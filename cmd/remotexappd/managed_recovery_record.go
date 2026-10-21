package main

import (
	"errors"
	"hash/fnv"
	"time"
)

const runtimeRecoverySchema = 3

type managedRecoveryPhase string

const (
	recoveryWaiting   managedRecoveryPhase = "waiting"
	recoveryCooldown  managedRecoveryPhase = "cooldown"
	recoveryBlocked   managedRecoveryPhase = "blocked"
	recoveryCleaning  managedRecoveryPhase = "cleaning"
	recoveryLaunching managedRecoveryPhase = "launching"
	recoveryWatching  managedRecoveryPhase = "watching"
	recoveryHealthy   managedRecoveryPhase = "healthy"
	recoveryDisabled  managedRecoveryPhase = "disabled"
)

const recoveryProbeInterval = 30 * time.Second
const recoveryHealthWindow = 10 * time.Minute
const maxManagedRecoveryAttempts = 1<<30 - 1

// Stored once at the manifest root; never in the managed registration or the
// public instance JSON. Generation fences deferred work and interrupted phases.
type managedSessionRecovery struct {
	RuntimeID     string               `json:"runtimeId"`
	Generation    int64                `json:"generation"`
	Phase         managedRecoveryPhase `json:"phase"`
	Reason        string               `json:"reason"`
	Attempts      int                  `json:"attempts"`
	UpdatedAt     time.Time            `json:"updatedAt"`
	NextAttemptAt time.Time            `json:"nextAttemptAt"`
	HealthySince  time.Time            `json:"healthySince"`
}

func managedRecoveryDelay(attempts int) time.Duration {
	switch attempts {
	case 0:
		return 5 * time.Second
	case 1:
		return 15 * time.Second
	case 2:
		return time.Minute
	default:
		return 10 * time.Minute
	}
}

// Positive deterministic jitter avoids fleet-wide deadlines without ever
// shortening a retry delay. Health checks have their own fixed interval.
func recoveryDeadline(id string, now time.Time, delay time.Duration) time.Time {
	hash := fnv.New32a()
	_, _ = hash.Write([]byte(id))
	jitter := time.Duration(hash.Sum32()%1001) * delay / 10000
	return now.Add(delay + jitter)
}

func (r *managedSessionRecovery) scheduleFailure(now time.Time, reason string) {
	r.Phase = recoveryWaiting
	if r.Attempts >= 3 {
		r.Phase = recoveryCooldown
	}
	r.Reason, r.UpdatedAt, r.HealthySince = reason, now, time.Time{}
	r.NextAttemptAt = recoveryDeadline(r.RuntimeID, now, managedRecoveryDelay(r.Attempts))
}

func (r *managedSessionRecovery) block(now time.Time, reason string) {
	r.Phase, r.Reason, r.UpdatedAt, r.HealthySince = recoveryBlocked, reason, now, time.Time{}
	r.NextAttemptAt = recoveryDeadline(r.RuntimeID, now, recoveryProbeInterval)
}

func (r *managedSessionRecovery) normalizeClock(now time.Time) bool {
	delay := managedRecoveryDelay(r.Attempts)
	if r.Phase == recoveryBlocked || r.Phase == recoveryWatching || r.Phase == recoveryCleaning && !r.NextAttemptAt.IsZero() {
		delay = recoveryProbeInterval
	}
	backward := now.Before(r.UpdatedAt)
	future := !r.NextAttemptAt.IsZero() && r.NextAttemptAt.After(now.Add(delay+delay/10))
	if !backward && !future {
		return false
	}
	r.UpdatedAt, r.HealthySince = now, time.Time{}
	if r.Phase == recoveryHealthy {
		r.Phase, r.Reason = recoveryWatching, "checking-health"
		delay = recoveryProbeInterval
		r.NextAttemptAt = now.Add(recoveryProbeInterval)
	}
	if !r.NextAttemptAt.IsZero() {
		r.NextAttemptAt = recoveryDeadline(r.RuntimeID, now, delay)
	}
	return true
}

func validateManagedRecovery(r *managedSessionRecovery, item *instance, spec classConfig) error {
	if r == nil {
		return errors.New("schema 3 requires recovery metadata")
	}
	if item.ManagedID == "" || spec.RunMode != "user-home" || r.RuntimeID != item.ID || r.Generation != item.SessionGeneration ||
		r.Generation < 0 || r.Generation >= 1<<53 || r.Attempts < 0 || r.Attempts > maxManagedRecoveryAttempts || r.UpdatedAt.IsZero() {
		return errors.New("invalid managed recovery identity or budget")
	}
	switch r.Reason {
	case "session-failed", "cleanup-failed", "launch-failed", "launch-interrupted", "runtime-unhealthy", "boot-unverified", "boot-changed",
		"session-populated-or-unknown", "viewer-attached", "desired-stopped", "shutdown-unresolved", "upgrade-unresolved", "runtime-not-ready",
		"generation-exhausted", "attempts-exhausted", "session-stopped", "healthy", "checking-health":
	default:
		return errors.New("invalid managed recovery reason")
	}
	switch r.Phase {
	case recoveryWaiting, recoveryCooldown, recoveryBlocked, recoveryWatching:
		if r.NextAttemptAt.IsZero() || !r.NextAttemptAt.After(r.UpdatedAt) {
			return errors.New("managed recovery deadline must follow its update")
		}
	case recoveryCleaning:
		if !r.NextAttemptAt.IsZero() && !r.NextAttemptAt.After(r.UpdatedAt) {
			return errors.New("charged cleanup probe deadline must follow its update")
		}
	case recoveryLaunching, recoveryHealthy, recoveryDisabled:
		if !r.NextAttemptAt.IsZero() {
			return errors.New("inactive recovery deadline must be empty")
		}
	default:
		return errors.New("invalid managed recovery phase")
	}
	if !r.HealthySince.IsZero() && (r.Phase != recoveryWatching && r.Phase != recoveryHealthy || r.HealthySince.After(r.UpdatedAt)) {
		return errors.New("invalid managed recovery health interval")
	}
	if r.Phase == recoveryHealthy && (r.Attempts != 0 || r.HealthySince.IsZero() || r.UpdatedAt.Sub(r.HealthySince) < recoveryHealthWindow) {
		return errors.New("healthy recovery requires a confirmed zero-budget interval")
	}
	if r.Phase == recoveryCooldown && r.Attempts < 3 || r.Phase == recoveryCleaning && r.Attempts == 0 {
		return errors.New("managed recovery phase disagrees with attempt budget")
	}
	return nil
}
