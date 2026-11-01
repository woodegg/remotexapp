package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/woodegg/remotexapp/internal/sessionaudio"
)

func audioTestServer(t *testing.T, a *audioService) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		identity := r.Header.Get("X-Test-Identity")
		if identity == "" {
			identity = "test-user"
		}
		r = r.WithContext(context.WithValue(r.Context(), requestIdentityKey{}, identity))
		a.serve(w, r)
	}))
	t.Cleanup(server.Close)
	return server
}
func audioTestClient(t *testing.T) *http.Client {
	t.Helper()
	jar, _ := cookiejar.New(nil)
	return &http.Client{Jar: jar, Timeout: 3 * time.Second}
}
func audioPost(t *testing.T, client *http.Client, base, action, identity string, body any) (int, map[string]any) {
	t.Helper()
	data, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", base+"/api/audio/"+action, bytes.NewReader(data))
	if identity != "" {
		req.Header.Set("X-Test-Identity", identity)
	}
	response, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var result map[string]any
	if err = json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	return response.StatusCode, result
}
func audioDial(t *testing.T, client *http.Client, server *httptest.Server, token, identity string) (*websocket.Conn, int) {
	t.Helper()
	req, _ := http.NewRequest("GET", server.URL, nil)
	headers := http.Header{}
	for _, cookie := range client.Jar.Cookies(req.URL) {
		headers.Add("Cookie", cookie.String())
	}
	if identity != "" {
		headers.Set("X-Test-Identity", identity)
	}
	d := websocket.Dialer{Subprotocols: []string{audioGrantPrefix + token}, HandshakeTimeout: time.Second}
	c, response, err := d.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/api/audio/ws", headers)
	if response != nil && response.StatusCode != 101 {
		defer response.Body.Close()
		return c, response.StatusCode
	}
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Close() })
	return c, 101
}
func TestAudioScopeReplayPrincipalLogoutAndExpiry(t *testing.T) {
	a := newAudioService("test", func(string, int64) (sessionaudio.Record, error) { return sessionaudio.Record{}, nil })
	server := audioTestServer(t, a)
	client := audioTestClient(t)
	status, ctx := audioPost(t, client, server.URL, "context", "alice", audioRequest{})
	if status != 200 {
		t.Fatal(ctx)
	}
	scope := ctx["scope"].(string)
	request := audioRequest{Scope: scope, Client: "coordinator-a"}
	status, grant := audioPost(t, client, server.URL, "grant", "alice", request)
	if status != 200 {
		t.Fatal(grant)
	}
	token := grant["token"].(string)
	if _, status = audioDial(t, client, server, token, "bob"); status != 403 {
		t.Fatal("cross-principal upgrade accepted")
	}
	conn, status := audioDial(t, client, server, token, "alice")
	if status != 101 {
		t.Fatal("authorized upgrade rejected")
	}
	var connected map[string]any
	if err := conn.ReadJSON(&connected); err != nil {
		t.Fatal(err)
	}
	request.Connection = connected["connection"].(string)
	if _, status = audioDial(t, client, server, token, "alice"); status != 403 {
		t.Fatal("one-use token replay accepted")
	}
	if status, _ = audioPost(t, client, server.URL, "grant", "alice", request); status != 409 {
		t.Fatal("two simultaneous scoped channels accepted")
	}
	if status, _ = audioPost(t, client, server.URL, "renew", "bob", request); status != 403 {
		t.Fatal("foreign principal renewed lease")
	}
	if status, _ = audioPost(t, client, server.URL, "renew", "alice", request); status != 200 {
		t.Fatal("renew failed")
	}
	if status, _ = audioPost(t, client, server.URL, "logout", "alice", request); status != 200 {
		t.Fatal("logout failed")
	}
	_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	if _, _, err := conn.ReadMessage(); err == nil {
		t.Fatal("logout retained wire")
	}
	if status, _ = audioPost(t, client, server.URL, "renew", "alice", request); status != 403 {
		t.Fatal("retired scope renewed")
	}
	_, ctx = audioPost(t, client, server.URL, "context", "alice", audioRequest{})
	if ctx["scope"] == scope {
		t.Fatal("logout did not change epoch")
	}
	request = audioRequest{Scope: ctx["scope"].(string), Client: "b"}
	_, grant = audioPost(t, client, server.URL, "grant", "alice", request)
	key, _ := grantKey(grant["token"].(string))
	a.mu.Lock()
	a.grants[key].expires = time.Now().Add(-time.Second)
	a.mu.Unlock()
	if _, status = audioDial(t, client, server, grant["token"].(string), "alice"); status != 403 {
		t.Fatal("expired token accepted")
	}
}

func TestAudioAccountChangeRevokesPreviousScope(t *testing.T) {
	a := newAudioService("test", nil)
	server := audioTestServer(t, a)
	client := audioTestClient(t)
	_, ctx := audioPost(t, client, server.URL, "context", "alice", audioRequest{})
	request := audioRequest{Scope: ctx["scope"].(string), Client: "a"}
	_, grant := audioPost(t, client, server.URL, "grant", "alice", request)
	conn, _ := audioDial(t, client, server, grant["token"].(string), "alice")
	var hello any
	_ = conn.ReadJSON(&hello)
	_, fresh := audioPost(t, client, server.URL, "context", "bob", audioRequest{})
	if fresh["scope"] == ctx["scope"] {
		t.Fatal("account epoch unchanged")
	}
	_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	if _, _, err := conn.ReadMessage(); err == nil {
		t.Fatal("old account retained channel")
	}
}

// Long-lived fixture only when explicitly invoked by the owned browser harness.
// Hooks below are compiled into the Go test binary, never the product binary.
func TestAudioBrowserFixture(t *testing.T) {
	output := os.Getenv("REMOTEXAPP_AUDIO_FIXTURE")
	if output == "" {
		t.Skip("owned live browser fixture not requested")
	}
	if os.Getuid() == 0 {
		t.Fatal("requires non-root UID")
	}
	if err := sessionaudio.CheckDependencies(); err != nil {
		t.Fatal(err)
	}
	root, err := os.MkdirTemp("", "rxa-browser-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(root)
	domains := map[string]*sessionaudio.Domain{}
	var domainMu sync.Mutex
	for _, id := range []string{"session-a", "session-b"} {
		d, e := sessionaudio.Prepare(root, 1, os.Environ())
		if e != nil {
			t.Fatal(e)
		}
		defer d.Close()
		if e = d.Start(context.Background()); e != nil {
			t.Fatal(e)
		}
		domains[id] = d
	}
	a := newAudioService("browser-fixture", func(id string, generation int64) (sessionaudio.Record, error) {
		domainMu.Lock()
		defer domainMu.Unlock()
		d := domains[id]
		if d == nil || d.Record.Generation != generation {
			return sessionaudio.Record{}, os.ErrNotExist
		}
		if err := sessionaudio.Validate(d.Record, root, generation); err != nil {
			return sessionaudio.Record{}, err
		}
		return d.Record, nil
	})
	stop := make(chan struct{})
	var stopOnce sync.Once
	handler := http.NewServeMux()
	handler.HandleFunc("/api/audio/", func(w http.ResponseWriter, r *http.Request) {
		identity := "fixture-user"
		if cookie, err := r.Cookie("fixture-principal"); err == nil {
			identity = cookie.Value
		}
		r = r.WithContext(context.WithValue(r.Context(), requestIdentityKey{}, identity))
		a.serve(w, r)
	})
	handler.Handle("/sdk/", http.StripPrefix("/sdk/", http.FileServer(http.Dir("web/sdk"))))
	handler.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html")
		io.WriteString(w, `<!doctype html><meta charset="utf-8"><title>Owned native audio integration fixture</title><button id="activate">Activate audio</button><p>Two private Pulse domains; synthetic audio only.</p>`)
	})
	handler.HandleFunc("/fixture/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			methodNotAllowed(w, "POST")
			return
		}
		var req struct {
			Runtime   string  `json:"runtime"`
			Route     string  `json:"route"`
			Frequency float64 `json:"frequency"`
		}
		if json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&req) != nil {
			writeError(w, 400, "invalid fixture request")
			return
		}
		if r.URL.Path == "/fixture/stop" {
			stopOnce.Do(func() { close(stop) })
			writeJSON(w, 200, map[string]bool{"ok": true})
			return
		}
		domainMu.Lock()
		d := domains[req.Runtime]
		if d == nil {
			domainMu.Unlock()
			writeError(w, 404, "fixture domain not found")
			return
		}
		record := d.Record
		domainMu.Unlock()
		if r.URL.Path == "/fixture/tone" {
			if req.Frequency < 100 || req.Frequency > 2000 {
				writeError(w, 400, "invalid synthetic frequency")
				return
			}
			samples := make([]byte, 48000*2*2)
			for i := 0; i < len(samples)/2; i++ {
				value := int16(6000 * math.Sin(2*math.Pi*req.Frequency*float64(i)/48000))
				binary.LittleEndian.PutUint16(samples[i*2:], uint16(value))
			}
			ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, "pacat", "--playback", "--raw", "--format=s16le", "--rate=48000", "--channels=1", "--latency-msec=20", "--device="+sessionaudio.Speaker)
			cmd.Env = sessionaudio.Environment(record, os.Environ())
			cmd.Stdin = bytes.NewReader(samples)
			if err := cmd.Run(); err != nil {
				writeError(w, 500, "tone failed")
				return
			}
			writeJSON(w, 200, map[string]bool{"played": true})
			return
		}
		if r.URL.Path == "/fixture/readback" {
			if req.Frequency < 100 || req.Frequency > 2000 {
				writeError(w, 400, "invalid synthetic frequency")
				return
			}
			ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
			defer cancel()
			device := sessionaudio.Microphone
			if req.Route == "speaker" {
				device = sessionaudio.Speaker + ".monitor"
			}
			cmd := exec.CommandContext(ctx, "parec", "--raw", "--format=s16le", "--rate=48000", "--channels=1", "--latency-msec=20", "--device="+device)
			cmd.Env = sessionaudio.Environment(record, os.Environ())
			data, _ := cmd.Output()
			peak := 0.0
			rms := 0.0
			const window = 4800
			for offset := 0; offset+window*2 <= len(data); offset += window * 2 {
				re, im, power := 0.0, 0.0, 0.0
				for i := 0; i < window; i++ {
					v := float64(int16(binary.LittleEndian.Uint16(data[offset+i*2:])))
					re += v * math.Cos(2*math.Pi*req.Frequency*float64(i)/48000)
					im += v * math.Sin(2*math.Pi*req.Frequency*float64(i)/48000)
					power += v * v
				}
				amp := 2 * math.Hypot(re, im) / window
				if amp > peak {
					peak = amp
				}
				if v := math.Sqrt(power / window); v > rms {
					rms = v
				}
			}
			writeJSON(w, 200, map[string]any{"samples": len(data) / 2, "frequency": req.Frequency, "amplitude": peak, "peakWindowRMS": rms})
			return
		}
		if r.URL.Path == "/fixture/restart-domain" {
			domainMu.Lock()
			d.Close()
			replacement, e := sessionaudio.Prepare(root, record.Generation, os.Environ())
			if e == nil {
				e = replacement.Start(context.Background())
			}
			if e == nil {
				domains[req.Runtime] = replacement
				t.Cleanup(replacement.Close)
			}
			domainMu.Unlock()
			if e != nil {
				writeError(w, 500, "domain restart failed")
				return
			}
			writeJSON(w, 200, map[string]bool{"replaced": true})
			return
		}
		if r.URL.Path == "/fixture/state" {
			a.mu.Lock()
			connections, readers, writers := 0, 0, 0
			for _, s := range a.scopes {
				if s.connection != nil {
					connections++
				}
			}
			for _, h := range a.hubs {
				if h.reader != nil {
					readers++
				}
				if h.writer != nil {
					writers++
				}
			}
			a.mu.Unlock()
			writeJSON(w, 200, map[string]int{"connections": connections, "readers": readers, "writers": writers})
			return
		}
		http.NotFound(w, r)
	})
	server := httptest.NewServer(handler)
	defer server.Close()
	config := map[string]any{"url": server.URL, "pid": os.Getpid(), "domains": map[string]sessionaudio.Record{"session-a": domains["session-a"].Record, "session-b": domains["session-b"].Record}}
	b, _ := json.Marshal(config)
	if err = os.WriteFile(filepath.Clean(output), b, 0600); err != nil {
		t.Fatal(err)
	}
	select {
	case <-stop:
	case <-time.After(45 * time.Minute):
		t.Error("browser fixture timed out")
	}
	a.mu.Lock()
	for _, s := range a.scopes {
		if s.connection != nil {
			s.connection.closeLocked("fixture-finished")
		}
	}
	a.mu.Unlock()
}

func TestAudioRouteGenerationScopeFencingAndLease(t *testing.T) {
	var mu sync.Mutex
	generation := int64(1)
	domain := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	a := newAudioService("route-test", func(id string, g int64) (sessionaudio.Record, error) {
		mu.Lock()
		defer mu.Unlock()
		if id != "app" || g != generation {
			return sessionaudio.Record{}, os.ErrNotExist
		}
		return sessionaudio.Record{ID: domain, Generation: g, Protocol: sessionaudio.Protocol}, nil
	})
	server := audioTestServer(t, a)
	client := audioTestClient(t)
	_, ctx := audioPost(t, client, server.URL, "context", "alice", audioRequest{})
	request := audioRequest{Scope: ctx["scope"].(string), Client: "a"}
	_, grant := audioPost(t, client, server.URL, "grant", "alice", request)
	conn, _ := audioDial(t, client, server, grant["token"].(string), "alice")
	var hello map[string]any
	_ = conn.ReadJSON(&hello)
	request.Connection = hello["connection"].(string)
	request.Runtime = "app"
	request.Generation = 1
	_, route := audioPost(t, client, server.URL, "route", "alice", request)
	mu.Lock()
	generation = 2
	mu.Unlock()
	if err := conn.WriteJSON(audioControl{Op: "subscribe", Request: "old", Slot: 1, Token: route["token"].(string)}); err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	_ = conn.ReadJSON(&result)
	if result["reason"] != "audio-grant-rejected" {
		t.Fatal("old generation route accepted", result)
	}
	request.Generation = 2
	_, route = audioPost(t, client, server.URL, "route", "alice", request)
	// Replacing the audio domain at the same App generation also fences its grant.
	mu.Lock()
	domain = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	mu.Unlock()
	_ = conn.WriteJSON(audioControl{Op: "subscribe", Request: "old-domain", Slot: 1, Token: route["token"].(string)})
	_ = conn.ReadJSON(&result)
	if result["reason"] != "audio-grant-retired" {
		t.Fatal("retired domain accepted", result)
	}
	_, route = audioPost(t, client, server.URL, "route", "alice", request)
	_ = conn.WriteJSON(audioControl{Op: "subscribe", Request: "current", Slot: 1, Token: route["token"].(string)})
	_ = conn.ReadJSON(&result)
	if result["type"] != "state" || result["domain"] != domain {
		t.Fatal("current grant rejected", result)
	}
	m := &manager{}
	m.audioOnce.Do(func() { m.audio = a })
	m.fenceAudio("app", 2)
	_ = conn.ReadJSON(&result)
	if result["reason"] != "generation-retired" {
		t.Fatal("fence did not revoke route", result)
	}
	a.mu.Lock()
	for _, s := range a.scopes {
		if s.connection != nil {
			s.connection.expires = time.Now().Add(-time.Second)
		}
	}
	a.mu.Unlock()
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, _, err := conn.ReadMessage(); err == nil {
		t.Fatal("expired channel retained")
	}
}

func TestAudioScopeCapacityAndManagerShutdown(t *testing.T) {
	a := newAudioService("drain", nil)
	server := audioTestServer(t, a)
	client := audioTestClient(t)
	_, ctx := audioPost(t, client, server.URL, "context", "alice", audioRequest{})
	request := audioRequest{Scope: ctx["scope"].(string), Client: "a"}
	_, grant := audioPost(t, client, server.URL, "grant", "alice", request)
	conn, _ := audioDial(t, client, server, grant["token"].(string), "alice")
	var hello any
	_ = conn.ReadJSON(&hello)
	m := &manager{}
	m.audioOnce.Do(func() { m.audio = a })
	m.closeAudio()
	_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	if _, _, err := conn.ReadMessage(); err == nil {
		t.Fatal("shutdown retained upgrade")
	}
	if status, _ := audioPost(t, client, server.URL, "context", "alice", audioRequest{}); status != 503 {
		t.Fatal("draining service issued new scope")
	}
}
