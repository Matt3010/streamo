# Piano: Navigazione dalle sezioni Home alle liste complete

## Obiettivo
Permettere di cliccare sull'intestazione di ogni sezione della Home per aprire la pagina con la lista completa dei titoli, con top app bar contenente tasto indietro e titolo della sezione.

## File coinvolti

### 1. `ui/common/SectionHeader.kt`
**Modifica:** Aggiungere parametro opzionale `onClick: (() -> Unit)? = null`. Quando presente, rendere la riga cliccabile e mostrare una freccia a destra (chevron) come indicatore visivo.

### 2. `navigation/NavRoutes.kt`
**Aggiungere** due nuove route:
- `data object ContinueWatching : NavRoutes()` — per "Continua a guardare"
- `data class SectionList(val title: String, val endpoint: String, val mediaType: String) : NavRoutes()` — per le sezioni TMDB

### 3. `data/remote/TMDBApi.kt`
**Modifica:** Aggiungere parametro `@Query("page") page: Int = 1` al metodo `list()` per supportare la paginazione.

### 4. `tmdb/TMDBClient.kt`
**Modifica:** Aggiornare `suspend fun list(endpoint: String, page: Int = 1)` per passare il parametro page all'API.

### 5. `ui/continuewatching/ContinueWatchingScreen.kt` (nuovo)
**Creare** schermata lista completa "Continua a guardare":
- `TopAppBar` con tasto indietro (`Icons.AutoMirrored.Filled.ArrowBack`) e titolo "Continua a guardare"
- `LazyColumn` con `ProgressMediaCard` per ogni `ProgressEntry`
- Stile identico a `HistoryScreen` ma senza necessità di combinare con history entries

### 6. `ui/continuewatching/ContinueWatchingViewModel.kt` (nuovo)
**Creare** ViewModel che espone `Flow<List<ProgressEntry>>` dal repository, eventualmente arricchito con i dati di progress.

### 7. `ui/sectionlist/SectionListScreen.kt` (nuovo)
**Creare** schermata generica per le sezioni TMDB:
- `TopAppBar` con tasto indietro e titolo dinamico (passato dalla route)
- `LazyVerticalGrid` a colonne adattive (min 140dp) con `MediaCard`
- Supporto paginazione: scroll infinito che carica pagine successive
- Stato di caricamento iniziale con `SkeletonCard`
- Stato vuoto con messaggio appropriato

### 8. `ui/sectionlist/SectionListViewModel.kt` (nuovo)
**Creare** ViewModel che:
- Riceve `title`, `endpoint`, `mediaType` tramite `SavedStateHandle` (Compose Navigation)
- Carica pagine dal TMDBClient on-demand
- Mantiene stato `items`, `isLoading`, `hasMorePages`
- Espone `loadMore()` per scroll infinito

### 9. `ui/home/HomeScreen.kt`
**Modificare** le righe sezione per passare `onHeaderClick`:
- `ContinueWatchingRow`: naviga a `NavRoutes.ContinueWatching`
- `MyListRow`: naviga a `NavRoutes.Watchlist` (esistente)
- `SectionRow`: naviga a `NavRoutes.SectionList(title, endpoint, mediaType)`

### 10. `navigation/AppNavHost.kt`
**Registrare** i nuovi composable:
- `NavRoutes.ContinueWatching` → `ContinueWatchingScreen(onNavigateToDetail = ..., onBack = popBackStack)`
- `NavRoutes.SectionList` → `SectionListScreen(onNavigateToDetail = ..., onBack = popBackStack)`

## Considerazioni UX
- Il `SectionHeader` cliccabile avrà una freccia (chevron) a destra per indicare che è tappabile, rendendo l'interazione più discoverable rispetto a un semplice tap sul testo.
- Le schermate di lista completa manterranno lo stesso stile visivo delle pagine esistenti (`HistoryScreen`, `WatchlistScreen`) per coerenza.
- Il tasto indietro utilizza `Icons.AutoMirrored.Filled.ArrowBack` (già presente nel codebase per `DetailScreen` e `PlayerScreen`).

## Ordine di implementazione consigliato
1. SectionHeader clickable
2. Nuove NavRoutes
3. TMDBApi + TMDBClient paginazione
4. ContinueWatchingScreen + ViewModel
5. SectionListScreen + ViewModel
6. HomeScreen (aggiungere i click handler)
7. AppNavHost (registrare nuove route)
