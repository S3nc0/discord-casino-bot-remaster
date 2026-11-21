#!/usr/bin/env bash
set -euo pipefail

ARCH="$(uname -m)"
if [ "$ARCH" != "aarch64" ] && [ "$ARCH" != "arm64" ]; then
  echo "Error: ops/pi/install.sh requires an arm64/aarch64 host (detected: $ARCH)." >&2
  exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "Error: run as root (for example: sudo bash ops/pi/install.sh)." >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
APP_DIR="${APP_DIR:-/opt/discord-casino}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/discord-casino}"
SERVICE_USER="${SERVICE_USER:-casino}"
PNPM_VERSION="12.21.0"

missing_pkgs=()
for cmd in sqlite3 curl gpg rsync; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    case "$cmd" in
      gpg) missing_pkgs+=(gnupg) ;;
      *) missing_pkgs+=("$cmd") ;;
    esac
  fi
done

if [ "${#missing_pkgs[@]}" -gt 0 ] || ! dpkg -s ca-certificates >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y --no-install-recommends ca-certificates "${missing_pkgs[@]}"
fi

install_node24() {
  local current_major=""
  if command -v node >/dev/null 2>&1; then
    current_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
  fi
  if [ "$current_major" = "24" ]; then
    return 0
  fi

  echo "Installing Node.js 24..."
  export DEBIAN_FRONTEND=noninteractive
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt-get install -y --no-install-recommends nodejs
}

install_pnpm() {
  local current_pnpm=""
  if command -v pnpm >/dev/null 2>&1; then
    current_pnpm="$(pnpm --version 2>/dev/null || true)"
  fi
  if [ "$current_pnpm" = "$PNPM_VERSION" ]; then
    return 0
  fi

  echo "Installing pnpm@${PNPM_VERSION}..."
  npm install -g "pnpm@${PNPM_VERSION}"
}

install_cloudflared() {
  if command -v cloudflared >/dev/null 2>&1; then
    return 0
  fi

  echo "Installing cloudflared (arm64)..."
  local tmp_deb
  tmp_deb="$(mktemp /tmp/cloudflared-XXXXXX.deb)"
  if curl -fsSL -o "$tmp_deb" \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb"; then
    dpkg -i "$tmp_deb"
    rm -f -- "$tmp_deb"
  else
    rm -f -- "$tmp_deb"
    return 1
  fi
}

install_node24
install_pnpm
install_cloudflared

if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --user-group --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0750 "$APP_DIR" "$APP_DIR/data" "$BACKUP_DIR"
install -d -o root -g "$SERVICE_USER" -m 0750 /etc/cloudflared

if [ "$SRC_DIR" != "$APP_DIR" ]; then
  rsync -a --delete \
    --exclude '.git' \
    --exclude '.env' \
    --exclude '.env.*' \
    --exclude 'data/' \
    --exclude 'node_modules/' \
    --exclude 'legacy/' \
    "$SRC_DIR/" "$APP_DIR/"
fi

chown -R "${SERVICE_USER}:${SERVICE_USER}" "$APP_DIR" "$BACKUP_DIR"
chmod 0750 "$APP_DIR/data" "$BACKUP_DIR"

runuser -u "$SERVICE_USER" -- env HOME="$APP_DIR" pnpm --dir "$APP_DIR" install --frozen-lockfile
runuser -u "$SERVICE_USER" -- env HOME="$APP_DIR" pnpm --dir "$APP_DIR" --filter @casino/server build

chmod 0755 "$APP_DIR/ops/pi/backup.sh"

install -m 0644 "$APP_DIR/ops/pi/discord-casino.service" /etc/systemd/system/discord-casino.service
install -m 0644 "$APP_DIR/ops/pi/cloudflared.service" /etc/systemd/system/cloudflared.service
install -m 0644 "$APP_DIR/ops/pi/discord-casino-backup.service" /etc/systemd/system/discord-casino-backup.service
install -m 0644 "$APP_DIR/ops/pi/discord-casino-backup.timer" /etc/systemd/system/discord-casino-backup.timer

if [ ! -f /etc/cloudflared/config.yml ]; then
  install -o root -g "$SERVICE_USER" -m 0640 \
    "$APP_DIR/ops/cloudflared/config.example.yml" \
    /etc/cloudflared/config.yml
fi

systemctl daemon-reload
systemctl enable --now discord-casino-backup.timer
systemctl enable discord-casino.service cloudflared.service

if [ -f "$APP_DIR/.env" ]; then
  chmod 0600 "$APP_DIR/.env"
  chown "${SERVICE_USER}:${SERVICE_USER}" "$APP_DIR/.env"
  systemctl restart discord-casino.service
else
  echo "Next: create $APP_DIR/.env from $APP_DIR/.env.example (chmod 600, chown ${SERVICE_USER}:${SERVICE_USER}), then run:"
  echo "  sudo systemctl start discord-casino.service"
fi

if grep -q 'YOUR_TUNNEL_ID' /etc/cloudflared/config.yml 2>/dev/null; then
  echo "Next: update /etc/cloudflared/config.yml with your tunnel ID, credentials file, and API domain, then run:"
  echo "  sudo systemctl start cloudflared.service"
else
  systemctl restart cloudflared.service
fi

echo "Install complete."
