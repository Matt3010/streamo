#!/usr/bin/env sh

set -eu

ACTION=${1:-apply}
HOST_IP=${HOST_IP:-192.168.1.99}
APP_PORT=${APP_PORT:-5794}
SSH_PORT=${SSH_PORT:-22}
WG_CONTAINER_IP=${WG_CONTAINER_IP:-172.31.0.2}
CHAIN=${CHAIN:-WG_REMOTE_LIMIT}

usage() {
  cat <<EOF
Usage:
  sudo HOST_IP=$HOST_IP APP_PORT=$APP_PORT SSH_PORT=$SSH_PORT WG_CONTAINER_IP=$WG_CONTAINER_IP ./scripts/host-firewall.sh apply
  sudo ./scripts/host-firewall.sh remove

This script restricts traffic arriving from the WireGuard container IP on the
Docker bridge so that remote VPN users can reach only:
  - ${HOST_IP}:${SSH_PORT}/tcp
  - ${HOST_IP}:${APP_PORT}/tcp

All other traffic from ${WG_CONTAINER_IP} to ${HOST_IP} is dropped.
EOF
}

need_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "Run as root (sudo)." >&2
    exit 1
  fi
}

ensure_chain() {
  iptables -N "$CHAIN" 2>/dev/null || true
  iptables -F "$CHAIN"
  iptables -C INPUT -s "$WG_CONTAINER_IP" -d "$HOST_IP" -j "$CHAIN" 2>/dev/null || \
    iptables -I INPUT 1 -s "$WG_CONTAINER_IP" -d "$HOST_IP" -j "$CHAIN"
}

apply_rules() {
  need_root
  ensure_chain
  iptables -A "$CHAIN" -p tcp --dport "$SSH_PORT" -m conntrack --ctstate NEW,ESTABLISHED -j ACCEPT
  iptables -A "$CHAIN" -p tcp --dport "$APP_PORT" -m conntrack --ctstate NEW,ESTABLISHED -j ACCEPT
  iptables -A "$CHAIN" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  iptables -A "$CHAIN" -j DROP
  echo "Applied firewall chain $CHAIN for $WG_CONTAINER_IP -> $HOST_IP (ssh:$SSH_PORT app:$APP_PORT)"
}

remove_rules() {
  need_root
  iptables -D INPUT -s "$WG_CONTAINER_IP" -d "$HOST_IP" -j "$CHAIN" 2>/dev/null || true
  iptables -F "$CHAIN" 2>/dev/null || true
  iptables -X "$CHAIN" 2>/dev/null || true
  echo "Removed firewall chain $CHAIN"
}

case "$ACTION" in
  apply)
    apply_rules
    ;;
  remove)
    remove_rules
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac
