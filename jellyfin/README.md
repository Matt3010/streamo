# Jellyfin integration

Contenuti StreamingCommunity dentro Jellyfin, via un addon Stremio (in questa
cartella) + il plugin **Gelato**. L'addon scrapa il catalogo SC, risolve gli
stream vixcloud e proxa l'HLS. Gira tutto in Docker, niente dipendenze da `ios/`.

## Architettura

```
Client (Streamyfin / Swiftfin / web / TV)
        │  ricerca + Play
        ▼
Jellyfin (Docker, :18096) + plugin Gelato
        │  protocollo addon Stremio (manifest/catalog/meta/stream)
        ▼
addon (Docker, :17871 → :7000 interno)
        ├─ catalog.ts   scraping StreamingCommunity (search, titoli, stagioni)
        ├─ tmdb.ts      traduce id imdb/tmdb → titolo da cercare su SC
        ├─ resolve.ts   verifica match via tmdb_id/imdb_id esatto
        ├─ playback.ts  resolver vixcloud + proxy HLS (playlist riscritte)
        ├─ download.ts  pagina browser: download offline (mux ffmpeg.wasm)
        └─ auth.ts      chiave per le rotte proxy HLS
```

### Due tipi di id

- **`sc:…`** — catalogo proprio (uso diretto in Stremio). Es: `sc:1994-matrix`,
  serie `sc:3-breaking-bad-reazioni-collaterali:1:2` (stagione 1, ep 2).
- **`tt…` / `tmdb:…`** — id esterni che Gelato usa per chiedere gli stream.
  L'addon li traduce: TMDB dà nome+anno → cerca su SC → **conferma col
  `tmdb_id`/`imdb_id` che SC stesso espone** (match esatto, niente sequel
  sbagliati). Serve la chiave TMDB (default: quella dell'app iOS).

## Avvio

```bash
cd jellyfin
cp .env.example .env      # nessun IP da mettere, vedi sotto
docker compose up -d --build
```

- Jellyfin: `http://<ip>:18096` — completa il wizard iniziale (crea utente admin).
- Addon health: `http://<ip>:17871/health` — `ok: true` se SC è raggiungibile.

**Niente IP da hardcodare.** Jellyfin transcodifica sempre questi contenuti,
quindi i player parlano solo con Jellyfin (all'indirizzo che usano per
connettersi) e mai con l'addon. L'addon resta interno (`addon:7000`). Funziona
su WiFi, hotspot, qualsiasi rete senza modifiche.

## Installare e configurare Gelato

Gelato è il ponte: ricerca in Jellyfin → interroga l'addon → inietta i risultati.

### 1. Aggiungi il repository

Dashboard → Plugin → **Gestisci Archivi** (Repositories) → **Nuovo Repository**:

```
https://raw.githubusercontent.com/lostb1t/Gelato/refs/heads/gh-pages/repository.json
```

### 2. Installa il plugin

- Torna a **Plugin** → tab **Catalogo** → cerca **Gelato** → Installa → riavvia.
- **Se Gelato non appare nel catalogo**: è cache. Ricarica con Cmd+Shift+R, o
  riavvia il container (`docker compose restart jellyfin`) e riapri.

Verifica: tab **Installato** → deve esserci **Gelato … Active**.

### 3. Configura Gelato

Plugin → Gelato → impostazioni:

- **URL** (campo "AIOStreams URL"): `http://addon:7000`
  (nome servizio + porta interna 7000, NON quella host. Gelato gira dentro la
  rete compose. Niente AIOStreams: l'addon è un addon Stremio diretto.)
- **Movie path**: `/config/data/gelato/movies`
- **Series path**: `/config/data/gelato/series`

Salva.

### 4. Crea le librerie sui path di Gelato (passo obbligatorio)

La ricerca via Gelato funziona SOLO se esistono librerie Jellyfin che puntano
ai suoi path. Dashboard → Librerie → Aggiungi:

- Libreria **Film** (tipo Film) → cartella `/config/data/gelato/movies`
- Libreria **Serie TV** (tipo Programmi TV) → cartella `/config/data/gelato/series`

Poi **scansiona le librerie** (Library → Scan). Senza scan Gelato logga
`No movie folder found … skipping search`.

### 5. Cerca

Lente → "matrix" → risultati dal catalogo SC. Apri → Play.

## Download offline

| Via | Dove | Stato |
|---|---|---|
| **Streamyfin** (client iOS/Android terzo) | in-app, nativo | scarica riprendendo il playback HLS e muxa sul device — funziona perché lo streaming funziona |
| **Pagina browser** `/download/<type>/<id>` | Mac/desktop | mux con ffmpeg.wasm nel browser → salva mp4. Es: `http://<ip>:17871/download/movie/sc:1994-matrix` |
| App ufficiali Jellyfin (Swiftfin / Jellyfin Mobile) | — | il download nativo non funziona: gli item Gelato non sono file, il server non espone un mp4 scaricabile |

Per offline su iPhone senza l'app Streamo: **Streamyfin**.

## Test rapido senza Jellyfin

```bash
# ricerca
curl 'http://localhost:17871/catalog/movie/streamo-search/search=matrix.json'
# meta serie (stagioni + episodi)
curl 'http://localhost:17871/meta/series/sc:3-breaking-bad-reazioni-collaterali.json'
# stream via id esterno (come fa Gelato) → URL playlist proxato
curl 'http://localhost:17871/stream/movie/tt0133093.json'
```

## Note

- Base URL del catalogo scoperto a runtime dal link-aggregator telegra.ph
  (cache 10 min), come l'app iOS — i domini SC cambiano spesso.
- Rotte proxy HLS protette da chiave (`addon-data/auth-token.txt`, generata al
  primo avvio). Gli endpoint Stremio (manifest/catalog/meta/stream) restano
  aperti: Gelato non gestisce auth.
- Il Mac (o l'host Docker) deve restare acceso: è il server.
- Tutto transcodifica su Jellyfin (CPU host) — è il prezzo per non hardcodare IP.
