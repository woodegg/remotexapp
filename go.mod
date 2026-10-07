module github.com/woodegg/remotexapp

go 1.26.0

toolchain go1.27.1

require github.com/gorilla/websocket v1.5.3

require (
	github.com/jezek/xgb v1.3.1
	golang.org/x/mod v0.41.0
	golang.org/x/sys v0.48.0
)

require (
	golang.org/x/sync v0.22.0 // indirect
	golang.org/x/telemetry v0.0.0-20260811182544-a038080d80e5 // indirect
	golang.org/x/tools v0.49.0 // indirect
	golang.org/x/vuln v1.7.0 // indirect
)

tool golang.org/x/vuln/cmd/govulncheck
