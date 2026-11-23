"""Backup: copy shared folders to a USB or internal (SATA, NVMe) disk, when it is plugged in or every day.

Each backup task belongs to one disk (recognised by its filesystem UUID, so it does
not matter which port it is in) and copies the chosen shared folders into
"Talon Backup/<NAS name>/" on it with rsync.

On disks that support hard links (ext4, XFS, Btrfs, NTFS) every run is a dated
version: files that did not change are hard links to the previous version, so a
version only takes the space of what changed. Versions older than the chosen number
of days are removed (the newest is always kept). FAT32 and exFAT have no hard links:
there the backup is one copy, kept up to date.

Restore: open a version in Files (it is a normal folder on the disk) and copy back
what you need."""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import threading
import time
import uuid
from typing import Dict, List, Optional

from .scheduler import parse_progress
from .util import UserError, run

ROOT_DIR = "Talon Backup"
STAMP_FMT = "%Y-%m-%d_%H%M"
STAMP_RE = re.compile(r"^\d{4}-\d{2}-\d{2}_\d{4}$")
CURRENT = "Current"                          # the single copy on FAT32 / exFAT
MEDIA = {"usb": "USB disk", "hdd": "SATA hard disk", "ssd": "SATA SSD", "nvme": "NVMe SSD"}   # by disk kind
LINKS_FS = {"ext2", "ext3", "ext4", "xfs", "btrfs", "ntfs", "ntfs3"}
KEEP_CHOICES = (7, 14, 30, 90, 365)
WHEN = ("plug", "daily", "both")
ENV = {"DEBIAN_FRONTEND": "noninteractive"}


def snapshot_name(ts: float) -> str:
    return time.strftime(STAMP_FMT, time.localtime(ts))


def to_prune(names: List[str], keep_days: int, now: float) -> List[str]:
    """Versions older than keep_days; the newest version is always kept."""
    stamps = sorted(n for n in names if STAMP_RE.match(n))
    if len(stamps) <= 1:
        return []
    cutoff = now - keep_days * 86400
    old = [n for n in stamps[:-1] if time.mktime(time.strptime(n, STAMP_FMT)) < cutoff]
    return old


class Backup:
    def __init__(self, nas, demo: bool = False):
        self.nas = nas
        self.state = nas.state
        self.demo = demo
        self.progress: Dict[str, dict] = {}
        self._procs: Dict[str, subprocess.Popen] = {}
        self._stop: set = set()
        self._uuid_cache: Dict[str, str] = {}
        self._seen: Optional[set] = None          # disks connected at the last look
        self._lock = threading.Lock()

    # ------------------------------------------------------------ disks
    def _uuid(self, dev: str, fstype: str) -> str:
        if self.demo:
            return f"demo-{dev}"
        key = f"{dev}:{fstype}"
        if not self._uuid_cache.get(key):
            # not cached when empty: a disk that was just plugged in may not have it yet
            self._uuid_cache[key] = run(["lsblk", "-ndo", "UUID", f"/dev/{dev}"], check=False).stdout.strip()
        return self._uuid_cache[key]

    def disks(self) -> List[dict]:
        out = []
        for e in self.nas.files.externals():
            u = self._uuid(e["dev"], e["fstype"])
            if not u:
                continue
            out.append({"uuid": u, "id": e["id"], "dev": e["dev"], "name": e["name"], "fstype": e["fstype"],
                        "media": MEDIA.get(e.get("disk_kind", ""), "Disk"),
                        "fs_label": e["detail"].split(" · ")[-1], "size": e["size"], "kind": e["kind"],
                        "versions": e["fstype"] in LINKS_FS})
        return out

    # ------------------------------------------------------------ tasks
    def _tasks(self) -> Dict[str, dict]:
        return self.state.get("usb_backup") or {}

    def info(self) -> dict:
        disks = {d["uuid"]: d for d in self.disks()}
        tasks = []
        for t in sorted(self._tasks().values(), key=lambda t: t["name"].lower()):
            d = disks.get(t["disk_uuid"])
            tasks.append({**t, "connected": bool(d), "disk": d, "progress": self.progress.get(t["id"], {"state": "idle"}),
                          "snapshots": self._snapshots(t, d) if d else t.get("snapshots_seen", [])})
        return {"tasks": tasks, "disks": list(disks.values()),
                "shares": [s["name"] for s in self.nas.shares() if s.get("path")],
                "backup_dir": os.path.relpath(self._base("/"), "/")}

    def _clean(self, data: dict, old: Optional[dict]) -> dict:
        name = str(data.get("name", (old or {}).get("name", ""))).strip()
        if not name or len(name) > 60:
            raise UserError("Enter a name (up to 60 characters)")
        disk_uuid = str(data.get("disk_uuid", (old or {}).get("disk_uuid", "")))
        disks = {d["uuid"]: d for d in self.disks()}
        if not old and disk_uuid not in disks:
            raise UserError("Plug in the disk and choose it")
        known = {s["name"] for s in self.nas.shares()}
        shares = [s for s in data.get("shares", (old or {}).get("shares", [])) if s in known]
        when = data.get("when", (old or {}).get("when", "plug"))
        if when not in WHEN:
            raise UserError("Invalid schedule")
        t = str(data.get("time", (old or {}).get("time", "02:00")))
        if not re.match(r"^([01]\d|2[0-3]):[0-5]\d$", t):
            raise UserError("Enter the time as hh:mm (24-hour)")
        keep = int(data.get("keep_days", (old or {}).get("keep_days", 30)))
        if keep not in KEEP_CHOICES:
            raise UserError("Invalid number of days")
        d = disks.get(disk_uuid)
        return {"name": name, "disk_uuid": disk_uuid,
                "disk_name": d["name"] if d else (old or {}).get("disk_name", ""),
                "disk_size": d["size"] if d else (old or {}).get("disk_size", 0),
                "versions": d["versions"] if d else (old or {}).get("versions", False),
                "shares": shares, "when": when, "time": t, "eject": bool(data.get("eject", (old or {}).get("eject", True))),
                "keep_days": keep}

    def create(self, data: dict, actor: str) -> dict:
        task = {"id": uuid.uuid4().hex[:10], **self._clean(data, None), "created": time.time(), "last": None}
        self.state.update(lambda d: d.setdefault("usb_backup", {}).__setitem__(task["id"], task))
        self.state.log_activity(actor, f"Created backup {task['name']}", "info", "backup")
        return task

    def update(self, tid: str, data: dict, actor: str) -> dict:
        old = self._get(tid)
        new = {**old, **self._clean(data, old)}
        self.state.update(lambda d: d["usb_backup"].__setitem__(tid, new))
        self.state.log_activity(actor, f"Updated backup {new['name']}", "info", "backup")
        return new

    def delete(self, tid: str, actor: str) -> None:
        t = self._get(tid)
        if self.progress.get(tid, {}).get("state") == "running":
            raise UserError("Stop the backup first")
        self.state.update(lambda d: d["usb_backup"].pop(tid, None))
        self.state.log_activity(actor, f"Deleted backup {t['name']} (the backups on the disk are kept)", "info", "backup")

    def _get(self, tid: str) -> dict:
        t = self._tasks().get(tid)
        if not t:
            raise UserError("Backup not found")
        return t

    # ------------------------------------------------------------ where on the disk
    def _base(self, root: str) -> str:
        host = re.sub(r"[^A-Za-z0-9._-]", "_", self.nas.p.system_info().get("hostname", "nas")) or "nas"
        return os.path.join(root, ROOT_DIR, host)

    def _snapshots(self, task: dict, disk: Optional[dict]) -> List[str]:
        if not disk:
            return []
        if self.demo:
            return list(task.get("demo_snapshots", []))
        root = self._mounted_root(disk, mount=False)
        if not root:
            return task.get("snapshots_seen", [])
        try:
            names = os.listdir(self._base(root))
        except OSError:
            return []
        return sorted((n for n in names if STAMP_RE.match(n) or n == CURRENT), reverse=True)

    def _mounted_root(self, disk: dict, mount: bool = True) -> Optional[str]:
        ext = next((e for e in self.nas.files.externals() if e["dev"] == disk["dev"]), None)
        if not ext:
            return None
        if ext["mountpoint"]:
            return ext["mountpoint"]
        return self.nas.files._root(ext["id"]) if mount else None

    # ------------------------------------------------------------ run
    def run_now(self, tid: str, actor: str) -> dict:
        task = self._get(tid)
        disk = next((d for d in self.disks() if d["uuid"] == task["disk_uuid"]), None)
        if not disk:
            raise UserError(f"Plug in {task['disk_name'] or 'the backup disk'} first")
        with self._lock:
            if self.progress.get(tid, {}).get("state") == "running":
                raise UserError("This backup is already running")
            self._stop.discard(tid)
            self.progress[tid] = {"state": "running", "share": "", "index": 0, "total": 0, "percent": 0,
                                  "started": time.time(), "speed": None}
        self.state.log_activity(actor, f"Backup {task['name']} started", "info", "backup")
        threading.Thread(target=self._run, args=(task, disk, actor), daemon=True, name=f"backup-{tid}").start()
        return self.info()

    def stop(self, tid: str) -> None:
        self._stop.add(tid)
        p = self._procs.get(tid)
        if p and p.poll() is None:
            p.terminate()

    def _run(self, task: dict, disk: dict, actor: str) -> None:
        tid = task["id"]
        p = self.progress[tid]
        err = None
        stamp = snapshot_name(time.time())
        try:
            shares = [s for s in self.nas.shares() if s.get("path") and (not task["shares"] or s["name"] in task["shares"])]
            if not shares:
                raise UserError("There are no shared folders to back up")
            p["total"] = len(shares)
            if self.demo:
                self._demo_run(task, shares, stamp)
            else:
                self._real_run(task, disk, shares, stamp)
            stopped = tid in self._stop
            p.update(state="stopped" if stopped else "success", percent=100, finished=time.time())
        except Exception as e:   # noqa: BLE001 - reported in the page, the log and by email
            err = str(e)
            p.update(state="error", error=err, finished=time.time())
        finally:
            self._procs.pop(tid, None)
        last = {"at": time.time(), "ok": err is None and p["state"] == "success", "error": err,
                "stopped": p["state"] == "stopped", "duration": round(time.time() - p["started"])}

        def upd(d):
            t = d.get("usb_backup", {}).get(tid)
            if t:
                t["last"] = last
        self.state.update(upd)
        if err:
            self.state.log_activity(actor, f"Backup {task['name']} failed: {err}", "error", "backup")
            self.nas.notifier.send("usb_backup", f"Backup {task['name']} failed", f"Backup {task['name']} failed:\n{err}")
        elif p["state"] == "stopped":
            self.state.log_activity(actor, f"Backup {task['name']} stopped", "warning", "backup")
        else:
            ejected = ""
            if task.get("eject"):
                ejected = self._eject(disk)
            self.state.log_activity(actor, f"Backup {task['name']} completed{ejected}", "info", "backup")
            self.nas.notifier.send("usb_backup", f"Backup {task['name']} completed",
                                   f"Backup {task['name']} to {task['disk_name']} completed{ejected}.")

    def _eject(self, disk: dict) -> str:
        try:
            if self.demo:
                self.nas.files.eject(f"ext:{disk['dev']}")
                return "; the disk can be unplugged"
            ext = next((e for e in self.nas.files.externals() if e["dev"] == disk["dev"]), None)
            if ext and ext["ejectable"]:
                self.nas.files.eject(ext["id"])
                return "; the disk can be unplugged"
        except Exception:   # noqa: BLE001
            pass
        return ""

    def _real_run(self, task: dict, disk: dict, shares: List[dict], stamp: str) -> None:
        tid = task["id"]
        p = self.progress[tid]
        if not shutil.which("rsync"):
            p["share"] = "Installing rsync"
            run(["apt-get", "install", "-y", "-q", "rsync"], timeout=900, env=ENV)
        root = self._mounted_root(disk)
        if not root:
            raise UserError("The disk is no longer connected")
        base = self._base(root)
        os.makedirs(base, exist_ok=True)
        versions = disk["fstype"] in LINKS_FS
        if versions:
            done = sorted(n for n in os.listdir(base) if STAMP_RE.match(n))
            prev = os.path.join(base, done[-1]) if done else None
            if done and done[-1] == stamp:                     # twice in one minute
                stamp = snapshot_name(time.time() + 60)
            dest = os.path.join(base, stamp + ".partial")
        else:
            prev, dest = None, os.path.join(base, CURRENT)
        os.makedirs(dest, exist_ok=True)
        for i, s in enumerate(shares):
            if tid in self._stop:
                return
            p.update(share=s["name"], index=i, percent=round(i / len(shares) * 100, 1))
            target = os.path.join(dest, s["name"])
            os.makedirs(target, exist_ok=True)
            cmd = ["nice", "-n", "10", "rsync", "--info=progress2", "--no-inc-recursive", "--delete",
                   "--exclude=/.recycle", "--exclude=/.versions", "--exclude=/.talon-*"]
            cmd += ["-aH"] if versions else ["-rt", "--modify-window=2"]
            if prev and os.path.isdir(os.path.join(prev, s["name"])):
                cmd.append(f"--link-dest={os.path.join(prev, s['name'])}")
            cmd += [s["path"].rstrip("/") + "/", target + "/"]
            proc = self._procs[tid] = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            assert proc.stdout is not None
            buf = ""
            while True:
                ch = proc.stdout.read(1)
                if not ch:
                    break
                if ch in "\r\n":
                    pr = parse_progress(buf)
                    if pr and pr.get("source") == "rsync":
                        p.update(percent=round((i + pr["percent"] / 100) / len(shares) * 100, 1), speed=pr.get("speed"))
                    buf = ""
                else:
                    buf += ch
            rc = proc.wait()
            errtxt = (proc.stderr.read() if proc.stderr else "").strip()
            if tid in self._stop:
                return
            if rc not in (0, 24):                              # 24: files vanished while copying
                if "No space left" in errtxt:
                    raise UserError("The backup disk is full")
                raise UserError((errtxt.splitlines() or [f"rsync failed (exit code {rc})"])[-1])
        if versions:
            final = os.path.join(base, stamp)
            os.rename(dest, final)
            for old in to_prune(os.listdir(base), task["keep_days"], time.time()):
                shutil.rmtree(os.path.join(base, old), ignore_errors=True)
        run(["sync"], check=False, timeout=600)
        snaps = sorted((n for n in os.listdir(base) if STAMP_RE.match(n) or n == CURRENT), reverse=True)
        self.state.update(lambda d: d["usb_backup"][tid].__setitem__("snapshots_seen", snaps))

    def _demo_run(self, task: dict, shares: List[dict], stamp: str) -> None:
        tid = task["id"]
        p = self.progress[tid]
        disk = next((d for d in self.disks() if d["uuid"] == task["disk_uuid"]), None)
        for i, s in enumerate(shares):
            for step in range(10):
                if tid in self._stop:
                    return
                p.update(share=s["name"], index=i, percent=round((i + step / 10) / len(shares) * 100, 1), speed=48 * 1024 ** 2)
                time.sleep(0.12)

        snaps = sorted(set(task.get("demo_snapshots") or [snapshot_name(time.time() - k * 86400) for k in range(1, 6)]) | {stamp},
                       reverse=True)
        if disk:                                   # folders in the Files sandbox, so Restore opens something
            base = self._base(self.nas.files._root(disk["id"]))
            for snap in snaps:
                for s in shares:
                    folder = os.path.join(base, snap, s["name"])
                    os.makedirs(folder, exist_ok=True)
                    with open(os.path.join(folder, "Example.txt"), "w") as f:
                        f.write(f"A file from {s['name']}, backed up {snap}\n")
        self.state.update(lambda d: d["usb_backup"][tid].__setitem__("demo_snapshots", snaps))

    # ------------------------------------------------------------ plug and schedule
    def background_loop(self, stop: threading.Event) -> None:
        stop.wait(20)
        last_daily: Dict[str, str] = {}
        while not stop.is_set():
            try:
                tasks = self._tasks()
                if tasks:
                    present = {d["uuid"] for d in self.disks()}
                    # disks already connected when Talon starts do not count as plugged in
                    plugged = present - (self._seen if self._seen is not None else present)
                    self._seen = present
                    now = time.localtime()
                    for t in tasks.values():
                        if t["disk_uuid"] not in present or self.progress.get(t["id"], {}).get("state") == "running":
                            continue
                        last_at = (t.get("last") or {}).get("at") or 0
                        if t["when"] in ("plug", "both") and t["disk_uuid"] in plugged and time.time() - last_at > 600:
                            self.run_now(t["id"], "talon")
                        elif t["when"] in ("daily", "both") and time.strftime("%H:%M", now) == t["time"] \
                                and last_daily.get(t["id"]) != time.strftime("%Y-%m-%d", now):
                            last_daily[t["id"]] = time.strftime("%Y-%m-%d", now)
                            self.run_now(t["id"], "talon")
            except Exception:   # noqa: BLE001
                pass
            stop.wait(20)
