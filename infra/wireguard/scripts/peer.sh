#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
STACK_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ENV_FILE="$STACK_ROOT/.env"
WIREGUARD_DIR="$STACK_ROOT/data"
COMPOSE_FILE="$STACK_ROOT/docker-compose.yml"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/peer.sh list
  ./scripts/peer.sh revoke <peer>
  ./scripts/peer.sh regen <peer>
  ./scripts/peer.sh show <peer>
EOF
}

if [ "$#" -lt 1 ]; then
  usage >&2
  exit 1
fi

command_name=$1
peer_name=${2:-}

if [ ! -f "$ENV_FILE" ]; then
  echo ".env not found at $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

normalize_csv() {
  printf '%s' "$1" | awk '
    BEGIN { FS=","; OFS="," }
    {
      out_count = 0
      for (i = 1; i <= NF; i++) {
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", $i)
        if ($i != "" && !seen[$i]++) {
          out[++out_count] = $i
        }
      }
      for (i = 1; i <= out_count; i++) {
        printf "%s%s", out[i], (i < out_count ? OFS : "")
      }
    }'
}

current_peers=$(normalize_csv "${WIREGUARD_PEERS:-}")

require_peer_arg() {
  if [ -z "$peer_name" ]; then
    echo "Peer name is required for '$command_name'" >&2
    exit 1
  fi
}

peer_exists_in_csv() {
  target=$1
  printf '%s\n' "$current_peers" | awk -F',' -v target="$target" '
    {
      for (i = 1; i <= NF; i++) {
        if ($i == target) {
          found = 1
        }
      }
    }
    END { exit(found ? 0 : 1) }'
}

write_peers_env() {
  updated_peers=$1
  tmp_file=$(mktemp "${ENV_FILE}.tmp.XXXXXX")
  awk -v peers="$updated_peers" '
    BEGIN { replaced = 0 }
    /^WIREGUARD_PEERS=/ {
      print "WIREGUARD_PEERS=" peers
      replaced = 1
      next
    }
    { print }
    END {
      if (!replaced) {
        print "WIREGUARD_PEERS=" peers
      }
    }' "$ENV_FILE" > "$tmp_file"
  mv "$tmp_file" "$ENV_FILE"
}

peer_dir() {
  printf '%s/peer_%s' "$WIREGUARD_DIR" "$1"
}

restart_wireguard() {
  (cd "$STACK_ROOT" && docker compose -f "$COMPOSE_FILE" up -d wireguard)
}

case "$command_name" in
  list)
    echo "Peers in .env: ${current_peers:-<none>}"
    if [ -d "$WIREGUARD_DIR" ]; then
      find "$WIREGUARD_DIR" -maxdepth 1 -type d -name 'peer_*' -print | sed "s#^$WIREGUARD_DIR/##" | sort
    else
      echo "No wireguard state directory yet: $WIREGUARD_DIR"
    fi
    ;;

  revoke)
    require_peer_arg
    if ! peer_exists_in_csv "$peer_name"; then
      echo "Peer '$peer_name' is not present in WIREGUARD_PEERS" >&2
      exit 1
    fi
    updated_peers=$(printf '%s' "$current_peers" | awk -F',' -v target="$peer_name" '
      BEGIN { OFS="," }
      {
        out_count = 0
        for (i = 1; i <= NF; i++) {
          if ($i != target && $i != "") {
            out[++out_count] = $i
          }
        }
        for (i = 1; i <= out_count; i++) {
          printf "%s%s", out[i], (i < out_count ? OFS : "")
        }
      }')
    if [ -z "$updated_peers" ]; then
      echo "Refusing to revoke the last remaining peer; edit .env intentionally if you really want zero peers." >&2
      exit 1
    fi
    write_peers_env "$updated_peers"
    rm -rf "$(peer_dir "$peer_name")"
    restart_wireguard
    echo "Revoked peer '$peer_name'. Updated WIREGUARD_PEERS=$updated_peers"
    ;;

  regen)
    require_peer_arg
    updated_peers=$current_peers
    if ! peer_exists_in_csv "$peer_name"; then
      if [ -n "$updated_peers" ]; then
        updated_peers="${updated_peers},${peer_name}"
      else
        updated_peers="$peer_name"
      fi
      updated_peers=$(normalize_csv "$updated_peers")
      write_peers_env "$updated_peers"
    fi
    rm -rf "$(peer_dir "$peer_name")"
    restart_wireguard
    echo "Regenerated peer '$peer_name'."
    echo "Config path: $(peer_dir "$peer_name")/peer_${peer_name}.conf"
    ;;

  show)
    require_peer_arg
    (cd "$STACK_ROOT" && docker compose -f "$COMPOSE_FILE" exec wireguard /app/show-peer "$peer_name")
    ;;

  *)
    usage >&2
    exit 1
    ;;
esac
