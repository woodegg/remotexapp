package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

type recoveryCloseCounter struct{ closed atomic.Int32 }

func (c *recoveryCloseCounter) Read([]byte) (int, error) { return 0, io.EOF }
func (c *recoveryCloseCounter) Close() error             { c.closed.Add(1); return nil }

func TestRecoveryFencesRealRFBAndInputChannels(t *testing.T) {
	m, item, now, starts := backgroundRecoveryFixture(t)
	item.SessionState = "running"
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		connection, err := (&websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer connection.Close()
		for {
			kind, data, err := connection.ReadMessage()
			if err != nil {
				return
			}
			if connection.WriteMessage(kind, data) != nil {
				return
			}
		}
	}))
	defer upstream.Close()
	item.GatewayAddr = strings.TrimPrefix(upstream.URL, "http://")
	server := httptest.NewServer(http.HandlerFunc(m.serveInstanceRoute))
	defer server.Close()
	var sockets []*websocket.Conn
	for _, path := range []string{"rfb-compat", "input"} {
		socket, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/remotexapps/"+item.ID+"/"+path, nil)
		if err != nil {
			t.Fatal(err)
		}
		sockets = append(sockets, socket)
		defer socket.Close()
	}
	if got := m.get(item.ID); got.AttachedClients != 1 || !m.canFenceViewerChannels(got) {
		t.Fatal("channel ownership was not registered")
	}
	m.setSessionState(item.ID, "failed", "injected leader loss")
	next := stepBackgroundRecovery(t, m, item, *now)
	*now = next
	stepBackgroundRecovery(t, m, item, *now)
	if starts.Load() != 1 || m.get(item.ID).AttachedClients != 0 {
		t.Fatal("attached Viewer prevented safe recovery")
	}
	for _, socket := range sockets {
		socket.SetReadDeadline(time.Now().Add(time.Second))
		if _, _, err := socket.ReadMessage(); err == nil {
			t.Fatal("old channel survived recovery")
		}
	}
	// Allow HTTP deferred detaches to race with a replacement Viewer registration.
	m.mu.Lock()
	current := m.instances[item.ID]
	current.AttachedClients = 1
	m.mu.Unlock()
	time.Sleep(30 * time.Millisecond)
	if m.get(item.ID).AttachedClients != 1 {
		t.Fatal("late old detach decremented the replacement count")
	}
	request := httptest.NewRequest("GET", "/remotexapps/"+item.ID+"/input?sessionGeneration=9", nil)
	request.Header.Set("Upgrade", "websocket")
	response := httptest.NewRecorder()
	m.serveInstanceRoute(response, request)
	if response.Code != 409 {
		t.Fatalf("stale generation accepted: %d", response.Code)
	}
}

func TestRecoveryPendingUpgradeAndLateDetachAreFenced(t *testing.T) {
	m, item, now, starts := backgroundRecoveryFixture(t)
	_, cancel := context.WithCancel(context.Background())
	old := &viewerChannel{runtimeID: item.ID, generation: item.SessionGeneration, rfb: true, cancel: cancel}
	m.viewerChannels = map[*viewerChannel]struct{}{old: {}}
	item.AttachedClients = 1
	next := stepBackgroundRecovery(t, m, item, *now)
	*now = next
	stepBackgroundRecovery(t, m, item, *now)
	if starts.Load() != 1 {
		t.Fatal("known pending upgrade blocked recovery")
	}
	body := &recoveryCloseCounter{}
	if err := m.bindViewerChannel(old, &http.Response{StatusCode: 101, Body: body}); err == nil || body.closed.Load() != 1 {
		t.Fatal("late upgrade was not rejected and closed")
	}
	m.mu.Lock()
	m.instances[item.ID].AttachedClients = 1
	m.mu.Unlock()
	m.closeViewerChannel(old)
	if m.get(item.ID).AttachedClients != 1 {
		t.Fatal("old generation detach changed new count")
	}
}

func TestRecoveryConcurrentTriggersStartOnce(t *testing.T) {
	m, item, now, starts := backgroundRecoveryFixture(t)
	next := stepBackgroundRecovery(t, m, item, *now)
	*now = next
	var group sync.WaitGroup
	for range 8 {
		group.Go(func() { m.notifySessionRecovery(); m.reconcileSessionRecovery(*now) })
	}
	group.Wait()
	if starts.Load() != 1 || m.get(item.ID).Recovery.Attempts != 1 {
		t.Fatal("concurrent events duplicated charged attempt")
	}
}

func TestRecoveryRetryStrictGenerationAndPreservedBudget(t *testing.T) {
	for _, test := range []struct {
		name, body string
		status     int
	}{
		{"accepted", `{"sessionGeneration":9}`, 202},
		{"missing", `{}`, 400}, {"stale", `{"sessionGeneration":8}`, 409},
		{"negative", `{"sessionGeneration":-1}`, 400}, {"fraction", `{"sessionGeneration":1.2}`, 400},
		{"force", `{"sessionGeneration":9,"force":true}`, 400},
		{"reset", `{"sessionGeneration":9,"reset":true}`, 400},
	} {
		t.Run(test.name, func(t *testing.T) {
			m, item, now, starts := backgroundRecoveryFixture(t)
			deadline := stepBackgroundRecovery(t, m, item, *now)
			request := httptest.NewRequest("POST", "/api/instances/"+item.ID+"/recovery-retry", strings.NewReader(test.body))
			response := httptest.NewRecorder()
			m.serveInstance(response, request)
			if response.Code != test.status {
				t.Fatalf("status %d body %s", response.Code, response.Body.String())
			}
			if !m.get(item.ID).Recovery.NextAttemptAt.Equal(deadline) || starts.Load() != 0 || m.get(item.ID).Recovery.Attempts != 0 {
				t.Fatal("manual retry bypassed waiting budget")
			}
		})
	}
}

func TestRecoveryRetryRechecksBlockedWithoutForceAndRedactsAuthority(t *testing.T) {
	m, item, now, starts := backgroundRecoveryFixture(t)
	next := stepBackgroundRecovery(t, m, item, *now)
	item.AttachedClients = 1
	*now = next
	stepBackgroundRecovery(t, m, item, *now)
	r := m.get(item.ID).Recovery
	if r.Phase != recoveryBlocked {
		t.Fatal("fixture was not blocked")
	}
	item.AttachedClients = 0
	response := httptest.NewRecorder()
	m.serveRecoveryRetry(response, httptest.NewRequest("POST", "/", strings.NewReader(`{"sessionGeneration":9}`)), item.ID)
	if response.Code != 202 || starts.Load() != 0 {
		t.Fatal("recheck launched inline or failed")
	}
	due := m.get(item.ID).Recovery.NextAttemptAt
	if due.Sub(*now) != time.Millisecond {
		t.Fatal("blocked recheck did not get a bounded deadline")
	}
	*now = due
	m.reconcileSessionRecovery(*now)
	if starts.Load() != 1 {
		t.Fatal("cleared blocker did not recover")
	}
	current := m.get(item.ID)
	current.Recovery.SourceBootID = oldTestBoot
	encoded, err := json.Marshal(m.publicInstance(current).Recovery)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"sourceBootId", oldTestBoot, "runtimeId", item.Runtime, item.Home} {
		if secret != "" && strings.Contains(string(encoded), secret) {
			t.Fatalf("private recovery authority leaked: %s", encoded)
		}
	}
}

func TestViewerInputPreservesInProgressAndBlockedShutdownEpoch(t *testing.T) {
	for _, state := range []string{"starting", "stopping", "shutdown-blocked"} {
		t.Run(state, func(t *testing.T) {
			m, item, _, _ := backgroundRecoveryFixture(t)
			item.SessionState = state
			if state == "shutdown-blocked" {
				item.Shutdown = &shutdownStatus{State: "blocked", Generation: item.SessionGeneration}
			}
			channel, _, err := m.openViewerChannel(item.ID, false, httptest.NewRequest("GET", "/input", nil))
			if state == "shutdown-blocked" {
				if err != nil {
					t.Fatal(err)
				}
				defer m.closeViewerChannel(channel)
				if got := m.get(item.ID); got.SessionState != "running" || got.Shutdown.State != "cancelled" {
					t.Fatal("attachment did not preserve the blocked App")
				}
			} else if err == nil {
				m.closeViewerChannel(channel)
				t.Fatal("input replaced an in-progress session")
			}
			if m.get(item.ID).SessionGeneration != item.SessionGeneration {
				t.Fatal("input advanced a protected generation")
			}
		})
	}
}
