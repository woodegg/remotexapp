package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSiteDisplayConfig(t *testing.T) {
	makeClasses := func() map[string]classConfig {
		return map[string]classConfig{
			"xfce-user-desktop": {APIVersion: appPackageAPIVersion, Server: serverClassConfig{DisplayMode: "fixed", Display: 1, RFBPort: 5901, GatewayPort: 39001}},
			"mousepad":          {APIVersion: appPackageAPIVersion, Server: serverClassConfig{DisplayMode: "dynamic"}},
		}
	}
	cases := []struct {
		name, payload string
		wantErr       bool
	}{
		{"alternate display", `{"schemaVersion":1,"fixedDisplays":{"xfce-user-desktop":{"display":4,"rfbPort":5904,"gatewayPort":39004}}}`, false},
		{"unknown app", `{"schemaVersion":1,"fixedDisplays":{"unknown":{"display":4,"rfbPort":5904,"gatewayPort":39004}}}`, true},
		{"dynamic app", `{"schemaVersion":1,"fixedDisplays":{"mousepad":{"display":4,"rfbPort":5904,"gatewayPort":39004}}}`, true},
		{"duplicate ports", `{"schemaVersion":1,"fixedDisplays":{"xfce-user-desktop":{"display":4,"rfbPort":5904,"gatewayPort":5904}}}`, true},
		{"privileged port", `{"schemaVersion":1,"fixedDisplays":{"xfce-user-desktop":{"display":4,"rfbPort":80,"gatewayPort":39004}}}`, true},
		{"unknown field", `{"schemaVersion":1,"fixedDisplays":{"xfce-user-desktop":{"display":4,"rfbPort":5904,"gatewayPort":39004,"extra":true}}}`, true},
		{"trailing data", `{"schemaVersion":1,"fixedDisplays":{"xfce-user-desktop":{"display":4,"rfbPort":5904,"gatewayPort":39004}}}{}`, true},
		{"missing port", `{"schemaVersion":1,"fixedDisplays":{"xfce-user-desktop":{"display":4,"rfbPort":5904}}}`, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "site.json")
			if err := os.WriteFile(path, []byte(tc.payload), 0o600); err != nil {
				t.Fatal(err)
			}
			classes := makeClasses()
			err := applySiteDisplayConfig(path, classes)
			if (err != nil) != tc.wantErr {
				t.Fatalf("applySiteDisplayConfig: %v, want error=%v", err, tc.wantErr)
			}
			if tc.wantErr && classes["xfce-user-desktop"].Server.Display != 1 {
				t.Fatal("invalid site config changed live catalog")
			}
			if !tc.wantErr && classes["xfce-user-desktop"].Server.Display != 4 {
				t.Fatal("valid site config did not select display")
			}
		})
	}
}

func TestSiteDisplayConfigRejectsCatalogCollision(t *testing.T) {
	path := filepath.Join(t.TempDir(), "site.json")
	content := `{"schemaVersion":1,"fixedDisplays":{"xfce-user-desktop":{"display":4,"rfbPort":5904,"gatewayPort":39004}}}`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	classes := map[string]classConfig{
		"xfce-user-desktop": {APIVersion: appPackageAPIVersion, Server: serverClassConfig{DisplayMode: "fixed", Display: 1, RFBPort: 5901, GatewayPort: 39001}},
		"other":             {APIVersion: appPackageAPIVersion, Server: serverClassConfig{DisplayMode: "fixed", Display: 4, RFBPort: 5910, GatewayPort: 39010}},
	}
	if err := applySiteDisplayConfig(path, classes); err == nil {
		t.Fatal("accepted conflicting fixed display")
	}
	if classes["xfce-user-desktop"].Server.Display != 1 {
		t.Fatal("catalog changed after rejecting collision")
	}
}
