# Streamo

Personal web app to browse movies and TV shows (TMDB catalog) and stream
them. Angular frontend, Express backend, both packaged as Docker
containers behind an nginx reverse proxy.

## Stack

- **Frontend**: Angular 21 standalone components + signals
- **Backend**: Node 22 + Express + TypeScript
- **Database**: Postgres 16
- **Queue**: Redis + BullMQ worker
- **Reverse proxy**: nginx (template processed with `envsubst`)
- **Catalog**: [TMDB](https://www.themoviedb.org/) (requires an API key)
- **Player**: vixcloud.co iframe proxied through nginx
- **App ingress**: LAN host bind
- **Remote access**: separate stack under `infra/wireguard`

## Getting started

Create a `.env` file at the project root with your TMDB API key:

``` 
TMDB_API_KEY=your_key_here
WORKER_REPLICAS=1
APP_HOST_BIND=192.168.1.99
APP_PORT=5794
```

Then:

```bash
chmod +x ./scripts/up.sh
./scripts/up.sh --build
```

With `--build`, the script runs `git pull --rebase --autostash` before rebuilding the
backend and frontend images.

The worker replica count is read from `WORKER_REPLICAS`. You can also override
it explicitly:

```bash
./scripts/up.sh --workers 3 --build
```

The script reads `.env` from the project root before starting, so
`WORKER_REPLICAS` and the other variables can stay there.

The backend (port 3000) is not exposed directly — nginx reverse-proxies
`/api/auth`, `/api/user`, `/api/tmdb`, and `/player`.

Ingress paths:

- On your home LAN, open `http://192.168.1.99:5794` or whatever you set in
  `APP_HOST_BIND` and `APP_PORT`.
- From the Internet, use the separate WireGuard stack under
  [`infra/wireguard`](./infra/wireguard/README.md), then open
  `http://192.168.1.99:5794` over the VPN.

If you are logged in as the super admin, the BullMQ dashboard is available at
`/api/admin/queues`.

State lives under `./data/`, including Postgres data, Redis-backed queues,
WARP state, logs, and application metadata.

## Features

- Email/password registration and login with HTTP-only JWT cookies
- Movie/TV catalog with rows (Trending, Now Playing, Popular, Upcoming —
  plus On The Air / Top Rated / Airing Today for TV)
- Detail page with tagline, genres, runtime, rating, top-6 cast
- Smart resume — clicking a TV card jumps to the most recently watched
  episode/position instead of always starting at S1E1
- Automatic progress tracking via the iframe's `postMessage` events
- **Watchlist** with two states per title:
  - `To watch` (default)
  - `Watched` (manual, or auto-flipped once you've seen >= 80% of every
    episode)
- Manual progress marking ("watched up to S2E5" / "watched everything")
- Smart badges per title ("3 episodes left", "All caught up")
- Auto-flip `Watched → To watch` when a new season is released
- History of watched episodes
- Grid or list view for the watchlist and history
- Toast confirmations on user actions
- Responsive layout

## Project layout

```
.
├── docker-compose.yml          # postgres, redis, warp, backend, worker, streamo
├── Dockerfile                  # multi-stage Angular + nginx build
├── infra/
│   └── wireguard/              # separate remote-access stack with its own .env
├── nginx.conf.template         # reverse proxy + streaming iframe
├── frontend/                   # Angular app
│   └── src/app/
│       ├── components/         # card, top-bar, account-menu, etc.
│       ├── ui/                 # shared UI library (tabs, modal)
│       ├── layouts/            # main-layout (with tabs), list-layout (without)
│       ├── pages/              # home, watch, search-results, user-list-view
│       ├── services/           # auth, tmdb, watchlist, history, progress, player
│       └── models/             # type definitions
├── server/                     # Express backend
│   └── src/                    # routes, services, DB access, worker
└── data/                       # DB volume (gitignored)
```

## Progress thresholds

- **80%** of an episode/movie → counts as "watched" (`watched_count`,
  badges, auto-flip status)
- **95%** → drops out of "Continue watching", progress bar hidden

The two thresholds are deliberately separated: at 85% you are "happy with
the viewing" but can still resume the same episode to finish the last few
minutes.

## TMDB cache

The backend caches TV details (season/episode counts) for 24 hours in the
`tmdb_cache` table. It powers:

- watchlist enrichment (`total_episodes` / `total_seasons`)
- validation of season/episode in manual marks
- the auto-flip decision when new seasons are released

## Network architecture

Ingress is split in two:

- Home LAN clients reach the app directly on the host bind, usually
  `http://192.168.1.99:5794`
- Internet clients use the separate WireGuard access stack and then reach
  `http://192.168.1.99:5794` over the VPN

Outbound traffic from the backend / worker / streamo containers exits via a
Cloudflare WARP tunnel running in a dedicated container. postgres/redis stay
on a private Docker bridge with static IPs (`172.30.0.0/24`) and never leave
the host.

- LAN peers can use the host bind directly without VPN
- VPN peers get routed to your home LAN by the separate access stack
- Streamo stays reachable on `http://192.168.1.99:5794` inside the VPN

```
═══════════════════════════════════════════════════════════════════
INGRESS — LAN direct, Internet via VPN
═══════════════════════════════════════════════════════════════════

  Home LAN device
       │
       │ HTTP http://192.168.1.99:5794
       ▼
  ┌──────────────────────────────────────────┐
  │  Docker host                             │
  │  host bind 192.168.1.99:5794 → warp:80   │
  └──────────────────────────────────────────┘

  Remote device on Internet
       │
       │ WireGuard tunnel (UDP 51820)
       ▼
  ┌──────────────────────────────────────────┐
  │  Home router (ISP NAT)                   │
  │  Port forward 51820/udp → server LAN IP  │
  └──────────────────────────────────────────┘
       │
       ▼
  ┌──────────────────────────────────────────┐
  │  Docker host + separate access stack     │
  │                                          │
  │  infra/wireguard                         │
  │       │ routes VPN peers to 192.168.1.0/24
  │       ▼                                  │
  │  host bind 192.168.1.99:5794 → warp:80   │
  │       │ shared namespace                 │
  │       ▼                                  │
  │  streamo (nginx)                         │
  │       │ proxy_pass → 127.0.0.1:3000      │
  │       ▼                                  │
  │  backend (node, :3000)                   │
  │                                          │
  │  postgres 172.30.0.11                    │
  │  redis    172.30.0.10                    │
  └──────────────────────────────────────────┘


═══════════════════════════════════════════════════════════════════
EGRESS — backend → upstream (via WARP)
═══════════════════════════════════════════════════════════════════

  backend  (inside warp namespace)
  fetch("https://upstream.example/...")
       │
       │ DNS query → 127.0.2.2 (warp DoH resolver)
       │ TLS handshake → SNI upstream.example
       ▼
  ┌──────────────────────────────────────────┐
  │  WARP tun (WireGuard, in container)      │
  │  Encapsulates packets, device key        │
  └──────────────────────────────────────────┘
       │
       ▼ leaves via the host's physical NIC
  ┌──────────────────────────────────────────┐
  │  ISP router                              │
  │  sees only: <home IP> → CF WARP endpoint │
  │  does NOT see: upstream.example, payload │
  └──────────────────────────────────────────┘
       │
       ▼ internet
  ┌──────────────────────────────────────────┐
  │  Cloudflare WARP edge                    │
  │  • Decrypts WireGuard envelope           │
  │  • Sees SNI, dest IP, timing             │
  │  • Does NOT see TLS payload (E2E)        │
  │  • Egresses to upstream from CF IP pool  │
  └──────────────────────────────────────────┘
       │
       ▼ src IP = <CF egress IP>
  ┌──────────────────────────────────────────┐
  │  upstream.example                        │
  │  sees:     src IP CF, Host: their own    │
  │  does NOT see: home IP, your domain      │
  └──────────────────────────────────────────┘


═══════════════════════════════════════════════════════════════════
FLOWS THAT DO NOT GO THROUGH WARP
═══════════════════════════════════════════════════════════════════

  Host bare-metal services (SSH, other Docker apps)
       │
       ▼  exit directly via the ISP, with the home IP
  Internet

  Internal containers (backend ↔ postgres ↔ redis)
       │
       ▼  docker bridge `internal` 172.30.0.0/24
  never leave the host
```

What each actor sees, end-to-end:

|                | Inbound          | Outbound → upstream |
|----------------|------------------|---------------------|
| User browser   | URLs + responses | —                   |
| Cloudflare     | everything (plaintext at edge) | metadata only (SNI, dest IP, timing) |
| ISP            | encrypted blob (CF→home) | encrypted blob (home→CF) |
| Upstream       | —                | source IP from CF pool, no referer/host |

## Disclaimer

This project is a personal experiment. It does not host or distribute any
media. All streaming content is fetched from third-party providers; the
legality of accessing those streams depends on your local laws. Use at
your own risk.
