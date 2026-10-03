package main

import (
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

func TestIBusConnectionIdentityAndFailures(t *testing.T) {
	m, item, _ := connectionFixture(t)
	item.SocketRuntime = t.TempDir()
	listener, err := net.Listen("unix", filepath.Join(item.SocketRuntime, "ibus.sock"))
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		for {
			c, e := listener.Accept()
			if e != nil {
				return
			}
			c.Close()
		}
	}()
	pid := os.Getpid()
	proc := filepath.Join(m.canonicalProcRoot(), strconv.Itoa(pid))
	os.Mkdir(proc, 0700)
	for _, name := range []string{"stat", "cgroup"} {
		data, _ := os.ReadFile(filepath.Join(m.canonicalProcRoot(), "4242", name))
		os.WriteFile(filepath.Join(proc, name), data, 0600)
	}
	valid := map[string]any{"generation": float64(3), "enabled": true, "address": "unix:path=" + filepath.Join(item.SocketRuntime, "ibus.sock"), "scope": "runtime", "pid": float64(pid), "startTime": "123456"}
	for _, mode := range []string{"isolated", "user-home"} {
		item.Spec.RunMode = mode
		bus, reason, e := m.ibusConnection(item, valid)
		if e != nil || reason != "" || bus.Scope != "runtime" {
			t.Fatalf("%s: %v %s %v", mode, bus, reason, e)
		}
	}
	for _, field := range []string{"generation", "scope", "address", "pid", "startTime", "extra"} {
		t.Run(field, func(t *testing.T) {
			bad := map[string]any{}
			for k, v := range valid {
				bad[k] = v
			}
			switch field {
			case "generation":
				bad[field] = 4
			case "pid":
				bad[field] = 4242
			default:
				bad[field] = "invalid"
			}
			if _, _, e := m.ibusConnection(item, bad); e == nil {
				t.Fatal("invalid identity accepted")
			}
		})
	}
	if _, reason, e := m.ibusConnection(item, nil); e != nil || reason != "metadata-missing" {
		t.Fatal(reason, e)
	}
	if _, reason, e := m.ibusConnection(item, map[string]any{"generation": 3, "enabled": false}); e != nil || reason != "not-enabled" {
		t.Fatal(reason, e)
	}
	// Additive private metadata projects only address/scope, never daemon PID/starttime.
	path := filepath.Join(item.Runtime, "connection-status.json")
	data, _ := os.ReadFile(path)
	var status applicationStatus
	json.Unmarshal(data, &status)
	status.Details["ibus"] = valid
	data, _ = json.Marshal(status)
	os.WriteFile(path, data, 0600)
	item.Spec.RunMode = "isolated"
	got, e := m.connections(item)
	if e != nil || got.Environment.IBus == nil {
		t.Fatal(got, e)
	}
	listener.Close()
	if _, reason, e := m.ibusConnection(item, valid); e != nil || reason != "not-running" {
		t.Fatal(reason, e)
	}
	os.Symlink(filepath.Join(item.SocketRuntime, "elsewhere"), filepath.Join(item.SocketRuntime, "ibus.sock"))
	if _, _, e := m.ibusConnection(item, valid); e == nil {
		t.Fatal("symlink accepted")
	}
}
