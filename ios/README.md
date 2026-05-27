# Streamo — app iOS/iPadOS nativa

Riscrittura nativa (SwiftUI + SwiftData + AVPlayer) dell'app web Streamo,
senza backend, VPN/WARP, nginx o database remoto. Tutto on-device, single-user.

## Requisiti
- Xcode 16+ (qui in repo c'erano solo i Command Line Tools: serve Xcode completo per buildare)
- iOS 17+ (richiesto da SwiftData)

## Come aprire
```
open ios/Streamo/Streamo.xcodeproj
```
Seleziona un simulatore iPhone/iPad e premi Run. Il progetto usa un
*file-system-synchronized group*: ogni file `.swift` sotto `Streamo/` viene
incluso automaticamente nel target, senza toccare il `project.pbxproj`.

## Configurazione
La chiave API TMDB è precompilata (presa dal `.env` del progetto web) ed è
modificabile in **Impostazioni**. Senza chiave il catalogo non si carica.

## Stato (per fasi)
- [x] **Fase 0** — scaffold progetto, modelli SwiftData, Impostazioni, tab nav
- [x] **Fase 1** — client TMDB, Home (9 righe), Cerca, Dettaglio (solo browsing)
- [x] **Fase 2** — provider resolver (streamingcommunity) + Vixcloud + player AVPlayer
      (catena validata end-to-end: telegra.ph → search → iframe → embed → playlist HLS;
      AVPlayer riproduce diretto, AES + segmenti OK senza proxy né header)
- [x] **Fase 3** — watchlist/history/progress (SwiftData) + smart-resume + griglia
      episodi con barre di progresso + righe "Continua a guardare"/"La mia lista" +
      tab Lista/Cronologia + persistenza progresso/completamento durante il play
- [x] **Fase 4** — badge intelligenti watchlist ("Mancano N episodi", "Serie
      conclusa", "Sei al passo", "Mancano N min") + grafico attività 30 giorni
      (Swift Charts) + tempo totale guardato
- [x] **Fase 5** — provider picker + manual refresh/confirm (persistito in
      ProviderMapping) + autoplay-next episodio + auto-flip stato watchlist
      on-read + gestione titoli non ancora usciti

**Tutte le 6 fasi completate.** La prima build/run resta da fare in Xcode sul tuo Mac.

### Widget
Widget "Continua a guardare" (codice in `StreamoWidget/` + `Streamo/Widget/`).
Richiede di creare il target Widget Extension e l'App Group in Xcode — vedi
[WIDGET-SETUP.md](./WIDGET-SETUP.md).

### Extra (post-MVP)
- [x] **Now Playing / lockscreen / remote / PiP / AirPlay** — `MPNowPlayingInfoCenter`
      + `MPRemoteCommandCenter`, `UIBackgroundModes: audio` (Info.plist), PiP+AirPlay
- [x] **Server alternativi provider** — fallback automatico tra i mirror CDN
      (`window.streams`) dello stesso embed vixcloud quando uno fallisce
- [x] **Notifiche locali** — nuovo episodio (check in foreground) + promemoria
      ripresa (schedulati); toggle in Impostazioni. NB: non background-fetch reale
- [x] **Cartelle watchlist** — raggruppamento + assegna/crea cartella da menu contestuale
- [x] **Reset progresso** — film "Riparti dall'inizio" + azzera per episodio (menu card)
- [x] **Marcatura manuale** — "Segna come visto/da vedere" (toolbar dettaglio) +
      "Segna visto fino a qui" sull'episodio
- [x] **Trailer** — pulsante che apre il trailer YouTube dai TMDB videos
- [x] **Toggle griglia/lista** — watchlist e cronologia, preferenza persistita
- [x] **Toast** — conferme sulle azioni (lista, progresso, versione)
- [x] **App icon** — riusa l'icona esistente del progetto web (icon-512 → 1024)
- [x] **Toggle notifiche granulari** — "Nuovi episodi" + "Promemoria ripresa" separati
- [x] **Stato errore Home** con pulsante "Riprova"
- [x] **Sync iCloud (opt-in)** — il ModelContainer usa CloudKit se la capability
      iCloud→CloudKit è attiva in Xcode, altrimenti fallback automatico a store locale

## Struttura
```
Streamo/
  StreamoApp.swift          # entry + ModelContainer SwiftData
  Models/                   # MediaType, modelli TMDB (Codable)
  Persistence/Models.swift  # @Model: Watchlist/Progress/History/ProviderMapping
  Networking/               # TMDBClient, TMDBImage
  Provider/                 # ProviderClient (streamingcommunity), VixcloudClient, ProviderResolver
  Player/                   # PlaybackController (AVPlayer), PlayerScreen
  Domain/                   # TVLogic (smart-resume/aired), Format
  Persistence/              # Models (@Model) + Library (store)
  Settings/AppSettings.swift
  UI/                       # RootTabView, Home, Search, Detail, Watchlist, History, Settings, Common
```
