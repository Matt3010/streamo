# VixStream

Web app personale per sfogliare film e serie TV (catalogo TMDB) e riprodurli
in streaming. Frontend Angular, backend Express + SQLite, tutto incapsulato
in due container Docker dietro un reverse proxy nginx.

## Stack

- **Frontend**: Angular 21 standalone components + signals
- **Backend**: Node 20 + Express + better-sqlite3
- **Reverse proxy**: nginx (template processato con `envsubst`)
- **Catalogo**: [TMDB](https://www.themoviedb.org/) (richiede una API key)
- **Player**: iframe vixsrc.to proxato dal nginx

## Avvio

Crea `.env` nella root con la tua TMDB API key:

```
TMDB_API_KEY=la_tua_key
```

Poi:

```bash
docker compose up -d --build
```

L'app è disponibile su `http://localhost:8080`. Il backend (porta 3000)
non è esposto direttamente — nginx fa da reverse proxy per `/api/auth`,
`/api/user`, `/api/tmdb` e `/player`.

Lo stato (utenti, watchlist, progress, history, JWT secret, cache TMDB)
vive in `./data/vixstream.db` (volume montato sul container backend).

## Features principali

- Registrazione + login con cookie HTTP-only (JWT)
- Catalogo film/serie con sezioni (Tendenza, Al Cinema, Più Visti, In Arrivo,
  per le serie anche In Onda Ora / Più Votate / Oggi in TV)
- Pagina dettaglio "watch" con tagline, generi, durata, rating, cast (top 6)
- Player con resume automatico (riprende dall'ultimo episodio guardato per le serie)
- Progress tracking automatico via `postMessage` dell'iframe vixsrc
- **Watchlist** con due stati per ogni titolo:
  - `Da guardare` (default)
  - `Visto` (manuale, oppure auto-flip quando hai visto >= 80% di tutti gli episodi)
- Marcatura manuale del progresso ("ho visto fino a S2E5" / "L'ho visto tutto")
- Badge intelligente sui titoli ("Mancano N episodi", "Sei al passo")
- Auto-flip `Visto → Da guardare` quando esce una nuova stagione
- Cronologia degli episodi guardati
- Vista a griglia o lista per la watchlist e cronologia
- Toast di conferma sulle azioni utente
- Layout responsive

## Layout del progetto

```
.
├── docker-compose.yml          # 2 servizi: backend + vixstream (nginx)
├── Dockerfile                  # build Angular + nginx, multi-stage
├── nginx.conf.template         # reverse proxy + iframe streaming
├── frontend/                   # app Angular
│   └── src/app/
│       ├── components/         # card, top-bar, account-menu, ecc.
│       ├── ui/                 # libreria UI condivisa (tabs, modal)
│       ├── layouts/            # main-layout (con tabs), list-layout (senza)
│       ├── pages/              # home, watch, search-results, user-list-view
│       ├── services/           # auth, tmdb, watchlist, history, progress, player
│       └── models/             # type definitions
├── server/                     # backend Express
│   ├── server.js               # routes
│   └── db.js                   # schema SQLite + migrazioni
└── data/                       # volume DB (gitignored)
```

## Soglie progress

- **80%** di un episodio → conta come "visto" (`watched_count`, badge,
  auto-flip status)
- **95%** → sparisce da "Continua a guardare", niente più barra di progresso

Le due soglie sono separate apposta: a 85% sei "soddisfatto della visione"
ma puoi ancora riprendere lo stesso episodio per finire i minuti rimanenti.

## Cache TMDB

Il backend ha una cache 24h sui dettagli TV (numero stagioni/episodi per
stagione) in tabella `tmdb_cache`. Serve per:

- arricchire la watchlist con `total_episodes` / `total_seasons`
- validare la stagione/episodio nei mark manuali
- decidere se auto-flippare lo status quando esce nuovo contenuto

## Disclaimer

This project is a personal experiment. It does not host or distribute any
media. All streaming content is fetched from third-party providers; the
legality of accessing those streams depends on your local laws. Use at
your own risk.

## License

TBD (probabilmente MIT — vedi le note nel commit della licenza quando ci sarà).
