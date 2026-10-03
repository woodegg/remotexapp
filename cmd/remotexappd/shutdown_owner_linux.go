package main

// A short-lived subreaper owns only one shutdown hook tree. A private pipe
// ties it to the Manager, including SIGKILL; the hook cannot inherit the pipe.
import (
	"context"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

func init() {
	if len(os.Args) == 3 && os.Args[1] == "--own-shutdown-hook" {
		os.Exit(ownShutdownHook(os.Args[2]))
	}
}

func ownedShutdownCommand(ctx context.Context, driver string) (*exec.Cmd, func(), error) {
	exe, err := os.Executable()
	if err != nil {
		return nil, nil, err
	}
	reader, writer, err := os.Pipe()
	if err != nil {
		return nil, nil, err
	}
	c := exec.CommandContext(ctx, exe, "--own-shutdown-hook", driver)
	c.ExtraFiles = []*os.File{reader}
	c.Cancel = func() error { return writer.Close() }
	c.WaitDelay = 4 * time.Second
	return c, func() { _ = reader.Close(); _ = writer.Close() }, nil
}

func ownShutdownHook(driver string) int {
	if unix.Prctl(unix.PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) != nil {
		return 1
	}
	parent := os.NewFile(3, "shutdown-owner")
	if parent == nil {
		return 1
	}
	defer parent.Close()
	unix.CloseOnExec(3)
	lost := make(chan struct{})
	go func() { _, _ = io.Copy(io.Discard, parent); close(lost) }()
	root := os.Getenv("REMOTEXAPP_RUNTIME")
	if !filepath.IsAbs(root) {
		return 1
	}
	lock, err := os.OpenFile(filepath.Join(root, "shutdown-hook.lock"), os.O_CREATE|os.O_RDWR|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0600)
	if err != nil {
		return 1
	}
	defer lock.Close()
	info, err := lock.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 {
		return 1
	}
	if owner, ok := info.Sys().(*syscall.Stat_t); !ok || owner.Uid != uint32(os.Getuid()) {
		return 1
	}
	for {
		err := unix.Flock(int(lock.Fd()), unix.LOCK_EX|unix.LOCK_NB)
		if err == nil {
			break
		}
		if err != unix.EWOULDBLOCK {
			return 1
		}
		select {
		case <-lost:
			return 1
		case <-time.After(10 * time.Millisecond):
		}
	}
	select {
	case <-lost:
		return 1
	default:
	}
	c := exec.Command(driver)
	c.Env, c.Stdout, c.Stderr = os.Environ(), os.Stdout, os.Stderr
	if c.Start() != nil {
		return 1
	}
	pid := c.Process.Pid
	_ = c.Process.Release() // Wait4 below owns reaping, including orphaned grandchildren.
	defer reapShutdownTree()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		var status unix.WaitStatus
		got, err := unix.Wait4(pid, &status, unix.WNOHANG, nil)
		if err != nil {
			return 1
		}
		if got == pid {
			if status.Exited() {
				return status.ExitStatus()
			}
			return 1
		}
		select {
		case <-lost:
			return 1
		case <-ticker.C:
		}
	}
}

func reapShutdownTree() {
	// Killing a direct child reparents its descendants to this subreaper,
	// including double-forked/setsid children. Never enumerate a whole UID.
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		paths, _ := filepath.Glob("/proc/self/task/*/children")
		for _, path := range paths {
			b, _ := os.ReadFile(path)
			for _, value := range strings.Fields(string(b)) {
				pid, err := strconv.Atoi(value)
				if err != nil || pid <= 1 {
					continue
				}
				fd, err := unix.PidfdOpen(pid, 0)
				if err != nil {
					continue
				}
				// Check parent identity after opening the pidfd, before signaling.
				stat, _ := os.ReadFile(filepath.Join("/proc", value, "stat"))
				end := strings.LastIndexByte(string(stat), ')')
				if end >= 0 {
					fields := strings.Fields(string(stat)[end+1:])
					if len(fields) > 1 && fields[1] == strconv.Itoa(os.Getpid()) {
						_ = unix.PidfdSendSignal(fd, unix.SIGKILL, nil, 0)
					}
				}
				_ = unix.Close(fd)
			}
		}
		for {
			pid, err := unix.Wait4(-1, nil, unix.WNOHANG, nil)
			if err == unix.ECHILD {
				return
			}
			if pid <= 0 {
				break
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
}
