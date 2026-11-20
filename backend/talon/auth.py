"""Session handling for the web UI.

Sessions are persisted (as SHA-256 hashes of the tokens) so that restarting the
service - e.g. while installing an update - does not sign anybody out."""
from __future__ import annotations

import hashlib
import json
import secrets
import threading
import time
from typing import Dict, Optional

from .util import write_atomic

COOKIE = "talon_session"


def _h(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class Sessions:
    def __init__(self, hours: int, path: Optional[str] = None):
        self.ttl = hours * 3600
        self.path = path
        self._s: Dict[str, dict] = {}
        self._fails: Dict[str, list] = {}
        self._lock = threading.Lock()
        self._last_save = 0.0
        self._load()

    def _load(self) -> None:
        if not self.path:
            return
        try:
            with open(self.path) as f:
                data = json.load(f)
            now = time.time()
            self._s = {k: v for k, v in data.items()
                       if isinstance(v, dict) and v.get("expires", 0) > now}
        except (OSError, ValueError):
            self._s = {}

    def _save(self) -> None:
        if not self.path:
            return
        try:
            write_atomic(self.path, json.dumps(self._s), 0o600)
            self._last_save = time.time()
        except OSError:
            pass

    def create(self, user: str) -> str:
        token = secrets.token_urlsafe(32)
        with self._lock:
            self._s[_h(token)] = {"user": user, "expires": time.time() + self.ttl}
            self._save()
        return token

    def get(self, token: Optional[str]) -> Optional[str]:
        if not token:
            return None
        key = _h(token)
        with self._lock:
            s = self._s.get(key)
            if not s:
                return None
            now = time.time()
            if s["expires"] < now:
                self._s.pop(key, None)
                self._save()
                return None
            s["expires"] = now + self.ttl   # sliding expiry
            if now - self._last_save > 600:
                self._save()
            return s["user"]

    def drop(self, token: Optional[str]) -> None:
        with self._lock:
            if self._s.pop(_h(token or ""), None):
                self._save()

    def drop_user(self, user: str) -> None:
        with self._lock:
            for k in [k for k, s in self._s.items() if s["user"] == user]:
                self._s.pop(k, None)
            self._save()

    # brute-force protection: 5 failures per 5 minutes per client address
    def blocked(self, ip: str) -> bool:
        now = time.time()
        with self._lock:
            fails = [t for t in self._fails.get(ip, []) if now - t < 300]
            self._fails[ip] = fails
            return len(fails) >= 5

    def failed(self, ip: str) -> None:
        with self._lock:
            self._fails.setdefault(ip, []).append(time.time())

    def succeeded(self, ip: str) -> None:
        with self._lock:
            self._fails.pop(ip, None)
