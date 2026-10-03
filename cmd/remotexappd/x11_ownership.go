package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type x11FileIdentity struct {
	Device uint64 `json:"device"`
	Inode  uint64 `json:"inode"`
}
type x11Ownership struct {
	SchemaVersion int                    `json:"schemaVersion"`
	RuntimeID     string                 `json:"runtimeId"`
	Display       string                 `json:"display"`
	VNC           sessionServiceIdentity `json:"vnc"`
	Lock          x11FileIdentity        `json:"lock"`
	Socket        x11FileIdentity        `json:"socket"`
}

func x11Paths(root, display string) (string, string, error) {
	n, err := strconv.Atoi(strings.TrimPrefix(display, ":"))
	if err != nil || n < 1 || n > 99 || display != ":"+strconv.Itoa(n) {
		return "", "", errors.New("invalid owned X display")
	}
	return filepath.Join(root, ".X"+strconv.Itoa(n)+"-lock"), filepath.Join(root, ".X11-unix", "X"+strconv.Itoa(n)), nil
}
func x11File(path string, socket bool) (x11FileIdentity, error) {
	i, err := os.Lstat(path)
	if err != nil {
		return x11FileIdentity{}, err
	}
	s, ok := i.Sys().(*syscall.Stat_t)
	if !ok || s.Uid != uint32(os.Getuid()) || (socket && i.Mode()&os.ModeSocket == 0) || (!socket && !i.Mode().IsRegular()) {
		return x11FileIdentity{}, errors.New("X endpoint type/owner changed")
	}
	return x11FileIdentity{s.Dev, s.Ino}, nil
}

func (m *manager) captureX11Ownership(item *instance) error {
	lock, socket, err := x11Paths("/tmp", item.Display)
	if err != nil {
		return err
	}
	pid, err := readCanonicalPID(lock)
	if err != nil {
		return err
	}
	p, err := m.inspectCanonicalProcess(m.canonicalProcRoot(), pid, item.VNCUnit)
	if err != nil {
		return err
	}
	l, err := x11File(lock, false)
	if err != nil {
		return err
	}
	s, err := x11File(socket, true)
	if err != nil {
		return err
	}
	v := x11Ownership{1, item.ID, item.Display, sessionServiceIdentity{pid, p.StartTime}, l, s}
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return writePrivateAtomic(filepath.Join(item.Runtime, "x11-ownership.json"), b)
}

func removeOwnedX11(item *instance) error {
	f, err := openPrivateRegular(filepath.Join(item.Runtime, "x11-ownership.json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	} // No proof: never guess ownership.
	if err != nil {
		return err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return err
	}
	owner, ok := info.Sys().(*syscall.Stat_t)
	if !ok || owner.Uid != uint32(os.Getuid()) || info.Mode().Perm()&0077 != 0 || info.Size() > 4096 {
		return errors.New("unsafe X ownership record")
	}
	var v x11Ownership
	d := json.NewDecoder(io.LimitReader(f, 4097))
	d.DisallowUnknownFields()
	if err := d.Decode(&v); err != nil {
		return err
	}
	var trailing any
	if d.Decode(&trailing) != io.EOF || v.SchemaVersion != 1 || v.RuntimeID != item.ID || v.Display != item.Display || v.VNC.PID < 2 || v.VNC.StartTime == "" || v.Lock.Inode == 0 || v.Socket.Inode == 0 {
		return errors.New("invalid X ownership record")
	}
	return removeX11Files("/tmp", item, &v)
}

func removeX11Files(root string, item *instance, v *x11Ownership) error {
	lock, socket, err := x11Paths(root, item.Display)
	if err != nil {
		return err
	}
	if p, e := canonicalProcess("/proc", v.VNC.PID); e == nil && p.StartTime == v.VNC.StartTime {
		return errors.New("owned X server is still alive")
	}
	// Check both Linux X transports and RFB. Never unlink an endpoint that
	// another live server has claimed, even if it reused the display number.
	for _, address := range []string{socket, "@" + socket} {
		if c, e := net.DialTimeout("unix", address, 100*time.Millisecond); e == nil {
			c.Close()
			return errors.New("X display has a live listener")
		}
	}
	if port, e := pinnedLoopbackPort(item.RFBAddr); e == nil && loopbackListenerActive(port) {
		return errors.New("RFB listener is still alive")
	}
	paths := []struct {
		name     string
		socket   bool
		identity x11FileIdentity
	}{{socket, true, v.Socket}, {lock, false, v.Lock}}
	for _, path := range paths {
		actual, err := x11File(path.name, path.socket)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		if actual != path.identity {
			return errors.New("X endpoint identity changed; manual recovery required")
		}
		if !path.socket {
			pid, e := readCanonicalPID(path.name)
			if e != nil || pid != v.VNC.PID {
				return errors.New("X lock owner changed")
			}
		}
	}
	for _, path := range paths {
		actual, err := x11File(path.name, path.socket)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil || actual != path.identity {
			return errors.New("X endpoint changed during cleanup")
		}
		if err := os.Remove(path.name); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("remove owned X endpoint: %w", err)
		}
	}
	return nil
}
