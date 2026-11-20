package main

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Reproduce a lost systemd observation while the canonical App process and
// populated component remain alive. All commands and /proc data are local
// doubles; this test never operates the developer's user manager or display.
func liveSessionObservationFixture(t *testing.T) (*manager, *instance, string) {
	t.Helper()
	state := t.TempDir()
	i := testRuntimeManifest(t, state, "fixture-123456abcdef", "desktop")
	i.Spec.RunMode = "user-home"
	i.Spec.Session.ReadinessPID = "app.pid"
	i.Spec.Session.VacantAction = "keep"
	i.Spec.Session.Status.Mode = "driver"
	i.SessionState, i.SessionGeneration = "running", 9
	i.Spec.Session.Services = ""
	proc := t.TempDir()
	pid := os.Getpid()
	dir := filepath.Join(proc, strconv.Itoa(pid))
	if err := os.Mkdir(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	fields := strings.Fields("S 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 12345")
	for path, content := range map[string]string{
		filepath.Join(dir, "stat"):          fmt.Sprintf("%d (live fixture) %s\n", pid, strings.Join(fields, " ")),
		filepath.Join(dir, "cgroup"):        "0::/user.slice/" + i.SessionUnit + "\n",
		filepath.Join(i.Runtime, "app.pid"): strconv.Itoa(pid) + "\n",
	} {
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	writeEnvironmentStatus(t, i.Runtime, 9, "ready")
	bin := t.TempDir()
	log := filepath.Join(bin, "calls")
	fault := filepath.Join(bin, "fault-consumed")
	t.Setenv("REMOTEXAPP_TEST_LIVE_UNIT", i.SessionUnit)
	t.Setenv("REMOTEXAPP_TEST_LIVE_LOG", log)
	t.Setenv("REMOTEXAPP_TEST_LIVE_FAULT", fault)
	script := `#!/bin/sh
printf '%s\n' "$*" >> "$REMOTEXAPP_TEST_LIVE_LOG"
case "$*" in
  "--user is-active --quiet $REMOTEXAPP_TEST_LIVE_UNIT")
    if [ ! -e "$REMOTEXAPP_TEST_LIVE_FAULT" ]; then
      : > "$REMOTEXAPP_TEST_LIVE_FAULT"
      echo 'Failed to connect to bus: temporarily unavailable' >&2
      exit 1
    fi ;;
esac
exit 0
`
	for name, content := range map[string]string{"systemctl": script, "xdpyinfo": "#!/bin/sh\nexit 0\n"} {
		if err := os.WriteFile(filepath.Join(bin, name), []byte(content), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", bin+":"+os.Getenv("PATH"))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }))
	t.Cleanup(server.Close)
	i.GatewayAddr = strings.TrimPrefix(server.URL, "http://")
	m := &manager{cfg: config{stateDir: state, classes: map[string]classConfig{i.TemplateID: i.Spec}},
		instances: map[string]*instance{i.ID: i}, environmentProcRoot: proc,
		idleTimers: map[string]*time.Timer{},
		managed: map[string]*managedInstance{"desktop": {ID: "desktop", TemplateID: i.TemplateID,
			RuntimeInstanceID: i.ID, Runtime: i, DesiredState: "running", ObservedState: "running"}},
	}
	return m, i, bin
}

func TestManagedReconciliationPreservesLiveSessionWhenUnitQueryFails(t *testing.T) {
	m, i, bin := liveSessionObservationFixture(t)
	for attempt := 0; attempt < 2; attempt++ {
		m.lifecycleMu.Lock()
		err := m.reconcileManagedLocked("desktop")
		m.lifecycleMu.Unlock()
		if err != nil {
			t.Fatal(err)
		}
		got := m.get(i.ID)
		if got.SessionState != "running" || got.SessionGeneration != 9 || got.Error != "" || got.ApplicationStatus.State != "ready" {
			t.Fatalf("live App became inaccessible after failed observation: state=%s generation=%d error=%q", got.SessionState, got.SessionGeneration, got.Error)
		}
	}
	if _, err := os.Stat(filepath.Join(bin, "fault-consumed")); err != nil {
		t.Fatal("test did not inject a failed systemd query", err)
	}
	calls, err := os.ReadFile(filepath.Join(bin, "calls"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(calls), " stop ") || strings.Contains(string(calls), " start ") {
		t.Fatalf("observation fault changed live processes: %s", calls)
	}
}

func TestLiveCanonicalAppSurvivesSystemdQueryTimeout(t *testing.T) {
	m, i, bin := liveSessionObservationFixture(t)
	if err := os.WriteFile(filepath.Join(bin, "systemctl"), []byte("#!/bin/sh\nexec sleep 10\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	observed := m.observeRecordedSession(i)
	if observed.state != sessionAlive || m.get(i.ID).unitObservationIssue != "unit-query-timeout" {
		t.Fatalf("timeout replaced verified process liveness: %+v", observed)
	}
}

func temporarilyUnreadableProcess(t *testing.T, m *manager) func() {
	t.Helper()
	path := filepath.Join(m.canonicalProcRoot(), strconv.Itoa(os.Getpid()), "stat")
	if err := os.Rename(path, path+".saved"); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(path, 0o700); err != nil {
		t.Fatal(err)
	}
	return func() {
		t.Helper()
		if err := os.Remove(path); err != nil {
			t.Fatal(err)
		}
		if err := os.Rename(path+".saved", path); err != nil {
			t.Fatal(err)
		}
	}
}

func TestUncertainManagedObservationRecoversWithoutStateRepair(t *testing.T) {
	m, i, _ := liveSessionObservationFixture(t)
	restore := temporarilyUnreadableProcess(t, m)
	for n := 0; n < 2; n++ {
		if err := m.reconcileManagedLocked("desktop"); err != nil {
			t.Fatal(err)
		}
		got := m.get(i.ID)
		if got.SessionState != "running" || got.Error != "" || got.SessionGeneration != 9 {
			t.Fatal("uncertain observation became a terminal transition")
		}
	}
	restore()
	if err := m.reconcileManagedLocked("desktop"); err != nil {
		t.Fatal(err)
	}
	if got := m.get(i.ID); got.processObservationIssue != "" || got.SessionState != "running" || got.ApplicationStatus.State != "ready" {
		t.Fatalf("restored observation did not recover in place: %+v", got)
	}
}

func TestSessionLeaderMonitorRetriesUnreadableProcessThenReportsRealExit(t *testing.T) {
	m, i, _ := liveSessionObservationFixture(t)
	m.sessionEvents = make(chan sessionRuntimeEvent, 1)
	pidPath := filepath.Join(i.Runtime, "app.pid")
	expected, err := canonicalProcess(m.canonicalProcRoot(), os.Getpid())
	if err != nil {
		t.Fatal(err)
	}
	restore := temporarilyUnreadableProcess(t, m)
	done := make(chan struct{})
	go func() { m.monitorSession(i.ID, 9, pidPath, os.Getpid(), expected); close(done) }()
	t.Cleanup(func() { m.setSessionState(i.ID, "stopped", ""); <-done })
	select {
	case event := <-m.sessionEvents:
		t.Fatalf("unreadable /proc declared a live App dead: %+v", event)
	case <-time.After(1100 * time.Millisecond):
	}
	restore()
	// Retire only the synthetic proc directory, never the real test process.
	if err := os.RemoveAll(filepath.Join(m.canonicalProcRoot(), strconv.Itoa(os.Getpid()))); err != nil {
		t.Fatal(err)
	}
	select {
	case event := <-m.sessionEvents:
		if event.ExpectedPID != os.Getpid() || event.ExpectedIdentity != expected || event.Generation != 9 {
			t.Fatalf("exit lost generation/process identity: %+v", event)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("confirmed process exit was not observed")
	}
}

func TestCanonicalObservationSeparatesExitFromUncertainty(t *testing.T) {
	for _, tc := range []struct {
		name   string
		state  sessionLiveness
		change func(*testing.T, *manager, *instance)
	}{
		{"bad-marker", sessionUncertain, func(t *testing.T, m *manager, i *instance) {
			if err := os.WriteFile(filepath.Join(i.Runtime, "app.pid"), []byte("invalid"), 0o600); err != nil {
				t.Fatal(err)
			}
		}},
		{"missing-marker", sessionUncertain, func(t *testing.T, m *manager, i *instance) {
			if err := os.Remove(filepath.Join(i.Runtime, "app.pid")); err != nil {
				t.Fatal(err)
			}
		}},
		{"unreadable-process", sessionUncertain, func(t *testing.T, m *manager, i *instance) { temporarilyUnreadableProcess(t, m) }},
		{"foreign-cgroup", sessionUncertain, func(t *testing.T, m *manager, i *instance) {
			if err := os.WriteFile(filepath.Join(m.canonicalProcRoot(), strconv.Itoa(os.Getpid()), "cgroup"), []byte("0::/foreign/session.service\n"), 0o600); err != nil {
				t.Fatal(err)
			}
		}},
		{"gone-process", sessionExited, func(t *testing.T, m *manager, i *instance) {
			if err := os.RemoveAll(filepath.Join(m.canonicalProcRoot(), strconv.Itoa(os.Getpid()))); err != nil {
				t.Fatal(err)
			}
		}},
		{"zombie", sessionExited, func(t *testing.T, m *manager, i *instance) {
			path := filepath.Join(m.canonicalProcRoot(), strconv.Itoa(os.Getpid()), "stat")
			b, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, []byte(strings.Replace(string(b), ") S ", ") Z ", 1)), 0o600); err != nil {
				t.Fatal(err)
			}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m, i, _ := liveSessionObservationFixture(t)
			tc.change(t, m, i)
			if got := m.observeCanonicalSession(i, 0, canonicalProcessIdentity{}); got.state != tc.state {
				t.Fatalf("observation=%+v, want %v", got, tc.state)
			}
		})
	}
	m, i, _ := liveSessionObservationFixture(t)
	if got := m.observeCanonicalSession(i, os.Getpid(), canonicalProcessIdentity{UID: uint32(os.Getuid()), StartTime: "old"}); got.state != sessionExited {
		t.Fatal("recycled canonical PID was adopted")
	}
}

func TestManagerRestorationPreservesUncertainOriginalSession(t *testing.T) {
	m, i, _ := liveSessionObservationFixture(t)
	restore := temporarilyUnreadableProcess(t, m)
	m.runtimeAdoptionCheck = func(*instance) error { return errors.New("unit query unavailable") }
	m.runtimeRecoveryCreate = func(createRequest) (*instance, error) { t.Fatal("uncertain live runtime replaced"); return nil, nil }
	m.restoreRuntimeManifests([]runtimeManifestRecord{{DesiredState: "running", Runtime: *i}})
	if got := m.get(i.ID); got.SessionState != "running" || got.SessionGeneration != 9 {
		t.Fatalf("restart retired an uncertain runtime: %+v", got)
	}
	restore()
	if !m.recordedSessionAlive(m.get(i.ID)) {
		t.Fatal("original process was not recognized when observation returned")
	}
}

func TestSessionEventRechecksLiveAndUncertainProcesses(t *testing.T) {
	for _, unreadable := range []bool{false, true} {
		t.Run(strconv.FormatBool(unreadable), func(t *testing.T) {
			m, i, _ := liveSessionObservationFixture(t)
			if unreadable {
				temporarilyUnreadableProcess(t, m)
			}
			m.sessionEvents = make(chan sessionRuntimeEvent, 1)
			m.sessionEvents <- sessionRuntimeEvent{InstanceID: i.ID, Generation: 9, Unit: i.SessionUnit}
			close(m.sessionEvents)
			m.reconcileSessionEvents()
			if got := m.get(i.ID); got.SessionState != "running" || got.Error != "" {
				t.Fatalf("notification retired a live/unverified App: %+v", got)
			}
		})
	}
}

func TestDuplicateSelectionCannotRetireUncertainRuntime(t *testing.T) {
	m, i, _ := liveSessionObservationFixture(t)
	temporarilyUnreadableProcess(t, m)
	other := testRuntimeManifest(t, m.cfg.stateDir, "fixture-abcdef123456", "desktop")
	_, err := m.selectManagedRuntimeManifest(m.managed["desktop"], []runtimeManifestRecord{{Runtime: *i}, {Runtime: *other}}, []int{0, 1})
	if err == nil || !strings.Contains(err.Error(), "unverified application") {
		t.Fatal("uncertain duplicate was eligible for cleanup", err)
	}
}

func TestInactiveUnitDoesNotOverrideCanonicalLiveness(t *testing.T) {
	m, i, bin := liveSessionObservationFixture(t)
	if err := os.WriteFile(filepath.Join(bin, "systemctl"), []byte("#!/bin/sh\nexit 3\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	if got := m.observeRecordedSession(i); got.state != sessionAlive {
		t.Fatalf("unit state overrode a verified live App: %+v", got)
	}
	if err := os.Remove(filepath.Join(i.Runtime, "app.pid")); err != nil {
		t.Fatal(err)
	}
	if got := m.observeRecordedSession(i); got.state != sessionExited || got.reason != "session-component-empty" {
		t.Fatalf("missing component was not recognized: %+v", got)
	}
}

func TestStandaloneObservationPreservesUnknownComponent(t *testing.T) {
	for _, tc := range []struct {
		name, events string
		want         sessionLiveness
	}{
		{"populated", "populated 1\n", sessionUncertain},
		{"unreadable", "invalid\n", sessionUncertain},
		{"empty", "populated 0\n", sessionExited},
		{"missing", "", sessionExited},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m, i, _ := liveSessionObservationFixture(t)
			m.standalone = &standaloneCgroupRoot{path: t.TempDir(), uid: os.Getuid()}
			if err := os.Remove(filepath.Join(i.Runtime, "app.pid")); err != nil {
				t.Fatal(err)
			}
			path, err := m.standalone.componentPath(i.SessionUnit)
			if err != nil {
				t.Fatal(err)
			}
			if tc.events != "" {
				if err := os.Mkdir(path, 0o700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(path, "cgroup.events"), []byte(tc.events), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			if got := m.observeRecordedSession(i); got.state != tc.want {
				t.Fatalf("observation=%+v, want %v", got, tc.want)
			}
		})
	}
}

func TestObservationDoesNotClearHistoricalFailedSession(t *testing.T) {
	m, i, _ := liveSessionObservationFixture(t)
	i.SessionState, i.Error = "failed", "previous application failure"
	if m.recordedSessionMayBeAlive(i) || m.get(i.ID).Error != "previous application failure" {
		t.Fatal("observation cleared an unrelated persisted failure")
	}
}

func TestDelayedReadinessEventResumesPollingWithoutKnownPID(t *testing.T) {
	m, i, _ := liveSessionObservationFixture(t)
	m.sessionEvents = make(chan sessionRuntimeEvent)
	consumerDone := make(chan struct{})
	go func() { m.reconcileSessionEvents(); close(consumerDone) }()
	// Startup may queue an unavailable-process event before it can bind a PID;
	// if its recheck finds a live App, it must reinstall the polling observer.
	m.sessionEvents <- sessionRuntimeEvent{InstanceID: i.ID, Generation: 9, ReadinessMonitor: true}
	// Receiving this stale event proves the first event finished processing.
	m.sessionEvents <- sessionRuntimeEvent{InstanceID: i.ID, Generation: 8}
	t.Cleanup(func() { m.setSessionState(i.ID, "stopped", "") })
	if err := os.RemoveAll(filepath.Join(m.canonicalProcRoot(), strconv.Itoa(os.Getpid()))); err != nil {
		t.Fatal(err)
	}
	if err := waitFor(2*time.Second, func() bool { return m.get(i.ID).SessionState == "failed" }); err != nil {
		t.Fatal("delayed event left the App without a polling observer")
	}
	close(m.sessionEvents)
	<-consumerDone
}
