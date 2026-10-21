package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestFailedSessionRecoveryAdmission(t *testing.T) {
	for _, test := range []struct {
		name   string
		change func(*instance)
		want   sessionRecoveryRejection
	}{
		{"eligible", func(*instance) {}, ""},
		{"anonymous", func(i *instance) { i.ManagedID = "" }, recoveryUnsupported},
		{"isolated", func(i *instance) { i.Spec.RunMode = "isolated" }, recoveryUnsupported},
		{"clean logout", func(i *instance) { i.SessionState = "stopped" }, recoveryNotFailed},
		{"desired stopped", func(i *instance) { i.RuntimeDesired = "stopped" }, recoveryStopped},
		{"shutdown veto", func(i *instance) { i.Shutdown = &shutdownStatus{State: "blocked"} }, recoveryShutdown},
		{"failed shutdown", func(i *instance) { i.Shutdown = &shutdownStatus{State: "failed"} }, recoveryShutdown},
		{"completed shutdown", func(i *instance) { i.Shutdown = &shutdownStatus{State: "completed"} }, ""},
		{"cancelled shutdown", func(i *instance) { i.Shutdown = &shutdownStatus{State: "cancelled"} }, ""},
		{"failed upgrade", func(i *instance) { i.Upgrade = &runtimeUpgrade{Status: upgradeStatus{Phase: "failed"}} }, recoveryUpgrade},
		{"completed upgrade", func(i *instance) { i.Upgrade = &runtimeUpgrade{Status: upgradeStatus{Phase: "completed"}} }, ""},
		{"unready runtime", func(i *instance) { i.State = "failed" }, recoveryRuntime},
		{"generation exhausted", func(i *instance) { i.SessionGeneration = 1<<53 - 1 }, recoveryGeneration},
	} {
		t.Run(test.name, func(t *testing.T) {
			item := &instance{ManagedID: "desktop", SessionState: "failed", State: "server-ready", SessionGeneration: 9, RuntimeDesired: "running", Spec: classConfig{RunMode: "user-home"}}
			test.change(item)
			if got := failedSessionRecoveryRejection(item, item.Spec.RunMode); got != test.want {
				t.Fatalf("reason=%q, want %q", got, test.want)
			}
		})
	}
}

// The systemctl double records the manifest it sees at the cleanup boundary.
// It never operates a host service. PID fixtures and failed storage live in
// TempDir; the canonical socket path is verified absent before any cleanup.
func recoveryIntentFixture(t *testing.T, failure string) (*manager, *instance, string, string) {
	t.Helper()
	stateDir := t.TempDir()
	m := &manager{cfg: config{stateDir: stateDir}, instances: map[string]*instance{}}
	item := testRuntimeManifest(t, stateDir, "fixture-193ab47ed826", "desktop")
	if _, err := os.Lstat(item.SocketRuntime); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("fixture socket path must be absent: %v", err)
	}
	item.Spec.RunMode = "user-home"
	item.Spec.Session.ReadinessPID = "fixture.pid"
	item.SessionState, item.SessionGeneration, item.Error = "failed", 9, "readiness leader exited"
	m.instances[item.ID] = item
	marker := filepath.Join(item.Runtime, item.Spec.Session.ReadinessPID)
	if err := os.WriteFile(marker, []byte("old fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := m.persistRuntime(item); err != nil {
		t.Fatal(err)
	}
	fixtureDir := t.TempDir()
	snapshot := filepath.Join(fixtureDir, "stop-snapshot.json")
	t.Setenv("REMOTEXAPP_TEST_RECOVERY_MANIFEST", filepath.Join(m.runtimeManifestDir(), item.ID+".json"))
	t.Setenv("REMOTEXAPP_TEST_RECOVERY_SNAPSHOT", snapshot)
	t.Setenv("REMOTEXAPP_TEST_RECOVERY_FAILURE", failure)
	t.Setenv("REMOTEXAPP_TEST_RECOVERY_BACKUP", filepath.Join(stateDir, "saved-manifests"))
	script := `#!/bin/sh
case "$2" in
  is-active)
    if [ "$REMOTEXAPP_TEST_RECOVERY_FAILURE" = populated ]; then exit 0; fi
    exit 3 ;;
  stop)
    cat "$REMOTEXAPP_TEST_RECOVERY_MANIFEST" > "$REMOTEXAPP_TEST_RECOVERY_SNAPSHOT" || exit 1
    case "$REMOTEXAPP_TEST_RECOVERY_FAILURE" in
      stop) echo injected-stop-failure; exit 1 ;;
      persist)
        directory=$(dirname "$REMOTEXAPP_TEST_RECOVERY_MANIFEST")
        mv "$directory" "$REMOTEXAPP_TEST_RECOVERY_BACKUP" || exit 1
        printf blocked > "$directory" || exit 1
        ;;
    esac
    exit 0 ;;
esac
exit 1
`
	if err := os.WriteFile(filepath.Join(fixtureDir, "systemctl"), []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", fixtureDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	return m, item, marker, snapshot
}

func readRecoverySnapshot(t *testing.T, path string) runtimeManifestRecord {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var record runtimeManifestRecord
	if err := json.Unmarshal(data, &record); err != nil {
		t.Fatal(err)
	}
	return record
}

func prepareRecoveryForTest(m *manager, id string) (*instance, error) {
	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()
	return m.prepareFailedSessionRecovery(id)
}

func TestRecoveryIntentPrecedesCleanupAndKeepsLegacyFormat(t *testing.T) {
	m, item, marker, snapshot := recoveryIntentFixture(t, "")
	got, err := prepareRecoveryForTest(m, item.ID)
	if err != nil {
		t.Fatal(err)
	}
	atStop := readRecoverySnapshot(t, snapshot)
	if atStop.Runtime.SessionState != "failed" || atStop.Runtime.SessionRecovery == nil || atStop.Runtime.SessionRecovery.Attempts != 1 {
		t.Fatalf("cleanup saw an uncharged/nonfailed intent: %+v", atStop.Runtime)
	}
	if _, err := os.Stat(marker); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("old PID fixture not removed: %v", err)
	}
	if got.SessionState != "stopped" || got.Error != "" || got.SessionGeneration != 9 || got.ID != item.ID || got.Components != item.Components {
		t.Fatalf("preparation changed identity or launched a generation: %+v", got)
	}
	records, err := m.loadRuntimeManifests()
	if err != nil || len(records) != 1 {
		t.Fatalf("load records=%v error=%v", records, err)
	}
	if records[0].SchemaVersion != 2 || records[0].Runtime.SessionState != "stopped" || records[0].Runtime.SessionRecovery.Attempts != 1 {
		t.Fatalf("legacy manifest did not retain prepared state: %+v", records[0])
	}
	// The old two-field recovery JSON remains readable without a migration.
	b, err := json.Marshal(records[0].Runtime.SessionRecovery)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(b, &fields); err != nil || len(fields) != 2 || fields["attempts"] == nil || fields["windowStart"] == nil {
		t.Fatalf("legacy counter format changed: %s (%v)", b, err)
	}
}

func TestRecoveryIntentWriteFailureDoesNotCleanOrAdvance(t *testing.T) {
	m, item, marker, snapshot := recoveryIntentFixture(t, "")
	// Break persistence independently of permissions or the executing UID.
	m.cfg.stateDir = filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(m.cfg.stateDir, []byte("blocked"), 0o600); err != nil {
		t.Fatal(err)
	}
	m.lifecycleMu.Lock()
	err := m.startSession(item.ID)
	m.lifecycleMu.Unlock()
	if err == nil || !strings.Contains(err.Error(), "persist managed session recovery intent") {
		t.Fatalf("unexpected write failure: %v", err)
	}
	if _, err := os.Stat(marker); err != nil {
		t.Fatalf("write failure removed old PID fixture: %v", err)
	}
	if _, err := os.Stat(snapshot); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("cleanup executed despite write failure: %v", err)
	}
	if got := m.get(item.ID); got.SessionRecovery != nil || got.SessionState != "failed" || got.SessionGeneration != 9 {
		t.Fatalf("write failure changed in-memory admission: %+v", got)
	}
}

func TestRecoveryCleanupFailureChargesAttemptsAcrossReload(t *testing.T) {
	m, item, marker, _ := recoveryIntentFixture(t, "stop")
	for attempt := 1; attempt <= 3; attempt++ {
		_, err := prepareRecoveryForTest(m, item.ID)
		if err == nil || !strings.Contains(err.Error(), "session recovery cleanup") {
			t.Fatalf("attempt %d: %v", attempt, err)
		}
		records, err := m.loadRuntimeManifests()
		if err != nil || len(records) != 1 {
			t.Fatalf("reload after attempt %d: records=%v error=%v", attempt, records, err)
		}
		restored := records[0].Runtime
		if restored.SessionRecovery == nil || restored.SessionRecovery.Attempts != attempt || restored.SessionState != "failed" || restored.SessionGeneration != 9 || restored.Error != "readiness leader exited" {
			t.Fatalf("cleanup failure lost charged intent: %+v", restored)
		}
		m = &manager{cfg: m.cfg, instances: map[string]*instance{restored.ID: &restored}}
	}
	if _, err := prepareRecoveryForTest(m, item.ID); err != recoveryExhausted {
		t.Fatalf("reloaded fourth attempt was not blocked: %v", err)
	}
	if _, err := os.Stat(marker); err != nil {
		t.Fatalf("failed stop removed the PID fixture: %v", err)
	}
}

func TestRecoveryStoppedWriteFailureDoesNotRefundIntent(t *testing.T) {
	m, item, _, snapshot := recoveryIntentFixture(t, "persist")
	m.lifecycleMu.Lock()
	err := m.startSession(item.ID)
	m.lifecycleMu.Unlock()
	if err == nil || !strings.Contains(err.Error(), "persist cleaned session recovery") {
		t.Fatalf("unexpected stopped-state write result: %v", err)
	}
	if got := m.get(item.ID); got.SessionState != "failed" || got.SessionGeneration != 9 || got.SessionRecovery == nil || got.SessionRecovery.Attempts != 1 {
		t.Fatalf("stopped-state failure refunded admission: %+v", got)
	}
	intent := readRecoverySnapshot(t, snapshot)
	if intent.Runtime.SessionState != "failed" || intent.Runtime.SessionRecovery.Attempts != 1 {
		t.Fatalf("failed stop write lost earlier durable charge: %+v", intent.Runtime)
	}
}

func TestRecoveryAdmissionGuardsDoNotChargeOrClean(t *testing.T) {
	for _, test := range []struct {
		name   string
		change func(*instance)
		want   sessionRecoveryRejection
	}{
		{"viewer", func(i *instance) { i.AttachedClients = 1 }, recoveryViewers},
		{"stopped", func(i *instance) { i.RuntimeDesired = "stopped" }, recoveryStopped},
		{"shutdown", func(i *instance) { i.Shutdown = &shutdownStatus{State: "blocked"} }, recoveryShutdown},
		{"budget", func(i *instance) { i.SessionRecovery = &sessionRecovery{WindowStart: time.Now(), Attempts: 3} }, recoveryExhausted},
	} {
		t.Run(test.name, func(t *testing.T) {
			m, item, marker, snapshot := recoveryIntentFixture(t, "")
			test.change(item)
			before := item.SessionRecovery
			if _, err := prepareRecoveryForTest(m, item.ID); err != test.want {
				t.Fatalf("admission error=%v, want %v", err, test.want)
			}
			if _, err := os.Stat(snapshot); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("blocked admission executed cleanup: %v", err)
			}
			if _, err := os.Stat(marker); err != nil {
				t.Fatal(err)
			}
			if item.SessionRecovery != before || item.SessionGeneration != 9 {
				t.Fatal("blocked admission charged an attempt or generation")
			}
		})
	}
}

func TestRecoveryPreservesPopulatedOrUnknownComponents(t *testing.T) {
	for _, kind := range []string{"populated", "unknown"} {
		t.Run(kind, func(t *testing.T) {
			m, item, marker, snapshot := recoveryIntentFixture(t, kind)
			if kind == "unknown" {
				root := t.TempDir()
				path := filepath.Join(root, item.SessionUnit)
				if err := os.Mkdir(path, 0o700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(path, "cgroup.events"), []byte("unknown evidence"), 0o600); err != nil {
					t.Fatal(err)
				}
				m.standalone = &standaloneCgroupRoot{path: root}
			}
			if _, err := prepareRecoveryForTest(m, item.ID); err != recoveryProcesses {
				t.Fatalf("uncertain component admitted: %v", err)
			}
			if _, err := os.Stat(snapshot); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("component was stopped: %v", err)
			}
			if _, err := os.Stat(marker); err != nil {
				t.Fatal(err)
			}
			if item.SessionRecovery != nil || item.SessionGeneration != 9 {
				t.Fatal("blocked component consumed budget or generation")
			}
		})
	}
}

func TestRecoveryHonorsStoppedManagedIntentBeforeRuntimeProjection(t *testing.T) {
	m, item, marker, snapshot := recoveryIntentFixture(t, "")
	m.managed = map[string]*managedInstance{item.ManagedID: {ID: item.ManagedID, DesiredState: "stopped"}}
	if _, err := prepareRecoveryForTest(m, item.ID); err != recoveryStopped {
		t.Fatalf("stale running runtime bypassed managed stop: %v", err)
	}
	if _, err := os.Stat(snapshot); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("managed stop permitted cleanup: %v", err)
	}
	if _, err := os.Stat(marker); err != nil {
		t.Fatal(err)
	}
	if item.SessionRecovery != nil || item.SessionGeneration != 9 {
		t.Fatal("managed stop consumed attempt or generation")
	}
}
