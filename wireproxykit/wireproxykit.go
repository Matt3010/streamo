// Package wireproxykit is a thin gomobile-bindable wrapper around
// windtf/wireproxy: it brings up a userspace WireGuard tunnel (to Cloudflare
// WARP) and spawns the local HTTP proxy described by the config's [http]
// section. No tun device, no root, no Network Extension — the proxy listens on
// 127.0.0.1 and the Swift app routes its provider traffic through it.
//
// gomobile exposes the two exported functions to Swift as:
//
//	WireproxykitStart(_ config: String) throws   // Go's trailing error → Swift throws
//	WireproxykitStop()
//
// Build: see build.sh (gomobile bind -o WireProxyKit.xcframework).
package wireproxykit

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/windtf/wireproxy"
	"golang.org/x/crypto/curve25519"
)

var (
	mu sync.Mutex
	vt *wireproxy.VirtualTun
)

// Start parses the wireproxy config text, brings up the WireGuard device and
// spawns its routines ([http] proxy) on background goroutines, then returns.
// Calling Start while already running tears the previous tunnel down first.
func Start(config string) error {
	mu.Lock()
	defer mu.Unlock()

	stopLocked()

	f, err := os.CreateTemp("", "warp-*.conf")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err := f.WriteString(config); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}

	conf, err := wireproxy.ParseConfig(f.Name())
	if err != nil {
		return err
	}
	tun, err := wireproxy.StartWireguard(conf, 0 /* silent log level */)
	if err != nil {
		return err
	}
	if len(conf.Routines) == 0 {
		tun.Dev.Close()
		return errors.New("wireproxykit: config has no proxy routine ([http] section missing)")
	}
	for _, spawner := range conf.Routines {
		go spawner.SpawnRoutine(tun)
	}
	vt = tun
	return nil
}

// Cloudflare WARP client-API constants, pinned to the values wgcf
// (github.com/ViRb3/wgcf) uses — the API gates registration on these.
const (
	regAPIBase    = "https://api.cloudflareclient.com"
	regAPIVersion = "v0a2158"
	regClientVer  = "a-6.11-2223"
	regUserAgent  = "okhttp/3.12.1"
)

// Register registers a fresh free Cloudflare WARP account on-device and returns
// the `[Interface]`/`[Peer]` portion of a wireproxy config as a string. The
// caller appends the `[http]` section (with its chosen local bind) before
// passing the full text to Start.
//
// A Curve25519 keypair is generated locally; the private key is embedded in the
// returned config and never sent anywhere. This is the Go equivalent of iOS's
// WarpAccount.register() — keeping registration in Go lets Android reuse
// wireguard's curve25519 instead of pulling in a separate crypto dependency.
func Register() (string, error) {
	var priv [32]byte
	if _, err := rand.Read(priv[:]); err != nil {
		return "", err
	}
	// WireGuard private-key clamping.
	priv[0] &= 248
	priv[31] &= 127
	priv[31] |= 64

	pub, err := curve25519.X25519(priv[:], curve25519.Basepoint)
	if err != nil {
		return "", err
	}
	privB64 := base64.StdEncoding.EncodeToString(priv[:])
	pubB64 := base64.StdEncoding.EncodeToString(pub)

	body, err := json.Marshal(map[string]string{
		"install_id": "",
		"fcm_token":  "",
		"tos":        time.Now().UTC().Format(time.RFC3339),
		"key":        pubB64,
		"type":       "Android",
		"locale":     "en_US",
	})
	if err != nil {
		return "", err
	}

	req, err := http.NewRequest("POST", fmt.Sprintf("%s/%s/reg", regAPIBase, regAPIVersion), bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", regUserAgent)
	req.Header.Set("CF-Client-Version", regClientVer)
	req.Header.Set("Content-Type", "application/json; charset=UTF-8")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("warp registration failed: HTTP %d", resp.StatusCode)
	}

	var reg regResponse
	if err := json.Unmarshal(data, &reg); err != nil {
		return "", err
	}
	if len(reg.Config.Peers) == 0 {
		return "", errors.New("warp registration: no peers in response")
	}
	peer := reg.Config.Peers[0]
	endpoint := peer.Endpoint.Host
	if endpoint == "" {
		endpoint = peer.Endpoint.V4
	}
	if peer.PublicKey == "" || endpoint == "" || reg.Config.Interface.Addresses.V4 == "" {
		return "", errors.New("warp registration: malformed response")
	}

	address := reg.Config.Interface.Addresses.V4 + "/32"
	if reg.Config.Interface.Addresses.V6 != "" {
		address += ", " + reg.Config.Interface.Addresses.V6 + "/128"
	}

	conf := fmt.Sprintf(`[Interface]
PrivateKey = %s
Address = %s
DNS = 1.1.1.1
MTU = 1280

[Peer]
PublicKey = %s
Endpoint = %s
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
`, privB64, address, peer.PublicKey, endpoint)
	return conf, nil
}

// regResponse mirrors the subset of Cloudflare's /reg response we need.
type regResponse struct {
	Config struct {
		ClientID string `json:"client_id"`
		Peers    []struct {
			PublicKey string `json:"public_key"`
			Endpoint  struct {
				V4   string `json:"v4"`
				V6   string `json:"v6"`
				Host string `json:"host"`
			} `json:"endpoint"`
		} `json:"peers"`
		Interface struct {
			Addresses struct {
				V4 string `json:"v4"`
				V6 string `json:"v6"`
			} `json:"addresses"`
		} `json:"interface"`
	} `json:"config"`
}

// SetTmpDir overrides the directory Start writes its temp config file into.
// Needed on Android: the default os.TempDir() is /data/local/tmp, which the app
// cannot write to — pass the app cache dir. Uses os.Setenv (not a host-side libc
// setenv) so Go's own os.TempDir() actually picks it up. No-op effect on iOS,
// where the default temp dir is already writable.
func SetTmpDir(dir string) {
	if dir != "" {
		os.Setenv("TMPDIR", dir)
	}
}

// Stop tears the tunnel down. Safe to call when not running.
func Stop() {
	mu.Lock()
	defer mu.Unlock()
	stopLocked()
}

func stopLocked() {
	if vt != nil && vt.Dev != nil {
		vt.Dev.Close()
	}
	vt = nil
}
