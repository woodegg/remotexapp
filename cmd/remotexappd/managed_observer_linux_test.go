package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func writeTestCgroupEvents(t *testing.T, root string, uid int, unit, value string) string {
	t.Helper()
	path := cgroupEventPath(root, uid, unit)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("populated "+value+"\nfrozen 0\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestCgroupPopulated(t *testing.T) {
	path := writeTestCgroupEvents(t, t.TempDir(), 1234, "example.service", "1")
	populated, err := cgroupPopulated(path)
	if err != nil || !populated {
		t.Fatalf("populated=%v err=%v", populated, err)
	}
	if err := os.WriteFile(path, []byte("populated 0\nfrozen 0\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	populated, err = cgroupPopulated(path)
	if err != nil || populated {
		t.Fatalf("populated=%v err=%v", populated, err)
	}
}

func TestCgroupRuntimeObserverCloseWaitsForReader(t *testing.T) {
	observer, err := newCgroupRuntimeObserver(t.TempDir(), 1234, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := observer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := observer.Close(); err != nil {
		t.Fatalf("idempotent close: %v", err)
	}
	if err := observer.WatchSession("runtime-a", 1, "runtime-a-session.service"); err == nil {
		t.Fatal("watch succeeded after reader shutdown")
	}
}

func TestCgroupRuntimeObserverReportsEmptyUnit(t *testing.T) {
	root, uid := t.TempDir(), 1234
	runtime := &instance{
		ID: "runtime-a", VNCUnit: "runtime-a-vnc.service", GatewayUnit: "runtime-a-gateway.service",
	}
	vncPath := writeTestCgroupEvents(t, root, uid, runtime.VNCUnit, "1")
	writeTestCgroupEvents(t, root, uid, runtime.GatewayUnit, "1")
	events := make(chan managedRuntimeEvent, 1)
	observer, err := newCgroupRuntimeObserver(root, uid, func(event managedRuntimeEvent) { events <- event }, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer observer.Close()
	if err := observer.Watch("managed-a", runtime); err != nil {
		t.Fatal(err)
	}
	if err := observer.Watch("managed-a", runtime); err != nil {
		t.Fatalf("idempotent watch: %v", err)
	}
	if err := os.WriteFile(vncPath, []byte("populated 0\nfrozen 0\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	select {
	case event := <-events:
		if event.ManagedID != "managed-a" || event.RuntimeID != runtime.ID || event.Unit != runtime.VNCUnit {
			t.Fatalf("event=%#v", event)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("observer did not report empty cgroup")
	}
	observer.Unwatch(runtime.ID)
}

func TestCgroupRuntimeObserverReportsEmptySessionUnit(t *testing.T) {
	root, uid := t.TempDir(), 1234
	unit := "runtime-a-session.service"
	path := writeTestCgroupEvents(t, root, uid, unit, "1")
	events := make(chan sessionRuntimeEvent, 2)
	observer, err := newCgroupRuntimeObserver(root, uid, nil, func(event sessionRuntimeEvent) { events <- event })
	if err != nil {
		t.Fatal(err)
	}
	defer observer.Close()
	if err := observer.WatchSession("runtime-a", 7, unit); err != nil {
		t.Fatal(err)
	}
	if err := observer.WatchSession("runtime-a", 7, unit); err != nil {
		t.Fatalf("idempotent watch: %v", err)
	}
	if err := os.WriteFile(path, []byte("populated 0\nfrozen 0\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	select {
	case event := <-events:
		if event.InstanceID != "runtime-a" || event.Generation != 7 || event.Unit != unit {
			t.Fatalf("event=%#v", event)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("observer did not report empty session cgroup")
	}
	select {
	case event := <-events:
		t.Fatalf("observer reported duplicate event: %#v", event)
	case <-time.After(50 * time.Millisecond):
	}
	observer.UnwatchSession("runtime-a", 7)
}
