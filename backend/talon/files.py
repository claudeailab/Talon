"""Web file browser for volumes: list, upload, download, new folder, rename,
move and delete. Every path is resolved inside a volume's mount point and
symlinks may not lead out of it. In demo mode a sandbox under the state
directory stands in for the volumes."""
from __future__ import annotations

import os
import shutil
import stat
import threading
import zipfile
from typing import Iterator, List, Optional, Tuple

from .util import UserError

HIDDEN = (".",)          # dot-files (.recycle, .versions, ...) are not shown
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

    # ------------------------------------------------------------ paths
    def volumes(self) -> List[dict]:
        return [{"name": v["name"], "mounted": v["mounted"] or self.demo}
                for v in self.nas.volumes()]

    def _root(self, volume: str) -> str:
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
            }
            for rel, size in samples.items():
                p = os.path.join(self._demo_root, rel)
                if not os.path.exists(p):
                    os.makedirs(os.path.dirname(p), exist_ok=True)
                    with open(p, "wb") as f:
                        f.truncate(size)            # sparse: takes no space
            self._seeded = True

    # ------------------------------------------------------------ listing
    def list(self, volume: str, path: str) -> dict:
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
        parent, _ = self.resolve(volume, path)
        target = os.path.join(parent, _name(name))
        if os.path.lexists(target):
            raise UserError(f"{name} already exists")
        os.mkdir(target, 0o2775)
        self._inherit(target)
        return _rel(f"{_rel(path)}/{name}")

    def rename(self, volume: str, path: str, name: str) -> str:
        src, root = self.resolve(volume, path)
        if src == root:
            raise UserError("The volume itself cannot be renamed")
        dst = os.path.join(os.path.dirname(src), _name(name))
        if os.path.lexists(dst):
            raise UserError(f"{name} already exists")
        os.rename(src, dst)
        return os.path.relpath(dst, root)

    def move(self, volume: str, items: List[str], dest_volume: str, dest: str) -> int:
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

    def delete(self, volume: str, items: List[str]) -> int:
        n = 0
        for rel in items:
            target, root = self.resolve(volume, rel)
            if target == root:
                raise UserError("The volume itself cannot be deleted")
            if os.path.isdir(target) and not os.path.islink(target):
                shutil.rmtree(target)
            else:
                os.unlink(target)
            n += 1
        return n

    # ------------------------------------------------------------ upload / download
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

