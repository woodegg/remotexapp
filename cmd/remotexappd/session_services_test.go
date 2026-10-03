package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func sessionServicesFixture(t *testing.T) (*manager, *instance, sessionServicesRecord, func(sessionServicesRecord)) {
	t.Helper()
	m, item, _ := newEnvironmentFixture(t, nil)
	item.Spec.RunMode = "isolated"
	for pid := 4243; pid <= 4246; pid++ {
		root := filepath.Join(m.canonicalProcRoot(), strconv.Itoa(pid))
		if err := os.Mkdir(root, 0700); err != nil {
			t.Fatal(err)
		}
		for _, name := range []string{"stat", "cgroup", "environ"} {
			b, err := os.ReadFile(filepath.Join(m.canonicalProcRoot(), "4242", name))
			if err != nil {
				t.Fatal(err)
			}
			if name == "stat" {
				b = []byte(strings.Replace(string(b), "4242", strconv.Itoa(pid), 1))
			}
			if err := os.WriteFile(filepath.Join(root, name), b, 0600); err != nil {
				t.Fatal(err)
			}
		}
	}
	id := func(pid int) sessionServiceIdentity { return sessionServiceIdentity{pid, "123456"} }
	driver := id(4242)
	r := sessionServicesRecord{SchemaVersion: 1, Generation: 3, State: "ready", Supervisor: id(4243), Driver: &driver, Services: map[string]sessionServiceIdentity{"dbus": id(4244), "ibus": id(4245), "engine": id(4246)}, DeadlineMS: time.Now().Add(time.Second).UnixMilli()}
	write := func(r sessionServicesRecord) {
		t.Helper()
		b, err := json.Marshal(r)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(item.Runtime, "session-services.json"), b, 0600); err != nil {
			t.Fatal(err)
		}
	}
	write(r)
	return m, item, r, write
}

func TestSessionServicesAdoptionIdentity(t *testing.T) {
	for _, name := range []string{"ready", "generation", "supervisor-reuse", "driver-reuse", "wrong-unit", "missing-engine", "degraded", "borrowed-mode", "old-schema", "unknown-state", "unknown-service", "duplicate-process"} {
		t.Run(name, func(t *testing.T) {
			m, item, r, write := sessionServicesFixture(t)
			switch name {
			case "generation":
				r.Generation++
			case "supervisor-reuse":
				r.Supervisor.StartTime = "old"
			case "driver-reuse":
				r.Driver.StartTime = "old"
			case "wrong-unit":
				item.SessionUnit = "different-session.service"
			case "missing-engine":
				delete(r.Services, "engine")
			case "degraded":
				r.State = "degraded"
				r.Failure = "ibus-exited"
			case "borrowed-mode":
				r.BorrowedBus = true
			case "old-schema":
				r.SchemaVersion = 0
			case "unknown-state":
				r.State = "unrecognized"
			case "unknown-service":
				r.Services["other"] = sessionServiceIdentity{4247, "123456"}
			case "duplicate-process":
				r.Services["engine"] = r.Services["ibus"]
			}
			write(r)
			err := m.checkSessionServices(item)
			if (err == nil) != (name == "ready") {
				t.Fatalf("%s: %v", name, err)
			}
		})
	}
}

func TestSessionServicesRejectsUnsafeRecords(t *testing.T) {
	for _, name := range []string{"missing", "symlink", "world-readable", "oversized", "unknown-field", "trailing"} {
		t.Run(name, func(t *testing.T) {
			m, item, _, _ := sessionServicesFixture(t)
			path := filepath.Join(item.Runtime, "session-services.json")
			switch name {
			case "missing":
				_ = os.Remove(path)
			case "symlink":
				_ = os.Rename(path, path+".source")
				_ = os.Symlink(path+".source", path)
			case "world-readable":
				_ = os.Chmod(path, 0644)
			case "oversized":
				_ = os.WriteFile(path, []byte(strings.Repeat(" ", 16385)), 0600)
			case "unknown-field":
				b, _ := os.ReadFile(path)
				_ = os.WriteFile(path, []byte(strings.Replace(string(b), "{", "{\"unexpected\":true,", 1)), 0600)
			case "trailing":
				b, _ := os.ReadFile(path)
				_ = os.WriteFile(path, append(b, []byte(" {}")...), 0600)
			}
			if m.checkSessionServices(item) == nil {
				t.Fatal("unsafe record accepted")
			}
		})
	}
}

func TestSessionServicesPreservesStatusRevisions(t *testing.T) {
	m, item, r, write := sessionServicesFixture(t)
	before, _ := os.ReadFile(statusPath(item.Runtime))
	r.State = "degraded"
	r.Failure = "unicode-exited"
	write(r)
	if m.checkSessionServices(item) == nil {
		t.Fatal("missing degradation")
	}
	after, _ := os.ReadFile(statusPath(item.Runtime))
	if string(before) != string(after) {
		t.Fatal("service observation modified App revision")
	}
}

func TestResumeSessionStartupRejectsStaleDeadline(t *testing.T) {
	for _, name := range []string{"expired", "unbounded", "stale-generation"} {
		t.Run(name, func(t *testing.T) {
			m, item, r, write := sessionServicesFixture(t)
			item.SessionState = "starting"
			r.State = "starting"
			switch name {
			case "expired":
				r.DeadlineMS = time.Now().Add(-time.Second).UnixMilli()
			case "unbounded":
				r.DeadlineMS = time.Now().Add(time.Hour).UnixMilli()
			case "stale-generation":
				r.Generation++
			}
			write(r)
			if m.resumeSessionStartup(item) {
				t.Fatal("invalid transaction resumed")
			}
			if item.SessionState != "starting" {
				t.Fatal("failed resume changed state")
			}
		})
	}
}

func TestResumeCompletedSessionAfterOriginalDeadline(t *testing.T) {
	for _, state := range []string{"ready", "degraded"} {
		t.Run(state, func(t *testing.T) {
			m, item, r, write := sessionServicesFixture(t)
			item.SessionState = "starting"
			r.State = state
			r.DeadlineMS = time.Now().Add(-time.Hour).UnixMilli()
			write(r)
			if !m.resumeSessionStartup(item) || item.SessionState != "running" {
				t.Fatal("completed startup was not adopted after Manager downtime")
			}
		})
	}
}

func TestResumeSessionStartupDistinctCanonicalApp(t *testing.T) {
	for _, invalid := range []string{"", "foreign-cgroup", "supervisor", "service"} {
		t.Run("canonical-"+invalid, func(t *testing.T) {
			m, item, r, write := sessionServicesFixture(t)
			item.SessionState = "starting"
			// 4242 remains the App; use another valid member as the Driver.
			driver := r.Services["dbus"]
			r.Driver = &driver
			delete(r.Services, "dbus")
			r.DeadlineMS = time.Now().Add(-time.Second).UnixMilli()
			write(r)
			switch invalid {
			case "foreign-cgroup":
				if err := os.WriteFile(filepath.Join(m.canonicalProcRoot(), "4242", "cgroup"), []byte("0::/other.service\n"), 0600); err != nil {
					t.Fatal(err)
				}
			case "supervisor", "service":
				pid := r.Supervisor.PID
				if invalid == "service" {
					pid = r.Services["ibus"].PID
				}
				if err := os.WriteFile(filepath.Join(item.Runtime, item.Spec.Session.ReadinessPID), []byte(strconv.Itoa(pid)), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if got := m.resumeSessionStartup(item); got != (invalid == "") {
				t.Fatalf("adopted=%v", got)
			}
		})
	}
}

func TestUpgradeRestoresOriginalStartingSession(t *testing.T) {
	m, item, _, _ := sessionServicesFixture(t)
	item.SessionState = "starting"
	item.Upgrade = &runtimeUpgrade{Status: upgradeStatus{Phase: "launching"}, Target: item.Spec, Components: item.Components}
	m.runtimeAdoptionCheck = func(got *instance) error {
		if got.SessionState != "running" {
			t.Fatal("upgrade skipped bounded startup adoption")
		}
		return nil
	}
	m.sessionObserver = &recordingSessionObserver{}
	m.runtimeRecoveryCreate = func(createRequest) (*instance, error) { t.Fatal("new startup replaced"); return nil, nil }
	if !m.restoreUpgrade(&runtimeManifestRecord{DesiredState: "running", Runtime: *item}) {
		t.Fatal("upgrade not restored")
	}
	got := m.get(item.ID)
	if got.SessionState != "running" || got.SessionGeneration != 3 || got.Upgrade.Status.Phase != "completed" {
		t.Fatalf("restored=%+v", got)
	}
}
