#!/usr/bin/env sh

set -eu

ACTION=${1:-apply}
HOST_IP=${HOST_IP:-192.168.1.99}
ALLOWED_TCP_PORTS=${ALLOWED_TCP_PORTS:-}
WG_CONTAINER_IP=${WG_CONTAINER_IP:-172.31.0.2}
CHAIN=${CHAIN:-WG_REMOTE_LIMIT}

usage() {
  cat <<EOF
Usage:
  sudo HOST_IP=$HOST_IP ALLOWED_TCP_PORTS=$ALLOWED_TCP_PORTS WG_CONTAINER_IP=$WG_CONTAINER_IP ./scripts/host-firewall.sh apply
  sudo ./scripts/host-firewall.sh remove

This script restricts traffic arriving from the WireGuard container IP on the
Docker bridge so that remote VPN users can reach only:
  - ${HOST_IP}:{${ALLOWED_TCP_PORTS}}/tcp

All other traffic from ${WG_CONTAINER_IP} to ${HOST_IP} is dropped.
EOF
}

need_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "Run as root (sudo)." >&2
    exit 1
  fi
}

need_ports() {
  if [ -z "$ALLOWED_TCP_PORTS" ]; then
    echo "ALLOWED_TCP_PORTS must be set, for example ALLOWED_TCP_PORTS=22,5794" >&2
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
  need_ports
  ensure_chain
  OLD_IFS=$IFS
  IFS=','
  for port in $ALLOWED_TCP_PORTS; do
    port=$(printf '%s' "$port" | tr -d '[:space:]')
    if [ -n "$port" ]; then
      iptables -A "$CHAIN" -p tcp --dport "$port" -m conntrack --ctstate NEW,ESTABLISHED -j ACCEPT
    fi
  done
  IFS=$OLD_IFS
  iptables -A "$CHAIN" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  iptables -A "$CHAIN" -j DROP
  echo "Applied firewall chain $CHAIN for $WG_CONTAINER_IP -> $HOST_IP (allowed tcp: $ALLOWED_TCP_PORTS)"
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
