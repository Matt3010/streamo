# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Streamo Android is a Kotlin/Jetpack Compose port of the iOS app, whose Swift source lives in the same repo at [`../../ios/Streamo`](../../ios/Streamo) — useful as a behavioral reference when porting or reconciling features. It browses a TMDB catalog and plays movies/TV via an external scraping provider, with offline downloads, casting, watchlist, history and JSON backup.

## Build & test commands

Single module `:app`. Gradle 8.10.2 wrapper, AGP 8.7.3, Kotlin 2.1.20, JDK 11. Use `./gradlew` (Unix) or `.\gradlew.bat` (Windows PowerShell).

- Build debug APK: `./gradlew assembleDebug`
- Install on device/emulator: `./gradlew installDebug`
- Lint: `./gradlew lint` (`abortOnError = false` — lint never fails the build)
- Unit tests: `./gradlew test`
- Single unit test: `./gradlew test --tests "com.streamo.app.ExampleUnitTest.addition_isCorrect"`
- Instrumented tests (needs device): `./gradlew connectedAndroidTest`

There is essentially no test suite yet — only the scaffold `ExampleUnitTest`. Verify changes by building and running on a device.

The TMDB key is baked via `BuildConfig.DEFAULT_TMDB_API_KEY` in `app/build.gradle.kts`; users can override it in Settings. `release` is signed with the debug key and `isMinifyEnabled = false`.

## Architecture

**MVVM + Hilt + Compose + Room.** Single-activity (`MainActivity`), single Application (`StreamoApplication`, `@HiltAndroidApp`). Package root `com.streamo.app`.

- **DI** (`di/`): `NetworkModule` (Retrofit→TMDB on `api.themoviedb.org/3/`, Gson with snake_case naming), `DatabaseModule` (Room), `AppModule`. All `@Singleton` in `SingletonComponent`.
- **Navigation** (`navigation/`): type-safe `NavRoutes` sealed class (`@Serializable` data objects/classes — args travel as typed fields, e.g. `Detail(tmdbId, mediaType, resumeSeason, resumeEpisode)`). `LocalNavController` composition-local + `RootTabView` for the bottom tabs. Pass `onNavigateTo...` lambdas into reusable composables rather than the NavController.
- **Data** (`data/`): `repository/StreamoRepository` is the single repository over Room DAOs. Entities: `ProgressEntry`, `HistoryEntry`, `WatchlistEntry`, `DownloadEntry`, `ProviderMappingEntity`, `SearchHistoryEntry`. `preferences/SettingsDataStore` (DataStore). `backup/BackupManager` does JSON export/import (uses kotlinx.serialization; Retrofit uses Gson).
- **UI** (`ui/`): one package per screen, each `@HiltViewModel`. `ui/common` holds shared composables; `ui/theme` the Material3 theme.

### Provider chain (how a TMDB title becomes a playable stream)

The provider is **NOT Vixcloud directly** — Vixcloud is only the final embed host. The chain is:

```
TMDB title → ProviderClient.search() → ProviderResolver → VixcloudClient.playbackSources() → HLS playlist
```

- `provider/ProviderClient` resolves the provider's current base domain at runtime (the domain rotates, so it is fetched dynamically rather than hardcoded) and searches it for a matching title.
- `provider/ProviderResolver` orchestrates TMDB→provider title matching. It caches resolved titles in memory for the session and persists confirmed mappings in `ProviderMappingEntity` to skip re-searching. When multiple candidates match it surfaces a picker (`showProviderPicker = true`); `confirmCandidate()` pins one.
- `VixcloudClient` extracts the HLS source from the vixcloud embed/iframe.

### Downloads (two paths — be careful which you touch)

Offline download is HLS via Media3. There was a migration from a `DownloadService`-driven approach to a `WorkManager` one; both still exist:

- **`DownloadInfrastructure`** (object, init'd in `StreamoApplication.onCreate`): owns the Media3 `SimpleCache`, `DownloadManager`, and a tuned OkHttp client (HTTP/2 multiplexing, 6-connection pool). Must be initialized before use.
- **`ResolveAndDownloadWorker`** (`CoroutineWorker`, linear backoff): the **current** path — resolves the provider source then downloads directly via `HlsDownloader`. New downloads go here.
- `StreamoDownloadService` + `DownloadStateSyncer` are kept for notifications and to sync legacy/in-flight downloads. `StreamoApplication` purges stale `DownloadManager` entries left by the old approach on startup.
- Quality selection: `DownloadQuality`, `DownloadQualityGate`, `DownloadResolutionProbe`, `DownloadGate`. Per-network quality preference exists (see recent commit).

### Playback & casting (`player/`)

- `PlaybackService` (Media3 `MediaSessionService`) + `PlaybackSessionHolder`; `PipController` for picture-in-picture.
- `player/cast`: `CastController` + `CastBannerViewModel` — a persistent banner lets the user reclaim control or background a cast session.
- `player/dlna`: `DlnaCastManager`, `DlnaSessionPlayer`, and `LocalHlsProxy` (NanoHTTPD) — serves the HLS stream over a local HTTP proxy so DLNA/TV renderers can fetch it.

### TV logic (`util/TVLogic`)

All season/episode utilities. `WATCHED_THRESHOLD = 0.9` — an episode counts as finished above 90%. **Smart resume** (`DetailViewModel`): for a series, `resumeSeasonEpisode` is the most recent incomplete episode (or the next one if that is finished). **Continue Watching** groups by `tmdbId+mediaType`, shows only the most-recent `updatedAt` entry, and filters out completed items.

## UI conventions

### Confirmation dialogs
- The **"Annulla"** (Cancel) button must always use `color = MaterialTheme.colorScheme.onSurfaceVariant` — never the primary color.
- Destructive/negative actions (Elimina, Rimuovi, etc.) use `MaterialTheme.colorScheme.error`.
- The positive/confirm action uses the default TextButton color (primary).

### Cards & posters
- TMDB images always go through `TMDBImage.url(path, size)`.
- `ProgressMediaCard` is the shared component for Continue Watching, History, and Watchlist.
- Poster cards use `aspectRatio = 2f / 3f`; still/episode cards use `16f / 9f`.
- **Every icon or badge floating over a poster/still must have a dark semi-transparent background** (e.g. `Color.Black.copy(alpha = 0.55f)` with a rounded clip). Never rely on the icon color alone — light or white backgrounds would make it invisible.

### Style
- Background of cinematic screens (Detail, Player): `Color.Black`, to stay consistent with the media.
- TopAppBar on scrolling screens uses `enterAlwaysScrollBehavior`.
- LazyRows use `contentPadding = PaddingValues(horizontal = 16.dp)` and `Arrangement.spacedBy(14.dp)`.

## Language

The app is in Italian: UI text, content descriptions, and error messages must be in Italian. (Code, commits, and PRs are in English.)
