package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Managed configuration retains its selected pins, including while stopped.
// Runtime manifests are authoritative; this record never migrates a former
// Driver-owned service runtime into the Core-owned architecture.
type managedRegistryRecord struct {
	managedInstance
	AppliedSpec       *classConfig       `json:"appliedSpec,omitempty"`
	AppliedComponents *runtimeComponents `json:"appliedComponents,omitempty"`
}

func (m *manager) managedDir() string {
	return filepath.Join(m.cfg.stateDir, "managed-instances")
}

func (m *manager) loadManagedRegistry() error {
	if err := os.MkdirAll(m.managedDir(), 0o700); err != nil {
		return err
	}
	paths, err := filepath.Glob(filepath.Join(m.managedDir(), "*.json"))
	if err != nil {
		return err
	}
	for _, path := range paths {
		file, err := os.Open(path)
		if err != nil {
			return err
		}
		var record managedRegistryRecord
		decoder := json.NewDecoder(io.LimitReader(file, 128<<10))
		decoder.DisallowUnknownFields()
		err = decoder.Decode(&record)
		_ = file.Close()
		if err != nil {
			return fmt.Errorf("load managed instance %s: %w", path, err)
		}
		item := record.managedInstance
		if item.Runtime != nil && (record.AppliedSpec == nil || record.AppliedComponents == nil) {
			return fmt.Errorf("load managed instance %s: running legacy runtime has no immutable driver snapshot; stop it with the previous manager before upgrading", path)
		}
		if record.AppliedSpec != nil {
			if record.AppliedSpec.Session.Services != "core-v1" {
				return fmt.Errorf("load managed instance %s: old session services contract; stop and recreate its configuration through the clean cutover", path)
			}
			item.AppliedSpec = *record.AppliedSpec
			if item.Runtime != nil {
				item.Runtime.Spec = item.AppliedSpec
			}
		}
		if record.AppliedComponents != nil {
			item.AppliedComponents = *record.AppliedComponents
			if item.Runtime != nil {
				item.Runtime.Components = item.AppliedComponents
			}
		}
		if err := m.validateManagedWithFiles(&item, false); err != nil {
			return fmt.Errorf("load managed instance %s: %w", path, err)
		}
		if filepath.Base(path) != item.ID+".json" {
			return fmt.Errorf("managed instance filename %q does not match id %q", filepath.Base(path), item.ID)
		}
		if item.Runtime != nil {
			m.hydrateManagedRuntime(&item)
		}
		m.managed[item.ID] = &item
	}
	return nil
}

func (m *manager) validateManaged(item *managedInstance) error {
	return m.validateManagedWithFiles(item, true)
}

func (m *manager) validateManagedWithFiles(item *managedInstance, checkFiles bool) error {
	if !safeRef.MatchString(item.ID) {
		return errors.New("id must be a safe lowercase reference")
	}
	currentTemplate, currentAvailable := m.cfg.classes[item.TemplateID]
	template := currentTemplate
	if item.AppliedSpec.ID != "" {
		template = item.AppliedSpec
	}
	if template.ID == "" {
		return fmt.Errorf("unsupported templateId %q", item.TemplateID)
	}
	item.AvailableDriverVersion = ""
	if currentAvailable {
		item.AvailableDriverVersion = currentTemplate.DriverVersion
	}
	item.UpdateStatus = "current"
	if item.AppliedDriverVersion != "" && item.AvailableDriverVersion != "" && item.AppliedDriverVersion != item.AvailableDriverVersion {
		item.UpdateStatus = "update-available"
	}
	parameters, err := resolveLaunchParametersWithFiles(template.Parameters, item.Parameters, m.cfg.documentRoots, checkFiles)
	if err != nil {
		return err
	}
	item.Parameters = parameters
	if item.DesiredState == "" {
		item.DesiredState = "running"
	}
	if item.DesiredState != "running" && item.DesiredState != "stopped" {
		return errors.New("desiredState must be running or stopped")
	}
	if item.ProfileRef == "" {
		item.ProfileRef = template.ProfileRef
	}
	if !safeRef.MatchString(item.ProfileRef) {
		return errors.New("profileRef must be a safe lowercase reference")
	}
	if template.RunMode == "user-home" && item.ProfileRef != template.ProfileRef {
		return errors.New("runMode user-home does not allow selecting another profileRef")
	}
	effective, _, workspaceMode, err := applyOverrides(template, item.Overrides)
	if err != nil {
		return err
	}
	if workspaceMode == "ephemeral" {
		return errors.New("managed instances require a persistent workspace")
	}
	if effective.Session.VacantAction == "stop-instance" {
		return errors.New("managed instances cannot use idleAction stop-instance; use keep or stop-session")
	}
	return nil
}

func (m *manager) hydrateManagedRuntime(item *managedInstance) {
	effective := item.AppliedSpec
	if effective.ID == "" {
		effective = item.Runtime.Spec
	}
	timeout, err := time.ParseDuration(effective.Session.VacantTimeout)
	if err != nil {
		item.Error = err.Error()
		return
	}
	workspaceMode := item.Runtime.WorkspaceMode
	item.Runtime.ClassID = item.TemplateID
	item.Runtime.TemplateID = item.TemplateID
	item.Runtime.DriverVersion = effective.DriverVersion
	item.Runtime.ManagedID = item.ID
	item.Runtime.ProfileRef = item.ProfileRef
	item.Runtime.WorkspaceMode = workspaceMode
	item.Runtime.EffectivePolicy = resolvedPolicy(effective, timeout, workspaceMode)
	item.Runtime.Parameters = item.Parameters
	item.Runtime.Spec = effective
	item.AppliedSpec = effective
	item.Runtime.Components = item.AppliedComponents
	item.Runtime.VacantTimeout = timeout
	item.Runtime.EphemeralHome = false
	item.Runtime.AttachedClients = 0
	item.Runtime.State = "server-ready"
	item.Runtime.ViewerURL = "/remotexapps/" + item.Runtime.ID + "/kiosk.html"
	if pidFileAlive(filepath.Join(item.Runtime.Runtime, effective.Session.ReadinessPID)) {
		item.Runtime.SessionState = "running"
	} else {
		item.Runtime.SessionState = "stopped"
	}
	// Session transitions intentionally do not rewrite the durable managed
	// registry. Recover the latest generation from the driver's validated,
	// atomically-written status envelope so exit observation remains aligned
	// after manager restart.
	if status, statusErr := readApplicationStatus(item.Runtime.Runtime); statusErr == nil && status.Generation > item.Runtime.SessionGeneration {
		item.Runtime.SessionGeneration = status.Generation
	}
	if item.Runtime.SessionState == "running" && item.Runtime.Shutdown != nil && item.Runtime.Shutdown.Generation == item.Runtime.SessionGeneration {
		switch item.Runtime.Shutdown.State {
		case "blocked", "timeout", "failed":
			item.Runtime.SessionState = "shutdown-blocked"
		}
	}
	item.AppliedDriverVersion = effective.DriverVersion
	item.AvailableDriverVersion = m.cfg.classes[item.TemplateID].DriverVersion
	if item.AppliedDriverVersion != item.AvailableDriverVersion {
		item.UpdateStatus = "update-available"
	} else {
		item.UpdateStatus = "current"
	}
}

func (m *manager) persistManaged(item *managedInstance) error {
	if err := os.MkdirAll(m.managedDir(), 0o700); err != nil {
		return err
	}
	record := managedRegistryRecord{managedInstance: *item}
	spec := item.AppliedSpec
	if spec.ID == "" && item.Runtime != nil {
		spec = item.Runtime.Spec
	}
	if spec.ID != "" {
		record.AppliedSpec = &spec
	}
	components := item.AppliedComponents
	if components.GatewayBinary == "" && item.Runtime != nil {
		components = item.Runtime.Components
	}
	if components.GatewayBinary != "" {
		record.AppliedComponents = &components
	}
	payload, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return err
	}
	payload = append(payload, '\n')
	temporary, err := os.CreateTemp(m.managedDir(), ".managed-*.tmp")
	if err != nil {
		return err
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return err
	}
	if _, err := temporary.Write(payload); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryName, filepath.Join(m.managedDir(), item.ID+".json")); err != nil {
		return err
	}
	return syncDirectory(m.managedDir())
}

func cloneManaged(item *managedInstance) *managedInstance {
	if item == nil {
		return nil
	}
	copy := *item
	if item.Runtime != nil {
		runtimeCopy := *item.Runtime
		copy.Runtime = &runtimeCopy
	}
	return &copy
}

func (m *manager) getManaged(id string) *managedInstance {
	m.managedMu.RLock()
	item := cloneManaged(m.managed[id])
	m.managedMu.RUnlock()
	if item != nil && item.RuntimeInstanceID != "" {
		item.Runtime = m.get(item.RuntimeInstanceID)
	}
	return item
}

func (m *manager) listManaged() []*managedInstance {
	m.managedMu.RLock()
	items := make([]*managedInstance, 0, len(m.managed))
	for _, item := range m.managed {
		items = append(items, cloneManaged(item))
	}
	m.managedMu.RUnlock()
	for _, item := range items {
		if item.RuntimeInstanceID != "" {
			item.Runtime = m.get(item.RuntimeInstanceID)
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].CreatedAt.Before(items[j].CreatedAt) })
	return items
}

func (m *manager) adoptManagedRuntime(runtime *instance) bool {
	if runtime == nil {
		return false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	// A managed registration contains the durable server-layer snapshot used
	// after a manager restart. Once adopted, m.instances is authoritative for
	// live session state and client counts; a periodic reconciliation must not
	// replace it with that older snapshot.
	if _, exists := m.instances[runtime.ID]; exists {
		return false
	}
	runtimeCopy := *runtime
	m.instances[runtime.ID] = &runtimeCopy
	return true
}

func (m *manager) observeManagedRuntime(managedID string, runtime *instance) {
	if m.managedObserver == nil || runtime == nil {
		return
	}
	if err := m.managedObserver.Watch(managedID, runtime); err != nil {
		log.Printf("managed instance %s runtime observation: %v; safety reconciliation remains active", managedID, err)
	}
}

func (m *manager) unobserveManagedRuntime(runtime *instance) {
	if m.managedObserver != nil && runtime != nil {
		m.managedObserver.Unwatch(runtime.ID)
	}
}

func (m *manager) registerManaged(request managedCreateRequest) (*managedInstance, error) {
	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()
	now := time.Now()
	item := &managedInstance{
		ID: request.ID, TemplateID: request.TemplateID, DesiredState: request.DesiredState,
		ProfileRef: request.ProfileRef, Overrides: request.Overrides, CreatedAt: now, UpdatedAt: now,
		Parameters:    request.Parameters,
		ObservedState: "stopped",
	}
	if err := m.validateManaged(item); err != nil {
		return nil, err
	}
	m.managedMu.Lock()
	if _, exists := m.managed[item.ID]; exists {
		m.managedMu.Unlock()
		return nil, fmt.Errorf("managed instance %q already exists", item.ID)
	}
	m.managed[item.ID] = item
	m.managedMu.Unlock()
	if err := m.persistManaged(item); err != nil {
		m.managedMu.Lock()
		delete(m.managed, item.ID)
		m.managedMu.Unlock()
		return nil, err
	}
	if err := m.reconcileManagedLocked(item.ID); err != nil {
		log.Printf("managed instance %s initial reconciliation: %v", item.ID, err)
		return m.getManaged(item.ID), nil
	}
	return m.getManaged(item.ID), nil
}

func (m *manager) setManagedDesiredState(id, desired string, force bool) (*managedInstance, error) {
	if desired != "running" && desired != "stopped" {
		return nil, errors.New("desiredState must be running or stopped")
	}
	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()
	m.managedMu.Lock()
	item := m.managed[id]
	if item == nil {
		m.managedMu.Unlock()
		return nil, errors.New("managed instance not found")
	}
	item.DesiredState = desired
	item.UpdatedAt = time.Now()
	item.Error = ""
	if err := m.persistManaged(item); err != nil {
		m.managedMu.Unlock()
		return nil, err
	}
	m.managedMu.Unlock()
	if err := m.reconcileManagedLocked(id, stopOptions{Reason: "managed-desired-stopped", Scope: "instance", Force: force}); err != nil {
		return m.getManaged(id), err
	}
	return m.getManaged(id), nil
}

func (m *manager) reconcileManagedLocked(id string, requested ...stopOptions) error {
	stop := stopOptions{Reason: "managed-desired-stopped", Scope: "instance"}
	if len(requested) > 0 {
		stop = requested[0]
	}
	m.managedMu.Lock()
	defer m.managedMu.Unlock()
	item := m.managed[id]
	if item == nil {
		return errors.New("managed instance not found")
	}
	// Registration snapshots describe desired configuration, not live session
	// state. Always consult the runtime authority before any lifecycle decision.
	if item.RuntimeInstanceID != "" {
		if current := m.get(item.RuntimeInstanceID); current != nil {
			item.Runtime = current
		}
	}
	if item.DesiredState == "stopped" {
		if item.Runtime != nil && item.Runtime.SessionState == "shutdown-blocked" && !stop.Force {
			if m.adoptManagedRuntime(item.Runtime) && item.Runtime.Shutdown != nil {
				m.observeSession(item.Runtime, item.Runtime.SessionGeneration)
				m.scheduleBlockedShutdown(item.Runtime.ID, item.Runtime.Shutdown.RequestID, stopOptions{
					Reason: item.Runtime.Shutdown.Reason, Scope: item.Runtime.Shutdown.Scope,
				})
			}
			item.ObservedState = "shutdown-blocked"
			return nil
		}
		if item.Runtime != nil && item.Runtime.State != "stopped" {
			m.adoptManagedRuntime(item.Runtime)
			m.unobserveManagedRuntime(item.Runtime)
			if err := m.stopInstanceLocked(item.Runtime, stop); err != nil {
				item.ObservedState, item.Error = "failed", err.Error()
				if isShutdownBlocked(err) {
					item.ObservedState = "shutdown-blocked"
				}
				_ = m.persistManaged(item)
				return err
			}
		}
		changed := item.ObservedState != "stopped" || item.Error != "" || item.RuntimeInstanceID != "" || item.Runtime != nil
		item.ObservedState, item.Error = "stopped", ""
		item.RuntimeInstanceID = ""
		item.Runtime = nil
		if !changed {
			return nil
		}
		item.UpdatedAt = time.Now()
		return m.persistManaged(item)
	}
	if item.Runtime != nil {
		if current := m.get(item.Runtime.ID); current != nil && current.Upgrade != nil && current.Upgrade.Status.Phase != "completed" {
			item.Runtime = current
			item.ObservedState = "upgrade-" + current.Upgrade.Status.Phase
			return nil
		}
		if item.Runtime.SessionState == "running" && !m.recordedSessionAlive(item.Runtime) {
			// The VNC and session cgroup events can arrive in either order.
			// Reconcile the terminal session before considering server recovery.
			if !xDisplayReady(item.Runtime.Display, authorityPath(item.Runtime)) {
				m.setSessionState(item.Runtime.ID, "failed", "X display terminated unexpectedly")
				_ = m.writeApplicationStatus(item.Runtime, item.Runtime.SessionGeneration, "error", "X display terminated unexpectedly", "display-unavailable", true)
				m.persistRuntimeTransition(m.get(item.Runtime.ID), "display-failed")
			} else {
				m.handleSessionExit(item.Runtime.ID, item.Runtime.SessionGeneration, "application exited before managed reconciliation")
			}
			item.Runtime = m.get(item.Runtime.ID)
		}
		if item.Runtime.SessionState == "failed" {
			item.ObservedState, item.Error = "failed", item.Runtime.Error
			return m.persistManaged(item)
		}
	}
	if item.Runtime != nil && managedRuntimeHealthy(item.Runtime) {
		changed := item.ObservedState != "running" || item.Error != "" || item.RuntimeInstanceID != item.Runtime.ID
		item.ObservedState, item.Error = "running", ""
		item.RuntimeInstanceID = item.Runtime.ID
		adopted := m.adoptManagedRuntime(item.Runtime)
		m.observeManagedRuntime(item.ID, item.Runtime)
		if adopted && item.Runtime.SessionState == "running" {
			m.observeSession(item.Runtime, item.Runtime.SessionGeneration)
		} else if adopted && item.Runtime.SessionState == "shutdown-blocked" && item.Runtime.Shutdown != nil {
			m.observeSession(item.Runtime, item.Runtime.SessionGeneration)
			m.scheduleBlockedShutdown(item.Runtime.ID, item.Runtime.Shutdown.RequestID, stopOptions{
				Reason: item.Runtime.Shutdown.Reason, Scope: item.Runtime.Shutdown.Scope,
			})
		}
		if !changed {
			return nil
		}
		item.UpdatedAt = time.Now()
		return m.persistManaged(item)
	}
	var recoveryRequest createRequest
	if item.Runtime != nil {
		// An unhealthy transport is not consent to close a live application.
		// Likewise, an observed terminal failure is not a restart request.
		if item.Runtime.SessionState != "shutdown-blocked" && m.recordedSessionAlive(item.Runtime) {
			item.ObservedState, item.Error = "failed", item.Runtime.Error
			if item.Error == "" {
				item.Error = "runtime requires explicit recovery; application preserved"
			}
			return m.persistManaged(item)
		}
		if item.Runtime.SessionState == "shutdown-blocked" {
			if m.adoptManagedRuntime(item.Runtime) && item.Runtime.Shutdown != nil {
				m.observeSession(item.Runtime, item.Runtime.SessionGeneration)
				m.scheduleBlockedShutdown(item.Runtime.ID, item.Runtime.Shutdown.RequestID, stopOptions{
					Reason: item.Runtime.Shutdown.Reason, Scope: item.Runtime.Shutdown.Scope,
				})
			}
			item.ObservedState = "shutdown-blocked"
			return nil
		}
		if item.Runtime.SessionState != "stopped" {
			m.adoptManagedRuntime(item.Runtime)
			if err := m.stopSession(item.Runtime.ID, stopOptions{Reason: "managed-runtime-recovery", Scope: "instance"}); err != nil {
				if isShutdownBlocked(err) {
					if updated := m.get(item.Runtime.ID); updated != nil {
						item.Runtime = updated
					}
					item.ObservedState, item.Error, item.UpdatedAt = "shutdown-blocked", err.Error(), time.Now()
					_ = m.persistManaged(item)
					return nil
				}
				return err
			}
		}
		recoveryRecord := runtimeManifestRecord{
			DesiredState: item.Runtime.RuntimeDesired, Runtime: *item.Runtime,
			Overrides: item.Runtime.Overrides, ResolvedSpec: item.Runtime.Spec, Components: item.Runtime.Components,
		}
		recoveryRecord.Runtime.State = "restarting"
		recoveryRequest = runtimeRecoveryRequest(&recoveryRecord)
		item.AppliedSpec = recoveryRequest.PinnedSpec
		item.AppliedComponents = recoveryRequest.PinnedComponents
		m.unobserveManagedRuntime(item.Runtime)
		if err := m.stopUnits(item.Runtime); err != nil {
			item.ObservedState, item.Error, item.UpdatedAt = "failed", err.Error(), time.Now()
			_ = m.persistManaged(item)
			return err
		}
		if err := removeRuntimeDirectory(m.cfg.stateDir, item.Runtime.Runtime); err != nil {
			item.ObservedState, item.Error, item.UpdatedAt = "failed", err.Error(), time.Now()
			_ = m.persistManaged(item)
			return err
		}
		m.mu.Lock()
		delete(m.instances, item.Runtime.ID)
		m.mu.Unlock()
	}
	item.ObservedState, item.Error, item.UpdatedAt = "starting", "", time.Now()
	if err := m.persistManaged(item); err != nil {
		return err
	}
	if recoveryRequest.RuntimeID == "" {
		recoveryRequest = createRequest{
			TemplateID: item.TemplateID, ProfileRef: item.ProfileRef, Overrides: item.Overrides, Parameters: item.Parameters, ManagedID: item.ID,
		}
	}
	runtime, err := m.createRecoveryRuntimeLocked(recoveryRequest)
	if err != nil {
		if runtime == nil && recoveryRequest.RuntimeID != "" {
			failed := recoveryRecordRuntime(recoveryRequest, item.Runtime)
			failed.State, failed.SessionState, failed.Error = "failed", "stopped", err.Error()
			failed.AttachedClients = 0
			m.storeRuntime(failed)
			m.persistRuntimeTransition(failed, "managed-locked-recovery-failed")
			runtime = failed
		}
		item.Runtime = runtime
		if runtime != nil {
			item.RuntimeInstanceID = runtime.ID
		}
		item.ObservedState, item.Error, item.UpdatedAt = "failed", err.Error(), time.Now()
		_ = m.persistManaged(item)
		return err
	}
	item.Runtime = runtime
	item.AppliedSpec = runtime.Spec
	item.AppliedComponents = runtime.Components
	item.RuntimeInstanceID = runtime.ID
	item.AppliedDriverVersion = runtime.DriverVersion
	item.AvailableDriverVersion = m.cfg.classes[item.TemplateID].DriverVersion
	item.UpdateStatus = "current"
	item.ObservedState, item.Error, item.UpdatedAt = "running", "", time.Now()
	m.observeManagedRuntime(item.ID, runtime)
	return m.persistManaged(item)
}

func recoveryRecordRuntime(request createRequest, fallback *instance) *instance {
	if fallback != nil {
		copy := *fallback
		return &copy
	}
	return &instance{
		ID: request.RuntimeID, TemplateID: request.TemplateID, ClassID: request.TemplateID,
		ManagedID: request.ManagedID, ProfileRef: request.ProfileRef, Parameters: request.Parameters,
		CreatedAt: request.CreatedAt, Spec: request.PinnedSpec, Components: request.PinnedComponents,
		RuntimeDesired: "running",
	}
}

func managedRuntimeHealthy(item *instance) bool {
	if item == nil || (item.State != "server-ready" && item.State != "ready") {
		return false
	}
	if !xDisplayReady(item.Display, authorityPath(item)) {
		return false
	}
	client := http.Client{Timeout: 500 * time.Millisecond}
	response, err := client.Get("http://" + item.GatewayAddr + "/healthz")
	if err != nil {
		return false
	}
	_ = response.Body.Close()
	return response.StatusCode == http.StatusOK
}

func (m *manager) reconcileManaged() {
	for _, item := range m.listManaged() {
		m.lifecycleMu.Lock()
		if err := m.reconcileManagedLocked(item.ID); err != nil {
			log.Printf("managed instance %s reconciliation: %v", item.ID, err)
		}
		m.lifecycleMu.Unlock()
	}
}

func (m *manager) reconcileManagedLoop(interval time.Duration, jitter bool) {
	for {
		delay := interval
		if jitter {
			// Spread host-manager safety passes over an 80-120% window. Runtime
			// process exits use the event path and do not wait for this timer.
			delay = interval*8/10 + time.Duration(rand.Int63n(int64(interval*4/10)+1))
		}
		timer := time.NewTimer(delay)
		<-timer.C
		m.reconcileManaged()
	}
}

func (m *manager) managedTemplateRegistered(templateID string) bool {
	m.managedMu.RLock()
	defer m.managedMu.RUnlock()
	for _, item := range m.managed {
		if item.TemplateID == templateID {
			return true
		}
	}
	return false
}

func (m *manager) removeManaged(id string, purge bool) error {
	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()
	m.managedMu.Lock()
	item := m.managed[id]
	if item == nil {
		m.managedMu.Unlock()
		return errors.New("managed instance not found")
	}
	runMode := item.AppliedSpec.RunMode
	if runMode == "" {
		runMode = m.cfg.classes[item.TemplateID].RunMode
	}
	if purge && runMode == "user-home" {
		m.managedMu.Unlock()
		return errors.New("runMode user-home cannot be purged")
	}
	if purge {
		for otherID, other := range m.managed {
			if otherID != id && other.TemplateID == item.TemplateID && other.ProfileRef == item.ProfileRef {
				m.managedMu.Unlock()
				return fmt.Errorf("profile is referenced by managed instance %q", otherID)
			}
		}
		m.mu.RLock()
		for _, runtime := range m.instances {
			if runtime.ManagedID != id && runtime.ClassID == item.TemplateID && runtime.ProfileRef == item.ProfileRef && runtime.State != "stopped" && runtime.State != "failed" {
				m.mu.RUnlock()
				m.managedMu.Unlock()
				return fmt.Errorf("profile is in use by runtime %q", runtime.ID)
			}
		}
		m.mu.RUnlock()
	}
	home := filepath.Join(m.cfg.stateDir, "profiles", item.TemplateID, item.ProfileRef)
	if item.Runtime != nil {
		home = item.Runtime.Home
		if item.Runtime.State != "stopped" {
			m.unobserveManagedRuntime(item.Runtime)
			if err := m.stopInstanceLocked(item.Runtime, stopOptions{Reason: "managed-delete", Scope: "instance"}); err != nil {
				m.managedMu.Unlock()
				return err
			}
		}
	}
	if err := os.Remove(filepath.Join(m.managedDir(), id+".json")); err != nil && !errors.Is(err, os.ErrNotExist) {
		m.managedMu.Unlock()
		return err
	}
	delete(m.managed, id)
	m.managedMu.Unlock()
	if purge {
		return removePersistentProfile(m.cfg.stateDir, home)
	}
	return nil
}

func removePersistentProfile(stateDir, home string) error {
	profilesRoot := filepath.Join(stateDir, "profiles")
	relative, err := filepath.Rel(profilesRoot, home)
	if err != nil || relative == "." || relative == "" || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return fmt.Errorf("refusing to purge profile outside profiles root: %q", home)
	}
	return os.RemoveAll(home)
}

func (m *manager) serveManagedInstances(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, m.publicManagedInstances(m.listManaged()))
	case http.MethodPost:
		var request managedCreateRequest
		if err := decodeStrictJSON(r.Body, &request); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
			return
		}
		item, err := m.registerManaged(request)
		if err != nil {
			writeError(w, http.StatusConflict, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, m.publicManagedInstance(item))
	default:
		methodNotAllowed(w, "GET, POST")
	}
}

func (m *manager) serveManagedInstance(w http.ResponseWriter, r *http.Request) {
	id := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/managed-instances/"), "/")
	if id == "" || strings.Contains(id, "/") {
		http.NotFound(w, r)
		return
	}
	switch r.Method {
	case http.MethodGet:
		item := m.getManaged(id)
		if item == nil {
			writeError(w, http.StatusNotFound, "managed instance not found")
			return
		}
		writeJSON(w, http.StatusOK, m.publicManagedInstance(item))
	case http.MethodPatch:
		var request managedPatchRequest
		if err := decodeStrictJSON(r.Body, &request); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
			return
		}
		item, err := m.setManagedDesiredState(id, request.DesiredState, request.Force)
		if err != nil {
			status := http.StatusConflict
			if item == nil && strings.Contains(err.Error(), "not found") {
				status = http.StatusNotFound
			}
			writeError(w, status, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, m.publicManagedInstance(item))
	case http.MethodDelete:
		purge := r.URL.Query().Get("purge") == "true"
		if err := m.removeManaged(id, purge); err != nil {
			if strings.Contains(err.Error(), "not found") {
				writeError(w, http.StatusNotFound, err.Error())
			} else {
				writeError(w, http.StatusInternalServerError, err.Error())
			}
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		methodNotAllowed(w, "GET, PATCH, DELETE")
	}
}

func (m *manager) publicManagedInstance(item *managedInstance) *publicManagedInstanceView {
	if item == nil {
		return nil
	}
	var available *runtimeVersion
	if spec, ok := m.cfg.classes[item.TemplateID]; ok {
		v := versionFor(spec, m.currentComponents())
		available = &v
	}
	return &publicManagedInstanceView{
		AvailableVersion: available,
		ID:               item.ID, TemplateID: item.TemplateID,
		AppliedDriverVersion:   item.AppliedDriverVersion,
		AvailableDriverVersion: item.AvailableDriverVersion,
		UpdateStatus:           item.UpdateStatus, DesiredState: item.DesiredState,
		ObservedState: item.ObservedState, ProfileRef: item.ProfileRef,
		Overrides: item.Overrides, Parameters: item.Parameters,
		RuntimeInstanceID: item.RuntimeInstanceID,
		Runtime:           m.publicInstance(item.Runtime), CreatedAt: item.CreatedAt,
		UpdatedAt: item.UpdatedAt, Error: item.Error,
	}
}

func (m *manager) publicManagedInstances(items []*managedInstance) []*publicManagedInstanceView {
	result := make([]*publicManagedInstanceView, 0, len(items))
	for _, item := range items {
		result = append(result, m.publicManagedInstance(item))
	}
	return result
}

func decodeStrictJSON(reader io.Reader, destination any) error {
	decoder := json.NewDecoder(io.LimitReader(reader, 64<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return err
	}
	return nil
}
