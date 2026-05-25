# WireGuard Access Stack

This stack is intentionally separate from the Streamo app compose. It gives
remote VPN access to the host or LAN; once connected, you reach Streamo on its
normal LAN bind such as `http://192.168.1.99:5794`.

## Files

- `docker-compose.yml`: WireGuard stack
- `scripts/up.sh`: validates env, tightens local state permissions, starts VPN
- `scripts/peer.sh`: list, revoke, regenerate, show peer configs
- `data/`: generated WireGuard state and peer configs

## Env

Create `infra/wireguard/.env`:

```env
WIREGUARD_HOST=vpn.northstarp.win
WIREGUARD_PORT=51820
WIREGUARD_PEERS=phone,laptop
WIREGUARD_ALLOWED_IPS=192.168.1.0/24
TZ=Europe/Rome
WIREGUARD_DNS=1.1.1.1
WIREGUARD_SUBNET=10.13.13.0
WIREGUARD_PUID=1000
WIREGUARD_PGID=1000
APPLY_HOST_FIREWALL=1
HOST_IP=192.168.1.99
APP_PORT=5794
SSH_PORT=22
WG_CONTAINER_IP=172.31.0.2
```

Use `WIREGUARD_ALLOWED_IPS=192.168.1.99/32` if you only want the server
itself reachable over VPN, or `192.168.1.0/24` for the whole LAN.

## Commands

```bash
cd infra/wireguard
chmod +x scripts/up.sh scripts/prepare-state.sh scripts/peer.sh scripts/host-firewall.sh
sudo ./scripts/up.sh
./scripts/peer.sh list
./scripts/peer.sh show phone
```

By default, `up.sh` automatically applies host firewall
rules that allow only `HOST_IP:SSH_PORT` and `HOST_IP:APP_PORT` from remote
VPN users, then starts the VPN stack.

If you prefer to manage the host firewall separately, set
`APPLY_HOST_FIREWALL=0` and run the helper manually:

```bash
cd infra/wireguard
sudo HOST_IP=192.168.1.99 APP_PORT=5794 SSH_PORT=22 ./scripts/host-firewall.sh apply
```

This helper assumes the WireGuard container keeps its fixed Docker IP
`172.31.0.2` and drops every other port from remote VPN users to `HOST_IP`.
Use `./scripts/host-firewall.sh remove` to uninstall the chain.

## Notes

- Forward only `${WIREGUARD_PORT}/udp` on the router.
- Do not forward the app port if remote app access should remain VPN-only.
- Keep one peer per physical device for clean revocation.
- Persist the resulting iptables rules with your distro's preferred mechanism
  (`iptables-persistent`, `netfilter-persistent`, firewalld, etc.).
