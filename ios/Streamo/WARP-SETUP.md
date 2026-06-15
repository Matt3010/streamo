# WARP on-device — build `WireProxyKit` (gomobile)

L'app instrada il traffico provider (ricerca/scrape + playback via `LocalHLSServer`)
attraverso un tunnel WireGuard **userspace** verso Cloudflare WARP, che espone un
proxy HTTP locale su `127.0.0.1`. Nessun server, nessuna Network Extension, nessun
entitlement VPN.

Lato Swift è già tutto nel progetto: `Provider/WarpAccount.swift` (registra l'account
WARP, port di `wgcf`, Keychain), `Provider/WarpTunnel.swift` (avvia il motore, espone
`warpSession`/`trace()`), `Player/HLSProxyRewriter.swift` + route live-proxy in
`Player/LocalHLSServer.swift`.

Manca **un solo pezzo nativo**: il motore WireGuard userspace, fornito come
xcframework `WireProxyKit` (gomobile, wrappa `github.com/windtf/wireproxy`). I sorgenti
Go sono già pronti in **`wireproxykit/`** (root, condiviso con Android) (`wireproxykit.go`, `go.mod`, `build-ios.sh`).
Finché l'xcframework non è collegato, `WarpTunnel.isAvailable == false` e l'app resta
in **Diretto** (il toggle WARP è disabilitato con avviso in Impostazioni → Avanzate).

## Build

Prerequisiti: **Xcode completo** (non solo CLT) e **Go**.

```sh
# se `xcode-select -p` mostra CommandLineTools:
sudo xcode-select -s /Applications/Xcode.app
brew install go            # se manca

cd wireproxykit
./build-ios.sh             # installa gomobile, risolve deps, produce l'xcframework in ios/Streamo/Frameworks/
```

L'output va in **`ios/Streamo/Frameworks/WireProxyKit.xcframework`**, già referenziato
dal progetto (Embed & Sign). È committato come Android committa `warpkit.aar`, quindi
altre macchine/CI non hanno bisogno di Go + Xcode toolchain.

## Collega in Xcode

Già collegato: l'xcframework è in `ios/Streamo/Frameworks/` e referenziato in
`Streamo.xcodeproj`. Basta **Rebuild** — `#if canImport(WireProxyKit)` attiva
`WireProxyEngine` e il toggle WARP si abilita. (Se lo rigeneri e Xcode non lo vede,
Product → Clean Build Folder.)

## Uso

Impostazioni → Avanzate → **WARP**:
1. "Registra account WARP" (una tantum).
2. Attiva il toggle WARP.
3. "Verifica egress" → deve mostrare `warp` attivo + un IP Cloudflare ≠ tuo IP.

Ricerca e riproduzione escono da WARP; il badge in player/download diventa verde.
AirPlay continua a funzionare perché il telefono fa da proxy sulla LAN.

## Note

- `build-ios.sh` esegue `go get github.com/windtf/wireproxy@latest` + `go mod tidy`: la
  versione esatta viene fissata al primo build (committa il `go.sum` generato).
- gomobile nomina i simboli `<Package><Func>`: package Go `wireproxykit` →
  `WireproxykitStart(_:)` / `WireproxykitStop()`, modulo `WireProxyKit` (dal `-o`).
  Se rinomini il package, aggiorna `WireProxyEngine` in `WarpTunnel.swift`.
- Se `whyvl/wireproxy` cambia firma di `ParseConfig`/`StartWireguard`/`SpawnRoutine`,
  adatta `wireproxykit.go` (oggi: `StartWireguard(conf *Configuration, logLevel int)`).
