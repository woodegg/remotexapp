package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const connectionsHeader = "X-RemoteXApp-Connections-Token"

// Private metadata files must not be followed through symlinks or FIFOs.
func openPrivateRegular(path string) (*os.File, error) {
	fd, err := syscall.Open(path, syscall.O_RDONLY|syscall.O_CLOEXEC|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(fd), path)
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		f.Close()
		return nil, errors.New("expected a regular file")
	}
	return f, nil
}

type sessionBusConnection struct {
	Address string `json:"address"`
	Scope   string `json:"scope"`
}
type connectionEnvironment struct {
	Display    string                `json:"display"`
	XAuthority string                `json:"xauthorityPath"`
	SessionBus *sessionBusConnection `json:"sessionBus,omitempty"`
	IBus       *sessionBusConnection `json:"ibus,omitempty"`
}
type connectionDescriptor struct {
	SchemaVersion      int                   `json:"schemaVersion"`
	InstanceID         string                `json:"instanceId"`
	SessionGeneration  int64                 `json:"sessionGeneration"`
	Revision           string                `json:"revision"`
	State              string                `json:"state"`
	Environment        connectionEnvironment `json:"environment"`
	Application        map[string]any        `json:"application,omitempty"`
	Unavailable        []string              `json:"unavailable,omitempty"`
	UnavailableReasons map[string]string     `json:"unavailableReasons,omitempty"`
}

func connectionDefinitions(private map[string]parameterDefinition) map[string]parameterDefinition {
	defs := map[string]parameterDefinition{
		"sessionBus": {Type: "json", MaxBytes: 4096, MaxDepth: 2, MaxItems: 2},
		"ibus":       {Type: "json", MaxBytes: 4096, MaxDepth: 2, MaxItems: 6},
	}
	for key, value := range private {
		defs[key] = value
	}
	return defs
}

func (m *manager) serveConnections(w http.ResponseWriter, r *http.Request, id string) {
	w.Header().Set("Cache-Control", "no-store")
	// Authorization and origin checks are provided by the Manager middleware.
	if r.Method != http.MethodGet {
		methodNotAllowed(w, "GET")
		return
	}
	generation := int64(0)
	if values, ok := r.URL.Query()["sessionGeneration"]; ok {
		var err error
		if len(values) != 1 {
			writeError(w, 400, "sessionGeneration must be a positive integer")
			return
		}
		generation, err = strconv.ParseInt(values[0], 10, 64)
		if err != nil || generation < 1 {
			writeError(w, 400, "sessionGeneration must be a positive integer")
			return
		}
	}
	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()
	item := m.get(id)
	if item == nil {
		writeError(w, 404, "instance not found")
		return
	}
	if generation != 0 && generation != item.SessionGeneration {
		writeError(w, 409, "session generation changed")
		return
	}
	descriptor, err := m.connections(item)
	if err != nil {
		writeError(w, 409, "current session connection information is unavailable")
		return
	}
	writeJSON(w, 200, descriptor)
}

func (m *manager) connections(item *instance) (*connectionDescriptor, error) {
	unavailable := errors.New("connection information unavailable")
	if item.State != "server-ready" || item.SessionState != "running" || item.SessionGeneration < 1 {
		return nil, unavailable
	}
	class := m.specFor(item)
	status, err := readyApplicationStatus(item, item.SessionGeneration)
	if err != nil {
		return nil, unavailable
	}
	if err = validateStatusDetails(class.Session.Status.Details, status.Details); err != nil {
		return nil, unavailable
	}
	pid, err := readCanonicalPID(filepath.Join(item.Runtime, class.Session.ReadinessPID))
	if err != nil {
		return nil, unavailable
	}
	identity, err := m.inspectCanonicalProcess(m.canonicalProcRoot(), pid, item.SessionUnit)
	if err != nil {
		return nil, unavailable
	}
	result := &connectionDescriptor{SchemaVersion: 1, InstanceID: item.ID, SessionGeneration: item.SessionGeneration, State: "ready",
		Environment: connectionEnvironment{Display: item.Display, XAuthority: authorityPath(item)}}
	if application, ok := status.Details["control"]; ok {
		var valid bool
		result.Application, valid = application.(map[string]any)
		if !valid {
			return nil, unavailable
		}
	}
	privatePath := filepath.Join(item.Runtime, "connection-status.json")
	private, err := readStatusFile(privatePath)
	if errors.Is(err, os.ErrNotExist) {
		// Old pinned core helpers did not publish this contract; never guess a bus.
		result.Unavailable = []string{"sessionBus"}
		if len(class.Session.Status.PrivateDetails) > 0 {
			result.Unavailable = append(result.Unavailable, "application")
		}
	} else if err != nil || private.Generation != item.SessionGeneration || private.Revision != status.Revision || private.State != "ready" {
		return nil, unavailable
	} else {
		if err = validateStatusDetails(connectionDefinitions(class.Session.Status.PrivateDetails), private.Details); err != nil {
			return nil, unavailable
		}
		if raw, ok := private.Details["sessionBus"]; ok {
			fields, ok := raw.(map[string]any)
			if !ok || len(fields) != 2 {
				return nil, unavailable
			}
			address, aok := fields["address"].(string)
			scope, sok := fields["scope"].(string)
			expected := "runtime"
			if class.RunMode == "user-home" {
				expected = "user"
			}
			if !aok || !sok || scope != expected || !validSessionBus(address) {
				return nil, unavailable
			}
			if sessionBusReachable(address) {
				result.Environment.SessionBus = &sessionBusConnection{Address: address, Scope: scope}
			} else {
				result.Unavailable = append(result.Unavailable, "sessionBus")
			}
		} else {
			result.Unavailable = append(result.Unavailable, "sessionBus")
		}
		if app, ok := private.Details["application"]; ok {
			if result.Application != nil {
				return nil, unavailable
			}
			var valid bool
			result.Application, valid = app.(map[string]any)
			if !valid {
				return nil, unavailable
			}
		} else if len(class.Session.Status.PrivateDetails) > 0 {
			return nil, unavailable
		}
	}
	var ibusRaw any
	if private != nil {
		ibusRaw = private.Details["ibus"]
		if _, declared := private.Details["ibus"]; declared && ibusRaw == nil {
			return nil, unavailable
		}
	}
	ibus, reason, err := m.ibusConnection(item, ibusRaw)
	if err != nil {
		return nil, unavailable
	}
	result.Environment.IBus = ibus
	if reason != "" {
		result.Unavailable = append(result.Unavailable, "ibus")
		result.UnavailableReasons = map[string]string{"ibus": reason}
	}
	if result.Application != nil {
		protocol, ok := result.Application["protocol"].(string)
		if !ok || protocol == "" {
			return nil, unavailable
		}
	}
	// Files can change independently of Manager lifecycle; recheck both snapshots.
	after, err := readApplicationStatus(item.Runtime)
	if err != nil || !sameConnectionSnapshot(status, after) {
		return nil, unavailable
	}
	later, err := readStatusFile(privatePath)
	if private == nil {
		if !errors.Is(err, os.ErrNotExist) {
			return nil, unavailable
		}
	} else if err != nil || !sameConnectionSnapshot(private, later) {
		return nil, unavailable
	}
	currentPID, err := readCanonicalPID(filepath.Join(item.Runtime, class.Session.ReadinessPID))
	if err != nil || currentPID != pid {
		return nil, unavailable
	}
	if err := m.confirmCanonicalProcess(m.canonicalProcRoot(), pid, item.SessionUnit, identity); err != nil {
		return nil, unavailable
	}
	// Opaque content revision survives Manager adoption and changes with endpoints.
	finalIBus, finalReason, err := m.ibusConnection(item, ibusRaw)
	if err != nil || finalReason != reason || (ibus != nil && (finalIBus == nil || *ibus != *finalIBus)) {
		return nil, unavailable
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		return nil, unavailable
	}
	hash := sha256.Sum256(encoded)
	result.Revision = hex.EncodeToString(hash[:])
	return result, nil
}

func sameConnectionSnapshot(a, b *applicationStatus) bool {
	first, _ := json.Marshal(a)
	second, _ := json.Marshal(b)
	return string(first) == string(second)
}

func validSessionBus(address string) bool {
	// The first contract supports one local filesystem socket, never TCP/autolaunch.
	if !strings.HasPrefix(address, "unix:path=") || strings.Contains(address, ";") {
		return false
	}
	parts := strings.Split(strings.TrimPrefix(address, "unix:path="), ",")
	if len(parts) > 2 || (len(parts) == 2 && !strings.HasPrefix(parts[1], "guid=")) {
		return false
	}
	path, err := url.PathUnescape(parts[0])
	if err != nil || !filepath.IsAbs(path) || strings.ContainsRune(path, 0) {
		return false
	}
	info, err := os.Stat(path)
	return errors.Is(err, os.ErrNotExist) || (err == nil && info.Mode()&os.ModeSocket != 0)
}

func sessionBusReachable(address string) bool {
	path, _ := url.PathUnescape(strings.Split(strings.TrimPrefix(address, "unix:path="), ",")[0])
	conn, err := net.DialTimeout("unix", path, 250*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}
