# WireGuard Access Stack

This stack is intentionally separate from the Streamo app compose. It gives
remote VPN access to the host or LAN. What a remote user can reach on the host
is controlled by env, not by app-specific code.

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
ALLOWED_TCP_PORTS=22,5794
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

`./scripts/peer.sh revoke <peer>` also removes orphan peer folders that still
exist on disk even if the peer is no longer present in `WIREGUARD_PEERS`.

By default, `up.sh` automatically applies host firewall
rules that allow only `HOST_IP` on the TCP ports listed in
`ALLOWED_TCP_PORTS`, then starts the VPN stack.

`ALLOWED_TCP_PORTS` has no default on purpose: set it explicitly in `.env`.

If you prefer to manage the host firewall separately, set
`APPLY_HOST_FIREWALL=0` and run the helper manually:

```bash
cd infra/wireguard
sudo HOST_IP=192.168.1.99 ALLOWED_TCP_PORTS=22,5794 ./scripts/host-firewall.sh apply
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
