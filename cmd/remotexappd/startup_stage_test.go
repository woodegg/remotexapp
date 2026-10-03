package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/woodegg/remotexapp/internal/sessionstartup"
	"golang.org/x/mod/semver"
)

func TestReadinessTimeoutRetainsSafeCurrentStage(t *testing.T) {
	for _, test := range []struct {
		name, summary string
		generation    int64
		stage         bool
	}{
		{"current", sessionstartup.Summary("IBus readiness"), 3, true},
		{"stale", sessionstartup.Summary("IBus readiness"), 2, false},
		{"private", "unix:path=/private/bus", 3, false},
		{"spoofed", sessionstartup.Summary("IBus readiness") + " secret", 3, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			b, _ := json.Marshal(applicationStatus{Generation: test.generation, Revision: 1, State: "starting", Summary: test.summary, UpdatedAt: time.Now()})
			if err := os.WriteFile(filepath.Join(root, "application-status.json"), b, 0600); err != nil {
				t.Fatal(err)
			}
			failure, err := waitForSessionReadiness(filepath.Join(root, "absent.pid"), root, 3, true, 20*time.Millisecond)
			if test.stage {
				if err != nil || !strings.Contains(failure, "IBus readiness") {
					t.Fatalf("stage lost: %q %v", failure, err)
				}
			} else if err == nil || failure != "" {
				t.Fatalf("invalid stage accepted: %q %v", failure, err)
			}
		})
	}
}

func TestMousepadNormalPatchSupersedesBothInstalledVariants(t *testing.T) {
	for _, old := range []string{"v4.0.0", "v4.0.0-sandbox.ubuntu2604.1"} {
		if semver.Compare("v4.0.1", old) <= 0 {
			t.Fatalf("4.0.1 must upgrade %s", old)
		}
	}
}
