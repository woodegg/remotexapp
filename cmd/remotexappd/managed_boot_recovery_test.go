package main

import (
	"errors"
	"net"
	"os"
	"testing"
	"time"
)

func managedBootFixture(t *testing.T) (*manager, *instance, *time.Time, *int) {
	t.Helper()
	m, item, now, _ := backgroundRecoveryFixture(t)
	item.Display = ":98"
	item.RFBAddr = "127.0.0.1:53998"
	item.GatewayAddr = "127.0.0.1:53999"
	item.SessionState = "failed"
	item.State = "failed"
	m.bootID = oldTestBoot
	if err := m.writeRuntimeBoot(item); err != nil {
		t.Fatal(err)
	}
	m.bootID = newTestBoot
	m.runtimeSessionAliveCheck = func(*instance) bool { return false }
	calls := new(int)
	m.runtimeRecoveryCreate = func(request createRequest) (*instance, error) {
		*calls++
		if m.get(item.ID) == nil {
			t.Fatal("recreating runtime disappeared from API registry")
		}
		if request.Recovery == nil || request.Recovery.Attempts != 1 || request.SessionGeneration != 10 {
			t.Fatalf("lost durable charge/generation: %+v", request)
		}
		old := readRecoverySnapshot(t, m.runtimeManifestDir()+"/"+item.ID+".json")
		if old.Recovery == nil || old.Recovery.Phase != recoveryRecreating || old.Runtime.State != "restarting" {
			t.Fatal("cleanup ran without durable intent")
		}
		next := *item
		next.Recovery = request.Recovery
		next.SessionGeneration = request.SessionGeneration
		next.State = "server-ready"
		next.SessionState = "stopped"
		if err := os.MkdirAll(next.Runtime, 0700); err != nil {
			t.Fatal(err)
		}
		if err := m.writeRuntimeBoot(&next); err != nil {
			t.Fatal(err)
		}
		m.storeRuntime(&next)
		if err := m.persistRuntime(&next); err != nil {
			t.Fatal(err)
		}
		return &next, nil
	}
	return m, item, now, calls
}

func TestManagedBootRecoveryDurableDeadlineAndPins(t *testing.T) {
	m, item, now, calls := managedBootFixture(t)
	next := stepBackgroundRecovery(t, m, item, *now)
	if !next.After(*now) || *calls != 0 {
		t.Fatal("boot bypassed delay")
	}
	reloadBackgroundRecovery(t, m, item)
	*now = next
	stepBackgroundRecovery(t, m, item, *now)
	got := m.get(item.ID)
	if *calls != 1 || got.SessionGeneration != 10 || got.Recovery.Attempts != 1 || got.Recovery.SourceBootID != "" || got.SessionState != "stopped" || got.Home != item.Home || got.Components != item.Components {
		t.Fatalf("boot outcome: %+v", got)
	}
	stepBackgroundRecovery(t, m, item, now.Add(time.Hour))
	if *calls != 1 {
		t.Fatal("same boot recreated twice")
	}
}

func TestManagedBootRecoveryGuards(t *testing.T) {
	for _, guard := range []string{"managed-stop", "runtime-stop", "shutdown", "upgrade", "process", "viewer", "port", "storage"} {
		t.Run(guard, func(t *testing.T) {
			m, item, now, calls := managedBootFixture(t)
			next := stepBackgroundRecovery(t, m, item, *now)
			switch guard {
			case "managed-stop":
				m.managed[item.ManagedID].DesiredState = "stopped"
			case "runtime-stop":
				item.RuntimeDesired = "stopped"
			case "shutdown":
				item.Shutdown = &shutdownStatus{State: "blocked"}
			case "upgrade":
				item.Upgrade = &runtimeUpgrade{Status: upgradeStatus{Phase: "failed"}}
			case "process":
				t.Setenv("REMOTEXAPP_TEST_RECOVERY_FAILURE", "populated")
			case "viewer":
				item.AttachedClients = 1
			case "port":
				listener, err := net.Listen("tcp", "127.0.0.1:0")
				if err != nil {
					t.Fatal(err)
				}
				defer listener.Close()
				item.GatewayAddr = listener.Addr().String()
			case "storage":
				m.cfg.stateDir = m.runtimeManifestDir() + "/blocked"
				if err := os.WriteFile(m.cfg.stateDir, []byte("x"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			*now = next
			m.reconcileSessionRecovery(*now)
			if *calls != 0 || m.get(item.ID).Recovery.Attempts != 0 {
				t.Fatal("guard authorized cleanup")
			}
		})
	}
}

func TestManagedBootRecoveryInterruptedAndFailedAttempts(t *testing.T) {
	m, item, now, calls := managedBootFixture(t)
	next := stepBackgroundRecovery(t, m, item, *now)
	*now = next
	m.runtimeRecoveryCreate = func(request createRequest) (*instance, error) { *calls++; return nil, errors.New("injected") }
	step := func() { m.reconcileSessionRecovery(*now) }
	step()
	got := m.get(item.ID)
	if *calls != 1 || got.Recovery.Attempts != 1 || got.Recovery.SourceBootID != oldTestBoot || got.Recovery.Reason != "runtime-recreation-failed" {
		t.Fatalf("lost failure: %+v", got)
	}
	reloadBackgroundRecovery(t, m, item)
	// Directory/sidecar was already removed; trusted source boot remains in the
	// private manifest and a Manager restart cannot grant an immediate retry.
	step()
	if *calls != 1 {
		t.Fatal("reload bypassed persisted backoff")
	}
	*now = got.Recovery.NextAttemptAt
	step()
	if *calls != 2 || m.get(item.ID).Recovery.Attempts != 2 {
		t.Fatal("later retry lost charge")
	}
}

func TestManagedBootRecoveryInterruptedCleanupDoesNotRecharge(t *testing.T) {
	m, item, now, calls := managedBootFixture(t)
	next := stepBackgroundRecovery(t, m, item, *now)
	r := *m.get(item.ID).Recovery
	r.Attempts = 1
	r.Phase = recoveryRecreating
	r.NextAttemptAt = time.Time{}
	if err := m.saveManagedRecovery(m.get(item.ID), r); err != nil {
		t.Fatal(err)
	}
	if err := removeRuntimeDirectory(m.cfg.stateDir, item.Runtime); err != nil {
		t.Fatal(err)
	}
	reloadBackgroundRecovery(t, m, item)
	*now = next
	stepBackgroundRecovery(t, m, item, *now)
	if *calls != 1 || m.get(item.ID).Recovery.Attempts != 1 {
		t.Fatal("interrupted cleanup double charged")
	}
}

func TestManagedBootRecoveryPreservesCooldownAcrossAnotherBoot(t *testing.T) {
	m, item, now, calls := managedBootFixture(t)
	item.SessionRecovery = &sessionRecovery{Attempts: 3, WindowStart: *now}
	next := stepBackgroundRecovery(t, m, item, *now)
	m.bootID = "33333333-3333-4333-8333-333333333333"
	reloadBackgroundRecovery(t, m, item)
	stepBackgroundRecovery(t, m, item, now.Add(time.Minute))
	if *calls != 0 || m.get(item.ID).Recovery.Attempts != 3 || !m.get(item.ID).Recovery.NextAttemptAt.Equal(next) {
		t.Fatal("another reboot reset cooldown")
	}
}

func TestManagedBootRecoveryHealthProbeCannotShortenCooldown(t *testing.T) {
	m, item, now, calls := managedBootFixture(t)
	item.Recovery = &managedSessionRecovery{RuntimeID: item.ID, Generation: item.SessionGeneration, Phase: recoveryWatching, Reason: "checking-health", Attempts: 3, UpdatedAt: *now, NextAttemptAt: now.Add(recoveryProbeInterval)}
	next := stepBackgroundRecovery(t, m, item, *now)
	if *calls != 0 || next.Before(now.Add(10*time.Minute)) || m.get(item.ID).Recovery.Phase != recoveryCooldown {
		t.Fatal("health timer shortened boot cooldown")
	}
}

func TestManagedBootRecoveryPreviouslyRecoveringRunningSessionKeepsCooldown(t *testing.T) {
	m, item, now, calls := managedBootFixture(t)
	item.State = "server-ready"
	item.SessionState = "running"
	item.Recovery = &managedSessionRecovery{RuntimeID: item.ID, Generation: item.SessionGeneration, Phase: recoveryWatching, Reason: "checking-health", Attempts: 3, UpdatedAt: *now, NextAttemptAt: now.Add(recoveryProbeInterval)}
	record := runtimeManifestRecord{Runtime: *item, DesiredState: "running", ResolvedSpec: item.Spec, Components: item.Components}
	m.restoreRuntimeManifests([]runtimeManifestRecord{record})
	got := m.get(item.ID)
	if *calls != 0 || got.Recovery.SourceBootID != oldTestBoot || got.Recovery.NextAttemptAt.Before(now.Add(10*time.Minute)) {
		t.Fatal("boot restore bypassed the existing recovery budget")
	}
	m.reconcileSessionRecovery(now.Add(time.Minute))
	if *calls != 0 {
		t.Fatal("healthy projection or health timer bypassed boot cooldown")
	}
}
