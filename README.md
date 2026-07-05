# Project Obsidian / Streamo

Personal cross-platform media app for browsing a TMDB catalog, resolving playable sources through external providers, and playing content on phones, tablets, Android TV / Fire TV, and iOS. This repository contains:

- a native Android app built with Kotlin, Jetpack Compose, and Material 3;
- a native iOS app built with SwiftUI and SwiftData;
- a shared Go module, compiled with gomobile, that exposes a userspace WARP proxy to both platforms.

> Legal note: the app uses TMDB metadata and third-party providers to resolve sources. Content availability and streaming legality depend on the providers, selected content, and local laws. The authors do not endorse copyright infringement or unlawful use; users are solely responsible for complying with applicable laws.

## Features

- TMDB-based movie and TV catalog.
- Home sections for trending, popular, in theaters, on TV, upcoming, and top-rated content.
- Search with local history.
- Detail pages with seasons, episodes, trailers, reviews, recommendations, and manual provider-version selection when multiple candidates match.
- HLS playback with smart episode resume.
- Continue Watching, history, watchlist, and watched/unwatched state.
- Offline HLS downloads with quality selection.
- Picture-in-picture on Android.
- Casting and remote playback through DLNA and the app-to-app LanCast protocol.
- Android TV / Fire TV support with Leanback launcher entry.
- JSON backup and restore for the local library.
- TMDB API key override from Settings.
- Optional Cloudflare WARP tunnel through a local userspace HTTP proxy, without root and without Network Extension.

## Repository Layout

```text
.
|-- android/Streamo/              # Android app, single Gradle module :app
|   |-- app/src/main/java/com/streamo/app/
|   |   |-- data/                 # Room, repository, DataStore, backup, remote API
|   |   |-- di/                   # Hilt modules
|   |   |-- download/             # WorkManager, Media3 downloads, quality gates
|   |   |-- navigation/           # Compose routes and NavHost
|   |   |-- player/               # Media3, PiP, DLNA, LanCast, casting
|   |   |-- provider/             # Provider resolver, Vixcloud, WARP
|   |   |-- tmdb/                 # TMDB client and image helpers
|   |   |-- ui/                   # Compose screens
|   |   `-- util/                 # Form factor, formatting, TV logic
|   `-- gradle/                   # Wrapper and version catalog
|-- ios/Streamo/                  # iOS SwiftUI app
|   |-- Streamo/
|   |   |-- Domain/               # Domain models and logic
|   |   |-- Networking/           # TMDB client
|   |   |-- Persistence/          # SwiftData, library, backup
|   |   |-- Player/               # Player, downloads, local HLS proxy
|   |   |-- Provider/             # Provider, Vixcloud, WARP
|   |   |-- Settings/             # App settings
|   |   `-- UI/                   # SwiftUI screens
|   `-- Frameworks/               # WireProxyKit.xcframework
`-- wireproxykit/                 # Shared Go module for WARP
```

## Tech Stack

### Android

- Kotlin 2.1.20
- Gradle 8.10.2
- Android Gradle Plugin 8.7.3
- compileSdk / targetSdk 36
- minSdk 26
- Jetpack Compose + Material 3
- AndroidX TV Material for Android TV / Fire TV
- Hilt for dependency injection
- Room for local persistence
- DataStore for settings
- Retrofit, OkHttp, and Gson for networking
- Media3 / ExoPlayer for playback, HLS, DASH, and downloads
- WorkManager for offline downloads
- NanoHTTPD for the local DLNA HLS proxy

### iOS

- SwiftUI
- SwiftData
- AVFoundation / AVKit for playback
- Local HLS server for proxying and downloads
- WireProxyKit xcframework generated from Go/gomobile

### Shared WARP Module

- Go 1.26
- gomobile / gobind
- `github.com/windtf/wireproxy`
- local HTTP proxy on `127.0.0.1`
- on-device WARP registration with locally generated WireGuard keys

## Requirements

### Android

- Recent Android Studio.
- JDK 11.
- Android SDK 36.
- Android SDK Platform Tools.
- Android NDK if you need to regenerate `warpkit.aar`.
- Android 8.0+ device/emulator, or a compatible Android TV / Fire TV device.

### iOS

- macOS with full Xcode, not only Command Line Tools.
- iOS SDK installed through Xcode.
- Go if you need to regenerate `WireProxyKit.xcframework`.

### Go / gomobile

Go and gomobile are only required when regenerating the native WARP artifacts:

- `android/Streamo/app/libs/warpkit.aar`
- `ios/Streamo/Frameworks/WireProxyKit.xcframework`

The artifacts are already present in the repository, so normal app builds do not require the Go toolchain.

## Configuration

### TMDB API Key

Android includes a default key in `android/Streamo/app/build.gradle.kts`:

```kotlin
buildConfigField("String", "DEFAULT_TMDB_API_KEY", "\"...\"")
```

Users can replace it from the app Settings screen. If you want a different build-time key, change that value or introduce a dedicated Gradle property.

### Provider Resolution

The provider domain is not hardcoded because it can rotate. The resolution chain is:

```text
TMDB title
-> ProviderClient.search()
-> ProviderResolver
-> VixcloudClient.playbackSources()
-> HLS playlist
```

When multiple results are plausible, the app shows a picker and persists the confirmed mapping locally.

### WARP

WARP is optional. If the native bridge is not available, the app falls back to direct mode and disables the WARP toggle.

Provider traffic can be routed through:

```text
app -> local HTTP proxy 127.0.0.1 -> userspace WireGuard -> Cloudflare WARP
```

The implementation does not require root, a system TUN device, or Network Extension.

## Android Build

PowerShell:

```powershell
cd android\Streamo
.\gradlew.bat assembleDebug
```

Unix/macOS/Linux shell:

```sh
cd android/Streamo
./gradlew assembleDebug
```

Useful commands:

```sh
./gradlew assembleDebug          # build debug APK
./gradlew installDebug           # install on connected device/emulator
./gradlew lint                   # run lint; it does not fail the build
./gradlew test                   # unit tests
./gradlew connectedAndroidTest   # instrumented tests, requires a device
./gradlew clean assembleDebug    # clean build
```

Android notes:

- The Gradle project has one module: `:app`.
- Release builds are signed with the debug key and minification is disabled.
- The APK packages only `arm64-v8a` and `armeabi-v7a` to reduce size and support 32-bit Fire TV devices.
- If you rename Hilt classes or annotated types, try a clean build before diagnosing generated-code errors.

## iOS Build

Open the project:

```sh
open ios/Streamo/Streamo.xcodeproj
```

Select the `Streamo` scheme and build from Xcode.

Command line on macOS:

```sh
cd ios/Streamo
xcodebuild -scheme Streamo -configuration Debug build
```

If you regenerate `WireProxyKit.xcframework`, run Clean Build Folder in Xcode if the framework is not picked up immediately.

## Regenerating WARP for Android

Requires Go, Android SDK, and preferably Android NDK:

```sh
export ANDROID_HOME="$HOME/Android/Sdk"
export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/<version>"

cd wireproxykit
./build-android.sh
```

Output:

```text
android/Streamo/app/libs/warpkit.aar
```

The script builds with min API 26 and 16 KB page-size alignment for modern Android devices.

On Windows:

```powershell
cd wireproxykit
.\build-android.ps1
```

## Regenerating WARP for iOS

Requires full Xcode and Go:

```sh
sudo xcode-select -s /Applications/Xcode.app

cd wireproxykit
./build-ios.sh
```

Output:

```text
ios/Streamo/Frameworks/WireProxyKit.xcframework
```

The framework is already referenced by the Xcode project with Embed & Sign.

## Android Architecture

Android uses MVVM with Hilt, Compose, and Room.

- `MainApplication` initializes global infrastructure, database, downloads, and services.
- `MainActivity` hosts the single-activity navigation tree.
- `NavRoutes` defines typed, serializable routes.
- Each main screen has a Hilt ViewModel.
- `AppRepository` is the main access point for Room DAOs and local state.
- `SettingsDataStore` stores persistent preferences.
- `BackupManager` exports and imports JSON backups.

Main local entities:

- `ProgressEntry`
- `HistoryEntry`
- `WatchlistEntry`
- `DownloadEntry`
- `ProviderMappingEntity`
- `SearchHistoryEntry`

## Downloads and Playback

Offline downloads use HLS and Media3. The current path goes through `ResolveAndDownloadWorker`, which resolves the provider source and downloads with `HlsDownloader`.

Important components:

- `DownloadInfrastructure`: shared Media3 cache, DownloadManager, and OkHttp client.
- `ResolveAndDownloadWorker`: current path for new downloads.
- `MediaDownloadService`: notifications and compatibility with legacy flows.
- `DownloadQualityGate` and `DownloadResolutionProbe`: quality selection and validation.
- `PlaybackService`: Media3 session and system controls.
- `PipController`: picture-in-picture.
- `LocalHlsProxy`: local proxy for DLNA.
- `LanCastService`: app-to-app protocol on the LAN.

## Android TV / Fire TV

The app can be installed on phones/tablets and TV devices:

- `android.hardware.touchscreen` is not required;
- `android.software.leanback` is not required;
- `MainActivity` also exposes `LEANBACK_LAUNCHER`;
- dedicated TV screens live under `ui/tv/`.

## Persistence and Backup

The library is local. There is no cloud sync across devices.

Persisted data includes:

- watchlist;
- playback progress;
- history;
- downloads;
- confirmed provider mappings;
- search history;
- settings.

JSON backup allows manual export and restore from Settings.

## Tests

The current test suite is minimal and mostly contains scaffold tests.

Android:

```sh
cd android/Streamo
./gradlew test
./gradlew connectedAndroidTest
```

iOS:

```sh
cd ios/Streamo
xcodebuild -scheme Streamo -configuration Debug test
```

For broad changes, the recommended minimum verification is:

```sh
cd android/Streamo
./gradlew clean assembleDebug
```

and an iOS build from Xcode or `xcodebuild` if the change touches Swift code.

## Development Conventions

- User-facing UI text is Italian.
- Code, commits, and PRs can be English.
- Kotlin: 4 spaces, camelCase for functions/properties, PascalCase for classes.
- Compose screens and ViewModels follow `NameScreen` / `NameViewModel`.
- Swift code should follow the style of nearby files.
- Do not hardcode the provider domain.
- TMDB images should go through the dedicated helpers.
- Poster cards use a 2:3 ratio; episode stills use 16:9.

## Commits

Recommended format:

```text
feat: add a new feature
fix: fix a bug
refactor: reorganize code without behavior changes
docs: update documentation
chore: maintenance, build, dependencies
```

Examples:

```text
feat(tv): add Fire TV navigation
fix(download): preserve quality preference on mobile data
docs: add WARP setup notes
```

## License

This project is released under the MIT License. See `LICENSE`.

This software is provided for personal and educational use. The authors are not responsible for how it is used, for third-party content accessed through it, or for any consequences resulting from unlawful or improper use.

## Troubleshooting

### Android: Hilt or KSP errors after renaming

Run a clean build:

```sh
cd android/Streamo
./gradlew clean assembleDebug
```

### Android: WARP unavailable

Check that this file exists:

```text
android/Streamo/app/libs/warpkit.aar
```

If it is missing, regenerate it with `wireproxykit/build-android.sh`.

### iOS: WARP toggle disabled

Check that this framework exists:

```text
ios/Streamo/Frameworks/WireProxyKit.xcframework
```

If you regenerated it, run Clean Build Folder in Xcode.

### Provider cannot resolve a title

The provider domain can rotate, and provider metadata can differ from the TMDB title. Search manually, select the correct candidate from the picker, and let the app save the local mapping.

### DLNA / cast devices are not found

Make sure the phone and TV are on the same LAN and multicast/SSDP is not blocked by the router. On Android, the app requires network, Wi-Fi, multicast, foreground-service, and wake-lock permissions to keep the proxy active.

## Useful Files

- `android/Streamo/CLAUDE.md`: detailed Android technical notes.
- `android/Streamo/AGENTS.md`: Android structure, build, and contribution guidelines.
- `ios/Streamo/WARP-SETUP.md`: iOS-specific WARP instructions.
- `wireproxykit/build-android.sh`: Android WARP bridge build script.
- `wireproxykit/build-ios.sh`: iOS WARP bridge build script.
