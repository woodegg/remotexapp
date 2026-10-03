package main

import (
	"errors"
	"fmt"
	"time"
)

func resolveTemplateID(request createRequest) (string, error) {
	if request.TemplateID != "" && request.ClassID != "" && request.TemplateID != request.ClassID {
		return "", errors.New("templateId and classId must match when both are provided")
	}
	if request.TemplateID != "" {
		return request.TemplateID, nil
	}
	if request.ClassID != "" {
		return request.ClassID, nil
	}
	return "", errors.New("templateId is required")
}

func applyOverrides(template classConfig, overrides instanceOverrides) (classConfig, time.Duration, string, error) {
	effective := template
	if err := normalizeControlConfig(&effective.Control); err != nil {
		return effective, 0, "", err
	}
	if err := validateAllowedOverrides(template, overrides); err != nil {
		return effective, 0, "", err
	}
	if overrides.DisplayMode != "" {
		effective.Server.DisplayMode = overrides.DisplayMode
	}
	if effective.Server.DisplayMode != "fixed" && effective.Server.DisplayMode != "dynamic" {
		return effective, 0, "", fmt.Errorf("unsupported displayMode %q", effective.Server.DisplayMode)
	}
	if effective.Server.DisplayMode == "dynamic" {
		if overrides.Display != 0 {
			return effective, 0, "", errors.New("display requires displayMode fixed")
		}
		effective.Server.Display, effective.Server.RFBPort, effective.Server.GatewayPort = 0, 0, 0
	} else if overrides.Display != 0 {
		effective.Server.Display = overrides.Display
		effective.Server.RFBPort = 5900 + overrides.Display
		effective.Server.GatewayPort = 39000 + overrides.Display
	}
	if effective.Server.DisplayMode == "fixed" && (effective.Server.Display < 1 || effective.Server.Display > 99) {
		return effective, 0, "", errors.New("fixed display must be between 1 and 99")
	}
	if overrides.Geometry != "" {
		if !safeGeometry.MatchString(overrides.Geometry) {
			return effective, 0, "", errors.New("invalid geometry")
		}
		effective.Server.Geometry = overrides.Geometry
	}
	if overrides.FrameRate != 0 {
		if overrides.FrameRate < 1 || overrides.FrameRate > 60 {
			return effective, 0, "", errors.New("frameRate must be between 1 and 60")
		}
		effective.Server.FrameRate = overrides.FrameRate
	}
	if overrides.AllowClientResize != nil {
		effective.Server.AllowClientResize = *overrides.AllowClientResize
	}
	workspaceMode := overrides.WorkspaceMode
	if workspaceMode == "" {
		if template.RunMode == "isolated" {
			workspaceMode = "ephemeral"
		} else {
			workspaceMode = "persistent"
		}
	}
	switch workspaceMode {
	case "ephemeral":
		if template.RunMode == "user-home" {
			return effective, 0, "", errors.New("runMode user-home cannot use an ephemeral workspace")
		}
		effective.RunMode = "isolated"
	case "persistent":
		if template.RunMode == "user-home" {
			effective.RunMode = "user-home"
		} else {
			effective.RunMode = "shared"
		}
	default:
		return effective, 0, "", fmt.Errorf("unsupported workspaceMode %q", workspaceMode)
	}
	if overrides.SessionActivation != "" {
		effective.Session.Activation = overrides.SessionActivation
	}
	if effective.Session.Activation != "on-attach" && effective.Session.Activation != "immediate" {
		return effective, 0, "", fmt.Errorf("unsupported sessionActivation %q", effective.Session.Activation)
	}
	if overrides.IdleAction != "" {
		effective.Session.VacantAction = overrides.IdleAction
	}
	if effective.Session.VacantAction != "keep" && effective.Session.VacantAction != "stop-session" && effective.Session.VacantAction != "stop-instance" {
		return effective, 0, "", fmt.Errorf("unsupported idleAction %q", effective.Session.VacantAction)
	}
	if overrides.IdleTimeout != "" {
		effective.Session.VacantTimeout = overrides.IdleTimeout
	}
	timeout, err := time.ParseDuration(effective.Session.VacantTimeout)
	if err != nil || timeout < time.Second {
		return effective, 0, "", errors.New("idleTimeout must be a duration of at least 1s")
	}
	if overrides.Singleton != nil {
		effective.Singleton = *overrides.Singleton
	}
	if effective.RunMode == "user-home" && !effective.Singleton {
		return effective, 0, "", errors.New("runMode user-home requires a singleton instance")
	}
	return effective, timeout, workspaceMode, nil
}

func validateAllowedOverrides(template classConfig, overrides instanceOverrides) error {
	if template.APIVersion == "" {
		return nil
	}
	allowed := make(map[string]bool)
	if template.Overrides != nil {
		for _, name := range template.Overrides.Allowed {
			allowed[name] = true
		}
	}
	supplied := map[string]bool{
		"displayMode": overrides.DisplayMode != "", "display": overrides.Display != 0,
		"geometry": overrides.Geometry != "", "frameRate": overrides.FrameRate != 0,
		"allowClientResize": overrides.AllowClientResize != nil, "workspaceMode": overrides.WorkspaceMode != "",
		"sessionActivation": overrides.SessionActivation != "", "idleTimeout": overrides.IdleTimeout != "",
		"idleAction": overrides.IdleAction != "", "singleton": overrides.Singleton != nil,
	}
	for name, present := range supplied {
		if present && !allowed[name] {
			return fmt.Errorf("template %s does not allow the %s override", template.ID, name)
		}
	}
	return nil
}

func (m *manager) specFor(item *instance) classConfig {
	var class classConfig
	if item.Spec.ID != "" {
		class = item.Spec
	} else {
		class = m.cfg.classes[item.ClassID]
	}
	if class.RunMode == "" {
		_ = normalizeRunMode(&class)
	}
	_ = normalizeControlConfig(&class.Control)
	return class
}

func (m *manager) timeoutFor(item *instance) time.Duration {
	if item.VacantTimeout > 0 {
		return item.VacantTimeout
	}
	return m.cfg.vacantTimeouts[item.ClassID]
}

func resolvedPolicy(class classConfig, timeout time.Duration, workspaceMode string) effectivePolicy {
	return effectivePolicy{
		Display: effectiveDisplayPolicy{
			Mode: class.Server.DisplayMode, Number: class.Server.Display, Size: class.Server.Geometry,
			Depth: class.Server.Depth, FrameRate: class.Server.FrameRate, AllowClientResize: class.Server.AllowClientResize,
		},
		RunMode:       class.RunMode,
		WorkspaceMode: workspaceMode, SessionActivation: class.Session.Activation,
		IdleTimeout: timeout.String(), IdleAction: class.Session.VacantAction, Singleton: class.Singleton,
	}
}
