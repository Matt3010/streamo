#!/usr/bin/env sh
# Build WireProxyKit.xcframework (userspace WireGuard → local HTTP proxy) for
# the Streamo iOS app. Requires FULL Xcode (not just Command Line Tools) and Go.
#
#   sudo xcode-select -s /Applications/Xcode.app   # if `xcode-select -p` shows CommandLineTools
#   brew install go                                 # if `go` is missing
#   ./build-ios.sh
#
# Output: ios/Streamo/Frameworks/WireProxyKit.xcframework, already
# wired into Streamo.xcodeproj (Embed & Sign). Commit it like Android commits
# warpkit.aar, so other machines/CI don't need Go + Xcode toolchain.
set -e
cd "$(dirname "$0")"

OUT="$(cd ../ios/Streamo && pwd)/Frameworks" # ios/Streamo/Frameworks (where Xcode consumes it)

[ "$(id -u)" = 0 ] && { echo "ERROR: do NOT run with sudo (pollutes ~/go with root-owned files). Run as your user."; exit 1; }
command -v go >/dev/null 2>&1 || { echo "ERROR: Go not installed (brew install go)"; exit 1; }
case "$(xcode-select -p 2>/dev/null)" in
  *CommandLineTools*|"") echo "ERROR: full Xcode required. Run: sudo xcode-select -s /Applications/Xcode.app"; exit 1;;
esac

export PATH="$PATH:$(go env GOPATH)/bin"

echo "==> Installing gomobile/gobind"
go install golang.org/x/mobile/cmd/gomobile@latest
go install golang.org/x/mobile/cmd/gobind@latest

echo "==> Resolving deps"
go get github.com/windtf/wireproxy@latest
# Go 1.24+: record x/mobile as a tool directive so `go mod tidy` keeps it in
# the module graph (gomobile bind needs it there).
go get -tool golang.org/x/mobile/cmd/gobind
go mod tidy

echo "==> gomobile init"
gomobile init

echo "==> Building xcframework -> $OUT"
mkdir -p "$OUT"
rm -rf "$OUT/WireProxyKit.xcframework"
gomobile bind -target=ios,iossimulator -o "$OUT/WireProxyKit.xcframework" .

echo ""
echo "OK -> $OUT/WireProxyKit.xcframework"
echo "Already referenced by Streamo.xcodeproj (Frameworks/). Just rebuild the app."
