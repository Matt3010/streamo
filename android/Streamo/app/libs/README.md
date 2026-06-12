# app/libs

Drop-in native libraries consumed via `fileTree("libs") { include("*.aar") }` in
`app/build.gradle.kts`.

## warpkit.aar

Userspace WireGuard → Cloudflare WARP tunnel exposing a local HTTP proxy. Built
from the shared Go source (`/wireproxykit` at repo root) by:

```sh
cd ../../../../wireproxykit && ./build-android.sh   # or build-android.ps1 on Windows
```

The app builds and runs **without** this `.aar` — `WarpEngine` reflects the
generated class (`com.streamo.warp.wireproxykit.Wireproxykit`) at runtime and, if
absent, reports the WARP engine as unavailable (the Settings toggle is disabled).
Commit the built `.aar` so other machines/CI don't need the Go + NDK toolchain.
