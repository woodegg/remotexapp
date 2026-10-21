package main

import (
	"errors"
	"log"
	"net"
	"path/filepath"
	"time"
)

func recoveryForRecreation(previous *managedSessionRecovery, generation int64) *managedSessionRecovery {
	if previous == nil {
		return nil
	}
	copy := *previous
	copy.Generation = generation
	return &copy
}

// A validated manifest may retain the source boot after its runtime directory
// was retired. This is the durable authority for an interrupted transaction.
func (m *manager) isManagedBootRecovery(item *instance) bool {
	if item.ManagedID == "" || item.Spec.RunMode != "user-home" || m.bootID == "" {
		return false
	}
	if item.Recovery != nil && item.Recovery.SourceBootID != "" {
		return true
	}
	if item.SessionState != "failed" && (item.Recovery == nil || item.SessionState != "running" && item.SessionState != "stopped") {
		return false
	}
	boot, err := readRuntimeBoot(item)
	return err == nil && boot != m.bootID
}

func (m *manager) finishManagedBootRecovery(item *instance, now time.Time) (time.Time, error) {
	r := *item.Recovery
	r.SourceBootID, r.HealthySince = "", time.Time{}
	r.Phase, r.Reason, r.UpdatedAt = recoveryDisabled, "session-stopped", now
	r.NextAttemptAt = time.Time{}
	if item.SessionState == "running" {
		r.Phase, r.Reason = recoveryWatching, "checking-health"
		r.NextAttemptAt = now.Add(recoveryProbeInterval)
	}
	if err := m.saveManagedRecovery(item, r); err != nil {
		return r.NextAttemptAt, err
	}
	current := m.get(item.ID)
	m.managedMu.Lock()
	if registration := m.managed[item.ManagedID]; registration != nil && registration.RuntimeInstanceID == item.ID && registration.DesiredState == "running" {
		registration.Runtime, registration.ObservedState, registration.Error = current, "running", ""
		registration.UpdatedAt = now
		if err := m.persistManaged(registration); err != nil {
			log.Printf("runtime %s boot recovery projection: %v", item.ID, err)
		}
	}
	m.managedMu.Unlock()
	m.observeManagedRuntime(item.ManagedID, current)
	m.scheduleVacancy(item.ID)
	return r.NextAttemptAt, nil
}

func (m *manager) managedBootRejection(item *instance) string {
	if item.RuntimeDesired == "stopped" {
		return string(recoveryStopped)
	}
	if item.Shutdown != nil && item.Shutdown.State != "completed" && item.Shutdown.State != "cancelled" {
		return string(recoveryShutdown)
	}
	if item.Upgrade != nil && item.Upgrade.Status.Phase != "completed" {
		return string(recoveryUpgrade)
	}
	if item.SessionGeneration >= 1<<53-1 {
		return string(recoveryGeneration)
	}
	if m.recordedSessionAlive(item) || m.sessionComponentPopulated(item.SessionUnit) {
		return string(recoveryProcesses)
	}
	if item.AttachedClients != 0 && !m.canFenceViewerChannels(item) {
		return string(recoveryViewers)
	}
	// Changed boot never grants permission to stop a newly occupied component.
	for _, unit := range []string{item.VNCUnit, item.ServerUnit, item.GatewayUnit} {
		if unit != "" && m.sessionComponentPopulated(unit) {
			return "runtime-occupied"
		}
	}
	for _, address := range []string{item.RFBAddr, item.GatewayAddr} {
		port, err := pinnedLoopbackPort(address)
		if err != nil || loopbackListenerActive(port) {
			return "runtime-occupied"
		}
	}
	if item.ControlPort != 0 && loopbackListenerActive(item.ControlPort) {
		return "runtime-occupied"
	}
	for _, resource := range item.Resources {
		if loopbackListenerActive(resource.Port) {
			return "runtime-occupied"
		}
	}
	_, socket, err := x11Paths("/tmp", item.Display)
	if err != nil {
		return "runtime-occupied"
	}
	for _, address := range []string{socket, "@" + socket} {
		if c, err := net.DialTimeout("unix", address, 100*time.Millisecond); err == nil {
			c.Close()
			return "runtime-occupied"
		}
	}
	if m.runtimeAdoptionCheck != nil {
		return ""
	} // Isolated test fixtures only.
	if err := verifyRuntimeAppPackage(filepath.Join(m.runtimeManifestDir(), item.ID+".json"), &runtimeManifestRecord{AppPackage: item.Spec.Package}); err != nil {
		return "runtime-unhealthy"
	}
	actual, err := identifyCore(item.Components)
	if err != nil || item.Components.Identity == nil || contentRevision(actual) != contentRevision(item.Components.Identity) {
		return "runtime-unhealthy"
	}
	return ""
}

// Called under lifecycleMu, without managedMu, by the same deadline controller
// as session-only recovery. No registration snapshot can independently replay it.
func (m *manager) reconcileManagedBootRecovery(item *instance, desiredRunning bool, now time.Time) (time.Time, error) {
	if !desiredRunning || item.RuntimeDesired == "stopped" {
		if item.Recovery == nil {
			return time.Time{}, nil
		}
		r := *item.Recovery
		r.Phase, r.Reason, r.UpdatedAt = recoveryDisabled, "desired-stopped", now
		r.SourceBootID, r.NextAttemptAt, r.HealthySince = "", time.Time{}, time.Time{}
		return time.Time{}, m.saveManagedRecovery(item, r)
	}
	var r managedSessionRecovery
	if item.Recovery != nil {
		r = *item.Recovery
	}
	if r.SourceBootID == "" {
		boot, err := readRuntimeBoot(item)
		if err != nil || boot == m.bootID {
			return time.Time{}, errors.New("changed boot proof is unavailable")
		}
		r.RuntimeID, r.Generation, r.SourceBootID = item.ID, item.SessionGeneration, boot
		if item.SessionRecovery != nil && item.SessionRecovery.Attempts > r.Attempts {
			r.Attempts = item.SessionRecovery.Attempts
		}
		// Retain a previously scheduled delay/cooldown across another host reboot.
		if r.NextAttemptAt.IsZero() || r.Phase == recoveryWatching || r.Phase == recoveryHealthy || r.Phase == recoveryDisabled {
			r.scheduleFailure(now, "boot-recovery")
		}
		return r.NextAttemptAt, m.saveManagedRecovery(item, r)
	}
	// The external recreation may have completed before a result write/Manager
	// interruption. Adopt a healthy outcome, never repeat its launch.
	boot, bootErr := readRuntimeBoot(item)
	if item.State == "server-ready" && bootErr == nil && boot == m.bootID && m.checkRuntimeAdoption(item) == nil {
		return m.finishManagedBootRecovery(item, now)
	}
	if r.normalizeClock(now) {
		return r.NextAttemptAt, m.saveManagedRecovery(item, r)
	}
	if !r.NextAttemptAt.IsZero() && now.Before(r.NextAttemptAt) {
		return r.NextAttemptAt, nil
	}
	if reason := m.managedBootRejection(item); reason != "" {
		charged := r.Phase == recoveryRecreating
		r.block(now, reason)
		if charged {
			r.Phase = recoveryRecreating
		}
		return r.NextAttemptAt, m.saveManagedRecovery(item, r)
	}
	if r.Phase != recoveryRecreating {
		if r.Attempts == maxManagedRecoveryAttempts {
			r.block(now, string(recoveryExhausted))
			return r.NextAttemptAt, m.saveManagedRecovery(item, r)
		}
		r.Attempts++
	}
	r.Phase, r.Reason, r.UpdatedAt = recoveryRecreating, "boot-recovery", now
	r.NextAttemptAt, r.HealthySince = time.Time{}, time.Time{}
	if err := m.saveManagedRecovery(item, r); err != nil {
		return time.Time{}, err
	}
	m.mu.Lock()
	m.instances[item.ID].State = "restarting"
	m.mu.Unlock()
	item = m.get(item.ID)
	if err := m.persistRuntime(item); err != nil {
		return time.Time{}, err
	}
	fail := func(err error) (time.Time, error) {
		current := m.get(item.ID)
		if current == nil {
			current = item
			m.storeRuntime(current)
		}
		m.setState(item.ID, "failed", "", "managed runtime recreation failed")
		m.setSessionState(item.ID, "failed", "managed runtime recreation failed")
		next, saveErr := m.finishManagedRecoveryFailure(item.ID, m.recoveryNow(), "runtime-recreation-failed")
		if saveErr != nil {
			return next, saveErr
		}
		return next, err
	}
	if err := m.fenceViewerChannels(item); err != nil {
		return fail(err)
	}
	if err := m.stopUnits(item); err != nil {
		return fail(err)
	}
	if err := removeRuntimeDirectory(m.cfg.stateDir, item.Runtime); err != nil {
		return fail(err)
	}
	record := runtimeManifestRecord{Runtime: *item, DesiredState: item.RuntimeDesired, ResolvedSpec: item.Spec, Components: item.Components, Overrides: item.Overrides}
	request := runtimeRecoveryRequest(&record)
	// Keep the restarting placeholder observable while createLocked replaces
	// it; its conflict/allocation checks already exclude this exact ID.
	runtime, err := m.createRecoveryRuntimeLocked(request)
	if err != nil {
		if runtime == nil {
			runtime = recoveryRecordRuntime(request, item)
			runtime.SessionGeneration = request.SessionGeneration
			runtime.Recovery = recoveryForRecreation(request.Recovery, request.SessionGeneration)
		}
		m.storeRuntime(runtime)
		return fail(err)
	}
	return m.finishManagedBootRecovery(runtime, m.recoveryNow())
}
