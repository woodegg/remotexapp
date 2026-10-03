package main

import (
	"sync"
	"time"
)

type instance struct {
	ID                  string                       `json:"id"`
	ClassID             string                       `json:"classId"`
	TemplateID          string                       `json:"templateId"`
	DriverVersion       string                       `json:"driverVersion"`
	ManagedID           string                       `json:"managedInstanceId,omitempty"`
	ProfileRef          string                       `json:"profileRef"`
	WorkspaceMode       string                       `json:"workspaceMode"`
	EffectivePolicy     effectivePolicy              `json:"effectivePolicy"`
	Parameters          map[string]any               `json:"parameters,omitempty"`
	ApplicationStatus   *applicationStatus           `json:"applicationStatus,omitempty"`
	SessionGeneration   int64                        `json:"sessionGeneration"`
	State               string                       `json:"state"`
	Display             string                       `json:"display"`
	ControlAddress      string                       `json:"controlAddress,omitempty"`
	ControlPort         int                          `json:"controlPort,omitempty"`
	ControlWebSocketURL string                       `json:"controlWebSocketUrl,omitempty"`
	Resources           map[string]allocatedResource `json:"resources"`
	ViewerURL           string                       `json:"viewerUrl,omitempty"`
	CreatedAt           time.Time                    `json:"createdAt"`
	Error               string                       `json:"error,omitempty"`
	SessionState        string                       `json:"sessionState"`
	StartupFailure      *startupFailure              `json:"startupFailure,omitempty"`
	SessionRecovery     *sessionRecovery             `json:"sessionRecovery,omitempty"`
	AttachedClients     int                          `json:"attachedClients"`
	Shutdown            *shutdownStatus              `json:"shutdown,omitempty"`
	Home                string                       `json:"homePath,omitempty"`
	XAuthority          string                       `json:"xauthorityPath,omitempty"`
	Runtime             string                       `json:"runtimePath,omitempty"`
	SocketRuntime       string                       `json:"socketRuntimePath,omitempty"`
	RFBAddr             string                       `json:"internalRfbAddress,omitempty"`
	GatewayAddr         string                       `json:"internalGatewayAddress,omitempty"`
	VNCUnit             string                       `json:"vncUnit,omitempty"`
	ServerUnit          string                       `json:"serverUnit,omitempty"`
	GatewayUnit         string                       `json:"gatewayUnit,omitempty"`
	SessionUnit         string                       `json:"sessionUnit,omitempty"`
	Spec                classConfig                  `json:"-"`
	Components          runtimeComponents            `json:"-"`
	VacantTimeout       time.Duration                `json:"-"`
	EphemeralHome       bool                         `json:"-"`
	Overrides           instanceOverrides            `json:"-"`
	RuntimeDesired      string                       `json:"-"`
	Upgrade             *runtimeUpgrade              `json:"upgrade,omitempty"`
}

type allocatedResource struct {
	Kind    string `json:"kind"`
	Address string `json:"address"`
	Port    int    `json:"port"`
}

// startupFailure is the bounded, generation-scoped record of an application
// that never reached session readiness. It is not set for a later App exit.
type startupFailure struct {
	Generation int64     `json:"generation"`
	FailedAt   time.Time `json:"failedAt"`
	ExpiresAt  time.Time `json:"expiresAt"`
	Summary    string    `json:"summary"`
}

// sessionRecovery bounds on-attach recovery of a failed managed user-home
// session across Manager restarts and repeated browser reconnects.
type sessionRecovery struct {
	WindowStart time.Time `json:"windowStart"`
	Attempts    int       `json:"attempts"`
}

// publicInstanceView is the major API projection. Legacy protocol-specific
// control fields remain on instance only so pre-App-Package runtime manifests
// can be adopted; they must never leak into the V1 public API.
type publicInstanceView struct {
	Versions          *runtimeVersions             `json:"versions,omitempty"`
	Upgrade           *upgradeStatus               `json:"upgrade,omitempty"`
	ID                string                       `json:"id"`
	ClassID           string                       `json:"classId"`
	TemplateID        string                       `json:"templateId"`
	DriverVersion     string                       `json:"driverVersion"`
	ManagedID         string                       `json:"managedInstanceId,omitempty"`
	ProfileRef        string                       `json:"profileRef"`
	WorkspaceMode     string                       `json:"workspaceMode"`
	EffectivePolicy   effectivePolicy              `json:"effectivePolicy"`
	Parameters        map[string]any               `json:"parameters,omitempty"`
	ApplicationStatus *applicationStatus           `json:"applicationStatus,omitempty"`
	SessionGeneration int64                        `json:"sessionGeneration"`
	State             string                       `json:"state"`
	Display           string                       `json:"display"`
	Resources         map[string]allocatedResource `json:"resources"`
	ViewerURL         string                       `json:"viewerUrl,omitempty"`
	CreatedAt         time.Time                    `json:"createdAt"`
	Error             string                       `json:"error,omitempty"`
	SessionState      string                       `json:"sessionState"`
	StartupFailure    *startupFailure              `json:"startupFailure,omitempty"`
	SessionRecovery   *sessionRecovery             `json:"sessionRecovery,omitempty"`
	AttachedClients   int                          `json:"attachedClients"`
	Shutdown          *shutdownStatus              `json:"shutdown,omitempty"`
	Home              string                       `json:"homePath,omitempty"`
	XAuthority        string                       `json:"xauthorityPath,omitempty"`
	Runtime           string                       `json:"runtimePath,omitempty"`
	SocketRuntime     string                       `json:"socketRuntimePath,omitempty"`
	RFBAddr           string                       `json:"internalRfbAddress,omitempty"`
	GatewayAddr       string                       `json:"internalGatewayAddress,omitempty"`
	VNCUnit           string                       `json:"vncUnit,omitempty"`
	ServerUnit        string                       `json:"serverUnit,omitempty"`
	GatewayUnit       string                       `json:"gatewayUnit,omitempty"`
	SessionUnit       string                       `json:"sessionUnit,omitempty"`
}

type effectivePolicy struct {
	Display           effectiveDisplayPolicy `json:"display"`
	RunMode           string                 `json:"runMode"`
	WorkspaceMode     string                 `json:"workspaceMode"`
	SessionActivation string                 `json:"sessionActivation"`
	IdleTimeout       string                 `json:"idleTimeout"`
	IdleAction        string                 `json:"idleAction"`
	Singleton         bool                   `json:"singleton"`
}

type effectiveDisplayPolicy struct {
	Mode              string `json:"mode"`
	Number            int    `json:"number"`
	Size              string `json:"size"`
	Depth             int    `json:"depth"`
	FrameRate         int    `json:"frameRate"`
	AllowClientResize bool   `json:"allowClientResize"`
}

type createRequest struct {
	Upgrade           *runtimeUpgrade   `json:"-"`
	ClassID           string            `json:"classId,omitempty"`
	TemplateID        string            `json:"templateId,omitempty"`
	ProfileRef        string            `json:"profileRef,omitempty"`
	Overrides         instanceOverrides `json:"overrides,omitempty"`
	Parameters        map[string]any    `json:"parameters,omitempty"`
	ManagedID         string            `json:"-"`
	PinnedSpec        classConfig       `json:"-"`
	PinnedComponents  runtimeComponents `json:"-"`
	RuntimeID         string            `json:"-"`
	CreatedAt         time.Time         `json:"-"`
	SessionGeneration int64             `json:"-"`
	PinnedAllocation  *instance         `json:"-"`
}

type runtimeComponents struct {
	Identity      *coreIdentity `json:"identity,omitempty"`
	GatewayBinary string        `json:"gatewayBinary"`
	StatusBinary  string        `json:"statusBinary"`
	UnicodeEngine string        `json:"unicodeEngine"`
	CoreDriverDir string        `json:"coreDriverDir,omitempty"`
}

type shutdownStatus struct {
	RequestID   string     `json:"requestId"`
	Generation  int64      `json:"generation"`
	Reason      string     `json:"reason"`
	Scope       string     `json:"scope"`
	State       string     `json:"state"`
	RequestedAt time.Time  `json:"requestedAt"`
	BlockedAt   *time.Time `json:"blockedAt,omitempty"`
	WarningAt   *time.Time `json:"warningAt,omitempty"`
	ForceAt     *time.Time `json:"forceAt,omitempty"`
	Message     string     `json:"message,omitempty"`
	Forced      bool       `json:"forced"`
}

type stopRequest struct {
	Force bool `json:"force,omitempty"`
}

type restartRequest struct {
	SessionGeneration *int64 `json:"sessionGeneration"`
	Force             bool   `json:"force,omitempty"`
}

type instanceOverrides struct {
	DisplayMode       string `json:"displayMode,omitempty"`
	Display           int    `json:"display,omitempty"`
	Geometry          string `json:"geometry,omitempty"`
	FrameRate         int    `json:"frameRate,omitempty"`
	AllowClientResize *bool  `json:"allowClientResize,omitempty"`
	WorkspaceMode     string `json:"workspaceMode,omitempty"`
	SessionActivation string `json:"sessionActivation,omitempty"`
	IdleTimeout       string `json:"idleTimeout,omitempty"`
	IdleAction        string `json:"idleAction,omitempty"`
	Singleton         *bool  `json:"singleton,omitempty"`
}

type managedInstance struct {
	ID                     string            `json:"id"`
	TemplateID             string            `json:"templateId"`
	AppliedDriverVersion   string            `json:"appliedDriverVersion,omitempty"`
	AvailableDriverVersion string            `json:"availableDriverVersion,omitempty"`
	UpdateStatus           string            `json:"updateStatus"`
	AppliedSpec            classConfig       `json:"-"`
	AppliedComponents      runtimeComponents `json:"-"`
	DesiredState           string            `json:"desiredState"`
	ObservedState          string            `json:"observedState"`
	ProfileRef             string            `json:"profileRef"`
	Overrides              instanceOverrides `json:"overrides,omitempty"`
	Parameters             map[string]any    `json:"parameters,omitempty"`
	RuntimeInstanceID      string            `json:"runtimeInstanceId,omitempty"`
	Runtime                *instance         `json:"runtime,omitempty"`
	CreatedAt              time.Time         `json:"createdAt"`
	UpdatedAt              time.Time         `json:"updatedAt"`
	Error                  string            `json:"error,omitempty"`
}

type publicManagedInstanceView struct {
	AvailableVersion       *runtimeVersion     `json:"availableVersion,omitempty"`
	ID                     string              `json:"id"`
	TemplateID             string              `json:"templateId"`
	AppliedDriverVersion   string              `json:"appliedDriverVersion,omitempty"`
	AvailableDriverVersion string              `json:"availableDriverVersion,omitempty"`
	UpdateStatus           string              `json:"updateStatus"`
	DesiredState           string              `json:"desiredState"`
	ObservedState          string              `json:"observedState"`
	ProfileRef             string              `json:"profileRef"`
	Overrides              instanceOverrides   `json:"overrides,omitempty"`
	Parameters             map[string]any      `json:"parameters,omitempty"`
	RuntimeInstanceID      string              `json:"runtimeInstanceId,omitempty"`
	Runtime                *publicInstanceView `json:"runtime,omitempty"`
	CreatedAt              time.Time           `json:"createdAt"`
	UpdatedAt              time.Time           `json:"updatedAt"`
	Error                  string              `json:"error,omitempty"`
}

type managedCreateRequest struct {
	ID           string            `json:"id"`
	TemplateID   string            `json:"templateId"`
	DesiredState string            `json:"desiredState,omitempty"`
	ProfileRef   string            `json:"profileRef,omitempty"`
	Overrides    instanceOverrides `json:"overrides,omitempty"`
	Parameters   map[string]any    `json:"parameters,omitempty"`
}

type managedPatchRequest struct {
	DesiredState string `json:"desiredState"`
	Force        bool   `json:"force,omitempty"`
}

type manager struct {
	cfg             config
	bootID          string
	mu              sync.RWMutex
	lifecycleMu     sync.Mutex
	actions         map[string]*activeAction
	managedMu       sync.RWMutex
	instances       map[string]*instance
	idleTimers      map[string]*time.Timer
	managed         map[string]*managedInstance
	managedObserver managedRuntimeObserver
	standalone      *standaloneCgroupRoot
	sessionObserver sessionRuntimeObserver
	managedEvents   chan managedRuntimeEvent
	sessionEvents   chan sessionRuntimeEvent
	// runtimeAdoptionCheck is overridden only by focused tests. Production
	// startup uses the full unit/display/gateway/readiness validation.
	runtimeAdoptionCheck func(*instance) error
	// runtimeSessionAliveCheck is overridden only by focused tests. Production
	// uses the exact session unit and readiness PID before preserving a live
	// application that cannot be fully adopted.
	runtimeSessionAliveCheck func(*instance) bool
	// runtimeRecoveryCreate is overridden only by focused tests. Production
	// recovery always uses createLocked with the durable identity and snapshot.
	runtimeRecoveryCreate func(createRequest) (*instance, error)
	// runtimeRestartStop is overridden only by focused restart transaction tests.
	// Production always applies the complete graceful/forced instance stop.
	runtimeRestartStop func(*instance, stopOptions) error
	// operatorCall is overridden only by focused HTTP authorization tests.
	// Production always calls the owner-only Unix helper socket.
	operatorCall func(operatorHelperRequest) (*operatorHelperResponse, error)
	// environmentProcRoot is overridden only by focused tests. Production
	// environment lookup always reads the kernel-owned /proc hierarchy.
	environmentProcRoot string
}
