"""Self-update: release checks against GitHub and launching the updater.

The actual installation is done by ``talon.updater`` running in its own
transient systemd unit, so it survives the restart of the web service."""
from __future__ import annotations

import calendar
import json
import os
import re
import shutil
import ssl
import threading
import time
import urllib.request
from typing import Optional

from . import __version__
from .util import UserError, read_file, run, write_atomic

CHECK_INTERVAL = 6 * 3600                 # default; changeable under Updates → Settings
INTERVAL_CHOICES = (0, 1, 6, 12, 24, 168)   # hours; 0 = only when "Check now" is clicked
HEARTBEAT_TIMEOUT = 180
AUTO_HOURS = (3, 5)                        # automatic installs start between 03:00 and 05:00
USER_AGENT = f"Talon-NAS/{__version__}"


def parse_version(v: str) -> Optional[tuple]:
    m = re.match(r"^v?(\d+)\.(\d+)\.(\d+)$", (v or "").strip())
    return tuple(int(x) for x in m.groups()) if m else None


def is_newer(latest: str, current: str) -> bool:
    a, b = parse_version(latest), parse_version(current)
    return bool(a and b and a > b)


def fetch_latest_release(repo: str, timeout: float = 15) -> dict:
    if not re.match(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", repo):
        raise UserError("Invalid update repository")
    req = urllib.request.Request(
        f"https://api.github.com/repos/{repo}/releases/latest",
        headers={"Accept": "application/vnd.github+json", "User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context()) as r:
            data = json.load(r)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return {"tag": None}
        raise UserError(f"Update server returned HTTP {e.code}") from e
    except (urllib.error.URLError, OSError, ValueError) as e:
        raise UserError(f"Could not reach GitHub: {getattr(e, 'reason', e)}") from e
    return {"tag": data.get("tag_name"), "name": data.get("name") or data.get("tag_name"),
            "notes": (data.get("body") or "")[:20000], "url": data.get("html_url"),
            "published_at": data.get("published_at")}


# ---------------------------------------------------------------- changelog
CHANGELOG_TTL = 3600
_PKG = os.path.dirname(os.path.abspath(__file__))
# the installer copies CHANGELOG.md next to the package; in a checkout it is two levels up
LOCAL_CHANGELOG = (os.path.join(os.path.dirname(_PKG), "CHANGELOG.md"),
                   os.path.join(os.path.dirname(os.path.dirname(_PKG)), "CHANGELOG.md"))


def parse_changelog(text: str) -> list:
    """CHANGELOG.md ("## 1.0.5" then "- change" lines) as [{"version", "items"}], newest first."""
    out: list = []
    for line in text.splitlines():
        m = re.match(r"^##\s+v?(\d+\.\d+\.\d+)\s*$", line)
        if m:
            out.append({"version": m.group(1), "items": []})
        elif out and line.startswith("- "):
            out[-1]["items"].append(line[2:].strip())
    return [v for v in out if v["items"]]


def _iso_ts(s) -> Optional[float]:
    try:
        return float(calendar.timegm(time.strptime(s, "%Y-%m-%dT%H:%M:%SZ"))) if s else None
    except (TypeError, ValueError):
        return None


def _get(url: str, timeout: float = 15):
    req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context()) as r:
        return r.read()


def fetch_changelog(repo: str) -> list:
    """The changelog from GitHub (it includes versions newer than the installed one) with
    each version's release date from the list of releases."""
    if not re.match(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", repo):
        raise UserError("Invalid update repository")
    try:
        versions = parse_changelog(_get(f"https://raw.githubusercontent.com/{repo}/main/CHANGELOG.md").decode("utf-8", "replace"))
        dates = {}
        for page in range(1, 6):                   # 100 releases a page, newest first
            rels = json.loads(_get(f"https://api.github.com/repos/{repo}/releases?per_page=100&page={page}"))
            for r in rels:
                dates[(r.get("tag_name") or "").lstrip("v")] = _iso_ts(r.get("published_at"))
            if len(rels) < 100:
                break
    except urllib.error.HTTPError as e:
        raise UserError(f"Update server returned HTTP {e.code}") from e
    except (urllib.error.URLError, OSError, ValueError) as e:
        raise UserError(f"Could not reach GitHub: {getattr(e, 'reason', e)}") from e
    # a version whose release failed (its tests did not pass) was never published: left out
    return [{**v, "date": dates[v["version"]]} for v in versions if dates.get(v["version"])]


def local_changelog() -> list:
    """The CHANGELOG.md installed with Talon, without dates (the first place that has one)."""
    for p in LOCAL_CHANGELOG:
        versions = parse_changelog(read_file(p))          # "" when the file is not there
        if versions:
            return [{**v, "date": None} for v in versions]
    return []


class Updater:
    """Checks for releases and starts / reports updates."""

    def __init__(self, cfg, state):
        self.cfg = cfg
        self.state = state
        self.current = __version__
        self._lock = threading.Lock()
        self._changelog: dict = {}

    # ------------------------------------------------------------ checking
    def check(self, force: bool = False) -> dict:
        cached = self.state.get("update_check") or {}
        if not force and cached and time.time() - cached.get("checked_at", 0) < self.interval() * 3600:
            return cached
        result = {"checked_at": time.time(), "error": None, "latest": None}
        try:
            rel = fetch_latest_release(self.cfg.repo)
            if rel.get("tag"):
                result.update(latest=rel["tag"].lstrip("v"), tag=rel["tag"], name=rel["name"],
                              notes=rel["notes"], url=rel["url"],
                              published_at=rel["published_at"])
        except UserError as e:
            result["error"] = str(e)
            if cached.get("latest"):          # keep the last good answer
                result = {**cached, "error": str(e), "checked_at": time.time()}
        self.state.update(lambda d: d.__setitem__("update_check", result))
        return result

    def changelog(self) -> dict:
        """Every version with its changes and release date, newest first. From GitHub,
        kept for an hour; offline, the copy installed with Talon (without dates)."""
        c = self._changelog
        if c.get("versions") and time.time() - c.get("at", 0) < CHANGELOG_TTL:
            return {"current": self.current, "versions": c["versions"], "error": None}
        try:
            versions = self._fetch_changelog()
            self._changelog = {"versions": versions, "at": time.time()}
            return {"current": self.current, "versions": versions, "error": None}
        except UserError as e:
            versions = c.get("versions") or local_changelog()
            return {"current": self.current, "versions": versions, "error": str(e)}

    def _fetch_changelog(self) -> list:
        return fetch_changelog(self.cfg.repo)

    def interval(self) -> int:
        """Hours between automatic checks (0: never)."""
        h = self.state.get("update_interval")
        return h if h in INTERVAL_CHOICES else CHECK_INTERVAL // 3600

    def set_interval(self, hours) -> int:
        try:
            hours = int(hours)
        except (TypeError, ValueError):
            hours = -1
        if hours not in INTERVAL_CHOICES:
            raise UserError("Choose how often to check for updates")
        self.state.update(lambda d: d.__setitem__("update_interval", hours))
        return hours

    def auto_install(self) -> bool:
        return bool(self.state.get("update_auto_install"))

    def set_auto_install(self, on) -> bool:
        on = bool(on)
        self.state.update(lambda d: d.__setitem__("update_auto_install", on))
        return on

    def _auto_due(self) -> bool:
        """Install by itself at night (03:00-05:00), once per new version."""
        info = self.info()
        return (self.auto_install() and info["available"] and not self.running()
                and AUTO_HOURS[0] <= time.localtime().tm_hour < AUTO_HOURS[1]
                and self.state.get("update_auto_tried") != info["latest"])

    def background_loop(self, stop: threading.Event) -> None:
        stop.wait(60)
        while not stop.is_set():
            if self.cfg.update_check and self.interval():
                try:
                    self.check()                  # only asks GitHub when the interval has passed
                except Exception:
                    pass
            try:
                if self._auto_due():
                    latest = self.info()["latest"]
                    self.state.update(lambda d: d.__setitem__("update_auto_tried", latest))
                    self.start("system")
            except Exception:   # noqa: BLE001 - logged by the updater, retried with the next version
                pass
            stop.wait(300)

    def info(self) -> dict:
        c = self.state.get("update_check") or {}
        latest = c.get("latest")
        return {"current": self.current, "latest": latest,
                "available": bool(latest and is_newer(latest, self.current)),
                "name": c.get("name"), "notes": c.get("notes"), "url": c.get("url"),
                "published_at": c.get("published_at"), "checked_at": c.get("checked_at"),
                "error": c.get("error"), "repo": self.cfg.repo, "status": self.status(),
                "interval_hours": self.interval(), "auto_install": self.auto_install()}

    # ------------------------------------------------------------ status
    def status(self) -> dict:
        try:
            with open(self.cfg.update_status_file) as f:
                st = json.load(f)
        except (OSError, ValueError):
            return {"state": "idle"}
        if st.get("state") == "running" and time.time() - st.get("heartbeat", 0) > HEARTBEAT_TIMEOUT:
            st["state"] = "failed"
            st["error"] = "The updater stopped unexpectedly"
        return st

    def running(self) -> bool:
        return self.status().get("state") == "running"

    # ------------------------------------------------------------ install
    def start(self, user: str) -> dict:
        with self._lock:
            if self.running():
                raise UserError("An update is already in progress")
            info = self.info()
            if not info["available"]:
                raise UserError("No update available")
            if not os.path.isdir("/run/systemd/system") or not shutil.which("systemd-run"):
                raise UserError("Updating from the web interface requires systemd")
            tag = (self.state.get("update_check") or {}).get("tag")
            initial = {"state": "running", "step": "starting", "from": self.current,
                       "target": info["latest"], "user": user, "started": time.time(),
                       "heartbeat": time.time(), "log": [f"Update to {tag} requested by {user}"]}
            write_atomic(self.cfg.update_status_file, json.dumps(initial), 0o600)
            python = os.path.join(self.cfg.prefix, "venv", "bin", "python")
            unit = f"talon-update-{int(time.time())}"
            run(["systemd-run", f"--unit={unit}", "--collect", "--quiet",
                 "--working-directory=/", f"--setenv=PYTHONPATH={self.cfg.prefix}/app",
                 "--setenv=PYTHONUNBUFFERED=1", "-p", "TimeoutStopSec=60",
                 python, "-m", "talon.updater", "--tag", tag, "--repo", self.cfg.repo,
                 "--port", str(self.cfg.port), "--prefix", self.cfg.prefix,
                 "--status", self.cfg.update_status_file])
            self.state.log_activity(user, f"Started update {self.current} → {info['latest']}",
                                    "warning")
            return initial


class DemoUpdater(Updater):
    """Simulated update for demo mode, including a fake service restart."""

    def __init__(self, cfg, state):
        super().__init__(cfg, state)
        self._status = {"state": "idle"}
        self.restarting_until = 0.0

    def _fetch_changelog(self) -> list:
        """The installed changelog, a release every three hours back from now, and the
        demo's pretend new version on top."""
        now = time.time()
        local = [{**v, "date": now - (i + 1) * 3 * 3600} for i, v in enumerate(local_changelog())]
        nxt = self.check().get("latest")
        new = [{"version": nxt, "items": ["A pretend new version, to try updates in the demo"], "date": now - 600}] if nxt and is_newer(nxt, self.current) else []
        return new + local

    def check(self, force: bool = False) -> dict:
        nxt = "1.1.0" if self.current == __version__ else self.current
        result = {"checked_at": time.time(), "error": None, "latest": nxt, "tag": f"v{nxt}",
                  "name": f"Talon v{nxt}", "url": None, "published_at": "2026-11-18T10:00:00Z",
                  "notes": "## What's new\n- Faster dashboard\n- Btrfs scrub scheduling\n"
                           "- Bug fixes and security updates"}
        self.state.update(lambda d: d.__setitem__("update_check", result))
        return result

    def background_loop(self, stop: threading.Event) -> None:
        self.check()

    def status(self) -> dict:
        return dict(self._status)

    def start(self, user: str) -> dict:
        info = self.info()
        if self.running():
            raise UserError("An update is already in progress")
        if not info["available"]:
            raise UserError("No update available")
        target = info["latest"]
        self._status = {"state": "running", "step": "download", "from": self.current,
                        "target": target, "user": user, "started": time.time(),
                        "heartbeat": time.time(), "log": ["Downloading release…"]}

        def sim():
            for step, msg, secs in [("download", "Verifying release archive", 2),
                                    ("backup", "Backing up current version", 1.5),
                                    ("install", "Installing Talon " + target, 3),
                                    ("restart", "Restarting Talon service", 0)]:
                self._status.update(step=step, heartbeat=time.time())
                self._status["log"].append(msg)
                time.sleep(secs)
            self.restarting_until = time.time() + 5
            time.sleep(5)
            self.current = target
            self._status.update(state="success", step="done", finished=time.time())
            self._status["log"].append(f"Talon {target} is running")

        threading.Thread(target=sim, daemon=True).start()
        return self.status()


def health(updater: Updater) -> dict:
    return {"ok": True, "version": updater.current, "updating": updater.running()}


def read_status_file(path: str) -> dict:
    try:
        return json.loads(read_file(path) or "{}")
    except ValueError:
        return {}
