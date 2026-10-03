package main

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func connectionFixture(t *testing.T) (*manager, *instance, func(map[string]any)) {
	t.Helper()
	m, item, runtime := newEnvironmentFixture(t, []byte("SECRET=not-for-connections\x00"))
	item.Spec.RunMode = "isolated"
	item.Spec.Session.Status.PrivateDetails = map[string]parameterDefinition{"application": {Type: "json", MaxBytes: 4096, MaxDepth: 4, MaxItems: 32}}
	item.Display = ":77"
	socket := filepath.Join(t.TempDir(), "bus")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	write := func(app map[string]any) {
		status := applicationStatus{Generation: 3, Revision: 1, State: "ready", Details: map[string]any{"sessionBus": map[string]any{"address": "unix:path=" + socket, "scope": "runtime"}}}
		if app != nil {
			status.Details["application"] = app
		}
		data, _ := json.Marshal(status)
		if err := os.WriteFile(filepath.Join(runtime, "connection-status.json"), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	write(map[string]any{"protocol": "dbus", "service": "org.example.private", "objectPath": "/private"})
	return m, item, write
}

func connectionRequest(m *manager, id, query, token string) *httptest.ResponseRecorder {
	r := httptest.NewRequest("GET", "/api/instances/"+id+"/connections"+query, nil)
	if token != "" {
		r.Header.Set(connectionsHeader, token)
	}
	w := httptest.NewRecorder()
	m.handler().ServeHTTP(w, r)
	return w
}

func TestConnectionAuthorizationAndProjection(t *testing.T) {
	m, item, _ := connectionFixture(t)
	for _, token := range []string{"", strings.Repeat("b", 64)} {
		w := connectionRequest(m, item.ID, "", token)
		if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal(w.Code, w.Body)
		}
	}
	m.cfg.allowInsecure = true
	m.cfg.exposeInternals = true
	if w := connectionRequest(m, item.ID, "", ""); w.Code != 200 {
		t.Fatal(w.Code)
	}
	good := strings.Repeat("a", 64)
	w := connectionRequest(m, item.ID, "?sessionGeneration=3", good)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body)
	}
	var value connectionDescriptor
	if err := json.Unmarshal(w.Body.Bytes(), &value); err != nil {
		t.Fatal(err)
	}
	if value.Environment.SessionBus.Scope != "runtime" || value.Application["protocol"] != "dbus" || value.Revision == "" {
		t.Fatal(value)
	}
	if strings.Contains(w.Body.String(), "SECRET") {
		t.Fatal("environment leak")
	}
	for _, path := range []string{"/api/instances/" + item.ID, "/api/instances/" + item.ID + "/status", "/api/instances"} {
		out := httptest.NewRecorder()
		m.handler().ServeHTTP(out, httptest.NewRequest("GET", path, nil))
		if strings.Contains(out.Body.String(), "org.example.private") || strings.Contains(out.Body.String(), "unix:path=") {
			t.Fatal("private descriptor leaked", path)
		}
	}
	for _, q := range []string{"?sessionGeneration=0", "?sessionGeneration=abc", "?sessionGeneration=3&sessionGeneration=3"} {
		if out := connectionRequest(m, item.ID, q, good); out.Code != 400 {
			t.Fatal(q, out.Code)
		}
	}
	if out := connectionRequest(m, item.ID, "?sessionGeneration=2", good); out.Code != 409 {
		t.Fatal(out.Code)
	}
	if out := connectionRequest(m, item.ID, "", good); out.Code != 200 {
		t.Fatal(out.Code)
	}
}

func TestConnectionRevisionLifecycleAndLegacy(t *testing.T) {
	m, item, write := connectionFixture(t)
	first, err := m.connections(item)
	if err != nil {
		t.Fatal(err)
	}
	second, err := m.connections(item)
	if err != nil || second.Revision != first.Revision {
		t.Fatal(second, err)
	}
	write(map[string]any{"protocol": "dbus", "service": "org.example.replaced"})
	changed, err := m.connections(item)
	if err != nil || changed.Revision == first.Revision {
		t.Fatal(changed, err)
	}
	for _, state := range []string{"stopped", "starting", "shutdown-blocked", "failed"} {
		item.SessionState = state
		if _, err := m.connections(item); err == nil {
			t.Fatal(state)
		}
	}
	item.SessionState = "running"
	item.SessionGeneration = 4
	if _, err := m.connections(item); err == nil {
		t.Fatal("accepted stale generation")
	}
	item.SessionGeneration = 3
	item.Spec.Session.Status.PrivateDetails = nil
	if err := os.Remove(filepath.Join(item.Runtime, "connection-status.json")); err != nil {
		t.Fatal(err)
	}
	old, err := m.connections(item)
	if err != nil || old.Environment.SessionBus != nil || len(old.Unavailable) != 2 || old.UnavailableReasons["ibus"] != "metadata-missing" || old.Application != nil {
		t.Fatal(old, err)
	}
}

func TestConnectionRejectsInvalidMetadataAndProcess(t *testing.T) {
	for _, payload := range []string{
		"{}",
		`{"generation":2,"revision":1,"state":"ready"}`,
		`{"generation":3,"revision":2,"state":"ready"}`,
		`{"generation":3,"revision":1,"state":"ready","details":{"undeclared":"secret"}}`,
		`{"generation":3,"revision":1,"state":"ready","details":{"application":{"protocol":"dbus"},"sessionBus":{"scope":"runtime","address":"tcp:host=localhost,port=123"}}}`,
		strings.Repeat("x", 65537),
	} {
		t.Run(payload[:min(len(payload), 35)], func(t *testing.T) {
			m, item, _ := connectionFixture(t)
			os.WriteFile(filepath.Join(item.Runtime, "connection-status.json"), []byte(payload), 0600)
			if w := connectionRequest(m, item.ID, "", strings.Repeat("a", 64)); w.Code != 409 || strings.Contains(w.Body.String(), "secret") {
				t.Fatal(w.Code, w.Body)
			}
		})
	}
	m, item, _ := connectionFixture(t)
	os.Remove(filepath.Join(item.Runtime, item.Spec.Session.ReadinessPID))
	if _, err := m.connections(item); err == nil {
		t.Fatal("accepted missing canonical PID")
	}
}

func TestConnectionPublicControlsAndSharedBus(t *testing.T) {
	for _, protocol := range []string{"cdp", "webdriver-bidi", "libreoffice-uno"} {
		t.Run(protocol, func(t *testing.T) {
			m, item, write := connectionFixture(t)
			item.Spec.Session.Status.PrivateDetails = nil
			item.Spec.Session.Status.Details = map[string]parameterDefinition{"control": {Type: "json", MaxBytes: 4096, MaxDepth: 4, MaxItems: 32}}
			write(nil)
			status, _ := readApplicationStatus(item.Runtime)
			status.Details = map[string]any{"control": map[string]any{"protocol": protocol, "address": "127.0.0.1", "port": float64(21001)}}
			data, _ := json.Marshal(status)
			os.WriteFile(statusPath(item.Runtime), data, 0600)
			got, err := m.connections(item)
			if err != nil || got.Application["protocol"] != protocol {
				t.Fatal(got, err)
			}
		})
	}
	m, item, write := connectionFixture(t)
	item.Spec.Session.Status.PrivateDetails = nil
	write(nil)
	item.Spec.RunMode = "user-home"
	path := filepath.Join(item.Runtime, "connection-status.json")
	raw, _ := os.ReadFile(path)
	os.WriteFile(path, []byte(strings.Replace(string(raw), `"scope":"runtime"`, `"scope":"user"`, 1)), 0600)
	got, err := m.connections(item)
	if err != nil || got.Environment.SessionBus.Scope != "user" || got.Application != nil {
		t.Fatal(got, err)
	}
}

func TestConnectionsRetainManagerSecurity(t *testing.T) {
	m, item, _ := connectionFixture(t)
	m.cfg.authMode = "trusted-header"
	m.cfg.identityHeader = "X-Remote-User"
	_, network, _ := net.ParseCIDR("127.0.0.0/8")
	m.cfg.trustedProxyNetworks = []*net.IPNet{network}
	for _, tc := range []struct {
		name, remote, identity, origin string
		status                         int
	}{
		{"missing identity", "127.0.0.1:1234", "", "", 401},
		{"untrusted proxy", "192.0.2.1:1234", "operator", "", 401},
		{"trusted identity", "127.0.0.1:1234", "operator", "", 200},
		{"cross origin", "127.0.0.1:1234", "operator", "https://foreign.example", 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/api/instances/"+item.ID+"/connections", nil)
			r.RemoteAddr = tc.remote
			r.Header.Set("X-Remote-User", tc.identity)
			if tc.origin != "" {
				r.Header.Set("Origin", tc.origin)
			}
			w := httptest.NewRecorder()
			m.handler().ServeHTTP(w, r)
			if w.Code != tc.status {
				t.Fatalf("got %d: %s", w.Code, w.Body)
			}
		})
	}
}
