"""OneDrive service: account connection, sync tasks, schedule and rclone runs.

Transfers are done by rclone (https://rclone.org). Talon signs in through its
own Entra ID app (see ``entra.py``), keeps the tokens in its state file and
writes a private rclone config for every run.
"""
from __future__ import annotations

import collections
import datetime
import hashlib
import io
import json
import os
import platform as pyplatform
import random
import re
import secrets
import shutil
import ssl
import subprocess
import threading
import time
import urllib.request
import uuid
import zipfile
from typing import Dict, Optional

from . import entra
from .util import UserError, write_atomic

RCLONE_DIR = "/opt/talon/bin"
RCLONE_MIN = (1, 66, 0)
DIRECTIONS = {"pull": "Backup from OneDrive", "push": "Backup to OneDrive", "bisync": "Two-way sync"}
INTERVALS = (15, 30, 60, 180, 360, 720, 1440)
NAME_RE = re.compile(r"^[^\x00-\x1f/\\]{1,64}$")
PATH_RE = re.compile(r"^[^\x00-\x1f\\]*$")
VERSIONS = ".versions"
KEEP_VERSIONS_DAYS = 30


def _clean_rel(path: str) -> str:
    parts = [p for p in str(path or "").replace("\\", "/").split("/") if p not in ("", ".")]
    if any(p == ".." for p in parts) or not PATH_RE.match("/".join(parts)):
        raise UserError("Invalid folder path")
    return "/".join(parts)


def parse_expiry(text: str) -> float:
    """RFC 3339 time as written by rclone (any fraction length, Z or +hh:mm)."""
    m = re.match(r"^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.\d+)?(Z|[+-]\d\d:\d\d)$", text.strip())
    if not m:
        raise ValueError(text)
    tz = "+00:00" if m.group(2) == "Z" else m.group(2)
    return datetime.datetime.fromisoformat(m.group(1) + tz).timestamp()


def _vtuple(text: str) -> Optional[tuple]:
    m = re.search(r"v(\d+)\.(\d+)\.(\d+)", text or "")
    return tuple(int(x) for x in m.groups()) if m else None


class CloudSync:
    def __init__(self, cfg, state, nas, demo: bool = False):
        self.cfg = cfg
        self.state = state
        self.nas = nas
        self.demo = demo
        self.base = os.path.dirname(os.path.abspath(cfg.state_file))
        self._pending: Dict[str, dict] = {}          # sign-in state -> PKCE data
        self._running: Dict[str, dict] = {}
        self._lock = threading.RLock()
        self._stop = threading.Event()
        self._installing = False
        self._demo_dirs: set = set()                 # folders created in demo mode

    # ------------------------------------------------------------ state helpers
    def _od(self) -> dict:
        return self.state.get("onedrive") or {}

    def _update(self, fn) -> None:
        def upd(d):
            od = d.setdefault("onedrive", {})
            od.setdefault("tasks", {})
            fn(od)
        self.state.update(upd)

    def _entra(self) -> dict:
        return self.state.get("entra") or {}

    # ------------------------------------------------------------ Entra ID settings
    def entra_public(self) -> dict:
        e = self._entra()
        return {"tenant": e.get("tenant", "common"), "client_id": e.get("client_id", ""),
                "secret_set": bool(e.get("client_secret")), "configured": entra.configured(e)}

    def entra_save(self, data: dict, user: str) -> dict:
        old = self._entra()
        merged = {**data, "client_secret": data.get("client_secret") or old.get("client_secret", "")}
        clean = entra.validate(merged)
        clean["tenant"] = (data.get("tenant") or "common").strip()
        self.state.update(lambda d: d.__setitem__("entra", clean))
        self.state.log_activity(user, "Updated the Entra ID app settings")
        return self.entra_public()

    def entra_test(self, data: dict, origin: str) -> list:
        old = self._entra()
        merged = {**old, **{k: v for k, v in data.items() if v not in (None, "")}}
        if self.demo:
            entra.validate(merged)
            entra.redirect_uri(origin)
            if not merged.get("client_id") or not merged.get("client_secret"):
                raise UserError("Enter the Application (client) ID and the client secret first")
            return [{"name": "Application ID and client secret", "ok": True,
                     "detail": "Accepted by Microsoft (demo)"},
                    {"name": "Redirect URI", "ok": True, "detail": entra.redirect_uri(origin)},
                    {"name": "Account types", "ok": True,
                     "detail": entra.ACCOUNT_TYPES.get(entra.tenant_of(merged), "One organization")}]
        return entra.test(merged, origin)

    # ------------------------------------------------------------ rclone
    def rclone_path(self) -> Optional[str]:
        if self.demo:
            return "rclone"
        own = os.path.join(RCLONE_DIR, "rclone")
        for cand in (own, shutil.which("rclone")):
            if cand and os.access(cand, os.X_OK):
                try:
                    out = subprocess.run([cand, "version"], capture_output=True, text=True,
                                         timeout=15).stdout
                except (OSError, subprocess.SubprocessError):
                    continue
                v = _vtuple(out)
                if v and v >= RCLONE_MIN:
                    return cand
        return None

    def _install_rclone(self, log) -> None:
        arch = {"x86_64": "amd64", "amd64": "amd64", "aarch64": "arm64", "arm64": "arm64",
                "armv7l": "arm-v7"}.get(pyplatform.machine())
        if not arch:
            raise UserError(f"No rclone build for {pyplatform.machine()}")
        ctx = ssl.create_default_context()

        def get(url: str) -> bytes:
            req = urllib.request.Request(url, headers={"User-Agent": "Talon-NAS"})
            with urllib.request.urlopen(req, timeout=120, context=ctx) as r:
                return r.read()
        version = _vtuple(get("https://downloads.rclone.org/version.txt").decode())
        if not version:
            raise UserError("Could not read the current rclone version")
        v = "v%d.%d.%d" % version
        name = f"rclone-{v}-linux-{arch}.zip"
        log(f"Downloading rclone {v} from downloads.rclone.org")
        sums = get(f"https://downloads.rclone.org/{v}/SHA256SUMS").decode()
        expected = next((ln.split()[0] for ln in sums.splitlines()
                         if ln.strip().endswith(name)), None)
        data = get(f"https://downloads.rclone.org/{v}/{name}")
        digest = hashlib.sha256(data).hexdigest()
        if not expected or digest != expected:
            raise UserError("rclone download failed the checksum check")
        log(f"Checksum OK ({digest[:16]}…)")
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            member = next(m for m in z.namelist() if m.endswith("/rclone"))
            binary = z.read(member)
        os.makedirs(RCLONE_DIR, exist_ok=True)
        tmp = os.path.join(RCLONE_DIR, ".rclone.new")
        with open(tmp, "wb") as f:
            f.write(binary)
        os.chmod(tmp, 0o755)
        os.replace(tmp, os.path.join(RCLONE_DIR, "rclone"))
        log(f"Installed rclone {v} to {RCLONE_DIR}")

    # ------------------------------------------------------------ service
    def enabled(self) -> bool:
        return bool(self._od().get("enabled"))

    def service_info(self) -> dict:
        on = self.enabled()
        return {"id": "onedrive", "unit": None, "installed": True, "active": on, "enabled": on,
                "label": "OneDrive", "description": "Backup and sync with OneDrive", "app": True}

    def set_enabled(self, on: bool, user: str):
        self._update(lambda od: od.__setitem__("enabled", on))
        self.state.log_activity(user, f"OneDrive service {'enabled' if on else 'disabled'}")
        if on and not self.rclone_path() and not self._installing:
            self._installing = True

            def work(log):
                try:
                    self._install_rclone(log)
                finally:
                    self._installing = False
            return self.nas.jobs.submit("Install rclone for OneDrive", user, work)
        if not on:
            for tid in list(self._running):
                self.stop_task(tid)
        return None

    # ------------------------------------------------------------ account
    def status(self) -> dict:
        od = self._od()
        tasks = [self._task_view(t) for t in sorted(od.get("tasks", {}).values(),
                                                    key=lambda t: t["name"].lower())]
        return {"enabled": bool(od.get("enabled")), "entra": self.entra_public(),
                "connected": bool(od.get("token")), "account": od.get("account"),
                "rclone": {"installed": bool(self.rclone_path()), "installing": self._installing},
                "tasks": tasks}

    def summary(self) -> Optional[dict]:
        """Dashboard tile: None while the OneDrive service is off."""
        st = self.status()
        if not st["enabled"]:
            return None
        tasks = st["tasks"]
        done = [t["last"] for t in tasks if t.get("last")]
        acc = st["account"] or {}
        return {"connected": st["connected"], "email": acc.get("email"),
                "used": acc.get("used"), "total": acc.get("total"),
                "tasks": len(tasks), "running": sum(1 for t in tasks if t["running"]),
                "errors": sum(1 for d in done if d["status"] == "error")}

    def connect_start(self, origin: str) -> str:
        e = self._entra()
        if not entra.configured(e):
            raise UserError("Configure the Entra ID app in Settings first")
        redirect = entra.redirect_uri(origin)
        state = secrets.token_urlsafe(24)
        verifier, challenge = entra.new_pkce()
        now = time.time()
        with self._lock:
            for k in [k for k, v in self._pending.items() if now - v["created"] > 900]:
                self._pending.pop(k, None)
            self._pending[state] = {"verifier": verifier, "redirect": redirect, "created": now}
        if self.demo:
            return f"{redirect}?code=demo&state={state}"
        return entra.authorize_url(e, redirect, state, challenge)

    def callback(self, code: str, state: str, error: str = "", detail: str = "") -> dict:
        with self._lock:
            pending = self._pending.pop(state or "", None)
        if not pending:
            raise UserError("This sign-in link has expired. Start again from Talon.")
        if error:
            raise UserError(entra.explain(set(int(c) for c in re.findall(r"AADSTS(\d+)", detail)),
                                          detail.split("\r\n")[0] or error))
        if self.demo:
            token = {"access_token": "demo", "refresh_token": "demo", "expires_at": time.time() + 3600}
            account = {"name": "Alex Demo", "email": "alex@outlook.com", "drive_id": "demo",
                       "drive_type": "personal", "used": 412 * 10**9, "total": 10**12}
        else:
            e = self._entra()
            t = entra.redeem_code(e, code, pending["redirect"], pending["verifier"])
            token = {"access_token": t["access_token"], "refresh_token": t.get("refresh_token", ""),
                     "expires_at": time.time() + int(t.get("expires_in", 3600))}
            account = entra.account_info(token["access_token"])
        account["connected_at"] = time.time()
        self._update(lambda od: (od.__setitem__("token", token), od.__setitem__("account", account)))
        self.state.log_activity("talon", f"OneDrive connected: {account['email']}")
        return account

    def disconnect(self, user: str) -> None:
        for tid in list(self._running):
            self.stop_task(tid)
        self._update(lambda od: (od.pop("token", None), od.pop("account", None)))
        self.state.log_activity(user, "OneDrive disconnected")

    def access_token(self) -> str:
        od = self._od()
        token = od.get("token")
        if not token:
            raise UserError("OneDrive is not connected")
        if self.demo or token.get("expires_at", 0) - time.time() > 300:
            return token["access_token"]
        t = entra.refresh(self._entra(), token["refresh_token"])
        new = {"access_token": t["access_token"],
               "refresh_token": t.get("refresh_token") or token["refresh_token"],
               "expires_at": time.time() + int(t.get("expires_in", 3600))}
        self._update(lambda o: o.__setitem__("token", new))
        return new["access_token"]

    def refresh_account(self) -> Optional[dict]:
        if self.demo or not self._od().get("token"):
            return self._od().get("account")
        info = entra.account_info(self.access_token())
        info["connected_at"] = (self._od().get("account") or {}).get("connected_at")
        self._update(lambda od: od.__setitem__("account", info))
        return info

    def items(self, path: str) -> list:
        """OneDrive folders and files at ``path`` (folders first)."""
        path = _clean_rel(path)
        if self.demo:
            dirs = {"": ["Documents", "Music", "NAS backup", "Pictures", "Work"],
                    "Pictures": ["2024", "2025", "2026", "Screenshots"],
                    "Documents": ["Invoices", "Taxes"], "Work": ["Projects", "Reports"]}
            files = {"Documents": [("Car insurance.pdf", 220_000), ("Lease agreement.pdf", 640_000),
                                   ("Passport scan.jpg", 1_100_000)],
                     "Pictures": [("Profile.png", 380_000)], "": [("Notes.txt", 2_000)]}
            return [{"name": n, "folder": True, "size": 0} for n in dirs.get(path, [])] + \
                [{"name": n, "folder": False, "size": s} for n, s in files.get(path, [])]
        return entra.list_items(self.access_token(), path)

    def local_folders(self, volume: str, path: str) -> list:
        root = self._volume_root(volume)
        target = os.path.realpath(os.path.join(root, _clean_rel(path)))
        if not target.startswith(root):
            raise UserError("Invalid folder")
        if self.demo:
            made = {n for p, n in self._demo_dirs if p == (volume, _clean_rel(path))}
            dirs = sorted({*(["Documents", "Media", "Office", "Photos"] if target == root else []),
                           *made}, key=str.lower)
            files = [("Budget 2026.xlsx", 48_000), ("Readme.txt", 1_200)] if target == root else []
            return [{"name": n, "folder": True, "size": 0} for n in dirs] + \
                [{"name": n, "folder": False, "size": s} for n, s in files]
        out = []
        try:
            for n in os.listdir(target):
                if n.startswith("."):
                    continue
                full = os.path.join(target, n)
                if os.path.isdir(full):
                    out.append({"name": n, "folder": True, "size": 0})
                elif os.path.isfile(full):
                    out.append({"name": n, "folder": False, "size": os.path.getsize(full)})
        except OSError:
            return []
        return sorted(out, key=lambda i: (not i["folder"], i["name"].lower()))

    def make_local_folder(self, volume: str, path: str, name: str) -> str:
        """Create a folder inside a volume; returns its path relative to the volume."""
        name = str(name or "").strip()
        if not name or name in (".", "..") or name.startswith(".") or "/" in name \
                or "\\" in name or len(name) > 128 or not PATH_RE.match(name):
            raise UserError("Enter a folder name without / (not starting with a dot)")
        root = self._volume_root(volume)
        rel = _clean_rel(f"{_clean_rel(path)}/{name}")
        target = os.path.realpath(os.path.join(root, rel))
        if not target.startswith(root + os.sep):
            raise UserError("Invalid folder")
        if self.demo:
            if (volume, _clean_rel(path), name) in {(v, p, n) for (v, p), n in self._demo_dirs}:
                raise UserError(f"{name} already exists")
            self._demo_dirs.add(((volume, _clean_rel(path)), name))
            return rel
        if os.path.exists(target):
            raise UserError(f"{name} already exists")
        os.makedirs(target, mode=0o775)
        return rel

    # ------------------------------------------------------------ tasks
    def _volume_root(self, volume: str) -> str:
        vols = {v["name"]: v for v in self.nas.volumes()}
        v = vols.get(volume)
        if not v:
            raise UserError(f"Volume {volume} not found")
        if not v["mounted"] and not self.demo:
            raise UserError(f"Volume {volume} is not mounted")
        return os.path.realpath(v["mountpoint"])

    def _validate(self, data: dict) -> dict:
        name = str(data.get("name", "")).strip()
        if not NAME_RE.match(name):
            raise UserError("Enter a task name (max 64 characters)")
        direction = data.get("direction")
        if direction not in DIRECTIONS:
            raise UserError("Choose a direction")
        remote = _clean_rel(data.get("remote", ""))
        volume = str(data.get("volume", ""))
        self._volume_root(volume)
        folder = _clean_rel(data.get("folder", ""))
        sched = data.get("schedule") or {"kind": "manual"}
        kind = sched.get("kind")
        if kind == "interval":
            if int(sched.get("minutes", 0)) not in INTERVALS:
                raise UserError("Invalid interval")
            sched = {"kind": "interval", "minutes": int(sched["minutes"])}
        elif kind == "daily":
            if not re.match(r"^([01]\d|2[0-3]):[0-5]\d$", str(sched.get("time", ""))):
                raise UserError("Time must be HH:MM")
            sched = {"kind": "daily", "time": sched["time"]}
        elif kind == "manual":
            sched = {"kind": "manual"}
        else:
            raise UserError("Invalid schedule")
        bw = str(data.get("bwlimit", "") or "").strip().upper()
        if bw and not re.match(r"^\d{1,5}[KMG]?$", bw):
            raise UserError("Speed limit must look like 10M (10 MB/s)")
        try:
            max_delete = int(data.get("max_delete", 50))
        except (TypeError, ValueError):
            raise UserError("Invalid delete limit") from None
        if not 1 <= max_delete <= 100:
            raise UserError("Delete limit must be 1-100%")
        # the source may be a single file: OneDrive for "pull", the NAS for "push"
        source_file = bool(data.get("source_file"))
        if source_file and direction == "bisync":
            raise UserError("Two-way sync works with folders only")
        if source_file and not (remote if direction == "pull" else folder):
            raise UserError("Choose a file")
        return {"name": name, "direction": direction, "remote": remote, "volume": volume,
                "folder": folder, "schedule": sched, "bwlimit": bw, "source_file": source_file,
                "delete": bool(data.get("delete")) and direction != "bisync" and not source_file,
                "versions": bool(data.get("versions")) and direction != "bisync",
                "max_delete": max_delete}

    def _task(self, tid: str) -> dict:
        t = self._od().get("tasks", {}).get(tid)
        if not t:
            raise UserError("Task not found")
        return t

    def create_task(self, data: dict, user: str) -> dict:
        task = {**self._validate(data), "id": uuid.uuid4().hex[:10], "created": time.time(),
                "last": None, "bisync_ready": False}
        self._update(lambda od: od["tasks"].__setitem__(task["id"], task))
        self.state.log_activity(user, f"Created OneDrive task {task['name']}")
        return self._task_view(task)

    def update_task(self, tid: str, data: dict, user: str) -> dict:
        old = self._task(tid)
        if tid in self._running:
            raise UserError("Stop the task before editing it")
        new = {**old, **self._validate(data)}
        if (new["remote"], new["volume"], new["folder"], new["direction"]) != \
                (old["remote"], old["volume"], old["folder"], old["direction"]) or \
                new.get("source_file") != old.get("source_file"):
            new["bisync_ready"] = False
        self._update(lambda od: od["tasks"].__setitem__(tid, new))
        self.state.log_activity(user, f"Updated OneDrive task {new['name']}")
        return self._task_view(new)

    def delete_task(self, tid: str, user: str) -> None:
        t = self._task(tid)
        self.stop_task(tid)
        self._update(lambda od: od["tasks"].pop(tid, None))
        shutil.rmtree(os.path.join(self.base, "bisync", tid), ignore_errors=True)
        self.state.log_activity(user, f"Deleted OneDrive task {t['name']}")

    def _task_view(self, t: dict) -> dict:
        r = self._running.get(t["id"])
        run = None
        if r:
            run = {k: r[k] for k in ("started", "files", "total_files", "bytes", "total_bytes",
                                     "speed")}
        return {**{k: v for k, v in t.items() if k != "bisync_ready"},
                "running": run, "next_run": self._next_run(t)}

    def task_log(self, tid: str) -> list:
        self._task(tid)
        r = self._running.get(tid)
        if r:
            return list(r["log"])
        try:
            with open(os.path.join(self.base, "cloud-logs", f"{tid}.log")) as f:
                return f.read().splitlines()[-500:]
        except OSError:
            return []

    # ------------------------------------------------------------ schedule
    def _next_run(self, t: dict) -> Optional[float]:
        s = t["schedule"]
        last = (t.get("last") or {}).get("started") or 0
        if s["kind"] == "interval":
            return max(last or t["created"], t["created"]) + s["minutes"] * 60
        if s["kind"] == "daily":
            hh, mm = map(int, s["time"].split(":"))
            lt = time.localtime()
            today = time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, hh, mm, 0, 0, 0, -1))
            return today if time.time() < today else today + 86400
        return None

    def _due(self, t: dict, now: float) -> bool:
        s = t["schedule"]
        last = (t.get("last") or {}).get("started") or 0
        if s["kind"] == "interval":
            return now >= max(last, t["created"]) + s["minutes"] * 60
        if s["kind"] == "daily":
            hh, mm = map(int, s["time"].split(":"))
            lt = time.localtime(now)
            today = time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, hh, mm, 0, 0, 0, -1))
            return now >= today and last < today and t["created"] < today
        return False

    def start(self) -> None:
        threading.Thread(target=self._scheduler, daemon=True, name="cloudsync").start()

    def stop(self) -> None:
        self._stop.set()

    def _scheduler(self) -> None:
        while not self._stop.wait(20):
            try:
                od = self._od()
                if not od.get("enabled") or not od.get("token"):
                    continue
                now = time.time()
                for t in od.get("tasks", {}).values():
                    if t["id"] not in self._running and self._due(t, now):
                        self.run_task(t["id"], "schedule")
            except Exception:   # noqa: BLE001 - the scheduler must keep running
                pass

    # ------------------------------------------------------------ running
    def run_task(self, tid: str, user: str) -> None:
        t = self._task(tid)
        od = self._od()
        if not od.get("enabled"):
            raise UserError("The OneDrive service is disabled")
        if not od.get("token"):
            raise UserError("OneDrive is not connected")
        if not self.rclone_path():
            raise UserError("rclone is still being installed. Try again in a minute.")
        with self._lock:
            if tid in self._running:
                raise UserError("The task is already running")
            self._running[tid] = {"started": time.time(), "files": 0, "total_files": 0, "bytes": 0,
                                  "total_bytes": 0, "speed": 0, "proc": None, "cancel": False,
                                  "log": collections.deque(maxlen=500)}
        threading.Thread(target=self._run, args=(t, user), daemon=True,
                         name=f"cloud-{tid}").start()

    def stop_task(self, tid: str) -> None:
        r = self._running.get(tid)
        if r:
            r["cancel"] = True
            if r.get("proc"):
                try:
                    r["proc"].terminate()
                except OSError:
                    pass

    def _rclone_conf(self, tid: str) -> str:
        e = self._entra()
        od = self._od()
        token = od["token"]
        account = od.get("account") or {}
        tenant = entra.tenant_of(e)
        expiry = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(token["expires_at"]))
        tok = json.dumps({"access_token": token["access_token"], "token_type": "Bearer",
                          "refresh_token": token["refresh_token"], "expiry": expiry})
        conf = "\n".join([
            "[onedrive]", "type = onedrive", f"client_id = {e['client_id']}",
            f"client_secret = {e['client_secret']}", f"token = {tok}",
            f"drive_id = {account.get('drive_id', '')}",
            f"drive_type = {account.get('drive_type', 'personal')}",
            f"auth_url = {entra.LOGIN}/{tenant}/oauth2/v2.0/authorize",
            f"token_url = {entra.LOGIN}/{tenant}/oauth2/v2.0/token", ""])
        path = os.path.join(self.base, "rclone", f"{tid}.conf")
        os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
        write_atomic(path, conf, 0o600)
        return path

    def _read_back_token(self, conf: str) -> None:
        """rclone refreshes long runs itself and writes the new token to its config."""
        try:
            with open(conf) as f:
                line = next((ln for ln in f if ln.startswith("token = ")), None)
            if not line:
                return
            t = json.loads(line[len("token = "):])
            exp = parse_expiry(t["expiry"])
            cur = self._od().get("token") or {}
            if t.get("refresh_token") and exp > cur.get("expires_at", 0):
                self._update(lambda od: od.__setitem__("token", {
                    "access_token": t["access_token"], "refresh_token": t["refresh_token"],
                    "expires_at": exp}))
        except (OSError, ValueError, KeyError):
            pass

    def command(self, t: dict, conf: str, local: str, first_bisync: bool) -> list:
        remote = "onedrive:" + t["remote"]
        stamp = time.strftime("%Y-%m-%d_%H%M%S")
        args = [self.rclone_path() or "rclone", "--config", conf, "--use-json-log",
                "--log-level", "INFO", "--stats", "2s", "--transfers", "4",
                "--filter", f"- /{VERSIONS}/**"]
        if t["bwlimit"]:
            args += ["--bwlimit", t["bwlimit"]]
        if t["direction"] == "bisync":
            args += ["bisync", local, remote, "--resilient", "--recover", "--max-lock", "2m",
                     "--max-delete", str(t["max_delete"]), "--conflict-resolve", "none",
                     "--conflict-loser", "num", "--create-empty-src-dirs",
                     "--workdir", os.path.join(self.base, "bisync", t["id"])]
            if first_bisync:
                args.append("--resync")
            return args
        src, dst = (remote, local) if t["direction"] == "pull" else (local, remote)
        args += ["sync" if t["delete"] else "copy", src, dst]
        if t["versions"]:
            base = dst.rstrip("/") + "/" if dst != "onedrive:" else dst
            args += ["--backup-dir", f"{base}{VERSIONS}/{stamp}"]
        return args

    def _run(self, t: dict, user: str) -> None:
        tid = t["id"]
        r = self._running[tid]
        status, error = "success", None
        log = r["log"]
        try:
            local = os.path.join(self._volume_root(t["volume"]), t["folder"])
            if self.demo:
                status, error = self._simulate(r)
            else:
                if t.get("source_file") and t["direction"] == "push":
                    if not os.path.isfile(local):
                        raise UserError(f"File not found: {t['volume']}/{t['folder']}")
                else:
                    os.makedirs(local, exist_ok=True)
                self.access_token()                       # refresh before writing the config
                conf = self._rclone_conf(tid)
                first = t["direction"] == "bisync" and not t.get("bisync_ready")
                cmd = self.command(t, conf, local, first)
                log.append("$ " + " ".join(a if "conf" not in a else "<config>" for a in cmd))
                proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                        text=True, bufsize=1)
                r["proc"] = proc
                last_err = ""
                for line in proc.stdout:
                    self._parse(line, r)
                    if '"level":"error"' in line or "ERROR" in line:
                        last_err = line
                rc = proc.wait()
                self._read_back_token(conf)
                if r["cancel"]:
                    status, error = "cancelled", "Stopped"
                elif rc != 0:
                    status = "error"
                    error = self._message(last_err) or f"rclone exited with code {rc}"
                elif first:
                    self._update(lambda od: od["tasks"].get(tid, {}).__setitem__("bisync_ready", True))
                if status == "success" and t["versions"]:
                    self._prune_versions(t, conf, local)
        except UserError as e:
            status, error = "error", str(e)
        except Exception as e:  # noqa: BLE001
            status, error = "error", f"{type(e).__name__}: {e}"
        finally:
            last = {"started": r["started"], "finished": time.time(), "status": status,
                    "files": r["files"], "bytes": r["bytes"], "error": error}
            self._update(lambda od: od["tasks"].get(tid) is not None and
                         od["tasks"][tid].__setitem__("last", last))
            try:
                os.makedirs(os.path.join(self.base, "cloud-logs"), exist_ok=True)
                write_atomic(os.path.join(self.base, "cloud-logs", f"{tid}.log"),
                             "\n".join(log) + "\n", 0o600)
            except OSError:
                pass
            with self._lock:
                self._running.pop(tid, None)
            msg = f"OneDrive task {t['name']}: " + (
                f"{r['files']} file(s) transferred" if status == "success" else error or status)
            self.state.log_activity(user, msg, "info" if status != "error" else "error")
            if status == "error":
                self.nas.notifier.send("cloud_failed", f"OneDrive task {t['name']} failed",
                                       f"The OneDrive task '{t['name']}' failed:\n{error}")

    @staticmethod
    def _message(line: str) -> str:
        try:
            return json.loads(line).get("msg", "")[:300]
        except ValueError:
            return line.strip()[:300]

    @staticmethod
    def _parse(line: str, r: dict) -> None:
        line = line.rstrip("\n")
        try:
            d = json.loads(line)
        except ValueError:
            if line:
                r["log"].append(line)
            return
        st = d.get("stats")
        if st:
            r.update(files=st.get("transfers", 0), total_files=st.get("totalTransfers", 0),
                     bytes=st.get("bytes", 0), total_bytes=st.get("totalBytes", 0),
                     speed=st.get("speed", 0))
            return
        msg = d.get("msg", "")
        obj = d.get("object", "")
        r["log"].append(f"{d.get('level', 'info').upper()}: {obj + ': ' if obj else ''}{msg}".strip())

    def _prune_versions(self, t: dict, conf: str, local: str) -> None:
        if t["direction"] == "pull":
            root = os.path.join(local, VERSIONS)
            cutoff = time.time() - KEEP_VERSIONS_DAYS * 86400
            for name in os.listdir(root) if os.path.isdir(root) else []:
                p = os.path.join(root, name)
                if os.path.getmtime(p) < cutoff:
                    shutil.rmtree(p, ignore_errors=True)
        elif t["direction"] == "push":
            subprocess.run([self.rclone_path() or "rclone", "--config", conf, "delete",
                            "--min-age", f"{KEEP_VERSIONS_DAYS}d", "--rmdirs",
                            f"onedrive:{t['remote']}/{VERSIONS}".replace(":/", ":")],
                           capture_output=True, timeout=3600)

    def _simulate(self, r: dict):
        total = random.randint(20, 400)
        size = total * random.randint(200_000, 4_000_000)
        r.update(total_files=total, total_bytes=size)
        for i in range(1, 21):
            if r["cancel"]:
                return "cancelled", "Stopped"
            time.sleep(0.5)
            r.update(files=total * i // 20, bytes=size * i // 20, speed=size / 10)
            r["log"].append(f"INFO: Copied {total * i // 20} of {total} files (demo)")
        return "success", None
