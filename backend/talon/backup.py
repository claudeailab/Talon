"""Backup: copy volumes, or folders on them, to a USB or internal (SATA, NVMe) disk, when it is
plugged in or every day.

Each backup task belongs to one disk (recognised by its filesystem UUID, so it does
not matter which port it is in) and copies the chosen volumes and folders into
"Talon Backup/<NAS name>/<version>/<volume>/" on it with rsync. A version is named after
when it was made, in the date format of Settings (e.g. "24-11-2026_1240"); a hidden
".talon-version" file in it holds the exact time, as names like 05-06-2026 can be read
two ways. A run copies into "<version>.partial" and renames it when done; a run that
stops or fails removes it again.

On disks that support hard links (ext4, XFS, Btrfs, NTFS) every run is a dated
version: files that did not change are hard links to the previous version, so a
version only takes the space of what changed. Versions older than the chosen number
of days are removed (the newest is always kept). FAT32 and exFAT have no hard links:
there the backup is one copy, kept up to date.

Restore: open a version in Files (it is a normal folder on the disk) and copy back
what you need."""
from __future__ import annotations

import collections
import contextlib
import os
import re
import shutil
import subprocess
import threading
import time
import uuid
from typing import Dict, List, Optional

from .scheduler import parse_progress
from .util import DATE_FORMATS, UserError, date_pattern, run, write_atomic

ROOT_DIR = "Talon Backup"
STAMP_FMT = "%Y-%m-%d_%H%M"                  # names of versions made before 1.0.144
STAMP_RE = re.compile(r"^\d{4}-\d{2}-\d{2}_\d{4}$")
MARKER = ".talon-version"                    # in each version: when it was made (seconds)
PARTIAL = ".partial"                         # a version still being copied
CURRENT = "Current"                          # the single copy on FAT32 / exFAT
MEDIA = {"usb": "USB disk", "hdd": "SATA hard disk", "ssd": "SATA SSD", "nvme": "NVMe SSD"}   # by disk kind
LINKS_FS = {"ext2", "ext3", "ext4", "xfs", "btrfs", "ntfs", "ntfs3"}
KEEP_CHOICES = (7, 14, 30, 90, 365)
WHEN = ("plug", "daily", "both")
ENV = {"DEBIAN_FRONTEND": "noninteractive"}


def snapshot_name(ts: float, settings: Optional[dict] = None) -> str:
    """A version's folder name: the date as in Settings → Date format ("/" becomes "-", as
    it cannot be in a name) and the time without ":" (Windows cannot show it)."""
    s = settings or {}
    lt = time.localtime(ts)
    date = time.strftime(DATE_FORMATS.get(s.get("date_format", ""), DATE_FORMATS["dd-mm-yyyy"]), lt).replace("/", "-")
    return f"{date}_{time.strftime('%I%M%p' if s.get('time_format') == '12h' else '%H%M', lt)}"


def version_time(folder: str, name: str) -> Optional[float]:
    """When a version was made; None for a folder that is not a version."""
    if name.endswith(PARTIAL) or name == CURRENT:
        return None
    if STAMP_RE.match(name):
        return time.mktime(time.strptime(name, STAMP_FMT))
    try:
        with open(os.path.join(folder, MARKER)) as f:
            return float(f.read().strip())
    except (OSError, ValueError):
        return None


def list_versions(base: str) -> List[dict]:
    """The versions in a backup folder, newest first: [{"name", "at"}]; the single copy
    on FAT32 / exFAT is {"name": "Current", "at": None}."""
    try:
        names = os.listdir(base)
    except OSError:
        return []
    found = [{"name": n, "at": version_time(os.path.join(base, n), n)} for n in names]
    out = sorted((v for v in found if v["at"] is not None), key=lambda v: v["at"], reverse=True)
    return out + ([{"name": CURRENT, "at": None}] if CURRENT in names else [])


def norm_versions(items) -> List[dict]:
    """Versions as {"name", "at"}; the state of older releases kept the names only."""
    out = []
    for v in items or []:
        if isinstance(v, dict):
            out.append(v)
        elif v == CURRENT:
            out.append({"name": v, "at": None})
        elif STAMP_RE.match(v):
            out.append({"name": v, "at": time.mktime(time.strptime(v, STAMP_FMT))})
    return out


def to_prune(versions: List[dict], keep_days: int, now: float) -> List[str]:
    """Versions older than keep_days; the newest version is always kept."""
    dated = sorted((v for v in versions if v.get("at") is not None), key=lambda v: v["at"])
    cutoff = now - keep_days * 86400
    return [v["name"] for v in dated[:-1] if v["at"] < cutoff]


def _duration(sec: float) -> str:
    sec = int(sec)
    if sec < 60:
        return f"{sec} s"
    if sec < 3600:
        return f"{sec // 60} min {sec % 60} s"
    return f"{sec // 3600} h {sec % 3600 // 60} min"


# never copied: recycle bins and previous versions (anywhere), Talon's own folders and lost+found
EXCLUDES = ["--exclude=.recycle/", "--exclude=.versions/", "--exclude=/.talon-*", "--exclude=/lost+found"]
SIZES_TTL = 600


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
        self._sizes: Dict[str, dict] = {}            # volume -> {"at": time, "folders": {name: bytes}}
        self._sizing: set = set()
        self._logs: Dict[str, collections.deque] = {}   # task -> the lines of its last run
        self.log_dir = os.path.join(os.path.dirname(os.path.abspath(nas.cfg.state_file)), "backup-logs")

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
            out.append({"uuid": u, "id": e["id"], "dev": e["dev"], "name": e["name"], "fstype": e["fstype"], "disk": e.get("disk"),
                        "media": MEDIA.get(e.get("disk_kind", ""), "Disk"),
                        "fs_label": e["detail"].split(" · ")[-1], "size": e["size"], "kind": e["kind"],
                        "versions": e["fstype"] in LINKS_FS})
        return out

    def blank_disks(self) -> List[dict]:
        """Disks Talon can prepare for backups (erase and format as ext4): empty ones, ones
        without a filesystem Talon can write to, and old RAID disks from another system."""
        ready = {e.get("disk") for e in self.nas.files.externals()}
        out = []
        for d in self.nas.disks():
            if d["name"] in ready or not d["selectable"] or d["status"] not in ("available", "has_data", "raid_member"):
                continue
            out.append({"disk": d["name"], "name": d["model"], "media": MEDIA.get(d["kind"], "Disk"), "size": d["size"],
                        "kind": "usb" if d["kind"] == "usb" else "disk",
                        "state": {"available": "Empty", "raid_member": "Old RAID"}.get(d["status"], "Has data")})
        return out

    # ------------------------------------------------------------ what can be backed up
    def sources(self) -> List[dict]:
        """Mounted volumes and the folders at their top, with sizes (worked out in the background)."""
        out = []
        for v in self.nas.volumes():
            if not (v["mounted"] or self.demo):
                continue
            try:
                items = self.nas.files.list(v["name"], "")["items"]
            except UserError:
                continue
            folders = sorted((i["name"] for i in items if i["folder"] and i["name"] != "lost+found"), key=str.lower)
            sizes = self._folder_sizes(v["name"])
            out.append({"volume": v["name"], "used": v["used"],
                        "folders": [{"name": f, "size": sizes.get(f)} for f in folders]})
        return out

    def _folder_sizes(self, volume: str) -> Dict[str, int]:
        c = self._sizes.get(volume)
        if (not c or time.time() - c["at"] > SIZES_TTL) and volume not in self._sizing:
            self._sizing.add(volume)
            threading.Thread(target=self._measure, args=(volume,), daemon=True, name=f"backup-sizes-{volume}").start()
        return (c or {}).get("folders", {})

    def _measure(self, volume: str) -> None:
        try:
            root = self.nas.files._root(volume)
            cp = run(["nice", "-n", "15", "du", "-b", "--max-depth=1", root], check=False, timeout=3600)
            folders = {}
            for line in cp.stdout.splitlines():
                size, _, path = line.partition("\t")
                name = os.path.relpath(path, root)
                if name != "." and "/" not in name and size.isdigit():
                    folders[name] = int(size)
            if self.demo and folders:           # the demo's files are tiny: share out the volume's used space
                used = next((v["used"] for v in self.nas.volumes() if v["name"] == volume), 0)
                total = sum(folders.values()) or 1
                folders = {k: int(used * n / total) for k, n in folders.items()}
            self._sizes[volume] = {"at": time.time(), "folders": folders}
        finally:
            self._sizing.discard(volume)

    def _sources(self, task: dict) -> List[dict]:
        """What a task copies: [{"volume", "folders"}] (no folders: the whole volume). Tasks made
        before volumes could be chosen copied shared folders: those become their folders."""
        if "sources" in task:
            return task["sources"]
        out: Dict[str, List[str]] = {}
        for sh in self.nas.shares():
            if sh.get("path") and (not task.get("shares") or sh["name"] in task["shares"]):
                out.setdefault(sh["volume"], []).append(sh["folder"])
        return [{"volume": v, "folders": sorted(set(f))} for v, f in sorted(out.items())]

    def _items(self, task: dict) -> List[dict]:
        """The copies a run makes: a source folder and where it goes in the version."""
        out = []
        for src in self._sources(task):
            try:
                root = self.nas.files._root(src["volume"])
            except UserError:
                raise UserError(f"Volume {src['volume']} is not available") from None
            for f in (src["folders"] or [""]):
                path = os.path.join(root, f) if f else root
                if os.path.isdir(path) or self.demo:
                    out.append({"label": f"{src['volume']}/{f}" if f else src["volume"], "path": path,
                                "dest": os.path.join(src["volume"], f) if f else src["volume"], "whole": not f})
        return out

    # ------------------------------------------------------------ tasks
    def _tasks(self) -> Dict[str, dict]:
        return self.state.get("usb_backup") or {}

    def info(self) -> dict:
        disks = {d["uuid"]: d for d in self.disks()}
        tasks = []
        for t in sorted(self._tasks().values(), key=lambda t: t["name"].lower()):
            d = disks.get(t["disk_uuid"])
            tasks.append({**t, "sources": self._sources(t), "connected": bool(d), "disk": d,
                          "progress": self.progress.get(t["id"], {"state": "idle"}),
                          "snapshots": self._snapshots(t, d) if d else norm_versions(t.get("snapshots_seen"))})
        return {"tasks": tasks, "disks": list(disks.values()), "prepare": self.blank_disks(),
                "sources": self.sources(),
                "backup_dir": os.path.relpath(self._base("/"), "/")}

    def _clean(self, data: dict, old: Optional[dict], preparing: bool = False) -> dict:
        name = str(data.get("name", (old or {}).get("name", ""))).strip()
        if not name or len(name) > 60:
            raise UserError("Enter a name (up to 60 characters)")
        disk_uuid = str(data.get("disk_uuid", (old or {}).get("disk_uuid", "")))
        disks = {d["uuid"]: d for d in self.disks()}
        if not old and not preparing and disk_uuid not in disks:
            raise UserError("Plug in the disk and choose it")
        sources = self._clean_sources(data["sources"]) if "sources" in data else (
            self._sources(old) if old else None)
        if not sources:
            raise UserError("Choose what to back up")
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
                "sources": sources, "when": when, "time": t, "eject": bool(data.get("eject", (old or {}).get("eject", True))),
                "keep_days": keep}

    def create(self, data: dict, actor: str) -> dict:
        prep = str(data.get("prepare_disk") or "")
        if prep:
            blank = next((b for b in self.blank_disks() if b["disk"] == prep), None)
            if not blank:
                raise UserError(f"Disk {prep} cannot be prepared for backups")
            data = {**data, "disk_uuid": ""}
        task = {"id": uuid.uuid4().hex[:10], **self._clean(data, None, preparing=bool(prep)), "created": time.time(), "last": None}
        if prep:
            task.update(disk_name=blank["name"], disk_size=blank["size"], versions=True)
        self.state.update(lambda d: d.setdefault("usb_backup", {}).__setitem__(task["id"], task))
        self.state.log_activity(actor, f"Created backup {task['name']}", "info", "backup")
        if prep:
            with self._lock:
                self.progress[task["id"]] = {"state": "running", "share": "Preparing the disk", "index": 0, "total": 0,
                                             "percent": 0, "started": time.time(), "speed": None}
            threading.Thread(target=self._prepare, args=(task, prep, bool(data.get("run_now")), actor),
                             daemon=True, name=f"backup-prepare-{task['id']}").start()
        return task

    def _prepare(self, task: dict, disk: str, run_now: bool, actor: str) -> None:
        """Erase and format the chosen disk as ext4, then (optionally) run the first backup."""
        tid = task["id"]
        try:
            part = self.nas.p.format_backup_disk(disk, "Talon Backup", lambda _l: None)
            self._uuid_cache.clear()
            u = self._uuid(part, "ext4")
            if not u:
                raise UserError(f"Disk {disk} was formatted but did not appear; unplug it and plug it in again")
            self.state.update(lambda d: d["usb_backup"][tid].__setitem__("disk_uuid", u))
            self.state.log_activity(actor, f"Prepared disk {disk} ({task['disk_name']}) for backup {task['name']}", "info", "backup")
            self.progress[tid] = {"state": "idle"}
            if run_now:
                self.run_now(tid, actor)
        except Exception as e:   # noqa: BLE001 - shown on the backup's card
            self.progress[tid] = {"state": "error", "error": f"Could not prepare disk {disk}: {e}", "finished": time.time()}
            self.state.log_activity(actor, f"Could not prepare disk {disk} for backup {task['name']}: {e}", "error", "backup")

    def _clean_sources(self, raw) -> List[dict]:
        vols = {v["volume"]: {f["name"] for f in v["folders"]} for v in self.sources()}
        out = []
        for src in raw or []:
            v = str((src or {}).get("volume", ""))
            if v not in vols:
                raise UserError(f"Volume {v} is not available")
            folders = sorted({str(f) for f in (src.get("folders") or [])})
            bad = [f for f in folders if f not in vols[v]]
            if bad:
                raise UserError(f"Folder {bad[0]} is not on volume {v}")
            out.append({"volume": v, "folders": folders})
        return out

    def update(self, tid: str, data: dict, actor: str) -> dict:
        old = self._get(tid)
        new = {**old, **self._clean(data, old)}
        new.pop("shares", None)
        self.state.update(lambda d: d["usb_backup"].__setitem__(tid, new))
        self.state.log_activity(actor, f"Updated backup {new['name']}", "info", "backup")
        return new

    def delete(self, tid: str, actor: str) -> None:
        t = self._get(tid)
        if self.progress.get(tid, {}).get("state") == "running":
            raise UserError("Stop the backup first")
        self.state.update(lambda d: d["usb_backup"].pop(tid, None))
        self._logs.pop(tid, None)
        with contextlib.suppress(OSError):
            os.remove(self._log_file(tid))
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

    def _snapshots(self, task: dict, disk: Optional[dict]) -> List[dict]:
        if not disk:
            return []
        if self.demo:
            return norm_versions(task.get("demo_snapshots"))
        root = self._mounted_root(disk, mount=False)
        if not root:
            return norm_versions(task.get("snapshots_seen"))
        return list_versions(self._base(root))

    # ------------------------------------------------------------ log
    def _log_file(self, tid: str) -> str:
        return os.path.join(self.log_dir, f"{tid}.log")

    def _log(self, tid: str, text: str, level: str = "INFO", file: str = "") -> None:
        """A log line in the same time/level/file/message form as OneDrive's."""
        q = self._logs.get(tid)
        if q is not None:
            q.append("\t".join((time.strftime("%H:%M:%S"), level, file.replace("\t", " "), text.replace("\t", " "))))

    def task_log(self, tid: str) -> List[str]:
        """The lines of the running or the last run."""
        self._get(tid)
        q = self._logs.get(tid)
        if q is not None:
            return list(q)
        try:
            with open(self._log_file(tid)) as f:
                return f.read().splitlines()[-2000:]
        except OSError:
            return []

    def _save_log(self, tid: str) -> None:
        q = self._logs.get(tid)
        if q is None:
            return
        try:
            os.makedirs(self.log_dir, exist_ok=True)
            write_atomic(self._log_file(tid), "\n".join(q) + "\n", 0o600)
        except OSError:
            pass

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
            self._logs[tid] = collections.deque(maxlen=2000)
        self._log(tid, time.strftime("Backup started " + date_pattern(self.state.get("settings"), True)) +
                  ("" if actor == "talon" else f" by {actor}"))
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
        try:
            items = self._items(task)
            if not items:
                raise UserError("Nothing to back up: the chosen folders no longer exist")
            p["total"] = len(items)
            if self.demo:
                self._demo_run(task, items)
            else:
                self._real_run(task, disk, items)
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
        took = _duration(last["duration"])
        if err:
            self._log(tid, f"Failed after {took}: {err}", "ERROR")
            self.state.log_activity(actor, f"Backup {task['name']} failed: {err}", "error", "backup")
            self.nas.notifier.send("usb_backup", f"Backup {task['name']} failed", f"Backup {task['name']} failed:\n{err}")
        elif p["state"] == "stopped":
            self._log(tid, f"Stopped after {took}", "WARNING")
            self.state.log_activity(actor, f"Backup {task['name']} stopped", "warning", "backup")
        else:
            ejected = ""
            if task.get("eject"):
                ejected = self._eject(disk)
                if ejected:
                    self._log(tid, "Ejected the disk; it can be unplugged")
            self._log(tid, f"Finished in {took}", "SUCCESS")
            self.state.log_activity(actor, f"Backup {task['name']} completed{ejected}", "info", "backup")
            self.nas.notifier.send("usb_backup", f"Backup {task['name']} completed",
                                   f"Backup {task['name']} to {task['disk_name']} completed{ejected}.")
        self._save_log(tid)

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

    def _real_run(self, task: dict, disk: dict, items: List[dict]) -> None:
        tid = task["id"]
        p = self.progress[tid]
        if not shutil.which("rsync"):
            p["share"] = "Installing rsync"
            self._log(tid, "Installing rsync")
            run(["apt-get", "install", "-y", "-q", "rsync"], timeout=900, env=ENV)
        root = self._mounted_root(disk)
        if not root:
            raise UserError("The disk is no longer connected")
        base = self._base(root)
        os.makedirs(base, exist_ok=True)
        for n in os.listdir(base):                             # left by a run that could not finish (power cut)
            if n.endswith(PARTIAL):
                self._log(tid, f"Removing {n}, left unfinished by an earlier run")
                shutil.rmtree(os.path.join(base, n), ignore_errors=True)
        versions = disk["fstype"] in LINKS_FS
        settings = self.state.get("settings")
        if versions:
            prev = next((v["name"] for v in list_versions(base) if v["at"] is not None), None)
            at = time.time()
            stamp = snapshot_name(at, settings)
            while os.path.exists(os.path.join(base, stamp)):   # twice in one minute
                at += 60
                stamp = snapshot_name(at, settings)
            dest = os.path.join(base, stamp + PARTIAL)
            os.makedirs(dest, exist_ok=True)
            with open(os.path.join(dest, MARKER), "w") as f:
                f.write(f"{at}\n")
            self._log(tid, f"New version {stamp}" + (f"; files that did not change are linked to {prev}" if prev else ""))
            prev = os.path.join(base, prev) if prev else None
        else:
            stamp, prev, dest = CURRENT, None, os.path.join(base, CURRENT)
            os.makedirs(dest, exist_ok=True)
            self._log(tid, f"Updating the copy in {CURRENT} ({disk['fs_label']} keeps no earlier versions)")
        finished = False
        try:
            self._copy(task, items, dest, prev, versions)
            finished = tid not in self._stop
        finally:
            if versions and not finished:                      # stopped or failed: no half version is left
                shutil.rmtree(dest, ignore_errors=True)
                self._log(tid, f"Removed the unfinished version {stamp}")
        if not finished:
            return
        if versions:
            os.rename(dest, os.path.join(base, stamp))
            for old in to_prune(list_versions(base), task["keep_days"], time.time()):
                self._log(tid, f"Removing version {old}, older than {task['keep_days']} days")
                shutil.rmtree(os.path.join(base, old), ignore_errors=True)
        run(["sync"], check=False, timeout=600)
        snaps = list_versions(base)
        self.state.update(lambda d: d["usb_backup"][tid].__setitem__("snapshots_seen", snaps))

    def _copy(self, task: dict, items: List[dict], dest: str, prev: Optional[str], versions: bool) -> None:
        """rsync each folder into the version, logging every file copied or deleted."""
        tid = task["id"]
        p = self.progress[tid]
        n = len(items)
        for i, it in enumerate(items):
            if tid in self._stop:
                return
            p.update(share=it["label"], index=i, percent=round(i / n * 100, 1))
            self._log(tid, f"Backing up {it['label']} ({i + 1} of {n})")
            target = os.path.join(dest, it["dest"])
            os.makedirs(target, exist_ok=True)
            cmd = ["nice", "-n", "10", "rsync", "--info=progress2", "--no-inc-recursive", "--delete",
                   "--out-format=>> %o %n", *EXCLUDES]
            cmd += ["-aH"] if versions else ["-rt", "--modify-window=2"]
            if prev and os.path.isdir(os.path.join(prev, it["dest"])):
                cmd.append(f"--link-dest={os.path.join(prev, it['dest'])}")
            cmd += [it["path"].rstrip("/") + "/", target + "/"]
            # one pipe for both: rsync waits when a stderr pipe nobody reads fills up
            proc = self._procs[tid] = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                                       text=True, errors="replace")
            assert proc.stdout is not None
            errors: List[str] = []
            counts = {"copied": 0, "deleted": 0}
            buf = ""
            while True:
                ch = proc.stdout.read(1)
                if not ch:
                    break
                if ch in "\r\n":
                    self._rsync_line(tid, it, buf, i, n, counts, errors)
                    buf = ""
                else:
                    buf += ch
            self._rsync_line(tid, it, buf, i, n, counts, errors)
            rc = proc.wait()
            if tid in self._stop:
                return
            self._log(tid, f"{it['label']}: {counts['copied']:,} files copied, {counts['deleted']:,} deleted")
            if rc not in (0, 24):                              # 24: files vanished while copying
                if any("No space left" in e for e in errors):
                    raise UserError("The backup disk is full")
                raise UserError(errors[-1] if errors else f"rsync failed (exit code {rc})")

    def _rsync_line(self, tid: str, it: dict, line: str, i: int, n: int, counts: dict, errors: List[str]) -> None:
        """One line of rsync's output: a file it copied or deleted, its progress, or a message."""
        line = line.strip()
        if not line:
            return
        if line.startswith(">> "):                             # --out-format: the operation and the path
            op, _, name = line[3:].partition(" ")
            if not name or name.endswith("/"):                 # a folder
                return
            gone = op == "del."
            counts["deleted" if gone else "copied"] += 1
            self._log(tid, "Deleted" if gone else "Copied", file=f"{it['dest']}/{name}")
            return
        pr = parse_progress(line)
        if pr:
            if pr.get("source") == "rsync":
                self.progress[tid].update(percent=round((i + pr["percent"] / 100) / n * 100, 1), speed=pr.get("speed"))
            return
        vanished = "vanished" in line
        if not vanished:
            errors.append(line)
        self._log(tid, line, "WARNING" if vanished else "ERROR")

    def _demo_run(self, task: dict, items: List[dict]) -> None:
        tid = task["id"]
        p = self.progress[tid]
        disk = next((d for d in self.disks() if d["uuid"] == task["disk_uuid"]), None)
        settings = self.state.get("settings")
        now = time.time()
        old = norm_versions(task.get("demo_snapshots")) or [
            {"name": snapshot_name(now - k * 86400, settings), "at": now - k * 86400} for k in range(1, 6)]
        new = {"name": snapshot_name(now, settings), "at": now}
        self._log(tid, f"New version {new['name']}; files that did not change are linked to {old[0]['name']}")
        for i, it in enumerate(items):
            self._log(tid, f"Backing up {it['label']} ({i + 1} of {len(items)})")
            for step in range(10):
                if tid in self._stop:
                    self._log(tid, f"Removed the unfinished version {new['name']}")
                    return
                p.update(share=it["label"], index=i, percent=round((i + step / 10) / len(items) * 100, 1), speed=48 * 1024 ** 2)
                self._log(tid, "Copied", file=f"{it['dest']}/Example {step + 1}.txt")
                time.sleep(0.12)
            self._log(tid, f"{it['label']}: 10 files copied, 0 deleted")

        snaps = sorted([v for v in old if v["name"] != new["name"]] + [new], key=lambda v: v["at"], reverse=True)
        if disk:                                   # folders in the Files sandbox, so Restore opens something
            base = self._base(self.nas.files._root(disk["id"]))
            for snap in snaps:
                for it in items:
                    folder = os.path.join(base, snap["name"], it["dest"])
                    os.makedirs(folder, exist_ok=True)
                    with open(os.path.join(folder, "Example.txt"), "w") as f:
                        f.write(f"A file from {it['label']}, backed up {snap['name']}\n")
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
