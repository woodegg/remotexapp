package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func backgroundRecoveryFixture(t *testing.T) (*manager, *instance, *time.Time, *atomic.Int32) {
	t.Helper()
	m, item, _, _ := recoveryIntentFixture(t, "")
	item.Spec.Session.VacantAction = "keep"
	m.recoveryWake = make(chan struct{}, 1)
	m.managed = map[string]*managedInstance{item.ManagedID: {ID: item.ManagedID, TemplateID: item.TemplateID,
		RuntimeInstanceID: item.ID, Runtime: item, DesiredState: "running", ObservedState: "failed"}}
	now := time.Now().UTC()
	m.recoveryClock = func() time.Time { return now }
	m.runtimeAdoptionCheck = func(*instance) error { return nil }
	starts := &atomic.Int32{}
	m.recoverySessionStart = func(id string) error {
		before := m.get(id)
		if before.SessionState != "stopped" || before.Recovery == nil || before.Recovery.Phase != recoveryCleaning {
			return errors.New("launch did not follow durable cleanup")
		}
		if _, _, err := m.nextSessionGeneration(id); err != nil {
			return err
		}
		m.setSessionState(id, "starting", "")
		if err := m.persistRuntime(m.get(id)); err != nil {
			return err
		}
		starts.Add(1)
		m.setSessionState(id, "running", "")
		return m.persistRuntime(m.get(id))
	}
	return m, item, &now, starts
}

func stepBackgroundRecovery(t *testing.T, m *manager, item *instance, now time.Time) time.Time {
	t.Helper()
	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()
	next, err := m.reconcileOneSessionRecovery(item.ID, now)
	if err != nil {
		t.Fatal(err)
	}
	return next
}

func reloadBackgroundRecovery(t *testing.T, m *manager, item *instance) {
	t.Helper()
	records, err := m.loadRuntimeManifests()
	if err != nil || len(records) != 1 {
		t.Fatalf("reload records=%d error=%v", len(records), err)
	}
	m.storeRuntime(&records[0].Runtime)
	if got := m.get(item.ID); got.Recovery == nil || got.Recovery.Generation != got.SessionGeneration {
		t.Fatal("recovery identity was not restored")
	}
}

func TestBackgroundRecoveryWithoutViewerAndSharedAttachBudget(t *testing.T) {
	m, item, now, starts := backgroundRecoveryFixture(t)
	next := stepBackgroundRecovery(t, m, item, *now)
	if next.Before(now.Add(5*time.Second)) || next.After(now.Add(5500*time.Millisecond)) {
		t.Fatalf("unexpected first deadline: %v", next.Sub(*now))
	}
	if _, err := prepareRecoveryForTest(m, item.ID); err != recoveryScheduled {
		t.Fatalf("Viewer bypassed the scheduled budget: %v", err)
	}
	reloadBackgroundRecovery(t, m, item)
	stepBackgroundRecovery(t, m, item, next.Add(-time.Nanosecond))
	if starts.Load() != 0 || m.get(item.ID).Recovery.Attempts != 0 {
		t.Fatal("recovery ran before its durable deadline")
	}
	*now = next
	stepBackgroundRecovery(t, m, item, *now)
	got := m.get(item.ID)
	if starts.Load() != 1 || got.SessionState != "running" || got.SessionGeneration != 10 || got.Recovery.Attempts != 1 || got.Recovery.Phase != recoveryWatching {
		t.Fatalf("no-Viewer recovery did not complete: %+v starts=%d", got, starts.Load())
	}
	if got.ID != item.ID || got.Components != item.Components || got.ProfileRef != item.ProfileRef || got.AttachedClients != 0 {
		t.Fatal("recovery changed identity/pins or invented a Viewer")
	}
	if m.managed[item.ManagedID].ObservedState != "running" {
		t.Fatal("managed projection was not updated after recovery")
	}
}

func TestBackgroundRecoveryBackoffCooldownAndReload(t *testing.T) {
	m, item, now, starts := backgroundRecoveryFixture(t)
	launch := m.recoverySessionStart
	m.recoverySessionStart = func(id string) error {
		if err := launch(id); err != nil {
			return err
		}
		return errors.New("fixture startup failure")
	}
	next := stepBackgroundRecovery(t, m, item, *now)
	for attempt := 1; attempt <= 5; attempt++ {
		*now = next
		next = stepBackgroundRecovery(t, m, item, *now)
		got := m.get(item.ID)
		want := managedRecoveryDelay(attempt)
		if next.Before(now.Add(want)) || next.After(now.Add(want+want/10)) || got.Recovery.Attempts != attempt || starts.Load() != int32(attempt) {
			t.Fatalf("attempt %d delay=%v state=%+v starts=%d", attempt, next.Sub(*now), got.Recovery, starts.Load())
		}
		if attempt >= 3 && got.Recovery.Phase != recoveryCooldown {
			t.Fatal("cooldown opened a fresh rapid-retry burst")
		}
		reloadBackgroundRecovery(t, m, item)
		stepBackgroundRecovery(t, m, item, next.Add(-time.Nanosecond))
		if starts.Load() != int32(attempt) {
			t.Fatal("Manager reload bypassed backoff")
		}
	}
}

func TestBackgroundRecoveryPreservesViewerAndLiveProcessGuards(t *testing.T) {
	for _, guard := range []string{"viewer", "process", "boot", "untrusted-boot", "health"} {
		t.Run(guard, func(t *testing.T) {
			m, item, now, starts := backgroundRecoveryFixture(t)
			next := stepBackgroundRecovery(t, m, item, *now)
			switch guard {
			case "viewer":
				item.AttachedClients = 1
			case "process":
				t.Setenv("REMOTEXAPP_TEST_RECOVERY_FAILURE", "populated")
			case "boot":
				m.bootID = "11111111-1111-4111-8111-111111111111"
				if err := m.writeRuntimeBoot(item); err != nil {
					t.Fatal(err)
				}
				m.bootID = "22222222-2222-4222-8222-222222222222"
			case "untrusted-boot":
				m.bootID = "11111111-1111-4111-8111-111111111111"
			case "health":
				m.runtimeAdoptionCheck = func(*instance) error { return errors.New("retained resource unavailable") }
			}
			*now = next
			next = stepBackgroundRecovery(t, m, item, *now)
			got := m.get(item.ID)
			if starts.Load() != 0 || got.Recovery.Attempts != 0 || got.Recovery.Phase != recoveryBlocked || !next.After(*now) {
				t.Fatalf("guard was bypassed: %+v", got.Recovery)
			}
			item.AttachedClients = 0
			t.Setenv("REMOTEXAPP_TEST_RECOVERY_FAILURE", "")
			m.bootID = ""
			m.runtimeAdoptionCheck = func(*instance) error { return nil }
			*now = next
			stepBackgroundRecovery(t, m, item, *now)
			if starts.Load() != 1 || m.get(item.ID).Recovery.Attempts != 1 {
				t.Fatal("cleared guard did not permit one charged attempt")
			}
		})
	}
}

func TestBackgroundRecoveryRespectsStopAndCleanLogout(t *testing.T) {
	for _, action := range []string{"managed-stop", "runtime-stop", "logout"} {
		t.Run(action, func(t *testing.T) {
			m, item, now, starts := backgroundRecoveryFixture(t)
			next := stepBackgroundRecovery(t, m, item, *now)
			switch action {
			case "managed-stop":
				m.managed[item.ManagedID].DesiredState = "stopped"
			case "runtime-stop":
				item.RuntimeDesired = "stopped"
			case "logout":
				item.SessionState = "stopped"
			}
			*now = next
			if next := stepBackgroundRecovery(t, m, item, *now); !next.IsZero() {
				t.Fatal("stopped intent retained an active timer")
			}
			if starts.Load() != 0 || m.get(item.ID).Recovery.Phase != recoveryDisabled {
				t.Fatal("stopped intent was resurrected")
			}
		})
	}
}

func TestBackgroundRecoveryInterruptedCleanupDoesNotDoubleCharge(t *testing.T) {
	m, item, now, starts := backgroundRecoveryFixture(t)
	stepBackgroundRecovery(t, m, item, *now)
	r := *m.get(item.ID).Recovery
	r.Phase, r.Attempts, r.NextAttemptAt = recoveryCleaning, 1, time.Time{}
	if err := m.saveManagedRecovery(m.get(item.ID), r); err != nil {
		t.Fatal(err)
	}
	reloadBackgroundRecovery(t, m, item)
	t.Setenv("REMOTEXAPP_TEST_RECOVERY_FAILURE", "populated")
	next := stepBackgroundRecovery(t, m, item, *now)
	if got := m.get(item.ID).Recovery; got.Phase != recoveryCleaning || got.Attempts != 1 {
		t.Fatalf("blocked interrupted cleanup lost its intent: %+v", got)
	}
	t.Setenv("REMOTEXAPP_TEST_RECOVERY_FAILURE", "")
	*now = next
	stepBackgroundRecovery(t, m, item, *now)
	if starts.Load() != 1 || m.get(item.ID).Recovery.Attempts != 1 {
		t.Fatal("interrupted cleanup charged a second attempt")
	}
}

func TestBackgroundRecoveryAmbiguousLaunchWaitsInsteadOfDuplicating(t *testing.T) {
	m, item, now, starts := backgroundRecoveryFixture(t)
	stepBackgroundRecovery(t, m, item, *now)
	r := *m.get(item.ID).Recovery
	r.Phase, r.Attempts, r.NextAttemptAt = recoveryLaunching, 1, time.Time{}
	if err := m.saveManagedRecovery(m.get(item.ID), r); err != nil {
		t.Fatal(err)
	}
	reloadBackgroundRecovery(t, m, item)
	next := stepBackgroundRecovery(t, m, item, *now)
	if starts.Load() != 0 || m.get(item.ID).Recovery.Attempts != 1 || next.Before(now.Add(15*time.Second)) {
		t.Fatal("ambiguous launch was repeated or its budget reset")
	}
	*now = next
	stepBackgroundRecovery(t, m, item, *now)
	if starts.Load() != 1 || m.get(item.ID).Recovery.Attempts != 2 {
		t.Fatal("next admitted launch did not consume its own attempt")
	}
}

func TestBackgroundRecoveryHealthyResetNeedsObservedContinuity(t *testing.T) {
	m, item, now, _ := backgroundRecoveryFixture(t)
	*now = stepBackgroundRecovery(t, m, item, *now)
	stepBackgroundRecovery(t, m, item, *now)
	*now = m.get(item.ID).Recovery.NextAttemptAt
	stepBackgroundRecovery(t, m, item, *now)
	if m.get(item.ID).Recovery.HealthySince.IsZero() {
		t.Fatal("health interval did not start")
	}
	*now = now.Add(11 * time.Minute)
	stepBackgroundRecovery(t, m, item, *now)
	if m.get(item.ID).Recovery.Attempts != 1 {
		t.Fatal("observation gap reset the budget")
	}
	m.resetRecoveryHealthConfirmation(*now)
	if !m.get(item.ID).Recovery.HealthySince.IsZero() {
		t.Fatal("Manager restart retained continuity proof")
	}
	for probe := 0; probe < 22; probe++ {
		r := m.get(item.ID).Recovery
		if r.Phase == recoveryHealthy {
			break
		}
		*now = r.NextAttemptAt
		stepBackgroundRecovery(t, m, item, *now)
	}
	if got := m.get(item.ID).Recovery; got.Phase != recoveryHealthy || got.Attempts != 0 {
		t.Fatalf("continuous health did not reset the budget: %+v", got)
	}
}

func TestBackgroundRecoveryStorageFailureIsThrottledAndCannotClean(t *testing.T) {
	m, item, now, starts := backgroundRecoveryFixture(t)
	next := stepBackgroundRecovery(t, m, item, *now)
	stateDir := m.cfg.stateDir
	m.cfg.stateDir = filepath.Join(t.TempDir(), "unavailable")
	if err := os.WriteFile(m.cfg.stateDir, []byte("blocked"), 0o600); err != nil {
		t.Fatal(err)
	}
	*now = next
	floor := m.reconcileSessionRecovery(*now)
	if !floor.Equal(now.Add(recoveryProbeInterval)) || starts.Load() != 0 || m.get(item.ID).Recovery.Attempts != 0 {
		t.Fatal("failed write allowed cleanup or lost its throttle")
	}
	m.cfg.stateDir = stateDir
	m.reconcileSessionRecovery(*now)
	if starts.Load() != 0 {
		t.Fatal("wake bypassed storage retry floor")
	}
	*now = floor
	m.reconcileSessionRecovery(*now)
	if starts.Load() != 1 {
		t.Fatal("storage recovery did not permit a later attempt")
	}
}

func TestBackgroundRecoveryCleanupFailuresRetainChargedIntent(t *testing.T) {
	for _, failure := range []string{"stop", "persist"} {
		t.Run(failure, func(t *testing.T) {
			m, item, now, starts := backgroundRecoveryFixture(t)
			next := stepBackgroundRecovery(t, m, item, *now)
			t.Setenv("REMOTEXAPP_TEST_RECOVERY_FAILURE", failure)
			*now = next
			m.reconcileSessionRecovery(*now)
			got := m.get(item.ID)
			if starts.Load() != 0 || got.SessionState != "failed" || got.Recovery.Attempts != 1 {
				t.Fatalf("cleanup failure launched or lost charge: %+v", got)
			}
			if failure == "persist" {
				// Restore the directory moved by the isolated systemctl double.
				if err := os.Remove(m.runtimeManifestDir()); err != nil {
					t.Fatal(err)
				}
				if err := os.Rename(os.Getenv("REMOTEXAPP_TEST_RECOVERY_BACKUP"), m.runtimeManifestDir()); err != nil {
					t.Fatal(err)
				}
			}
			reloadBackgroundRecovery(t, m, item)
			if m.get(item.ID).Recovery.Attempts != 1 {
				t.Fatal("reload erased the charged cleanup intent")
			}
		})
	}
}

func TestBackgroundRecoveryClockRollbackKeepsBudget(t *testing.T) {
	m, item, now, starts := backgroundRecoveryFixture(t)
	item.SessionRecovery = &sessionRecovery{Attempts: 3, WindowStart: *now}
	stepBackgroundRecovery(t, m, item, *now)
	*now = now.Add(-time.Hour)
	next := stepBackgroundRecovery(t, m, item, *now)
	if got := m.get(item.ID).Recovery; got.Attempts != 3 || starts.Load() != 0 || next.Before(now.Add(10*time.Minute)) {
		t.Fatalf("clock rollback bypassed the budget: %+v", got)
	}
}

func TestManagedRecoveryManifestStrictSchemaAndSingleAuthority(t *testing.T) {
	m, item, now, _ := backgroundRecoveryFixture(t)
	stepBackgroundRecovery(t, m, item, *now)
	path := filepath.Join(m.runtimeManifestDir(), item.ID+".json")
	original, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var record map[string]any
	if err := json.Unmarshal(original, &record); err != nil {
		t.Fatal(err)
	}
	if record["schemaVersion"] != float64(3) || record["recovery"] == nil || record["runtime"].(map[string]any)["recovery"] != nil {
		t.Fatal("recovery is not stored only at the schema-3 root")
	}
	copy := m.get(item.ID)
	copy.Recovery.Attempts = 99
	if m.get(item.ID).Recovery.Attempts != 0 {
		t.Fatal("snapshot mutated live recovery state")
	}
	for _, kind := range []string{"schema2-with-recovery", "schema3-without-recovery", "unknown-field", "wrong-generation", "negative-budget", "bad-phase", "unsafe-reason"} {
		t.Run(kind, func(t *testing.T) {
			var bad map[string]any
			if err := json.Unmarshal(original, &bad); err != nil {
				t.Fatal(err)
			}
			r := bad["recovery"].(map[string]any)
			switch kind {
			case "schema2-with-recovery":
				bad["schemaVersion"] = 2
			case "schema3-without-recovery":
				delete(bad, "recovery")
			case "unknown-field":
				r["unknown"] = true
			case "wrong-generation":
				r["generation"] = 99
			case "negative-budget":
				r["attempts"] = -1
			case "bad-phase":
				r["phase"] = "force-restart"
			case "unsafe-reason":
				r["reason"] = "/private/content"
			}
			b, err := json.Marshal(bad)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, b, 0o600); err != nil {
				t.Fatal(err)
			}
			if _, err := m.loadRuntimeManifests(); err == nil {
				t.Fatal("invalid recovery metadata accepted")
			}
		})
	}
	if err := os.WriteFile(path, original, 0o600); err != nil {
		t.Fatal(err)
	}
	legacy := testRuntimeManifest(t, m.cfg.stateDir, "fixture-238a76291bc5", "")
	if err := m.persistRuntime(legacy); err != nil {
		t.Fatal(err)
	}
	records, err := m.loadRuntimeManifests()
	if err != nil || len(records) != 2 {
		t.Fatalf("mixed schemas: records=%d err=%v", len(records), err)
	}
}

func TestManagedRecoverySharedLoopRunsAndCancels(t *testing.T) {
	m, item, _, starts := backgroundRecoveryFixture(t)
	m.recoveryClock = nil // Exercise the real shared timer, including the initial delay.
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { defer close(done); m.runSessionRecoveryLoop(ctx) }()
	t.Cleanup(func() {
		cancel()
		select {
		case <-done:
		case <-time.After(time.Second):
			t.Error("recovery loop did not stop")
		}
	})
	if err := waitFor(8*time.Second, func() bool {
		got := m.get(item.ID)
		return got.SessionState == "running" && got.Recovery != nil && got.Recovery.Phase == recoveryWatching
	}); err != nil {
		t.Fatal(err)
	}
	if starts.Load() != 1 {
		t.Fatalf("shared loop launches=%d", starts.Load())
	}
}
