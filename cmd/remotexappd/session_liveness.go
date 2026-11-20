package main

import (
	"context"
	"errors"
	"log"
	"os"
	"path/filepath"
	"time"
)

type sessionLiveness uint8

const (
	sessionUncertain sessionLiveness = iota
	sessionAlive
	sessionExited
)

type sessionObservation struct {
	state    sessionLiveness
	pid      int
	identity canonicalProcessIdentity
	reason   string
}

// A negative unit query is not evidence that an App died. In particular,
// systemd/D-Bus availability is independent of a live canonical process.
// Callers that might retire resources must preserve sessionUncertain too;
// readiness/health callers require sessionAlive.
func (m *manager) observeRecordedSession(item *instance) sessionObservation {
	if m.runtimeSessionAliveCheck != nil {
		if m.runtimeSessionAliveCheck(item) {
			return sessionObservation{state: sessionAlive}
		}
		return sessionObservation{state: sessionExited}
	}
	if item == nil || (item.SessionState != "running" && item.SessionState != "shutdown-blocked") {
		return sessionObservation{state: sessionExited}
	}
	active, reason := m.observeSessionUnit(item.SessionUnit)
	observation := m.observeCanonicalSession(item, 0, canonicalProcessIdentity{})
	// A missing readiness marker alone is inconclusive. Only an empty/missing
	// component, corroborated by the unit query, permits the terminal path.
	if observation.state == sessionUncertain && observation.reason == "readiness-marker-unavailable" && !active && reason == "unit-inactive" && !m.sessionComponentPopulated(item.SessionUnit) {
		observation = sessionObservation{state: sessionExited, reason: "session-component-empty"}
	}
	if active || observation.state == sessionExited {
		reason = ""
	}
	m.reportSessionObservation(item, "unit", reason)
	m.reportSessionObservation(item, "process", observation.uncertainty())
	return observation
}

func (m *manager) observeSessionUnit(unit string) (bool, string) {
	if unit == "" {
		return false, "unit-unavailable"
	}
	if m.standalone != nil {
		if m.standaloneComponentActive(unit) {
			return true, ""
		}
		if populated, err := m.standalone.populated(unit); err == nil && !populated || errors.Is(err, os.ErrNotExist) {
			return false, "unit-inactive"
		}
		// A failed runit identity probe cannot prove component emptiness.
		return false, "unit-observation-unavailable"
	}
	_, err := runUserSystemd(3*time.Second, "systemctl", "--user", "is-active", "--quiet", unit)
	if err == nil {
		return true, ""
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return false, "unit-query-timeout"
	}
	var exit interface{ ExitCode() int }
	if errors.As(err, &exit) && (exit.ExitCode() == 3 || exit.ExitCode() == 4) {
		return false, "unit-inactive"
	}
	return false, "unit-query-failed"
}

func (o sessionObservation) uncertainty() string {
	if o.state == sessionUncertain {
		return o.reason
	}
	return ""
}

// Expected identity comes from the watcher installed for this generation.
// Re-reading a PID file must never silently adopt a recycled/different leader.
func (m *manager) observeCanonicalSession(item *instance, expectedPID int, expected canonicalProcessIdentity) sessionObservation {
	return m.observeSessionReadiness(item, filepath.Join(item.Runtime, m.specFor(item).Session.ReadinessPID), expectedPID, expected)
}

func (m *manager) observeSessionReadiness(item *instance, pidPath string, expectedPID int, expected canonicalProcessIdentity) sessionObservation {
	if expectedPID > 0 {
		observed := m.observeSessionProcess(item, expectedPID)
		if observed.state != sessionAlive {
			return observed
		}
		if observed.identity != expected {
			return sessionObservation{state: sessionExited, reason: "canonical-identity-changed"}
		}
	}
	pid, err := readCanonicalPID(pidPath)
	if err != nil {
		return sessionObservation{state: sessionUncertain, reason: "readiness-marker-unavailable"}
	}
	if expectedPID > 0 && pid != expectedPID {
		return sessionObservation{state: sessionUncertain, reason: "readiness-marker-changed"}
	}
	observed := m.observeSessionProcess(item, pid)
	if expectedPID > 0 && observed.state == sessionAlive && observed.identity != expected {
		return sessionObservation{state: sessionExited, reason: "canonical-identity-changed"}
	}
	return observed
}

func (m *manager) observeSessionProcess(item *instance, pid int) sessionObservation {
	identity, err := canonicalProcess(m.canonicalProcRoot(), pid)
	if errors.Is(err, os.ErrNotExist) || errors.Is(err, errCanonicalProcessExited) {
		return sessionObservation{state: sessionExited, reason: "canonical-process-exited"}
	}
	if err != nil {
		return sessionObservation{state: sessionUncertain, reason: "canonical-process-unreadable"}
	}
	if identity.UID == 0 || int(identity.UID) != os.Getuid() {
		return sessionObservation{state: sessionUncertain, reason: "canonical-owner-unverified"}
	}
	belongs, err := processBelongsToUnit(m.canonicalProcRoot(), pid, item.SessionUnit)
	if err != nil || !belongs || m.confirmStandaloneCgroupMembership(m.canonicalProcRoot(), pid, item.SessionUnit) != nil {
		return sessionObservation{state: sessionUncertain, reason: "canonical-cgroup-unverified"}
	}
	return sessionObservation{state: sessionAlive, pid: pid, identity: identity}
}

func (m *manager) recordedSessionMayBeAlive(item *instance) bool {
	return m.observeRecordedSession(item).state != sessionExited
}

// At most one log per changed reason/scope/generation, rather than one per
// 500 ms poll. Keep this ephemeral diagnostic out of persisted/public state.
func (m *manager) reportSessionObservation(item *instance, scope, reason string) {
	m.mu.Lock()
	live := m.instances[item.ID]
	if live == nil || live.SessionGeneration != item.SessionGeneration {
		m.mu.Unlock()
		return
	}
	if live.observationGeneration != item.SessionGeneration {
		live.observationGeneration = item.SessionGeneration
		live.unitObservationIssue, live.processObservationIssue = "", ""
	}
	field := &live.processObservationIssue
	if scope == "unit" {
		field = &live.unitObservationIssue
	}
	previous := *field
	*field = reason
	m.mu.Unlock()
	if previous == reason {
		return
	}
	if reason == "" {
		log.Printf("instance %s session observation restored scope=%s generation=%d", item.ID, scope, item.SessionGeneration)
	} else {
		log.Printf("instance %s session observation uncertain scope=%s reason=%s generation=%d; preserving application", item.ID, scope, reason, item.SessionGeneration)
	}
}
