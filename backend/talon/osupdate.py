"""Operating system updates: Debian / Ubuntu / Raspberry Pi OS packages.

Settings → Update → Operating system lists the waiting package updates (security
updates first), installs them with a progress bar instead of a terminal, says when
a restart is needed, and turns automatic security updates on or off
(unattended-upgrades, with an optional automatic restart at 04:00).

Everything runs through apt-get with DEBIAN_FRONTEND=noninteractive: configuration
files that were changed keep their current version, and services are not
restarted behind Talon's back (needrestart is told to only list them)."""
from __future__ import annotations

import os
import re
import threading
import time
from typing import Callable, Dict, List, Optional

from .util import UserError, read_file, run, write_atomic

ENV = {"DEBIAN_FRONTEND": "noninteractive", "NEEDRESTART_MODE": "l", "NEEDRESTART_SUSPEND": "1",
       "APT_LISTCHANGES_FRONTEND": "none", "LC_ALL": "C"}
APT_OPTS = ["-o", "Dpkg::Options::=--force-confdef", "-o", "Dpkg::Options::=--force-confold",
            "-o", "DPkg::Lock::Timeout=120"]
AUTO_FILE = "/etc/apt/apt.conf.d/20auto-upgrades"
TALON_FILE = "/etc/apt/apt.conf.d/52talon-unattended-upgrades"
UU_LOG = "/var/log/unattended-upgrades/unattended-upgrades.log"
RESTART_PACKAGES = re.compile(r"^(linux-image|linux-headers|raspberrypi-kernel|linux-.*rpi|libc6$|systemd$|dbus$|firmware-)")
INST_RE = re.compile(r"^Inst (\S+)(?: \[([^\]]+)\])? \((\S+) ([^\[)]*?)(?: \[[^\]]*\])?\)")
CHECK_HOURS = 24


def parse_simulation(text: str) -> List[dict]:
    """Packages from `apt-get -s full-upgrade`: "Inst name [old] (new origin [arch])"."""
    out = []
    for line in text.splitlines():
        m = INST_RE.match(line.strip())
        if not m:
            continue
        name, old, new, origin = m.group(1), m.group(2) or "", m.group(3), m.group(4)
        out.append({"name": name, "old": old, "new": new,
                    "security": "security" in origin.lower(),
                    "restart": bool(RESTART_PACKAGES.match(name))})
    out.sort(key=lambda p: (not p["security"], p["name"]))
    return out


def parse_status(line: str) -> Optional[dict]:
    """apt's machine-readable progress (APT::Status-Fd): "pmstatus:pkg:42.5:Installing pkg"."""
    m = re.match(r"^(pmstatus|dlstatus):(.+?):(\d+(?:\.\d+)?):(.*)$", line.strip())
    if not m:
        return None
    return {"phase": "download" if m.group(1) == "dlstatus" else "install",
            "package": m.group(2).split(":")[0], "percent": float(m.group(3)), "text": m.group(4)}


class OsUpdate:
    def __init__(self, state, notifier=None, demo: bool = False):
        self.state = state
        self.notifier = notifier
        self.demo = demo
        self._lock = threading.Lock()
        self.progress: dict = {"state": "idle"}

    # ------------------------------------------------------------ status
    def _saved(self) -> dict:
        return self.state.get("os_updates") or {}

    def info(self) -> dict:
        s = self._saved()
        pk = s.get("packages") or []
        return {"os": self._os_name(), "checked_at": s.get("checked_at"), "error": s.get("error"),
                "packages": pk, "security": sum(1 for p in pk if p["security"]),
                "restart_needed": self.restart_needed(), "progress": self.progress,
                "auto": self.auto_settings(), "last_install": s.get("last_install")}

    def _os_name(self) -> str:
        if self.demo:
            return "Debian GNU/Linux 13 (trixie)"
        m = re.search(r'^PRETTY_NAME="?([^"\n]+)', read_file("/etc/os-release") or "", re.M)
        return m.group(1) if m else "Linux"

    def restart_needed(self) -> bool:
        if self.demo:
            return bool(self._saved().get("demo_restart"))
        if os.path.exists("/run/reboot-required") or os.path.exists("/var/run/reboot-required"):
            return True
        # Debian has no reboot-required file: a newer installed kernel than the running one
        running = os.uname().release
        try:
            kernels = [k for k in os.listdir("/lib/modules") if os.path.exists(f"/lib/modules/{k}/modules.dep")]
        except OSError:
            return False
        flavour = running.split("-", 2)[-1] if running.count("-") >= 2 else ""
        same = [k for k in kernels if not flavour or k.endswith(flavour)]
        return bool(same) and _vkey(max(same, key=_vkey)) > _vkey(running)

    # ------------------------------------------------------------ check
    def check(self) -> dict:
        if self.progress.get("state") == "running":
            return self.info()
        if self.demo:
            pk = [] if self._saved().get("demo_installed") else DEMO_PACKAGES
            self.state.update(lambda d: d.__setitem__("os_updates", {**(d.get("os_updates") or {}),
                                                                     "checked_at": time.time(), "packages": pk, "error": None}))
            return self.info()
        cp = run(["apt-get", "update", "-q", "-o", "DPkg::Lock::Timeout=120"], check=False, timeout=600, env=ENV)
        error = None
        if cp.returncode != 0:
            error = _first_error(cp.stderr or cp.stdout) or "apt-get update failed"
        sim = run(["apt-get", "-s", "-q", "full-upgrade"], check=False, timeout=300, env=ENV)
        pk = parse_simulation(sim.stdout or "") if sim.returncode == 0 else []
        if sim.returncode != 0 and not error:
            error = _first_error(sim.stderr or sim.stdout) or "Could not list the updates"
        old = {p["name"] for p in self._saved().get("packages") or [] if p["security"]}
        self.state.update(lambda d: d.__setitem__("os_updates", {**(d.get("os_updates") or {}),
                                                                 "checked_at": time.time(), "packages": pk, "error": error}))
        new_security = [p["name"] for p in pk if p["security"] and p["name"] not in old]
        if new_security and self.notifier and not self.auto_settings()["security"]:
            self.notifier.send("os_updates", f"{len(new_security)} security update(s) for the operating system",
                               "Security updates are waiting: " + ", ".join(new_security) +
                               "\nInstall them in Talon under Settings → Update → Operating system.")
        return self.info()

    # ------------------------------------------------------------ install
    def install(self, actor: str) -> dict:
        with self._lock:
            if self.progress.get("state") == "running":
                raise UserError("Updates are already being installed")
            total = len(self._saved().get("packages") or [])
            if not total:
                raise UserError("There are no updates to install")
            self.progress = {"state": "running", "phase": "download", "percent": 0, "package": "",
                             "done": 0, "total": total, "started": time.time(), "log": []}
        self.state.log_activity(actor, f"Started installing {total} operating system update(s)", "info", "updates")
        threading.Thread(target=self._install, args=(actor, total), daemon=True, name="os-update").start()
        return self.info()

    def _install(self, actor: str, total: int) -> None:
        p = self.progress
        seen: set = set()

        def on_line(line: str) -> None:
            st = parse_status(line)
            if st:
                p["phase"], p["package"] = st["phase"], st["package"]
                if st["phase"] == "download":
                    p["percent"] = round(st["percent"] * 0.3, 1)        # downloading: the first 30%
                else:
                    p["percent"] = round(30 + st["percent"] * 0.7, 1)
                    if st["package"] not in seen and st["text"].lower().startswith("installed"):
                        seen.add(st["package"])
                        p["done"] = min(total, len(seen))
            elif line.strip():
                p["log"].append(line.rstrip())
                del p["log"][:-400]

        try:
            if self.demo:
                for i, pkg in enumerate(DEMO_PACKAGES):
                    p.update(phase="install", package=pkg["name"], done=i + 1, percent=round((i + 1) / len(DEMO_PACKAGES) * 100, 1))
                    time.sleep(0.6)
                self.state.update(lambda d: d.__setitem__("os_updates", {**(d.get("os_updates") or {}), "packages": [],
                                                                         "demo_installed": True, "demo_restart": True}))
                rc, err = 0, ""
            else:
                rc, err = _stream(["apt-get", "-y", "-q", *APT_OPTS, "-o", "APT::Status-Fd=1", "full-upgrade"], on_line)
            if rc != 0:
                raise UserError(_first_error(err) or _first_error("\n".join(p["log"])) or f"apt-get failed (exit code {rc})")
            p.update(state="success", percent=100, finished=time.time())
            self.state.log_activity(actor, f"Installed {total} operating system update(s)", "info", "updates")
        except Exception as e:   # noqa: BLE001 - reported in the page and the activity log
            p.update(state="error", error=str(e), finished=time.time())
            self.state.log_activity(actor, f"Installing operating system updates failed: {e}", "error", "updates")
        finally:
            self.state.update(lambda d: d.__setitem__("os_updates", {**(d.get("os_updates") or {}),
                                                                     "last_install": {"at": time.time(), "ok": p["state"] == "success",
                                                                                      "count": total, "error": p.get("error")}}))
            if not self.demo:
                try:
                    self.check()
                except Exception:   # noqa: BLE001
                    pass

    # ------------------------------------------------------------ automatic security updates
    def auto_settings(self) -> dict:
        a = self._saved().get("auto") or {}
        return {"security": bool(a.get("security")), "restart": bool(a.get("restart")),
                "restart_time": a.get("restart_time", "04:00")}

    def set_auto(self, data: dict, actor: str) -> dict:
        cur = self.auto_settings()
        security = bool(data.get("security", cur["security"]))
        restart = bool(data.get("restart", cur["restart"])) and security
        t = str(data.get("restart_time", cur["restart_time"]))
        if not re.match(r"^([01]\d|2[0-3]):[0-5]\d$", t):
            raise UserError("Enter the time as hh:mm (24-hour)")
        if not self.demo:
            self._apply_auto(security, restart, t)
        self.state.update(lambda d: d.__setitem__("os_updates", {**(d.get("os_updates") or {}),
                                                                 "auto": {"security": security, "restart": restart, "restart_time": t}}))
        if security != cur["security"]:
            self.state.log_activity(actor, ("Turned on" if security else "Turned off") + " automatic security updates", "info", "updates")
        if restart != cur["restart"] or (restart and t != cur["restart_time"]):
            self.state.log_activity(actor, f"Automatic restart after updates: {'at ' + t if restart else 'off'}", "info", "updates")
        return self.info()

    def _apply_auto(self, security: bool, restart: bool, t: str) -> None:
        if security and run(["sh", "-c", "command -v unattended-upgrade"], check=False).returncode != 0:
            cp = run(["apt-get", "install", "-y", "-q", *APT_OPTS, "unattended-upgrades"], check=False, timeout=900, env=ENV)
            if cp.returncode != 0:
                raise UserError("Could not install unattended-upgrades: " + (_first_error(cp.stderr) or "apt-get failed"))
        on = "1" if security else "0"
        write_atomic(AUTO_FILE, f'APT::Periodic::Update-Package-Lists "{on}";\nAPT::Periodic::Unattended-Upgrade "{on}";\n')
        write_atomic(TALON_FILE, "// Talon: Settings → Update → Operating system\n"
                                 f'Unattended-Upgrade::Automatic-Reboot "{"true" if restart else "false"}";\n'
                                 f'Unattended-Upgrade::Automatic-Reboot-Time "{t}";\n'
                                 'Unattended-Upgrade::Automatic-Reboot-WithUsers "true";\n')

    def report_automatic(self) -> None:
        """Log (and email) what unattended-upgrades installed since the last look."""
        if self.demo or not os.path.exists(UU_LOG):
            return
        since = self._saved().get("uu_seen", time.time() - 86400)
        found, newest = [], since
        for line in (read_file(UU_LOG) or "").splitlines()[-2000:]:
            m = re.match(r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d),\d+ INFO Packages that will be upgraded: (.+)$", line)
            if not m:
                continue
            ts = time.mktime(time.strptime(m.group(1), "%Y-%m-%d %H:%M:%S"))
            if ts > since:
                found += m.group(2).split()
                newest = max(newest, ts)
        self.state.update(lambda d: d.__setitem__("os_updates", {**(d.get("os_updates") or {}), "uu_seen": newest}))
        if found:
            msg = f"Installed security update(s) automatically: {', '.join(found)}"
            self.state.log_activity("system", msg, "info", "updates")
            if self.notifier:
                extra = "\nThe NAS needs a restart to finish." if self.restart_needed() else ""
                self.notifier.send("os_updates", "Security updates were installed", msg + extra)

    def background_loop(self, stop: threading.Event) -> None:
        stop.wait(120)
        while not stop.is_set():
            last = self._saved().get("checked_at") or 0
            if time.time() - last > CHECK_HOURS * 3600:
                try:
                    self.check()
                except Exception:   # noqa: BLE001
                    pass
            try:
                self.report_automatic()
            except Exception:   # noqa: BLE001
                pass
            stop.wait(3600)


def _stream(cmd: List[str], on_line: Callable[[str], None]):
    import subprocess
    env = dict(os.environ)
    env.update(ENV)
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env, bufsize=1)
    assert proc.stdout is not None
    for line in proc.stdout:
        on_line(line)
    err = proc.stderr.read() if proc.stderr else ""
    return proc.wait(), err


def _first_error(text: str) -> str:
    for line in (text or "").splitlines():
        line = line.strip()
        if line.startswith(("E:", "Err:")):
            return line.split(":", 1)[1].strip()
    return ""


def _vkey(v: str):
    return [int(x) if x.isdigit() else x for x in re.split(r"[.\-+~]", v)]


DEMO_PACKAGES: List[dict] = parse_simulation("""
Inst openssl [3.5.1-1] (3.5.1-1+deb13u2 Debian-Security:13/stable-security [amd64])
Inst samba [2:4.22.3+dfsg-4] (2:4.22.4+dfsg-1~deb13u1 Debian-Security:13/stable-security [amd64])
Inst linux-image-amd64 [6.12.48-1] (6.12.57-1 Debian-Security:13/stable-security [amd64])
Inst tzdata [2025b-4] (2025c-0+deb13u1 Debian:13.2/stable [all])
Inst curl [8.14.1-2] (8.14.1-2+deb13u1 Debian:13.2/stable [amd64])
Inst libcurl4t64 [8.14.1-2] (8.14.1-2+deb13u1 Debian:13.2/stable [amd64])
Inst python3-urllib3 [2.3.0-3] (2.3.0-3+deb13u1 Debian:13.2/stable [all])
Inst smartmontools [7.4-3] (7.4-3+deb13u1 Debian:13.2/stable [amd64])
""")
