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
```

Use `WIREGUARD_ALLOWED_IPS=192.168.1.99/32` if you only want the server
itself reachable over VPN, or `192.168.1.0/24` for the whole LAN.

## Commands

```bash
cd infra/wireguard
chmod +x scripts/up.sh scripts/prepare-state.sh scripts/peer.sh
./scripts/up.sh
./scripts/peer.sh list
./scripts/peer.sh show phone
```

## Notes

- Forward only `${WIREGUARD_PORT}/udp` on the router.
- Do not forward the app port if remote app access should remain VPN-only.
- Keep one peer per physical device for clean revocation.
