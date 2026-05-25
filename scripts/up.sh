#!/usr/bin/env sh

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
BUILD_FLAG=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --build)
      BUILD_FLAG=1
      shift
      ;;
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
      echo "Usage: ./scripts/up.sh [--build] [--workers N]" >&2
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

set -- compose
set -- "$@" up -d --scale "backend-worker=$WORKER_REPLICAS"

echo "Starting stack with backend-worker replicas=$WORKER_REPLICAS"
cd "$PROJECT_ROOT"
if [ "$BUILD_FLAG" -eq 1 ]; then
  git pull --rebase --autostash
  docker compose build backend streamo
fi
docker "$@"
