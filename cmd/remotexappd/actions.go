package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const actionLimit = 16384

type actionDefinition struct {
	Handler    string                         `json:"handler"`
	Parameters map[string]parameterDefinition `json:"parameters"`
	Result     map[string]parameterDefinition `json:"result"`
	Timeout    string                         `json:"timeout"`
}
type activeAction struct {
	cancel context.CancelFunc
	done   chan struct{}
}

func validateActions(class *classConfig) error {
	if len(class.Actions) > 16 {
		return errors.New("at most 16 actions are supported")
	}
	for name, a := range class.Actions {
		if class.APIVersion != appPackageAPIVersion || !safeParameterName.MatchString(name) {
			return errors.New("actions require App Package V1 and safe names")
		}
		if a.Handler == "" || filepath.IsAbs(a.Handler) || filepath.Clean(a.Handler) != a.Handler || strings.Contains(a.Handler, "\\") || strings.HasPrefix(a.Handler, "../") {
			return errors.New("action handler must be package-relative")
		}
		timeout, err := time.ParseDuration(a.Timeout)
		if err != nil || timeout < time.Second || timeout > 30*time.Second {
			return errors.New("action timeout must be 1s..30s")
		}
		for _, defs := range []map[string]parameterDefinition{a.Parameters, a.Result} {
			if defs == nil || len(defs) > 16 {
				return errors.New("action schemas must be objects with at most 16 fields")
			}
			if err := validateParameterDefinitions(defs); err != nil {
				return err
			}
			for _, d := range defs {
				if d.Type == "file" {
					return errors.New("action file parameters are unsupported")
				}
			}
		}
	}
	return nil
}

func (m *manager) cancelAction(id string) {
	m.mu.RLock()
	a := m.actions[id]
	m.mu.RUnlock()
	if a != nil {
		a.cancel()
		<-a.done
	}
}

type boundedActionOutput struct {
	bytes.Buffer
	exceeded bool
}

func (b *boundedActionOutput) Write(p []byte) (int, error) {
	if b.Len()+len(p) > actionLimit {
		b.exceeded = true
		return 0, errors.New("action output limit")
	}
	return b.Buffer.Write(p)
}

func (m *manager) serveActions(w http.ResponseWriter, r *http.Request, parts []string) {
	w.Header().Set("Cache-Control", "no-store")
	fail := func(status int, code string) { writeJSON(w, status, map[string]string{"error": code, "code": code}) }
	if len(parts) == 2 && r.Method != http.MethodGet || len(parts) == 3 && r.Method != http.MethodPost {
		methodNotAllowed(w, "GET, POST")
		return
	}
	var request struct {
		SessionGeneration int64          `json:"sessionGeneration"`
		Parameters        map[string]any `json:"parameters"`
	}
	if len(parts) == 3 {
		// Never hold the lifecycle lock while waiting for client-controlled input.
		// ResponseRecorder/custom transports may not implement read deadlines.
		controller := http.NewResponseController(w)
		_ = controller.SetReadDeadline(time.Now().Add(5 * time.Second))
		r.Body = http.MaxBytesReader(w, r.Body, actionLimit)
		err := decodeStrictJSON(r.Body, &request)
		_ = controller.SetReadDeadline(time.Time{})
		if err != nil {
			fail(400, "invalid-request")
			return
		}
	}
	if !m.lifecycleMu.TryLock() {
		fail(409, "busy")
		return
	}
	locked := true
	defer func() {
		if locked {
			m.lifecycleMu.Unlock()
		}
	}()
	item := m.get(parts[0])
	if item == nil {
		fail(404, "instance-not-found")
		return
	}
	class := m.specFor(item)
	if len(parts) == 2 {
		actions := map[string]any{}
		for name, a := range class.Actions {
			actions[name] = map[string]any{"parameters": a.Parameters, "result": a.Result, "timeout": a.Timeout}
		}
		writeJSON(w, 200, map[string]any{"instanceId": item.ID, "sessionGeneration": item.SessionGeneration, "driverVersion": item.DriverVersion, "ready": item.SessionState == "running" && item.ApplicationStatus != nil && item.ApplicationStatus.State == "ready", "actions": actions})
		return
	}
	a, ok := class.Actions[parts[2]]
	if !ok || class.Package == nil {
		fail(404, "unsupported-action")
		return
	}
	if request.SessionGeneration < 1 || request.SessionGeneration != item.SessionGeneration {
		fail(409, "stale-generation")
		return
	}
	if item.SessionState != "running" || item.ApplicationStatus == nil || item.ApplicationStatus.State != "ready" {
		fail(409, "not-ready")
		return
	}
	parameters, err := resolveLaunchParameters(a.Parameters, request.Parameters, nil)
	if err != nil {
		fail(400, "invalid-parameters")
		return
	}
	// Revalidate the immutable pinned package, not the latest enabled selector.
	verified, _, err := loadAppPackageDirectory(class.Package.Path, class.ID)
	if err != nil || verified.Package.ContentSHA256 != class.Package.ContentSHA256 {
		fail(409, "invalid-package")
		return
	}
	descriptor, err := m.connections(item)
	if err != nil {
		fail(409, "not-ready")
		return
	}
	timeout, _ := time.ParseDuration(a.Timeout)
	ctx, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()
	active := &activeAction{cancel: cancel, done: make(chan struct{})}
	m.mu.Lock()
	if m.actions == nil {
		m.actions = map[string]*activeAction{}
	}
	if m.actions[item.ID] != nil || len(m.actions) >= 32 {
		m.mu.Unlock()
		fail(409, "busy")
		return
	}
	m.actions[item.ID] = active
	m.mu.Unlock()
	defer func() { m.mu.Lock(); delete(m.actions, item.ID); close(active.done); m.mu.Unlock() }()
	// Registration and process start share the short lifecycle critical section.
	// Lifecycle stop cancels and joins this handler before replacing the session.
	payload, _ := json.Marshal(map[string]any{"parameters": parameters, "connections": descriptor})
	command := exec.CommandContext(ctx, filepath.Join(class.Package.Path, a.Handler))
	command.Stdin = bytes.NewReader(payload)
	command.Dir = class.Package.Path
	command.Env = []string{"PATH=/usr/local/bin:/usr/bin:/bin", "HOME=" + item.Home, "DISPLAY=" + item.Display, "XAUTHORITY=" + authorityPath(item), "XDG_CONFIG_HOME=" + filepath.Join(item.Home, ".config"), "XDG_CACHE_HOME=" + filepath.Join(item.Home, ".cache"), "XDG_DATA_HOME=" + filepath.Join(item.Home, ".local/share"), "REMOTEXAPP_RUNTIME=" + item.Runtime, "REMOTEXAPP_SESSION_GENERATION=" + strconv.FormatInt(item.SessionGeneration, 10)}
	if descriptor.Environment.SessionBus != nil {
		command.Env = append(command.Env, "DBUS_SESSION_BUS_ADDRESS="+descriptor.Environment.SessionBus.Address)
	}
	command.Env = appendAppProcessEnvironment(command.Env, item, class)
	// Imported Python helpers must not create __pycache__ inside sealed packages.
	command.Env = append(command.Env, "PYTHONDONTWRITEBYTECODE=1")
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true, Pdeathsig: syscall.SIGTERM}
	command.Cancel = func() error {
		if command.Process != nil {
			return syscall.Kill(-command.Process.Pid, syscall.SIGTERM)
		}
		return nil
	}
	// Let protocol-owning handlers release their own sessions before force kill.
	command.WaitDelay = 4 * time.Second
	var output, stderr boundedActionOutput
	command.Stdout = &output
	command.Stderr = &stderr
	if os.Geteuid() == 0 {
		fail(403, "root-execution-forbidden")
		return
	}
	if err = command.Start(); err != nil {
		fail(500, "driver-unavailable")
		return
	}
	m.lifecycleMu.Unlock()
	locked = false
	err = command.Wait()
	// A handler must not leave descendants behind after returning.
	_ = syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
	current := m.get(item.ID)
	if ctx.Err() != nil || current == nil || current.SessionGeneration != item.SessionGeneration || current.SessionState != "running" {
		fail(409, "outcome-unknown")
		return
	}
	if err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) && exit.ExitCode() == 10 {
			fail(409, "control-busy")
		} else {
			fail(502, "outcome-unknown")
		}
		return
	}
	if output.exceeded || stderr.exceeded {
		fail(502, "outcome-unknown")
		return
	}
	var result map[string]any
	decoder := json.NewDecoder(&output)
	decoder.UseNumber()
	if err := decoder.Decode(&result); err != nil || result == nil {
		fail(502, "outcome-unknown")
		return
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		fail(502, "outcome-unknown")
		return
	}
	// Result defaults are forbidden by convention: require actual driver values.
	for name, d := range a.Result {
		if d.Required {
			if _, ok := result[name]; !ok {
				fail(502, "outcome-unknown")
				return
			}
		}
	}
	if err := validateStatusDetails(a.Result, result); err != nil {
		fail(502, "outcome-unknown")
		return
	}
	writeJSON(w, 200, map[string]any{"instanceId": item.ID, "sessionGeneration": item.SessionGeneration, "action": parts[2], "result": result})
}
