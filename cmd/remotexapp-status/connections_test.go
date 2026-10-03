package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPrivateConnectionReport(t *testing.T) {
	for _, mode := range []string{"isolated", "shared", "user-home"} {
		t.Run(mode, func(t *testing.T) {
			directory := t.TempDir()
			path := filepath.Join(directory, "application-status.json")
			private := filepath.Join(directory, "connection-status.json")
			os.WriteFile(private, []byte(`{"generation":3,"revision":1,"state":"starting"}`), 0600)
			os.WriteFile(filepath.Join(directory, "connection-schema.json"), []byte(`{"sessionBus":{"type":"json","maxBytes":4096,"maxDepth":2,"maxItems":2},"application":{"type":"json","maxBytes":4096,"maxDepth":4,"maxItems":32}}`), 0600)
			t.Setenv("DBUS_SESSION_BUS_ADDRESS", "unix:path=/private/test/bus")
			t.Setenv("REMOTEXAPP_RUN_MODE", mode)
			if err := reportConnections(path, 3, "ready", `{"protocol":"dbus","service":"private"}`); err != nil {
				t.Fatal(err)
			}
			data, _ := os.ReadFile(private)
			var status applicationStatus
			if err := json.Unmarshal(data, &status); err != nil {
				t.Fatal(err)
			}
			scope := "runtime"
			if mode == "user-home" {
				scope = "user"
			}
			if status.Details["sessionBus"].(map[string]any)["scope"] != scope {
				t.Fatal(status)
			}
			if _, err := os.Stat(path); !os.IsNotExist(err) {
				t.Fatal("private report wrote public file")
			}
			if info, _ := os.Stat(private); info.Mode().Perm() != 0600 {
				t.Fatal("private file mode")
			}
			if err := reportConnections(path, 2, "ready", ""); err == nil {
				t.Fatal("stale report accepted")
			}
			if err := reportConnections(path, 3, "ready", `{"protocol":"`+strings.Repeat("a", 5000)+`"}`); err == nil {
				t.Fatal("oversize accepted")
			}
		})
	}
}
