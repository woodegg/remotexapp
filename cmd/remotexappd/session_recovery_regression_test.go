package main

import (
	"errors"
	"testing"
	"time"
)

func TestFailedSessionSurvivesRepeatedManagerRestoration(t *testing.T) {
	for _, managedID := range []string{"", "desktop"} {
		t.Run("managed-"+managedID, func(t *testing.T) {
			m := &manager{cfg: config{stateDir: t.TempDir()}, instances: map[string]*instance{}, managed: map[string]*managedInstance{}, idleTimers: map[string]*time.Timer{}}
			item := testRuntimeManifest(t, m.cfg.stateDir, "fixture-abcdef012345", managedID)
			item.Spec.Session.VacantAction = "keep"
			item.SessionState, item.SessionGeneration, item.Error = "failed", 9, "supervisor exited"
			m.managed[managedID] = &managedInstance{ID: managedID, DesiredState: "running"}
			m.runtimeRecoveryCreate = func(createRequest) (*instance, error) { t.Fatal("failed session relaunched"); return nil, nil }
			for n := 0; n < 3; n++ {
				m.restoreRuntimeManifests([]runtimeManifestRecord{{DesiredState: "running", Runtime: *item}})
				got := m.get(item.ID)
				if got == nil || got.SessionState != "failed" || got.SessionGeneration != 9 || got.Error != item.Error {
					t.Fatalf("failure erased: %+v", got)
				}
			}
		})
	}
}

func TestManagedReconcileUsesAuthoritativeSession(t *testing.T) {
	for _, state := range []string{"running", "shutdown-blocked", "failed"} {
		t.Run(state, func(t *testing.T) {
			m := &manager{cfg: config{stateDir: t.TempDir()}, instances: map[string]*instance{}, managed: map[string]*managedInstance{}, sessionObserver: &recordingSessionObserver{}}
			live := testRuntimeManifest(t, m.cfg.stateDir, "fixture-abcdef012345", "desktop")
			stale := *live // cached before on-attach activation
			live.SessionState, live.SessionGeneration, live.Error = state, 12, "injected transport loss"
			if state == "shutdown-blocked" {
				live.Shutdown = &shutdownStatus{State: "blocked", Generation: 12, RequestID: "request"}
			}
			m.storeRuntime(live)
			managed := &managedInstance{ID: "desktop", RuntimeInstanceID: live.ID, Runtime: &stale, DesiredState: "running"}
			m.managed[managed.ID] = managed
			m.runtimeSessionAliveCheck = func(got *instance) bool {
				if got.SessionGeneration != 12 || got.SessionState != state {
					t.Fatal("stale registration drove recovery")
				}
				return state != "failed"
			}
			m.runtimeRecoveryCreate = func(createRequest) (*instance, error) {
				t.Fatal("implicit replacement")
				return nil, errors.New("unexpected")
			}
			if err := m.reconcileManagedLocked(managed.ID); err != nil {
				t.Fatal(err)
			}
			if got := m.get(live.ID); got.SessionGeneration != 12 || got.SessionState != state {
				t.Fatalf("live session replaced: %+v", got)
			}
			if managed.Runtime.SessionGeneration != 12 {
				t.Fatal("snapshot was not refreshed")
			}
		})
	}
}

func TestInterruptedRestartReservesGenerationBeforeNextAttach(t *testing.T) {
	item := instance{State: "restarting", SessionGeneration: 17}
	r := runtimeRecoveryRequest(&runtimeManifestRecord{Runtime: item})
	if r.SessionGeneration != 18 {
		t.Fatalf("generation=%d", r.SessionGeneration)
	}
}

func TestViewerReconnectCannotRelaunchFailedSession(t *testing.T) {
	item := &instance{ID: "fixture-abcdef012345", SessionState: "failed", SessionGeneration: 4}
	m := &manager{instances: map[string]*instance{item.ID: item}}
	if err := m.startSession(item.ID); err == nil {
		t.Fatal("failed session relaunched by attachment")
	}
	if item.SessionGeneration != 4 {
		t.Fatal("failed attempt consumed generation")
	}
}

func TestManagerRestorationObservesOfflineApplicationFailure(t *testing.T) {
	m := &manager{cfg: config{stateDir: t.TempDir()}, instances: map[string]*instance{}, idleTimers: map[string]*time.Timer{}, sessionObserver: &recordingSessionObserver{}, runtimeAdoptionCheck: func(*instance) error { return errors.New("session is gone") }, runtimeSessionAliveCheck: func(*instance) bool { return false }}
	item := testRuntimeManifest(t, m.cfg.stateDir, "fixture-abcdef012345", "")
	item.Spec.Session.VacantAction = "keep"
	item.SessionState, item.SessionGeneration = "running", 11
	m.runtimeRecoveryCreate = func(createRequest) (*instance, error) { t.Fatal("offline failure replayed launch"); return nil, nil }
	m.restoreRuntimeManifests([]runtimeManifestRecord{{DesiredState: "running", Runtime: *item}})
	got := m.get(item.ID)
	if got == nil || got.SessionState != "failed" || got.SessionGeneration != 11 {
		t.Fatalf("offline failure lost: %+v", got)
	}
}
