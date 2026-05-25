#!/usr/bin/env sh

# Single command that brings the streamingimmunity stack up. Always:
#   1. git pull --rebase --autostash       (sync to latest)
#   2. docker compose build backend streamo (cache-friendly, no-op if unchanged)
#   3. docker compose up -d --scale ...    (recreate containers with new env/image)
#   4. force-recreate caddy + cert-renew   (picks up Caddyfile / cert-loop.sh edits
#                                           that aren't tracked by compose because
#                                           they're bind-mounted, not in the image)
#
# Result: any code, config, or env change is picked up by running this one script.
# No flags needed for the common case.

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

WORKER_REPLICAS_ARG=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --workers)
      if [ "$#" -lt 2 ]; then
        echo "Missing value for --workers" >&2
        exit 1
      fi
      WORKER_REPLICAS_ARG=$2
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: ./scripts/up.sh [--workers N]" >&2
      exit 1
      ;;
  esac
done

if [ -n "$WORKER_REPLICAS_ARG" ]; then
  WORKER_REPLICAS=$WORKER_REPLICAS_ARG
elif [ -n "${WORKER_REPLICAS:-}" ]; then
  :
else
  WORKER_REPLICAS=1
fi

case "$WORKER_REPLICAS" in
  ''|*[!0-9]*)
    echo "WORKER_REPLICAS must be a positive integer" >&2
    exit 1
    ;;
esac

if [ "$WORKER_REPLICAS" -le 0 ]; then
  echo "WORKER_REPLICAS must be greater than zero" >&2
  exit 1
fi

cd "$PROJECT_ROOT"

echo "==> git pull"
git pull --rebase --autostash

echo "==> docker compose build (cache-friendly)"
docker compose build backend streamo

echo "==> docker compose up -d (backend-worker replicas=$WORKER_REPLICAS)"
docker compose up -d --scale "backend-worker=$WORKER_REPLICAS"

# Caddy mounts the Caddyfile and cert-renew mounts cert-loop.sh as bind
# volumes, so file edits don't propagate into the running container until
# it's recreated. compose up -d alone leaves them untouched (no config
# diff). Force-recreate the two so any local change to those files takes
# effect. Cost is ~2s of Caddy downtime, acceptable for a homelab.
echo "==> force-recreate caddy + cert-renew (pick up bind-mount changes)"
docker compose up -d --no-deps --force-recreate caddy cert-renew

# Realign ownership/permissions on sensitive files. Containers can leave
# fresh logs root-owned, and APP_OWNER_UID/GID may have changed since
# last run. fix-perms.sh needs sudo for docker-owned files; if sudo
# isn't available passwordless, skip with a hint (the user can run it
# manually later).
echo "==> realign ownership/permissions"
if sudo -n true 2>/dev/null; then
  sudo sh "$SCRIPT_DIR/fix-perms.sh"
else
  echo "  (skipped: sudo would prompt for password — run \`sudo sh ./scripts/fix-perms.sh\` separately)"
fi
