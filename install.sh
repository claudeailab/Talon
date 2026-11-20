#!/usr/bin/env bash
# Talon installer
#
#   curl -fsSL https://raw.githubusercontent.com/claudeailab/Talon/main/install.sh | bash
#
# Supported: Debian 12/13, Ubuntu 22.04/24.04/26.04, Raspberry Pi OS 12/13 (64-bit)
# on amd64 and arm64.  Re-running the installer upgrades an existing installation
# and keeps its configuration.
#
# The web UI runs on https://<nas-ip>/ (port 443). The Linux user who runs the
# installer becomes the administrator (root access is requested when needed).
#
#   TALON_FORCE=1          skip the OS/architecture check
set -Eeuo pipefail

REPO=claudeailab/Talon
PREFIX=/opt/talon
CONF_DIR=/etc/talon
STATE_DIR=/var/lib/talon
MOUNT_ROOT=/srv/nas
ADMIN_GROUP=nasadmins
USERS_GROUP=nasusers

c_blue=$'\e[1;34m'; c_green=$'\e[1;32m'; c_yellow=$'\e[1;33m'; c_red=$'\e[1;31m'; c_off=$'\e[0m'
[ -t 1 ] || { c_blue=; c_green=; c_yellow=; c_red=; c_off=; }
step() { echo "${c_blue}==>${c_off} $*"; }
ok()   { echo "${c_green}  ✓${c_off} $*"; }
warn() { echo "${c_yellow}  !${c_off} $*"; }
die()  { echo "${c_red}ERROR:${c_off} $*" >&2; exit 1; }
trap 'die "installation failed at line $LINENO"' ERR

has_systemd() { [ -d /run/systemd/system ]; }

# ---------------------------------------------------------------- root
# Not root: ask for a password in this terminal (sudo if installed, else su)
# and run the installer again as root.
if [ "$(id -u)" -ne 0 ]; then
  { : </dev/tty; } 2>/dev/null || die "root access is needed: run the installer in a terminal"
  self="${BASH_SOURCE[0]:-}"
  if [ -z "$self" ] || [ ! -f "$self" ]; then   # piped from curl: fetch a copy
    self="$(mktemp /tmp/talon-install.XXXXXX)"
    curl -fsSL "https://raw.githubusercontent.com/${REPO}/main/install.sh" -o "$self" \
      || die "download failed"
    chmod 644 "$self"
  fi
  if command -v sudo >/dev/null 2>&1; then
    echo "Talon needs root access. Enter your password if asked."
    exec sudo bash "$self" </dev/tty
  fi
  echo "Talon needs root access. Enter the root password."
  exec su root -c "SUDO_USER=$(id -un) bash '$self'" </dev/tty
fi

# ---------------------------------------------------------------- checks
[ -r /etc/os-release ] || die "/etc/os-release not found"
. /etc/os-release
ARCH="$(dpkg --print-architecture 2>/dev/null || uname -m)"

supported=0
case "${ID:-}:${VERSION_ID:-}" in
  debian:12|debian:13|raspbian:12|raspbian:13) supported=1 ;;
  ubuntu:22.04|ubuntu:24.04|ubuntu:26.04) supported=1 ;;
esac
if [ "$supported" -ne 1 ] && [ "${TALON_FORCE:-0}" != 1 ]; then
  die "unsupported OS '${PRETTY_NAME:-unknown}'. Supported: Debian 12/13, Ubuntu 22.04/24.04/26.04, Raspberry Pi OS 12/13. Set TALON_FORCE=1 to try anyway."
fi
case "$ARCH" in
  amd64|arm64) ;;
  *) [ "${TALON_FORCE:-0}" = 1 ] || die "unsupported architecture '$ARCH' (amd64 and arm64 are supported; use a 64-bit OS on Raspberry Pi)" ;;
esac

echo
echo "${c_blue}Talon installer${c_off} — ${PRETTY_NAME} (${ARCH})"
echo

# ---------------------------------------------------------------- packages
step "Checking system packages"
export DEBIAN_FRONTEND=noninteractive
PKGS=(python3 python3-venv ca-certificates curl openssl tar iproute2 udev util-linux
      mdadm parted smartmontools e2fsprogs xfsprogs acl
      samba samba-common-bin nfs-kernel-server avahi-daemon)
is_installed() { dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q "install ok installed"; }
# Only install what is missing: never upgrade (and thereby restart) Samba/NFS
# while clients may be connected, e.g. during an update from the web UI.
MISSING=()
for p in "${PKGS[@]}"; do is_installed "$p" || MISSING+=("$p"); done
APT_UPDATED=0
if [ "${#MISSING[@]}" -gt 0 ]; then
  echo "    installing: ${MISSING[*]} (this can take a few minutes)"
  apt-get update -q >/dev/null; APT_UPDATED=1
  apt-get install -y -q --no-install-recommends "${MISSING[@]}" >/dev/null
fi
ok "system packages present"
# Windows network discovery: wsdd (Debian 12+/Ubuntu 22.04+), wsdd2 as fallback
if is_installed wsdd || is_installed wsdd2; then
  ok "WS-Discovery present (Windows network discovery)"
else
  [ "$APT_UPDATED" = 1 ] || apt-get update -q >/dev/null
  if apt-get install -y -q --no-install-recommends wsdd >/dev/null 2>&1; then
    ok "wsdd installed (Windows network discovery)"
  elif apt-get install -y -q --no-install-recommends wsdd2 >/dev/null 2>&1; then
    ok "wsdd2 installed (Windows network discovery)"
  else
    warn "wsdd not available - the NAS will not appear automatically in Windows Network"
  fi
fi

# ---------------------------------------------------------------- sources
SRC=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/backend/talon/__init__.py" ]; then
  SRC="$SCRIPT_DIR"
  step "Installing from local checkout $SRC"
else
  step "Downloading Talon"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  curl -fsSL "https://codeload.github.com/${REPO}/tar.gz/main" -o "$TMP/src.tgz" \
    || die "download failed - is the repository public and reachable?"
  tar -xzf "$TMP/src.tgz" -C "$TMP"
  SRC="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -n1)"
fi
[ -f "$SRC/backend/talon/web/index.html" ] || die "web UI build missing in source ($SRC/backend/talon/web)"

# ---------------------------------------------------------------- application
step "Installing application to $PREFIX"
mkdir -p "$PREFIX" "$CONF_DIR/tls" "$STATE_DIR" "$MOUNT_ROOT"
chmod 700 "$CONF_DIR" "$STATE_DIR"
rm -rf "$PREFIX/app.new"
mkdir -p "$PREFIX/app.new"
cp -a "$SRC/backend/talon" "$SRC/backend/requirements.txt" "$PREFIX/app.new/"
rm -rf "$PREFIX/app"
mv "$PREFIX/app.new" "$PREFIX/app"
cp "$SRC/uninstall.sh" "$PREFIX/uninstall.sh" 2>/dev/null && chmod 755 "$PREFIX/uninstall.sh" || true

if [ ! -x "$PREFIX/venv/bin/python" ] || ! "$PREFIX/venv/bin/python" -c 'import sys' 2>/dev/null; then
  rm -rf "$PREFIX/venv"
  python3 -m venv "$PREFIX/venv"
fi
"$PREFIX/venv/bin/python" -m pip install -q --disable-pip-version-check --no-cache-dir --upgrade pip >/dev/null
"$PREFIX/venv/bin/python" -m pip install -q --disable-pip-version-check --no-cache-dir --upgrade \
  -r "$PREFIX/app/requirements.txt" >/dev/null
ok "Python environment ready ($("$PREFIX/venv/bin/python" -c 'import fastapi,sys;print(f"Python {sys.version.split()[0]}, FastAPI {fastapi.__version__}")'))"

cat > /usr/local/sbin/talon <<EOF
#!/bin/sh
cd $PREFIX/app && exec $PREFIX/venv/bin/python -m talon "\$@"
EOF
chmod 755 /usr/local/sbin/talon

# ---------------------------------------------------------------- configuration
port_in_use() { ss -Hltn "sport = :$1" 2>/dev/null | grep -q .; }
if [ -f "$CONF_DIR/config.json" ]; then
  PORT="$("$PREFIX/venv/bin/python" -c "import json;print(json.load(open('$CONF_DIR/config.json')).get('port',443))")"
  "$PREFIX/venv/bin/python" - "$CONF_DIR/config.json" "$REPO" <<'PYEOF'
import json, sys
p, repo = sys.argv[1], sys.argv[2]
d = json.load(open(p))
if "repo" not in d:
    d["repo"] = repo
    json.dump(d, open(p, "w"), indent=2)
PYEOF
  ok "keeping existing configuration (port $PORT)"
else
  PORT=443
  port_in_use 443 && die "port 443 is already used by another program; stop it and run the installer again"
  cat > "$CONF_DIR/config.json" <<EOF
{
  "port": $PORT,
  "mount_root": "$MOUNT_ROOT",
  "admin_group": "$ADMIN_GROUP",
  "users_group": "$USERS_GROUP",
  "repo": "$REPO"
}
EOF
  chmod 600 "$CONF_DIR/config.json"
fi

HOST="$(hostname)"
if [ ! -s "$CONF_DIR/tls/cert.pem" ]; then
  step "Creating self-signed TLS certificate"
  SAN="DNS:${HOST},DNS:${HOST}.local,DNS:localhost,IP:127.0.0.1"
  for ip in $(hostname -I 2>/dev/null); do
    case "$ip" in *:*) ;; *) SAN="$SAN,IP:$ip" ;; esac
  done
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 3650 \
    -subj "/CN=${HOST}/O=Talon" -addext "subjectAltName=${SAN}" \
    -keyout "$CONF_DIR/tls/key.pem" -out "$CONF_DIR/tls/cert.pem" >/dev/null 2>&1
  chmod 600 "$CONF_DIR/tls/key.pem"
  ok "certificate for ${HOST} created"
fi

cat > /etc/pam.d/talon <<'EOF'
# Talon web interface login
@include common-auth
@include common-account
EOF

# ---------------------------------------------------------------- groups & admin
step "Setting up users and groups"
getent group "$USERS_GROUP" >/dev/null || groupadd "$USERS_GROUP"
getent group "$ADMIN_GROUP" >/dev/null || groupadd "$ADMIN_GROUP"

ADMIN="${SUDO_USER:-}"
NEW_ADMIN_PW=""
if [ -n "$ADMIN" ] && [ "$ADMIN" != root ] && id "$ADMIN" >/dev/null 2>&1; then
  usermod -aG "$ADMIN_GROUP,$USERS_GROUP" "$ADMIN"
  ok "'$ADMIN' is a Talon administrator (sign in with its Linux password)"
elif [ -z "$(getent group "$ADMIN_GROUP" | cut -d: -f4)" ]; then
  ADMIN=nasadmin
  NEW_ADMIN_PW="$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 16)"
  if ! id "$ADMIN" >/dev/null 2>&1; then
    useradd -M -N -g "$USERS_GROUP" -G "$ADMIN_GROUP" -s /usr/sbin/nologin -c "Talon administrator" "$ADMIN"
  fi
  echo "$ADMIN:$NEW_ADMIN_PW" | chpasswd
  printf '%s\n%s\n' "$NEW_ADMIN_PW" "$NEW_ADMIN_PW" | smbpasswd -a -s "$ADMIN" >/dev/null
  ok "created administrator '$ADMIN'"
else
  ADMIN="$(getent group "$ADMIN_GROUP" | cut -d: -f4 | cut -d, -f1)"
  ok "existing administrator: $ADMIN"
fi

# ---------------------------------------------------------------- file sharing
step "Configuring file sharing"
[ -f /etc/samba/smb.conf.talon-backup ] || cp -a /etc/samba/smb.conf /etc/samba/smb.conf.talon-backup 2>/dev/null || true
mkdir -p /etc/exports.d /etc/avahi/services
/usr/local/sbin/talon apply >/dev/null
ok "Samba, NFS and Bonjour configuration written"

if has_systemd; then
  for unit in smbd nfs-server avahi-daemon wsdd wsdd2; do
    if systemctl list-unit-files "$unit.service" >/dev/null 2>&1 \
       && systemctl list-unit-files "$unit.service" | grep -q "^$unit.service"; then
      systemctl enable --now "$unit" >/dev/null 2>&1 || warn "could not start $unit"
    fi
  done
fi

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  step "Opening firewall ports (ufw)"
  ufw allow "$PORT/tcp" >/dev/null
  ufw allow 445/tcp >/dev/null; ufw allow 139/tcp >/dev/null
  ufw allow 137:138/udp >/dev/null
  ufw allow 2049/tcp >/dev/null; ufw allow 111 >/dev/null
  ufw allow 5353/udp >/dev/null; ufw allow 3702/udp >/dev/null; ufw allow 5357/tcp >/dev/null
  ok "firewall rules added"
fi

# ---------------------------------------------------------------- service
step "Starting Talon"
cat > /etc/systemd/system/talon.service <<EOF
[Unit]
Description=Talon storage management web interface
After=network-online.target local-fs.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$PREFIX/app
Environment=PYTHONUNBUFFERED=1
ExecStart=$PREFIX/venv/bin/python -m talon serve
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
if has_systemd; then
  systemctl daemon-reload
  systemctl enable talon >/dev/null 2>&1
  systemctl restart talon
  for _ in $(seq 1 20); do
    if curl -fsk -o /dev/null "https://127.0.0.1:$PORT/"; then break; fi
    sleep 1
  done
  if curl -fsk -o /dev/null "https://127.0.0.1:$PORT/"; then
    ok "web interface is running"
  else
    warn "the service did not answer yet - check: journalctl -u talon -e"
  fi
else
  warn "systemd not detected - start manually with: talon serve"
fi

# ---------------------------------------------------------------- summary
PORT_SUFFIX=""; [ "$PORT" = 443 ] || PORT_SUFFIX=":$PORT"
echo
echo "${c_green}Talon is installed.${c_off}"
echo
echo "  Open in your browser:"
for ip in $(hostname -I 2>/dev/null); do
  case "$ip" in *:*) ;; *) echo "    https://${ip}${PORT_SUFFIX}/" ;; esac
done
echo "    https://${HOST}.local${PORT_SUFFIX}/"
echo
echo "  The certificate is self-signed: accept the browser warning on first visit."
if [ -n "$NEW_ADMIN_PW" ]; then
  echo
  echo "  Administrator login:  ${c_yellow}${ADMIN}${c_off} / ${c_yellow}${NEW_ADMIN_PW}${c_off}"
  echo "  Change this password in Users & groups after signing in."
else
  echo "  Sign in as '${ADMIN}' with its Linux password."
fi
echo
