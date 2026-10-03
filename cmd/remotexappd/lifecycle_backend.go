package main

import (
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

const standaloneComponentLogLimit = 8 << 20

// launchComponent accepts the existing systemd-run component specification.
// The standalone translation is deliberately strict: an unfamiliar option is
// an error, never silently ignored. This keeps one environment/argv contract
// across the two lifecycle backends until all launch sites use a typed spec.
func (m *manager) launchComponent(args []string) (string, error) {
	if m.standalone == nil {
		return runUserSystemd(20*time.Second, "systemd-run", args...)
	}
	unit, directory, env, argv, err := parseComponentLaunch(args)
	if err != nil {
		return "", err
	}
	logDir := filepath.Join(m.cfg.stateDir, "component-logs")
	if err := os.MkdirAll(logDir, 0o700); err != nil {
		return "", err
	}
	logPath := filepath.Join(logDir, unit+".log")
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return "", err
	}
	defer logFile.Close()
	intentPersisted := false
	pid, startTime, err := m.standalone.start(unit, directory, env, argv, logFile, func() error {
		if err := m.persistStandaloneIdentity(unit, 0, ""); err != nil {
			return err
		}
		intentPersisted = true
		return nil
	})
	if err != nil {
		// Only clean up an intent created by this launch; an existing live
		// component with the same unit must never be touched on collision.
		if intentPersisted {
			if cleanupErr := m.stopStandaloneComponent(unit); cleanupErr != nil {
				return "", fmt.Errorf("%w; cleanup: %v", err, cleanupErr)
			}
		}
		return "", err
	}
	if err := m.persistStandaloneIdentity(unit, pid, startTime); err != nil {
		_ = m.standalone.stop(unit, pid, startTime, time.Second)
		return "", fmt.Errorf("persist standalone component identity: %w", err)
	}
	return fmt.Sprintf("standalone component %s pid=%d start=%s", unit, pid, startTime), nil
}

func parseComponentLaunch(args []string) (unit, directory string, env, argv []string, err error) {
	env = append([]string(nil), os.Environ()...)
	directory, err = os.Getwd()
	if err != nil {
		return "", "", nil, nil, err
	}
	separator := -1
	for i, arg := range args {
		if arg == "--" {
			separator = i
			break
		}
		switch {
		case arg == "--user", arg == "--collect", arg == "--remain-after-exit":
		case strings.HasPrefix(arg, "--unit="):
			unit = strings.TrimPrefix(arg, "--unit=") + ".service"
		case strings.HasPrefix(arg, "--setenv="):
			value := strings.TrimPrefix(arg, "--setenv=")
			if key, _, ok := strings.Cut(value, "="); !ok || key == "" || strings.ContainsAny(key, " \t\r\n") {
				return "", "", nil, nil, fmt.Errorf("invalid component environment %q", value)
			}
			env = append(env, value)
		case strings.HasPrefix(arg, "--property=WorkingDirectory="):
			directory = strings.TrimPrefix(arg, "--property=WorkingDirectory=")
		case strings.HasPrefix(arg, "--property=BindsTo="), strings.HasPrefix(arg, "--property=After="),
			arg == "--property=KillMode=mixed", arg == "--property=TimeoutStopSec=10s":
			// These systemd dependencies are enforced by Manager launch order and
			// cgroup/observer reconciliation in standalone mode.
		default:
			return "", "", nil, nil, fmt.Errorf("unsupported standalone component option %q", arg)
		}
	}
	if separator < 0 || separator+1 >= len(args) || unit == ".service" {
		return "", "", nil, nil, errors.New("component unit and executable are required")
	}
	if _, err := (&standaloneCgroupRoot{}).componentPath(unit); err != nil {
		return "", "", nil, nil, err
	}
	argv = args[separator+1:]
	if !filepath.IsAbs(argv[0]) || !filepath.IsAbs(directory) {
		return "", "", nil, nil, errors.New("component executable and working directory must be absolute")
	}
	return unit, directory, env, argv, nil
}

func (m *manager) componentActive(unit string) bool {
	if m.standalone != nil {
		return m.standaloneComponentActive(unit)
	}
	return userUnitActive(unit)
}

// A failed unit can still have processes in its cgroup. Treat an unreadable
// cgroup as populated unless it no longer exists; auto-recovery must never
// stop an uncertain, possibly unsaved user session.
func (m *manager) sessionComponentPopulated(unit string) bool {
	if m.componentActive(unit) {
		return true
	}
	if unit == "" {
		return false
	}
	path := cgroupEventPath("/sys/fs/cgroup", os.Getuid(), unit)
	if m.standalone != nil {
		componentPath, err := m.standalone.componentPath(unit)
		if err != nil {
			return true
		}
		path = filepath.Join(componentPath, "cgroup.events")
	}
	populated, err := cgroupPopulated(path)
	if errors.Is(err, os.ErrNotExist) {
		return false
	}
	return err != nil || populated
}

func (m *manager) stopComponent(unit string) (string, error) {
	if m.standalone != nil {
		return "", m.stopStandaloneComponent(unit)
	}
	return runUserSystemd(20*time.Second, "systemctl", "--user", "stop", unit)
}

// systemd BindsTo stops dependent units when VNC exits. Standalone has no
// service manager for those dependencies, so reconcile every ready runtime,
// including anonymous ones, and force-retire a broken server stack. Session
// exits have their separate generation-scoped observer and policy.
func (m *manager) monitorStandaloneComponents() {
	if m.standalone == nil {
		return
	}
	for range time.NewTicker(2 * time.Second).C {
		if err := m.limitStandaloneComponentLogs(); err != nil {
			log.Printf("standalone component log maintenance: %v", err)
		}
		m.mu.RLock()
		ids := make([]string, 0, len(m.instances))
		for id, item := range m.instances {
			if item.State == "server-ready" || item.State == "ready" {
				ids = append(ids, id)
			}
		}
		m.mu.RUnlock()
		for _, id := range ids {
			m.lifecycleMu.Lock()
			item := m.get(id)
			if item == nil || (item.State != "server-ready" && item.State != "ready") {
				m.lifecycleMu.Unlock()
				continue
			}
			failed := ""
			for _, unit := range []string{item.VNCUnit, item.ServerUnit, item.GatewayUnit} {
				if unit != "" && !m.componentActive(unit) {
					failed = unit
					break
				}
			}
			if failed == "" {
				m.lifecycleMu.Unlock()
				continue
			}
			err := m.stopInstanceLocked(item, stopOptions{Reason: "standalone-component-exit", Force: true})
			if item.ManagedID != "" {
				if reconcileErr := m.reconcileManagedAfterStandaloneComponentLoss(item, err); reconcileErr != nil {
					log.Printf("managed runtime %s lost component %s; reconciliation failed: %v", item.ManagedID, failed, reconcileErr)
				}
			}
			m.lifecycleMu.Unlock()
			if err != nil {
				log.Printf("runtime %s lost component %s; force cleanup failed: %v", id, failed, err)
			} else {
				log.Printf("runtime %s lost component %s; retired dependent components", id, failed)
			}
		}
	}
}

// The standalone supervisor handles server loss directly. Its managed cgroup
// observer watches VNC and gateway, not the server Driver, so retiring a dead
// server must also update/reconcile the durable managed registration now.
// Otherwise it can report running with a stopped runtime until the long
// safety sweep, even though all component cgroups have already disappeared.
func (m *manager) reconcileManagedAfterStandaloneComponentLoss(runtime *instance, stopErr error) error {
	if stopErr == nil {
		return m.reconcileManagedLocked(runtime.ManagedID)
	}
	m.managedMu.Lock()
	defer m.managedMu.Unlock()
	managed := m.managed[runtime.ManagedID]
	if managed == nil || managed.RuntimeInstanceID != runtime.ID {
		return nil
	}
	managed.ObservedState = "failed"
	managed.Error = "standalone component cleanup failed: " + stopErr.Error()
	managed.UpdatedAt = time.Now()
	return m.persistManaged(managed)
}

func (m *manager) limitStandaloneComponentLogs() error {
	entries, err := os.ReadDir(filepath.Join(m.cfg.stateDir, "component-logs"))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".service.log") {
			continue
		}
		unit := strings.TrimSuffix(entry.Name(), ".log")
		if _, err := m.standalone.componentPath(unit); err != nil {
			continue
		}
		path := filepath.Join(m.cfg.stateDir, "component-logs", entry.Name())
		info, err := os.Lstat(path)
		if err != nil || !info.Mode().IsRegular() {
			return fmt.Errorf("unsafe component log %s", entry.Name())
		}
		owner, ok := info.Sys().(*syscall.Stat_t)
		if !ok || owner.Uid != uint32(os.Getuid()) || info.Mode().Perm() != 0o600 {
			return fmt.Errorf("unsafe component log owner or mode %s", entry.Name())
		}
		if info.Size() > standaloneComponentLogLimit {
			if err := os.Truncate(path, 0); err != nil {
				return fmt.Errorf("truncate component log %s: %w", entry.Name(), err)
			}
		}
	}
	return nil
}
