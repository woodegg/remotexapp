package main

import (
	"bytes"
	"errors"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/woodegg/remotexapp/internal/kasmbundle"
)

// Native mode owns only a bounded same-origin WSS proxy and pinned assets.
// It does not initialize XFixes, IBus, clipboard or the old input bridge.
func nativeKasmHandler(cfg config) (http.Handler, error) {
	for _, address := range []string{cfg.listen, cfg.vncAddr} {
		host, _, err := net.SplitHostPort(address)
		if err != nil || host != "127.0.0.1" {
			return nil, errors.New("native gateway and upstream must use IPv4 loopback")
		}
	}
	bundle, err := kasmbundle.Load(cfg.nativeBundle, cfg.nativeDigest)
	if err != nil {
		return nil, err
	}
	assets := map[string][]byte{}
	for name, digest := range bundle.Manifest.Files {
		if !strings.HasPrefix(name, "web/") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(bundle.Pin.Directory, name))
		if err != nil || kasmbundle.Digest(data) != digest {
			return nil, errors.New("native asset changed during load")
		}
		assets[strings.TrimPrefix(name, "web/")] = data
	}
	target := &url.URL{Scheme: "http", Host: cfg.vncAddr}
	proxy := httputil.NewSingleHostReverseProxy(target)
	director := proxy.Director
	proxy.Director = func(r *http.Request) {
		director(r)
		r.URL.Path, r.URL.RawPath, r.URL.RawQuery = "/websockify", "", ""
		// Authentication ends at the Manager. Forward only protocol headers,
		// including no site-specific identity/token or proxy metadata headers.
		incoming := r.Header
		r.Header = make(http.Header)
		for _, name := range []string{"Origin", "Connection", "Upgrade", "Sec-WebSocket-Key", "Sec-WebSocket-Version", "Sec-WebSocket-Protocol", "Sec-WebSocket-Extensions"} {
			if values, ok := incoming[http.CanonicalHeaderKey(name)]; ok {
				r.Header[http.CanonicalHeaderKey(name)] = append([]string(nil), values...)
			}
		}
		// A nil slice suppresses ReverseProxy's automatic source-IP header.
		r.Header["X-Forwarded-For"] = nil
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		http.Error(w, "native display unavailable", http.StatusBadGateway)
	}
	gate := make(chan struct{}, normalizedLimit(cfg.maxRFBConnections))
	ws := limitedWebSocket(gate, func(w http.ResponseWriter, r *http.Request) {
		origin, err := url.Parse(r.Header.Get("Origin"))
		if err != nil || (origin.Scheme != "http" && origin.Scheme != "https") || origin.Host != r.Host || origin.User != nil || origin.Path != "" || origin.RawQuery != "" || origin.Fragment != "" {
			http.Error(w, "same-origin browser required", http.StatusForbidden)
			return
		}
		if r.Method != http.MethodGet || !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
			http.Error(w, "WebSocket upgrade required", http.StatusBadRequest)
			return
		}
		metrics.activeRFB.Add(1)
		defer metrics.activeRFB.Add(-1)
		metrics.totalRFB.Add(1)
		proxy.ServeHTTP(w, r)
	})
	return gatewaySecurityHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/websockify" {
			ws(w, r)
			return
		}
		if r.URL.Path == "/healthz" {
			serveHealth(w, r, cfg)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "GET or HEAD required", http.StatusMethodNotAllowed)
			return
		}
		name := strings.TrimPrefix(r.URL.Path, "/")
		data, ok := assets[name]
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		if strings.HasSuffix(name, ".js") {
			w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		}
		if strings.HasSuffix(name, ".wasm") {
			w.Header().Set("Content-Type", "application/wasm")
		}
		http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(data))
	})), nil
}
