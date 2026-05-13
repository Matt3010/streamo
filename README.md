# Streamo

Personal web app to browse movies and TV shows (TMDB catalog) and stream
them. Angular frontend, Express + SQLite backend, both packaged as Docker
containers behind an nginx reverse proxy.

## Stack

- **Frontend**: Angular 21 standalone components + signals
- **Backend**: Node 20 + Express + better-sqlite3
- **Reverse proxy**: nginx (template processed with `envsubst`)
- **Catalog**: [TMDB](https://www.themoviedb.org/) (requires an API key)
- **Player**: vixsrc.to iframe proxied through nginx

## Getting started

Create a `.env` file at the project root with your TMDB API key:

```
TMDB_API_KEY=your_key_here
WORKER_REPLICAS=1
```

Then:

```bash
chmod +x ./scripts/up.sh
./scripts/up.sh --build
```

With `--build`, the script runs `git pull --rebase` before rebuilding the
backend and frontend images.

The worker replica count is read from `WORKER_REPLICAS`. You can also override
it explicitly:

```bash
./scripts/up.sh --workers 3 --build
```

The app is available at `http://localhost:7549`. The backend (port 3000)
is not exposed directly — nginx reverse-proxies `/api/auth`, `/api/user`,
`/api/tmdb`, and `/player`.

If you are logged in as the super admin, the BullMQ dashboard is available at
`/api/admin/queues`.

State (users, watchlist, progress, history, JWT secret, TMDB cache) lives
in `./data/vixstream.db` (volume mounted on the backend container; legacy filename kept to preserve existing data).

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
├── docker-compose.yml          # 2 services: backend + streamo (nginx)
├── Dockerfile                  # multi-stage Angular + nginx build
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
│   ├── server.js               # routes
│   └── db.js                   # SQLite schema + migrations
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

## Disclaimer

This project is a personal experiment. It does not host or distribute any
media. All streaming content is fetched from third-party providers; the
legality of accessing those streams depends on your local laws. Use at
your own risk.
