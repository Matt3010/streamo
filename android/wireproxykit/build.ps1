# Build warpkit.aar (userspace WireGuard -> local HTTP proxy, Cloudflare WARP)
# for the Streamo Android app, on Windows. PowerShell port of build.sh — reuses
# the SAME Go source as iOS (..\..\ios\wireproxykit\wireproxykit.go).
#
# Requires:
#   - Go (https://go.dev/dl/)        -> `go version`
#   - Android NDK (via Android Studio: SDK Manager -> SDK Tools -> NDK)
#
# Point gomobile at your SDK/NDK before running (adjust paths/version):
#   $env:ANDROID_HOME     = "$env:LOCALAPPDATA\Android\Sdk"
#   $env:ANDROID_NDK_HOME = "$env:ANDROID_HOME\ndk\27.0.12077973"
#   .\build.ps1
#
# Output: android\Streamo\app\libs\warpkit.aar. Commit it like iOS commits
# WireProxyKit.xcframework, so other machines/CI don't need Go + NDK.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$src = Resolve-Path "..\..\ios\wireproxykit"
$out = Join-Path (Resolve-Path "..\Streamo") "app\libs"

if (-not (Get-Command go -ErrorAction SilentlyContinue)) { throw "Go not installed (https://go.dev/dl/)" }
if (-not (Test-Path (Join-Path $src "wireproxykit.go"))) { throw "Go source not found at $src" }

$gobin = (& go env GOPATH).Trim() + "\bin"
$env:PATH = "$env:PATH;$gobin"

Write-Host "==> Installing gomobile/gobind"
& go install golang.org/x/mobile/cmd/gomobile@latest
& go install golang.org/x/mobile/cmd/gobind@latest

Write-Host "==> Resolving deps (in $src)"
Push-Location $src
try {
    & go get github.com/windtf/wireproxy@latest
    & go get golang.org/x/crypto/curve25519
    & go get -tool golang.org/x/mobile/cmd/gobind
    & go mod tidy
} finally { Pop-Location }

Write-Host "==> gomobile init"
& gomobile init

Write-Host "==> Building warpkit.aar (min API 26)"
New-Item -ItemType Directory -Force -Path $out | Out-Null
$aar = Join-Path $out "warpkit.aar"
# Pass args as an array (splat). Writing `-javapkg=com.streamo.warp` inline gets
# split by PowerShell's argument parser into `-javapkg=com` + `.streamo.warp`;
# an array element is passed verbatim. Keep the package = WarpEngine's reflected
# class prefix (com.streamo.warp.wireproxykit.Wireproxykit).
$bindArgs = @(
    "bind",
    "-target=android",
    "-androidapi", "26",
    "-javapkg=com.streamo.warp",
    "-o", $aar,
    "."
)
Push-Location $src
try {
    & gomobile @bindArgs
    if ($LASTEXITCODE -ne 0) { throw "gomobile bind failed (exit $LASTEXITCODE)" }
} finally { Pop-Location }

Write-Host ""
Write-Host "OK -> $aar"
Write-Host "Rebuild the app: .\gradlew.bat assembleDebug"
