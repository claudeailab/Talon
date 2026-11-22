"""Business logic shared by the real and demo platforms."""
from __future__ import annotations

import collections
import json
import os
import re
import threading
import time
from typing import Dict, List, Optional

from . import raid, sharecfg
from .cloudsync import CloudSync
from .files import FileBrowser
from .folderperms import FolderPerms
from .jobs import JobRunner
from .network import Network
from .antivirus import Antivirus
from .history import History
from .osupdate import OsUpdate
from .ramlog import RamLog
from .backup import Backup
from .notify import Notifier
from .scheduler import Scheduler
from .state import State
from .util import (NFS_CLIENT_RE, RESERVED_SHARES, SHARE_NAME_RE, USER_NAME_RE,
                   VOLUME_NAME_RE, UserError, require, unique, write_atomic)

SYSTEM_MOUNTS = {"/", "/boot", "/boot/efi", "/boot/firmware", "/usr", "/var", "/home",
                 "[SWAP]", "/var/log", "/tmp", "/opt", "/srv"}
SMB_PROTOCOLS = ["SMB2_02", "SMB2_10", "SMB3_00", "SMB3_11"]
HOSTNAME_RE = re.compile(r"^(?!-)[A-Za-z0-9-]{1,63}(?<!-)$")
WORKGROUP_RE = re.compile(r"^[A-Za-z0-9_-]{1,15}$")
GROWABLE = {"raid1", "raid5", "raid6"}


class Nas:
    def __init__(self, cfg, platform):
        self.cfg = cfg
        self.p = platform
        if getattr(platform, "demo", False):
            # the simulated host is rebuilt on every start, its activity log too
            for f in (cfg.state_file, *(os.path.join(os.path.dirname(os.path.abspath(cfg.state_file)), n)
                                        for n in ("activity.jsonl", "history.json"))):
                if os.path.exists(f):
                    os.unlink(f)
        self.state = State(cfg.state_file)
        if getattr(platform, "demo", False):
            platform.seed_state(self.state)
        self._migrate()
        self.jobs = JobRunner(on_done=self._job_done,
                              on_start=lambda job: self.state.log_activity(job.user, f"{job.title} started",
                                                                           job=job.id))
        demo = bool(getattr(platform, "demo", False))
        self.notifier = Notifier(self.state, lambda: self.p.system_info().get("hostname", "nas"),
                                 demo)
        self.cloud = CloudSync(cfg, self.state, self, demo)
        self.files = FileBrowser(self, demo)
        self.folder_perms = FolderPerms(self, demo)
        from .restore import Restore
        self.restore = Restore(self)
        from .entrausers import EntraUsers
        self.entra_users = EntraUsers(
            self.state, lambda: [u["name"] for u in self.users() if u["admin"] and not u["disabled"]], demo)
        self._purged = 0.0
        self.scheduler = Scheduler(cfg, self.state, self, demo)
        self.network = Network(platform, self.state, demo)
        self.ramlog = RamLog(self.state, demo)
        self.osupdate = OsUpdate(self.state, self.notifier, demo)
        # usage history (Dashboard → tap a card): written hourly on SD cards, else every 10 minutes
        self.usage = History(os.path.join(os.path.dirname(os.path.abspath(cfg.state_file)), "history.json"),
                             3600 if (self.state.get("ramlog") or {}).get("enabled") else 600)
        self._disk_temps: Dict[str, float] = {}
        self._vol_used: Dict[str, float] = {}
        self._vol_checked = 0.0
        self.antivirus = Antivirus(self, bool(getattr(platform, "demo", False)))
        self.backup = Backup(self, bool(getattr(platform, "demo", False)))
        self.history: collections.deque = collections.deque(maxlen=90)
        self._last_sample: Optional[dict] = None
        self._stop = threading.Event()

    def _migrate(self) -> None:
        """Volumes created before RAID and volumes were separated owned their md
        array. Give each such array its own entry in ``arrays``."""
        vols = self.state.get("volumes")
        if all("array" in v for v in vols.values()):
            return

        def upd(d):
            for v in d["volumes"].values():
                if "array" in v:
                    continue
                if v.get("md_uuid") and v.get("level", "single") != "single":
                    d["arrays"].setdefault(v["name"], {
                        "name": v["name"], "level": v["level"], "md_uuid": v["md_uuid"],
                        "created": v.get("created")})
                    v["array"] = v["name"]
                else:
                    v["array"] = None
        self.state.update(upd)

    # ---------------------------------------------------------------- lifecycle
    def start(self) -> None:
        try:
            self.ramlog.auto_enable()
        except Exception:   # noqa: BLE001 - only a convenience
            pass
        if getattr(self.p, "demo", False):
            try:
                self.usage.seed_demo({v["name"]: float(v["used"]) for v in self.volumes() if v.get("size")},
                                     [d["name"] for d in self.p.scan_disks()])
            except Exception:   # noqa: BLE001
                pass
        threading.Thread(target=self._sampler, daemon=True, name="sampler").start()
        threading.Thread(target=self._smart_refresher, daemon=True, name="smart").start()
        threading.Thread(target=self._watcher, daemon=True, name="notify").start()
        self.cloud.start()
        self.scheduler.start()
        threading.Thread(target=self.backup.background_loop, args=(self._stop,), daemon=True, name="backup").start()
        threading.Thread(target=self.antivirus.background_loop, args=(self._stop,), daemon=True, name="antivirus").start()
        threading.Thread(target=self.osupdate.background_loop, args=(self._stop,), daemon=True, name="os-update-check").start()

    def stop(self) -> None:
        self._stop.set()
        self.usage.flush()
        self.cloud.stop()
        self.scheduler.stop()

    def _watcher(self) -> None:
        """Every 5 minutes: mail new alerts and newly published updates."""
        from . import __version__
        from .update import is_newer
        self._stop.wait(60)
        while not self._stop.is_set():
            try:
                self.notifier.check_alerts(self.alerts())
                self.cloud.check_secret_expiry()
                if time.time() - self._purged > 86400:         # recycle bins: 30 days
                    self._purged = time.time()
                    self.restore.purge()
                upd = self.state.get("update_check") or {}
                latest = upd.get("latest")
                if latest and is_newer(latest, __version__) and \
                        self.state.get("notify_update") != latest:
                    self.notifier.send("update", f"Talon {latest} is available",
                                       f"Talon {latest} is available (you have {__version__}).\n"
                                       "Install it in Settings > Update.")
                    self.state.update(lambda d: d.__setitem__("notify_update", latest))
            except Exception:
                pass
            self._stop.wait(300)

    def _sampler(self) -> None:
        while not self._stop.is_set():
            try:
                s = self.p.sample()
                prev = self._last_sample
                point = {"ts": s["ts"], "cpu": s["cpu"], "mem_used": s["mem_used"],
                         "mem_total": s["mem_total"], "temp": s["temp"], "load": s["load"],
                         "rx": 0.0, "tx": 0.0, "read": 0.0, "write": 0.0}
                if prev:
                    dt = max(s["ts"] - prev["ts"], 0.001)
                    point["rx"] = max(s["net_rx"] - prev["net_rx"], 0) / dt
                    point["tx"] = max(s["net_tx"] - prev["net_tx"], 0) / dt
                    point["read"] = max(s["disk_read"] - prev["disk_read"], 0) / dt
                    point["write"] = max(s["disk_write"] - prev["disk_write"], 0) / dt
                self._last_sample = s
                self.history.append(point)
                self._record_usage(point)
            except Exception:
                pass
            self._stop.wait(2.0)

    def _record_usage(self, point: dict) -> None:
        if time.time() - self._vol_checked > 600:               # used space: every 10 minutes
            self._vol_checked = time.time()
            self._vol_used = {v["name"]: float(v["used"]) for v in self.volumes() if v.get("mounted") and v.get("size")}
        p = {"ts": point["ts"], "cpu": point["cpu"],
             "mem": round(point["mem_used"] / point["mem_total"] * 100, 2) if point.get("mem_total") else None,
             "temp": point["temp"], "rx": point["rx"], "tx": point["tx"], "read": point["read"], "write": point["write"]}
        for d, t in self._disk_temps.items():
            p["disk:" + d] = t
        for v, used in self._vol_used.items():
            p["vol:" + v] = used
        self.usage.add(p)

    def usage_history(self, rng: str) -> dict:
        vols = {v["name"]: float(v["size"]) for v in self.volumes() if v.get("size")}
        out = self.usage.series(rng)
        out["volumes"] = {name: {"size": size, "forecast": self.usage.forecast("vol:" + name, size)} for name, size in vols.items()}
        out["disks"] = sorted({k[5:] for p in out["points"] for k in p if k.startswith("disk:") and not k.endswith("^")})
        return out

    def _smart_refresher(self) -> None:
        while not self._stop.is_set():
            try:
                temps = {}
                for d in self.p.scan_disks():
                    t = self.p.smart(d["name"]).get("temperature")
                    if t:
                        temps[d["name"]] = float(t)
                self._disk_temps = temps
            except Exception:
                pass
            self._stop.wait(300)

    JOBS_KEEP = 200

    def _jobs_dir(self) -> str:
        return os.path.join(os.path.dirname(os.path.abspath(self.cfg.state_file)), "jobs")

    def _job_done(self, job) -> None:
        level = "info" if job.status == "success" else "error"
        msg = job.title + (" completed" if job.status == "success" else f" failed: {job.error}")
        # keep its steps on disk, so the activity log can show them after a restart
        try:
            d = self._jobs_dir()
            os.makedirs(d, mode=0o700, exist_ok=True)
            write_atomic(os.path.join(d, f"{int(job.started * 1000):015d}-{job.id}.json"),
                         json.dumps(job.to_dict(with_log=True)), 0o600)
            for old in sorted(os.listdir(d))[:-self.JOBS_KEEP]:
                os.unlink(os.path.join(d, old))
        except OSError:
            pass
        self.state.log_activity(job.user, msg, level, job=job.id)
        if job.status == "error":
            self.notifier.send("task_failed", f"{job.title} failed", f"{job.title} failed:\n{job.error}")

    def job_details(self, job_id: str) -> Optional[dict]:
        """A job with its steps: running ones from memory, finished ones from disk."""
        j = self.jobs.get(job_id)
        if j:
            return j.to_dict(with_log=True)
        if not re.fullmatch(r"[0-9a-f]{12}", job_id or ""):
            return None
        try:
            name = next(n for n in os.listdir(self._jobs_dir()) if n.endswith(f"-{job_id}.json"))
            with open(os.path.join(self._jobs_dir(), name)) as f:
                return json.load(f)
        except (OSError, StopIteration, ValueError):
            return None

    # ---------------------------------------------------------------- disks
    def disks(self) -> List[dict]:
        vols = self.state.get("volumes")
        known = self.state.get("arrays")
        md_by_dev = {a["dev"]: a for a in self.p.md_arrays()}
        uuid_to_array = {r["md_uuid"]: n for n, r in known.items()}
        array_to_vol = {v["array"]: v["name"] for v in vols.values() if v.get("array")}
        mp_to_vol = {v["mountpoint"]: v["name"] for v in vols.values()}
        out = []
        for d in self.p.scan_disks():
            status, detail, volume, array = "available", "", None, None
            mine = [uuid_to_array[md_by_dev[m]["uuid"]] for m in d["md"]
                    if m in md_by_dev and md_by_dev[m].get("uuid") in uuid_to_array]
            if mine:
                array = mine[0]
                volume = array_to_vol.get(array)
                status, detail = "raid", f"Member of RAID {array}"
            elif d["md"]:
                # a RAID array from another system: it can be erased unless it is in use
                in_use = bool(d["mounts"]) or d.get("busy", False)
                status = "raid_member"
                detail = f"Old RAID {', '.join(d['md'])} - " + ("in use" if in_use else "will be erased")
            elif any(m in SYSTEM_MOUNTS for m in d["mounts"]):
                status, detail = "system", "Operating system disk"
            elif any(m in mp_to_vol for m in d["mounts"]):
                volume = next(mp_to_vol[m] for m in d["mounts"] if m in mp_to_vol)
                status, detail = "volume", f"Volume {volume}"
            elif d["mounts"]:
                status, detail = "mounted", "Mounted at " + ", ".join(d["mounts"])
            elif d["has_signature"]:
                fs = ", ".join(d["fstypes"]) or "partitions"
                status, detail = "has_data", f"Existing data ({fs}) - will be erased"
            smart = self.p.smart_cached(d["name"])
            out.append({**d, "status": status, "status_detail": detail, "volume": volume,
                        "array": array,
                        "selectable": status in ("available", "has_data") or (
                            status == "raid_member" and not d["mounts"] and not d.get("busy")),
                        "health": self._health(smart),
                        "temperature": smart.get("temperature") or None,
                        "power_on_hours": smart.get("power_on_hours")})
        limits = self.thresholds()
        for d in out:   # the "Disk too hot" alert threshold for this kind of disk
            d["temp_limit"] = limits[f"temp_{self._temp_kind(d)}"]
        return out

    # ---------------------------------------------------------------- alert thresholds
    THRESHOLDS = {"temp_hdd": 55, "temp_ssd": 65, "temp_nvme": 75,
                  "volume_full": 90, "ssd_wear": 90, "bad_sectors": True}
    LIMITS = {"temp_hdd": (30, 90), "temp_ssd": (30, 90), "temp_nvme": (30, 95),
              "volume_full": (50, 99), "ssd_wear": (50, 100)}

    def thresholds(self) -> dict:
        saved = self.state.get("thresholds") or {}
        return {k: saved.get(k, v) for k, v in self.THRESHOLDS.items()}

    def thresholds_info(self) -> dict:
        """Thresholds, defaults and the current temperature of each disk by type."""
        now: Dict[str, list] = {"hdd": [], "ssd": [], "nvme": []}
        for d in self.disks():
            if d.get("temperature"):
                now[self._temp_kind(d)].append({"name": d["name"], "temperature": d["temperature"]})
        return {"values": self.thresholds(), "defaults": dict(self.THRESHOLDS), "now": now}

    def save_thresholds(self, data: dict, user: str) -> dict:
        clean = {}
        for k, default in self.THRESHOLDS.items():
            v = data.get(k, default)
            if isinstance(default, bool):
                clean[k] = bool(v)
                continue
            try:
                v = int(v)
            except (TypeError, ValueError):
                raise UserError("Enter whole numbers") from None
            lo, hi = self.LIMITS[k]
            if not lo <= v <= hi:
                raise UserError(f"Enter a value between {lo} and {hi}")
            clean[k] = v
        self.state.update(lambda d: d.__setitem__("thresholds", clean))
        self.state.log_activity(user, "Changed the alert thresholds")
        return self.thresholds_info()

    @staticmethod
    def _temp_kind(d: dict) -> str:
        if d.get("kind") == "nvme":
            return "nvme"
        if d.get("kind") == "hdd" or (d.get("kind") == "usb" and d.get("rotational")):
            return "hdd"
        return "ssd"

    def _health(self, smart: dict) -> str:
        if not smart or smart.get("passed") is None:
            return "unknown"
        if smart.get("passed") is False:
            return "failing"
        t = self.thresholds()
        if t["bad_sectors"] and smart.get("bad_sectors"):
            return "warning"
        if (smart.get("percentage_used") or 0) >= t["ssd_wear"]:
            return "warning"
        return "good"

    def _disk(self, name: str) -> dict:
        for d in self.disks():
            if d["name"] == name:
                return d
        raise UserError(f"Disk {name} not found")

    def disk_smart(self, name: str) -> dict:
        self._disk(name)
        return {k: v for k, v in self.p.smart(name, refresh=True).items() if not k.startswith("_")}

    def disk_smart_test(self, name: str, kind: str, user: str) -> None:
        self._disk(name)
        self.p.smart_test(name, kind)
        self.state.log_activity(user, f"Started {kind} SMART self-test on {name}")

    def wipe_disk(self, name: str, user: str):
        d = self._disk(name)
        if not d["selectable"]:
            raise UserError(f"Disk {name} is in use ({d['status_detail']})")
        def work(log):
            self.p.wipe_disk(name, log)       # stops an old RAID array on it first
            if d["status"] == "raid_member":
                self.p.save_mdadm_conf(log)

        return self.jobs.submit(f"Wipe disk {name}", user, work)

    # ---------------------------------------------------------------- RAID arrays
    def raid_options(self, disks: List[str], spares: int) -> List[dict]:
        all_disks = {d["name"]: d for d in self.disks()}
        sizes = [all_disks[n]["size"] for n in disks if n in all_disks]
        return [o for o in raid.options_for(sizes, spares) if o["id"] != "single"]

    def _live(self, record: dict, arrays: List[dict]) -> Optional[dict]:
        return next((a for a in arrays if a.get("uuid") == record.get("md_uuid")), None)

    def raid_arrays(self) -> List[dict]:
        known = self.state.get("arrays")
        vols = self.state.get("volumes")
        live = self.p.md_arrays()
        disks = {d["name"]: d for d in self.p.scan_disks()}
        out = []
        for r in sorted(known.values(), key=lambda x: x["name"]):
            item = {"name": r["name"], "level": r["level"], "created": r.get("created"),
                    "volume": next((v["name"] for v in vols.values()
                                    if v.get("array") == r["name"]), None),
                    "size": 0, "members": [], "sync": None,
                    "status": "healthy", "status_detail": ""}
            a = self._live(r, live)
            if not a:
                item["status"], item["status_detail"] = "missing", "RAID array not assembled"
            else:
                item["dev"] = a["dev"]
                item["size"] = a["size"]
                item["raid_disks"] = a["raid_disks"]
                item["degraded"] = a["degraded"]
                item["sync"] = {k: a[k] for k in ("sync_action", "sync_progress", "sync_speed_kbs")}
                for m in a["members"]:
                    d = disks.get(m["disk"], {})
                    item["members"].append({**m, "model": d.get("model", "?"),
                                            "size": d.get("size", 0),
                                            "kind": d.get("kind", "hdd")})
                item["status"], item["status_detail"] = self._array_status(a)
                # mdadm builds a new RAID 5 by "recovering" onto its last disk (faster than
                # a parity resync): that is the first build, not a replacement disk.
                if r.get("synced") is False:
                    if a["sync_action"] in ("recover", "resync"):
                        prog = a.get("sync_progress")
                        item["status"] = "building"
                        item["status_detail"] = "Building the new array" + (
                            f" ({prog:.1f}%)" if prog is not None else "")
                        item["sync"]["label"] = "Building"
                        for m in item["members"]:
                            if m["state"] == "rebuilding":
                                m["state"] = "syncing"
                    elif a["sync_action"] == "idle" and not a["degraded"]:
                        name = r["name"]
                        self.state.update(lambda d: d["arrays"][name].__setitem__("synced", True))
            item["fault_tolerance"] = raid.fault_tolerance(
                r["level"], len([m for m in item["members"] if m["state"] != "spare"]) or 1)
            out.append(item)
        return out

    @staticmethod
    def _array_status(a: dict):
        act = a["sync_action"]
        prog = a.get("sync_progress")
        pct = f" ({prog:.1f}%)" if prog is not None else ""
        if a["array_state"] in ("inactive", "clear") or (
                a["level"] == "raid0" and any(m["state"] == "faulty" for m in a["members"])):
            return "failed", "Array is not running - too many disks missing"
        if act == "recover":
            return "rebuilding", "Rebuilding onto replacement disk" + pct
        if act == "reshape":
            return "reshaping", "Expanding array" + pct
        if a["degraded"]:
            return "degraded", f"{a['degraded']} disk(s) missing or failed - replace them"
        if act == "resync":
            return "syncing", "Initial synchronisation" + pct
        if act in ("check", "repair"):
            return "checking", "Data scrub in progress" + pct
        return "healthy", ""

    def _check_disks(self, names: List[str]) -> Dict[str, dict]:
        current = {d["name"]: d for d in self.disks()}
        for n in names:
            if n not in current:
                raise UserError(f"Disk {n} not found")
            if not current[n]["selectable"]:
                raise UserError(f"Disk {n} is in use ({current[n]['status_detail']})")
        return current

    def create_array(self, name: str, level: str, disks: List[str], spares: List[str],
                     user: str):
        require(VOLUME_NAME_RE, name, "RAID name (lowercase letters, digits, - and _)")
        if name in self.state.get("arrays"):
            raise UserError(f"A RAID array named {name} already exists")
        if level == "single" or level not in raid.LEVELS:
            raise UserError("Choose a RAID level")
        disks, spares = unique(disks), unique(spares)
        if set(disks) & set(spares):
            raise UserError("A disk cannot be both a data disk and a spare")
        err = raid.validate(level, len(disks), len(spares))
        if err:
            raise UserError(err)
        self._check_disks(disks + spares)
        label = raid.LEVELS[level].label

        def work(log):
            for n in disks + spares:
                log(f"-- preparing disk {n}")
                self.p.wipe_disk(n, log)
            parts = [self.p.make_partition(n, True, log) for n in disks]
            sparts = [self.p.make_partition(n, True, log) for n in spares]
            log(f"-- creating {label} array")
            md = self.p.md_create(name, level, parts, sparts, log)
            record = {"name": name, "level": level, "md_uuid": md["uuid"], "created": time.time(),
                      "synced": level == "raid0"}       # False until the first build has finished
            self.state.update(lambda d: d["arrays"].__setitem__(name, record))
            self.p.save_mdadm_conf(log)
            log("RAID array created. Create a volume on it to store data.")

        return self.jobs.submit(f"Create RAID {name} ({label}, {len(disks)} disks)", user, work)

    def _array(self, name: str):
        r = self.state.get("arrays").get(name)
        if not r:
            raise UserError(f"RAID array {name} not found")
        a = self._live(r, self.p.md_arrays())
        if not a:
            raise UserError("RAID array is not assembled")
        return r, a

    def delete_array(self, name: str, user: str):
        r = self.state.get("arrays").get(name)
        if not r:
            raise UserError(f"RAID array {name} not found")
        used = next((v["name"] for v in self.state.get("volumes").values()
                     if v.get("array") == name), None)
        if used:
            raise UserError(f"Delete volume {used} first")

        def work(log):
            a = self._live(r, self.p.md_arrays())
            if a:
                self.p.md_destroy(a["dev"], [m["part"] for m in a["members"]], log)
                for disk in unique([m["disk"] for m in a["members"]]):
                    self.p.wipe_disk(disk, log)
            self.state.update(lambda d: d["arrays"].pop(name, None))
            self.p.save_mdadm_conf(log)

        return self.jobs.submit(f"Delete RAID {name}", user, work)

    def add_disk(self, name: str, disk: str, mode: str, user: str):
        r, a = self._array(name)
        d = self._disk(disk)
        if not d["selectable"]:
            raise UserError(f"Disk {disk} is in use ({d['status_detail']})")
        smallest = min((self.p.block_size(m["part"]) for m in a["members"]), default=0)
        if d["size"] < smallest:
            raise UserError(f"Disk {disk} is smaller than the existing members")
        level = r["level"]
        if mode == "spare":
            if level == "raid0":
                raise UserError("RAID 0 cannot use hot spares")
            title = f"Add hot spare {disk} to {name}"
        elif mode == "grow":
            if level not in GROWABLE:
                raise UserError(f"{raid.LEVELS[level].label} cannot be expanded with "
                                "more disks; add it as a hot spare instead")
            if a["degraded"] or a["sync_action"] != "idle":
                raise UserError("Wait until the array is healthy and idle before expanding")
            title = f"Expand {name} with disk {disk}"
        elif mode == "replace":
            if not a["degraded"]:
                raise UserError("The array is not degraded")
            title = f"Replace failed disk in {name} with {disk}"
        else:
            raise UserError("Invalid mode")

        def work(log):
            if mode == "replace":
                self.p.md_remove_failed(a["dev"], log)
            self.p.wipe_disk(disk, log)
            part = self.p.make_partition(disk, True, log)
            self.p.md_add(a["dev"], part, log)
            if mode == "grow":
                self.p.md_grow(a["dev"], a["raid_disks"] + 1, log)
                log("Array reshape started. When it finishes, use 'Expand filesystem' on "
                    "the volume to make the new space available." if level != "raid1" else
                    "Disk added as an additional mirror.")
            self.p.save_mdadm_conf(log)

        return self.jobs.submit(title, user, work)

    def remove_member(self, name: str, part: str, user: str):
        r, a = self._array(name)
        member = next((m for m in a["members"] if m["part"] == part), None)
        if not member:
            raise UserError("Not a member of this array")
        if member["state"] not in ("spare", "faulty"):
            active = [m for m in a["members"] if m["state"] == "active"]
            tolerance = raid.fault_tolerance(r["level"], a["raid_disks"])
            if a["degraded"] + 1 > tolerance or len(active) <= 1:
                raise UserError("Removing this disk would destroy the array")

        def work(log):
            self.p.md_fail_remove(a["dev"], part, log)
            self.p.wipe_disk(member["disk"], log)
            self.p.save_mdadm_conf(log)

        return self.jobs.submit(f"Remove disk {member['disk']} from {name}", user, work)

    def scrub(self, name: str, action: str, user: str) -> None:
        _, a = self._array(name)
        if action == "check" and a["sync_action"] != "idle":
            raise UserError("Array is busy")
        self.p.md_sync_action(a["dev"], action)
        self.state.log_activity(user, f"{'Started' if action == 'check' else 'Stopped'} "
                                      f"data scrub on RAID {name}")

    # ---------------------------------------------------------------- volumes
    def volumes(self) -> List[dict]:
        vols = self.state.get("volumes")
        shares = self.state.get("shares")
        arrays = {a["name"]: a for a in self.raid_arrays()}
        disks = {d["name"]: d for d in self.p.scan_disks()}
        out = []
        for v in sorted(vols.values(), key=lambda x: x["name"]):
            info = self.p.fs_info(v.get("uuid")) if v.get("uuid") else None
            arr = arrays.get(v.get("array")) if v.get("array") else None
            item = {
                "name": v["name"], "fs": v["fs"], "mountpoint": v["mountpoint"],
                "created": v.get("created"), "mounted": bool(info and info.get("mounted")),
                "size": (info or {}).get("size", 0), "used": (info or {}).get("used", 0),
                "free": (info or {}).get("free", 0),
                "array": v.get("array"), "disk": None,
                "level": arr["level"] if arr else "single",
                "members": arr["members"] if arr else [], "sync": arr["sync"] if arr else None,
                "fault_tolerance": arr["fault_tolerance"] if arr else 0,
                "shares": sorted(n for n, s in shares.items() if s["volume"] == v["name"]),
                "can_expand_fs": False, "status": "healthy", "status_detail": "",
            }
            if v.get("array"):
                if not arr:
                    item["status"], item["status_detail"] = "missing", f"RAID {v['array']} not found"
                else:
                    item["status"], item["status_detail"] = arr["status"], arr["status_detail"]
                    sync = arr["sync"] or {}
                    if info and info.get("mounted") and sync.get("sync_action") != "reshape" \
                            and arr["size"] > (v.get("fs_dev_size") or arr["size"]):
                        item["can_expand_fs"] = True
            else:
                dev = (info or {}).get("dev")
                disk = next((n for n, d in disks.items()
                             if dev and any(p["name"] == dev for p in d["partitions"])), None)
                item["disk"] = disk
                if disk:
                    item["members"] = [{"disk": disk, "part": dev, "state": "active",
                                        "model": disks[disk]["model"],
                                        "size": disks[disk]["size"], "kind": disks[disk]["kind"]}]
                if not info:
                    item["status"], item["status_detail"] = "missing", "Disk not found"
            if item["status"] == "healthy" and not item["mounted"]:
                item["status"], item["status_detail"] = "unmounted", "Filesystem is not mounted"
            out.append(item)
        return out

    def volume_sources(self) -> dict:
        """RAID arrays without a volume, and unused disks, a volume can be created on."""
        return {
            "arrays": [{k: a[k] for k in ("name", "level", "size", "status")}
                       for a in self.raid_arrays()
                       if not a["volume"] and a["status"] not in ("missing", "failed")],
            "disks": [{k: d[k] for k in ("name", "model", "size", "kind", "status")}
                      for d in self.disks() if d["selectable"]],
        }

    def _vol(self, name: str) -> dict:
        v = self.state.get("volumes").get(name)
        if not v:
            raise UserError(f"Volume {name} not found")
        return v

    def create_volume(self, name: str, fs: str, array: Optional[str], disk: Optional[str],
                      user: str):
        require(VOLUME_NAME_RE, name, "volume name (lowercase letters, digits, - and _)")
        if name in self.state.get("volumes"):
            raise UserError(f"A volume named {name} already exists")
        if fs not in ("ext4", "xfs"):
            raise UserError("Filesystem must be ext4 or xfs")
        if bool(array) == bool(disk):
            raise UserError("Choose a RAID array or a disk for the volume")
        if array:
            src = next((a for a in self.volume_sources()["arrays"] if a["name"] == array), None)
            if not src:
                raise UserError(f"RAID {array} is not available for a new volume")
            size = src["size"]
        else:
            size = self._check_disks([disk])[disk]["size"]
        if fs == "xfs" and size < 320 * 10**6:
            raise UserError("XFS needs a volume of at least 300 MB; use ext4")
        mountpoint = os.path.join(self.cfg.mount_root, name)
        if os.path.ismount(mountpoint):
            raise UserError(f"{mountpoint} is already a mount point")

        def work(log):
            record = {"name": name, "fs": fs, "mountpoint": mountpoint, "created": time.time(),
                      "uuid": None, "array": array}
            if array:
                _, a = self._array(array)
                dev = a["dev"]
            else:
                log(f"-- preparing disk {disk}")
                self.p.wipe_disk(disk, log)
                dev = self.p.make_partition(disk, False, log)
            log(f"-- creating {fs} filesystem on {dev}")
            record["uuid"] = self.p.mkfs(dev, fs, name, log)
            record["fs_dev_size"] = self.p.block_size(dev)
            self.state.update(lambda d: d["volumes"].__setitem__(name, dict(record)))
            log(f"-- mounting at {mountpoint}")
            self.p.mount_persist(record["uuid"], fs, mountpoint, log)

        where = f"RAID {array}" if array else f"disk {disk}"
        return self.jobs.submit(f"Create volume {name} on {where}", user, work)

    def delete_volume(self, name: str, user: str):
        v = self._vol(name)
        used_by = [n for n, s in self.state.get("shares").items() if s["volume"] == name]
        if used_by:
            raise UserError("Delete these shares first: " + ", ".join(sorted(used_by)))

        def work(log):
            info = self.p.fs_info(v.get("uuid")) if v.get("uuid") else None
            self.p.unmount_remove(v.get("uuid"), v["mountpoint"], log)
            if v.get("array"):
                r = self.state.get("arrays").get(v["array"])
                a = self._live(r, self.p.md_arrays()) if r else None
                if a:
                    self.p.wipe_signatures(a["dev"], log)
            else:
                dev = (info or {}).get("dev")
                for d in self.p.scan_disks():
                    if dev and any(p["name"] == dev for p in d["partitions"]):
                        self.p.wipe_disk(d["name"], log)
            self.state.update(lambda d: d["volumes"].pop(name, None))

        return self.jobs.submit(f"Delete volume {name}", user, work)

    def expand_fs(self, name: str, user: str):
        v = self._vol(name)
        if not v.get("array"):
            raise UserError("Only volumes on a RAID array can be expanded")
        _, a = self._array(v["array"])

        def work(log):
            self.p.fs_grow(a["dev"], v["fs"], v["mountpoint"], log)
            size = self.p.block_size(a["dev"])
            self.state.update(lambda d: d["volumes"][name].__setitem__("fs_dev_size", size))

        return self.jobs.submit(f"Expand filesystem on {name}", user, work)

    # ---------------------------------------------------------------- shares
    def shares(self) -> List[dict]:
        vols = self.state.get("volumes")
        out = []
        for s in sorted(self.state.get("shares").values(), key=lambda x: x["name"].lower()):
            path = sharecfg.share_path(s, vols) if s["volume"] in vols else None
            out.append({**s, "path": path})
        return out

    def _validate_share(self, s: dict, existing: Optional[dict]) -> dict:
        name = require(SHARE_NAME_RE, s.get("name", ""), "share name")
        if name.lower() in RESERVED_SHARES:
            raise UserError(f"{name} is a reserved name")
        vols = self.state.get("volumes")
        volume = s.get("volume")
        if volume not in vols:
            raise UserError("Select a volume")
        users = {u["name"] for u in self.users()}
        groups = set(self.state.get("groups"))
        acc_ok = {"ro", "rw"}
        perm_u = {u: a for u, a in (s.get("users") or {}).items() if a in acc_ok}
        perm_g = {g: a for g, a in (s.get("groups") or {}).items() if a in acc_ok}
        for u in perm_u:
            if u not in users:
                raise UserError(f"Unknown user {u}")
        for g in perm_g:
            if g not in groups and g != self.cfg.users_group:
                raise UserError(f"Unknown group {g}")
        smb = s.get("smb") or {}
        nfs = s.get("nfs") or {}
        clients = []
        for c in nfs.get("clients") or []:
            host = str(c.get("host", "")).strip()
            require(NFS_CLIENT_RE, host, "NFS client (IP, network/CIDR, hostname or *)")
            clients.append({"host": host, "access": "rw" if c.get("access") == "rw" else "ro"})
        if nfs.get("enabled") and not clients:
            raise UserError("Add at least one NFS client (e.g. 192.168.1.0/24)")
        squash = nfs.get("squash", "all")
        if squash not in ("all", "root", "none"):
            raise UserError("Invalid NFS squash mode")
        description = str(s.get("description") or "")[:200].replace("\n", " ")
        if re.search(r"[\[\]=%]", description):
            raise UserError("Description may not contain [ ] = or %")
        folder = existing["folder"] if existing else name
        if existing and existing["volume"] != volume:
            raise UserError("The volume of an existing share cannot be changed")
        return {
            "name": name, "volume": volume, "folder": folder, "description": description,
            "guest": "ro" if s.get("guest") == "ro" else "none",
            "users": perm_u, "groups": perm_g,
            "smb": {"enabled": bool(smb.get("enabled", True)),
                    "browseable": bool(smb.get("browseable", True)),
                    # on unless asked otherwise; never for Time Machine (it would keep
                    # every old backup Time Machine removes)
                    "recycle_bin": bool(smb.get("recycle_bin", True)) and not smb.get("time_machine"),
                    "time_machine": bool(smb.get("time_machine", False))},
            "nfs": {"enabled": bool(nfs.get("enabled", False)), "clients": clients,
                    "squash": squash, "insecure": bool(nfs.get("insecure", False))},
            "created": existing.get("created") if existing else time.time(),
        }

    def save_share(self, data: dict, user: str, original: Optional[str] = None) -> dict:
        shares = self.state.get("shares")
        existing = shares.get(original) if original else None
        if original and not existing:
            raise UserError(f"Share {original} not found")
        s = self._validate_share(data, existing)
        if s["name"] != original and s["name"].lower() in {n.lower() for n in shares}:
            raise UserError(f"A share named {s['name']} already exists")
        vols = self.state.get("volumes")
        path = sharecfg.share_path(s, vols)
        if not existing:
            self.p.prepare_share_dir(path, self.cfg.users_group, lambda _m: None)

        def upd(d):
            if original and original != s["name"]:
                d["shares"].pop(original, None)
            d["shares"][s["name"]] = s
        self.state.update(upd)
        self.apply_shares()
        self.state.log_activity(user, f"{'Updated' if existing else 'Created'} share {s['name']}")
        return s

    def delete_share(self, name: str, user: str) -> None:
        if name not in self.state.get("shares"):
            raise UserError(f"Share {name} not found")
        self.state.update(lambda d: d["shares"].pop(name, None))
        self.apply_shares()
        self.state.log_activity(user, f"Deleted share {name} (data kept on disk)")

    def apply_shares(self) -> None:
        st = self.state.read()
        vols = {n: v for n, v in st["volumes"].items()}
        self.p.apply_smb(sharecfg.smb_conf(st["settings"], st["shares"], vols), lambda _m: None)
        try:
            gid = self.p.group_gid(self.cfg.users_group)
        except KeyError:
            gid = 100
        self.p.apply_nfs(sharecfg.nfs_exports(st["shares"], vols, gid), lambda _m: None)
        self.p.apply_avahi(self._avahi(st["shares"]), lambda _m: None)

    @staticmethod
    def _avahi(shares: Dict[str, dict]) -> str:
        tm = [n for n, s in sorted(shares.items())
              if s["smb"]["enabled"] and s["smb"].get("time_machine")]
        x = ['<?xml version="1.0" standalone="no"?>',
             '<!DOCTYPE service-group SYSTEM "avahi-service.dtd">',
             "<!-- Generated by Talon -->",
             "<service-group>",
             '  <name replace-wildcards="yes">%h</name>',
             "  <service><type>_smb._tcp</type><port>445</port></service>",
             "  <service><type>_device-info._tcp</type><port>9</port>"
             "<txt-record>model=RackMac</txt-record></service>"]
        if tm:
            recs = "".join(f"<txt-record>dk{i}=adVN={n},adVF=0x82</txt-record>"
                           for i, n in enumerate(tm))
            x.append("  <service><type>_adisk._tcp</type><port>9</port>"
                     f"<txt-record>sys=waMa=0,adVF=0x100</txt-record>{recs}</service>")
        x.append("</service-group>")
        return "\n".join(x) + "\n"

    # ---------------------------------------------------------------- users
    def users(self) -> List[dict]:
        return self.p.list_users(self.cfg.users_group, self.cfg.admin_group,
                                 self.state.get("groups"))

    def _check_password(self, pw: str) -> None:
        if not isinstance(pw, str) or len(pw) < 8:
            raise UserError("Password must be at least 8 characters")
        if len(pw) > 128 or any(c in pw for c in "\n\r\0"):
            raise UserError("Password contains invalid characters")

    def create_user(self, data: dict, actor: str) -> None:
        name = require(USER_NAME_RE, data.get("name", ""),
                       "user name (lowercase letters, digits, - and _)")
        if self.p.user_exists(name):
            raise UserError(f"User {name} already exists")
        if self.p.group_exists(name):
            raise UserError(f"{name} is already used as a group name")
        self._check_password(data.get("password"))
        full = str(data.get("full_name") or "")[:64].replace(":", " ").replace(",", " ")
        groups = [g for g in data.get("groups") or [] if g in self.state.get("groups")]
        if data.get("admin"):
            groups.append(self.cfg.admin_group)
        self.p.create_user(name, full, data["password"], self.cfg.users_group, groups)
        self.state.log_activity(actor, f"Created user {name}" + (" (administrator)" if data.get("admin") else ""))

    def _user(self, name: str) -> dict:
        for u in self.users():
            if u["name"] == name:
                return u
        raise UserError(f"User {name} not found")

    def update_user(self, name: str, data: dict, actor: str) -> None:
        u = self._user(name)
        if "full_name" in data:
            self.p.set_full_name(name, str(data["full_name"] or "")[:64].replace(":", " ")
                                 .replace(",", " "))
        if "admin" in data and bool(data["admin"]) != u["admin"]:
            if not data["admin"]:
                if name == actor:
                    raise UserError("You cannot remove your own administrator rights")
                if not u["disabled"] and self.entra_users.web_access_count() <= 1:
                    raise UserError("At least one user must be able to sign in to the web interface")
            self.p.set_group_membership(name, self.cfg.admin_group, bool(data["admin"]))
        if "groups" in data:
            managed = self.state.get("groups")
            want = {g for g in data["groups"] if g in managed}
            for g in managed:
                if (g in want) != (g in u["groups"]):
                    self.p.set_group_membership(name, g, g in want)
        if "disabled" in data and bool(data["disabled"]) != u["disabled"]:
            if name == actor:
                raise UserError("You cannot disable your own account")
            if data["disabled"] and u["admin"] and self.entra_users.web_access_count() <= 1:
                raise UserError("At least one user must be able to sign in to the web interface")
            self.p.set_disabled(name, bool(data["disabled"]))
        if data.get("password"):
            self._check_password(data["password"])
            self.p.set_password(name, data["password"])
        self.state.log_activity(actor, f"Updated user {name}")

    def delete_user(self, name: str, actor: str) -> None:
        u = self._user(name)
        if name == actor:
            raise UserError("You cannot delete your own account")
        if u["uid"] < 1000:
            raise UserError("System accounts cannot be deleted here")
        if u["admin"] and not u["disabled"] and self.entra_users.web_access_count() <= 1:
            raise UserError("At least one user must be able to sign in to the web interface")
        self.p.delete_user(name)

        def upd(d):
            for s in d["shares"].values():
                s["users"].pop(name, None)
        self.state.update(upd)
        self.apply_shares()
        self.state.log_activity(actor, f"Deleted user {name}")

    def groups(self) -> List[dict]:
        out = []
        info = self.state.get("group_info") or {}
        for g in sorted(self.state.get("groups")):
            out.append({"name": g, "members": self.p.group_members(g),
                        "description": (info.get(g) or {}).get("description", "")})
        return out

    def set_group_description(self, name: str, description: str) -> None:
        description = (description or "").strip()[:200]
        self.state.update(lambda d: d.setdefault("group_info", {}).setdefault(name, {}).__setitem__("description", description))

    def create_group(self, name: str, members: List[str], actor: str, description: str = "") -> None:
        require(USER_NAME_RE, name, "group name")
        if name in self.state.get("groups"):
            raise UserError(f"Group {name} already exists")
        if name in (self.cfg.admin_group, self.cfg.users_group):
            raise UserError(f"{name} is used by Talon itself. Choose another name.")
        if self.p.group_exists(name):
            raise UserError(f"{name} is already a group of the operating system, so Talon cannot use the name. "
                            "Choose another name, for example staff or team.")
        self.p.create_group(name)
        self.state.update(lambda d: d["groups"].append(name))
        self.set_group_description(name, description)
        self.set_group_members(name, members, actor, log=False)
        self.state.log_activity(actor, f"Created group {name}")

    def set_group_members(self, name: str, members: List[str], actor: str, log: bool = True) -> None:
        if name not in self.state.get("groups"):
            raise UserError(f"Group {name} not found")
        valid = {u["name"] for u in self.users()}
        bad = [m for m in members if m not in valid]
        if bad:
            raise UserError("Unknown user(s): " + ", ".join(bad))
        self.p.set_group_members(name, unique(members))
        if log:
            self.state.log_activity(actor, f"Updated members of group {name}")

    def delete_group(self, name: str, actor: str) -> None:
        if name not in self.state.get("groups"):
            raise UserError(f"Group {name} not found")
        self.p.delete_group(name)

        def upd(d):
            d["groups"].remove(name)
            (d.get("group_info") or {}).pop(name, None)
            for s in d["shares"].values():
                s["groups"].pop(name, None)
        self.state.update(upd)
        self.apply_shares()
        self.state.log_activity(actor, f"Deleted group {name}")

    # ---------------------------------------------------------------- system
    def settings(self) -> dict:
        st = self.state.get("settings")
        info = self.p.system_info()
        return {**st, "hostname": info["hostname"], "timezone": self.p.timezone(),
                "smb_protocols": SMB_PROTOCOLS}

    def update_settings(self, data: dict, actor: str) -> None:
        changes = []
        if "hostname" in data and data["hostname"] != self.p.system_info()["hostname"]:
            require(HOSTNAME_RE, data["hostname"], "hostname")
            self.p.set_hostname(data["hostname"])
            changes.append("hostname")
        if "timezone" in data and data["timezone"] != self.p.timezone():
            self.p.set_timezone(data["timezone"])
            changes.append("time zone")
        smb_keys = {}
        if "workgroup" in data:
            smb_keys["workgroup"] = require(WORKGROUP_RE, data["workgroup"], "workgroup").upper()
        if "server_string" in data:
            ss = str(data["server_string"])[:64]
            if re.search(r"[\[\]=%\n]", ss):
                raise UserError("Server description may not contain [ ] = %")
            smb_keys["server_string"] = ss
        if "smb_min_protocol" in data:
            if data["smb_min_protocol"] not in SMB_PROTOCOLS:
                raise UserError("Invalid SMB protocol")
            smb_keys["smb_min_protocol"] = data["smb_min_protocol"]
        if "smb_macos_compat" in data:
            smb_keys["smb_macos_compat"] = bool(data["smb_macos_compat"])
        if smb_keys:
            self.state.update(lambda d: d["settings"].update(smb_keys))
            self.apply_shares()
            changes.append("file sharing settings")
        if changes:
            self.state.log_activity(actor, "Updated " + ", ".join(changes))

    def alerts(self, volumes: Optional[List[dict]] = None,
               disks: Optional[List[dict]] = None) -> List[dict]:
        volumes = volumes if volumes is not None else self.volumes()
        disks = disks if disks is not None else self.disks()
        limits = self.thresholds()
        out = []
        for a in self.raid_arrays():
            if a["status"] in ("degraded", "failed", "missing"):
                out.append({"level": "critical" if a["status"] in ("failed", "missing")
                            else "warning", "title": f"RAID {a['name']} is {a['status']}",
                            "detail": a["status_detail"], "link": "/raid"})
        for v in volumes:
            if v["status"] == "unmounted" or (v["status"] == "missing" and not v["array"]):
                out.append({"level": "critical" if v["status"] == "missing" else "warning",
                            "title": f"Volume {v['name']} is {v['status']}",
                            "detail": v["status_detail"], "link": "/volumes"})
            if v["size"] and v["used"] / v["size"] * 100 >= limits["volume_full"]:
                out.append({"level": "warning", "title": f"Volume {v['name']} is almost full",
                            "detail": f"{v['used'] / v['size'] * 100:.0f}% used",
                            "link": "/volumes"})
        for d in disks:
            if d["health"] == "failing":
                out.append({"level": "critical", "title": f"Disk {d['name']} is failing",
                            "detail": f"{d['model']} - SMART health check failed. Replace it.",
                            "link": "/disks"})
            elif d["health"] == "warning":
                out.append({"level": "warning", "title": f"Disk {d['name']} shows wear",
                            "detail": f"{d['model']} - check SMART details", "link": "/disks"})
            if d.get("temperature") and d["temperature"] >= limits[f"temp_{self._temp_kind(d)}"]:
                out.append({"level": "warning", "title": f"Disk {d['name']} is hot",
                            "detail": f"{d['temperature']} °C", "link": "/disks"})
        exp = self.cloud.secret_expiry()
        if exp and exp["remind"]:
            out.append({"level": "critical" if exp["days"] < 0 else "warning",
                        "title": "EntraID client secret " + (
                            "has expired" if exp["days"] < 0 else f"expires in {exp['days']} days"
                            if exp["days"] != 1 else "expires tomorrow"),
                        "detail": "Create a new secret in Entra and save it in Settings > EntraID",
                        "link": "/settings?tab=entra"})
        os_up = self.osupdate.info()
        if os_up["progress"].get("state") != "running":
            if os_up["security"]:
                out.append({"level": "warning",
                            "title": f"{os_up['security']} security update{'s' if os_up['security'] > 1 else ''} for the operating system",
                            "detail": "Install them in Settings > Update > Operating system",
                            "link": "/settings?tab=update&os=1"})
            if os_up["restart_needed"]:
                out.append({"level": "warning", "title": "Restart to finish the updates",
                            "detail": "Some updates are only used after a restart",
                            "link": "/settings?tab=update&os=1"})
        return out

    def dashboard(self) -> dict:
        volumes = self.volumes()
        disks = self.disks()
        return {
            "info": self.p.system_info(),
            "history": list(self.history),
            "volumes": volumes,
            "disks": [{k: d[k] for k in ("name", "model", "size", "kind", "status", "health",
                                         "temperature", "volume", "array")} for d in disks],
            "services": self.p.services() + [self.cloud.service_info()],
            "alerts": self.alerts(volumes, disks),
            "shares": len(self.state.get("shares")),
            "share_list": [{"name": sh["name"], "volume": sh["volume"],
                            "smb": sh["smb"]["enabled"], "nfs": sh["nfs"]["enabled"],
                            "time_machine": sh["smb"]["enabled"] and sh["smb"]["time_machine"]}
                           for sh in self.shares()],
            "arrays": self.raid_arrays(),
            "onedrive": self.cloud.summary(),
            "users": len(self.users()),
            "jobs": [j for j in self.jobs.list() if j["status"] in ("queued", "running")],
        }
