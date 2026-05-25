#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
STACK_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ENV_FILE="$STACK_ROOT/.env"
PREPARE_SCRIPT="$SCRIPT_DIR/prepare-state.sh"
COMPOSE_FILE="$STACK_ROOT/docker-compose.yml"
HOST_FIREWALL_SCRIPT="$SCRIPT_DIR/host-firewall.sh"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

if [ -z "${WIREGUARD_HOST:-}" ]; then
  echo "WIREGUARD_HOST must be set in infra/wireguard/.env" >&2
  exit 1
fi

if [ -z "${WIREGUARD_PEERS:-}" ]; then
  echo "WIREGUARD_PEERS must list at least one peer in infra/wireguard/.env" >&2
  exit 1
fi

cd "$STACK_ROOT"
sh "$PREPARE_SCRIPT"

if [ "${APPLY_HOST_FIREWALL:-1}" = "1" ]; then
  if [ "$(id -u)" -ne 0 ]; then
    echo "APPLY_HOST_FIREWALL=1 requires running ./scripts/up.sh with sudo." >&2
    exit 1
  fi
  if [ -z "${ALLOWED_TCP_PORTS:-}" ]; then
    echo "ALLOWED_TCP_PORTS must be set in infra/wireguard/.env when APPLY_HOST_FIREWALL=1." >&2
    exit 1
  fi
  sh "$HOST_FIREWALL_SCRIPT" apply
fi

docker compose -f "$COMPOSE_FILE" up -d
