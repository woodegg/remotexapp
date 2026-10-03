package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

// The recorded launch and the live peer must describe the same runtime process.
// A conventional filename by itself is not evidence of a usable IBus service.
func (m *manager) ibusConnection(item *instance, raw any) (*sessionBusConnection, string, error) {
	bad := errors.New("invalid private IBus metadata")
	if raw == nil {
		return nil, "metadata-missing", nil
	}
	payload, err := json.Marshal(raw)
	if err != nil {
		return nil, "", bad
	}
	var v struct {
		Generation int64  `json:"generation"`
		Enabled    *bool  `json:"enabled"`
		Address    string `json:"address"`
		Scope      string `json:"scope"`
		PID        int    `json:"pid"`
		StartTime  string `json:"startTime"`
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&v) != nil || v.Generation != item.SessionGeneration || v.Enabled == nil {
		return nil, "", bad
	}
	if !*v.Enabled {
		if v.Address != "" || v.Scope != "" || v.PID != 0 || v.StartTime != "" {
			return nil, "", bad
		}
		return nil, "not-enabled", nil
	}
	path := filepath.Join(item.SocketRuntime, "ibus.sock")
	if !filepath.IsAbs(item.SocketRuntime) || v.Address != "unix:path="+path || v.Scope != "runtime" || v.PID < 1 || v.StartTime == "" {
		return nil, "", bad
	}
	resolved, err := filepath.EvalSymlinks(item.SocketRuntime)
	if err != nil || resolved != filepath.Clean(item.SocketRuntime) {
		return nil, "", bad
	}
	identity, err := canonicalProcess(m.canonicalProcRoot(), v.PID)
	if os.IsNotExist(err) {
		return nil, "not-running", nil
	}
	if err != nil || identity.StartTime != v.StartTime {
		return nil, "", bad
	}
	if _, err = m.inspectCanonicalProcess(m.canonicalProcRoot(), v.PID, item.SessionUnit); err != nil {
		return nil, "", bad
	}
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return nil, "not-running", nil
	}
	if err != nil || info.Mode()&os.ModeSocket == 0 {
		return nil, "", bad
	}
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok || st.Uid != identity.UID {
		return nil, "", bad
	}
	conn, err := net.DialTimeout("unix", path, 250*time.Millisecond)
	if err != nil {
		if errors.Is(err, syscall.ECONNREFUSED) || errors.Is(err, syscall.ENOENT) {
			return nil, "not-running", nil
		}
		return nil, "", bad
	}
	defer conn.Close()
	unix, ok := conn.(*net.UnixConn)
	if !ok {
		return nil, "", bad
	}
	fd, err := unix.SyscallConn()
	if err != nil {
		return nil, "", bad
	}
	var peer *syscall.Ucred
	var peerErr error
	if err = fd.Control(func(s uintptr) {
		peer, peerErr = syscall.GetsockoptUcred(int(s), syscall.SOL_SOCKET, syscall.SO_PEERCRED)
	}); err != nil || peerErr != nil || peer == nil || int(peer.Pid) != v.PID || peer.Uid != identity.UID {
		return nil, "", bad
	}
	if m.confirmCanonicalProcess(m.canonicalProcRoot(), v.PID, item.SessionUnit, identity) != nil {
		return nil, "", bad
	}
	// The address is read from the launch record; expected path is only a boundary check.
	return &sessionBusConnection{Address: strings.TrimSpace(v.Address), Scope: v.Scope}, "", nil
}
