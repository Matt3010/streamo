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
chmod +x scripts/up.sh scripts/peer.sh scripts/prepare-state.sh scripts/host-firewall.sh
sudo ./scripts/up.sh
./scripts/peer.sh list
./scripts/peer.sh show phone
```

### Main commands

`sudo ./scripts/up.sh`

- Reads `infra/wireguard/.env`
- Tightens permissions on `infra/wireguard/data`
- Applies host firewall rules if enabled
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

These are support helpers. You normally do not need them in daily use because
`up.sh` already prepares state and applies the firewall when enabled.

`sudo ./scripts/host-firewall.sh apply`

- Installs the host-side `iptables` chain for traffic coming from the WireGuard container
- Allows only `HOST_IP` on the TCP ports listed in `ALLOWED_TCP_PORTS`
- Drops every other port from remote VPN users to that host

`sudo ./scripts/host-firewall.sh remove`

- Removes the dedicated `iptables` chain and detaches it from `INPUT`
- Use it if you want to disable the host-side restriction logic

`sudo ./scripts/host-firewall.sh help`

- Prints usage examples and the env variables used by the firewall helper

`./scripts/prepare-state.sh`

- Creates `infra/wireguard/data` if missing
- Sets restrictive permissions on the generated state directory
- Normally called automatically by `up.sh`; run it manually only if you need to fix permissions

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
