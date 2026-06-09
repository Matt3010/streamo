#!/usr/bin/env sh
# Build warpkit.aar (userspace WireGuard -> local HTTP proxy, Cloudflare WARP)
# for the Streamo Android app. Reuses the SAME Go source as iOS
# (../../ios/wireproxykit/wireproxykit.go) — only the gomobile target differs.
#
# Requires Go and the Android NDK. gomobile fetches its own NDK if ANDROID_NDK_HOME
# is unset, but a local SDK/NDK is recommended:
#   export ANDROID_HOME=$HOME/Android/Sdk
#   export ANDROID_NDK_HOME=$ANDROID_HOME/ndk/<version>
#   ./build.sh
#
# Output: android/Streamo/app/libs/warpkit.aar. Commit the .aar like iOS commits
# WireProxyKit.xcframework, so CI/other machines don't need the Go toolchain.
set -e
cd "$(dirname "$0")"

SRC="../../ios/wireproxykit"           # shared Go module
OUT="$(cd ../Streamo && pwd)/app/libs" # android/Streamo/app/libs

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

echo "==> Building warpkit.aar (min API 26)"
mkdir -p "$OUT"
( cd "$SRC" && gomobile bind -target=android -androidapi 26 -javapkg=com.streamo.warp -o "$OUT/warpkit.aar" . )

echo ""
echo "OK -> $OUT/warpkit.aar"
echo "Rebuild the app: ./gradlew assembleDebug"
