"""File operations on the connected OneDrive, for the Files page (Microsoft Graph).

Items are addressed by path relative to the OneDrive root. Uploads up to 4 MB use
a single PUT; larger files use an upload session in 10 MiB pieces (a multiple of
the required 320 KiB). Deleted items go to the OneDrive recycle bin.
"""
from __future__ import annotations

import json
import os
import ssl
import threading
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from typing import Callable, Iterator, List, Optional, Tuple

from .entra import GRAPH
from .util import UserError

SIMPLE_MAX = 4 * 1024 * 1024
PIECE = 32 * 320 * 1024                 # 10 MiB
CHUNK = 1024 * 1024


def _q(path: str) -> str:
    return urllib.parse.quote(path.strip("/"))


def _item(path: str) -> str:
    """Graph address of an item by path ('' is the root)."""
    return "/me/drive/root" if not path.strip("/") else f"/me/drive/root:/{_q(path)}:"


class OneDriveFiles:
    def __init__(self, token: Callable[[], str]):
        self.token = token

    # ------------------------------------------------------------ HTTP
    def _call(self, method: str, url: str, body=None, data: Optional[bytes] = None,
              headers: Optional[dict] = None, auth: bool = True, timeout: float = 60) -> Tuple[int, dict]:
        h = {"User-Agent": "Talon-NAS", **(headers or {})}
        if auth:
            h["Authorization"] = f"Bearer {self.token()}"
        if body is not None:
            data = json.dumps(body).encode()
            h["Content-Type"] = "application/json"
        req = urllib.request.Request(url if url.startswith("http") else GRAPH + url,
                                     data=data, headers=h, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context()) as r:
                raw = r.read()
                return r.status, (json.loads(raw) if raw.strip().startswith(b"{") else {})
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                payload = json.loads(raw)
            except ValueError:
                payload = {}
            return e.code, payload
        except (urllib.error.URLError, OSError) as e:
            raise UserError(f"Cannot reach OneDrive: {getattr(e, 'reason', e)}") from e

    def _ok(self, status: int, payload: dict, what: str) -> dict:
        if status >= 400:
            code = (payload.get("error") or {}).get("code", "")
            msg = (payload.get("error") or {}).get("message") or f"HTTP {status}"
            if status == 404 or code == "itemNotFound":
                raise UserError("Not found in OneDrive")
            if status == 409 or code == "nameAlreadyExists":
                raise UserError(f"{what} already exists in OneDrive")
            raise UserError(f"OneDrive: {msg}")
        return payload

    # ------------------------------------------------------------ listing
    def list(self, path: str) -> List[dict]:
        url = ("/me/drive/root/children" if not path.strip("/") else f"/me/drive/root:/{_q(path)}:/children") + \
            "?$select=name,folder,file,size,lastModifiedDateTime&$top=999"
        items: List[dict] = []
        while url:
            data = self._ok(*self._call("GET", url), "Folder")
            for i in data.get("value", []):
                if "folder" not in i and "file" not in i:
                    continue
                items.append({"name": i["name"], "folder": "folder" in i,
                              "size": 0 if "folder" in i else (i.get("size") or 0),
                              "modified": _ts(i.get("lastModifiedDateTime")),
                              "count": (i.get("folder") or {}).get("childCount") if "folder" in i else None})
            url = data.get("@odata.nextLink")
        items.sort(key=lambda i: (not i["folder"], i["name"].lower()))
        return items

    def info(self, path: str) -> dict:
        return self._ok(*self._call("GET", _item(path) + "?$select=id,name,folder,file,size"), "Item")

    # ------------------------------------------------------------ changes
    def mkdir(self, path: str, name: str) -> None:
        url = "/me/drive/root/children" if not path.strip("/") else f"/me/drive/root:/{_q(path)}:/children"
        self._ok(*self._call("POST", url, {"name": name, "folder": {},
                                           "@microsoft.graph.conflictBehavior": "fail"}), name)

    def rename(self, path: str, name: str) -> None:
        self._ok(*self._call("PATCH", _item(path), {"name": name}), name)

    def move(self, path: str, dest: str) -> None:
        dest_id = self.info(dest)["id"]
        name = path.rstrip("/").split("/")[-1]
        self._ok(*self._call("PATCH", _item(path), {"parentReference": {"id": dest_id},
                                                    "@microsoft.graph.conflictBehavior": "fail"}), name)

    def delete(self, path: str) -> None:
        if not path.strip("/"):
            raise UserError("OneDrive itself cannot be deleted")
        status, payload = self._call("DELETE", _item(path))
        if status != 204:
            self._ok(status, payload, "Item")

    def exists(self, path: str) -> bool:
        status, _ = self._call("GET", _item(path) + "?$select=id")
        return status == 200

    # ------------------------------------------------------------ upload / download
    def upload(self, folder: str, name: str, src: str, overwrite: bool) -> None:
        target = f"{folder.strip('/')}/{name}".strip("/")
        if not overwrite and self.exists(target):
            raise UserError(f"{name} already exists")
        size = os.path.getsize(src)
        if size <= SIMPLE_MAX:
            with open(src, "rb") as f:
                self._ok(*self._call("PUT", f"/me/drive/root:/{_q(target)}:/content", data=f.read(),
                                     headers={"Content-Type": "application/octet-stream"},
                                     timeout=300), name)
            return
        session = self._ok(*self._call(
            "POST", f"/me/drive/root:/{_q(target)}:/createUploadSession",
            {"item": {"@microsoft.graph.conflictBehavior": "replace"}}), name)
        url = session["uploadUrl"]
        with open(src, "rb") as f:
            start = 0
            while start < size:
                piece = f.read(PIECE)
                end = start + len(piece) - 1
                # the upload URL is pre-authorised: no Authorization header
                status, payload = self._call("PUT", url, data=piece, auth=False, timeout=600, headers={
                    "Content-Length": str(len(piece)), "Content-Range": f"bytes {start}-{end}/{size}"})
                if status not in (200, 201, 202):
                    self._call("DELETE", url, auth=False)
                    self._ok(status, payload, name)
                start = end + 1

    def download_url(self, path: str) -> str:
        data = self._ok(*self._call("GET", _item(path) + "?$select=name,file,@microsoft.graph.downloadUrl"), "File")
        if "file" not in data:
            raise UserError("Not a file")
        return data["@microsoft.graph.downloadUrl"]

    def _walk(self, path: str, prefix: str) -> Iterator[Tuple[str, str]]:
        """(path in OneDrive, path inside the zip) for every file under path."""
        for i in self.list(path):
            child = f"{path.strip('/')}/{i['name']}".strip("/")
            inner = f"{prefix}/{i['name']}" if prefix else i["name"]
            if i["folder"]:
                yield from self._walk(child, inner)
            else:
                yield child, inner

    def zip_stream(self, paths: List[str]) -> Iterator[bytes]:
        """Stream a zip of files and folders, fetched one by one."""
        r, w = os.pipe()

        def writer():
            try:
                with os.fdopen(w, "wb") as out, \
                        zipfile.ZipFile(out, "w", zipfile.ZIP_STORED, allowZip64=True) as z:
                    for p in paths:
                        name = p.rstrip("/").split("/")[-1]
                        is_file = "file" in self.info(p)
                        files = [(p, name)] if is_file else self._walk(p, name)
                        for src, inner in files:
                            url = self.download_url(src)
                            with urllib.request.urlopen(url, timeout=300,
                                                        context=ssl.create_default_context()) as resp, \
                                    z.open(inner, "w", force_zip64=True) as dst:
                                while True:
                                    chunk = resp.read(CHUNK)
                                    if not chunk:
                                        break
                                    dst.write(chunk)
            except (OSError, BrokenPipeError, UserError, urllib.error.URLError):
                pass
        threading.Thread(target=writer, daemon=True, name="odzip").start()
        with os.fdopen(r, "rb") as f:
            while True:
                chunk = f.read(CHUNK)
                if not chunk:
                    break
                yield chunk


def _ts(iso: Optional[str]) -> float:
    if not iso:
        return 0.0
    import datetime
    try:
        return datetime.datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0
