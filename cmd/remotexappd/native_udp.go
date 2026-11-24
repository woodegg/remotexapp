package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net"
	"net/netip"
	"strconv"
	"strings"

	"github.com/woodegg/remotexapp/internal/kasmbundle"
)

const nativeUDPManifestSchema = 5
const routedUDPManifestSchema = 7
const udpInterfaceUnavailable = "interface-ipv4-unavailable"

type udpLease struct {
	Address string `json:"advertisedAddress"`
	Port    int    `json:"port"`
	Epoch   string `json:"epoch"`
	Mode    string `json:"mode"`
	Bind    string `json:"bind"`
}

type nativeTransportView struct {
	Policy        string `json:"policy"`
	Available     bool   `json:"available"`
	Reason        string `json:"reason,omitempty"`
	GrantRequired bool   `json:"grantRequired"`
	Mode          string `json:"mode,omitempty"`
	ReadOnly      bool   `json:"readOnly"`
}

type webRTCConfig struct {
	mode, bind, interfaceName, address, ports string
	firstPort, lastPort                       int
}

func specificIPv4(address string) bool {
	ip, err := netip.ParseAddr(address)
	return err == nil && ip.Is4() && (ip.IsGlobalUnicast() || ip.IsLoopback())
}

func (c *webRTCConfig) validate(protocol string) error {
	if c.mode == "" || c.mode == "off" {
		if c.bind != "" || c.interfaceName != "" || c.address != "" || c.ports != "" {
			return errors.New("WebRTC listener settings require direct or turn mode")
		}
		return nil
	}
	if c.mode != "direct" && c.mode != "turn" {
		return errors.New("webrtc-mode must be off, direct or turn")
	}
	if !kasmbundle.SupportsRoutedUDP(protocol) {
		return errors.New("WebRTC modes require a routed-UDP Kasm component")
	}
	low, high, ok := strings.Cut(c.ports, "-")
	first, firstErr := strconv.Atoi(low)
	last, lastErr := strconv.Atoi(high)
	if !ok || firstErr != nil || lastErr != nil || first < 1024 || last > 65535 || last < first || last-first >= 1024 {
		return errors.New("webrtc-ports must specify 1–1024 UDP ports between 1024 and 65535")
	}
	if c.interfaceName != "" && (c.bind != "" || len(c.interfaceName) > 15 ||
		strings.ContainsAny(c.interfaceName, " /:\t\r\n\x00")) {
		return errors.New("webrtc-interface requires a Linux interface name and cannot be combined with webrtc-bind")
	}
	if c.mode == "turn" {
		if c.address != "" {
			return errors.New("turn mode advertises its private bind address")
		}
		if c.bind != "" && !validRoutedEndpoint(c.mode, c.bind, c.bind, first) {
			return errors.New("turn mode requires a private IPv4 listener")
		}
	} else {
		if c.bind == "" && c.interfaceName == "" {
			c.bind = "127.0.0.1"
		}
		if !publicWebRTCIPv4(c.address) || (c.bind != "" && !specificIPv4(c.bind)) {
			return errors.New("invalid WebRTC bind or advertised address")
		}
	}
	c.firstPort, c.lastPort = first, last
	return nil
}

func publicWebRTCIPv4(address string) bool {
	ip, err := netip.ParseAddr(address)
	return err == nil && ip.Is4() && ip.IsGlobalUnicast() && !ip.IsPrivate()
}

// Select only an unambiguous interface address. The order returned by the
// kernel does not establish which address belongs to the relay network.
func selectWebRTCBind(addresses []net.Addr, private bool) string {
	var chosen netip.Addr
	for _, address := range addresses {
		prefix, err := netip.ParsePrefix(address.String())
		if err != nil {
			continue
		}
		ip := prefix.Addr()
		if !ip.Is4() || !ip.IsGlobalUnicast() || private && !ip.IsPrivate() {
			continue
		}
		if chosen.IsValid() && chosen != ip {
			return ""
		}
		chosen = ip
	}
	if !chosen.IsValid() {
		return ""
	}
	return chosen.String()
}

func (c webRTCConfig) endpointAddresses() (bind, advertised string) {
	bind = c.bind
	if bind == "" {
		interfaces, err := net.Interfaces()
		if err != nil {
			return "", ""
		}
		var addresses []net.Addr
		for _, iface := range interfaces {
			if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 ||
				(c.interfaceName != "" && iface.Name != c.interfaceName) {
				continue
			}
			local, err := iface.Addrs()
			if err != nil {
				return "", ""
			}
			addresses = append(addresses, local...)
		}
		bind = selectWebRTCBind(addresses, c.mode == "turn")
	}
	if c.mode == "turn" {
		return bind, bind
	}
	return bind, c.address
}

func validRoutedEndpoint(mode, bind, address string, port int) bool {
	if !specificIPv4(bind) || port < 1024 || port > 65535 {
		return false
	}
	switch mode {
	case "direct":
		return publicWebRTCIPv4(address)
	case "turn":
		return address == bind && netip.MustParseAddr(bind).IsPrivate()
	default:
		return false
	}
}

func validUDPLease(lease *udpLease) bool {
	if lease == nil {
		return true
	}
	b, err := hex.DecodeString(lease.Epoch)
	return err == nil && len(b) == 16 && hex.EncodeToString(b) == lease.Epoch &&
		validRoutedEndpoint(lease.Mode, lease.Bind, lease.Address, lease.Port)
}

// lifecycleMu serializes assignment with creation/retirement. Durable records,
// including failed or not-yet-restored records, reserve slots until verified
// teardown removes the record. Persistent displays retain their slot on detach.
func (m *manager) assignUDPEndpoint(id string, c *runtimeComponents, pinned bool) error {
	policy := m.cfg.webRTC
	if !c.NativeUDP || (!pinned && policy.firstPort == 0) {
		return nil
	}
	used := map[int]string{}
	claim := func(owner string, lease *udpLease) error {
		if lease == nil {
			return nil
		}
		if prior := used[lease.Port]; prior != "" && prior != owner {
			return errors.New("UDP endpoint has conflicting owners")
		}
		used[lease.Port] = owner
		return nil
	}
	if m.cfg.stateDir != "" {
		records, err := m.loadRuntimeManifests()
		if err != nil {
			return err
		}
		for _, record := range records {
			if err := claim(record.Runtime.ID, record.Components.UDPEndpoint); err != nil {
				return err
			}
		}
	}
	m.mu.RLock()
	for _, item := range m.instances {
		if item.State == "stopped" {
			continue
		}
		if err := claim(item.ID, item.Components.UDPEndpoint); err != nil {
			m.mu.RUnlock()
			return err
		}
	}
	m.mu.RUnlock()
	if pinned {
		if c.UDPEndpoint != nil && used[c.UDPEndpoint.Port] != "" && used[c.UDPEndpoint.Port] != id {
			return errors.New("locked UDP endpoint is owned by another runtime")
		}
		return nil
	}
	bind, advertised := policy.endpointAddresses()
	c.UDPEndpoint = nil
	if bind == "" {
		c.UDPUnavailableReason = udpInterfaceUnavailable
		return nil
	}
	c.UDPUnavailableReason = "endpoint-pool-full"
	for port := policy.firstPort; port <= policy.lastPort; port++ {
		if used[port] != "" {
			continue
		}
		probe, err := net.ListenPacket("udp4", net.JoinHostPort(bind, strconv.Itoa(port)))
		if err != nil {
			continue
		}
		_ = probe.Close()
		var epoch [16]byte
		if _, err := rand.Read(epoch[:]); err != nil {
			return err
		}
		c.UDPEndpoint = &udpLease{Address: advertised, Port: port, Epoch: hex.EncodeToString(epoch[:]), Mode: policy.mode, Bind: bind}
		c.UDPUnavailableReason = ""
		break
	}
	return nil
}

func nativeTransport(item *instance) *nativeTransportView {
	if !isKasm(item) {
		return nil
	}
	v := &nativeTransportView{Policy: "wss-only", Reason: item.Components.UDPUnavailableReason, GrantRequired: true}
	v.ReadOnly = true
	if item.Components.UDPEndpoint != nil {
		v.Policy, v.Available = "prefer-udp", true
		v.Mode = item.Components.UDPEndpoint.Mode
	}
	return v
}

func supportsNativeText(protocol string) bool {
	return protocol == kasmbundle.TextProtocol || protocol == kasmbundle.UDPProtocol || kasmbundle.SupportsRichClipboard(protocol)
}
