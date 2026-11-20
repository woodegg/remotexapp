package main

import (
	"encoding/json"
	"errors"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestLaunchIntentSurvivesReopenAndScopesIdentity(t *testing.T) {
	dir, now := t.TempDir(), time.Now()
	key := "test-launch-123456789"
	if err := reserveLaunchIntent(dir, "actor-a", key, now, 10); err != nil {
		t.Fatal(err)
	}
	if err := reserveLaunchIntent(dir, "actor-a", key, now, 10); err == nil {
		t.Fatal("replay accepted")
	}
	if err := reserveLaunchIntent(dir, "actor-b", key, now, 10); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(filepath.Join(dir, "launch-intents"))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 {
		t.Fatal(entries)
	}
	for _, entry := range entries {
		path := filepath.Join(dir, "launch-intents", entry.Name())
		body, err := os.ReadFile(path)
		if err != nil || string(body) != "1\n" {
			t.Fatalf("reservation contents: %q %v", body, err)
		}
		info, _ := entry.Info()
		if info.Mode().Perm() != 0o600 {
			t.Fatal(info.Mode())
		}
	}
}

func TestConcurrentLaunchIntentAdmitsAtMostOne(t *testing.T) {
	dir := t.TempDir()
	var accepted atomic.Int32
	var wg sync.WaitGroup
	for range 12 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if reserveLaunchIntent(dir, "actor", "same-launch-123456789", time.Now(), 100) == nil {
				accepted.Add(1)
			}
		}()
	}
	wg.Wait()
	if accepted.Load() != 1 {
		t.Fatalf("accepted %d", accepted.Load())
	}
}

func TestLaunchIntentStorageFailureCapacityAndExpiry(t *testing.T) {
	dir, now := t.TempDir(), time.Now()
	for _, key := range []string{"short", "../invalid-launch-key", ""} {
		var e *launchIntentError
		if err := reserveLaunchIntent(dir, "a", key, now, 1); !errors.As(err, &e) || e.status != 400 {
			t.Fatalf("invalid intent: %v", err)
		}
	}
	if err := reserveLaunchIntent(dir, "a", "first-launch-123456789", now, 1); err != nil {
		t.Fatal(err)
	}
	var e *launchIntentError
	if err := reserveLaunchIntent(dir, "a", "second-launch-123456789", now, 1); !errors.As(err, &e) || e.code != "launch-intent-capacity" {
		t.Fatalf("capacity: %v", err)
	}
	if err := reserveLaunchIntent(dir, "a", "second-launch-123456789", now.Add(launchIntentRetention+time.Minute), 1); err != nil {
		t.Fatal(err)
	}
	blocked := filepath.Join(t.TempDir(), "state")
	if err := os.WriteFile(blocked, []byte("not a directory"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := reserveLaunchIntent(blocked, "a", "third-launch-123456789", now, 1); !errors.As(err, &e) || e.code != "launch-intent-storage-unavailable" {
		t.Fatalf("storage: %v", err)
	}
}

func TestLaunchIntentAPIReplayDoesNotReenterCreationAfterManagerReplacement(t *testing.T) {
	dir := t.TempDir()
	// An unsupported template consumes the intent before lifecycle work. The
	// replacement Manager must reject the replay at the persisted reservation.
	for n := 0; n < 2; n++ {
		m := &manager{cfg: config{stateDir: dir}}
		w := httptest.NewRecorder()
		m.serveInstances(w, httptest.NewRequest("POST", "/api/instances", strings.NewReader(`{"templateId":"missing","launchIntent":"api-launch-123456789"}`)))
		var body map[string]string
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if w.Code != 409 {
			t.Fatalf("%d %s", w.Code, w.Body.String())
		}
		if n == 0 && body["code"] != "" {
			t.Fatal(body)
		}
		if n == 1 && body["code"] != "launch-uncertain" {
			t.Fatal(body)
		}
	}
}
