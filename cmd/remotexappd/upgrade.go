package main

import (
	"crypto/sha256"
	"debug/buildinfo"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"math"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/mod/semver"
)

type coreIdentity struct {
	Version string `json:"version"`
	Commit  string `json:"commit"`
	SHA256  string `json:"sha256"`
}
type runtimeVersion struct {
	Core *coreIdentity `json:"core"`
	App  appVersion    `json:"app"`
}
type appVersion struct {
	ID      string `json:"id"`
	Version string `json:"version"`
	SHA256  string `json:"sha256"`
}
type runtimeVersions struct {
	Current         runtimeVersion  `json:"current"`
	Available       *runtimeVersion `json:"available"`
	TargetRevision  string          `json:"targetRevision,omitempty"`
	UpdateAvailable bool            `json:"updateAvailable"`
	Eligible        bool            `json:"eligible"`
	Reason          string          `json:"reason,omitempty"`
}
type upgradeStatus struct {
	ID             string    `json:"id"`
	Phase          string    `json:"phase"`
	TargetRevision string    `json:"targetRevision"`
	ErrorCode      string    `json:"errorCode,omitempty"`
	Message        string    `json:"message,omitempty"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

// This lives only in the private runtime manifest, never the public projection.
type runtimeUpgrade struct {
	Status           upgradeStatus        `json:"status"`
	Target           classConfig          `json:"target"`
	Package          *appPackageReference `json:"package"`
	Components       runtimeComponents    `json:"components"`
	SourceGeneration int64                `json:"sourceGeneration"`
	Force            bool                 `json:"force"`
}
type upgradeRequest struct {
	SessionGeneration *int64 `json:"sessionGeneration"`
	TargetRevision    string `json:"targetRevision"`
	Force             bool   `json:"force,omitempty"`
}

// Distinguish this request's transition failure from an older failed operation
// still present on the runtime returned by a rejected stale request.
type upgradeOperationError struct {
	code string
	err  error
}

func (e *upgradeOperationError) Error() string { return e.err.Error() }
func (e *upgradeOperationError) Unwrap() error { return e.err }

type digestEntry struct {
	Size     int64
	Modified time.Time
	Digest   string
}

var componentDigestCache sync.Map

func componentDigest(path string) (string, error) {
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() {
		return "", errors.New("component file unavailable")
	}
	if v, ok := componentDigestCache.Load(path); ok {
		c := v.(digestEntry)
		if c.Size == info.Size() && c.Modified.Equal(info.ModTime()) {
			return c.Digest, nil
		}
	}
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err = io.Copy(h, f); err != nil {
		return "", err
	}
	result := hex.EncodeToString(h.Sum(nil))
	componentDigestCache.Store(path, digestEntry{info.Size(), info.ModTime(), result})
	return result, nil
}
func contentRevision(v any) string {
	b, _ := json.Marshal(v)
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:])
}
func identifyCore(c runtimeComponents) (*coreIdentity, error) {
	hashes := map[string]string{}
	for name, path := range map[string]string{"gateway": c.GatewayBinary, "status": c.StatusBinary, "engine": c.UnicodeEngine} {
		d, err := componentDigest(path)
		if err != nil {
			return nil, err
		}
		hashes[name] = d
	}
	if c.CoreDriverDir == "" {
		return nil, errors.New("core helpers unavailable")
	}
	err := filepath.WalkDir(c.CoreDriverDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		if d.Type()&os.ModeSymlink != 0 {
			return errors.New("core helper symlink")
		}
		rel, _ := filepath.Rel(c.CoreDriverDir, path)
		hash, err := componentDigest(path)
		if err != nil {
			return err
		}
		hashes["common/"+rel] = hash
		return nil
	})
	if err != nil {
		return nil, err
	}
	id := &coreIdentity{Version: "unknown", Commit: "unknown", SHA256: contentRevision(hashes)}
	// Installed bundles carry VERSION beside the binaries; archives carry it
	// above bin/. Go omits -ldflags with -trimpath, so do not depend on linker
	// flags being recoverable from production binaries.
	binDir := filepath.Dir(c.GatewayBinary)
	versionPaths := []string{filepath.Join(binDir, "VERSION")}
	if filepath.Base(binDir) == "bin" {
		versionPaths = append(versionPaths, filepath.Join(filepath.Dir(binDir), "VERSION"))
	}
	for _, path := range versionPaths {
		if raw, err := os.ReadFile(path); err == nil && semver.IsValid("v"+strings.TrimSpace(string(raw))) {
			id.Version = strings.TrimSpace(string(raw))
			break
		}
	}
	bi, err := buildinfo.ReadFile(filepath.Join(filepath.Dir(c.GatewayBinary), "remotexappd"))
	if err == nil {
		for _, setting := range bi.Settings {
			if setting.Key == "vcs.revision" {
				id.Commit = setting.Value
			}
			if setting.Key == "-ldflags" {
				for _, field := range []struct {
					name string
					out  *string
				}{{"version", &id.Version}, {"commit", &id.Commit}} {
					match := regexp.MustCompile(`(?:^|\s)-X\s+main\.` + field.name + `=([^\s]+)`).FindStringSubmatch(setting.Value)
					if len(match) == 2 {
						*field.out = match[1]
					}
				}
			}
		}
	}
	return id, nil
}
func versionFor(spec classConfig, c runtimeComponents) runtimeVersion {
	identity := c.Identity
	if identity == nil {
		identity, _ = identifyCore(c)
	}
	a := appVersion{ID: spec.ID, Version: spec.DriverVersion}
	if spec.Package != nil {
		a.SHA256 = spec.Package.ContentSHA256
	}
	return runtimeVersion{Core: identity, App: a}
}
func (m *manager) currentComponents() runtimeComponents {
	return runtimeComponents{GatewayBinary: m.cfg.gatewayBinary, StatusBinary: m.cfg.statusBinary, UnicodeEngine: m.cfg.engine, CoreDriverDir: m.cfg.coreDriverDir}
}
func downgrade(a, b string) bool {
	return semver.IsValid("v"+a) && semver.IsValid("v"+b) && semver.Compare("v"+b, "v"+a) < 0
}
func (m *manager) versionView(item *instance) *runtimeVersions {
	v := &runtimeVersions{Current: versionFor(item.Spec, item.Components)}
	target, ok := m.cfg.classes[item.TemplateID]
	if !ok {
		v.Reason = "template is not enabled"
		return v
	}
	available := versionFor(target, m.currentComponents())
	v.Available = &available
	if available.Core == nil || available.Core.Version == "unknown" || target.Package == nil {
		v.Reason = "available release identity is unavailable"
		return v
	}
	v.TargetRevision = contentRevision(struct {
		Version runtimeVersion
		Spec    classConfig
	}{available, target})
	v.UpdateAvailable = contentRevision(v.Current) != contentRevision(available)
	if downgrade(v.Current.App.Version, available.App.Version) || (v.Current.Core != nil && downgrade(v.Current.Core.Version, available.Core.Version)) {
		v.Reason = "selected version is a downgrade"
		return v
	}
	if item.Upgrade != nil && (item.Upgrade.Status.Phase == "stopping" || item.Upgrade.Status.Phase == "launching") {
		v.Reason = "upgrade in progress"
		return v
	}
	if item.State != "server-ready" && item.State != "ready" && !(item.Upgrade != nil && (item.Upgrade.Status.Phase == "failed" || item.Upgrade.Status.Phase == "blocked")) {
		v.Reason = "runtime is not upgradeable in its current state"
		return v
	}
	if !v.UpdateAvailable && !(item.Upgrade != nil && item.Upgrade.Status.Phase == "failed") {
		v.Reason = "already current"
		return v
	}
	if item.ManagedID != "" {
		managed := m.getManaged(item.ManagedID)
		if managed == nil || managed.DesiredState != "running" {
			v.Reason = "managed desiredState must be running"
			return v
		}
	}
	if err := m.preflightUpgrade(item, target); err != nil {
		v.Reason = "target policy, inputs or dependencies are incompatible"
		return v
	}
	v.Eligible = true
	return v
}
func publicUpgrade(item *instance) *upgradeStatus {
	if item == nil || item.Upgrade == nil {
		return nil
	}
	s := item.Upgrade.Status
	return &s
}
func (m *manager) setUpgrade(item *instance, u *runtimeUpgrade, phase, code, message string) error {
	copy := *u
	copy.Status.Phase = phase
	copy.Status.ErrorCode = code
	copy.Status.Message = message
	copy.Status.UpdatedAt = time.Now()
	item = m.get(item.ID)
	if item == nil {
		return errors.New("runtime disappeared")
	}
	item.Upgrade = &copy
	if err := m.persistRuntime(item); err != nil {
		return err
	}
	m.storeRuntime(item)
	return nil
}
func (m *manager) preflightUpgrade(item *instance, target classConfig) error {
	if target.Package == nil {
		return errors.New("upgrade requires an immutable App Package")
	}
	loaded, _, err := loadAppPackageDirectory(target.Package.Path, target.ID)
	if err != nil {
		return errors.New("target package or dependencies unavailable")
	}
	if loaded.Package.ContentSHA256 != target.Package.ContentSHA256 {
		return errors.New("target package identity changed")
	}
	resolved, _, workspace, err := applyOverrides(target, item.Overrides)
	if err != nil {
		return err
	}
	if resolved.RunMode != item.Spec.RunMode || workspace != item.WorkspaceMode {
		return errors.New("upgrade cannot change HOME isolation or persistence mode")
	}
	if item.ManagedID != "" && (workspace != "persistent" || resolved.Session.VacantAction == "stop-instance") {
		return errors.New("managed target requires persistent HOME and keep/stop-session vacancy")
	}
	if resolved.RunMode == "user-home" && item.ProfileRef != resolved.ProfileRef {
		return errors.New("target profile is incompatible")
	}
	if resolved.RunMode == "user-home" && (item.ManagedID == "" || m.cfg.vncLauncher != "direct") {
		return errors.New("user-home requires a managed runtime and direct VNC launcher")
	}
	if _, err := resolveLaunchParameters(target.Parameters, item.Parameters, m.cfg.documentRoots); err != nil {
		return err
	}
	if item.SessionGeneration >= math.MaxInt64-1 {
		return errors.New("session generation exhausted")
	}
	if resolved.Server.DisplayMode == "fixed" {
		s := resolved.Server
		if m.fixedUpgradeAllocationBusy(item, s) {
			return errors.New("target fixed display or ports are occupied")
		}
	}
	for name, resource := range resolved.Ports {
		if resource.Port > 0 && item.Resources[name].Port != resource.Port && m.controlPortBusyExcept(resource.Port, item.ID) {
			return errors.New("target control port is occupied")
		}
	}
	if existing, active, err := m.createConflict(resolved, createRequest{RuntimeID: item.ID, ManagedID: item.ManagedID}); err != nil {
		return err
	} else if existing != nil {
		return errors.New("another runtime owns the target singleton")
	} else if m.cfg.maxInstances > 0 && active >= m.cfg.maxInstances {
		return errors.New("target exceeds active instance limit")
	}
	return nil
}

func (m *manager) fixedUpgradeAllocationBusy(item *instance, target serverClassConfig) bool {
	display := ":" + strconv.Itoa(target.Display)
	address := func(port int) string { return net.JoinHostPort("127.0.0.1", strconv.Itoa(port)) }
	rfb, gateway := address(target.RFBPort), address(target.GatewayPort)
	// Reserved-but-not-listening allocations count, except this exact runtime.
	m.mu.RLock()
	for id, other := range m.instances {
		if id != item.ID && other.State != "stopped" && other.State != "failed" {
			if other.Display == display || other.RFBAddr == rfb || other.GatewayAddr == rfb || other.RFBAddr == gateway || other.GatewayAddr == gateway {
				m.mu.RUnlock()
				return true
			}
			for _, resource := range other.Resources {
				if resource.Port == target.RFBPort || resource.Port == target.GatewayPort {
					m.mu.RUnlock()
					return true
				}
			}
		}
	}
	m.mu.RUnlock()
	if item.Display != display {
		if _, err := os.Stat("/tmp/.X11-unix/X" + strconv.Itoa(target.Display)); err == nil {
			return true
		}
	}
	for _, port := range []int{target.RFBPort, target.GatewayPort} {
		own := address(port) == item.RFBAddr || address(port) == item.GatewayAddr || port == item.ControlPort
		for _, resource := range item.Resources {
			own = own || resource.Port == port
		}
		if !own && loopbackListenerActive(port) {
			return true
		}
	}
	return false
}

func (m *manager) upgradeRuntime(id string, r upgradeRequest) (*instance, error) {
	// Do not queue a destructive command behind another lifecycle transition:
	// its confirmation may no longer describe the runtime when that finishes.
	if !m.lifecycleMu.TryLock() {
		return m.get(id), errors.New("a lifecycle operation is already in progress")
	}
	defer m.lifecycleMu.Unlock()
	item := m.get(id)
	if item == nil {
		return nil, errors.New("instance not found")
	}
	if r.SessionGeneration == nil || *r.SessionGeneration != item.SessionGeneration {
		return item, errors.New("stale session generation")
	}
	if item.ManagedID != "" {
		managed := m.getManaged(item.ManagedID)
		if managed == nil || managed.DesiredState != "running" {
			return item, errors.New("managed desiredState must be running")
		}
	}
	v := m.versionView(item)
	if !v.Eligible {
		return item, errors.New(v.Reason)
	}
	if r.TargetRevision != v.TargetRevision {
		return item, errors.New("stale target revision")
	}
	target := m.cfg.classes[item.TemplateID]
	if err := m.preflightUpgrade(item, target); err != nil {
		return item, err
	}
	c := m.currentComponents()
	c.Identity = v.Available.Core
	operationID, err := randomID("upgrade")
	if err != nil {
		return item, err
	}
	u := &runtimeUpgrade{Status: upgradeStatus{ID: operationID, TargetRevision: r.TargetRevision}, Target: target, Package: target.Package, Components: c, SourceGeneration: item.SessionGeneration, Force: r.Force}
	if err = m.setUpgrade(item, u, "stopping", "", ""); err != nil {
		return item, &upgradeOperationError{code: "record-failed", err: err}
	}
	return m.continueUpgrade(m.get(id))
}
func (m *manager) continueUpgrade(item *instance) (*instance, error) {
	u := item.Upgrade
	fail := func(phase, code string, err error) (*instance, error) {
		if e := m.setUpgrade(item, u, phase, code, "Runtime upgrade did not complete"); e != nil {
			return m.get(item.ID), &upgradeOperationError{code: "record-failed", err: e}
		}
		current := m.get(item.ID)
		m.updateManagedAfterRuntimeRestart(current.ManagedID, current, err)
		return current, &upgradeOperationError{code: code, err: err}
	}
	// Verify frozen files again after a crash, before touching any application.
	if err := m.preflightUpgrade(item, u.Target); err != nil {
		return fail("failed", "target-invalid", err)
	}
	actual, err := identifyCore(u.Components)
	if err != nil || contentRevision(actual) != contentRevision(u.Components.Identity) {
		return fail("failed", "target-invalid", errors.New("frozen core identity changed"))
	}
	stop := m.stopInstanceLocked
	if m.runtimeRestartStop != nil {
		stop = m.runtimeRestartStop
	}
	if err := stop(item, stopOptions{Reason: "api-upgrade", Scope: "instance", Force: u.Force, PreserveRuntime: true}); err != nil {
		if isShutdownBlocked(err) {
			return fail("blocked", "shutdown-blocked", err)
		}
		return fail("failed", "cleanup-failed", err)
	}
	// Cleanup succeeded: the old runtime no longer owns live allocations.
	// PreserveRuntime leaves it "restarting" for ordinary pinned restart,
	// but upgrade allocates from the new template and must not collide with
	// that old in-memory reservation. Other owners and live sockets still count.
	// setUpgrade durably records this state with the launching intent.
	m.setState(item.ID, "stopped", "", "")
	if err := m.setUpgrade(item, u, "launching", "", ""); err != nil {
		return m.get(item.ID), &upgradeOperationError{code: "record-failed", err: err}
	}
	item = m.get(item.ID)
	u = item.Upgrade
	request := createRequest{TemplateID: item.TemplateID, ProfileRef: item.ProfileRef, Parameters: item.Parameters, Overrides: item.Overrides, ManagedID: item.ManagedID, RuntimeID: item.ID, CreatedAt: item.CreatedAt, SessionGeneration: item.SessionGeneration + 1, PinnedSpec: u.Target, PinnedComponents: u.Components, Upgrade: u}
	runtime, err := m.createRecoveryRuntimeLocked(request)
	if err != nil {
		m.setState(item.ID, "failed", "", "Runtime upgrade launch failed")
		return fail("failed", "launch-failed", err)
	}
	if err = m.setUpgrade(runtime, u, "completed", "", ""); err != nil {
		return m.get(item.ID), &upgradeOperationError{code: "record-failed", err: err}
	}
	runtime = m.get(item.ID)
	m.updateManagedAfterRuntimeRestart(runtime.ManagedID, runtime, nil)
	return runtime, nil
}
func (m *manager) serveUpgrade(w http.ResponseWriter, r *http.Request, item *instance) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method == http.MethodGet {
		writeJSON(w, 200, map[string]any{"versions": m.versionView(item), "upgrade": publicUpgrade(item)})
		return
	}
	if r.Method != http.MethodPost {
		methodNotAllowed(w, "GET, POST")
		return
	}
	var request upgradeRequest
	if err := decodeStrictJSON(r.Body, &request); err != nil || request.SessionGeneration == nil || *request.SessionGeneration < 0 || !validSHA256(request.TargetRevision) {
		writeError(w, 400, "sessionGeneration and targetRevision are required")
		return
	}
	result, err := m.upgradeRuntime(item.ID, request)
	if err != nil {
		code := "preflight-failed"
		status := http.StatusConflict
		var operationError *upgradeOperationError
		if errors.As(err, &operationError) {
			code = operationError.code
			if code == "record-failed" {
				status = http.StatusInternalServerError
			}
		}
		writeJSON(w, status, map[string]any{"error": err.Error(), "code": code, "instance": m.publicInstance(result)})
		return
	}
	writeJSON(w, 200, m.publicInstance(result))
}

// Recovery owns the same runtime manifest: never create a second upgrade DB.
func (m *manager) restoreUpgrade(record *runtimeManifestRecord) bool {
	item := &record.Runtime
	u := item.Upgrade
	if u == nil {
		return false
	}
	if !m.runtimeShouldRecover(record) {
		return false
	}
	if u.Status.Phase == "completed" {
		return false
	}
	m.storeRuntime(item)
	if u.Status.Phase == "blocked" || u.Status.Phase == "failed" {
		if m.recordedSessionAlive(item) {
			m.adoptRuntimeManifest(item)
		}
		return true
	}
	if u.Status.Phase == "launching" && contentRevision(item.Components) == contentRevision(u.Components) && item.DriverVersion == u.Target.DriverVersion {
		if item.SessionState == "starting" {
			if !m.resumeSessionStartup(item) {
				item.SessionState, item.Error = "failed", "original upgrade startup did not complete"
				_, _ = m.stopComponent(item.SessionUnit)
				m.storeRuntime(item)
				if err := m.setUpgrade(item, u, "failed", "launch-failed", item.Error); err != nil {
					log.Printf("runtime %s failed upgrade startup record: %v", item.ID, err)
				}
				return true
			}
		}
		if m.checkRuntimeAdoption(item) == nil || m.recordedSessionAlive(item) {
			m.adoptRuntimeManifest(item)
			if err := m.setUpgrade(item, u, "completed", "", ""); err != nil {
				log.Printf("runtime %s upgrade completion record: %v", item.ID, err)
			}
			return true
		}
	}
	if _, err := m.continueUpgrade(item); err != nil {
		log.Printf("runtime %s upgrade recovery: %v", item.ID, err)
		// Preflight or shutdown can fail while the old application survives.
		// Startup must still restore its exit observation and host policy timers.
		if current := m.get(item.ID); m.recordedSessionAlive(current) {
			m.adoptRuntimeManifest(current)
		}
	}
	return true
}

func validateUpgrade(u *runtimeUpgrade, id string) error {
	if u == nil {
		return nil
	}
	if u.Target.Package == nil {
		u.Target.Package = u.Package
	}
	if !runtimeRef.MatchString(u.Status.ID) || !validSHA256(u.Status.TargetRevision) || u.Target.ID == "" || u.Target.Package == nil || u.Target.ID != id || u.SourceGeneration < 0 || u.Components.Identity == nil || !validSHA256(u.Components.Identity.SHA256) {
		return errors.New("invalid upgrade record")
	}
	if u.Package == nil || u.Package.ID != id || u.Package.Version != u.Target.DriverVersion || u.Package.APIVersion != appPackageAPIVersion || !validSHA256(u.Package.ContentSHA256) || !filepath.IsAbs(u.Package.Path) {
		return errors.New("invalid upgrade package identity")
	}
	if !strings.Contains("|stopping|launching|completed|blocked|failed|", "|"+u.Status.Phase+"|") {
		return fmt.Errorf("invalid upgrade phase %q", u.Status.Phase)
	}
	return nil
}
