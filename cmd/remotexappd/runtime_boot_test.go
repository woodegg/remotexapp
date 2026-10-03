package main

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

const oldTestBoot = "11111111-1111-4111-8111-111111111111"
const newTestBoot = "22222222-2222-4222-8222-222222222222"

func bootFixture(t *testing.T, managed bool) (*manager, *runtimeManifestRecord) {
	t.Helper()
	m := &manager{bootID: newTestBoot, cfg: config{stateDir: t.TempDir()}, instances: map[string]*instance{}, managed: map[string]*managedInstance{}, idleTimers: map[string]*time.Timer{},
		runtimeAdoptionCheck: func(*instance) error { return errors.New("previous boot resources gone") }, runtimeSessionAliveCheck: func(*instance) bool { return false }}
	managedID := ""
	if managed {
		managedID = "desktop"
		m.managed[managedID] = &managedInstance{ID: managedID, DesiredState: "running"}
	}
	id, err := randomID("boot-fixture")
	if err != nil {
		t.Fatal(err)
	}
	item := testRuntimeManifest(t, m.cfg.stateDir, id, managedID)
	// Keep the real path invariant, but never touch a pre-existing /run entry.
	if _, err := os.Lstat(item.SocketRuntime); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("disposable socket path is not absent")
	}
	item.Spec.Session.VacantAction = "keep"
	item.Spec.Session.Activation = "on-attach"
	item.SessionState, item.SessionGeneration = "running", 12
	item.Parameters = map[string]any{"document": "preserved.txt"}
	old := &manager{bootID: oldTestBoot}
	if err := old.writeRuntimeBoot(item); err != nil {
		t.Fatal(err)
	}
	return m, &runtimeManifestRecord{SchemaVersion: runtimeManifestSchema, DesiredState: "running", Runtime: *item, ResolvedSpec: item.Spec, Components: item.Components, Overrides: item.Overrides}
}

func TestBootRecoveryEligibility(t *testing.T) {
	for _, test := range []struct {
		name   string
		change func(*manager, *runtimeManifestRecord)
		want   bool
	}{
		{"running-after-boot", func(*manager, *runtimeManifestRecord) {}, true},
		{"stopped-session-after-boot", func(_ *manager, r *runtimeManifestRecord) { r.Runtime.SessionState = "stopped" }, true},
		{"same-boot", func(m *manager, _ *runtimeManifestRecord) { m.bootID = oldTestBoot }, false},
		{"unknown-current-boot", func(m *manager, _ *runtimeManifestRecord) { m.bootID = "" }, false},
		{"live-App", func(m *manager, _ *runtimeManifestRecord) {
			m.runtimeSessionAliveCheck = func(*instance) bool { return true }
		}, false},
		{"failed-session", func(_ *manager, r *runtimeManifestRecord) { r.Runtime.SessionState = "failed" }, false},
		{"starting-session", func(_ *manager, r *runtimeManifestRecord) { r.Runtime.SessionState = "starting" }, false},
		{"blocked-session", func(_ *manager, r *runtimeManifestRecord) { r.Runtime.SessionState = "shutdown-blocked" }, false},
		{"failed-server", func(_ *manager, r *runtimeManifestRecord) { r.Runtime.State = "failed" }, false},
		{"explicit-runtime-stop", func(_ *manager, r *runtimeManifestRecord) { r.DesiredState = "stopped" }, false},
		{"explicit-managed-stop", func(m *manager, _ *runtimeManifestRecord) { m.managed["desktop"].DesiredState = "stopped" }, false},
		{"pending-shutdown", func(_ *manager, r *runtimeManifestRecord) { r.Runtime.Shutdown = &shutdownStatus{State: "requested"} }, false},
		{"completed-shutdown", func(_ *manager, r *runtimeManifestRecord) { r.Runtime.Shutdown = &shutdownStatus{State: "completed"} }, true},
		{"cancelled-shutdown", func(_ *manager, r *runtimeManifestRecord) { r.Runtime.Shutdown = &shutdownStatus{State: "cancelled"} }, true},
		{"timed-out-shutdown", func(_ *manager, r *runtimeManifestRecord) { r.Runtime.Shutdown = &shutdownStatus{State: "timeout"} }, false},
		{"unknown-shutdown", func(_ *manager, r *runtimeManifestRecord) { r.Runtime.Shutdown = &shutdownStatus{State: "unknown"} }, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			m, r := bootFixture(t, true)
			test.change(m, r)
			got, err := m.prepareBootRecovery(r)
			if err != nil || got != test.want {
				t.Fatalf("eligible=%v err=%v want=%v", got, err, test.want)
			}
			if got && (r.Runtime.State != "restarting" || r.Runtime.SessionGeneration != 12) {
				t.Fatal("recovery did not preserve generation in durable intent")
			}
		})
	}
}

func TestBootRecoveryRestoresPinnedRuntimeOnce(t *testing.T) {
	for _, managed := range []bool{false, true} {
		for _, interrupted := range []bool{false, true} {
			t.Run(strings.Join([]string{map[bool]string{true: "managed", false: "anonymous"}[managed], map[bool]string{true: "interrupted", false: "direct"}[interrupted]}, "-"), func(t *testing.T) {
				installSystemctlStub(t, true)
				m, r := bootFixture(t, managed)
				if interrupted {
					if started, err := m.prepareBootRecovery(r); !started || err != nil {
						t.Fatalf("prepare=%v %v", started, err)
					}
				}
				calls := 0
				m.runtimeRecoveryCreate = func(request createRequest) (*instance, error) {
					calls++
					if request.RuntimeID != r.Runtime.ID || request.SessionGeneration != 13 || request.ProfileRef != r.Runtime.ProfileRef ||
						!request.CreatedAt.Equal(r.Runtime.CreatedAt) || !reflect.DeepEqual(request.Parameters, r.Runtime.Parameters) ||
						!reflect.DeepEqual(request.PinnedSpec, r.ResolvedSpec) || !reflect.DeepEqual(request.PinnedComponents, r.Components) {
						t.Fatalf("lost pin/configuration/generation: %+v", request)
					}
					b, err := os.ReadFile(filepath.Join(m.runtimeManifestDir(), r.Runtime.ID+".json"))
					if err != nil || !strings.Contains(string(b), `"state": "restarting"`) {
						t.Fatal("recovery intent was not durable before recreation")
					}
					if err := os.MkdirAll(r.Runtime.Runtime, 0700); err != nil {
						t.Fatal(err)
					}
					next := r.Runtime
					next.State, next.SessionState, next.SessionGeneration = "server-ready", "stopped", request.SessionGeneration
					if err := m.writeRuntimeBoot(&next); err != nil {
						t.Fatal(err)
					}
					m.storeRuntime(&next)
					if err := m.persistRuntime(&next); err != nil {
						t.Fatal(err)
					}
					return &next, nil
				}
				m.restoreRuntimeManifests([]runtimeManifestRecord{*r})
				got := m.get(r.Runtime.ID)
				if got == nil || got.SessionGeneration != 13 || got.SessionState != "stopped" || calls != 1 {
					t.Fatalf("recovery=%+v calls=%d", got, calls)
				}
				if id, err := readRuntimeBoot(got); err != nil || id != newTestBoot {
					t.Fatalf("new boot identity %q %v", id, err)
				}
				m.runtimeAdoptionCheck = func(*instance) error { return nil }
				next := *r
				next.Runtime = *got
				m.restoreRuntimeManifests([]runtimeManifestRecord{next})
				if calls != 1 || m.get(got.ID).SessionGeneration != 13 {
					t.Fatal("same-boot restart repeated recovery")
				}
			})
		}
	}
}

func TestBootRecoveryFailureIsNotAutomaticallyRetried(t *testing.T) {
	for _, cleanupFailure := range []bool{false, true} {
		t.Run(map[bool]string{true: "cleanup", false: "recreation"}[cleanupFailure], func(t *testing.T) {
			installSystemctlStub(t, !cleanupFailure)
			m, r := bootFixture(t, true)
			calls := 0
			m.runtimeRecoveryCreate = func(createRequest) (*instance, error) { calls++; return nil, errors.New("injected recreation failure") }
			m.restoreRuntimeManifests([]runtimeManifestRecord{*r})
			got := m.get(r.Runtime.ID)
			if got == nil || got.State != "failed" || got.SessionState != "failed" {
				t.Fatalf("failure not retained: %+v", got)
			}
			expected := calls
			if calls != map[bool]int{true: 0, false: 1}[cleanupFailure] {
				t.Fatal("did not reach intended recovery failure")
			}
			for i := 0; i < 3; i++ {
				next := *r
				next.Runtime = *got
				m.restoreRuntimeManifests([]runtimeManifestRecord{next})
			}
			if calls != expected {
				t.Fatal("failed boot recovery automatically retried")
			}
		})
	}
}

func TestRuntimeBootIdentityValidationAndBackfill(t *testing.T) {
	m, r := bootFixture(t, false)
	path := filepath.Join(r.Runtime.Runtime, "runtime-boot.json")
	valid, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct{ name, body string }{
		{"malformed", "{"}, {"trailing", string(valid) + "{}"}, {"wrong-runtime", strings.ReplaceAll(string(valid), r.Runtime.ID, "other")},
		{"wrong-boot", strings.ReplaceAll(string(valid), oldTestBoot, "not-a-boot")}, {"unknown-field", strings.TrimSuffix(string(valid), "}") + `,"extra":true}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := os.WriteFile(path, []byte(test.body), 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := readRuntimeBoot(&r.Runtime); err == nil {
				t.Fatal("invalid identity accepted")
			}
			if err := m.rememberAdoptedRuntimeBoot(&r.Runtime); err == nil {
				t.Fatal("invalid identity overwritten")
			}
		})
	}
	if err := os.WriteFile(path, valid, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := readRuntimeBoot(&r.Runtime); err == nil {
		t.Fatal("public identity accepted")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if ok, err := m.prepareBootRecovery(r); ok || err != nil {
		t.Fatalf("missing legacy identity authorized replay: %v %v", ok, err)
	}
	if err := m.rememberAdoptedRuntimeBoot(&r.Runtime); err != nil {
		t.Fatal(err)
	}
	if id, err := readRuntimeBoot(&r.Runtime); id != newTestBoot || err != nil {
		t.Fatalf("backfill=%q %v", id, err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(t.TempDir(), "target")
	if err := os.WriteFile(target, valid, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, path); err != nil {
		t.Fatal(err)
	}
	if _, err := readRuntimeBoot(&r.Runtime); err == nil {
		t.Fatal("symlink identity accepted")
	}
}

func TestKernelBootIdentityIsCanonical(t *testing.T) {
	id, err := readSystemBootID()
	if err != nil || !bootIDPattern.MatchString(id) {
		t.Fatalf("kernel boot identity %q %v", id, err)
	}
}

func TestRuntimeBootBackfillRequiresHealthyAdoption(t *testing.T) {
	for _, scenario := range []string{"healthy", "failed", "offline-exit"} {
		t.Run(scenario, func(t *testing.T) {
			m, r := bootFixture(t, false)
			m.sessionObserver = &recordingSessionObserver{}
			path := filepath.Join(r.Runtime.Runtime, "runtime-boot.json")
			if err := os.Remove(path); err != nil {
				t.Fatal(err)
			}
			if scenario == "healthy" {
				m.runtimeAdoptionCheck = func(*instance) error { return nil }
			} else if scenario == "failed" {
				r.Runtime.SessionState = "failed"
			}
			m.runtimeRecoveryCreate = func(createRequest) (*instance, error) {
				t.Fatal("legacy record replayed without boot proof")
				return nil, nil
			}
			m.restoreRuntimeManifests([]runtimeManifestRecord{*r})
			id, err := readRuntimeBoot(&r.Runtime)
			if scenario == "healthy" {
				if err != nil || id != newTestBoot {
					t.Fatalf("healthy adoption did not backfill: %q %v", id, err)
				}
			} else if !errors.Is(err, os.ErrNotExist) {
				t.Fatal("unhealthy legacy runtime received new boot proof")
			}
		})
	}
}

func TestBootRecoveryGenerationExhaustionPreservesState(t *testing.T) {
	m, r := bootFixture(t, false)
	r.Runtime.SessionGeneration = 1<<53 - 1
	if ok, err := m.prepareBootRecovery(r); ok || err == nil {
		t.Fatal("exhausted generation permitted boot recreation")
	}
	if r.Runtime.State != "server-ready" {
		t.Fatal("generation failure mutated recovery intent")
	}
}
