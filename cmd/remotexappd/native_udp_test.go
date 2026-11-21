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
		{mode: "off", interfaceName: "eth0"},
		{mode: "turn", bind: privateIP, interfaceName: "eth0", ports: spec},
		{mode: "turn", interfaceName: "not an interface", ports: spec},
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
	if err := turn.validate(kasmbundle.RoutedUDPProtocol); err != nil {
		t.Fatalf("TURN private endpoint rejected: %v", err)
	}
	if bind, advertised := turn.endpointAddresses(); bind != privateIP || advertised != privateIP {
		t.Fatal("explicit TURN address differs from the advertised address")
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

func TestRoutedUDPSelectInterfaceBind(t *testing.T) {
	private := net.IPv4(10, 0, 0, 1).To4()
	otherPrivate := net.IPv4(10, 0, 0, 2).To4()
	local := func(ip net.IP) net.Addr {
		return &net.IPNet{IP: ip, Mask: net.CIDRMask(len(ip)*8, len(ip)*8)}
	}
	public := net.ParseIP("192.0.2.4").To4()
	ignored := []net.Addr{local(net.IPv4(127, 0, 0, 1).To4()), local(net.ParseIP("2001:db8::1")), local(public)}
	if got := selectWebRTCBind(append(ignored, local(private)), true); got != private.String() {
		t.Fatalf("unique TURN IPv4 = %q", got)
	}
	if got := selectWebRTCBind(ignored, true); got != "" {
		t.Fatalf("TURN selected an ineligible IPv4: %q", got)
	}
	if got := selectWebRTCBind([]net.Addr{local(private), local(otherPrivate)}, true); got != "" {
		t.Fatalf("TURN selected an ambiguous IPv4: %q", got)
	}
	if got := selectWebRTCBind([]net.Addr{local(public)}, false); got != public.String() {
		t.Fatalf("direct interface IPv4 = %q", got)
	}
}

func TestRoutedUDPAutomaticTURNUnavailableFallsBack(t *testing.T) {
	policy := webRTCConfig{mode: "turn", ports: "43001-43002"}
	if err := policy.validate(kasmbundle.RoutedUDPProtocol); err != nil {
		t.Fatalf("TURN without a hard-coded address must be valid: %v", err)
	}
	policy.interfaceName = "rx-no-such-if"
	m := &manager{cfg: config{webRTC: policy}}
	c := runtimeComponents{DisplayProvider: "kasm", NativeUDP: true}
	if err := m.assignUDPEndpoint("instance", &c, false); err != nil || c.UDPEndpoint != nil ||
		c.UDPUnavailableReason != udpInterfaceUnavailable {
		t.Fatalf("unavailable interface should use WSS: %v", err)
	}
	if view := nativeTransport(&instance{Components: c}); view.Available || view.Policy != "wss-only" {
		t.Fatalf("unexpected transport descriptor: %+v", view)
	}
}
