package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestClipboardPreviewImagePolicy(t *testing.T) {
	w := httptest.NewRecorder()
	setSecurityHeaders(w)
	policy := w.Header().Get("Content-Security-Policy")
	if !strings.Contains(policy, "img-src 'self' data: blob:;") {
		t.Fatalf("clipboard SVG/thumbnail image policy missing: %s", policy)
	}
	if !strings.Contains(policy, "script-src 'self' 'unsafe-inline';") || strings.Contains(policy, "script-src 'self' 'unsafe-inline' blob:") {
		t.Fatal("image previews must not enable blob scripts")
	}
}

func TestTrustedHeaderAuthentication(t *testing.T) {
	networks, err := parseTrustedNetworks("127.0.0.0/8,::1/128")
	if err != nil {
		t.Fatal(err)
	}
	m := &manager{cfg: config{authMode: "trusted-header", identityHeader: "X-Remote-User", trustedProxyNetworks: networks, classes: map[string]classConfig{"test": {ID: "test"}}}}

	request := httptest.NewRequest(http.MethodGet, "/api/version", nil)
	request.RemoteAddr = "127.0.0.1:54321"
	response := httptest.NewRecorder()
	m.handler().ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("missing identity = %d, want 401", response.Code)
	}

	request = httptest.NewRequest(http.MethodGet, "/api/version", nil)
	request.RemoteAddr = "127.0.0.1:54321"
	request.Header.Set("X-Remote-User", "operator@example.com")
	response = httptest.NewRecorder()
	m.handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("trusted identity = %d body=%s", response.Code, response.Body.String())
	}

	request = httptest.NewRequest(http.MethodGet, "/api/version", nil)
	request.RemoteAddr = "192.0.2.20:54321"
	request.Header.Set("X-Remote-User", "forged@example.com")
	response = httptest.NewRecorder()
	m.handler().ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("untrusted proxy = %d, want 401", response.Code)
	}
}

func TestHealthAndReadyBypassAuthentication(t *testing.T) {
	m := &manager{cfg: config{authMode: "trusted-header", classes: map[string]classConfig{"test": {ID: "test"}}}, instances: map[string]*instance{}}
	for _, path := range []string{"/healthz", "/readyz"} {
		response := httptest.NewRecorder()
		m.handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusOK {
			t.Errorf("GET %s = %d body=%s", path, response.Code, response.Body.String())
		}
	}
}

func TestManagerRejectsCrossOrigin(t *testing.T) {
	m := &manager{cfg: config{authMode: "none", classes: map[string]classConfig{"test": {ID: "test"}}}}
	request := httptest.NewRequest(http.MethodPost, "http://remote.example/api/instances", nil)
	request.Header.Set("Origin", "https://remote.example.attacker.test")
	response := httptest.NewRecorder()
	m.handler().ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("cross origin = %d, want 403", response.Code)
	}
}

func TestRequestIDIsValidatedBeforeReflection(t *testing.T) {
	m := &manager{cfg: config{authMode: "none", classes: map[string]classConfig{"test": {ID: "test"}}}}
	request := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	request.Header.Set("X-Request-ID", strings.Repeat("x", 129))
	response := httptest.NewRecorder()
	m.handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Header().Get("X-Request-ID") == request.Header.Get("X-Request-ID") || !validRequestID(response.Header().Get("X-Request-ID")) {
		t.Fatalf("invalid request ID was not replaced: %q", response.Header().Get("X-Request-ID"))
	}
}

func TestPublicInstanceRedactsHostInternals(t *testing.T) {
	m := &manager{cfg: config{exposeInternals: false}}
	item := &instance{ID: "test", ControlAddress: "127.0.0.1", ControlPort: 21000, ControlWebSocketURL: "ws://127.0.0.1:21000/session", Home: "/private/home", XAuthority: "/private/runtime/Xauthority", Runtime: "/private/runtime", SocketRuntime: "/run/private", RFBAddr: "127.0.0.1:5902", GatewayAddr: "127.0.0.1:39002", VNCUnit: "secret.service"}
	public := m.publicInstance(item)
	if public.Home != "" || public.XAuthority != "" || public.Runtime != "" || public.SocketRuntime != "" || public.RFBAddr != "" || public.GatewayAddr != "" || public.VNCUnit != "" {
		t.Fatalf("public instance leaks internals: %#v", public)
	}
	if item.Home == "" {
		t.Fatal("redaction mutated manager-owned instance")
	}
	control := public.Resources["control"]
	if control.Address != "127.0.0.1" || control.Port != 21000 || control.Kind != "loopback-tcp" {
		t.Fatalf("public instance omitted the generic application resource: %#v", public)
	}
	payload, err := json.Marshal(public)
	if err != nil {
		t.Fatal(err)
	}
	for _, legacy := range []string{"controlAddress", "controlPort", "controlWebSocketUrl"} {
		if strings.Contains(string(payload), `"`+legacy+`"`) {
			t.Fatalf("public instance exposes legacy field %q: %s", legacy, payload)
		}
	}
}

func TestActiveInstanceLimit(t *testing.T) {
	class, timeout := neutralAppTemplate()
	m := &manager{
		cfg:       config{classes: map[string]classConfig{class.ID: class}, vacantTimeouts: map[string]time.Duration{class.ID: timeout}, maxInstances: 1},
		instances: map[string]*instance{"existing": {ID: "existing", ClassID: class.ID, State: "server-ready"}},
	}
	if _, err := m.create(createRequest{TemplateID: class.ID}); err == nil || !strings.Contains(err.Error(), "instance limit") {
		t.Fatalf("create error = %v, want instance limit", err)
	}
}
