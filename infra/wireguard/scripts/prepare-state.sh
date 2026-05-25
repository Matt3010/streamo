#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
STACK_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
WIREGUARD_DIR="$STACK_ROOT/data"
ENV_FILE="$STACK_ROOT/.env"

# Re-source .env defensively in case prepare-state.sh is invoked
# standalone (up.sh already exports the vars before calling us).
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

WIREGUARD_OWNER=${WIREGUARD_OWNER:-matteoscanferla}
WIREGUARD_GROUP=${WIREGUARD_GROUP:-matteoscanferla}
PUID=${WIREGUARD_PUID:-1000}
PGID=${WIREGUARD_PGID:-1000}

umask 077

mkdir -p "$WIREGUARD_DIR"
chmod 700 "$WIREGUARD_DIR"

# Render the CoreDNS hosts file from LAN_IP / LAN_HOSTNAMES in .env. This
# is the source of truth for which names resolve inside the VPN — keeping
# it env-driven so adding a hostname is a one-line edit.
LAN_IP=${LAN_IP:-}
LAN_HOSTNAMES=${LAN_HOSTNAMES:-}
HOSTS_FILE="$WIREGUARD_DIR/coredns/hosts"

mkdir -p "$WIREGUARD_DIR/coredns"
{
  echo "# Auto-generated from infra/wireguard/.env (LAN_IP, LAN_HOSTNAMES)."
  echo "# Do not edit by hand — edit the env file and re-run scripts/up.sh."
  if [ -n "$LAN_IP" ] && [ -n "$LAN_HOSTNAMES" ]; then
    echo "$LAN_IP $LAN_HOSTNAMES"
  fi
} > "$HOSTS_FILE"

# Prefer the explicit Linux user/group for this host. If they don't exist,
# fall back to numeric ids so the stack stays portable.
if ! chown -R "$WIREGUARD_OWNER:$WIREGUARD_GROUP" "$WIREGUARD_DIR" 2>/dev/null; then
  chown -R "$PUID:$PGID" "$WIREGUARD_DIR" 2>/dev/null || true
fi

find "$WIREGUARD_DIR" -type d -exec chmod 700 {} \;
find "$WIREGUARD_DIR" -type f -exec chmod 600 {} \;

echo "Prepared WireGuard state directory at $WIREGUARD_DIR"
