#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
STACK_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
WIREGUARD_DIR="$STACK_ROOT/data"

PUID=${WIREGUARD_PUID:-1000}
PGID=${WIREGUARD_PGID:-1000}

umask 077

mkdir -p "$WIREGUARD_DIR"
chmod 700 "$WIREGUARD_DIR"

if chown -R "$PUID:$PGID" "$WIREGUARD_DIR" 2>/dev/null; then
  :
fi

find "$WIREGUARD_DIR" -type d -exec chmod 700 {} \;
find "$WIREGUARD_DIR" -type f -exec chmod 600 {} \;

echo "Prepared WireGuard state directory at $WIREGUARD_DIR"
