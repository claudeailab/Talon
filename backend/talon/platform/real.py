"""Platform implementation that drives the real Linux host."""
from __future__ import annotations

import glob
import grp
import json
import os
import platform as pyplatform
import pwd
import re
import shutil
import socket
import threading
import time
import zoneinfo
from typing import Dict, List, Optional

import psutil

from .. import pam
from ..util import CommandError, Logger, UserError, read_file, run, write_atomic

SYSTEM_MOUNTS = {"/", "/boot", "/boot/efi", "/boot/firmware", "/usr", "/var", "/home",
                 "[SWAP]", "/var/log", "/tmp"}
SKIP_DISK_PREFIXES = ("loop", "ram", "zram", "sr", "fd", "md", "dm-", "nbd", "mtdblock")

SERVICES = {
    "smb": {"units": ["smbd"], "label": "SMB (Samba)",
            "description": "File sharing for Windows, macOS and Linux"},
    "netbios": {"units": ["nmbd"], "label": "NetBIOS",
                "description": "Name lookup for old Windows PCs"},
    "nfs": {"units": ["nfs-server", "nfs-kernel-server"], "label": "NFS",
            "description": "File sharing for Linux and VMware"},
    "wsdd": {"units": ["wsdd", "wsdd2"], "label": "WS-Discovery",
             "description": "Shows the NAS in Windows Network"},
    "mdns": {"units": ["avahi-daemon"], "label": "Bonjour (mDNS)",
             "description": "Shows the NAS in macOS Finder"},
    "ssh": {"units": ["ssh"], "label": "SSH", "description": "Secure remote shell access"},
}

MDADM_CONF = "/etc/mdadm/mdadm.conf"
FSTAB = "/etc/fstab"
FSTAB_TAG = "# talon"


def _dev(name: str) -> str:
    return "/dev/" + name


def part_name(disk: str, n: int = 1) -> str:
    return f"{disk}p{n}" if disk[-1].isdigit() else f"{disk}{n}"


VIRTUAL_DISKS = [("vmware", "VMware"), ("qemu", "QEMU"), ("vbox", "VirtualBox"),
                 ("virtualbox", "VirtualBox"), ("msft", "Hyper-V"), ("xen", "Xen")]


def virtual_disk_name(name: str, vendor: str, model: str) -> str:
    """Readable name for disks of virtual machines, whose raw model strings are
    cut off at 16 characters (e.g. "VMware Virtual S"). Empty for real disks."""
    text = f"{vendor} {model}".lower()
    for key, label in VIRTUAL_DISKS:
        if key in text:
            return f"{label} virtual disk"
    if name.startswith("vd") or "virtual disk" in text:
        return "Virtual disk"
    return ""


class RealPlatform:
    demo = False

    def __init__(self, cfg):
        self.cfg = cfg
        self._smart_cache: Dict[str, dict] = {}
        self._smart_lock = threading.Lock()

    # ------------------------------------------------------------ discovery
    def _lsblk(self) -> List[dict]:
        cols = ("NAME,KNAME,PATH,TYPE,SIZE,MODEL,SERIAL,WWN,ROTA,TRAN,VENDOR,RM,RO,"
                "FSTYPE,UUID,LABEL,PARTLABEL,MOUNTPOINTS,PKNAME")
        cp = run(["lsblk", "-J", "-b", "-o", cols], timeout=30)
        return json.loads(cp.stdout).get("blockdevices", [])

    @staticmethod
    def _mounts(node: dict) -> List[str]:
        mps = node.get("mountpoints") or []
        return [m for m in mps if m]

    def _walk(self, node: dict, acc: dict) -> None:
        for m in self._mounts(node):
            acc["mounts"].add(m)
        if node.get("type", "").startswith("raid"):
            acc["md"].add(node["name"])
        if node.get("type") in ("lvm", "crypt"):
            acc["busy"] = True
        if node.get("fstype"):
            acc["fstypes"].add(node["fstype"])
        for c in node.get("children") or []:
            self._walk(c, acc)

    def scan_disks(self) -> List[dict]:  # noqa: C901
        out = []
        for d in self._lsblk():
            name = d["name"]
            if d.get("type") != "disk" or name.startswith(SKIP_DISK_PREFIXES):
                continue
            if d.get("ro") in (True, "1", 1) or not d.get("size"):
                continue
            if re.match(r"mmcblk\d+boot\d+$", name) or re.match(r"mmcblk\d+rpmb$", name):
                continue
            acc = {"mounts": set(), "md": set(), "fstypes": set(), "busy": False}
            self._walk(d, acc)
            tran = (d.get("tran") or "").lower()
            rota = d.get("rota") in (True, "1", 1)
            vendor = (d.get("vendor") or "").strip()
            model = (d.get("model") or "").strip()
            virtual = virtual_disk_name(name, vendor, model)
            if virtual:
                kind = "virtual"
            elif name.startswith("nvme"):
                kind = "nvme"
            elif name.startswith("mmcblk"):
                kind = "sd"
            elif tran == "usb":
                kind = "usb"
            else:
                kind = "hdd" if rota else "ssd"
            parts = [{
                "name": c["name"], "size": c.get("size") or 0, "fstype": c.get("fstype"),
                "label": c.get("label") or c.get("partlabel"), "mountpoints": self._mounts(c),
            } for c in d.get("children") or [] if c.get("type") == "part"]
            out.append({
                "name": name, "path": d.get("path") or _dev(name),
                "model": virtual or model or "Unknown",
                "vendor": vendor,
                "serial": (d.get("serial") or "").strip(),
                "wwn": d.get("wwn"), "size": int(d.get("size") or 0),
                "rotational": rota, "transport": tran or None, "kind": kind,
                "removable": d.get("rm") in (True, "1", 1),
                "partitions": parts, "mounts": sorted(acc["mounts"]),
                "md": sorted(acc["md"]), "fstypes": sorted(acc["fstypes"]), "busy": acc["busy"],
                "has_signature": bool(d.get("fstype")) or bool(parts),
            })
        return out

    # ------------------------------------------------------------ SMART
    def smart_cached(self, disk: str) -> dict:
        with self._smart_lock:
            return dict(self._smart_cache.get(disk) or {})

    def smart(self, disk: str, refresh: bool = False) -> dict:
        with self._smart_lock:
            cached = self._smart_cache.get(disk)
        if cached and not refresh and time.time() - cached["_ts"] < 300:
            return cached
        data = self._smartctl(["-a"], disk)
        info = self._parse_smart(data)
        info["_ts"] = time.time()
        with self._smart_lock:
            self._smart_cache[disk] = info
        return info

    def _smartctl(self, args: List[str], disk: str) -> dict:
        data: dict = {}
        for extra in ([], ["-d", "sat"]):
            cp = run(["smartctl", "-j", *extra, *args, _dev(disk)], check=False, timeout=60)
            try:
                data = json.loads(cp.stdout or "{}")
            except ValueError:
                data = {}
            # bit 1 = device open failed / unsupported bridge -> retry as SAT (USB)
            if not (cp.returncode & 0b10) and data:
                break
        return data

    @staticmethod
    def _parse_smart(d: dict) -> dict:
        status = d.get("smart_status", {}).get("passed")
        attrs = []
        for a in d.get("ata_smart_attributes", {}).get("table", []):
            attrs.append({"id": a.get("id"), "name": a.get("name"),
                          "value": a.get("value"), "worst": a.get("worst"),
                          "thresh": a.get("thresh"), "raw": a.get("raw", {}).get("string"),
                          "failing": bool(a.get("when_failed"))})
        nvme = d.get("nvme_smart_health_information_log") or {}
        realloc = None
        for a in attrs:
            if a["id"] in (5, 197, 198):
                try:
                    realloc = (realloc or 0) + int(str(a["raw"]).split()[0])
                except (ValueError, IndexError):
                    pass
        tests = []
        for t in (d.get("ata_smart_self_test_log", {}).get("standard", {}).get("table", []))[:10]:
            tests.append({"type": t.get("type", {}).get("string"),
                          "status": t.get("status", {}).get("string"),
                          "hours": t.get("lifetime_hours")})
        return {
            "available": bool(d.get("smart_support", {}).get("available", bool(d.get("smart_status")))),
            "passed": status,
            # virtual and some USB disks report 0 when they have no sensor
            "temperature": (d.get("temperature", {}).get("current") or None),
            "power_on_hours": d.get("power_on_time", {}).get("hours"),
            "power_cycles": d.get("power_cycle_count"),
            "bad_sectors": realloc,
            "percentage_used": nvme.get("percentage_used"),
            "firmware": d.get("firmware_version"),
            "rpm": d.get("rotation_rate"),
            "attributes": attrs,
            "self_tests": tests,
            "messages": [m.get("string") for m in d.get("smartctl", {}).get("messages", [])],
        }

    def smart_test(self, disk: str, kind: str) -> None:
        if kind not in ("short", "long"):
            raise UserError("Test type must be short or long")
        self._smartctl(["-t", kind], disk)

    # ------------------------------------------------------------ disks
    def _settle(self, log: Optional[Logger] = None) -> None:
        run(["udevadm", "settle", "--timeout=30"], check=False, log=log)

    def _stop_holders(self, disk: str, log: Logger) -> None:
        """Stop RAID arrays that use the disk or its partitions (an old array from
        another system is assembled automatically at boot and keeps the disk busy)."""
        nodes = [disk] + [os.path.basename(p) for p in glob.glob(f"/sys/class/block/{disk}/{disk}*")]
        for node in nodes:
            for h in glob.glob(f"/sys/class/block/{node}/holders/md*"):
                md = os.path.basename(h)
                log(f"-- stopping old RAID {md}")
                run(["mdadm", "--stop", _dev(md)], log=log)

    def wipe_disk(self, disk: str, log: Logger, step=lambda n: None) -> None:
        dev = _dev(disk)
        step(1)
        self._stop_holders(disk, log)
        step(2)
        for p in glob.glob(f"/sys/class/block/{disk}/{disk}*"):
            pn = os.path.basename(p)
            run(["mdadm", "--zero-superblock", _dev(pn)], check=False, log=log)
            run(["wipefs", "-a", _dev(pn)], check=False, log=log)
        run(["mdadm", "--zero-superblock", dev], check=False, log=log)
        run(["wipefs", "-a", dev], log=log)
        step(3)
        run(["partprobe", dev], check=False, log=log)
        self._settle(log)

    def make_partition(self, disk: str, raid: bool, log: Logger) -> str:
        dev = _dev(disk)
        run(["parted", "-s", "-a", "optimal", dev, "mklabel", "gpt",
             "mkpart", "talon", "1MiB", "100%"], log=log)
        if raid:
            run(["parted", "-s", dev, "set", "1", "raid", "on"], log=log)
        run(["partprobe", dev], check=False, log=log)
        self._settle(log)
        part = part_name(disk)
        for _ in range(30):
            if os.path.exists(_dev(part)):
                break
            time.sleep(0.5)
        else:
            raise UserError(f"Partition {part} did not appear")
        run(["wipefs", "-a", _dev(part)], check=False, log=log)
        run(["mdadm", "--zero-superblock", _dev(part)], check=False, log=log)
        return part

    # ------------------------------------------------------------ md RAID
    def md_create(self, name: str, level: str, parts: List[str], spares: List[str],
                  log: Logger) -> dict:
        from ..raid import MD_LEVEL
        cmd = ["mdadm", "--create", f"/dev/md/{name}", "--run", "--metadata=1.2",
               f"--name={name}", f"--level={MD_LEVEL[level]}", f"--raid-devices={len(parts)}"]
        if spares:
            cmd.append(f"--spare-devices={len(spares)}")
        if level != "raid0":
            cmd.append("--bitmap=internal")
        if level == "raid10":
            cmd.append("--layout=n2")
        cmd += [_dev(p) for p in parts + spares]
        run(cmd, input="y\n", log=log)
        self._settle(log)
        link = f"/dev/md/{name}"
        for _ in range(20):
            if os.path.exists(link):
                mddev = os.path.realpath(link)
                info = self._md_export(mddev)
                return {"dev": os.path.basename(mddev), "uuid": info.get("MD_UUID")}
            # udev may name the node differently (e.g. other homehost): match by name
            for a in glob.glob("/sys/block/md*/md"):
                dev = a.split("/")[3]
                info = self._md_export(_dev(dev))
                if info.get("MD_NAME", "").split(":")[-1] == name:
                    return {"dev": dev, "uuid": info.get("MD_UUID")}
            time.sleep(0.5)
        raise UserError(f"RAID array {name} was created but its device could not be found")

    def _md_export(self, dev: str) -> Dict[str, str]:
        cp = run(["mdadm", "--detail", "--export", dev], check=False, timeout=30)
        out = {}
        for line in cp.stdout.splitlines():
            if "=" in line:
                k, v = line.split("=", 1)
                out[k] = v
        return out

    def md_arrays(self) -> List[dict]:
        arrays = []
        for path in sorted(glob.glob("/sys/block/md*/md")):
            dev = path.split("/")[3]
            r = lambda f: read_file(os.path.join(path, f)).strip()  # noqa: E731
            level = r("level")
            if not level:
                continue
            exp = self._md_export(_dev(dev))
            members = []
            for m in sorted(glob.glob(os.path.join(path, "dev-*"))):
                pn = os.path.basename(m)[4:]
                state = read_file(os.path.join(m, "state")).strip()
                slot = read_file(os.path.join(m, "slot")).strip()
                disk = os.path.basename(os.path.dirname(os.path.realpath(f"/sys/class/block/{pn}")))
                if disk == "block":
                    disk = pn
                st = "active"
                if "faulty" in state:
                    st = "faulty"
                elif "spare" in state and slot == "none":
                    st = "spare"
                elif "in_sync" not in state and level != "raid0":
                    st = "rebuilding"
                members.append({"part": pn, "disk": disk, "state": st, "slot": slot})
            sync_action = r("sync_action") or "idle"
            completed = r("sync_completed")
            progress = None
            if completed and "/" in completed:
                a, b = completed.split("/")
                try:
                    progress = round(int(a) / max(int(b), 1) * 100, 1)
                except ValueError:
                    pass
            try:
                speed = int(r("sync_speed") or 0)
            except ValueError:
                speed = 0
            try:
                degraded = int(r("degraded") or 0)
            except ValueError:
                degraded = 0
            arrays.append({
                "dev": dev, "uuid": exp.get("MD_UUID"), "name": exp.get("MD_NAME", "").split(":")[-1],
                "level": level, "raid_disks": int(r("raid_disks") or 0),
                "size": int(read_file(f"/sys/block/{dev}/size", "0").strip() or 0) * 512,
                "array_state": r("array_state"), "degraded": degraded,
                "sync_action": sync_action, "sync_progress": progress, "sync_speed_kbs": speed,
                "members": members,
            })
        return arrays

    def md_add(self, md: str, part: str, log: Logger) -> None:
        run(["mdadm", "--manage", _dev(md), "--add", _dev(part)], log=log)

    def md_grow(self, md: str, raid_devices: int, log: Logger) -> None:
        run(["mdadm", "--grow", _dev(md), f"--raid-devices={raid_devices}"], log=log)

    def md_fail_remove(self, md: str, part: str, log: Logger) -> None:
        run(["mdadm", "--manage", _dev(md), "--fail", _dev(part)], check=False, log=log)
        run(["mdadm", "--manage", _dev(md), "--remove", _dev(part)], log=log)

    def md_remove_failed(self, md: str, log: Logger) -> None:
        run(["mdadm", "--manage", _dev(md), "--remove", "failed"], check=False, log=log)
        run(["mdadm", "--manage", _dev(md), "--remove", "detached"], check=False, log=log)

    def md_destroy(self, md: str, parts: List[str], log: Logger) -> None:
        run(["mdadm", "--stop", _dev(md)], log=log)
        for p in parts:
            run(["mdadm", "--zero-superblock", _dev(p)], check=False, log=log)
            run(["wipefs", "-a", _dev(p)], check=False, log=log)

    def md_sync_action(self, md: str, action: str) -> None:
        if action not in ("check", "repair", "idle"):
            raise UserError("Invalid action")
        write_atomic_sys(f"/sys/block/{md}/md/sync_action", action)

    def save_mdadm_conf(self, log: Logger) -> None:
        current = read_file(MDADM_CONF)
        keep = [ln for ln in current.splitlines() if not ln.startswith("ARRAY")]
        scan = run(["mdadm", "--detail", "--scan"], check=False, log=log).stdout
        content = "\n".join(keep).rstrip() + "\n\n" + scan.strip() + "\n"
        if os.path.isdir(os.path.dirname(MDADM_CONF)):
            write_atomic(MDADM_CONF, content)
        if os.path.exists("/usr/sbin/update-initramfs"):
            # slow on a Raspberry Pi; run detached so the job finishes promptly
            threading.Thread(target=run, args=(["update-initramfs", "-u"],),
                             kwargs={"check": False, "timeout": 900}, daemon=True).start()
            log("update-initramfs -u started in background")

    # ------------------------------------------------------------ filesystems
    def mkfs(self, dev: str, fs: str, label: str, log: Logger) -> str:
        path = _dev(dev)
        if fs == "ext4":
            run(["mkfs.ext4", "-F", "-m", "0", "-L", label[:16], path], log=log, timeout=7200)
        elif fs == "xfs":
            run(["mkfs.xfs", "-f", "-L", label[:12], path], log=log, timeout=7200)
        else:
            raise UserError(f"Unsupported filesystem {fs}")
        self._settle(log)
        return run(["blkid", "-s", "UUID", "-o", "value", path], log=log).stdout.strip()

    def fs_info(self, uuid: str) -> Optional[dict]:
        if not uuid:
            return None
        cp = run(["blkid", "-U", uuid], check=False, timeout=15)
        dev = cp.stdout.strip()
        if not dev:
            return None
        info = {"dev": os.path.basename(os.path.realpath(dev)), "mounted": False}
        for p in psutil.disk_partitions(all=True):
            if os.path.realpath(p.device) == os.path.realpath(dev):
                u = psutil.disk_usage(p.mountpoint)
                info.update(mounted=True, mountpoint=p.mountpoint, size=u.total, used=u.used,
                            free=u.free)
                break
        return info

    MEDIA_ROOT = "/media/talon"

    def mount_external(self, dev: str, fstype: str, log: Logger) -> str:
        """Mount a disk Talon does not manage under /media/talon/<dev> (until ejected
        or the next restart). FAT, exFAT and NTFS have no owners: files belong to
        root and the NAS users group, so shared-folder users can work with them."""
        if not re.match(r"^[a-z0-9]+$", dev):
            raise UserError("Invalid device")
        mp = os.path.join(self.MEDIA_ROOT, dev)
        os.makedirs(mp, exist_ok=True)
        try:
            gid = grp.getgrnam(self.cfg.users_group).gr_gid
        except KeyError:
            gid = 0
        owners = f"uid=0,gid={gid},dmask=0002,fmask=0113"
        attempts = {"vfat": [("vfat", owners + ",utf8")], "exfat": [("exfat", owners)],
                    "ntfs": [("ntfs3", owners), ("ntfs-3g", owners)], "ntfs3": [("ntfs3", owners)]}
        tries = attempts.get(fstype, [(fstype, "defaults")])
        last = None
        for fs, opts in tries:
            cp = run(["mount", "-t", fs, "-o", opts, _dev(dev), mp], check=False, log=log, timeout=60)
            if cp.returncode == 0:
                return mp
            last = (cp.stderr or cp.stdout or "").strip()
        try:
            os.rmdir(mp)
        except OSError:
            pass
        raise UserError(f"Could not open {dev}: {last or 'mount failed'}")

    def unmount_external(self, mountpoint: str, log: Logger) -> None:
        if not mountpoint.startswith(self.MEDIA_ROOT + "/"):
            raise UserError("Not mounted by Talon")
        run(["sync"], check=False, log=log, timeout=120)
        cp = run(["umount", mountpoint], check=False, log=log, timeout=60)
        if cp.returncode != 0:
            raise UserError("The disk is in use; close any open files and try again")
        try:
            os.rmdir(mountpoint)
        except OSError:
            pass

    def mount_persist(self, uuid: str, fs: str, mountpoint: str, log: Logger) -> None:
        os.makedirs(mountpoint, exist_ok=True)
        lines = [ln for ln in read_file(FSTAB).splitlines() if f"UUID={uuid} " not in ln]
        passno = "2" if fs == "ext4" else "0"
        lines.append(f"UUID={uuid} {mountpoint} {fs} defaults,nofail,"
                     f"x-systemd.device-timeout=30s 0 {passno} {FSTAB_TAG}")
        write_atomic(FSTAB, "\n".join(lines) + "\n")
        log(f"fstab: added {mountpoint}")
        run(["systemctl", "daemon-reload"], check=False, log=log)
        run(["mount", mountpoint], log=log)
        os.chmod(mountpoint, 0o755)

    def wipe_signatures(self, dev: str, log: Logger) -> None:
        """Remove filesystem signatures from a block device (e.g. a RAID array)."""
        run(["wipefs", "-a", _dev(dev)], log=log)

    def unmount_remove(self, uuid: str, mountpoint: str, log: Logger) -> None:
        if os.path.ismount(mountpoint):
            cp = run(["umount", mountpoint], check=False, log=log)
            if cp.returncode != 0:
                raise UserError(f"Cannot unmount {mountpoint}: it is busy. Stop clients "
                                "using it and try again.")
        lines = [ln for ln in read_file(FSTAB).splitlines()
                 if not (uuid and f"UUID={uuid} " in ln)]
        write_atomic(FSTAB, "\n".join(lines) + "\n")
        run(["systemctl", "daemon-reload"], check=False, log=log)
        try:
            os.rmdir(mountpoint)
        except OSError:
            pass

    def fs_grow(self, dev: str, fs: str, mountpoint: str, log: Logger) -> None:
        if fs == "ext4":
            run(["resize2fs", _dev(dev)], log=log, timeout=7200)
        else:
            run(["xfs_growfs", mountpoint], log=log, timeout=7200)

    def block_size(self, dev: str) -> int:
        if "/" in dev:                     # a logical volume: <vg>/<lv>
            cp = run(["blockdev", "--getsize64", _dev(dev)], check=False, timeout=15)
            return int(cp.stdout.strip() or 0) if cp.returncode == 0 else 0
        return int(read_file(f"/sys/class/block/{dev}/size", "0").strip() or 0) * 512

    def format_backup_disk(self, disk: str, label: str, log: Logger) -> str:
        """Erase a disk and give it one ext4 partition for backups; returns the partition."""
        self.wipe_disk(disk, log)
        part = self.make_partition(disk, False, log)
        self.mkfs(part, "ext4", label, log)
        return part

    # ------------------------------------------------------------ LVM: several volumes on one RAID
    def lvm_info(self, md: str) -> Optional[dict]:
        """The LVM pool on a RAID array: its volume group, size and free space (bytes).
        Space the array gained (it was expanded) and LVM does not use yet counts as free."""
        if not shutil.which("pvs"):
            return None
        cp = run(["pvs", "--noheadings", "--units", "b", "--nosuffix", "--separator", ";",
                  "-o", "vg_name,pv_size,vg_free", _dev(md)], check=False, timeout=15)
        if cp.returncode != 0 or not cp.stdout.strip():
            return None
        vg, pv_size, free = (x.strip() for x in cp.stdout.strip().split(";")[:3])
        if not vg:
            return None
        grown = max(0, self.block_size(md) - int(pv_size) - 4 * 2**20)   # minus LVM's metadata
        return {"vg": vg, "size": int(pv_size) + grown, "free": int(free) + grown}

    def lvm_setup(self, md: str, vg: str, log: Logger) -> None:
        if not shutil.which("pvcreate"):
            raise UserError("LVM is not installed: update Talon, or run: apt-get install lvm2")
        run(["pvcreate", "-ff", "-y", _dev(md)], log=log)
        run(["vgcreate", vg, _dev(md)], log=log)

    def lvm_create(self, vg: str, lv: str, size: Optional[int], md: str, log: Logger) -> str:
        """A logical volume of `size` bytes (None: all the free space); returns <vg>/<lv>."""
        run(["pvresize", _dev(md)], check=False, log=log)
        size_arg = ["-l", "100%FREE"] if size is None else ["-L", f"{int(size)}b"]
        run(["lvcreate", "-y", "-W", "y", "-n", lv, *size_arg, vg], log=log)
        self._settle(log)
        return f"{vg}/{lv}"

    def lvm_resize(self, lv: str, size: int, fs: str, mountpoint: str, md: str, log: Logger) -> None:
        """Grow (online) or shrink (ext4 only, briefly unmounted) a volume and its filesystem."""
        path = _dev(lv)
        current = self.block_size(lv)
        if abs(size - current) < 8 * 2**20:        # less than two LVM extents: nothing to do
            return
        if size > current:
            run(["pvresize", _dev(md)], check=False, log=log)
            run(["lvextend", "-L", f"{int(size)}b", path], log=log)
            self.fs_grow(lv, fs, mountpoint, log)
            return
        if fs != "ext4":
            raise UserError("XFS volumes can only grow")
        run(["umount", mountpoint], log=log)
        try:
            run(["e2fsck", "-f", "-y", path], log=log, timeout=7200)
            run(["resize2fs", path, f"{int(size) // 1024}K"], log=log, timeout=7200)
            run(["lvreduce", "-f", "-L", f"{int(size)}b", path], log=log)
            run(["resize2fs", path], log=log, timeout=7200)        # fill the exact LV size
        finally:
            run(["mount", mountpoint], log=log)

    def lvm_remove(self, lv: str, md: str, log: Logger) -> None:
        """Remove a volume; the last one also removes the pool, leaving the RAID array empty."""
        vg = lv.split("/")[0]
        run(["lvremove", "-y", _dev(lv)], log=log)
        cp = run(["vgs", "--noheadings", "-o", "lv_count", vg], check=False, log=log)
        if cp.returncode == 0 and cp.stdout.strip() == "0":
            run(["vgremove", "-y", vg], log=log)
            run(["pvremove", "-y", _dev(md)], check=False, log=log)
            run(["wipefs", "-a", _dev(md)], check=False, log=log)

    # ------------------------------------------------------------ shares
    def prepare_share_dir(self, path: str, group: str, log: Logger) -> None:
        os.makedirs(path, exist_ok=True)
        gid = grp.getgrnam(group).gr_gid
        os.chown(path, 0, gid)
        os.chmod(path, 0o2775)
        run(["setfacl", "-m", f"g:{group}:rwx", "-m", f"d:g:{group}:rwx", "-m", "d:u::rwx",
             "-m", "d:g::rwx", "-m", "d:o::rx", path], check=False, log=log)

    def apply_smb(self, content: str, log: Logger) -> None:
        tmp = "/etc/samba/.smb.conf.talon-test"
        write_atomic(tmp, content)
        try:
            cp = run(["testparm", "-s", tmp], check=False, log=None)
            if cp.returncode != 0:
                raise UserError("Samba rejected the configuration: " + (cp.stderr or "")[-500:])
        finally:
            try:
                os.unlink(tmp)
            except OSError:
                pass
        write_atomic("/etc/samba/smb.conf", content)
        if self._active("smbd"):
            run(["smbcontrol", "smbd", "reload-config"], check=False, log=log)

    def apply_nfs(self, content: str, log: Logger) -> None:
        write_atomic("/etc/exports.d/talon.exports", content)
        run(["exportfs", "-ra"], check=False, log=log)

    def apply_avahi(self, content: str, log: Logger) -> None:
        if os.path.isdir("/etc/avahi/services"):
            write_atomic("/etc/avahi/services/talon.service", content)

    # ------------------------------------------------------------ users
    def group_gid(self, name: str) -> int:
        return grp.getgrnam(name).gr_gid

    def group_exists(self, name: str) -> bool:
        try:
            grp.getgrnam(name)
            return True
        except KeyError:
            return False

    def user_exists(self, name: str) -> bool:
        try:
            pwd.getpwnam(name)
            return True
        except KeyError:
            return False

    def group_members(self, name: str) -> List[str]:
        try:
            g = grp.getgrnam(name)
        except KeyError:
            return []
        members = set(g.gr_mem)
        for p in pwd.getpwall():
            if p.pw_gid == g.gr_gid:
                members.add(p.pw_name)
        return sorted(members)

    def list_users(self, users_group: str, admin_group: str, managed_groups: List[str]) -> List[dict]:
        names = set(self.group_members(users_group)) | set(self.group_members(admin_group))
        smb_users = set()
        cp = run(["pdbedit", "-L"], check=False, timeout=30)
        for line in cp.stdout.splitlines():
            if ":" in line:
                smb_users.add(line.split(":", 1)[0])
        admins = set(self.group_members(admin_group))
        gmembers = {g: set(self.group_members(g)) for g in managed_groups}
        out = []
        for n in sorted(names):
            try:
                p = pwd.getpwnam(n)
            except KeyError:
                continue
            st = run(["passwd", "-S", n], check=False, timeout=10).stdout.split()
            out.append({
                "name": n, "uid": p.pw_uid, "full_name": p.pw_gecos.split(",")[0],
                "admin": n in admins, "disabled": len(st) > 1 and st[1] == "L",
                "smb": n in smb_users,
                "groups": sorted(g for g, m in gmembers.items() if n in m),
            })
        return out

    def create_user(self, name: str, full_name: str, password: str, users_group: str,
                    groups: List[str]) -> None:
        cmd = ["useradd", "-M", "-N", "-g", users_group, "-s", "/usr/sbin/nologin",
               "-c", full_name or name]
        if groups:
            cmd += ["-G", ",".join(groups)]
        run(cmd + [name])
        try:
            self.set_password(name, password)
        except Exception:
            run(["userdel", name], check=False)
            raise

    def set_password(self, name: str, password: str) -> None:
        run(["chpasswd"], input=f"{name}:{password}\n")
        run(["smbpasswd", "-a", "-s", name], input=f"{password}\n{password}\n")

    def set_full_name(self, name: str, full_name: str) -> None:
        run(["usermod", "-c", full_name or name, name])

    def set_group_membership(self, user: str, group: str, member: bool) -> None:
        if member:
            run(["gpasswd", "-a", user, group])
        else:
            run(["gpasswd", "-d", user, group], check=False)

    def set_disabled(self, name: str, disabled: bool) -> None:
        run(["usermod", "-L" if disabled else "-U", name])
        run(["smbpasswd", "-d" if disabled else "-e", name], check=False)

    def delete_user(self, name: str) -> None:
        run(["smbpasswd", "-x", name], check=False)
        run(["userdel", name])

    def create_group(self, name: str) -> None:
        run(["groupadd", name])

    def delete_group(self, name: str) -> None:
        run(["groupdel", name])

    def set_group_members(self, name: str, members: List[str]) -> None:
        run(["gpasswd", "-M", ",".join(members), name])

    def authenticate(self, user: str, password: str) -> bool:
        return pam.authenticate(user, password, self.cfg.pam_service)

    # ------------------------------------------------------------ system
    def system_info(self) -> dict:
        osr = {}
        for line in read_file("/etc/os-release").splitlines():
            if "=" in line:
                k, v = line.split("=", 1)
                osr[k] = v.strip('"')
        model = read_file("/proc/device-tree/model").strip("\x00\n ")
        if not model:
            vendor = read_file("/sys/class/dmi/id/sys_vendor").strip()
            product = read_file("/sys/class/dmi/id/product_name").strip()
            model = " ".join(x for x in (vendor, product) if x and "O.E.M" not in x) or "Generic PC"
        cpu = ""
        for line in read_file("/proc/cpuinfo").splitlines():
            if line.lower().startswith(("model name", "hardware")):
                cpu = line.split(":", 1)[1].strip()
                break
        if not cpu:
            cp = run(["lscpu"], check=False, timeout=10)
            m = re.search(r"Model name:\s*(.+)", cp.stdout)
            cpu = m.group(1).strip() if m else pyplatform.machine()
        return {
            "hostname": socket.gethostname(), "os": osr.get("PRETTY_NAME", "Linux"),
            "kernel": pyplatform.release(), "arch": pyplatform.machine(), "model": model,
            "cpu": cpu, "cores": psutil.cpu_count() or 1,
            "memory": psutil.virtual_memory().total, "boot_time": psutil.boot_time(),
            "addresses": self.addresses(),
        }

    @staticmethod
    def addresses() -> List[dict]:
        out = []
        stats = psutil.net_if_stats()
        for iface, addrs in psutil.net_if_addrs().items():
            if iface == "lo" or iface.startswith(("docker", "veth", "br-", "virbr")):
                continue
            for a in addrs:
                if a.family == socket.AF_INET or (a.family == socket.AF_INET6
                                                  and not a.address.startswith("fe80")):
                    out.append({"iface": iface, "address": a.address.split("%")[0],
                                "family": 4 if a.family == socket.AF_INET else 6,
                                "up": bool(stats.get(iface) and stats[iface].isup),
                                "speed": stats[iface].speed if iface in stats else 0})
        return out

    # ------------------------------------------------------------ network (IPv4)
    NETPLAN_DIR = "/etc/netplan"
    IFUPDOWN = "/etc/network/interfaces"
    RESOLV = "/etc/resolv.conf"

    @staticmethod
    def _nm_split(line: str) -> List[str]:
        """nmcli -t output: fields separated by ':', with ':' inside values escaped."""
        return [f.replace("\\:", ":") for f in re.split(r"(?<!\\):", line)]

    def _nm_connection(self, iface: str) -> Optional[str]:
        if not shutil.which("nmcli"):
            return None
        if run(["systemctl", "is-active", "NetworkManager"], check=False, timeout=10).stdout.strip() != "active":
            return None
        out = run(["nmcli", "-t", "-f", "DEVICE,STATE,CONNECTION", "device"], check=False, timeout=15).stdout
        for line in out.splitlines():
            f = self._nm_split(line)
            if len(f) >= 3 and f[0] == iface and f[1].startswith("connected") and f[2]:
                return f[2]
        return None

    def _netplan_files(self) -> List[str]:
        return sorted(glob.glob(os.path.join(self.NETPLAN_DIR, "*.yaml")))

    def _talon_netplan(self, iface: str) -> str:
        return os.path.join(self.NETPLAN_DIR, f"90-talon-{iface}.yaml")

    def _ifupdown_file(self, iface: str) -> Optional[str]:
        from ..network import ifupdown_method
        files = [self.IFUPDOWN] + sorted(glob.glob("/etc/network/interfaces.d/*"))
        for f in files:
            if os.path.isfile(f) and ifupdown_method(read_file(f), iface):
                return f
        return None

    def _net_manager(self, iface: str):
        con = self._nm_connection(iface)
        if con:
            return "networkmanager", con
        if shutil.which("netplan") and self._netplan_files():
            return "netplan", None
        f = self._ifupdown_file(iface)
        if f and shutil.which("ifup"):
            return "ifupdown", f
        return None, None

    def _dns(self, iface: str, manager: Optional[str]) -> List[str]:
        if manager == "networkmanager":
            out = run(["nmcli", "-g", "IP4.DNS", "device", "show", iface], check=False, timeout=15).stdout
            return [d.strip() for d in re.split(r"[|\n]", out) if d.strip()]
        if shutil.which("resolvectl"):
            out = run(["resolvectl", "dns", iface], check=False, timeout=10).stdout
            if ":" in out:
                found = [d for d in out.split(":", 1)[1].split() if re.match(r"^\d+\.\d+\.\d+\.\d+$", d)]
                if found:
                    return found
        return [ln.split()[1] for ln in read_file("/etc/resolv.conf").splitlines()
                if ln.startswith("nameserver ") and len(ln.split()) > 1
                and not ln.split()[1].startswith("127.")]

    def net_interfaces(self) -> List[dict]:
        from ..network import ifupdown_method, mask_of
        try:
            links = json.loads(run(["ip", "-j", "link", "show"], timeout=10).stdout or "[]")
            addrs = json.loads(run(["ip", "-j", "-4", "addr", "show"], timeout=10).stdout or "[]")
            routes = json.loads(run(["ip", "-j", "-4", "route", "show", "default"], timeout=10).stdout or "[]")
        except (CommandError, ValueError):
            return []
        gw = {r.get("dev"): r.get("gateway") for r in routes if r.get("gateway")}
        out = []
        for ln in links:
            name = ln.get("ifname", "")
            if ln.get("link_type") != "ether" or name.startswith(("docker", "veth", "br-", "virbr", "tun", "tap")):
                continue
            if os.path.isdir(f"/sys/class/net/{name}/bridge") or not os.path.exists(f"/sys/class/net/{name}/device"):
                continue                       # bridges and virtual devices
            a4 = next((a for a in addrs if a.get("ifname") == name), {})
            info = next((x for x in a4.get("addr_info", []) if x.get("family") == "inet"), None)
            manager, ref = self._net_manager(name)
            if manager == "networkmanager":
                method = run(["nmcli", "-g", "ipv4.method", "connection", "show", ref],
                             check=False, timeout=15).stdout.strip()
                mode = "static" if method == "manual" else "dhcp"
            elif manager == "netplan":
                talon = read_file(self._talon_netplan(name))
                mode = "static" if "dhcp4: false" in talon else (
                    "dhcp" if talon or info is None or info.get("dynamic") else "static")
            elif manager == "ifupdown":
                mode = "static" if ifupdown_method(read_file(ref), name) == "static" else "dhcp"
            else:
                mode = "dhcp" if info and info.get("dynamic") else "static"
            wireless = os.path.isdir(f"/sys/class/net/{name}/wireless")
            out.append({
                "name": name, "mac": ln.get("address", ""), "up": "UP" in (ln.get("flags") or []),
                "wireless": wireless, "manager": manager, "mode": mode,
                "address": info["local"] if info else None,
                "prefix": info["prefixlen"] if info else None,
                "subnet": mask_of(info["prefixlen"]) if info else None,
                "gateway": gw.get(name), "dns": self._dns(name, manager) if info else [],
                "default": name in gw,
                "unsupported": None if manager else (
                    "Talon can change the network settings only when NetworkManager, "
                    "netplan or ifupdown manages the interface"),
            })
        out.sort(key=lambda i: (not i["default"], i["name"]))
        return out

    def net_apply(self, iface: str, cfg: dict, log: Logger) -> dict:
        """Apply cfg; returns what net_restore needs to undo it."""
        from ..network import ifupdown_replace, ifupdown_stanza, netplan_key, netplan_yaml
        manager, ref = self._net_manager(iface)
        if manager == "networkmanager":
            keys = ("ipv4.method", "ipv4.addresses", "ipv4.gateway", "ipv4.dns", "ipv4.ignore-auto-dns")
            old = {k: run(["nmcli", "-g", k, "connection", "show", ref], timeout=15).stdout.strip()
                   for k in keys}
            if cfg["mode"] == "static":
                new = {"ipv4.method": "manual", "ipv4.addresses": f"{cfg['address']}/{cfg['prefix']}",
                       "ipv4.gateway": cfg["gateway"], "ipv4.dns": " ".join(cfg["dns"]),
                       "ipv4.ignore-auto-dns": "yes"}
            else:
                new = {"ipv4.method": "auto", "ipv4.addresses": "", "ipv4.gateway": "",
                       "ipv4.dns": "", "ipv4.ignore-auto-dns": "no"}
            self._nm_set(ref, new, log)
            return {"manager": manager, "connection": ref, "old": old}
        if manager == "netplan":
            path = self._talon_netplan(iface)
            backup = read_file(path) if os.path.exists(path) else None
            others = [read_file(f) for f in self._netplan_files() if f != path]
            key, fixed = netplan_key(others, iface)
            if cfg["mode"] == "dhcp" and fixed:
                raise UserError(f"{iface} has a fixed address in another file in /etc/netplan; "
                                "remove it there to use DHCP")
            if cfg["mode"] == "dhcp":
                if os.path.exists(path):
                    os.unlink(path)            # back to the system's own (DHCP) configuration
            else:
                write_atomic(path, netplan_yaml(key, cfg), mode=0o600)
            try:
                run(["netplan", "generate"], log=log, timeout=60)
            except CommandError:
                self._netplan_put(path, backup)
                raise
            run(["netplan", "apply"], log=log, timeout=120)
            return {"manager": manager, "path": path, "backup": backup}
        if manager == "ifupdown":
            old = read_file(ref)
            new = ifupdown_replace(old, iface, ifupdown_stanza(iface, cfg))
            resolv = self.RESOLV
            resolv_old = read_file(resolv) if os.path.isfile(resolv) and not os.path.islink(resolv) else None
            write_atomic(ref, new or old)
            if cfg["mode"] == "static" and resolv_old is not None:
                write_atomic(resolv, "".join(f"nameserver {d}\n" for d in cfg["dns"]))
            self._ifupdown_cycle(iface, log)
            return {"manager": manager, "path": ref, "backup": old, "resolv": resolv_old}
        raise UserError("Talon cannot change the network settings on this system")

    def net_restore(self, iface: str, token: dict, log: Logger) -> None:
        if not token:
            return
        if token["manager"] == "networkmanager":
            self._nm_set(token["connection"], token["old"], log)
        elif token["manager"] == "netplan":
            self._netplan_put(token["path"], token["backup"])
            run(["netplan", "apply"], log=log, timeout=120)
        elif token["manager"] == "ifupdown":
            write_atomic(token["path"], token["backup"])
            if token.get("resolv") is not None:
                write_atomic(self.RESOLV, token["resolv"])
            self._ifupdown_cycle(iface, log)

    def _nm_set(self, con: str, values: Dict[str, str], log: Logger) -> None:
        args = ["nmcli", "connection", "modify", con]
        for k in ("ipv4.method", "ipv4.addresses", "ipv4.gateway", "ipv4.dns", "ipv4.ignore-auto-dns"):
            v = values.get(k, "")
            if k == "ipv4.ignore-auto-dns":
                v = "yes" if v in ("yes", "true") else "no"
            args += [k, v.replace(", ", ",")]
        run(args, log=log, timeout=30)
        run(["nmcli", "connection", "up", con], log=log, timeout=90)

    @staticmethod
    def _netplan_put(path: str, content: Optional[str]) -> None:
        if content is None:
            if os.path.exists(path):
                os.unlink(path)
        else:
            write_atomic(path, content, mode=0o600)

    @staticmethod
    def _ifupdown_cycle(iface: str, log: Logger) -> None:
        run(["ifdown", "--force", iface], check=False, log=log, timeout=60)
        run(["ifup", iface], log=log, timeout=120)

    def sample(self) -> dict:
        vm = psutil.virtual_memory()
        net = psutil.net_io_counters(pernic=True)
        rx = sum(v.bytes_recv for k, v in net.items() if k != "lo")
        tx = sum(v.bytes_sent for k, v in net.items() if k != "lo")
        try:
            io = psutil.disk_io_counters()
            rd, wr = (io.read_bytes, io.write_bytes) if io else (0, 0)
        except Exception:
            rd = wr = 0
        temp = None
        try:
            temps = psutil.sensors_temperatures()
            for key in ("cpu_thermal", "coretemp", "k10temp", "zenpower", "soc_thermal",
                        "cpu-thermal", "acpitz"):
                if temps.get(key):
                    temp = temps[key][0].current
                    break
        except Exception:
            pass
        return {"ts": time.time(), "cpu": psutil.cpu_percent(interval=None),
                "mem_used": vm.total - vm.available, "mem_total": vm.total,
                "load": list(os.getloadavg()), "temp": temp, "net_rx": rx, "net_tx": tx,
                "disk_read": rd, "disk_write": wr}

    def _unit(self, svc: str) -> Optional[str]:
        for u in SERVICES[svc]["units"]:
            cp = run(["systemctl", "show", "-p", "LoadState", "--value", u], check=False, timeout=10)
            if cp.stdout.strip() == "loaded":
                return u
        return None

    def _active(self, unit: str) -> bool:
        return run(["systemctl", "is-active", "--quiet", unit], check=False, timeout=10).returncode == 0

    def services(self) -> List[dict]:
        out = []
        for sid, meta in SERVICES.items():
            unit = self._unit(sid)
            active = enabled = False
            if unit:
                active = self._active(unit)
                en = run(["systemctl", "is-enabled", unit], check=False, timeout=10).stdout.strip()
                enabled = en in ("enabled", "alias", "static", "indirect")
            out.append({"id": sid, "unit": unit, "installed": bool(unit), "active": active,
                        "enabled": enabled, "label": meta["label"],
                        "description": meta["description"]})
        return out

    def service_action(self, sid: str, action: str) -> None:
        if sid not in SERVICES:
            raise UserError("Unknown service")
        unit = self._unit(sid)
        if not unit:
            raise UserError(f"{SERVICES[sid]['label']} is not installed")
        if action == "enable":
            run(["systemctl", "enable", "--now", unit])
        elif action == "disable":
            run(["systemctl", "disable", "--now", unit])
        if action in ("enable", "disable") and sid == "mdns":
            # the socket would start Bonjour again on the next request
            run(["systemctl", action, "--now", "avahi-daemon.socket"], check=False)
        elif action in ("start", "stop", "restart"):
            run(["systemctl", action, unit])
        else:
            raise UserError("Invalid action")

    def set_hostname(self, name: str) -> None:
        run(["hostnamectl", "set-hostname", name])
        hosts = read_file("/etc/hosts").splitlines()
        new, done = [], False
        for ln in hosts:
            if ln.startswith("127.0.1.1"):
                ln, done = f"127.0.1.1\t{name}", True
            new.append(ln)
        if not done:
            new.append(f"127.0.1.1\t{name}")
        write_atomic("/etc/hosts", "\n".join(new) + "\n")

    def timezone(self) -> str:
        cp = run(["timedatectl", "show", "-p", "Timezone", "--value"], check=False, timeout=10)
        return cp.stdout.strip() or read_file("/etc/timezone").strip() or "UTC"

    def timezones(self) -> List[str]:
        return sorted(zoneinfo.available_timezones())

    def set_timezone(self, tz: str) -> None:
        if tz not in zoneinfo.available_timezones():
            raise UserError("Unknown time zone")
        run(["timedatectl", "set-timezone", tz])

    def power(self, action: str) -> None:
        if action not in ("reboot", "poweroff"):
            raise UserError("Invalid power action")
        threading.Timer(2.0, run, args=(["systemctl", action],), kwargs={"check": False}).start()


def write_atomic_sys(path: str, value: str) -> None:
    try:
        with open(path, "w") as f:
            f.write(value)
    except OSError as e:
        raise CommandError(["write", path], 1, "", str(e)) from e
