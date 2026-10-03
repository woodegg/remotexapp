package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type config struct {
	listen               string
	stateDir             string
	classConfigPath      string
	appPackageRoot       string
	appsEnabledPath      string
	appPackageCount      int
	siteDisplayFile      string
	documentRootsSpec    string
	documentRoots        []string
	engine               string
	gatewayBinary        string
	gatewayTextLog       string
	statusBinary         string
	coreDriverDir        string
	vncLauncher          string
	lifecycleBackend     string
	standaloneCgroupRoot string
	managedObserver      string
	sessionObserver      string
	managedSafety        time.Duration
	shutdownGrace        time.Duration
	shutdownWarnAfter    time.Duration
	shutdownForceAfter   time.Duration
	failedStartGrace     time.Duration
	authMode             string
	identityHeader       string
	trustedProxies       string
	allowInsecure        bool
	connectionsTokenFile string
	exposeInternals      bool
	disableConsole       bool
	disableKiosk         bool
	enableServiceRestart bool
	operatorSocket       string
	maxInstances         int
	trustedProxyNetworks []*net.IPNet
	classes              map[string]classConfig
	vacantTimeouts       map[string]time.Duration
}

func booleanEnvironmentDefault(name string, fallback bool) (bool, error) {
	raw, present := os.LookupEnv(name)
	if !present || strings.TrimSpace(raw) == "" {
		return fallback, nil
	}
	switch raw {
	case "true":
		return true, nil
	case "false":
		return false, nil
	default:
		return false, fmt.Errorf("%s must be true or false", name)
	}
}

func parseTrustedNetworks(value string) ([]*net.IPNet, error) {
	var networks []*net.IPNet
	for _, raw := range strings.Split(value, ",") {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		_, network, err := net.ParseCIDR(raw)
		if err != nil {
			return nil, fmt.Errorf("invalid trusted proxy CIDR %q", raw)
		}
		networks = append(networks, network)
	}
	if len(networks) == 0 {
		return nil, errors.New("at least one trusted proxy CIDR is required")
	}
	return networks, nil
}

type classConfig struct {
	APIVersion    string                         `json:"apiVersion,omitempty"`
	ID            string                         `json:"id"`
	Name          string                         `json:"name"`
	DriverVersion string                         `json:"driverVersion"`
	Singleton     bool                           `json:"singleton"`
	ProfileRef    string                         `json:"profileRef"`
	RunMode       string                         `json:"runMode"`
	Server        serverClassConfig              `json:"server"`
	Session       sessionClassConfig             `json:"session"`
	Input         inputClassConfig               `json:"input"`
	Control       controlClassConfig             `json:"control,omitempty"`
	Ports         map[string]portClassConfig     `json:"ports,omitempty"`
	Parameters    map[string]parameterDefinition `json:"parameters,omitempty"`
	Actions       map[string]actionDefinition    `json:"actions,omitempty"`
	Driver        *driverClassConfig             `json:"driver,omitempty"`
	Overrides     *overridePolicyConfig          `json:"overrides,omitempty"`
	Dependencies  *dependencyClassConfig         `json:"dependencies,omitempty"`
	Package       *appPackageReference           `json:"-"`
}

type portClassConfig struct {
	Kind string `json:"kind"`
	Port int    `json:"port"`
}

type driverClassConfig struct {
	Config json.RawMessage `json:"config"`
}

type overridePolicyConfig struct {
	Allowed []string `json:"allowed"`
}

type dependencyClassConfig struct {
	Executables   []string `json:"executables"`
	PythonModules []string `json:"pythonModules"`
}

type controlClassConfig struct {
	Protocol string `json:"protocol,omitempty"`
	Address  string `json:"address,omitempty"`
	Port     int    `json:"port,omitempty"`
	Path     string `json:"path,omitempty"`
}

type serverClassConfig struct {
	Activation        string   `json:"activation"`
	Driver            string   `json:"driver"`
	DisplayMode       string   `json:"displayMode"`
	Display           int      `json:"display"`
	RFBPort           int      `json:"rfbPort"`
	GatewayPort       int      `json:"gatewayPort"`
	Geometry          string   `json:"geometry"`
	Depth             int      `json:"depth"`
	FrameRate         int      `json:"frameRate"`
	AllowClientResize bool     `json:"allowClientResize"`
	ReadinessPIDs     []string `json:"readinessPids"`
	ReadinessTimeout  string   `json:"readinessTimeout,omitempty"`
}

type sessionClassConfig struct {
	Services           string            `json:"services"`
	Activation         string            `json:"activation"`
	Driver             string            `json:"driver"`
	ShutdownDriver     string            `json:"shutdownDriver,omitempty"`
	ViewerAttachDriver string            `json:"viewerAttachDriver,omitempty"`
	ViewerDetachDriver string            `json:"viewerDetachDriver,omitempty"`
	ReadinessPID       string            `json:"readinessPid"`
	ReadinessTimeout   string            `json:"readinessTimeout,omitempty"`
	VacantTimeout      string            `json:"vacantTimeout"`
	VacantAction       string            `json:"vacantAction"`
	Status             statusClassConfig `json:"status,omitempty"`
}

type statusClassConfig struct {
	PrivateDetails map[string]parameterDefinition `json:"privateDetails,omitempty"`
	Mode           string                         `json:"mode,omitempty"`
	Details        map[string]parameterDefinition `json:"details,omitempty"`
}

type inputClassConfig struct {
	Backend          string   `json:"backend"`
	Lifecycle        string   `json:"lifecycle,omitempty"`
	AllowedWMClasses []string `json:"allowedWmClasses"`
}

var safeRef = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)
var runtimeRef = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,95}$`)
var safeGeometry = regexp.MustCompile(`^[1-9][0-9]{1,4}x[1-9][0-9]{1,4}$`)
var semanticVersion = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$`)

func validGatewayTextLog(level string) bool {
	return level == "errors" || level == "metadata" || level == "content"
}

func loadClassConfig(path string) (classConfig, time.Duration, error) {
	var class classConfig
	file, err := os.Open(path)
	if err != nil {
		return class, 0, fmt.Errorf("open class config: %w", err)
	}
	defer file.Close()
	if info, err := file.Stat(); err != nil {
		return class, 0, fmt.Errorf("stat class config: %w", err)
	} else if info.Size() > 64<<10 {
		return class, 0, errors.New("class config exceeds 65536 bytes")
	}
	decoder := json.NewDecoder(io.LimitReader(file, 64<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&class); err != nil {
		return class, 0, fmt.Errorf("decode class config: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return class, 0, errors.New("class config must contain exactly one JSON object")
	}
	if !safeRef.MatchString(class.ID) || !safeRef.MatchString(class.ProfileRef) {
		return class, 0, errors.New("class id and profileRef must be safe lowercase references")
	}
	if class.DriverVersion == "" {
		// External and pre-version catalogs remain loadable, but are visibly
		// marked legacy and should be assigned a real version before release.
		class.DriverVersion = "0.0.0-legacy"
	}
	if !semanticVersion.MatchString(class.DriverVersion) {
		return class, 0, errors.New("driverVersion must be a semantic version such as 1.2.0")
	}
	if err := normalizeRunMode(&class); err != nil {
		return class, 0, err
	}
	if class.RunMode == "user-home" && !class.Singleton {
		return class, 0, errors.New("runMode user-home requires singleton true")
	}
	if err := validateParameterDefinitions(class.Parameters); err != nil {
		return class, 0, fmt.Errorf("parameters: %w", err)
	}
	if err := normalizeControlConfig(&class.Control); err != nil {
		return class, 0, err
	}
	if err := validateClassExtensions(&class); err != nil {
		return class, 0, err
	}
	if class.Parameters == nil {
		class.Parameters = map[string]parameterDefinition{}
	}
	if class.Server.Activation != "auto" && class.Server.Activation != "on-demand" {
		return class, 0, fmt.Errorf("unsupported server activation %q", class.Server.Activation)
	}
	if class.Session.Activation != "on-attach" && class.Session.Activation != "immediate" {
		return class, 0, fmt.Errorf("unsupported session activation %q", class.Session.Activation)
	}
	server := class.Server
	if server.DisplayMode == "" {
		server.DisplayMode = "fixed"
		class.Server.DisplayMode = "fixed"
	}
	if server.DisplayMode != "fixed" && server.DisplayMode != "dynamic" {
		return class, 0, fmt.Errorf("unsupported displayMode %q", server.DisplayMode)
	}
	if class.RunMode == "user-home" && server.DisplayMode != "fixed" {
		return class, 0, errors.New("runMode user-home requires a fixed display")
	}
	if (server.DisplayMode == "fixed" && (server.Display < 1 || server.Display > 99 || server.RFBPort < 1 || server.GatewayPort < 1)) ||
		(server.DisplayMode == "dynamic" && (server.Display != 0 || server.RFBPort != 0 || server.GatewayPort != 0)) ||
		!safeGeometry.MatchString(server.Geometry) || (server.Depth != 16 && server.Depth != 24) ||
		server.FrameRate < 1 || server.FrameRate > 60 {
		return class, 0, errors.New("invalid class display configuration")
	}
	if class.Input.Backend != "ibus" || len(class.Input.AllowedWMClasses) == 0 {
		return class, 0, errors.New("remote application classes require ibus and at least one allowed WM_CLASS")
	}
	if class.Session.Services != "core-v1" {
		return class, 0, errors.New("session.services must be core-v1; old Driver-owned contracts require a stopped-system cutover")
	}
	if class.Input.Lifecycle != "session" {
		return class, 0, fmt.Errorf("unsupported input lifecycle %q", class.Input.Lifecycle)
	}
	if len(class.Server.ReadinessPIDs) == 0 {
		return class, 0, errors.New("server readinessPids must contain at least one runtime-local PID filename")
	}
	for _, name := range class.Server.ReadinessPIDs {
		if filepath.Base(name) != name || name == "." || name == "" {
			return class, 0, errors.New("server readinessPids must be runtime-local filenames")
		}
	}
	if _, err := readinessTimeout(class.Server.ReadinessTimeout); err != nil {
		return class, 0, fmt.Errorf("server readinessTimeout: %w", err)
	}
	if class.Session.ReadinessPID == "" {
		class.Session.ReadinessPID = "session.pid"
	}
	if filepath.Base(class.Session.ReadinessPID) != class.Session.ReadinessPID || class.Session.ReadinessPID == "." {
		return class, 0, errors.New("session readinessPid must be a runtime-local filename")
	}
	if _, err := readinessTimeout(class.Session.ReadinessTimeout); err != nil {
		return class, 0, fmt.Errorf("session readinessTimeout: %w", err)
	}
	if class.Session.VacantAction == "" {
		class.Session.VacantAction = "stop-session"
	}
	if class.Session.VacantAction != "stop-session" && class.Session.VacantAction != "stop-instance" {
		return class, 0, fmt.Errorf("unsupported session vacantAction %q", class.Session.VacantAction)
	}
	if class.Session.Status.Mode != "driver" {
		return class, 0, fmt.Errorf("core-v1 requires session status mode driver, got %q", class.Session.Status.Mode)
	}
	if err := validateParameterDefinitions(class.Session.Status.Details); err != nil {
		return class, 0, fmt.Errorf("session status details: %w", err)
	}
	for name, definition := range class.Session.Status.Details {
		if definition.Type == "file" {
			return class, 0, fmt.Errorf("session status detail %q cannot expose a file parameter", name)
		}
		if definition.Required || len(definition.Default) != 0 {
			return class, 0, fmt.Errorf("session status detail %q cannot be required or have a default", name)
		}
	}
	if err := validateParameterDefinitions(class.Session.Status.PrivateDetails); err != nil {
		return class, 0, errors.New("invalid private connection schema")
	}
	for name, definition := range class.Session.Status.PrivateDetails {
		if name != "application" || definition.Type != "json" || definition.Required || len(definition.Default) != 0 || class.Session.Status.Mode != "driver" {
			return class, 0, errors.New("privateDetails only supports an optional bounded application JSON descriptor in driver mode")
		}
		if _, exists := class.Session.Status.Details["control"]; exists {
			return class, 0, errors.New("public control and private application cannot both be declared")
		}
	}
	if class.Session.Status.Details == nil {
		class.Session.Status.Details = map[string]parameterDefinition{}
	}
	vacantTimeout, err := time.ParseDuration(class.Session.VacantTimeout)
	if err != nil || vacantTimeout < time.Second {
		return class, 0, errors.New("session vacantTimeout must be a duration of at least 1s")
	}
	return class, vacantTimeout, nil
}

func normalizeControlConfig(control *controlClassConfig) error {
	if control.Protocol == "" {
		if control.Address != "" || control.Port != 0 || control.Path != "" {
			return errors.New("control address, port, and path require a control protocol")
		}
		return nil
	}
	if control.Address == "" {
		control.Address = "127.0.0.1"
	}
	if control.Address != "127.0.0.1" {
		return errors.New("control address must be exactly 127.0.0.1")
	}
	if control.Port < 0 || control.Port > 65535 || (control.Port > 0 && control.Port < 1024) {
		return errors.New("control port must be zero or an unprivileged TCP port")
	}
	if !safeRef.MatchString(control.Protocol) {
		return errors.New("legacy control protocol must be a safe lowercase reference")
	}
	if control.Path != "" && (!strings.HasPrefix(control.Path, "/") || len(control.Path) > 1024 || strings.ContainsAny(control.Path, "\r\n\t?#")) {
		return errors.New("legacy control path must be an absolute path without query, fragment, or control characters")
	}
	return nil
}

func normalizeRunMode(class *classConfig) error {
	if class.RunMode == "" {
		return errors.New("runMode is required")
	}
	if class.RunMode != "shared" && class.RunMode != "isolated" && class.RunMode != "user-home" {
		return fmt.Errorf("unsupported runMode %q", class.RunMode)
	}
	return nil
}

func loadClassCatalog(path string) (map[string]classConfig, map[string]time.Duration, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, nil, err
	}
	paths := []string{path}
	if info.IsDir() {
		paths, err = filepath.Glob(filepath.Join(path, "*.json"))
		if err != nil {
			return nil, nil, err
		}
	}
	classes := make(map[string]classConfig)
	timeouts := make(map[string]time.Duration)
	for _, configPath := range paths {
		class, timeout, err := loadClassConfig(configPath)
		if err != nil {
			return nil, nil, fmt.Errorf("%s: %w", configPath, err)
		}
		if _, exists := classes[class.ID]; exists {
			return nil, nil, fmt.Errorf("duplicate class id %q", class.ID)
		}
		if err := resolveClassDrivers(&class, configPath); err != nil {
			return nil, nil, err
		}
		classes[class.ID], timeouts[class.ID] = class, timeout
	}
	return classes, timeouts, nil
}

func resolveClassDrivers(class *classConfig, configPath string) error {
	for _, driver := range []*string{&class.Server.Driver, &class.Session.Driver, &class.Session.ShutdownDriver, &class.Session.ViewerAttachDriver, &class.Session.ViewerDetachDriver} {
		if *driver == "" {
			continue
		}
		if !filepath.IsAbs(*driver) {
			*driver = filepath.Join(filepath.Dir(configPath), *driver)
		}
		absolute, err := filepath.Abs(*driver)
		if err != nil {
			return err
		}
		if _, err := os.Stat(absolute); err != nil {
			return fmt.Errorf("class %s driver %q: %w", class.ID, absolute, err)
		}
		if resolved, resolveErr := filepath.EvalSymlinks(absolute); resolveErr == nil {
			absolute = resolved
		}
		*driver = absolute
	}
	return nil
}
