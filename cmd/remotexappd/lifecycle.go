package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/woodegg/remotexapp/internal/sessionstartup"
)

func (m *manager) create(request createRequest) (*instance, error) {
	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()
	return m.createLocked(request)
}

func (m *manager) createLocked(request createRequest) (*instance, error) {
	templateID, err := resolveTemplateID(request)
	if err != nil {
		return nil, err
	}
	template, ok := m.cfg.classes[templateID]
	if request.PinnedSpec.ID != "" {
		if request.PinnedSpec.ID != templateID {
			return nil, errors.New("pinned driver template does not match templateId")
		}
		template = request.PinnedSpec
		ok = true
	}
	if !ok {
		return nil, fmt.Errorf("unsupported templateId %q", templateID)
	}
	class, vacantTimeout, workspaceMode, err := applyOverrides(template, request.Overrides)
	if err != nil {
		return nil, err
	}
	components := runtimeComponents{GatewayBinary: m.cfg.gatewayBinary, StatusBinary: m.cfg.statusBinary, UnicodeEngine: m.cfg.engine, CoreDriverDir: m.cfg.coreDriverDir}
	if request.PinnedComponents.GatewayBinary != "" {
		components = request.PinnedComponents
	}
	if components.Identity == nil {
		components.Identity, _ = identifyCore(components)
	}
	parameters, err := resolveLaunchParameters(template.Parameters, request.Parameters, m.cfg.documentRoots)
	if err != nil {
		return nil, err
	}
	if request.ProfileRef == "" {
		request.ProfileRef = class.ProfileRef
	}
	if !safeRef.MatchString(request.ProfileRef) {
		return nil, errors.New("profileRef must match [a-z0-9][a-z0-9-]{0,63}")
	}
	if class.RunMode == "user-home" && request.ManagedID == "" {
		return nil, errors.New("runMode user-home requires a managed instance")
	}
	if class.RunMode == "user-home" && m.cfg.vncLauncher != "direct" {
		return nil, errors.New("runMode user-home requires the direct VNC launcher")
	}
	if class.RunMode == "user-home" && request.ProfileRef != class.ProfileRef {
		return nil, errors.New("runMode user-home does not allow selecting another profileRef")
	}
	existing, activeInstances, err := m.createConflict(class, request)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return existing, nil
	}
	if m.cfg.maxInstances > 0 && activeInstances >= m.cfg.maxInstances {
		return nil, fmt.Errorf("active instance limit %d reached", m.cfg.maxInstances)
	}
	display, rfbPort, gatewayPort, controlPort, resources, err := m.allocateRuntimeRequest(class, request.PinnedAllocation)
	if err != nil {
		return nil, err
	}

	id := request.RuntimeID
	if id == "" {
		id, err = randomID(class.ID)
		if err != nil {
			return nil, err
		}
	} else if !runtimeRef.MatchString(id) {
		return nil, errors.New("restored runtime id must be a safe lowercase reference")
	}
	runtimeDir := filepath.Join(m.cfg.stateDir, "instances", id)
	socketName := id
	if len(socketName) > 12 {
		socketName = socketName[len(socketName)-12:]
	}
	socketRuntime := filepath.Join("/run/user", strconv.Itoa(os.Getuid()), "remotexappd", socketName)
	profileDir := filepath.Join(m.cfg.stateDir, "profiles", class.ID, request.ProfileRef)
	if class.RunMode == "isolated" {
		profileDir = filepath.Join(profileDir, id)
	} else if class.RunMode == "user-home" {
		profileDir, err = resolveUserHome()
		if err != nil {
			return nil, err
		}
	}
	directories := []string{runtimeDir, socketRuntime}
	if class.RunMode != "user-home" {
		directories = append(directories, profileDir, filepath.Join(profileDir, ".config"), filepath.Join(profileDir, ".cache"), filepath.Join(profileDir, ".local", "share"))
	}
	for _, directory := range directories {
		if err := os.MkdirAll(directory, 0o700); err != nil {
			return nil, err
		}
	}
	if _, err := writeLaunchParameters(runtimeDir, parameters); err != nil {
		return nil, fmt.Errorf("write launch parameters: %w", err)
	}
	if err := writeAppLaunchContract(runtimeDir, class, resources); err != nil {
		return nil, fmt.Errorf("write App Package launch contract: %w", err)
	}
	if class.Session.Status.Mode == "driver" {
		if err := writeStatusSchema(runtimeDir, class.Session.Status.Details, class.Session.Status.PrivateDetails); err != nil {
			return nil, fmt.Errorf("write status schema: %w", err)
		}
	}
	createdAt := request.CreatedAt
	if createdAt.IsZero() {
		createdAt = time.Now()
	}
	controlAddress := ""
	controlWebSocketURL := ""
	if class.Control.Protocol != "" {
		controlAddress = class.Control.Address
	}
	item := &instance{
		Upgrade: request.Upgrade,
		ID:      id, ClassID: templateID, TemplateID: templateID, DriverVersion: class.DriverVersion, ManagedID: request.ManagedID,
		ProfileRef: request.ProfileRef, WorkspaceMode: workspaceMode, State: "starting", SessionState: "stopped",
		EffectivePolicy: resolvedPolicy(class, vacantTimeout, workspaceMode),
		Parameters:      parameters, SessionGeneration: request.SessionGeneration,
		Display: ":" + strconv.Itoa(display), ControlAddress: controlAddress, ControlPort: controlPort, ControlWebSocketURL: controlWebSocketURL, Resources: resources, CreatedAt: createdAt, Home: profileDir,
		Runtime: runtimeDir, SocketRuntime: socketRuntime, RFBAddr: net.JoinHostPort("127.0.0.1", strconv.Itoa(rfbPort)),
		GatewayAddr: net.JoinHostPort("127.0.0.1", strconv.Itoa(gatewayPort)),
		VNCUnit:     "remotexapp-" + id + "-vnc.service", GatewayUnit: "remotexapp-" + id + "-gateway.service",
		SessionUnit: "remotexapp-" + id + "-session.service",
		Spec:        class, Components: components, VacantTimeout: vacantTimeout, EphemeralHome: workspaceMode == "ephemeral", Overrides: request.Overrides, RuntimeDesired: "running",
	}
	if class.RunMode == "user-home" {
		item.XAuthority = filepath.Join(profileDir, ".Xauthority")
	}
	if m.cfg.vncLauncher == "direct" {
		item.ServerUnit = "remotexapp-" + id + "-server.service"
	}
	if err := m.writeRuntimeBoot(item); err != nil {
		return nil, fmt.Errorf("record runtime boot identity: %w", err)
	}
	if err := m.writeApplicationStatus(item, item.SessionGeneration, "stopped", "Session has not started", "", false); err != nil {
		return nil, fmt.Errorf("initialize application status: %w", err)
	}
	if err := m.persistRuntime(item); err != nil {
		return nil, fmt.Errorf("persist creating runtime: %w", err)
	}
	m.mu.Lock()
	m.instances[id] = item
	m.mu.Unlock()
	if err := m.startServer(item); err != nil {
		m.setState(id, "failed", "", err.Error())
		_ = m.stopUnits(item)
		m.persistRuntimeTransition(m.get(id), "server-start-failed")
		return m.get(id), err
	}
	m.setState(id, "server-ready", "/remotexapps/"+item.ID+"/kiosk.html", "")
	if err := m.persistRuntime(m.get(id)); err != nil {
		_ = m.stopUnits(item)
		m.setState(id, "failed", "", err.Error())
		return m.get(id), fmt.Errorf("persist ready runtime: %w", err)
	}
	if class.Session.Activation == "immediate" {
		if err := m.startSession(id); err != nil {
			m.setState(id, "failed", "", err.Error())
			_ = m.stopUnits(item)
			m.persistRuntimeTransition(m.get(id), "immediate-session-start-failed")
			return m.get(id), err
		}
	}
	if class.Session.VacantAction == "stop-instance" {
		m.scheduleVacancy(id)
	}
	return m.get(id), nil
}

func (m *manager) createConflict(class classConfig, request createRequest) (*instance, int, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	activeInstances := 0
	for id, existing := range m.instances {
		// Runtime recovery and API restart deliberately replace this exact
		// in-memory record. It must still see conflicts from every other runtime.
		if request.RuntimeID != "" && id == request.RuntimeID {
			continue
		}
		if existing.State != "stopped" && existing.State != "failed" {
			existingSpec := m.specFor(existing)
			if class.RunMode == "user-home" && existingSpec.RunMode == "user-home" {
				return nil, 0, errors.New("another active instance already owns the current Unix user HOME")
			}
			activeInstances++
		}
		if existing.ClassID == class.ID && existing.State != "stopped" && existing.State != "failed" && class.Singleton && request.ManagedID == "" {
			copy := *existing
			return &copy, activeInstances, nil
		}
	}
	return nil, activeInstances, nil
}

func (m *manager) allocateRuntimeRequest(class classConfig, pinned *instance) (int, int, int, int, map[string]allocatedResource, error) {
	if pinned == nil {
		display, rfbPort, gatewayPort, controlPort, err := m.allocateRuntime(class)
		if err != nil {
			return 0, 0, 0, 0, nil, err
		}
		resources, err := m.allocateNamedResources(class.Ports)
		return display, rfbPort, gatewayPort, controlPort, resources, err
	}
	display, err := strconv.Atoi(strings.TrimPrefix(pinned.Display, ":"))
	if err != nil || display < 1 || display > 99 || pinned.Display != ":"+strconv.Itoa(display) {
		return 0, 0, 0, 0, nil, errors.New("pinned runtime has an invalid display allocation")
	}
	rfbPort, err := pinnedLoopbackPort(pinned.RFBAddr)
	if err != nil {
		return 0, 0, 0, 0, nil, fmt.Errorf("pinned RFB allocation: %w", err)
	}
	gatewayPort, err := pinnedLoopbackPort(pinned.GatewayAddr)
	if err != nil {
		return 0, 0, 0, 0, nil, fmt.Errorf("pinned gateway allocation: %w", err)
	}
	if class.Server.DisplayMode == "fixed" && (display != class.Server.Display || rfbPort != class.Server.RFBPort || gatewayPort != class.Server.GatewayPort) {
		return 0, 0, 0, 0, nil, errors.New("pinned fixed display allocation does not match the locked template")
	}
	if m.runtimeBusyExcept(display, rfbPort, gatewayPort, pinned.ID) {
		return 0, 0, 0, 0, nil, errors.New("pinned display allocation is still busy")
	}
	controlPort := 0
	if class.Control.Protocol != "" {
		controlPort = pinned.ControlPort
		if controlPort < 1024 || controlPort > 65535 || pinned.ControlAddress != class.Control.Address || m.controlPortBusyExcept(controlPort, pinned.ID) {
			return 0, 0, 0, 0, nil, errors.New("pinned control allocation is invalid or busy")
		}
	} else if pinned.ControlPort != 0 || pinned.ControlAddress != "" {
		return 0, 0, 0, 0, nil, errors.New("pinned runtime has an unexpected legacy control allocation")
	}
	if len(pinned.Resources) != len(class.Ports) {
		return 0, 0, 0, 0, nil, errors.New("pinned App resource allocation does not match the locked template")
	}
	resources := make(map[string]allocatedResource, len(pinned.Resources))
	seen := make(map[int]bool, len(pinned.Resources)+1)
	if controlPort != 0 {
		seen[controlPort] = true
	}
	for name, definition := range class.Ports {
		resource, ok := pinned.Resources[name]
		if !ok || resource.Kind != definition.Kind || resource.Address != "127.0.0.1" || resource.Port < 1024 || resource.Port > 65535 || (definition.Port > 0 && resource.Port != definition.Port) || seen[resource.Port] || m.controlPortBusyExcept(resource.Port, pinned.ID) {
			return 0, 0, 0, 0, nil, fmt.Errorf("pinned App resource %q is invalid or busy", name)
		}
		seen[resource.Port] = true
		resources[name] = resource
	}
	return display, rfbPort, gatewayPort, controlPort, resources, nil
}

func pinnedLoopbackPort(address string) (int, error) {
	host, rawPort, err := net.SplitHostPort(address)
	if err != nil || host != "127.0.0.1" {
		return 0, errors.New("address must use 127.0.0.1 and a TCP port")
	}
	port, err := strconv.Atoi(rawPort)
	if err != nil || port < 1024 || port > 65535 {
		return 0, errors.New("port must be between 1024 and 65535")
	}
	return port, nil
}

func (m *manager) restartRuntime(id string, request restartRequest) (*instance, error) {
	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()
	item := m.get(id)
	if item == nil {
		return nil, errors.New("instance not found")
	}
	if item.Upgrade != nil && item.Upgrade.Status.Phase != "completed" {
		return item, errors.New("runtime upgrade requires reconciliation; ordinary restart is unavailable")
	}
	if request.SessionGeneration == nil || *request.SessionGeneration < 0 {
		return item, errors.New("sessionGeneration is required and must be non-negative")
	}
	if item.SessionGeneration != *request.SessionGeneration {
		return item, fmt.Errorf("stale session generation %d; current generation is %d", *request.SessionGeneration, item.SessionGeneration)
	}
	if item.State != "server-ready" && item.State != "ready" {
		return item, fmt.Errorf("instance is not restartable from state %q", item.State)
	}
	if item.ManagedID != "" {
		managed := m.getManaged(item.ManagedID)
		if managed == nil || managed.DesiredState != "running" {
			return item, errors.New("managed runtime restart requires desiredState running")
		}
	}
	pinned := *item
	pinned.Resources = cloneResources(item.Resources)
	pinned.State = "restarting"
	record := runtimeManifestRecord{
		DesiredState: item.RuntimeDesired, Runtime: pinned, Overrides: item.Overrides,
		ResolvedSpec: item.Spec, AppPackage: item.Spec.Package, Components: item.Components,
	}
	recovery := runtimeRecoveryRequest(&record)
	stop := m.stopInstanceLocked
	if m.runtimeRestartStop != nil {
		stop = m.runtimeRestartStop
	}
	if err := stop(item, stopOptions{Reason: "api-restart", Scope: "instance", Force: request.Force, PreserveRuntime: true}); err != nil {
		return m.get(id), err
	}
	runtime, err := m.createRecoveryRuntimeLocked(recovery)
	if err != nil {
		if runtime == nil {
			failed := pinned
			failed.SessionGeneration = recovery.SessionGeneration
			failed.State, failed.SessionState, failed.Error = "failed", "stopped", err.Error()
			failed.AttachedClients = 0
			failed.RuntimeDesired = "running"
			m.storeRuntime(&failed)
			m.persistRuntimeTransition(&failed, "api-restart-recovery-failed")
			runtime = &failed
		}
		m.updateManagedAfterRuntimeRestart(item.ManagedID, runtime, err)
		return runtime, err
	}
	m.updateManagedAfterRuntimeRestart(item.ManagedID, runtime, nil)
	return runtime, nil
}

func cloneResources(resources map[string]allocatedResource) map[string]allocatedResource {
	if resources == nil {
		return nil
	}
	copy := make(map[string]allocatedResource, len(resources))
	for name, resource := range resources {
		copy[name] = resource
	}
	return copy
}

func (m *manager) updateManagedAfterRuntimeRestart(managedID string, runtime *instance, restartErr error) {
	if managedID == "" {
		return
	}
	m.managedMu.Lock()
	defer m.managedMu.Unlock()
	managed := m.managed[managedID]
	if managed == nil {
		return
	}
	managed.Runtime = runtime
	managed.UpdatedAt = time.Now()
	if runtime != nil {
		managed.RuntimeInstanceID = runtime.ID
		managed.AppliedSpec = runtime.Spec
		managed.AppliedComponents = runtime.Components
		managed.AppliedDriverVersion = runtime.DriverVersion
		managed.AvailableDriverVersion = m.cfg.classes[managed.TemplateID].DriverVersion
		managed.UpdateStatus = "current"
	}
	if restartErr != nil {
		managed.ObservedState, managed.Error = "failed", restartErr.Error()
	} else {
		managed.ObservedState, managed.Error = "running", ""
		m.observeManagedRuntime(managed.ID, runtime)
	}
	if err := m.persistManaged(managed); err != nil {
		log.Printf("managed instance %s persist runtime restart: %v", managedID, err)
	}
}

func (m *manager) allocateRuntime(class classConfig) (int, int, int, int, error) {
	controlPort, err := m.allocateControlPort(class.Control)
	if err != nil {
		return 0, 0, 0, 0, err
	}
	if class.Server.DisplayMode == "fixed" {
		if m.runtimeBusy(class.Server.Display, class.Server.RFBPort, class.Server.GatewayPort) {
			return 0, 0, 0, 0, fmt.Errorf("display :%d or its configured ports are already in use", class.Server.Display)
		}
		return class.Server.Display, class.Server.RFBPort, class.Server.GatewayPort, controlPort, nil
	}
	for display := 10; display <= 99; display++ {
		rfbPort, gatewayPort := 5900+display, 39000+display
		if !m.runtimeBusy(display, rfbPort, gatewayPort) {
			return display, rfbPort, gatewayPort, controlPort, nil
		}
	}
	return 0, 0, 0, 0, errors.New("no free dynamic X11 display is available")
}

func (m *manager) allocateControlPort(control controlClassConfig) (int, error) {
	if control.Protocol == "" {
		return 0, nil
	}
	if control.Port > 0 {
		if m.controlPortBusy(control.Port) {
			return 0, fmt.Errorf("configured control port %d is already in use", control.Port)
		}
		return control.Port, nil
	}
	// Stay below Linux's normal ephemeral-client range so unrelated outbound
	// connections cannot claim the selected loopback listener between create
	// and first session attachment.
	for port := 21000; port <= 21999; port++ {
		if !m.controlPortBusy(port) {
			return port, nil
		}
	}
	return 0, errors.New("no free application control port is available")
}

func (m *manager) allocateNamedResources(definitions map[string]portClassConfig) (map[string]allocatedResource, error) {
	if definitions == nil {
		return nil, nil
	}
	if len(definitions) == 0 {
		return map[string]allocatedResource{}, nil
	}
	names := make([]string, 0, len(definitions))
	for name := range definitions {
		names = append(names, name)
	}
	sort.Strings(names)
	resources := make(map[string]allocatedResource, len(names))
	selected := make(map[int]bool, len(names))
	for _, name := range names {
		definition := definitions[name]
		port := definition.Port
		if port > 0 {
			if selected[port] || m.controlPortBusy(port) {
				return nil, fmt.Errorf("configured App Package port %s=%d is already in use", name, port)
			}
		} else {
			for candidate := 21000; candidate <= 21999; candidate++ {
				if !selected[candidate] && !m.controlPortBusy(candidate) {
					port = candidate
					break
				}
			}
			if port == 0 {
				return nil, fmt.Errorf("no free loopback TCP port is available for resource %q", name)
			}
		}
		selected[port] = true
		resources[name] = allocatedResource{Kind: definition.Kind, Address: "127.0.0.1", Port: port}
	}
	return resources, nil
}

func (m *manager) controlPortBusy(port int) bool {
	return m.controlPortBusyExcept(port, "")
}

func (m *manager) controlPortBusyExcept(port int, ignoredRuntimeID string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for id, item := range m.instances {
		if id == ignoredRuntimeID {
			continue
		}
		if item.State != "stopped" && item.State != "failed" {
			if item.ControlPort == port {
				return true
			}
			for _, resource := range item.Resources {
				if resource.Kind == "loopback-tcp" && resource.Port == port {
					return true
				}
			}
		}
	}
	if ignoredRuntimeID != "" {
		return loopbackBindBusy(port, true)
	}
	return portBusy(port)
}

func (m *manager) runtimeBusy(display, rfbPort, gatewayPort int) bool {
	return m.runtimeBusyExcept(display, rfbPort, gatewayPort, "")
}

func (m *manager) runtimeBusyExcept(display, rfbPort, gatewayPort int, ignoredRuntimeID string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	requestedDisplay := ":" + strconv.Itoa(display)
	requestedRFB := net.JoinHostPort("127.0.0.1", strconv.Itoa(rfbPort))
	requestedGateway := net.JoinHostPort("127.0.0.1", strconv.Itoa(gatewayPort))
	for id, item := range m.instances {
		if id == ignoredRuntimeID {
			continue
		}
		if item.State != "stopped" && item.State != "failed" &&
			(item.Display == requestedDisplay || item.RFBAddr == requestedRFB || item.GatewayAddr == requestedGateway) {
			return true
		}
	}
	return displayBusy(display, rfbPort) || loopbackListenerActive(gatewayPort)
}

func (m *manager) startServer(item *instance) error {
	class := m.specFor(item)
	serverReadinessTimeout, err := readinessTimeout(class.Server.ReadinessTimeout)
	if err != nil {
		return fmt.Errorf("server readiness timeout: %w", err)
	}
	rfbPort, _ := strconv.Atoi(strings.TrimPrefix(item.RFBAddr, "127.0.0.1:"))
	socketPath := filepath.Join(item.SocketRuntime, "unicode.sock")
	if m.cfg.vncLauncher == "direct" {
		if err := m.startDirectVNC(item, class, rfbPort); err != nil {
			return err
		}
	} else if err := m.startWrappedVNC(item, class, rfbPort, socketPath); err != nil {
		return err
	}
	if err := m.captureX11Ownership(item); err != nil {
		return fmt.Errorf("record owned X display: %w", err)
	}
	if err := waitFor(serverReadinessTimeout, func() bool {
		if !xDisplayReady(item.Display, authorityPath(item)) {
			return false
		}
		for _, name := range class.Server.ReadinessPIDs {
			if !pidFileAlive(filepath.Join(item.Runtime, name)) {
				return false
			}
		}
		return true
	}); err != nil {
		return fmt.Errorf("server-layer readiness: %w", err)
	}

	gatewayArgs := []string{
		"--user", "--unit=" + strings.TrimSuffix(item.GatewayUnit, ".service"), "--collect",
		"--property=WorkingDirectory=" + item.Home,
		"--setenv=HOME=" + item.Home,
		"--setenv=XAUTHORITY=" + authorityPath(item),
		"--setenv=REMOTEXAPP_CLIPBOARD_SOCKET=" + filepath.Join(item.SocketRuntime, "clipboard.sock"),
	}
	if m.cfg.vncLauncher == "direct" {
		gatewayArgs = append(gatewayArgs,
			"--property=BindsTo="+item.VNCUnit,
			"--property=After="+item.VNCUnit,
		)
	}
	gatewayArgs = append(gatewayArgs,
		"--", item.Components.GatewayBinary,
		"-listen", item.GatewayAddr, "-display", item.Display, "-vnc-addr", item.RFBAddr,
		"-text-backend", "ibus", "-text-log", m.cfg.gatewayTextLog, "-ime-socket", socketPath,
		// A full desktop intentionally permits every non-empty focused WM_CLASS.
		// Single-app classes should instead pass only their application's class.
		"-ibus-focus-class", strings.Join(class.Input.AllowedWMClasses, ","),
	)
	if output, err := m.launchComponent(gatewayArgs); err != nil {
		return fmt.Errorf("start gateway unit: %w: %s", err, output)
	}
	if err := waitFor(10*time.Second, func() bool {
		client := http.Client{Timeout: 500 * time.Millisecond}
		response, err := client.Get("http://" + item.GatewayAddr + "/healthz")
		if err != nil {
			return false
		}
		_ = response.Body.Close()
		return response.StatusCode == http.StatusOK
	}); err != nil {
		return fmt.Errorf("gateway readiness: %w", err)
	}
	if (item.SessionState == "running" || item.SessionState == "shutdown-blocked") && item.SessionGeneration > 0 {
		if err := m.setGatewayClipboardSession(item, item.SessionGeneration, true); err != nil {
			return fmt.Errorf("restore gateway clipboard session: %w", err)
		}
	}
	return nil
}

func (m *manager) startWrappedVNC(item *instance, class classConfig, rfbPort int, socketPath string) error {
	vncArgs := []string{
		"--user", "--unit=" + strings.TrimSuffix(item.VNCUnit, ".service"), "--remain-after-exit", "--collect",
		"--property=WorkingDirectory=" + item.Home,
		"--setenv=HOME=" + item.Home,
		"--setenv=XDG_CONFIG_HOME=" + filepath.Join(item.Home, ".config"),
		"--setenv=XDG_CACHE_HOME=" + filepath.Join(item.Home, ".cache"),
		"--setenv=XDG_DATA_HOME=" + filepath.Join(item.Home, ".local", "share"),
		"--setenv=REMOTEXAPP_RUNTIME=" + item.Runtime,
		"--setenv=REMOTEXAPP_SOCKET_RUNTIME=" + item.SocketRuntime,
		"--setenv=REMOTE_UNICODE_SOCKET=" + socketPath,
		"--setenv=REMOTE_UNICODE_ENGINE=" + item.Components.UnicodeEngine,
		"--setenv=REMOTEXAPP_PARAMETERS=" + filepath.Join(item.Runtime, "launch-parameters.json"),
		"--setenv=REMOTEXAPP_RUN_MODE=" + class.RunMode,
	}
	vncArgs = append(vncArgs, appSystemdEnvironmentArgs(item, class)...)
	vncArgs = append(vncArgs,
		"--", "/usr/bin/tigervncserver", item.Display,
		"-geometry", class.Server.Geometry, "-depth", strconv.Itoa(class.Server.Depth), "-FrameRate", strconv.Itoa(class.Server.FrameRate),
		"-localhost=1", "-rfbport", strconv.Itoa(rfbPort), "-SecurityTypes", "None",
		"-AcceptSetDesktopSize="+boolDigit(class.Server.AllowClientResize), "-xstartup", class.Server.Driver,
	)
	if output, err := m.launchComponent(vncArgs); err != nil {
		return fmt.Errorf("start VNC unit: %w: %s", err, output)
	}
	return nil
}

func (m *manager) startDirectVNC(item *instance, class classConfig, rfbPort int) error {
	authority := authorityPath(item)
	if err := prepareXAuthority(item.Display, authority); err != nil {
		return fmt.Errorf("prepare Xauthority: %w", err)
	}
	vncArgs := []string{
		"--user", "--unit=" + strings.TrimSuffix(item.VNCUnit, ".service"), "--collect",
		"--property=WorkingDirectory=" + item.Home,
		"--setenv=HOME=" + item.Home,
		"--", "/usr/bin/Xtigervnc", item.Display,
		"-geometry", class.Server.Geometry, "-depth", strconv.Itoa(class.Server.Depth), "-FrameRate", strconv.Itoa(class.Server.FrameRate),
		"-localhost=1", "-rfbport", strconv.Itoa(rfbPort), "-SecurityTypes", "None",
		"-AcceptSetDesktopSize=" + boolDigit(class.Server.AllowClientResize), "-auth", authority,
	}
	if output, err := m.launchComponent(vncArgs); err != nil {
		return fmt.Errorf("start direct VNC unit: %w: %s", err, output)
	}
	if err := waitFor(10*time.Second, func() bool {
		return xDisplayReady(item.Display, authority)
	}); err != nil {
		return fmt.Errorf("direct VNC readiness: %w", err)
	}

	driverArgs := []string{
		"--user", "--unit=" + strings.TrimSuffix(item.ServerUnit, ".service"), "--collect",
		"--property=BindsTo=" + item.VNCUnit,
		"--property=After=" + item.VNCUnit,
		"--property=WorkingDirectory=" + item.Home,
		"--setenv=HOME=" + item.Home,
		"--setenv=XDG_CONFIG_HOME=" + filepath.Join(item.Home, ".config"),
		"--setenv=XDG_CACHE_HOME=" + filepath.Join(item.Home, ".cache"),
		"--setenv=XDG_DATA_HOME=" + filepath.Join(item.Home, ".local", "share"),
		"--setenv=DISPLAY=" + item.Display,
		"--setenv=XAUTHORITY=" + authority,
		"--setenv=VNCDESKTOP=" + item.Display,
		"--setenv=XDG_SESSION_TYPE=x11",
		"--setenv=XDG_SESSION_CLASS=user",
		"--setenv=REMOTEXAPP_RUNTIME=" + item.Runtime,
		"--setenv=REMOTEXAPP_SOCKET_RUNTIME=" + item.SocketRuntime,
		"--setenv=REMOTE_UNICODE_SOCKET=" + filepath.Join(item.SocketRuntime, "unicode.sock"),
		"--setenv=REMOTE_UNICODE_ENGINE=" + item.Components.UnicodeEngine,
		"--setenv=REMOTEXAPP_PARAMETERS=" + filepath.Join(item.Runtime, "launch-parameters.json"),
		"--setenv=REMOTEXAPP_RUN_MODE=" + class.RunMode,
	}
	driverArgs = append(driverArgs, appSystemdEnvironmentArgs(item, class)...)
	driverArgs = append(driverArgs, "--", class.Server.Driver)
	if output, err := m.launchComponent(driverArgs); err != nil {
		return fmt.Errorf("start server-driver unit: %w: %s", err, output)
	}
	return nil
}

func prepareXAuthority(display, authority string) error {
	var cookie [16]byte
	if _, err := rand.Read(cookie[:]); err != nil {
		return fmt.Errorf("generate cookie: %w", err)
	}
	file, err := os.OpenFile(authority, os.O_CREATE, 0o600)
	if err != nil {
		return fmt.Errorf("create %s: %w", authority, err)
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := os.Chmod(authority, 0o600); err != nil {
		return err
	}
	command := []string{"-f", authority, "add", display, "MIT-MAGIC-COOKIE-1", hex.EncodeToString(cookie[:])}
	if output, err := runUserSystemd(5*time.Second, "/usr/bin/xauth", command...); err != nil {
		return fmt.Errorf("xauth: %w: %s", err, output)
	}
	return nil
}

func boolDigit(value bool) string {
	if value {
		return "1"
	}
	return "0"
}

func (m *manager) startSession(id string) (sessionErr error) {
	item := m.get(id)
	if item == nil {
		return errors.New("instance not found")
	}
	if item.SessionState == "running" {
		return nil
	}
	if item.SessionState == "failed" {
		if item.ManagedID == "" || m.specFor(item).RunMode != "user-home" {
			return errors.New("session failed; an explicit runtime restart is required")
		}
		if m.sessionComponentPopulated(item.SessionUnit) {
			return errors.New("session recovery blocked: live session processes require operator review")
		}
		if item.AttachedClients != 0 {
			return errors.New("session recovery blocked: viewer is still attached")
		}
		window, allowed := nextSessionRecovery(item.SessionRecovery, time.Now())
		if !allowed {
			return errors.New("session recovery exhausted: explicit runtime restart required")
		}
		if err := m.cleanupSessionComponent(item); err != nil {
			return fmt.Errorf("session recovery cleanup: %w", err)
		}
		m.mu.Lock()
		if live := m.instances[id]; live != nil && live.SessionGeneration == item.SessionGeneration && live.SessionState == "failed" {
			live.SessionRecovery = &window
			live.SessionState = "stopped"
			live.Error = ""
		}
		m.mu.Unlock()
		if err := m.persistRuntime(m.get(id)); err != nil {
			m.mu.Lock()
			if live := m.instances[id]; live != nil && live.SessionGeneration == item.SessionGeneration {
				live.SessionRecovery = item.SessionRecovery
				live.SessionState = "failed"
				live.Error = item.Error
			}
			m.mu.Unlock()
			return fmt.Errorf("persist managed session recovery intent: %w", err)
		}
		item = m.get(id)
	}
	item, generation, err := m.nextSessionGeneration(id)
	if err != nil {
		return err
	}
	defer func() {
		if sessionErr != nil {
			m.recordSessionStartupFailure(id, generation, sessionErr)
		}
	}()
	class := m.specFor(item)
	m.setSessionState(id, "starting", "")
	if class.Session.Services != "core-v1" {
		m.setSessionState(id, "failed", "Core session services contract required")
		return errors.New("Core session services contract required; perform a clean cutover")
	}
	// Re-publish the current schema for every generation. Besides keeping a
	// driver's contract synchronized after a class edit, this upgrades an
	// adopted runtime that was created before driver status was enabled.
	if class.Session.Status.Mode == "driver" {
		if err := writeStatusSchema(item.Runtime, class.Session.Status.Details, class.Session.Status.PrivateDetails); err != nil {
			m.setSessionState(id, "failed", err.Error())
			return fmt.Errorf("write application status schema: %w", err)
		}
	}
	if err := m.writeApplicationStatus(item, generation, "starting", "Starting application session", "", false); err != nil {
		m.setSessionState(id, "failed", err.Error())
		return fmt.Errorf("initialize application status: %w", err)
	}
	dbusAddress := ""
	if class.RunMode == "user-home" {
		dbusAddress, err = userBusAddress()
		if err != nil {
			_ = m.writeApplicationStatus(item, generation, "error", "Session startup failed", err.Error(), false)
			m.setSessionState(id, "failed", err.Error())
			return err
		}
	}
	sessionReadinessTimeout, err := readinessTimeout(class.Session.ReadinessTimeout)
	if err != nil {
		return fmt.Errorf("session readiness timeout: %w", err)
	}
	startupDeadline := time.Now().Add(sessionReadinessTimeout)
	pidPath := filepath.Join(item.Runtime, class.Session.ReadinessPID)
	if err := os.Remove(pidPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove stale session pid: %w", err)
	}
	args := []string{
		"--user", "--unit=" + strings.TrimSuffix(item.SessionUnit, ".service"), "--collect",
		"--property=BindsTo=" + item.VNCUnit,
		"--property=After=" + item.VNCUnit,
		"--property=KillMode=mixed",
		"--property=TimeoutStopSec=10s",
		"--property=WorkingDirectory=" + item.Home,
		"--setenv=HOME=" + item.Home,
		"--setenv=XDG_CONFIG_HOME=" + filepath.Join(item.Home, ".config"),
		"--setenv=XDG_CACHE_HOME=" + filepath.Join(item.Home, ".cache"),
		"--setenv=XDG_DATA_HOME=" + filepath.Join(item.Home, ".local", "share"),
		"--setenv=DISPLAY=" + item.Display,
		"--setenv=XAUTHORITY=" + authorityPath(item),
	}
	if dbusAddress != "" {
		args = append(args, "--setenv=DBUS_SESSION_BUS_ADDRESS="+dbusAddress)
	}
	args = append(args,
		"--setenv=IBUS_ADDRESS=unix:path="+filepath.Join(item.SocketRuntime, "ibus.sock"),
		"--setenv=GTK_IM_MODULE=ibus", "--setenv=QT_IM_MODULE=ibus", "--setenv=XMODIFIERS=@im=ibus",
		"--setenv=REMOTEXAPP_RUNTIME="+item.Runtime,
		"--setenv=REMOTEXAPP_SOCKET_RUNTIME="+item.SocketRuntime,
		"--setenv=REMOTE_UNICODE_SOCKET="+filepath.Join(item.SocketRuntime, "unicode.sock"),
		"--setenv=REMOTE_UNICODE_ENGINE="+item.Components.UnicodeEngine,
		"--setenv=REMOTEXAPP_PARAMETERS="+filepath.Join(item.Runtime, "launch-parameters.json"),
		"--setenv=REMOTEXAPP_RUN_MODE="+class.RunMode,
		"--setenv=REMOTEXAPP_STATUS_PATH="+statusPath(item.Runtime),
		"--setenv=REMOTEXAPP_STATUS_SCHEMA="+statusSchemaPath(item.Runtime),
		"--setenv=REMOTEXAPP_STATUS_HELPER="+item.Components.StatusBinary,
		"--setenv=REMOTEXAPP_SESSION_GENERATION="+strconv.FormatInt(generation, 10),
		"--setenv=REMOTEXAPP_SESSION_SERVICES="+class.Session.Services,
		"--setenv=REMOTEXAPP_SESSION_DEADLINE_MS="+strconv.FormatInt(startupDeadline.UnixMilli(), 10),
	)
	args = append(args, appSystemdEnvironmentArgs(item, class)...)
	if class.Control.Protocol != "" {
		args = append(args,
			"--setenv=REMOTEXAPP_CONTROL_PROTOCOL="+class.Control.Protocol,
			"--setenv=REMOTEXAPP_CONTROL_ADDRESS="+item.ControlAddress,
			"--setenv=REMOTEXAPP_CONTROL_PORT="+strconv.Itoa(item.ControlPort),
		)
		if class.Control.Path != "" {
			args = append(args, "--setenv=REMOTEXAPP_CONTROL_PATH="+class.Control.Path)
		}
	}
	args = append(args, "--", item.Components.StatusBinary, "--supervise-session", class.Session.Driver)
	if err := m.persistRuntime(m.get(id)); err != nil {
		m.setSessionState(id, "failed", "cannot persist session startup")
		return fmt.Errorf("persist session startup before launching supervisor: %w", err)
	}
	if err := m.setGatewayClipboardSession(item, generation, true); err != nil {
		m.setSessionState(id, "failed", err.Error())
		return fmt.Errorf("activate gateway clipboard session: %w", err)
	}
	if output, err := m.launchComponent(args); err != nil {
		_ = m.setGatewayClipboardSession(item, generation, false)
		_ = m.writeApplicationStatus(item, generation, "error", "Session startup failed", string(output), false)
		m.setSessionState(id, "failed", string(output))
		return fmt.Errorf("start session unit: %w: %s", err, output)
	}
	started := false
	defer func() {
		if !started {
			_, _ = m.stopComponent(item.SessionUnit)
		}
	}()
	driverFailure, err := waitForSessionReadiness(pidPath, item.Runtime, generation, class.Session.Status.Mode == "driver", time.Until(startupDeadline))
	if err != nil {
		_ = m.setGatewayClipboardSession(item, generation, false)
		_ = m.writeApplicationStatus(item, generation, "error", "Application readiness failed", err.Error(), false)
		m.setSessionState(id, "failed", err.Error())
		return fmt.Errorf("session-layer readiness: %w", err)
	}
	if driverFailure != "" {
		_ = m.setGatewayClipboardSession(item, generation, false)
		m.setSessionState(id, "failed", driverFailure)
		return fmt.Errorf("session driver failed: %s", driverFailure)
	}
	if err := waitFor(time.Until(startupDeadline), func() bool { return m.checkSessionServices(item) == nil }); err != nil {
		_ = m.setGatewayClipboardSession(item, generation, false)
		m.setSessionState(id, "failed", "Core session readiness failed")
		return errors.New("Core session readiness failed before startup deadline")
	}
	m.setSessionState(id, "running", "")
	started = true
	m.persistRuntimeTransition(m.get(id), "session-running")
	m.observeSession(item, generation)
	log.Printf("instance %s session layer started", id)
	return nil
}

func nextSessionRecovery(previous *sessionRecovery, now time.Time) (sessionRecovery, bool) {
	const recoveryWindow = 10 * time.Minute
	const maxRecoveryAttempts = 3
	window := sessionRecovery{WindowStart: now}
	if previous != nil && !now.Before(previous.WindowStart) && now.Sub(previous.WindowStart) < recoveryWindow {
		window = *previous
	}
	if window.Attempts >= maxRecoveryAttempts {
		return window, false
	}
	window.Attempts++
	return window, true
}

func waitForSessionReadiness(pidPath, runtime string, generation int64, statusEnabled bool, timeout time.Duration) (string, error) {
	driverFailure := ""
	err := waitFor(timeout, func() bool {
		if pidFileAlive(pidPath) {
			return true
		}
		if !statusEnabled {
			return false
		}
		status, statusErr := readApplicationStatus(runtime)
		if statusErr != nil || status.Generation != generation || status.State != "error" {
			return false
		}
		driverFailure = strings.TrimSpace(status.Error)
		if driverFailure == "" {
			driverFailure = strings.TrimSpace(status.Summary)
		}
		if driverFailure == "" {
			driverFailure = "session driver reported an application error"
		}
		return true
	})
	if err != nil && statusEnabled {
		// Supervisor and Manager share a deadline. At its boundary the public
		// error write can race this timeout; the previously published safe stage
		// still identifies the failure without reading journals/private records.
		status, statusErr := readApplicationStatus(runtime)
		if statusErr == nil && status.Generation == generation && status.State == "starting" {
			if failure := sessionstartup.Failure(status.Summary); failure != "" {
				return failure, nil
			}
		}
	}
	return driverFailure, err
}

func (m *manager) stopSession(id string, options stopOptions) error {
	m.cancelAction(id)
	item := m.get(id)
	if item == nil || item.SessionState == "stopped" {
		return nil
	}
	if options.Force {
		m.unobserveSession(item.ID, item.SessionGeneration)
		m.mu.Lock()
		if live := m.instances[id]; live != nil {
			live.SessionState = "stopping"
			if live.Shutdown == nil || live.Shutdown.Generation != live.SessionGeneration || (live.Shutdown.State != "blocked" && live.Shutdown.State != "timeout" && live.Shutdown.State != "failed") {
				now := time.Now()
				live.Shutdown = &shutdownStatus{
					RequestID: "forced-" + strconv.FormatInt(now.UnixNano(), 10), Generation: live.SessionGeneration, Reason: options.Reason,
					Scope: options.Scope, State: "forced", RequestedAt: now, Forced: true,
				}
			} else {
				live.Shutdown.State = "forced"
				live.Shutdown.Forced = true
			}
		}
		m.mu.Unlock()
	} else {
		if err := m.prepareSessionShutdown(item, options); err != nil {
			return err
		}
		m.unobserveSession(item.ID, item.SessionGeneration)
	}
	if err := m.setGatewayClipboardSession(item, item.SessionGeneration, false); err != nil {
		log.Printf("instance %s deactivate gateway clipboard session: %v", id, err)
	}
	if err := m.cleanupSessionComponent(item); err != nil {
		m.setSessionState(id, "failed", err.Error())
		return err
	}
	m.setSessionState(id, "stopped", "")
	_ = m.writeApplicationStatus(item, item.SessionGeneration, "stopped", "Application session stopped", "", true)
	m.persistRuntimeTransition(m.get(id), "session-stopped")
	log.Printf("instance %s session layer stopped", id)
	return nil
}

// A naturally exited session also needs its service leaf and stale IPC files
// retired. In standalone mode an empty cgroup still consumes the delegated
// descendant quota, so merely publishing SessionState=stopped is insufficient.
func (m *manager) cleanupSessionComponent(item *instance) error {
	if item.SessionUnit != "" {
		output, err := m.stopComponent(item.SessionUnit)
		if err != nil && !strings.Contains(output, "not loaded") {
			return fmt.Errorf("stop session unit: %w: %s", err, output)
		}
	}
	class := m.specFor(item)
	if item.Runtime != "" {
		for _, name := range []string{class.Session.ReadinessPID, "session-dbus.pid", "session-dbus-address", "session-ibus.pid", "session-engine.pid", "session-driver.pid"} {
			if name == "" {
				continue
			}
			if err := os.Remove(filepath.Join(item.Runtime, name)); err != nil && !errors.Is(err, os.ErrNotExist) {
				return fmt.Errorf("remove session runtime file %s: %w", name, err)
			}
		}
	}
	if item.SocketRuntime != "" {
		for _, name := range []string{"unicode.sock", "ibus.sock", "session-bus.sock"} {
			if err := os.Remove(filepath.Join(item.SocketRuntime, name)); err != nil && !errors.Is(err, os.ErrNotExist) {
				return fmt.Errorf("remove session socket %s: %w", name, err)
			}
		}
	}
	return nil
}

func (m *manager) attachRFB(id string) error {
	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()
	m.mu.Lock()
	if timer := m.idleTimers[id]; timer != nil {
		timer.Stop()
		delete(m.idleTimers, id)
	}
	m.mu.Unlock()
	m.cancelBlockedShutdown(id)
	if err := m.startSession(id); err != nil {
		m.mu.Lock()
		if item := m.instances[id]; item != nil && item.AttachedClients == 0 && item.State == "server-ready" && m.specFor(item).Session.VacantAction == "stop-instance" {
			m.scheduleVacancyLocked(id)
		}
		m.mu.Unlock()
		return err
	}
	item := m.get(id)
	if item != nil && item.AttachedClients == 0 {
		if err := m.runViewerHook(item, true); err != nil {
			m.scheduleVacancy(id)
			return err
		}
	}
	m.mu.Lock()
	if item := m.instances[id]; item != nil {
		item.AttachedClients++
		log.Printf("instance %s RFB attached; clients=%d", id, item.AttachedClients)
	}
	m.mu.Unlock()
	return nil
}

func (m *manager) detachRFB(id string) {
	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()
	m.mu.Lock()
	item := m.instances[id]
	if item == nil {
		m.mu.Unlock()
		return
	}
	if item.AttachedClients > 0 {
		item.AttachedClients--
	}
	clients := item.AttachedClients
	log.Printf("instance %s RFB detached; clients=%d", id, clients)
	shouldDetach := clients == 0 && item.SessionState == "running"
	m.mu.Unlock()
	if shouldDetach {
		if err := m.runViewerHook(item, false); err != nil {
			log.Printf("instance %s viewer detach hook: %v", id, err)
		}
	}
	m.mu.Lock()
	if clients == 0 && item.State == "server-ready" {
		if m.specFor(item).Session.VacantAction != "keep" {
			m.scheduleVacancyLocked(id)
		}
	}
	m.mu.Unlock()
}

func (m *manager) scheduleVacancy(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.scheduleVacancyLocked(id)
}

func (m *manager) scheduleVacancyLocked(id string) time.Time {
	item := m.instances[id]
	if item == nil {
		return time.Time{}
	}
	if timer := m.idleTimers[id]; timer != nil {
		timer.Stop()
	}
	if m.specFor(item).Session.VacantAction == "keep" {
		delete(m.idleTimers, id)
		return time.Time{}
	}
	timeout := m.timeoutFor(item)
	deadline := time.Now().Add(timeout)
	if failure := item.StartupFailure; item.ManagedID == "" && item.SessionState == "failed" && failure != nil && failure.Generation == item.SessionGeneration {
		deadline = failure.ExpiresAt
		timeout = time.Until(deadline)
		if timeout < 0 {
			timeout = 0
		}
	}
	generation := item.SessionGeneration
	// Stop cannot recall an AfterFunc callback already waiting on lifecycleMu.
	// Both timer and runtime identities fence that callback after renewal/restart.
	initialized := make(chan struct{})
	var timer *time.Timer
	timer = time.AfterFunc(timeout, func() {
		<-initialized
		m.stopVacant(id, timer, item, generation, deadline)
	})
	m.idleTimers[id] = timer
	close(initialized)
	log.Printf("instance %s vacant cleanup scheduled in %s", id, timeout)
	return deadline
}

func (m *manager) stopVacant(id string, timer *time.Timer, expected *instance, generation int64, deadline time.Time) {
	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()
	m.mu.Lock()
	item := m.instances[id]
	if item == nil || item != expected || item.SessionGeneration != generation || m.idleTimers[id] != timer ||
		time.Now().Before(deadline) || item.AttachedClients != 0 || item.State != "server-ready" {
		m.mu.Unlock()
		return
	}
	if failure := item.StartupFailure; failure != nil && failure.Generation == generation && failure.ExpiresAt.Equal(deadline) && item.SessionState != "failed" {
		// A failed-start timer must never turn into an early healthy-session stop.
		delete(m.idleTimers, id)
		m.mu.Unlock()
		return
	}
	delete(m.idleTimers, id)
	m.mu.Unlock()
	class := m.specFor(item)
	// stopInstanceLocked writes the caller's result snapshot. Never pass its
	// live map entry from an asynchronous vacancy callback.
	stopping := m.get(id)
	var err error
	if class.Session.VacantAction == "stop-instance" {
		failedStart := item.ManagedID == "" && item.SessionState == "failed" && item.StartupFailure != nil && item.StartupFailure.Generation == generation
		reason := "idle-timeout"
		if failedStart {
			reason = "failed-start-grace-expired"
		}
		err = m.stopInstanceLocked(stopping, stopOptions{Reason: reason, Scope: "instance", Force: failedStart})
	} else {
		err = m.stopSession(id, stopOptions{Reason: "idle-timeout", Scope: "session"})
	}
	if err != nil {
		log.Printf("instance %s vacant %s cleanup: %v", id, class.Session.VacantAction, err)
	} else if stopping.StartupFailure != nil && stopping.ManagedID == "" {
		if err := m.saveStartupFailureRecord(stopping); err != nil {
			log.Printf("instance %s startup failure record: %v", id, err)
		}
	}
}

func (m *manager) stop(item *instance, options stopOptions) error {
	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()
	return m.stopInstanceLocked(item, options)
}

func (m *manager) stopInstanceLocked(item *instance, options stopOptions) error {
	m.mu.Lock()
	if timer := m.idleTimers[item.ID]; timer != nil {
		timer.Stop()
		delete(m.idleTimers, item.ID)
	}
	m.mu.Unlock()
	if options.PreserveRuntime {
		m.unobserveManagedRuntime(item)
		m.setState(item.ID, "restarting", "", "")
		if err := m.persistRuntime(m.get(item.ID)); err != nil {
			m.setState(item.ID, "server-ready", item.ViewerURL, "cannot durably record runtime restart: "+err.Error())
			return fmt.Errorf("persist runtime restart intent: %w", err)
		}
	}
	if options.Force && !options.PreserveRuntime {
		if err := m.persistInstanceStopIntent(item); err != nil {
			return err
		}
		m.unobserveManagedRuntime(item)
	}
	if err := m.stopSession(item.ID, options); err != nil {
		if isShutdownBlocked(err) {
			m.setState(item.ID, "server-ready", item.ViewerURL, err.Error())
			m.persistRuntimeTransition(m.get(item.ID), "shutdown-blocked")
			if updated := m.get(item.ID); updated != nil {
				*item = *updated
			}
			return err
		}
		if current := m.get(item.ID); current != nil && current.SessionState == "running" {
			m.setState(item.ID, "server-ready", item.ViewerURL, err.Error())
			m.scheduleVacancy(item.ID)
		} else {
			m.setState(item.ID, "failed", "", err.Error())
		}
		m.persistRuntimeTransition(m.get(item.ID), "session-stop-failed")
		return err
	}
	if !options.Force && !options.PreserveRuntime {
		if err := m.persistInstanceStopIntent(item); err != nil {
			return err
		}
		m.unobserveManagedRuntime(item)
	}
	if err := m.stopUnits(item); err != nil {
		m.setState(item.ID, "failed", "", err.Error())
		m.persistRuntimeTransition(m.get(item.ID), "unit-stop-failed")
		return err
	}
	if options.PreserveRuntime {
		if err := removeStoppedRuntimeState(m.cfg.stateDir, item); err != nil {
			m.setState(item.ID, "failed", "", err.Error())
			m.persistRuntimeTransition(m.get(item.ID), "restart-state-cleanup-failed")
			return err
		}
		updated := m.get(item.ID)
		*item = *updated
		return nil
	}
	m.setState(item.ID, "stopped", "", "")
	if err := removeStoppedRuntimeState(m.cfg.stateDir, item); err != nil {
		m.setState(item.ID, "failed", "", err.Error())
		return err
	}
	if err := m.removeRuntimeManifest(item.ID); err != nil {
		m.setState(item.ID, "failed", "", err.Error())
		return err
	}
	updated := m.get(item.ID)
	*item = *updated
	return nil
}

func removeStoppedRuntimeState(stateDir string, item *instance) error {
	if item.EphemeralHome {
		if err := removeEphemeralHome(stateDir, item.Home); err != nil {
			return err
		}
	}
	return removeRuntimeDirectory(stateDir, item.Runtime)
}

func (m *manager) persistInstanceStopIntent(item *instance) error {
	m.mu.Lock()
	if live := m.instances[item.ID]; live != nil {
		live.RuntimeDesired = "stopped"
	}
	m.mu.Unlock()
	m.setState(item.ID, "stopping", "", "")
	if err := m.persistRuntime(m.get(item.ID)); err != nil {
		m.mu.Lock()
		if live := m.instances[item.ID]; live != nil {
			live.RuntimeDesired = "running"
		}
		m.mu.Unlock()
		m.setState(item.ID, "server-ready", item.ViewerURL, "cannot durably record stop intent: "+err.Error())
		m.scheduleVacancy(item.ID)
		return fmt.Errorf("persist instance stop intent: %w", err)
	}
	return nil
}

func (m *manager) stopUnits(item *instance) error {
	var failures []string
	for _, unit := range []string{item.SessionUnit, item.GatewayUnit, item.ServerUnit, item.VNCUnit} {
		if unit == "" {
			continue
		}
		output, err := m.stopComponent(unit)
		if err != nil && !strings.Contains(output, "not loaded") {
			failures = append(failures, fmt.Sprintf("%s: %v: %s", unit, err, output))
		}
	}
	if len(failures) > 0 {
		return fmt.Errorf("stop units: %s", strings.Join(failures, "; "))
	}
	if err := removeOwnedX11(item); err != nil {
		return fmt.Errorf("clean owned X display: %w", err)
	}
	// A forced kill/crash can bypass supervisor cleanup. Retire only known
	// runtime-local endpoints after all owned units have stopped. The borrowed
	// account bus is never in this directory and is never removed.
	if item.SocketRuntime != "" {
		for _, name := range []string{"unicode.sock", "ibus.sock", "session-bus.sock", "clipboard.sock"} {
			if err := os.Remove(filepath.Join(item.SocketRuntime, name)); err != nil && !errors.Is(err, os.ErrNotExist) {
				return fmt.Errorf("remove runtime socket %s: %w", name, err)
			}
		}
		if err := os.Remove(item.SocketRuntime); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("remove socket runtime: %w", err)
		}
	}
	return nil
}

func (m *manager) get(id string) *instance {
	m.mu.RLock()
	item := m.instances[id]
	if item == nil {
		m.mu.RUnlock()
		return nil
	}
	copy := *item
	if item.Shutdown != nil {
		shutdownCopy := *item.Shutdown
		copy.Shutdown = &shutdownCopy
	}
	if item.ApplicationStatus != nil {
		statusCopy := *item.ApplicationStatus
		copy.ApplicationStatus = &statusCopy
	}
	m.mu.RUnlock()
	m.refreshApplicationStatus(&copy)
	return &copy
}

func (m *manager) monitorSession(id string, generation int64, pidPath string, expectedPID int, expected canonicalProcessIdentity) {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for range ticker.C {
		item := m.get(id)
		if item == nil || item.SessionGeneration != generation || (item.SessionState != "running" && item.SessionState != "shutdown-blocked") {
			return
		}
		pid, err := readCanonicalPID(pidPath)
		if err == nil && pid == expectedPID {
			identity, identityErr := m.inspectCanonicalProcess(m.canonicalProcRoot(), pid, item.SessionUnit)
			if identityErr == nil && identity == expected {
				continue
			}
		}
		m.queueSessionRuntimeEvent(sessionRuntimeEvent{
			InstanceID: id, Generation: generation, Reason: "readiness process exited",
		})
		return
	}
}

func (m *manager) handleSessionExit(id string, generation int64, reason string) {
	m.mu.RLock()
	item := m.instances[id]
	if item == nil || item.SessionGeneration != generation || (item.SessionState != "running" && item.SessionState != "shutdown-blocked") {
		m.mu.RUnlock()
		return
	}
	copy := *item
	wasShutdownBlocked := item.SessionState == "shutdown-blocked"
	if item.Shutdown != nil {
		shutdownCopy := *item.Shutdown
		copy.Shutdown = &shutdownCopy
	}
	m.mu.RUnlock()
	m.unobserveSession(id, generation)
	_ = m.setGatewayClipboardSession(&copy, generation, false)
	status, _ := readApplicationStatus(copy.Runtime)
	if wasShutdownBlocked && copy.Shutdown != nil {
		if status == nil || status.State != "exited" {
			_ = m.writeApplicationStatus(&copy, generation, "exited", "Application exited after the graceful shutdown request", "", true)
			status, _ = readApplicationStatus(copy.Runtime)
		}
		m.mu.Lock()
		if live := m.instances[id]; live != nil && live.SessionGeneration == generation && live.SessionState == "shutdown-blocked" {
			live.ApplicationStatus = status
			live.Error = ""
			if live.Shutdown != nil && live.Shutdown.RequestID == copy.Shutdown.RequestID {
				live.Shutdown.Message = "application exited after the graceful shutdown request"
			}
		}
		m.mu.Unlock()
		m.persistRuntimeTransition(m.get(id), "blocked-shutdown-exited")
		go m.completeBlockedShutdown(id, generation, copy.Shutdown.RequestID, copy.Shutdown.Scope, copy.Shutdown.Reason)
		return
	}
	if copy.ManagedID != "" && m.specFor(&copy).RunMode == "user-home" &&
		m.sessionComponentPopulated(copy.SessionUnit) && (status == nil || status.State != "exited") {
		// The readiness process is gone, but the session cgroup still contains
		// processes. Those may include unsaved user applications. Do not treat
		// their presence as permission to kill the cgroup for auto-recovery.
		const blocked = "session leader exited while other processes remain; recovery requires operator review"
		_ = m.writeApplicationStatus(&copy, generation, "error", "Session recovery blocked", blocked, true)
		m.setSessionState(id, "failed", blocked)
		m.persistRuntimeTransition(m.get(id), "session-recovery-blocked")
		return
	}
	if err := m.cleanupSessionComponent(&copy); err != nil {
		m.setSessionState(id, "failed", err.Error())
		m.persistRuntimeTransition(m.get(id), "session-exit-cleanup-failed")
		log.Printf("instance %s exited session cleanup: %v", id, err)
		return
	}
	if status != nil && status.State == "exited" {
		m.mu.Lock()
		if live := m.instances[id]; live != nil && live.SessionGeneration == generation {
			live.ApplicationStatus = status
		}
		m.mu.Unlock()
		m.setSessionState(id, "stopped", "")
		m.persistRuntimeTransition(m.get(id), "session-exited")
		go m.applyCleanExitAction(id, generation)
		return
	}
	errorText := "application session terminated unexpectedly"
	if status == nil || status.State != "error" {
		_ = m.writeApplicationStatus(&copy, generation, "error", "Application session terminated unexpectedly", reason, true)
	} else if status.Error != "" {
		errorText = status.Error
	}
	m.setSessionState(id, "failed", errorText)
	m.persistRuntimeTransition(m.get(id), "session-failed")
}

func (m *manager) completeBlockedShutdown(id string, generation int64, requestID, scope, reason string) {
	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()
	item := m.get(id)
	if item == nil || item.SessionGeneration != generation || item.SessionState != "shutdown-blocked" || item.Shutdown == nil || item.Shutdown.RequestID != requestID {
		return
	}
	options := stopOptions{Reason: reason + "-application-exited", Scope: scope, Force: true}
	var err error
	if scope == "instance" {
		err = m.stopInstanceLocked(item, options)
	} else {
		err = m.stopSession(id, options)
	}
	if err != nil {
		log.Printf("instance %s complete blocked shutdown after application exit: %v", id, err)
		return
	}
	m.finishShutdownStatus(id, requestID, "completed", "application exited after the graceful shutdown request", false)
	m.persistRuntimeTransition(m.get(id), "blocked-shutdown-completed")
}

// A driver-confirmed user exit is an early idle transition: retain or stop
// exactly what the existing idleAction prescribes, without waiting for the
// last WebSocket to detach or for idleTimeout to expire.
func (m *manager) applyCleanExitAction(id string, generation int64) {
	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()
	m.mu.RLock()
	item := m.instances[id]
	if item == nil || item.SessionGeneration != generation || item.SessionState != "stopped" {
		m.mu.RUnlock()
		return
	}
	action := cleanExitAction(m.specFor(item))
	m.mu.RUnlock()
	if action != "stop-instance" {
		log.Printf("instance %s clean session exit applied early idle action %s", id, action)
		return
	}
	if err := m.stopInstanceLocked(item, stopOptions{Reason: "application-exited", Scope: "instance", Force: true}); err != nil {
		log.Printf("instance %s clean session exit stop: %v", id, err)
	}
}

func cleanExitAction(class classConfig) string {
	return class.Session.VacantAction
}

func (m *manager) observeSession(item *instance, generation int64) {
	if item == nil {
		return
	}
	// A session cgroup can remain populated by helpers after its readiness
	// process has died. Watch both signals so a managed desktop cannot appear
	// healthy until the much slower managed safety reconciliation notices it.
	class := m.specFor(item)
	if m.sessionEvents != nil {
		pidPath := filepath.Join(item.Runtime, class.Session.ReadinessPID)
		pid, err := readCanonicalPID(pidPath)
		identity := canonicalProcessIdentity{}
		if err == nil {
			identity, err = m.inspectCanonicalProcess(m.canonicalProcRoot(), pid, item.SessionUnit)
		}
		if err != nil {
			// Restoration installs watches before starting the event consumer.
			// A broken session must not block startup if its event channel fills.
			go m.queueSessionRuntimeEvent(sessionRuntimeEvent{InstanceID: item.ID, Generation: generation, Reason: "readiness process unavailable"})
		} else {
			go m.monitorSession(item.ID, generation, pidPath, pid, identity)
		}
	}
	if m.sessionObserver != nil {
		if err := m.sessionObserver.WatchSession(item.ID, generation, item.SessionUnit); err == nil {
			return
		} else {
			log.Printf("instance %s session observation: %v; using PID polling fallback", item.ID, err)
		}
	}
}

func (m *manager) unobserveSession(id string, generation int64) {
	if m.sessionObserver != nil {
		m.sessionObserver.UnwatchSession(id, generation)
	}
}

func (m *manager) queueSessionRuntimeEvent(event sessionRuntimeEvent) {
	// Session events have no slow safety reconciler: preserve every terminal
	// transition. Backpressure here only pauses the one host-wide inotify reader
	// while lifecycleMu is busy; it never adds per-session workers.
	m.sessionEvents <- event
}

func (m *manager) reconcileSessionEvents() {
	for event := range m.sessionEvents {
		m.lifecycleMu.Lock()
		reason := event.Reason
		if reason == "" {
			reason = "session unit exited"
			log.Printf("instance %s observed empty session cgroup %s generation %d", event.InstanceID, event.Unit, event.Generation)
		} else {
			log.Printf("instance %s observed %s generation %d", event.InstanceID, reason, event.Generation)
		}
		m.handleSessionExit(event.InstanceID, event.Generation, reason)
		if item := m.get(event.InstanceID); item != nil && item.ManagedID != "" {
			if err := m.reconcileManagedLocked(item.ManagedID); err != nil {
				log.Printf("managed instance %s session reconciliation: %v", item.ManagedID, err)
			}
		}
		m.lifecycleMu.Unlock()
	}
}

func (m *manager) setState(id, state, viewerURL, errorText string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if item := m.instances[id]; item != nil {
		item.State = state
		item.ViewerURL = viewerURL
		item.Error = errorText
		if state == "stopped" {
			item.AttachedClients = 0
			item.SessionState = "stopped"
		}
	}
}

func (m *manager) setSessionState(id, state, errorText string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if item := m.instances[id]; item != nil {
		item.SessionState = state
		if errorText != "" {
			item.Error = errorText
		} else if item.State == "server-ready" {
			item.Error = ""
		}
	}
}
