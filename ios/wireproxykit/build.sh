#!/usr/bin/env sh
# Build WireProxyKit.xcframework (userspace WireGuard → local HTTP proxy) for
# the Streamo iOS app. Requires FULL Xcode (not just Command Line Tools) and Go.
#
#   sudo xcode-select -s /Applications/Xcode.app   # if `xcode-select -p` shows CommandLineTools
#   brew install go                                 # if `go` is missing
#   ./build.sh
#
# Then drag the produced WireProxyKit.xcframework into the Streamo target
# (General → Frameworks, Libraries, and Embedded Content → Embed & Sign).
set -e
cd "$(dirname "$0")"

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

echo "==> Building xcframework"
rm -rf WireProxyKit.xcframework
gomobile bind -target=ios,iossimulator -o WireProxyKit.xcframework .

echo ""
echo "OK -> $(pwd)/WireProxyKit.xcframework"
echo "Drag it into the Streamo target (Embed & Sign), then rebuild the app."
