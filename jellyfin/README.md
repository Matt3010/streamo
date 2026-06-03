# Jellyfin integration (standalone)

Contenuti StreamingCommunity dentro Jellyfin via addon Stremio + plugin Gelato.
**Completamente autonomo**: nessuna dipendenza da `ios/` o dal suo proxy,
niente TMDB. L'addon scrapa il catalogo, risolve gli stream vixcloud e proxa
l'HLS da solo.

## Architettura

```
Client Jellyfin (TV / web / telefono)
        │  ricerca + Play
        ▼
Jellyfin (Docker, :18096) + plugin Gelato
        │  protocollo addon Stremio
        ▼
addon (Docker, :17871) ── tutto in questa cartella
        ├─ catalog.ts   scraping StreamingCommunity (search, titoli, stagioni)
        ├─ playback.ts  resolver vixcloud + proxy HLS (playlist riscritte)
        └─ auth.ts      chiave per le rotte proxy (i player non mandano header)
```

Namespace id proprio, niente TMDB:

| Cosa | Id |
|---|---|
| Film | `sc:1994-matrix` |
| Serie (meta) | `sc:3-breaking-bad-reazioni-collaterali` |
| Episodio (stream) | `sc:3-breaking-bad-reazioni-collaterali:1:2` |

Flusso: ricerca in Jellyfin → Gelato → `/catalog/...search=...` → risultati con
poster/trama SC. Play → `/stream/...` → l'addon risolve l'embed vixcloud
on-demand (gli URL scadono, zero cache stream) e risponde con l'URL del
playlist HLS proxato; segmenti e chiavi passano tutti dall'addon.

## Avvio

```bash
cd jellyfin
cp .env.example .env   # imposta ADDON_PUBLIC_URL con l'IP LAN della macchina
docker compose up -d --build
```

- Jellyfin: `http://<ip>:18096` — completa il wizard iniziale.
- Addon: `http://<ip>:17871/manifest.json` — deve rispondere JSON.
- Health: `http://<ip>:17871/health` — `ok: true` se il catalogo è raggiungibile.

## Configurare Gelato in Jellyfin

1. Dashboard → Plugins → Repositories → aggiungi il repo di Gelato
   (URL manifest aggiornato su https://github.com/lostb1t/Gelato).
2. Catalog → installa **Gelato** → riavvia Jellyfin.
3. Impostazioni Gelato → aggiungi addon URL: `http://addon:7000/manifest.json`
   (Gelato gira DENTRO la rete compose: usa il nome servizio e la porta
   interna 7000, non quella mappata sull'host).

## Test rapido senza Jellyfin

```bash
# ricerca
curl 'http://localhost:17871/catalog/movie/streamo-search/search=matrix.json'
# meta serie (stagioni + episodi)
curl 'http://localhost:17871/meta/series/sc:3-breaking-bad-reazioni-collaterali.json'
# stream episodio → URL playlist proxato
curl 'http://localhost:17871/stream/series/sc:3-breaking-bad-reazioni-collaterali:1:1.json'
```

## Note

- `ADDON_PUBLIC_URL` = IP LAN, NON `localhost`: l'URL finisce nei client che
  scaricano i segmenti dall'addon.
- Base URL del catalogo scoperto a runtime dal link-aggregator telegra.ph
  (cache 10 min), come fa l'app iOS — i domini SC cambiano spesso.
- Le rotte proxy HLS sono protette da chiave (`addon-data/auth-token.txt`,
  generata al primo avvio) per non essere un relay aperto; gli endpoint
  Stremio restano aperti perché Gelato non gestisce auth.
