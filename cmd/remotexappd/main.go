package main

import (
	"context"
	"embed"
	"encoding/json"
	"flag"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"
)

var (
	version        = "dev"
	commit         = "unknown"
	buildDate      = "unknown"
	serviceStarted = time.Now()
)

//go:embed web/console.html
var consoleHTML []byte

//go:embed web/sdk/*
var sdkFiles embed.FS

func main() {
	cfg := config{}
	serviceRestartDefault, environmentErr := booleanEnvironmentDefault("REMOTEXAPP_ENABLE_SERVICE_RESTART", false)
	if environmentErr != nil {
		log.Fatal(environmentErr)
	}
	var installAppArchive, installAppSHA256, activateApp, disableApp, retireApp string
	var installAppActivate bool
	var checkAppCatalog bool
	flag.StringVar(&cfg.listen, "listen", "127.0.0.1:1991", "HTTP/WebSocket listen address")
	flag.StringVar(&cfg.stateDir, "state-dir", ".runtime/remotexappd", "profiles and runtime state root")
	flag.StringVar(&cfg.classConfigPath, "class-config", "configs/remotexapp-classes", "registered class configuration file or directory")
	flag.StringVar(&cfg.appPackageRoot, "app-package-root", os.Getenv("REMOTEXAPP_APP_PACKAGE_ROOT"), "immutable App Package version root (requires -apps-enabled)")
	flag.StringVar(&cfg.appsEnabledPath, "apps-enabled", os.Getenv("REMOTEXAPP_APPS_ENABLED"), "enabled App Package selector directory (requires -app-package-root)")
	flag.StringVar(&cfg.siteDisplayFile, "site-display-config", os.Getenv("REMOTEXAPP_SITE_DISPLAY_CONFIG"), "administrator-owned fixed display/port allocation JSON")
	flag.StringVar(&installAppArchive, "install-app-archive", "", "install one App Package .tar.gz and exit")
	flag.StringVar(&installAppSHA256, "install-app-sha256", "", "expected SHA-256 for -install-app-archive")
	flag.BoolVar(&installAppActivate, "install-app-activate", true, "atomically activate an installed App Package")
	flag.StringVar(&activateApp, "activate-app", "", "atomically activate an installed App Package as ID@VERSION and exit")
	flag.StringVar(&disableApp, "disable-app", "", "atomically disable an App Package by ID and exit")
	flag.StringVar(&retireApp, "retire-app", "", "disable an App Package only when durable state has no reference to its ID, then exit")
	flag.BoolVar(&checkAppCatalog, "check-app-catalog", false, "validate enabled App Packages and their dependencies, then exit")
	flag.StringVar(&cfg.documentRootsSpec, "document-roots", os.Getenv("REMOTEXAPP_DOCUMENT_ROOTS"), "colon-separated roots allowed for file launch parameters (default STATE_DIR/documents)")
	flag.StringVar(&cfg.engine, "ibus-engine", "components/remote-unicode-engine/engine.py", "remote Unicode IBus engine")
	flag.StringVar(&cfg.gatewayBinary, "gateway-bin", "./novnc-input", "novnc-input binary")
	flag.StringVar(&cfg.gatewayTextLog, "gateway-text-log", "errors", "per-instance gateway text logging: errors, metadata, or content")
	flag.StringVar(&cfg.statusBinary, "status-bin", "./remotexapp-status", "validated driver status helper")
	coreDriverDir := os.Getenv("REMOTEXAPP_CORE_DRIVER_DIR")
	if coreDriverDir == "" {
		coreDriverDir = "drivers/common"
	}
	flag.StringVar(&cfg.coreDriverDir, "core-driver-dir", coreDriverDir, "immutable core driver helper directory for App Package ABI")
	flag.StringVar(&cfg.vncLauncher, "vnc-launcher", "direct", "VNC launcher: direct or wrapper")
	flag.StringVar(&cfg.lifecycleBackend, "lifecycle-backend", "systemd", "component lifecycle backend: systemd or standalone")
	flag.StringVar(&cfg.standaloneCgroupRoot, "standalone-cgroup-root", "", "host-delegated cgroup v2 subtree for standalone components")
	flag.StringVar(&cfg.managedObserver, "managed-observer", "cgroup", "managed runtime observer: cgroup or poll")
	flag.StringVar(&cfg.sessionObserver, "session-observer", "cgroup", "session exit observer: cgroup or poll")
	flag.DurationVar(&cfg.managedSafety, "managed-safety-interval", 5*time.Minute, "managed runtime safety reconciliation interval in cgroup mode")
	flag.DurationVar(&cfg.shutdownGrace, "shutdown-grace-timeout", 15*time.Second, "maximum application-driver graceful shutdown time")
	flag.DurationVar(&cfg.shutdownWarnAfter, "shutdown-blocked-warning-after", time.Hour, "warn when a graceful shutdown remains blocked (0 disables)")
	flag.DurationVar(&cfg.shutdownForceAfter, "shutdown-force-after", 0, "force a host-initiated blocked shutdown after this duration (0 never forces)")
	flag.DurationVar(&cfg.failedStartGrace, "failed-start-grace", 2*time.Minute, "retain an unattached anonymous instance after session startup fails before cleanup")
	flag.StringVar(&cfg.authMode, "auth-mode", "trusted-header", "authentication mode: trusted-header or none")
	flag.StringVar(&cfg.identityHeader, "identity-header", "Cf-Access-Authenticated-User-Email", "identity header accepted from a trusted reverse proxy")
	flag.StringVar(&cfg.trustedProxies, "trusted-proxies", "127.0.0.0/8,::1/128", "comma-separated reverse proxy CIDRs")
	flag.BoolVar(&cfg.allowInsecure, "allow-insecure-public", false, "allow auth-mode=none, including sensitive API operations, on a non-loopback listener (controlled testing only)")
	flag.BoolVar(&cfg.exposeInternals, "expose-internals", false, "include host paths, ports, and systemd units in operator API responses")
	flag.BoolVar(&cfg.disableConsole, "disable-console", false, "disable the built-in root, console, and minimal pages")
	flag.BoolVar(&cfg.disableKiosk, "disable-kiosk", false, "disable the built-in per-instance kiosk page")
	flag.BoolVar(&cfg.enableServiceRestart, "enable-service-restart", serviceRestartDefault, "allow authenticated operators to request a user-service restart through the separate helper")
	flag.StringVar(&cfg.operatorSocket, "operator-socket", filepath.Join("/run/user", strconv.Itoa(os.Getuid()), "remotexapp", "operator.sock"), "owner-only Unix socket for the separate operator helper")
	flag.IntVar(&cfg.maxInstances, "max-instances", 32, "maximum active runtime instances")
	flag.StringVar(&cfg.connectionsTokenFile, "connections-token-file", os.Getenv("REMOTEXAPP_CONNECTIONS_TOKEN_FILE"), "deprecated, ignored; connection reads use Manager authentication")
	flag.Parse()
	if cfg.failedStartGrace < time.Second || cfg.failedStartGrace > time.Hour {
		log.Fatal("failed-start-grace must be between 1s and 1h")
	}
	appOperations := 0
	for _, value := range []string{installAppArchive, activateApp, disableApp, retireApp} {
		if value != "" {
			appOperations++
		}
	}
	if checkAppCatalog {
		appOperations++
	}
	if appOperations > 1 {
		log.Fatal("install-app-archive, activate-app, disable-app, retire-app, and check-app-catalog are mutually exclusive")
	}
	if appOperations != 0 {
		if cfg.appPackageRoot == "" || cfg.appsEnabledPath == "" {
			log.Fatal("App Package operations require app-package-root and apps-enabled")
		}
		for _, target := range []*string{&cfg.appPackageRoot, &cfg.appsEnabledPath} {
			var pathErr error
			*target, pathErr = filepath.Abs(*target)
			if pathErr != nil {
				log.Fatal(pathErr)
			}
		}
	}
	if installAppArchive != "" {
		if installAppSHA256 == "" {
			log.Fatal("install-app-archive requires install-app-sha256")
		}
		var pathErr error
		installAppArchive, pathErr = filepath.Abs(installAppArchive)
		if pathErr != nil {
			log.Fatal(pathErr)
		}
		reference, installErr := installAppPackageArchive(installAppArchive, installAppSHA256, cfg.appPackageRoot, cfg.appsEnabledPath, installAppActivate)
		if installErr != nil {
			log.Fatal(installErr)
		}
		if encodeErr := json.NewEncoder(os.Stdout).Encode(reference); encodeErr != nil {
			log.Fatal(encodeErr)
		}
		return
	}
	if activateApp != "" {
		parts := strings.Split(activateApp, "@")
		if len(parts) != 2 {
			log.Fatal("activate-app must use ID@VERSION")
		}
		reference, activateErr := activateInstalledAppPackage(parts[0], parts[1], cfg.appPackageRoot, cfg.appsEnabledPath)
		if activateErr != nil {
			log.Fatal(activateErr)
		}
		if encodeErr := json.NewEncoder(os.Stdout).Encode(reference); encodeErr != nil {
			log.Fatal(encodeErr)
		}
		return
	}
	if disableApp != "" {
		if disableErr := disableAppPackage(disableApp, cfg.appPackageRoot, cfg.appsEnabledPath); disableErr != nil {
			log.Fatal(disableErr)
		}
		if encodeErr := json.NewEncoder(os.Stdout).Encode(map[string]any{"id": disableApp, "enabled": false}); encodeErr != nil {
			log.Fatal(encodeErr)
		}
		return
	}
	if retireApp != "" {
		var pathErr error
		cfg.stateDir, pathErr = filepath.Abs(cfg.stateDir)
		if pathErr != nil {
			log.Fatal(pathErr)
		}
		if retireErr := retireAppPackage(retireApp, cfg.appPackageRoot, cfg.appsEnabledPath, cfg.stateDir); retireErr != nil {
			log.Fatal(retireErr)
		}
		if encodeErr := json.NewEncoder(os.Stdout).Encode(map[string]any{"id": retireApp, "enabled": false, "retired": true}); encodeErr != nil {
			log.Fatal(encodeErr)
		}
		return
	}
	if checkAppCatalog {
		classes, _, checkErr := loadAppPackageCatalog(cfg.appPackageRoot, cfg.appsEnabledPath)
		if checkErr != nil {
			log.Fatal(checkErr)
		}
		if encodeErr := json.NewEncoder(os.Stdout).Encode(map[string]any{"apiVersion": appPackageAPIVersion, "enabled": len(classes)}); encodeErr != nil {
			log.Fatal(encodeErr)
		}
		return
	}
	if cfg.authMode != "trusted-header" && cfg.authMode != "none" {
		log.Fatalf("unsupported auth mode %q", cfg.authMode)
	}
	if cfg.identityHeader == "" || cfg.maxInstances < 1 || cfg.maxInstances > 1000 {
		log.Fatal("identity-header must be non-empty and max-instances must be between 1 and 1000")
	}
	var err error
	if cfg.trustedProxyNetworks, err = parseTrustedNetworks(cfg.trustedProxies); err != nil {
		log.Fatal(err)
	}
	if cfg.authMode == "none" && !listenIsLoopback(cfg.listen) && !cfg.allowInsecure {
		log.Fatal("auth-mode=none on a non-loopback listener requires -allow-insecure-public")
	}
	if cfg.enableServiceRestart && cfg.authMode == "none" {
		log.Fatal("service restart requires authenticated trusted-header mode")
	}
	if cfg.enableServiceRestart && (!filepath.IsAbs(cfg.operatorSocket) || !pathWithinUserRuntime(cfg.operatorSocket)) {
		log.Fatal("service restart operator socket must be an absolute path below the current user's runtime directory")
	}
	if cfg.vncLauncher != "wrapper" && cfg.vncLauncher != "direct" {
		log.Fatalf("unsupported VNC launcher %q", cfg.vncLauncher)
	}
	if cfg.lifecycleBackend != "systemd" && cfg.lifecycleBackend != "standalone" {
		log.Fatalf("unsupported lifecycle backend %q", cfg.lifecycleBackend)
	}
	if cfg.lifecycleBackend == "standalone" && cfg.vncLauncher != "direct" {
		log.Fatal("standalone backend requires the direct VNC launcher")
	}
	if cfg.lifecycleBackend == "standalone" && cfg.enableServiceRestart {
		log.Fatal("the systemd operator service restart helper is unavailable with standalone lifecycle")
	}
	if cfg.lifecycleBackend == "systemd" && cfg.standaloneCgroupRoot != "" {
		log.Fatal("standalone-cgroup-root requires lifecycle-backend=standalone")
	}
	if cfg.managedObserver != "cgroup" && cfg.managedObserver != "poll" {
		log.Fatalf("unsupported managed observer %q", cfg.managedObserver)
	}
	if cfg.sessionObserver != "cgroup" && cfg.sessionObserver != "poll" {
		log.Fatalf("unsupported session observer %q", cfg.sessionObserver)
	}
	if !validGatewayTextLog(cfg.gatewayTextLog) {
		log.Fatalf("unsupported gateway text log level %q", cfg.gatewayTextLog)
	}
	if cfg.managedObserver == "cgroup" && cfg.managedSafety < 30*time.Second {
		log.Fatalf("managed safety interval must be at least 30s in cgroup mode")
	}
	if cfg.shutdownGrace < time.Second || cfg.shutdownGrace > 5*time.Minute {
		log.Fatal("shutdown grace timeout must be between 1s and 5m")
	}
	if cfg.shutdownWarnAfter < 0 || cfg.shutdownForceAfter < 0 {
		log.Fatal("shutdown blocked durations cannot be negative")
	}

	for _, target := range []*string{&cfg.stateDir, &cfg.classConfigPath, &cfg.engine, &cfg.gatewayBinary, &cfg.statusBinary, &cfg.coreDriverDir} {
		*target, err = filepath.Abs(*target)
		if err != nil {
			log.Fatal(err)
		}
	}
	if (cfg.appPackageRoot == "") != (cfg.appsEnabledPath == "") {
		log.Fatal("app-package-root and apps-enabled must be configured together")
	}
	for _, target := range []*string{&cfg.appPackageRoot, &cfg.appsEnabledPath} {
		if *target == "" {
			continue
		}
		*target, err = filepath.Abs(*target)
		if err != nil {
			log.Fatal(err)
		}
	}
	if cfg.documentRoots, err = resolveDocumentRoots(cfg.documentRootsSpec, cfg.stateDir); err != nil {
		log.Fatal(err)
	}
	// Resolve release-selector symlinks once. Every runtime created by this
	// manager then remains pinned even if a newer release is activated.
	for _, target := range []*string{&cfg.engine, &cfg.gatewayBinary, &cfg.statusBinary, &cfg.coreDriverDir} {
		if resolved, resolveErr := filepath.EvalSymlinks(*target); resolveErr == nil {
			*target = resolved
		}
	}
	if cfg.classes, cfg.vacantTimeouts, err = loadClassCatalog(cfg.classConfigPath); err != nil {
		log.Fatal(err)
	}
	if cfg.appPackageRoot != "" {
		packageClasses, packageTimeouts, loadErr := loadAppPackageCatalog(cfg.appPackageRoot, cfg.appsEnabledPath)
		if loadErr != nil {
			log.Fatal(loadErr)
		}
		for id, class := range packageClasses {
			if _, exists := cfg.classes[id]; exists {
				log.Fatalf("App Package id %q conflicts with the legacy class catalog", id)
			}
			cfg.classes[id] = class
			cfg.vacantTimeouts[id] = packageTimeouts[id]
		}
		cfg.appPackageCount = len(packageClasses)
	}
	if err := applySiteDisplayConfig(cfg.siteDisplayFile, cfg.classes); err != nil {
		log.Fatal(err)
	}
	if cfg.appPackageCount > 0 {
		info, statErr := os.Stat(cfg.coreDriverDir)
		if statErr != nil || !info.IsDir() {
			log.Fatalf("core driver helper directory %q is unavailable", cfg.coreDriverDir)
		}
	}
	if len(cfg.classes) == 0 {
		log.Fatal("template catalog is empty")
	}
	requiredPaths := []string{cfg.engine, cfg.gatewayBinary}
	if cfg.vncLauncher == "direct" {
		requiredPaths = append(requiredPaths, "/usr/bin/Xtigervnc", "/usr/bin/xauth")
	}
	for _, class := range cfg.classes {
		if class.Session.Status.Mode == "driver" {
			requiredPaths = append(requiredPaths, cfg.statusBinary)
			break
		}
	}
	for _, required := range requiredPaths {
		if _, err := os.Stat(required); err != nil {
			log.Fatalf("required path %q: %v", required, err)
		}
	}
	if err := os.MkdirAll(cfg.stateDir, 0o700); err != nil {
		log.Fatal(err)
	}
	if cfg.enableServiceRestart {
		if err := probeOperatorHelper(cfg.operatorSocket); err != nil {
			log.Fatalf("service restart operator helper unavailable: %v", err)
		}
	}

	bootID, err := readSystemBootID()
	if err != nil {
		log.Fatalf("read system boot identity: %v", err)
	}
	m := &manager{
		bootID: bootID,
		cfg:    cfg, instances: make(map[string]*instance), idleTimers: make(map[string]*time.Timer),
		managed: make(map[string]*managedInstance), managedEvents: make(chan managedRuntimeEvent, 128),
		sessionEvents: make(chan sessionRuntimeEvent, 128),
	}
	if cfg.lifecycleBackend == "standalone" {
		m.standalone, err = openStandaloneCgroupRoot(cfg.standaloneCgroupRoot)
		if err != nil {
			log.Fatalf("initialize standalone lifecycle backend: %v", err)
		}
	}
	if err := m.loadManagedRegistry(); err != nil {
		log.Fatal(err)
	}
	runtimeManifests, err := m.loadRuntimeManifests()
	if err != nil {
		log.Fatal(err)
	}
	runtimeManifests, err = m.bindManagedRuntimeManifests(runtimeManifests)
	if err != nil {
		log.Fatal(err)
	}
	if err := m.reconcileStandaloneLaunchIntents(); err != nil {
		log.Fatalf("reconcile interrupted standalone launches: %v", err)
	}
	if err := m.reconcileStandaloneEmptyComponents(); err != nil {
		log.Fatalf("reclaim empty standalone components: %v", err)
	}
	if cfg.managedObserver == "cgroup" || cfg.sessionObserver == "cgroup" {
		root := "/sys/fs/cgroup"
		if m.standalone != nil {
			root = m.standalone.path
		}
		observer, err := newCgroupRuntimeObserver(root, os.Getuid(), m.queueManagedRuntimeEvent, m.queueSessionRuntimeEvent, m.standalone != nil)
		if err != nil {
			log.Fatalf("initialize cgroup observer: %v (use the corresponding observer=poll flags for compatibility fallback)", err)
		}
		if cfg.managedObserver == "cgroup" {
			m.managedObserver = observer
		}
		if cfg.sessionObserver == "cgroup" {
			m.sessionObserver = observer
		}
	}
	m.restoreRuntimeManifests(runtimeManifests)
	for _, runtime := range m.instances {
		active := runtime.SessionState == "running" || runtime.SessionState == "shutdown-blocked"
		if err := m.setGatewayClipboardSession(runtime, runtime.SessionGeneration, active); err != nil {
			log.Printf("runtime %s restore clipboard session state: %v", runtime.ID, err)
		}
	}
	if err := m.linkManagedRuntimes(); err != nil {
		log.Fatal(err)
	}
	// Install every restored watch and managed/runtime link before consuming
	// cgroup events. The shared observer channels are buffered, so an event that
	// arrives during restoration is retained without racing startup state.
	if cfg.managedObserver == "cgroup" {
		go m.reconcileManagedEvents()
	}
	// Readiness-process events are emitted in both cgroup and poll modes.
	go m.reconcileSessionEvents()
	m.reconcileManaged()
	if m.standalone != nil {
		go m.monitorStandaloneComponents()
	}

	classIDs := make([]string, 0, len(cfg.classes))
	for classID := range cfg.classes {
		classIDs = append(classIDs, classID)
	}
	sort.Strings(classIDs)
	for _, classID := range classIDs {
		class := cfg.classes[classID]
		if class.Server.Activation == "auto" && !m.managedTemplateRegistered(class.ID) {
			if _, err := m.create(createRequest{ClassID: class.ID, ProfileRef: class.ProfileRef}); err != nil {
				log.Fatalf("autostart class %s: %v", class.ID, err)
			}
		}
	}
	if cfg.managedObserver == "cgroup" {
		go m.reconcileManagedLoop(cfg.managedSafety, true)
	} else {
		go m.reconcileManagedLoop(5*time.Second, false)
	}
	server := &http.Server{
		Addr: cfg.listen, Handler: m.handler(),
		ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 75 * time.Second, MaxHeaderBytes: 1 << 20,
	}
	log.Printf("remotexapp %s (%s): http://%s/ (%d templates, %d App Packages, %d managed instances; auth=%s; lifecycle=%s; managed observer=%s safety=%s; session observer=%s; shutdown grace=%s warning=%s force-after=%s)", version, commit, cfg.listen, len(cfg.classes), cfg.appPackageCount, len(m.listManaged()), cfg.authMode, cfg.lifecycleBackend, cfg.managedObserver, cfg.managedSafety, cfg.sessionObserver, cfg.shutdownGrace, cfg.shutdownWarnAfter, cfg.shutdownForceAfter)
	serverErrors := make(chan error, 1)
	go func() { serverErrors <- server.ListenAndServe() }()
	reportDocumentRootAvailability(cfg.documentRoots, time.Second, func(root string) error {
		_, err := resolveAvailableDocumentRoot(root)
		return err
	}, log.Printf)
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	select {
	case err := <-serverErrors:
		if err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	case signal := <-signals:
		log.Printf("received %s; draining HTTP connections", signal)
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			log.Printf("HTTP shutdown: %v", err)
		}
	}
}

func listenIsLoopback(address string) bool {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	return strings.EqualFold(host, "localhost") || (ip != nil && ip.IsLoopback())
}

func pathWithinUserRuntime(path string) bool {
	root := filepath.Join("/run/user", strconv.Itoa(os.Getuid()))
	relative, err := filepath.Rel(root, filepath.Clean(path))
	return err == nil && relative != "." && relative != "" && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}
