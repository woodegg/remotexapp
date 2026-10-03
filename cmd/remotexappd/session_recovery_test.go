package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSessionRecoveryWindowBoundsReconnects(t *testing.T) {
	now := time.Now()
	var previous *sessionRecovery
	for attempt := 1; attempt <= 3; attempt++ {
		next, ok := nextSessionRecovery(previous, now.Add(time.Duration(attempt)*time.Second))
		if !ok || next.Attempts != attempt {
			t.Fatalf("attempt %d: next=%+v allowed=%t", attempt, next, ok)
		}
		previous = &next
	}
	if _, ok := nextSessionRecovery(previous, now.Add(9*time.Minute)); ok {
		t.Fatal("fourth browser reconnect bypassed recovery limit")
	}
	reset, ok := nextSessionRecovery(previous, now.Add(11*time.Minute))
	if !ok || reset.Attempts != 1 {
		t.Fatalf("window did not reset after expiry: %+v allowed=%t", reset, ok)
	}
	rollback, ok := nextSessionRecovery(previous, now.Add(-time.Minute))
	if !ok || rollback.Attempts != 1 {
		t.Fatalf("clock rollback did not start a new bounded window: %+v allowed=%t", rollback, ok)
	}
}

func TestSessionLeaderMonitorReportsExitWithoutWaitingForEmptyCgroup(t *testing.T) {
	id := "desktop-000000000001"
	m := &manager{sessionEvents: make(chan sessionRuntimeEvent, 1), instances: map[string]*instance{id: {ID: id, SessionGeneration: 7, SessionState: "running"}}}
	missingPID := filepath.Join(t.TempDir(), "missing.pid")
	done := make(chan struct{})
	go func() {
		m.monitorSession(id, 7, missingPID, 12345, canonicalProcessIdentity{StartTime: "1"})
		close(done)
	}()
	select {
	case event := <-m.sessionEvents:
		if event.InstanceID != "desktop-000000000001" || event.Generation != 7 || event.Reason != "readiness process exited" {
			t.Fatalf("unexpected leader exit event: %+v", event)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("session leader exit was not reported before the safety sweep")
	}
	<-done
}

func TestManagedUserHomeLeaderExitPreservesPopulatedSession(t *testing.T) {
	stateDir := t.TempDir()
	binDir := t.TempDir()
	unitLog := filepath.Join(t.TempDir(), "systemctl.log")
	script := "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$REMOTEXAPP_TEST_SYSTEMCTL_LOG\"\n"
	if err := os.WriteFile(filepath.Join(binDir, "systemctl"), []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDir+":"+os.Getenv("PATH"))
	t.Setenv("REMOTEXAPP_TEST_SYSTEMCTL_LOG", unitLog)
	runtimeDir := filepath.Join(stateDir, "instances", "desktop-000000000001")
	if err := os.MkdirAll(runtimeDir, 0o700); err != nil {
		t.Fatal(err)
	}
	spec := classConfig{
		ID: "xfce-user-desktop", RunMode: "user-home",
		Session: sessionClassConfig{ReadinessPID: "xfce.pid", VacantAction: "stop-session"},
	}
	item := &instance{
		ID: "desktop-000000000001", TemplateID: spec.ID, ClassID: spec.ID,
		ManagedID: "sandbox-desktop", Runtime: runtimeDir,
		SessionUnit: "remotexapp-desktop-000000000001-session.service",
		State:       "server-ready", SessionState: "running", SessionGeneration: 3,
		Spec: spec, RuntimeDesired: "running",
	}
	m := &manager{
		cfg:       config{stateDir: stateDir, classes: map[string]classConfig{spec.ID: spec}},
		instances: map[string]*instance{item.ID: item},
	}
	m.handleSessionExit(item.ID, 3, "readiness process exited")
	got := m.get(item.ID)
	if got.SessionState != "failed" || !strings.Contains(got.Error, "other processes remain") {
		t.Fatalf("populated user-home session was not safely blocked: %+v", got)
	}
	logBytes, err := os.ReadFile(unitLog)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(logBytes), "stop "+item.SessionUnit) {
		t.Fatalf("surviving user processes were stopped: %s", logBytes)
	}
}

func TestStandaloneFailedComponentDoesNotMaskSurvivingProcesses(t *testing.T) {
	root := t.TempDir()
	unit := "remotexapp-desktop-000000000001-session.service"
	path := filepath.Join(root, unit)
	if err := os.Mkdir(path, 0o700); err != nil {
		t.Fatal(err)
	}
	m := &manager{standalone: &standaloneCgroupRoot{path: root}}
	for _, test := range []struct {
		name, contents string
		want           bool
	}{
		{"populated", "populated 1\n", true},
		{"empty", "populated 0\n", false},
		{"unreadable", "bad data\n", true},
	} {
		if err := os.WriteFile(filepath.Join(path, "cgroup.events"), []byte(test.contents), 0o600); err != nil {
			t.Fatal(err)
		}
		if got := m.sessionComponentPopulated(unit); got != test.want {
			t.Fatalf("%s: populated=%t, want %t", test.name, got, test.want)
		}
	}
}
