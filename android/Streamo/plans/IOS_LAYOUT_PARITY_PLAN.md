# Allineamento layout Android ↔ iOS Streamo

## Context

L'app Android è un porting di Jetpack Compose dell'app iOS (`../../ios/Streamo`). È nata da una versione di test iOS più vecchia; da allora l'iOS è cambiato, quindi alcune schermate/layout Android sono divergenti o mancano feature visive.

Questo piano allinea **solo layout/UI** delle schermate **telefono/tablet** (TV esclusa, scelta utente). Il LAN sharing iOS (server HTTP locale con QR/VLC/password/auto-shutoff) è **escluso** e annotato come "da valutare il porting" in fase separata.

Mappatura iOS↔Android già fatta. Sintesi gap reali (alcune voci segnalate dall'esplorazione iniziale erano già a parità):

- **History**: già a parità (glass watch-time card, type chip Tutti/TV/Film, sezioni raggruppate per tempo con titolo+summary). **Nessun lavoro.**
- **Detail**: già copre play/riprendi, watchlist, download, prossimo episodio, trailer, provider picker, reviews, recommendations. Gap minori (link "Leggi su TMDB", badge download su card episodio) → bassa priorità.

Gap da chiudere (in ordine di priorità):

| # | Gap | iOS ha | Android ha |
|---|-----|--------|-----------|
| 1 | Hero carousel in Home | sì (auto-advance, swipe, indicatori, play+bookmark, dissolve) | no — trending mostrati come righe normali |
| 2 | Top 10 numerato | sì (numerali sagomati 1–10) | no |
| 3 | Filtri Watchlist | status (da guardare/in corso/visto/non usciti) + tipo (tutti/TV/film) | nessun filtro, solo griglia |
| 4 | Info su card (titolo/anno/voto) + toggle | sì, con toggle "mostra info" | `MediaCard` mostra solo titolo, nessun toggle |
| 5 | Cap qualità streaming (settings) | Auto/1080/720/480 separato dal download | manca (solo qualità download) |
| 6 | Campo locale provider (settings) | sì | pref esiste già, **nessuna UI** |
| 7 | Schermata "Impostazioni avanzate" | split base/avanzate | tutto in una schermata |
| 8 | WARP badge nel player durante load | sì | no (player mostra solo DNS) |

---

## Approccio raccomandato

### 1. Hero carousel in Home — *alta priorità, alto impatto visivo*

**File**: nuovo `ui/home/HomeHero.kt`; modifica `ui/home/HomeScreen.kt`, `ui/home/HomeViewModel.kt`, `ui/home/HomeSection.kt`.

- In `HomeViewModel`: esporre `heroItems: List<TmdbItem>` derivati dal merge di `movie-trending` + `tv-trending` (già caricati), ordinati per `popularity`, primi ~6. Usano `backdropPath`/`posterPath`, `displayTitle`, `mediaType`.
- In `HomeSection.kt`: marcare `movie-trending` e `tv-trending` come **nascosti dalle righe** (flag `hiddenFromRows`) — come iOS, che li usa solo per hero. Filtrare in `HomeScreen` `items(HomeSections.all.filter { !it.hiddenFromRows })`.
- `HomeHero`: `Box` full-bleed in cima alla `LazyColumn` (primo `item{}`), `AsyncImage` backdrop (`TMDBImage.url(..., W780/Original)`), gradiente bottom→`Color.Black`, titolo + bottone "Guarda" (rosso primary) + bottone bookmark in overlay. Indicatori di pagina cliccabili.
- Auto-advance: `LaunchedEffect` con loop `delay(...)` su `pagerState` (in-app `delay`/orologio OK). Swipe tramite `HorizontalPager` (Compose foundation). Cross-fade opzionale (animateContentSize/Crossfade) — accettabile partire con pager scorrevole standard se il dissolve costa troppo.
- Play → `NavRoutes.Player`; bookmark → toggle watchlist via repository (aggiungere metodo al VM se assente).

### 2. Top 10 row — *alta priorità*

**File**: nuovo `ui/home/Top10Row.kt` (+ `Top10Card`); usato in `HomeScreen`, dati da `HomeViewModel`.

- VM: `top10: List<TmdbItem>` = merge trending movie+tv per `popularity`, primi 10, escludendo gli `heroItems` (evita duplicati, come iOS).
- `Top10Card`: `Row` con numerale grande sagomato (outline) a sinistra + poster 2:3. Per l'outline usare `Text` con `drawWithContent`/`TextStyle(drawStyle = Stroke(...))` (Compose `androidx.compose.ui.graphics.drawscope.Stroke`).
- Inserire la riga in `HomeScreen` subito dopo Continue Watching / My list, con `SectionHeader("Top 10", Icons.Filled.Star)`.

### 3. Filtri Watchlist — *alta priorità*

**File**: `ui/watchlist/WatchlistViewModel.kt`, `ui/watchlist/WatchlistScreen.kt`.

- Riusare il pattern chip di `HistoryScreen.kt` (`FilterChip` + `FilterChipDefaults.filterChipColors(selectedContainerColor = primary)`).
- **Filtro tipo** (Tutti/TV/Film): immediato, filtra su `entry.mediaType`.
- **Filtro status** (Da guardare/In corso/Visto/Non usciti): derivare lo status per item in `WatchlistViewModel` dal `progress` già combinato (vedi `WatchlistItem.progress`):
  - *In corso*: progress esistente e `position < duration*0.9`.
  - *Visto*: `position ≥ duration*0.9` (riusare `TVLogic.WATCHED_THRESHOLD`).
  - *Non uscito*: `primaryDate` futura / assente (necessita enrichment TMDB di `WatchlistEntry`; se l'entry non porta la data, fare lazy-fetch come iOS — altrimenti limitare a Da guardare/In corso/Visto nella prima iterazione e annotare "Non usciti = follow-up").
  - *Da guardare*: nessun progress.
- Esporre `selectedType`/`selectedStatus` StateFlow + setter, e `items` filtrati. Aggiungere due righe di chip in cima alla griglia (come iOS: due file).

### 4. Info su card + toggle — *media priorità*

**File**: `ui/common/MediaCard.kt`; `data/preferences/SettingsDataStore.kt`; `ui/settings/SettingsScreen.kt` + `SettingsViewModel.kt`; call-site in Home/Search/Watchlist.

- Aggiungere a `MediaCard` parametri opzionali `year: Int? = null`, `rating: Double? = null`, `showInfo: Boolean = true`. Sotto al titolo, riga `anno · ★voto` (gold `#FFC107`, stile `labelSmall`), mostrata solo se `showInfo`.
- Nuova pref `SHOW_CARD_INFO` (default `true`) in `SettingsDataStore` (pattern identico a `foldersEnabled`).
- Toggle in Settings: "Mostra titolo, anno e voto" (card "Colore dell'app" o nuova card "Aspetto"). Nota iOS: Continue Watching mostra **sempre** le info → forzare `showInfo = true` nelle card di Continue Watching ignorando la pref.
- Passare `year = item.year`, `rating = item.voteAverage` ai call-site che hanno un `TmdbItem`.

### 5. Cap qualità streaming — *media priorità*

**File**: `SettingsDataStore.kt`, `SettingsScreen.kt`+VM, `ui/player/PlayerViewModel.kt`.

- Nuova pref `STREAMING_QUALITY` (token `auto|1080|720|480`, default `auto`).
- Picker in Settings (riusare il pattern `QualityPickerRow` + dialog `RadioButton` già presente per il download; opzioni senza "Chiedi", con "Auto").
- Applicare in `PlayerViewModel`: impostare `trackSelectionParameters` di ExoPlayer con `setMaxVideoSize`/`maxVideoHeight` secondo la pref (Media3 `DefaultTrackSelector`/`TrackSelectionParameters.Builder().setMaxVideoSize(...)`).

### 6 + 7. Schermata Impostazioni avanzate + locale provider — *media priorità*

**File**: nuovo `ui/settings/AdvancedSettingsScreen.kt`; `navigation/NavRoutes.kt` (+ `AppNavHost.kt`); `SettingsScreen.kt`; `SettingsViewModel.kt`.

- Nuova route `NavRoutes.AdvancedSettings` + entry in `AppNavHost`. Link "Impostazioni avanzate" in fondo a `SettingsScreen` (come iOS `NavigationLink`).
- **Spostare** in Advanced: card TMDB API Key, card WARP, card Manutenzione. **Aggiungere** card "Provider" con `OutlinedTextField` per il locale (`viewModel.providerLocale` ↔ `SettingsDataStore.setProviderLocale`, pref **già esistente**) + bottone reset a `"it"`.
- Settings principale resta: Aspetto/colore + toggle info card, Playback (autoplay + cap streaming), Download (auto-delete + qualità per rete), Organization (folder), Statistiche, Backup, App info.

### 8. WARP badge nel player — *bassa priorità*

**File**: `ui/player/PlayerScreen.kt` (+ eventuale `ui/common/WarpBadge.kt`).

- Quando `warpEnabled` e lo stream è in resolving/playing via WARP, mostrare un piccolo badge ("WARP" + icona scudo) nell'overlay di caricamento, su sfondo scuro semi-trasparente (rispetta la regola CLAUDE.md: badge sopra media = sfondo scuro `Color.Black.copy(alpha=0.55f)` con clip arrotondato). Port di iOS `WarpBadge.swift`.

---

## Convenzioni da rispettare (CLAUDE.md)

- UI/testi/content-description **in italiano**; codice/commit/PR in inglese.
- Badge/icone sopra poster/still → **sfondo scuro semi-trasparente** obbligatorio.
- "Annulla" nei dialog → `color = MaterialTheme.colorScheme.onSurfaceVariant`; azioni distruttive → `colorScheme.error`.
- Immagini TMDB sempre via `TMDBImage.url(path, size)`.
- Poster 2:3, still 16:9; LazyRow `contentPadding = PaddingValues(horizontal = 16.dp)`, `Arrangement.spacedBy(14.dp)`.
- Riusare `ProgressMediaCard`, `SectionHeader`, `MediaCard`, `FilterChip` esistenti invece di duplicare.

## Fuori scope (annotato)

- **LAN sharing** (server NanoHTTPD, QR, VLC, password, auto-shutoff timer, token): da valutare il porting in fase separata. Esiste già `LocalHlsProxy` (NanoHTTPD) in `player/dlna` riutilizzabile come base se si decidesse di portarlo.
- Schermate TV (Fire TV / Android TV): invariate.

## Verifica

Nessuna test suite reale nel progetto (solo `ExampleUnitTest`). Verifica manuale su device/emulatore:

1. Build: `.\gradlew.bat assembleDebug` (lint non blocca: `abortOnError = false`).
2. Install: `.\gradlew.bat installDebug`.
3. **Home**: hero in cima auto-avanza e risponde a swipe/tap; play/bookmark funzionano; riga Top 10 con numerali; trending non più duplicati come righe.
4. **Watchlist**: chip tipo+status filtrano correttamente; status derivato coerente con progress.
5. **Card**: toggle "Mostra info" in Settings nasconde/mostra anno+voto; Continue Watching mostra sempre le info.
6. **Settings**: link "Impostazioni avanzate" apre la nuova schermata con TMDB key, WARP, locale provider, manutenzione; cap qualità streaming presente.
7. **Player**: con WARP attivo il badge appare durante il caricamento; impostando 720p il player limita la risoluzione.
8. Build + run finale per confermare nessuna regressione di navigazione.

## Ordine di esecuzione suggerito

1. Hero + Top 10 (#1, #2) — stesso file/VM, massimo impatto.
2. Filtri Watchlist (#3).
3. Info card + toggle (#4).
4. Advanced Settings + locale provider (#6, #7).
5. Cap qualità streaming (#5).
6. WARP badge player (#8).
