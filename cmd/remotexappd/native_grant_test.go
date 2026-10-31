package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/woodegg/remotexapp/internal/testfixture"
)

func grantFixture(t *testing.T) (*manager, *instance, nativeGrantRequest) {
	t.Helper()
	pin := testfixture.KasmProtocol(t, "kasm-udp-text-v1")
	i := &instance{ID: "test-native", State: "ready", SessionState: "running", SessionGeneration: 3, Components: runtimeComponents{DisplayProvider: "kasm", Kasm: &pin, NativeUDP: true}}
	m := &manager{instances: map[string]*instance{i.ID: i}, viewerChannels: map[*viewerChannel]struct{}{}}
	t.Cleanup(func() {
		m.mu.Lock()
		defer m.mu.Unlock()
		for _, g := range m.nativeGrants {
			if g.timer != nil {
				g.timer.Stop()
			}
		}
	})
	return m, i, nativeGrantRequest{SessionGeneration: 3, ComponentDigest: pin.SHA256, ViewerID: "viewer-a", ConnectionEpoch: 7}
}
func grantCall(m *manager, i *instance, q nativeGrantRequest, principal, action string) *httptest.ResponseRecorder {
	b, _ := json.Marshal(q)
	r := httptest.NewRequest("POST", "/native/"+action, bytes.NewReader(b))
	r = r.WithContext(context.WithValue(r.Context(), requestIdentityKey{}, principal))
	w := httptest.NewRecorder()
	m.serveNativeGrant(w, r, i, action)
	return w
}
func issueGrant(t *testing.T, m *manager, i *instance, q nativeGrantRequest) nativeGrantRequest {
	t.Helper()
	w := grantCall(m, i, q, "alice", "grant")
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var v struct {
		Token string `json:"token"`
	}
	json.Unmarshal(w.Body.Bytes(), &v)
	q.Token = v.Token
	return q
}
func claimRequest(token, principal string) *http.Request {
	r := httptest.NewRequest("GET", "/native/websockify", nil)
	r.Header.Set("Sec-WebSocket-Protocol", nativeGrantProtocol+token)
	return r.WithContext(context.WithValue(r.Context(), requestIdentityKey{}, principal))
}
func TestNativeGrantPrincipalReplayAndBindings(t *testing.T) {
	m, i, q := grantFixture(t)
	q = issueGrant(t, m, i, q)
	if _, e := m.claimNativeGrant(claimRequest(q.Token, "mallory"), i); e == nil {
		t.Fatal("wrong principal claimed")
	}
	wrong := *i
	wrong.SessionGeneration++
	if _, e := m.claimNativeGrant(claimRequest(q.Token, "alice"), &wrong); e == nil {
		t.Fatal("wrong generation claimed")
	}
	key, e := m.claimNativeGrant(claimRequest(q.Token, "alice"), i)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = m.claimNativeGrant(claimRequest(q.Token, "alice"), i); e == nil {
		t.Fatal("replayed one-use grant")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	c := &viewerChannel{runtimeID: i.ID, generation: i.SessionGeneration, cancel: cancel}
	m.viewerChannels[c] = struct{}{}
	if e = m.attachNativeGrant(key, c); e != nil {
		t.Fatal(e)
	}
	for _, modify := range []func(*nativeGrantRequest){func(v *nativeGrantRequest) { v.ViewerID = "other" }, func(v *nativeGrantRequest) { v.ConnectionEpoch++ }, func(v *nativeGrantRequest) { v.ComponentDigest = strings.Repeat("0", 64) }} {
		bad := q
		modify(&bad)
		if grantCall(m, i, bad, "alice", "lease").Code == 200 {
			t.Fatal("wrong grant binding renewed")
		}
	}
	if grantCall(m, i, q, "alice", "lease").Code != 200 {
		t.Fatal("valid lease failed")
	}
	if grantCall(m, i, q, "alice", "revoke").Code != 200 || ctx.Err() == nil {
		t.Fatal("revocation did not cancel")
	}
	if grantCall(m, i, q, "alice", "lease").Code == 200 {
		t.Fatal("revoked grant renewed")
	}
}

type closeCounter struct{ closed atomic.Int32 }

func (c *closeCounter) Close() error             { c.closed.Add(1); return nil }
func (c *closeCounter) Read([]byte) (int, error) { return 0, io.EOF }
func TestNativeGrantExpiryClosesBoundAndPendingUpgrades(t *testing.T) {
	for _, bound := range []bool{true, false} {
		t.Run(map[bool]string{true: "bound", false: "pending"}[bound], func(t *testing.T) {
			m, i, q := grantFixture(t)
			q = issueGrant(t, m, i, q)
			key, e := m.claimNativeGrant(claimRequest(q.Token, "alice"), i)
			if e != nil {
				t.Fatal(e)
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			c := &viewerChannel{runtimeID: i.ID, generation: i.SessionGeneration, cancel: cancel}
			m.viewerChannels[c] = struct{}{}
			if e = m.attachNativeGrant(key, c); e != nil {
				t.Fatal(e)
			}
			body := &closeCounter{}
			response := &http.Response{StatusCode: 101, Body: body}
			if bound {
				if e = m.bindViewerChannel(c, response); e != nil {
					t.Fatal(e)
				}
			}
			m.mu.Lock()
			g := m.nativeGrants[key]
			g.expires = time.Now().Add(10 * time.Millisecond)
			m.scheduleNativeGrantLocked(key, g)
			m.mu.Unlock()
			select {
			case <-ctx.Done():
			case <-time.After(time.Second):
				t.Fatal("expiry did not cancel")
			}
			if !bound && m.bindViewerChannel(c, response) == nil {
				t.Fatal("late upstream upgraded after expiry")
			}
			deadline := time.Now().Add(time.Second)
			for body.closed.Load() == 0 && time.Now().Before(deadline) {
				time.Sleep(time.Millisecond)
			}
			if body.closed.Load() != 1 {
				t.Fatal("owned socket not closed exactly once")
			}
		})
	}
}
func TestNativeGrantCapacityAndExpiredPendingReclamation(t *testing.T) {
	m, i, q := grantFixture(t)
	for n := 0; n < nativeGrantLimit; n++ {
		issueGrant(t, m, i, q)
	}
	if grantCall(m, i, q, "alice", "grant").Code != 429 {
		t.Fatal("unbounded grants")
	}
	for _, g := range m.nativeGrants {
		g.expires = time.Now().Add(-time.Second)
	}
	issueGrant(t, m, i, q)
	if len(m.nativeGrants) != 1 {
		t.Fatal("pending grant expiry leak")
	}
	fresh, _, _ := grantFixture(t)
	for key := range m.nativeGrants {
		if fresh.nativeGrants[key] != nil {
			t.Fatal("grants survived Manager restart")
		}
	}
}
