#!/usr/bin/env bash
# Remove the Talon web interface.
#
#   sudo /opt/talon/uninstall.sh          # keep configuration and shares
#   sudo /opt/talon/uninstall.sh --purge  # also remove config, stop sharing
#
# Volumes, RAID arrays, data, /etc/fstab entries and user accounts are NEVER
# touched: your disks keep working and stay mounted at /srv/nas/*.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
PURGE=0; [ "${1:-}" = "--purge" ] && PURGE=1

if [ -d /run/systemd/system ]; then
  systemctl disable --now talon >/dev/null 2>&1 || true
fi
rm -f /etc/systemd/system/talon.service /etc/pam.d/talon /usr/local/sbin/talon
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
