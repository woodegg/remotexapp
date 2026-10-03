package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestViewerHookRunsOnlyOnFirstAttachAndLastDetach(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("viewer hooks cannot execute as root")
	}
	m, item := failedStartFixture(t, false)
	item.SessionState = "running"
	item.State = "server-ready"
	item.Spec.Session.VacantAction = "stop-instance"
	for _, phase := range []string{"attach", "detach"} {
		path := filepath.Join(t.TempDir(), phase+".sh")
		if err := os.WriteFile(path, []byte("#!/bin/sh\nprintf '%s %s\\n' '"+phase+"' \"$REMOTEXAPP_SESSION_GENERATION\" >> \"$REMOTEXAPP_RUNTIME/viewer-calls\"\n"), 0700); err != nil {
			t.Fatal(err)
		}
		if phase == "attach" {
			item.Spec.Session.ViewerAttachDriver = path
		} else {
			item.Spec.Session.ViewerDetachDriver = path
		}
	}
	if err := m.attachRFB(item.ID); err != nil {
		t.Fatal(err)
	}
	if err := m.attachRFB(item.ID); err != nil {
		t.Fatal(err)
	}
	m.detachRFB(item.ID)
	m.detachRFB(item.ID)
	data, err := os.ReadFile(filepath.Join(item.Runtime, "viewer-calls"))
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.TrimSpace(string(data)); got != "attach 4\ndetach 4" {
		t.Fatalf("viewer transitions: %q", got)
	}
}

func TestViewerAttachHookFailureDoesNotCountViewer(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("viewer hooks cannot execute as root")
	}
	m, item := failedStartFixture(t, false)
	item.SessionState = "running"
	item.State = "server-ready"
	path := filepath.Join(t.TempDir(), "fail.sh")
	if err := os.WriteFile(path, []byte("#!/bin/sh\nexit 7\n"), 0700); err != nil {
		t.Fatal(err)
	}
	item.Spec.Session.ViewerAttachDriver = path
	if err := m.attachRFB(item.ID); err == nil || item.AttachedClients != 0 {
		t.Fatalf("failed hook counted viewer: clients=%d err=%v", item.AttachedClients, err)
	}
}
