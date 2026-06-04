# Streamo Android — Note per Claude

## Convenzioni UI

### Dialog di conferma
- Il pulsante **"Annulla"** deve sempre usare `color = MaterialTheme.colorScheme.onSurfaceVariant` (mai il primary).
- L'azione distruttiva/negativa (Elimina, Rimuovi, ecc.) usa `MaterialTheme.colorScheme.error`.
- L'azione positiva/confirm usa il colore di default del TextButton (primary).

### Card e poster
- Le immagini TMDB passano sempre per `TMDBImage.url(path, size)`.
- `ProgressMediaCard` è il componente condiviso per: Continue Watching, History, Watchlist.
- Le card di tipo poster usano `aspectRatio = 2f / 3f`, quelle still/episodio `16f / 9f`.
- **Ogni icona o badge che fluttua sopra un poster/still deve avere un background scuro semi-trasparente** (es. `Color.Black.copy(alpha = 0.55f)` con clip arrotondato). Mai affidarsi solo al colore dell'icona: sfondi chiari o bianchi la renderebbero invisibile.

## Architettura

- **MVVM + Hilt**: ogni screen ha il proprio ViewModel, `@HiltViewModel` con `@Inject`.
- **Navigazione**: `NavRoutes` sealed class + `LocalNavController`. Preferire passare lambda `onNavigateTo...` invece di usare NavController direttamente nei Composable riutilizzabili.
- **Database**: `StreamoDatabase` (Room) con entità: `ProgressEntry`, `HistoryEntry`, `WatchlistEntry`, `DownloadEntry`, `ProviderMappingEntity`.
- **Download**: `ResolveAndDownloadWorker` (WorkManager) con backoff lineare.

## Logica TV

- `TVLogic` contiene tutte le utility stagione/episodio.
- `WATCHED_THRESHOLD = 0.9`: un episodio si considera finito sopra il 90%.
- **Smart resume** (DetailViewModel): per serie TV, `resumeSeasonEpisode` è l'episodio incompleto più recente (o il prossimo se quello è finito).
- **Continue Watching** raggruppa per `tmdbId+mediaType` e mostra solo l'entry con `updatedAt` più recente, filtrando completati.

## Provider

- `ProviderResolver` mappa TMDB → provider esterno.
- Il mapping viene salvato in `ProviderMappingEntity` per evitare ricalcoli.
- Se il resolver trova più candidati, mostra un picker (`showProviderPicker = true`).

## Stile

- Sfondo delle screen cinematiche (Detail, Player): `Color.Black` per mantenere coerenza con il media.
- TopAppBar su schermate a scorrimento usa `enterAlwaysScrollBehavior`.
- Le LazyRow usano `contentPadding = PaddingValues(horizontal = 16.dp)` e `Arrangement.spacedBy(14.dp)`.

## Lingua

- L'app è in italiano. Testi UI, content description e messaggi di errore devono essere in italiano.
