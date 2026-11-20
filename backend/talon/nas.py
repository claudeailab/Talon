"""Business logic shared by the real and demo platforms."""
from __future__ import annotations

import collections
import os
import re
import threading
import time
from typing import Dict, List, Optional

from . import raid, sharecfg
from .jobs import JobRunner
from .state import State
from .util import (NFS_CLIENT_RE, RESERVED_SHARES, SHARE_NAME_RE, USER_NAME_RE,
                   VOLUME_NAME_RE, UserError, require, unique)

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
        if getattr(platform, "demo", False) and os.path.exists(cfg.state_file):
            os.unlink(cfg.state_file)   # the simulated host is rebuilt on every start
        self.state = State(cfg.state_file)
        if getattr(platform, "demo", False):
            platform.seed_state(self.state)
        self.jobs = JobRunner(on_done=self._job_done)
        self.history: collections.deque = collections.deque(maxlen=90)
        self._last_sample: Optional[dict] = None
        self._stop = threading.Event()

    # ---------------------------------------------------------------- lifecycle
    def start(self) -> None:
        threading.Thread(target=self._sampler, daemon=True, name="sampler").start()
        threading.Thread(target=self._smart_refresher, daemon=True, name="smart").start()

    def stop(self) -> None:
        self._stop.set()

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
            except Exception:
                pass
            self._stop.wait(2.0)

    def _smart_refresher(self) -> None:
        while not self._stop.is_set():
            try:
                for d in self.p.scan_disks():
                    self.p.smart(d["name"])
            except Exception:
                pass
            self._stop.wait(300)

    def _job_done(self, job) -> None:
        level = "info" if job.status == "success" else "error"
        msg = job.title + (" completed" if job.status == "success" else f" failed: {job.error}")
        self.state.log_activity(job.user, msg, level)

    # ---------------------------------------------------------------- disks
    def disks(self) -> List[dict]:
        vols = self.state.get("volumes")
        arrays = {a["dev"]: a for a in self.p.md_arrays()}
        md_to_vol = {}
        for v in vols.values():
            for a in arrays.values():
                if v.get("md_uuid") and a.get("uuid") == v["md_uuid"]:
                    md_to_vol[a["dev"]] = v["name"]
        mp_to_vol = {v["mountpoint"]: v["name"] for v in vols.values()}
        out = []
        for d in self.p.scan_disks():
            status, detail, volume = "available", "", None
            if any(m in md_to_vol for m in d["md"]):
                volume = next(md_to_vol[m] for m in d["md"] if m in md_to_vol)
                status, detail = "volume", f"Member of volume {volume}"
            elif d["md"]:
                status, detail = "raid_member", "Member of RAID " + ", ".join(d["md"])
            elif any(m in SYSTEM_MOUNTS for m in d["mounts"]):
                status, detail = "system", "Operating system disk"
            elif any(m in mp_to_vol for m in d["mounts"]):
                volume = next(mp_to_vol[m] for m in d["mounts"] if m in mp_to_vol)
                status, detail = "volume", f"Volume {volume}"
            elif d["mounts"]:
                status, detail = "mounted", "Mounted at " + ", ".join(d["mounts"])
            elif d["has_signature"]:
                fs = ", ".join(d["fstypes"]) or "partitions"
                status, detail = "has_data", f"Contains existing data ({fs}) - will be erased"
            smart = self.p.smart_cached(d["name"])
            out.append({**d, "status": status, "status_detail": detail, "volume": volume,
                        "selectable": status in ("available", "has_data"),
                        "health": self._health(smart),
                        "temperature": smart.get("temperature"),
                        "power_on_hours": smart.get("power_on_hours")})
        return out

    @staticmethod
    def _health(smart: dict) -> str:
        if not smart or smart.get("passed") is None:
            return "unknown"
        if smart.get("passed") is False:
            return "failing"
        if smart.get("bad_sectors"):
            return "warning"
        if (smart.get("percentage_used") or 0) >= 90:
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
        return self.jobs.submit(f"Wipe disk {name}", user, lambda log: self.p.wipe_disk(name, log))

    # ---------------------------------------------------------------- volumes
    def raid_options(self, disks: List[str], spares: int) -> List[dict]:
        all_disks = {d["name"]: d for d in self.disks()}
        sizes = [all_disks[n]["size"] for n in disks if n in all_disks]
        return raid.options_for(sizes, spares)

    def _array_for(self, vol: dict, arrays: List[dict]) -> Optional[dict]:
        for a in arrays:
            if vol.get("md_uuid") and a.get("uuid") == vol["md_uuid"]:
                return a
        return None

    def volumes(self) -> List[dict]:
        vols = self.state.get("volumes")
        shares = self.state.get("shares")
        arrays = self.p.md_arrays()
        disks = {d["name"]: d for d in self.p.scan_disks()}
        out = []
        for v in sorted(vols.values(), key=lambda x: x["name"]):
            info = self.p.fs_info(v.get("uuid")) if v.get("uuid") else None
            item = {
                "name": v["name"], "level": v["level"], "fs": v["fs"],
                "mountpoint": v["mountpoint"], "created": v.get("created"),
                "mounted": bool(info and info.get("mounted")),
                "size": (info or {}).get("size", 0), "used": (info or {}).get("used", 0),
                "free": (info or {}).get("free", 0), "members": [], "array": None,
                "shares": sorted(n for n, s in shares.items() if s["volume"] == v["name"]),
                "can_expand_fs": False, "status": "healthy", "status_detail": "",
            }
            if v["level"] == "single":
                dev = (info or {}).get("dev")
                disk = next((n for n, d in disks.items()
                             if dev and any(p["name"] == dev for p in d["partitions"])), None)
                if disk:
                    item["members"] = [{"disk": disk, "part": dev, "state": "active",
                                        "model": disks[disk]["model"],
                                        "size": disks[disk]["size"], "kind": disks[disk]["kind"]}]
                if not info:
                    item["status"], item["status_detail"] = "missing", "Disk not found"
            else:
                a = self._array_for(v, arrays)
                if not a:
                    item["status"], item["status_detail"] = "missing", "RAID array not assembled"
                else:
                    item["array"] = {k: a[k] for k in ("dev", "raid_disks", "size", "degraded",
                                                       "sync_action", "sync_progress",
                                                       "sync_speed_kbs", "array_state")}
                    for m in a["members"]:
                        d = disks.get(m["disk"], {})
                        item["members"].append({**m, "model": d.get("model", "?"),
                                                "size": d.get("size", 0),
                                                "kind": d.get("kind", "hdd")})
                    item["status"], item["status_detail"] = self._array_status(a)
                    if info and info.get("mounted") and a["sync_action"] != "reshape" \
                            and a["size"] > (v.get("fs_dev_size") or a["size"]):
                        item["can_expand_fs"] = True
            if item["status"] == "healthy" and not item["mounted"]:
                item["status"], item["status_detail"] = "unmounted", "Filesystem is not mounted"
            item["fault_tolerance"] = raid.fault_tolerance(
                v["level"], len([m for m in item["members"] if m["state"] != "spare"]) or 1) \
                if v["level"] in raid.LEVELS else 0
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

    def _vol(self, name: str) -> dict:
        v = self.state.get("volumes").get(name)
        if not v:
            raise UserError(f"Volume {name} not found")
        return v

    def create_volume(self, name: str, level: str, disks: List[str], spares: List[str],
                      fs: str, user: str):
        require(VOLUME_NAME_RE, name, "volume name (lowercase letters, digits, - and _)")
        if name in self.state.get("volumes"):
            raise UserError(f"A volume named {name} already exists")
        if fs not in ("ext4", "xfs"):
            raise UserError("Filesystem must be ext4 or xfs")
        disks, spares = unique(disks), unique(spares)
        if set(disks) & set(spares):
            raise UserError("A disk cannot be both a data disk and a spare")
        err = raid.validate(level, len(disks), len(spares))
        if err:
            raise UserError(err)
        current = {d["name"]: d for d in self.disks()}
        for n in disks + spares:
            if n not in current:
                raise UserError(f"Disk {n} not found")
            if not current[n]["selectable"]:
                raise UserError(f"Disk {n} is in use ({current[n]['status_detail']})")
        usable = raid.usable_capacity(level, [current[n]["size"] for n in disks])
        if fs == "xfs" and usable < 320 * 10**6:
            raise UserError("XFS needs a volume of at least 300 MB; use ext4")
        mountpoint = os.path.join(self.cfg.mount_root, name)
        if os.path.ismount(mountpoint):
            raise UserError(f"{mountpoint} is already a mount point")
        label = raid.LEVELS[level].label

        def work(log):
            for n in disks + spares:
                log(f"-- preparing disk {n}")
                self.p.wipe_disk(n, log)
            parts = [self.p.make_partition(n, level != "single", log) for n in disks]
            sparts = [self.p.make_partition(n, True, log) for n in spares]
            record = {"name": name, "level": level, "fs": fs, "mountpoint": mountpoint,
                      "created": time.time(), "uuid": None, "md_uuid": None}
            if level == "single":
                dev = parts[0]
            else:
                log(f"-- creating {label} array")
                md = self.p.md_create(name, level, parts, sparts, log)
                dev = md["dev"]
                record["md_uuid"] = md["uuid"]
                self.state.update(lambda d: d["volumes"].__setitem__(name, dict(record)))
            log(f"-- creating {fs} filesystem on {dev}")
            record["uuid"] = self.p.mkfs(dev, fs, name, log)
            record["fs_dev_size"] = self.p.block_size(dev)
            self.state.update(lambda d: d["volumes"].__setitem__(name, dict(record)))
            log(f"-- mounting at {mountpoint}")
            self.p.mount_persist(record["uuid"], fs, mountpoint, log)
            if level != "single":
                self.p.save_mdadm_conf(log)

        return self.jobs.submit(f"Create volume {name} ({label}, {len(disks)} disk"
                                f"{'s' if len(disks) > 1 else ''})", user, work)

    def delete_volume(self, name: str, user: str):
        v = self._vol(name)
        used_by = [n for n, s in self.state.get("shares").items() if s["volume"] == name]
        if used_by:
            raise UserError("Delete these shares first: " + ", ".join(sorted(used_by)))

        def work(log):
            arrays = self.p.md_arrays()
            disks = self.p.scan_disks()
            info = self.p.fs_info(v.get("uuid")) if v.get("uuid") else None
            self.p.unmount_remove(v.get("uuid"), v["mountpoint"], log)
            members: List[str] = []
            if v["level"] == "single":
                dev = (info or {}).get("dev")
                members = [d["name"] for d in disks
                           if dev and any(p["name"] == dev for p in d["partitions"])]
            else:
                a = self._array_for(v, arrays)
                if a:
                    self.p.md_destroy(a["dev"], [m["part"] for m in a["members"]], log)
                    members = [m["disk"] for m in a["members"]]
            for disk in unique(members):
                self.p.wipe_disk(disk, log)
            self.state.update(lambda d: d["volumes"].pop(name, None))
            if v["level"] != "single":
                self.p.save_mdadm_conf(log)

        return self.jobs.submit(f"Delete volume {name}", user, work)

    def _live_array(self, name: str):
        v = self._vol(name)
        if v["level"] == "single":
            raise UserError("This operation needs a RAID volume")
        a = self._array_for(v, self.p.md_arrays())
        if not a:
            raise UserError("RAID array is not assembled")
        return v, a

    def add_disk(self, name: str, disk: str, mode: str, user: str):
        v, a = self._live_array(name)
        d = self._disk(disk)
        if not d["selectable"]:
            raise UserError(f"Disk {disk} is in use ({d['status_detail']})")
        smallest = min((self.p.block_size(m["part"]) for m in a["members"]), default=0)
        if d["size"] < smallest:
            raise UserError(f"Disk {disk} is smaller than the existing members")
        if mode == "spare":
            if v["level"] == "raid0":
                raise UserError("RAID 0 cannot use hot spares")
            title = f"Add hot spare {disk} to {name}"
        elif mode == "grow":
            if v["level"] not in GROWABLE:
                raise UserError(f"{raid.LEVELS[v['level']].label} cannot be expanded with "
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
                log("Array reshape started. When it finishes, use 'Expand filesystem' "
                    "to make the new space available." if v["level"] != "raid1" else
                    "Disk added as an additional mirror.")
            self.p.save_mdadm_conf(log)

        return self.jobs.submit(title, user, work)

    def remove_member(self, name: str, part: str, user: str):
        v, a = self._live_array(name)
        member = next((m for m in a["members"] if m["part"] == part), None)
        if not member:
            raise UserError("Not a member of this array")
        if member["state"] not in ("spare", "faulty"):
            active = [m for m in a["members"] if m["state"] == "active"]
            tolerance = raid.fault_tolerance(v["level"], a["raid_disks"])
            if a["degraded"] + 1 > tolerance or len(active) <= 1:
                raise UserError("Removing this disk would destroy the volume")

        def work(log):
            self.p.md_fail_remove(a["dev"], part, log)
            self.p.wipe_disk(member["disk"], log)
            self.p.save_mdadm_conf(log)

        return self.jobs.submit(f"Remove disk {member['disk']} from {name}", user, work)

    def scrub(self, name: str, action: str, user: str) -> None:
        _, a = self._live_array(name)
        if action == "check" and a["sync_action"] != "idle":
            raise UserError("Array is busy")
        self.p.md_sync_action(a["dev"], action)
        self.state.log_activity(user, f"{'Started' if action == 'check' else 'Stopped'} "
                                      f"data scrub on {name}")

    def expand_fs(self, name: str, user: str):
        v, a = self._live_array(name)

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
                    "recycle_bin": bool(smb.get("recycle_bin", False)),
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
                if len([x for x in self.users() if x["admin"]]) <= 1:
                    raise UserError("At least one administrator is required")
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
        if u["admin"] and len([x for x in self.users() if x["admin"]]) <= 1:
            raise UserError("At least one administrator is required")
        self.p.delete_user(name)

        def upd(d):
            for s in d["shares"].values():
                s["users"].pop(name, None)
        self.state.update(upd)
        self.apply_shares()
        self.state.log_activity(actor, f"Deleted user {name}")

    def groups(self) -> List[dict]:
        out = []
        for g in sorted(self.state.get("groups")):
            out.append({"name": g, "members": self.p.group_members(g)})
        return out

    def create_group(self, name: str, members: List[str], actor: str) -> None:
        require(USER_NAME_RE, name, "group name")
        if self.p.group_exists(name) or name in (self.cfg.admin_group, self.cfg.users_group):
            raise UserError(f"Group {name} already exists")
        self.p.create_group(name)
        self.state.update(lambda d: d["groups"].append(name))
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
        out = []
        for v in volumes:
            if v["status"] in ("degraded", "failed", "missing", "unmounted"):
                out.append({"level": "critical" if v["status"] in ("failed", "missing")
                            else "warning", "title": f"Volume {v['name']} is {v['status']}",
                            "detail": v["status_detail"], "link": "/storage"})
            if v["size"] and v["used"] / v["size"] > 0.9:
                out.append({"level": "warning", "title": f"Volume {v['name']} is almost full",
                            "detail": f"{v['used'] / v['size'] * 100:.0f}% used",
                            "link": "/storage"})
        for d in disks:
            if d["health"] == "failing":
                out.append({"level": "critical", "title": f"Disk {d['name']} is failing",
                            "detail": f"{d['model']} - SMART health check failed. Replace it.",
                            "link": "/disks"})
            elif d["health"] == "warning":
                out.append({"level": "warning", "title": f"Disk {d['name']} shows wear",
                            "detail": f"{d['model']} - check SMART details", "link": "/disks"})
            if d.get("temperature") and d["temperature"] >= 55:
                out.append({"level": "warning", "title": f"Disk {d['name']} is hot",
                            "detail": f"{d['temperature']} °C", "link": "/disks"})
        return out

    def dashboard(self) -> dict:
        volumes = self.volumes()
        disks = self.disks()
        return {
            "info": self.p.system_info(),
            "history": list(self.history),
            "volumes": volumes,
            "disks": [{k: d[k] for k in ("name", "model", "size", "kind", "status", "health",
                                         "temperature", "volume")} for d in disks],
            "services": self.p.services(),
            "alerts": self.alerts(volumes, disks),
            "shares": len(self.state.get("shares")),
            "users": len(self.users()),
            "jobs": [j for j in self.jobs.list() if j["status"] in ("queued", "running")],
        }
