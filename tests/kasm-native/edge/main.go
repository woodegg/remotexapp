// Trusted, deployment-owned ingress for the bounded native UDP UAT. Run outside
// the desktop namespace, on loopback behind an Access-verifying connector.
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"github.com/woodegg/remotexapp/internal/nativewire"
)

type asset struct {
	File   string `json:"file"`
	SHA256 string `json:"sha256"`
	Type   string `json:"type"`
	data   []byte
}
type configuration struct {
	Origin     string           `json:"origin"`
	Backend    string           `json:"backend"`
	Assets     map[string]asset `json:"assets"`
	Components map[string]asset `json:"components"`
}

var nativeRoute = regexp.MustCompile(`^/rx/remotexapps/[a-zA-Z0-9_-]+/(kiosk\.html|native/(client\.js|websockify|prepare|grant|lease|revoke))$`)
var digestPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

func loadConfig(name string) (configuration, error) {
	var c configuration
	raw, err := os.ReadFile(name)
	if err != nil {
		return c, err
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err = d.Decode(&c); err != nil {
		return c, err
	}
	for _, assets := range []map[string]asset{c.Assets, c.Components} {
		for key, a := range assets {
			if !filepath.IsLocal(a.File) || !digestPattern.MatchString(a.SHA256) {
				return c, fmt.Errorf("invalid asset pin")
			}
			a.data, err = os.ReadFile(filepath.Join(filepath.Dir(name), a.File))
			if err != nil {
				return c, err
			}
			h := sha256.Sum256(a.data)
			if hex.EncodeToString(h[:]) != a.SHA256 {
				return c, fmt.Errorf("asset integrity mismatch")
			}
			assets[key] = a
		}
	}
	return c, nil
}

// Allowlist headers instead of trying to enumerate all address-bearing headers.
// Access cookies/JWTs terminate at the trusted connector and never enter UAT.
func upstreamHeaders(r *http.Request) http.Header {
	h := make(http.Header)
	for _, key := range []string{"Content-Type", "Accept", "Origin", "Sec-WebSocket-Protocol"} {
		if value := r.Header.Get(key); value != "" {
			h.Set(key, value)
		}
	}
	return h
}

func edgeHandler(c configuration) (http.Handler, error) {
	origin, err := url.Parse(c.Origin)
	if err != nil || origin.Scheme != "https" || origin.Host == "" || origin.Path != "" || origin.User != nil {
		return nil, fmt.Errorf("invalid public origin")
	}
	target, err := url.Parse(c.Backend)
	if err != nil || target.Scheme != "http" || target.Host == "" || target.Path != "" || target.User != nil {
		return nil, fmt.Errorf("invalid private backend")
	}
	proxy := &httputil.ReverseProxy{Rewrite: func(p *httputil.ProxyRequest) {
		p.SetURL(target)
		p.Out.Host = origin.Host
		p.Out.Header = upstreamHeaders(p.In)
	}, ModifyResponse: func(r *http.Response) error {
		if r.StatusCode >= 300 && r.StatusCode < 400 {
			return fmt.Errorf("upstream redirects are unavailable")
		}
		r.Header = make(http.Header)
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Cache-Control", "no-store")
		r.Header.Set("X-Content-Type-Options", "nosniff")
		return nil
	}, ErrorHandler: func(w http.ResponseWriter, _ *http.Request, _ error) {
		http.Error(w, "private backend unavailable", 502)
	}}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		peer, _, _ := net.SplitHostPort(r.RemoteAddr)
		if !net.ParseIP(peer).IsLoopback() || r.Host != origin.Host || (r.Header.Get("Origin") != "" && r.Header.Get("Origin") != c.Origin) {
			http.Error(w, "untrusted ingress", 403)
			return
		}
		if path.Clean(r.URL.Path) != r.URL.Path || strings.Contains(r.URL.Path, "//") {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		a, found := c.Assets[r.URL.Path]
		match := nativeRoute.FindStringSubmatch(r.URL.Path)
		if match != nil && match[1] == "kiosk.html" {
			a, found = c.Assets["native-viewer"]
		}
		if match != nil && match[2] == "client.js" {
			pins := r.URL.Query()["componentDigest"]
			if len(pins) != 1 || !digestPattern.MatchString(pins[0]) {
				http.Error(w, "invalid component pin", 409)
				return
			}
			a, found = c.Components[pins[0]]
			if !found {
				http.Error(w, "component is not trusted by this edge", 409)
				return
			}
		}
		if found {
			if r.Method != "GET" && r.Method != "HEAD" {
				http.Error(w, "method unavailable", 405)
				return
			}
			w.Header().Set("Content-Type", a.Type)
			http.ServeContent(w, r, "asset", time.Time{}, bytes.NewReader(a.data))
			return
		}
		if match != nil && match[2] == "websockify" {
			if _, ok := c.Components[r.URL.Query().Get("componentDigest")]; !ok {
				http.Error(w, "component is not trusted by this edge", 409)
				return
			}
			bridge(w, r, target)
			return
		}
		if r.URL.Path == "/fixture-config" || strings.HasPrefix(r.URL.Path, "/rx/api/") || (match != nil && (match[2] == "prepare" || match[2] == "grant" || match[2] == "lease" || match[2] == "revoke")) {
			r.Body = http.MaxBytesReader(w, r.Body, 1024*1024)
			proxy.ServeHTTP(w, r)
			return
		}
		http.NotFound(w, r)
	}), nil
}

// The pinned native decoder ignores continuation frames and rejects frames over
// 65535 bytes. Match the write buffer to each independent binary message.
const nativeFrameBytes = 16 * 1024

func bridge(w http.ResponseWriter, r *http.Request, target *url.URL) {
	if !websocket.IsWebSocketUpgrade(r) || r.Method != "GET" {
		http.Error(w, "WebSocket required", 400)
		return
	}
	u := *r.URL
	u.Scheme = "ws"
	u.Host = target.Host
	headers := upstreamHeaders(r)
	protocol := headers.Get("Sec-WebSocket-Protocol")
	headers.Del("Sec-WebSocket-Protocol")
	headers.Set("Host", r.Host)
	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second, WriteBufferSize: nativeFrameBytes}
	if protocol != "" {
		dialer.Subprotocols = []string{protocol}
	}
	up, resp, err := dialer.DialContext(r.Context(), u.String(), headers)
	if err != nil {
		code := http.StatusBadGateway
		if resp != nil {
			if resp.StatusCode == 403 || resp.StatusCode == 409 {
				code = resp.StatusCode
			}
			resp.Body.Close()
		}
		http.Error(w, "native Viewer upgrade rejected", code)
		return
	}
	defer up.Close()
	// The upstream has already accepted the grant (or legacy binary protocol).
	// Browsers require the offered subprotocol to be acknowledged explicitly.
	upgrade := websocket.Upgrader{Subprotocols: dialer.Subprotocols, CheckOrigin: func(*http.Request) bool { return true }}
	client, err := upgrade.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer client.Close()
	client.SetReadLimit(nativewire.MaxBuffered)
	up.SetReadLimit(8 * 1024 * 1024)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	heartbeatDone := browserHeartbeat(ctx, client, 20*time.Second, 60*time.Second)
	defer func() { cancel(); <-heartbeatDone }()
	done := make(chan struct{})
	go func() {
		defer close(done)
		defer cancel()
		defer up.Close()
		defer client.Close()
		var filter nativewire.ClientFilter
		for {
			kind, payload, e := client.ReadMessage()
			if e != nil {
				return
			}
			if kind != websocket.BinaryMessage {
				return
			}
			payload, e = filter.Feed(payload)
			if e != nil {
				return
			}
			if len(payload) == 0 {
				continue
			}
			up.SetWriteDeadline(time.Now().Add(15 * time.Second))
			for len(payload) > 0 {
				n := min(len(payload), nativeFrameBytes)
				if up.WriteMessage(websocket.BinaryMessage, payload[:n]) != nil {
					return
				}
				payload = payload[n:]
			}
		}
	}()
	for ctx.Err() == nil {
		kind, payload, e := up.ReadMessage()
		if e != nil {
			break
		}
		if kind != websocket.BinaryMessage {
			break
		}
		client.SetWriteDeadline(time.Now().Add(15 * time.Second))
		if client.WriteMessage(kind, payload) != nil {
			break
		}
	}
	client.Close()
	up.Close()
	<-done
}

// HTTP grant renewals do not keep an idle WebSocket alive through an edge.
// Browser-native pong replies are independent of background JavaScript timers.
// Control frames terminate here and never count as application activity.
func browserHeartbeat(ctx context.Context, client *websocket.Conn, interval, timeout time.Duration) <-chan struct{} {
	done := make(chan struct{})
	client.SetReadDeadline(time.Now().Add(timeout))
	client.SetPongHandler(func(string) error {
		return client.SetReadDeadline(time.Now().Add(timeout))
	})
	go func() {
		defer close(done)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := client.WriteControl(websocket.PingMessage, nil, time.Now().Add(interval)); err != nil {
					client.Close()
					return
				}
			}
		}
	}()
	return done
}

func main() {
	listen := flag.String("listen", "127.0.0.1:8082", "loopback connector listener")
	config := flag.String("config", "", "pinned trusted edge asset configuration")
	flag.Parse()
	host, _, err := net.SplitHostPort(*listen)
	if err != nil || !net.ParseIP(host).IsLoopback() {
		log.Fatal("edge must listen on loopback")
	}
	c, err := loadConfig(*config)
	if err != nil {
		log.Fatal(err)
	}
	h, err := edgeHandler(c)
	if err != nil {
		log.Fatal(err)
	}
	s := http.Server{Addr: *listen, Handler: h, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16384}
	log.Fatal(s.ListenAndServe())
}
