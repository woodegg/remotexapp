package main

import (
	"net/http"
	"time"
)

type publicRecovery struct {
	Phase         managedRecoveryPhase `json:"phase"`
	Reason        string               `json:"reason"`
	Message       string               `json:"message"`
	Attempts      int                  `json:"attempts"`
	NextAttemptAt *time.Time           `json:"nextAttemptAt,omitempty"`
	LastSuccessAt *time.Time           `json:"lastSuccessAt,omitempty"`
}

func recoveryView(item *instance) *publicRecovery {
	if item == nil || item.Recovery == nil {
		return nil
	}
	r := item.Recovery
	message := "Automatic recovery is being assessed"
	switch r.Reason {
	case "session-failed", "boot-recovery", "launch-interrupted":
		message = "Recovery is scheduled"
	case "cleanup-failed", "launch-failed", "runtime-recreation-failed":
		message = "Recovery attempt failed; a later retry is scheduled"
	case "session-populated-or-unknown":
		message = "Recovery is blocked by live or unverified application processes"
	case "viewer-attached":
		message = "Recovery is blocked by unverified Viewer ownership"
	case "runtime-unhealthy":
		message = "Locked runtime resources are unavailable or unhealthy"
	case "runtime-occupied":
		message = "Runtime resources are occupied"
	case "boot-unverified", "boot-changed":
		message = "Recovery needs verified boot and resource ownership"
	case "shutdown-unresolved":
		message = "Resolve the pending shutdown before recovery"
	case "upgrade-unresolved":
		message = "Resolve the pending upgrade before recovery"
	case "desired-stopped", "session-stopped":
		message = "Automatic recovery is inactive"
	case "healthy":
		message = "Session health is confirmed"
	case "checking-health":
		message = "Confirming sustained session health"
	case "generation-exhausted", "attempts-exhausted":
		message = "Recovery limit reached; explicit intervention is required"
	}
	result := &publicRecovery{Phase: r.Phase, Reason: r.Reason, Message: message, Attempts: r.Attempts}
	if !r.NextAttemptAt.IsZero() {
		next := r.NextAttemptAt
		result.NextAttemptAt = &next
	}
	if !r.LastSuccessAt.IsZero() {
		last := r.LastSuccessAt
		result.LastSuccessAt = &last
	}
	return result
}

func (m *manager) serveRecoveryRetry(w http.ResponseWriter, r *http.Request, id string) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodPost {
		methodNotAllowed(w, "POST")
		return
	}
	var request struct {
		SessionGeneration *int64 `json:"sessionGeneration"`
	}
	if err := decodeStrictJSON(r.Body, &request); err != nil || request.SessionGeneration == nil || *request.SessionGeneration < 0 || *request.SessionGeneration >= 1<<53 {
		writeError(w, 400, "sessionGeneration is required and must be a safe non-negative integer")
		return
	}
	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()
	item := m.get(id)
	if item == nil {
		writeError(w, 404, "instance not found")
		return
	}
	if item.SessionGeneration != *request.SessionGeneration {
		writeError(w, 409, "session generation changed")
		return
	}
	if reason := failedSessionRecoveryRejection(item, item.Spec.RunMode); reason != "" && reason != recoveryRuntime {
		writeError(w, 409, reason.Error())
		return
	}
	m.managedMu.RLock()
	registration := m.managed[item.ManagedID]
	running := registration != nil && registration.RuntimeInstanceID == id && registration.DesiredState == "running"
	m.managedMu.RUnlock()
	if !running {
		writeError(w, 409, "managed recovery requires desired-running registration")
		return
	}
	now := m.recoveryNow()
	if item.Recovery == nil {
		if _, err := m.reconcileOneSessionRecovery(id, now); err != nil {
			writeError(w, 503, "cannot persist recovery schedule")
			return
		}
	} else {
		recovery := *item.Recovery
		// Waiting/cooldown always retain their deadline and charged budget. Manual
		// recheck can expedite only a blocked safety probe, never force an attempt.
		if recovery.Phase == recoveryBlocked || (recovery.Phase == recoveryCleaning || recovery.Phase == recoveryRecreating) && !recovery.NextAttemptAt.IsZero() {
			recovery.UpdatedAt = now
			recovery.NextAttemptAt = now.Add(time.Millisecond)
			if err := m.saveManagedRecovery(item, recovery); err != nil {
				writeError(w, 503, "cannot persist recovery recheck")
				return
			}
		}
	}
	m.notifySessionRecovery()
	writeJSON(w, http.StatusAccepted, m.publicInstance(m.get(id)))
}
