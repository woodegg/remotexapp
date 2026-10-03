package main

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

type sessionServiceIdentity struct {
	PID       int    `json:"pid"`
	StartTime string `json:"startTime"`
}
type sessionServicesRecord struct {
	SchemaVersion int                               `json:"schemaVersion"`
	DeadlineMS    int64                             `json:"deadlineMs"`
	Generation    int64                             `json:"generation"`
	State         string                            `json:"state"`
	Failure       string                            `json:"failure,omitempty"`
	Supervisor    sessionServiceIdentity            `json:"supervisor"`
	Driver        *sessionServiceIdentity           `json:"driver,omitempty"`
	Services      map[string]sessionServiceIdentity `json:"services"`
	BorrowedBus   bool                              `json:"borrowedBus"`
}

// Supervisor observations are private and independent of the App's public and
// connection status revisions. They are never authority to replace a live App.
func (m *manager) readSessionServices(item *instance) (*sessionServicesRecord, error) {
	fd, err := syscall.Open(filepath.Join(item.Runtime, "session-services.json"), syscall.O_RDONLY|syscall.O_CLOEXEC|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, errors.New("session services record unavailable")
	}
	f := os.NewFile(uintptr(fd), "session-services.json")
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Size() > 16384 {
		return nil, errors.New("invalid session services record")
	}
	if st, ok := info.Sys().(*syscall.Stat_t); !ok || st.Uid != uint32(os.Getuid()) {
		return nil, errors.New("invalid session services record owner")
	}
	var v sessionServicesRecord
	d := json.NewDecoder(io.LimitReader(f, 16385))
	d.DisallowUnknownFields()
	if d.Decode(&v) != nil || v.SchemaVersion != 1 || v.Generation != item.SessionGeneration || v.BorrowedBus != (item.Spec.RunMode == "user-home") {
		return nil, errors.New("invalid session services generation or contract")
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		return nil, errors.New("invalid session services trailing data")
	}
	switch v.State {
	case "starting", "ready", "degraded", "failed", "exited", "stopped":
	default:
		return nil, errors.New("invalid session services state")
	}
	seen := map[int]bool{v.Supervisor.PID: true}
	if v.Driver != nil {
		if seen[v.Driver.PID] {
			return nil, errors.New("duplicate session service identity")
		}
		seen[v.Driver.PID] = true
	}
	for name, id := range v.Services {
		if (name != "dbus" && name != "ibus" && name != "engine") || (name == "dbus" && v.BorrowedBus) || seen[id.PID] {
			return nil, errors.New("invalid session service ownership")
		}
		seen[id.PID] = true
	}
	if err := m.checkServiceIdentity(item, v.Supervisor); err != nil {
		return nil, err
	}
	return &v, nil
}

func (m *manager) checkServiceIdentity(item *instance, id sessionServiceIdentity) error {
	p, err := m.inspectCanonicalProcess(m.canonicalProcRoot(), id.PID, item.SessionUnit)
	if err != nil || p.StartTime != id.StartTime || id.StartTime == "" {
		return errors.New("stale session service process identity")
	}
	return nil
}

func (m *manager) checkSessionServices(item *instance) error {
	v, err := m.readSessionServices(item)
	if err != nil {
		return err
	}
	if v.Driver == nil || v.Driver.PID == v.Supervisor.PID {
		return errors.New("missing distinct Driver identity")
	}
	if err := m.checkServiceIdentity(item, *v.Driver); err != nil {
		return err
	}
	if v.State != "ready" || v.Failure != "" {
		return errors.New("session input services are degraded")
	}
	for _, name := range []string{"ibus", "engine", "dbus"} {
		if name == "dbus" && v.BorrowedBus {
			continue
		}
		if err := m.checkServiceIdentity(item, v.Services[name]); err != nil {
			return err
		}
	}
	return nil
}

// A restart during startup resumes the original bounded transaction. It never
// launches a second supervisor or resets the generation/deadline.
func (m *manager) resumeSessionStartup(item *instance) bool {
	v, err := m.readSessionServices(item)
	if err != nil {
		return false
	}
	ready := func(record *sessionServicesRecord) bool {
		status, err := readApplicationStatus(item.Runtime)
		if err != nil || status.Generation != item.SessionGeneration || status.State != "ready" || record.Driver == nil || m.checkServiceIdentity(item, *record.Driver) != nil {
			return false
		}
		pid, err := readCanonicalPID(filepath.Join(item.Runtime, item.Spec.Session.ReadinessPID))
		if err != nil || pid == record.Supervisor.PID {
			return false
		}
		for _, service := range record.Services {
			if pid == service.PID {
				return false
			}
		}
		// A Driver may wait for a distinct canonical App child (e.g. KDE).
		// Validate both identities in the session cgroup, not PID equality.
		_, err = m.inspectCanonicalProcess(m.canonicalProcRoot(), pid, item.SessionUnit)
		return err == nil
	}
	if (v.State == "ready" || v.State == "degraded") && ready(v) {
		item.SessionState = "running"
		return true
	}
	remaining := time.Until(time.UnixMilli(v.DeadlineMS))
	if remaining <= 0 || remaining > 5*time.Minute {
		return false
	}
	completed := false
	err = waitFor(remaining, func() bool {
		current, e := m.readSessionServices(item)
		if e != nil || current.Supervisor != v.Supervisor || current.DeadlineMS != v.DeadlineMS {
			return true // Original owner disappeared or changed; never adopt a replacement.
		}
		if current.State == "failed" || current.State == "exited" || current.State == "stopped" {
			return true
		}
		completed = (current.State == "ready" || current.State == "degraded") && ready(current)
		return completed
	})
	if err != nil || !completed {
		return false
	}
	item.SessionState = "running"
	return true
}
