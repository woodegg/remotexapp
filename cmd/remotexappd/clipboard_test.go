package main

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestManagerClipboardProxyValidatesGenerationAndPrivateSocket(t *testing.T) {
	directory := t.TempDir()
	socket := filepath.Join(directory, "clipboard.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(socket, 0o600); err != nil {
		t.Fatal(err)
	}
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/capabilities" {
			t.Errorf("internal path = %q", r.URL.Path)
		}
		if r.Header.Get("X-RemoteXApp-Session-Generation") != "3" {
			t.Errorf("generation header = %q", r.Header.Get("X-RemoteXApp-Session-Generation"))
		}
		if r.Header.Get("X-RemoteXApp-Clipboard-Sequence") != "0" {
			t.Errorf("clipboard consistency guard was not forwarded")
		}
		writeJSON(w, http.StatusOK, map[string]any{"protocolVersion": 1, "generation": 3})
	})}
	defer server.Close()
	go func() { _ = server.Serve(listener) }()

	item := &instance{ID: "runtime-a", State: "server-ready", SessionState: "running", SessionGeneration: 3, SocketRuntime: directory}
	manager := &manager{cfg: config{authMode: "none", listen: "127.0.0.1:1991"}, instances: map[string]*instance{item.ID: item}, idleTimers: map[string]*time.Timer{}}
	request := httptest.NewRequest(http.MethodGet, "/api/instances/runtime-a/clipboard/capabilities", nil)
	request.Header.Set("X-RemoteXApp-Session-Generation", "3")
	request.Header.Set("X-RemoteXApp-Clipboard-Sequence", "0")
	response := httptest.NewRecorder()
	manager.handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("proxy = %d: %s", response.Code, response.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["generation"] != float64(3) {
		t.Fatalf("payload = %#v", payload)
	}

	stale := httptest.NewRequest(http.MethodGet, "/api/instances/runtime-a/clipboard/capabilities", nil)
	stale.Header.Set("X-RemoteXApp-Session-Generation", "2")
	staleResponse := httptest.NewRecorder()
	manager.handler().ServeHTTP(staleResponse, stale)
	if staleResponse.Code != http.StatusConflict {
		t.Fatalf("stale = %d", staleResponse.Code)
	}
}

func TestManagerClipboardFailsClosedForPinnedLegacyRuntime(t *testing.T) {
	directory := t.TempDir()
	item := &instance{ID: "runtime-a", State: "server-ready", SessionState: "running", SessionGeneration: 3, SocketRuntime: directory}
	manager := &manager{cfg: config{authMode: "none", listen: "127.0.0.1:1991"}, instances: map[string]*instance{item.ID: item}, idleTimers: map[string]*time.Timer{}}
	request := httptest.NewRequest(http.MethodGet, "/api/instances/runtime-a/clipboard/capabilities", nil)
	request.Header.Set("X-RemoteXApp-Session-Generation", "3")
	response := httptest.NewRecorder()
	manager.handler().ServeHTTP(response, request)
	if response.Code != http.StatusConflict {
		t.Fatalf("legacy = %d: %s", response.Code, response.Body.String())
	}
}

func TestManagerClipboardFailsClosedOnPublicNoAuthWithoutOptIn(t *testing.T) {
	item := &instance{ID: "runtime-a", State: "server-ready", SessionState: "running", SessionGeneration: 3, SocketRuntime: t.TempDir()}
	manager := &manager{cfg: config{authMode: "none", listen: "0.0.0.0:1991"}, instances: map[string]*instance{item.ID: item}, idleTimers: map[string]*time.Timer{}}
	request := httptest.NewRequest(http.MethodGet, "/api/instances/runtime-a/clipboard/capabilities", nil)
	request.Header.Set("X-RemoteXApp-Session-Generation", "3")
	response := httptest.NewRecorder()
	manager.handler().ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("public no-auth = %d: %s", response.Code, response.Body.String())
	}
}

func TestManagerClipboardStreamingValidatorRejectsInvalidUTF8AndMissingFallback(t *testing.T) {
	for name, values := range map[string]map[string][]byte{
		"invalid-utf8":       {"text/plain": {0xff}},
		"html-without-plain": {"text/html": []byte("<b>hello</b>")},
	} {
		t.Run(name, func(t *testing.T) {
			var body bytes.Buffer
			writer := multipart.NewWriter(&body)
			for mediaType, value := range values {
				part, err := writer.CreatePart(map[string][]string{"Content-Disposition": {`form-data; name="item"; filename="clipboard"`}, "Content-Type": {mediaType}})
				if err != nil {
					t.Fatal(err)
				}
				_, _ = part.Write(value)
			}
			_ = writer.Close()
			if err := validateManagerClipboardParts(multipart.NewReader(bytes.NewReader(body.Bytes()), writer.Boundary())); err == nil {
				t.Fatal("invalid multipart was accepted")
			}
		})
	}
}

func TestManagerClipboardEmptyNormalization(t *testing.T) {
	for _, tc := range []struct {
		name  string
		parts [][2]string
		valid bool
	}{
		{"empty", [][2]string{{"text/plain", ""}}, true},
		{"mixed", [][2]string{{"text/plain", "ok"}, {"text/rtf", ""}}, true},
		{"whitespace", [][2]string{{"text/plain", " \t\n"}}, true},
		{"html-empty-fallback", [][2]string{{"text/html", "<b>x</b>"}, {"text/plain", ""}}, false},
		{"empty-html", [][2]string{{"text/html", ""}, {"text/plain", "x"}}, true},
		{"duplicate-empty", [][2]string{{"text/plain", ""}, {"text/plain", "x"}}, false},
		{"unsupported-empty", [][2]string{{"application/pdf", ""}}, false},
		{"no-parts", nil, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var body bytes.Buffer
			writer := multipart.NewWriter(&body)
			for _, item := range tc.parts {
				part, err := writer.CreatePart(map[string][]string{"Content-Disposition": {`form-data; name="item"`}, "Content-Type": {item[0]}})
				if err != nil {
					t.Fatal(err)
				}
				_, _ = part.Write([]byte(item[1]))
			}
			_ = writer.Close()
			err := validateManagerClipboardParts(multipart.NewReader(bytes.NewReader(body.Bytes()), writer.Boundary()))
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v: %v", tc.valid, err)
			}
			if len(tc.parts) > 0 {
				truncated := body.Bytes()[:body.Len()-8]
				if err := validateManagerClipboardParts(multipart.NewReader(bytes.NewReader(truncated), writer.Boundary())); err == nil {
					t.Fatal("truncated multipart accepted")
				}
			}
		})
	}
}

func FuzzManagerClipboardMultipart(f *testing.F) {
	const boundary = "remotexapp-fuzz-boundary"
	f.Add([]byte("not multipart"))
	f.Add([]byte("--" + boundary + "\r\nContent-Disposition: form-data; name=\"item\"; filename=\"clipboard\"\r\nContent-Type: text/plain\r\n\r\nhello\r\n--" + boundary + "--\r\n"))
	f.Fuzz(func(t *testing.T, data []byte) {
		if len(data) > 1<<20 {
			t.Skip()
		}
		_ = validateManagerClipboardParts(multipart.NewReader(bytes.NewReader(data), boundary))
	})
}
