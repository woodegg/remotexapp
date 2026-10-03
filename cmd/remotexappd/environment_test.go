package main

import (
	"bytes"
	"encoding/json"
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

func TestParseApplicationEnvironment(t *testing.T) {
	parsed, err := parseApplicationEnvironment([]byte("DISPLAY=:7\x00EMPTY=\x00VALUE=a=b=c\x00"))
	if err != nil {
		t.Fatal(err)
	}
	if parsed["DISPLAY"] != ":7" || parsed["EMPTY"] != "" || parsed["VALUE"] != "a=b=c" || len(parsed) != 3 {
		t.Fatalf("parsed environment = %#v", parsed)
	}

	for name, payload := range map[string][]byte{
		"missing name":   []byte("=value\x00"),
		"missing equals": []byte("DISPLAY\x00"),
		"duplicate":      []byte("DISPLAY=:1\x00DISPLAY=:2\x00"),
		"invalid utf8":   {'N', 'A', 'M', 'E', '=', 0xff, 0},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := parseApplicationEnvironment(payload); err == nil {
				t.Fatal("invalid environment was accepted")
			}
		})
	}
}

func TestApplicationEnvironmentRejectsExitedCanonicalProcess(t *testing.T) {
	for _, state := range []string{"R", "S", "Z", "X"} {
		t.Run(state, func(t *testing.T) {
			m, item, _ := newEnvironmentFixture(t, []byte("DISPLAY=:71\x00"))
			path := procPath(m.environmentProcRoot, 4242, "stat")
			payload, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			payload = bytes.Replace(payload, []byte(") S "), []byte(") "+state+" "), 1)
			if err := os.WriteFile(path, payload, 0o600); err != nil {
				t.Fatal(err)
			}
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/api/instances/"+item.ID+"/status/environment", strings.NewReader(`{"sessionGeneration":3}`))
			m.handler().ServeHTTP(response, request)
			want := http.StatusOK
			if state == "Z" || state == "X" {
				want = http.StatusConflict
			}
			if response.Code != want {
				t.Fatalf("process state %s: HTTP %d, want %d: %s", state, response.Code, want, response.Body.String())
			}
		})
	}
}

func TestProcessBelongsToExactUnitSegment(t *testing.T) {
	root := t.TempDir()
	pid := 4242
	directory := filepath.Join(root, strconv.Itoa(pid))
	if err := os.Mkdir(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "cgroup"), []byte("0::/user.slice/remotexapp-example-session.service/child\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	matched, err := processBelongsToUnit(root, pid, "remotexapp-example-session.service")
	if err != nil || !matched {
		t.Fatalf("exact cgroup unit match = %v, %v", matched, err)
	}
	matched, err = processBelongsToUnit(root, pid, "example-session.service")
	if err != nil || matched {
		t.Fatalf("partial cgroup unit match = %v, %v", matched, err)
	}
}

func TestApplicationEnvironmentEndpoint(t *testing.T) {
	m, _, runtime := newEnvironmentFixture(t, []byte(
		"DISPLAY=:71\x00"+
			"XAUTHORITY=/tmp/test-authority\x00"+
			"DBUS_SESSION_BUS_ADDRESS=unix:path=/tmp/test-bus\x00"+
			"VALUE=a=b\x00",
	))
	statusBefore, err := os.ReadFile(statusPath(runtime))
	if err != nil {
		t.Fatal(err)
	}
	filesBefore, err := os.ReadDir(runtime)
	if err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodPost, "/api/instances/test-environment/status/environment", strings.NewReader(`{"sessionGeneration":3}`))
	response := httptest.NewRecorder()
	m.handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("environment endpoint=%d body=%s", response.Code, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Errorf("Cache-Control = %q", response.Header().Get("Cache-Control"))
	}
	var result applicationEnvironmentResponse
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.InstanceID != "test-environment" || result.SessionGeneration != 3 || result.ApplicationState != "ready" {
		t.Fatalf("environment response envelope = %#v", result)
	}
	wantEnvironment := map[string]string{
		"DISPLAY": ":71", "XAUTHORITY": "/tmp/test-authority",
		"DBUS_SESSION_BUS_ADDRESS": "unix:path=/tmp/test-bus", "VALUE": "a=b",
	}
	if !equalStringMap(result.Environment, wantEnvironment) {
		t.Fatalf("environment = %#v, want %#v", result.Environment, wantEnvironment)
	}
	if result.WorkingDirectory != m.instances["test-environment"].Home {
		t.Errorf("workingDirectory = %q", result.WorkingDirectory)
	}
	for _, forbidden := range []string{"processId", "stdout", "stderr", "exitCode"} {
		if bytes.Contains(response.Body.Bytes(), []byte(forbidden)) {
			t.Errorf("environment response exposes %s: %s", forbidden, response.Body.String())
		}
	}
	statusAfter, err := os.ReadFile(statusPath(runtime))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(statusBefore, statusAfter) {
		t.Error("environment lookup changed the durable application status")
	}
	filesAfter, err := os.ReadDir(runtime)
	if err != nil {
		t.Fatal(err)
	}
	if len(filesAfter) != len(filesBefore) {
		t.Errorf("environment lookup persisted runtime data: before=%d after=%d", len(filesBefore), len(filesAfter))
	}
}

func TestApplicationEnvironmentEndpointRejectsInvalidRequests(t *testing.T) {
	tests := []struct {
		name      string
		body      string
		configure func(*manager, *instance, string)
		want      int
	}{
		{name: "malformed JSON", body: `{`, want: http.StatusBadRequest},
		{name: "unknown field", body: `{"sessionGeneration":3,"argv":["/usr/bin/env"]}`, want: http.StatusBadRequest},
		{name: "missing generation", body: `{}`, want: http.StatusBadRequest},
		{name: "stale generation", body: `{"sessionGeneration":2}`, want: http.StatusConflict},
		{name: "stopped session", body: `{"sessionGeneration":3}`, want: http.StatusConflict, configure: func(_ *manager, item *instance, _ string) {
			item.SessionState = "stopped"
		}},
		{name: "wrong cgroup", body: `{"sessionGeneration":3}`, want: http.StatusConflict, configure: func(_ *manager, item *instance, _ string) {
			item.SessionUnit = "another-session.service"
		}},
		{name: "loading application", body: `{"sessionGeneration":3}`, want: http.StatusConflict, configure: func(_ *manager, _ *instance, runtime string) {
			writeEnvironmentStatus(t, runtime, 3, "loading")
		}},
		{name: "duplicate environment", body: `{"sessionGeneration":3}`, want: http.StatusUnprocessableEntity, configure: func(m *manager, _ *instance, _ string) {
			pid := 4242
			_ = os.WriteFile(procPath(m.environmentProcRoot, pid, "environ"), []byte("DISPLAY=:1\x00DISPLAY=:2\x00"), 0o600)
		}},
		{name: "oversized environment", body: `{"sessionGeneration":3}`, want: http.StatusRequestEntityTooLarge, configure: func(m *manager, _ *instance, _ string) {
			pid := 4242
			payload := append([]byte("LARGE="), bytes.Repeat([]byte{'x'}, applicationEnvironmentLimit)...)
			_ = os.WriteFile(procPath(m.environmentProcRoot, pid, "environ"), payload, 0o600)
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			m, item, runtime := newEnvironmentFixture(t, []byte("DISPLAY=:71\x00"))
			if test.configure != nil {
				test.configure(m, item, runtime)
			}
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/api/instances/test-environment/status/environment", strings.NewReader(test.body))
			m.handler().ServeHTTP(response, request)
			if response.Code != test.want {
				t.Fatalf("status=%d want=%d body=%s", response.Code, test.want, response.Body.String())
			}
			if response.Header().Get("Cache-Control") != "no-store" {
				t.Errorf("error Cache-Control = %q", response.Header().Get("Cache-Control"))
			}
		})
	}
}

func TestApplicationEnvironmentEndpointAllowsOnlyPOST(t *testing.T) {
	m, _, _ := newEnvironmentFixture(t, []byte("DISPLAY=:71\x00"))
	response := httptest.NewRecorder()
	m.handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/instances/test-environment/status/environment", nil))
	if response.Code != http.StatusMethodNotAllowed || response.Header().Get("Allow") != "POST" {
		t.Fatalf("GET environment response = %d Allow=%q", response.Code, response.Header().Get("Allow"))
	}
}

func TestApplicationEnvironmentEndpointRejectsUnauthenticatedPublicListener(t *testing.T) {
	m, _, _ := newEnvironmentFixture(t, []byte("DISPLAY=:71\x00"))
	m.cfg.listen = "0.0.0.0:1991"
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/instances/test-environment/status/environment", strings.NewReader(`{"sessionGeneration":3}`))
	m.handler().ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("public unauthenticated environment response = %d, want %d: %s", response.Code, http.StatusForbidden, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Errorf("Cache-Control = %q", response.Header().Get("Cache-Control"))
	}
}

func TestApplicationEnvironmentEndpointAllowsExplicitInsecurePublicListener(t *testing.T) {
	m, _, _ := newEnvironmentFixture(t, []byte("DISPLAY=:71\x00"))
	m.cfg.listen = "0.0.0.0:1991"
	m.cfg.allowInsecure = true
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/instances/test-environment/status/environment", strings.NewReader(`{"sessionGeneration":3}`))
	m.handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("explicit insecure public environment response = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Errorf("Cache-Control = %q", response.Header().Get("Cache-Control"))
	}
}

func newEnvironmentFixture(t *testing.T, environment []byte) (*manager, *instance, string) {
	t.Helper()
	runtime := t.TempDir()
	workingDirectory := t.TempDir()
	procRoot := t.TempDir()
	pid := 4242
	unit := "remotexapp-test-environment-session.service"
	processDirectory := filepath.Join(procRoot, strconv.Itoa(pid))
	if err := os.Mkdir(processDirectory, 0o700); err != nil {
		t.Fatal(err)
	}
	statFields := make([]string, 20)
	statFields[0] = "S"
	for index := 1; index < len(statFields); index++ {
		statFields[index] = "0"
	}
	statFields[19] = "123456"
	processStat := fmt.Sprintf("%d (fixture process) %s\n", pid, strings.Join(statFields, " "))
	for name, payload := range map[string][]byte{
		"stat":    []byte(processStat),
		"cgroup":  []byte("0::/user.slice/" + unit + "/child\n"),
		"environ": environment,
	} {
		if err := os.WriteFile(filepath.Join(processDirectory, name), payload, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Symlink(workingDirectory, filepath.Join(processDirectory, "cwd")); err != nil {
		t.Fatal(err)
	}
	class := classConfig{
		ID: "test-environment",
		Session: sessionClassConfig{
			ReadinessPID: "application.pid",
			Status:       statusClassConfig{Mode: "driver"},
		},
	}
	item := &instance{
		ID: "test-environment", ClassID: class.ID, Spec: class,
		Runtime: runtime, Home: workingDirectory, State: "server-ready",
		SessionState: "running", SessionGeneration: 3, SessionUnit: unit,
	}
	m := &manager{
		cfg:       config{listen: "127.0.0.1:1991", authMode: "none", classes: map[string]classConfig{class.ID: class}},
		instances: map[string]*instance{item.ID: item}, idleTimers: map[string]*time.Timer{},
		environmentProcRoot: procRoot,
	}
	if err := os.WriteFile(filepath.Join(runtime, class.Session.ReadinessPID), []byte(strconv.Itoa(pid)+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	writeEnvironmentStatus(t, runtime, 3, "ready")
	return m, item, runtime
}

func writeEnvironmentStatus(t *testing.T, runtime string, generation int64, state string) {
	t.Helper()
	payload, err := json.Marshal(applicationStatus{
		Generation: generation, Revision: 1, State: state, UpdatedAt: time.Now(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := writePrivateAtomic(statusPath(runtime), append(payload, '\n')); err != nil {
		t.Fatal(err)
	}
}

func equalStringMap(left, right map[string]string) bool {
	if len(left) != len(right) {
		return false
	}
	for key, value := range left {
		if right[key] != value {
			return false
		}
	}
	return true
}
