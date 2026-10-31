package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
)

const nativeGrantLifetime = 90 * time.Second
const nativeGrantLimit = 128
const nativeGrantProtocol = "remotexapp-grant."

type nativeGrant struct {
	principal, runtime, component, viewer string
	generation, epoch                     int64
	expires                               time.Time
	claimed                               bool
	channel                               *viewerChannel
	timer                                 *time.Timer
}

type nativeGrantRequest struct {
	SessionGeneration int64  `json:"sessionGeneration"`
	ComponentDigest   string `json:"componentDigest"`
	ViewerID          string `json:"viewerId"`
	ConnectionEpoch   int64  `json:"connectionEpoch"`
	Token             string `json:"token,omitempty"`
}

func grantIdentity(r *http.Request) string {
	identity, _ := r.Context().Value(requestIdentityKey{}).(string)
	return identity
}

func grantKey(token string) ([32]byte, bool) {
	b, err := hex.DecodeString(token)
	return sha256.Sum256([]byte(token)), err == nil && len(b) == 32 && hex.EncodeToString(b) == token
}

func (m *manager) serveNativeGrant(w http.ResponseWriter, r *http.Request, item *instance, action string) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, "POST")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	var req nativeGrantRequest
	if decodeStrictJSON(r.Body, &req) != nil || req.SessionGeneration < 1 || req.ConnectionEpoch < 1 ||
		!validRequestID(req.ViewerID) || len(req.ViewerID) > 64 || grantIdentity(r) == "" {
		writeError(w, http.StatusBadRequest, "invalid native Viewer grant request")
		return
	}
	var closeBody io.Closer
	var cancel context.CancelFunc
	m.mu.Lock()
	current := m.instances[item.ID]
	if current == nil || !current.Components.NativeUDP || current.Components.Kasm == nil ||
		current.Components.Kasm.SHA256 != req.ComponentDigest || current.SessionGeneration != req.SessionGeneration || current.SessionState != "running" ||
		(current.State != "ready" && current.State != "server-ready") {
		m.mu.Unlock()
		writeError(w, http.StatusConflict, "native Viewer generation unavailable")
		return
	}
	now := time.Now()
	if action == "grant" {
		if req.Token != "" {
			m.mu.Unlock()
			writeError(w, http.StatusBadRequest, "new grants cannot supply a token")
			return
		}
		if m.nativeGrants == nil {
			m.nativeGrants = map[[32]byte]*nativeGrant{}
		}
		for key, grant := range m.nativeGrants {
			if grant.channel == nil && !now.Before(grant.expires) {
				delete(m.nativeGrants, key)
			}
		}
		if len(m.nativeGrants) >= nativeGrantLimit {
			m.mu.Unlock()
			writeError(w, http.StatusTooManyRequests, "native Viewer grant capacity reached")
			return
		}
		var random [32]byte
		if _, err := rand.Read(random[:]); err != nil {
			m.mu.Unlock()
			writeError(w, http.StatusInternalServerError, "native Viewer grant unavailable")
			return
		}
		token := hex.EncodeToString(random[:])
		key, _ := grantKey(token)
		m.nativeGrants[key] = &nativeGrant{principal: grantIdentity(r), runtime: item.ID, generation: req.SessionGeneration,
			component: req.ComponentDigest, viewer: req.ViewerID, epoch: req.ConnectionEpoch, expires: now.Add(nativeGrantLifetime)}
		m.mu.Unlock()
		writeJSON(w, http.StatusOK, map[string]any{"token": token, "expiresInMs": nativeGrantLifetime.Milliseconds(), "renewAfterMs": 20000})
		return
	}
	key, valid := grantKey(req.Token)
	g := m.nativeGrants[key]
	if !valid || g == nil || !now.Before(g.expires) || g.principal != grantIdentity(r) || g.runtime != item.ID ||
		g.generation != req.SessionGeneration || g.component != req.ComponentDigest || g.viewer != req.ViewerID || g.epoch != req.ConnectionEpoch {
		m.mu.Unlock()
		writeError(w, http.StatusForbidden, "native Viewer grant rejected")
		return
	}
	if action == "revoke" {
		delete(m.nativeGrants, key)
		if g.timer != nil {
			g.timer.Stop()
		}
		if g.channel != nil {
			closeBody = g.channel.body
			cancel = g.channel.cancel
		}
	} else {
		if !g.claimed || g.channel == nil {
			m.mu.Unlock()
			writeError(w, http.StatusConflict, "native Viewer is not attached")
			return
		}
		g.expires = now.Add(nativeGrantLifetime)
		m.scheduleNativeGrantLocked(key, g)
	}
	m.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if closeBody != nil {
		_ = closeBody.Close()
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "expiresInMs": nativeGrantLifetime.Milliseconds()})
}

// The grant travels in an upgrade header, never a URL. The downstream native
// endpoint does not receive the grant credential or authenticated principal.
func (m *manager) claimNativeGrant(r *http.Request, item *instance) ([32]byte, error) {
	var empty [32]byte
	protocol := r.Header.Get("Sec-WebSocket-Protocol")
	if !strings.HasPrefix(protocol, nativeGrantProtocol) || strings.Contains(protocol, ",") {
		return empty, errors.New("native Viewer grant required")
	}
	key, valid := grantKey(strings.TrimPrefix(protocol, nativeGrantProtocol))
	m.mu.Lock()
	defer m.mu.Unlock()
	g := m.nativeGrants[key]
	if !valid || g == nil || g.claimed || !time.Now().Before(g.expires) || g.principal != grantIdentity(r) ||
		g.runtime != item.ID || g.generation != item.SessionGeneration || item.Components.Kasm == nil || g.component != item.Components.Kasm.SHA256 {
		return empty, errors.New("native Viewer grant rejected")
	}
	g.claimed = true
	return key, nil
}

func (m *manager) attachNativeGrant(key [32]byte, c *viewerChannel) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	g := m.nativeGrants[key]
	if g == nil || !time.Now().Before(g.expires) || g.channel != nil || !g.claimed || g.generation != c.generation {
		return errors.New("native Viewer grant retired")
	}
	g.channel = c
	c.nativeGrantKey = key
	m.scheduleNativeGrantLocked(key, g)
	return nil
}

func (m *manager) scheduleNativeGrantLocked(key [32]byte, g *nativeGrant) {
	if g.timer != nil {
		g.timer.Stop()
	}
	expiry := g.expires
	g.timer = time.AfterFunc(time.Until(expiry), func() {
		m.mu.Lock()
		current := m.nativeGrants[key]
		if current != g || current.expires != expiry {
			m.mu.Unlock()
			return
		}
		delete(m.nativeGrants, key)
		c := g.channel
		// A completed response binding owns this closer; cancel also fences any
		// not-yet-completed upstream handshake.
		var closeBody = c.body
		m.mu.Unlock()
		c.cancel()
		if closeBody != nil {
			_ = closeBody.Close()
		}
	})
}

// Caller owns mu. Removal is also performed when generation fencing removes
// the channel before the HTTP handler's deferred close runs.
func (m *manager) retireNativeGrantLocked(c *viewerChannel) {
	if g := m.nativeGrants[c.nativeGrantKey]; g != nil && g.channel == c {
		if g.timer != nil {
			g.timer.Stop()
		}
		delete(m.nativeGrants, c.nativeGrantKey)
	}
}
