package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestDocumentRootsRetainUnavailableAllowlist(t *testing.T) {
	base := t.TempDir()
	missing, notDir, broken := filepath.Join(base, "offline"), filepath.Join(base, "file"), filepath.Join(base, "broken")
	if err := os.WriteFile(notDir, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(missing, broken); err != nil {
		t.Fatal(err)
	}
	for _, root := range []string{missing, notDir, broken} {
		roots, err := resolveDocumentRoots(root, base)
		if err != nil || len(roots) != 1 || roots[0] != root {
			t.Fatalf("root %q: %v %v", root, roots, err)
		}
		if _, err := resolveAvailableDocumentRoot(root); err == nil {
			t.Fatalf("unavailable root accepted: %q", root)
		}
	}
	for _, spec := range []string{"relative", base + ":", ":" + base, base + "::" + missing, base + "\x00", base + "\n"} {
		if _, err := resolveDocumentRoots(spec, base); err == nil {
			t.Fatalf("invalid configuration accepted: %q", spec)
		}
	}
}

func TestDocumentRootsRecoverWithoutRestartAndDoNotExpand(t *testing.T) {
	base := t.TempDir()
	root, other := filepath.Join(base, "disk"), filepath.Join(base, "other")
	roots, err := resolveDocumentRoots(root+":"+other, base)
	if err != nil {
		t.Fatal(err)
	}
	doc := filepath.Join(root, "document.txt")
	if _, err := resolveDocumentFile(doc, roots); err == nil {
		t.Fatal("missing file allowed")
	}
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(doc, []byte("local fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	for round := 0; round < 2; round++ {
		if got, err := resolveDocumentFile(doc, roots); err != nil || got != doc {
			t.Fatalf("recovered root: %q %v", got, err)
		}
		if err := os.Rename(root, root+"-offline"); err != nil {
			t.Fatal(err)
		}
		if _, err := resolveDocumentFile(doc, roots); err == nil {
			t.Fatal("offline file allowed")
		}
		if _, err := resolveDocumentFile(filepath.Join(root+"-offline", "document.txt"), roots); err == nil {
			t.Fatal("allowlist expanded to parent or sibling")
		}
		if err := os.Rename(root+"-offline", root); err != nil {
			t.Fatal(err)
		}
	}
	outside := filepath.Join(base, "outside.txt")
	if err := os.WriteFile(outside, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	escape := filepath.Join(root, "escape.txt")
	if err := os.Symlink(outside, escape); err != nil {
		t.Fatal(err)
	}
	if _, err := resolveDocumentFile(escape, roots); err == nil {
		t.Fatal("symlink escape allowed")
	}
	alias := filepath.Join(base, "alias")
	if err := os.Symlink(root, alias); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{doc, filepath.Join(alias, "document.txt")} {
		if got, err := resolveDocumentFile(path, []string{other, alias}); err != nil || got != doc {
			t.Fatalf("root alias: %q %v", got, err)
		}
	}
}

func TestDocumentRootDiagnosticsDoNotBlock(t *testing.T) {
	blocked, released := make(chan struct{}), make(chan struct{})
	defer close(blocked)
	logs := make(chan string, 10)
	reportDocumentRootAvailability([]string{"healthy", "missing", "permission", "disconnected", "stalled"}, 20*time.Millisecond,
		func(root string) error {
			switch root {
			case "healthy":
				return nil
			case "missing":
				return os.ErrNotExist
			case "permission":
				return os.ErrPermission
			case "disconnected":
				return syscall.ENOTCONN
			default:
				<-blocked
				close(released)
				return nil
			}
		}, func(format string, args ...any) { logs <- fmt.Sprintf(format, args...) })
	seen := map[string]bool{}
	for range 4 {
		select {
		case line := <-logs:
			if !strings.Contains(line, "ERROR") || !strings.Contains(line, "Manager continues") {
				t.Fatal(line)
			}
			seen[line] = true
		case <-time.After(5 * time.Second):
			t.Fatal("availability reporting blocked by a filesystem")
		}
	}
	if len(seen) != 4 {
		t.Fatal("missing independent root errors")
	}
	select {
	case <-released:
		t.Fatal("stalled fixture unexpectedly finished")
	default:
	}
}

func TestManagedDocumentOutageDoesNotPreventRegistryLoad(t *testing.T) {
	template, timeout := neutralAppTemplate()
	template.RunMode = "shared"
	template.Session.VacantAction = "keep"
	template.Parameters = map[string]parameterDefinition{"filePath": {Type: "file"}}
	root := filepath.Join(t.TempDir(), "offline")
	m := &manager{cfg: config{stateDir: t.TempDir(), classes: map[string]classConfig{template.ID: template}, vacantTimeouts: map[string]time.Duration{template.ID: timeout}, documentRoots: []string{root}}, managed: map[string]*managedInstance{}, instances: map[string]*instance{}, idleTimers: map[string]*time.Timer{}}
	item := &managedInstance{ID: "offline-document", TemplateID: template.ID, DesiredState: "stopped", ProfileRef: template.ProfileRef, Parameters: map[string]any{"filePath": filepath.Join(root, "notes.txt")}}
	if err := m.persistManaged(item); err != nil {
		t.Fatal(err)
	}
	if err := m.loadManagedRegistry(); err != nil {
		t.Fatalf("storage outage prevented registry loading: %v", err)
	}
	if got := m.managed[item.ID]; got == nil || got.Parameters["filePath"] != item.Parameters["filePath"] {
		t.Fatal("durable file parameter was lost")
	}
	if err := m.validateManaged(item); err == nil {
		t.Fatal("new registration bypassed file checks")
	}
	// The request fails before Driver execution or runtime allocation.
	payload, err := json.Marshal(map[string]any{"templateId": template.ID, "parameters": item.Parameters})
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRecorder()
	m.handler().ServeHTTP(r, httptest.NewRequest(http.MethodPost, "/api/instances", bytes.NewReader(payload)))
	if r.Code != http.StatusConflict || !strings.Contains(r.Body.String(), "filePath") || len(m.instances) != 0 {
		t.Fatalf("file request: %d %s", r.Code, r.Body.String())
	}
	item.Parameters["filePath"] = "relative.txt"
	if err := m.persistManaged(item); err != nil {
		t.Fatal(err)
	}
	if err := m.loadManagedRegistry(); err == nil || !strings.Contains(err.Error(), "absolute") {
		t.Fatalf("invalid persisted configuration not rejected: %v", err)
	}
	if _, err := os.Stat(root); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("unavailable explicit root was created or replaced")
	}
}
