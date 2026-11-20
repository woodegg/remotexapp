package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"time"
)

// Browser transports can resend a POST whose response headers never arrived.
// Reserve before any launch side effect, including across Manager restarts.
// This is duplicate suppression, not a result cache or permission to retry.
const launchIntentRetention = 24 * time.Hour
const launchIntentLimit = 8192

var launchIntentPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{16,128}$`)
var launchIntentFilePattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

type launchIntentError struct {
	status int
	code   string
}

func (e *launchIntentError) Error() string { return e.code }

func (m *manager) createWithLaunchIntent(request createRequest, principal string) (*instance, error) {
	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()
	if request.LaunchIntent != "" {
		if err := reserveLaunchIntent(m.cfg.stateDir, principal, request.LaunchIntent, time.Now(), launchIntentLimit); err != nil {
			return nil, err
		}
	}
	return m.createLocked(request)
}

func reserveLaunchIntent(stateDir, principal, intent string, now time.Time, limit int) error {
	if !launchIntentPattern.MatchString(intent) {
		return &launchIntentError{http.StatusBadRequest, "invalid-launch-intent"}
	}
	dir := filepath.Join(stateDir, "launch-intents")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return &launchIntentError{http.StatusServiceUnavailable, "launch-intent-storage-unavailable"}
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return &launchIntentError{http.StatusServiceUnavailable, "launch-intent-storage-unavailable"}
	}
	count := 0
	for _, entry := range entries {
		if !launchIntentFilePattern.MatchString(entry.Name()) {
			continue
		}
		info, err := entry.Info()
		if err != nil || !info.Mode().IsRegular() {
			return &launchIntentError{http.StatusServiceUnavailable, "launch-intent-storage-unavailable"}
		}
		if now.Sub(info.ModTime()) > launchIntentRetention {
			if err := os.Remove(filepath.Join(dir, entry.Name())); err != nil {
				return &launchIntentError{http.StatusServiceUnavailable, "launch-intent-storage-unavailable"}
			}
		} else {
			count++
		}
	}
	digest := sha256.Sum256([]byte(principal + "\x00" + intent))
	path := filepath.Join(dir, hex.EncodeToString(digest[:]))
	if _, err := os.Lstat(path); err == nil {
		return &launchIntentError{http.StatusConflict, "launch-uncertain"}
	} else if !os.IsNotExist(err) {
		return &launchIntentError{http.StatusServiceUnavailable, "launch-intent-storage-unavailable"}
	}
	if count >= limit {
		return &launchIntentError{http.StatusServiceUnavailable, "launch-intent-capacity"}
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if os.IsExist(err) {
		return &launchIntentError{http.StatusConflict, "launch-uncertain"}
	}
	if err != nil {
		return &launchIntentError{http.StatusServiceUnavailable, "launch-intent-storage-unavailable"}
	}
	// The content is deliberately free of identity, parameters, paths and tokens.
	_, writeErr := fmt.Fprintln(f, "1")
	syncErr := f.Sync()
	closeErr := f.Close()
	directory, err := os.Open(dir)
	if err != nil {
		return &launchIntentError{http.StatusServiceUnavailable, "launch-intent-storage-unavailable"}
	}
	dirSyncErr := directory.Sync()
	dirCloseErr := directory.Close()
	if writeErr != nil || syncErr != nil || closeErr != nil || dirSyncErr != nil || dirCloseErr != nil {
		// Keep a possibly durable reservation; never launch after uncertain storage.
		return &launchIntentError{http.StatusServiceUnavailable, "launch-intent-storage-unavailable"}
	}
	return nil
}
