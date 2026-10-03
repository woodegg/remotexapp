package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestRecordIBusLaunchAndPrivateReport(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "application-status.json")
	t.Setenv("IBUS_ADDRESS", "unix:path=/example/ibus.sock")
	if e := recordIBus(path, 3, os.Getpid()); e != nil {
		t.Fatal(e)
	}
	identity, _ := os.ReadFile(filepath.Join(dir, "session-ibus-identity.json"))
	var value map[string]any
	json.Unmarshal(identity, &value)
	if value["pid"] != float64(os.Getpid()) || value["startTime"] == "" || value["scope"] != "runtime" {
		t.Fatal(value)
	}
	os.WriteFile(filepath.Join(dir, "connection-schema.json"), []byte(`{"ibus":{"type":"json","maxBytes":4096,"maxDepth":2,"maxItems":6}}`), 0600)
	t.Setenv("DBUS_SESSION_BUS_ADDRESS", "")
	os.WriteFile(filepath.Join(dir, "connection-status.json"), []byte(`{"generation":3,"revision":1,"state":"starting"}`), 0600)
	if e := reportConnections(path, 3, "ready", ""); e != nil {
		t.Fatal(e)
	}
	if e := reportConnections(path, 4, "ready", ""); e == nil {
		t.Fatal("old launch metadata accepted")
	}
	if _, e := os.Stat(path); !os.IsNotExist(e) {
		t.Fatal("public file written")
	}
	if e := recordIBus(path, 4, 0); e != nil {
		t.Fatal(e)
	}
	os.WriteFile(filepath.Join(dir, "connection-status.json"), []byte(`{"generation":4,"revision":1,"state":"starting"}`), 0600)
	if e := reportConnections(path, 4, "ready", ""); e != nil {
		t.Fatal(e)
	}
	for _, pid := range []int{-1, 99999999} {
		if e := recordIBus(path, 4, pid); e == nil {
			t.Fatal("bad PID accepted")
		}
	}
}
