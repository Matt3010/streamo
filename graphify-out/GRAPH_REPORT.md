# Graph Report - streamingimmunity  (2026-07-08)

## Corpus Check
- 345 files · ~252,136 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1131 nodes · 2202 edges · 64 communities (46 shown, 18 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 156 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `7fd2e828`
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
- [[_COMMUNITY_SettingsScreen|SettingsScreen]]
- [[_COMMUNITY_WatchlistViewModel|WatchlistViewModel]]
- [[_COMMUNITY_Int|Int]]
- [[_COMMUNITY_List|List]]
- [[_COMMUNITY_Modifier|Modifier]]
- [[_COMMUNITY_String|String]]
- [[_COMMUNITY_TmdbGenre|TmdbGenre]]
- [[_COMMUNITY_PlayerViewModel|PlayerViewModel]]
- [[_COMMUNITY_DetailScreen.kt|DetailScreen.kt]]
- [[_COMMUNITY_TvSettingsOverlay|TvSettingsOverlay]]
- [[_COMMUNITY_HistoryViewModel|HistoryViewModel]]
- [[_COMMUNITY_TVLogic|TVLogic]]
- [[_COMMUNITY_VixcloudClient|VixcloudClient]]
- [[_COMMUNITY_Release|Release]]
- [[_COMMUNITY_MediaDownloadService|MediaDownloadService]]
- [[_COMMUNITY_Boolean|Boolean]]
- [[_COMMUNITY_PlayerViewModel.kt|PlayerViewModel.kt]]
- [[_COMMUNITY_.resolveTrack|.resolveTrack]]
- [[_COMMUNITY_sortItems|sortItems]]
- [[_COMMUNITY_SettingsScreen|SettingsScreen]]
- [[_COMMUNITY_GlassDialogDestructiveButton|GlassDialogDestructiveButton]]
- [[_COMMUNITY_CastPickerDialog|CastPickerDialog]]
- [[_COMMUNITY_String|String]]
- [[_COMMUNITY_CastBanner|CastBanner]]
- [[_COMMUNITY_GlassBottomSheet|GlassBottomSheet]]
- [[_COMMUNITY_.seekTo|.seekTo]]
- [[_COMMUNITY_NavHostController|NavHostController]]
- [[_COMMUNITY_NavRoutes|NavRoutes]]
- [[_COMMUNITY_TmdbReview|TmdbReview]]
- [[_COMMUNITY_CastDeviceGroup|CastDeviceGroup]]
- [[_COMMUNITY_ChromecastRenderer|ChromecastRenderer]]
- [[_COMMUNITY_com|com]]
- [[_COMMUNITY_DlnaRenderer|DlnaRenderer]]
- [[_COMMUNITY_DownloadQualityPref|DownloadQualityPref]]
- [[_COMMUNITY_LanRenderer|LanRenderer]]
- [[_COMMUNITY_TmdbEpisodeDetail|TmdbEpisodeDetail]]

## God Nodes (most connected - your core abstractions)
1. `PlayerViewModel` - 86 edges
2. `AppRepository` - 45 edges
3. `SeriesDownloadsViewModel` - 33 edges
4. `DetailViewModel` - 31 edges
5. `SettingsDataStore` - 28 edges
6. `TMDBClient` - 26 edges
7. `ProviderClient` - 22 edges
8. `CacheManagementViewModel` - 21 edges
9. `GlassAlertDialog()` - 20 edges
10. `HomeViewModel` - 19 edges

## Surprising Connections (you probably didn't know these)
- `AppNavHost()` --calls--> `DetailScreen()`  [INFERRED]
  android/Streamo/app/src/main/java/com/streamo/app/navigation/AppNavHost.kt → android/Streamo/app/src/main/java/com/streamo/app/ui/detail/DetailScreen.kt
- `AppNavHost()` --calls--> `HomeScreen()`  [INFERRED]
  android/Streamo/app/src/main/java/com/streamo/app/navigation/AppNavHost.kt → android/Streamo/app/src/main/java/com/streamo/app/ui/home/HomeScreen.kt
- `AppNavHost()` --calls--> `PlayerScreen()`  [INFERRED]
  android/Streamo/app/src/main/java/com/streamo/app/navigation/AppNavHost.kt → android/Streamo/app/src/main/java/com/streamo/app/ui/player/PlayerScreen.kt
- `RootTabView()` --calls--> `DialogHostState`  [INFERRED]
  android/Streamo/app/src/main/java/com/streamo/app/navigation/RootTabView.kt → android/Streamo/app/src/main/java/com/streamo/app/ui/common/GlassDialog.kt
- `GlassBottomSheet()` --calls--> `scrimEnter()`  [INFERRED]
  android/Streamo/app/src/main/java/com/streamo/app/ui/common/GlassBottomSheet.kt → android/Streamo/app/src/main/java/com/streamo/app/ui/common/GlassDialog.kt

## Import Cycles
- None detected.

## Communities (64 total, 18 thin omitted)

### Community 0 - "AppRepository"
Cohesion: 0.08
Nodes (13): AppRepository, Boolean, DownloadEntry, Float, Flow, Int, List, Long (+5 more)

### Community 1 - "DetailViewModel"
Cohesion: 0.12
Nodes (11): DetailViewModel, Boolean, Double, DownloadQualityPref, Int, Pair, ProgressEntry, StateFlow (+3 more)

### Community 2 - "GlassAlertDialog"
Cohesion: 0.21
Nodes (20): cardEnter(), cardExit(), DialogHandle, GlassAlertDialog(), GlassDialog(), GlassDialogContent(), GlassDialogNeutralButton(), GlassDialogPrimaryButton() (+12 more)

### Community 3 - "SettingsScreen"
Cohesion: 0.06
Nodes (41): AnimeDetailScreen(), AnimeHeader(), AnimeSynopsis(), EpisodeCell(), Boolean, Float, Int, String (+33 more)

### Community 4 - "EpisodeDownloadCard"
Cohesion: 0.09
Nodes (43): GlassCard(), GlassDefaults, GlassFilterChip(), GlassSnapshot, androidx, Boolean, Modifier, String (+35 more)

### Community 5 - "GlassTopBarScaffold"
Cohesion: 0.06
Nodes (36): AnimeCatalogCard(), AnimeContinueRow(), AnimeErrorState(), AnimeScreen(), AnimeSearchField(), List, Modifier, ProgressEntry (+28 more)

### Community 6 - "HomeViewModel"
Cohesion: 0.13
Nodes (11): HomeViewModel, Boolean, com, HomeSection, Int, List, ProgressEntry, StateFlow (+3 more)

### Community 7 - "TMDBClient"
Cohesion: 0.12
Nodes (17): ImageLoader, MainApplication, Collection, Int, List, Long, String, TmdbGenre (+9 more)

### Community 8 - "WatchlistViewModel"
Cohesion: 0.09
Nodes (22): ConfirmDialog(), Boolean, FocusRequester, String, SectionHeader(), SettingsValueRow(), TvCacheManagementScreen(), Int (+14 more)

### Community 9 - "MediaCard"
Cohesion: 0.21
Nodes (13): AnimatedActionIcon(), ContinueWatchingRow(), ErrorState(), HomeScreen(), Boolean, HomeSection, ImageVector, Int (+5 more)

### Community 10 - "SettingsDataStore"
Cohesion: 0.08
Nodes (15): Boolean, Context, Float, Flow, Map, String, Triple, SettingsDataStore (+7 more)

### Community 11 - "AppDatabase"
Cohesion: 0.06
Nodes (18): AppDatabase, migrate(), Boolean, Flow, Int, List, String, WatchlistDao (+10 more)

### Community 12 - "AppNavHost"
Cohesion: 0.08
Nodes (42): AppNavHost(), detailEnterTransition(), detailExitTransition(), isDetailRoute(), Boolean, EnterTransition, ExitTransition, Int (+34 more)

### Community 13 - "TabletLandscapeShell"
Cohesion: 0.24
Nodes (11): Anime, GlassBottomBar(), Home, Boolean, Color, HazeState, Modifier, rememberTabContentColor() (+3 more)

### Community 14 - "FilterBar"
Cohesion: 0.28
Nodes (17): FilterBar(), FilterButton(), GenreBadgeRow(), GenrePickerDialog(), GenreSummaryChip(), SearchHistoryDropdown(), SearchScreen(), SortButton() (+9 more)

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
Cohesion: 0.17
Nodes (19): buildCastDeviceGroups(), extractIp(), androidx, Boolean, ChromecastRenderer, DlnaRenderer, Int, LanRenderer (+11 more)

### Community 19 - "TmdbCacheDao"
Cohesion: 0.19
Nodes (5): Int, Long, String, TmdbCacheDao, TmdbCacheEntry

### Community 20 - "CLAUDE.md"
Cohesion: 0.12
Nodes (15): Architecture, Build & test commands, Cards & posters, Confirmation dialogs, Downloads (two paths — be careful which you touch), graphify, Language, Playback & casting (`player/`) (+7 more)

### Community 21 - "NetworkModule"
Cohesion: 0.12
Nodes (25): decodeHTMLEntities(), extractYear(), firstMatch(), HttpResponse, Int, List, Long, OkHttpClient (+17 more)

### Community 22 - "TmdbCacheKey"
Cohesion: 0.29
Nodes (4): Boolean, Int, String, TmdbCacheKey

### Community 23 - ".availableHeights"
Cohesion: 0.18
Nodes (11): DownloadInfrastructure, Context, DownloadManager, DownloadResolutionProbe, Int, List, OkHttpClient, String (+3 more)

### Community 24 - "MainApplication"
Cohesion: 0.14
Nodes (33): downloadDetailLine(), downloadItemLabel(), DownloadManagerRow(), DownloadsSheet(), formatBytes(), formatSpeed(), Boolean, DownloadEntry (+25 more)

### Community 25 - ".provideImageLoader"
Cohesion: 0.40
Nodes (3): ImageModule, Context, ImageLoader

### Community 28 - "SettingsScreen"
Cohesion: 0.22
Nodes (15): glassCapsule(), GlassLargeTitle(), GlassTopBar(), GlassTopBarScaffold(), androidx, HazeState, ImageVector, Modifier (+7 more)

### Community 29 - "WatchlistViewModel"
Cohesion: 0.13
Nodes (12): Factory, Boolean, DownloadEntry, DownloadQualityPref, Int, List, Map, Pair (+4 more)

### Community 35 - "PlayerViewModel"
Cohesion: 0.09
Nodes (11): Context, Float, List, StateFlow, TmdbItem, PlayerViewModel, DefaultTrackSelector, ExoPlayer (+3 more)

### Community 36 - "DetailScreen.kt"
Cohesion: 0.16
Nodes (23): DetailScreen(), DetailScrollContent(), DetailSkeleton(), EpisodeCard(), EpisodesSection(), EpisodesUnavailable(), ErrorState(), formatClock() (+15 more)

### Community 37 - "TvSettingsOverlay"
Cohesion: 0.20
Nodes (23): aspectLabel(), androidx, Boolean, com, Float, ImageVector, Int, List (+15 more)

### Community 38 - "HistoryViewModel"
Cohesion: 0.16
Nodes (15): coordinate(), formatWatchTime(), HistoryFilter, HistoryItem, HistorySection, HistoryUiState, HistoryViewModel, Double (+7 more)

### Community 39 - "TVLogic"
Cohesion: 0.24
Nodes (9): Boolean, Int, List, Pair, String, TmdbEpisodeDetail, TmdbItem, TVLogic (+1 more)

### Community 40 - "VixcloudClient"
Cohesion: 0.22
Nodes (10): FetchFailed, List, OkHttpClient, PlaybackSource, String, PlaylistNotFound, StreamEntry, VixcloudClient (+2 more)

### Community 41 - "Release"
Cohesion: 0.33
Nodes (7): Boolean, Int, Pair, String, TmdbItem, Release, Date

### Community 42 - "MediaDownloadService"
Cohesion: 0.14
Nodes (10): ensureNotificationChannel(), androidx, Context, DownloadManager, Int, MediaDownloadService, Download, DownloadService (+2 more)

### Community 43 - "Boolean"
Cohesion: 0.24
Nodes (5): Boolean, ChromecastRenderer, DlnaRenderer, LanRenderer, CastSession

### Community 44 - "PlayerViewModel.kt"
Cohesion: 0.18
Nodes (9): Chromecast, Dlna, Lan, onIsPlayingChanged(), onPlayerError(), PendingCastTarget, SkipPrompt, SkipSegment (+1 more)

### Community 45 - ".resolveTrack"
Cohesion: 0.24
Nodes (7): androidx, Int, Pair, onPlaybackStateChanged(), onTracksChanged(), onVideoSizeChanged(), TrackInfo

### Community 46 - "sortItems"
Cohesion: 0.26
Nodes (12): compareNullableDir(), Double, Int, List, String, T, TmdbItem, numKey() (+4 more)

### Community 47 - "SettingsScreen"
Cohesion: 0.30
Nodes (11): hsvColor(), Color, Float, SettingsViewModel, String, Triple, QualityPickerRow(), rgbToHsv() (+3 more)

### Community 48 - "GlassDialogDestructiveButton"
Cohesion: 0.22
Nodes (9): GlassDialogDestructiveButton(), AdvancedSettingsScreen(), Boolean, SettingsViewModel, String, SectionHeaderAdv(), CacheManagementScreen(), String (+1 more)

### Community 49 - "CastPickerDialog"
Cohesion: 0.40
Nodes (10): CastDetailPanel(), CastDeviceRow(), CastPickerDialog(), DeviceHeaderRow(), Boolean, CastDeviceGroup, HazeState, List (+2 more)

### Community 50 - "String"
Cohesion: 0.24
Nodes (3): Map, PlaybackSource, String

### Community 51 - "CastBanner"
Cohesion: 0.22
Nodes (8): CastBanner(), Boolean, HazeState, Modifier, String, DialogEntry, DialogHostState, List

### Community 52 - "GlassBottomSheet"
Cohesion: 0.31
Nodes (9): GlassBottomSheet(), GlassBottomSheetContent(), Boolean, EnterTransition, ExitTransition, HazeState, SheetAnchor, sheetCardEnter() (+1 more)

## Knowledge Gaps
- **35 isolated node(s):** `SheetAnchor`, `ProviderAvailability`, `Security & Privacy`, `Working approach`, `Writing plans` (+30 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **18 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `DetailViewModel` connect `DetailViewModel` to `GlassAlertDialog`, `DetailScreen.kt`, `HomeViewModel`, `WatchlistViewModel`, `NetworkModule`?**
  _High betweenness centrality (0.175) - this node is a cross-community bridge._
- **Why does `PlayerViewModel` connect `PlayerViewModel` to `AppRepository`, `TvSettingsOverlay`, `WatchlistViewModel`, `Boolean`, `PlayerViewModel.kt`, `.resolveTrack`, `String`, `.seekTo`?**
  _High betweenness centrality (0.168) - this node is a cross-community bridge._
- **Why does `AppRepository` connect `AppRepository` to `AppDatabase`?**
  _High betweenness centrality (0.122) - this node is a cross-community bridge._
- **What connects `SheetAnchor`, `ProviderAvailability`, `Security & Privacy` to the rest of the system?**
  _35 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `AppRepository` be split into smaller, more focused modules?**
  _Cohesion score 0.07539450613676213 - nodes in this community are weakly interconnected._
- **Should `DetailViewModel` be split into smaller, more focused modules?**
  _Cohesion score 0.12043010752688173 - nodes in this community are weakly interconnected._
- **Should `SettingsScreen` be split into smaller, more focused modules?**
  _Cohesion score 0.06294326241134751 - nodes in this community are weakly interconnected._