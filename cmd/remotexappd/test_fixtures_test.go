package main

import "time"

// neutralAppTemplate keeps manager capability tests independent from the
// manifests and implementation details of any shipped App Package.
func neutralAppTemplate() (classConfig, time.Duration) {
	timeout := time.Minute
	return classConfig{
		APIVersion:    appPackageAPIVersion,
		ID:            "fixture-app",
		Name:          "Fixture App",
		DriverVersion: "1.0.0",
		RunMode:       "isolated",
		ProfileRef:    "fixture",
		Server: serverClassConfig{
			Activation: "on-demand", DisplayMode: "dynamic", Geometry: "800x600",
			Depth: 16, FrameRate: 5, AllowClientResize: true,
		},
		Session: sessionClassConfig{Services: "core-v1",
			Activation: "on-attach", ReadinessPID: "application.pid",
			VacantTimeout: timeout.String(), VacantAction: "stop-session",
		},
		Overrides: &overridePolicyConfig{Allowed: []string{"workspaceMode", "idleAction", "displayMode", "display"}},
		Parameters: map[string]parameterDefinition{
			"documentName": {Type: "string", MaxLength: 64},
		},
	}, timeout
}

func neutralUserHomeTemplate() (classConfig, time.Duration) {
	timeout := 48 * time.Hour
	return classConfig{
		APIVersion:    appPackageAPIVersion,
		ID:            "fixture-user-desktop",
		Name:          "Fixture User Desktop",
		DriverVersion: "1.0.0",
		RunMode:       "user-home",
		Singleton:     true,
		ProfileRef:    "user",
		Server: serverClassConfig{
			Activation: "on-demand", DisplayMode: "fixed", Display: 1,
			RFBPort: 5901, GatewayPort: 39001, Geometry: "1280x720",
			Depth: 16, FrameRate: 10, AllowClientResize: false,
		},
		Session: sessionClassConfig{Services: "core-v1",
			Activation: "on-attach", ReadinessPID: "desktop.pid",
			VacantTimeout: timeout.String(), VacantAction: "stop-session",
		},
		Overrides: &overridePolicyConfig{Allowed: []string{}},
	}, timeout
}
