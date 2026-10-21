package main

import (
	"context"
	"errors"
	"log"
	"path/filepath"
	"sort"
	"time"
)

type recoveryRetryFloor struct {
	Generation int64
	Until      time.Time
}

func (m *manager) recoveryNow() time.Time {
	if m.recoveryClock != nil {
		return m.recoveryClock()
	}
	return time.Now()
}

func (m *manager) notifySessionRecovery() {
	if m.recoveryWake != nil {
		select {
		case m.recoveryWake <- struct{}{}:
		default:
		}
	}
}

// The legacy counter is a capped projection, including creating/recreating
// snapshots. Only the schema-3 authority supplies its budget, never the old
// projection's count. Keep the old window label for existing clients.
func projectManagedRecoveryCounter(previous *sessionRecovery, recovery *managedSessionRecovery) *sessionRecovery {
	if recovery == nil || recovery.Attempts == 0 {
		return nil
	}
	windowStart := recovery.UpdatedAt
	if previous != nil && !previous.WindowStart.IsZero() {
		windowStart = previous.WindowStart
	}
	return &sessionRecovery{WindowStart: windowStart, Attempts: min(recovery.Attempts, 3)}
}

// lifecycleMu owns transitions. Registry locks are only used for snapshots;
// never call this while managedMu is held by managed reconciliation.
func (m *manager) saveManagedRecovery(item *instance, recovery managedSessionRecovery) error {
	m.mu.RLock()
	live := m.instances[item.ID]
	current := live != nil && live.SessionGeneration == item.SessionGeneration
	m.mu.RUnlock()
	if !current {
		return errors.New("stale managed recovery generation")
	}
	copy := *item
	recovery.RuntimeID, recovery.Generation = item.ID, item.SessionGeneration
	copy.Recovery = &recovery
	copy.SessionRecovery = projectManagedRecoveryCounter(item.SessionRecovery, &recovery)
	if err := m.persistRuntime(&copy); err != nil {
		return err
	}
	m.mu.Lock()
	m.instances[item.ID].Recovery = &recovery
	m.instances[item.ID].SessionRecovery = copy.SessionRecovery // Compatibility projection only.
	m.mu.Unlock()
	return nil
}

func (m *manager) checkManagedRecoveryHealth(item *instance, session bool) error {
	copy := *item
	if !session {
		copy.SessionState = "stopped"
	}
	// Existing test-only adoption hook supplies isolated resource evidence.
	if m.runtimeAdoptionCheck != nil {
		return m.runtimeAdoptionCheck(&copy)
	}
	if err := verifyRuntimeAppPackage(filepath.Join(m.runtimeManifestDir(), item.ID+".json"), &runtimeManifestRecord{AppPackage: item.Spec.Package}); err != nil {
		return err
	}
	if !session && item.Components.Identity != nil {
		actual, err := identifyCore(item.Components)
		if err != nil || contentRevision(actual) != contentRevision(item.Components.Identity) {
			return errors.New("locked Core component identity changed")
		}
	}
	if err := m.checkRuntimeAdoption(&copy); err != nil {
		return err
	}
	if session {
		if !m.recordedSessionAlive(item) {
			return errors.New("canonical session readiness is unavailable")
		}
		if item.Spec.Session.Status.Mode == "driver" && (item.ApplicationStatus == nil || item.ApplicationStatus.Generation != item.SessionGeneration || item.ApplicationStatus.State != "ready") {
			return errors.New("application readiness is unavailable")
		}
	}
	return nil
}

func (m *manager) recoveryResourceRejection(item *instance) string {
	if m.bootID != "" {
		boot, err := readRuntimeBoot(item)
		if err != nil {
			return "boot-unverified"
		}
		if boot != m.bootID {
			return "boot-changed" // Runtime recreation belongs to the next slice.
		}
	}
	if m.sessionComponentPopulated(item.SessionUnit) {
		return string(recoveryProcesses)
	}
	if item.AttachedClients != 0 && !m.canFenceViewerChannels(item) {
		return string(recoveryViewers)
	}
	if err := m.checkManagedRecoveryHealth(item, false); err != nil {
		return "runtime-unhealthy"
	}
	return ""
}

func (m *manager) finishManagedRecoveryFailure(id string, now time.Time, reason string) (time.Time, error) {
	item := m.get(id)
	if item == nil || item.Recovery == nil {
		return time.Time{}, errors.New("managed recovery runtime disappeared")
	}
	recovery := *item.Recovery
	recovery.scheduleFailure(now, reason)
	return recovery.NextAttemptAt, m.saveManagedRecovery(item, recovery)
}

func (m *manager) reconcileOneSessionRecovery(id string, now time.Time) (time.Time, error) {
	item := m.get(id)
	if item == nil || item.ManagedID == "" || m.specFor(item).RunMode != "user-home" {
		return time.Time{}, nil
	}
	m.managedMu.RLock()
	managed := m.managed[item.ManagedID]
	bound := managed != nil && managed.RuntimeInstanceID == item.ID
	running := bound && managed.DesiredState == "running"
	m.managedMu.RUnlock()
	if !bound {
		return time.Time{}, nil
	}
	if m.isManagedBootRecovery(item) {
		return m.reconcileManagedBootRecovery(item, running, now)
	}
	if item.Recovery == nil {
		if !running || failedSessionRecoveryRejection(item, m.specFor(item).RunMode) != "" {
			return time.Time{}, nil
		}
		recovery := managedSessionRecovery{RuntimeID: item.ID, Generation: item.SessionGeneration}
		if item.SessionRecovery != nil {
			recovery.Attempts = item.SessionRecovery.Attempts
		}
		recovery.scheduleFailure(now, "session-failed")
		return recovery.NextAttemptAt, m.saveManagedRecovery(item, recovery)
	}
	recovery := *item.Recovery
	if !running || item.RuntimeDesired == "stopped" {
		if recovery.Phase != recoveryDisabled || recovery.Reason != "desired-stopped" {
			recovery.Phase, recovery.Reason, recovery.UpdatedAt = recoveryDisabled, "desired-stopped", now
			recovery.NextAttemptAt, recovery.HealthySince = time.Time{}, time.Time{}
			return time.Time{}, m.saveManagedRecovery(item, recovery)
		}
		return time.Time{}, nil
	}
	if recovery.normalizeClock(now) {
		next := recovery.NextAttemptAt
		if next.IsZero() && (recovery.Phase == recoveryCleaning || recovery.Phase == recoveryLaunching) {
			next = now
		}
		return next, m.saveManagedRecovery(item, recovery)
	}
	if item.SessionState == "running" {
		if recovery.Phase == recoveryHealthy && recovery.Attempts == 0 {
			return time.Time{}, nil
		}
		if recovery.Phase == recoveryWatching && now.Before(recovery.NextAttemptAt) {
			return recovery.NextAttemptAt, nil
		}
		if now.Sub(recovery.UpdatedAt) > 2*recoveryProbeInterval {
			recovery.HealthySince = time.Time{} // An observation gap is not continuous health.
		}
		recovery.Phase, recovery.Reason, recovery.UpdatedAt = recoveryWatching, "checking-health", now
		recovery.NextAttemptAt = now.Add(recoveryProbeInterval)
		if err := m.checkManagedRecoveryHealth(item, true); err != nil {
			recovery.Reason, recovery.HealthySince = "runtime-unhealthy", time.Time{}
		} else if recovery.HealthySince.IsZero() {
			recovery.HealthySince = now
		} else if now.Sub(recovery.HealthySince) >= recoveryHealthWindow {
			recovery.Phase, recovery.Reason, recovery.Attempts = recoveryHealthy, "healthy", 0
			recovery.LastSuccessAt = now
			recovery.NextAttemptAt = time.Time{}
		}
		return recovery.NextAttemptAt, m.saveManagedRecovery(item, recovery)
	}
	resumingCleanup := recovery.Phase == recoveryCleaning && item.SessionState == "stopped"
	if item.SessionState != "failed" && !resumingCleanup {
		if recovery.Phase != recoveryDisabled || recovery.Reason != "session-stopped" {
			recovery.Phase, recovery.Reason, recovery.UpdatedAt = recoveryDisabled, "session-stopped", now
			recovery.NextAttemptAt, recovery.HealthySince = time.Time{}, time.Time{}
			return time.Time{}, m.saveManagedRecovery(item, recovery)
		}
		return time.Time{}, nil
	}
	if recovery.Phase == recoveryLaunching {
		// A recorded launch may already have run. Reconcile its outcome rather
		// than issuing the same external launch twice after a Manager crash.
		return m.finishManagedRecoveryFailure(id, now, "launch-interrupted")
	}
	if recovery.Phase == recoveryHealthy || recovery.Phase == recoveryWatching || recovery.Phase == recoveryDisabled {
		return m.finishManagedRecoveryFailure(id, now, "session-failed")
	}
	if !recovery.NextAttemptAt.IsZero() && now.Before(recovery.NextAttemptAt) {
		return recovery.NextAttemptAt, nil
	}
	admission := *item
	if resumingCleanup {
		admission.SessionState = "failed"
	}
	reason := string(failedSessionRecoveryRejection(&admission, m.specFor(item).RunMode))
	if reason == "" {
		reason = m.recoveryResourceRejection(item)
	}
	if reason == "" && recovery.Phase != recoveryCleaning && recovery.Attempts == maxManagedRecoveryAttempts {
		reason = string(recoveryExhausted)
	}
	if reason != "" {
		cleaning := recovery.Phase == recoveryCleaning
		recovery.block(now, reason)
		if cleaning {
			recovery.Phase = recoveryCleaning // Resume the already charged intent.
		}
		return recovery.NextAttemptAt, m.saveManagedRecovery(item, recovery)
	}
	if recovery.Phase != recoveryCleaning {
		recovery.Attempts++
		recovery.Phase, recovery.Reason, recovery.UpdatedAt = recoveryCleaning, "session-failed", now
		recovery.NextAttemptAt, recovery.HealthySince = time.Time{}, time.Time{}
		if err := m.saveManagedRecovery(item, recovery); err != nil {
			return time.Time{}, err
		}
	}
	if err := m.fenceViewerChannels(item); err != nil {
		return m.finishManagedRecoveryFailure(id, m.recoveryNow(), string(recoveryViewers))
	}
	currentSafety := m.get(id)
	if reason := m.recoveryResourceRejection(currentSafety); reason != "" {
		r := *currentSafety.Recovery
		r.block(m.recoveryNow(), reason)
		r.Phase = recoveryCleaning
		return r.NextAttemptAt, m.saveManagedRecovery(currentSafety, r)
	}
	if err := m.setGatewayClipboardSession(item, item.SessionGeneration, false); err != nil {
		return m.finishManagedRecoveryFailure(id, m.recoveryNow(), "cleanup-failed")
	}
	if err := m.cleanupSessionComponent(item); err != nil {
		log.Printf("runtime %s managed recovery cleanup: %v", id, err)
		return m.finishManagedRecoveryFailure(id, m.recoveryNow(), "cleanup-failed")
	}
	m.setSessionState(id, "stopped", "")
	if err := m.persistRuntime(m.get(id)); err != nil {
		m.setSessionState(id, "failed", "cannot persist cleaned managed session")
		return time.Time{}, err
	}
	start := m.recoverySessionStart
	if start == nil {
		start = m.startSession
	}
	if err := start(id); err != nil {
		log.Printf("runtime %s managed recovery launch: %v", id, err)
		m.setSessionState(id, "failed", "managed session recovery launch failed")
		return m.finishManagedRecoveryFailure(id, m.recoveryNow(), "launch-failed")
	}
	current := m.get(id)
	if current == nil || current.Recovery == nil || current.SessionState != "running" {
		return time.Time{}, errors.New("managed recovery launch did not produce a running session")
	}
	recovery = *current.Recovery
	recovery.Phase, recovery.Reason, recovery.UpdatedAt = recoveryWatching, "checking-health", m.recoveryNow()
	recovery.HealthySince = time.Time{}
	recovery.NextAttemptAt = recovery.UpdatedAt.Add(recoveryProbeInterval)
	if err := m.saveManagedRecovery(current, recovery); err != nil {
		return time.Time{}, err // Preserve the live App even if the result write failed.
	}
	// Update the managed projection now; it is not the recovery authority.
	m.managedMu.Lock()
	if managed := m.managed[item.ManagedID]; managed != nil && managed.RuntimeInstanceID == id && managed.DesiredState == "running" {
		managed.Runtime, managed.ObservedState, managed.Error = m.get(id), "running", ""
		managed.UpdatedAt = m.recoveryNow()
		if err := m.persistManaged(managed); err != nil {
			log.Printf("runtime %s recovered managed projection: %v", id, err)
		}
	}
	m.managedMu.Unlock()
	m.scheduleVacancy(id)
	return recovery.NextAttemptAt, nil
}

func (m *manager) reconcileSessionRecovery(now time.Time) time.Time {
	m.mu.RLock()
	ids := make([]string, 0, len(m.instances))
	for id := range m.instances {
		ids = append(ids, id)
	}
	m.mu.RUnlock()
	sort.Strings(ids)
	var earliest time.Time
	for _, id := range ids {
		m.lifecycleMu.Lock()
		item := m.get(id)
		if item == nil {
			m.lifecycleMu.Unlock()
			continue
		}
		var next time.Time
		floor := m.recoveryRetryAfter[id]
		if floor.Generation == item.SessionGeneration && now.Before(floor.Until) {
			if floor.Until.After(now.Add(recoveryProbeInterval)) {
				floor.Until = now.Add(recoveryProbeInterval)
				m.recoveryRetryAfter[id] = floor
			}
			next = floor.Until
		} else {
			var err error
			next, err = m.reconcileOneSessionRecovery(id, now)
			if err != nil {
				log.Printf("runtime %s managed recovery record: %v", id, err)
				next = now.Add(recoveryProbeInterval)
				if m.recoveryRetryAfter == nil {
					m.recoveryRetryAfter = make(map[string]recoveryRetryFloor)
				}
				m.recoveryRetryAfter[id] = recoveryRetryFloor{Generation: item.SessionGeneration, Until: next}
			} else {
				delete(m.recoveryRetryAfter, id)
			}
		}
		m.lifecycleMu.Unlock()
		if !next.IsZero() && (earliest.IsZero() || next.Before(earliest)) {
			earliest = next
		}
	}
	m.lifecycleMu.Lock()
	m.mu.RLock()
	for id := range m.recoveryRetryAfter {
		if m.instances[id] == nil {
			delete(m.recoveryRetryAfter, id)
		}
	}
	m.mu.RUnlock()
	m.lifecycleMu.Unlock()
	return earliest
}

func (m *manager) resetRecoveryHealthConfirmation(now time.Time) {
	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()
	m.mu.RLock()
	ids := make([]string, 0, len(m.instances))
	for id := range m.instances {
		ids = append(ids, id)
	}
	m.mu.RUnlock()
	for _, id := range ids {
		item := m.get(id)
		if item == nil || item.Recovery == nil || item.Recovery.Phase != recoveryWatching {
			continue
		}
		recovery := *item.Recovery
		recovery.HealthySince, recovery.UpdatedAt = time.Time{}, now
		recovery.NextAttemptAt = now.Add(recoveryProbeInterval)
		if err := m.saveManagedRecovery(item, recovery); err != nil {
			// An unpersistable reset must not turn old healthySince into proof
			// of continuous health across a Manager outage.
			m.mu.Lock()
			m.instances[id].Recovery = &recovery
			m.mu.Unlock()
			log.Printf("runtime %s reset recovery health confirmation: %v", id, err)
		}
	}
}

func (m *manager) runSessionRecoveryLoop(ctx context.Context) {
	m.resetRecoveryHealthConfirmation(m.recoveryNow())
	for {
		if ctx.Err() != nil {
			return
		}
		next := m.reconcileSessionRecovery(m.recoveryNow())
		delay := 24 * time.Hour
		if !next.IsZero() {
			delay = time.Until(next)
			if delay < 0 {
				delay = 0
			}
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-m.recoveryWake:
			timer.Stop()
		case <-timer.C:
		}
	}
}
