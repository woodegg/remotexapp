package main

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Actual tiny Go release binaries exercise linker identity discovery without
// depending on bin/, a development installation, systemd, or a desktop.
func upgradeFixture(t *testing.T) (*manager, *instance) {
	t.Helper()
	root := t.TempDir()
	src := filepath.Join(root, "main.go")
	if err := os.WriteFile(src, []byte("package main\nvar version,commit string\nfunc main(){println(version,commit)}\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "VERSION"), []byte("2.0.0\n"), 0600); err != nil {
		t.Fatal(err)
	}
	build := exec.Command("go", "build", "-trimpath", "-ldflags", "-X main.version=2.0.0 -X main.commit=123456789abc", "-o", filepath.Join(root, "remotexappd"), src)
	if b, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build fixture: %s: %v", b, err)
	}
	for _, name := range []string{"gateway", "status", "engine"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte(name), 0700); err != nil {
			t.Fatal(err)
		}
	}
	common := filepath.Join(root, "common")
	if err := os.Mkdir(common, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(common, "helper.sh"), []byte("true\n"), 0700); err != nil {
		t.Fatal(err)
	}
	oldPath := writeSyntheticAppPackageVersion(t, filepath.Join(root, "apps"), "1.0.0")
	newPath := writeSyntheticAppPackageVersion(t, filepath.Join(root, "apps"), "2.0.0")
	old, _, err := loadAppPackageDirectory(oldPath, "synthetic-app")
	if err != nil {
		t.Fatal(err)
	}
	target, _, err := loadAppPackageDirectory(newPath, "synthetic-app")
	if err != nil {
		t.Fatal(err)
	}
	m := &manager{cfg: config{stateDir: filepath.Join(root, "state"), classes: map[string]classConfig{target.ID: target}, gatewayBinary: filepath.Join(root, "gateway"), statusBinary: filepath.Join(root, "status"), engine: filepath.Join(root, "engine"), coreDriverDir: common}, instances: map[string]*instance{}, idleTimers: map[string]*time.Timer{}}
	item := testRuntimeManifest(t, m.cfg.stateDir, "synthetic-app-0123456789ab", "")
	item.ClassID = old.ID
	item.TemplateID = old.ID
	item.DriverVersion = old.DriverVersion
	item.Spec = old
	item.WorkspaceMode = "ephemeral"
	item.Overrides = instanceOverrides{}
	item.SessionGeneration = 7
	item.Parameters = map[string]any{"message": "retained"}
	item.Resources = map[string]allocatedResource{"control": {Kind: "loopback-tcp", Address: "127.0.0.1", Port: 21077}}
	item.Components = m.currentComponents()
	item.Components.Identity, _ = identifyCore(item.Components)
	m.storeRuntime(item)
	m.runtimeRestartStop = func(*instance, stopOptions) error { return nil }
	m.runtimeRecoveryCreate = func(r createRequest) (*instance, error) {
		got := *m.get(r.RuntimeID)
		got.Spec = r.PinnedSpec
		got.Components = r.PinnedComponents
		got.DriverVersion = r.PinnedSpec.DriverVersion
		got.SessionGeneration = r.SessionGeneration
		got.Upgrade = r.Upgrade
		got.State = "server-ready"
		got.SessionState = "stopped"
		m.storeRuntime(&got)
		return &got, nil
	}
	return m, item
}

func TestUpgradeTransactionAndDurableFrozenTarget(t *testing.T) {
	m, item := upgradeFixture(t)
	v := m.versionView(item)
	if !v.Eligible || !v.UpdateAvailable || v.Current.Core.Version != "2.0.0" {
		t.Fatalf("view=%+v", v)
	}
	stopCalls := 0
	m.runtimeRestartStop = func(got *instance, o stopOptions) error {
		stopCalls++
		if !o.PreserveRuntime || o.Force || o.Reason != "api-upgrade" {
			t.Fatalf("stop=%+v", o)
		}
		records, err := m.loadRuntimeManifests()
		if err != nil {
			t.Fatal(err)
		}
		if len(records) != 1 || records[0].Runtime.Upgrade.Target.Package == nil || records[0].Runtime.Upgrade.Status.Phase != "stopping" {
			t.Fatal("target not durably frozen before stop")
		}
		return nil
	}
	got, err := m.upgradeRuntime(item.ID, upgradeRequest{SessionGeneration: &item.SessionGeneration, TargetRevision: v.TargetRevision})
	if err != nil {
		t.Fatal(err)
	}
	if stopCalls != 1 || got.ID != item.ID || got.SessionGeneration <= item.SessionGeneration || got.DriverVersion != "2.0.0" || got.Upgrade.Status.Phase != "completed" || got.Parameters["message"] != "retained" || got.ProfileRef != item.ProfileRef || !got.CreatedAt.Equal(item.CreatedAt) {
		t.Fatalf("lost identity or inputs: %+v", got)
	}
	if m.versionView(got).UpdateAvailable {
		t.Fatal("still reports update")
	}
	public, _ := json.Marshal(m.publicInstance(got))
	if strings.Contains(string(public), m.cfg.stateDir) || strings.Contains(string(public), got.Spec.Package.Path) {
		t.Fatal("private paths leaked")
	}
	if _, err = m.upgradeRuntime(item.ID, upgradeRequest{SessionGeneration: &item.SessionGeneration, TargetRevision: v.TargetRevision}); err == nil || stopCalls != 1 {
		t.Fatal("duplicate old request stopped again")
	}
}

func TestUpgradeReleasesStoppedAllocation(t *testing.T) {
	for _, collision := range []string{"none", "other-runtime", "live-listener"} {
		t.Run(collision, func(t *testing.T) {
			m, item := upgradeFixture(t)
			class := classConfig{Server: serverClassConfig{DisplayMode: "fixed", Display: 89, RFBPort: 5989, GatewayPort: 39089}}
			if m.runtimeBusy(89, 5989, 39089) {
				t.Skip("fixture display is in use")
			}
			item.Display = ":89"
			m.storeRuntime(item)
			m.runtimeRestartStop = func(item *instance, _ stopOptions) error {
				m.setState(item.ID, "restarting", "", "")
				return nil
			}
			create := m.runtimeRecoveryCreate
			m.runtimeRecoveryCreate = func(r createRequest) (*instance, error) {
				records, err := m.loadRuntimeManifests()
				if err != nil || len(records) != 1 || records[0].Runtime.State != "stopped" || records[0].Runtime.Upgrade.Status.Phase != "launching" {
					t.Fatalf("stopped allocation and launch intent not durable: %v", err)
				}
				if collision == "other-runtime" {
					m.storeRuntime(&instance{ID: "other", State: "server-ready", Display: ":89"})
				}
				if collision == "live-listener" {
					listener, err := net.Listen("tcp4", "127.0.0.1:39089")
					if err != nil {
						t.Fatal(err)
					}
					defer listener.Close()
				}
				if _, _, _, _, err := m.allocateRuntime(class); err != nil {
					return nil, err
				}
				return create(r)
			}
			v := m.versionView(item)
			got, err := m.upgradeRuntime(item.ID, upgradeRequest{SessionGeneration: &item.SessionGeneration, TargetRevision: v.TargetRevision})
			if collision != "none" {
				if err == nil || !strings.Contains(err.Error(), "already in use") {
					t.Fatalf("other owner accepted: %v", err)
				}
			} else if err != nil || got.Upgrade.Status.Phase != "completed" {
				t.Fatalf("stopped runtime conflicts with itself: %v", err)
			}
		})
	}
}

func TestUpgradePreflightAndVersionGuards(t *testing.T) {
	m, item := upgradeFixture(t)
	v := m.versionView(item)
	stopped := false
	m.runtimeRestartStop = func(*instance, stopOptions) error { stopped = true; return nil }
	for _, r := range []upgradeRequest{{TargetRevision: v.TargetRevision}, {SessionGeneration: &item.SessionGeneration, TargetRevision: strings.Repeat("0", 64)}} {
		if _, err := m.upgradeRuntime(item.ID, r); err == nil {
			t.Fatal("accepted invalid guard")
		}
	}
	bad := m.cfg.classes[item.TemplateID]
	bad.Parameters = map[string]parameterDefinition{}
	if err := m.preflightUpgrade(item, bad); err == nil {
		t.Fatal("dropped removed parameter")
	}
	bad = m.cfg.classes[item.TemplateID]
	bad.RunMode = "user-home"
	if err := m.preflightUpgrade(item, bad); err == nil {
		t.Fatal("changed HOME mode")
	}
	delete(m.cfg.classes, item.TemplateID)
	if m.versionView(item).Eligible {
		t.Fatal("disabled template accepted")
	}
	if stopped {
		t.Fatal("preflight stopped application")
	}
	for _, pair := range [][2]string{{"2.0.0", "1.9.9"}, {"2.0.0", "2.0.0-rc.1"}} {
		if !downgrade(pair[0], pair[1]) {
			t.Fatal("downgrade not detected")
		}
	}
	if downgrade("unknown", "2.0.0") || downgrade("1.0.0", "2.0.0") {
		t.Fatal("incorrect downgrade")
	}
}

func TestUpgradeFailuresAndCrashResume(t *testing.T) {
	m, original := upgradeFixture(t)
	for _, stage := range []string{"blocked", "cleanup", "launch", "crash-stopping", "crash-launching", "target-changed"} {
		t.Run(stage, func(t *testing.T) {
			item := *original
			observer := &recordingSessionObserver{}
			m.sessionObserver = observer
			survives := stage == "target-changed" || stage == "blocked" || stage == "cleanup"
			m.runtimeSessionAliveCheck = func(*instance) bool { return survives }
			if survives {
				item.SessionState = "running"
			}
			m.storeRuntime(&item)
			v := m.versionView(&item)
			target := m.cfg.classes[item.TemplateID]
			components := m.currentComponents()
			components.Identity = v.Available.Core
			u := &runtimeUpgrade{Status: upgradeStatus{ID: "upgrade-0123456789ab", TargetRevision: v.TargetRevision, Phase: "stopping"}, Target: target, Package: target.Package, Components: components, SourceGeneration: item.SessionGeneration}
			item.Upgrade = u
			m.storeRuntime(&item)
			creates := 0
			stops := 0
			m.runtimeRestartStop = func(*instance, stopOptions) error {
				stops++
				if stage == "blocked" {
					return &shutdownBlockedError{Message: "unsaved document"}
				}
				if stage == "cleanup" {
					return errors.New("cleanup failed")
				}
				return nil
			}
			m.runtimeRecoveryCreate = func(r createRequest) (*instance, error) {
				creates++
				if stage == "launch" {
					return nil, errors.New("launch failed")
				}
				if r.RuntimeID != item.ID || r.PinnedAllocation != nil || r.SessionGeneration <= original.SessionGeneration || r.PinnedSpec.Package.ContentSHA256 != target.Package.ContentSHA256 {
					t.Fatal("wrong recovery target")
				}
				got := *original
				got.Spec = r.PinnedSpec
				got.DriverVersion = r.PinnedSpec.DriverVersion
				got.Components = r.PinnedComponents
				got.SessionGeneration = r.SessionGeneration
				got.Upgrade = r.Upgrade
				m.storeRuntime(&got)
				return &got, nil
			}
			if stage == "target-changed" {
				u.Components.Identity = &coreIdentity{Version: "2.0.0", SHA256: strings.Repeat("0", 64)}
			}
			if stage == "crash-launching" {
				u.Status.Phase = "launching"
			}
			if err := m.persistRuntime(&item); err != nil {
				t.Fatal(err)
			}
			records, err := m.loadRuntimeManifests()
			if err != nil {
				t.Fatal(err)
			}
			if !m.restoreUpgrade(&records[0]) {
				t.Fatal("pending upgrade not reconciled")
			}
			got := m.get(item.ID)
			if survives && (observer.instanceID != item.ID || observer.generation != item.SessionGeneration || observer.unit != item.SessionUnit) {
				t.Fatal("surviving session observation was not restored after recovery failure")
			}
			m.mu.Lock()
			if timer := m.idleTimers[item.ID]; timer != nil {
				timer.Stop()
				delete(m.idleTimers, item.ID)
			}
			m.mu.Unlock()
			switch stage {
			case "blocked":
				if got.Upgrade.Status.Phase != "blocked" || creates != 0 {
					t.Fatal("ignored veto")
				}
			case "cleanup", "launch", "target-changed":
				if got.Upgrade.Status.Phase != "failed" {
					t.Fatal("failure not persisted")
				}
			default:
				if got.Upgrade.Status.Phase != "completed" || creates != 1 || stops != 1 {
					t.Fatal("crash did not resume exactly once")
				}
			}
			if stage == "target-changed" && stops != 0 {
				t.Fatal("changed target stopped old runtime")
			}
			if stage == "blocked" || stage == "cleanup" || stage == "launch" {
				// Failed transitions never silently retry through startup recovery.
				got.SessionState = "stopped"
				record := runtimeManifestRecord{DesiredState: "running", Runtime: *got}
				before := creates
				if !m.restoreUpgrade(&record) || creates != before {
					t.Fatal("failure retried implicitly")
				}
			}
		})
	}
}

func TestUpgradeManagedOwnershipConcurrencyAndHTTP(t *testing.T) {
	m, item := upgradeFixture(t)
	target := m.cfg.classes[item.TemplateID]
	target.RunMode = "shared"
	target.Session.VacantAction = "keep"
	m.cfg.classes[item.TemplateID] = target
	item.Spec.RunMode = "shared"
	item.Spec.Session.VacantAction = "keep"
	item.WorkspaceMode = "persistent"
	item.ManagedID = "managed-editor"
	m.managed = map[string]*managedInstance{item.ManagedID: {ID: item.ManagedID, TemplateID: item.TemplateID, DesiredState: "running", RuntimeInstanceID: item.ID, Runtime: item}}
	m.storeRuntime(item)
	v := m.versionView(item)
	if !v.Eligible {
		t.Fatalf("managed ineligible: %+v", v)
	}
	m.lifecycleMu.Lock()
	if _, err := m.upgradeRuntime(item.ID, upgradeRequest{SessionGeneration: &item.SessionGeneration, TargetRevision: v.TargetRevision}); err == nil {
		t.Fatal("queued conflicting mutation")
	}
	m.lifecycleMu.Unlock()
	for _, body := range []string{`{}`, `{"sessionGeneration":-1}`, `{"sessionGeneration":7,"targetRevision":"bad"}`, `{"unknown":true}`} {
		w := httptest.NewRecorder()
		m.serveUpgrade(w, httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body)), item)
		if w.Code != 400 {
			t.Fatalf("invalid request=%d", w.Code)
		}
	}
	w := httptest.NewRecorder()
	m.serveUpgrade(w, httptest.NewRequest(http.MethodGet, "/", nil), item)
	if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" || !strings.Contains(w.Body.String(), v.TargetRevision) {
		t.Fatal("GET version contract")
	}
	w = httptest.NewRecorder()
	m.serveUpgrade(w, httptest.NewRequest(http.MethodDelete, "/", nil), item)
	if w.Code != 405 {
		t.Fatal("method guard")
	}
	m.runtimeRestartStop = func(*instance, stopOptions) error {
		return &shutdownBlockedError{Outcome: "blocked", Message: "unsaved"}
	}
	body := `{"sessionGeneration":7,"targetRevision":"` + v.TargetRevision + `"}`
	w = httptest.NewRecorder()
	m.serveUpgrade(w, httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body)), item)
	if w.Code != 409 || !strings.Contains(w.Body.String(), `"code":"shutdown-blocked"`) {
		t.Fatalf("blocked=%d %s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	m.serveUpgrade(w, httptest.NewRequest(http.MethodPost, "/", strings.NewReader(strings.Replace(body, `"sessionGeneration":7`, `"sessionGeneration":6`, 1))), m.get(item.ID))
	if w.Code != 409 || !strings.Contains(w.Body.String(), `"code":"preflight-failed"`) {
		t.Fatal("stale request inherited an older shutdown-blocked error")
	}
	// Desired-state reconciliation cannot create another runtime after a veto.
	creates := 0
	m.runtimeRecoveryCreate = func(createRequest) (*instance, error) { creates++; return nil, errors.New("unexpected create") }
	if err := m.reconcileManagedLocked(item.ManagedID); err != nil {
		t.Fatal(err)
	}
	if creates != 0 || m.getManaged(item.ManagedID).ObservedState != "upgrade-blocked" {
		t.Fatal("managed veto guard")
	}
	m.runtimeRestartStop = func(_ *instance, o stopOptions) error {
		if !o.Force {
			t.Fatal("force lost")
		}
		return nil
	}
	m.runtimeRecoveryCreate = func(r createRequest) (*instance, error) {
		if r.ManagedID != item.ManagedID {
			t.Fatal("association lost")
		}
		got := *item
		got.DriverVersion = r.PinnedSpec.DriverVersion
		got.Spec = r.PinnedSpec
		got.Components = r.PinnedComponents
		got.SessionGeneration = r.SessionGeneration
		got.Upgrade = r.Upgrade
		m.storeRuntime(&got)
		return &got, nil
	}
	got, err := m.upgradeRuntime(item.ID, upgradeRequest{SessionGeneration: &item.SessionGeneration, TargetRevision: v.TargetRevision, Force: true})
	if err != nil {
		t.Fatal(err)
	}
	managed := m.getManaged(item.ManagedID)
	if managed.RuntimeInstanceID != got.ID || managed.AppliedDriverVersion != got.DriverVersion {
		t.Fatal("managed applied pin not updated")
	}
}

func TestUpgradeRecoveryAdoptsCompletedLaunchWithoutLaunchingAgain(t *testing.T) {
	m, item := upgradeFixture(t)
	v := m.versionView(item)
	target := m.cfg.classes[item.TemplateID]
	item.Components = m.currentComponents()
	item.Components.Identity = v.Available.Core
	item.Spec = target
	item.DriverVersion = target.DriverVersion
	item.Upgrade = &runtimeUpgrade{Status: upgradeStatus{ID: "upgrade-0123456789ab", TargetRevision: v.TargetRevision, Phase: "launching"}, Target: target, Package: target.Package, Components: item.Components, SourceGeneration: 6}
	m.runtimeAdoptionCheck = func(*instance) error { return nil }
	m.runtimeRecoveryCreate = func(createRequest) (*instance, error) { t.Fatal("duplicate launch after crash"); return nil, nil }
	item.Spec.Session.VacantAction = "keep"
	if !m.restoreUpgrade(&runtimeManifestRecord{DesiredState: "running", Runtime: *item}) || m.get(item.ID).Upgrade.Status.Phase != "completed" {
		t.Fatal("completed launch not adopted")
	}
}

func TestUpgradePolicyMatrixPreservesOwnershipProfileAndLaunchIntent(t *testing.T) {
	m, original := upgradeFixture(t)
	baseTarget := m.cfg.classes[original.TemplateID]
	for _, mode := range []string{"isolated", "shared", "user-home"} {
		for _, activation := range []string{"immediate", "on-attach"} {
			for _, managed := range []bool{false, true} {
				t.Run(mode+"/"+activation+"/managed="+strconv.FormatBool(managed), func(t *testing.T) {
					item := *original
					item.Spec.RunMode = mode
					item.Spec.Session.Activation = activation
					target := baseTarget
					target.RunMode = mode
					target.Session.Activation = activation
					if managed {
						target.Session.VacantAction = "keep"
						item.Spec.Session.VacantAction = "keep"
					}
					if mode == "user-home" {
						target.Singleton = true
						item.Spec.Singleton = true
						m.cfg.vncLauncher = "direct"
					}
					_, _, workspace, err := applyOverrides(target, item.Overrides)
					if err != nil {
						t.Fatal(err)
					}
					item.WorkspaceMode = workspace
					if mode == "user-home" {
						item.Display = ":87"
						item.RFBAddr = "127.0.0.1:5987"
						item.GatewayAddr = "127.0.0.1:39087"
						target.Server.DisplayMode = "fixed"
						target.Server.Display = 87
						target.Server.RFBPort = 5987
						target.Server.GatewayPort = 39087
						item.Spec.Server = target.Server
					}
					m.managed = map[string]*managedInstance{}
					if managed {
						item.ManagedID = "resident"
						m.managed[item.ManagedID] = &managedInstance{ID: item.ManagedID, TemplateID: item.TemplateID, DesiredState: "running", RuntimeInstanceID: item.ID, Runtime: &item}
					}
					m.cfg.classes[item.TemplateID] = target
					m.storeRuntime(&item)
					m.runtimeRecoveryCreate = func(r createRequest) (*instance, error) {
						if r.RuntimeID != item.ID || r.ManagedID != item.ManagedID || r.ProfileRef != item.ProfileRef || r.Parameters["message"] != "retained" || r.PinnedAllocation != nil || r.PinnedSpec.RunMode != mode || r.PinnedSpec.Session.Activation != activation {
							t.Fatalf("lost policy/intent: %+v", r)
						}
						got := item
						got.Spec = r.PinnedSpec
						got.Components = r.PinnedComponents
						got.DriverVersion = r.PinnedSpec.DriverVersion
						got.SessionGeneration = r.SessionGeneration
						got.Upgrade = r.Upgrade
						m.storeRuntime(&got)
						return &got, nil
					}
					v := m.versionView(&item)
					if mode == "isolated" && managed {
						if v.Eligible {
							t.Fatal("managed ephemeral target allowed")
						}
						return
					}
					if mode == "user-home" && !managed {
						if v.Eligible {
							t.Fatal("anonymous user-home allowed")
						}
						return
					}
					if !v.Eligible {
						t.Fatalf("ineligible: %+v", v)
					}
					got, err := m.upgradeRuntime(item.ID, upgradeRequest{SessionGeneration: &item.SessionGeneration, TargetRevision: v.TargetRevision})
					if err != nil {
						t.Fatal(err)
					}
					if got.WorkspaceMode != workspace || got.ProfileRef != item.ProfileRef {
						t.Fatal("HOME policy changed")
					}
				})
			}
		}
	}
}

func TestUpgradeFixedAllocationAllowsOwnPortsButRejectsOtherOwners(t *testing.T) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	port := listener.Addr().(*net.TCPAddr).Port
	item := &instance{ID: "own", Display: ":87", RFBAddr: listener.Addr().String(), GatewayAddr: "127.0.0.1:39087"}
	m := &manager{instances: map[string]*instance{item.ID: item}}
	target := serverClassConfig{Display: 87, RFBPort: port, GatewayPort: 39087}
	if m.fixedUpgradeAllocationBusy(item, target) {
		t.Fatal("own allocation blocked")
	}
	// Moving one's own listener from RFB to gateway is released by scoped stop.
	target.RFBPort = 39087
	target.GatewayPort = port
	if m.fixedUpgradeAllocationBusy(item, target) {
		t.Fatal("own port layout change blocked")
	}
	item.RFBAddr = "127.0.0.1:5987"
	if !m.fixedUpgradeAllocationBusy(item, target) {
		t.Fatal("unowned listener accepted")
	}
	item.RFBAddr = listener.Addr().String()
	m.instances["other"] = &instance{ID: "other", State: "starting", Display: ":87"}
	if !m.fixedUpgradeAllocationBusy(item, target) {
		t.Fatal("reserved display accepted")
	}
	m.instances["other"] = &instance{ID: "other", State: "starting", Resources: map[string]allocatedResource{"control": {Port: port}}}
	if !m.fixedUpgradeAllocationBusy(item, target) {
		t.Fatal("reserved control port accepted")
	}
}
