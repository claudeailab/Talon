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
from typing import Optional

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


class RamLog:
    def __init__(self, state, demo: bool = False):
        self.state = state
        self.demo = demo

    # ------------------------------------------------------------ status
    def _root_disk(self) -> dict:
        if self.demo:
            return {"name": "mmcblk0", "tran": "", "rotational": False}
        src = run(["findmnt", "-n", "-o", "SOURCE", "/"], check=False).stdout.strip()
        disk = run(["lsblk", "-ndo", "PKNAME", src], check=False).stdout.strip() if src.startswith("/dev/") else ""
        disk = disk or os.path.basename(src)
        info = run(["lsblk", "-ndo", "TRAN,ROTA", f"/dev/{disk}"], check=False).stdout.split()
        return {"name": disk, "tran": info[0] if info and info[0] not in ("0", "1") else "",
                "rotational": bool(info) and info[-1] == "1"}

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
        detail = ("Applies after the next restart" if st["restart_needed"]
                  else f"Logs in memory: {st['used_mb']} of {st['size_mb']} MB" if st["active"]
                  else f"Recommended: the system runs from {what}" if what else None)
        return {"id": "sdcard", "unit": None, "installed": True, "active": st["active"], "enabled": st["enabled"],
                "label": "SD-card protection",
                "description": "Keeps the system logs in memory and writes them to the disk once a day, "
                               "so an SD card or USB flash drive lasts longer",
                "detail": detail, "app": True}

    # ------------------------------------------------------------ on / off
    def set_enabled(self, enabled: bool, actor: str) -> dict:
        if not self.demo:
            (self._install if enabled else self._uninstall)()
        self.state.update(lambda d: d.__setitem__("ramlog", {"enabled": bool(enabled), "changed": time.time()}))
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
