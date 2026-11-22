#!/usr/bin/env bash
# Remove the Talon web interface.
#
#   /opt/talon/uninstall.sh          # keep configuration and shares
#   /opt/talon/uninstall.sh --purge  # also remove config, stop sharing
#
# Volumes, RAID arrays, data, /etc/fstab entries and user accounts are NEVER
# touched: your disks keep working and stay mounted at /srv/nas/*.
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then   # ask for a password: sudo if installed, else su
  echo "Removing Talon needs root access."
  command -v sudo >/dev/null 2>&1 && exec sudo bash "$0" "$@"
  exec su root -c "bash $(printf '%q ' "$0" "$@")"
fi
PURGE=0; [ "${1:-}" = "--purge" ] && PURGE=1

if [ -d /run/systemd/system ]; then
  systemctl disable --now talon >/dev/null 2>&1 || true
  # logs kept in memory: stopping copies them back to the disk and unmounts the memory
  systemctl disable --now talon-ramlog-sync.timer talon-ramlog.service >/dev/null 2>&1 || true
fi
rm -f /etc/systemd/system/talon.service /etc/pam.d/talon /usr/local/sbin/talon
rm -f /etc/systemd/system/talon-ramlog.service /etc/systemd/system/talon-ramlog-sync.service \
  /etc/systemd/system/talon-ramlog-sync.timer /etc/systemd/journald.conf.d/talon-ramlog.conf /usr/local/sbin/talon-ramlog
[ -d /run/systemd/system ] && systemctl daemon-reload || true
rm -rf /opt/talon
echo "Talon web interface removed."

if [ "$PURGE" = 1 ]; then
  if [ -f /etc/samba/smb.conf.talon-backup ]; then
    mv /etc/samba/smb.conf.talon-backup /etc/samba/smb.conf
    systemctl reload smbd 2>/dev/null || true
  fi
  rm -f /etc/exports.d/talon.exports /etc/avahi/services/talon.service
  exportfs -ra 2>/dev/null || true
  rm -rf /etc/talon /var/lib/talon
  echo "Configuration removed; SMB/NFS shares are no longer published."
else
  echo "Configuration kept in /etc/talon and /var/lib/talon; shares remain active."
fi
echo "Your volumes and data were not modified."
