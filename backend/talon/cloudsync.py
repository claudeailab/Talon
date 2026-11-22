"""OneDrive service: account connection, sync tasks, schedule and rclone runs.

Transfers are done by rclone (https://rclone.org). Talon signs in through its
own EntraID app (see ``entra.py``), keeps the tokens in its state file and
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

# rclone's exit codes (https://rclone.org/docs/#exit-code), used when it printed no error
RCLONE_EXIT = {
    1: "rclone: error not otherwise categorised",
    2: "rclone: syntax or usage error",
    3: "rclone: folder not found",
    4: "rclone: file not found",
    5: "rclone: temporary error; it may work next time",
    6: "rclone: some files could not be copied",
    7: "rclone: fatal error; retrying will not help",
    8: "rclone: transfer limit reached",
    9: "rclone: no files were transferred",
    10: "rclone: time limit reached",
}

SIGNAL_EXIT = (130, 137, 143)    # 128 + SIGINT / SIGKILL / SIGTERM
RETRY_CHOICES = (0, 1, 2, 3, 5)
RETRY_DELAY = 120                # seconds between attempts
RESUME_DELAY = 30                # seconds after start-up before interrupted runs resume

REMIND_DAYS = (7, 14, 30, 60, 90)
REMIND_DEFAULT = 30

RCLONE_DIR = "/opt/talon/bin"
RCLONE_MIN = (1, 66, 0)
DIRECTIONS = {"pull": "Backup from OneDrive", "push": "Backup to OneDrive", "bisync": "Two-way sync"}
INTERVALS = (15, 30, 60, 180, 360, 720, 1440)
NAME_RE = re.compile(r"^[^\x00-\x1f/\\]{1,64}$")
PATH_RE = re.compile(r"^[^\x00-\x1f\\]*$")
VERSIONS = ".versions"
VERIFY_MODES = ("off", "quick", "full")
READ_TEST_SECONDS = 10
UNRESOLVED_KEEP = 200            # files listed in the result of a failed check
KEEP_VERSIONS_DAYS = 30


def _duration(secs: float) -> str:
    secs = int(secs)
    if secs < 90:
        return f"{max(secs, 1)} s"
    if secs < 3600:
        return f"{round(secs / 60)} min"
    h, m = divmod(round(secs / 60), 60)
    return f"{h} h {m} min" if m else f"{h} h"


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
        self._measuring: set = set()
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

    # ------------------------------------------------------------ EntraID settings
    def entra_public(self) -> dict:
        e = self._entra()
        return {"tenant": e.get("tenant", "common"), "domain": e.get("domain", ""), "client_id": e.get("client_id", ""),
                "secret_set": bool(e.get("client_secret")), "configured": entra.configured(e),
                "secret_expires": e.get("secret_expires", ""),
                "remind_days": e.get("remind_days", REMIND_DEFAULT),
                "remind_to": e.get("remind_to", []),
                "expiry": self.secret_expiry()}

    def entra_save(self, data: dict, user: str) -> dict:
        from .notify import parse_recipients
        old = self._entra()
        tenant = self._tenant(data.get("tenant"))
        merged = {**data, "tenant": tenant, "client_secret": data.get("client_secret") or old.get("client_secret", "")}
        clean = entra.validate(merged)
        clean["tenant"] = tenant
        # which accounts the app allows (work or school, personal, or both): asked
        # of Microsoft, so Settings never has to ask for an account type
        clean["onedrive_authority"] = old.get("onedrive_authority") or tenant
        if clean["client_id"]:
            if self.demo:
                clean["onedrive_authority"] = "common"
            elif data.get("origin"):
                try:
                    clean["onedrive_authority"] = entra.detect_onedrive_authority(clean, entra.redirect_uri(data["origin"]))
                except UserError:
                    pass
        # keep the domain the organization was entered with, to show it again
        raw = str(data.get("tenant") or "").strip().lower().split("@")[-1]
        clean["domain"] = raw if entra.GUID_RE.match(tenant) and not entra.GUID_RE.match(raw) else ""
        expires = str(data.get("secret_expires") or "").strip()
        if expires:
            try:                                    # yyyy-mm-dd from the UI, or dd-mm-yyyy
                if re.match(r"^\d{1,2}[-./]\d{1,2}[-./]\d{4}$", expires):
                    d, m, y = map(int, re.split(r"[-./]", expires))
                    expires = datetime.date(y, m, d).isoformat()
                else:
                    expires = datetime.date.fromisoformat(expires).isoformat()
            except ValueError:
                raise UserError("Enter the expiry date as dd-mm-yyyy") from None
        try:
            days = int(data.get("remind_days", REMIND_DEFAULT))
        except (TypeError, ValueError):
            days = -1
        if days not in REMIND_DAYS:
            raise UserError("Choose when to send the reminder")
        clean.update(secret_expires=expires, remind_days=days,
                     remind_to=parse_recipients(data.get("remind_to") or []))
        # a new date (or a new secret) starts the reminders again
        if expires != old.get("secret_expires") or data.get("client_secret"):
            clean["reminded"] = []
        else:
            clean["reminded"] = old.get("reminded", [])
        self.state.update(lambda d: d.__setitem__("entra", clean))
        self.state.log_activity(user, "Updated the EntraID app settings")
        return self.entra_public()

    def secret_expiry(self) -> Optional[dict]:
        """Days until the client secret expires and whether a reminder is due."""
        e = self._entra()
        if not e.get("secret_expires"):
            return None
        try:
            date = datetime.date.fromisoformat(e["secret_expires"])
        except ValueError:
            return None
        days = (date - datetime.date.today()).days
        return {"date": e["secret_expires"], "days": days,
                "remind": days <= e.get("remind_days", REMIND_DEFAULT)}

    def check_secret_expiry(self) -> None:
        """Mail one reminder when the reminder period starts and one when it expires."""
        exp = self.secret_expiry()
        if not exp or not exp["remind"]:
            return
        stage = "expired" if exp["days"] < 0 else "soon"
        e = self._entra()
        if stage in e.get("reminded", []):
            return
        dmy = datetime.date.fromisoformat(exp["date"]).strftime("%d-%m-%Y")
        if stage == "soon":
            subject = f"EntraID client secret expires on {dmy}"
            when = "tomorrow" if exp["days"] == 1 else ("today" if exp["days"] == 0 else f"in {exp['days']} days")
            body = (f"The client secret of the EntraID app used by Talon for OneDrive expires {when} "
                    f"({dmy}).\n\n")
        else:
            subject = "EntraID client secret has expired"
            body = f"The client secret of the EntraID app used by Talon expired on {dmy}. " \
                   "OneDrive tasks cannot sign in until it is replaced.\n\n"
        body += ("To replace it: in entra.microsoft.com open the app > Certificates & secrets > "
                 "New client secret, then paste the new Value and its expiry date in "
                 "Talon > Settings > EntraID and click Save.")
        to = e.get("remind_to") or self.nas.notifier.settings()["recipients"]
        if not to or not (self.state.get("smtp") or {}).get("host"):
            return                      # nowhere to send it yet; try again later
        self.nas.notifier.send("entra_secret", subject, body, force=True, to=to)
        self.state.update(lambda d: d["entra"].__setitem__(
            "reminded", sorted(set(d["entra"].get("reminded", [])) | {stage})))

    def _tenant(self, value) -> str:
        """The account type from Settings: "consumers" (personal), or a work or
        school organization by tenant ID or email domain (turned into the ID)."""
        tenant = str(value or "").strip()
        if not tenant:
            raise UserError("Enter the Directory (tenant) ID from the app's Overview page")
        if self.demo and tenant not in ("consumers", "common", "organizations") and not entra.GUID_RE.match(tenant):
            return "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        return entra.resolve_tenant(tenant)

    def entra_test(self, data: dict, origin: str) -> list:
        old = self._entra()
        merged = {**old, **{k: v for k, v in data.items() if v not in (None, "")}}
        if merged.get("tenant"):
            merged["tenant"] = self._tenant(merged["tenant"])
        if self.demo:
            entra.validate(merged)
            entra.redirect_uri(origin)
            if not merged.get("client_id") or not merged.get("client_secret"):
                raise UserError("Enter the Application (client) ID and the client secret first")
            return [{"name": "Application ID and client secret", "ok": True,
                     "detail": "Accepted by Microsoft (demo)"},
                    {"name": "Redirect URI", "ok": True, "detail": entra.redirect_uri(origin)},
                    {"name": "Accounts", "ok": True, "detail": entra.ACCOUNTS["common"] + " (demo)"}] + (
                [{"name": "Directory users (EntraID Users)", "ok": True,
                  "detail": "The app can read your organization's users (demo)"}]
                if entra.GUID_RE.match(entra.tenant_of(merged)) else [])
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
            raise UserError("Configure the EntraID app in Settings first")
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
                       "drive_type": "personal", "used": 412 * 2**30, "total": 2**40}
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
        try:
            retries = int(data.get("retries", 2))
        except (TypeError, ValueError):
            retries = -1
        if retries not in RETRY_CHOICES:
            raise UserError("Choose how often to retry")
        # the source may be a single file: OneDrive for "pull", the NAS for "push"
        source_file = bool(data.get("source_file"))
        if source_file and direction == "bisync":
            raise UserError("Two-way sync works with folders only")
        if source_file and not (remote if direction == "pull" else folder):
            raise UserError("Choose a file")
        verify = data.get("verify", "quick")
        if verify not in VERIFY_MODES:
            raise UserError("Choose how to verify")
        full = data.get("full_check") or {"kind": "never"}
        fk = full.get("kind")
        time_ok = re.match(r"^([01]\d|2[0-3]):[0-5]\d$", str(full.get("time", "")))
        if fk == "never":
            full = {"kind": "never"}
        elif fk == "weekly" and time_ok and full.get("weekday") in range(7):
            full = {"kind": "weekly", "weekday": full["weekday"], "time": full["time"]}
        elif fk == "monthly" and time_ok and full.get("day") in range(1, 29):
            full = {"kind": "monthly", "day": int(full["day"]), "time": full["time"]}
        else:
            raise UserError("Invalid full check schedule")
        if source_file:
            verify, full = "off", {"kind": "never"}
        return {"name": name, "direction": direction, "remote": remote, "volume": volume,
                "folder": folder, "schedule": sched, "bwlimit": bw, "source_file": source_file,
                "delete": bool(data.get("delete")) and direction != "bisync" and not source_file,
                # replaced files are kept (Files > Previous versions) when backing up
                # OneDrive to the NAS; OneDrive keeps its own version history
                "versions": direction == "pull",
                "max_delete": max_delete, "retries": retries, "verify": verify, "full_check": full}

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
            run["comparing"] = r.get("comparing", False)
            run["checks"] = r.get("checks", 0)
            run["total_checks"] = r.get("total_checks", 0)
            run["listed"] = r.get("listed", 0)
            now = time.time()
            run["idle"] = int(now - (r.get("active") or r["started"]))
            run["throttled"] = max(0, int(r.get("throttled_until", 0) - now)) or None
            run["phase"] = r.get("phase") or ("comparing" if run["comparing"] else "copying")
            run["percent"] = None if run["comparing"] else self.percent(r)
            run["read_speed"] = r.get("read_speed")
            run["mode"] = r.get("mode") or "run"
            run["eta"] = None
            if run["phase"] == "verifying":
                expected = (t.get("profile") or {}).get("files") or 0
                done = r.get("checks", 0)
                total = max(r.get("total_checks", 0), expected, done)
                run["percent"] = round(min(99.0, done * 100 / total), 1) if total else 0.0
                run["total_checks"] = total
                spent = now - r.get("phase_started", now)
                if run["percent"] >= 3 and spent >= 20:
                    run["eta"] = int(spent * (100 - run["percent"]) / run["percent"])
                elif r.get("estimate"):
                    run["eta"] = max(0, int(min(r["estimate"] - spent,
                                                r["estimate"] * (100 - run["percent"]) / 100)))
            elif run["phase"] == "fixing":
                run["percent"] = self.percent(r)
        return {**{k: v for k, v in t.items() if k not in ("bisync_ready", "profile")},
                "running": run, "next_run": self._next_run(t),
                "next_full_check": self._next_full(t), "estimate": self.estimate(t)}

    @staticmethod
    def percent(r: dict) -> float:
        """Progress by files. rclone first compares both sides (--check-first), so
        the totals are final when copying starts; files that are already up to
        date count as done, so a run resumed after a restart starts where it was."""
        done = r.get("checks", 0) + r["files"]
        total = max(r.get("total_checks", 0) + r["total_files"], done)
        if not total:
            return 0.0
        return round(min(99.0, done * 100 / total), 1)

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

    def _next_full(self, t: dict) -> Optional[float]:
        full = t.get("full_check") or {"kind": "never"}
        if full["kind"] == "never":
            return None
        from .scheduler import next_run
        last = (t.get("last_verify") or {}).get("started") if (t.get("last_verify") or {}).get("mode") == "full" else 0
        return next_run(full, max(last or 0, t.get("created", 0), time.time() - 1))

    def _full_due(self, t: dict, now: float) -> bool:
        full = t.get("full_check") or {"kind": "never"}
        if full["kind"] == "never":
            return False
        from .scheduler import next_run
        lv = t.get("last_verify") or {}
        last = lv.get("started") if lv.get("mode") == "full" else 0
        due = next_run(full, max(last or 0, t.get("created", 0)))
        return due is not None and now >= due

    def estimate(self, t: dict) -> Optional[dict]:
        """How long a quick and a full check take for this task, from its own files:
        the file count and size of its NAS folder (after each run), how long the last
        comparison or quick check took, and the measured read speed of its volume."""
        if t.get("source_file"):
            return None
        p = t.get("profile") or {}
        if not p.get("files"):
            return {"files": None, "bytes": None, "quick_secs": None, "full_secs": None,
                    "speed": None, "measuring": False}
        speed = (self._od().get("read_speed") or {}).get(t["volume"]) or {}
        quick = p.get("quick_secs") or p.get("compare_secs")
        full = None
        if speed.get("bps"):
            full = p["bytes"] / speed["bps"]
            if speed.get("source") == "test":
                full += p.get("compare_secs") or 0     # a full check also lists both sides
        elif t["volume"] not in self._measuring:
            self._measure_later(t)
        return {"files": p["files"], "bytes": p["bytes"],
                "quick_secs": int(quick) if quick else None, "full_secs": int(full) if full else None,
                "speed": speed.get("bps"), "speed_source": speed.get("source"),
                "measuring": t["volume"] in self._measuring}

    def _measure_later(self, t: dict) -> None:
        vol = t["volume"]
        self._measuring.add(vol)
        def work():
            try:
                bps = 240e6 if self.demo else self.read_test(
                    os.path.join(self._volume_root(vol), t["folder"]))
                if bps:
                    self._update(lambda od: od.setdefault("read_speed", {}).__setitem__(
                        vol, {"bps": bps, "source": "test", "at": time.time()}))
            except Exception:   # noqa: BLE001 - only an estimate
                pass
            finally:
                self._measuring.discard(vol)
        threading.Thread(target=work, daemon=True, name="read-test").start()

    @staticmethod
    def read_test(folder: str, seconds: float = READ_TEST_SECONDS) -> Optional[float]:
        """Read the task's own files for a few seconds, past the page cache, with 4
        readers (like rclone's checkers), and return bytes per second. Reading real
        files includes the slowdown of many small files."""
        paths = []
        for root, dirs, files in os.walk(folder):
            dirs[:] = [d for d in dirs if d != VERSIONS]
            paths += [os.path.join(root, f) for f in files]
            if len(paths) >= 20000:
                break
        if not paths:
            return None
        lock, total, idx = threading.Lock(), [0], [0]
        end = time.time() + seconds
        def reader():
            while time.time() < end:
                with lock:
                    if idx[0] >= len(paths):
                        return
                    path = paths[idx[0]]
                    idx[0] += 1
                try:
                    fd = os.open(path, os.O_RDONLY)
                except OSError:
                    continue
                try:
                    os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)   # not from memory
                    while time.time() < end:
                        b = os.read(fd, 1 << 20)
                        if not b:
                            break
                        with lock:
                            total[0] += len(b)
                except OSError:
                    pass
                finally:
                    os.close(fd)
        t0 = time.time()
        threads = [threading.Thread(target=reader, daemon=True) for _ in range(4)]
        for th in threads:
            th.start()
        for th in threads:
            th.join()
        spent = time.time() - t0
        return total[0] / spent if total[0] and spent > 0 else None

    @staticmethod
    def folder_size(folder: str) -> tuple:
        files = size = 0
        if os.path.isfile(folder):
            return 1, os.path.getsize(folder)
        for root, dirs, names in os.walk(folder):
            dirs[:] = [d for d in dirs if d != VERSIONS]
            for n in names:
                try:
                    size += os.lstat(os.path.join(root, n)).st_size
                    files += 1
                except OSError:
                    pass
        return files, size

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

    def migrate_tenant(self) -> None:
        """Earlier versions asked for an account type (personal and work, any work
        or school account, personal only). Settings now asks only for the
        Directory (tenant) ID: keep OneDrive signing in where it did, and fill in
        the tenant ID from the connected work or school OneDrive."""
        e = self._entra()
        old = e.get("tenant")
        if old not in ("common", "organizations", "consumers"):
            return
        tid = entra.tenant_from_token(((self._od().get("token") or {}).get("access_token")) or "")

        def upd(d):
            d["entra"]["onedrive_authority"] = d["entra"].get("onedrive_authority") or old
            if tid:
                d["entra"]["tenant"] = tid
        self.state.update(upd)
        if tid:
            self.state.log_activity("talon", "EntraID app: Directory (tenant) ID filled in from OneDrive",
                                    "info", "settings")

    def start(self) -> None:
        try:
            self.migrate_tenant()
        except Exception:   # noqa: BLE001 - only a convenience
            pass
        threading.Thread(target=self._scheduler, daemon=True, name="cloudsync").start()
        threading.Thread(target=self._resume, daemon=True, name="cloud-resume").start()

    def _resume(self) -> None:
        """Restart runs that were interrupted by a restart of Talon or the NAS.
        rclone skips what was already copied, so the run carries on."""
        def stopped_by_restart(t):
            # runs before 1.0.54 recorded a restart as a failure ("exited with code 143")
            last = t.get("last") or {}
            return (last.get("status") == "error" and time.time() - (last.get("finished") or 0) < 86400
                    and any(f"exited with code {c}" in (last.get("error") or "") for c in SIGNAL_EXIT))
        interrupted = [t for t in (self._od().get("tasks") or {}).values()
                       if t.get("interrupted") or stopped_by_restart(t)]
        if not interrupted:
            return
        self._stop.wait(RESUME_DELAY)                 # let the network and rclone come up
        for t in interrupted:
            try:
                intr = t.get("interrupted") or {}
                self.run_task(t["id"], intr.get("user") or "schedule", resumed=True,
                              mode=intr.get("mode") or "run")
            except UserError as e:
                self._update(lambda od, tid=t["id"]: od["tasks"].get(tid, {}).pop("interrupted", None))
                self.state.log_activity("talon", f"OneDrive task {t['name']} could not resume: {e}", "warning")

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
                    elif t["id"] not in self._running and self._full_due(t, now):
                        self.run_task(t["id"], "schedule", mode="full")
            except Exception:   # noqa: BLE001 - the scheduler must keep running
                pass

    # ------------------------------------------------------------ running
    def run_task(self, tid: str, user: str, resumed: bool = False, mode: str = "run") -> None:
        """mode "run": copy, then verify as the task says; "quick"/"full": verify only."""
        t = self._task(tid)
        if mode in ("quick", "full") and t.get("source_file"):
            raise UserError("Single-file tasks are not verified")
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
                                  "total_bytes": 0, "checks": 0, "total_checks": 0, "comparing": False, "speed": 0, "proc": None, "cancel": False,
                                  "log": collections.deque(maxlen=1000), "resumed": resumed,
                                  "mode": mode, "phase": None}
        # remembered in the state file until the run ends, so a restart can resume it
        self._update(lambda od: od["tasks"].get(tid) is not None and
                     od["tasks"][tid].__setitem__("interrupted", {"user": user, "since": time.time(), "mode": mode}))
        what = {"run": "run", "quick": "quick check", "full": "full check"}.get(mode, "run")
        self.state.log_activity(user, f"OneDrive task {t['name']}: {what} started"
                                + (" (resumed after a restart)" if resumed else ""), "info", "onedrive")
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
        tenant = entra.onedrive_authority(e)
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
        # --onedrive-delta + --fast-list: list the whole OneDrive in a few big
        # requests instead of one request per folder (much faster on large drives).
        # DEBUG: rclone reports OneDrive throttling only at this level; _parse keeps
        # those lines and drops the other debug lines.
        args = [self.rclone_path() or "rclone", "--config", conf, "--use-json-log",
                "--log-level", "DEBUG", "--stats", "2s", "--transfers", "4", "--checkers", "16",
                "--onedrive-delta", "--fast-list",
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
            # what a sync deletes or replaces on the NAS is kept (Recycle bin, Previous
            # versions); OneDrive keeps its own recycle bin and versions
            args += ["--backup-dir1", os.path.join(local, VERSIONS, stamp)]
            return args
        src, dst = (remote, local) if t["direction"] == "pull" else (local, remote)
        # compare everything before copying, so progress is known from the start
        args += ["--check-first", "sync" if t["delete"] else "copy", src, dst]
        if t["direction"] == "pull":                     # keep what a run replaces or deletes
            base = dst.rstrip("/") + "/" if dst != "onedrive:" else dst
            args += ["--backup-dir", f"{base}{VERSIONS}/{stamp}"]
        return args

    def _attempt(self, t: dict, r: dict, log) -> tuple:
        """One run of rclone; returns (status, error). Errors are returned, not
        raised, so the caller can try again."""
        tid = t["id"]
        status, error = "success", None
        try:
            local = os.path.join(self._volume_root(t["volume"]), t["folder"])
            if self.demo:
                return self._simulate(r)
            if t.get("source_file") and t["direction"] == "push":
                if not os.path.isfile(local):
                    raise UserError(f"File not found: {t['volume']}/{t['folder']}")
            else:
                os.makedirs(local, exist_ok=True)
            self.access_token()                       # refresh before writing the config
            conf = self._rclone_conf(tid)
            first = t["direction"] == "bisync" and not t.get("bisync_ready")
            cmd = self.command(t, conf, local, first)
            log.append(self._line("$ " + " ".join("<config>" if a == conf else a for a in cmd)))
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    text=True, bufsize=1)
            r["proc"] = proc
            last_err = ""
            r["comparing"] = t["direction"] != "bisync"
            r["attempt_started"] = time.time()
            for line in proc.stdout:
                self._parse(line, r)
                if self._is_error(line):
                    last_err = line
            rc = proc.wait()
            self._read_back_token(conf)
            if r["cancel"]:
                status, error = "cancelled", "Stopped"
            elif rc < 0 or rc in SIGNAL_EXIT or self._stop.is_set():
                # stopped by a signal because Talon or the NAS is shutting down (rclone
                # catches SIGTERM and exits with 143 = 128 + 15): resume later
                status, error = "interrupted", "Interrupted by a restart"
            elif rc != 0:
                status = "error"
                error = self._message(last_err) or RCLONE_EXIT.get(rc, f"rclone exited with code {rc}")
            elif first:
                self._update(lambda od: od["tasks"].get(tid, {}).__setitem__("bisync_ready", True))
            if status == "success" and t["direction"] in ("pull", "bisync"):
                self._prune_versions(t, conf, local)
        except UserError as e:
            status, error = "error", str(e)
        except Exception as e:  # noqa: BLE001 - reported as the result of this attempt
            status, error = "error", f"{type(e).__name__}: {e}"
        return status, error

    @staticmethod
    def _line(text: str, level: str = "INFO") -> str:
        """A log line of Talon's own, in the same time/level/file/message form as rclone's."""
        return "\t".join((time.strftime("%H:%M:%S"), level, "", text))

    def _run(self, t: dict, user: str) -> None:
        tid = t["id"]
        r = self._running[tid]
        status, error = "success", None
        log = r["log"]
        attempts = 1 + int(t.get("retries", 0))
        mode = r.get("mode") or "run"
        what = {"run": "Run", "quick": "Quick check", "full": "Full check"}[mode]
        log.append(self._line(time.strftime(f"{what} started %d-%m-%Y %H:%M") + (
            " (resumed after a restart)" if r.get("resumed") else "")))
        verified = None
        try:
            for attempt in range(1, attempts + 1 if mode == "run" else 1):
                status, error = self._attempt(t, r, log)
                if status != "error" or r["cancel"] or attempt == attempts or self._stop.is_set():
                    break
                log.append(self._line(f"Attempt {attempt} of {attempts} failed: {error}. "
                                      f"Trying again in {RETRY_DELAY // 60} minutes.", "NOTICE"))
                end = time.time() + RETRY_DELAY
                while time.time() < end and not r["cancel"] and not self._stop.is_set():
                    time.sleep(1)
                if r["cancel"]:
                    status, error = "cancelled", "Stopped"
                    break
                r.update(files=0, bytes=0, total_files=0, total_bytes=0, speed=0,
                         checks=0, total_checks=0, listed=0, seen=None, active=time.time())
                log.append(self._line(f"Attempt {attempt + 1} of {attempts}"))
            if mode == "run" and status == "success":
                self._record_profile(t, r)
            r["copied"] = (r["files"], r["bytes"])         # verification resets the counters
            check = mode if mode != "run" else t.get("verify", "off")
            if status == "success" and check in ("quick", "full") and not t.get("source_file"):
                verified = self._verify(t, r, log, check)
                if verified["status"] == "interrupted" or (verified["status"] == "cancelled" and mode != "run"):
                    status = verified["status"]
                    error = "Stopped" if status == "cancelled" else "Interrupted by a restart"
                    verified = None
                elif verified["status"] == "cancelled":       # the copy itself finished
                    log.append(self._line("Verification stopped", "NOTICE"))
                    verified = None
            log.append(self._line("Finished" if status == "success" else
                                  "Stopped" if status == "cancelled" else f"Failed: {error}",
                                  "INFO" if status != "error" else "ERROR"))
        except UserError as e:
            status, error = "error", str(e)
        except Exception as e:  # noqa: BLE001
            status, error = "error", f"{type(e).__name__}: {e}"
        finally:
            if status == "interrupted" or self._stop.is_set():
                # keep the "interrupted" mark: the run resumes when Talon starts again
                with self._lock:
                    self._running.pop(tid, None)
                return
            last = {"started": r["started"], "finished": time.time(), "status": status,
                    "files": r.get("copied", (r["files"], 0))[0],
                    "bytes": r.get("copied", (0, r["bytes"]))[1], "error": error}
            def done(od):
                if od["tasks"].get(tid) is not None:
                    if mode == "run":
                        od["tasks"][tid]["last"] = last
                    if verified:
                        od["tasks"][tid]["last_verify"] = verified
                    od["tasks"][tid].pop("interrupted", None)
            self._update(done)
            try:
                os.makedirs(os.path.join(self.base, "cloud-logs"), exist_ok=True)
                write_atomic(os.path.join(self.base, "cloud-logs", f"{tid}.log"),
                             "\n".join(log) + "\n", 0o600)
            except OSError:
                pass
            with self._lock:
                self._running.pop(tid, None)
            msg = f"OneDrive task {t['name']}: " + (
                f"{last['files']} file(s) transferred" if status == "success" else error or status)
            if mode == "run" or status != "success":
                self.state.log_activity(user, msg, "info" if status != "error" else "error")
            if verified:
                self._report_verify(t, user, verified)
            if status == "error":
                self.nas.notifier.send("cloud_failed", f"OneDrive task {t['name']} failed",
                                       f"The OneDrive task '{t['name']}' failed:\n{error}")

    # ------------------------------------------------------------ verification
    def _record_profile(self, t: dict, r: dict) -> None:
        """File count and size of the task's NAS folder after a run, and how long
        the comparison took: the basis of the time estimates."""
        try:
            if self.demo:
                files, size = r.get("total_checks", 0) + r["total_files"], int(1.02e12)
            else:
                files, size = self.folder_size(os.path.join(self._volume_root(t["volume"]), t["folder"]))
        except (OSError, UserError):
            return
        cmp = r.get("compare_secs") or (240 if self.demo else None)
        def upd(od):
            task = od["tasks"].get(t["id"])
            if task is not None:
                p = task.setdefault("profile", {})
                p.update(files=files, bytes=size)
                if cmp:
                    p["compare_secs"] = cmp
        self._update(upd)

    def _sides(self, t: dict) -> tuple:
        local = os.path.join(self._volume_root(t["volume"]), t["folder"])
        remote = "onedrive:" + t["remote"]
        if t["direction"] == "pull":
            return remote, local, local
        return local, remote, local

    def _base_args(self, conf: str, skip_versions: bool = True) -> list:
        # --files-from cannot be combined with --filter (rclone refuses to start)
        return [self.rclone_path() or "rclone", "--config", conf, "--use-json-log",
                "--log-level", "DEBUG", "--stats", "2s", "--checkers", "16",
                "--onedrive-delta", "--fast-list"] + (
                    ["--filter", f"- /{VERSIONS}/**"] if skip_versions else [])

    def _rclone(self, cmd: list, r: dict, conf: str) -> int:
        """Run rclone, feeding its log into the run; returns the exit code."""
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, bufsize=1)
        r["proc"] = proc
        io0 = self._disk_read()
        t0 = time.time()
        for line in proc.stdout:
            self._parse(line, r)
            if time.time() - t0 >= 2:                 # whole-system disk read speed
                io1 = self._disk_read()
                if io0 is not None and io1 is not None:
                    r["read_speed"] = max(0, (io1 - io0) / (time.time() - t0))
                io0, t0 = io1, time.time()
        rc = proc.wait()
        self._read_back_token(conf)
        return rc

    @staticmethod
    def _disk_read() -> Optional[int]:
        try:
            import psutil
            io = psutil.disk_io_counters()
            return io.read_bytes if io else None
        except Exception:   # noqa: BLE001
            return None

    def _check_cmd(self, t: dict, conf: str, mode: str, combined: str, files_from: str = "") -> list:
        src, dst, _local = self._sides(t)
        cmd = self._base_args(conf, not files_from) + ["check", src, dst, "--combined", combined]
        if t["direction"] != "bisync":
            cmd.append("--one-way")              # extra files at the destination are fine
        if mode == "quick":
            cmd.append("--size-only")
        if files_from:
            cmd += ["--files-from", files_from]
        return cmd

    @staticmethod
    def read_combined(path: str) -> dict:
        """rclone check --combined: "= same", "+ only in the source (missing at the
        destination)", "- only in the destination", "* different", "! could not
        be checked"."""
        out = {"same": 0, "-": [], "+": [], "*": [], "!": []}
        try:
            with open(path, encoding="utf-8", errors="replace") as f:
                for line in f:
                    line = line.rstrip("\n")
                    if len(line) < 3:
                        continue
                    if line[0] == "=":
                        out["same"] += 1
                    elif line[0] in "-+*!":
                        out[line[0]].append(line[2:])
        except OSError:
            pass
        return out

    def _verify(self, t: dict, r: dict, log, mode: str) -> dict:
        """Check that every file arrived (quick: names and sizes; full: contents by
        checksum). Files that are missing or different are copied again at once,
        then checked again; the result says what was found and fixed."""
        est = self.estimate(t) or {}
        r.update(phase="verifying", phase_started=time.time(), checks=0, total_checks=0,
                 files=0, total_files=0, bytes=0, total_bytes=0, comparing=False,
                 estimate=est.get("quick_secs" if mode == "quick" else "full_secs"))
        label = "Quick check (names and sizes)" if mode == "quick" else "Full check (contents)"
        if r["estimate"]:
            log.append(self._line(f"{label}: about {_duration(r['estimate'])}"))
        else:
            log.append(self._line(label))
        res = {"mode": mode, "started": time.time(), "finished": None, "status": "ok",
               "checked": 0, "missing": 0, "different": 0, "errors": 0, "fixed": 0,
               "unresolved": [], "unresolved_count": 0, "error": None}
        try:
            if self.demo:
                found = self._simulate_check(r)
                if r["cancel"]:
                    return {**res, "status": "cancelled"}
                if self._stop.is_set():
                    return {**res, "status": "interrupted"}
            else:
                self.access_token()
                conf = self._rclone_conf(t["id"])
                os.makedirs(os.path.join(self.base, "verify"), exist_ok=True)
                combined = os.path.join(self.base, "verify", f"{t['id']}.txt")
                rc = self._rclone(self._check_cmd(t, conf, mode, combined), r, conf)
                if r["cancel"]:
                    return {**res, "status": "cancelled"}
                if rc < 0 or rc in SIGNAL_EXIT or self._stop.is_set():
                    return {**res, "status": "interrupted"}
                found = self.read_combined(combined)
                if rc not in (0, 1) or (rc == 1 and not any(found[k] for k in "-+*!")):
                    raise UserError(RCLONE_EXIT.get(rc, f"rclone check exited with code {rc}"))
            # "+": missing at the destination; for two-way sync "-" (missing on the
            # NAS side) too. Extra files at a backup's destination are fine.
            missing = [("missing", p) for p in found["+"]] + \
                [("missing", p) for p in (found["-"] if t["direction"] == "bisync" else [])]
            different = [("different", p) for p in found["*"]]
            errors = [("error", p) for p in found["!"]]
            res.update(checked=found["same"] + len(missing) + len(different) + len(errors),
                       missing=len(missing), different=len(different), errors=len(errors))
            todo = missing + (different if t["direction"] != "bisync" else [])
            if todo:
                log.append(self._line(f"{len(missing)} missing, {len(different)} different: "
                                      "copying them again", "NOTICE"))
                left = self._fix(t, r, log, mode, found) if not self.demo else []
                if left is None:
                    return {**res, "status": "cancelled" if r["cancel"] else "interrupted"}
                res["fixed"] = len(todo) - len([x for x in left if x[0] != "error"])
                unresolved = left + (different if t["direction"] == "bisync" else []) + errors
            else:
                unresolved = errors
            res["unresolved"] = [{"kind": k, "path": p} for k, p in unresolved[:UNRESOLVED_KEEP]]
            res["unresolved_count"] = len(unresolved)
            res["status"] = "failed" if unresolved else ("fixed" if res["fixed"] else "ok")
            for k, p in unresolved[:UNRESOLVED_KEEP]:
                log.append("\t".join((time.strftime("%H:%M:%S"), "ERROR", p, f"Not verified: {k}")))
            log.append(self._line(
                f"Verified: all {res['checked']:,} files match" if res["status"] == "ok" else
                f"Copied {res['fixed']} file(s) again · all {res['checked']:,} files match now"
                if res["status"] == "fixed" else
                f"Verification: {len(unresolved)} file(s) could not be verified",
                "ERROR" if unresolved else "INFO"))
        except UserError as e:
            res.update(status="error", error=str(e))
            log.append(self._line(f"Verification failed: {e}", "ERROR"))
        except Exception as e:  # noqa: BLE001
            res.update(status="error", error=f"{type(e).__name__}: {e}")
            log.append(self._line(f"Verification failed: {res['error']}", "ERROR"))
        res["finished"] = time.time()
        if res["status"] in ("ok", "fixed") and not self.demo:
            self._learn_speed(t, mode, res["finished"] - res["started"])
        return res

    def _fix(self, t: dict, r: dict, log, mode: str, found: dict) -> Optional[list]:
        """Copy the missing and different files again, then check just those.
        Returns what still does not match, or None when stopped."""
        src, dst, _local = self._sides(t)
        conf = self._rclone_conf(t["id"])
        jobs = [(src, dst, found["+"] + found["*"])]
        if t["direction"] == "bisync":                  # copy only; never overwrite either side
            jobs = [(src, dst, found["+"]), (dst, src, found["-"])]
        r.update(phase="fixing", files=0, total_files=0, checks=0, total_checks=0, bytes=0, total_bytes=0)
        left = []
        for i, (a, b, paths) in enumerate(jobs):
            if not paths:
                continue
            lst = os.path.join(self.base, "verify", f"{t['id']}-fix{i}.txt")
            write_atomic(lst, "\n".join(paths) + "\n", 0o600)
            cmd = self._base_args(conf, False) + ["copy", a, b, "--files-from", lst, "--ignore-times",
                                           "--no-traverse", "--transfers", "4"]
            if t.get("bwlimit"):
                cmd += ["--bwlimit", t["bwlimit"]]
            if t["direction"] == "pull" and not b.startswith("onedrive:"):
                base = b.rstrip("/") + "/" if b != "onedrive:" else b
                cmd += ["--backup-dir", f"{base}{VERSIONS}/{time.strftime('%Y-%m-%d_%H%M%S')}"]
            rc = self._rclone(cmd, r, conf)
            if r["cancel"] or rc < 0 or rc in SIGNAL_EXIT or self._stop.is_set():
                return None
            # check those files again
            again = os.path.join(self.base, "verify", f"{t['id']}-again{i}.txt")
            tt = {**t, "direction": "pull" if a.startswith("onedrive:") else "push"}
            r["phase"] = "verifying"
            self._rclone(self._check_cmd(tt, conf, mode, again, lst), r, conf)
            res = self.read_combined(again)
            left += [("missing", p) for p in res["+"]] + [("different", p) for p in res["*"]] + \
                [("error", p) for p in res["!"]]
        return left

    def _learn_speed(self, t: dict, mode: str, secs: float) -> None:
        """Use how long this check really took for the next estimates."""
        p = t.get("profile") or {}
        def upd(od):
            task = od["tasks"].get(t["id"])
            if task is None:
                return
            if mode == "quick":
                task.setdefault("profile", {})["quick_secs"] = secs
            elif p.get("bytes") and secs > 5:
                od.setdefault("read_speed", {})[t["volume"]] = {
                    "bps": p["bytes"] / secs, "source": "check", "at": time.time()}
        self._update(upd)

    def _report_verify(self, t: dict, user: str, v: dict) -> None:
        kind = "quick" if v["mode"] == "quick" else "full"
        if v["status"] == "ok":
            self.state.log_activity(user, f"OneDrive task {t['name']}: {kind} check passed, "
                                          f"{v['checked']:,} files match")
        elif v["status"] == "fixed":
            self.state.log_activity(user, f"OneDrive task {t['name']}: {kind} check found "
                                          f"{v['fixed']} missing or different file(s) and copied them again")
        else:
            what = v["error"] or f"{v['unresolved_count']} file(s) could not be verified"
            self.state.log_activity(user, f"OneDrive task {t['name']}: {kind} check: {what}", "warning")
            files = "\n".join(f"{x['kind']}: {x['path']}" for x in v["unresolved"][:50])
            self.nas.notifier.send("cloud_failed", f"OneDrive task {t['name']}: verification found problems",
                                   f"The {kind} check of OneDrive task '{t['name']}' found problems:\n"
                                   f"{what}\n\n{files}")

    @staticmethod
    def _message(line: str) -> str:
        try:
            d = json.loads(line)
        except ValueError:
            return line.strip()[:300]
        obj = d.get("object", "")
        return (f"{obj}: " if obj else "") + str(d.get("msg", "")).strip()[:300]

    @staticmethod
    def _is_error(line: str) -> bool:
        """rclone's JSON log lines at level error/critical, or a plain-text error
        (e.g. a usage error printed before logging starts)."""
        try:
            d = json.loads(line)
        except ValueError:
            return "error" in line.lower() or "fatal" in line.lower()
        return str(d.get("level", "")).lower() in ("error", "critical", "fatal")

    @staticmethod
    def _parse(line: str, r: dict) -> None:
        line = line.rstrip("\n")
        try:
            d = json.loads(line)
        except ValueError:
            if line.strip():
                r["log"].append("\t".join((time.strftime("%H:%M:%S"), "INFO", "", line.strip())))
            return
        msg = str(d.get("msg", ""))
        level = str(d.get("level", "info")).lower()
        if "Checks finished" in msg and r.get("comparing"):
            r["comparing"] = False                 # --check-first: copying starts now
            r["compare_secs"] = time.time() - r.get("attempt_started", r["started"])
        st = d.get("stats")
        if st:
            if st.get("transfers"):
                r["comparing"] = False
            seen = (st.get("listed", 0), st.get("checks", 0), st.get("transfers", 0), st.get("bytes", 0))
            if seen != r.get("seen"):
                r["seen"], r["active"] = seen, time.time()
            r["listed"] = st.get("listed", 0)
            r.update(files=st.get("transfers", 0), total_files=st.get("totalTransfers", 0),
                     bytes=st.get("bytes", 0), total_bytes=st.get("totalBytes", 0),
                     speed=st.get("speed", 0), checks=st.get("checks", 0),
                     total_checks=st.get("totalChecks", 0))
            return
        if level == "debug":
            # OneDrive throttling: "Too many requests. Trying again in 30 seconds."
            m = re.search(r"Too many requests\. Trying again in (\d+) seconds", msg)
            if m:
                wait = int(m.group(1))
                r["throttled_until"] = time.time() + wait
                d = {**d, "level": "notice", "object": "",
                     "msg": f"OneDrive is limiting requests (throttling); trying again in {wait} s"}
            else:
                return
        # "time<TAB>LEVEL<TAB>file<TAB>message": the web interface shows each part
        # on its own (time, highlighted level, wrapped path), so it reads on a phone
        when = str(d.get("time", ""))[11:19]
        r["log"].append("\t".join((when, str(d.get("level", "info")).upper(),
                                    str(d.get("object", "")), str(d.get("msg", "")).strip())))

    def _prune_versions(self, t: dict, conf: str, local: str) -> None:
        if t["direction"] in ("pull", "bisync"):
            root = os.path.join(local, VERSIONS)
            cutoff = time.time() - KEEP_VERSIONS_DAYS * 86400
            from .restore import _stamp_time
            for name in os.listdir(root) if os.path.isdir(root) else []:
                p = os.path.join(root, name)
                # the folder name is when its files were replaced (restoring changes its mtime)
                if (_stamp_time(name) or os.path.getmtime(p)) < cutoff:
                    shutil.rmtree(p, ignore_errors=True)
        elif t["direction"] == "push":
            subprocess.run([self.rclone_path() or "rclone", "--config", conf, "delete",
                            "--min-age", f"{KEEP_VERSIONS_DAYS}d", "--rmdirs",
                            f"onedrive:{t['remote']}/{VERSIONS}".replace(":/", ":")],
                           capture_output=True, timeout=3600)

    def _simulate_check(self, r: dict) -> dict:
        total = 3510
        for i in range(1, 11):
            if r["cancel"] or self._stop.is_set():
                break
            time.sleep(0.3)
            r.update(checks=total * i // 10, total_checks=total * i // 10, active=time.time(),
                     read_speed=236e6)
        if r.get("mode") == "full":           # demo: a full check finds and fixes 3 files
            return {"same": total - 3, "+": ["Pictures/2026/IMG_4101.HEIC", "Pictures/2026/IMG_4102.HEIC"],
                    "-": [], "*": ["Documents/Notes/house.docx"], "!": []}
        return {"same": total, "+": [], "-": [], "*": [], "!": []}

    def _simulate(self, r: dict):
        total = random.randint(20, 400)
        size = total * random.randint(200_000, 4_000_000)
        same = total * 9                           # files already up to date
        r["comparing"] = True
        for i in range(1, 7):                      # compare both sides first
            if r["cancel"]:
                return "cancelled", "Stopped"
            time.sleep(0.5)
            r.update(checks=same * i // 6, total_checks=same * i // 6, listed=total * 10 * i // 6,
                     active=time.time())
        r.update(comparing=False, total_files=total, total_bytes=size)
        for i in range(1, 21):
            if r["cancel"]:
                return "cancelled", "Stopped"
            time.sleep(0.5)
            r.update(files=total * i // 20, bytes=size * i // 20, speed=size / 10, active=time.time())
            when = time.strftime("%H:%M:%S")
            r["log"].append(f"{when}\tINFO\tPictures/2026/Holiday in Paphos/IMG_{4000 + i}.HEIC\tCopied (new)")
            if i == 12:
                r["log"].append(f"{when}\tNOTICE\tPictures/2026/Screenshot 2026-11-20 at 14.02.11.png"
                                "\tSkipped: the file is in use (demo)")
        return "success", None
