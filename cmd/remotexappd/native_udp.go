package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/netip"
	"os"
	"strconv"

	"github.com/woodegg/remotexapp/internal/kasmbundle"
)

const nativeUDPManifestSchema = 5

// An administrator preconfigures matching non-NAT proxies. This catalog is
// declarative input only: Manager has no host/network administration API.
type udpEndpoint struct {
	Slot    string `json:"slot"`
	Address string `json:"advertisedAddress"`
	Port    int    `json:"port"`
}

type udpLease struct {
	udpEndpoint
	Epoch string `json:"epoch"`
}

type nativeTransportView struct {
	Policy        string `json:"policy"`
	Available     bool   `json:"available"`
	Reason        string `json:"reason,omitempty"`
	GrantRequired bool   `json:"grantRequired"`
}

func validUDPEndpoint(e udpEndpoint) bool {
	ip, err := netip.ParseAddr(e.Address)
	return err == nil && ip.Is4() && ip.IsGlobalUnicast() && !ip.IsPrivate() &&
		!ip.IsLoopback() && e.Address == ip.String() && safeRef.MatchString(e.Slot) && e.Port >= 1024 && e.Port <= 65535
}

func (cfg *config) loadUDPEndpoints() error {
	if cfg.udpEndpointsFile == "" {
		return nil
	}
	if !cfg.nativeUDPCapable {
		return errors.New("udp-endpoints requires the pinned UDP-capable Kasm component")
	}
	f, err := os.Open(cfg.udpEndpointsFile)
	if err != nil {
		return err
	}
	defer f.Close()
	var catalog struct {
		SchemaVersion int           `json:"schemaVersion"`
		Endpoints     []udpEndpoint `json:"endpoints"`
	}
	raw, err := io.ReadAll(io.LimitReader(f, 16385))
	if err != nil || len(raw) > 16384 {
		return errors.New("UDP endpoint catalog exceeds byte limit")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(&catalog); err != nil {
		return fmt.Errorf("UDP endpoint catalog: %w", err)
	}
	var extra any
	if d.Decode(&extra) != io.EOF || catalog.SchemaVersion != 1 || len(catalog.Endpoints) < 1 || len(catalog.Endpoints) > 64 {
		return errors.New("invalid UDP endpoint catalog")
	}
	slots, ports := map[string]bool{}, map[int]bool{}
	for _, e := range catalog.Endpoints {
		if !validUDPEndpoint(e) || slots[e.Slot] || ports[e.Port] {
			return errors.New("invalid or duplicate UDP endpoint")
		}
		slots[e.Slot], ports[e.Port] = true, true
	}
	cfg.udpEndpoints = catalog.Endpoints
	return nil
}

func validUDPLease(lease *udpLease) bool {
	if lease == nil {
		return true
	}
	b, err := hex.DecodeString(lease.Epoch)
	return validUDPEndpoint(lease.udpEndpoint) && err == nil && len(b) == 16 && hex.EncodeToString(b) == lease.Epoch
}

func (m *manager) validateUDPCatalogLease(lease *udpLease) error {
	if lease == nil {
		return nil
	}
	for _, endpoint := range m.cfg.udpEndpoints {
		if endpoint == lease.udpEndpoint {
			return nil
		}
	}
	return errors.New("locked UDP endpoint is absent or changed in the deployment catalog")
}

// lifecycleMu serializes assignment with creation/retirement. Durable records,
// including failed or not-yet-restored records, reserve slots until verified
// teardown removes the record. Persistent displays retain their slot on detach.
func (m *manager) assignUDPEndpoint(id string, c *runtimeComponents, pinned bool) error {
	if !c.NativeUDP {
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
		if err := m.validateUDPCatalogLease(c.UDPEndpoint); err != nil {
			return err
		}
		if c.UDPEndpoint != nil && used[c.UDPEndpoint.Port] != "" && used[c.UDPEndpoint.Port] != id {
			return errors.New("locked UDP endpoint is owned by another runtime")
		}
		return nil
	}
	c.UDPEndpoint = nil
	c.UDPUnavailableReason = "endpoint-pool-full"
	if len(m.cfg.udpEndpoints) == 0 {
		c.UDPUnavailableReason = "endpoints-not-configured"
	}
	for _, e := range m.cfg.udpEndpoints {
		if used[e.Port] != "" {
			continue
		}
		// Check actual local ownership too; immediately close the probe. The
		// selected UID is the trust boundary, not a defense against its peers.
		probe, err := net.ListenPacket("udp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(e.Port)))
		if err != nil {
			continue
		}
		_ = probe.Close()
		var epoch [16]byte
		if _, err := rand.Read(epoch[:]); err != nil {
			return err
		}
		c.UDPEndpoint = &udpLease{udpEndpoint: e, Epoch: hex.EncodeToString(epoch[:])}
		c.UDPUnavailableReason = ""
		break
	}
	return nil
}

func nativeTransport(item *instance) *nativeTransportView {
	if !isKasm(item) || !item.Components.NativeUDP {
		return nil
	}
	v := &nativeTransportView{Policy: "wss-only", Reason: item.Components.UDPUnavailableReason, GrantRequired: true}
	if item.Components.UDPEndpoint != nil {
		v.Policy, v.Available = "prefer-udp", true
	}
	return v
}

func supportsNativeText(protocol string) bool {
	return protocol == kasmbundle.TextProtocol || protocol == kasmbundle.UDPProtocol
}
