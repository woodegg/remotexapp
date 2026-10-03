package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"syscall"
	"time"
)

const runtimeManifestSchema = 2

// runtimeManifestRecord is the durable active-runtime database. Managed and
// anonymous runtimes use the same record; ManagedID is only a foreign key to
// the separate desired-state registration.
type runtimeManifestRecord struct {
	SchemaVersion int                  `json:"schemaVersion"`
	Backend       string               `json:"backend,omitempty"`
	DesiredState  string               `json:"desiredState"`
	Runtime       instance             `json:"runtime"`
	Overrides     instanceOverrides    `json:"overrides,omitempty"`
	ResolvedSpec  classConfig          `json:"resolvedSpec"`
	AppPackage    *appPackageReference `json:"appPackage,omitempty"`
	Components    runtimeComponents    `json:"components"`
}

func (m *manager) runtimeManifestDir() string {
	return filepath.Join(m.cfg.stateDir, "runtime-manifests")
}

func (m *manager) persistRuntime(item *instance) error {
	// A zero stateDir exists only in focused in-memory manager tests. Production
	// startup always resolves a non-empty state root before constructing manager.
	if m.cfg.stateDir == "" {
		return nil
	}
	if item == nil || !runtimeRef.MatchString(item.ID) {
		return errors.New("runtime with a safe id is required")
	}
	directory := m.runtimeManifestDir()
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return err
	}
	record := runtimeManifestRecord{
		SchemaVersion: runtimeManifestSchema,
		Backend:       m.cfg.lifecycleBackend,
		DesiredState:  item.RuntimeDesired,
		Runtime:       *item,
		Overrides:     item.Overrides,
		ResolvedSpec:  item.Spec,
		AppPackage:    item.Spec.Package,
		Components:    item.Components,
	}
	if record.DesiredState == "" {
		record.DesiredState = "running"
	}
	target := filepath.Join(directory, item.ID+".json")
	if err := m.validateRuntimeManifest(target, &record); err != nil {
		return err
	}
	payload, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return err
	}
	payload = append(payload, '\n')
	temporary, err := os.CreateTemp(directory, ".runtime-*.tmp")
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
	if err := os.Rename(temporaryName, target); err != nil {
		return err
	}
	return syncDirectory(directory)
}

func (m *manager) persistRuntimeTransition(item *instance, transition string) {
	if err := m.persistRuntime(item); err != nil {
		id := "unknown"
		if item != nil {
			id = item.ID
		}
		log.Printf("runtime %s persist %s transition: %v", id, transition, err)
	}
}

func syncDirectory(path string) error {
	directory, err := os.Open(path)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}

func (m *manager) removeRuntimeManifest(id string) error {
	if m.cfg.stateDir == "" {
		return nil
	}
	if !runtimeRef.MatchString(id) {
		return errors.New("runtime id must be a safe lowercase reference")
	}
	path := filepath.Join(m.runtimeManifestDir(), id+".json")
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if _, err := os.Stat(m.runtimeManifestDir()); err == nil {
		return syncDirectory(m.runtimeManifestDir())
	}
	return nil
}

func (m *manager) loadRuntimeManifests() ([]runtimeManifestRecord, error) {
	directory := m.runtimeManifestDir()
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, err
	}
	paths, err := filepath.Glob(filepath.Join(directory, "*.json"))
	if err != nil {
		return nil, err
	}
	sort.Strings(paths)
	records := make([]runtimeManifestRecord, 0, len(paths))
	for _, path := range paths {
		info, err := os.Lstat(path)
		if err != nil {
			return nil, err
		}
		stat, ownerOK := info.Sys().(*syscall.Stat_t)
		if !info.Mode().IsRegular() || info.Mode().Perm() != 0o600 || !ownerOK || int(stat.Uid) != os.Getuid() {
			return nil, fmt.Errorf("load runtime manifest %s: file must be regular, owned by uid %d, and mode 0600", path, os.Getuid())
		}
		file, err := os.Open(path)
		if err != nil {
			return nil, err
		}
		var record runtimeManifestRecord
		decoder := json.NewDecoder(io.LimitReader(file, 512<<10))
		decoder.DisallowUnknownFields()
		err = decoder.Decode(&record)
		if err == nil {
			var extra any
			if extraErr := decoder.Decode(&extra); !errors.Is(extraErr, io.EOF) {
				if extraErr == nil {
					err = errors.New("multiple JSON values")
				} else {
					err = extraErr
				}
			}
		}
		_ = file.Close()
		if err != nil {
			return nil, fmt.Errorf("load runtime manifest %s: %w", path, err)
		}
		if err := m.validateRuntimeManifest(path, &record); err != nil {
			return nil, err
		}
		if err := verifyRuntimeAppPackage(path, &record); err != nil {
			return nil, err
		}
		record.ResolvedSpec.Package = record.AppPackage
		record.Runtime.Spec = record.ResolvedSpec
		record.Runtime.Components = record.Components
		record.Runtime.Overrides = record.Overrides
		record.Runtime.RuntimeDesired = record.DesiredState
		record.Runtime.EphemeralHome = record.Runtime.WorkspaceMode == "ephemeral"
		record.Runtime.VacantTimeout, err = time.ParseDuration(record.ResolvedSpec.Session.VacantTimeout)
		if err != nil || record.Runtime.VacantTimeout <= 0 {
			return nil, fmt.Errorf("load runtime manifest %s: invalid resolved vacant timeout", path)
		}
		records = append(records, record)
	}
	return records, nil
}

func (m *manager) validateRuntimeManifest(path string, record *runtimeManifestRecord) error {
	if record.SchemaVersion != runtimeManifestSchema {
		return fmt.Errorf("load runtime manifest %s: unsupported schemaVersion %d", path, record.SchemaVersion)
	}
	backend := record.Backend
	if backend == "" {
		backend = "systemd"
	}
	current := m.cfg.lifecycleBackend
	if current == "" {
		current = "systemd"
	}
	if backend != current {
		return fmt.Errorf("load runtime manifest %s: lifecycle backend %s does not match %s", path, backend, current)
	}
	if record.DesiredState != "running" && record.DesiredState != "stopped" {
		return fmt.Errorf("load runtime manifest %s: desiredState must be running or stopped", path)
	}
	item := &record.Runtime
	if err := validateUpgrade(item.Upgrade, item.TemplateID); err != nil {
		return err
	}
	if !runtimeRef.MatchString(item.ID) || filepath.Base(path) != item.ID+".json" {
		return fmt.Errorf("load runtime manifest %s: invalid runtime identity", path)
	}
	if item.TemplateID == "" || item.ClassID != item.TemplateID || record.ResolvedSpec.ID != item.TemplateID {
		return fmt.Errorf("load runtime manifest %s: inconsistent template identity", path)
	}
	if item.ManagedID != "" && !safeRef.MatchString(item.ManagedID) {
		return fmt.Errorf("load runtime manifest %s: invalid managed instance id", path)
	}
	if err := normalizeControlConfig(&record.ResolvedSpec.Control); err != nil {
		return fmt.Errorf("load runtime manifest %s: invalid control configuration: %w", path, err)
	}
	if record.ResolvedSpec.APIVersion == "" {
		if record.AppPackage != nil || len(item.Resources) != 0 {
			return fmt.Errorf("load runtime manifest %s: legacy runtime has unexpected App Package metadata", path)
		}
	} else {
		if record.ResolvedSpec.APIVersion != appPackageAPIVersion || record.AppPackage == nil {
			return fmt.Errorf("load runtime manifest %s: incomplete App Package snapshot", path)
		}
		if record.AppPackage.APIVersion != record.ResolvedSpec.APIVersion || record.AppPackage.ID != item.TemplateID || record.AppPackage.Version != item.DriverVersion {
			return fmt.Errorf("load runtime manifest %s: inconsistent App Package identity", path)
		}
		if record.Components.CoreDriverDir == "" {
			return fmt.Errorf("load runtime manifest %s: App Package snapshot has no core driver helper directory", path)
		}
		if len(item.Resources) != len(record.ResolvedSpec.Ports) {
			return fmt.Errorf("load runtime manifest %s: inconsistent App Package resources", path)
		}
		for name, definition := range record.ResolvedSpec.Ports {
			resource, exists := item.Resources[name]
			if !exists || resource.Kind != definition.Kind || resource.Address != "127.0.0.1" || resource.Port < 1024 || resource.Port > 65535 || (definition.Port > 0 && resource.Port != definition.Port) {
				return fmt.Errorf("load runtime manifest %s: invalid App Package resource %q", path, name)
			}
		}
	}
	control := record.ResolvedSpec.Control
	if control.Protocol == "" {
		if item.ControlAddress != "" || item.ControlPort != 0 || item.ControlWebSocketURL != "" {
			return fmt.Errorf("load runtime manifest %s: unexpected control endpoint", path)
		}
	} else {
		if item.ControlPort < 1024 || item.ControlPort > 65535 {
			return fmt.Errorf("load runtime manifest %s: invalid control port", path)
		}
		if item.ControlAddress == "" {
			// rc.18 and older manifests persisted only the allocated loopback port.
			item.ControlAddress = control.Address
		}
		if item.ControlAddress != control.Address {
			return fmt.Errorf("load runtime manifest %s: inconsistent control address", path)
		}
		if item.ControlWebSocketURL != "" {
			endpoint, parseErr := url.Parse(item.ControlWebSocketURL)
			expectedHost := net.JoinHostPort(control.Address, strconv.Itoa(item.ControlPort))
			if parseErr != nil || endpoint.Scheme != "ws" || endpoint.Host != expectedHost || endpoint.Path != control.Path || endpoint.User != nil || endpoint.RawQuery != "" || endpoint.Fragment != "" {
				return fmt.Errorf("load runtime manifest %s: inconsistent legacy control WebSocket URL", path)
			}
		}
	}
	if record.Components.GatewayBinary == "" || record.Components.UnicodeEngine == "" {
		return fmt.Errorf("load runtime manifest %s: incomplete component snapshot", path)
	}
	expectedRuntime := filepath.Join(m.cfg.stateDir, "instances", item.ID)
	if filepath.Clean(item.Runtime) != expectedRuntime {
		return fmt.Errorf("load runtime manifest %s: runtime path is outside the instance root", path)
	}
	socketName := item.ID
	if len(socketName) > 12 {
		socketName = socketName[len(socketName)-12:]
	}
	expectedSocketRuntime := filepath.Join("/run/user", strconv.Itoa(os.Getuid()), "remotexappd", socketName)
	if filepath.Clean(item.SocketRuntime) != expectedSocketRuntime {
		return fmt.Errorf("load runtime manifest %s: inconsistent socket runtime path", path)
	}
	expectedUnits := map[string]string{
		"vnc":     "remotexapp-" + item.ID + "-vnc.service",
		"gateway": "remotexapp-" + item.ID + "-gateway.service",
		"session": "remotexapp-" + item.ID + "-session.service",
	}
	if item.VNCUnit != expectedUnits["vnc"] || item.GatewayUnit != expectedUnits["gateway"] || item.SessionUnit != expectedUnits["session"] {
		return fmt.Errorf("load runtime manifest %s: inconsistent systemd unit names", path)
	}
	if item.ServerUnit != "" && item.ServerUnit != "remotexapp-"+item.ID+"-server.service" {
		return fmt.Errorf("load runtime manifest %s: inconsistent server unit name", path)
	}
	return nil
}

func verifyRuntimeAppPackage(path string, record *runtimeManifestRecord) error {
	if record.AppPackage == nil {
		return nil
	}
	reference := record.AppPackage
	if !filepath.IsAbs(reference.Path) || !validSHA256(reference.ContentSHA256) || (reference.ArchiveSHA256 != "" && !validSHA256(reference.ArchiveSHA256)) {
		return fmt.Errorf("load runtime manifest %s: invalid App Package reference", path)
	}
	class, _, err := loadAppPackageDirectory(reference.Path, reference.ID)
	if err != nil {
		return fmt.Errorf("load runtime manifest %s: verify App Package: %w", path, err)
	}
	if class.Package == nil || class.DriverVersion != reference.Version || class.Package.ContentSHA256 != reference.ContentSHA256 || class.Package.ArchiveSHA256 != reference.ArchiveSHA256 {
		return fmt.Errorf("load runtime manifest %s: App Package snapshot no longer matches", path)
	}
	return nil
}

// bindManagedRuntimeManifests repairs the foreign-key crash window between a
// durable runtime manifest and its managed record. It also repairs duplicate
// manifests written by pre-rc.5 replacement: preserve a live application,
// otherwise trust the managed pointer, a uniquely healthy runtime, or finally
// the newest recoverable snapshot. Stale records are stopped and removed
// before ordinary restoration sees them.
func (m *manager) bindManagedRuntimeManifests(records []runtimeManifestRecord) ([]runtimeManifestRecord, error) {
	groups := make(map[string][]int)
	for i := range records {
		if managedID := records[i].Runtime.ManagedID; managedID != "" {
			groups[managedID] = append(groups[managedID], i)
		}
	}
	removed := make(map[int]bool)
	for managedID, indexes := range groups {
		managed := m.managed[managedID]
		if managed == nil || managed.DesiredState != "running" {
			continue
		}
		if len(indexes) == 1 {
			managed.RuntimeInstanceID = records[indexes[0]].Runtime.ID
			continue
		}
		winner, err := m.selectManagedRuntimeManifest(managed, records, indexes)
		if err != nil {
			return nil, err
		}
		managed.RuntimeInstanceID = records[winner].Runtime.ID
		for _, index := range indexes {
			if index == winner {
				continue
			}
			stale := &records[index].Runtime
			if err := m.stopUnits(stale); err != nil {
				return nil, fmt.Errorf("retire stale managed runtime %s: %w", stale.ID, err)
			}
			if err := removeRuntimeDirectory(m.cfg.stateDir, stale.Runtime); err != nil {
				return nil, fmt.Errorf("retire stale managed runtime %s directory: %w", stale.ID, err)
			}
			if err := m.removeRuntimeManifest(stale.ID); err != nil {
				return nil, fmt.Errorf("retire stale managed runtime %s manifest: %w", stale.ID, err)
			}
			removed[index] = true
			log.Printf("retired stale managed runtime %s in favor of %s for %s", stale.ID, records[winner].Runtime.ID, managedID)
		}
	}
	bound := make([]runtimeManifestRecord, 0, len(records)-len(removed))
	for index, record := range records {
		if !removed[index] {
			bound = append(bound, record)
		}
	}
	return bound, nil
}

func (m *manager) selectManagedRuntimeManifest(managed *managedInstance, records []runtimeManifestRecord, indexes []int) (int, error) {
	live := make([]int, 0, len(indexes))
	for _, index := range indexes {
		if m.recordedSessionAlive(&records[index].Runtime) {
			live = append(live, index)
		}
	}
	if len(live) > 1 {
		return 0, fmt.Errorf("managed instance %s has multiple live application runtimes", managed.ID)
	}
	if len(live) == 1 {
		return live[0], nil
	}
	if managed.RuntimeInstanceID != "" {
		for _, index := range indexes {
			if records[index].Runtime.ID == managed.RuntimeInstanceID {
				return index, nil
			}
		}
	}
	healthy := make([]int, 0, len(indexes))
	for _, index := range indexes {
		if err := m.checkRuntimeAdoption(&records[index].Runtime); err == nil {
			healthy = append(healthy, index)
		}
	}
	if len(healthy) > 1 {
		return 0, fmt.Errorf("managed instance %s has multiple healthy runtimes and no authoritative pointer", managed.ID)
	}
	if len(healthy) == 1 {
		return healthy[0], nil
	}
	winner := indexes[0]
	for _, index := range indexes[1:] {
		candidate, current := records[index].Runtime, records[winner].Runtime
		if candidate.CreatedAt.After(current.CreatedAt) || (candidate.CreatedAt.Equal(current.CreatedAt) && candidate.ID > current.ID) {
			winner = index
		}
	}
	return winner, nil
}

// restoreRuntimeManifests adopts complete healthy runtimes without changing
// their locked driver processes. Only incomplete or unhealthy runtimes are
// stopped and recreated from the immutable snapshot stored in their manifest.
func (m *manager) restoreRuntimeManifests(records []runtimeManifestRecord) {
	for i := range records {
		record := &records[i]
		item := &record.Runtime
		if m.restoreUpgrade(record) {
			continue
		}
		bootRecovery, bootErr := m.prepareBootRecovery(record)
		if bootErr != nil {
			item.State, item.SessionState, item.Error = "failed", "failed", "runtime boot recovery requires explicit intervention"
			_ = m.writeApplicationStatus(item, item.SessionGeneration, "error", "Runtime recovery blocked", item.Error, true)
			m.storeRuntime(item)
			m.persistRuntimeTransition(item, "boot-recovery-rejected")
			log.Printf("runtime %s boot recovery rejected: %v", item.ID, bootErr)
			continue
		}
		if bootRecovery {
			log.Printf("runtime %s recovering pinned resources after system boot change", item.ID)
		}
		if !bootRecovery && item.SessionState == "failed" && item.State != "restarting" && m.runtimeShouldRestore(record) {
			// Keep the failure and its generation across Manager restarts. An
			// observed App/service failure is not an interrupted launch intent.
			m.adoptRuntimeManifest(item)
			continue
		}
		if item.SessionState == "starting" && m.runtimeShouldRestore(record) {
			if m.resumeSessionStartup(item) {
				log.Printf("runtime %s resumed its original session startup generation %d", item.ID, item.SessionGeneration)
				m.persistRuntimeTransition(item, "session-startup-adopted")
			} else {
				item.SessionState, item.Error = "failed", "original session startup did not complete"
				m.markStartupFailure(item, item.SessionGeneration)
				// The original bounded attempt owns this unit; failed startup
				// rolls back that attempt, not a new application generation.
				if _, err := m.stopComponent(item.SessionUnit); err != nil {
					item.Error += "; session cleanup requires explicit recovery"
				}
				m.adoptRuntimeManifest(item)
				m.persistRuntimeTransition(item, "session-startup-recovery-failed")
				continue
			}
		}
		if !bootRecovery && m.runtimeShouldRestore(record) {
			if err := m.checkRuntimeAdoption(item); err == nil {
				if err := m.rememberAdoptedRuntimeBoot(item); err != nil {
					log.Printf("runtime %s could not retain boot identity: %v", item.ID, err)
				}
				m.adoptRuntimeManifest(item)
				log.Printf("runtime %s adopted with locked template %s driver %s", item.ID, item.TemplateID, item.DriverVersion)
				continue
			} else if m.recordedSessionAlive(item) {
				// A transport or helper fault must not silently destroy a live
				// application that may hold unsaved work. Preserve the locked
				// session and let normal managed reconciliation or an explicit
				// operator stop apply the graceful-shutdown policy.
				m.adoptRuntimeManifest(item)
				if item.SessionState != "shutdown-blocked" {
					m.mu.Lock()
					if live := m.instances[item.ID]; live != nil {
						live.Error = "runtime preserved with incomplete adoption health: " + err.Error()
					}
					m.mu.Unlock()
					m.persistRuntimeTransition(m.get(item.ID), "restart-live-session-preserved")
				}
				log.Printf("runtime %s preserved because its locked application session is alive; adoption health: %v", item.ID, err)
				continue
			} else if item.State == "server-ready" && (item.SessionState == "running" || item.SessionState == "shutdown-blocked") {
				// The App can exit while the Manager is offline. Reconcile the
				// same terminal event as the live observer; do not replay launch.
				m.adoptRuntimeManifest(item)
				m.handleSessionExit(item.ID, item.SessionGeneration, "session exited while Manager was unavailable")
				continue
			} else {
				log.Printf("runtime %s cannot be adopted; recovering locked runtime: %v", item.ID, err)
			}
		}
		if err := m.stopUnits(item); err != nil {
			log.Printf("runtime %s recovery cleanup failed: %v", item.ID, err)
			item.State, item.SessionState, item.Error = "failed", "stopped", err.Error()
			if bootRecovery {
				item.SessionState = "failed"
			}
			m.storeRuntime(item)
			m.persistRuntimeTransition(item, "restart-recovery-cleanup-failed")
			continue
		}
		if err := removeRuntimeDirectory(m.cfg.stateDir, item.Runtime); err != nil {
			log.Printf("runtime %s recovery runtime cleanup failed: %v", item.ID, err)
			item.State, item.SessionState, item.Error = "failed", "stopped", err.Error()
			if bootRecovery {
				item.SessionState = "failed"
			}
			m.storeRuntime(item)
			m.persistRuntimeTransition(item, "restart-recovery-runtime-cleanup-failed")
			continue
		}
		// A desired-stopped managed runtime is adopted only while its blocked
		// application is still alive. If that session cannot be preserved, finish
		// cleanup instead of recreating resources that the operator wants stopped.
		if !m.runtimeShouldRecover(record) {
			if item.WorkspaceMode == "ephemeral" {
				if err := removeEphemeralHome(m.cfg.stateDir, item.Home); err != nil {
					item.State, item.SessionState, item.Error = "failed", "stopped", err.Error()
					m.storeRuntime(item)
					m.persistRuntimeTransition(item, "ephemeral-home-cleanup-failed")
					log.Printf("runtime %s complete ephemeral HOME cleanup: %v", item.ID, err)
					continue
				}
			}
			if err := m.removeRuntimeManifest(item.ID); err != nil {
				log.Printf("runtime %s remove inactive manifest: %v", item.ID, err)
			}
			continue
		}
		request := runtimeRecoveryRequest(record)
		if runtime, err := m.createRecoveryRuntimeLocked(request); err != nil {
			log.Printf("runtime %s locked recovery failed: %v", item.ID, err)
			failed := record.Runtime
			if runtime != nil {
				failed = *runtime
			}
			failed.State, failed.SessionState, failed.Error = "failed", "stopped", err.Error()
			if bootRecovery {
				failed.SessionState = "failed"
			}
			failed.AttachedClients = 0
			m.storeRuntime(&failed)
			m.persistRuntimeTransition(&failed, "restart-locked-recovery-failed")
		} else {
			log.Printf("runtime %s recovered from locked template %s driver %s", runtime.ID, runtime.TemplateID, runtime.DriverVersion)
		}
	}
}

func runtimeRecoveryRequest(record *runtimeManifestRecord) createRequest {
	item := &record.Runtime
	generation := item.SessionGeneration
	if item.State == "restarting" {
		// Fence the completed server replacement even for on-attach Apps,
		// whose next session may not start until much later.
		generation++
	}
	return createRequest{
		TemplateID: item.TemplateID, ProfileRef: item.ProfileRef,
		Overrides: record.Overrides, Parameters: item.Parameters,
		ManagedID: item.ManagedID, RuntimeID: item.ID, CreatedAt: item.CreatedAt,
		SessionGeneration: generation, PinnedAllocation: item,
		PinnedSpec: record.ResolvedSpec, PinnedComponents: record.Components,
	}
}

func (m *manager) createRecoveryRuntimeLocked(request createRequest) (*instance, error) {
	if m.runtimeRecoveryCreate != nil {
		return m.runtimeRecoveryCreate(request)
	}
	return m.createLocked(request)
}

func (m *manager) runtimeShouldRestore(record *runtimeManifestRecord) bool {
	if record.Runtime.ManagedID == "" {
		return record.DesiredState == "running"
	}
	m.managedMu.RLock()
	defer m.managedMu.RUnlock()
	managed := m.managed[record.Runtime.ManagedID]
	if managed == nil {
		return false
	}
	if managed.DesiredState == "running" {
		return true
	}
	// A normal managed desired-stop records the operator intent before its
	// graceful hook can report that unsaved work blocks shutdown. The runtime
	// stop intent remains "running" until force is authorized. Preserve and
	// adopt that blocked session across a manager restart; a forced stop that
	// already persisted DesiredState=stopped must instead finish cleanup.
	return record.DesiredState == "running" && record.Runtime.SessionState == "shutdown-blocked"
}

func (m *manager) runtimeShouldRecover(record *runtimeManifestRecord) bool {
	if record.Runtime.ManagedID == "" {
		return record.DesiredState == "running"
	}
	m.managedMu.RLock()
	defer m.managedMu.RUnlock()
	managed := m.managed[record.Runtime.ManagedID]
	return managed != nil && managed.DesiredState == "running"
}

func (m *manager) checkRuntimeAdoption(item *instance) error {
	if m.runtimeAdoptionCheck != nil {
		return m.runtimeAdoptionCheck(item)
	}
	if err := validateRuntimeAdoptionState(item); err != nil {
		return err
	}
	if info, err := os.Stat(item.Runtime); err != nil || !info.IsDir() {
		return errors.New("runtime directory is unavailable")
	}
	lockedPaths := []string{
		item.Components.GatewayBinary,
		item.Components.UnicodeEngine,
		item.Spec.Server.Driver,
		item.Spec.Session.Driver,
	}
	if item.Spec.Session.Status.Mode == "driver" {
		lockedPaths = append(lockedPaths, item.Components.StatusBinary)
	}
	if item.Spec.Session.ShutdownDriver != "" {
		lockedPaths = append(lockedPaths, item.Spec.Session.ShutdownDriver)
	}
	for _, hook := range []string{item.Spec.Session.ViewerAttachDriver, item.Spec.Session.ViewerDetachDriver} {
		if hook != "" {
			lockedPaths = append(lockedPaths, hook)
		}
	}
	for _, path := range lockedPaths {
		info, err := os.Stat(path)
		if path == "" || err != nil || info.IsDir() {
			return fmt.Errorf("locked runtime dependency %s is unavailable", path)
		}
	}
	if item.Spec.APIVersion != "" {
		info, err := os.Stat(item.Components.CoreDriverDir)
		if item.Components.CoreDriverDir == "" || err != nil || !info.IsDir() {
			return fmt.Errorf("locked core driver helper directory %s is unavailable", item.Components.CoreDriverDir)
		}
	}
	for _, unit := range []string{item.VNCUnit, item.ServerUnit, item.GatewayUnit} {
		if unit != "" && !m.componentActive(unit) {
			return fmt.Errorf("required unit %s is not active", unit)
		}
	}
	if !xDisplayReady(item.Display, authorityPath(item)) {
		return errors.New("X display is not ready")
	}
	client := http.Client{Timeout: 500 * time.Millisecond}
	response, err := client.Get("http://" + item.GatewayAddr + "/healthz")
	if err != nil {
		return fmt.Errorf("gateway health: %w", err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("gateway health returned HTTP %d", response.StatusCode)
	}
	for _, name := range item.Spec.Server.ReadinessPIDs {
		if !pidFileAlive(filepath.Join(item.Runtime, name)) {
			return fmt.Errorf("server readiness process %s is not alive", name)
		}
	}
	sessionActive := m.componentActive(item.SessionUnit)
	switch item.SessionState {
	case "stopped":
		if sessionActive {
			return errors.New("session unit is active while manifest says stopped")
		}
	case "running", "shutdown-blocked":
		if !sessionActive || !pidFileAlive(filepath.Join(item.Runtime, item.Spec.Session.ReadinessPID)) {
			return errors.New("recorded session is not healthy")
		}
		if err := m.checkSessionServices(item); err != nil {
			return err
		}
		if !socketExists(filepath.Join(item.SocketRuntime, "unicode.sock")) {
			return errors.New("session Unicode socket is unavailable")
		}
		if item.Spec.Control.Protocol != "" && !portBusy(item.ControlPort) {
			return errors.New("application control socket is unavailable")
		}
	}
	return nil
}

func validateRuntimeAdoptionState(item *instance) error {
	if item == nil || (item.State != "server-ready" && item.State != "ready") {
		return errors.New("runtime is not in a complete server-ready state")
	}
	if item.RuntimeDesired != "running" {
		return errors.New("runtime is not desired running")
	}
	switch item.SessionState {
	case "stopped", "running":
		return nil
	case "shutdown-blocked":
		if item.Shutdown == nil || item.Shutdown.Generation != item.SessionGeneration {
			return errors.New("blocked shutdown metadata is inconsistent")
		}
		switch item.Shutdown.State {
		case "blocked", "timeout", "failed":
		default:
			return errors.New("blocked shutdown outcome is inconsistent")
		}
		return nil
	default:
		return fmt.Errorf("session state %s is incomplete", item.SessionState)
	}
}

func userUnitActive(unit string) bool {
	if unit == "" {
		return false
	}
	_, err := runUserSystemd(3*time.Second, "systemctl", "--user", "is-active", "--quiet", unit)
	return err == nil
}

func (m *manager) recordedSessionAlive(item *instance) bool {
	if m.runtimeSessionAliveCheck != nil {
		return m.runtimeSessionAliveCheck(item)
	}
	if item == nil || (item.SessionState != "running" && item.SessionState != "shutdown-blocked") {
		return false
	}
	if !m.componentActive(item.SessionUnit) {
		return false
	}
	pid, err := readCanonicalPID(filepath.Join(item.Runtime, item.Spec.Session.ReadinessPID))
	if err != nil || !pidFileAlive(filepath.Join(item.Runtime, item.Spec.Session.ReadinessPID)) {
		return false
	}
	_, err = m.inspectCanonicalProcess(m.canonicalProcRoot(), pid, item.SessionUnit)
	return err == nil
}

func (m *manager) adoptRuntimeManifest(item *instance) {
	item.AttachedClients = 0
	if item.SessionState != "shutdown-blocked" && item.SessionState != "failed" {
		item.Error = ""
	}
	m.storeRuntime(item)
	// A restarted Manager has lost every Viewer websocket. Undo any package
	// attach-time inhibition before honoring the existing vacancy policy.
	if item.SessionState == "running" {
		if err := m.runViewerHook(item, false); err != nil {
			log.Printf("instance %s adopted viewer detach hook: %v", item.ID, err)
		}
	}
	if item.ManagedID != "" {
		m.observeManagedRuntime(item.ManagedID, item)
	}
	if item.SessionState == "running" || item.SessionState == "shutdown-blocked" {
		m.observeSession(item, item.SessionGeneration)
	}
	if item.SessionState == "shutdown-blocked" && item.Shutdown != nil {
		m.scheduleBlockedShutdown(item.ID, item.Shutdown.RequestID, stopOptions{
			Reason: item.Shutdown.Reason, Scope: item.Shutdown.Scope,
		})
	}
	if item.State == "server-ready" && item.AttachedClients == 0 && item.SessionState != "shutdown-blocked" && item.Spec.Session.VacantAction != "keep" {
		m.scheduleVacancy(item.ID)
	}
}

func (m *manager) storeRuntime(item *instance) {
	m.mu.Lock()
	m.instances[item.ID] = item
	m.mu.Unlock()
}

func (m *manager) linkManagedRuntimes() error {
	m.managedMu.Lock()
	defer m.managedMu.Unlock()
	for _, managed := range m.managed {
		managed.Runtime = nil
		if managed.RuntimeInstanceID != "" {
			managed.Runtime = m.get(managed.RuntimeInstanceID)
			if managed.Runtime == nil || managed.Runtime.ManagedID != managed.ID {
				managed.RuntimeInstanceID = ""
				managed.Runtime = nil
			} else {
				managed.AppliedSpec = managed.Runtime.Spec
				managed.AppliedComponents = managed.Runtime.Components
				managed.AppliedDriverVersion = managed.Runtime.DriverVersion
			}
		}
		if err := m.persistManaged(managed); err != nil {
			return fmt.Errorf("persist normalized managed instance %s: %w", managed.ID, err)
		}
	}
	return nil
}
