"""Persistent JSON state: volumes registry, shares, managed groups, settings,
activity log.  The generated smb.conf / NFS exports are derived from it."""
from __future__ import annotations

import copy
import json
import os
import threading
import time
from typing import Any, Callable, Optional

from .util import write_atomic

DEFAULT_STATE: dict = {
    "version": 1,
    "arrays": {},
    "volumes": {},
    "shares": {},
    "groups": [],
    "settings": {
        "workgroup": "WORKGROUP",
        "server_string": "Talon",
        "smb_min_protocol": "SMB2_10",
        "smb_macos_compat": True,
    },
    "entra": {},
    "smtp": {},
    "notifications": {},
    "onedrive": {"enabled": False, "tasks": {}},
    "activity": [],
}


class State:
    def __init__(self, path: str):
        from .activity import ActivityLog
        self.path = path
        self._lock = threading.RLock()
        self._data = self._load()
        # the activity log lives in its own file (see activity.py); move entries
        # that earlier versions kept in the state file
        self.activity = ActivityLog(os.path.join(os.path.dirname(os.path.abspath(path)), "activity.jsonl"))
        if self._data.get("activity"):
            self.activity.migrate(self._data["activity"])
            self.update(lambda d: d.__setitem__("activity", []))

    def _load(self) -> dict:
        try:
            with open(self.path) as f:
                data = json.load(f)
        except FileNotFoundError:
            data = {}
        merged = copy.deepcopy(DEFAULT_STATE)
        for k, v in data.items():
            if isinstance(v, dict) and isinstance(merged.get(k), dict):
                merged[k].update(v)
            else:
                merged[k] = v
        return merged

    def read(self) -> dict:
        with self._lock:
            return copy.deepcopy(self._data)

    def get(self, key: str) -> Any:
        with self._lock:
            return copy.deepcopy(self._data.get(key))

    def update(self, fn: Callable[[dict], Any]) -> Any:
        """Apply ``fn`` to a copy of the state and persist it atomically."""
        with self._lock:
            data = copy.deepcopy(self._data)
            result = fn(data)
            write_atomic(self.path, json.dumps(data, indent=2, sort_keys=True), 0o600)
            self._data = data
            return result

    def log_activity(self, user: str, message: str, level: str = "info",
                     category: Optional[str] = None, job: Optional[str] = None) -> None:
        self.activity.add(user, message, level, category, job)
