#!/usr/bin/env sh
# One-shot cleanup that tightens ownership and permissions on every
# sensitive file in this stack. Idempotent — safe to re-run any time.
# After this, the cert containers and prepare-state.sh maintain
# correct ownership automatically on subsequent runs.
#
# Must be run with sudo because some files (logs, certs, postgres data)
# are owned by root inside docker volumes.

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ENV_FILE="$PROJECT_ROOT/.env"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

OWNER_UID=${APP_OWNER_UID:-1000}
OWNER_GID=${APP_OWNER_GID:-1000}

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root (sudo): some files are docker-owned by root." >&2
  exit 1
fi

echo "==> Tightening .env files to 0600 (owned by $OWNER_UID:$OWNER_GID)"
for f in "$PROJECT_ROOT/.env" "$PROJECT_ROOT/infra/wireguard/.env"; do
  [ -f "$f" ] || continue
  chown "$OWNER_UID:$OWNER_GID" "$f"
  chmod 600 "$f"
done

echo "==> Tightening certs in infra/certs/"
if [ -d "$PROJECT_ROOT/infra/certs" ]; then
  chown -R "$OWNER_UID:$OWNER_GID" "$PROJECT_ROOT/infra/certs"
  # Private keys: 0600. Public certs: 0644 (they're public anyway).
  find "$PROJECT_ROOT/infra/certs" -name '*-key.pem' -exec chmod 600 {} \;
  find "$PROJECT_ROOT/infra/certs" -name 'rootCA.pem' -exec chmod 644 {} \;
  find "$PROJECT_ROOT/infra/certs" -name 'streamo.pem' -exec chmod 644 {} \;
fi

echo "==> Tightening runtime logs in data/"
for log in auth.log nginx-playback-access.log playback.log provider-resolve.log; do
  f="$PROJECT_ROOT/data/$log"
  [ -f "$f" ] || continue
  chown "$OWNER_UID:$OWNER_GID" "$f"
  chmod 600 "$f"
done

echo "==> Removing stale SQLite dumps from data/ (Postgres migration done)"
rm -f "$PROJECT_ROOT/data/vixstream.db.bak" \
      "$PROJECT_ROOT/data/vixstream.db.migrated"

echo "Done."
