# Streamo — Piano di Migrazione iOS → Android

> **Stato:** Migrazione completata — build verde | **Progetto Android:** Funzionalmente completo | **Data:** 2026-05-29

---

## 1. Executive Summary

L'app iOS **Streamo** è stata portata in Kotlin Android con Jetpack Compose, Room, Coil, ExoPlayer (Media3) e Hilt.
Tutte le fasi di migrazione sono state implementate; il progetto compila correttamente e replica le funzionalità
chiave dell'app iOS (catalogo TMDB, streaming via provider, watchlist, cronologia, download offline,
player con ExoPlayer, impostazioni complete, backup JSON e tema personalizzabile).

Le sezioni 2-8 del documento originale restano valide come riferimento architetturale; di seguito
sono riportati gli stati di completamento e i fix applicati dopo la prima build funzionante.

---

## 2. Verifica delle Informazioni Fornite

| Informazione | Stato | Note / Correzioni |
|---|---|---|
| App per film/serie TV in streaming | ✅ Confermato | |
| Catalogo TMDB via API token | ✅ Confermato | Chiave default baked: `42b62dc...`, override in Settings |
| Streaming via Vixcloud | ✅ Confermato, con caveat | Il provider **non è Vixcloud diretto**: è **StreamingCommunity** → telegra.ph (link aggiornato) → search → iframe → embed vixcloud → HLS playlist. La catena è: `TMDB title → ProviderClient.search() → ProviderResolver → VixcloudClient.playbackSources()` |
| Download in locale | ✅ Confermato | HLS `.movpkg` offline tramite `AVAssetDownloadTask`. Su Android useremo ExoPlayer + `DownloadManager` o `WorkManager` + FFmpeg/HLS download |
| Gestione watchlist | ✅ Confermato | SwiftData `WatchlistEntry` con status (todo/inProgress/done) |
| Backup iCloud | ⚠️ Da rivedere | Su iOS è backup/restore **manuale JSON** (non iCloud automatico). L'utente esporta un `.json` e lo reimporta. Su Android: **Google Drive / Storage Access Framework / Firebase** — da decidere |

### Aggiunte / Correzioni rilevanti scoperte nel codice

1. **Provider chain complessa**: L'app non usa Vixcloud direttamente. Cerca il titolo su StreamingCommunity (base URL dinamico da telegra.ph), fa scoring fuzzy-match, risolve embed iframe, poi estrae playlist HLS da vixcloud.co.
2. **Smart resume & progress tracking**: Per ogni episodio/movie viene tracciata posizione e durata. "Continua a guardare" è calcolato in tempo reale con logica di "next unwatched episode".
3. **Autoplay next episode**: Disponibile e attivo di default.
4. **Now Playing / Lockscreen / PiP / AirPlay**: Integrazione nativa iOS completa. Su Android: MediaSession + Picture-in-Picture + Cast.
5. **Cartelle watchlist**: Raggruppamento titoli in folder personalizzate.
6. **Notifiche locali**: "Nuovo episodio" + "Promemoria ripresa" (solo foreground scheduling, non background fetch).
7. **Trailer YouTube**: Integrazione TMDB videos.
8. **Widget iOS**: "Continua a guardare" — da valutare se replicare come Android widget/home screen.
9. **Theme engine**: Colore accent completamente personalizzabile (default rosso #E50914).

---

## 3. Architettura iOS → Mapping Android

### 3.1 Stack Tecnologico

| Layer | iOS (Swift) | Android (Kotlin) |
|---|---|---|
| **UI Framework** | SwiftUI | Jetpack Compose |
| **State Management** | `@Observable` (Observation framework) | `ViewModel` + `StateFlow` / `Compose State` |
| **Dependency Injection** | Singleton manuali | Hilt (Dagger) |
| **Networking** | `URLSession` + async/await | Retrofit + OkHttp + Kotlin Coroutines |
| **JSON Parsing** | `Codable` | kotlinx.serialization (o Gson/Moshi) |
| **Persistence locale** | SwiftData (`@Model`) | Room (SQLite) |
| **Immagini** | `AsyncImage` | Coil |
| **Player** | AVPlayer (AVKit) | ExoPlayer (Media3) |
| **Download HLS** | `AVAssetDownloadTask` | ExoPlayer `DownloadManager` + `WorkManager` |
| **Background/Scheduler** | `NotificationCenter` | WorkManager + AlarmManager |
| **Settings** | `UserDefaults` | `DataStore` (o SharedPreferences) |
| **Deep Links** | `onOpenURL` | Android App Links / Intent Filters |
| **Media Session** | `MPNowPlayingInfoCenter` | `MediaSessionCompat` |
| **PiP** | `AVPlayerViewController` | `PictureInPictureParams` |

### 3.2 Struttura Package Android Proposta

```
com.streamo.app
├── data
│   ├── local                 # Room entities, DAOs, Database
│   ├── remote                # Retrofit APIs, DTOs
│   ├── repository            # Repository implementations
│   └── model                 # Domain models (shared)
├── domain
│   ├── model                 # Pure Kotlin data classes
│   ├── repository            # Repository interfaces
│   └── usecase               # Use cases (opzionale, per complessità)
├── player                    # ExoPlayer wrapper, DownloadManager
├── provider                # ProviderClient, ProviderResolver, VixcloudClient
├── tmdb                    # TMDBClient, modelli TMDB
├── ui
│   ├── home                # HomeViewModel + HomeScreen
│   ├── search              # SearchViewModel + SearchScreen
│   ├── detail              # DetailViewModel + DetailScreen
│   ├── watchlist           # WatchlistViewModel + WatchlistScreen
│   ├── history             # HistoryScreen
│   ├── downloads           # DownloadsScreen
│   ├── settings            # SettingsScreen
│   └── common              # Theme, components shared, navigation
├── navigation              # NavHost, deep links
├── widget                  # Android App Widget (optional)
├── di                      # Hilt modules
└── util                    # Format, TVLogic, Release, extensions
```

---

## 4. Modelli Dati — Mapping SwiftData → Room

### 4.1 Entità Room (con corrispondente SwiftData)

| SwiftData `@Model` | Room `@Entity` | Note |
|---|---|---|
| `WatchlistEntry` | `WatchlistEntryEntity` | PK: `(tmdbId, mediaTypeRaw)` |
| `ProgressEntry` | `ProgressEntryEntity` | PK: `(tmdbId, mediaTypeRaw, season, episode)` |
| `HistoryEntry` | `HistoryEntryEntity` | Auto-increment ID + unique constraint giornaliera |
| `ProviderMapping` | `ProviderMappingEntity` | PK: `(tmdbId, mediaTypeRaw)` |
| `DownloadEntry` | `DownloadEntryEntity` | PK: `(tmdbId, mediaTypeRaw, season, episode)` |

### 4.2 DataStore (ex-UserDefaults)

- `tmdbApiKey`
- `autoplayNext`
- `providerLocale`
- `foldersEnabled`
- `autoDeleteWatchedDownloads`
- `accentColor` (RGB)
- `recentSearches` (JSON string)
- `watchlistExpandedFolders` (JSON string)
- `watchlistStatusFilter`
- `watchlistTypeFilter`

---

## 5. Fasi di Migrazione

> Ogni fase è concepita per produrre un build funzionante e testabile. Non si procede alla fase successiva finché la precedente non è stabile.

---

### 🔷 FASE 0 — Scaffold Android, Tema, Navigazione

**Obiettivo:** Progetto Android compilabile con tema scuro, accent color dinamico, e navigazione a tab.

**Task:**
1. Aggiornare `libs.versions.toml` con le dipendenze necessarie (Compose BOM, Navigation, Room, Retrofit, Hilt, Coil, ExoPlayer, DataStore, WorkManager).
2. Configurare Hilt (`Application` class + `@HiltAndroidApp`).
3. Creare `StreamoTheme` in Compose: dark-only, accent color da DataStore.
4. Implementare `RootTabView` equivalente: BottomNavigation con 3 tab (Home, Cerca, Lista) + sheet per History/Settings/Downloads.
5. Setup `NavHost` con nested navigation per ogni tab.
6. Aggiungere `AmbientBackground` (gradiente accent wash → nero).

**File chiave da creare:**
- `MainActivity.kt`
- `ui/theme/Theme.kt`, `Color.kt`, `Type.kt`
- `navigation/AppNavHost.kt`
- `ui/common/AmbientBackground.kt`
- `ui/common/SectionHeader.kt`, `MediaCard.kt` (stub)

**Punti in sospeso:**
- ❓ Icona app: riutilizzare asset iOS (esportare PNG/WEBP da `AppIcon.appiconset`) o creare nuova adaptive icon?

---

### 🔷 FASE 1 — TMDB Client, Modelli, Home & Search (browsing only)

**Obiettivo:** Catalogo TMDB funzionante: home row, search, detail page statico.

**Task:**
1. **Retrofit setup**: `TMDBApi` interface con endpoints (`/trending/movie/day`, `/tv/{id}/season/{n}`, `/search/multi`, etc.).
2. **DTOs**: Convertire `TmdbItem`, `TmdbSeasonDetails`, `TmdbEpisodeDetail`, etc. in `data class` Kotlin con `@SerialName`.
3. **TMDBClient**: Actor → singleton repository con memo-cache LRU per details (100 item).
4. **HomeViewModel**: Caricamento concorrente delle row, stato `Loading/Content/Error`.
5. **HomeScreen**: Lazy row orizzontali con skeleton cards.
6. **SearchScreen**: SearchBar + debounce 350ms + recent searches persistence.
7. **DetailScreen (static)**: Header con backdrop, metadata, cast, overview, recensioni, raccomandazioni (senza player/CTA attivo).

**File chiave da creare:**
- `data/remote/TMDBApi.kt`, `data/remote/dto/*.kt`
- `data/repository/TMDBRepository.kt`
- `tmdb/TMDBClient.kt` (wrapper)
- `ui/home/HomeViewModel.kt`, `HomeScreen.kt`
- `ui/search/SearchViewModel.kt`, `SearchScreen.kt`
- `ui/detail/DetailViewModel.kt`, `DetailScreen.kt`
- `util/Format.kt` (port `Format.time`, `Format.percent`, etc.)
- `util/TVLogic.kt` (port TVLogic completo)
- `util/Release.kt` (port Release completo)

**Punti in sospeso:**
- ❓ TMDB API key: hardcoded default come su iOS, o in `local.properties` / BuildConfig?

---

### 🔷 FASE 2 — Provider Resolver + Vixcloud + Player ExoPlayer

**Obiettivo:** La catena di streaming end-to-end funziona: da TMDB title a HLS playable.

**Task:**
1. **ProviderClient**: Portare la logica di scraping StreamingCommunity.
   - `resolveTitle()`: search + fuzzy scoring (`tokenOverlapScore`, `normalizeTitle`).
   - `episodeEmbed()`, `movieEmbed()`: fetch iframe → estrazione vixcloud embed URL.
   - `baseURL()`: fetch da telegra.ph con TTL 10 min.
2. **VixcloudClient**: Scraping embed HTML per estrarre `window.masterPlaylist` + `window.streams` → playlist URLs.
3. **ProviderResolver**: Orchestrazione con in-memory cache + `ProviderMapping` persistito.
4. **PlaybackController**: Wrapper ExoPlayer.
   - `start()`: resolve provider → `MediaItem` con headers (`Referer`, `Origin`).
   - Fallback automatico tra mirror CDN (`window.streams`).
   - Progress callback ogni 5s.
   - `onCompleted`: autoplay next (se enabled).
5. **PlayerScreen**: Fullscreen Compose con `AndroidView` wrapping `PlayerView` (ExoPlayer).
   - Stati: resolving / ready / failed.
   - Background artwork + overlay nero.
   - PiP support.
6. **NowPlaying (Android)**: `MediaSessionCompat` + `MediaMetadataCompat` per lockscreen/notification.

**File chiave da creare:**
- `provider/ProviderClient.kt`
- `provider/ProviderResolver.kt`
- `provider/VixcloudClient.kt`
- `provider/ProviderModels.kt`
- `player/PlaybackController.kt`
- `player/PlayerScreen.kt`
- `player/NowPlayingHelper.kt` (MediaSession)

**Punti in sospeso:**
- ❓ **Domanda critica per l'utente**: Lo streaming via StreamingCommunity + Vixcloud è un meccanismo di scraping di siti di terze parti. Questo potrebbe violare ToS dei provider e in alcune giurisdizioni essere illegale. L'app originale iOS include una nota legale nelle impostazioni: "Lo streaming usa provider di terze parti; la legalità dipende dalle tue leggi locali." Vuoi mantenere questa logica identica o hai alternative da considerare?
- ❓ Download offline: ExoPlayer ha `DownloadManager` nativo per DASH/HLS. Confermi che vogliamo replicare il download HLS offline esattamente come iOS (`.movpkg` equivalente)?

---

### 🔷 FASE 3 — Watchlist / History / Progress (Room + Repository)

**Obiettivo:** Persistenza locale completa con Room, logica smart-resume, griglia episodi con progress bar.

**Task:**
1. **Room Database**: `StreamoDatabase` con tutte le entità.
2. **DAO**: `WatchlistDao`, `ProgressDao`, `HistoryDao`, `ProviderMappingDao`, `DownloadDao`.
3. **Library (repository)**: Portare tutta la logica di `Library.swift`.
   - Watchlist toggle, status, folders.
   - Progress save/update, `continueRows()`, `nextUnwatched()`.
   - History save con dedup giornaliero.
   - `recalculate()` cleanup.
   - Provider mappings persist.
4. **UI Watchlist**: Grid con folder tiles, filter chips (status + type), context menu.
5. **UI History**: Lista cronologia con opzione rimozione.
6. **UI Detail episodi**: Griglia orizzontale episode cards con progress bar rossa, highlight next-to-watch.

**File chiave da creare:**
- `data/local/StreamoDatabase.kt`
- `data/local/dao/*.kt`
- `data/local/entity/*.kt`
- `data/repository/LibraryRepository.kt`
- `ui/watchlist/WatchlistViewModel.kt`, `WatchlistScreen.kt`
- `ui/history/HistoryScreen.kt`
- `ui/detail/EpisodeCard.kt`

**Punti in sospeso:**
- ❓ Cloud sync: come gestiamo il backup/restore cross-device? Opzioni:
  - A) JSON export/import manuale (pari-pari iOS) — più semplice
  - B) Firebase Firestore / Realtime Database — richiede backend
  - C) Google Drive API — complesso, necessita OAuth
  - **Raccomandazione**: Implementare prima A (export/import JSON via Storage Access Framework), poi valutare B/C in futuro.

---

### 🔷 FASE 4 — Badge Smart Watchlist + Grafico Attività + Statistiche

**Obiettivo:** Watchlist "intelligente" con badge testuali + schermata statistiche.

**Task:**
1. **WatchlistEnrichment**: Logica per calcolare badge:
   - "Mancano N episodi" / "Sei al passo" / "Serie conclusa" / "Mancano N min"
   - Basato su `airedEpisodesCount` vs `watchedEpisodeCount` vs `doneAiredEpisodes`.
2. **Statistiche**:
   - Tempo totale guardato (`totalWatchSeconds()`).
   - Grafico 30 giorni attività (Jetpack Compose Charts o MPAndroidChart).
3. **UI**: Aggiungere badge sulle card watchlist, possibile screen statistiche in settings o tab separato.

**File chiave:**
- `ui/watchlist/WatchlistEnrichment.kt` (domain logic)
- `ui/settings/StatsScreen.kt` (opzionale)

---

### 🔷 FASE 5 — Provider Picker, Autoplay, Gestione Non-Usciti, Extra

**Obiettivo:** Feature parity completa con la versione iOS.

**Task:**
1. **ProviderPickerSheet**: BottomSheet / Dialog con lista candidati, conferma manuale, refresh.
2. **Autoplay next episode**: Al completamento episodio, resolve e play next (con abort se non disponibile).
3. **Auto-flip watchlist on-read**: Quando guardi un titolo, se era "todo" → "inProgress"; se movie completato ≥90% → "done".
4. **Titoli non usciti**: Gestione upcoming con filtro separato in watchlist.
5. **Trailer**: Pulsante "Trailer" che apre YouTube (intent o CustomTabs).
6. **Toggle griglia/lista**: Preferenza in watchlist/history.
7. **Toast**: Snackbar globali conferma azioni.
8. **Reset progresso**: "Riparti dall'inizio" per film, azzera per episodio.
9. **Marcatura manuale**: "Segna come visto/da vedere" + "Segna visto fino a qui".

**File chiave:**
- `ui/detail/ProviderPickerSheet.kt`
- `ui/common/ToastHost.kt` (Snackbar globale)
- `util/WatchStatus.kt`

---

### 🔷 FASE 6 — Download Offline, Notifiche, PiP, Widget, Polish

**Obiettivo:** Feature avanzate e polish finale.

**Task:**
1. **DownloadManager** (ExoPlayer):
   - Serial queue (1 download attivo).
   - Pausa durante playback.
   - Stati: queued, downloading, paused, completed, failed.
   - Auto-retry con backoff (max 3).
   - Auto-delete dopo visione (se enabled).
2. **Notifiche locali**:
   - "Nuovo episodio": check in foreground quando apri app (non background fetch).
   - "Promemoria ripresa": scheduling reminder.
3. **PiP (Picture-in-Picture)**: `PictureInPictureParams` + ExoPlayer supporto nativo.
4. **Cast (Chromecast)**: Opzionale, ExoPlayer ha `CastPlayer`.
5. **Android Widget**: Replica "Continua a guardare" (lista poster + progresso).
6. **Deep links**: `streamo://open?type=tv&id=123&s=1&e=2`.
7. **Backup/Restore JSON**: Export via SAF, import con doppia conferma.
8. **Performance**: Coil caching immagini, Room pagination se necessario.

**Punti in sospeso:**
- ❓ Widget Android: home screen widget con lista scorrevole? Android 12+ limita aggiornamenti. Meglio un widget statico con gli ultimi 3 item.
- ❓ Notifiche background: Android 12+ richiede `SCHEDULE_EXACT_ALARM` o `USE_EXACT_ALARM` per reminder precisi. Vuoi notifiche esatte o approssimate?
- ❓ Chromecast: aggiungiamo supporto Cast nativo o rimandiamo a post-MVP?

---

## 6. Dipendenze Gradle Proposte

```toml
[versions]
compose-bom = "2025.05.00"
navigation = "2.8.0"
room = "2.7.0"
hilt = "2.56"
coil = "2.7.0"
retrofit = "2.11.0"
serialization = "1.8.0"
media3 = "1.6.0"
work = "2.10.0"
datastore = "1.1.0"

[libraries]
androidx-compose-bom = { group = "androidx.compose", name = "compose-bom", version.ref = "compose-bom" }
androidx-compose-material3 = { group = "androidx.compose.material3", name = "material3" }
androidx-compose-ui-tooling = { group = "androidx.compose.ui", name = "ui-tooling" }
androidx-navigation-compose = { group = "androidx.navigation", name = "navigation-compose", version.ref = "navigation" }
androidx-room-runtime = { group = "androidx.room", name = "room-runtime", version.ref = "room" }
androidx-room-ktx = { group = "androidx.room", name = "room-ktx", version.ref = "room" }
androidx-room-compiler = { group = "androidx.room", name = "room-compiler", version.ref = "room" }
androidx-hilt-navigation-compose = { group = "androidx.hilt", name = "hilt-navigation-compose", version = "1.2.0" }
hilt-android = { group = "com.google.dagger", name = "hilt-android", version.ref = "hilt" }
hilt-compiler = { group = "com.google.dagger", name = "hilt-compiler", version.ref = "hilt" }
coil-compose = { group = "io.coil-kt", name = "coil-compose", version.ref = "coil" }
retrofit = { group = "com.squareup.retrofit2", name = "retrofit", version.ref = "retrofit" }
retrofit-converter-kotlinx = { group = "com.squareup.retrofit2", name = "converter-kotlinx-serialization", version.ref = "retrofit" }
kotlinx-serialization-json = { group = "org.jetbrains.kotlinx", name = "kotlinx-serialization-json", version.ref = "serialization" }
media3-exoplayer = { group = "androidx.media3", name = "media3-exoplayer", version.ref = "media3" }
media3-ui = { group = "androidx.media3", name = "media3-ui", version.ref = "media3" }
media3-session = { group = "androidx.media3", name = "media3-session", version.ref = "media3" }
media3-datasource-okhttp = { group = "androidx.media3", name = "media3-datasource-okhttp", version.ref = "media3" }
androidx-work-runtime-ktx = { group = "androidx.work", name = "work-runtime-ktx", version.ref = "work" }
androidx-datastore-preferences = { group = "androidx.datastore", name = "datastore-preferences", version.ref = "datastore" }
androidx-browser = { group = "androidx.browser", name = "browser", version = "1.8.0" }  # CustomTabs per YouTube trailer
okhttp = { group = "com.squareup.okhttp3", name = "okhttp", version = "4.12.0" }
```

---

## 7. Domande Aperte per l'Utente

Prima di procedere con l'implementazione, ho bisogno di conferme sui seguenti punti:

1. **Legalità / Scraping**: Vuoi mantenere identica la logica di streaming via StreamingCommunity+Vixcloud, oppure vuoi esplorare alternative legali (es. TMDB non fornisce streaming, ma potremmo linkare a servizi legali)?

2. **Cloud Sync**: Per il backup, preferisci:
   - **A)** Export/import JSON manuale (pari-pari iOS)
   - **B)** Firebase (richiede account/progetto Firebase)
   - **C)** Google Drive sync (complessità media)

3. **Download offline**: Confermi che vogliamo replicare il download HLS offline con ExoPlayer `DownloadManager`?

4. **Chromecast / Cast**: Lo aggiungiamo come feature o lo rimandiamo?

5. **Min SDK**: Attualmente `minSdk = 25` (Android 7.1). Alcune API moderne (PiP migliorato, DataStore, Compose) preferirebbero `minSdk = 26` (Android 8.0) o superiore. Vuoi alzare il minSdk?

6. **Notifiche esatte**: I promemoria di ripresa richiedono allarmi esatti. Vuoi richiedere il permesso `USE_EXACT_ALARM` (permesso speciale su Android 12+) o usare allarmi approssimati?

---

## 8. Checklist di Avanzamento

- [x] Fase 0: Scaffold, Tema, Navigazione
- [x] Fase 1: TMDB, Home, Search, Detail statico
- [x] Fase 2: Provider + Vixcloud + ExoPlayer
- [x] Fase 3: Room, Watchlist, History, Progress
- [x] Fase 4: Badge smart, Statistiche
- [x] Fase 5: Provider picker, Autoplay, Extra
- [x] Fase 6: Download, Notifiche, PiP, Widget, Polish

---

## 9. Fix e Polish Applicati (post-build verde)

### 2026-05-29 — Sessione di consolidamento

**1. Download — etichetta episodio corretta**
- `DetailScreen.kt`: il pulsante "Scarica" dalla pagina di una serie TV passa ora l'episodio `1`
  (invece di `0`), così il download viene salvato con `episode = 1` anziché `episode = 0`.
- `DownloadsScreen.kt`: la card di download per le serie mostra ora
  `"Stagione X · Episodio Y"` invece di solo `"Stagione X"`.

**2. Player — titolo con stagione ed episodio**
- `PlayerScreen.kt`: nella top bar overlay, se il contenuto è una serie TV (`mediaType == "tv"`),
  il titolo diventa `"Nome Serie — S1 E3"` invece di solo `"Nome Serie"`.

**3. Player — replay e auto-overlay alla fine**
- `PlayerViewModel.kt`: aggiunto stato `_playbackEnded` (Boolean) che si attiva quando
  ExoPlayer raggiunge `STATE_ENDED`.
- `PlayerScreen.kt`:
  - Quando `playbackEnded == true`, l'overlay dei controlli viene forzato visibile automaticamente.
  - Al centro dello schermo compare un grande pulsante **Replay** (icona `Replay`)
    invece dei controlli play/pause/avanti/indietro.
  - Aggiunto metodo `replay()` nel ViewModel: `seekTo(0)` + `play()`.

**4. Impostazioni — schermata espansa con feature parity iOS**
- Creato `SettingsDataStore.kt` (DataStore Preferences persistente) per gestire:
  - `tmdbApiKey`
  - `autoplayNext`
  - `providerLocale`
  - `foldersEnabled`
  - `autoDeleteWatchedDownloads`
  - `accentColor` (RGB float)
- `SettingsScreen.kt` completamente riscritto con:
  - **Catalogo (TMDB)**: campo di testo per la chiave API + avviso se vuota + pulsante "Ripristina chiave predefinita".
  - **Colore dell'app**: 8 preset colorati cliccabili; il tema si aggiorna in tempo reale
    (`MainActivity` osserva `accentColor` e passa il valore a `StreamoTheme`); pulsante
    "Ripristina rosso Streamo".
  - **Riproduzione**: toggle "Riproduci episodio successivo".
  - **Download**: toggle "Elimina dopo la visione" (≥90%).
  - **Organizzazione**: toggle "Folder nella mia lista".
  - **Manutenzione**: pulsante "Ricalcola libreria" con dialogo di conferma;
    rimuove progressi orfani e aggiorna le statistiche.
  - **Backup**: esporta/importa JSON con doppia conferma di ripristino (2 dialoghi AlertDialog).
  - **Informazioni app**: versione (`BuildConfig.VERSION_NAME`) + disclaimer legale.
- `SettingsViewModel.kt`: espanso per gestire tutti i nuovi stati, i dialoghi di conferma,
  il ricalcolo libreria e l'aggiornamento del DataStore.

**5. Wiring impostazioni nel resto dell'app**
- `TMDBClient.kt`: la chiave API viene letta in tempo reale dal `SettingsDataStore`
  (non più hardcoded); il campo `apiKey` è diventato una suspend function `apiKey()`
  per evitare blocchi sul thread principale.
- `ProviderClient.kt`: il `locale` (es. `"it"`) viene letto dal DataStore anziché essere
  hardcoded; tutte le chiamate di rete usano ora `locale()` come funzione suspend.
- `PlayerViewModel.kt`:
  - Legge `autoplayNext` dal DataStore: se disattivato, al termine dell'episodio
    non passa automaticamente al prossimo.
  - Legge `autoDeleteWatchedDownloads`: se attivo e un download completato è stato
    guardato al ≥90%, viene rimosso automaticamente da Room e dal `DownloadManager`.
- `MainActivity.kt`: osserva `accentColor` dal DataStore e lo passa a `StreamoTheme`
  in modo che il colore primario si aggiorni dinamicamente senza riavvio.

**6. Fix Hilt / DI**
- `SettingsDataStore`: aggiunta annotazione `@ApplicationContext` al parametro `Context`
  nel constructor, necessaria affinché Hilt possa fornire il context corretto a livello Singleton.

---

*Documento preparato da analisi statica del codice iOS Swift. Migrazione completata e mantenuta aggiornata con i fix post-build.*
