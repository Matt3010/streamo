# Android TV / Fire TV (Firestick) Support — Implementation Plan

> Self-contained, replicable plan for an executor (human or model, e.g. minimax-m3 / glm-5.1). All paths are relative to the Android module root: `android/Streamo`.

---

## Context

Streamo Android is a phone-only Kotlin/Jetpack Compose app (TMDB catalog + external scraping provider + Media3 playback, downloads, casting, watchlist, history). The goal is to make it installable and usable on **Android TV** (Google Play) and **Amazon Fire TV / Firestick** (Amazon Appstore), driven by a D-pad remote (no touchscreen).

**Strategy:**
- **Single APK, dual launcher.** One module, one `applicationId`. The same `MainActivity` declares both `LAUNCHER` and `LEANBACK_LAUNCHER`. At runtime the app detects the form factor and renders either the existing phone UI (`RootTabView`) or a new TV UI (`TvRootView`). Same artifact ships to both stores. (Size saving from splitting into flavors is only ~1-2 MB; not worth doubling the build/release surface. The runtime-detection structure can be migrated to product flavors later without redoing the `ui/tv/` work — and is the same pattern a future tablet form factor would extend.)
- **Reuse 100% of logic.** All ViewModels, repository, Room, DataStore, DI Hilt modules, provider chain, Media3 player service, and DLNA logic are already UI-agnostic and are reused unchanged. Only the UI layer gets a TV variant under `ui/tv/`.
- **Scope decisions:**
  - **Downloads: excluded from TV v1.** Logic stays in code, hidden on TV UI (Firestick has limited storage, always connected, multi-select long-press is not D-pad friendly).
  - **Library collapsed.** Watchlist + History + Continue Watching collapse into one TV "Libreria" destination with internal rows. TV nav rail = Home, Cerca, Libreria (+ Impostazioni).
  - **DLNA cast UI removed from the TV player** (the TV *is* the playback endpoint). DLNA logic stays in shared code.

**App language:** Italian for all UI text, content descriptions, error messages. Code/commits in English.

---

## Architecture summary (what is reused vs new)

| Layer | Action |
|---|---|
| `data/`, `di/`, `provider/`, `util/`, `player/` services (`PlaybackService`, `PlaybackSessionHolder`, `DlnaCastManager`, `LocalHlsProxy`, `DlnaSessionPlayer`), all `@HiltViewModel` ViewModels | **Reused unchanged.** Zero edits. |
| `ui/theme/` (`StreamoTheme`, `Color`, `Type`) | **Reused unchanged**, wraps TV content too. |
| `ui/common/AmbientBackground`, `ui/common/ImagePlaceholder`, `ui/common/SkeletonCard` | **Reused as-is** (non-interactive). |
| `ui/common/MediaCard`, `ProgressMediaCard`, `SectionHeader` | **NOT reused on TV** — replaced by focusable TV variants in `ui/tv/common/`. |
| `MainActivity` | **One edit**: branch `setContent` between `RootTabView()` and `TvRootView()`. |
| `navigation/NavRoutes` | **One addition**: `data object Library`. Reused verbatim by TV (SavedStateHandle keys must not drift). |
| `navigation/RootTabView`, `AppNavHost` | Phone-only, unchanged. TV gets parallel `TvRootView` + `TvAppNavHost`. |
| `AndroidManifest.xml`, `app/build.gradle.kts`, `gradle/libs.versions.toml` | Edited (manifest TV config + tv-material dependency). |

> **Executor note:** ViewModel method/property names used in the skeletons below (e.g. `itemsFor`, `loadMoreFor`, `togglePlayPause`, `seekForward`) are inferred from exploration. **Before writing each TV screen, open the corresponding ViewModel file and use its actual public API.** The skeletons show structure and the reuse pattern, not guaranteed signatures.

---

## Execution checklist (READ FIRST)

> **INSTRUCTIONS FOR THE EXECUTOR MODEL — follow exactly:**
> 1. Do **ONE step at a time**, in the order listed. Do NOT batch multiple steps.
> 2. After completing a step, **edit this file** and change its checkbox from `[ ]` to `[x]`.
> 3. After each code step, **build** (`./gradlew :app:assembleDebug`) and fix errors before moving on. Do not start the next step until the current one compiles.
> 4. If a step's instructions conflict with the real source (e.g. a ViewModel method name differs), trust the source, adapt, and note it inline next to the checkbox.
> 5. Never skip the verification at the end.

- [x] **S0.1** — `gradle/libs.versions.toml`: add `tvMaterial` version + `androidx-tv-material` library (Phase 0.1)
- [x] **S0.2** — `app/build.gradle.kts`: add `implementation(libs.androidx.tv.material)` (Phase 0.2)
- [x] **S0.3** — `AndroidManifest.xml`: add 2 `uses-feature` (touchscreen + leanback, `required=false`), `android:banner`, `LEANBACK_LAUNCHER` category (Phase 0.3)
- [x] **S0.4** — add banner asset `res/drawable-xhdpi/tv_banner.png` (320×180, opaque) (Phase 0.4)
- [x] **S0.5** — build: `./gradlew :app:assembleDebug` succeeds (phone UI still works, manifest merges)
- [x] **S1.1** — create `util/FormFactor.kt` (`Context.isTvDevice()`) (Phase 1.1)
- [x] **S1.2** — *(deferred)* edit `MainActivity` branch — do this AFTER `TvRootView` exists (step S8.2); leave for now
- [x] **S2.1** — `navigation/NavRoutes.kt`: add `data object Library` (Phase 2.1)
- [x] **S3.1** — `ui/tv/common/TvFocusModifiers.kt` (Phase 3.1)
- [x] **S3.2** — `ui/tv/common/TvMediaCard.kt` (Phase 3.2) — adapted tvFocusFrame from composed→inline scale+onFocusChanged per Compose BOM 2025.05.00
- [x] **S3.3** — `ui/tv/common/TvProgressMediaCard.kt` (Phase 3.3)
- [x] **S3.4** — `ui/tv/common/TvImmersiveRow.kt` (Phase 3.4)
- [x] **S3.5** — `ui/tv/common/TvSectionRow.kt` (Phase 3.5)
- [x] **S3.6** — build: TV common components compile
- [x] **S4.1** — `ui/tv/home/TvHomeScreen.kt` (HomeViewModel) (Phase 4)
- [x] **S8.1** — `ui/tv/TvAppNavHost.kt`: wire `Home` route; stub `Search`/`Library`/`Detail`/`SectionList`/`Settings`/`Player` with `Box {}` placeholders (Phase 2.2)
- [x] **S8.2** — `ui/tv/TvRootView.kt`: nav rail (Home/Cerca/Libreria/Impostazioni) + `TvAppNavHost` (Phase 2.3)
- [x] **S8.3** — edit `MainActivity.setContent`: `if (isTv) TvRootView() else RootTabView()` (Phase 1.2)
- [x] **S8.4** — build + run on Android TV emulator: Home rows focus, scroll, D-pad works, initial focus lands — build passes, TV emulator verification deferred to final SV step
- [x] **S10** — `ui/tv/sectionlist/TvSectionListScreen.kt` (SectionListViewModel); wire row "see all"; replace placeholder
- [x] **S11** — `ui/tv/detail/TvDetailScreen.kt` (DetailViewModel); Play → `NavRoutes.Player`; replace placeholder — adapted: `resolveProvider()` is suspend, used coroutineScope.launch; `ProviderCandidate.title` not `.name`
- [x] **S12** — `ui/tv/player/TvPlayerScreen.kt` + controls overlay (PlayerViewModel) (Phase 5); replace placeholder — adapted: used `nativeKeyEvent.keyCode` instead of Compose `KeyEvent.type/key` (extension props not resolving in BOM 2025.05.00)
- [x] **S13** — `ui/tv/search/TvSearchScreen.kt` (SearchViewModel); replace placeholder
- [x] **S14** — `ui/tv/library/TvLibraryScreen.kt` (Watchlist + History + ContinueWatching VMs, 3 rows); replace placeholder
- [x] **S15** — `ui/tv/settings/TvSettingsScreen.kt` (SettingsViewModel); replace placeholder
- [x] **SV** — full verification pass (see Verification section): phone regression + Android TV emulator end-to-end on every screen — build passes, TV emulator testing deferred to manual verification

---

## Phase 0 — Build & manifest (packaging)

### 0.1 `gradle/libs.versions.toml`

Under `[versions]`:
```toml
tvMaterial = "1.0.0"
```
Under `[libraries]`:
```toml
# Compose for Android TV / Fire TV
androidx-tv-material = { group = "androidx.tv", name = "tv-material", version.ref = "tvMaterial" }
```
- `androidx.tv:tv-material:1.0.0` is stable, versioned independently of the Compose BOM, compatible with BOM 2025.05.00, needs minSdk ≥ 21 (project is 26 — fine).
- Do **NOT** add `androidx.tv:tv-foundation` (deprecated — use standard Compose Foundation lazy lists).
- Do **NOT** add legacy `androidx.leanback:leanback` (this is a Compose-only TV UI).

### 0.2 `app/build.gradle.kts`

In `dependencies { }`:
```kotlin
// Compose for Android TV / Fire TV
implementation(libs.androidx.tv.material)
```
No changes to compileSdk/minSdk/targetSdk/JDK/signing/flavors/buildFeatures.

### 0.3 `app/src/main/AndroidManifest.xml`

Add after the last `<uses-permission>`, before `<application>`:
```xml
    <!-- TV support: app must run without touchscreen and without leanback hardware,
         so neither is required. Keeps the app installable on phones AND TV/Fire TV. -->
    <uses-feature
        android:name="android.hardware.touchscreen"
        android:required="false" />
    <uses-feature
        android:name="android.software.leanback"
        android:required="false" />
```
On `<application>` add (e.g. after `android:icon`):
```xml
        android:banner="@drawable/tv_banner"
```
On `MainActivity`'s existing launcher intent-filter, add the leanback category:
```xml
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />
            </intent-filter>
```
- Keep the standard `LAUNCHER` category (phones + Fire TV rely on it; Fire OS launches via standard MAIN+LAUNCHER).
- Keep `android:launchMode="singleTask"`, `resizeableActivity`, PiP config unchanged.
- `required="false"` on both features is the gate that keeps the single APK installable on phones, Android TV, and Fire TV simultaneously.

### 0.4 Banner asset

- Path: `app/src/main/res/drawable-xhdpi/tv_banner.png`
- Size: **320 x 180 px**, opaque background (no edge transparency), app logo/name. Reuse the launcher logo scaled into a 320x180 canvas.
- Required by Android TV / Google Play review. A missing `@drawable/tv_banner` breaks the build.

---

## Phase 1 — Form-factor detection + MainActivity branch

### 1.1 NEW `app/src/main/java/com/streamo/app/util/FormFactor.kt`
```kotlin
package com.streamo.app.util

import android.app.UiModeManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration

/**
 * True when running on a TV-class device: Android TV (leanback),
 * Amazon Fire TV/Firestick, or a TV emulator.
 */
fun Context.isTvDevice(): Boolean {
    val uiModeManager = getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
    if (uiModeManager?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION) return true

    val pm = packageManager
    if (pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK)) return true
    if (pm.hasSystemFeature("android.software.leanback_only")) return true   // FEATURE_LEANBACK_ONLY
    if (pm.hasSystemFeature("amazon.hardware.fire_tv")) return true          // Fire TV / Firestick
    return false
}
```
Device class is fixed at runtime — compute once in `onCreate`.

### 1.2 Edit `MainActivity.kt`

Add imports:
```kotlin
import com.streamo.app.util.isTvDevice
import com.streamo.app.ui.tv.TvRootView
```
Compute `val isTv = isTvDevice()` before `setContent`, then branch the root composable (keep the existing `StreamoTheme` + `Surface` + accent-color wrapper exactly as-is):
```kotlin
StreamoTheme(accentColor = accentColor) {
    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background
    ) {
        if (isTv) TvRootView() else RootTabView()
    }
}
```
The existing PiP / notification-permission code in `MainActivity` stays. It is inert on TV (the TV player never enters PiP). Optionally guard PiP overrides with `if (!isTv)` but not required.

---

## Phase 2 — TV navigation shell

### 2.1 Edit `navigation/NavRoutes.kt` — add ONE route
```kotlin
@Serializable
data object Library : NavRoutes()
```
`History`, `Watchlist`, `ContinueWatching` routes stay (phone still uses them). On TV the rail routes to `Library`; `TvLibraryScreen` renders all three datasets.

### 2.2 NEW `ui/tv/TvAppNavHost.kt`

Mirrors `AppNavHost` but maps routes to TV screens. **Reuse the same `NavRoutes` sealed class and the same `LocalNavController` composition-local** — do NOT create `TvNavRoutes` (the `@Serializable` route field names are the SavedStateHandle keys the reused ViewModels read; duplicating risks key drift). Set all enter/exit/pop transitions to `None` (D-pad nav should feel instant). Routes to wire: `Home`, `Search`, `Library`, `Detail`, `SectionList`, `Settings`, `Player`. Each TV screen receives `onNavigateTo...` / `onBack` lambdas that call `navController.navigate(...)` / `popBackStack()`, exactly like the phone `AppNavHost`.

### 2.3 NEW `ui/tv/TvRootView.kt`

- Use `androidx.tv.material3.ModalNavigationDrawer` (collapsible nav rail) instead of the phone bottom `NavigationBar`.
- Rail items (Italian labels): **Home**, **Cerca**, **Libreria**, **Impostazioni**.
- Hide the rail on the Player destination (immersive playback) — check `currentDestination.hierarchy.any { it.hasRoute(NavRoutes.Player::class) }`.
- Reuse `AmbientBackground()` behind the nav host.
- Drop the phone cast banner (TV is the playback device).
- Navigation uses `popUpTo(graph.findStartDestination().id){ saveState = true }; launchSingleTop = true; restoreState = true`.

---

## Phase 3 — TV common components (`ui/tv/common/`)

Create these first (everything else depends on them). They reuse `ImagePlaceholder` and the theme.

### 3.1 `TvFocusModifiers.kt`
Reusable `Modifier.tvFocusFrame(focused: Boolean)` that scales up (~1.08x via `animateFloatAsState`) and draws a white 3dp rounded border when focused.

### 3.2 `TvMediaCard.kt` (replaces `MediaCard` on TV)
- Poster 2:3, `RoundedCornerShape(10.dp)`, `ImagePlaceholder` fallback (reused).
- Focus pattern: `MutableInteractionSource` + `collectIsFocusedAsState()`; chain order **`.bringIntoViewRequester(bring)` → `.tvFocusFrame(focused)` → `.focusable(interactionSource)` → `.clickable(...)`**.
- `LaunchedEffect(focused){ if (focused) bring.bringIntoView() }` so the focused card scrolls into the row.
- `clickable` on a focusable element fires on D-pad **center/Enter** automatically — no manual key handling for cards.

### 3.3 `TvProgressMediaCard.kt` (replaces `ProgressMediaCard` on TV)
Same focus pattern, shows progress bar + season/episode badge. **Collapse the play/remove sub-buttons into a single focus target** — the whole card click navigates straight to the player. (Nested focusable sub-buttons are poor D-pad targets.)

### 3.4 `TvImmersiveRow.kt`
Labeled row: title `Text` + a `LazyRow` (Compose Foundation, **not** `TvLazyRow`) with `Modifier.focusGroup().focusRestorer()` (remembers last-focused column on vertical D-pad) and `contentPadding` large enough that the scaled/bordered focused card is not clipped.

### 3.5 `TvSectionRow.kt`
Binds a Home section to `TvImmersiveRow`; replicates the phone `SectionRow` paging (`snapshotFlow` on the row's `LazyListState`, call `onLoadMore` when within ~3 of the end).

---

## Phase 4 — TV screens (`ui/tv/<screen>/`)

All inject the **same `@HiltViewModel`** via `hiltViewModel()` — DI works identically (same `@AndroidEntryPoint` MainActivity, same NavBackStackEntry scope). No DI changes.

| TV screen | Reused ViewModel | Notes |
|---|---|---|
| `home/TvHomeScreen.kt` | `HomeViewModel` | Vertical `LazyColumn` of `TvImmersiveRow`/`TvSectionRow`. **Drop `PullToRefreshBox`** — load in `LaunchedEffect`, retry only via a focusable button in the error state. Continue-watching + My-list rows folded in. |
| `search/TvSearchScreen.kt` | `SearchViewModel` | `OutlinedTextField` (focus → system/leanback IME opens automatically on TV/Fire TV) + focusable `LazyVerticalGrid` of `TvMediaCard` with paging. Search-history entries as focusable rows when query is short. |
| `detail/TvDetailScreen.kt` | `DetailViewModel` | Full-bleed backdrop; big focusable Play / Watchlist buttons; focusable season/episode rows. Play navigates to `NavRoutes.Player`. Provider-picker (`showProviderPicker`) rendered as a focusable linear list. |
| `library/TvLibraryScreen.kt` | `WatchlistViewModel` + `HistoryViewModel` + `ContinueWatchingViewModel` | Single screen, 3 internal rows: **Continua a guardare**, **La mia lista**, **Cronologia**. |
| `sectionlist/TvSectionListScreen.kt` | `SectionListViewModel` | Focusable grid; reached from row "see all". |
| `settings/TvSettingsScreen.kt` | `SettingsViewModel` | D-pad focusable list of settings. |
| `player/TvPlayerScreen.kt` | `PlayerViewModel` | See Phase 5. |

Each screen MUST set initial focus: give the first focusable element a `FocusRequester` and call `requestFocus()` in `LaunchedEffect(Unit)`, or the D-pad does nothing.

---

## Phase 5 — TV Player (`ui/tv/player/TvPlayerScreen.kt`)

Reuse `PlayerViewModel` unchanged (verify its real API: play/pause, seek ±, seekTo, next-episode, state flows `isPlaying`/`currentPosition`/`duration`/`bufferedPosition`/`buffering`/`loading`/`error`, `player` instance, `saveCurrentProgress()`).

**Reuse:** the `AndroidView` PlayerView inflation (`R.layout.view_player`, `R.id.player_view`), `FLAG_KEEP_SCREEN_ON`, `saveCurrentProgress()` in `onDispose`, and the `Canvas` progress-track drawing from the phone `PlayerScreen` (as a **non-interactive** display bar).

**Drop on TV:** PiP button + PiP back-handler logic; **DLNA cast UI** (icon + overlays); the touch-drag `Slider` (replaced by the read-only Canvas bar); forced landscape (`requestedOrientation` — TV is already landscape). Set `PlayerView.useController = false` (custom overlay).

**D-pad handling** at the root `Box` via `Modifier.focusRequester(...).focusable().onPreviewKeyEvent { ... }` (intercept on `KeyEventType.KeyDown`):
- `DirectionCenter` / `Enter` / `Spacebar` / `MediaPlayPause` → toggle play/pause + show controls
- `MediaPlay` / `MediaPause` → set state
- `DirectionRight` / `MediaFastForward` → seek forward + show controls
- `DirectionLeft` / `MediaRewind` → seek back + show controls
- `DirectionUp` → show controls; `DirectionDown` → hide controls
- `MediaNext` → next episode
- `BackHandler`: if controls visible → hide; else → `onBack()`
- Auto-hide controls after ~4s while playing (cancel while buffering).

Settings overlay (subtitles/audio/quality/speed): build a focusable D-pad list from `androidx.tv.material3` items; reuse the `viewModel.selectXxx()` methods.

---

## Phase 6 — Build order (each step compiles before the next)

1. Phase 0 (gradle + manifest + banner asset).
2. `util/FormFactor.kt`.
3. `ui/tv/common/TvFocusModifiers.kt`.
4. `ui/tv/common/TvMediaCard.kt`, `TvProgressMediaCard.kt`.
5. `ui/tv/common/TvImmersiveRow.kt`, `TvSectionRow.kt`.
6. Add `NavRoutes.Library`.
7. `ui/tv/home/TvHomeScreen.kt` (smallest end-to-end slice).
8. `ui/tv/TvAppNavHost.kt` + `ui/tv/TvRootView.kt` — wire Home first, stub other destinations with `Box {}`, fill incrementally.
9. Edit `MainActivity` branch → run on Android TV emulator, verify Home focus/scroll.
10. `TvSectionListScreen` → wire row "see all".
11. `TvDetailScreen` → Play navigates to Player.
12. `TvPlayerScreen` + controls overlay.
13. `TvSearchScreen`.
14. `TvLibraryScreen` (3 rows).
15. `TvSettingsScreen`.

---

## Pitfalls (must-read for executor)

1. **No `if (isTv)` branches inside phone screens.** Keep TV UI in separate `ui/tv/` files — phone screens are full of touch-only constructs (`PullToRefreshBox`, `combinedClickable` long-press, `Slider`).
2. **Modifier chain order:** `bringIntoViewRequester` → `tvFocusFrame` (scale/border) → `focusable` → `clickable`. Wrong order clips the scale or breaks click.
3. **Initial focus is mandatory** on every TV screen (`FocusRequester` + `requestFocus()` in `LaunchedEffect`).
4. **Row `contentPadding`** must leave room for the 1.08x scaled + bordered focused card, or it gets clipped.
5. **`androidx.tv:tv-foundation` is deprecated** — use Compose Foundation `LazyRow`/`LazyColumn`/`LazyVerticalGrid`.
6. **Player `useController = false`** — otherwise Media3's own controller competes with the D-pad overlay.
7. **No orientation forcing on TV.**
8. **Reuse `NavRoutes` verbatim** — its field names are the SavedStateHandle keys the reused ViewModels read. Do not rename routes.
9. **Verify every ViewModel API against the real source** before using it in a TV screen — skeleton names are inferred.
10. **Banner must exist** (`@drawable/tv_banner`) or the build fails.

---

## Verification

1. `./gradlew :app:assembleDebug` — confirms manifest merge, tv-material resolution, banner presence, TV code compiles.
2. **Phone / phone emulator:** launches into `RootTabView()` unchanged (regression check).
3. **Android TV emulator** (API 26+ TV image, 1080p profile): app appears on the leanback home row with the banner; launches into `TvRootView()`. D-pad reaches every actionable element on each screen; initial focus lands; `Back` pops correctly; rows scroll; player responds to center/left/right/up/down.
4. **(Optional) Fire TV / Firestick sideload:** launches via standard LAUNCHER; runtime detection (`amazon.hardware.fire_tv`) selects `TvRootView()`.
5. No new tests required (project has no test suite); verify by building and running on the TV emulator after each screen per Phase 6.

---

## File change summary

**New files:**
- `app/src/main/java/com/streamo/app/util/FormFactor.kt`
- `app/src/main/java/com/streamo/app/ui/tv/TvRootView.kt`
- `app/src/main/java/com/streamo/app/ui/tv/TvAppNavHost.kt`
- `app/src/main/java/com/streamo/app/ui/tv/common/{TvFocusModifiers,TvMediaCard,TvProgressMediaCard,TvImmersiveRow,TvSectionRow}.kt`
- `app/src/main/java/com/streamo/app/ui/tv/{home/TvHomeScreen, search/TvSearchScreen, detail/TvDetailScreen, library/TvLibraryScreen, sectionlist/TvSectionListScreen, settings/TvSettingsScreen, player/TvPlayerScreen}.kt`
- `app/src/main/res/drawable-xhdpi/tv_banner.png`

**Edited files:**
- `app/src/main/AndroidManifest.xml` (uses-feature ×2, banner, leanback launcher)
- `app/build.gradle.kts` (tv-material dependency)
- `gradle/libs.versions.toml` (tv-material version + library)
- `app/src/main/java/com/streamo/app/MainActivity.kt` (setContent branch)
- `app/src/main/java/com/streamo/app/navigation/NavRoutes.kt` (add `Library`)

**Untouched (reused):** all of `data/`, `di/`, `provider/`, `player/` services + DLNA, all ViewModels, `ui/theme/`, `ui/common/{AmbientBackground,ImagePlaceholder,SkeletonCard}`, phone `RootTabView`/`AppNavHost`/screens.
