package main

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestTURNOnlySignsAuthorizedViewerResponses(t *testing.T) {
	const host = "viewer.example.test"
	const path = "/rx/remotexapps/app/native/"
	token := strings.Repeat("a", 64)
	privateKey := []byte(strings.Repeat("x", 48))
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case path + "grant":
			if r.Header.Get("Accept") == "deny" {
				http.Error(w, "denied", http.StatusForbidden)
				return
			}
			json.NewEncoder(w).Encode(map[string]string{"token": token, "webRTCMode": "turn"})
		case path + "lease":
			json.NewEncoder(w).Encode(map[string]string{"status": "ok", "webRTCMode": "turn"})
		default:
			json.NewEncoder(w).Encode(map[string]string{"token": token, "webRTCMode": "turn"})
		}
	}))
	defer backend.Close()
	handler, err := edgeHandler(configuration{Origin: "https://" + host, Backend: backend.URL,
		TURN: &turnConfiguration{URL: "turn:relay.example.test:3478?transport=udp", secret: privateKey}})
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range []struct {
		method, path, accept, body string
		status                     int
		signed                     bool
	}{
		{"POST", path + "grant", "", "{}", 200, true},
		{"POST", path + "lease", "", `{"token":"` + token + `"}`, 200, true},
		{"POST", path + "lease", "", `{"token":"invalid"}`, 400, false},
		{"POST", path + "grant", "deny", "{}", 403, false},
		{"GET", path + "grant", "", "", 200, false},
		{"POST", "/rx/api/version", "", "{}", 200, false},
	} {
		r := httptest.NewRequest(item.method, "https://"+host+item.path, strings.NewReader(item.body))
		r.RemoteAddr = "127.0.0.1:3456"
		r.Header.Set("Accept", item.accept)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		var value struct {
			Turn  *turnIceServer `json:"turn"`
			Token string         `json:"token"`
		}
		err := json.Unmarshal(w.Body.Bytes(), &value)
		if w.Code != item.status || (value.Turn != nil) != item.signed {
			t.Fatalf("%s %s: status=%d signed=%v", item.method, item.path, w.Code, value.Turn != nil)
		}
		if item.signed {
			if err != nil || w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("invalid signed response", err)
			}
			mac := hmac.New(sha1.New, privateKey)
			mac.Write([]byte(value.Turn.Username))
			until, _, _ := strings.Cut(value.Turn.Username, ":")
			expires, expiresErr := strconv.ParseInt(until, 10, 64)
			if value.Turn.Credential != base64.StdEncoding.EncodeToString(mac.Sum(nil)) ||
				strings.Contains(value.Turn.Username, token) || expiresErr != nil ||
				time.Until(time.Unix(expires, 0)) < 14*time.Minute || time.Until(time.Unix(expires, 0)) > 15*time.Minute {
				t.Fatal("incorrect credential, identity or lifetime")
			}
			if item.path == path+"lease" && value.Token != "" {
				t.Fatal("lease echoed the grant token")
			}
		}
	}
}
