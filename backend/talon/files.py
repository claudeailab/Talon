"""Web file browser: list, upload, download, new folder, rename, move and delete.

Locations are the volumes, other disks with a filesystem (USB or internal; they
are mounted under /media/talon when first opened and can be ejected), and the
connected OneDrive (through Microsoft Graph, see odfiles.py). Every local path is
resolved inside its location's mount point and symlinks may not lead out of it.
In demo mode a sandbox under the state directory stands in for all of them."""
from __future__ import annotations

import os
import shutil
import stat
import threading
import time
import zipfile
from typing import Iterator, List, Optional, Tuple

from .util import UserError

HIDDEN = (".",)          # dot-files (.recycle, .versions, ...) are not shown
ONEDRIVE = "cloud:onedrive"
EXTERNAL = "ext:"
SUPPORTED_FS = ("vfat", "exfat", "ntfs", "ntfs3", "ext2", "ext3", "ext4", "xfs", "btrfs")
FS_LABEL = {"vfat": "FAT32", "exfat": "exFAT", "ntfs": "NTFS", "ntfs3": "NTFS"}
CHUNK = 1024 * 1024


def _rel(path: str) -> str:
    parts = [p for p in str(path or "").replace("\\", "/").split("/") if p not in ("", ".")]
    if any(p == ".." for p in parts) or any("\x00" in p for p in parts):
        raise UserError("Invalid path")
    return "/".join(parts)


def _name(name: str) -> str:
    name = str(name or "").strip()
    if not name or name in (".", "..") or "/" in name or "\\" in name or "\x00" in name \
            or len(name.encode()) > 255:
        raise UserError("Invalid name")
    if name.startswith("."):
        raise UserError("Names starting with a dot are hidden; choose another name")
    return name


class FileBrowser:
    def __init__(self, nas, demo: bool = False):
        self.nas = nas
        self.demo = demo
        self._demo_root = os.path.join(os.path.dirname(os.path.abspath(nas.cfg.state_file)),
                                       "demo-files")
        self._seeded = False
        self._lock = threading.Lock()
        self._demo_mounted: set = set()

    # ------------------------------------------------------------ locations
    def externals(self) -> List[dict]:
        """Partitions (or whole disks) with a filesystem that Talon does not use."""
        out = []
        for d in self.nas.disks():
            if d["status"] not in ("has_data", "mounted"):
                continue
            parts = d.get("partitions") or []
            cands = [(p["name"], p.get("fstype"), p.get("size") or 0, p.get("label"), p.get("mountpoints") or [])
                     for p in parts]
            if not parts and d.get("fstypes"):
                cands = [(d["name"], d["fstypes"][0], d["size"], None, d.get("mounts") or [])]
            for name, fs, size, label, mps in cands:
                if fs not in SUPPORTED_FS:
                    continue
                if any(m in ("/", "/boot", "/boot/efi", "/boot/firmware") or m.startswith("/srv/nas")
                       for m in mps):
                    continue
                mounted = bool(mps) or (self.demo and name in self._demo_mounted)
                out.append({"id": EXTERNAL + name, "kind": "usb" if d["kind"] == "usb" else "disk",
                            "name": label or d["model"], "dev": name, "fstype": fs, "size": size,
                            "detail": f"{name} · {FS_LABEL.get(fs, fs)}", "mounted": mounted,
                            "mountpoint": mps[0] if mps else None,
                            "ejectable": mounted and (not mps or mps[0].startswith("/media/talon/"))})
        return out

    def locations(self) -> List[dict]:
        out = [{"id": v["name"], "kind": "volume", "name": v["name"], "detail": "Volume",
                "mounted": v["mounted"] or self.demo, "ejectable": False}
               for v in self.nas.volumes()]
        out += [{k: e[k] for k in ("id", "kind", "name", "detail", "mounted", "ejectable")}
                for e in self.externals()]
        st = self.nas.cloud.status()
        if st["enabled"] and st["connected"]:
            out.append({"id": ONEDRIVE, "kind": "onedrive", "name": "OneDrive",
                        "detail": (st.get("account") or {}).get("email") or "Microsoft OneDrive",
                        "mounted": True, "ejectable": False})
        return out

    def is_remote(self, loc: str) -> bool:
        return loc == ONEDRIVE and not self.demo

    def _od(self):
        from .odfiles import OneDriveFiles
        st = self.nas.cloud.status()
        if not (st["enabled"] and st["connected"]):
            raise UserError("OneDrive is not connected")
        return OneDriveFiles(self.nas.cloud.access_token)

    def eject(self, loc: str) -> None:
        ext = next((e for e in self.externals() if e["id"] == loc), None)
        if not ext:
            raise UserError("Not found")
        if self.demo:
            self._demo_mounted.discard(ext["dev"])
            return
        if not ext["ejectable"]:
            raise UserError("This disk was mounted outside Talon")
        self.nas.p.unmount_external(ext["mountpoint"], lambda m: None)

    # ------------------------------------------------------------ paths
    def volumes(self) -> List[dict]:
        return [{"name": v["name"], "mounted": v["mounted"] or self.demo}
                for v in self.nas.volumes()]

    def _root(self, volume: str) -> str:
        if volume == ONEDRIVE:
            if not self.demo:
                raise UserError("Not a local location")
            root = os.path.join(self._demo_root, "@onedrive")
            self._seed()
            return os.path.realpath(root)
        if volume.startswith(EXTERNAL):
            ext = next((e for e in self.externals() if e["id"] == volume), None)
            if not ext:
                raise UserError("This disk is no longer available")
            if self.demo:
                self._demo_mounted.add(ext["dev"])
                self._seed()
                return os.path.realpath(os.path.join(self._demo_root, "@" + ext["dev"]))
            if ext["mountpoint"]:
                return os.path.realpath(ext["mountpoint"])
            return os.path.realpath(self.nas.p.mount_external(ext["dev"], ext["fstype"], lambda m: None))
        vols = {v["name"]: v for v in self.nas.volumes()}
        v = vols.get(volume)
        if not v:
            raise UserError(f"Volume {volume} not found")
        if self.demo:
            root = os.path.join(self._demo_root, volume)
            self._seed()
            os.makedirs(root, exist_ok=True)
            return os.path.realpath(root)
        if not v["mounted"]:
            raise UserError(f"Volume {volume} is not mounted")
        return os.path.realpath(v["mountpoint"])

    def resolve(self, volume: str, path: str, must_exist: bool = True) -> Tuple[str, str]:
        """(absolute path, volume root). Refuses anything outside the volume."""
        root = self._root(volume)
        target = os.path.realpath(os.path.join(root, _rel(path)))
        if target != root and not target.startswith(root + os.sep):
            raise UserError("Invalid path")
        if must_exist and not os.path.lexists(target):
            raise UserError("Not found")
        return target, root

    @staticmethod
    def _inherit(path: str) -> None:
        """Give new items the owner/group of their folder so SMB users keep access."""
        if os.geteuid() != 0:
            return
        try:
            st = os.stat(os.path.dirname(path))
            os.chown(path, st.st_uid, st.st_gid)
            os.chmod(path, 0o2775 if os.path.isdir(path) else 0o664)
        except OSError:
            pass

    # ------------------------------------------------------------ demo sandbox
    def _seed(self) -> None:
        if self._seeded:
            return
        with self._lock:
            if self._seeded:
                return
            samples = {
                "tank/Media/Photos/2025/Lake.jpg": 2_400_000,
                "tank/Media/Photos/2026/Birthday.jpg": 3_100_000,
                "tank/Media/Photos/Beach sunset.jpg": 4_200_000,
                "tank/Media/Photos/Album list.xlsx": 38_000,
                "tank/Media/Music/Playlist.m3u": 4_000,
                "tank/Documents/Invoices/Invoice 2026-01.pdf": 180_000,
                "tank/Documents/Lease agreement.pdf": 640_000,
                "tank/Office/Projects/Plan.docx": 52_000,
                "backup/TimeMachine/Readme.txt": 1_200,
                "@sdg1/Holiday 2025/Video 01.mp4": 48_000_000,
                "@sdg1/Holiday 2025/Video 02.mp4": 61_000_000,
                "@sdg1/Camera import/IMG_0412.jpg": 3_300_000,
                "@sdg1/Notes.txt": 3_000,
                "@onedrive/Documents/Car insurance.pdf": 220_000,
                "@onedrive/Documents/Lease agreement.pdf": 640_000,
                "@onedrive/Pictures/2026/Birthday.jpg": 2_900_000,
                "@onedrive/Pictures/Profile.png": 380_000,
                "@onedrive/Work/Projects/Plan.docx": 52_000,
                "@onedrive/Notes.txt": 2_000,
            }
            # previous versions and the recycle bin (see restore.py)
            def stamp(days):            # a fixed time of day: the same paths on every start
                return time.strftime("%Y-%m-%d_020000", time.localtime(time.time() - days * 86400))
            samples.update({
                f"tank/Media/Photos/.versions/{stamp(1)}/Album list.xlsx": 36_000,
                f"tank/Media/Photos/.versions/{stamp(7)}/Album list.xlsx": 35_000,
                f"tank/Media/Photos/.versions/{stamp(3)}/2024/Old harbour.jpg": 2_100_000,
                "tank/Documents/.recycle/alice/Invoices/Invoice 2025-12.pdf": 170_000,
                "tank/Documents/.recycle/admin/Old budget.xlsx": 88_000,
            })
            for rel, size in samples.items():
                p = os.path.join(self._demo_root, rel)
                if not os.path.exists(p):
                    os.makedirs(os.path.dirname(p), exist_ok=True)
                    with open(p, "wb") as f:
                        f.truncate(size)            # sparse: takes no space
            self._seeded = True

    # ------------------------------------------------------------ listing
    def list(self, volume: str, path: str) -> dict:
        if self.is_remote(volume):
            return {"volume": volume, "path": _rel(path), "items": self._od().list(_rel(path))}
        target, root = self.resolve(volume, path)
        if not os.path.isdir(target):
            raise UserError("Not a folder")
        items = []
        with os.scandir(target) as it:
            for e in it:
                if e.name.startswith(HIDDEN):
                    continue
                try:
                    st = e.stat(follow_symlinks=False)
                except OSError:
                    continue
                if stat.S_ISLNK(st.st_mode):
                    continue                        # symlinks are not followed
                folder = stat.S_ISDIR(st.st_mode)
                count = None
                if folder:
                    try:
                        count = sum(1 for n in os.listdir(e.path) if not n.startswith(HIDDEN))
                    except OSError:
                        count = 0
                items.append({"name": e.name, "folder": folder,
                              "size": 0 if folder else st.st_size,
                              "modified": st.st_mtime, "count": count})
        items.sort(key=lambda i: (not i["folder"], i["name"].lower()))
        return {"volume": volume, "path": _rel(path), "items": items}

    # ------------------------------------------------------------ changes
    def mkdir(self, volume: str, path: str, name: str) -> str:
        if self.is_remote(volume):
            self._od().mkdir(_rel(path), _name(name))
            return _rel(f"{_rel(path)}/{name}")
        parent, _ = self.resolve(volume, path)
        target = os.path.join(parent, _name(name))
        if os.path.lexists(target):
            raise UserError(f"{name} already exists")
        os.mkdir(target, 0o2775)
        self._inherit(target)
        return _rel(f"{_rel(path)}/{name}")

    def rename(self, volume: str, path: str, name: str) -> str:
        if self.is_remote(volume):
            rel = _rel(path)
            if not rel:
                raise UserError("OneDrive itself cannot be renamed")
            self._od().rename(rel, _name(name))
            return _rel(f"{os.path.dirname(rel)}/{name}")
        src, root = self.resolve(volume, path)
        if src == root:
            raise UserError("The volume itself cannot be renamed")
        dst = os.path.join(os.path.dirname(src), _name(name))
        if os.path.lexists(dst):
            raise UserError(f"{name} already exists")
        os.rename(src, dst)
        return os.path.relpath(dst, root)

    def move(self, volume: str, items: List[str], dest_volume: str, dest: str) -> int:
        if (volume == ONEDRIVE) != (dest_volume == ONEDRIVE):
            raise UserError("Files cannot be moved between OneDrive and the NAS here; "
                            "download and upload them, or use a OneDrive task")
        if self.is_remote(volume):
            od, dest = self._od(), _rel(dest)
            for rel in items:
                rel = _rel(rel)
                if dest == rel or dest.startswith(rel + "/"):
                    raise UserError(f"Cannot move {os.path.basename(rel)} into itself")
                od.move(rel, dest)
            return len(items)
        dst_dir, _ = self.resolve(dest_volume, dest)
        if not os.path.isdir(dst_dir):
            raise UserError("The destination is not a folder")
        moved = 0
        for rel in items:
            src, root = self.resolve(volume, rel)
            if src == root:
                raise UserError("The volume itself cannot be moved")
            if dst_dir == src or dst_dir.startswith(src + os.sep):
                raise UserError(f"Cannot move {os.path.basename(src)} into itself")
            target = os.path.join(dst_dir, os.path.basename(src))
            if os.path.lexists(target):
                raise UserError(f"{os.path.basename(src)} already exists in the destination")
            shutil.move(src, target)
            moved += 1
        return moved

    def delete(self, volume: str, items: List[str], user: str = "talon") -> int:
        """Delete items. On a volume they go to its recycle bin (.recycle/<user>/ at
        the volume's top, kept 30 days); on other disks they are deleted for good;
        on OneDrive they go to the OneDrive recycle bin."""
        if self.is_remote(volume):
            od = self._od()
            for rel in items:
                od.delete(_rel(rel))
            return len(items)
        n = 0
        for rel in items:
            target, root = self.resolve(volume, rel)
            if target == root:
                raise UserError("The volume itself cannot be deleted")
            if self.has_bin(volume):
                self._to_bin(root, target, user)
            elif os.path.isdir(target) and not os.path.islink(target):
                shutil.rmtree(target)
            else:
                os.unlink(target)
            n += 1
        return n

    @staticmethod
    def has_bin(volume: str) -> bool:
        """Volumes have a recycle bin; USB and other disks and OneDrive do not."""
        return volume != ONEDRIVE and not volume.startswith(EXTERNAL)

    def _to_bin(self, root: str, target: str, user: str) -> None:
        rel = os.path.relpath(target, root)
        if rel.split(os.sep)[0] in (".recycle", ".versions"):
            raise UserError("Not allowed")
        dest = os.path.join(root, ".recycle", user or "talon", rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        n = 2
        while os.path.lexists(dest):                 # deleted before: "Copy #2 of name"
            dest = os.path.join(os.path.dirname(dest), f"Copy #{n} of {os.path.basename(rel)}")
            n += 1
        os.rename(target, dest)
        # mark when it was deleted: the recycle bin uses each file's change time.
        # Setting the times to their own values updates the change time and keeps
        # the modified date; files inside a deleted folder need it too.
        paths = [dest]
        if os.path.isdir(dest) and not os.path.islink(dest):
            for dirpath, _dirs, files in os.walk(dest):
                paths += [os.path.join(dirpath, f) for f in files]
        for p in paths:
            try:
                st = os.lstat(p)
                os.utime(p, ns=(st.st_atime_ns, st.st_mtime_ns), follow_symlinks=False)
            except (OSError, NotImplementedError):
                pass

    # ------------------------------------------------------------ upload / download
    def upload_remote(self, path: str, name: str, src: str, overwrite: bool) -> None:
        self._od().upload(_rel(path), _name(name), src, overwrite)

    def upload_target(self, volume: str, path: str, name: str, overwrite: bool) -> str:
        parent, _ = self.resolve(volume, path)
        if not os.path.isdir(parent):
            raise UserError("Not a folder")
        target = os.path.join(parent, _name(name))
        if os.path.isdir(target):
            raise UserError(f"A folder named {name} exists")
        if os.path.exists(target) and not overwrite:
            raise UserError(f"{name} already exists")
        return target

    def download_remote(self, items: List[str]) -> Tuple[str, Optional[str], Optional[Iterator[bytes]]]:
        """(name, redirect URL for a single file, or a zip stream) from OneDrive."""
        od = self._od()
        rels = [_rel(i) for i in items]
        if len(rels) == 1 and "file" in od.info(rels[0]):
            return os.path.basename(rels[0]), od.download_url(rels[0]), None
        parents = {os.path.dirname(r) for r in rels}
        name = os.path.basename(rels[0]) if len(rels) == 1 else (
            os.path.basename(parents.pop()) if len(parents) == 1 and list(parents)[0] else "OneDrive")
        return f"{name or 'OneDrive'}.zip", None, od.zip_stream(rels)

    def download(self, volume: str, items: List[str]) -> Tuple[str, Optional[str], Optional[Iterator[bytes]]]:
        """(download name, file path for a single file, or a zip stream)."""
        if not items:
            raise UserError("Nothing selected")
        paths = [self.resolve(volume, rel) for rel in items]
        if len(paths) == 1 and os.path.isfile(paths[0][0]):
            return os.path.basename(paths[0][0]), paths[0][0], None
        if len(paths) == 1:
            name = os.path.basename(paths[0][0])
        else:            # several items: name the zip after their common folder
            parents = {os.path.dirname(t) for t, _ in paths}
            parent = parents.pop() if len(parents) == 1 else paths[0][1]
            name = volume if parent == paths[0][1] else os.path.basename(parent)
        return f"{name}.zip", None, self._zip_stream(paths)

    @staticmethod
    def _zip_stream(paths: List[Tuple[str, str]]) -> Iterator[bytes]:
        """Stream a zip without building it in memory or on disk."""
        r, w = os.pipe()

        def writer():
            try:
                with os.fdopen(w, "wb") as out, \
                        zipfile.ZipFile(out, "w", zipfile.ZIP_STORED, allowZip64=True) as z:
                    for target, _root in paths:
                        base = os.path.dirname(target)
                        if os.path.isfile(target):
                            z.write(target, os.path.relpath(target, base))
                            continue
                        for dirpath, dirs, files in os.walk(target):
                            dirs[:] = [d for d in dirs if not d.startswith(HIDDEN)]
                            for fn in files:
                                full = os.path.join(dirpath, fn)
                                if fn.startswith(HIDDEN) or os.path.islink(full):
                                    continue
                                z.write(full, os.path.relpath(full, base))
            except (OSError, BrokenPipeError):
                pass
        threading.Thread(target=writer, daemon=True, name="zip").start()
        with os.fdopen(r, "rb") as f:
            while True:
                chunk = f.read(CHUNK)
                if not chunk:
                    break
                yield chunk

