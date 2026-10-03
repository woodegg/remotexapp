package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestProfileReferenceValidation(t *testing.T) {
	valid := []string{"default", "xfce-test", "account-42"}
	invalid := []string{"", "UPPER", "../escape", "/absolute", "has space", "-leading"}
	for _, value := range valid {
		if !safeRef.MatchString(value) {
			t.Errorf("expected %q to be valid", value)
		}
	}
	for _, value := range invalid {
		if safeRef.MatchString(value) {
			t.Errorf("expected %q to be invalid", value)
		}
	}
}

func TestPrepareXAuthority(t *testing.T) {
	authority := filepath.Join(t.TempDir(), ".Xauthority")
	for attempt := 0; attempt < 2; attempt++ {
		if err := prepareXAuthority(":77", authority); err != nil {
			t.Fatal(err)
		}
	}
	info, err := os.Stat(authority)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("Xauthority mode=%#o, want 0600", info.Mode().Perm())
	}
	output, err := exec.Command("/usr/bin/xauth", "-f", authority, "list").Output()
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Fields(strings.TrimSpace(string(output)))
	if len(lines) != 3 || !strings.Contains(lines[0], "/unix:77") || lines[1] != "MIT-MAGIC-COOKIE-1" || len(lines[2]) != 32 {
		t.Fatalf("unexpected Xauthority entry: %q", output)
	}
}

func TestPrepareXAuthorityPreservesOtherDisplayCookies(t *testing.T) {
	authority := filepath.Join(t.TempDir(), ".Xauthority")
	if err := prepareXAuthority(":76", authority); err != nil {
		t.Fatal(err)
	}
	if err := prepareXAuthority(":77", authority); err != nil {
		t.Fatal(err)
	}
	output, err := exec.Command("/usr/bin/xauth", "-f", authority, "list").Output()
	if err != nil {
		t.Fatal(err)
	}
	text := string(output)
	if !strings.Contains(text, "/unix:76") || !strings.Contains(text, "/unix:77") {
		t.Fatalf("xauth add did not preserve both display records: %q", output)
	}
}

func TestClassConfigRejectsLegacySplitExecutionModes(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.json")
	payload := `{
  "id":"legacy","name":"legacy","driverVersion":"1.0.0","singleton":true,
  "profileRef":"default","profileMode":"shared",
  "server":{"activation":"on-demand","driver":"/bin/true","displayMode":"fixed","display":9,"rfbPort":5909,"gatewayPort":39009,"geometry":"1280x720","depth":16,"frameRate":5,"allowClientResize":false,"readinessPids":["server.pid"]},
  "session":{"activation":"on-attach","dbusMode":"private","driver":"/bin/true","readinessPid":"session.pid","vacantTimeout":"10s","vacantAction":"stop-session"},
  "input":{"backend":"ibus","lifecycle":"session","allowedWmClasses":["*"]}
}`
	if err := os.WriteFile(path, []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := loadClassConfig(path); err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("legacy split execution mode error = %v", err)
	}
}

func TestControlConfigNormalizationAndBoundary(t *testing.T) {
	for name, test := range map[string]struct {
		control controlClassConfig
		want    controlClassConfig
		ok      bool
	}{
		"legacy loopback default":   {controlClassConfig{Protocol: "legacy-control"}, controlClassConfig{Protocol: "legacy-control", Address: "127.0.0.1"}, true},
		"legacy absolute path":      {controlClassConfig{Protocol: "legacy-control", Address: "127.0.0.1", Port: 21000, Path: "/session"}, controlClassConfig{Protocol: "legacy-control", Address: "127.0.0.1", Port: 21000, Path: "/session"}, true},
		"public address":            {controlClassConfig{Protocol: "legacy-control", Address: "0.0.0.0"}, controlClassConfig{}, false},
		"unsafe path":               {controlClassConfig{Protocol: "legacy-control", Path: "/session?token=secret"}, controlClassConfig{}, false},
		"unsafe protocol":           {controlClassConfig{Protocol: "Legacy Control"}, controlClassConfig{}, false},
		"endpoint without protocol": {controlClassConfig{Address: "127.0.0.1", Port: 21000}, controlClassConfig{}, false},
	} {
		t.Run(name, func(t *testing.T) {
			got := test.control
			err := normalizeControlConfig(&got)
			if test.ok && (err != nil || got != test.want) {
				t.Fatalf("normalized control = %#v, error = %v; want %#v", got, err, test.want)
			}
			if !test.ok && err == nil {
				t.Fatalf("unsafe control was accepted as %#v", got)
			}
		})
	}
	legacyPinned := classConfig{
		ID: "legacy", RunMode: "shared", Control: controlClassConfig{Protocol: "loopback-tcp"},
		Server:  serverClassConfig{DisplayMode: "dynamic"},
		Session: sessionClassConfig{Services: "core-v1", Activation: "on-attach", VacantTimeout: "10s", VacantAction: "stop-session"},
	}
	effective, _, _, err := applyOverrides(legacyPinned, instanceOverrides{})
	if err != nil || effective.Control.Address != "127.0.0.1" {
		t.Fatalf("legacy pinned control was not normalized: %#v, error = %v", effective.Control, err)
	}
}

func TestRejectHistoricalDriverOwnedSessionContract(t *testing.T) {
	path := filepath.Join("..", "..", "tests", "performance", "session-owned-ibus", "class.json")
	_, _, err := loadClassConfig(path)
	if err == nil || !strings.Contains(err.Error(), "session.services must be core-v1") {
		t.Fatalf("old Driver-owned experiment must require explicit cutover, got %v", err)
	}
}

func TestShutdownDriverProtocolOutcomes(t *testing.T) {
	// The self-executed race-instrumented helper must not add Go's default
	// one-second diagnostic exit sleep to the explicit timeout probe below.
	t.Setenv("GORACE", os.Getenv("GORACE")+" atexit_sleep_ms=0")
	runtime := t.TempDir()
	home := t.TempDir()
	pidPath := filepath.Join(runtime, "app.pid")
	if err := os.WriteFile(pidPath, []byte("999999\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	writeDriver := func(name, body string) string {
		path := filepath.Join(t.TempDir(), name)
		if err := os.WriteFile(path, []byte("#!/bin/sh\n"+body+"\n"), 0o700); err != nil {
			t.Fatal(err)
		}
		return path
	}
	class := classConfig{ID: "test-app", Session: sessionClassConfig{Services: "core-v1", ReadinessPID: "app.pid"}}
	class.Control = controlClassConfig{Protocol: "legacy-control", Address: "127.0.0.1", Path: "/session"}
	item := &instance{ID: "test-runtime", ClassID: class.ID, Spec: class, Runtime: runtime, Home: home, Display: ":99", SessionGeneration: 4, ControlAddress: "127.0.0.1", ControlPort: 21042}
	// Completion/refusal assertions are not process-startup speed benchmarks.
	m := &manager{cfg: config{shutdownGrace: time.Second, classes: map[string]classConfig{class.ID: class}}}

	message, outcome := m.runShutdownDriver(item, writeDriver("complete.sh", "printf 'closed\\n'"), stopOptions{Reason: "idle-timeout", Scope: "session"})
	if outcome != "completed" || message != "closed" {
		t.Fatalf("completed hook = %q/%q", outcome, message)
	}
	message, outcome = m.runShutdownDriver(item, writeDriver("control-env.sh", `printf '%s\n' "$REMOTEXAPP_CONTROL_PROTOCOL|$REMOTEXAPP_CONTROL_ADDRESS|$REMOTEXAPP_CONTROL_PORT|$REMOTEXAPP_CONTROL_PATH"`), stopOptions{Reason: "api-stop", Scope: "instance"})
	if outcome != "completed" || message != "legacy-control|127.0.0.1|21042|/session" {
		t.Fatalf("control environment = %q/%q", outcome, message)
	}
	message, outcome = m.runShutdownDriver(item, writeDriver("blocked.sh", "printf 'unsaved\\n' >&2; exit 10"), stopOptions{Reason: "api-stop", Scope: "instance"})
	if outcome != "blocked" || message != "unsaved" {
		t.Fatalf("blocked hook = %q/%q", outcome, message)
	}
	m.cfg.shutdownGrace = 50 * time.Millisecond
	_, outcome = m.runShutdownDriver(item, writeDriver("timeout.sh", "sleep 1"), stopOptions{Reason: "idle-timeout", Scope: "session"})
	if outcome != "timeout" {
		t.Fatalf("timed hook outcome = %q", outcome)
	}
}

func TestVersionReportsEffectiveHostShutdownPolicy(t *testing.T) {
	m := &manager{cfg: config{
		shutdownGrace: 12 * time.Second, shutdownWarnAfter: 45 * time.Minute, shutdownForceAfter: 2 * time.Hour,
	}}
	response := httptest.NewRecorder()
	m.handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/version", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("version status=%d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		ShutdownPolicy map[string]string `json:"shutdownPolicy"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.ShutdownPolicy["graceTimeout"] != "12s" || payload.ShutdownPolicy["blockedWarningAfter"] != "45m0s" || payload.ShutdownPolicy["forceAfter"] != "2h0m0s" {
		t.Fatalf("shutdown policy = %#v", payload.ShutdownPolicy)
	}
}

func TestCleanExitReusesIdleAction(t *testing.T) {
	for _, action := range []string{"keep", "stop-session", "stop-instance"} {
		class := classConfig{Session: sessionClassConfig{Services: "core-v1", VacantAction: action}}
		if got := cleanExitAction(class); got != action {
			t.Errorf("clean exit action = %q, want %q", got, action)
		}
	}
}

func TestBlockedShutdownCanBeCancelledByAttachment(t *testing.T) {
	t.Setenv("GORACE", os.Getenv("GORACE")+" atexit_sleep_ms=0")
	runtime := t.TempDir()
	driver := filepath.Join(t.TempDir(), "blocked.sh")
	if err := os.WriteFile(driver, []byte("#!/bin/sh\nprintf 'save decision required\\n' >&2\nexit 10\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	class := classConfig{ID: "test-app", Session: sessionClassConfig{Services: "core-v1",
		ReadinessPID: "app.pid", ShutdownDriver: driver,
	}}
	if err := os.WriteFile(filepath.Join(runtime, "app.pid"), []byte(strconv.Itoa(os.Getpid())+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	item := &instance{
		ID: "runtime-blocked", ClassID: class.ID, Spec: class, Runtime: runtime, Home: t.TempDir(),
		State: "server-ready", SessionState: "running", SessionGeneration: 2,
	}
	m := &manager{
		cfg:       config{shutdownGrace: time.Second, shutdownWarnAfter: time.Hour, classes: map[string]classConfig{class.ID: class}},
		instances: map[string]*instance{item.ID: item}, sessionObserver: acceptingSessionObserver{},
	}
	err := m.prepareSessionShutdown(item, stopOptions{Reason: "idle-timeout", Scope: "session"})
	if !isShutdownBlocked(err) {
		t.Fatalf("prepare shutdown error = %v, want blocked", err)
	}
	if item.SessionState != "shutdown-blocked" || item.Shutdown == nil || item.Shutdown.State != "blocked" || item.Shutdown.WarningAt == nil {
		t.Fatalf("blocked shutdown state = %#v", item)
	}
	m.cancelBlockedShutdown(item.ID)
	if item.SessionState != "running" || item.Shutdown.State != "cancelled" || item.Error != "" {
		t.Fatalf("cancelled shutdown state = %#v", item)
	}
}

type acceptingSessionObserver struct{}

func (acceptingSessionObserver) WatchSession(string, int64, string) error { return nil }
func (acceptingSessionObserver) UnwatchSession(string, int64)             {}

func TestApplicationStatusSnapshotEndpoint(t *testing.T) {
	runtime := t.TempDir()
	class := classConfig{
		ID: "test-app",
		Session: sessionClassConfig{Services: "core-v1", Status: statusClassConfig{Mode: "driver", Details: map[string]parameterDefinition{
			"application": {Type: "enum", Values: []string{"test-app"}},
		}}},
	}
	item := &instance{ID: "test-1", ClassID: class.ID, Spec: class, Runtime: runtime, SessionGeneration: 2}
	m := &manager{cfg: config{classes: map[string]classConfig{class.ID: class}}, instances: map[string]*instance{item.ID: item}, idleTimers: map[string]*time.Timer{}}
	if err := writeStatusSchema(runtime, class.Session.Status.Details); err != nil {
		t.Fatal(err)
	}
	if err := m.writeApplicationStatus(item, 2, "ready", "Test app is ready", "", false); err != nil {
		t.Fatal(err)
	}
	status, err := readApplicationStatus(runtime)
	if err != nil {
		t.Fatal(err)
	}
	status.Details = map[string]any{"application": "test-app"}
	payload, _ := json.MarshalIndent(status, "", "  ")
	if err := writePrivateAtomic(statusPath(runtime), append(payload, '\n')); err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	m.handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/instances/test-1/status", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status endpoint=%d body=%s", response.Code, response.Body.String())
	}
	var result applicationStatus
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Generation != 2 || result.State != "ready" || result.Details["application"] != "test-app" {
		t.Fatalf("unexpected application status: %#v", result)
	}
	info, err := os.Stat(statusPath(runtime))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("status mode=%#o, want 0600", info.Mode().Perm())
	}
}

func TestCurrentGenerationDriverErrorStopsSessionReadinessWait(t *testing.T) {
	runtime := t.TempDir()
	item := &instance{
		ID:                "driver-error-runtime",
		Runtime:           runtime,
		SessionGeneration: 3,
		SessionState:      "starting",
		Spec: classConfig{
			ID: "driver-error",
			Session: sessionClassConfig{Services: "core-v1",
				ReadinessPID: "application.pid",
				Status:       statusClassConfig{Mode: "driver"},
			},
		},
	}
	payload, err := json.Marshal(applicationStatus{
		Generation: 3,
		Revision:   2,
		State:      "error",
		UpdatedAt:  time.Now(),
		Summary:    "LibreOffice preflight failed",
		Error:      "document path was replaced by a symlink",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := writePrivateAtomic(statusPath(runtime), append(payload, '\n')); err != nil {
		t.Fatal(err)
	}

	started := time.Now()
	driverFailure, err := waitForSessionReadiness(
		filepath.Join(runtime, item.Spec.Session.ReadinessPID), runtime,
		item.SessionGeneration, true, time.Second,
	)
	if err != nil {
		t.Fatal(err)
	}
	if driverFailure != "document path was replaced by a symlink" {
		t.Fatalf("driver failure = %q", driverFailure)
	}
	if elapsed := time.Since(started); elapsed > 250*time.Millisecond {
		t.Errorf("driver error readiness took %s, want prompt failure", elapsed)
	}

	pidPath := filepath.Join(runtime, item.Spec.Session.ReadinessPID)
	if err := os.WriteFile(pidPath, []byte(strconv.Itoa(os.Getpid())+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	driverFailure, err = waitForSessionReadiness(pidPath, runtime, item.SessionGeneration, true, time.Second)
	if err != nil || driverFailure != "" {
		t.Fatalf("live readiness PID did not take precedence: failure=%q error=%v", driverFailure, err)
	}
	if err := os.Remove(pidPath); err != nil {
		t.Fatal(err)
	}

	status, err := readApplicationStatus(runtime)
	if err != nil {
		t.Fatal(err)
	}
	status.Generation--
	payload, err = json.Marshal(status)
	if err != nil {
		t.Fatal(err)
	}
	if err := writePrivateAtomic(statusPath(runtime), append(payload, '\n')); err != nil {
		t.Fatal(err)
	}
	driverFailure, err = waitForSessionReadiness(pidPath, runtime, item.SessionGeneration, true, 120*time.Millisecond)
	if err == nil || driverFailure != "" {
		t.Fatalf("stale driver error ended current readiness: failure=%q error=%v", driverFailure, err)
	}
}

func TestNewStatusContractTreatsLegacyStoppedRuntimeAsStopped(t *testing.T) {
	class := classConfig{ID: "test-app", Session: sessionClassConfig{Services: "core-v1", Status: statusClassConfig{Mode: "driver"}}}
	createdAt := time.Now().Add(-time.Minute)
	item := &instance{
		ID: "legacy-runtime", ClassID: class.ID, Spec: class, Runtime: t.TempDir(),
		SessionState: "stopped", SessionGeneration: 6, CreatedAt: createdAt,
	}
	m := &manager{cfg: config{classes: map[string]classConfig{class.ID: class}}}

	m.refreshApplicationStatus(item)

	if item.ApplicationStatus == nil || item.ApplicationStatus.State != "stopped" || item.ApplicationStatus.Generation != 6 {
		t.Fatalf("legacy stopped status = %#v, want stopped generation 6", item.ApplicationStatus)
	}
}

func TestUserDesktopPolicyCannotBeWeakened(t *testing.T) {
	template, _ := neutralUserHomeTemplate()
	effective, timeout, workspace, err := applyOverrides(template, instanceOverrides{})
	if err != nil {
		t.Fatal(err)
	}
	if effective.RunMode != "user-home" || workspace != "persistent" || timeout != 48*time.Hour {
		t.Fatalf("resolved user desktop policy: %#v workspace=%q timeout=%s", effective, workspace, timeout)
	}
	if _, _, _, err := applyOverrides(template, instanceOverrides{WorkspaceMode: "ephemeral"}); err == nil || !strings.Contains(err.Error(), "workspaceMode") {
		t.Fatalf("ephemeral user HOME error = %v", err)
	}
	singleton := false
	if _, _, _, err := applyOverrides(template, instanceOverrides{Singleton: &singleton}); err == nil || !strings.Contains(err.Error(), "singleton") {
		t.Fatalf("non-singleton user desktop error = %v", err)
	}
	if _, _, _, err := applyOverrides(template, instanceOverrides{Geometry: "1920x1080"}); err == nil || !strings.Contains(err.Error(), "geometry") {
		t.Fatalf("user desktop geometry override error = %v", err)
	}
	resize := true
	if _, _, _, err := applyOverrides(template, instanceOverrides{AllowClientResize: &resize}); err == nil || !strings.Contains(err.Error(), "allowClientResize") {
		t.Fatalf("user desktop resize override error = %v", err)
	}
	m := &manager{cfg: config{classes: map[string]classConfig{template.ID: template}, vncLauncher: "direct"}, instances: map[string]*instance{}, idleTimers: map[string]*time.Timer{}}
	if _, err := m.createLocked(createRequest{TemplateID: template.ID}); err == nil || !strings.Contains(err.Error(), "managed instance") {
		t.Fatalf("temporary user desktop error = %v", err)
	}
}

func TestManifestAllowedDisplayOverrides(t *testing.T) {
	template := classConfig{
		APIVersion: appPackageAPIVersion, ID: "neutral-app", RunMode: "isolated",
		Server:    serverClassConfig{DisplayMode: "dynamic", Geometry: "800x600", FrameRate: 5},
		Session:   sessionClassConfig{Services: "core-v1", Activation: "on-attach", VacantTimeout: "1m", VacantAction: "stop-instance"},
		Overrides: &overridePolicyConfig{Allowed: []string{"geometry", "allowClientResize"}},
	}
	resize := true
	effective, _, _, err := applyOverrides(template, instanceOverrides{Geometry: "1600x900", AllowClientResize: &resize})
	if err != nil {
		t.Fatal(err)
	}
	if effective.Server.Geometry != "1600x900" || !effective.Server.AllowClientResize {
		t.Fatalf("other template display overrides = %#v", effective.Server)
	}
}

func TestUserDesktopManagedRegistrationUsesFixedProfile(t *testing.T) {
	template, timeout := neutralUserHomeTemplate()
	stateDir := t.TempDir()
	m := &manager{
		cfg:       config{stateDir: stateDir, classes: map[string]classConfig{template.ID: template}, vacantTimeouts: map[string]time.Duration{template.ID: timeout}, vncLauncher: "direct"},
		instances: map[string]*instance{}, idleTimers: map[string]*time.Timer{}, managed: map[string]*managedInstance{},
	}
	request := httptest.NewRequest(http.MethodPost, "/api/managed-instances", strings.NewReader(`{"id":"primary-desktop","templateId":"fixture-user-desktop","desiredState":"stopped"}`))
	response := httptest.NewRecorder()
	m.handler().ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("register user desktop status=%d body=%s", response.Code, response.Body.String())
	}
	var registered managedInstance
	if err := json.Unmarshal(response.Body.Bytes(), &registered); err != nil {
		t.Fatal(err)
	}
	if registered.ProfileRef != "user" || registered.DesiredState != "stopped" || registered.Runtime != nil {
		t.Fatalf("registered user desktop: %#v", registered)
	}
	request = httptest.NewRequest(http.MethodPost, "/api/managed-instances", strings.NewReader(`{"id":"wrong-profile","templateId":"fixture-user-desktop","desiredState":"stopped","profileRef":"other"}`))
	response = httptest.NewRecorder()
	m.handler().ServeHTTP(response, request)
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "another profileRef") {
		t.Fatalf("wrong profile status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestUserHomeManagedRegistrationCannotPurgeUnixHome(t *testing.T) {
	stateDir := t.TempDir()
	template, _ := neutralUserHomeTemplate()
	item := &managedInstance{ID: "primary-desktop", TemplateID: template.ID, ProfileRef: template.ProfileRef, DesiredState: "stopped"}
	m := &manager{
		cfg:       config{stateDir: stateDir, classes: map[string]classConfig{template.ID: template}},
		instances: map[string]*instance{}, idleTimers: map[string]*time.Timer{}, managed: map[string]*managedInstance{item.ID: item},
	}
	if err := m.persistManaged(item); err != nil {
		t.Fatal(err)
	}
	if err := m.removeManaged(item.ID, true); err == nil || !strings.Contains(err.Error(), "cannot be purged") {
		t.Fatalf("purge error = %v, want user-home refusal", err)
	}
	if m.getManaged(item.ID) == nil {
		t.Fatal("rejected purge removed the managed registration")
	}
	if _, err := os.Stat(filepath.Join(stateDir, "managed-instances", item.ID+".json")); err != nil {
		t.Fatalf("rejected purge removed durable registration: %v", err)
	}
}

func TestUserHomeUsesDefaultUserXAuthority(t *testing.T) {
	home, err := resolveUserHome()
	if err != nil {
		t.Fatal(err)
	}
	if !filepath.IsAbs(home) || home == "/" {
		t.Fatalf("unsafe resolved user HOME %q", home)
	}
	item := &instance{Home: home, Runtime: t.TempDir(), XAuthority: filepath.Join(home, ".Xauthority")}
	if got := authorityPath(item); got != filepath.Join(home, ".Xauthority") {
		t.Fatalf("user-home Xauthority = %q", got)
	}
}

// Borrowed-bus lifecycle is tested with the Core supervisor, not an App helper.

func TestResolveLaunchParameters(t *testing.T) {
	definitions := map[string]parameterDefinition{
		"startUrl": {Type: "url", Default: json.RawMessage(`"about:blank"`), AllowedSchemes: []string{"http", "https", "about"}},
		"private":  {Type: "boolean", Default: json.RawMessage(`false`)},
	}
	resolved, err := resolveLaunchParameters(definitions, map[string]any{
		"startUrl": "https://example.com/path?q=one", "private": true,
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if resolved["startUrl"] != "https://example.com/path?q=one" || resolved["private"] != true {
		t.Fatalf("resolved parameters = %#v", resolved)
	}
	defaults, err := resolveLaunchParameters(definitions, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if defaults["startUrl"] != "about:blank" || defaults["private"] != false {
		t.Fatalf("default parameters = %#v", defaults)
	}
}

func TestLaunchParameterValidationRejectsUnsafeValues(t *testing.T) {
	definitions := map[string]parameterDefinition{
		"startUrl": {Type: "url", AllowedSchemes: []string{"http", "https", "about"}},
		"private":  {Type: "boolean"},
	}
	tests := []map[string]any{
		{"unknown": "value"},
		{"startUrl": "javascript:alert(1)"},
		{"startUrl": "file:///etc/passwd"},
		{"startUrl": "about:config"},
		{"startUrl": "https:///missing-host"},
		{"startUrl": "https://example.com\n--new-window"},
		{"private": "true"},
	}
	for _, supplied := range tests {
		if resolved, err := resolveLaunchParameters(definitions, supplied, nil); err == nil {
			t.Errorf("parameters %#v unexpectedly resolved to %#v", supplied, resolved)
		}
	}
}

func TestFileLaunchParameter(t *testing.T) {
	definitions := map[string]parameterDefinition{"filePath": {Type: "file", Required: true}}
	root := t.TempDir()
	document := filepath.Join(root, "example.odt")
	if err := os.WriteFile(document, []byte("test document"), 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "document-link.odt")
	if err := os.Symlink(document, link); err != nil {
		t.Fatal(err)
	}
	resolved, err := resolveLaunchParameters(definitions, map[string]any{"filePath": link}, []string{root})
	if err != nil {
		t.Fatal(err)
	}
	if resolved["filePath"] != document {
		t.Fatalf("resolved filePath = %q, want canonical path %q", resolved["filePath"], document)
	}

	outside := filepath.Join(t.TempDir(), "outside.odt")
	if err := os.WriteFile(outside, []byte("outside"), 0o600); err != nil {
		t.Fatal(err)
	}
	escape := filepath.Join(root, "escape.odt")
	if err := os.Symlink(outside, escape); err != nil {
		t.Fatal(err)
	}
	for _, value := range []any{nil, "relative.odt", outside, escape, root, filepath.Join(root, "missing.odt")} {
		parameters := map[string]any{}
		if value != nil {
			parameters["filePath"] = value
		}
		if got, err := resolveLaunchParameters(definitions, parameters, []string{root}); err == nil {
			t.Errorf("filePath %#v unexpectedly resolved to %#v", value, got)
		}
	}
}

func TestResolveDocumentRoots(t *testing.T) {
	stateDir := filepath.Join(t.TempDir(), "state")
	roots, err := resolveDocumentRoots("", stateDir)
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(stateDir, "documents")
	if len(roots) != 1 || roots[0] != want {
		t.Fatalf("default document roots = %#v, want %q", roots, want)
	}
	info, err := os.Stat(want)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o700 {
		t.Fatalf("default document root mode = %#o, want 0700", info.Mode().Perm())
	}

	configured := t.TempDir()
	roots, err = resolveDocumentRoots(configured+string(filepath.ListSeparator)+configured, stateDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(roots) != 1 || roots[0] != configured {
		t.Fatalf("deduplicated document roots = %#v, want %q", roots, configured)
	}
	if _, err := resolveDocumentRoots("relative", stateDir); err == nil {
		t.Fatal("relative document root was accepted")
	}
}

func TestAllocateLibreOfficeControlPort(t *testing.T) {
	m := &manager{instances: map[string]*instance{}}
	control := controlClassConfig{Protocol: "loopback-tcp"}
	first, err := m.allocateControlPort(control)
	if err != nil {
		t.Fatal(err)
	}
	if first < 21000 || first > 21999 {
		t.Fatalf("allocated control port = %d, want 21000..21999", first)
	}
	m.instances["existing"] = &instance{ID: "existing", State: "server-ready", ControlPort: first}
	second, err := m.allocateControlPort(control)
	if err != nil {
		t.Fatal(err)
	}
	if second == first {
		t.Fatalf("allocated duplicate control port %d", second)
	}
	if _, err := m.allocateControlPort(controlClassConfig{Protocol: "loopback-tcp", Port: first}); err == nil {
		t.Fatal("configured busy control port was accepted")
	}
	if port, err := m.allocateControlPort(controlClassConfig{}); err != nil || port != 0 {
		t.Fatalf("class without control protocol allocated port %d: %v", port, err)
	}
}

func TestLaunchParameterFileModeAndContents(t *testing.T) {
	runtime := t.TempDir()
	path, err := writeLaunchParameters(runtime, map[string]any{"startUrl": "https://example.com", "incognito": true})
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("parameter file mode=%#o, want 0600", info.Mode().Perm())
	}
	var values map[string]any
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(payload, &values); err != nil {
		t.Fatal(err)
	}
	if values["startUrl"] != "https://example.com" || values["incognito"] != true {
		t.Errorf("parameter file = %#v", values)
	}
}

func TestRFBWebSocketAttachDetection(t *testing.T) {
	request := httptest.NewRequest("GET", "/rfb-compat", nil)
	request.Header.Set("Upgrade", "websocket")
	if !isRFBWebSocket("rfb-compat", request) {
		t.Error("RFB WebSocket was not recognized as an attach")
	}
	if isRFBWebSocket("input", request) {
		t.Error("control WebSocket must not count as an RFB attach")
	}
	request.Header.Del("Upgrade")
	if isRFBWebSocket("rfb-compat", request) {
		t.Error("ordinary HTTP request must not count as an attach")
	}
}

func TestManagerHandlerServesCatalogAndSDK(t *testing.T) {
	class := classConfig{
		APIVersion: appPackageAPIVersion, ID: "test-app", Name: "Test App", ProfileRef: "default",
		Input: inputClassConfig{Lifecycle: "session"}, Ports: map[string]portClassConfig{"automation": {Kind: "loopback-tcp"}},
		Control: controlClassConfig{Protocol: "legacy-control", Address: "127.0.0.1", Port: 21000},
	}
	m := &manager{
		cfg:       config{classes: map[string]classConfig{class.ID: class}},
		instances: map[string]*instance{}, idleTimers: map[string]*time.Timer{},
	}
	handler := m.handler()

	for _, path := range []string{"/api/classes", "/sdk/index.js", "/"} {
		request := httptest.NewRequest(http.MethodGet, path, nil)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusOK {
			t.Errorf("GET %s status = %d, want 200", path, response.Code)
		}
	}
	catalog := httptest.NewRecorder()
	handler.ServeHTTP(catalog, httptest.NewRequest(http.MethodGet, "/api/classes", nil))
	var classes []struct {
		APIVersion string `json:"apiVersion"`
		Input      struct {
			Lifecycle string `json:"lifecycle"`
		} `json:"input"`
		Ports map[string]portClassConfig `json:"ports"`
	}
	if err := json.Unmarshal(catalog.Body.Bytes(), &classes); err != nil {
		t.Fatal(err)
	}
	if len(classes) != 1 || classes[0].APIVersion != appPackageAPIVersion || classes[0].Input.Lifecycle != "session" || classes[0].Ports["automation"].Kind != "loopback-tcp" {
		t.Fatalf("catalog generic package contract = %#v", classes)
	}
	if strings.Contains(catalog.Body.String(), `"control"`) {
		t.Fatalf("major catalog API exposed legacy control config: %s", catalog.Body.String())
	}

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPut, "/api/classes", strings.NewReader("{}")))
	if response.Code != http.StatusMethodNotAllowed || response.Header().Get("Allow") != "GET" {
		t.Fatalf("PUT /api/classes = %d Allow=%q", response.Code, response.Header().Get("Allow"))
	}
}

func TestBundledWebAssetCachePolicy(t *testing.T) {
	m := &manager{cfg: config{classes: map[string]classConfig{}}, instances: map[string]*instance{}, idleTimers: map[string]*time.Timer{}}
	handler := m.handler()

	loader := httptest.NewRecorder()
	handler.ServeHTTP(loader, httptest.NewRequest(http.MethodGet, "/sdk/index.js", nil))
	if loader.Code != http.StatusOK || !strings.Contains(loader.Body.String(), "../assets/"+builtAssetManifest.SDK) {
		t.Fatalf("SDK loader = %d %q", loader.Code, loader.Body.String())
	}
	if loader.Header().Get("Cache-Control") != "no-cache" || loader.Header().Get("ETag") == "" {
		t.Errorf("SDK loader cache headers = %q ETag=%q", loader.Header().Get("Cache-Control"), loader.Header().Get("ETag"))
	}
	consoleLoader := httptest.NewRecorder()
	handler.ServeHTTP(consoleLoader, httptest.NewRequest(http.MethodGet, "/console/index.js", nil))
	if consoleLoader.Code != http.StatusOK || !strings.Contains(consoleLoader.Body.String(), "../assets/"+builtAssetManifest.Console) || consoleLoader.Header().Get("Cache-Control") != "no-cache" {
		t.Fatalf("console loader = %d %q", consoleLoader.Code, consoleLoader.Body.String())
	}

	for _, name := range []string{builtAssetManifest.SDK, builtAssetManifest.Console, builtAssetManifest.NoVNC} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/assets/"+name, nil))
		if response.Code != http.StatusOK || response.Body.Len() != len(builtAssetBytes[name]) {
			t.Errorf("asset %s = %d/%d bytes, want 200/%d", name, response.Code, response.Body.Len(), len(builtAssetBytes[name]))
		}
		if response.Header().Get("Cache-Control") != "public, max-age=31536000, immutable" || response.Header().Get("ETag") == "" {
			t.Errorf("asset %s cache headers = %q ETag=%q", name, response.Header().Get("Cache-Control"), response.Header().Get("ETag"))
		}
	}

	missing := httptest.NewRecorder()
	handler.ServeHTTP(missing, httptest.NewRequest(http.MethodGet, "/assets/not-in-manifest.js", nil))
	if missing.Code != http.StatusNotFound {
		t.Errorf("unknown asset status = %d, want 404", missing.Code)
	}
}

func TestBuiltInWebSurfacesCanBeDisabledIndependently(t *testing.T) {
	class := classConfig{ID: "test-app", Server: serverClassConfig{AllowClientResize: false}}
	item := &instance{ID: "test-123", ClassID: class.ID, State: "server-ready", ViewerURL: "/remotexapps/test-123/kiosk.html"}
	for _, test := range []struct {
		name           string
		disableConsole bool
		disableKiosk   bool
		rootStatus     int
		kioskStatus    int
	}{
		{"console only", true, false, http.StatusNotFound, http.StatusOK},
		{"kiosk only", false, true, http.StatusOK, http.StatusNotFound},
	} {
		t.Run(test.name, func(t *testing.T) {
			m := &manager{
				cfg: config{
					classes:        map[string]classConfig{class.ID: class},
					disableConsole: test.disableConsole, disableKiosk: test.disableKiosk,
				},
				instances: map[string]*instance{item.ID: item}, idleTimers: map[string]*time.Timer{},
			}
			for path, want := range map[string]int{
				"/":                                test.rootStatus,
				"/remotexapps/test-123/kiosk.html": test.kioskStatus,
			} {
				response := httptest.NewRecorder()
				m.handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
				if response.Code != want {
					t.Errorf("GET %s = %d, want %d", path, response.Code, want)
				}
			}
		})
	}
}

func TestCompatibilityPagesServeTheExactUnifiedConsoleShell(t *testing.T) {
	class := classConfig{ID: "test-app"}
	item := &instance{ID: "test-123", ClassID: class.ID, State: "server-ready"}
	m := &manager{cfg: config{classes: map[string]classConfig{class.ID: class}}, instances: map[string]*instance{item.ID: item}, idleTimers: map[string]*time.Timer{}}
	for _, path := range []string{"/", "/sdk/console.html", "/sdk/minimal.html", "/remotexapps/test-123/kiosk.html"} {
		response := httptest.NewRecorder()
		m.handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusOK || !bytes.Equal(response.Body.Bytes(), consoleHTML) {
			t.Errorf("GET %s did not serve the unified shell: %d", path, response.Code)
		}
	}
}

func TestDisabledBuiltInPagesKeepSDKAPIAndInstanceTransport(t *testing.T) {
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/healthz" {
			t.Errorf("gateway path = %q, want /healthz", r.URL.Path)
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}))
	defer gateway.Close()

	class := classConfig{ID: "test-app", Name: "Test App", Input: inputClassConfig{Lifecycle: "session"}}
	item := &instance{
		ID: "test-123", ClassID: class.ID, State: "server-ready",
		ViewerURL:   "/remotexapps/test-123/kiosk.html",
		GatewayAddr: strings.TrimPrefix(gateway.URL, "http://"),
	}
	m := &manager{
		cfg: config{
			classes:        map[string]classConfig{class.ID: class},
			disableConsole: true, disableKiosk: true, exposeInternals: true,
		},
		instances: map[string]*instance{item.ID: item}, idleTimers: map[string]*time.Timer{},
	}
	handler := m.handler()
	for _, path := range []string{"/", "/sdk/console.html", "/sdk/minimal.html", "/remotexapps/test-123/kiosk.html"} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusNotFound {
			t.Errorf("disabled GET %s = %d, want 404", path, response.Code)
		}
	}
	for _, path := range []string{"/sdk/index.js", "/sdk/index.d.ts", "/api/classes", "/remotexapps/test-123/healthz"} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusOK {
			t.Errorf("retained GET %s = %d, want 200", path, response.Code)
		}
	}

	instanceResponse := httptest.NewRecorder()
	handler.ServeHTTP(instanceResponse, httptest.NewRequest(http.MethodGet, "/api/instances/test-123", nil))
	var public instance
	if err := json.Unmarshal(instanceResponse.Body.Bytes(), &public); err != nil {
		t.Fatal(err)
	}
	if public.ViewerURL != "" {
		t.Errorf("disabled kiosk viewerUrl = %q, want omitted", public.ViewerURL)
	}
	attach := httptest.NewRecorder()
	handler.ServeHTTP(attach, httptest.NewRequest(http.MethodPost, "/api/instances/test-123/attach", nil))
	if attach.Code != http.StatusNotFound {
		t.Errorf("disabled kiosk attach = %d, want 404", attach.Code)
	}

	versionResponse := httptest.NewRecorder()
	handler.ServeHTTP(versionResponse, httptest.NewRequest(http.MethodGet, "/api/version", nil))
	var versionPayload struct {
		WebFeatures map[string]bool `json:"webFeatures"`
	}
	if err := json.Unmarshal(versionResponse.Body.Bytes(), &versionPayload); err != nil {
		t.Fatal(err)
	}
	if versionPayload.WebFeatures["console"] || versionPayload.WebFeatures["kiosk"] {
		t.Errorf("disabled web features = %#v", versionPayload.WebFeatures)
	}
}

func TestStripPrefixReverseProxyMountKeepsSDKAssetsAndUnifiedViewer(t *testing.T) {
	class := classConfig{ID: "test-app"}
	item := &instance{ID: "test-123", ClassID: class.ID, State: "server-ready"}
	m := &manager{
		cfg:       config{classes: map[string]classConfig{class.ID: class}},
		instances: map[string]*instance{item.ID: item}, idleTimers: map[string]*time.Timer{},
	}
	external := http.NewServeMux()
	external.Handle("/tools/remotexapp/", http.StripPrefix("/tools/remotexapp", m.handler()))

	loader := httptest.NewRecorder()
	external.ServeHTTP(loader, httptest.NewRequest(http.MethodGet, "/tools/remotexapp/sdk/index.js", nil))
	if loader.Code != http.StatusOK {
		t.Fatalf("prefixed SDK loader = %d", loader.Code)
	}
	moduleSpecifier := "../assets/" + builtAssetManifest.SDK
	if !strings.Contains(loader.Body.String(), moduleSpecifier) {
		t.Fatalf("prefixed SDK loader = %q", loader.Body.String())
	}
	loaderURL, err := url.Parse("https://example.test/tools/remotexapp/sdk/index.js")
	if err != nil {
		t.Fatal(err)
	}
	assetURL, err := loaderURL.Parse(moduleSpecifier)
	if err != nil {
		t.Fatal(err)
	}
	asset := httptest.NewRecorder()
	external.ServeHTTP(asset, httptest.NewRequest(http.MethodGet, assetURL.RequestURI(), nil))
	if asset.Code != http.StatusOK || asset.Body.Len() != len(builtAssetBytes[builtAssetManifest.SDK]) {
		t.Fatalf("prefixed SDK asset = %d/%d bytes", asset.Code, asset.Body.Len())
	}

	viewer := httptest.NewRecorder()
	external.ServeHTTP(viewer, httptest.NewRequest(http.MethodGet, "/tools/remotexapp/remotexapps/test-123/kiosk.html", nil))
	if viewer.Code != http.StatusOK || !strings.Contains(viewer.Body.String(), "/console/index.js") {
		t.Fatalf("prefixed unified viewer = %d %q", viewer.Code, viewer.Body.String())
	}
}

func TestInstanceViewerUsesOneUnifiedShellForEveryResizePolicy(t *testing.T) {
	for _, test := range []struct {
		allow bool
	}{{false}, {true}} {
		class := classConfig{ID: "test-app", Server: serverClassConfig{AllowClientResize: test.allow}}
		item := &instance{ID: "test-123", ClassID: class.ID, State: "server-ready"}
		m := &manager{
			cfg:       config{classes: map[string]classConfig{class.ID: class}},
			instances: map[string]*instance{item.ID: item}, idleTimers: map[string]*time.Timer{},
		}
		response := httptest.NewRecorder()
		m.handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/remotexapps/test-123/kiosk.html", nil))
		if response.Code != http.StatusOK {
			t.Fatalf("resize=%v status = %d", test.allow, response.Code)
		}
		if !strings.Contains(response.Body.String(), "/console/index.js") || response.Header().Get("Location") != "" {
			t.Errorf("resize=%v viewer did not use the unified shell", test.allow)
		}
	}
}

func TestInstanceListReturnsIndependentSnapshot(t *testing.T) {
	created := time.Now()
	m := &manager{cfg: config{}, instances: map[string]*instance{
		"one": {ID: "one", State: "ready", CreatedAt: created},
	}, idleTimers: map[string]*time.Timer{}}
	response := httptest.NewRecorder()
	m.handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/instances", nil))
	var items []instance
	if err := json.Unmarshal(response.Body.Bytes(), &items); err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].ID != "one" || items[0].State != "ready" {
		t.Fatalf("unexpected instances: %#v", items)
	}
}

func TestApplyOverridesCreatesDisposableDesktopPolicy(t *testing.T) {
	template := classConfig{
		ID: "neutral-desktop", RunMode: "shared", Singleton: true,
		Server:  serverClassConfig{DisplayMode: "fixed", Display: 2, RFBPort: 5902, GatewayPort: 39002, Geometry: "1280x720", FrameRate: 5},
		Session: sessionClassConfig{Services: "core-v1", Activation: "on-attach", VacantTimeout: "10s", VacantAction: "stop-session"},
	}
	singleton := false
	effective, timeout, workspace, err := applyOverrides(template, instanceOverrides{
		DisplayMode: "dynamic", WorkspaceMode: "ephemeral", SessionActivation: "on-attach",
		IdleTimeout: "60s", IdleAction: "stop-instance", Singleton: &singleton,
	})
	if err != nil {
		t.Fatal(err)
	}
	if effective.Server.Display != 0 || effective.Server.RFBPort != 0 || effective.Server.GatewayPort != 0 {
		t.Errorf("dynamic allocation retained fixed resources: %#v", effective.Server)
	}
	if effective.Singleton || effective.RunMode != "isolated" || workspace != "ephemeral" {
		t.Errorf("unexpected disposable policy: singleton=%v runMode=%q workspace=%q", effective.Singleton, effective.RunMode, workspace)
	}
	if effective.Session.VacantAction != "stop-instance" || timeout != time.Minute {
		t.Errorf("idle policy = %q/%s", effective.Session.VacantAction, timeout)
	}
	policy := resolvedPolicy(effective, timeout, workspace)
	if policy.Display.Mode != "dynamic" || policy.WorkspaceMode != "ephemeral" || policy.IdleTimeout != "1m0s" {
		t.Errorf("resolved policy = %#v", policy)
	}
}

func TestManagedRegistryHTTPPersistence(t *testing.T) {
	template, timeout := neutralAppTemplate()
	stateDir := t.TempDir()
	m := &manager{
		cfg:       config{stateDir: stateDir, classes: map[string]classConfig{template.ID: template}, vacantTimeouts: map[string]time.Duration{template.ID: timeout}},
		instances: map[string]*instance{}, idleTimers: map[string]*time.Timer{}, managed: map[string]*managedInstance{},
	}
	body := []byte(`{"id":"resident-pad","templateId":"fixture-app","desiredState":"stopped","profileRef":"resident","parameters":{"documentName":"resident notes"},"overrides":{"workspaceMode":"persistent","idleAction":"keep","displayMode":"fixed","display":12}}`)
	response := httptest.NewRecorder()
	m.handler().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/managed-instances", bytes.NewReader(body)))
	if response.Code != http.StatusCreated {
		t.Fatalf("register status=%d body=%s", response.Code, response.Body.String())
	}
	var registered managedInstance
	if err := json.Unmarshal(response.Body.Bytes(), &registered); err != nil {
		t.Fatal(err)
	}
	if registered.DesiredState != "stopped" || registered.ObservedState != "stopped" || registered.Runtime != nil {
		t.Fatalf("unexpected registration: %#v", registered)
	}
	if registered.Parameters["documentName"] != "resident notes" {
		t.Fatalf("registered parameters: %#v", registered.Parameters)
	}
	path := filepath.Join(stateDir, "managed-instances", "resident-pad.json")
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("registry mode=%#o, want 0600", info.Mode().Perm())
	}

	reloaded := &manager{
		cfg: m.cfg, instances: map[string]*instance{}, idleTimers: map[string]*time.Timer{}, managed: map[string]*managedInstance{},
	}
	if err := reloaded.loadManagedRegistry(); err != nil {
		t.Fatal(err)
	}
	if got := reloaded.getManaged("resident-pad"); got == nil || got.TemplateID != template.ID || got.Overrides.Display != 12 || got.Parameters["documentName"] != "resident notes" {
		t.Fatalf("reloaded registration: %#v", got)
	}

	response = httptest.NewRecorder()
	reloaded.handler().ServeHTTP(response, httptest.NewRequest(http.MethodDelete, "/api/managed-instances/resident-pad", nil))
	if response.Code != http.StatusNoContent {
		t.Fatalf("delete status=%d body=%s", response.Code, response.Body.String())
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Errorf("registry file remains after delete: %v", err)
	}
}

func TestRuntimeManifestOwnsAppliedDriverSnapshot(t *testing.T) {
	stateDir := t.TempDir()
	oldSpec, _ := neutralAppTemplate()
	oldSpec.APIVersion = ""
	oldSpec.Package = nil
	oldSpec.Ports = nil
	oldSpec.Driver = nil
	oldSpec.Overrides = nil
	oldSpec.Dependencies = nil
	oldSpec.DriverVersion = "1.2.0"
	oldSpec.RunMode = "shared"
	oldSpec.Session.ShutdownDriver = "/releases/1.2.0/shutdown"
	current := oldSpec
	current.DriverVersion = "1.3.0"
	current.Session.ShutdownDriver = "/releases/1.3.0/shutdown"
	blockedAt := time.Now().Add(-time.Minute)
	forceAt := time.Now().Add(time.Hour)
	runtimePath := filepath.Join(stateDir, "instances", "test-runtime")
	if err := os.MkdirAll(runtimePath, 0o700); err != nil {
		t.Fatal(err)
	}
	item := &managedInstance{
		ID: "pinned-desktop", TemplateID: oldSpec.ID, DesiredState: "running", ObservedState: "running",
		ProfileRef: oldSpec.ProfileRef, RuntimeInstanceID: "test-runtime", CreatedAt: time.Now(), UpdatedAt: time.Now(),
		Runtime: &instance{
			ID: "test-runtime", TemplateID: oldSpec.ID, ClassID: oldSpec.ID, DriverVersion: oldSpec.DriverVersion,
			WorkspaceMode: "persistent", Runtime: runtimePath, SocketRuntime: filepath.Join("/run/user", strconv.Itoa(os.Getuid()), "remotexappd", "test-runtime"), Spec: oldSpec,
			Components: runtimeComponents{GatewayBinary: "/releases/1.2.0/gateway", StatusBinary: "/releases/1.2.0/status", UnicodeEngine: "/releases/1.2.0/engine"},
			VNCUnit:    "remotexapp-test-runtime-vnc.service", GatewayUnit: "remotexapp-test-runtime-gateway.service", SessionUnit: "remotexapp-test-runtime-session.service",
			SessionGeneration: 6, Shutdown: &shutdownStatus{
				RequestID: "shutdown-persisted", Generation: 7, Reason: "idle-timeout", Scope: "session",
				State: "blocked", RequestedAt: blockedAt, BlockedAt: &blockedAt, ForceAt: &forceAt,
			},
		},
	}
	if err := os.WriteFile(filepath.Join(item.Runtime.Runtime, oldSpec.Session.ReadinessPID), []byte(strconv.Itoa(os.Getpid())+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	statusPayload, err := json.Marshal(applicationStatus{Generation: 7, Revision: 1, State: "ready", UpdatedAt: time.Now()})
	if err != nil {
		t.Fatal(err)
	}
	if err := writePrivateAtomic(statusPath(item.Runtime.Runtime), append(statusPayload, '\n')); err != nil {
		t.Fatal(err)
	}
	m := &manager{
		cfg: config{
			stateDir: stateDir, classes: map[string]classConfig{current.ID: current},
			gatewayBinary: "/releases/1.3.0/gateway", statusBinary: "/releases/1.3.0/status", engine: "/releases/1.3.0/engine",
		},
		instances: map[string]*instance{}, idleTimers: map[string]*time.Timer{}, managed: map[string]*managedInstance{},
	}
	if err := m.persistManaged(item); err != nil {
		t.Fatal(err)
	}
	if err := m.persistRuntime(item.Runtime); err != nil {
		t.Fatal(err)
	}
	if err := m.loadManagedRegistry(); err != nil {
		t.Fatal(err)
	}
	records, err := m.loadRuntimeManifests()
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 {
		t.Fatalf("runtime manifests = %d, want 1", len(records))
	}
	got := &records[0].Runtime
	if got.Spec.DriverVersion != "1.2.0" || got.DriverVersion != "1.2.0" {
		t.Fatalf("runtime was not pinned to old driver: %#v", got)
	}
	if got.Spec.Session.ShutdownDriver != "/releases/1.2.0/shutdown" {
		t.Fatalf("shutdown driver was not pinned: %q", got.Spec.Session.ShutdownDriver)
	}
	if got.Components.GatewayBinary != "/releases/1.2.0/gateway" || got.Components.UnicodeEngine != "/releases/1.2.0/engine" {
		t.Fatalf("runtime components were not pinned: %#v", got.Components)
	}
	if got.SessionGeneration != 6 {
		t.Fatalf("session generation = %d, want persisted generation 6", got.SessionGeneration)
	}
	if got.Shutdown == nil || got.Shutdown.RequestID != "shutdown-persisted" {
		t.Fatalf("blocked shutdown was not stored: %#v", got.Shutdown)
	}
	registry, err := os.ReadFile(filepath.Join(stateDir, "managed-instances", item.ID+".json"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(registry, []byte(`"runtime"`)) || !bytes.Contains(registry, []byte(`"appliedSpec"`)) || !bytes.Contains(registry, []byte(`"appliedComponents"`)) {
		t.Fatalf("managed registry omits rc.15 rollback projection: %s", registry)
	}
}

func TestManagedRegistryRejectsUnpinnedLegacyRuntime(t *testing.T) {
	template, timeout := neutralAppTemplate()
	m := &manager{
		cfg: config{
			stateDir: t.TempDir(), classes: map[string]classConfig{template.ID: template},
			vacantTimeouts: map[string]time.Duration{template.ID: timeout},
		},
		instances: map[string]*instance{}, idleTimers: map[string]*time.Timer{}, managed: map[string]*managedInstance{},
	}
	legacy := &managedInstance{
		ID: "legacy-running", TemplateID: template.ID, DesiredState: "running", ObservedState: "running",
		ProfileRef: template.ProfileRef, RuntimeInstanceID: "legacy-runtime", Runtime: &instance{ID: "legacy-runtime"},
		CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	record := managedRegistryRecord{managedInstance: *legacy}
	payload, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(m.managedDir(), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(m.managedDir(), legacy.ID+".json"), payload, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := m.loadManagedRegistry(); err == nil || !strings.Contains(err.Error(), "no immutable driver snapshot") {
		t.Fatalf("legacy runtime load error = %v", err)
	}
}

func TestManagedRegistryRejectsDriverOwnedServices(t *testing.T) {
	template, timeout := neutralAppTemplate()
	m := &manager{cfg: config{stateDir: t.TempDir(), classes: map[string]classConfig{template.ID: template}, vacantTimeouts: map[string]time.Duration{template.ID: timeout}}, managed: map[string]*managedInstance{}}
	template.Session.Services = ""
	item := &managedInstance{ID: "old-services", TemplateID: template.ID, DesiredState: "stopped", ProfileRef: template.ProfileRef, AppliedSpec: template, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	if err := m.persistManaged(item); err != nil {
		t.Fatal(err)
	}
	if err := m.loadManagedRegistry(); err == nil || !strings.Contains(err.Error(), "old session services contract") {
		t.Fatalf("old internal launch snapshot was accepted: %v", err)
	}
}

func TestStoppedManagedRegistrationSuppressesAnonymousAutostart(t *testing.T) {
	m := &manager{managed: map[string]*managedInstance{
		"desktop": {ID: "desktop", TemplateID: "fixture-desktop", DesiredState: "stopped"},
	}}
	if !m.managedTemplateRegistered("fixture-desktop") {
		t.Fatal("stopped managed registration did not reserve its auto template")
	}
	if m.managedTemplateRegistered("fixture-app") {
		t.Fatal("unrelated template was reported as registered")
	}
}

func TestManagedReconcilePersistsTransitionButNotSteadyState(t *testing.T) {
	stateDir := t.TempDir()
	item := &managedInstance{
		ID: "steady-registration", TemplateID: "fixture-app", DesiredState: "stopped",
		ObservedState: "starting", CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	m := &manager{
		cfg: config{stateDir: stateDir}, instances: map[string]*instance{},
		idleTimers: map[string]*time.Timer{}, managed: map[string]*managedInstance{item.ID: item},
	}
	if err := m.persistManaged(item); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(stateDir, "managed-instances", item.ID+".json")
	beforeTransition, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := m.reconcileManagedLocked(item.ID); err != nil {
		t.Fatal(err)
	}
	afterTransition, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if os.SameFile(beforeTransition, afterTransition) || item.ObservedState != "stopped" {
		t.Fatalf("state transition was not persisted: before=%v after=%v item=%#v", beforeTransition, afterTransition, item)
	}
	if err := m.reconcileManagedLocked(item.ID); err != nil {
		t.Fatal(err)
	}
	afterSteady, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if !os.SameFile(afterTransition, afterSteady) || !afterTransition.ModTime().Equal(afterSteady.ModTime()) {
		t.Fatalf("steady reconciliation rewrote registry: transition=%v steady=%v", afterTransition, afterSteady)
	}
}

func TestForcedManagedRuntimeConvergesToDesiredStopped(t *testing.T) {
	stateDir := t.TempDir()
	runtime := &instance{
		ID: "forced-runtime", ManagedID: "forced-registration", State: "stopped", SessionState: "stopped",
		Shutdown: &shutdownStatus{RequestID: "shutdown-forced", State: "forced", Forced: true},
	}
	item := &managedInstance{
		ID: "forced-registration", TemplateID: "fixture-app", DesiredState: "stopped", ObservedState: "shutdown-blocked",
		RuntimeInstanceID: runtime.ID, Runtime: runtime, Error: "shutdown was blocked", CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	m := &manager{
		cfg: config{stateDir: stateDir}, instances: map[string]*instance{runtime.ID: runtime},
		idleTimers: map[string]*time.Timer{}, managed: map[string]*managedInstance{item.ID: item},
	}
	if err := m.persistManaged(item); err != nil {
		t.Fatal(err)
	}
	if err := m.reconcileManagedLocked(item.ID, stopOptions{Reason: "host-force", Scope: "instance", Force: true}); err != nil {
		t.Fatal(err)
	}
	if item.ObservedState != "stopped" || item.Runtime != nil || item.RuntimeInstanceID != "" || item.Error != "" {
		t.Fatalf("forced managed runtime did not converge: %#v", item)
	}
}

func TestManagedBlockedShutdownCanBeExplicitlyForced(t *testing.T) {
	stateDir := t.TempDir()
	binDir := t.TempDir()
	systemctlLog := filepath.Join(t.TempDir(), "systemctl.log")
	systemctl := filepath.Join(binDir, "systemctl")
	if err := os.WriteFile(systemctl, []byte("#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$REMOTEXAPP_TEST_SYSTEMCTL_LOG\"\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDir+":"+os.Getenv("PATH"))
	t.Setenv("REMOTEXAPP_TEST_SYSTEMCTL_LOG", systemctlLog)

	runtimeID := "forced-runtime"
	runtimeDir := filepath.Join(stateDir, "instances", runtimeID)
	if err := os.MkdirAll(runtimeDir, 0o700); err != nil {
		t.Fatal(err)
	}
	socketName := runtimeID
	if len(socketName) > 12 {
		socketName = socketName[len(socketName)-12:]
	}
	spec := classConfig{
		ID: "fixture-app",
		Session: sessionClassConfig{Services: "core-v1",
			ReadinessPID:  "application.pid",
			VacantTimeout: "1m",
		},
	}
	runtime := &instance{
		ID: runtimeID, ManagedID: "forced-registration", TemplateID: spec.ID, ClassID: spec.ID,
		State: "server-ready", SessionState: "shutdown-blocked", SessionGeneration: 3, RuntimeDesired: "running",
		Runtime: runtimeDir, SocketRuntime: filepath.Join("/run/user", strconv.Itoa(os.Getuid()), "remotexappd", socketName),
		Home: filepath.Join(stateDir, "profiles", "default"), ViewerURL: "/remotexapps/" + runtimeID + "/kiosk.html",
		VNCUnit: "remotexapp-" + runtimeID + "-vnc.service", GatewayUnit: "remotexapp-" + runtimeID + "-gateway.service",
		ServerUnit: "remotexapp-" + runtimeID + "-server.service", SessionUnit: "remotexapp-" + runtimeID + "-session.service",
		Spec: spec, Components: runtimeComponents{GatewayBinary: "/release/novnc-input", UnicodeEngine: "/release/remote-unicode-engine"},
		Shutdown: &shutdownStatus{
			RequestID: "shutdown-blocked", Generation: 3, Reason: "managed-desired-stopped", Scope: "instance", State: "blocked",
			RequestedAt: time.Now(),
		},
	}
	item := &managedInstance{
		ID: runtime.ManagedID, TemplateID: runtime.TemplateID, DesiredState: "running", ObservedState: "shutdown-blocked",
		RuntimeInstanceID: runtime.ID, Runtime: runtime, Error: "save decision required", CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	m := &manager{
		cfg:       config{stateDir: stateDir, classes: map[string]classConfig{spec.ID: spec}},
		instances: map[string]*instance{runtime.ID: runtime}, idleTimers: map[string]*time.Timer{},
		managed: map[string]*managedInstance{item.ID: item},
	}
	if err := m.persistRuntime(runtime); err != nil {
		t.Fatal(err)
	}
	if err := m.persistManaged(item); err != nil {
		t.Fatal(err)
	}

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPatch, "/api/managed-instances/"+item.ID, strings.NewReader(`{"desiredState":"stopped"}`))
	m.handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("non-forced stop status=%d body=%s", response.Code, response.Body.String())
	}
	if got := m.getManaged(item.ID); got == nil || got.ObservedState != "shutdown-blocked" || got.Runtime == nil {
		t.Fatalf("non-forced stop did not preserve blocked runtime: %#v", got)
	}
	if _, err := os.Stat(systemctlLog); !os.IsNotExist(err) {
		t.Fatalf("non-forced blocked reconciliation invoked systemctl: %v", err)
	}
	records, err := m.loadRuntimeManifests()
	if err != nil {
		t.Fatal(err)
	}
	reloadedItem := cloneManaged(m.getManaged(item.ID))
	reloaded := &manager{
		cfg: m.cfg, instances: map[string]*instance{}, idleTimers: map[string]*time.Timer{},
		managed: map[string]*managedInstance{reloadedItem.ID: reloadedItem}, sessionObserver: acceptingSessionObserver{},
		runtimeAdoptionCheck: func(*instance) error { return nil },
	}
	reloaded.restoreRuntimeManifests(records)
	if err := reloaded.linkManagedRuntimes(); err != nil {
		t.Fatal(err)
	}
	reloaded.reconcileManaged()
	if got := reloaded.getManaged(item.ID); got == nil || got.ObservedState != "shutdown-blocked" || got.Runtime == nil {
		t.Fatalf("manager restart did not preserve blocked runtime: %#v", got)
	}
	m = reloaded

	response = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodPatch, "/api/managed-instances/"+item.ID, strings.NewReader(`{"desiredState":"stopped","force":true}`))
	m.handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("forced stop status=%d body=%s", response.Code, response.Body.String())
	}
	got := m.getManaged(item.ID)
	if got == nil || got.DesiredState != "stopped" || got.ObservedState != "stopped" || got.Runtime != nil || got.RuntimeInstanceID != "" || got.Error != "" {
		t.Fatalf("forced blocked runtime did not converge: %#v", got)
	}
	if _, err := os.Stat(runtimeDir); !os.IsNotExist(err) {
		t.Fatalf("forced runtime directory remains: %v", err)
	}
	if _, err := os.Stat(filepath.Join(stateDir, "runtime-manifests", runtimeID+".json")); !os.IsNotExist(err) {
		t.Fatalf("forced runtime manifest remains: %v", err)
	}
	payload, err := os.ReadFile(systemctlLog)
	if err != nil {
		t.Fatal(err)
	}
	for _, unit := range []string{runtime.SessionUnit, runtime.GatewayUnit, runtime.ServerUnit, runtime.VNCUnit} {
		if !bytes.Contains(payload, []byte("stop "+unit)) {
			t.Errorf("forced stop did not invoke systemctl for %s: %s", unit, payload)
		}
	}
}

func TestBlockedShutdownConvergesWhenApplicationLaterExits(t *testing.T) {
	stateDir := t.TempDir()
	binDir := t.TempDir()
	systemctlLog := filepath.Join(t.TempDir(), "systemctl.log")
	systemctl := filepath.Join(binDir, "systemctl")
	if err := os.WriteFile(systemctl, []byte("#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$REMOTEXAPP_TEST_SYSTEMCTL_LOG\"\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDir+":"+os.Getenv("PATH"))
	t.Setenv("REMOTEXAPP_TEST_SYSTEMCTL_LOG", systemctlLog)

	runtimeDir := filepath.Join(stateDir, "instances", "blocked-runtime")
	socketDir := filepath.Join(t.TempDir(), "sockets")
	if err := os.MkdirAll(runtimeDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(socketDir, 0o700); err != nil {
		t.Fatal(err)
	}
	spec := classConfig{
		ID: "synthetic-app", RunMode: "isolated",
		Session: sessionClassConfig{Services: "core-v1",
			ReadinessPID: "application.pid", VacantTimeout: "1m", VacantAction: "stop-session",
			Status: statusClassConfig{Mode: "driver", Details: map[string]parameterDefinition{}},
		},
	}
	item := &instance{
		ID: "blocked-runtime", ClassID: spec.ID, TemplateID: spec.ID, DriverVersion: "1.0.0",
		State: "server-ready", SessionState: "shutdown-blocked", SessionGeneration: 2, RuntimeDesired: "running",
		Runtime: runtimeDir, SocketRuntime: socketDir, SessionUnit: "remotexapp-blocked-runtime-session.service",
		Spec: spec, Components: runtimeComponents{GatewayBinary: "/release/gateway", UnicodeEngine: "/release/engine"},
		Shutdown: &shutdownStatus{
			RequestID: "shutdown-later-exit", Generation: 2, Reason: "idle-timeout", Scope: "session", State: "blocked", RequestedAt: time.Now(),
		},
	}
	status := applicationStatus{Generation: 2, Revision: 3, State: "exited", UpdatedAt: time.Now(), Summary: "Application exited"}
	payload, err := json.Marshal(status)
	if err != nil {
		t.Fatal(err)
	}
	if err := writePrivateAtomic(statusPath(runtimeDir), payload); err != nil {
		t.Fatal(err)
	}
	m := &manager{
		cfg:       config{stateDir: stateDir, classes: map[string]classConfig{spec.ID: spec}},
		instances: map[string]*instance{item.ID: item}, idleTimers: map[string]*time.Timer{},
	}

	m.handleSessionExit(item.ID, item.SessionGeneration, "readiness process exited")
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		got := m.get(item.ID)
		if got != nil && got.SessionState == "stopped" && got.Shutdown != nil && got.Shutdown.State == "completed" && !got.Shutdown.Forced {
			if content, err := os.ReadFile(systemctlLog); err != nil || !bytes.Contains(content, []byte("stop "+item.SessionUnit)) {
				t.Fatalf("session unit was not stopped after delayed exit: %q err=%v", content, err)
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("blocked shutdown did not converge after application exit: %#v", m.get(item.ID))
}

func TestAdoptManagedRuntimeDoesNotOverwriteLiveSessionState(t *testing.T) {
	stale := &instance{ID: "resident-pad-runtime", SessionState: "stopped", AttachedClients: 0}
	live := &instance{ID: stale.ID, SessionState: "running", AttachedClients: 1}
	m := &manager{instances: map[string]*instance{stale.ID: live}}

	m.adoptManagedRuntime(stale)
	got := m.instances[stale.ID]
	if got != live || got.SessionState != "running" || got.AttachedClients != 1 {
		t.Fatalf("live runtime was overwritten by durable snapshot: %#v", got)
	}

	delete(m.instances, stale.ID)
	m.adoptManagedRuntime(stale)
	got = m.instances[stale.ID]
	if got == stale || got.SessionState != "stopped" {
		t.Fatalf("runtime was not safely adopted from snapshot: %#v", got)
	}
}

func TestStaleSessionEventDoesNotChangeNewGeneration(t *testing.T) {
	item := &instance{ID: "runtime-a", SessionGeneration: 8, SessionState: "running"}
	m := &manager{instances: map[string]*instance{item.ID: item}}

	m.handleSessionExit(item.ID, 7, "stale session unit exited")
	if item.SessionState != "running" {
		t.Fatalf("stale generation changed live session state to %q", item.SessionState)
	}
}

func TestDriverReportedCleanExitStopsSession(t *testing.T) {
	runtime := t.TempDir()
	sockets := t.TempDir()
	binDir := t.TempDir()
	systemctlLog := filepath.Join(t.TempDir(), "systemctl.log")
	if err := os.WriteFile(filepath.Join(binDir, "systemctl"), []byte("#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$REMOTEXAPP_TEST_SYSTEMCTL_LOG\"\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDir+":"+os.Getenv("PATH"))
	t.Setenv("REMOTEXAPP_TEST_SYSTEMCTL_LOG", systemctlLog)
	class := classConfig{ID: "test-desktop", Session: sessionClassConfig{Services: "core-v1", Status: statusClassConfig{Mode: "driver"}}}
	item := &instance{
		ID: "runtime-clean-exit", ClassID: class.ID, Spec: class, Runtime: runtime, SocketRuntime: sockets,
		SessionUnit: "remotexapp-runtime-clean-exit-session.service",
		State:       "server-ready", SessionState: "running", SessionGeneration: 3,
	}
	m := &manager{cfg: config{classes: map[string]classConfig{class.ID: class}}, instances: map[string]*instance{item.ID: item}}
	for _, path := range []string{filepath.Join(runtime, "session-dbus.pid"), filepath.Join(sockets, "ibus.sock")} {
		if err := os.WriteFile(path, []byte("stale"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := m.writeApplicationStatus(item, item.SessionGeneration, "exited", "Desktop session logged out", "", false); err != nil {
		t.Fatal(err)
	}

	m.handleSessionExit(item.ID, item.SessionGeneration, "session unit exited")

	if item.SessionState != "stopped" || item.Error != "" {
		t.Fatalf("clean driver exit became state=%q error=%q, want stopped with no error", item.SessionState, item.Error)
	}
	if content, err := os.ReadFile(systemctlLog); err != nil || !bytes.Contains(content, []byte("stop "+item.SessionUnit)) {
		t.Fatalf("clean exit did not retire the session component: %q err=%v", content, err)
	}
	for _, path := range []string{filepath.Join(runtime, "session-dbus.pid"), filepath.Join(sockets, "ibus.sock")} {
		if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("clean exit retained stale session file %s: %v", path, err)
		}
	}
	status, err := readApplicationStatus(runtime)
	if err != nil || status.State != "exited" {
		t.Fatalf("clean exit status was overwritten: %#v err=%v", status, err)
	}
}

func TestUnreportedSessionExitStillFails(t *testing.T) {
	runtime := t.TempDir()
	binDir := t.TempDir()
	systemctlLog := filepath.Join(t.TempDir(), "systemctl.log")
	if err := os.WriteFile(filepath.Join(binDir, "systemctl"), []byte("#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$REMOTEXAPP_TEST_SYSTEMCTL_LOG\"\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDir+":"+os.Getenv("PATH"))
	t.Setenv("REMOTEXAPP_TEST_SYSTEMCTL_LOG", systemctlLog)
	class := classConfig{ID: "test-desktop", Session: sessionClassConfig{Services: "core-v1", Status: statusClassConfig{Mode: "driver"}}}
	item := &instance{
		ID: "runtime-crash", ClassID: class.ID, Spec: class, Runtime: runtime,
		SessionUnit: "remotexapp-runtime-crash-session.service",
		State:       "server-ready", SessionState: "running", SessionGeneration: 4,
	}
	m := &manager{cfg: config{classes: map[string]classConfig{class.ID: class}}, instances: map[string]*instance{item.ID: item}}
	if err := m.writeApplicationStatus(item, item.SessionGeneration, "ready", "Desktop is ready", "", false); err != nil {
		t.Fatal(err)
	}

	m.handleSessionExit(item.ID, item.SessionGeneration, "session unit exited")

	if item.SessionState != "failed" || item.Error == "" {
		t.Fatalf("unreported exit became state=%q error=%q, want failed with an error", item.SessionState, item.Error)
	}
	if content, err := os.ReadFile(systemctlLog); err != nil || !bytes.Contains(content, []byte("stop "+item.SessionUnit)) {
		t.Fatalf("failed session exit did not retire the component: %q err=%v", content, err)
	}
}

func TestCleanSessionExitDoesNotPublishStoppedBeforeComponentCleanup(t *testing.T) {
	binDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(binDir, "systemctl"), []byte("#!/bin/sh\nexit 1\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDir+":"+os.Getenv("PATH"))
	runtime := t.TempDir()
	class := classConfig{ID: "test-desktop", Session: sessionClassConfig{Services: "core-v1", Status: statusClassConfig{Mode: "driver"}}}
	item := &instance{
		ID: "runtime-cleanup-failure", ClassID: class.ID, Spec: class, Runtime: runtime,
		SessionUnit: "remotexapp-runtime-cleanup-failure-session.service",
		State:       "server-ready", SessionState: "running", SessionGeneration: 5,
	}
	m := &manager{cfg: config{classes: map[string]classConfig{class.ID: class}}, instances: map[string]*instance{item.ID: item}}
	if err := m.writeApplicationStatus(item, item.SessionGeneration, "exited", "Application exited", "", false); err != nil {
		t.Fatal(err)
	}
	m.handleSessionExit(item.ID, item.SessionGeneration, "session unit exited")
	if item.SessionState != "failed" || item.Error == "" {
		t.Fatalf("failed component cleanup published clean exit: state=%q error=%q", item.SessionState, item.Error)
	}
	status, err := readApplicationStatus(runtime)
	if err != nil || status.State != "exited" {
		t.Fatalf("cleanup failure overwrote App exit status: %#v err=%v", status, err)
	}
}

func TestManagedRegistryRejectsUnsafePolicy(t *testing.T) {
	template, timeout := neutralAppTemplate()
	m := &manager{
		cfg:       config{stateDir: t.TempDir(), classes: map[string]classConfig{template.ID: template}, vacantTimeouts: map[string]time.Duration{template.ID: timeout}},
		instances: map[string]*instance{}, idleTimers: map[string]*time.Timer{}, managed: map[string]*managedInstance{},
	}
	for _, body := range []string{
		`{"id":"bad","templateId":"fixture-app","desiredState":"stopped","overrides":{"workspaceMode":"ephemeral","idleAction":"keep"}}`,
		`{"id":"bad","templateId":"fixture-app","desiredState":"stopped","overrides":{"workspaceMode":"persistent","idleAction":"stop-instance"}}`,
		`{"id":"bad","templateId":"fixture-app","unknown":true}`,
	} {
		response := httptest.NewRecorder()
		m.handler().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/managed-instances", strings.NewReader(body)))
		if response.Code < 400 {
			t.Errorf("unsafe request accepted: %s", body)
		}
	}
}

func FuzzBoundedJSONParameter(f *testing.F) {
	f.Add([]byte(`null`))
	f.Add([]byte(`{"nested":[1,true,"value"]}`))
	f.Add([]byte(`{"invalid":`))
	f.Fuzz(func(t *testing.T, data []byte) {
		if len(data) > 1<<20 {
			t.Skip()
		}
		var value any
		decoder := json.NewDecoder(bytes.NewReader(data))
		decoder.UseNumber()
		if err := decoder.Decode(&value); err != nil {
			return
		}
		if err := validateBoundedJSON(value, 1024, 8, 64); err != nil {
			return
		}
		encoded, err := json.Marshal(value)
		if err != nil {
			t.Fatalf("accepted value cannot be encoded: %v", err)
		}
		if len(encoded) > 1024 {
			t.Fatalf("accepted JSON has %d encoded bytes", len(encoded))
		}
	})
}
