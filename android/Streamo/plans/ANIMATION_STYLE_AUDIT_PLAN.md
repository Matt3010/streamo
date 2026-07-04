# Piano di audit: animazioni (mobile/tablet) e coerenza di stile (mobile/tablet/TV)

## Context

Streamo Android (`app/src/main/java/com/streamo/app/`) ha accumulato UI aggiunta in momenti diversi (Home, Player, dialoghi vetro, download, TV) senza una fonte unica di verità per motion e design token. Un'analisi preliminare del codice ha già trovato pattern concreti di divergenza: animazioni che rispettano il flag "riduci effetti" (`LocalReducedEffects`) e altre che no, più implementazioni indipendenti dello stesso "press feedback", raggi di bordo (`RoundedCornerShape`) e valori di alpha ripetuti come literal invece che come token condivisi, e differenze di stile fra mobile/tablet e TV non sempre giustificate. Questo piano è diviso in due fasi:

1. **Fase 1 — Animazioni**: controllo e correzione, **solo mobile + tablet** (esclude `app/src/main/java/com/streamo/app/ui/tv/`).
2. **Fase 2 — Coerenza di stile**: ricerca incongruenze di layout/stile su **tutti e tre** i form factor (mobile, tablet, TV).

Il modello che esegue questo piano deve trattare ogni punto come verifica-poi-fix: prima confermare il problema leggendo il file/riga citato (il codice può essere cambiato da quando è stata scritta questa analisi), poi applicare la correzione, poi verificare a runtime (build + comportamento visivo), non solo con `./gradlew assembleDebug`.

Percorsi di base: tutti i path sotto sono relativi a `app/src/main/java/com/streamo/app/` salvo indicazione diversa.

## Metodologia comune

Prima di ogni fase, ri-eseguire questi grep per confermare che i risultati dell'analisi preliminare siano ancora validi (il codice evolve):

```bash
# Fase 1 — animazioni fuori da ui/tv/
rg -n "animate\w*AsState|AnimatedVisibility|AnimatedContent|Crossfade|updateTransition|rememberInfiniteTransition|tween\(|spring\(|animateContentSize|LocalReducedEffects" app/src/main/java/com/streamo/app --glob '!ui/tv/**'

# Fase 2 — token di stile
rg -n "RoundedCornerShape\(" app/src/main/java/com/streamo/app
rg -n "\.copy\(alpha\s*=" app/src/main/java/com/streamo/app
rg -n "Haze|hazeEffect|hazeSource|GlassDefaults|blurRadius" app/src/main/java/com/streamo/app
```

Per ogni fix: leggere il file completo attorno alla riga citata (non fidarsi solo del numero di riga isolato), applicare la modifica minima, poi buildare:

```bash
./gradlew assembleDebug
```

Se la build fallisce dopo un rename o dopo aver toccato classi Hilt-annotated, riprovare con:

```bash
./gradlew clean assembleDebug
```

---

## Fase 1 — Audit animazioni (mobile + tablet)

### 1.1 Gating incoerente su "riduci effetti" (`LocalReducedEffects`)

Il pattern corretto già in uso in `ui/common/PressFeedback.kt:26-53` e in `navigation/AppNavHost.kt:50`: leggere `LocalReducedEffects`, e se attivo usare `snap()` (per `animate*AsState`) o `EnterTransition.None`/nessuna transizione (per `AnimatedVisibility`/`AnimatedContent`). I seguenti punti **non seguono questo pattern** e vanno allineati:

- `ui/home/HomeHero.kt:264-267` — `animateDpAsState` per la larghezza dell'indicatore pagina, senza `animationSpec` esplicito e senza check di `LocalReducedEffects`. Aggiungere `spring()`/`tween()` esplicito + fallback `snap()` quando reduced, sul modello di `PressFeedback.kt`.
- `ui/player/PlayerScreen.kt:563-566` (controlli show/hide), `:945-948` (badge WARP), `:982-985` (prompt skip/prossimo episodio) — tutti `AnimatedVisibility` con `fadeIn()/fadeOut()` bare, nessuna durata esplicita, nessun check reduced. Nello stesso file, righe `819-823` e `851-854` (seek thumb, bolla del tempo) **già** controllano `reducedEffects` con fallback `snap()` — usare questi due come riferimento per allineare gli altri quattro punti.
- `ui/player/PlayerScreen.kt:1236-1247` — `AnimatedContent` del pannello impostazioni (slide+fade `tween(220)`, `SizeTransform(clip=false){tween(220)}`), nessun check reduced.
- `ui/player/cast/CastPickerDialog.kt:146-166` — `AnimatedContent` master/detail (slide+fade `tween(220)` in entrambe le direzioni), nessun check reduced.
- `ui/downloads/DownloadsScreen.kt:655-659` (`SelectionCheckbox`) — `AnimatedVisibility(fadeIn()+expandHorizontally(), fadeOut()+shrinkHorizontally())` con spec di default, nessun check reduced. È anche l'unico punto mobile/tablet che combina `expand/shrink` con fade — se rimane l'unico caso dopo la verifica, va bene, ma va comunque gated su reduced.

**Fix**: per ciascuno, avvolgere l'animazione in un check `if (LocalReducedEffects.current) { /* snap/no-op */ } else { /* animazione con animationSpec esplicito */ }`, replicando lo stile già presente in `AppNavHost.kt:50` e `PressFeedback.kt:35-52`.

### 1.2 Frammentazione del "press feedback"

`ui/common/PressFeedback.kt` (file nuovo, non ancora tracciato in git) espone `rememberPressFeedback(interactionSource, pressedScale=0.94f, pressedElevation=12f, pressedTint=0.18f)` con tre `animateFloatAsState` (scale/elevation/tint), tutti su `spring()` con fallback `snap()` se reduced. È usato oggi **solo** da:
- `ui/common/MediaCard.kt:48,53-57,81`
- `ui/common/ProgressMediaCard.kt:66,71-75,97`

I seguenti componenti reimplementano la propria versione (spesso solo scala, senza elevazione/tint) invece di usare `PressFeedback`:

- `ui/common/SectionHeader.kt:38-50` — press scale indipendente (`spring(0.7,400)`, target 0.97).
- `ui/common/BrandButtons.kt:43-49,79-85,124-130` — tre bottoni (`BrandButton`, `BrandSecondaryButton`, `BrandIconButton`), ciascuno con la propria scala (`spring(0.7,400)`, target 0.96).
- `ui/home/HomeScreen.kt:444-450` (`AnimatedActionIcon`) — scala indipendente (`spring(0.4,300)`, target 0.82).
- `ui/common/SeasonChip.kt:29-44` — **nessun** feedback, solo `.clickable(onClick=onClick)` con ripple di default.
- `ui/common/Glass.kt:132-157` (`GlassFilterChip`) — solo ripple Material3 di default, nessuna scala/tint custom.
- `ui/settings/SettingsScreen.kt:311,334` e `ui/settings/AdvancedSettingsScreen.kt:196,249,303` — righe cliccabili (swatch colore accento, reset default) con `.clickable {}` bare.
- `ui/home/HomeHero.kt:274` — dot dell'indicatore pagina, `.clickable {}` bare.
- `ui/home/Top10Row.kt:84` — la `Row` che avvolge `MediaCard` è a sua volta `.clickable(onClick=onClick)`, quindi due click handler annidati con feedback potenzialmente diverso (quello di `MediaCard` via `PressFeedback`, quello del wrapper nessuno).

**Fix**:
1. Se `PressFeedback` non supporta ancora scala/elevazione/tint personalizzabili per casi come `AnimatedActionIcon` (target 0.82, spring diverso), estendere i parametri di `rememberPressFeedback` (già parametrizzati: `pressedScale`, `pressedElevation`, `pressedTint` — verificare che accettino override per-chiamante) invece di creare una nuova utility.
2. Migrare `SectionHeader.kt`, i tre bottoni in `BrandButtons.kt`, `AnimatedActionIcon` in `HomeScreen.kt` a `rememberPressFeedback(...)`.
3. Aggiungere `rememberPressFeedback` a `SeasonChip.kt`, alle righe cliccabili di `SettingsScreen.kt`/`AdvancedSettingsScreen.kt`, e al dot in `HomeHero.kt:274`. Per `GlassFilterChip` (`Glass.kt:132-157`), decidere caso per caso se il ripple Material3 di default è sufficiente (chip piccoli, densi) o se serve `PressFeedback` — verificare visivamente prima di cambiare.
4. In `Top10Row.kt:84`, rimuovere il click handler ridondante sul wrapper `Row` se il feedback visivo duplicato/conflittuale si nota a schermo, lasciando il feedback a `MediaCard`.

### 1.3 Famiglie di durata/easing incoerenti nella navigazione

`navigation/AppNavHost.kt` usa quattro combinazioni diverse di durata/easing per transizioni concettualmente simili ("naviga in avanti"):

- `:65-67,74-75,89-90,97-98` — cambio tab: `tween(300)`; push/pop non-tab: fade+slide-up `tween(260/220, FastOutSlowInEasing)`; pop-to-detail: `tween(350)`.
- `:151-152,159-160` — pop di sotto-rotte Anime/Detail: `fadeIn/fadeOut(tween(200))`.
- `:298-317` (`detailEnterTransition`/`detailExitTransition`) — scale+fade `tween(280)` in / `tween(220)` out, `FastOutSlowInEasing` in entrambe le direzioni. Condivisa correttamente fra Detail e AnimeDetail.

**Fix**: non unificare ciecamente. Proporre una piccola tabella di "categorie di transizione" (es. *cambio tab*, *push/pop standard*, *apertura dettaglio/modale*) con un'unica coppia durata/easing per categoria, poi convergere le durate isolate (200ms, 260ms, 350ms) sulla categoria corretta. Documentare la scelta con un commento breve nel file — è una decisione di design, non una pura normalizzazione meccanica.

### 1.4 Schermate senza alcuna animazione locale

Nessuna chiamata a `animate*/AnimatedVisibility/AnimatedContent/Crossfade` trovata in: `ui/detail/DetailScreen.kt`, `ui/anime/AnimeDetailScreen.kt` (corpo), `ui/search/SearchScreen.kt`, `ui/watchlist/WatchlistScreen.kt`, `ui/history/HistoryScreen.kt`, `ui/continuewatching/ContinueWatchingScreen.kt`, `ui/sectionlist/SectionListScreen.kt`, `ui/settings/SettingsScreen.kt`, `ui/settings/AdvancedSettingsScreen.kt`, `ui/settings/CacheManagementScreen.kt`, `ui/settings/LogViewerScreen.kt`, `ui/downloads/SeriesDownloadsScreen.kt`.

**Fix**: non è un obbligo aggiungere motion ovunque. Per ciascuna schermata, verificare a runtime se un cambio di stato (loading→loaded, lista vuota→popolata, cambio ordinamento/filtro, errore) fa un "pop" istantaneo mentre una schermata sorella (Home, Player) animerebbe lo stesso tipo di cambio. Segnalare come candidati `AnimatedContent`/`animateContentSize` solo dove lo scatto è visibilmente brusco rispetto alle altre schermate, non aggiungere motion "per simmetria".

### 1.5 Nota strutturale (non bloccante per la fase 1, ma impatta il codice di animazione)

- `navigation/GlassBottomBar.kt:105-152` (crossfade colore tab, `tween(200)`) e `navigation/TabletRootView.kt:316-320` (stesso crossfade per la rail, stesso `tween(200)`) sono due implementazioni indipendenti dello stesso comportamento. Estrarre in una funzione condivisa per evitare che le due copie divergano in futuro.
- `navigation/RootTabView.kt:187-277` e `navigation/TabletRootView.kt:419-509` duplicano quasi verbatim il composable `CastBanner` (stesso padding, stessa logica enter/exit). Stesso discorso: estrarre in un composable condiviso.

---

## Fase 2 — Audit coerenza di stile (mobile, tablet, TV)

### 2.1 Assenza di un file di token in `ui/theme/`

`ui/theme/` contiene solo `Color.kt`, `Theme.kt`, `Type.kt` — **nessun `Shape.kt`**, e `MaterialTheme(...)` in `Theme.kt:61-65` viene chiamato senza il parametro `shapes:`. Di conseguenza ogni schermata usa `RoundedCornerShape(Xdp)` come literal ad-hoc. Valori distinti trovati (non esaustivo): `2dp`, `5dp`, `6dp`, `8dp`, `9dp` (solo TV), `10dp`, `12dp`, `14dp`, `24dp`, `28dp`, `50%` (pillola) — vedi occorrenze in `common/MediaCard.kt`, `common/ProgressMediaCard.kt`, `common/SeasonChip.kt`, `common/SectionHeader.kt`, `detail/DetailScreen.kt`, `anime/AnimeDetailScreen.kt`, `anime/AnimeScreen.kt`, `downloads/DownloadsScreen.kt`, `downloads/SeriesDownloadsScreen.kt`, `search/SearchScreen.kt`, `settings/SettingsScreen.kt`, `settings/AdvancedSettingsScreen.kt`, `player/PlayerScreen.kt`, `player/cast/CastPickerDialog.kt`.

Inoltre due costanti "ufficiali" duplicano lo stesso valore in modo indipendente:
- `ui/common/Glass.kt:65` — `GlassDefaults.Shape = RoundedCornerShape(14.dp)`
- `ui/common/BrandButtons.kt:30` — `BrandButtonDefaults.Shape = RoundedCornerShape(14.dp)`

**Fix**:
1. Creare `ui/theme/Shape.kt` con una scala di raggi coerente coi cluster di valori già in uso (es. `xs=6.dp, sm=8.dp, md=10.dp, lg=14.dp, xl=24.dp, pill=CircleShape/50%`).
2. Far riferire `BrandButtonDefaults.Shape` alla stessa costante di `GlassDefaults.Shape` (o al nuovo token in `Shape.kt`) invece di duplicare `14.dp`.
3. Sostituire i literal `RoundedCornerShape(Xdp)` nei file elencati sopra con i nuovi token **solo** dove il valore combacia o è così vicino da essere chiaramente lo stesso intento visivo — non normalizzare valori diversi solo per ridurne il conteggio. Confermare ogni sostituzione con verifica visiva (screenshot prima/dopo) perché cambia l'aspetto a schermo.

### 2.2 Sprawl della scala di alpha

Valori di `.copy(alpha = ...)` trovati sparsi senza token condiviso: `8%` (`GlassDefaults.Container`), `12%` (evidenziazione fuoco TV, `ui/tv/settings/TvSettingsScreen.kt`), `15%` (`navigation/TabletRootView.kt:357`, indicatore selezionato della rail), `22%` (`navigation/GlassBottomBar.kt:139`, pillola tab selezionata), `60%` (`navigation/GlassBottomBar.kt:149`, testo tab non selezionato), più `65%/70%/78%/86%` in vari punti di dialoghi/TV.

**Fix**: definire un piccolo oggetto `AlphaTokens` (es. `containerLow=0.08f`, `containerSelected=0.22f`, `textMuted=0.60f`, `focusHighlight=0.12f`) in `ui/theme/` o `ui/common/`, poi migrare `GlassBottomBar.kt:139,149`, `Glass.kt` (`GlassDefaults.Container`), `TabletRootView.kt:357`, `TvSettingsScreen.kt` (tint di focus) a riferire i token. Dove due valori "vicini" rappresentano lo stesso concetto (es. rail al 15% vs pillola al 22% per "tab selezionato") decidere quale diventa il canonico tramite confronto visivo diretto, non sostituzione meccanica.

### 2.3 Raggio di blur (Haze) incoerente

- `ui/common/GlassTopBar.kt:99` — capsule/topbar: `blurRadius = 24.dp`.
- `ui/common/GlassDialog.kt:349` — dialoghi: `blurRadius = 36.dp`.

**Fix**: introdurre costanti esplicite (es. `GlassDefaults.BlurRadiusChrome = 24.dp`, `GlassDefaults.BlurRadiusDialog = 36.dp`) invece dei numeri magici. Ri-grepppare `blurRadius`/`hazeEffect` su tutto il progetto (incluso `player/PlayerScreen.kt:806,866` che ha il proprio `playerHazeState`) per verificare che non esista un terzo valore isolato non censito qui.

### 2.4 Schermate che aggirano lo scaffold vetro condiviso

- `ui/detail/DetailScreen.kt:173,197,200` — usa `GlassTopBar` direttamente con un proprio `HazeState` (`detailHaze`) e un overlay custom per il titolo collassante, invece di `GlassTopBarScaffold` (usato da `HomeScreen.kt:110`, `WatchlistScreen.kt:57`, `ContinueWatchingScreen.kt:59`, `SettingsScreen.kt:247`, `CacheManagementScreen.kt:100`, `HistoryScreen.kt:72`, `AdvancedSettingsScreen.kt:138`, `DownloadsScreen.kt:119`, `SeriesDownloadsScreen.kt:126`, `SectionListScreen.kt:71`, `AnimeScreen.kt:78`, `AnimeDetailScreen.kt:69`).
- `ui/settings/LogViewerScreen.kt:60` — usa un `TopAppBar` Material3 semplice, senza alcun effetto vetro, unica schermata dell'area settings a farlo.

**Fix**: valutare se `DetailScreen.kt` può migrare a `GlassTopBarScaffold` senza perdere il comportamento di titolo collassante custom; se non è possibile, documentare nel codice perché diverge. Per `LogViewerScreen.kt`, allineare a `GlassTopBarScaffold` come le altre schermate settings, a meno che l'esclusione sia intenzionale (es. per performance su una schermata log-intensive) — in tal caso documentarlo con un commento breve.

### 2.5 Schermate tablet che non usano i token responsive

`ui/common/WindowSize.kt:14-70` espone `LocalWindowSizeClass` con `isTablet`, `isLandscapeTablet`, `isPortraitTablet`, `cardWidth`, `contentPadding`, `itemSpacing` (keyed su `WindowWidthSizeClass`: Compact/Medium/Expanded → 140/150/180dp larghezza, 16/20/32dp padding, 14/16/20dp spacing). Già usato da `HomeScreen.kt`, `AnimeScreen.kt`, `DetailScreen.kt`, `SearchScreen.kt`, `WatchlistScreen.kt`, `HistoryScreen.kt`, `DownloadsScreen.kt`, `CacheManagementScreen.kt`.

**Assenti** (probabilmente renderizzano identici a mobile anche su tablet): `ui/anime/AnimeDetailScreen.kt`, `ui/downloads/SeriesDownloadsScreen.kt`, `ui/continuewatching/ContinueWatchingScreen.kt`, `ui/sectionlist/SectionListScreen.kt`, `ui/settings/SettingsScreen.kt`, `ui/settings/AdvancedSettingsScreen.kt`.

**Fix**: aprire ciascuna schermata su un emulatore tablet (window Expanded/Medium, portrait e landscape) e verificare se il contenuto appare troppo stretto/mal distribuito rispetto alle schermate che già usano i token. Se sì, adattare con gli stessi extension property di `WindowSize.kt` usati dalle schermate sorelle equivalenti.

### 2.6 Divergenze mobile/tablet vs TV — confermare intenzionali o accidentali

- **Vetro/Haze assente su TV**: grep confermato zero occorrenze di `Haze|hazeEffect|hazeSource|GlassDefaults` sotto `ui/tv/`. TV sostituisce con superfici piatte/solid + focus ring. Verificare che sia una scelta di design deliberata (UI a 10 piedi tipicamente evita blur pesante) — se confermato, aggiungere un commento nel codice TV che lo dichiari esplicitamente, per evitare che un futuro contributor lo "corregga" per errore.
- **Dialogo TV vs dialogo mobile**: `ui/tv/settings/TvSettingsScreen.kt:437-438` — `Dialog` con `.clip(RoundedCornerShape(16.dp)).background(Color(0xFF1A1A1A))`, colore literal, nessun bordo, nessun vetro. Confronta con `ui/common/GlassDialog.kt` — `GlassDefaults.Shape` (14dp) + bordo (`GlassDefaults.Border`). Allineare almeno il raggio (16dp → 14dp) e sostituire il literal `0xFF1A1A1A` con `DarkSurface`/`DarkSurfaceVariant` da `ui/theme/Color.kt` se il colore corrisponde.
- **Trattamento azione distruttiva**: `TvSettingsScreen.kt:163` riempie l'intero bottone col colore `error` (focused: `error`, non-focused: `error@70%`); `ui/common/GlassDialog.kt:200-222` (`GlassDialogDestructiveButton`) mantiene il contenitore vetro e tinge solo il testo con `error`. Decidere se è un divario intenzionale (TV necessita segnale di focus più forte) — se sì, documentarlo esplicitamente nel report finale come "verificato e intenzionale" invece di lasciarlo come incongruenza aperta.
- **Tint di evidenziazione focus**: `TvSettingsScreen.kt` usa `White@12%` per righe in focus vs `GlassDefaults.Container` (`White@8%`) per il concetto equivalente lato mobile. Allineare al token comune (vedi §2.2) a meno che la leggibilità a distanza richieda deliberatamente un valore più alto.
- **Padding di navigazione**: `ui/tv/TvRootView.kt:146-150` (drawer: `16/32/16dp`, `spacedBy(14dp)`) vs `navigation/GlassBottomBar.kt:120-123` (`12dp/6dp`) vs `navigation/TabletRootView.kt:303,307` (rail: `8dp/4dp`). Non necessariamente un errore (componenti diversi), ma confermare che ogni valore sia una scelta deliberata e non deriva da copia-incolla; convergere dove rappresentano lo stesso concetto.
- **Colore hardcoded del brand**: `Theme.kt:38-50` (`AppTheme`) sovrascrive `primary`/`primaryContainer`/`onPrimaryContainer` in base all'accento scelto dall'utente nelle Impostazioni — quindi `MaterialTheme.colorScheme.primary` **non è sempre** `BrandRed` (`0xFFE50914`). Grep su tutto il progetto (inclusi `ui/tv/`) per `0xFFE50914`/`BrandRed` usati fuori da `ui/theme/`: qualunque componente che hardcoda questo colore invece di leggere `MaterialTheme.colorScheme.primary` rompe la funzione di colore accento personalizzabile. Correggere ogni occorrenza trovata.

---

## Criteri di accettazione

- `./gradlew assembleDebug` passa dopo ogni gruppo di modifiche (non solo alla fine).
- Verifica visiva manuale su:
  - emulatore/telefono (layout mobile, `RootTabView`)
  - emulatore tablet, sia portrait (`TabletPortraitShell`) sia landscape (`TabletLandscapeShell`)
  - emulatore Android TV (`TvRootView`)
- Ri-eseguire i grep della sezione "Metodologia comune" a fine fase 1 e conferma che non restino `AnimatedVisibility`/`animate*AsState` fuori da `ui/tv/` privi di gating su `LocalReducedEffects`, salvo eccezioni esplicitamente documentate con commento nel codice.
- Dopo qualunque consolidamento di token (raggi, alpha, blur), confrontare screenshot prima/dopo per ogni schermata toccata — nessuna modifica di token deve alterare silenziosamente l'aspetto visivo senza che sia stata verificata.
- Verificare che il selettore di colore accento in Impostazioni continui a funzionare (nessun componente hardcoda `BrandRed`/`0xFFE50914` al posto di `MaterialTheme.colorScheme.primary`).
- Il report finale deve elencare, per ogni punto delle sezioni 1.1–1.5 e 2.1–2.6: stato (corretto / verificato-intenzionale-non-serve-fix / non riproducibile), file:riga toccati, e come è stato verificato a runtime.

## Fuori scope

- Audit interno alle animazioni di focus TV (`ui/tv/common/TvFocusModifiers.kt`, `TvMediaCard.kt`, `TvProgressMediaCard.kt`, `TvSectionRow.kt`, tutte su `tween(150-200ms)`) — la fase 1 copre solo mobile/tablet; un'eventuale coerenza interna alle animazioni TV è un possibile follow-up, non incluso qui.
- Non aggiungere nuove animazioni "per simmetria" alle schermate elencate in §1.4 se il cambio di stato non risulta visibilmente brusco a verifica manuale.
