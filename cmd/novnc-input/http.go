package main

import (
	"encoding/json"
	"net/http"
	"time"
)

func gatewayHandler(cfg config, input *inputController) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/", "/kiosk.html":
			serveEmbeddedHTML(w, kioskHTML)
		default:
			http.NotFound(w, r)
		}
	})
	rfbGate := make(chan struct{}, normalizedLimit(cfg.maxRFBConnections))
	inputGate := make(chan struct{}, normalizedLimit(cfg.maxInputConnections))
	mux.HandleFunc("/input", limitedWebSocket(inputGate, input.serve))
	mux.HandleFunc("/rfb", limitedWebSocket(rfbGate, func(w http.ResponseWriter, r *http.Request) { proxyRFB(w, r, cfg.vncAddr) }))
	mux.HandleFunc("/rfb-compat", limitedWebSocket(rfbGate, func(w http.ResponseWriter, r *http.Request) { proxyRFBCompat(w, r, cfg.vncAddr) }))
	if cfg.legacyRFB != "" {
		mux.HandleFunc("/websockify", func(w http.ResponseWriter, r *http.Request) { proxyWebSocket(w, r, cfg.legacyRFB) })
		mux.HandleFunc("/rfb-legacy", func(w http.ResponseWriter, r *http.Request) { proxyWebSocket(w, r, cfg.legacyRFB) })
	}
	if cfg.unoURL != "" {
		mux.HandleFunc("/api/uno", unoAPIHandler(cfg.unoURL))
	}
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) { serveHealth(w, r, cfg) })
	return gatewaySecurityHeaders(mux)
}

func normalizedLimit(value int) int {
	if value < 1 {
		return 8
	}
	return value
}

func limitedWebSocket(gate chan struct{}, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		select {
		case gate <- struct{}{}:
			defer func() { <-gate }()
			next(w, r)
		default:
			http.Error(w, "connection limit reached", http.StatusServiceUnavailable)
		}
	}
}

func gatewaySecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), clipboard-read=(self), clipboard-write=(self)")
		next.ServeHTTP(w, r)
	})
}

func serveEmbeddedHTML(w http.ResponseWriter, content []byte) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(content)
}

func serveHealth(w http.ResponseWriter, r *http.Request, cfg config) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status": "ok", "uptimeSeconds": time.Since(gatewayStarted).Seconds(),
		"activeRfbConnections": metrics.activeRFB.Load(), "totalRfbConnections": metrics.totalRFB.Load(),
		"activeInputConnections": metrics.activeInput.Load(), "totalInputConnections": metrics.totalInput.Load(),
		"rfbToBrowserBytes": metrics.rfbToBrowser.Load(), "browserToRfbBytes": metrics.browserToRFB.Load(),
		"textLogLevel": normalizedTextLogLevel(cfg.textLogLevel),
		"textRequests": metrics.textRequests.Load(), "textErrors": metrics.textErrors.Load(),
		"textInputBytes": metrics.textBytes.Load(), "textServerMicroseconds": metrics.textMicros.Load(),
		"clipboard": map[string]any{"enabled": cfg.clipboardSocket != "", "protocolVersion": 1},
	})
}
