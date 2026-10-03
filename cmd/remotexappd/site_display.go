package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
)

// siteDisplayConfig changes only administrator-selected fixed allocations. It
// never changes the sealed App Package or grants a client instance override.
type siteDisplayConfig struct {
	SchemaVersion int                              `json:"schemaVersion"`
	FixedDisplays map[string]siteDisplayAllocation `json:"fixedDisplays"`
}

type siteDisplayAllocation struct {
	Display     int `json:"display"`
	RFBPort     int `json:"rfbPort"`
	GatewayPort int `json:"gatewayPort"`
}

func applySiteDisplayConfig(path string, classes map[string]classConfig) error {
	if path == "" {
		return nil
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read site display config: %w", err)
	}
	if len(content) == 0 || len(content) > 64<<10 {
		return errors.New("site display config must be 1–65536 bytes")
	}
	decoder := json.NewDecoder(bytes.NewReader(content))
	decoder.DisallowUnknownFields()
	var site siteDisplayConfig
	if err := decoder.Decode(&site); err != nil {
		return fmt.Errorf("decode site display config: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return errors.New("site display config must contain exactly one JSON object")
	}
	if site.SchemaVersion != 1 || len(site.FixedDisplays) == 0 {
		return errors.New("site display config requires schemaVersion 1 and nonempty fixedDisplays")
	}
	// Apply only after every entry validates, so a bad site file cannot leave a
	// partially modified catalog if this helper is reused outside startup.
	updated := make(map[string]classConfig, len(classes))
	for id, class := range classes {
		updated[id] = class
	}
	for id, allocation := range site.FixedDisplays {
		class, exists := updated[id]
		if !exists || class.APIVersion == "" || class.Server.DisplayMode != "fixed" {
			return fmt.Errorf("site display target %q must be an enabled fixed-display App Package", id)
		}
		if allocation.Display < 1 || allocation.Display > 99 || allocation.RFBPort < 1024 || allocation.RFBPort > 65535 || allocation.GatewayPort < 1024 || allocation.GatewayPort > 65535 || allocation.RFBPort == allocation.GatewayPort {
			return fmt.Errorf("site display target %q has invalid display or ports", id)
		}
		class.Server.Display = allocation.Display
		class.Server.RFBPort = allocation.RFBPort
		class.Server.GatewayPort = allocation.GatewayPort
		updated[id] = class
	}
	for id, class := range updated {
		if class.Server.DisplayMode != "fixed" {
			continue
		}
		for otherID, other := range updated {
			if otherID >= id || other.Server.DisplayMode != "fixed" {
				continue
			}
			if class.Server.Display == other.Server.Display || class.Server.RFBPort == other.Server.RFBPort || class.Server.GatewayPort == other.Server.GatewayPort || class.Server.RFBPort == other.Server.GatewayPort || class.Server.GatewayPort == other.Server.RFBPort {
				return fmt.Errorf("site display allocation for %q conflicts with %q", id, otherID)
			}
		}
	}
	for id, class := range updated {
		classes[id] = class
	}
	return nil
}
