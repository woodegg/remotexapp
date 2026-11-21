package main

import (
	"fmt"
	"net"
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
func TestRoutedUDPConfigAndAutomaticLease(t *testing.T) {
	privateIP := net.IPv4(10, 0, 0, 1).String()
	port := freeUDP(t)
	spec := fmt.Sprintf("%d-%d", port, port)
	for _, c := range []webRTCConfig{
		{mode: "off", ports: spec},
		{mode: "manual"},
		{mode: "direct", address: privateIP, ports: spec},
		{mode: "turn", bind: "127.0.0.1", ports: spec},
		{mode: "turn", bind: privateIP, address: "192.0.2.4", ports: spec},
		{mode: "direct", address: "192.0.2.4", ports: "1000-66000"},
	} {
		if err := c.validate(kasmbundle.RoutedUDPProtocol); err == nil {
			t.Fatalf("invalid configuration accepted: %v", c)
		}
	}
	turn := webRTCConfig{mode: "turn", ports: spec, bind: privateIP}
	if err := turn.validate(kasmbundle.RichUDPProtocol); err == nil {
		t.Fatal("old component accepted routed UDP")
	}
	if err := turn.validate(kasmbundle.RoutedUDPProtocol); err != nil || turn.address != turn.bind {
		t.Fatalf("TURN private endpoint rejected: %v", err)
	}
	direct := webRTCConfig{mode: "direct", address: "192.0.2.4", ports: spec}
	if err := direct.validate(kasmbundle.RoutedUDPProtocol); err != nil {
		t.Fatal(err)
	}
	m := &manager{cfg: config{webRTC: direct}, instances: map[string]*instance{}}
	c := runtimeComponents{NativeUDP: true}
	if err := m.assignUDPEndpoint("one", &c, false); err != nil || c.UDPEndpoint == nil || c.UDPEndpoint.Port != port ||
		c.UDPEndpoint.Mode != "direct" || c.UDPEndpoint.Bind != "127.0.0.1" || !validUDPLease(c.UDPEndpoint) {
		t.Fatalf("automatic direct endpoint unavailable: %v", err)
	}
	m.instances["one"] = &instance{ID: "one", State: "server-ready", Components: c}
	next := runtimeComponents{NativeUDP: true}
	if err := m.assignUDPEndpoint("two", &next, false); err != nil || next.UDPEndpoint != nil || next.UDPUnavailableReason != "endpoint-pool-full" {
		t.Fatalf("port reservation not honored: %v", err)
	}
	m.instances["one"].State = "stopped"
	if err := m.assignUDPEndpoint("two", &next, false); err != nil || next.UDPEndpoint == nil || next.UDPEndpoint.Epoch == c.UDPEndpoint.Epoch {
		t.Fatalf("cleaned port not reassigned with fresh epoch: %v", err)
	}
	m.cfg.webRTC = webRTCConfig{mode: "off"}
	off := runtimeComponents{NativeUDP: true}
	if err := m.assignUDPEndpoint("three", &off, false); err != nil || off.UDPEndpoint != nil || off.UDPUnavailableReason != "" {
		t.Fatalf("off mode used a UDP endpoint: %v", err)
	}
}

func TestRoutedUDPManifestPinsPrivateBind(t *testing.T) {
	privateIP := net.IPv4(10, 0, 0, 1).String()
	pin := testfixture.KasmProtocol(t, kasmbundle.RoutedUDPProtocol)
	m := &manager{cfg: config{stateDir: t.TempDir()}}
	i := testRuntimeManifest(t, m.cfg.stateDir, "mousepad-0123456789ab", "")
	i.Components.DisplayProvider = "kasm"
	i.Components.Kasm = &pin
	i.Components.UnicodeEngine = ""
	i.Components.NativeUDP = true
	i.Components.UDPEndpoint = &udpLease{Address: privateIP, Port: 43001,
		Epoch: strings.Repeat("a", 32), Mode: "turn", Bind: privateIP}
	if err := m.persistRuntime(i); err != nil {
		t.Fatal(err)
	}
	records, err := m.loadRuntimeManifests()
	if err != nil || len(records) != 1 || records[0].SchemaVersion != routedUDPManifestSchema ||
		*records[0].Components.UDPEndpoint != *i.Components.UDPEndpoint {
		t.Fatalf("routed runtime not restored: %v", err)
	}
	m.cfg.webRTC = webRTCConfig{mode: "direct", bind: "127.0.0.1", address: "192.0.2.4", firstPort: 43001, lastPort: 43001}
	next := runtimeComponents{NativeUDP: true}
	if err := m.assignUDPEndpoint("another", &next, false); err != nil || next.UDPEndpoint != nil ||
		next.UDPUnavailableReason != "endpoint-pool-full" {
		t.Fatalf("durable owner did not fence port reuse: %v", err)
	}
	args := strings.Join(kasmLaunchArgs(i, classConfig{}, 5901, "/tmp/auth"), " ")
	if !strings.Contains(args, "-udpPort 43001") || !strings.Contains(args, "-udpBindAddress "+privateIP) {
		t.Fatal("endpoint not passed to native server")
	}
	records[0].SchemaVersion = nativeUDPManifestSchema
	if err := m.validateRuntimeManifest("test", &records[0]); err == nil {
		t.Fatal("routed endpoint accepted in legacy schema")
	}
}
