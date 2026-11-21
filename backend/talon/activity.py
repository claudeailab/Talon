"""The activity log: everything that happens in Talon, newest first.

Entries are appended to ``activity.jsonl`` next to the state file (one JSON object
per line), so logging never rewrites the whole state. The newest KEEP entries
are kept. Each entry has a category (the kind of operation) so the web
interface can filter by it, and can be searched by text."""
from __future__ import annotations

import contextvars
import json
import os
import re
import threading
import time
from typing import List, Optional

KEEP = 20000

# id -> label, in the order the filter shows them
CATEGORIES = {
    "signin": "Sign-in",
    "storage": "Disks, RAID & volumes",
    "files": "Files",
    "sharing": "Shared Folders",
    "users": "Users & Groups",
    "onedrive": "OneDrive",
    "scheduled": "Scheduled",
    "services": "Services",
    "settings": "Settings",
    "updates": "Updates",
    "alerts": "Alerts & notifications",
    "system": "System",
}

# the category of a message logged outside a web request (background work)
_RULES = [
    (r"\bOneDrive\b|EntraID", "onedrive"),
    (r"^(Started |Created |Updated |Deleted |Paused |Resumed |Skipped )?scheduled task|^Scheduled task|^Test run as", "scheduled"),
    (r"^Notification|^Alert|^Resolved|email", "alerts"),
    (r"Signed (in|out)|[Ff]ailed login|sign-in", "signin"),
    (r"\bupdate\b|Update checks|Talon \d", "updates"),
    (r"\bRAID\b|\bvolume\b|\bdisk\b|S\.M\.A\.R\.T|scrub|[Ww]ip(e|ed|ing)\b|array", "storage"),
    (r"shared folder|\bshare\b", "sharing"),
    (r"\buser\b|\bgroup\b", "users"),
    (r"recycle bin|previous version|[Ff]older|Renamed|Moved|Uploaded|item\(s\)|Ejected", "files"),
    (r"^Service ", "services"),
    (r"[Nn]etwork|HTTPS|hostname|SMTP|settings|time zone|thresholds", "settings"),
]

# set for the length of a web request: the category of that endpoint, and a list
# that collects what the request logged (see app.py: requests that change
# something but log nothing get a generic entry)
request_category: contextvars.ContextVar = contextvars.ContextVar("activity_category", default=None)
request_logged: contextvars.ContextVar = contextvars.ContextVar("activity_logged", default=None)


def categorize(message: str) -> str:
    for pattern, cat in _RULES:
        if re.search(pattern, message):
            return cat
    return "system"


class ActivityLog:
    def __init__(self, path: str):
        self.path = path
        self._lock = threading.Lock()

    def add(self, user: str, message: str, level: str = "info", category: Optional[str] = None) -> None:
        cat = category or request_category.get() or categorize(message)
        entry = {"ts": time.time(), "user": user, "message": message, "level": level,
                 "category": cat if cat in CATEGORIES else "system"}
        logged = request_logged.get()
        if logged is not None:
            logged.append(entry)
        line = json.dumps(entry, ensure_ascii=False) + "\n"
        with self._lock:
            new = not os.path.exists(self.path)
            with open(self.path, "a", encoding="utf-8") as f:
                f.write(line)
            if new:
                os.chmod(self.path, 0o600)
            self._trim()

    def _trim(self) -> None:
        # keep the file at most ~25% over KEEP lines; cheap check on the size first
        try:
            if os.path.getsize(self.path) < KEEP * 120:
                return
            with open(self.path, encoding="utf-8") as f:
                lines = f.readlines()
            if len(lines) <= KEEP * 5 // 4:
                return
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                f.writelines(lines[-KEEP:])
            os.chmod(tmp, 0o600)
            os.replace(tmp, self.path)
        except OSError:
            pass

    def entries(self) -> List[dict]:
        """All entries, newest first."""
        try:
            with open(self.path, encoding="utf-8") as f:
                lines = f.readlines()
        except OSError:
            return []
        out = []
        for line in reversed(lines):
            try:
                out.append(json.loads(line))
            except ValueError:
                continue
        return out

    def query(self, offset: int = 0, limit: int = 10, category: str = "", level: str = "",
              q: str = "") -> dict:
        items = self.entries()
        if category:
            cats = set(category.split(","))
            items = [e for e in items if e.get("category", categorize(e["message"])) in cats]
        if level == "warning":                       # warnings and errors
            items = [e for e in items if e.get("level") in ("warning", "error")]
        elif level == "error":
            items = [e for e in items if e.get("level") == "error"]
        if q.strip():
            words = q.lower().split()
            items = [e for e in items
                     if all(w in (e["message"] + " " + e.get("user", "")).lower() for w in words)]
        offset, limit = max(offset, 0), min(max(limit, 1), 100)
        page = items[offset:offset + limit]
        for e in page:
            e.setdefault("category", categorize(e["message"]))
        return {"items": page, "total": len(items), "offset": offset, "limit": limit,
                "categories": [{"id": k, "label": v} for k, v in CATEGORIES.items()]}

    def migrate(self, old: List[dict]) -> None:
        """Move entries kept in the state file by earlier versions into the log file."""
        if not old or os.path.exists(self.path):
            return
        with self._lock, open(self.path, "w", encoding="utf-8") as f:
            for e in reversed(old):
                e = {**e, "category": e.get("category") or categorize(e.get("message", ""))}
                f.write(json.dumps(e, ensure_ascii=False) + "\n")
        os.chmod(self.path, 0o600)
