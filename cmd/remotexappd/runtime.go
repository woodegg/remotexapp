package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func resolveUserHome() (string, error) {
	if os.Getuid() == 0 {
		return "", errors.New("runMode user-home is unavailable to UID 0")
	}
	account, err := user.Current()
	if err != nil {
		return "", fmt.Errorf("resolve current Unix account: %w", err)
	}
	home := filepath.Clean(account.HomeDir)
	if !filepath.IsAbs(home) || home == string(filepath.Separator) {
		return "", fmt.Errorf("current Unix account has unsafe HOME %q", account.HomeDir)
	}
	info, err := os.Stat(home)
	if err != nil {
		return "", fmt.Errorf("inspect current Unix account HOME: %w", err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("current Unix account HOME is not a directory: %s", home)
	}
	return home, nil
}

func authorityPath(item *instance) string {
	if item.XAuthority != "" {
		return item.XAuthority
	}
	return filepath.Join(item.Home, ".Xauthority")
}

func userBusAddress() (string, error) {
	return userBusAddressAt(filepath.Join("/run/user", strconv.Itoa(os.Getuid())), os.Getuid())
}

func userBusAddressAt(directory string, uid int) (string, error) {
	parent, err := os.Lstat(directory)
	if err != nil {
		return "", fmt.Errorf("inspect user runtime directory: %w", err)
	}
	owner, ok := parent.Sys().(*syscall.Stat_t)
	if !parent.IsDir() || parent.Mode()&os.ModeSymlink != 0 || parent.Mode().Perm() != 0o700 || !ok || int(owner.Uid) != uid {
		return "", errors.New("user runtime directory must be a real owner-only directory for the selected UID")
	}
	path := filepath.Join(directory, "bus")
	info, err := os.Lstat(path)
	if err != nil {
		return "", fmt.Errorf("inspect user D-Bus socket: %w", err)
	}
	owner, ok = info.Sys().(*syscall.Stat_t)
	// The parent is private; systemd's user-bus socket itself is commonly
	// mode 0666, so socket mode is not an isolation boundary here.
	if info.Mode()&os.ModeSocket == 0 || !ok || int(owner.Uid) != uid {
		return "", fmt.Errorf("user D-Bus path must be a socket owned by UID %d: %s", uid, path)
	}
	return "unix:path=" + path, nil
}

func runUserSystemd(timeout time.Duration, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	command := exec.CommandContext(ctx, name, args...)
	uid := strconv.Itoa(os.Getuid())
	command.Env = append(os.Environ(), "XDG_RUNTIME_DIR=/run/user/"+uid, "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/"+uid+"/bus")
	output, err := command.CombinedOutput()
	if ctx.Err() != nil {
		return string(output), ctx.Err()
	}
	return strings.TrimSpace(string(output)), err
}

func displayBusy(display, rfbPort int) bool {
	if _, err := os.Stat("/tmp/.X11-unix/X" + strconv.Itoa(display)); err == nil {
		return true
	}
	return loopbackListenerActive(rfbPort)
}

// loopbackListenerActive distinguishes a live listener from connections left
// in TIME_WAIT. The core RFB and gateway listeners enable immediate rebinding,
// so recently closed client connections must not block a fixed-display restart.
func loopbackListenerActive(port int) bool {
	connection, err := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)), 150*time.Millisecond)
	if err == nil {
		_ = connection.Close()
		return true
	}
	return false
}

func portBusy(port int) bool {
	// A connect probe misses a recently closed listener whose connections are
	// still in TIME_WAIT. App Package drivers are not required to enable
	// SO_REUSEADDR, so allocate only a port that a plain loopback socket can
	// actually bind at this instant.
	return loopbackBindBusy(port, false)
}

// A pinned restart reuses the same immutable driver and endpoint. On Linux,
// SO_REUSEADDR permits rebinding after close only if the former socket also
// enabled reuse. Unlike a connect-only probe, bind still rejects live listeners
// and non-reusable closed sockets. Driver readiness remains authoritative.
func loopbackBindBusy(port int, reuse bool) bool {
	socket, err := syscall.Socket(syscall.AF_INET, syscall.SOCK_STREAM|syscall.SOCK_CLOEXEC, syscall.IPPROTO_TCP)
	if err != nil {
		return true
	}
	defer syscall.Close(socket)
	if reuse {
		if err := syscall.SetsockoptInt(socket, syscall.SOL_SOCKET, syscall.SO_REUSEADDR, 1); err != nil {
			return true
		}
	}
	address := &syscall.SockaddrInet4{Port: port, Addr: [4]byte{127, 0, 0, 1}}
	return syscall.Bind(socket, address) != nil
}

func xDisplayReady(display, authority string) bool {
	command := exec.Command("xdpyinfo", "-display", display)
	command.Env = append(os.Environ(), "DISPLAY="+display, "XAUTHORITY="+authority)
	return command.Run() == nil
}

func socketExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode()&os.ModeSocket != 0
}

func pidFileAlive(path string) bool {
	value, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(value)))
	return err == nil && pid > 1 && syscall.Kill(pid, 0) == nil
}

func waitFor(timeout time.Duration, ready func() bool) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if ready() {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return errors.New("timed out")
}

func randomID(classID string) (string, error) {
	buffer := make([]byte, 6)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return classID + "-" + hex.EncodeToString(buffer), nil
}

func removeEphemeralHome(stateDir, home string) error {
	profilesRoot := filepath.Join(stateDir, "profiles")
	relative, err := filepath.Rel(profilesRoot, home)
	if err != nil || relative == "." || relative == "" || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return fmt.Errorf("refusing to remove ephemeral HOME outside profiles root: %q", home)
	}
	if err := os.RemoveAll(home); err != nil {
		return fmt.Errorf("remove ephemeral HOME: %w", err)
	}
	return nil
}

func removeRuntimeDirectory(stateDir, runtime string) error {
	runtimeRoot := filepath.Join(stateDir, "instances")
	relative, err := filepath.Rel(runtimeRoot, runtime)
	if err != nil || relative == "." || relative == "" || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return fmt.Errorf("refusing to remove runtime outside instances root: %q", runtime)
	}
	if err := os.RemoveAll(runtime); err != nil {
		return fmt.Errorf("remove runtime directory: %w", err)
	}
	return nil
}
