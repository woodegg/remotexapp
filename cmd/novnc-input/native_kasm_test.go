package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/woodegg/remotexapp/internal/testfixture"
)

func TestNativeGatewayAssetsOriginAndPrivateUpstream(t *testing.T) {
	p := testfixture.Kasm(t)
	seen := make(chan http.Header, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/websockify" || r.URL.RawQuery != "" {
			t.Error("upstream path or query leaked")
		}
		seen <- r.Header.Clone()
		c, err := (&websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close()
		kind, data, err := c.ReadMessage()
		if err == nil {
			_ = c.WriteMessage(kind, data)
		}
	}))
	defer upstream.Close()
	cfg := config{listen: "127.0.0.1:0", vncAddr: strings.TrimPrefix(upstream.URL, "http://"), nativeBundle: p.Directory, nativeDigest: p.SHA256, maxRFBConnections: 1}
	h, err := nativeKasmHandler(cfg)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(h)
	defer server.Close()
	for _, path := range []string{"/api/users", "/manifest.json", "/SOURCE.json", "/input", "/clipboard"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 404 {
			t.Fatalf("private path %s available: %d", path, w.Code)
		}
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/client.js", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), "synthetic test fixture") {
		t.Fatal("pinned asset not served")
	}
	url := "ws" + strings.TrimPrefix(server.URL, "http") + "/websockify?sessionGeneration=4"
	for _, origin := range []string{"", "https://foreign.invalid", server.URL + "/path"} {
		c, resp, err := websocket.DefaultDialer.Dial(url, http.Header{"Origin": {origin}})
		if c != nil {
			c.Close()
		}
		if err == nil || resp == nil || resp.StatusCode != 403 {
			t.Fatalf("unsafe Origin accepted: %s", origin)
		}
	}
	headers := http.Header{"Origin": {server.URL}, "Authorization": {"secret"}, "Cookie": {"secret"}, "X-Site-Identity": {"fixture"}, "X-Forwarded-For": {"192.0.2.1"}, "CF-Connecting-IP": {"192.0.2.1"}, "Forwarded": {"for=192.0.2.1"}}
	c, _, err := websocket.DefaultDialer.Dial(url, headers)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	c.SetReadDeadline(time.Now().Add(time.Second))
	if err := c.WriteMessage(websocket.BinaryMessage, []byte("fixture")); err != nil {
		t.Fatal(err)
	}
	if _, data, err := c.ReadMessage(); err != nil || string(data) != "fixture" {
		t.Fatalf("relay: %v", err)
	}
	got := <-seen
	for _, key := range []string{"Authorization", "Cookie", "X-Site-Identity", "X-Forwarded-For", "CF-Connecting-IP", "Forwarded"} {
		if got.Get(key) != "" {
			t.Fatalf("private header forwarded: %s", key)
		}
	}
	cfg.listen = "0.0.0.0:8080"
	if _, err := nativeKasmHandler(cfg); err == nil {
		t.Fatal("non-loopback native gateway accepted")
	}
}
