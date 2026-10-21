package main

import (
	"errors"
	"fmt"
	"time"
)

// Reasons describe lifecycle facts, not text scraped from an App's error.
// Background admission can share these guards when its scheduler is introduced.
type sessionRecoveryRejection string

const (
	recoveryUnsupported sessionRecoveryRejection = "not-managed-user-home"
	recoveryNotFailed   sessionRecoveryRejection = "session-not-failed"
	recoveryStopped     sessionRecoveryRejection = "desired-stopped"
	recoveryShutdown    sessionRecoveryRejection = "shutdown-unresolved"
	recoveryUpgrade     sessionRecoveryRejection = "upgrade-unresolved"
	recoveryRuntime     sessionRecoveryRejection = "runtime-not-ready"
	recoveryGeneration  sessionRecoveryRejection = "generation-exhausted"
	recoveryProcesses   sessionRecoveryRejection = "session-populated-or-unknown"
	recoveryViewers     sessionRecoveryRejection = "viewer-attached"
	recoveryExhausted   sessionRecoveryRejection = "attempts-exhausted"
)

func (reason sessionRecoveryRejection) Error() string {
	switch reason {
	case recoveryUnsupported:
		return "session failed; an explicit runtime restart is required"
	case recoveryNotFailed:
		return "session recovery requires a failed session"
	case recoveryStopped:
		return "session recovery blocked: runtime is explicitly stopped"
	case recoveryShutdown:
		return "session recovery blocked: shutdown requires explicit resolution"
	case recoveryUpgrade:
		return "session recovery blocked: upgrade requires explicit resolution"
	case recoveryRuntime:
		return "session recovery blocked: retained runtime is not server-ready"
	case recoveryGeneration:
		return "session recovery blocked: session generation exhausted"
	case recoveryProcesses:
		return "session recovery blocked: live session processes require operator review"
	case recoveryViewers:
		return "session recovery blocked: viewer is still attached"
	case recoveryExhausted:
		return "session recovery exhausted: explicit runtime restart required"
	default:
		return "session recovery blocked"
	}
}

func failedSessionRecoveryRejection(item *instance, runMode string) sessionRecoveryRejection {
	if item == nil || item.ManagedID == "" || runMode != "user-home" {
		return recoveryUnsupported
	}
	if item.SessionState != "failed" {
		return recoveryNotFailed
	}
	if item.RuntimeDesired == "stopped" {
		return recoveryStopped
	}
	if item.Shutdown != nil && item.Shutdown.State != "completed" && item.Shutdown.State != "cancelled" {
		return recoveryShutdown
	}
	if item.Upgrade != nil && item.Upgrade.Status.Phase != "completed" {
		return recoveryUpgrade
	}
	if item.State != "server-ready" {
		return recoveryRuntime
	}
	if item.SessionGeneration < 0 || item.SessionGeneration >= 1<<53-1 {
		return recoveryGeneration
	}
	return ""
}

// prepareFailedSessionRecovery requires lifecycleMu. This first slice retains
// schema 2 and the on-attach policy. Charge the existing durable budget before
// cleanup, retaining failed state until cleanup and the stopped-state write
// succeed. A crash can consume an attempt; it must never refund one silently.
func (m *manager) prepareFailedSessionRecovery(id string) (*instance, error) {
	item := m.get(id)
	if item == nil {
		return nil, errors.New("instance not found")
	}
	if reason := failedSessionRecoveryRejection(item, m.specFor(item).RunMode); reason != "" {
		return nil, reason
	}
	// Registration owns desired state. A failed stop may not yet have updated
	// the runtime projection, so attachment must honor both sources of intent.
	m.managedMu.Lock()
	managed := m.managed[item.ManagedID]
	stopped := managed != nil && managed.DesiredState == "stopped"
	m.managedMu.Unlock()
	if stopped {
		return nil, recoveryStopped
	}
	if m.sessionComponentPopulated(item.SessionUnit) {
		return nil, recoveryProcesses
	}
	// Keep this guard until old-generation Viewer channels can be fenced.
	if item.AttachedClients != 0 {
		return nil, recoveryViewers
	}
	window, allowed := nextSessionRecovery(item.SessionRecovery, time.Now())
	if !allowed {
		return nil, recoveryExhausted
	}
	intent := *item
	intent.SessionRecovery = &window
	if err := m.persistRuntime(&intent); err != nil {
		return nil, fmt.Errorf("persist managed session recovery intent: %w", err)
	}
	m.mu.Lock()
	m.instances[id].SessionRecovery = &window
	m.mu.Unlock()
	if err := m.cleanupSessionComponent(&intent); err != nil {
		return nil, fmt.Errorf("session recovery cleanup: %w", err)
	}
	ready := *m.get(id)
	ready.SessionState, ready.Error = "stopped", ""
	if err := m.persistRuntime(&ready); err != nil {
		return nil, fmt.Errorf("persist cleaned session recovery: %w", err)
	}
	m.mu.Lock()
	m.instances[id].SessionState, m.instances[id].Error = "stopped", ""
	m.mu.Unlock()
	return m.get(id), nil
}
