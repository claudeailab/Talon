"""Previous versions and the recycle bin of a volume.

Two hidden folders hold files that were replaced or deleted:

* ``.versions/<YYYY-MM-DD_HHMMSS>/<path>`` in the NAS folder of a OneDrive backup
  (rclone --backup-dir): the copy a run replaced or deleted. A file that still
  exists has *previous versions*; one that no longer exists is in the recycle bin.
* ``.recycle/<user>/<path>`` in a shared folder with the recycle bin turned on
  (Samba vfs_recycle): files deleted from Windows or macOS.

Both are kept for KEEP_DAYS days. Ids are paths relative to the volume root and
are only accepted when they lie inside one of these hidden folders."""
from __future__ import annotations

import datetime
import os
import re
import shutil
import time
from typing import List, Optional, Tuple

from .util import UserError

KEEP_DAYS = 30
VERSIONS = ".versions"
RECYCLE = ".recycle"
STAMP_RE = re.compile(r"^\d{4}-\d{2}-\d{2}_\d{6}$")
COPY_RE = re.compile(r"^Copy #\d+ of ")          # vfs_recycle: recycle:versions = yes
MAX_ITEMS = 5000


def _stamp_time(stamp: str) -> Optional[float]:
    try:
        return datetime.datetime.strptime(stamp, "%Y-%m-%d_%H%M%S").timestamp()
    except ValueError:
        return None


def _now_stamp() -> str:
    return time.strftime("%Y-%m-%d_%H%M%S")


def _free_name(path: str) -> str:
    """path, or "name (restored).ext", "name (restored 2).ext" if it is taken."""
    if not os.path.lexists(path):
        return path
    base, ext = os.path.splitext(path)
    for i in range(1, 1000):
        cand = f"{base} (restored{'' if i == 1 else ' ' + str(i)}){ext}"
        if not os.path.lexists(cand):
            return cand
    raise UserError("Too many restored copies")


def _prune_empty(path: str, stop: str) -> None:
    """Remove empty folders from path up to (not including) stop."""
    path = os.path.dirname(path)
    while path.startswith(stop + os.sep) and path != stop:
        try:
            os.rmdir(path)
        except OSError:
            return
        path = os.path.dirname(path)


class Restore:
    def __init__(self, nas):
        self.nas = nas

    # ------------------------------------------------------------ helpers
    def _root(self, volume: str) -> str:
        if ":" in volume:
            raise UserError("Previous versions and the recycle bin are on volumes only")
        return self.nas.files._root(volume)

    def _inside(self, root: str, rel: str) -> str:
        path = os.path.realpath(os.path.join(root, rel))
        if not path.startswith(root + os.sep):
            raise UserError("Invalid path")
        return path

    def _version_roots(self, volume: str, root: str) -> List[Tuple[str, str]]:
        """(folder that holds .versions, OneDrive task name) for this volume: the
        folders of its OneDrive tasks, and any other .versions near the top (left
        by a task that was deleted)."""
        out = {}
        for t in (self.nas.cloud._od().get("tasks") or {}).values():
            if t.get("volume") == volume:
                base = os.path.realpath(os.path.join(root, t.get("folder", "")))
                if os.path.isdir(os.path.join(base, VERSIONS)):
                    out[base] = t["name"]
        level, seen = [root], 0
        for _depth in range(4):
            nxt = []
            for d in level:
                if os.path.isdir(os.path.join(d, VERSIONS)):
                    out.setdefault(d, "OneDrive backup")
                try:
                    with os.scandir(d) as it:
                        for e in it:
                            if not e.name.startswith(".") and e.is_dir(follow_symlinks=False):
                                nxt.append(e.path)
                except OSError:
                    pass
                seen += 1
                if seen > 5000:
                    return list(out.items())
            level = nxt
        return list(out.items())

    def _recycle_roots(self, volume: str, root: str) -> List[Tuple[str, str]]:
        """(folder, name) of each .recycle on this volume: the volume's own (files
        deleted on the Files page) and each shared folder's (deleted from computers)."""
        out = [(root, volume)] if os.path.isdir(os.path.join(root, RECYCLE)) else []
        for s in self.nas.state.get("shares").values():
            if s.get("volume") != volume:
                continue
            base = os.path.realpath(os.path.join(root, s.get("folder", "")))
            if os.path.isdir(os.path.join(base, RECYCLE)):
                out.append((base, s["name"]))
        return out

    def _kind(self, root: str, path: str) -> Tuple[str, str, str]:
        """For a file inside .versions or .recycle: (kind, base folder, original path)."""
        rel = os.path.relpath(path, root).split(os.sep)
        for i, part in enumerate(rel):
            if part == VERSIONS and i + 2 < len(rel) and STAMP_RE.match(rel[i + 1]):
                base = os.path.join(root, *rel[:i])
                return "version", base, os.path.join(base, *rel[i + 2:])
            if part == RECYCLE and i + 2 < len(rel):
                base = os.path.join(root, *rel[:i])
                rest = rel[i + 2:]
                rest[-1] = COPY_RE.sub("", rest[-1])
                return "recycle", base, os.path.join(base, *rest)
        raise UserError("Not in the recycle bin or previous versions")

    # ------------------------------------------------------------ previous versions
    def versions(self, volume: str, path: str) -> List[dict]:
        root = self._root(volume)
        target = self._inside(root, path)
        out = []
        folder = os.path.dirname(target)
        while folder == root or folder.startswith(root + os.sep):
            store = os.path.join(folder, VERSIONS)
            if os.path.isdir(store):
                rel = os.path.relpath(target, folder)
                for stamp in os.listdir(store):
                    when = _stamp_time(stamp) if STAMP_RE.match(stamp) else None
                    p = os.path.join(store, stamp, rel)
                    if when and os.path.isfile(p) and not os.path.islink(p):
                        st = os.stat(p)
                        out.append({"id": os.path.relpath(p, root), "time": when, "size": st.st_size,
                                    "expires": when + KEEP_DAYS * 86400})
            if folder == root:
                break
            folder = os.path.dirname(folder)
        out.sort(key=lambda v: -v["time"])
        return out

    def restore_version(self, volume: str, path: str, vid: str) -> None:
        """Put a previous version back; the current file becomes a previous version."""
        root = self._root(volume)
        target = self._inside(root, path)
        src = self._inside(root, vid)
        kind, base, original = self._kind(root, src)
        if kind != "version" or original != target or not os.path.isfile(src):
            raise UserError("This version is not available")
        if os.path.isfile(target):
            keep = os.path.join(base, VERSIONS, _now_stamp(), os.path.relpath(target, base))
            os.makedirs(os.path.dirname(keep), exist_ok=True)
            shutil.move(target, keep)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        shutil.move(src, target)
        _prune_empty(src, os.path.join(base, VERSIONS))
        self.nas.files._inherit(target)

    def version_file(self, volume: str, vid: str) -> str:
        root = self._root(volume)
        src = self._inside(root, vid)
        self._kind(root, src)
        if not os.path.isfile(src):
            raise UserError("Not found")
        return src

    # ------------------------------------------------------------ recycle bin
    def bin(self, volume: str) -> dict:
        root = self._root(volume)
        items: List[dict] = []
        for base, share in self._recycle_roots(volume, root):
            store = os.path.join(base, RECYCLE)
            for user in sorted(os.listdir(store)):
                udir = os.path.join(store, user)
                if not os.path.isdir(udir):
                    continue
                for dirpath, _dirs, files in os.walk(udir):
                    for f in files:
                        p = os.path.join(dirpath, f)
                        try:
                            st = os.lstat(p)
                        except OSError:
                            continue
                        orig = os.path.relpath(os.path.join(base, os.path.relpath(dirpath, udir)), root)
                        items.append({"id": os.path.relpath(p, root), "name": COPY_RE.sub("", f),
                                      "was_in": os.path.normpath(orig), "by": user,
                                      "deleted": st.st_ctime, "size": st.st_size})
        for base, task in self._version_roots(volume, root):
            store = os.path.join(base, VERSIONS)
            for stamp in os.listdir(store):
                when = _stamp_time(stamp) if STAMP_RE.match(stamp) else None
                if not when:
                    continue
                sdir = os.path.join(store, stamp)
                for dirpath, _dirs, files in os.walk(sdir):
                    for f in files:
                        p = os.path.join(dirpath, f)
                        rel = os.path.relpath(p, sdir)
                        if os.path.lexists(os.path.join(base, rel)):
                            continue            # still there: a previous version, not deleted
                        try:
                            size = os.lstat(p).st_size
                        except OSError:
                            continue
                        items.append({"id": os.path.relpath(p, root), "name": f,
                                      "was_in": os.path.normpath(os.path.relpath(
                                          os.path.join(base, os.path.dirname(rel)), root)),
                                      "by": task, "deleted": when, "size": size})
        items.sort(key=lambda i: -i["deleted"])
        return {"volume": volume, "keep_days": KEEP_DAYS, "total": len(items), "items": items[:MAX_ITEMS]}

    def restore_items(self, volume: str, ids: List[str]) -> int:
        root = self._root(volume)
        n = 0
        for vid in ids:
            src = self._inside(root, vid)
            kind, base, original = self._kind(root, src)
            if not os.path.isfile(src):
                continue
            dest = _free_name(original)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            shutil.move(src, dest)
            _prune_empty(src, os.path.join(base, VERSIONS if kind == "version" else RECYCLE))
            self.nas.files._inherit(dest)
            n += 1
        return n

    def delete_items(self, volume: str, ids: Optional[List[str]] = None) -> int:
        """Delete these items for good, or everything in the volume's recycle bin."""
        root = self._root(volume)
        if ids is None:
            ids = [i["id"] for i in self.bin(volume)["items"]]
        n = 0
        for vid in ids:
            src = self._inside(root, vid)
            kind, base, _orig = self._kind(root, src)
            if os.path.isfile(src):
                os.unlink(src)
                _prune_empty(src, os.path.join(base, VERSIONS if kind == "version" else RECYCLE))
                n += 1
        return n

    # ------------------------------------------------------------ clean-up
    def purge(self) -> int:
        """Remove recycle bin files older than KEEP_DAYS (OneDrive tasks prune
        their own .versions after each run)."""
        cutoff = time.time() - KEEP_DAYS * 86400
        n = 0
        for v in self.nas.volumes():
            try:
                root = self._root(v["name"])
            except UserError:
                continue
            for base, _share in self._recycle_roots(v["name"], root):
                store = os.path.join(base, RECYCLE)
                for dirpath, _dirs, files in os.walk(store, topdown=False):
                    for f in files:
                        p = os.path.join(dirpath, f)
                        try:
                            if os.lstat(p).st_ctime < cutoff:
                                os.unlink(p)
                                n += 1
                        except OSError:
                            pass
                    if dirpath != store:
                        try:
                            os.rmdir(dirpath)
                        except OSError:
                            pass
        return n
