package main

import (
	"encoding/json"
	"errors"
	"log"
	"os"
	"path/filepath"
	"sort"
	"time"
)

const startupFailureRecordLimit = 100
const startupFailureRecordAge = 7 * 24 * time.Hour

func (m *manager) markStartupFailure(item *instance, generation int64) {
	if item == nil || item.ManagedID != "" || item.StartupFailure != nil {
		return
	}
	grace := m.cfg.failedStartGrace
	if grace == 0 { // Focused in-memory tests construct a Manager without CLI defaults.
		grace = 2 * time.Minute
	}
	now := time.Now().UTC()
	item.StartupFailure = &startupFailure{
		Generation: generation, FailedAt: now, ExpiresAt: now.Add(grace),
		Summary: "Session startup did not reach readiness",
	}
}

func (m *manager) recordSessionStartupFailure(id string, generation int64, cause error) {
	m.mu.Lock()
	item := m.instances[id]
	if item == nil || item.SessionGeneration != generation {
		m.mu.Unlock()
		return
	}
	item.SessionState = "failed"
	if item.Error == "" {
		item.Error = cause.Error()
	}
	m.markStartupFailure(item, generation)
	copy := *item
	m.mu.Unlock()
	if err := m.persistRuntime(&copy); err != nil {
		log.Printf("runtime %s persist session startup failure: %v", id, err)
	}
}

// Retain only a private, bounded tombstone once the runtime and its potentially
// sensitive logs are removed. Manager startup does not restore these as runtimes.
func (m *manager) saveStartupFailureRecord(item *instance) error {
	if m.cfg.stateDir == "" || item == nil || item.StartupFailure == nil || !runtimeRef.MatchString(item.ID) {
		return nil
	}
	dir := filepath.Join(m.cfg.stateDir, "startup-failures")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	record := struct {
		InstanceID string         `json:"instanceId"`
		TemplateID string         `json:"templateId"`
		Failure    startupFailure `json:"failure"`
	}{item.ID, item.TemplateID, *item.StartupFailure}
	payload, err := json.Marshal(record)
	if err != nil {
		return err
	}
	if err := writePrivateAtomic(filepath.Join(dir, item.ID+".json"), append(payload, '\n')); err != nil {
		return err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	type entry struct {
		name  string
		mtime time.Time
	}
	var records []entry
	for _, candidate := range entries {
		if candidate.IsDir() || filepath.Ext(candidate.Name()) != ".json" {
			continue
		}
		info, err := candidate.Info()
		if err != nil {
			return err
		}
		records = append(records, entry{candidate.Name(), info.ModTime()})
	}
	sort.Slice(records, func(i, j int) bool { return records[i].mtime.After(records[j].mtime) })
	for i, candidate := range records {
		if i < startupFailureRecordLimit && time.Since(candidate.mtime) < startupFailureRecordAge {
			continue
		}
		if err := os.Remove(filepath.Join(dir, candidate.name)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return nil
}
