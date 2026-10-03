package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestReportValidatesSchemaAndGeneration(t *testing.T) {
	directory := t.TempDir()
	schemaPath := filepath.Join(directory, "schema.json")
	statusPath := filepath.Join(directory, "status.json")
	if err := os.WriteFile(schemaPath, []byte(`{"application":{"type":"enum","values":["mousepad"]}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	initial := applicationStatus{Generation: 4, Revision: 1, State: "starting", UpdatedAt: time.Now()}
	payload, _ := json.Marshal(initial)
	if err := os.WriteFile(statusPath, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := report(statusPath, schemaPath, 4, "ready", "Mousepad is ready", "", []string{"application=mousepad"}, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	status, err := readStatus(statusPath)
	if err != nil {
		t.Fatal(err)
	}
	if status.State != "ready" || status.Revision != 2 || status.Details["application"] != "mousepad" || status.LastReadyAt == nil {
		t.Fatalf("unexpected status: %#v", status)
	}
	if err := report(statusPath, schemaPath, 3, "ready", "stale", "", []string{"application=mousepad"}, nil, nil, nil); err == nil {
		t.Error("stale generation was accepted")
	}
	if err := report(statusPath, schemaPath, 4, "ready", "bad detail", "", []string{"secret=value"}, nil, nil, nil); err == nil {
		t.Error("undeclared detail was accepted")
	}
}

func TestReportWritesPrivateFile(t *testing.T) {
	directory := t.TempDir()
	schemaPath := filepath.Join(directory, "schema.json")
	statusPath := filepath.Join(directory, "status.json")
	_ = os.WriteFile(schemaPath, []byte(`{}`), 0o600)
	initial := applicationStatus{Generation: 1, Revision: 1, State: "starting", UpdatedAt: time.Now()}
	payload, _ := json.Marshal(initial)
	_ = os.WriteFile(statusPath, payload, 0o666)
	if err := report(statusPath, schemaPath, 1, "loading", "Loading", "", nil, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(statusPath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("status mode=%#o, want 0600", info.Mode().Perm())
	}
}

func TestStatusHelperReadersRejectTrailingJSON(t *testing.T) {
	directory := t.TempDir()
	schemaPath := filepath.Join(directory, "schema.json")
	statusPath := filepath.Join(directory, "status.json")
	if err := os.WriteFile(schemaPath, []byte(`{} {}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := readSchema(schemaPath); err == nil {
		t.Fatal("trailing schema JSON was accepted")
	}
	if err := os.WriteFile(statusPath, []byte(`{"generation":1,"revision":1,"state":"starting","updatedAt":"2026-08-29T00:00:00Z"} {}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := readStatus(statusPath); err == nil {
		t.Fatal("trailing status JSON was accepted")
	}
}

func TestReportAcceptsOnlyBoundedJSONDetails(t *testing.T) {
	directory := t.TempDir()
	schemaPath := filepath.Join(directory, "schema.json")
	statusPath := filepath.Join(directory, "status.json")
	if err := os.WriteFile(schemaPath, []byte(`{"control":{"type":"json","maxBytes":128,"maxDepth":3,"maxItems":8}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	initial := applicationStatus{Generation: 2, Revision: 1, State: "starting", UpdatedAt: time.Now()}
	payload, _ := json.Marshal(initial)
	if err := os.WriteFile(statusPath, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := report(statusPath, schemaPath, 2, "ready", "Ready", "", nil, nil, nil, []string{`control={"protocol":"cdp","port":21001}`}); err != nil {
		t.Fatal(err)
	}
	status, err := readStatus(statusPath)
	if err != nil {
		t.Fatal(err)
	}
	control, ok := status.Details["control"].(map[string]any)
	if !ok || control["protocol"] != "cdp" {
		t.Fatalf("JSON status detail = %#v", status.Details)
	}
	if err := report(statusPath, schemaPath, 2, "ready", "deep", "", nil, nil, nil, []string{`control={"a":{"b":{"c":1}}}`}); err == nil {
		t.Fatal("over-depth JSON detail was accepted")
	}
	if err := report(statusPath, schemaPath, 2, "ready", "bad", "", nil, nil, nil, []string{`control={not-json}`}); err == nil {
		t.Fatal("malformed JSON detail was accepted")
	}
}
