package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

type applicationStatus struct {
	Generation  int64          `json:"generation"`
	Revision    int64          `json:"revision"`
	State       string         `json:"state"`
	UpdatedAt   time.Time      `json:"updatedAt"`
	LastReadyAt *time.Time     `json:"lastReadyAt,omitempty"`
	Summary     string         `json:"summary,omitempty"`
	Details     map[string]any `json:"details,omitempty"`
	Error       string         `json:"error,omitempty"`
}

func statusPath(runtime string) string       { return filepath.Join(runtime, "application-status.json") }
func statusSchemaPath(runtime string) string { return filepath.Join(runtime, "status-schema.json") }

func writeStatusSchema(runtime string, definitions map[string]parameterDefinition, private ...map[string]parameterDefinition) error {
	payload, err := json.MarshalIndent(definitions, "", "  ")
	if err != nil {
		return err
	}
	if err := writePrivateAtomic(statusSchemaPath(runtime), append(payload, '\n')); err != nil {
		return err
	}
	defs := connectionDefinitions(nil)
	if len(private) > 0 {
		defs = connectionDefinitions(private[0])
	}
	payload, err = json.Marshal(defs)
	if err != nil {
		return err
	}
	return writePrivateAtomic(filepath.Join(runtime, "connection-schema.json"), payload)
}

func readApplicationStatus(runtime string) (*applicationStatus, error) {
	return readStatusFile(statusPath(runtime))
}

func readStatusFile(path string) (*applicationStatus, error) {
	file, err := openPrivateRegular(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	if info, err := file.Stat(); err != nil {
		return nil, err
	} else if info.Size() > 64<<10 {
		return nil, errors.New("application status exceeds 65536 bytes")
	}
	var status applicationStatus
	decoder := json.NewDecoder(io.LimitReader(file, 64<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&status); err != nil {
		return nil, err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return nil, errors.New("application status must contain exactly one JSON object")
	}
	if status.Generation < 0 || status.Revision < 1 || !validApplicationState(status.State) {
		return nil, errors.New("invalid application status envelope")
	}
	return &status, nil
}

func validApplicationState(state string) bool {
	switch state {
	case "stopped", "starting", "loading", "ready", "error", "exited":
		return true
	default:
		return false
	}
}

func validateStatusDetails(definitions map[string]parameterDefinition, details map[string]any) error {
	for name, value := range details {
		definition, exists := definitions[name]
		if !exists {
			return fmt.Errorf("unknown status detail %q", name)
		}
		if _, err := validateParameterValue(name, definition, value); err != nil {
			return fmt.Errorf("status detail %q: %w", name, err)
		}
	}
	return nil
}

func writePrivateAtomic(path string, payload []byte) error {
	directory := filepath.Dir(path)
	temporary, err := os.CreateTemp(directory, ".status-*.tmp")
	if err != nil {
		return err
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return err
	}
	if _, err := temporary.Write(payload); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryName, path)
}

func (m *manager) writeApplicationStatus(item *instance, generation int64, state, summary, errorText string, preserve bool) error {
	if item == nil || m.specFor(item).Session.Status.Mode != "driver" {
		return nil
	}
	status := &applicationStatus{Generation: generation, Revision: 1, State: state, UpdatedAt: time.Now(), Summary: summary, Error: errorText}
	if previous, err := readApplicationStatus(item.Runtime); err == nil {
		status.Revision = previous.Revision + 1
		status.LastReadyAt = previous.LastReadyAt
		if preserve {
			status.Details = previous.Details
		}
	}
	if state == "ready" {
		now := status.UpdatedAt
		status.LastReadyAt = &now
	}
	payload, err := json.MarshalIndent(status, "", "  ")
	if err != nil {
		return err
	}
	if state == "starting" {
		if err := os.Remove(filepath.Join(item.Runtime, "session-ibus-identity.json")); err != nil && !os.IsNotExist(err) {
			return err
		}
		if err := writePrivateAtomic(filepath.Join(item.Runtime, "connection-status.json"), payload); err != nil {
			return err
		}
	}
	return writePrivateAtomic(statusPath(item.Runtime), append(payload, '\n'))
}

func (m *manager) refreshApplicationStatus(item *instance) {
	if item == nil || m.specFor(item).Session.Status.Mode != "driver" {
		return
	}
	status, err := readApplicationStatus(item.Runtime)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) && item.ApplicationStatus != nil && item.ApplicationStatus.Generation == item.SessionGeneration {
			return
		}
		// A persistent runtime may predate a newly enabled driver-status
		// contract. Until its first new session publishes a real generation,
		// expose its actual stopped lifecycle state instead of a false error.
		if errors.Is(err, os.ErrNotExist) && item.SessionState == "stopped" {
			item.ApplicationStatus = &applicationStatus{
				Generation: item.SessionGeneration, Revision: 1, State: "stopped",
				UpdatedAt: item.CreatedAt, Summary: "Application session is stopped",
			}
			return
		}
		item.ApplicationStatus = &applicationStatus{
			Generation: item.SessionGeneration, Revision: 1, State: "error", UpdatedAt: time.Now(),
			Summary: "Application status is unavailable", Error: err.Error(),
		}
		return
	}
	if err := validateStatusDetails(m.specFor(item).Session.Status.Details, status.Details); err != nil {
		status.State, status.Summary, status.Error = "error", "Application status is invalid", err.Error()
	}
	item.ApplicationStatus = status
}

func (m *manager) nextSessionGeneration(id string) (*instance, int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	item := m.instances[id]
	if item == nil {
		return nil, 0, errors.New("instance not found")
	}
	item.SessionGeneration++
	item.StartupFailure = nil
	copy := *item
	return &copy, item.SessionGeneration, nil
}
