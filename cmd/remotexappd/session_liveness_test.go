package main

import (
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
func TestManagedReconciliationPreservesLiveSessionWhenUnitQueryFails(t *testing.T) {
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
	defer server.Close()
	i.GatewayAddr = strings.TrimPrefix(server.URL, "http://")
	m := &manager{cfg: config{stateDir: state, classes: map[string]classConfig{i.TemplateID: i.Spec}},
		instances: map[string]*instance{i.ID: i}, environmentProcRoot: proc,
		idleTimers: map[string]*time.Timer{},
		managed: map[string]*managedInstance{"desktop": {ID: "desktop", TemplateID: i.TemplateID,
			RuntimeInstanceID: i.ID, Runtime: i, DesiredState: "running", ObservedState: "running"}},
	}
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
	if _, err := os.Stat(fault); err != nil {
		t.Fatal("test did not inject a failed systemd query", err)
	}
	calls, err := os.ReadFile(log)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(calls), " stop ") || strings.Contains(string(calls), " start ") {
		t.Fatalf("observation fault changed live processes: %s", calls)
	}
}
