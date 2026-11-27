"""In-memory simulation of a NAS host.  Used by ``talon --demo`` to preview
the web UI and by the test-suite.  Nothing on the real system is touched."""
from __future__ import annotations

import math
import random
import threading
import time
import uuid
import zoneinfo
from typing import Dict, List, Optional

from ..util import UserError

TB = 10**12
GB = 10**9
DEMO_PASSWORD = "talon"


def _uuid() -> str:
    return str(uuid.uuid4())


class DemoPlatform:
    demo = True

    def __init__(self, cfg):
        self.cfg = cfg
        self.lock = threading.RLock()
        self.pause = 0.0          # simulated command time; none while seeding the demo disks
        self.hostname = "talon-demo"
        self.tz = "Europe/Nicosia"
        self.disks: Dict[str, dict] = {}
        for name, model, size, kind, serial in [
            ("nvme0n1", "Samsung SSD 990 PRO 1TB", 1 * TB, "nvme", "S6Z1NJ0W"),
            ("sda", "WDC WD40EFPX-68C6CN0", 4 * TB, "hdd", "WD-WX12A3"),
            ("sdb", "WDC WD40EFPX-68C6CN0", 4 * TB, "hdd", "WD-WX12B7"),
            ("sdc", "WDC WD40EFPX-68C6CN0", 4 * TB, "hdd", "WD-WX12C1"),
            ("sdd", "WDC WD40EFPX-68C6CN0", 4 * TB, "hdd", "WD-WX12D9"),
            ("sde", "ST8000VN004-3CP101", 8 * TB, "hdd", "ZR14E2"),
            ("sdf", "ST8000VN004-3CP101", 8 * TB, "hdd", "ZR14F5"),
            ("sdg", "Samsung PSSD T7", 1 * TB, "usb", "S5SXNG0R"),
            ("sdh", "ST2000VN004-2E4164", 2 * TB, "hdd", "Z52A1H7K"),
            ("sdi", "ST2000VN004-2E4164", 2 * TB, "hdd", "Z52A1J2M"),
            ("sdj", "WD My Passport 2TB", 2 * TB, "usb", "WX42A81F"),
            ("sdk", "WDC WD40EFZX-68AWUN0", 4 * TB, "hdd", "WD-WX62K9"),
        ]:
            self.disks[name] = {"name": name, "model": model, "size": size, "kind": kind,
                                "serial": serial, "parts": [], "signature": None,
                                "mounts": [], "temp": random.randint(31, 38),
                                "hours": random.randint(2000, 21000)}
        self.disks["nvme0n1"]["parts"] = [
            {"name": "nvme0n1p1", "size": 512 * 10**6, "fstype": "vfat", "mounts": ["/boot/efi"]},
            {"name": "nvme0n1p2", "size": 999 * GB, "fstype": "ext4", "mounts": ["/"]},
        ]
        self.disks["sdg"]["parts"] = [{"name": "sdg1", "size": 1 * TB, "fstype": "exfat",
                                       "mounts": []}]
        self.disks["sdk"]["parts"] = [{"name": "sdk1", "size": 4 * TB, "fstype": "ext4", "label": "Archive",
                                       "mounts": []}]
        self.disks["sdj"]["parts"] = [{"name": "sdj1", "size": 2 * TB, "fstype": "ext4", "label": "Backup",
                                       "mounts": []}]
        self.arrays: Dict[str, dict] = {}
        self.vgs: Dict[str, dict] = {}       # md -> {"vg": name, "lvs": {lv: size}}
        self.fs: Dict[str, dict] = {}
        self.users: Dict[str, dict] = {
            "admin": {"uid": 1000, "full_name": "Administrator", "password": DEMO_PASSWORD,
                      "disabled": False, "smb": True},
        }
        self.groups: Dict[str, set] = {"nasusers": {"admin"}, "nasadmins": {"admin"}}
        self.services_state = {"smb": [True, True], "netbios": [False, False],
                               "nfs": [False, False], "wsdd": [True, True],
                               "mdns": [False, False], "ssh": [True, True]}
        self.smb_conf = ""
        self.nfs_conf = ""
        self._seed()
        self.pause = 1.0

    # ----------------------------------------------------------- seed data
    def _seed(self) -> None:
        log = lambda _m: None  # noqa: E731
        parts = [self.make_partition(d, True, log) for d in ("sda", "sdb", "sdc")]
        md = self.md_create("tank", "raid5", parts, [], log)
        self.arrays[md["dev"]]["sync_start"] = 0          # already in sync
        for m in self.arrays[md["dev"]]["members"]:
            m["state"] = "active"
        self.lvm_setup(md["dev"], "talon-tank", log)
        lv = self.lvm_create("talon-tank", "tank", int(self._array_size(self.arrays[md["dev"]]) * 0.7), md["dev"], log)
        u = self.mkfs(lv, "ext4", "tank", log)
        self.mount_persist(u, "ext4", "/srv/nas/tank", log)
        self.fs[u]["used"] = int(2.0 * TB)
        # disks from another NAS: an old RAID 1 that is assembled but not Talon's
        old = [self.make_partition(d, True, log) for d in ("sdh", "sdi")]
        md_old = self.md_create("oldnas", "raid1", old, [], log)
        self.arrays[md_old["dev"]]["sync_start"] = 0
        p = self.make_partition("sde", False, log)
        u2 = self.mkfs(p, "xfs", "backup", log)
        self.mount_persist(u2, "xfs", "/srv/nas/backup", log)
        self.fs[u2]["used"] = int(2.4 * TB)
        self._seed_volumes = {
            "tank": {"name": "tank", "level": "raid5", "fs": "ext4", "mountpoint": "/srv/nas/tank",
                     "created": time.time() - 86400 * 120, "uuid": u, "md_uuid": md["uuid"], "lv": lv},
            "backup": {"name": "backup", "level": "single", "fs": "xfs",
                       "mountpoint": "/srv/nas/backup", "created": time.time() - 86400 * 30,
                       "uuid": u2, "md_uuid": None},
        }
        for n, full in [("alice", "Alice Georgiou"), ("bob", "Bob Ioannou"),
                        ("maria", "Maria Christou")]:
            self.create_user(n, full, DEMO_PASSWORD, "nasusers", [])
        self.groups["family"] = {"alice", "bob", "maria"}
        self.groups["office"] = {"alice"}
        self.users["bob"]["disabled"] = False

    def seed_state(self, state) -> None:
        """Populate an empty demo state file with matching volumes/shares."""
        if state.get("volumes"):
            return

        def fill(d):
            d["volumes"] = self._seed_volumes
            d["groups"] = ["family", "office"]
            base = {"guest": "none", "created": time.time() - 86400 * 60, "description": "",
                    "smb": {"enabled": True, "browseable": True, "recycle_bin": True,
                            "time_machine": False},
                    "nfs": {"enabled": False, "clients": [], "squash": "all", "insecure": False}}
            d["shares"] = {
                "Media": {**base, "name": "Media", "volume": "tank", "folder": "Media",
                          "description": "Movies, music and photos", "guest": "ro",
                          "users": {"admin": "rw"}, "groups": {"family": "ro"},
                          "nfs": {"enabled": True, "squash": "all", "insecure": False,
                                  "clients": [{"host": "192.168.1.0/24", "access": "ro"}]}},
                "Documents": {**base, "name": "Documents", "volume": "tank",
                              "folder": "Documents", "description": "Family documents",
                              "users": {"admin": "rw", "alice": "rw"},
                              "groups": {"family": "ro"}},
                "Office": {**base, "name": "Office", "volume": "tank", "folder": "Office",
                           "users": {"admin": "rw"}, "groups": {"office": "rw"}},
                "TimeMachine": {**base, "name": "TimeMachine", "volume": "backup",
                                "folder": "TimeMachine", "description": "macOS backups",
                                "users": {"alice": "rw"}, "groups": {},
                                "smb": {"enabled": True, "browseable": True,
                                        "recycle_bin": False, "time_machine": True}},
            }
        state.update(fill)

    # ----------------------------------------------------------- disks
    def scan_disks(self) -> List[dict]:
        with self.lock:
            out = []
            for d in self.disks.values():
                md = sorted({a["dev"] for a in self.arrays.values()
                             for m in a["members"] if m["part"] in {p["name"] for p in d["parts"]}})
                mounts = sorted({m for p in d["parts"] for m in p["mounts"]})
                for f in self.fs.values():
                    if f["dev"] in {p["name"] for p in d["parts"]} and f.get("mountpoint"):
                        mounts.append(f["mountpoint"])
                fstypes = sorted({p["fstype"] for p in d["parts"] if p.get("fstype")})
                out.append({
                    "name": d["name"], "path": "/dev/" + d["name"], "model": d["model"],
                    "vendor": "", "serial": d["serial"], "wwn": None, "size": d["size"],
                    "rotational": d["kind"] == "hdd",
                    "transport": {"nvme": "nvme", "usb": "usb"}.get(d["kind"], "sata"),
                    "kind": d["kind"], "removable": d["kind"] == "usb",
                    "partitions": [{"name": p["name"], "size": p["size"],
                                    "fstype": p.get("fstype"), "label": p.get("label"),
                                    "mountpoints": p["mounts"]} for p in d["parts"]],
                    "mounts": mounts, "md": md, "fstypes": fstypes, "busy": False,
                    "has_signature": bool(d["parts"] or d["signature"]),
                })
            return out

    def smart_cached(self, disk: str) -> dict:
        return self.smart(disk)

    def smart(self, disk: str, refresh: bool = False) -> dict:
        d = self.disks[disk]
        nvme = d["kind"] == "nvme"
        attrs = [] if nvme else [
            {"id": 1, "name": "Raw_Read_Error_Rate", "value": 200, "worst": 200, "thresh": 51,
             "raw": "0", "failing": False},
            {"id": 5, "name": "Reallocated_Sector_Ct", "value": 200, "worst": 200,
             "thresh": 140, "raw": "0", "failing": False},
            {"id": 9, "name": "Power_On_Hours", "value": 80, "worst": 80, "thresh": 0,
             "raw": str(d["hours"]), "failing": False},
            {"id": 194, "name": "Temperature_Celsius", "value": 115, "worst": 100,
             "thresh": 0, "raw": str(d["temp"]), "failing": False},
            {"id": 197, "name": "Current_Pending_Sector", "value": 200, "worst": 200,
             "thresh": 0, "raw": "0", "failing": False},
        ]
        return {"available": True, "passed": True, "temperature": d["temp"],
                "power_on_hours": d["hours"], "power_cycles": 87, "bad_sectors": 0,
                "percentage_used": 3 if nvme else None, "firmware": "81.00A81",
                "rpm": 5400 if d["kind"] == "hdd" else 0, "attributes": attrs,
                "self_tests": [{"type": "Short offline", "status": "Completed without error",
                                "hours": d["hours"] - 24}], "messages": []}

    def smart_test(self, disk: str, kind: str) -> None:
        if kind not in ("short", "long"):
            raise UserError("Test type must be short or long")

    def wipe_disk(self, disk: str, log, step=lambda n: None, zero: bool = True) -> None:
        with self.lock:
            d = self.disks[disk]
            names = {p["name"] for p in d["parts"]}
            step(1)
            for dev in [k for k, a in self.arrays.items() if {m["part"] for m in a["members"]} & names]:
                log(f"$ mdadm --stop /dev/{dev}")
                self.arrays.pop(dev)
            time.sleep(0.8 * self.pause)
            step(2)
            log(f"$ wipefs -a /dev/{disk}")
            time.sleep(0.8 * self.pause)
            step(3)
            for u in [u for u, f in self.fs.items() if f["dev"] in names]:
                self.fs.pop(u)
            d["parts"], d["signature"] = [], None
        time.sleep(0.3 * self.pause)

    def make_partition(self, disk: str, raid: bool, log) -> str:
        with self.lock:
            log(f"$ parted -s /dev/{disk} mklabel gpt mkpart talon 1MiB 100%")
            d = self.disks[disk]
            name = f"{disk}p1" if disk[-1].isdigit() else f"{disk}1"
            d["parts"] = [{"name": name, "size": d["size"] - 2 * 10**6,
                           "fstype": "linux_raid_member" if raid else None, "mounts": []}]
            return name

    def _part_size(self, part: str) -> int:
        for d in self.disks.values():
            for p in d["parts"]:
                if p["name"] == part:
                    return p["size"]
        return 0

    def _part_disk(self, part: str) -> str:
        for d in self.disks.values():
            if any(p["name"] == part for p in d["parts"]):
                return d["name"]
        return part

    # ----------------------------------------------------------- md
    def md_create(self, name, level, parts, spares, log) -> dict:
        with self.lock:
            n = 127 - len(self.arrays)
            dev = f"md{n}"
            log(f"$ mdadm --create /dev/md/{name} --level={level} --raid-devices={len(parts)}")
            members = [{"part": p, "state": "active"} for p in parts] + \
                      [{"part": p, "state": "spare"} for p in spares]
            if level == "raid5":           # like mdadm: build by recovering onto the last disk
                members[len(parts) - 1]["state"] = "rebuilding"
            self.arrays[dev] = {"dev": dev, "uuid": _uuid(), "name": name,
                                "level": level, "raid_disks": len(parts),
                                "members": members, "sync_start": time.time(),
                                "sync_kind": None if level == "raid0" else ("recover" if level == "raid5" else "resync"),
                                "check": None}
            time.sleep(0.5 * self.pause)
            return {"dev": dev, "uuid": self.arrays[dev]["uuid"]}

    def _array_size(self, a: dict) -> int:
        from ..raid import usable_capacity
        sizes = [self._part_size(m["part"]) for m in a["members"] if m["state"] != "spare"]
        sizes = sizes[: a["raid_disks"]] or [0]
        return usable_capacity(a["level"], sizes + [min(sizes)] * (a["raid_disks"] - len(sizes)))

    def md_arrays(self) -> List[dict]:
        with self.lock:
            out = []
            for a in self.arrays.values():
                active = [m for m in a["members"] if m["state"] in ("active", "rebuilding")]
                degraded = max(a["raid_disks"] - len(active), 0)
                action, progress, speed = "idle", None, 0
                if a.get("sync_kind") and a["sync_start"]:
                    p = (time.time() - a["sync_start"]) / 90 * 100
                    if p < 100:
                        action, progress, speed = a["sync_kind"], round(p, 1), 182000
                    else:
                        a["sync_start"] = 0
                        for m in a["members"]:
                            if m["state"] == "rebuilding":
                                m["state"] = "active"
                if action == "idle" and a.get("check"):
                    p = (time.time() - a["check"]) / 120 * 100
                    if p < 100:
                        action, progress, speed = "check", round(p, 1), 195000
                    else:
                        a["check"] = None
                if action == "recover":
                    pass
                out.append({
                    "dev": a["dev"], "uuid": a["uuid"], "name": a["name"], "level": a["level"],
                    "raid_disks": a["raid_disks"], "size": self._array_size(a),
                    "array_state": "clean" if action == "idle" else "active",
                    "degraded": degraded, "sync_action": action, "sync_progress": progress,
                    "sync_speed_kbs": speed,
                    "members": [{"part": m["part"], "disk": self._part_disk(m["part"]),
                                 "state": m["state"], "slot": str(i)}
                                for i, m in enumerate(a["members"])],
                })
            return out

    def md_add(self, md, part, log) -> None:
        with self.lock:
            a = self.arrays[md]
            active = [m for m in a["members"] if m["state"] == "active"]
            if len(active) < a["raid_disks"]:
                a["members"].append({"part": part, "state": "rebuilding"})
                a["sync_kind"], a["sync_start"] = "recover", time.time()
            else:
                a["members"].append({"part": part, "state": "spare"})
            log(f"$ mdadm --manage /dev/{md} --add /dev/{part}")

    def md_grow(self, md, n, log) -> None:
        with self.lock:
            a = self.arrays[md]
            shrink = n < a["raid_disks"]
            a["raid_disks"] = n
            log(f"$ mdadm --grow /dev/{md} --raid-devices={n}")
            if shrink:
                return
            for m in a["members"]:
                if m["state"] == "spare":
                    m["state"] = "active"
                    break
            a["sync_kind"], a["sync_start"] = "reshape", time.time()

    def md_fail_remove(self, md, part, log) -> None:
        with self.lock:
            a = self.arrays[md]
            a["members"] = [m for m in a["members"] if m["part"] != part]
            log(f"$ mdadm --manage /dev/{md} --fail /dev/{part} --remove /dev/{part}")

    def md_remove_failed(self, md, log) -> None:
        with self.lock:
            a = self.arrays[md]
            a["members"] = [m for m in a["members"] if m["state"] != "faulty"]

    def md_destroy(self, md, parts, log) -> None:
        with self.lock:
            self.arrays.pop(md, None)
            log(f"$ mdadm --stop /dev/{md}")

    def md_sync_action(self, md, action) -> None:
        with self.lock:
            self.arrays[md]["check"] = time.time() if action == "check" else None

    def save_mdadm_conf(self, log) -> None:
        log("$ mdadm --detail --scan > /etc/mdadm/mdadm.conf")

    def block_size(self, dev: str) -> int:
        if "/" in dev:
            vg, lv = dev.split("/")
            return next((g["lvs"].get(lv, 0) for g in self.vgs.values() if g["vg"] == vg), 0)
        if dev in self.arrays:
            return self._array_size(self.arrays[dev])
        return self._part_size(dev)

    # ----------------------------------------------------------- filesystems
    def mkfs(self, dev, fs, label, log) -> str:
        with self.lock:
            log(f"$ mkfs.{fs} -L {label} /dev/{dev}")
            size = self.block_size(dev)
            u = _uuid()
            self.fs[u] = {"dev": dev, "fs": fs, "size": int(size * 0.98), "used": 0,
                          "mountpoint": None}
            time.sleep(0.5 * self.pause)
            return u

    def fs_info(self, u) -> Optional[dict]:
        with self.lock:
            f = self.fs.get(u)
            if not f:
                return None
            return {"dev": f["dev"], "mounted": bool(f["mountpoint"]),
                    "mountpoint": f["mountpoint"], "size": f["size"], "used": f["used"],
                    "free": max(f["size"] - f["used"], 0)}

    def mount_persist(self, u, fs, mountpoint, log) -> None:
        with self.lock:
            self.fs[u]["mountpoint"] = mountpoint
            log(f"$ mount {mountpoint}")

    def wipe_signatures(self, dev, log) -> None:
        with self.lock:
            log(f"$ wipefs -a /dev/{dev}")
            for u in [u for u, f in self.fs.items() if f["dev"] == dev]:
                self.fs.pop(u)

    def unmount_remove(self, u, mountpoint, log) -> None:
        with self.lock:
            if u in self.fs:
                self.fs[u]["mountpoint"] = None
            log(f"$ umount {mountpoint}")

    def fs_grow(self, dev, fs, mountpoint, log) -> None:
        with self.lock:
            for f in self.fs.values():
                if f["dev"] == dev:
                    f["size"] = int(self.block_size(dev) * 0.98)
            log(f"$ resize2fs /dev/{dev}" if fs == "ext4" else f"$ xfs_growfs {mountpoint}")

    def format_backup_disk(self, disk, label, log) -> str:
        self.wipe_disk(disk, log)
        part = self.make_partition(disk, False, log)
        self.mkfs(part, "ext4", label, log)
        with self.lock:
            p = self.disks[disk]["parts"][0]
            p["fstype"], p["label"] = "ext4", label
            self.disks[disk]["signature"] = True
        return part

    # ----------------------------------------------------------- LVM
    def lvm_info(self, md) -> Optional[dict]:
        g = self.vgs.get(md)
        if not g:
            return None
        size = int(self._array_size(self.arrays[md])) if md in self.arrays else 0
        return {"vg": g["vg"], "size": size, "free": max(0, size - sum(g["lvs"].values()))}

    def lvm_setup(self, md, vg, log) -> None:
        log(f"$ pvcreate /dev/{md}")
        log(f"$ vgcreate {vg} /dev/{md}")
        self.vgs[md] = {"vg": vg, "lvs": {}}

    def lvm_create(self, vg, lv, size, md, log) -> str:
        info = self.lvm_info(md)
        size = info["free"] if size is None else min(int(size), info["free"])
        log(f"$ lvcreate -n {lv} -L {size}b {vg}")
        self.vgs[md]["lvs"][lv] = size
        time.sleep(0.4 * self.pause)
        return f"{vg}/{lv}"

    def lvm_resize(self, lv, size, fs, mountpoint, md, log) -> None:
        vg, name = lv.split("/")
        cur = self.vgs[md]["lvs"][name]
        if size < cur and fs != "ext4":
            raise UserError("XFS volumes can only grow")
        log(f"$ {'lvextend' if size > cur else 'lvreduce'} -L {int(size)}b /dev/{lv}")
        self.vgs[md]["lvs"][name] = int(size)
        time.sleep(0.6 * self.pause)
        with self.lock:
            for f in self.fs.values():
                if f["dev"] == lv:
                    f["size"] = int(size * 0.98)

    def lvm_remove(self, lv, md, log) -> None:
        vg, name = lv.split("/")
        log(f"$ lvremove /dev/{lv}")
        self.vgs[md]["lvs"].pop(name, None)
        with self.lock:
            for u in [u for u, f in self.fs.items() if f["dev"] == lv]:
                self.fs.pop(u)
        if not self.vgs[md]["lvs"]:
            log(f"$ vgremove {vg}")
            self.vgs.pop(md)

    # ----------------------------------------------------------- shares
    def prepare_share_dir(self, path, group, log) -> None:
        pass

    def apply_smb(self, content, log) -> None:
        self.smb_conf = content

    def apply_nfs(self, content, log) -> None:
        self.nfs_conf = content

    def apply_avahi(self, content, log) -> None:
        pass

    # ----------------------------------------------------------- users
    def group_gid(self, name) -> int:
        return 1001

    def group_exists(self, name) -> bool:
        return name in self.groups or name in ("root", "sudo", "users", "adm")

    def user_exists(self, name) -> bool:
        return name in self.users or name in ("root", "daemon", "nobody")

    def group_members(self, name) -> List[str]:
        return sorted(self.groups.get(name, set()))

    def list_users(self, users_group, admin_group, managed) -> List[dict]:
        out = []
        for n, u in sorted(self.users.items()):
            out.append({"name": n, "uid": u["uid"], "full_name": u["full_name"],
                        "admin": n in self.groups[admin_group], "disabled": u["disabled"],
                        "smb": u["smb"],
                        "groups": sorted(g for g in managed if n in self.groups.get(g, set()))})
        return out

    def create_user(self, name, full_name, password, users_group, groups) -> None:
        self.users[name] = {"uid": 1000 + len(self.users), "full_name": full_name or name,
                            "password": password, "disabled": False, "smb": True}
        self.groups[users_group].add(name)
        for g in groups:
            self.groups.setdefault(g, set()).add(name)

    def set_password(self, name, password) -> None:
        self.users[name]["password"] = password
        self.users[name]["smb"] = True

    def set_full_name(self, name, full_name) -> None:
        self.users[name]["full_name"] = full_name or name

    def set_group_membership(self, user, group, member) -> None:
        s = self.groups.setdefault(group, set())
        (s.add if member else s.discard)(user)

    def set_disabled(self, name, disabled) -> None:
        self.users[name]["disabled"] = disabled

    def delete_user(self, name) -> None:
        self.users.pop(name, None)
        for s in self.groups.values():
            s.discard(name)

    def create_group(self, name) -> None:
        self.groups[name] = set()

    def delete_group(self, name) -> None:
        self.groups.pop(name, None)

    def set_group_members(self, name, members) -> None:
        self.groups[name] = set(members)

    def authenticate(self, user, password) -> bool:
        u = self.users.get(user)
        return bool(u and not u["disabled"] and u["password"] == password)

    # ----------------------------------------------------------- system
    # ----------------------------------------------------------- network (IPv4)
    _net = {"mode": "dhcp", "address": "192.168.1.50", "prefix": 24,
            "gateway": "192.168.1.1", "dns": ["192.168.1.1"]}

    def net_interfaces(self) -> List[dict]:
        from ..network import mask_of
        n = self._net
        return [{"name": "enp1s0", "mac": "a8:a1:59:3c:21:7e", "up": True, "wireless": False,
                 "manager": "networkmanager", "mode": n["mode"], "address": n["address"],
                 "prefix": n["prefix"], "subnet": mask_of(n["prefix"]), "gateway": n["gateway"],
                 "dns": list(n["dns"]), "default": True, "unsupported": None}]

    def net_apply(self, iface: str, cfg: dict, log) -> dict:
        old = dict(self._net)
        if cfg["mode"] == "static":
            self._net = {k: cfg[k] for k in ("mode", "address", "prefix", "gateway", "dns")}
        else:
            self._net = {"mode": "dhcp", "address": "192.168.1.50", "prefix": 24,
                         "gateway": "192.168.1.1", "dns": ["192.168.1.1"]}
        return {"old": old}

    def net_restore(self, iface: str, token: dict, log) -> None:
        self._net = token["old"]

    def system_info(self) -> dict:
        return {"hostname": self.hostname, "os": "Debian GNU/Linux 13 (trixie)",
                "kernel": "6.12.48+deb13-amd64", "arch": "x86_64",
                "model": "Demo NAS (simulated)", "cpu": "Intel(R) N100", "cores": 4,
                "memory": 16 * 2**30, "boot_time": time.time() - 86400 * 12 - 3600 * 5,
                "addresses": [{"iface": "enp1s0", "address": "192.168.1.50", "family": 4,
                               "up": True, "speed": 2500}]}

    def sample(self) -> dict:
        t = time.time()
        base = getattr(self, "_ctr", None) or {"rx": 0.0, "tx": 0.0, "rd": 0.0, "wr": 0.0}
        base["rx"] += max(0, 40e6 + 35e6 * math.sin(t / 9) + random.uniform(-8e6, 8e6)) * 2
        base["tx"] += max(0, 9e6 + 7e6 * math.sin(t / 13 + 1) + random.uniform(-2e6, 2e6)) * 2
        base["rd"] += max(0, 55e6 + 40e6 * math.sin(t / 11) + random.uniform(-5e6, 5e6)) * 2
        base["wr"] += max(0, 12e6 + 10e6 * math.sin(t / 7) + random.uniform(-3e6, 3e6)) * 2
        self._ctr = base
        cpu = max(1.0, min(100.0, 18 + 12 * math.sin(t / 15) + random.uniform(-5, 5)))
        total = 16 * 2**30
        return {"ts": t, "cpu": cpu, "mem_used": int(total * (0.31 + 0.03 * math.sin(t / 30))),
                "mem_total": total, "load": [0.42, 0.51, 0.47],
                "temp": 46 + 4 * math.sin(t / 20), "net_rx": base["rx"], "net_tx": base["tx"],
                "disk_read": base["rd"], "disk_write": base["wr"]}

    def services(self) -> List[dict]:
        from .real import SERVICES
        return [{"id": k, "unit": v["units"][0], "installed": True,
                 "active": self.services_state[k][0], "enabled": self.services_state[k][1],
                 "label": v["label"], "description": v["description"]}
                for k, v in SERVICES.items()]

    def service_action(self, sid, action) -> None:
        st = self.services_state.get(sid)
        if st is None:
            raise UserError("Unknown service")
        if action in ("enable", "start", "restart"):
            st[0] = True
            if action == "enable":
                st[1] = True
        elif action in ("disable", "stop"):
            st[0] = False
            if action == "disable":
                st[1] = False
        else:
            raise UserError("Invalid action")

    def set_hostname(self, name) -> None:
        self.hostname = name

    def timezone(self) -> str:
        return self.tz

    def timezones(self) -> List[str]:
        return sorted(zoneinfo.available_timezones())

    def set_timezone(self, tz) -> None:
        if tz not in zoneinfo.available_timezones():
            raise UserError("Unknown time zone")
        self.tz = tz

    def power(self, action) -> None:
        if action not in ("reboot", "poweroff"):
            raise UserError("Invalid power action")
