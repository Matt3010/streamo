#!/usr/bin/env sh
# Build warpkit.aar (userspace WireGuard -> local HTTP proxy, Cloudflare WARP)
# for the Streamo Android app. Reuses the SAME shared Go source as iOS
# (./wireproxykit.go, this dir) — only the gomobile target differs.
#
# Requires Go and the Android NDK. gomobile fetches its own NDK if ANDROID_NDK_HOME
# is unset, but a local SDK/NDK is recommended:
#   export ANDROID_HOME=$HOME/Android/Sdk
#   export ANDROID_NDK_HOME=$ANDROID_HOME/ndk/<version>
#   ./build-android.sh
#
# Output: android/Streamo/app/libs/warpkit.aar. Commit the .aar like iOS commits
# WireProxyKit.xcframework, so CI/other machines don't need the Go toolchain.
set -e
cd "$(dirname "$0")"

SRC="."                                        # shared Go module (this dir)
OUT="$(cd ../android/Streamo && pwd)/app/libs" # android/Streamo/app/libs

command -v go >/dev/null 2>&1 || { echo "ERROR: Go not installed"; exit 1; }
[ -f "$SRC/wireproxykit.go" ] || { echo "ERROR: Go source not found at $SRC"; exit 1; }

export PATH="$PATH:$(go env GOPATH)/bin"

echo "==> Installing gomobile/gobind"
go install golang.org/x/mobile/cmd/gomobile@latest
go install golang.org/x/mobile/cmd/gobind@latest

echo "==> Resolving deps (in $SRC)"
( cd "$SRC" && go get github.com/windtf/wireproxy@latest && go get golang.org/x/crypto/curve25519 && go get -tool golang.org/x/mobile/cmd/gobind && go mod tidy )

echo "==> gomobile init"
gomobile init

echo "==> Building warpkit.aar (min API 24, 16 KB page-size aligned)"
mkdir -p "$OUT"
# -z max-page-size=16384: align ELF LOAD segments to 16 KB, required by Google
# Play for Android 15+ devices (developer.android.com/16kb-page-size).
( cd "$SRC" && gomobile bind -target=android -androidapi 24 -javapkg=com.streamo.warp \
    -ldflags="-extldflags=-Wl,-z,max-page-size=16384" \
    -o "$OUT/warpkit.aar" . )

echo ""
echo "OK -> $OUT/warpkit.aar"
echo "Rebuild the app: ./gradlew assembleDebug"
