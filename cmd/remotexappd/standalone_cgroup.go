package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

// standaloneCgroupRoot is supplied by the host, not created by the Manager.
// Keeping the Manager inside the delegated subtree allows atomic child spawn
// without granting it write access to unrelated platform cgroups.
type standaloneCgroupRoot struct {
	path string
	uid  int
}

func openStandaloneCgroupRoot(path string) (*standaloneCgroupRoot, error) {
	if os.Getuid() == 0 {
		return nil, errors.New("standalone Manager must not run as root")
	}
	if !filepath.IsAbs(path) || filepath.Clean(path) == "/sys/fs/cgroup" {
		return nil, errors.New("standalone cgroup root must be a delegated child of /sys/fs/cgroup")
	}
	path = filepath.Clean(path)
	rel, err := filepath.Rel("/sys/fs/cgroup", path)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return nil, errors.New("standalone cgroup root is outside /sys/fs/cgroup")
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil || resolved != path {
		return nil, errors.New("standalone cgroup root must exist without symlinks")
	}
	info, err := os.Stat(path)
	if err != nil || !info.IsDir() {
		return nil, errors.New("standalone cgroup root is unavailable")
	}
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok || st.Uid != uint32(os.Getuid()) || info.Mode().Perm()&0o022 != 0 {
		return nil, errors.New("standalone cgroup root must be owned by the runtime UID and not group/world writable")
	}
	var fs unix.Statfs_t
	if err := unix.Statfs(path, &fs); err != nil || fs.Type != unix.CGROUP2_SUPER_MAGIC {
		return nil, errors.New("standalone cgroup root is not on cgroup v2")
	}
	if !selfInCgroup(path) {
		return nil, errors.New("standalone Manager must start inside its delegated cgroup subtree")
	}
	if file, err := os.OpenFile(filepath.Join(path, "cgroup.procs"), os.O_WRONLY, 0); err != nil {
		return nil, fmt.Errorf("standalone cgroup root is not delegated for process placement: %w", err)
	} else {
		_ = file.Close()
	}
	return &standaloneCgroupRoot{path: path, uid: os.Getuid()}, nil
}

func selfInCgroup(root string) bool {
	content, err := os.ReadFile("/proc/self/cgroup")
	if err != nil {
		return false
	}
	rel, err := filepath.Rel("/sys/fs/cgroup", root)
	if err != nil || rel == "." || strings.HasPrefix(rel, "..") {
		return false
	}
	expected := "/" + filepath.ToSlash(rel)
	for _, line := range strings.Split(strings.TrimSpace(string(content)), "\n") {
		if !strings.HasPrefix(line, "0::") {
			continue
		}
		actual := strings.TrimPrefix(line, "0::")
		return actual == expected || strings.HasPrefix(actual, expected+"/")
	}
	return false
}

func (root *standaloneCgroupRoot) componentPath(unit string) (string, error) {
	if root == nil || unit == "" || filepath.Base(unit) != unit || !strings.HasPrefix(unit, "remotexapp-") || !strings.HasSuffix(unit, ".service") {
		return "", errors.New("invalid standalone component name")
	}
	for _, ch := range unit {
		if !(ch >= 'a' && ch <= 'z' || ch >= '0' && ch <= '9' || ch == '-' || ch == '.') {
			return "", errors.New("invalid standalone component name")
		}
	}
	return filepath.Join(root.path, unit), nil
}

func (root *standaloneCgroupRoot) populated(unit string) (bool, error) {
	path, err := root.componentPath(unit)
	if err != nil {
		return false, err
	}
	return cgroupPopulated(filepath.Join(path, "cgroup.events"))
}

// start creates a dedicated cgroup and atomically places the component there.
// The child is never briefly loose in the Manager's own cgroup. Callers must
// durably record launch intent before invoking start and verify readiness after.
func (root *standaloneCgroupRoot) start(unit, directory string, environment, argv []string, output *os.File, beforeSpawn func() error) (int, string, error) {
	path, err := root.componentPath(unit)
	if err != nil {
		return 0, "", err
	}
	if len(argv) == 0 || !filepath.IsAbs(argv[0]) || output == nil {
		return 0, "", errors.New("standalone component requires an absolute executable and output file")
	}
	if err := os.Mkdir(path, 0o700); err != nil && !errors.Is(err, os.ErrExist) {
		return 0, "", fmt.Errorf("create component cgroup: %w", err)
	}
	info, err := os.Lstat(path)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return 0, "", errors.New("component cgroup is not a directory")
	}
	owner, ok := info.Sys().(*syscall.Stat_t)
	if !ok || owner.Uid != uint32(root.uid) {
		return 0, "", errors.New("component cgroup has the wrong owner")
	}
	if live, err := root.populated(unit); err != nil || live {
		return 0, "", fmt.Errorf("component cgroup is not empty: %s", unit)
	}
	// Persist the exact cgroup identity before atomic spawn. A Manager crash
	// between spawn and final PID persistence can then retire the owned tree
	// on the next boot without guessing from a PID or pathname alone.
	if err := beforeSpawn(); err != nil {
		return 0, "", fmt.Errorf("persist component launch intent: %w", err)
	}
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC, 0)
	if err != nil {
		return 0, "", err
	}
	defer unix.Close(fd)
	cmd := exec.Command(argv[0], argv[1:]...)
	cmd.Dir = directory
	cmd.Env = environment
	cmd.Stdin = nil
	cmd.Stdout, cmd.Stderr = output, output
	cmd.SysProcAttr = &syscall.SysProcAttr{UseCgroupFD: true, CgroupFD: fd, Setsid: true}
	if err := cmd.Start(); err != nil {
		return 0, "", fmt.Errorf("spawn component into delegated cgroup: %w", err)
	}
	pid := cmd.Process.Pid
	pidfd, pidfdErr := unix.PidfdOpen(pid, 0)
	if pidfdErr != nil {
		// A component started without a stable handle is not adoptable. The Go
		// child has not been reaped yet, so its numeric PID cannot be reused.
		// Retire its entire cgroup, including children it already forked.
		_ = root.stop(unit, 0, "", time.Second)
		go func() { _ = cmd.Wait() }()
		return 0, "", fmt.Errorf("open launched component pidfd: %w", pidfdErr)
	}
	defer unix.Close(pidfd)
	abort := func() {
		_ = root.stop(unit, 0, "", time.Second)
		go func() { _ = cmd.Wait() }()
	}
	// Even a fast-exiting child is reaped. An unqualified PID is never used as
	// adoption authority; callers persist both start time and cgroup identity.
	identity, err := canonicalProcess("/proc", pid)
	if err != nil {
		abort()
		return 0, "", fmt.Errorf("inspect launched component: %w", err)
	}
	if identity.UID != uint32(root.uid) {
		abort()
		return 0, "", errors.New("launched component has the wrong UID")
	}
	inUnit, err := processBelongsToStandaloneCgroup("/proc", pid, path)
	if err != nil || !inUnit {
		abort()
		return 0, "", errors.New("launched component escaped its cgroup")
	}
	go func() { _ = cmd.Wait() }()
	return pid, identity.StartTime, nil
}

// stop sends TERM only to a still-identical main process, then kills every
// remaining owned descendant after the bounded graceful window. It never
// signals an unverified PID or a cgroup outside the delegated subtree.
func (root *standaloneCgroupRoot) stop(unit string, pid int, startTime string, grace time.Duration) error {
	path, err := root.componentPath(unit)
	if err != nil {
		return err
	}
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("component cgroup is not an owned directory")
	}
	owner, ok := info.Sys().(*syscall.Stat_t)
	if !ok || owner.Uid != uint32(root.uid) {
		return errors.New("component cgroup has the wrong owner")
	}
	ownedInode := owner.Ino
	if grace <= 0 || grace > time.Minute {
		return errors.New("invalid standalone stop grace")
	}
	if pid > 1 && startTime != "" {
		if identity, err := canonicalProcess("/proc", pid); err == nil && identity.UID == uint32(root.uid) && identity.StartTime == startTime {
			if belongs, err := processBelongsToStandaloneCgroup("/proc", pid, path); err == nil && belongs {
				if fd, err := unix.PidfdOpen(pid, 0); err == nil {
					_ = unix.PidfdSendSignal(fd, unix.SIGTERM, nil, 0)
					_ = unix.Close(fd)
				}
			}
		}
	}
	// A restarted Manager may have no main-PID handle. Signal only same-UID
	// members verified inside this exact component cgroup before the force
	// fallback. The pidfd prevents signaling a recycled numeric PID.
	content, err := os.ReadFile(filepath.Join(path, "cgroup.procs"))
	if err != nil {
		return fmt.Errorf("read component processes: %w", err)
	}
	for _, raw := range strings.Fields(string(content)) {
		member, parseErr := strconv.Atoi(raw)
		if parseErr != nil || member <= 1 {
			continue
		}
		fd, openErr := unix.PidfdOpen(member, 0)
		if openErr != nil {
			continue
		}
		identity, inspectErr := canonicalProcess("/proc", member)
		belongs, belongsErr := processBelongsToStandaloneCgroup("/proc", member, path)
		if inspectErr == nil && belongsErr == nil && belongs && identity.UID == uint32(root.uid) {
			_ = unix.PidfdSendSignal(fd, unix.SIGTERM, nil, 0)
		}
		_ = unix.Close(fd)
	}
	deadline := time.Now().Add(grace)
	for time.Now().Before(deadline) {
		live, err := root.populated(unit)
		if errors.Is(err, os.ErrNotExist) || err == nil && !live {
			return root.removeEmptyComponent(path, ownedInode)
		}
		if err != nil {
			return err
		}
		time.Sleep(50 * time.Millisecond)
	}
	file, err := os.OpenFile(filepath.Join(path, "cgroup.kill"), os.O_WRONLY, 0)
	if err != nil {
		return fmt.Errorf("open owned component cgroup.kill: %w", err)
	}
	_, writeErr := file.WriteString("1")
	closeErr := file.Close()
	if writeErr != nil || closeErr != nil {
		return fmt.Errorf("kill owned component cgroup: %v; close: %v", writeErr, closeErr)
	}
	if err := waitFor(5*time.Second, func() bool {
		live, err := root.populated(unit)
		return errors.Is(err, os.ErrNotExist) || err == nil && !live
	}); err != nil {
		return err
	}
	return root.removeEmptyComponent(path, ownedInode)
}

// removeEmptyComponent reclaims the exact leaf after its process tree has
// exited. Empty cgroups still consume the host's cgroup.max.descendants quota.
// os.Remove is deliberately non-recursive: a replaced or nested cgroup must
// fail closed rather than allowing cleanup outside this component.
func (root *standaloneCgroupRoot) removeEmptyComponent(path string, inode uint64) error {
	var fs unix.Statfs_t
	if err := unix.Statfs(path, &fs); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	} else if fs.Type != unix.CGROUP2_SUPER_MAGIC {
		// Unit fixtures emulate cgroup.events with regular files. Production roots
		// are required to be cgroup v2 by openStandaloneCgroupRoot.
		return nil
	}
	return removeOwnedEmptyCgroup(path, inode, root.uid, cgroupPopulated)
}

func removeOwnedEmptyCgroup(path string, inode uint64, uid int, populated func(string) (bool, error)) error {
	deadline := time.Now().Add(5 * time.Second)
	for {
		info, err := os.Lstat(path)
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return errors.New("component cgroup changed during cleanup")
		}
		owner, ok := info.Sys().(*syscall.Stat_t)
		if !ok || owner.Uid != uint32(uid) || owner.Ino != inode {
			return errors.New("component cgroup identity changed during cleanup")
		}
		live, err := populated(filepath.Join(path, "cgroup.events"))
		if err != nil {
			return fmt.Errorf("inspect component cgroup during cleanup: %w", err)
		}
		if live {
			return errors.New("component cgroup became populated during cleanup")
		}
		if err := os.Remove(path); err == nil || errors.Is(err, os.ErrNotExist) {
			return nil
		} else if !errors.Is(err, unix.EBUSY) || time.Now().After(deadline) {
			return fmt.Errorf("remove empty component cgroup: %w", err)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func (root *standaloneCgroupRoot) active(unit string) bool {
	live, err := root.populated(unit)
	return err == nil && live
}

func processBelongsToStandaloneCgroup(procRoot string, pid int, cgroupPath string) (bool, error) {
	rel, err := filepath.Rel("/sys/fs/cgroup", cgroupPath)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return false, errors.New("invalid standalone cgroup path")
	}
	payload, err := os.ReadFile(procPath(procRoot, pid, "cgroup"))
	if err != nil {
		return false, err
	}
	expected := "/" + filepath.ToSlash(rel)
	for _, line := range strings.Split(strings.TrimSpace(string(payload)), "\n") {
		if !strings.HasPrefix(line, "0::") {
			continue
		}
		actual := strings.TrimPrefix(line, "0::")
		return actual == expected || strings.HasPrefix(actual, expected+"/"), nil
	}
	return false, errors.New("no cgroup v2 membership record")
}
