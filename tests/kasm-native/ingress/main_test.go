package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestFixtureTrustBoundary(t *testing.T) {
	calls := 0
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("X-RemoteXApp-Test-User") != "alpine-uat" || r.URL.Path != "/api/instances" {
			t.Errorf("identity or rewritten path incorrect")
		}
		_, _ = io.WriteString(w, "proxied")
	}))
	defer backend.Close()
	target, _ := url.Parse(backend.URL)
	h := handler(target, []byte("fixture"), fixture{BaseURL: "/rx"}, "192.0.2.1")
	for _, tc := range []struct {
		peer, path string
		code       int
	}{
		{"192.0.2.2:1234", "/rx/api/instances", 403},
		{"192.0.2.1:1234", "/rx/api/instances", 200},
		{"127.0.0.1:1234", "/rx/api/instances", 200},
		{"192.0.2.1:1234", "/", 200},
		{"192.0.2.1:1234", "/fixture-config", 200},
		{"192.0.2.1:1234", "/rx-spoof/api/instances", 404},
		{"192.0.2.1:1234", "/etc/passwd", 404},
	} {
		r := httptest.NewRequest("GET", tc.path, nil)
		r.RemoteAddr = tc.peer
		r.Header.Set("X-RemoteXApp-Test-User", "spoofed")
		r.Header.Set("X-Forwarded-For", "192.0.2.1")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != tc.code {
			t.Errorf("%s %s: %d, want %d", tc.peer, tc.path, w.Code, tc.code)
		}
	}
	if calls != 2 {
		t.Fatalf("unexpected upstream calls: %d", calls)
	}
}
