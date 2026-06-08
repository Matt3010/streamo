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
	"errors"
	"os"
	"sync"

	"github.com/windtf/wireproxy"
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
