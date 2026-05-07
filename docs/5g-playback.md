# Riproduzione video su 5G — strategie tentate

Note sui tentativi di far funzionare la riproduzione video sui carrier
mobili italiani (TIM, Vodafone, Iliad, Wind3) che applicano blocchi DNS
AGCOM su `vixsrc.to`, `vixcloud.co`, `*.vix-content.net`.

## Problema

- Su Wi-Fi: tutto funziona — il browser risolve direttamente i domini
  upstream e li raggiunge.
- Su 5G italiano: la pagina si carica (l'app sta sul nostro dominio
  `cinema.scanferlamatteo.work`), ma JW Player va in errore `224003`
  (HLS chunk load failure) o resta in caricamento infinito.
  Causa: il bundle JS della pagina di embed contiene riferimenti
  hardcoded a `sc-u8-XX.vix-content.net`, `vixcloud.co`, `vixsrc.to`,
  e quei domini sono DNS-bloccati dai carrier.

## Baseline funzionante (commit `e42317b`)

`nginx.conf.template` essenziale:

- proxy `/embed/`, `/player/`, `/playlist/`, `/_next/`, `/api/`,
  `/api/vixsrc/`, `/jwplayer-`, `/build/`, `/favicon.ico` verso
  `vixsrc.to`
- fallback regex `\.(js|css|m3u8|ts|...)$` → `@vixsrc_proxy`
- `resolver 8.8.8.8 ipv6=off valid=30s;` (necessario, vedi sotto)
- `sub_filter` solo per iniettare `adblock.js` e `autoseek.js` su
  `/embed/` e `/player/`
- nessun rewriting di URL upstream

Stato: Wi-Fi funziona. 5G no.

## Cosa è stato provato (e perché non ha funzionato)

### 1. Strip degli header IP-leak (`CF-Connecting-IP`, ecc.)

**Idea**: vix vede l'IP del carrier via `CF-Connecting-IP` (passato dal
cloudflared tunnel) e blocca via geolocation.
**Risultato**: parziale — qualche endpoint smette di tornare 410, ma
non risolve il problema principale (i domini bloccati).
**Status nel repo attuale**: NON applicato (rimosso al rollback).
**Da considerare**: se vix dovesse iniziare a bloccare per IP, gli
header sono `CF-Connecting-IP`, `X-Forwarded-For`, `X-Real-IP`,
`True-Client-IP`, `CF-IPCountry`, `CF-Visitor`. Aggiungere
`proxy_set_header <name> "";` su ogni `proxy_pass` verso vix.

### 2. `sub_filter` statico sul JS bundle (`@vixsrc_proxy`)

**Idea**: riscrivere a build-time/proxy-time tutti i letterali
`https://vixsrc.to/`, `https://vixcloud.co/`, `://sc-u8-`,
`.vix-content.net/` dentro `vixsrc-XXX.js` e bundle `_next` per farli
puntare al nostro proxy.
**Risultato**: ROTTO. Il bundle minificato contiene quei letterali in
contesti non solo URL (parti di stringhe, regex, configurazioni).
Sostituirli corrompe il bundle e il player non parte (la pagina mostra
`Cannot read properties of null (reading 'open')` o simili).
**Lezione**: `sub_filter` su JS minificato è troppo grossolano. Anche
con pattern stretti (`'"vixsrc.to"'` con virgolette) si rompono cose.

### 3. `sub_filter` su `/embed/` e `/player/` con `sc-u8` / `vix-content.net`

**Idea**: stessa cosa ma sull'HTML del player invece che sul bundle.
**Risultato**: ROTTO. Il config inline (`window.M = {...}`) contiene
hostname che, dopo il rewrite, finiscono mangiati o storti.
Specificamente `.vix-content.net/` → `/` può cancellare parti di
oggetti config se non c'è uno schema URL davanti.
**Status attuale**: applicato solo `https://vixsrc.to/` →
`https://$host/` e `"vixsrc.to"` → `"$host"` (più equivalenti per
`vixcloud.co`). NIENTE rewrite di sc-u8/vix-content sull'HTML.

### 4. `sub_filter` su `/playlist/` per `sc-u8` / `vix-content.net`

**Idea**: i master m3u8 contengono URL assoluti tipo
`https://sc-u8-01.vix-content.net/.../0000.ts`. Riscriverli a
`https://$host/cdn/sc-u8-01/.../0000.ts` con catena:
```
sub_filter '://sc-u8-' '://$host/cdn/sc-u8-';
sub_filter '.vix-content.net/' '/';
```
+ creare una location proxy `/cdn/<sub>/<path>` →
`https://<sub>.vix-content.net/<path>`.
**Risultato**: i `.ts` arrivano 200 OK (1.7 MB, content-type
`video/mp2t`). Ma il video resta in caricamento infinito comunque.
**Ipotesi**: `sub_filter` disabilita `Accept-Ranges`, e
AVPlayer/Safari richiede risposte 206 Partial Content per HLS. Senza
range support, il player non considera la sorgente valida.
**Status attuale**: NON applicato.
**Se si riprova**: combinare con `proxy_buffering off` o usare un
filter più mirato (es. via Lua/njs) che non rompa i range.

### 5. `Accept-Encoding ""` sui proxy_pass per disabilitare gzip upstream

**Idea**: `sub_filter` non funziona su risposte gzip. Forzare
`Accept-Encoding: ""` verso upstream per ricevere risposte plain.
**Risultato**: prerequisito per `sub_filter`, ma di per sé non rompe
nulla. Lasciato dove serve (`/embed/`, `/player/`, `/playlist/`,
ecc.).

### 6. Script runtime `url-rewrite.js` con monkey-patch

**Idea**: invece di rewriting statico (lento e fragile), iniettare uno
script come **primo** elemento di `<head>` su `/embed/` e `/player/`,
che monkey-patcha `fetch`, `XMLHttpRequest.open`, `setAttribute`,
`HTMLMediaElement.prototype.src`, ecc. per riscrivere a runtime
qualsiasi URL verso domini bloccati.
**Risultato**: ROTTO. Anche la versione minimale (solo
fetch/XHR/setAttribute) faceva inizializzare JW Player ma il video
non partiva (00:00 / 00:00 con spinner) anche su Wi-Fi.
**Probabili cause**:
- Override di `HTMLMediaElement.prototype.src` setter rompe la
  detection di feature di JW Player / Safari nativo HLS
- Il bundle fa `Object.getOwnPropertyDescriptor` per feature detection
  e l'override viene rifiutato come "shadowed"
- AVPlayer di Safari ignora i monkey-patch JS perché fetcha le
  risorse via networking nativo, NON via JS
**Status attuale**: file `scripts/url-rewrite.js` resta nel repo (per
riferimento), ma NON è iniettato.

### 7. `resolver 8.8.8.8 ipv6=off`

**Idea**: nginx risolveva `vix-content.net` via Google DNS, otteneva
record AAAA (IPv6), tentava la connessione su IPv6 e falliva
(`connect() to [...]:443 failed (101: Network unreachable)`) perché
il Pi non ha IPv6 outbound. Poi cadeva su IPv4 con latenza extra.
**Risultato**: FIX VALIDO E APPLICATO. Le HEAD speculative del
browser non vanno più in timeout.
**Status attuale**: applicato in `nginx.conf.template:12`.

## Errori ricorrenti incontrati

| Sintomo | Causa probabile |
|---|---|
| `224003` JW Player error | Chunk HLS non scaricabile (dominio bloccato dal carrier o token scaduto) |
| `Cannot read properties of null (reading 'open')` at `Zn` line 53 | Bundle JS corrotto da sub_filter sul JS minificato |
| `connect() to [IPv6]:443 failed (101: Network unreachable)` | Mancava `ipv6=off` sul resolver |
| `ping.gif` 404 da `/vixcloud/` | Endpoint analytics di JW, non bloccante — può essere ignorato |
| `ERR_BLOCKED_BY_CLIENT` su Cloudflare Insights / analytics | Ad blocker del browser, non bloccante |
| `SecurityError: Blocked a frame ... cross-origin` | Iframe vix tenta `document.domain`, atteso e ignorabile |
| `embed/movie/695389` 404 | URL sbagliata: l'embed reale è `/embed/695389` (senza `/movie/`) |
| `playlist/695389` 403 senza token | Atteso — il token signed è obbligatorio |

## Note operative

- Pi remoto: `192.168.1.99`, accesso via cloudflared SSH
  (`ssh.scanferlamatteo.work`).
- Repo: `~/streamingimmunity`.
- Deploy: `git pull && docker compose up -d --build vixstream`.
- Dominio pubblico: `cinema.scanferlamatteo.work` (cloudflared tunnel).
- I `.ts` da 1.5–2 MB possono caricare in <1s in Wi-Fi ma fallire su
  5G non per banda, ma per blocco DNS sui domini upstream.

## Direzioni che non ho provato

1. **Cloudflare Worker davanti al dominio** che faccia rewriting
   selettivo (solo HTML/m3u8) senza rompere `Accept-Ranges`. Il
   Worker può streammare la response e modificare solo i pezzi text.
2. **Service Worker** registrato sull'app principale che intercetti
   le fetch del player iframe (richiede COOP/COEP e l'iframe
   same-origin). Più solido del monkey-patch perché lavora sotto al
   bundle.
3. **Build Vite/esbuild custom del bundle** scaricando il sorgente di
   vixsrc, patchando i letterali con regex precise e servendolo dal
   nostro origin. Lavoro grosso ma controllabile.
4. **Riscrivere solo il master m3u8** lato server con uno script
   Node/Python (non `sub_filter`), preservando `Accept-Ranges` e
   `Content-Length`. Filtra solo `application/vnd.apple.mpegurl`.
5. **DoH (DNS-over-HTTPS) lato client** — non aiuta perché molti
   carrier fanno SNI inspection oltre al DNS.
6. **Tunnel WireGuard/Tailscale dedicato sul telefono** — bypassa
   completamente il blocco AGCOM, ma richiede config sul device.
   Soluzione "vera" ma lato utente, non lato app.
