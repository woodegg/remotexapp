package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func actionFixture(t *testing.T, program string) (*manager, *instance) {
	t.Helper()
	m, item, _ := connectionFixture(t)
	path := writeSyntheticAppPackageVersion(t, t.TempDir(), "1.0.0")
	data, err := os.ReadFile(filepath.Join(path, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest map[string]any
	if err = json.Unmarshal(data, &manifest); err != nil {
		t.Fatal(err)
	}
	manifest["actions"] = map[string]any{"echo": actionDefinition{Handler: "action.py", Timeout: "1s", Parameters: map[string]parameterDefinition{"text": {Type: "string", Required: true, MaxLength: 512}}, Result: map[string]parameterDefinition{"text": {Type: "string", Required: true, MaxLength: 512}}}}
	data, _ = json.Marshal(manifest)
	if err = os.WriteFile(filepath.Join(path, "manifest.json"), data, 0644); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(path, "action.py"), []byte("#!/usr/bin/python3\nimport json,sys,time,os\n"+program+"\n"), 0755); err != nil {
		t.Fatal(err)
	}
	if _, err = sealAppPackageDirectory(path, strings.Repeat("a", 64)); err != nil {
		t.Fatal(err)
	}
	class, _, err := loadAppPackageDirectory(path, "synthetic-app")
	if err != nil {
		t.Fatal(err)
	}
	item.Spec.Actions = class.Actions
	item.Spec.Package = class.Package
	item.Spec.ID = class.ID
	item.Spec.APIVersion = class.APIVersion
	item.DriverVersion = "1.0.0"
	return m, item
}

func actionRequest(m *manager, id, action, body string) *httptest.ResponseRecorder {
	method, path := "GET", "/api/instances/"+id+"/actions"
	if action != "" {
		method = "POST"
		path += "/" + action
	}
	w := httptest.NewRecorder()
	m.handler().ServeHTTP(w, httptest.NewRequest(method, path, strings.NewReader(body)))
	return w
}

func TestActionsContractAndValidation(t *testing.T) {
	m, item := actionFixture(t, "print(json.dumps(json.load(sys.stdin)['parameters']))")
	w := actionRequest(m, item.ID, "", "")
	if w.Code != 200 || strings.Contains(w.Body.String(), "action.py") || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal(w.Code, w.Body)
	}
	for _, tc := range []struct {
		action, body string
		status       int
	}{
		{"absent", `{}`, 404}, {"echo", `{}`, 409},
		{"echo", `{"sessionGeneration":2,"parameters":{"text":"hi"}}`, 409},
		{"echo", `{"sessionGeneration":3,"parameters":{}}`, 400},
		{"echo", `{"sessionGeneration":3,"parameters":{"text":42}}`, 400},
		{"echo", `{"sessionGeneration":3,"parameters":{"text":"hi","shell":"ls"}}`, 400},
		{"echo", `{"sessionGeneration":3,"parameters":{"text":"hi"},"command":"ls"}`, 400},
		{"echo", `{"sessionGeneration":3} {}`, 400},
	} {
		w = actionRequest(m, item.ID, tc.action, tc.body)
		if w.Code != tc.status {
			t.Fatalf("%s: %d %s", tc.body, w.Code, w.Body)
		}
	}
	if os.Geteuid() != 0 {
		literal := "$(touch /never-execute); ' 中文"
		body, _ := json.Marshal(map[string]any{"sessionGeneration": 3, "parameters": map[string]string{"text": literal}})
		w = actionRequest(m, item.ID, "echo", string(body))
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body)
		}
		var response struct{ Result map[string]string }
		json.Unmarshal(w.Body.Bytes(), &response)
		if response.Result["text"] != literal {
			t.Fatal(response)
		}
	}
	item.SessionState = "stopped"
	w = actionRequest(m, item.ID, "echo", `{"sessionGeneration":3,"parameters":{"text":"hi"}}`)
	if w.Code != 409 {
		t.Fatal(w.Code, w.Body)
	}
	item.SessionState = "running"
	if err := os.WriteFile(filepath.Join(item.Spec.Package.Path, "action.py"), []byte("tampered"), 0755); err != nil {
		t.Fatal(err)
	}
	w = actionRequest(m, item.ID, "echo", `{"sessionGeneration":3,"parameters":{"text":"hi"}}`)
	if w.Code != 409 || !strings.Contains(w.Body.String(), "invalid-package") {
		t.Fatal(w.Code, w.Body)
	}
}

func TestActionFailuresAndCancellation(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("handlers intentionally forbidden as root")
	}
	for index, tc := range []struct {
		program, code string
		status        int
	}{
		{"sys.exit(10)", "control-busy", 409},
		{"print('private secret',file=sys.stderr);sys.exit(1)", "outcome-unknown", 502},
		{"print('not json')", "outcome-unknown", 502},
		{"print('{}')", "outcome-unknown", 502},
		{"print('{\"text\":42}')", "outcome-unknown", 502},
		{"print('{\"text\":\"ok\",\"secret\":true}')", "outcome-unknown", 502},
		{"print('{\"text\":\"ok\"} {}')", "outcome-unknown", 502},
		{"print('x'*20000)", "outcome-unknown", 502},
		{"time.sleep(10)", "outcome-unknown", 409},
	} {
		t.Run(fmt.Sprintf("case-%d", index), func(t *testing.T) {
			m, item := actionFixture(t, tc.program)
			start := time.Now()
			w := actionRequest(m, item.ID, "echo", `{"sessionGeneration":3,"parameters":{"text":"hi"}}`)
			if w.Code != tc.status || !strings.Contains(w.Body.String(), tc.code) || strings.Contains(w.Body.String(), "private secret") {
				t.Fatal(w.Code, w.Body)
			}
			if time.Since(start) > 3*time.Second {
				t.Fatal("unbounded execution")
			}
			if len(m.actions) != 0 {
				t.Fatal("retained action")
			}
		})
	}
	m, item := actionFixture(t, "time.sleep(10)")
	finished := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		finished <- actionRequest(m, item.ID, "echo", `{"sessionGeneration":3,"parameters":{"text":"hi"}}`)
	}()
	deadline := time.Now().Add(time.Second)
	for {
		m.mu.RLock()
		running := m.actions[item.ID] != nil
		m.mu.RUnlock()
		if running {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("not registered")
		}
		time.Sleep(time.Millisecond)
	}
	w := actionRequest(m, item.ID, "echo", `{"sessionGeneration":3,"parameters":{"text":"hi"}}`)
	if w.Code != 409 {
		t.Fatal(w.Code)
	}
	// Cancellation joins while lifecycle lock is held; no deadlock or late success.
	m.lifecycleMu.Lock()
	m.cancelAction(item.ID)
	m.lifecycleMu.Unlock()
	select {
	case w = <-finished:
		if w.Code != 409 {
			t.Fatal(w.Code)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("cancel deadlock")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	req := httptest.NewRequest("POST", "/api/instances/"+item.ID+"/actions/echo", strings.NewReader(`{"sessionGeneration":3,"parameters":{"text":"hi"}}`)).WithContext(ctx)
	w = httptest.NewRecorder()
	m.handler().ServeHTTP(w, req)
	if w.Code == 200 {
		t.Fatal("cancelled request succeeded")
	}
}

func TestActionDefinitionGuards(t *testing.T) {
	valid := actionDefinition{Handler: "run.sh", Timeout: "1s", Parameters: map[string]parameterDefinition{}, Result: map[string]parameterDefinition{}}
	for _, handler := range []string{"", "/bin/sh", "../run.sh", "a/../run.sh", "a\\run.sh"} {
		a := valid
		a.Handler = handler
		if validateActions(&classConfig{APIVersion: appPackageAPIVersion, Actions: map[string]actionDefinition{"run": a}}) == nil {
			t.Fatal(handler)
		}
	}
	for _, timeout := range []string{"0s", "31s", "invalid"} {
		a := valid
		a.Timeout = timeout
		if validateActions(&classConfig{APIVersion: appPackageAPIVersion, Actions: map[string]actionDefinition{"run": a}}) == nil {
			t.Fatal(timeout)
		}
	}
	for _, defs := range []map[string]parameterDefinition{nil, {"file": {Type: "file"}}, {"bad": {Type: "unknown"}}} {
		a := valid
		a.Parameters = defs
		if validateActions(&classConfig{APIVersion: appPackageAPIVersion, Actions: map[string]actionDefinition{"run": a}}) == nil {
			t.Fatal(defs)
		}
	}
	m, item, _ := connectionFixture(t)
	w := actionRequest(m, item.ID, "", "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"actions":{}`) {
		t.Fatal(w.Code, w.Body)
	}
	w = actionRequest(m, "missing", "", "")
	if w.Code != 404 {
		t.Fatal(w.Code)
	}
	m.lifecycleMu.Lock()
	w = actionRequest(m, item.ID, "", "")
	m.lifecycleMu.Unlock()
	if w.Code != 409 {
		t.Fatal(w.Code)
	}
}

func TestActionsRetainManagerSecurity(t *testing.T) {
	m, item, _ := connectionFixture(t)
	m.cfg.authMode = "trusted-header"
	m.cfg.identityHeader = "X-Remote-User"
	_, network, _ := net.ParseCIDR("127.0.0.0/8")
	m.cfg.trustedProxyNetworks = []*net.IPNet{network}
	for _, tc := range []struct {
		remote, identity, origin string
		status                   int
	}{
		{"127.0.0.1:1234", "", "", 401}, {"192.0.2.1:1234", "operator", "", 401},
		{"127.0.0.1:1234", "operator", "", 200}, {"127.0.0.1:1234", "operator", "https://foreign.example", 403},
	} {
		r := httptest.NewRequest("GET", "/api/instances/"+item.ID+"/actions", nil)
		r.RemoteAddr = tc.remote
		r.Header.Set("X-Remote-User", tc.identity)
		r.Header.Set("Origin", tc.origin)
		w := httptest.NewRecorder()
		m.handler().ServeHTTP(w, r)
		if w.Code != tc.status {
			t.Fatal(w.Code, w.Body)
		}
	}
}

func TestActionSlowBodyDoesNotLockLifecycle(t *testing.T) {
	m, item := actionFixture(t, "print('{}')")
	reader, writer := io.Pipe()
	defer reader.Close()
	defer writer.Close()
	request := httptest.NewRequest("POST", "/api/instances/"+item.ID+"/actions/echo", reader)
	finished := make(chan struct{})
	go func() { defer close(finished); m.handler().ServeHTTP(httptest.NewRecorder(), request) }()
	if _, err := writer.Write([]byte(`{"sessionGeneration":3,`)); err != nil {
		t.Fatal(err)
	}
	response := actionRequest(m, item.ID, "", "")
	writer.Close()
	<-finished
	if response.Code != 200 {
		t.Fatalf("slow body blocked lifecycle: %d %s", response.Code, response.Body)
	}
}

func TestActionForceKillsUncooperativeGroup(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("handlers forbidden as root")
	}
	m, item := actionFixture(t, "import signal,subprocess\nsignal.signal(signal.SIGTERM,signal.SIG_IGN)\np=subprocess.Popen(['/bin/sleep','30'])\nopen(os.environ['REMOTEXAPP_RUNTIME']+'/descendant.pid','w').write(str(p.pid))\ntime.sleep(30)")
	started := time.Now()
	response := actionRequest(m, item.ID, "echo", `{"sessionGeneration":3,"parameters":{"text":"test"}}`)
	if response.Code != 409 || !strings.Contains(response.Body.String(), "outcome-unknown") {
		t.Fatal(response.Code, response.Body)
	}
	if time.Since(started) > 8*time.Second {
		t.Fatal("force deadline not enforced")
	}
	payload, err := os.ReadFile(filepath.Join(item.Runtime, "descendant.pid"))
	if err != nil {
		t.Fatal(err)
	}
	pid, err := strconv.Atoi(string(payload))
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for {
		stat, err := os.ReadFile(filepath.Join("/proc", strconv.Itoa(pid), "stat"))
		if os.IsNotExist(err) || strings.Contains(string(stat), ") Z ") {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("descendant still running", pid)
		}
		time.Sleep(10 * time.Millisecond)
	}
}
