package main

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func leaseFixture(t *testing.T) (*manager, *instance) {
	t.Helper()
	spec, _ := neutralAppTemplate()
	item := &instance{ID: "fixture-app-123", Spec: spec, State: "server-ready", SessionState: "running", SessionGeneration: 3, RuntimeDesired: "running", VacantTimeout: time.Hour}
	m := &manager{cfg: config{authMode: "none", listen: "127.0.0.1:1991"}, instances: map[string]*instance{item.ID: item}, idleTimers: map[string]*time.Timer{}, managed: map[string]*managedInstance{}}
	t.Cleanup(func() {
		m.mu.Lock()
		defer m.mu.Unlock()
		for id, timer := range m.idleTimers {
			timer.Stop()
			delete(m.idleTimers, id)
		}
	})
	return m, item
}

func leaseRequest(m *manager, body string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	m.handler().ServeHTTP(w, httptest.NewRequest("POST", "/api/instances/fixture-app-123/idle-lease", strings.NewReader(body)))
	return w
}

func TestIdleLeasePolicyAndGeneration(t *testing.T) {
	for _, action := range []string{"stop-session", "stop-instance", "keep"} {
		for _, attached := range []int{0, 2} {
			t.Run(action+string(rune('0'+attached)), func(t *testing.T) {
				m, item := leaseFixture(t)
				item.Spec.Session.VacantAction, item.AttachedClients = action, attached
				w := leaseRequest(m, `{"sessionGeneration":3}`)
				if w.Code != 200 {
					t.Fatal(w.Code, w.Body.String())
				}
				var result idleLeaseResult
				if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
					t.Fatal(err)
				}
				want := "renewed"
				if action == "keep" {
					want = "kept"
				} else if attached > 0 {
					want = "attached"
				}
				if result.Outcome != want || result.IdleTimeoutMS != time.Hour.Milliseconds() || result.InstanceID != item.ID || result.SessionGeneration != 3 {
					t.Fatalf("%+v", result)
				}
				if want == "renewed" {
					if result.ExpiresAt == nil || result.ExpiresAt.Sub(result.ServerTime) < time.Hour || result.ExpiresAt.Sub(result.ServerTime) > time.Hour+time.Second || m.idleTimers[item.ID] == nil {
						t.Fatal("incorrect deadline", result)
					}
				} else if result.ExpiresAt != nil || m.idleTimers[item.ID] != nil {
					t.Fatal("non-vacant timer")
				}
				if item.AttachedClients != attached || item.SessionGeneration != 3 {
					t.Fatal("renewal altered attachment/session")
				}
			})
		}
	}
}

func TestIdleLeaseRejectsInvalidAndLifecycleStates(t *testing.T) {
	for _, body := range []string{`{}`, `null`, `{"sessionGeneration":-1}`, `{"sessionGeneration":1.5}`, `{"sessionGeneration":3,"ttl":9}`, `{"sessionGeneration":3} {}`, strings.Repeat(" ", 1025)} {
		m, _ := leaseFixture(t)
		if w := leaseRequest(m, body); w.Code != 400 {
			t.Fatal(body, w.Code)
		}
	}
	for name, change := range map[string]func(*manager, *instance){
		"missing":      func(m *manager, i *instance) { delete(m.instances, i.ID) },
		"generation":   func(m *manager, i *instance) { i.SessionGeneration++ },
		"stopped":      func(m *manager, i *instance) { i.State = "stopped" },
		"failed":       func(m *manager, i *instance) { i.SessionState = "failed" },
		"ended":        func(m *manager, i *instance) { i.SessionState = "stopped" },
		"blocked":      func(m *manager, i *instance) { i.SessionState = "shutdown-blocked" },
		"desired-stop": func(m *manager, i *instance) { i.RuntimeDesired = "stopped" },
		"exit":         func(m *manager, i *instance) { i.ApplicationStatus = &applicationStatus{State: "exited"} },
		"upgrade":      func(m *manager, i *instance) { i.Upgrade = &runtimeUpgrade{Status: upgradeStatus{Phase: "stopping"}} },
		"managed-stop": func(m *manager, i *instance) {
			i.ManagedID = "managed"
			m.managed["managed"] = &managedInstance{DesiredState: "stopped"}
		},
	} {
		t.Run(name, func(t *testing.T) {
			m, item := leaseFixture(t)
			change(m, item)
			w := leaseRequest(m, `{"sessionGeneration":3}`)
			want := 409
			if name == "missing" {
				want = 404
			}
			if w.Code != want || len(m.idleTimers) != 0 {
				t.Fatal(w.Code, w.Body.String())
			}
		})
	}
	m, item := leaseFixture(t)
	item.SessionGeneration, item.SessionState = 0, "stopped"
	if w := leaseRequest(m, `{"sessionGeneration":0}`); w.Code != 200 || item.SessionState != "stopped" {
		t.Fatal(w.Code, "started dormant App")
	}
	item.ManagedID = "managed"
	m.managed["managed"] = &managedInstance{DesiredState: "running"}
	if w := leaseRequest(m, `{"sessionGeneration":0}`); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
}

func TestIdleLeaseAdmission(t *testing.T) {
	m, _ := leaseFixture(t)
	m.lifecycleMu.Lock()
	w := leaseRequest(m, `{"sessionGeneration":3}`)
	m.lifecycleMu.Unlock()
	if w.Code != 409 || !strings.Contains(w.Body.String(), "busy") {
		t.Fatal(w.Code, w.Body.String())
	}
	for _, method := range []string{"GET", "DELETE"} {
		w = httptest.NewRecorder()
		m.handler().ServeHTTP(w, httptest.NewRequest(method, "/api/instances/fixture-app-123/idle-lease", nil))
		if w.Code != 405 {
			t.Fatal(w.Code)
		}
	}
	r := httptest.NewRequest("POST", "/api/instances/fixture-app-123/idle-lease", strings.NewReader(`{"sessionGeneration":3}`))
	r.Header.Set("Origin", "https://foreign.invalid")
	w = httptest.NewRecorder()
	m.handler().ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("foreign origin accepted", w.Code)
	}
	m.cfg.authMode = "trusted-header"
	if w := leaseRequest(m, `{"sessionGeneration":3}`); w.Code != 401 {
		t.Fatal("renewal bypassed Manager authentication", w.Code)
	}
}

func TestIdleLeaseUsesFreshDriverStatus(t *testing.T) {
	for _, state := range []string{"exited", "error"} {
		t.Run(state, func(t *testing.T) {
			m, item := leaseFixture(t)
			item.Runtime = t.TempDir()
			item.Spec.Session.Status.Mode = "driver"
			if err := m.writeApplicationStatus(item, 3, state, "test terminal status", "", false); err != nil {
				t.Fatal(err)
			}
			item.ApplicationStatus = &applicationStatus{Generation: 3, State: "ready"}
			if w := leaseRequest(m, `{"sessionGeneration":3}`); w.Code != 409 || len(m.idleTimers) != 0 {
				t.Fatal("cached ready status overrode terminal Driver status", w.Code, w.Body.String())
			}
		})
	}
}

func TestVacancyOldCallbackCannotStopRenewedOrReplacedRuntime(t *testing.T) {
	m, item := leaseFixture(t)
	m.scheduleVacancy(item.ID)
	old := m.idleTimers[item.ID]
	// Simulate AfterFunc already fired and waiting on the lifecycle lock.
	m.lifecycleMu.Lock()
	done := make(chan struct{})
	go func() { m.stopVacant(item.ID, old, item, 3, time.Now().Add(-time.Second)); close(done) }()
	m.scheduleVacancy(item.ID)
	current := m.idleTimers[item.ID]
	m.lifecycleMu.Unlock()
	<-done
	if m.idleTimers[item.ID] != current || item.SessionState != "running" {
		t.Fatal("old callback consumed new timer")
	}
	// Runtime identity and generation are additional fences, even if a caller
	// accidentally leaves a timer behind during replacement.
	replacement := *item
	m.instances[item.ID] = &replacement
	m.stopVacant(item.ID, current, item, 3, time.Now().Add(-time.Second))
	m.stopVacant(item.ID, current, &replacement, 2, time.Now().Add(-time.Second))
	m.stopVacant(item.ID, current, &replacement, 3, time.Now().Add(time.Hour))
	if m.idleTimers[item.ID] != current {
		t.Fatal("identity/deadline fence lost")
	}
}

func TestIdleLeaseConcurrentRenewalsAndKeepCancel(t *testing.T) {
	m, item := leaseFixture(t)
	var group sync.WaitGroup
	for i := 0; i < 20; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			w := leaseRequest(m, `{"sessionGeneration":3}`)
			if w.Code != 200 && w.Code != 409 {
				t.Error(w.Code)
			}
		}()
	}
	group.Wait()
	m.mu.Lock()
	item.Spec.Session.VacantAction = "keep"
	m.scheduleVacancyLocked(item.ID)
	m.mu.Unlock()
	if len(m.idleTimers) != 0 {
		t.Fatal("keep retains timer")
	}
}
