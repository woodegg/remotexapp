package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
)

// Exercise the production handler through HTTP, using real packaged LightView
// scripts and a deterministic Unix peer. Only native desktop dependencies and
// /proc identity are fixtures; the installer, seal and action execution are real.
func TestLightViewPolicyActions(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("action execution intentionally forbidden as root")
	}
	source := filepath.Join("..", "..", "apps", "lightview")
	provideDeclaredExecutableDependencies(t, source)
	stage := t.TempDir()
	for _, name := range []string{"LICENSE", "manifest.json", "control.py", "open-url.py", "session.sh", "shutdown.sh", "server.sh", "viewer-hook.py", "viewer-attach.sh", "viewer-detach.sh"} {
		data, err := os.ReadFile(filepath.Join(source, name))
		if err != nil {
			t.Fatal(err)
		}
		info, err := os.Stat(filepath.Join(source, name))
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filepath.Join(stage, name), data, info.Mode().Perm()); err != nil {
			t.Fatal(err)
		}
	}
	archive := filepath.Join(t.TempDir(), "lightview.tar.gz")
	digest := archiveSyntheticAppPackage(t, stage, archive)
	root, enabled := filepath.Join(t.TempDir(), "apps"), filepath.Join(t.TempDir(), "enabled")
	installed, err := installAppPackageArchive(archive, digest, root, enabled, true)
	if err != nil {
		t.Fatal(err)
	}
	class, _, err := loadAppPackageDirectory(installed.Path, "lightview")
	if err != nil {
		t.Fatal(err)
	}
	m, item, writeConnections := connectionFixture(t)
	item.Spec.Actions, item.Spec.Package = class.Actions, class.Package
	item.Spec.ID, item.Spec.APIVersion, item.DriverVersion = class.ID, class.APIVersion, class.DriverVersion
	if err = os.Mkdir(filepath.Join(item.Runtime, "lightview"), 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(item.Runtime, "lightview", "control.sock")
	if err = os.WriteFile(filepath.Join(item.Runtime, "lightview-process.pid"), []byte("4242\n"), 0600); err != nil {
		t.Fatal(err)
	}
	writeConnections(map[string]any{"protocol": "lightview-json-v1", "transport": "unix", "socketPath": path})
	peer, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	defer peer.Close()
	var mu sync.Mutex
	state := map[string]any{"pid": 4242, "private": false, "low_memory": true, "memory_limit_mib": 384,
		"configured_memory_kill_threshold_mib": 3072, "memory_kill_threshold_mib": 0, "memory_protection_enabled": false,
		"engine_state": "ready", "web_process_generation": 1, "uri": "about:blank", "title": "fixture", "loading": false, "load_error": nil}
	var commands []string
	go func() {
		for {
			c, err := peer.Accept()
			if err != nil {
				return
			}
			func() {
				defer c.Close()
				var request map[string]any
				if json.NewDecoder(bufio.NewReader(c)).Decode(&request) != nil {
					return
				}
				mu.Lock()
				defer mu.Unlock()
				command, _ := request["command"].(string)
				commands = append(commands, command)
				if command == "open" {
					state["uri"] = request["uri"]
				}
				var result any = map[string]any{}
				if command == "status" {
					result = state
				}
				_ = json.NewEncoder(c).Encode(map[string]any{"ok": true, "result": result})
			}()
		}
	}()
	server := httptest.NewServer(m.handler())
	defer server.Close()
	post := func(url string) (int, string) {
		t.Helper()
		data, _ := json.Marshal(map[string]any{"sessionGeneration": 3, "parameters": map[string]string{"url": url}})
		response, err := http.Post(server.URL+"/api/instances/"+item.ID+"/actions/openUrl", "application/json", bytes.NewReader(data))
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		body, _ := io.ReadAll(response.Body)
		return response.StatusCode, string(body)
	}
	for _, threshold := range []int{0, 3072, 4096, 0} {
		mu.Lock()
		state["memory_kill_threshold_mib"] = threshold
		state["memory_protection_enabled"] = threshold != 0
		commands = nil
		mu.Unlock()
		code, body := post("http://localhost:8765/review.html")
		if code != 200 || !strings.Contains(body, `"currentUri":"http://localhost:8765/review.html"`) {
			t.Fatalf("threshold %d: %d %s", threshold, code, body)
		}
		mu.Lock()
		actual := append([]string(nil), commands...)
		mu.Unlock()
		if !reflect.DeepEqual(actual, []string{"status", "open", "status"}) {
			t.Fatal(actual)
		}
	}
	for key, value := range map[string]any{"pid": 4243, "engine_state": "recovering"} {
		mu.Lock()
		old := state[key]
		state[key] = value
		commands = nil
		mu.Unlock()
		code, _ := post("http://localhost:8765/review.html")
		if code != 502 {
			t.Fatal(code)
		}
		mu.Lock()
		actual := append([]string(nil), commands...)
		state[key] = old
		mu.Unlock()
		if !reflect.DeepEqual(actual, []string{"status"}) {
			t.Fatal(actual)
		}
	}
	if code, _ := post("file:///etc/passwd"); code != 400 {
		t.Fatal(code)
	}
	mu.Lock()
	state["engine_state"] = "recovering"
	state["web_process_generation"] = 0
	commands = nil
	mu.Unlock()
	quit := exec.Command("/usr/bin/python3", filepath.Join(installed.Path, "control.py"), path, "4242", "quit")
	if out, err := quit.CombinedOutput(); err != nil {
		t.Fatalf("quit: %v %s", err, out)
	}
	mu.Lock()
	actual := append([]string(nil), commands...)
	mu.Unlock()
	if !reflect.DeepEqual(actual, []string{"status", "quit"}) {
		t.Fatal(actual)
	}
	if _, err := os.Stat(filepath.Join(installed.Path, "__pycache__")); !os.IsNotExist(err) {
		t.Fatal("bytecode polluted package", err)
	}
	if _, _, err := loadAppPackageDirectory(installed.Path, "lightview"); err != nil {
		t.Fatal(err)
	}
	// Intentionally corrupt only the disposable package: both dispatch and the
	// same catalog loader used at Manager startup must continue to fail closed.
	if err := os.WriteFile(filepath.Join(installed.Path, "control.py"), []byte("tampered"), 0755); err != nil {
		t.Fatal(err)
	}
	if code, body := post("http://localhost:8765/review.html"); code != 409 || !strings.Contains(body, "invalid-package") {
		t.Fatal(code, body)
	}
	if _, _, err := loadAppPackageDirectory(installed.Path, "lightview"); err == nil || !strings.Contains(err.Error(), "does not match its seal") {
		t.Fatal(err)
	}
	if _, _, err := loadAppPackageCatalog(root, enabled); err == nil || !strings.Contains(err.Error(), "does not match its seal") {
		t.Fatal("startup catalog must reject the tampered package", err)
	}
}
