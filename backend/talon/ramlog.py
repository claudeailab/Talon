"""Fewer writes to the system disk: keep /var/log in memory.

SD cards and USB flash drives wear out from many small writes, and the logs of the
operating system are the biggest source. When this is on, /var/log lives in RAM
(tmpfs) and is copied to the disk once a day and when the NAS shuts down or
restarts, the same idea as log2ram. Talon writes its own files less often too.

At boot a small systemd service (talon-ramlog) bind-mounts the real /var/log to
/var/hdd.log, mounts a tmpfs on /var/log and copies the logs into it. It never
stops the NAS from starting: if anything fails, the logs simply stay on the disk.
Turning it on or off (Services → SD-card protection, off by default) takes effect
after the next restart."""
from __future__ import annotations

import os
import time
from typing import Dict, List, Optional, Tuple

from .util import read_file, run, write_atomic

SCRIPT = "/usr/local/sbin/talon-ramlog"
UNIT = "/etc/systemd/system/talon-ramlog.service"
SYNC_SERVICE = "/etc/systemd/system/talon-ramlog-sync.service"
SYNC_TIMER = "/etc/systemd/system/talon-ramlog-sync.timer"
JOURNALD = "/etc/systemd/journald.conf.d/talon-ramlog.conf"
STAMP = "/var/hdd.log/.talon-ramlog-synced"
SIZE_MB = 128          # the memory /var/log may use
JOURNAL_MB = 48        # the journal is kept below this, so it fits

SCRIPT_TEXT = f"""#!/bin/sh
# Talon: keep /var/log in memory (tmpfs) and copy it to the disk once a day and at shutdown.
# Never fails the boot: on any problem the logs stay on the disk.
HDD=/var/hdd.log
sync_to_disk() {{
    mountpoint -q "$HDD" || return 0
    if command -v rsync >/dev/null 2>&1; then
        rsync -aX --inplace --delete /var/log/ "$HDD"/ 2>/dev/null
    else
        cp -a -u /var/log/. "$HDD"/ 2>/dev/null
    fi
    date +%s > "$HDD"/.talon-ramlog-synced 2>/dev/null
    return 0
}}
case "$1" in
start)
    mountpoint -q "$HDD" && exit 0
    used=$(du -sm /var/log 2>/dev/null | cut -f1)
    if [ "${{used:-0}}" -gt {SIZE_MB - 24} ]; then
        echo "talon-ramlog: /var/log uses ${{used}} MB, too much to keep in memory" >&2
        exit 0
    fi
    mkdir -p "$HDD"
    mount --bind /var/log "$HDD" || exit 0
    mount --make-private "$HDD" 2>/dev/null
    if ! mount -t tmpfs -o nosuid,noexec,nodev,mode=0755,size={SIZE_MB}M talon-ramlog /var/log; then
        umount "$HDD"
        exit 0
    fi
    cp -a "$HDD"/. /var/log/ 2>/dev/null
    rm -f /var/log/.talon-ramlog-synced
    ;;
write)
    sync_to_disk
    ;;
stop)
    sync_to_disk
    umount -l /var/log 2>/dev/null
    umount -l "$HDD" 2>/dev/null
    ;;
esac
exit 0
"""

UNIT_TEXT = f"""[Unit]
Description=Talon: keep /var/log in memory to protect the system disk
DefaultDependencies=no
After=local-fs.target
Before=basic.target sysinit.target systemd-journald.service systemd-journal-flush.service rsyslog.service syslog.target shutdown.target
Conflicts=shutdown.target reboot.target halt.target
RequiresMountsFor=/var/log
IgnoreOnIsolate=yes

[Service]
Type=oneshot
ExecStart={SCRIPT} start
ExecStop={SCRIPT} stop
ExecReload={SCRIPT} write
RemainAfterExit=yes
TimeoutStartSec=120
TimeoutStopSec=120

[Install]
WantedBy=sysinit.target
"""

SYNC_SERVICE_TEXT = f"""[Unit]
Description=Talon: copy the logs in memory to the disk

[Service]
Type=oneshot
ExecStart={SCRIPT} write
"""

SYNC_TIMER_TEXT = """[Unit]
Description=Talon: copy the logs in memory to the disk every day

[Timer]
OnCalendar=*-*-* 03:30:00
RandomizedDelaySec=15min
Persistent=true

[Install]
WantedBy=timers.target
"""

JOURNALD_TEXT = f"""# Talon: keep the journal small so it fits in memory with the other logs
[Journal]
SystemMaxUse={JOURNAL_MB}M
"""


def flash_kind(root_disk: str, tran: str = "", rotational: bool = False) -> str:
    """What the system disk is: "sd" (SD card or eMMC), "usb" (USB flash) or ""."""
    if root_disk.startswith("mmcblk"):
        return "sd"
    if tran == "usb" and not rotational:
        return "usb"
    return ""


LOGGERS = ("systemd-journal", "rsyslogd")          # what the logging programs are called in /proc/<pid>/comm
SAMPLE_SECONDS = 300
KEEP_HOURS = 7 * 24
MIN_HOURS = 3                                     # before that, the page says it is still measuring


def read_diskstats(disk: str, text: Optional[str] = None) -> Optional[Tuple[int, int]]:
    """(bytes written, write operations) of a whole disk since boot, from /proc/diskstats."""
    for line in (text if text is not None else read_file("/proc/diskstats") or "").splitlines():
        f = line.split()
        if len(f) >= 10 and f[2] == disk:
            return int(f[9]) * 512, int(f[7])
    return None


def logger_bytes(proc: str = "/proc") -> Dict[int, int]:
    """{pid: bytes it caused to be written to storage} for the logging programs (/proc/<pid>/io)."""
    out = {}
    try:
        pids = [p for p in os.listdir(proc) if p.isdigit()]
    except OSError:
        return out
    for pid in pids:
        try:
            with open(f"{proc}/{pid}/comm") as f:
                if f.read().strip() not in LOGGERS:
                    continue
            with open(f"{proc}/{pid}/io") as f:
                for line in f:
                    if line.startswith("write_bytes:"):
                        out[int(pid)] = int(line.split()[1])
        except (OSError, ValueError):
            continue
    return out


class RamLog:
    def __init__(self, state, demo: bool = False):
        self.state = state
        self.demo = demo
        self._root: Optional[dict] = None
        self._prev: Optional[dict] = None         # the counters at the last sample
        # hourly totals: {hour start: [disk bytes, disk writes, log bytes]}
        self._hours: Dict[int, List[int]] = {int(k): v for k, v in ((self.state.get("ramlog_stats") or {}).items())}

    # ------------------------------------------------------------ measuring
    def sample(self) -> None:
        """Every 5 minutes: what was written to the system disk, and by the logging programs."""
        if self.demo:
            return
        disk = read_diskstats(self._root_disk()["name"])
        if not disk:
            return
        logs = logger_bytes()
        now = time.time()
        prev, self._prev = self._prev, {"disk": disk, "logs": logs}
        if not prev:
            return
        d_bytes = max(0, disk[0] - prev["disk"][0])
        d_ops = max(0, disk[1] - prev["disk"][1])
        # a logging program that restarted starts counting from 0 again
        l_bytes = sum(v - prev["logs"].get(pid, 0) if v >= prev["logs"].get(pid, 0) else v for pid, v in logs.items())
        hour = int(now // 3600 * 3600)
        h = self._hours.setdefault(hour, [0, 0, 0])
        h[0] += d_bytes
        h[1] += d_ops
        h[2] += min(l_bytes, d_bytes)
        cut = hour - KEEP_HOURS * 3600
        for k in [k for k in self._hours if k < cut]:
            del self._hours[k]
        if len(self._hours) and (not hasattr(self, "_saved_hour") or self._saved_hour != hour):
            self._saved_hour = hour                # kept once an hour, so a restart does not lose a week
            snapshot = {str(k): v for k, v in self._hours.items()}
            self.state.update(lambda d: d.__setitem__("ramlog_stats", snapshot))

    def measured(self) -> Optional[dict]:
        """Daily averages over the hours measured (up to 7 days)."""
        if self.demo:
            if (self.state.get("ramlog") or {}).get("enabled"):
                return None
            return {"hours": 168, "disk_bytes": int(2.4 * 1024 ** 3), "disk_ops": 41200,
                    "log_bytes": int(1.4 * 1024 ** 3), "log_ops": 29000}
        hours = len(self._hours)
        if hours < MIN_HOURS:
            return {"hours": hours}
        tot = [sum(h[i] for h in self._hours.values()) for i in range(3)]
        per_day = 24 / hours
        share = tot[2] / tot[0] if tot[0] else 0
        return {"hours": hours, "disk_bytes": int(tot[0] * per_day), "disk_ops": int(tot[1] * per_day),
                "log_bytes": int(tot[2] * per_day), "log_ops": int(tot[1] * share * per_day)}

    def saved(self) -> Optional[dict]:
        """While it is on: the writes it avoided since it was turned on (at most 7 days),
        from what the logs wrote per day before."""
        r = self.state.get("ramlog") or {}
        base = r.get("baseline")
        since = r.get("active_since")
        if self.demo and r.get("enabled"):
            base, since = {"log_bytes": int(1.4 * 1024 ** 3), "log_ops": 29000}, time.time() - 7 * 86400
        if not base or not since:
            return None
        days = min(7.0, max(0.0, (time.time() - since) / 86400))
        return {"days": round(days, 1), "bytes": int(base["log_bytes"] * days), "ops": int(base["log_ops"] * days),
                "per_day_bytes": base["log_bytes"]}

    # ------------------------------------------------------------ status
    def _root_disk(self) -> dict:
        if self.demo:
            return {"name": "mmcblk0", "tran": "", "rotational": False}
        if self._root:
            return self._root
        src = run(["findmnt", "-n", "-o", "SOURCE", "/"], check=False).stdout.strip()
        disk = run(["lsblk", "-ndo", "PKNAME", src], check=False).stdout.strip() if src.startswith("/dev/") else ""
        disk = disk or os.path.basename(src)
        info = run(["lsblk", "-ndo", "TRAN,ROTA", f"/dev/{disk}"], check=False).stdout.split()
        self._root = {"name": disk, "tran": info[0] if info and info[0] not in ("0", "1") else "",
                      "rotational": bool(info) and info[-1] == "1"}
        return self._root

    def active(self) -> bool:
        if self.demo:
            return bool((self.state.get("ramlog") or {}).get("enabled"))
        return run(["mountpoint", "-q", "/var/hdd.log"], check=False).returncode == 0

    def status(self) -> dict:
        root = self._root_disk()
        kind = flash_kind(root["name"], root["tran"], root["rotational"])
        enabled = bool((self.state.get("ramlog") or {}).get("enabled"))
        active = self.active()
        used = self._used_mb() if active else None
        synced = self._synced_at() if active else None
        return {"enabled": enabled, "active": active, "restart_needed": enabled != active,
                "disk": root["name"], "flash": kind, "recommended": bool(kind),
                "used_mb": used, "size_mb": SIZE_MB, "synced_at": synced}

    def _used_mb(self) -> Optional[float]:
        if self.demo:
            return 18.4
        try:
            st = os.statvfs("/var/log")
            return round((st.f_blocks - st.f_bfree) * st.f_frsize / 1024 / 1024, 1)
        except OSError:
            return None

    def _synced_at(self) -> Optional[float]:
        if self.demo:
            return time.time() - 5 * 3600
        try:
            return float(read_file(STAMP).strip())
        except (OSError, ValueError, AttributeError):
            return None

    def service_info(self) -> dict:
        """The Services page: off by default, recommended when the system disk is flash."""
        st = self.status()
        what = {"sd": "an SD card", "usb": "a USB flash drive"}.get(st["flash"])
        if st["active"] and not (self.state.get("ramlog") or {}).get("active_since"):
            # the first look after the restart that turned it on: from now on it saves
            since = time.time() - (7 * 86400 if self.demo else 0)      # the demo pretends it has run for a week
            self.state.update(lambda d: d.setdefault("ramlog", {}).__setitem__("active_since", since))
        disk_label = {"sd": "SD card", "usb": "USB flash drive"}.get(st["flash"], "system disk")
        return {"id": "sdcard", "unit": None, "installed": True, "active": st["active"], "enabled": st["enabled"],
                "writes": {"disk": disk_label, "measured": None if st["active"] else self.measured(),
                           "saved": self.saved() if st["active"] else None,
                           "used_mb": st["used_mb"], "size_mb": st["size_mb"], "synced_at": st["synced_at"],
                           "restart_needed": st["restart_needed"], "recommended": f"Recommended: the system runs from {what}" if what and not st["enabled"] else None,
                           "active_since": (self.state.get("ramlog") or {}).get("active_since")},
                "label": "SD-card protection",
                "description": "Fewer writes to an SD card or USB flash drive",
                "app": True}

    # ------------------------------------------------------------ on / off
    def set_enabled(self, enabled: bool, actor: str) -> dict:
        if not self.demo:
            (self._install if enabled else self._uninstall)()
        m = self.measured() if enabled else None
        # what the logs wrote per day so far: the base for "saved" once it runs
        baseline = {"log_bytes": m["log_bytes"], "log_ops": m["log_ops"]} if m and "log_bytes" in m else None
        self.state.update(lambda d: d.__setitem__("ramlog", {"enabled": bool(enabled), "changed": time.time(),
                                                             "baseline": baseline}))
        self.state.log_activity(actor, ("Turned on" if enabled else "Turned off") +
                                " fewer writes to the system disk (applies after a restart)", "info", "settings")
        return self.status()

    def _install(self) -> None:
        write_atomic(SCRIPT, SCRIPT_TEXT, mode=0o755)
        write_atomic(UNIT, UNIT_TEXT)
        write_atomic(SYNC_SERVICE, SYNC_SERVICE_TEXT)
        write_atomic(SYNC_TIMER, SYNC_TIMER_TEXT)
        os.makedirs(os.path.dirname(JOURNALD), exist_ok=True)
        write_atomic(JOURNALD, JOURNALD_TEXT)
        # shrink the journal now, so /var/log fits in memory at the next boot
        run(["journalctl", f"--vacuum-size={JOURNAL_MB}M"], check=False)
        run(["systemctl", "daemon-reload"], check=False)
        run(["systemctl", "enable", "talon-ramlog.service", "talon-ramlog-sync.timer"], check=False)

    def _uninstall(self) -> None:
        run(["systemctl", "disable", "talon-ramlog.service", "talon-ramlog-sync.timer"], check=False)
        # the files stay until the next boot when it is active now: the shutdown copies the logs back
        if not self.active():
            for f in (UNIT, SYNC_SERVICE, SYNC_TIMER, SCRIPT):
                try:
                    os.remove(f)
                except OSError:
                    pass
        try:
            os.remove(JOURNALD)
        except OSError:
            pass
        run(["systemctl", "daemon-reload"], check=False)

    def write_now(self) -> None:
        if not self.demo and self.active():
            run(["systemctl", "reload", "talon-ramlog.service"], check=False)
