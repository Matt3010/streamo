# WireGuard Access Stack

This stack is intentionally separate from the Streamo app compose. It gives
remote VPN access to the host or LAN. Once a peer is connected, it can reach
any service on the host or `WIREGUARD_ALLOWED_IPS` subnet — no per-port
restriction is enforced.

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
WIREGUARD_SUBNET=10.13.13.0
WIREGUARD_OWNER=matteoscanferla
WIREGUARD_GROUP=matteoscanferla
WIREGUARD_PUID=1000
WIREGUARD_PGID=1000
```

Use `WIREGUARD_ALLOWED_IPS=192.168.1.99/32` if you only want the server
itself reachable over VPN, or `192.168.1.0/24` for the whole LAN.

`prepare-state.sh` prefers `WIREGUARD_OWNER:WIREGUARD_GROUP` and tightens the
state directory to that Linux account. `WIREGUARD_PUID/WIREGUARD_PGID` remain
as a fallback for hosts where that username does not exist.

## Commands

```bash
cd infra/wireguard
chmod +x scripts/up.sh scripts/peer.sh scripts/prepare-state.sh
sudo ./scripts/up.sh
./scripts/peer.sh list
./scripts/peer.sh show phone
```

### Main commands

`sudo ./scripts/up.sh`

- Reads `infra/wireguard/.env`
- Tightens permissions on `infra/wireguard/data`
- Starts or updates the WireGuard container

`./scripts/peer.sh list`

- Prints peers currently declared in `WIREGUARD_PEERS`
- Lists `peer_*` folders currently present on disk
- Useful to spot drift between `.env` and generated state

`./scripts/peer.sh show <peer>`

- Asks the running container to print the config or QR output again for a peer
- Use it when you need to re-import a profile on a device

`./scripts/peer.sh regen <peer>`

- Ensures the peer exists in `WIREGUARD_PEERS`
- Deletes only that peer's generated folder
- Restarts WireGuard so the peer config is regenerated

`./scripts/peer.sh revoke <peer>`

- Removes the peer from `WIREGUARD_PEERS` if it is still declared there
- Deletes the local `data/peer_<peer>` folder
- Also works for orphan peers that still exist on disk but are no longer in `.env`
- Restarts WireGuard after cleanup

### Maintenance commands

`./scripts/prepare-state.sh`

- Creates `infra/wireguard/data` if missing
- Sets restrictive permissions on the generated state directory
- Normally called automatically by `up.sh`; run it manually only if you need to fix permissions

`./scripts/peer.sh revoke <peer>` also removes orphan peer folders that still
exist on disk even if the peer is no longer present in `WIREGUARD_PEERS`.

## Notes

- Forward only `${WIREGUARD_PORT}/udp` on the router.
- Do not forward the app port if remote app access should remain VPN-only.
- Keep one peer per physical device for clean revocation.
