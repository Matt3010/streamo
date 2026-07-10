package main

import (
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"

	"wireproxykit"
)

const socksAddress = "127.0.0.1:40000"
const controlAddress = "127.0.0.1:40001"

var (
	configPath string
	warpMu     sync.Mutex
)

func writeRegistration() (string, error) {
	registered, err := wireproxykit.Register()
	if err != nil {
		return "", err
	}
	config := []byte(registered + "\n[Socks5]\nBindAddress = " + socksAddress + "\n")
	if err := os.MkdirAll(filepath.Dir(configPath), 0700); err != nil {
		return "", err
	}
	if err := os.WriteFile(configPath, config, 0600); err != nil {
		return "", err
	}
	return string(config), nil
}

func register() error {
	wirebase, err := writeRegistration()
	if err != nil {
		return err
	}
	wireproxykit.Stop()
	return wireproxykit.Start(wirebase)
}

func main() {
	dir, err := os.UserConfigDir()
	if err != nil {
		panic(err)
	}
	configPath = filepath.Join(dir, "Streamo", "warp.conf")
	config, err := os.ReadFile(configPath)
	if os.IsNotExist(err) {
		var registered string
		registered, err = writeRegistration()
		if err == nil {
			config = []byte(registered)
		}
	}
	if err != nil {
		panic(err)
	}
	if err := wireproxykit.Start(string(config)); err != nil {
		panic(err)
	}
	http.HandleFunc("POST /register", func(w http.ResponseWriter, _ *http.Request) {
		warpMu.Lock()
		defer warpMu.Unlock()
		if err := register(); err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	go func() { _ = http.ListenAndServe(controlAddress, nil) }()
	fmt.Println("Streamo WARP SOCKS pronto su " + socksAddress)
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	wireproxykit.Stop()
}
