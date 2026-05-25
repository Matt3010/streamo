# Fresh setup su un Pi nuovo

Procedura per ricostruire l'intero stack da zero su una macchina nuova (OS
reinstallato, hardware nuovo, ecc.). I file `.env` non sono in git e
contengono i tuoi secrets — devi ricrearli a mano dai backup.

## 0. Prerequisiti

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin git curl openssl

# Aggiungi il tuo utente al gruppo docker (evita sudo per ogni comando)
sudo usermod -aG docker $USER
# logout/login (o `newgrp docker`) per rendere effettivo

# Verifica
docker compose version
```

## 1. Clone del repo

```bash
cd ~
git clone <repo-url> streamingimmunity
cd streamingimmunity
```

## 2. Ricrea i due `.env` dagli example

Nel repo trovi `.env.example` e `infra/wireguard/.env.example` (sono in
git, contengono tutta la struttura e i default sensati ma niente
secrets). Copiali e riempi i placeholder:

```bash
cp .env.example .env
cp infra/wireguard/.env.example infra/wireguard/.env

# editi a mano i due file riempiendo:
$EDITOR .env
$EDITOR infra/wireguard/.env
```

### `streamingimmunity/.env` — campi da riempire

| Campo | Da dove |
|---|---|
| `TMDB_API_KEY` | backup, oppure ne generi una nuova su themoviedb.org |
| `SUPER_ADMIN_EMAIL` | la tua email admin |
| `FCM_PROJECT_ID` | backup, oppure dal Firebase Console |
| `FCM_SERVICE_ACCOUNT_JSON` | backup (è il base64 del JSON del service account) |
| `APP_OWNER_UID` / `APP_OWNER_GID` | `id -u` e `id -g` dell'utente che owna i file |

Lascia i default per Postgres, worker pool, cert/Caddy a meno che tu
non sappia cosa stai cambiando.

⚠️ Se non hai il backup di `TMDB_API_KEY` e `FCM_SERVICE_ACCOUNT_JSON`
devi rigenerarli dalle rispettive console. Il `FCM_SERVICE_ACCOUNT_JSON`
in particolare è il base64 di un file JSON scaricabile dal Firebase
Console (impostazioni progetto → Service accounts → Generate new
private key → base64 del file).

### `infra/wireguard/.env` — campi da riempire

| Campo | Da dove |
|---|---|
| `WIREGUARD_HOST` | IP pubblico di casa o DDNS hostname |
| `WIREGUARD_PEERS` | comma-separated lista dei device (es. `phone,laptop`) |
| `WIREGUARD_OWNER` / `WIREGUARD_GROUP` | utente Linux che owna `data/` (es. `matteoscanferla`) |

## 4. Permessi (one-shot)

```bash
sudo ./scripts/fix-perms.sh
```

Questo chowna tutti i file sensibili a `APP_OWNER_UID:APP_OWNER_GID` e
imposta `0600` su `.env`, log, e chiavi private.

## 5. Avvia gli stack

```bash
# Streamo (app + caddy + cert-renew)
./scripts/up.sh

# WireGuard (VPN)
cd infra/wireguard
sudo ./scripts/up.sh
cd ../..
```

Al primo avvio:
- `cert-renew` daemon vede che `infra/certs/` è vuota → genera CA + cert
  (firma gli IP in `CERT_SAN`)
- Il container WireGuard genera nuove chiavi server + peer (in `data/`)
- Postgres parte vuoto, AUTO_MIGRATE crea le tabelle

## 6. Enroll devices (per ogni dispositivo)

### 6a. WireGuard — QR

Dal Pi:
```bash
cd ~/streamingimmunity/infra/wireguard
./scripts/peer.sh show <peer-name>
# esempio: ./scripts/peer.sh show matteoscanferla
```

Stampa il QR ASCII a video. Sul telefono:
- App WireGuard → "+ Aggiungi tunnel" → "Scansiona da QR"
- Attiva il tunnel

### 6b. Root CA per HTTPS

Il root CA è in `infra/certs/rootCA.pem`. Copialo sul dispositivo dal
**Mac/laptop** via scp:
```bash
scp <user>@<pi-lan-ip>:~/streamingimmunity/infra/certs/rootCA.pem ~/Downloads/
```

Poi installalo come trusted root sul dispositivo:

- **iOS**: apri il file `rootCA.pem` come allegato → Settings → General →
  VPN & Device Management → "Downloaded Profile" → Install. Poi
  Settings → General → About → Certificate Trust Settings → toggle
  **ON** per "mkcert ...". Questo secondo step è obbligatorio (iOS
  installa il cert ma non lo trusta automaticamente).
- **Android**: Settings → Security → Encryption & credentials → Install
  a certificate → **CA certificate** (non "user").
- **macOS**:
  ```bash
  sudo security add-trusted-cert -d -r trustRoot \
    -k /Library/Keychains/System.keychain ~/Downloads/rootCA.pem
  ```
- **Linux**: copia il file in `/usr/local/share/ca-certificates/`
  rinominandolo con estensione `.crt`, poi `sudo update-ca-certificates`.

### 6c. Verifica

Connetti il device alla VPN, apri `https://192.168.1.99` — deve mostrare
l'app con lucchetto verde e senza warning. Da LAN (senza VPN) puoi anche
usare `http://192.168.1.99:7549` per AirPlay/Cast.

## 7. (opzionale) Ripristino dati

Se hai un dump Postgres dal vecchio Pi:

```bash
cat backup.sql | docker exec -i streamingimmunity-postgres-1 \
  psql -U streamo -d streamo
```

Watchlist, history, users tornano come prima.

---

## Cosa va salvato fuori dal Pi per essere safe

Backup periodico di questi su una macchina diversa / cloud:

| Cosa | Perché |
|---|---|
| `streamingimmunity/.env` | secrets (TMDB, FCM, Postgres pwd) |
| `infra/wireguard/.env` | config VPN (endpoint, peers list) |
| `infra/certs/rootCA.pem` + `rootCA-key.pem` | evita di reinstallare CA su ogni device |
| `infra/wireguard/data/peer_*/` | chiavi peer (evita re-import QR) |
| `infra/wireguard/data/server/` | chiavi server WG |
| Postgres dump (`pg_dump`) | dati utenti (watchlist, history) |

Comandi rapidi per il backup:

```bash
# Postgres dump giornaliero
docker exec streamingimmunity-postgres-1 pg_dump -U streamo streamo \
  > "backup-$(date +%F).sql"

# Tarball completo (env + certs + WG state)
sudo tar czf streamingimmunity-state-$(date +%F).tar.gz \
  .env \
  infra/wireguard/.env \
  infra/certs/ \
  infra/wireguard/data/peer_* \
  infra/wireguard/data/server/
```

Conserva entrambi i file fuori dal Pi (cloud storage cifrato, NAS, ecc).
