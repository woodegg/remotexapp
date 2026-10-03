package main

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func testRuntimeManifest(t *testing.T, stateDir, id, managedID string) *instance {
	t.Helper()
	spec := classConfig{ID: "fixture-app", DriverVersion: "2.0.0", Session: sessionClassConfig{Services: "core-v1", VacantTimeout: "5s"}}
	runtimePath := filepath.Join(stateDir, "instances", id)
	if err := os.MkdirAll(runtimePath, 0o700); err != nil {
		t.Fatal(err)
	}
	return &instance{
		ID: id, ClassID: spec.ID, TemplateID: spec.ID, DriverVersion: spec.DriverVersion,
		ManagedID: managedID, ProfileRef: "default", WorkspaceMode: "persistent",
		State: "server-ready", SessionState: "stopped", CreatedAt: time.Now(),
		RuntimeDesired: "running",
		Runtime:        runtimePath, SocketRuntime: filepath.Join("/run/user", strconv.Itoa(os.Getuid()), "remotexappd", id[len(id)-12:]),
		VNCUnit: "remotexapp-" + id + "-vnc.service", GatewayUnit: "remotexapp-" + id + "-gateway.service",
		SessionUnit: "remotexapp-" + id + "-session.service", Spec: spec,
		Components: runtimeComponents{GatewayBinary: "/release/novnc-input", UnicodeEngine: "/release/engine.py"},
		Overrides:  instanceOverrides{WorkspaceMode: "persistent"}, VacantTimeout: 5 * time.Second,
	}
}

type recordingManagedObserver struct {
	watchedManaged string
	watchedRuntime string
}

func (o *recordingManagedObserver) Watch(managedID string, runtime *instance) error {
	o.watchedManaged, o.watchedRuntime = managedID, runtime.ID
	return nil
}
func (*recordingManagedObserver) Unwatch(string) {}
func (*recordingManagedObserver) Close() error   { return nil }

type recordingSessionObserver struct {
	instanceID string
	generation int64
	unit       string
}

func (o *recordingSessionObserver) WatchSession(instanceID string, generation int64, unit string) error {
	o.instanceID, o.generation, o.unit = instanceID, generation, unit
	return nil
}
func (*recordingSessionObserver) UnwatchSession(string, int64) {}

func installSystemctlStub(t *testing.T, succeed bool) {
	t.Helper()
	binDir := t.TempDir()
	script := "#!/bin/sh\nexit 0\n"
	if !succeed {
		script = "#!/bin/sh\necho injected-stop-failure >&2\nexit 1\n"
	}
	if err := os.WriteFile(filepath.Join(binDir, "systemctl"), []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
}

func TestRuntimeManifestRoundTripAndPermissions(t *testing.T) {
	stateDir := t.TempDir()
	m := &manager{cfg: config{stateDir: stateDir}}
	item := testRuntimeManifest(t, stateDir, "mousepad-0123456789ab", "")
	item.ControlPort = 21000
	item.Spec.Control = controlClassConfig{Protocol: "loopback-tcp"}
	if err := m.persistRuntime(item); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(m.runtimeManifestDir(), item.ID+".json")
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("manifest mode = %#o, want 0600", info.Mode().Perm())
	}
	records, err := m.loadRuntimeManifests()
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 || records[0].Runtime.ID != item.ID || records[0].Runtime.Spec.DriverVersion != "2.0.0" {
		t.Fatalf("reloaded manifests: %#v", records)
	}
	if records[0].Overrides.WorkspaceMode != "persistent" || records[0].Runtime.Components.GatewayBinary != "/release/novnc-input" {
		t.Fatalf("runtime launch snapshot was not restored: %#v", records[0])
	}
	if records[0].DesiredState != "running" || records[0].Runtime.RuntimeDesired != "running" {
		t.Fatalf("runtime desired state was not restored: %#v", records[0])
	}
	if records[0].Runtime.ControlPort != 21000 || records[0].ResolvedSpec.Control.Protocol != "loopback-tcp" {
		t.Fatalf("runtime control endpoint was not restored: %#v", records[0])
	}
	if records[0].Runtime.ControlAddress != "127.0.0.1" || records[0].ResolvedSpec.Control.Address != "127.0.0.1" {
		t.Fatalf("legacy loopback control address was not normalized: %#v", records[0])
	}
}

func TestRuntimeManifestBackendIsPinned(t *testing.T) {
	stateDir := t.TempDir()
	standalone := &manager{cfg: config{stateDir: stateDir, lifecycleBackend: "standalone"}}
	item := testRuntimeManifest(t, stateDir, "mousepad-0123456789ab", "")
	if err := standalone.persistRuntime(item); err != nil {
		t.Fatal(err)
	}
	records, err := standalone.loadRuntimeManifests()
	if err != nil || len(records) != 1 || records[0].Backend != "standalone" {
		t.Fatalf("standalone manifest: records=%v err=%v", records, err)
	}
	systemd := &manager{cfg: config{stateDir: stateDir, lifecycleBackend: "systemd"}}
	if _, err := systemd.loadRuntimeManifests(); err == nil || !strings.Contains(err.Error(), "lifecycle backend") {
		t.Fatalf("cross-backend manifest accepted: %v", err)
	}
}

func TestRuntimeManifestRestoresLegacyLoopbackWebSocketEndpoint(t *testing.T) {
	stateDir := t.TempDir()
	m := &manager{cfg: config{stateDir: stateDir}}
	item := testRuntimeManifest(t, stateDir, "legacy-app-00123456", "")
	item.ControlAddress = "127.0.0.1"
	item.ControlPort = 21042
	item.ControlWebSocketURL = "ws://127.0.0.1:21042/session"
	item.Spec.Control = controlClassConfig{Protocol: "legacy-control", Address: "127.0.0.1", Path: "/session"}
	if err := m.persistRuntime(item); err != nil {
		t.Fatal(err)
	}
	records, err := m.loadRuntimeManifests()
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 || records[0].Runtime.ControlAddress != "127.0.0.1" || records[0].Runtime.ControlPort != 21042 || records[0].Runtime.ControlWebSocketURL != "ws://127.0.0.1:21042/session" {
		t.Fatalf("legacy loopback WebSocket endpoint was not restored: %#v", records)
	}
}

func TestRuntimeManifestRestoresDerivedLifecycleFields(t *testing.T) {
	stateDir := t.TempDir()
	m := &manager{cfg: config{stateDir: stateDir}}
	item := testRuntimeManifest(t, stateDir, "mousepad-998877665544", "")
	item.WorkspaceMode = "ephemeral"
	item.Spec.Session.VacantTimeout = "37s"
	item.VacantTimeout = 37 * time.Second
	if err := m.persistRuntime(item); err != nil {
		t.Fatal(err)
	}
	records, err := m.loadRuntimeManifests()
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 || !records[0].Runtime.EphemeralHome || records[0].Runtime.VacantTimeout != 37*time.Second {
		t.Fatalf("derived lifecycle fields were not restored: %#v", records)
	}
}

func TestRuntimeManifestRejectsUnknownFields(t *testing.T) {
	stateDir := t.TempDir()
	m := &manager{cfg: config{stateDir: stateDir}}
	item := testRuntimeManifest(t, stateDir, "mousepad-abcdef012345", "")
	if err := m.persistRuntime(item); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(m.runtimeManifestDir(), item.ID+".json")
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	payload = bytes.Replace(payload, []byte(`"schemaVersion": 2,`), []byte(`"schemaVersion": 2, "unexpected": true,`), 1)
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := m.loadRuntimeManifests(); err == nil {
		t.Fatal("unknown manifest field was accepted")
	}
}

func TestRuntimeManifestRejectsInsecurePermissions(t *testing.T) {
	stateDir := t.TempDir()
	m := &manager{cfg: config{stateDir: stateDir}}
	item := testRuntimeManifest(t, stateDir, "mousepad-112233445566", "")
	if err := m.persistRuntime(item); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(m.runtimeManifestDir(), item.ID+".json")
	if err := os.Chmod(path, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := m.loadRuntimeManifests(); err == nil {
		t.Fatal("world-readable runtime manifest was accepted")
	}
}

func TestRuntimeManifestRejectsTruncatedAndUnsupportedRecords(t *testing.T) {
	for _, test := range []struct {
		name   string
		mutate func([]byte) []byte
	}{
		{name: "truncated", mutate: func(payload []byte) []byte { return payload[:len(payload)/2] }},
		{name: "unsupported schema", mutate: func(payload []byte) []byte {
			return bytes.Replace(payload, []byte(`"schemaVersion": 2`), []byte(`"schemaVersion": 99`), 1)
		}},
		{name: "multiple values", mutate: func(payload []byte) []byte { return append(payload, []byte("{}\n")...) }},
	} {
		t.Run(test.name, func(t *testing.T) {
			stateDir := t.TempDir()
			m := &manager{cfg: config{stateDir: stateDir}}
			item := testRuntimeManifest(t, stateDir, "mousepad-778899aabbcc", "")
			if err := m.persistRuntime(item); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(m.runtimeManifestDir(), item.ID+".json")
			payload, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, test.mutate(payload), 0o600); err != nil {
				t.Fatal(err)
			}
			if _, err := m.loadRuntimeManifests(); err == nil {
				t.Fatal("invalid runtime manifest was accepted")
			}
		})
	}
}

func TestEmbeddedManagedRuntimeDoesNotCreateAuthoritativeManifest(t *testing.T) {
	stateDir := t.TempDir()
	m := &manager{cfg: config{stateDir: stateDir}, managed: map[string]*managedInstance{}}
	runtime := testRuntimeManifest(t, stateDir, "mousepad-fedcba987654", "resident-pad")
	managed := &managedInstance{
		ID: "resident-pad", TemplateID: runtime.TemplateID, DesiredState: "running",
		RuntimeInstanceID: runtime.ID, Runtime: runtime, Overrides: runtime.Overrides,
	}
	m.managed[managed.ID] = managed
	records, err := m.loadRuntimeManifests()
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 0 {
		t.Fatalf("embedded snapshot was promoted to an authoritative runtime: %#v", records)
	}
}

func TestRuntimeManifestRepairsManagedForeignKeyCrashWindow(t *testing.T) {
	managed := &managedInstance{ID: "resident-pad", DesiredState: "running"}
	m := &manager{managed: map[string]*managedInstance{managed.ID: managed}}
	record := runtimeManifestRecord{Runtime: instance{ID: "mousepad-aabbccddeeff", ManagedID: managed.ID}}
	bound, err := m.bindManagedRuntimeManifests([]runtimeManifestRecord{record})
	if err != nil {
		t.Fatal(err)
	}
	if len(bound) != 1 || managed.RuntimeInstanceID != record.Runtime.ID {
		t.Fatalf("managed foreign key = %q, want %q", managed.RuntimeInstanceID, record.Runtime.ID)
	}
	if managed.RuntimeInstanceID != record.Runtime.ID {
		t.Fatalf("managed foreign key = %q, want %q", managed.RuntimeInstanceID, record.Runtime.ID)
	}
}

func TestDuplicateManagedRuntimeManifestsRetireStalePointer(t *testing.T) {
	installSystemctlStub(t, true)
	stateDir := t.TempDir()
	old := testRuntimeManifest(t, stateDir, "fixture-old00112233", "resident-pad")
	old.CreatedAt = time.Now().Add(-time.Minute)
	current := testRuntimeManifest(t, stateDir, "fixture-new00112233", "resident-pad")
	managed := &managedInstance{ID: "resident-pad", DesiredState: "running", RuntimeInstanceID: current.ID}
	m := &manager{cfg: config{stateDir: stateDir}, managed: map[string]*managedInstance{managed.ID: managed}}
	for _, item := range []*instance{old, current} {
		if err := m.persistRuntime(item); err != nil {
			t.Fatal(err)
		}
	}
	records, err := m.loadRuntimeManifests()
	if err != nil {
		t.Fatal(err)
	}
	bound, err := m.bindManagedRuntimeManifests(records)
	if err != nil {
		t.Fatal(err)
	}
	if len(bound) != 1 || bound[0].Runtime.ID != current.ID || managed.RuntimeInstanceID != current.ID {
		t.Fatalf("bound manifests=%#v managed=%#v", bound, managed)
	}
	if _, err := os.Stat(filepath.Join(m.runtimeManifestDir(), old.ID+".json")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("stale manifest remains: %v", err)
	}
	if _, err := os.Stat(old.Runtime); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("stale runtime directory remains: %v", err)
	}
}

func TestDuplicateManagedRuntimeManifestsPreferOnlyLiveApplication(t *testing.T) {
	installSystemctlStub(t, true)
	stateDir := t.TempDir()
	live := testRuntimeManifest(t, stateDir, "fixture-live0112233", "resident-pad")
	live.SessionState = "running"
	pointed := testRuntimeManifest(t, stateDir, "fixture-next0112233", "resident-pad")
	managed := &managedInstance{ID: "resident-pad", DesiredState: "running", RuntimeInstanceID: pointed.ID}
	m := &manager{
		cfg: config{stateDir: stateDir}, managed: map[string]*managedInstance{managed.ID: managed},
		runtimeSessionAliveCheck: func(item *instance) bool { return item.ID == live.ID },
	}
	for _, item := range []*instance{live, pointed} {
		if err := m.persistRuntime(item); err != nil {
			t.Fatal(err)
		}
	}
	records, err := m.loadRuntimeManifests()
	if err != nil {
		t.Fatal(err)
	}
	bound, err := m.bindManagedRuntimeManifests(records)
	if err != nil {
		t.Fatal(err)
	}
	if len(bound) != 1 || bound[0].Runtime.ID != live.ID || managed.RuntimeInstanceID != live.ID {
		t.Fatalf("live runtime was not preserved: bound=%#v managed=%#v", bound, managed)
	}
}

func TestDuplicateManagedRuntimeManifestsRejectMultipleLiveApplications(t *testing.T) {
	stateDir := t.TempDir()
	first := testRuntimeManifest(t, stateDir, "fixture-live1112233", "resident-pad")
	second := testRuntimeManifest(t, stateDir, "fixture-live2112233", "resident-pad")
	first.SessionState, second.SessionState = "running", "running"
	m := &manager{
		cfg: config{stateDir: stateDir}, managed: map[string]*managedInstance{
			"resident-pad": {ID: "resident-pad", DesiredState: "running"},
		},
		runtimeSessionAliveCheck: func(*instance) bool { return true },
	}
	if _, err := m.bindManagedRuntimeManifests([]runtimeManifestRecord{{Runtime: *first}, {Runtime: *second}}); err == nil {
		t.Fatal("multiple live managed applications were resolved destructively")
	}
}

func TestDuplicateManagedRuntimeManifestsWithoutPointerUseNewestRecoverableRecord(t *testing.T) {
	installSystemctlStub(t, true)
	stateDir := t.TempDir()
	old := testRuntimeManifest(t, stateDir, "fixture-old10112233", "resident-pad")
	old.CreatedAt = time.Now().Add(-time.Minute)
	newest := testRuntimeManifest(t, stateDir, "fixture-new10112233", "resident-pad")
	m := &manager{
		cfg: config{stateDir: stateDir}, managed: map[string]*managedInstance{
			"resident-pad": {ID: "resident-pad", DesiredState: "running"},
		},
		runtimeAdoptionCheck: func(*instance) error { return errors.New("injected unhealthy runtime") },
	}
	for _, item := range []*instance{old, newest} {
		if err := m.persistRuntime(item); err != nil {
			t.Fatal(err)
		}
	}
	records, err := m.loadRuntimeManifests()
	if err != nil {
		t.Fatal(err)
	}
	bound, err := m.bindManagedRuntimeManifests(records)
	if err != nil {
		t.Fatal(err)
	}
	if len(bound) != 1 || bound[0].Runtime.ID != newest.ID {
		t.Fatalf("newest recoverable manifest was not selected: %#v", bound)
	}
}

func TestDuplicateManagedRuntimeManifestsWithoutPointerUseUniqueHealthyRecord(t *testing.T) {
	installSystemctlStub(t, true)
	stateDir := t.TempDir()
	unhealthy := testRuntimeManifest(t, stateDir, "fixture-bad00112233", "resident-pad")
	healthy := testRuntimeManifest(t, stateDir, "fixture-good0112233", "resident-pad")
	m := &manager{
		cfg: config{stateDir: stateDir}, managed: map[string]*managedInstance{
			"resident-pad": {ID: "resident-pad", DesiredState: "running"},
		},
		runtimeAdoptionCheck: func(item *instance) error {
			if item.ID == healthy.ID {
				return nil
			}
			return errors.New("injected unhealthy runtime")
		},
	}
	for _, item := range []*instance{unhealthy, healthy} {
		if err := m.persistRuntime(item); err != nil {
			t.Fatal(err)
		}
	}
	records, err := m.loadRuntimeManifests()
	if err != nil {
		t.Fatal(err)
	}
	bound, err := m.bindManagedRuntimeManifests(records)
	if err != nil {
		t.Fatal(err)
	}
	if len(bound) != 1 || bound[0].Runtime.ID != healthy.ID {
		t.Fatalf("unique healthy manifest was not selected: %#v", bound)
	}
}

func TestDuplicateManagedRuntimeCleanupFailureKeepsBothRecords(t *testing.T) {
	installSystemctlStub(t, false)
	stateDir := t.TempDir()
	old := testRuntimeManifest(t, stateDir, "fixture-old20112233", "resident-pad")
	current := testRuntimeManifest(t, stateDir, "fixture-new20112233", "resident-pad")
	managed := &managedInstance{ID: "resident-pad", DesiredState: "running", RuntimeInstanceID: current.ID}
	m := &manager{cfg: config{stateDir: stateDir}, managed: map[string]*managedInstance{managed.ID: managed}}
	for _, item := range []*instance{old, current} {
		if err := m.persistRuntime(item); err != nil {
			t.Fatal(err)
		}
	}
	records, err := m.loadRuntimeManifests()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.bindManagedRuntimeManifests(records); err == nil {
		t.Fatal("stale unit cleanup failure was ignored")
	}
	remaining, err := m.loadRuntimeManifests()
	if err != nil || len(remaining) != 2 {
		t.Fatalf("failed cleanup changed durable records: len=%d err=%v", len(remaining), err)
	}
}

func TestManagedReconcileReusesRuntimeIdentityAndRetriesFailedRecovery(t *testing.T) {
	installSystemctlStub(t, true)
	stateDir := t.TempDir()
	old := testRuntimeManifest(t, stateDir, "fixture-retry0112233", "resident-pad")
	old.State = "failed"
	managed := &managedInstance{
		ID: "resident-pad", TemplateID: old.TemplateID, DesiredState: "running", ObservedState: "failed",
		ProfileRef: old.ProfileRef, RuntimeInstanceID: old.ID, Runtime: old,
		AppliedSpec: old.Spec, AppliedComponents: old.Components, CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	m := &manager{
		cfg: config{stateDir: stateDir}, instances: map[string]*instance{old.ID: old}, idleTimers: map[string]*time.Timer{},
		managed: map[string]*managedInstance{managed.ID: managed},
	}
	if err := m.persistRuntime(old); err != nil {
		t.Fatal(err)
	}
	if err := m.persistManaged(managed); err != nil {
		t.Fatal(err)
	}
	attempts := 0
	m.runtimeRecoveryCreate = func(request createRequest) (*instance, error) {
		attempts++
		if request.RuntimeID != old.ID || !request.CreatedAt.Equal(old.CreatedAt) || request.PinnedSpec.DriverVersion != old.DriverVersion {
			t.Fatalf("recovery request changed locked identity: %#v", request)
		}
		if _, err := os.Stat(old.Runtime); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("runtime directory was not cleaned before recovery: %v", err)
		}
		if err := os.MkdirAll(old.Runtime, 0o700); err != nil {
			t.Fatal(err)
		}
		recovered := *old
		recovered.State, recovered.SessionState, recovered.Error = "failed", "stopped", "injected first recovery failure"
		if attempts == 2 {
			recovered.State, recovered.Error = "server-ready", ""
		}
		m.storeRuntime(&recovered)
		if err := m.persistRuntime(&recovered); err != nil {
			t.Fatal(err)
		}
		if attempts == 1 {
			return &recovered, errors.New("injected first recovery failure")
		}
		return &recovered, nil
	}
	if err := m.reconcileManagedLocked(managed.ID); err == nil {
		t.Fatal("injected recovery failure was ignored")
	}
	if got := m.getManaged(managed.ID); got == nil || got.RuntimeInstanceID != old.ID || got.Runtime == nil || got.ObservedState != "failed" {
		t.Fatalf("failed recovery lost its durable identity: %#v", got)
	}
	if records, err := m.loadRuntimeManifests(); err != nil || len(records) != 1 || records[0].Runtime.ID != old.ID {
		t.Fatalf("failed recovery manifests=%#v err=%v", records, err)
	}
	if err := m.reconcileManagedLocked(managed.ID); err != nil {
		t.Fatal(err)
	}
	got := m.getManaged(managed.ID)
	if got == nil || got.RuntimeInstanceID != old.ID || got.Runtime == nil || got.Runtime.State != "server-ready" || got.ObservedState != "running" {
		t.Fatalf("recovery retry did not converge: %#v", got)
	}
	if attempts != 2 {
		t.Fatalf("recovery attempts=%d, want 2", attempts)
	}
	if records, err := m.loadRuntimeManifests(); err != nil || len(records) != 1 || records[0].Runtime.ID != old.ID {
		t.Fatalf("successful recovery manifests=%#v err=%v", records, err)
	}
}

func TestManagedReconcileUnitCleanupFailureDoesNotCreateReplacement(t *testing.T) {
	installSystemctlStub(t, false)
	stateDir := t.TempDir()
	old := testRuntimeManifest(t, stateDir, "fixture-stopfail1234", "resident-pad")
	old.State = "failed"
	managed := &managedInstance{
		ID: "resident-pad", TemplateID: old.TemplateID, DesiredState: "running", ObservedState: "failed",
		ProfileRef: old.ProfileRef, RuntimeInstanceID: old.ID, Runtime: old,
		AppliedSpec: old.Spec, AppliedComponents: old.Components, CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	created := false
	m := &manager{
		cfg: config{stateDir: stateDir}, instances: map[string]*instance{old.ID: old}, idleTimers: map[string]*time.Timer{},
		managed: map[string]*managedInstance{managed.ID: managed},
		runtimeRecoveryCreate: func(createRequest) (*instance, error) {
			created = true
			return nil, nil
		},
	}
	if err := m.persistRuntime(old); err != nil {
		t.Fatal(err)
	}
	if err := m.reconcileManagedLocked(managed.ID); err == nil {
		t.Fatal("unit cleanup failure was ignored")
	}
	if created {
		t.Fatal("replacement started after unit cleanup failed")
	}
	if records, err := m.loadRuntimeManifests(); err != nil || len(records) != 1 || records[0].Runtime.ID != old.ID {
		t.Fatalf("cleanup failure manifests=%#v err=%v", records, err)
	}
}

func TestManagedReconcileRuntimeDirectoryCleanupFailureDoesNotCreateReplacement(t *testing.T) {
	installSystemctlStub(t, true)
	stateDir := t.TempDir()
	old := testRuntimeManifest(t, stateDir, "fixture-dirfail01234", "resident-pad")
	old.State = "failed"
	managed := &managedInstance{
		ID: "resident-pad", TemplateID: old.TemplateID, DesiredState: "running", ObservedState: "failed",
		ProfileRef: old.ProfileRef, RuntimeInstanceID: old.ID, Runtime: old,
		AppliedSpec: old.Spec, AppliedComponents: old.Components, CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	created := false
	m := &manager{
		cfg: config{stateDir: stateDir}, instances: map[string]*instance{old.ID: old}, idleTimers: map[string]*time.Timer{},
		managed: map[string]*managedInstance{managed.ID: managed},
		runtimeRecoveryCreate: func(createRequest) (*instance, error) {
			created = true
			return nil, nil
		},
	}
	if err := m.persistRuntime(old); err != nil {
		t.Fatal(err)
	}
	instancesRoot := filepath.Join(stateDir, "instances")
	if err := os.Chmod(instancesRoot, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(instancesRoot, 0o700) })
	if err := m.reconcileManagedLocked(managed.ID); err == nil {
		t.Fatal("unsafe runtime directory cleanup was ignored")
	}
	if created {
		t.Fatal("replacement started after runtime directory cleanup failed")
	}
	if _, err := os.Stat(filepath.Join(m.runtimeManifestDir(), old.ID+".json")); err != nil {
		t.Fatalf("directory cleanup failure removed the manifest: %v", err)
	}
}

func TestManagedRecoveryCrashPointsRestartWithSingleIdentity(t *testing.T) {
	for _, state := range []string{"server-ready", "starting", "failed"} {
		t.Run(state, func(t *testing.T) {
			installSystemctlStub(t, true)
			stateDir := t.TempDir()
			item := testRuntimeManifest(t, stateDir, "fixture-crash0112233", "resident-pad")
			item.State = state
			managed := &managedInstance{
				ID: "resident-pad", TemplateID: item.TemplateID, DesiredState: "running", ObservedState: "starting",
				ProfileRef: item.ProfileRef, AppliedSpec: item.Spec, AppliedComponents: item.Components,
				CreatedAt: time.Now(), UpdatedAt: time.Now(),
			}
			m := &manager{
				cfg: config{stateDir: stateDir}, instances: map[string]*instance{}, idleTimers: map[string]*time.Timer{},
				managed:                  map[string]*managedInstance{managed.ID: managed},
				runtimeAdoptionCheck:     func(*instance) error { return errors.New("injected restart recovery") },
				runtimeSessionAliveCheck: func(*instance) bool { return false },
			}
			if err := m.persistRuntime(item); err != nil {
				t.Fatal(err)
			}
			records, err := m.loadRuntimeManifests()
			if err != nil {
				t.Fatal(err)
			}
			records, err = m.bindManagedRuntimeManifests(records)
			if err != nil {
				t.Fatal(err)
			}
			m.runtimeRecoveryCreate = func(request createRequest) (*instance, error) {
				if request.RuntimeID != item.ID {
					t.Fatalf("restart changed runtime identity: %#v", request)
				}
				if err := os.MkdirAll(item.Runtime, 0o700); err != nil {
					t.Fatal(err)
				}
				recovered := *item
				recovered.State, recovered.SessionState, recovered.Error = "server-ready", "stopped", ""
				m.storeRuntime(&recovered)
				if err := m.persistRuntime(&recovered); err != nil {
					t.Fatal(err)
				}
				return &recovered, nil
			}
			m.restoreRuntimeManifests(records)
			if err := m.linkManagedRuntimes(); err != nil {
				t.Fatal(err)
			}
			got := m.getManaged(managed.ID)
			if got == nil || got.RuntimeInstanceID != item.ID || got.Runtime == nil || got.Runtime.State != "server-ready" {
				t.Fatalf("restart did not recover crash point: %#v", got)
			}
			if records, err := m.loadRuntimeManifests(); err != nil || len(records) != 1 || records[0].Runtime.ID != item.ID {
				t.Fatalf("restart manifests=%#v err=%v", records, err)
			}
		})
	}
}

func TestStoppedRuntimeManifestIsRemoved(t *testing.T) {
	stateDir := t.TempDir()
	m := &manager{cfg: config{stateDir: stateDir}}
	item := testRuntimeManifest(t, stateDir, "mousepad-001122334455", "")
	if err := m.persistRuntime(item); err != nil {
		t.Fatal(err)
	}
	if err := m.removeRuntimeManifest(item.ID); err != nil {
		t.Fatal(err)
	}
	records, err := m.loadRuntimeManifests()
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 0 {
		t.Fatalf("stopped runtime manifest remains: %#v", records)
	}
}

func TestStoppedPersistentRuntimeRemovesRuntimeAndPreservesProfile(t *testing.T) {
	stateDir := t.TempDir()
	item := testRuntimeManifest(t, stateDir, "persistent-app-112233", "")
	item.ClassID = "persistent-app"
	item.TemplateID = "persistent-app"
	item.Spec.ID = "persistent-app"
	item.Home = filepath.Join(stateDir, "profiles", "persistent-app", "default")
	if err := os.MkdirAll(item.Home, 0o700); err != nil {
		t.Fatal(err)
	}
	profileMarker := filepath.Join(item.Home, "profile-marker")
	if err := os.WriteFile(profileMarker, []byte("persistent"), 0o600); err != nil {
		t.Fatal(err)
	}
	runtimeMarker := filepath.Join(item.Runtime, "runtime-marker")
	if err := os.WriteFile(runtimeMarker, []byte("temporary"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := removeStoppedRuntimeState(stateDir, item); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(item.Runtime); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("stopped persistent runtime directory remains: %v", err)
	}
	if content, err := os.ReadFile(profileMarker); err != nil || string(content) != "persistent" {
		t.Fatalf("persistent profile was not preserved: content=%q error=%v", content, err)
	}
}

func TestForcedAnonymousStopDoesNotTeardownBeforeStoppedIntentIsDurable(t *testing.T) {
	stateDir := t.TempDir()
	item := testRuntimeManifest(t, stateDir, "mousepad-stop123456", "")
	item.ViewerURL = "/remotexapps/" + item.ID + "/kiosk.html"
	item.Spec.Session.VacantAction = "keep"
	m := &manager{
		cfg: config{stateDir: stateDir}, instances: map[string]*instance{item.ID: item},
		idleTimers: map[string]*time.Timer{}, managed: map[string]*managedInstance{},
	}
	if err := m.persistRuntime(item); err != nil {
		t.Fatal(err)
	}
	manifestDir := m.runtimeManifestDir()
	if err := os.Chmod(manifestDir, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(manifestDir, 0o700) })

	err := m.stopInstanceLocked(item, stopOptions{Reason: "test-stop", Scope: "instance", Force: true})
	if err == nil {
		t.Fatal("stop succeeded even though stopped intent could not be persisted")
	}
	got := m.get(item.ID)
	if got == nil || got.State != "server-ready" || got.RuntimeDesired != "running" {
		t.Fatalf("failed durable stop changed live runtime: %#v", got)
	}
	if err := os.Chmod(manifestDir, 0o700); err != nil {
		t.Fatal(err)
	}
	records, err := m.loadRuntimeManifests()
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 || records[0].DesiredState != "running" {
		t.Fatalf("failed stop changed durable intent: %#v", records)
	}
}

func TestGracefulStopDoesNotInvokeDriverBeforeShutdownRequestIsDurable(t *testing.T) {
	stateDir := t.TempDir()
	item := testRuntimeManifest(t, stateDir, "mousepad-grace123456", "")
	item.ViewerURL = "/remotexapps/" + item.ID + "/kiosk.html"
	item.SessionState = "running"
	item.SessionGeneration = 2
	item.Spec.Session.ReadinessPID = "app.pid"
	item.Spec.Session.ShutdownDriver = filepath.Join(stateDir, "must-not-run.sh")
	item.Spec.Session.VacantAction = "keep"
	if err := os.WriteFile(item.Spec.Session.ShutdownDriver, []byte("#!/bin/sh\ntouch \"$REMOTEXAPP_RUNTIME/driver-ran\"\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	m := &manager{
		cfg: config{stateDir: stateDir}, instances: map[string]*instance{item.ID: item},
		idleTimers: map[string]*time.Timer{}, managed: map[string]*managedInstance{},
	}
	if err := m.persistRuntime(item); err != nil {
		t.Fatal(err)
	}
	manifestDir := m.runtimeManifestDir()
	if err := os.Chmod(manifestDir, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(manifestDir, 0o700) })

	err := m.stopInstanceLocked(item, stopOptions{Reason: "test-stop", Scope: "instance"})
	if err == nil {
		t.Fatal("graceful stop succeeded even though its request could not be persisted")
	}
	if _, err := os.Stat(filepath.Join(item.Runtime, "driver-ran")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("shutdown driver ran before durable request: %v", err)
	}
	got := m.get(item.ID)
	if got == nil || got.State != "server-ready" || got.SessionState != "running" || got.RuntimeDesired != "running" || got.Shutdown != nil {
		t.Fatalf("failed durable shutdown changed live runtime: %#v", got)
	}
}

func TestRuntimeRestoreHonorsRuntimeAndManagedDesiredState(t *testing.T) {
	m := &manager{managed: map[string]*managedInstance{
		"running-managed": {ID: "running-managed", DesiredState: "running"},
		"stopped-managed": {ID: "stopped-managed", DesiredState: "stopped"},
	}}
	tests := []struct {
		name    string
		record  runtimeManifestRecord
		restore bool
		recover bool
	}{
		{name: "anonymous running", record: runtimeManifestRecord{DesiredState: "running"}, restore: true, recover: true},
		{name: "anonymous stopping", record: runtimeManifestRecord{DesiredState: "stopped"}},
		{name: "managed running", record: runtimeManifestRecord{Runtime: instance{ManagedID: "running-managed"}}, restore: true, recover: true},
		{name: "managed stopped", record: runtimeManifestRecord{Runtime: instance{ManagedID: "stopped-managed"}}},
		{name: "managed stopped with blocked graceful shutdown", record: runtimeManifestRecord{DesiredState: "running", Runtime: instance{ManagedID: "stopped-managed", SessionState: "shutdown-blocked"}}, restore: true},
		{name: "managed stopped after forced stop intent", record: runtimeManifestRecord{DesiredState: "stopped", Runtime: instance{ManagedID: "stopped-managed", SessionState: "shutdown-blocked"}}},
		{name: "deleted registration", record: runtimeManifestRecord{Runtime: instance{ManagedID: "missing"}}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := m.runtimeShouldRestore(&test.record); got != test.restore {
				t.Fatalf("runtimeShouldRestore = %v, want %v", got, test.restore)
			}
			if got := m.runtimeShouldRecover(&test.record); got != test.recover {
				t.Fatalf("runtimeShouldRecover = %v, want %v", got, test.recover)
			}
		})
	}
}

func TestRestoreRuntimeManifestsAdoptsHealthyManagedAndAnonymous(t *testing.T) {
	stateDir := t.TempDir()
	managedRuntime := testRuntimeManifest(t, stateDir, "mousepad-a1b2c3d4e5f6", "resident-pad")
	managedRuntime.SessionState = "running"
	managedRuntime.SessionGeneration = 7
	managedRuntime.AttachedClients = 3
	managedRuntime.Spec.Session.VacantAction = "stop-session"
	managedRuntime.VacantTimeout = time.Hour
	anonymousRuntime := testRuntimeManifest(t, stateDir, "mousepad-0a1b2c3d4e5f", "")
	anonymousRuntime.AttachedClients = 2
	anonymousRuntime.Spec.Session.VacantAction = "stop-instance"
	anonymousRuntime.VacantTimeout = time.Hour

	managedObserver := &recordingManagedObserver{}
	sessionObserver := &recordingSessionObserver{}
	m := &manager{
		cfg: config{stateDir: stateDir}, instances: map[string]*instance{}, idleTimers: map[string]*time.Timer{},
		managed:         map[string]*managedInstance{"resident-pad": {ID: "resident-pad", DesiredState: "running"}},
		managedObserver: managedObserver, sessionObserver: sessionObserver,
		runtimeAdoptionCheck: func(*instance) error { return nil },
	}
	records := []runtimeManifestRecord{
		{DesiredState: "running", Runtime: *managedRuntime, ResolvedSpec: managedRuntime.Spec, Components: managedRuntime.Components},
		{DesiredState: "running", Runtime: *anonymousRuntime, ResolvedSpec: anonymousRuntime.Spec, Components: anonymousRuntime.Components},
	}
	m.restoreRuntimeManifests(records)
	t.Cleanup(func() {
		for _, timer := range m.idleTimers {
			timer.Stop()
		}
	})

	if len(m.instances) != 2 || m.instances[managedRuntime.ID].AttachedClients != 0 || m.instances[anonymousRuntime.ID].AttachedClients != 0 {
		t.Fatalf("adopted runtimes = %#v", m.instances)
	}
	if managedObserver.watchedManaged != "resident-pad" || managedObserver.watchedRuntime != managedRuntime.ID {
		t.Fatalf("managed observer was not restored: %#v", managedObserver)
	}
	if sessionObserver.instanceID != managedRuntime.ID || sessionObserver.generation != 7 || sessionObserver.unit != managedRuntime.SessionUnit {
		t.Fatalf("session observer was not restored: %#v", sessionObserver)
	}
	if m.idleTimers[managedRuntime.ID] == nil || m.idleTimers[anonymousRuntime.ID] == nil {
		t.Fatalf("vacancy timers were not restored: %#v", m.idleTimers)
	}
}

func TestRuntimeAdoptionCheckOverrideRejectsUnhealthyRuntime(t *testing.T) {
	want := errors.New("injected unhealthy runtime")
	called := false
	m := &manager{runtimeAdoptionCheck: func(*instance) error {
		called = true
		return want
	}}
	if err := m.checkRuntimeAdoption(&instance{}); !errors.Is(err, want) || !called {
		t.Fatalf("adoption check error = %v called=%v", err, called)
	}
}

func TestRestoreRuntimeManifestsPreservesLiveSessionWhenHealthIsIncomplete(t *testing.T) {
	stateDir := t.TempDir()
	item := testRuntimeManifest(t, stateDir, "mousepad-live1234567", "")
	item.SessionState = "running"
	item.SessionGeneration = 9
	item.Spec.Session.VacantAction = "keep"
	m := &manager{
		cfg: config{stateDir: stateDir}, instances: map[string]*instance{}, idleTimers: map[string]*time.Timer{}, managed: map[string]*managedInstance{},
		runtimeAdoptionCheck:     func(*instance) error { return errors.New("gateway unavailable") },
		runtimeSessionAliveCheck: func(*instance) bool { return true },
	}
	record := runtimeManifestRecord{DesiredState: "running", Runtime: *item, ResolvedSpec: item.Spec, Components: item.Components}
	m.restoreRuntimeManifests([]runtimeManifestRecord{record})
	got := m.get(item.ID)
	if got == nil || got.SessionState != "running" || got.SessionGeneration != 9 {
		t.Fatalf("live session was not preserved: %#v", got)
	}
	if got.Error == "" {
		t.Fatalf("degraded adoption health was not exposed: %#v", got)
	}
}

func TestValidateRuntimeAdoptionState(t *testing.T) {
	valid := instance{State: "server-ready", SessionState: "running", SessionGeneration: 3, RuntimeDesired: "running"}
	blocked := valid
	blocked.SessionState = "shutdown-blocked"
	blocked.Shutdown = &shutdownStatus{Generation: 3, State: "blocked"}
	for _, test := range []struct {
		name    string
		item    *instance
		wantErr bool
	}{
		{name: "healthy running", item: &valid},
		{name: "healthy stopped session", item: &instance{State: "server-ready", SessionState: "stopped", RuntimeDesired: "running"}},
		{name: "consistent blocked shutdown", item: &blocked},
		{name: "consistent timed-out hook", item: &instance{State: "server-ready", SessionState: "shutdown-blocked", SessionGeneration: 3, RuntimeDesired: "running", Shutdown: &shutdownStatus{Generation: 3, State: "timeout"}}},
		{name: "consistent failed hook", item: &instance{State: "server-ready", SessionState: "shutdown-blocked", SessionGeneration: 3, RuntimeDesired: "running", Shutdown: &shutdownStatus{Generation: 3, State: "failed"}}},
		{name: "missing runtime", item: nil, wantErr: true},
		{name: "partial server start", item: &instance{State: "starting", SessionState: "stopped", RuntimeDesired: "running"}, wantErr: true},
		{name: "stopped intent", item: &instance{State: "server-ready", SessionState: "stopped", RuntimeDesired: "stopped"}, wantErr: true},
		{name: "partial session start", item: &instance{State: "server-ready", SessionState: "starting", RuntimeDesired: "running"}, wantErr: true},
		{name: "blocked without metadata", item: &instance{State: "server-ready", SessionState: "shutdown-blocked", SessionGeneration: 3, RuntimeDesired: "running"}, wantErr: true},
		{name: "blocked wrong generation", item: &instance{State: "server-ready", SessionState: "shutdown-blocked", SessionGeneration: 3, RuntimeDesired: "running", Shutdown: &shutdownStatus{Generation: 2, State: "blocked"}}, wantErr: true},
		{name: "blocked cancelled metadata", item: &instance{State: "server-ready", SessionState: "shutdown-blocked", SessionGeneration: 3, RuntimeDesired: "running", Shutdown: &shutdownStatus{Generation: 3, State: "cancelled"}}, wantErr: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			err := validateRuntimeAdoptionState(test.item)
			if (err != nil) != test.wantErr {
				t.Fatalf("validateRuntimeAdoptionState error = %v, wantErr=%v", err, test.wantErr)
			}
		})
	}
}

func TestRuntimeRecoveryRequestUsesLockedSnapshot(t *testing.T) {
	createdAt := time.Now().Add(-time.Hour).Round(time.Second)
	record := runtimeManifestRecord{
		Runtime: instance{
			ID: "fixture-locked123456", TemplateID: "fixture-app", ManagedID: "resident-pad",
			ProfileRef: "primary", Parameters: map[string]any{"document": "draft.txt"}, CreatedAt: createdAt,
		},
		Overrides:    instanceOverrides{WorkspaceMode: "persistent"},
		ResolvedSpec: classConfig{ID: "fixture-app", DriverVersion: "1.5.0", Server: serverClassConfig{Geometry: "1280x720"}},
		Components:   runtimeComponents{GatewayBinary: "/releases/old/novnc-input", UnicodeEngine: "/releases/old/engine.py"},
	}
	request := runtimeRecoveryRequest(&record)
	if request.RuntimeID != record.Runtime.ID || request.ManagedID != record.Runtime.ManagedID || request.CreatedAt != createdAt {
		t.Fatalf("recovery identity changed: %#v", request)
	}
	if request.PinnedSpec.DriverVersion != "1.5.0" || request.PinnedSpec.Server.Geometry != "1280x720" {
		t.Fatalf("recovery did not use locked template: %#v", request.PinnedSpec)
	}
	if request.PinnedComponents.GatewayBinary != "/releases/old/novnc-input" || request.Parameters["document"] != "draft.txt" || request.Overrides.WorkspaceMode != "persistent" {
		t.Fatalf("recovery did not preserve locked launch inputs: %#v", request)
	}
}

func TestAdoptBlockedRuntimePreservesShutdownAndRestoresObserver(t *testing.T) {
	observer := &recordingSessionObserver{}
	item := &instance{
		ID: "mousepad-blocked1234", ManagedID: "resident-pad", State: "server-ready", SessionState: "shutdown-blocked",
		SessionGeneration: 4, SessionUnit: "remotexapp-mousepad-blocked1234-session.service", AttachedClients: 1,
		Error: "save decision required", Shutdown: &shutdownStatus{RequestID: "shutdown-blocked1234", Generation: 4, Reason: "api-stop", Scope: "instance", State: "blocked"},
		Spec: classConfig{Session: sessionClassConfig{Services: "core-v1", VacantAction: "stop-session"}},
	}
	m := &manager{instances: map[string]*instance{}, idleTimers: map[string]*time.Timer{}, sessionObserver: observer}
	m.adoptRuntimeManifest(item)
	if item.AttachedClients != 0 || item.Error != "save decision required" || item.Shutdown.State != "blocked" {
		t.Fatalf("blocked shutdown was not preserved: %#v", item)
	}
	if observer.instanceID != item.ID || observer.generation != item.SessionGeneration {
		t.Fatalf("blocked session observer was not restored: %#v", observer)
	}
	if timer := m.idleTimers[item.ID]; timer != nil {
		timer.Stop()
		t.Fatal("blocked shutdown received an ordinary vacancy timer")
	}
}

func TestCleanSessionExitPersistsToRuntimeManifest(t *testing.T) {
	stateDir := t.TempDir()
	item := testRuntimeManifest(t, stateDir, "mousepad-exit1234567", "")
	item.SessionState = "running"
	item.SessionGeneration = 5
	item.Spec.Session.Status.Mode = "driver"
	item.Spec.Session.VacantAction = "keep"
	m := &manager{
		cfg: config{stateDir: stateDir}, instances: map[string]*instance{item.ID: item},
		idleTimers: map[string]*time.Timer{}, managed: map[string]*managedInstance{},
	}
	if err := m.persistRuntime(item); err != nil {
		t.Fatal(err)
	}
	if err := m.writeApplicationStatus(item, item.SessionGeneration, "exited", "Application exited", "", false); err != nil {
		t.Fatal(err)
	}
	m.handleSessionExit(item.ID, item.SessionGeneration, "session unit exited")
	records, err := m.loadRuntimeManifests()
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 || records[0].Runtime.SessionState != "stopped" || records[0].Runtime.ApplicationStatus == nil || records[0].Runtime.ApplicationStatus.State != "exited" {
		t.Fatalf("clean session exit was not persisted: %#v", records)
	}
}
