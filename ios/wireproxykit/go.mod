module wireproxykit

go 1.26.0

// Deps are added by build.sh (`go get` + `go mod tidy`):
//   github.com/windtf/wireproxy
//   golang.org/x/mobile

require (
	github.com/windtf/wireproxy v1.1.2
	golang.org/x/crypto v0.53.0
)

require (
	github.com/MakeNowJust/heredoc/v2 v2.0.1 // indirect
	github.com/go-ini/ini v1.67.0 // indirect
	github.com/google/btree v1.1.2 // indirect
	github.com/things-go/go-socks5 v0.0.5 // indirect
	golang.org/x/mobile v0.0.0-20260602190626-68735029466e // indirect
	golang.org/x/mod v0.36.0 // indirect
	golang.org/x/net v0.55.0 // indirect
	golang.org/x/sync v0.20.0 // indirect
	golang.org/x/sys v0.46.0 // indirect
	golang.org/x/time v0.5.0 // indirect
	golang.org/x/tools v0.45.0 // indirect
	golang.zx2c4.com/wintun v0.0.0-20230126152724-0fa3db229ce2 // indirect
	golang.zx2c4.com/wireguard v0.0.0-20231211153847-12269c276173 // indirect
	gvisor.dev/gvisor v0.0.0-20230927004350-cbd86285d259 // indirect
)

tool golang.org/x/mobile/cmd/gobind
