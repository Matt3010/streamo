# Graph Report - streamingimmunity  (2026-07-04)

## Corpus Check
- 269 files · ~231,422 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 735 nodes · 1406 edges · 28 communities (26 shown, 2 thin omitted)
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 164 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `ddb2f25f`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_AppRepository|AppRepository]]
- [[_COMMUNITY_DetailViewModel|DetailViewModel]]
- [[_COMMUNITY_GlassAlertDialog|GlassAlertDialog]]
- [[_COMMUNITY_SettingsScreen|SettingsScreen]]
- [[_COMMUNITY_EpisodeDownloadCard|EpisodeDownloadCard]]
- [[_COMMUNITY_GlassTopBarScaffold|GlassTopBarScaffold]]
- [[_COMMUNITY_HomeViewModel|HomeViewModel]]
- [[_COMMUNITY_TMDBClient|TMDBClient]]
- [[_COMMUNITY_WatchlistViewModel|WatchlistViewModel]]
- [[_COMMUNITY_MediaCard|MediaCard]]
- [[_COMMUNITY_SettingsDataStore|SettingsDataStore]]
- [[_COMMUNITY_AppDatabase|AppDatabase]]
- [[_COMMUNITY_AppNavHost|AppNavHost]]
- [[_COMMUNITY_TabletLandscapeShell|TabletLandscapeShell]]
- [[_COMMUNITY_FilterBar|FilterBar]]
- [[_COMMUNITY_CacheManagementViewModel|CacheManagementViewModel]]
- [[_COMMUNITY_TvSettingsScreen|TvSettingsScreen]]
- [[_COMMUNITY_Fase 2 — Audit coerenza di stile (mobile, tablet, TV)|Fase 2 — Audit coerenza di stile (mobile, tablet, TV)]]
- [[_COMMUNITY_PlayerScreen|PlayerScreen]]
- [[_COMMUNITY_TmdbCacheDao|TmdbCacheDao]]
- [[_COMMUNITY_CLAUDE|CLAUDE.md]]
- [[_COMMUNITY_NetworkModule|NetworkModule]]
- [[_COMMUNITY_TmdbCacheKey|TmdbCacheKey]]
- [[_COMMUNITY_.availableHeights|.availableHeights]]
- [[_COMMUNITY_MainApplication|MainApplication]]
- [[_COMMUNITY_.provideImageLoader|.provideImageLoader]]
- [[_COMMUNITY_TmdbCacheTtl.kt|TmdbCacheTtl.kt]]
- [[_COMMUNITY_Shape.kt|Shape.kt]]

## God Nodes (most connected - your core abstractions)
1. `AppRepository` - 45 edges
2. `DetailViewModel` - 31 edges
3. `SettingsDataStore` - 28 edges
4. `TMDBClient` - 26 edges
5. `AppNavHost()` - 23 edges
6. `GlassAlertDialog()` - 21 edges
7. `CacheManagementViewModel` - 21 edges
8. `SettingsScreen()` - 19 edges
9. `HomeViewModel` - 18 edges
10. `AppDatabase` - 17 edges

## Surprising Connections (you probably didn't know these)
- `AppNavHost()` --calls--> `AnimeScreen()`  [INFERRED]
  android/Streamo/app/src/main/java/com/streamo/app/navigation/AppNavHost.kt → android/Streamo/app/src/main/java/com/streamo/app/ui/anime/AnimeScreen.kt
- `AppNavHost()` --calls--> `DetailScreen()`  [INFERRED]
  android/Streamo/app/src/main/java/com/streamo/app/navigation/AppNavHost.kt → android/Streamo/app/src/main/java/com/streamo/app/ui/detail/DetailScreen.kt
- `AppNavHost()` --calls--> `DownloadsScreen()`  [INFERRED]
  android/Streamo/app/src/main/java/com/streamo/app/navigation/AppNavHost.kt → android/Streamo/app/src/main/java/com/streamo/app/ui/downloads/DownloadsScreen.kt
- `AppNavHost()` --calls--> `SeriesDownloadsScreen()`  [INFERRED]
  android/Streamo/app/src/main/java/com/streamo/app/navigation/AppNavHost.kt → android/Streamo/app/src/main/java/com/streamo/app/ui/downloads/SeriesDownloadsScreen.kt
- `AppNavHost()` --calls--> `HomeScreen()`  [INFERRED]
  android/Streamo/app/src/main/java/com/streamo/app/navigation/AppNavHost.kt → android/Streamo/app/src/main/java/com/streamo/app/ui/home/HomeScreen.kt

## Import Cycles
- None detected.

## Communities (28 total, 2 thin omitted)

### Community 0 - "AppRepository"
Cohesion: 0.08
Nodes (13): AppRepository, Boolean, DownloadEntry, Float, Flow, Int, List, Long (+5 more)

### Community 1 - "DetailViewModel"
Cohesion: 0.07
Nodes (35): DetailContent(), DetailScreen(), DetailScrollContent(), DetailSkeleton(), EpisodeCard(), EpisodesSection(), EpisodesUnavailable(), ErrorState() (+27 more)

### Community 2 - "GlassAlertDialog"
Cohesion: 0.08
Nodes (45): CastBanner(), Boolean, HazeState, Modifier, String, RootTabView(), cardEnter(), cardExit() (+37 more)

### Community 3 - "SettingsScreen"
Cohesion: 0.07
Nodes (42): BrandButton(), BrandButtonDefaults, BrandIconButton(), BrandSecondaryButton(), Boolean, ImageVector, Modifier, String (+34 more)

### Community 4 - "EpisodeDownloadCard"
Cohesion: 0.10
Nodes (40): GlassCard(), GlassDefaults, GlassSnapshot, androidx, Modifier, downloadDetailLine(), downloadItemLabel(), DownloadManagerRow() (+32 more)

### Community 5 - "GlassTopBarScaffold"
Cohesion: 0.07
Nodes (37): AnimeCatalogCard(), AnimeContinueRow(), AnimeErrorState(), AnimeScreen(), AnimeSearchField(), List, Modifier, ProgressEntry (+29 more)

### Community 6 - "HomeViewModel"
Cohesion: 0.08
Nodes (17): Boolean, Flow, Int, List, String, WatchlistDao, WatchlistEntry, HomeViewModel (+9 more)

### Community 7 - "TMDBClient"
Cohesion: 0.17
Nodes (12): Collection, Int, List, Long, String, TmdbGenre, TmdbItem, TmdbReview (+4 more)

### Community 8 - "WatchlistViewModel"
Cohesion: 0.09
Nodes (22): ConfirmDialog(), Boolean, FocusRequester, String, SectionHeader(), SettingsValueRow(), TvCacheManagementScreen(), Int (+14 more)

### Community 9 - "MediaCard"
Cohesion: 0.09
Nodes (29): Boolean, Double, Dp, Float, Int, Modifier, String, MediaCard() (+21 more)

### Community 10 - "SettingsDataStore"
Cohesion: 0.12
Nodes (8): Boolean, Context, Float, Flow, Map, String, Triple, SettingsDataStore

### Community 11 - "AppDatabase"
Cohesion: 0.10
Nodes (11): AppDatabase, migrate(), DatabaseModule, Context, DownloadDao, HistoryDao, ProgressDao, ProviderMappingDao (+3 more)

### Community 12 - "AppNavHost"
Cohesion: 0.13
Nodes (23): AppNavHost(), detailEnterTransition(), detailExitTransition(), isDetailRoute(), Boolean, EnterTransition, ExitTransition, Int (+15 more)

### Community 13 - "TabletLandscapeShell"
Cohesion: 0.13
Nodes (23): Anime, GlassBottomBar(), Home, Boolean, Color, HazeState, Modifier, rememberTabContentColor() (+15 more)

### Community 14 - "FilterBar"
Cohesion: 0.23
Nodes (20): GlassFilterChip(), Boolean, String, FilterBar(), FilterButton(), GenreBadgeRow(), GenrePickerDialog(), GenreSummaryChip() (+12 more)

### Community 15 - "CacheManagementViewModel"
Cohesion: 0.16
Nodes (8): CacheManagementViewModel, Boolean, Collection, DownloadEntry, Int, List, Long, StateFlow

### Community 16 - "TvSettingsScreen"
Cohesion: 0.18
Nodes (17): Boolean, FocusRequester, SettingsViewModel, String, RowContent(), SectionHeader(), SettingsToggleRow(), SettingsValueRow() (+9 more)

### Community 17 - "Fase 2 — Audit coerenza di stile (mobile, tablet, TV)"
Cohesion: 0.11
Nodes (18): 1.1 Gating incoerente su "riduci effetti" (`LocalReducedEffects`), 1.2 Frammentazione del "press feedback", 1.3 Famiglie di durata/easing incoerenti nella navigazione, 1.4 Schermate senza alcuna animazione locale, 1.5 Nota strutturale (non bloccante per la fase 1, ma impatta il codice di animazione), 2.1 Assenza di un file di token in `ui/theme/`, 2.2 Sprawl della scala di alpha, 2.3 Raggio di blur (Haze) incoerente (+10 more)

### Community 18 - "PlayerScreen"
Cohesion: 0.19
Nodes (17): buildCastDeviceGroups(), extractIp(), androidx, Boolean, CastDeviceGroup, List, Modifier, String (+9 more)

### Community 19 - "TmdbCacheDao"
Cohesion: 0.19
Nodes (5): Int, Long, String, TmdbCacheDao, TmdbCacheEntry

### Community 20 - "CLAUDE.md"
Cohesion: 0.12
Nodes (15): Architecture, Build & test commands, Cards & posters, Confirmation dialogs, Downloads (two paths — be careful which you touch), graphify, Language, Playback & casting (`player/`) (+7 more)

### Community 21 - "NetworkModule"
Cohesion: 0.20
Nodes (7): OkHttpClient, NetworkModule, AnimeUnityClient, AnimeUnityCookieJar, Gson, Retrofit, TMDBApi

### Community 22 - "TmdbCacheKey"
Cohesion: 0.29
Nodes (4): Boolean, Int, String, TmdbCacheKey

### Community 23 - ".availableHeights"
Cohesion: 0.36
Nodes (6): DownloadResolutionProbe, Int, List, OkHttpClient, String, DataSource

### Community 24 - "MainApplication"
Cohesion: 0.29
Nodes (5): ImageLoader, MainApplication, Application, DownloadStateSyncer, ImageLoaderFactory

### Community 25 - ".provideImageLoader"
Cohesion: 0.40
Nodes (3): ImageModule, Context, ImageLoader

## Knowledge Gaps
- **34 isolated node(s):** `Security & Privacy`, `Working approach`, `Writing plans`, `Build & test commands`, `Provider chain (how a TMDB title becomes a playable stream)` (+29 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `WatchlistEntry` connect `HomeViewModel` to `AppRepository`?**
  _High betweenness centrality (0.225) - this node is a cross-community bridge._
- **Why does `HomeScreen()` connect `MediaCard` to `GlassAlertDialog`, `SettingsScreen`, `GlassTopBarScaffold`, `HomeViewModel`, `AppNavHost`?**
  _High betweenness centrality (0.215) - this node is a cross-community bridge._
- **Why does `HomeViewModel` connect `HomeViewModel` to `WatchlistViewModel`, `MediaCard`?**
  _High betweenness centrality (0.203) - this node is a cross-community bridge._
- **What connects `Security & Privacy`, `Working approach`, `Writing plans` to the rest of the system?**
  _34 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `AppRepository` be split into smaller, more focused modules?**
  _Cohesion score 0.07957393483709273 - nodes in this community are weakly interconnected._
- **Should `DetailViewModel` be split into smaller, more focused modules?**
  _Cohesion score 0.07017543859649122 - nodes in this community are weakly interconnected._
- **Should `GlassAlertDialog` be split into smaller, more focused modules?**
  _Cohesion score 0.07918552036199095 - nodes in this community are weakly interconnected._