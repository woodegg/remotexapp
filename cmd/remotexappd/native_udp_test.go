package main

import (
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/woodegg/remotexapp/internal/kasmbundle"
	"github.com/woodegg/remotexapp/internal/testfixture"
)

func freeUDP(t *testing.T) int {
	t.Helper()
	c, e := net.ListenPacket("udp4", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	defer c.Close()
	return c.LocalAddr().(*net.UDPAddr).Port
}
func TestUDPCatalogStrictAndOptIn(t *testing.T) {
	p := filepath.Join(t.TempDir(), "endpoints.json")
	cfg := config{udpEndpointsFile: p, nativeUDPCapable: true}
	valid := `{"schemaVersion":1,"endpoints":[{"slot":"one","advertisedAddress":"192.0.2.1","port":42001}]}`
	for _, raw := range []string{`{}`, strings.ReplaceAll(valid, "192.0.2.1", "127.0.0.1"), strings.ReplaceAll(valid, "192.0.2.1", net.IPv4(10, 0, 0, 1).String()), strings.ReplaceAll(valid, "42001", "80"), strings.ReplaceAll(valid, "\"slot\"", "\"unknown\""), valid + "{}"} {
		os.WriteFile(p, []byte(raw), 0600)
		if cfg.loadUDPEndpoints() == nil {
			t.Fatal("invalid catalog accepted")
		}
	}
	os.WriteFile(p, []byte(valid), 0600)
	if err := cfg.loadUDPEndpoints(); err != nil {
		t.Fatal(err)
	}
	cfg.nativeUDPCapable = false
	if cfg.loadUDPEndpoints() == nil {
		t.Fatal("legacy component accepted UDP")
	}
}
func TestUDPOwnershipPoolAndRecovery(t *testing.T) {
	e := udpEndpoint{"one", "192.0.2.1", freeUDP(t)}
	m := &manager{cfg: config{udpEndpoints: []udpEndpoint{e}}, instances: map[string]*instance{}}
	a := runtimeComponents{NativeUDP: true}
	if err := m.assignUDPEndpoint("a", &a, false); err != nil || a.UDPEndpoint == nil || !validUDPLease(a.UDPEndpoint) {
		t.Fatal("lease not allocated", err)
	}
	m.instances["a"] = &instance{ID: "a", State: "failed", Components: a}
	b := runtimeComponents{NativeUDP: true}
	if err := m.assignUDPEndpoint("b", &b, false); err != nil || b.UDPEndpoint != nil || b.UDPUnavailableReason != "endpoint-pool-full" {
		t.Fatal("failed owner lost reservation", err)
	}
	copy := a
	if err := m.assignUDPEndpoint("a", &copy, true); err != nil || *copy.UDPEndpoint != *a.UDPEndpoint {
		t.Fatal("recovery changed locked endpoint")
	}
	if err := m.assignUDPEndpoint("b", &copy, true); err == nil {
		t.Fatal("stolen locked endpoint")
	}
	m.instances["a"].State = "stopped"
	if err := m.assignUDPEndpoint("b", &b, false); err != nil || b.UDPEndpoint == nil || b.UDPEndpoint.Epoch == a.UDPEndpoint.Epoch {
		t.Fatal("verified removal did not allocate a new epoch")
	}
	m.cfg.udpEndpoints = nil
	if m.validateUDPCatalogLease(a.UDPEndpoint) == nil {
		t.Fatal("changed deployment catalog accepted")
	}
}
func TestUDPManifestPinsSchemaAndDurableFailedOwner(t *testing.T) {
	pin := testfixture.KasmProtocol(t, kasmbundle.UDPProtocol)
	e := udpEndpoint{"one", "192.0.2.1", freeUDP(t)}
	m := &manager{cfg: config{stateDir: t.TempDir(), udpEndpoints: []udpEndpoint{e}}, instances: map[string]*instance{}}
	i := testRuntimeManifest(t, m.cfg.stateDir, "mousepad-0123456789ab", "")
	i.Components.DisplayProvider = "kasm"
	i.Components.Kasm = &pin
	i.Components.UnicodeEngine = ""
	i.Components.NativeUDP = true
	i.Components.UDPEndpoint = &udpLease{e, strings.Repeat("a", 32)}
	if err := m.persistRuntime(i); err != nil {
		t.Fatal(err)
	}
	records, err := m.loadRuntimeManifests()
	if err != nil || len(records) != 1 || records[0].SchemaVersion != 5 {
		t.Fatal("UDP manifest not restored", err)
	}
	c := runtimeComponents{NativeUDP: true}
	if err := m.assignUDPEndpoint("other", &c, false); err != nil || c.UDPEndpoint != nil {
		t.Fatal("durable owner ignored", err)
	}
	records[0].SchemaVersion = 4
	data, _ := json.Marshal(records[0])
	os.WriteFile(filepath.Join(m.runtimeManifestDir(), i.ID+".json"), data, 0600)
	if _, err := m.loadRuntimeManifests(); err == nil {
		t.Fatal("UDP accepted as schema4")
	}
	args := strings.Join(kasmLaunchArgs(i, classConfig{}, 5901, "/tmp/auth"), " ")
	if !strings.Contains(args, "-udpPort ") || !strings.Contains(args, "-publicIP 192.0.2.1") {
		t.Fatal("endpoint not passed to native server")
	}
}
