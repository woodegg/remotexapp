package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestStandaloneServerLossImmediatelyReconcilesManaged(t *testing.T) {
	installSystemctlStub(t, true)
	stateDir := t.TempDir()
	old := testRuntimeManifest(t, stateDir, "fixture-serverloss123", "resident-pad")
	old.State, old.SessionState, old.RuntimeDesired = "stopped", "stopped", "stopped"
	managed := &managedInstance{
		ID: "resident-pad", TemplateID: old.TemplateID, DesiredState: "running", ObservedState: "running",
		ProfileRef: old.ProfileRef, RuntimeInstanceID: old.ID, Runtime: old,
		AppliedSpec: old.Spec, AppliedComponents: old.Components, CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	m := &manager{
		cfg: config{stateDir: stateDir}, instances: map[string]*instance{old.ID: old},
		managed: map[string]*managedInstance{managed.ID: managed}, idleTimers: map[string]*time.Timer{},
	}
	created := 0
	m.runtimeRecoveryCreate = func(request createRequest) (*instance, error) {
		created++
		if request.RuntimeID != old.ID || request.ManagedID != managed.ID {
			t.Fatalf("managed recovery lost its locked identity: %#v", request)
		}
		recovered := *old
		recovered.State, recovered.SessionState, recovered.RuntimeDesired = "server-ready", "stopped", "running"
		m.storeRuntime(&recovered)
		return &recovered, nil
	}
	if err := m.reconcileManagedAfterStandaloneComponentLoss(old, nil); err != nil {
		t.Fatal(err)
	}
	if got := m.getManaged(managed.ID); created != 1 || got == nil || got.ObservedState != "running" || got.Runtime == nil || got.Runtime.State != "server-ready" {
		t.Fatalf("managed server fault was not reconciled immediately: created=%d managed=%#v", created, got)
	}
}

func TestStandaloneServerLossCleanupFailureIsVisibleToManaged(t *testing.T) {
	stateDir := t.TempDir()
	runtime := &instance{ID: "fixture-serverloss123", ManagedID: "resident-pad"}
	managed := &managedInstance{ID: runtime.ManagedID, RuntimeInstanceID: runtime.ID, DesiredState: "running", ObservedState: "running"}
	m := &manager{cfg: config{stateDir: stateDir}, managed: map[string]*managedInstance{managed.ID: managed}}
	if err := m.reconcileManagedAfterStandaloneComponentLoss(runtime, errors.New("injected teardown failure")); err != nil {
		t.Fatal(err)
	}
	if got := m.getManaged(managed.ID); got == nil || got.ObservedState != "failed" || !strings.Contains(got.Error, "injected teardown failure") {
		t.Fatalf("failed component teardown remained falsely healthy: %#v", got)
	}
}

func TestParseComponentLaunch(t *testing.T) {
	args := []string{
		"--user", "--unit=remotexapp-example-gateway", "--collect",
		"--property=WorkingDirectory=/tmp", "--property=BindsTo=remotexapp-example-vnc.service",
		"--property=After=remotexapp-example-vnc.service", "--setenv=HOME=/tmp",
		"--", "/usr/bin/true", "--argument",
	}
	unit, directory, env, argv, err := parseComponentLaunch(args)
	if err != nil {
		t.Fatal(err)
	}
	if unit != "remotexapp-example-gateway.service" || directory != "/tmp" {
		t.Fatalf("unit=%q directory=%q", unit, directory)
	}
	if len(argv) != 2 || argv[0] != "/usr/bin/true" || argv[1] != "--argument" {
		t.Fatalf("argv=%v", argv)
	}
	if !strings.Contains(strings.Join(env, "\n"), "HOME=/tmp") {
		t.Fatalf("component HOME missing: %v", env)
	}
}

func TestStandaloneComponentLogsAreBounded(t *testing.T) {
	state := t.TempDir()
	logs := filepath.Join(state, "component-logs")
	if err := os.Mkdir(logs, 0o700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(logs, "remotexapp-example-vnc.service.log")
	if err := os.WriteFile(path, []byte("test"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Truncate(path, standaloneComponentLogLimit+1); err != nil {
		t.Fatal(err)
	}
	m := &manager{cfg: config{stateDir: state}, standalone: &standaloneCgroupRoot{path: t.TempDir(), uid: os.Getuid()}}
	if err := m.limitStandaloneComponentLogs(); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil || info.Size() != 0 {
		t.Fatalf("log after bounded maintenance: info=%v err=%v", info, err)
	}
}

func TestParseComponentLaunchRejectsUnknownOption(t *testing.T) {
	for _, extra := range []string{"--property=PrivateNetwork=no", "--setenv=BAD VALUE=x", "--unit=not-valid"} {
		args := []string{"--user", "--unit=remotexapp-safe-vnc", extra, "--", "/usr/bin/true"}
		_, _, _, _, err := parseComponentLaunch(args)
		if err == nil {
			t.Fatalf("accepted %q", extra)
		}
	}
}

func TestStandaloneComponentPathRejectsTraversal(t *testing.T) {
	root := &standaloneCgroupRoot{path: filepath.Join(t.TempDir(), "delegate")}
	for _, name := range []string{"", "../remotexapp-foo.service", "remotexapp-foo.service/../x", "remotexapp-foo.socket", "remotexapp-FOO.service"} {
		if _, err := root.componentPath(name); err == nil {
			t.Fatalf("accepted unsafe component %q", name)
		}
	}
	path, err := root.componentPath("remotexapp-foo-vnc.service")
	if err != nil || path != filepath.Join(root.path, "remotexapp-foo-vnc.service") {
		t.Fatalf("safe component path %q: %v", path, err)
	}
}
