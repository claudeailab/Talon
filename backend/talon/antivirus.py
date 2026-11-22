"""Antivirus: scan shared folders with ClamAV, on demand or on a schedule.

ClamAV is free and open source (GPL), made by Cisco Talos. Talon installs it on
request (apt: clamav, which brings clamav-freshclam to keep the virus definitions
up to date by itself). Scans use clamscan, which loads the definitions only while
it runs (about 1.2–1.5 GB of memory), so nothing stays in memory between scans.

Infected files are moved to the volume's quarantine (.talon-quarantine at the
volume root, outside every shared folder), where they can be restored or deleted.
A scan that finds something is logged and emailed ("Virus found")."""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import threading
import time
import uuid
from typing import Callable, Dict, List, Optional

from .util import UserError, run

QUARANTINE = ".talon-quarantine"
MIN_RAM = 1.9 * 1024 ** 3          # below this, ClamAV is not offered
WARN_RAM = 3.0 * 1024 ** 3         # ClamAV recommends 3 GB or more
DB_DIR = "/var/lib/clamav"
ENV = {"DEBIAN_FRONTEND": "noninteractive", "NEEDRESTART_MODE": "l", "NEEDRESTART_SUSPEND": "1"}
FOUND_RE = re.compile(r"^(.*): (.+) FOUND$")
SCHEDULES = ("off", "daily", "weekly")


def parse_version(text: str) -> dict:
    """clamscan --version: "ClamAV 1.4.3/27831/Sat Nov 21 09:30:00 2026"."""
    m = re.match(r"^ClamAV ([\d.]+)(?:/(\d+)/(.+))?$", (text or "").strip())
    if not m:
        return {"version": None, "db_version": None, "db_date": None}
    db_date = None
    if m.group(3):
        try:
            db_date = time.mktime(time.strptime(m.group(3).strip(), "%a %b %d %H:%M:%S %Y"))
        except ValueError:
            pass
    return {"version": m.group(1), "db_version": m.group(2), "db_date": db_date}


class Antivirus:
    def __init__(self, nas, demo: bool = False):
        self.nas = nas
        self.state = nas.state
        self.demo = demo
        self.progress: dict = {"state": "idle"}
        self._proc: Optional[subprocess.Popen] = None
        self._stop_scan = False
        self._lock = threading.Lock()

    # ------------------------------------------------------------ status
    def _saved(self) -> dict:
        return self.state.get("antivirus") or {}

    def settings(self) -> dict:
        s = self._saved().get("settings") or {}
        return {"shares": s.get("shares") or [], "schedule": s.get("schedule", "off"),
                "time": s.get("time", "02:30"), "weekday": int(s.get("weekday", 6))}

    def _ram(self) -> int:
        if self.demo:
            return 16 * 1024 ** 3
        import psutil
        return int(psutil.virtual_memory().total)

    def installed(self) -> bool:
        if self.demo:
            return bool(self._saved().get("demo_installed"))
        return shutil.which("clamscan") is not None

    def info(self) -> dict:
        ram = self._ram()
        inst = self.installed()
        ver = self._version() if inst else {"version": None, "db_version": None, "db_date": None}
        return {"installed": inst, **ver, "definitions": self._has_definitions() if inst else False,
                "ram": ram, "ram_ok": ram >= MIN_RAM, "ram_warning": MIN_RAM <= ram < WARN_RAM,
                "progress": self.progress, "settings": self.settings(),
                "last_scan": self._saved().get("last_scan"), "quarantine": self._saved().get("quarantine") or [],
                "installing": self._saved().get("installing_job")}

    def _version(self) -> dict:
        if self.demo:
            return {"version": "1.4.3", "db_version": "27831", "db_date": time.time() - 3 * 3600}
        return parse_version(run(["clamscan", "--version"], check=False, timeout=30).stdout)

    def _has_definitions(self) -> bool:
        if self.demo:
            return True
        try:
            names = os.listdir(DB_DIR)
        except OSError:
            return False
        return any(n.startswith("main.") for n in names) and any(n.startswith("daily.") for n in names)

    # ------------------------------------------------------------ install / remove
    def install(self, user: str):
        if self.installed():
            raise UserError("ClamAV is already installed")
        if self._ram() < MIN_RAM:
            raise UserError("ClamAV needs at least 2 GB of memory; this NAS has less")

        def work(log):
            if self.demo:
                for step in ("Installing clamav", "Downloading the virus definitions"):
                    log(step)
                    time.sleep(1.5)
                self.state.update(lambda d: d.setdefault("antivirus", {}).__setitem__("demo_installed", True))
                return
            run(["apt-get", "update", "-q"], check=False, timeout=600, log=log, env=ENV)
            run(["apt-get", "install", "-y", "-q", "-o", "DPkg::Lock::Timeout=120", "clamav", "clamav-freshclam"],
                timeout=1800, log=log, env=ENV)
            # the definitions: freshclam runs as a service; wait for the first download
            log("Downloading the virus definitions (about 250 MB)")
            run(["systemctl", "enable", "--now", "clamav-freshclam"], check=False, log=log)
            for _ in range(180):
                if self._has_definitions():
                    break
                time.sleep(5)
            if not self._has_definitions():
                run(["systemctl", "stop", "clamav-freshclam"], check=False, log=log)
                run(["freshclam", "--quiet"], check=False, timeout=1800, log=log)
                run(["systemctl", "start", "clamav-freshclam"], check=False, log=log)

        job = self.nas.jobs.submit("Install ClamAV antivirus", user, work)
        self.state.update(lambda d: d.setdefault("antivirus", {}).__setitem__("installing_job", job.id))
        return job

    def remove(self, user: str):
        if self.progress.get("state") == "running":
            raise UserError("Stop the scan first")

        def work(log):
            if self.demo:
                self.state.update(lambda d: d.setdefault("antivirus", {}).__setitem__("demo_installed", False))
                return
            run(["apt-get", "remove", "-y", "-q", "clamav", "clamav-freshclam", "clamav-base"], timeout=900, log=log, env=ENV)

        return self.nas.jobs.submit("Remove ClamAV antivirus", user, work)

    # ------------------------------------------------------------ settings
    def save_settings(self, data: dict, user: str) -> dict:
        cur = self.settings()
        shares = [s for s in data.get("shares", cur["shares"]) if isinstance(s, str)]
        known = {s["name"] for s in self.nas.shares()}
        shares = [s for s in shares if s in known]
        schedule = data.get("schedule", cur["schedule"])
        if schedule not in SCHEDULES:
            raise UserError("Invalid schedule")
        t = str(data.get("time", cur["time"]))
        if not re.match(r"^([01]\d|2[0-3]):[0-5]\d$", t):
            raise UserError("Enter the time as hh:mm (24-hour)")
        wd = int(data.get("weekday", cur["weekday"]))
        if not 0 <= wd <= 6:
            raise UserError("Invalid day")
        new = {"shares": shares, "schedule": schedule, "time": t, "weekday": wd}
        self.state.update(lambda d: d.setdefault("antivirus", {}).__setitem__("settings", new))
        if new != cur:
            when = "off" if schedule == "off" else f"{schedule} at {t}"
            self.state.log_activity(user, f"Antivirus settings saved (scheduled scan: {when})", "info", "settings")
        return self.info()

    # ------------------------------------------------------------ scan
    def _targets(self, names: List[str]) -> List[dict]:
        shares = [s for s in self.nas.shares() if s.get("path")]
        if names:
            shares = [s for s in shares if s["name"] in names]
        if not shares:
            raise UserError("There are no shared folders to scan")
        return shares

    def scan(self, user: str, names: Optional[List[str]] = None) -> dict:
        if not self.installed():
            raise UserError("Install ClamAV first")
        with self._lock:
            if self.progress.get("state") == "running":
                raise UserError("A scan is already running")
            targets = self._targets(names if names is not None else self.settings()["shares"])
            self._stop_scan = False
            self.progress = {"state": "running", "phase": "counting", "done": 0, "total": 0, "found": 0,
                             "file": "", "started": time.time(), "shares": [t["name"] for t in targets]}
        self.state.log_activity(user, "Started a virus scan of " + ", ".join(t["name"] for t in targets), "info", "antivirus")
        threading.Thread(target=self._scan, args=(user, targets), daemon=True, name="antivirus").start()
        return self.info()

    def stop(self) -> None:
        self._stop_scan = True
        p = self._proc
        if p and p.poll() is None:
            p.terminate()

    def _scan(self, user: str, targets: List[dict]) -> None:
        p = self.progress
        found: List[dict] = []
        error = None
        try:
            if self.demo:
                self._demo_scan(targets, found)
            else:
                p["total"] = sum(_count_files(t["path"]) for t in targets)
                p["phase"] = "loading"
                cmd = ["nice", "-n", "19", "ionice", "-c3", "clamscan", "-r", "--stdout", "--no-summary",
                       "--cross-fs=no"] + [t["path"] for t in targets]
                self._proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
                assert self._proc.stdout is not None
                for line in self._proc.stdout:
                    line = line.rstrip("\n")
                    if p["phase"] == "loading":
                        p["phase"] = "scanning"
                    m = FOUND_RE.match(line)
                    if m:
                        found.append({"path": m.group(1), "virus": m.group(2)})
                        p["found"] = len(found)
                    if ": " in line:
                        p["done"] += 1
                        p["file"] = line.rsplit(": ", 1)[0]
                rc = self._proc.wait()
                err = (self._proc.stderr.read() if self._proc.stderr else "").strip()
                if rc not in (0, 1) and not self._stop_scan:
                    error = (err.splitlines() or [f"clamscan failed (exit code {rc})"])[-1]
            moved = [self._quarantine(f) for f in found]
            moved = [m for m in moved if m]
            stopped = self._stop_scan
            result = {"at": time.time(), "duration": round(time.time() - p["started"]), "files": p["done"],
                      "found": len(found), "shares": p["shares"], "stopped": stopped, "error": error}
            self.state.update(lambda d: d.setdefault("antivirus", {}).__setitem__("last_scan", result))
            p.update(state="stopped" if stopped else "error" if error else "success", finished=time.time())
            if found:
                names = "\n".join(f"{f['path']}: {f['virus']}" for f in found)
                self.state.log_activity(user, f"Virus scan found {len(found)} infected file(s); moved to quarantine", "error", "antivirus")
                self.nas.notifier.send("virus", f"Virus found: {len(found)} infected file(s)",
                                       f"The virus scan moved these files to the quarantine:\n{names}\n\n"
                                       "Restore or delete them in Talon under Antivirus.")
            elif error:
                self.state.log_activity(user, f"Virus scan failed: {error}", "error", "antivirus")
            else:
                self.state.log_activity(user, ("Virus scan stopped after " if stopped else "Virus scan finished: ") +
                                        f"{p['done']} file(s), nothing found", "info", "antivirus")
        except Exception as e:   # noqa: BLE001 - reported in the page
            p.update(state="error", error=str(e), finished=time.time())
            self.state.log_activity(user, f"Virus scan failed: {e}", "error", "antivirus")
        finally:
            self._proc = None

    def _demo_scan(self, targets: List[dict], found: List[dict]) -> None:
        p = self.progress
        p["total"] = 1840
        p["phase"] = "loading"
        time.sleep(1.0)
        p["phase"] = "scanning"
        for i in range(0, 1840, 46):
            if self._stop_scan:
                return
            p["done"] = i + 46
            p["file"] = f"{targets[0]['path']}/Photos/2026/IMG_{1000 + i}.jpg"
            if i == 920:
                found.append({"path": f"{targets[0]['path']}/Downloads/invoice.pdf.exe", "virus": "Win.Trojan.Agent-1234"})
                p["found"] = 1
            time.sleep(0.08)

    # ------------------------------------------------------------ quarantine
    def _volume_root(self, path: str) -> Optional[str]:
        vols = self.state.get("volumes") or {}
        best = None
        for v in vols.values():
            mp = v.get("mountpoint")
            if mp and (path == mp or path.startswith(mp.rstrip("/") + "/")) and (not best or len(mp) > len(best)):
                best = mp
        return best

    def _quarantine(self, f: dict) -> Optional[dict]:
        qid = uuid.uuid4().hex[:12]
        item = {"id": qid, "path": f["path"], "virus": f["virus"], "found": time.time(), "size": 0}
        if not self.demo:
            root = self._volume_root(f["path"])
            if not root or not os.path.isfile(f["path"]):
                return None
            dest_dir = os.path.join(root, QUARANTINE, qid)
            try:
                os.makedirs(dest_dir, mode=0o700, exist_ok=True)
                os.chmod(os.path.join(root, QUARANTINE), 0o700)
                item["size"] = os.path.getsize(f["path"])
                shutil.move(f["path"], os.path.join(dest_dir, os.path.basename(f["path"])))
                item["stored"] = os.path.join(dest_dir, os.path.basename(f["path"]))
            except OSError:
                return None
        else:
            item["size"] = 284_672
        self.state.update(lambda d: d.setdefault("antivirus", {}).setdefault("quarantine", []).append(item))
        return item

    def _q_item(self, qid: str) -> dict:
        item = next((q for q in self._saved().get("quarantine") or [] if q["id"] == qid), None)
        if not item:
            raise UserError("Not in the quarantine")
        return item

    def _q_drop(self, qid: str) -> None:
        self.state.update(lambda d: d["antivirus"].__setitem__(
            "quarantine", [q for q in d["antivirus"].get("quarantine", []) if q["id"] != qid]))

    def restore(self, qid: str, user: str) -> None:
        item = self._q_item(qid)
        if not self.demo:
            if os.path.exists(item["path"]):
                raise UserError("A file with this name exists again in its folder; move or rename it first")
            os.makedirs(os.path.dirname(item["path"]), exist_ok=True)
            shutil.move(item["stored"], item["path"])
            shutil.rmtree(os.path.dirname(item["stored"]), ignore_errors=True)
        self._q_drop(qid)
        self.state.log_activity(user, f"Restored {item['path']} from the quarantine", "warning", "antivirus")

    def delete(self, qid: str, user: str) -> None:
        item = self._q_item(qid)
        if not self.demo and item.get("stored"):
            shutil.rmtree(os.path.dirname(item["stored"]), ignore_errors=True)
        self._q_drop(qid)
        self.state.log_activity(user, f"Deleted {item['path']} ({item['virus']}) from the quarantine", "info", "antivirus")

    # ------------------------------------------------------------ schedule
    def background_loop(self, stop: threading.Event) -> None:
        last_run = ""
        while not stop.wait(30):
            try:
                s = self.settings()
                if s["schedule"] == "off" or not self.installed():
                    continue
                now = time.localtime()
                if time.strftime("%H:%M", now) != s["time"]:
                    continue
                if s["schedule"] == "weekly" and now.tm_wday != s["weekday"]:
                    continue
                key = time.strftime("%Y-%m-%d %H:%M", now)
                if key == last_run or self.progress.get("state") == "running":
                    continue
                last_run = key
                self.scan("talon", s["shares"])
            except Exception:   # noqa: BLE001
                pass


def _count_files(path: str) -> int:
    n = 0
    for _root, _dirs, files in os.walk(path):
        n += len(files)
    return n
