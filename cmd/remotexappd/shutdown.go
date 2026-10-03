package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const shutdownBlockedExitCode = 10

// Drain hook diagnostics without retaining an unbounded payload in Manager.
type shutdownOutput struct{ bytes.Buffer }

func (b *shutdownOutput) Write(p []byte) (int, error) {
	n := len(p)
	if remaining := 4096 - b.Len(); remaining > 0 {
		if len(p) > remaining {
			p = p[:remaining]
		}
		_, _ = b.Buffer.Write(p)
	}
	return n, nil
}

type stopOptions struct {
	Reason          string
	Scope           string
	Force           bool
	PreserveRuntime bool
}

type shutdownBlockedError struct {
	Outcome string
	Message string
}

func (e *shutdownBlockedError) Error() string {
	return "graceful shutdown is blocked (" + e.Outcome + "): " + e.Message
}

func isShutdownBlocked(err error) bool {
	var target *shutdownBlockedError
	return errors.As(err, &target)
}

func (m *manager) shutdownGraceTimeout() time.Duration {
	if m.cfg.shutdownGrace > 0 {
		return m.cfg.shutdownGrace
	}
	return 15 * time.Second
}

func (m *manager) prepareSessionShutdown(item *instance, options stopOptions) error {
	requestID, err := randomID("shutdown")
	if err != nil {
		return err
	}
	now := time.Now()
	status := &shutdownStatus{
		RequestID: requestID, Generation: item.SessionGeneration, Reason: options.Reason,
		Scope: options.Scope, State: "requested", RequestedAt: now,
	}
	m.mu.Lock()
	if live := m.instances[item.ID]; live != nil {
		live.Error = ""
		live.Shutdown = status
	}
	m.mu.Unlock()
	if err := m.persistRuntime(m.get(item.ID)); err != nil {
		m.mu.Lock()
		if live := m.instances[item.ID]; live != nil && live.Shutdown != nil && live.Shutdown.RequestID == requestID {
			live.Shutdown = nil
			live.Error = "cannot durably record shutdown request: " + err.Error()
		}
		m.mu.Unlock()
		return fmt.Errorf("persist shutdown request: %w", err)
	}

	driver := m.specFor(item).Session.ShutdownDriver
	if driver == "" {
		m.finishShutdownStatus(item.ID, requestID, "completed", "template has no graceful shutdown driver; using the compatibility process-stop path", false)
		return nil
	}

	output, outcome := m.runShutdownDriver(item, driver, options)
	if outcome != "completed" && !pidFileAlive(filepath.Join(item.Runtime, m.specFor(item).Session.ReadinessPID)) {
		outcome = "completed"
		if output == "" {
			output = "application exited while the graceful shutdown hook completed"
		}
	}
	if outcome == "completed" {
		m.finishShutdownStatus(item.ID, requestID, outcome, output, false)
		m.persistRuntimeTransition(m.get(item.ID), "shutdown-completed")
		return nil
	}
	if output == "" {
		output = "application did not complete graceful shutdown"
	}
	blockedAt := time.Now()
	m.mu.Lock()
	if live := m.instances[item.ID]; live != nil && live.Shutdown != nil && live.Shutdown.RequestID == requestID {
		live.SessionState = "shutdown-blocked"
		live.Error = output
		live.Shutdown.State = outcome
		live.Shutdown.Message = output
		live.Shutdown.BlockedAt = &blockedAt
		if m.cfg.shutdownWarnAfter > 0 {
			warningAt := blockedAt.Add(m.cfg.shutdownWarnAfter)
			live.Shutdown.WarningAt = &warningAt
		}
		if m.cfg.shutdownForceAfter > 0 {
			forceAt := blockedAt.Add(m.cfg.shutdownForceAfter)
			live.Shutdown.ForceAt = &forceAt
		}
	}
	m.mu.Unlock()
	m.persistRuntimeTransition(m.get(item.ID), "shutdown-blocked")
	m.observeSession(item, item.SessionGeneration)
	m.scheduleBlockedShutdown(item.ID, requestID, options)
	return &shutdownBlockedError{Outcome: outcome, Message: output}
}

func (m *manager) runShutdownDriver(item *instance, driver string, options stopOptions) (string, string) {
	grace := m.shutdownGraceTimeout()
	ctx, cancel := context.WithTimeout(context.Background(), grace)
	defer cancel()
	command, cleanup, err := ownedShutdownCommand(ctx, driver)
	if err != nil {
		return "cannot establish shutdown hook ownership", "failed"
	}
	defer cleanup()
	dbusAddress := ""
	if value, err := os.ReadFile(filepath.Join(item.Runtime, "session-dbus-address")); err == nil {
		dbusAddress = strings.TrimSpace(string(value))
	}
	if dbusAddress == "" && m.specFor(item).RunMode == "user-home" {
		dbusAddress, _ = userBusAddress()
	}
	graceSeconds := int64((grace + time.Second - 1) / time.Second)
	command.Env = append(os.Environ(),
		"HOME="+item.Home,
		"XDG_CONFIG_HOME="+filepath.Join(item.Home, ".config"),
		"XDG_CACHE_HOME="+filepath.Join(item.Home, ".cache"),
		"XDG_DATA_HOME="+filepath.Join(item.Home, ".local", "share"),
		"DISPLAY="+item.Display,
		"XAUTHORITY="+authorityPath(item),
		"DBUS_SESSION_BUS_ADDRESS="+dbusAddress,
		"REMOTEXAPP_RUNTIME="+item.Runtime,
		"REMOTEXAPP_SOCKET_RUNTIME="+item.SocketRuntime,
		"REMOTEXAPP_PARAMETERS="+filepath.Join(item.Runtime, "launch-parameters.json"),
		"REMOTEXAPP_RUN_MODE="+m.specFor(item).RunMode,
		"REMOTEXAPP_STATUS_PATH="+statusPath(item.Runtime),
		"REMOTEXAPP_STATUS_SCHEMA="+statusSchemaPath(item.Runtime),
		"REMOTEXAPP_STATUS_HELPER="+item.Components.StatusBinary,
		"REMOTEXAPP_SESSION_GENERATION="+strconv.FormatInt(item.SessionGeneration, 10),
		"REMOTEXAPP_SHUTDOWN_PID="+filepath.Join(item.Runtime, m.specFor(item).Session.ReadinessPID),
		"REMOTEXAPP_SHUTDOWN_REASON="+options.Reason,
		"REMOTEXAPP_SHUTDOWN_SCOPE="+options.Scope,
		"REMOTEXAPP_SHUTDOWN_GRACE_SECONDS="+strconv.FormatInt(graceSeconds, 10),
	)
	command.Env = appendAppProcessEnvironment(command.Env, item, m.specFor(item))
	control := m.specFor(item).Control
	if control.Protocol != "" {
		command.Env = append(command.Env,
			"REMOTEXAPP_CONTROL_PROTOCOL="+control.Protocol,
			"REMOTEXAPP_CONTROL_ADDRESS="+item.ControlAddress,
			"REMOTEXAPP_CONTROL_PORT="+strconv.Itoa(item.ControlPort),
		)
		if control.Path != "" {
			command.Env = append(command.Env, "REMOTEXAPP_CONTROL_PATH="+control.Path)
		}
	}
	var output shutdownOutput
	command.Stdout, command.Stderr = &output, &output
	err = command.Run()
	message := strings.TrimSpace(output.String())
	if ctx.Err() != nil {
		return message, "timeout"
	}
	if err == nil {
		return message, "completed"
	}
	var exitError *exec.ExitError
	if errors.As(err, &exitError) && exitError.ExitCode() == shutdownBlockedExitCode {
		return message, "blocked"
	}
	if message == "" {
		message = err.Error()
	}
	return message, "failed"
}

func (m *manager) finishShutdownStatus(id, requestID, state, message string, forced bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if item := m.instances[id]; item != nil && item.Shutdown != nil && item.Shutdown.RequestID == requestID {
		item.Shutdown.State = state
		item.Shutdown.Message = message
		item.Shutdown.Forced = forced
	}
}

func (m *manager) scheduleBlockedShutdown(id, requestID string, options stopOptions) {
	m.mu.RLock()
	item := m.instances[id]
	var warningAt, forceAt *time.Time
	if item != nil && item.Shutdown != nil && item.Shutdown.RequestID == requestID {
		warningAt, forceAt = item.Shutdown.WarningAt, item.Shutdown.ForceAt
	}
	m.mu.RUnlock()
	if warningAt != nil {
		delay := time.Until(*warningAt)
		if delay < 0 {
			delay = 0
		}
		time.AfterFunc(delay, func() {
			m.mu.RLock()
			item := m.instances[id]
			active := item != nil && item.SessionState == "shutdown-blocked" && item.Shutdown != nil && item.Shutdown.RequestID == requestID && item.Shutdown.Generation == item.SessionGeneration
			m.mu.RUnlock()
			if active {
				logShutdownWarning(id, requestID)
			}
		})
	}
	if forceAt == nil {
		return
	}
	delay := time.Until(*forceAt)
	if delay < 0 {
		delay = 0
	}
	time.AfterFunc(delay, func() {
		m.lifecycleMu.Lock()
		defer m.lifecycleMu.Unlock()
		m.mu.RLock()
		item := m.instances[id]
		active := item != nil && item.SessionState == "shutdown-blocked" && item.Shutdown != nil && item.Shutdown.RequestID == requestID && item.Shutdown.Generation == item.SessionGeneration
		m.mu.RUnlock()
		if !active {
			return
		}
		managedID := item.ManagedID
		forced := options
		forced.Force = true
		forced.Reason += "-host-force-deadline"
		if forced.Scope == "instance" {
			_ = m.stopInstanceLocked(item, forced)
		} else {
			_ = m.stopSession(item.ID, forced)
		}
		m.syncManagedRuntimeSnapshot(id)
		// Cgroup exit events are best-effort wakeups, not the owner of desired
		// state convergence. Complete a managed desired-stop synchronously after
		// the forced runtime teardown so its durable record cannot remain stuck
		// at shutdown-blocked when the observer event races with this callback.
		if managedID != "" {
			if err := m.reconcileManagedLocked(managedID, forced); err != nil {
				log.Printf("managed instance %s reconcile after host force: %v", managedID, err)
			}
		}
	})
}

func logShutdownWarning(id, requestID string) {
	log.Printf("instance %s graceful shutdown %s remains blocked", id, requestID)
}

func (m *manager) cancelBlockedShutdown(id string) {
	m.mu.Lock()
	item := m.instances[id]
	if item == nil || item.SessionState != "shutdown-blocked" {
		m.mu.Unlock()
		return
	}
	item.SessionState = "running"
	item.Error = ""
	if item.Shutdown != nil {
		item.Shutdown.State = "cancelled"
		item.Shutdown.Message = "shutdown cancelled by a new attachment"
	}
	managedID := item.ManagedID
	runtimeCopy := *item
	if item.Shutdown != nil {
		shutdownCopy := *item.Shutdown
		runtimeCopy.Shutdown = &shutdownCopy
	}
	m.mu.Unlock()
	m.persistRuntimeTransition(&runtimeCopy, "shutdown-cancelled")
	if managedID == "" {
		return
	}
	m.managedMu.Lock()
	if managed := m.managed[managedID]; managed != nil && managed.RuntimeInstanceID == id {
		managed.Runtime = &runtimeCopy
		managed.ObservedState = "running"
		managed.Error = ""
		managed.UpdatedAt = time.Now()
		if err := m.persistManaged(managed); err != nil {
			log.Printf("managed instance %s persist shutdown cancellation: %v", managedID, err)
		}
	}
	m.managedMu.Unlock()
}

func (m *manager) syncManagedRuntimeSnapshot(id string) {
	m.mu.RLock()
	live := m.instances[id]
	if live == nil || live.ManagedID == "" {
		m.mu.RUnlock()
		return
	}
	runtimeCopy := *live
	managedID := live.ManagedID
	if live.Shutdown != nil {
		shutdownCopy := *live.Shutdown
		runtimeCopy.Shutdown = &shutdownCopy
	}
	m.mu.RUnlock()
	if err := m.persistRuntime(&runtimeCopy); err != nil {
		log.Printf("runtime %s persist forced shutdown: %v", id, err)
	}
	m.managedMu.Lock()
	if managed := m.managed[managedID]; managed != nil && managed.RuntimeInstanceID == id {
		managed.Runtime = &runtimeCopy
		managed.UpdatedAt = time.Now()
		if err := m.persistManaged(managed); err != nil {
			log.Printf("managed instance %s persist forced shutdown: %v", managedID, err)
		}
	}
	m.managedMu.Unlock()
}
