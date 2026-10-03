package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func failedStartFixture(t *testing.T, managed bool) (*manager, *instance) {
	t.Helper()
	stateDir := t.TempDir()
	m := &manager{cfg: config{stateDir: stateDir, failedStartGrace: 300 * time.Millisecond},
		instances: map[string]*instance{}, idleTimers: map[string]*time.Timer{}}
	managedID := ""
	if managed {
		managedID = "managed-fixture"
	}
	item := testRuntimeManifest(t, stateDir, "edge-0123456789ab", managedID)
	item.Spec.Session.VacantAction = "stop-instance"
	item.SessionGeneration = 4
	m.instances[item.ID] = item
	return m, item
}

func TestFailedStartPersistsGenerationAndDeadline(t *testing.T) {
	m, item := failedStartFixture(t, false)
	m.recordSessionStartupFailure(item.ID, 4, errors.New("private launch detail"))
	if item.StartupFailure == nil || item.SessionState != "failed" || item.StartupFailure.Generation != 4 {
		t.Fatalf("missing failure state: %+v", item)
	}
	first := *item.StartupFailure
	m.recordSessionStartupFailure(item.ID, 4, errors.New("repeat"))
	if *item.StartupFailure != first {
		t.Fatal("duplicate failure extended the original deadline")
	}
	records, err := m.loadRuntimeManifests()
	if err != nil || len(records) != 1 {
		t.Fatalf("durable manifest: count=%d err=%v", len(records), err)
	}
	if records[0].Runtime.SessionState != "failed" || *records[0].Runtime.StartupFailure != first {
		t.Fatalf("failure not durable: %+v", records[0].Runtime.StartupFailure)
	}
	if strings.Contains(first.Summary, "private launch detail") {
		t.Fatal("private error leaked into bounded failure summary")
	}
}

func TestFailedStartDeadlineDoesNotRenewAndCleansRuntime(t *testing.T) {
	installSystemctlStub(t, true)
	m, item := failedStartFixture(t, false)
	id := item.ID
	m.recordSessionStartupFailure(id, 4, errors.New("CDP did not become ready"))
	first := m.scheduleVacancyLocked(id)
	time.Sleep(100 * time.Millisecond)
	second := m.scheduleVacancyLocked(id)
	if !second.Equal(first) {
		t.Fatalf("deadline renewed: %v -> %v", first, second)
	}
	deadline := time.Now().Add(3 * time.Second)
	recordPath := filepath.Join(m.cfg.stateDir, "startup-failures", id+".json")
	var info os.FileInfo
	var err error
	for time.Now().Before(deadline) {
		info, err = os.Stat(recordPath)
		if err == nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err != nil {
		t.Fatalf("expired failure not cleaned: %v", err)
	}
	if _, err := os.Stat(filepath.Join(m.runtimeManifestDir(), id+".json")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("active manifest remains: %v", err)
	}
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("private record: info=%v err=%v", info, err)
	}
	payload, err := os.ReadFile(recordPath)
	if err != nil || strings.Contains(string(payload), "CDP did not become ready") {
		t.Fatalf("record exposes private failure: %v %q", err, payload)
	}
	var record struct {
		Failure startupFailure `json:"failure"`
	}
	if err := json.Unmarshal(payload, &record); err != nil || !record.Failure.ExpiresAt.Equal(first) {
		t.Fatalf("record expiration mismatch: %+v %v", record, err)
	}
}

func TestFailedStartManagedRuntimeKeepsNormalPolicy(t *testing.T) {
	m, item := failedStartFixture(t, true)
	m.recordSessionStartupFailure(item.ID, 4, errors.New("driver error"))
	if item.StartupFailure != nil {
		t.Fatal("managed runtime received anonymous failure cleanup")
	}
	deadline := m.scheduleVacancyLocked(item.ID)
	if deadline.Before(time.Now().Add(4 * time.Second)) {
		t.Fatalf("managed timeout shortened: %v", deadline)
	}
	m.idleTimers[item.ID].Stop()
}

func TestFailedStartNewGenerationClearsFailure(t *testing.T) {
	m, item := failedStartFixture(t, false)
	m.recordSessionStartupFailure(item.ID, 4, errors.New("driver error"))
	_, generation, err := m.nextSessionGeneration(item.ID)
	if err != nil || generation != 5 || item.StartupFailure != nil {
		t.Fatalf("new generation did not clear failure: %d %v %+v", generation, err, item.StartupFailure)
	}
}

func TestFailedStartAdoptionPreservesDeadline(t *testing.T) {
	m, item := failedStartFixture(t, false)
	m.recordSessionStartupFailure(item.ID, 4, errors.New("driver error"))
	first := item.StartupFailure.ExpiresAt
	records, err := m.loadRuntimeManifests()
	if err != nil || len(records) != 1 {
		t.Fatalf("load failed runtime: count=%d err=%v", len(records), err)
	}
	restored := &records[0].Runtime
	m.instances = map[string]*instance{}
	m.idleTimers = map[string]*time.Timer{}
	m.adoptRuntimeManifest(restored)
	if m.idleTimers[item.ID] == nil {
		t.Fatal("failed session was not scheduled on adoption")
	}
	if restored.StartupFailure.ExpiresAt != first {
		t.Fatal("adoption changed the failure deadline")
	}
	m.idleTimers[item.ID].Stop()
}

func TestFailedStartTimerCannotStopRecoveredSession(t *testing.T) {
	m, item := failedStartFixture(t, false)
	m.recordSessionStartupFailure(item.ID, 4, errors.New("driver error"))
	expired := time.Now().Add(-time.Second)
	item.StartupFailure.ExpiresAt = expired
	item.SessionState = "running"
	timer := time.NewTimer(time.Hour)
	defer timer.Stop()
	m.idleTimers[item.ID] = timer
	m.stopVacant(item.ID, timer, item, 4, expired)
	if m.get(item.ID).State != "server-ready" {
		t.Fatal("stale failed-start timer stopped a recovered session")
	}
}
