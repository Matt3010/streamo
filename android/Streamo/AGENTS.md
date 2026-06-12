# Repository Guidelines

## Project Structure & Module Organization

Streamo Android is a single-module Gradle project (`:app`) for a Jetpack Compose media app (TMDB catalog browsing, provider-scraped playback, offline downloads, casting).

```
Streamo/
├── app/
│   ├── src/
│   │   ├── main/java/com/streamo/app/
│   │   │   ├── data/          # Room DB, repository, DataStore, backup, remote API
│   │   │   ├── di/            # Hilt modules (NetworkModule, DatabaseModule, AppModule)
│   │   │   ├── download/      # Download infrastructure (WorkManager + legacy paths)
│   │   │   ├── navigation/    # NavRoutes sealed class, NavHost, RootTabView
│   │   │   ├── player/        # Media3 player, PiP, casting (Cast/DLNA/LanCast)
│   │   │   ├── provider/      # Provider resolver chain (Vixcloud + WARP tunnel)
│   │   │   ├── tmdb/          # TMDB API client and image utilities
│   │   │   ├── ui/            # Compose screens (home, detail, player, search, etc.)
│   │   │   ├── util/          # Connectivity, formatting, form-factor, TV logic
│   │   │   ├── MainActivity.kt
│   │   │   └── MainApplication.kt
│   │   ├── test/              # Unit tests (JUnit 4)
│   │   └── androidTest/       # Instrumented tests (Espresso, Compose)
│   ├── libs/                  # Local AARs (warpkit.aar)
│   └── build.gradle.kts
├── gradle/
│   ├── libs.versions.toml     # Version catalog
│   └── wrapper/
├── build.gradle.kts
├── settings.gradle.kts
└── gradle.properties
```

The iOS counterpart lives at `../../ios/Streamo` — useful as a behavioral reference when porting features.

## Build, Test & Development Commands

Use the Gradle wrapper (`./gradlew` on Unix, `.\gradlew.bat` on Windows), Java 11.

| Command | Description |
|---|---|
| `.\gradlew assembleDebug` | Build the debug APK |
| `.\gradlew installDebug` | Install on connected device/emulator |
| `.\gradlew lint` | Run lint (never fails — `abortOnError = false`) |
| `.\gradlew test` | Run unit tests |
| `.\gradlew test --tests "com.streamo.app.ClassName.methodName"` | Run a single unit test |
| `.\gradlew connectedAndroidTest` | Run instrumented tests (needs device) |
| `.\gradlew clean assembleDebug` | Clean build (use when incremental builds fail on stale generated code) |

After renaming Hilt-annotated classes, always verify with a clean build. The TMDB API key is baked in via `BuildConfig.DEFAULT_TMDB_API_KEY`; users can override it in Settings.

## Coding Style & Naming Conventions

- **Language**: Kotlin with Jetpack Compose.
- **Indentation**: 4 spaces. No tabs.
- **Naming**: Classes and objects use PascalCase; functions, properties, and local variables use camelCase. Composable functions follow the ScreenNameScreen/ScreenNameViewModel pattern (e.g., HomeScreen, HomeViewModel).
- **DI**: All ViewModels are @HiltViewModel; modules live in `di/` and are @Singleton in SingletonComponent.
- **Formatting**: No auto-formatter is configured — follow the existing style in the file you edit.
- **Lint**: Runs at build time but never blocks it.

## Testing Guidelines

- **Frameworks**: JUnit 4 for unit tests, Espresso + Compose Test for instrumented tests.
- **Coverage**: Minimal test suite exists today — only scaffold tests (ExampleUnitTest, ExampleInstrumentedTest). Prefer verifying changes by building and running the app.
- **Test location**: Unit tests go in `app/src/test/`, instrumented tests in `app/src/androidTest/`, mirroring the com.streamo.app package structure.
- **Naming**: Use descriptive snake_case or camelCase method names that describe the scenario and expected outcome.

## Commit & Pull Request Guidelines

Commits use Conventional Commits prefixes:

```
feat:     A new feature (e.g., feat(tv): add Android TV / Fire TV support)
fix:      A bug fix
refactor: Code restructuring without feature changes
docs:     Documentation only
chore:    Maintenance, tooling, dependency updates
```

PR descriptions should:
- Summarize what changed and why.
- Reference any related issues.
- Include screenshots for UI changes (Italian locale preferred).
- Note if the change touches the download system (legacy MediaDownloadService vs current ResolveAndDownloadWorker) to guide reviewers.

## Security & Configuration Tips

- The provider domain is resolved at runtime (not hardcoded) — it rotates frequently.
- warpkit.aar (Cloudflare WARP tunnel) is built externally via wireproxykit/build-android.sh (repo root) and placed in app/libs/.
- The ndk block limits native libraries to arm64-v8a to keep APK size small.
- Release builds use the debug signing key with minification disabled.
