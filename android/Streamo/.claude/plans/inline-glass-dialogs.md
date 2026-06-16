# Piano: Modali glass con blur reale (inline overlay)

## Obiettivo
Sostituire le modali `GlassDialog`/`GlassAlertDialog` attuali (finestra Compose separata, vetro piatto) con overlay inline che condividano la `hazeSource` dello screen e ottengano il blur reale come la navbar in basso.

## Vincoli tecnici
1. `androidx.compose.ui.window.Dialog` crea una finestra separata: non può leggere la `hazeSource` dell'app, quindi niente blur.
2. Haze richiede che l'elemento con `hazeEffect` sia **fratello** della `hazeSource`, non dentro di essa; altrimenti si ottiene un crash RenderThread/SIGSEGV (vedi memory "Haze nested-source SIGSEGV").
3. Le modali devono comunque bloccare l'interazione con lo screen sottostante, gestire back press e tap fuori.

## Soluzione scelta
- `GlassDialog` diventa un overlay full-screen inline (no `Dialog`).
- Lo sfondo (scrim) applica `hazeEffect` sul `HazeState` dello screen: così **tutto lo sfondo diventa sfocato** (stesso effetto vetro della navbar, ma a tutto schermo).
- La card della modale rimane glass flat con bordo sottile e tinta scura, perché sopra lo scrim sfocato non c'è più contenuto da sfocare.
- Ogni screen passa il `HazeState` corretto e posiziona la modale **fuori** dal proprio `hazeSource`.

## File coinvolti

### 1. `ui/common/GlassDialog.kt`
- Rimuovere `Dialog`/`DialogProperties`.
- Aggiungere import Haze (`HazeState`, `hazeEffect`, `HazeTint`).
- `GlassDialog(hazeState: HazeState?, onDismissRequest, modifier, content)`:
  - `Box` full-screen con `pointerInput` per dismiss al tap fuori.
  - Scrim: se `hazeState != null` e non reduced → `hazeEffect` + overlay nero `alpha=0.55`; altrimenti overlay nero `alpha=0.72`.
  - `BackHandler` per chiudere con back.
  - Card centrata che intercetta i tocchi per non dismissare.
- `GlassAlertDialog` accetta e inoltra `hazeState` a `GlassDialog`.

### 2. `ui/common/GlassTopBarScaffold.kt`
- Aggiungere parametro opzionale `overlay: @Composable BoxScope.(topPadding: Dp) -> Unit = {}`.
- Il `overlay` viene disegnato **dopo** la top bar, fuori dalla `hazeSource` locale del contenuto.
- Esporre `LocalHazeState` locale dello scaffold? No: per semplicità gli screen useranno il root `LocalHazeState.current`; se un giorno servirà si può aggiungere.

### 3. Schermate con `GlassTopBarScaffold`
Spostare tutte le chiamate `GlassAlertDialog`/`DownloadQualityDialog`/`CastPickerDialog` fuori dal blocco `content` dello scaffold (o dentro il nuovo `overlay`), così sono fratelle della `hazeSource` locale/root.

File:
- `ui/home/HomeScreen.kt`
- `ui/downloads/DownloadsScreen.kt`
- `ui/downloads/SeriesDownloadsScreen.kt`
- `ui/continuewatching/ContinueWatchingScreen.kt`
- `ui/settings/SettingsScreen.kt`
- `ui/settings/AdvancedSettingsScreen.kt`

### 4. Schermate con `hazeSource` locale
Spostare le modali fuori dal `Box` che definisce il `hazeState` locale e passare quel `hazeState` alle modali.

File:
- `ui/detail/DetailScreen.kt` (usa `detailHaze`)
- `ui/player/PlayerScreen.kt` (usa `playerHazeState`)

### 5. Dialog wrapper
- `ui/downloads/DownloadQualityDialog.kt`: aggiungere parametro `hazeState` e inoltrarlo a `GlassAlertDialog`.
- `ui/player/cast/CastPickerDialog.kt`: aggiungere parametro `hazeState` e inoltrarlo a `GlassAlertDialog`.

## Passaggi
1. Modificare `GlassDialog.kt` con il nuovo overlay inline.
2. Aggiungere `overlay` slot a `GlassTopBarScaffold.kt` (facoltativo, utile per chi preferisce tenere lo stato dentro content).
3. Per ogni screen, spostare le modali fuori dalla `hazeSource` e passare il `HazeState` corretto.
4. Aggiornare `CastPickerDialog` e `DownloadQualityDialog` per accettare `hazeState`.
5. Verificare la build con `./gradlew :app:compileDebugKotlin` (o `clean assembleDebug` se Hilt/KSP si lamenta).

## Rischi / considerazioni
- Se una modale viene lasciata dentro una `hazeSource`, con `hazeEffect` otterremmo il crash SIGSEGV. Verificherò la topologia in ogni file.
- Lo scrim sfocato oscura e sfoca tutto lo sfondo, non solo l'area attorno alla card; questo è coerente con il comportamento standard delle modali iOS/macOS.
- TV: `TvRootView` non fornisce `LocalHazeState`. In quel caso le modali faranno fallback a scrim scuro piatto, che è accettabile.
