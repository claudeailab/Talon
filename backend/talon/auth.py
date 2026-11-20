"""Session handling for the web UI."""
from __future__ import annotations

import secrets
import threading
import time
from typing import Dict, Optional

COOKIE = "talon_session"


class Sessions:
    def __init__(self, hours: int):
        self.ttl = hours * 3600
        self._s: Dict[str, dict] = {}
        self._fails: Dict[str, list] = {}
        self._lock = threading.Lock()

    def create(self, user: str) -> str:
        token = secrets.token_urlsafe(32)
        with self._lock:
            self._s[token] = {"user": user, "expires": time.time() + self.ttl}
        return token

    def get(self, token: Optional[str]) -> Optional[str]:
        if not token:
            return None
        with self._lock:
            s = self._s.get(token)
            if not s:
                return None
            if s["expires"] < time.time():
                self._s.pop(token, None)
                return None
            s["expires"] = time.time() + self.ttl   # sliding expiry
            return s["user"]

    def drop(self, token: Optional[str]) -> None:
        with self._lock:
            self._s.pop(token or "", None)

    def drop_user(self, user: str) -> None:
        with self._lock:
            for t in [t for t, s in self._s.items() if s["user"] == user]:
                self._s.pop(t, None)

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
