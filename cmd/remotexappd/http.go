package main

import (
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"sort"
	"strings"
	"time"
)

func (m *manager) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", m.serveHealth)
	mux.HandleFunc("/readyz", m.serveReady)
	mux.HandleFunc("/api/version", m.serveVersion)
	mux.HandleFunc("/", m.serveClient)
	mux.HandleFunc("/api/classes", m.serveClasses)
	mux.HandleFunc("/api/templates", m.serveClasses)
	mux.HandleFunc("/api/instances", m.serveInstances)
	mux.HandleFunc("/api/instances/", m.serveInstance)
	mux.HandleFunc("/api/managed-instances", m.serveManagedInstances)
	mux.HandleFunc("/api/managed-instances/", m.serveManagedInstance)
	mux.HandleFunc("/api/operator/service/restart", m.serveOperatorServiceRestart)
	mux.HandleFunc("/api/operator/operations/", m.serveOperatorOperation)
	mux.HandleFunc("/remotexapps/", m.serveInstanceRoute)
	mux.HandleFunc("/assets/", serveBundledAsset)
	mux.HandleFunc("/console/index.js", serveConsoleEntry)
	sdkRoot, err := fs.Sub(sdkFiles, "web/sdk")
	if err != nil {
		panic(err)
	}
	mux.HandleFunc("/sdk/index.js", serveSDKEntry)
	mux.HandleFunc("/sdk/console.html", m.serveConsolePage)
	mux.HandleFunc("/sdk/minimal.html", m.serveConsolePage)
	mux.Handle("/sdk/", m.serveSDKFiles(http.StripPrefix("/sdk/", http.FileServer(http.FS(sdkRoot)))))
	return m.secure(mux)
}

func (m *manager) serveHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, "GET")
		return
	}
	m.mu.RLock()
	active, attached := 0, 0
	for _, item := range m.instances {
		if item.State != "stopped" && item.State != "failed" {
			active++
		}
		attached += item.AttachedClients
	}
	m.mu.RUnlock()
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok", "version": version, "uptimeSeconds": time.Since(serviceStarted).Seconds(),
		"templates": len(m.cfg.classes), "activeInstances": active, "attachedClients": attached,
	})
}

func (m *manager) serveReady(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, "GET")
		return
	}
	if len(m.cfg.classes) == 0 {
		writeError(w, http.StatusServiceUnavailable, "class catalog is not loaded")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

func (m *manager) serveVersion(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, "GET")
		return
	}
	forceAfter := "never"
	if m.cfg.shutdownForceAfter > 0 {
		forceAfter = m.cfg.shutdownForceAfter.String()
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"version": version, "commit": commit, "buildDate": buildDate,
		"webFeatures": map[string]bool{
			"console": !m.cfg.disableConsole,
			"kiosk":   !m.cfg.disableKiosk,
		},
		"capabilities": map[string]bool{
			"runtimeRestart": true,
			"serviceRestart": m.cfg.enableServiceRestart && m.cfg.authMode == "trusted-header",
			"clipboard":      true,
			"appActions":     true,
			"idleLease":      true,
		},
		"shutdownPolicy": map[string]string{
			"graceTimeout":        m.shutdownGraceTimeout().String(),
			"blockedWarningAfter": durationOrDisabled(m.cfg.shutdownWarnAfter),
			"forceAfter":          forceAfter,
		},
	})
}

func durationOrDisabled(value time.Duration) string {
	if value <= 0 {
		return "disabled"
	}
	return value.String()
}

func (m *manager) serveClient(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" || m.cfg.disableConsole {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		methodNotAllowed(w, "GET, HEAD")
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if r.Method == http.MethodGet {
		_, _ = w.Write(consoleHTML)
	}
}

func (m *manager) serveConsolePage(w http.ResponseWriter, r *http.Request) {
	if m.cfg.disableConsole {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		methodNotAllowed(w, "GET, HEAD")
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if r.Method == http.MethodGet {
		_, _ = w.Write(consoleHTML)
	}
}

func (m *manager) serveSDKFiles(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r)
	})
}

func (m *manager) serveClasses(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, "GET")
		return
	}
	classIDs := make([]string, 0, len(m.cfg.classes))
	for classID := range m.cfg.classes {
		classIDs = append(classIDs, classID)
	}
	sort.Strings(classIDs)
	classes := make([]any, 0, len(classIDs))
	for _, classID := range classIDs {
		class := m.cfg.classes[classID]
		item := map[string]any{
			"id": class.ID, "name": class.Name, "driverVersion": class.DriverVersion, "singleton": class.Singleton, "profileRef": class.ProfileRef, "runMode": class.RunMode,
			"serverActivation": class.Server.Activation, "sessionActivation": class.Session.Activation,
			"vacantTimeout": class.Session.VacantTimeout, "vacantAction": class.Session.VacantAction,
			"display":          map[string]any{"mode": class.Server.DisplayMode, "number": class.Server.Display, "size": class.Server.Geometry, "depth": class.Server.Depth, "frameRate": class.Server.FrameRate, "allowClientResize": class.Server.AllowClientResize},
			"readiness":        map[string]any{"serverPids": class.Server.ReadinessPIDs, "sessionPid": class.Session.ReadinessPID},
			"input":            map[string]any{"backend": class.Input.Backend, "lifecycle": class.Input.Lifecycle, "allowedWmClasses": class.Input.AllowedWMClasses},
			"parameters":       class.Parameters,
			"status":           map[string]any{"mode": class.Session.Status.Mode, "details": class.Session.Status.Details},
			"gracefulShutdown": class.Session.ShutdownDriver != "",
		}
		if class.APIVersion != "" {
			item["apiVersion"] = class.APIVersion
			item["ports"] = class.Ports
			item["overrides"] = class.Overrides
			item["dependencies"] = class.Dependencies
			item["readiness"] = map[string]any{
				"serverPids": class.Server.ReadinessPIDs, "sessionPid": class.Session.ReadinessPID,
				"serverTimeout": class.Server.ReadinessTimeout, "sessionTimeout": class.Session.ReadinessTimeout,
			}
		}
		if m.cfg.exposeInternals {
			item["drivers"] = map[string]any{"server": class.Server.Driver, "session": class.Session.Driver, "shutdown": class.Session.ShutdownDriver}
		}
		classes = append(classes, item)
	}
	writeJSON(w, http.StatusOK, classes)
}

func (m *manager) serveInstances(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		m.mu.RLock()
		items := make([]*instance, 0, len(m.instances))
		for _, item := range m.instances {
			copy := *item
			items = append(items, &copy)
		}
		m.mu.RUnlock()
		sort.Slice(items, func(i, j int) bool { return items[i].CreatedAt.Before(items[j].CreatedAt) })
		writeJSON(w, http.StatusOK, m.publicInstances(items))
	case http.MethodPost:
		var request createRequest
		if err := decodeStrictJSON(r.Body, &request); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
			return
		}
		item, err := m.create(request)
		if err != nil {
			writeError(w, http.StatusConflict, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, m.publicInstance(item))
	default:
		methodNotAllowed(w, "GET, POST")
	}
}

func (m *manager) serveInstance(w http.ResponseWriter, r *http.Request) {
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/instances/"), "/")
	parts := strings.Split(path, "/")
	if len(parts) == 2 && parts[1] == "idle-lease" {
		m.serveIdleLease(w, r, parts[0])
		return
	}
	if (len(parts) == 2 || len(parts) == 3) && parts[1] == "actions" {
		m.serveActions(w, r, parts)
		return
	}
	if len(parts) == 0 || parts[0] == "" {
		http.NotFound(w, r)
		return
	}
	if len(parts) == 2 && parts[1] == "connections" {
		m.serveConnections(w, r, parts[0])
		return
	}
	item := m.get(parts[0])
	if item == nil {
		writeError(w, http.StatusNotFound, "instance not found")
		return
	}
	if len(parts) >= 2 && parts[1] == "clipboard" {
		m.serveClipboard(w, r, item, parts)
		return
	}
	if len(parts) == 1 && r.Method == http.MethodGet {
		writeJSON(w, http.StatusOK, m.publicInstance(item))
		return
	}
	if len(parts) == 2 && parts[1] == "status" && r.Method == http.MethodGet {
		if m.specFor(item).Session.Status.Mode != "driver" {
			writeError(w, http.StatusNotFound, "template does not provide application status")
			return
		}
		m.refreshApplicationStatus(item)
		writeJSON(w, http.StatusOK, item.ApplicationStatus)
		return
	}
	if len(parts) == 3 && parts[1] == "status" && parts[2] == "environment" {
		if r.Method != http.MethodPost {
			methodNotAllowed(w, "POST")
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		var request applicationEnvironmentRequest
		if err := decodeStrictJSON(r.Body, &request); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
			return
		}
		result, err := m.applicationEnvironment(item.ID, request.SessionGeneration)
		if err != nil {
			var public *applicationEnvironmentError
			if errors.As(err, &public) {
				writeError(w, public.Status, public.Message)
			} else {
				writeError(w, http.StatusInternalServerError, "application environment lookup failed")
			}
			return
		}
		writeJSON(w, http.StatusOK, result)
		return
	}
	if len(parts) == 2 && parts[1] == "attach" && r.Method == http.MethodPost {
		if m.cfg.disableKiosk {
			writeError(w, http.StatusNotFound, "built-in kiosk is disabled")
			return
		}
		if item.State != "server-ready" && item.State != "ready" {
			writeError(w, http.StatusConflict, "instance is not ready")
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"viewerUrl": item.ViewerURL})
		return
	}
	if len(parts) == 2 && parts[1] == "stop" && r.Method == http.MethodPost {
		if item.ManagedID != "" {
			writeError(w, http.StatusConflict, "managed runtime must be stopped through its managed-instance desiredState")
			return
		}
		var request stopRequest
		if r.ContentLength != 0 {
			if err := decodeStrictJSON(r.Body, &request); err != nil {
				writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
				return
			}
		}
		if err := m.stop(item, stopOptions{Reason: "api-stop", Scope: "instance", Force: request.Force}); err != nil {
			status := http.StatusInternalServerError
			if isShutdownBlocked(err) {
				status = http.StatusConflict
			}
			writeError(w, status, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, m.publicInstance(item))
		return
	}
	if len(parts) == 2 && parts[1] == "upgrade-and-restart" {
		m.serveUpgrade(w, r, item)
		return
	}
	if len(parts) == 2 && parts[1] == "restart" && r.Method == http.MethodPost {
		var request restartRequest
		if err := decodeStrictJSON(r.Body, &request); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
			return
		}
		if request.SessionGeneration == nil || *request.SessionGeneration < 0 {
			writeError(w, http.StatusBadRequest, "sessionGeneration is required and must be non-negative")
			return
		}
		restarted, err := m.restartRuntime(item.ID, request)
		if err != nil {
			status := http.StatusConflict
			if restarted == nil {
				status = http.StatusNotFound
			} else if !isShutdownBlocked(err) && !strings.Contains(err.Error(), "generation") && !strings.Contains(err.Error(), "state") && !strings.Contains(err.Error(), "desiredState") {
				status = http.StatusInternalServerError
			}
			writeError(w, status, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, m.publicInstance(restarted))
		return
	}
	methodNotAllowed(w, "GET, POST")
}

func (m *manager) publicInstance(item *instance) *publicInstanceView {
	if item == nil {
		return nil
	}
	copy := *item
	m.refreshApplicationStatus(&copy)
	if len(copy.Resources) == 0 {
		copy.Resources = map[string]allocatedResource{}
		if copy.ControlPort != 0 {
			copy.Resources["control"] = allocatedResource{Kind: "loopback-tcp", Address: copy.ControlAddress, Port: copy.ControlPort}
		}
	}
	if !m.cfg.exposeInternals {
		copy.Home, copy.XAuthority, copy.Runtime, copy.SocketRuntime = "", "", "", ""
		copy.RFBAddr, copy.GatewayAddr = "", ""
		copy.VNCUnit, copy.ServerUnit, copy.GatewayUnit, copy.SessionUnit = "", "", "", ""
	}
	if m.cfg.disableKiosk {
		copy.ViewerURL = ""
	}
	return &publicInstanceView{
		Versions: m.versionView(item), Upgrade: publicUpgrade(item),
		ID: copy.ID, ClassID: copy.ClassID, TemplateID: copy.TemplateID,
		DriverVersion: copy.DriverVersion, ManagedID: copy.ManagedID,
		ProfileRef: copy.ProfileRef, WorkspaceMode: copy.WorkspaceMode,
		EffectivePolicy: copy.EffectivePolicy, Parameters: copy.Parameters,
		ApplicationStatus: copy.ApplicationStatus, SessionGeneration: copy.SessionGeneration,
		State: copy.State, Display: copy.Display, Resources: copy.Resources,
		ViewerURL: copy.ViewerURL, CreatedAt: copy.CreatedAt, Error: copy.Error,
		SessionState: copy.SessionState, StartupFailure: copy.StartupFailure, SessionRecovery: copy.SessionRecovery, AttachedClients: copy.AttachedClients,
		Shutdown: copy.Shutdown, Home: copy.Home, XAuthority: copy.XAuthority,
		Runtime: copy.Runtime, SocketRuntime: copy.SocketRuntime, RFBAddr: copy.RFBAddr,
		GatewayAddr: copy.GatewayAddr, VNCUnit: copy.VNCUnit, ServerUnit: copy.ServerUnit,
		GatewayUnit: copy.GatewayUnit, SessionUnit: copy.SessionUnit,
	}
}

func (m *manager) publicInstances(items []*instance) []*publicInstanceView {
	result := make([]*publicInstanceView, 0, len(items))
	for _, item := range items {
		result = append(result, m.publicInstance(item))
	}
	return result
}

func (m *manager) serveInstanceRoute(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.TrimPrefix(r.URL.Path, "/remotexapps/")
	parts := strings.SplitN(trimmed, "/", 2)
	if len(parts) != 2 {
		http.NotFound(w, r)
		return
	}
	if parts[1] == "kiosk.html" && m.cfg.disableKiosk {
		http.NotFound(w, r)
		return
	}
	item := m.get(parts[0])
	if item == nil || (item.State != "server-ready" && item.State != "ready") {
		writeError(w, http.StatusServiceUnavailable, "instance is not ready")
		return
	}
	if parts[1] == "kiosk.html" {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			methodNotAllowed(w, "GET, HEAD")
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		if r.Method == http.MethodGet {
			_, _ = w.Write(consoleHTML)
		}
		return
	}
	if isRFBWebSocket(parts[1], r) {
		if err := m.attachRFB(item.ID); err != nil {
			writeError(w, http.StatusServiceUnavailable, "session start failed: "+err.Error())
			return
		}
		defer m.detachRFB(item.ID)
	}
	targetURL, _ := url.Parse("http://" + item.GatewayAddr)
	proxy := httputil.NewSingleHostReverseProxy(targetURL)
	originalDirector := proxy.Director
	proxy.Director = func(request *http.Request) {
		originalDirector(request)
		request.URL.Path = "/" + parts[1]
		// Preserve the browser-facing Host. The per-instance gateway compares it
		// with Origin during the WebSocket upgrade; replacing it with the
		// loopback target would incorrectly reject a same-origin client.
	}
	proxy.ErrorHandler = func(writer http.ResponseWriter, _ *http.Request, err error) {
		log.Printf("instance %s proxy: %v", item.ID, err)
		writeError(writer, http.StatusBadGateway, "instance gateway unavailable")
	}
	proxy.ServeHTTP(w, r)
}

func isRFBWebSocket(path string, r *http.Request) bool {
	if path != "rfb" && path != "rfb-compat" && path != "websockify" {
		return false
	}
	return strings.EqualFold(r.Header.Get("Upgrade"), "websocket")
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func methodNotAllowed(w http.ResponseWriter, allow string) {
	w.Header().Set("Allow", allow)
	writeError(w, http.StatusMethodNotAllowed, "method not allowed")
}
