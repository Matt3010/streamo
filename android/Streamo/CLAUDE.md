# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Security & Privacy

**NEVER read, access, or reference:**
- SSH keys or config (`~/.ssh/`, `%USERPROFILE%\.ssh\`)
- Credentials, tokens, secrets outside this repo
- Home directory contents (`~`, `%USERPROFILE%`, `C:\Users\*`) except this project path
- `.env` files (including this repo's `.env`), credential stores, keychain/vault data

**NEVER include in output, tool calls, or code:**
- Full home directory paths — use `~` or relative paths
- Usernames from filesystem paths
- Contents of any file matching `id_rsa*`, `*.pem`, `*.key`, `known_hosts`, `authorized_keys`
- API keys, passwords, tokens found anywhere

When paths must be shown, redact username: `C:\Users\<user>\...` or `~\...`

Streamo Android is a Kotlin/Jetpack Compose port of the iOS app, whose Swift source lives in the same repo at [`../../ios/Streamo`](../../ios/Streamo) — useful as a behavioral reference when porting or reconciling features. It browses a TMDB catalog and plays movies/TV via an external scraping provider, with offline downloads, casting, watchlist, history and JSON backup.

## Working approach

If you can't find the solution after several attempts, or you're out of ideas, search the internet instead of inventing things and burning tokens on guesses. Don't keep blindly retrying or fabricating APIs/behavior — look it up (web search / official docs) to get the real answer.

## Writing plans

When you produce an implementation plan, write it so that any model — not just the one that authored it — can read and execute it reliably. Plans are frequently handed off to other models (e.g. GLM-5.2, MiniMax-M3, Kimi-K2.7-Code, DeepSeek-V4) for execution, so they must be self-contained and unambiguous. Follow these rules:

- **Make it self-contained.** State every fact needed to execute. Never rely on conversation history, hidden context, or "as discussed" — the executing model may not have seen any of it.
- **Lead with Context.** Open with a short section explaining *why* the change is being made: the problem, what prompted it, and the intended outcome.
- **Use a strict hierarchy.** Markdown headings (`##`/`###`), then ordered lists for sequential steps and unordered lists for non-sequential items. One idea per bullet. No walls of prose.
- **Be concrete and deterministic.** Name exact file paths, function/class names, and symbols (e.g. `provider/ProviderResolver.confirmCandidate()`). Avoid vague references like "the relevant file" or "update accordingly".
- **Reference what already exists.** Point to existing functions, utilities, and patterns to reuse, with their paths — don't imply new code where the codebase already has a solution.
- **Fence all code and commands.** Put code, file snippets, and shell commands in fenced blocks with a language tag. Quote error messages and identifiers exactly.
- **Use consistent terminology.** Pick one name per concept and reuse it verbatim throughout the plan; don't alternate synonyms.
- **State acceptance criteria.** End with explicit, checkable success conditions and a verification section (commands to run, expected output, how to confirm the change end-to-end).
- **Describe repeated patterns once.** For a change that repeats across many files, describe the pattern a single time and list a few representative paths rather than enumerating every file and line.

## Build & test commands

Single module `:app`. Gradle 8.10.2 wrapper, AGP 8.7.3, Kotlin 2.1.20, JDK 11. Use `./gradlew` (Unix) or `.\gradlew.bat` (Windows PowerShell).

- Build debug APK: `./gradlew assembleDebug`
- Install on device/emulator: `./gradlew installDebug`
- Lint: `./gradlew lint` (`abortOnError = false` — lint never fails the build)
- Unit tests: `./gradlew test`
- Single unit test: `./gradlew test --tests "com.streamo.app.ExampleUnitTest.addition_isCorrect"`
- Instrumented tests (needs device): `./gradlew connectedAndroidTest`

There is essentially no test suite yet — only the scaffold `ExampleUnitTest`. Verify changes by building and running on a device.

**Always verify generated code compiles** (`./gradlew assembleDebug`) — mandatory when the change touches many files or adds anything that requires new imports. After renaming classes or Hilt-annotated types, incremental builds can fail on stale generated artifacts: retry with `./gradlew clean assembleDebug` before assuming the code is wrong.

The TMDB key is baked via `BuildConfig.DEFAULT_TMDB_API_KEY` in `app/build.gradle.kts`; users can override it in Settings. `release` is signed with the debug key and `isMinifyEnabled = false`.

## Architecture

**MVVM + Hilt + Compose + Room.** Single-activity (`MainActivity`), single Application (`MainApplication`, `@HiltAndroidApp`). Package root `com.streamo.app`.

- **DI** (`di/`): `NetworkModule` (Retrofit→TMDB on `api.themoviedb.org/3/`, Gson with snake_case naming), `DatabaseModule` (Room), `AppModule`. All `@Singleton` in `SingletonComponent`.
- **Navigation** (`navigation/`): type-safe `NavRoutes` sealed class (`@Serializable` data objects/classes — args travel as typed fields, e.g. `Detail(tmdbId, mediaType, resumeSeason, resumeEpisode)`). `LocalNavController` composition-local + `RootTabView` for the bottom tabs. Pass `onNavigateTo...` lambdas into reusable composables rather than the NavController.
- **Data** (`data/`): `repository/AppRepository` is the single repository over Room DAOs. Entities: `ProgressEntry`, `HistoryEntry`, `WatchlistEntry`, `DownloadEntry`, `ProviderMappingEntity`, `SearchHistoryEntry`. `preferences/SettingsDataStore` (DataStore). `backup/BackupManager` does JSON export/import (uses kotlinx.serialization; Retrofit uses Gson).
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

- **`DownloadInfrastructure`** (object, init'd in `MainApplication.onCreate`): owns the Media3 `SimpleCache`, `DownloadManager`, and a tuned OkHttp client (HTTP/2 multiplexing, 6-connection pool). Must be initialized before use.
- **`ResolveAndDownloadWorker`** (`CoroutineWorker`, linear backoff): the **current** path — resolves the provider source then downloads directly via `HlsDownloader`. New downloads go here.
- `MediaDownloadService` + `DownloadStateSyncer` are kept for notifications and to sync legacy/in-flight downloads. `MainApplication` purges stale `DownloadManager` entries left by the old approach on startup.
- Quality selection: `DownloadQuality`, `DownloadQualityGate`, `DownloadResolutionProbe`, `DownloadGate`. Per-network quality preference exists (see recent commit).

### Playback & casting (`player/`)

- `PlaybackService` (Media3 `MediaSessionService`) + `PlaybackSessionHolder`; `PipController` for picture-in-picture.
- `player/cast`: `CastController` + `CastBannerViewModel` — a persistent banner lets the user reclaim control or background a cast session.
- `player/dlna`: `DlnaCastManager`, `DlnaSessionPlayer`, and `LocalHlsProxy` (NanoHTTPD) — serves the HLS stream over a local HTTP proxy so DLNA/TV renderers can fetch it.
- `player/lancast`: `LanCast*` classes — the app-to-app cast protocol (NSD `_streamo._tcp` discovery + HTTP REST) between phone and the app on Android TV / Fire TV.

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

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
