"""WebDAV: the shared folders over HTTPS, at https://<nas>/dav/.

For apps that cannot use SMB from outside the home network, for example a photo
backup app on a phone through a Cloudflare tunnel, and for file managers that
speak WebDAV. Sign in with a Talon user name and password (local users; Entra ID
users have no password Talon knows). Each user sees the shared folders they may
open, with the same Read or Read & write access as over SMB, including folder
permissions. Deleted files go to the shared folder's recycle bin when it is on.

Implements what clients use: OPTIONS, PROPFIND (depth 0 and 1), GET/HEAD (with
ranges), PUT, DELETE, MKCOL, MOVE, COPY, PROPPATCH and LOCK/UNLOCK (advisory, for
Windows and macOS Finder)."""
from __future__ import annotations

import base64
import email.utils
import hashlib
import html
import mimetypes
import os
import secrets
import shutil
import tempfile
import threading
import time
import urllib.parse
from typing import Dict, List, Optional, Tuple
from xml.etree import ElementTree as ET

from starlette.requests import Request

from .folderperms import has_default_acl
from starlette.responses import FileResponse, Response


PREFIX = "/dav"
HIDDEN = {".recycle", ".versions", ".talon-quarantine", "lost+found"}
# administrators also see each mounted volume as "Volume <name>" (a shared folder's name
# cannot contain a space, so it never clashes with one)
VOLUME_PREFIX = "Volume "
ORDER = {"none": 0, "ro": 1, "rw": 2}
AUTH_CACHE_SECONDS = 300
FAIL_LIMIT, FAIL_WINDOW = 10, 300


class DavError(Exception):
    def __init__(self, status: int, text: str = ""):
        super().__init__(text)
        self.status = status
        self.text = text


def _http_date(ts: float) -> str:
    return email.utils.formatdate(ts, usegmt=True)


def _iso(ts: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts))


def _etag(st: os.stat_result) -> str:
    return '"%x-%x"' % (int(st.st_mtime * 1000), st.st_size)


class WebDav:
    """An ASGI app mounted at /dav."""

    def __init__(self, nas, platform, demo: bool = False):
        self.nas = nas
        self.p = platform
        self.demo = demo
        self._auth: Dict[str, Tuple[str, float]] = {}       # hash of the header -> (user, until)
        self._fails: Dict[str, List[float]] = {}
        self._locks: Dict[str, str] = {}
        self._lock = threading.Lock()
        self._counts: Dict[Tuple[str, str, str], int] = {}
        self._counts_flushed = time.time()
        self._users_cache: Tuple[float, Dict[str, dict]] = (0.0, {})

    def _users(self, fresh: bool = False) -> Dict[str, dict]:
        """The local users, refreshed every 30 seconds (each request needs them)."""
        at, users = self._users_cache
        if fresh or time.time() - at > 30:
            users = {u["name"]: u for u in self.nas.users()}
            self._users_cache = (time.time(), users)
        return users

    # ------------------------------------------------------------ on / off
    def enabled(self) -> bool:
        return bool((self.nas.state.get("webdav") or {}).get("enabled"))

    def set_enabled(self, on: bool, user: str) -> None:
        self.nas.state.update(lambda d: d.__setitem__("webdav", {"enabled": bool(on)}))
        self.nas.state.log_activity(user, f"WebDAV {'enabled' if on else 'disabled'}", "info", "services")

    def service_info(self) -> dict:
        on = self.enabled()
        return {"id": "webdav", "unit": None, "installed": True, "active": on, "enabled": on,
                "label": "WebDAV", "description": "Shared folders (and volumes, for administrators) over HTTPS at /dav, for apps and remote access", "app": True}

    # ------------------------------------------------------------ ASGI
    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return
        request = Request(scope, receive)
        try:
            resp = await self._handle(request)
        except DavError as e:
            resp = Response(e.text, status_code=e.status, media_type="text/plain")
            if e.status == 401:
                resp.headers["WWW-Authenticate"] = 'Basic realm="Talon", charset="UTF-8"'
        except PermissionError:
            resp = Response("Forbidden", status_code=403)
        except FileNotFoundError:
            resp = Response("Not found", status_code=404)
        resp.headers["DAV"] = "1, 2"
        # Settings → Date format, so apps name folders the same way (the iPhone app's photo backup)
        resp.headers["X-Talon-Date-Format"] = (self.nas.state.get("settings") or {}).get("date_format") or "dd-mm-yyyy"
        resp.headers["MS-Author-Via"] = "DAV"
        await resp(scope, receive, send)

    async def _handle(self, req: Request) -> Response:
        if not self.enabled():
            raise DavError(404, "WebDAV is turned off. An administrator can turn it on under Services.")
        if req.method == "OPTIONS" and not req.headers.get("authorization"):
            return self._options()
        user = await self._user(req)
        self._flush_counts()
        rel = self._rel(req.scope.get("path", ""))
        m = req.method.upper()
        if m == "OPTIONS":
            return self._options()
        if m == "PROPFIND":
            return await self._propfind(req, user, rel)
        if m in ("GET", "HEAD"):
            return self._get(req, user, rel)
        if m == "PUT":
            return await self._put(req, user, rel)
        if m == "DELETE":
            return self._delete(user, rel)
        if m == "MKCOL":
            return self._mkcol(user, rel)
        if m in ("MOVE", "COPY"):
            return self._move_copy(req, user, rel, m == "MOVE")
        if m == "PROPPATCH":
            return await self._proppatch(req, user, rel)
        if m == "LOCK":
            return await self._lock_(req, user, rel)
        if m == "UNLOCK":
            return Response(status_code=204)
        raise DavError(405, "Method not allowed")

    def _options(self) -> Response:
        return Response(status_code=200, headers={
            "Allow": "OPTIONS, PROPFIND, PROPPATCH, GET, HEAD, PUT, DELETE, MKCOL, MOVE, COPY, LOCK, UNLOCK",
            "Content-Length": "0"})

    # ------------------------------------------------------------ sign-in
    async def _user(self, req: Request) -> str:
        ip = req.client.host if req.client else "?"
        hdr = req.headers.get("authorization", "")
        if not hdr.lower().startswith("basic "):
            raise DavError(401, "Sign in with your Talon user name and password")
        key = hashlib.sha256(hdr.encode()).hexdigest()
        now = time.time()
        with self._lock:
            hit = self._auth.get(key)
            if hit and hit[1] > now:
                return hit[0]
            fails = [t for t in self._fails.get(ip, []) if now - t < FAIL_WINDOW]
            self._fails[ip] = fails
        if len(fails) >= FAIL_LIMIT:
            raise DavError(429, "Too many failed sign-ins. Try again in 5 minutes.")
        try:
            user, _, password = base64.b64decode(hdr[6:]).decode("utf-8").partition(":")
        except (ValueError, UnicodeDecodeError):
            raise DavError(401, "Invalid sign-in") from None
        user = user.strip().lower()
        known = self._users()
        if user not in known:                  # a user added in the last 30 seconds
            known = self._users(fresh=True)
        ok = user in known and not known[user].get("disabled") and await _threaded(self.p.authenticate, user, password)
        if not ok:
            with self._lock:
                self._fails.setdefault(ip, []).append(now)
            self.nas.state.log_activity(user or "?", f"Failed WebDAV sign-in from {ip}", "warning", "signin")
            try:
                self.nas.notifier.login_failed(user, ip)
            except Exception:   # noqa: BLE001
                pass
            raise DavError(401, "Wrong user name or password")
        with self._lock:
            self._auth[key] = (user, now + AUTH_CACHE_SECONDS)
            if len(self._auth) > 500:
                self._auth = {k: v for k, v in self._auth.items() if v[1] > now}
        return user

    # ------------------------------------------------------------ paths and access
    @staticmethod
    def _rel(path: str) -> List[str]:
        """The path inside /dav as parts: [] is the list of shared folders."""
        path = urllib.parse.unquote(path)
        if path.startswith(PREFIX):
            path = path[len(PREFIX):]
        parts = [p for p in path.split("/") if p not in ("", ".")]
        if any(p == ".." or "\x00" in p for p in parts):
            raise DavError(400, "Invalid path")
        if any(p in HIDDEN for p in parts):
            raise DavError(404, "Not found")
        return parts

    def _access(self, user: str, share: dict) -> str:
        groups = set((self._users().get(user) or {}).get("groups", []))
        best = share.get("users", {}).get(user, "none")
        for g, a in share.get("groups", {}).items():
            if g == self.nas.cfg.users_group or g in groups:
                if ORDER.get(a, 0) > ORDER.get(best, 0):
                    best = a
        return best

    def _share_dir(self, s: dict) -> Optional[str]:
        """The folder of a shared folder; in demo mode inside the Files sandbox."""
        if not s.get("path"):
            return None
        if not self.demo:
            return s["path"]
        vol = (self.nas.state.get("volumes") or {}).get(s["volume"]) or {}
        rel = os.path.relpath(s["path"], vol.get("mountpoint") or "/")
        path = os.path.join(self.nas.files._root(s["volume"]), rel)
        os.makedirs(path, exist_ok=True)
        return path

    def _shares(self, user: str) -> Dict[str, Tuple[dict, str]]:
        out = {}
        for s in self.nas.shares():
            s = {**s, "path": self._share_dir(s)}
            if s["path"] and os.path.isdir(s["path"]):
                a = self._access(user, s)
                if a != "none":
                    out[s["name"]] = (s, a)
        if (self._users().get(user) or {}).get("admin"):
            out.update(self._volumes())
        return out

    def _volumes(self) -> Dict[str, Tuple[dict, str]]:
        """Whole volumes, for administrators: any folder on them, e.g. for a photo backup
        that is not in a shared folder. Deleted items go to the volume's recycle bin."""
        out = {}
        for v in self.nas.files.volumes():
            if not v["mounted"]:
                continue
            try:
                path = self.nas.files._root(v["name"])
            except Exception:   # noqa: BLE001 - a volume that is not available right now
                continue
            if os.path.isdir(path):
                name = VOLUME_PREFIX + v["name"]
                out[name] = ({"name": name, "path": path, "volume": v["name"], "users": {}, "groups": {},
                              "smb": {"recycle_bin": True}}, "rw")
        return out

    def _resolve(self, user: str, parts: List[str], write: bool = False) -> Tuple[str, dict, str]:
        """(filesystem path, share, access) for a path inside a shared folder."""
        if not parts:
            raise DavError(403, "Choose a shared folder")
        shares = self._shares(user)
        hit = next((v for k, v in shares.items() if k.lower() == parts[0].lower()), None)
        if not hit:
            raise DavError(404, "Not found")
        share, access = hit
        root = os.path.realpath(share["path"])
        target = os.path.join(root, *parts[1:])
        real = os.path.realpath(target)
        if real != root and not real.startswith(root + os.sep):
            raise DavError(403, "Outside the shared folder")
        access = self._folder_access(user, share, root, target, access)
        if access == "none":                                  # a folder with custom permissions
            raise DavError(404, "Not found")
        if write and access != "rw":
            raise DavError(403, "You can only read this folder")
        return target, share, access

    def _folder_access(self, user: str, share: dict, root: str, target: str, access: str) -> str:
        """Folder permissions (Files → Permissions) can narrow what the share allows."""
        perms = getattr(self.nas, "folder_perms", None)
        if not perms:
            return access
        return perms.effective(user, root, target, access)

    def _href(self, parts: List[str], is_dir: bool) -> str:
        h = PREFIX + "/" + "/".join(urllib.parse.quote(p) for p in parts)
        return h + "/" if is_dir and not h.endswith("/") else h

    # ------------------------------------------------------------ PROPFIND
    async def _propfind(self, req: Request, user: str, parts: List[str]) -> Response:
        depth = req.headers.get("depth", "1")
        await req.body()
        entries: List[Tuple[List[str], Optional[os.stat_result], Optional[str]]] = []
        if not parts:
            entries.append(([], None, None))
            if depth != "0":
                for name, (share, _a) in sorted(self._shares(user).items(), key=lambda x: x[0].lower()):
                    entries.append(([name], os.stat(share["path"]), share["path"]))
        else:
            target, share, _a = self._resolve(user, parts)
            if not os.path.lexists(target):
                raise DavError(404, "Not found")
            parts = [share["name"]] + parts[1:]
            st = os.stat(target)
            entries.append((parts, st, target))
            if depth != "0" and os.path.isdir(target):
                with os.scandir(target) as it:
                    for e in sorted(it, key=lambda e: e.name.lower()):
                        if e.name in HIDDEN or e.name.startswith(".talon-upload-"):
                            continue
                        try:
                            entries.append((parts + [e.name], e.stat(), e.path))
                        except OSError:
                            continue
        root = ET.Element("{DAV:}multistatus")
        for p, st, path in entries:
            r = ET.SubElement(root, "{DAV:}response")
            is_dir = st is None or (st is not None and _isdir(st))
            ET.SubElement(r, "{DAV:}href").text = self._href(p, is_dir)
            ps = ET.SubElement(r, "{DAV:}propstat")
            prop = ET.SubElement(ps, "{DAV:}prop")
            ET.SubElement(prop, "{DAV:}displayname").text = p[-1] if p else "Talon"
            rt = ET.SubElement(prop, "{DAV:}resourcetype")
            if is_dir:
                ET.SubElement(rt, "{DAV:}collection")
            if st is not None:
                ET.SubElement(prop, "{DAV:}getlastmodified").text = _http_date(st.st_mtime)
                ET.SubElement(prop, "{DAV:}creationdate").text = _iso(st.st_ctime)
                ET.SubElement(prop, "{DAV:}getetag").text = _etag(st)
                if not is_dir:
                    ET.SubElement(prop, "{DAV:}getcontentlength").text = str(st.st_size)
                    ET.SubElement(prop, "{DAV:}getcontenttype").text = mimetypes.guess_type(p[-1])[0] or "application/octet-stream"
                elif path:
                    try:
                        vfs = os.statvfs(path)
                        ET.SubElement(prop, "{DAV:}quota-available-bytes").text = str(vfs.f_bavail * vfs.f_frsize)
                        ET.SubElement(prop, "{DAV:}quota-used-bytes").text = str((vfs.f_blocks - vfs.f_bfree) * vfs.f_frsize)
                    except OSError:
                        pass
            sl = ET.SubElement(prop, "{DAV:}supportedlock")
            le = ET.SubElement(sl, "{DAV:}lockentry")
            ET.SubElement(ET.SubElement(le, "{DAV:}lockscope"), "{DAV:}exclusive")
            ET.SubElement(ET.SubElement(le, "{DAV:}locktype"), "{DAV:}write")
            ET.SubElement(ps, "{DAV:}status").text = "HTTP/1.1 200 OK"
        return _xml(root)

    # ------------------------------------------------------------ GET
    def _get(self, req: Request, user: str, parts: List[str]) -> Response:
        if not parts:
            return self._listing(user, [], [(n, True) for n in sorted(self._shares(user), key=str.lower)])
        target, share, _a = self._resolve(user, parts)
        if not os.path.exists(target):
            raise DavError(404, "Not found")
        if os.path.isdir(target):
            items = sorted(((e.name, e.is_dir()) for e in os.scandir(target) if e.name not in HIDDEN), key=lambda x: (not x[1], x[0].lower()))
            return self._listing(user, [share["name"]] + parts[1:], items)
        st = os.stat(target)
        return FileResponse(target, stat_result=st, headers={"ETag": _etag(st), "Last-Modified": _http_date(st.st_mtime)},
                            content_disposition_type="inline")

    def _listing(self, user: str, parts: List[str], items: List[Tuple[str, bool]]) -> Response:
        rows = "".join(f'<li><a href="{html.escape(self._href(parts + [n], d))}">{html.escape(n)}{"/" if d else ""}</a></li>' for n, d in items)
        up = f'<p><a href="{html.escape(self._href(parts[:-1], True))}">↑ Up</a></p>' if parts else ""
        title = html.escape("/" + "/".join(parts))
        return Response(f"<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'>"
                        f"<title>Talon WebDAV {title}</title><body style='font:15px system-ui;margin:24px'>"
                        f"<h3>{title}</h3>{up}<ul>{rows}</ul><p style='color:#888'>Signed in as {html.escape(user)}</p>",
                        media_type="text/html")

    # ------------------------------------------------------------ PUT
    async def _put(self, req: Request, user: str, parts: List[str]) -> Response:
        if len(parts) < 2:
            raise DavError(403, "Files go inside a shared folder")
        target, share, _a = self._resolve(user, parts, write=True)
        if os.path.isdir(target):
            raise DavError(405, "A folder with this name exists")
        parent = os.path.dirname(target)
        if not os.path.isdir(parent):
            raise DavError(409, "The folder does not exist")
        existed = os.path.exists(target)
        fd, tmp = tempfile.mkstemp(prefix=".talon-upload-", dir=parent)
        try:
            with os.fdopen(fd, "wb") as f:
                async for chunk in req.stream():
                    f.write(chunk)
            mtime = req.headers.get("x-oc-mtime")              # Nextcloud-style clients send the original date
            if mtime and mtime.isdigit():
                os.utime(tmp, (time.time(), int(mtime)))
            os.replace(tmp, target)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
        self._own(target, user)
        self._count(user, share["name"], "uploaded")
        st = os.stat(target)
        headers = {"ETag": _etag(st)}
        if req.headers.get("x-oc-mtime"):
            headers["X-OC-MTime"] = "accepted"
        return Response(status_code=204 if existed else 201, headers=headers)

    def _own(self, path: str, user: str) -> None:
        """Like Samba: owned by the user, group NAS users, readable and writable for the group."""
        if self.demo or os.geteuid() != 0:
            return
        try:
            import grp
            import pwd
            uid = pwd.getpwnam(user).pw_uid
            gid = grp.getgrnam(self.nas.cfg.users_group).gr_gid
            os.chown(path, uid, gid)
            if not has_default_acl(os.path.dirname(path)):       # else the folder permissions decide
                os.chmod(path, 0o2775 if os.path.isdir(path) else 0o664)
        except (KeyError, OSError):
            pass

    # ------------------------------------------------------------ DELETE / MKCOL
    def _delete(self, user: str, parts: List[str]) -> Response:
        if len(parts) < 2:
            raise DavError(403, "Shared folders cannot be deleted here")
        target, share, _a = self._resolve(user, parts, write=True)
        if not os.path.lexists(target):
            raise DavError(404, "Not found")
        root = os.path.realpath(share["path"])
        if (share.get("smb") or {}).get("recycle_bin"):
            rel = os.path.relpath(target, root)
            dest = os.path.join(root, ".recycle", user, rel)
            if os.path.lexists(dest):
                base, ext = os.path.splitext(dest)
                dest = f"{base} ({time.strftime('%Y-%m-%d %H%M%S')}){ext}"
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            shutil.move(target, dest)
            os.utime(dest)                                    # the 30 days start now
        elif os.path.isdir(target) and not os.path.islink(target):
            shutil.rmtree(target)
        else:
            os.unlink(target)
        self._count(user, share["name"], "deleted")
        return Response(status_code=204)

    def _mkcol(self, user: str, parts: List[str]) -> Response:
        if len(parts) < 2:
            raise DavError(403, "Create folders inside a shared folder")
        target, _share, _a = self._resolve(user, parts, write=True)
        if os.path.lexists(target):
            raise DavError(405, "It already exists")
        if not os.path.isdir(os.path.dirname(target)):
            raise DavError(409, "The parent folder does not exist")
        os.mkdir(target)
        self._own(target, user)
        return Response(status_code=201)

    # ------------------------------------------------------------ MOVE / COPY
    def _move_copy(self, req: Request, user: str, parts: List[str], move: bool) -> Response:
        if len(parts) < 2:
            raise DavError(403, "Shared folders cannot be moved here")
        src, share, _a = self._resolve(user, parts, write=move)
        if not os.path.lexists(src):
            raise DavError(404, "Not found")
        dest_hdr = req.headers.get("destination", "")
        if not dest_hdr:
            raise DavError(400, "Missing Destination")
        dpath = urllib.parse.urlparse(dest_hdr).path
        if not dpath.startswith(PREFIX + "/"):
            raise DavError(502, "The destination is not on this server")
        dparts = self._rel(dpath)
        if len(dparts) < 2:
            raise DavError(403, "Choose a folder inside a shared folder")
        dest, dshare, _da = self._resolve(user, dparts, write=True)
        if os.path.realpath(dest) == os.path.realpath(src):
            raise DavError(403, "Source and destination are the same")
        if os.path.isdir(src) and os.path.realpath(dest).startswith(os.path.realpath(src) + os.sep):
            raise DavError(409, "A folder cannot go inside itself")
        if not os.path.isdir(os.path.dirname(dest)):
            raise DavError(409, "The destination folder does not exist")
        existed = os.path.lexists(dest)
        if existed:
            if req.headers.get("overwrite", "T").upper() == "F":
                raise DavError(412, "The destination exists")
            if os.path.isdir(dest) and not os.path.islink(dest):
                shutil.rmtree(dest)
            else:
                os.unlink(dest)
        if move:
            shutil.move(src, dest)
        elif os.path.isdir(src):
            shutil.copytree(src, dest, symlinks=True)
        else:
            shutil.copy2(src, dest)
            self._own(dest, user)
        self._count(user, dshare["name"], "moved" if move else "copied")
        return Response(status_code=204 if existed else 201)

    # ------------------------------------------------------------ PROPPATCH / LOCK
    async def _proppatch(self, req: Request, user: str, parts: List[str]) -> Response:
        target, share, _a = self._resolve(user, parts, write=True)
        if not os.path.lexists(target):
            raise DavError(404, "Not found")
        body = await req.body()
        names: List[str] = []
        try:
            for el in ET.fromstring(body or b"<x/>").iter():
                if el.tag.endswith("}prop"):
                    names += [c.tag for c in el]
        except ET.ParseError:
            pass
        root = ET.Element("{DAV:}multistatus")
        r = ET.SubElement(root, "{DAV:}response")
        ET.SubElement(r, "{DAV:}href").text = self._href([share["name"]] + parts[1:], os.path.isdir(target))
        ps = ET.SubElement(r, "{DAV:}propstat")
        prop = ET.SubElement(ps, "{DAV:}prop")
        for n in names:
            ET.SubElement(prop, n)
        ET.SubElement(ps, "{DAV:}status").text = "HTTP/1.1 200 OK"
        return _xml(root)

    async def _lock_(self, req: Request, user: str, parts: List[str]) -> Response:
        await req.body()
        token = req.headers.get("if", "").strip("()<> ") or f"opaquelocktoken:{secrets.token_hex(16)}"
        if parts and len(parts) >= 2:
            target, _s, _a = self._resolve(user, parts, write=True)
            if not os.path.lexists(target) and os.path.isdir(os.path.dirname(target)):
                open(target, "ab").close()                    # LOCK on a new name creates an empty file
                self._own(target, user)
        root = ET.Element("{DAV:}prop")
        al = ET.SubElement(ET.SubElement(root, "{DAV:}lockdiscovery"), "{DAV:}activelock")
        ET.SubElement(ET.SubElement(al, "{DAV:}locktype"), "{DAV:}write")
        ET.SubElement(ET.SubElement(al, "{DAV:}lockscope"), "{DAV:}exclusive")
        ET.SubElement(al, "{DAV:}depth").text = req.headers.get("depth", "0")
        ET.SubElement(ET.SubElement(al, "{DAV:}owner"), "{DAV:}href").text = user
        ET.SubElement(al, "{DAV:}timeout").text = "Second-3600"
        ET.SubElement(ET.SubElement(al, "{DAV:}locktoken"), "{DAV:}href").text = token
        resp = _xml(root, status=200)
        resp.headers["Lock-Token"] = f"<{token}>"
        return resp

    # ------------------------------------------------------------ activity (summarised)
    def _count(self, user: str, share: str, what: str) -> None:
        with self._lock:
            self._counts[(user, share, what)] = self._counts.get((user, share, what), 0) + 1

    def _flush_counts(self, force: bool = False) -> None:
        if not force and time.time() - self._counts_flushed < 300:
            return
        with self._lock:
            counts, self._counts = self._counts, {}
            self._counts_flushed = time.time()
        for (user, share, what), n in sorted(counts.items()):
            self.nas.state.log_activity(user, f"WebDAV: {what} {n} item{'s' if n != 1 else ''} in {share}", "info", "files")


def _isdir(st: os.stat_result) -> bool:
    import stat
    return stat.S_ISDIR(st.st_mode)


def _xml(root: ET.Element, status: int = 207) -> Response:
    ET.register_namespace("d", "DAV:")
    body = b'<?xml version="1.0" encoding="utf-8"?>\n' + ET.tostring(root)
    return Response(body, status_code=status, media_type='application/xml; charset="utf-8"')


async def _threaded(fn, *args):
    from starlette.concurrency import run_in_threadpool
    return await run_in_threadpool(fn, *args)
