package main

import (
	"net/http"
	"time"
)

type idleLeaseResult struct {
	InstanceID        string     `json:"instanceId"`
	SessionGeneration int64      `json:"sessionGeneration"`
	Outcome           string     `json:"outcome"`
	IdleAction        string     `json:"idleAction"`
	IdleTimeoutMS     int64      `json:"idleTimeoutMs"`
	ServerTime        time.Time  `json:"serverTime"`
	ExpiresAt         *time.Time `json:"expiresAt"`
}

func (m *manager) serveIdleLease(w http.ResponseWriter, r *http.Request, id string) {
	w.Header().Set("Cache-Control", "no-store")
	fail := func(status int, code string) { writeJSON(w, status, map[string]string{"error": code, "code": code}) }
	if r.Method != http.MethodPost {
		methodNotAllowed(w, "POST")
		return
	}
	var request struct {
		SessionGeneration *int64 `json:"sessionGeneration"`
	}
	controller := http.NewResponseController(w)
	_ = controller.SetReadDeadline(time.Now().Add(5 * time.Second))
	r.Body = http.MaxBytesReader(w, r.Body, 1024)
	err := decodeStrictJSON(r.Body, &request)
	_ = controller.SetReadDeadline(time.Time{})
	if err != nil || request.SessionGeneration == nil || *request.SessionGeneration < 0 {
		fail(http.StatusBadRequest, "invalid-request")
		return
	}
	// Do not queue a renewal behind slow shutdown/start hooks. Busy is retryable,
	// while not-renewable and stale-generation terminate the client's interest.
	if !m.lifecycleMu.TryLock() {
		fail(http.StatusConflict, "busy")
		return
	}
	defer m.lifecycleMu.Unlock()
	copy := m.get(id)
	if copy == nil {
		fail(http.StatusNotFound, "instance-not-found")
		return
	}
	if copy.ManagedID != "" {
		managed := m.getManaged(copy.ManagedID)
		if managed == nil || managed.DesiredState != "running" {
			fail(http.StatusConflict, "not-renewable")
			return
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	item := m.instances[id]
	if item == nil {
		fail(http.StatusNotFound, "instance-not-found")
		return
	}
	if item.SessionGeneration != *request.SessionGeneration {
		fail(http.StatusConflict, "stale-generation")
		return
	}
	class := m.specFor(item)
	unstarted := item.SessionGeneration == 0 && item.SessionState == "stopped" && class.Session.Activation == "on-attach"
	upgrading := item.Upgrade != nil && (item.Upgrade.Status.Phase == "stopping" || item.Upgrade.Status.Phase == "launching" || item.Upgrade.Status.Phase == "blocked")
	if item.State != "server-ready" || item.RuntimeDesired == "stopped" || upgrading ||
		(item.SessionState != "running" && !unstarted) ||
		(copy.ApplicationStatus != nil && (copy.ApplicationStatus.State == "exited" || copy.ApplicationStatus.State == "error")) {
		fail(http.StatusConflict, "not-renewable")
		return
	}
	result := idleLeaseResult{InstanceID: id, SessionGeneration: item.SessionGeneration,
		IdleAction: class.Session.VacantAction, IdleTimeoutMS: m.timeoutFor(item).Milliseconds(), ServerTime: time.Now()}
	switch {
	case class.Session.VacantAction == "keep":
		result.Outcome = "kept"
	case item.AttachedClients > 0:
		result.Outcome = "attached"
	default:
		deadline := m.scheduleVacancyLocked(id)
		result.Outcome, result.ExpiresAt = "renewed", &deadline
	}
	writeJSON(w, http.StatusOK, result)
}
