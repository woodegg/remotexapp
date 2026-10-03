package main

// Core-owned session services deliberately share the existing session unit.
// The Manager owns policy; this process owns only children and their ordering.
import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/woodegg/remotexapp/internal/sessionstartup"
	"golang.org/x/sys/unix"
)

type serviceIdentity struct {
	PID       int    `json:"pid"`
	StartTime string `json:"startTime"`
}

type serviceRecord struct {
	DeadlineMS    int64                      `json:"deadlineMs"`
	SchemaVersion int                        `json:"schemaVersion"`
	Generation    int64                      `json:"generation"`
	State         string                     `json:"state"`
	Failure       string                     `json:"failure,omitempty"`
	Supervisor    serviceIdentity            `json:"supervisor"`
	Driver        *serviceIdentity           `json:"driver,omitempty"`
	Services      map[string]serviceIdentity `json:"services"`
	BorrowedBus   bool                       `json:"borrowedBus"`
}

type serviceChild struct {
	cmd     *exec.Cmd
	done    chan struct{}
	err     error // read only after done is closed
	stopped bool
}

type sessionSupervisor struct {
	runtime, socketRuntime, publicPath, schemaPath, driver string
	generation                                             int64
	env                                                    []string
	record                                                 serviceRecord
	children                                               map[string]*serviceChild
	endpoints                                              map[string]os.FileInfo
	stage                                                  string
}

func (s *sessionSupervisor) startupStage(stage string) error {
	s.stage = stage
	// Driver status publication increments private and public revisions together.
	// Advance both before handing ownership to the Driver, or every subsequent
	// ready connection descriptor would be rejected for mismatched revisions.
	if err := report(filepath.Join(s.runtime, "connection-status.json"), filepath.Join(s.runtime, "connection-schema.json"),
		s.generation, "starting", "", "", nil, nil, nil, nil); err != nil {
		return err
	}
	return report(s.publicPath, s.schemaPath, s.generation, "starting", sessionstartup.Summary(stage), "", nil, nil, nil, nil)
}

func processIdentity(pid int) (serviceIdentity, error) {
	b, err := os.ReadFile(filepath.Join("/proc", strconv.Itoa(pid), "stat"))
	if err != nil {
		return serviceIdentity{}, err
	}
	i := strings.LastIndexByte(string(b), ')')
	if i < 0 {
		return serviceIdentity{}, errors.New("invalid process identity")
	}
	f := strings.Fields(string(b)[i+1:])
	if len(f) < 20 || f[0] == "Z" {
		return serviceIdentity{}, errors.New("process exited")
	}
	if _, err := strconv.ParseUint(f[19], 10, 64); err != nil {
		return serviceIdentity{}, err
	}
	return serviceIdentity{pid, f[19]}, nil
}

func (s *sessionSupervisor) publish(state, failure string) error {
	s.record.State, s.record.Failure = state, failure
	b, err := json.Marshal(s.record)
	if err != nil {
		return err
	}
	return writeAtomic(filepath.Join(s.runtime, "session-services.json"), b)
}

func (s *sessionSupervisor) start(name, executable string, args ...string) error {
	log, err := os.OpenFile(filepath.Join(s.runtime, "session-"+name+".log"), os.O_WRONLY|os.O_CREATE|os.O_APPEND, 0600)
	if err != nil {
		return err
	}
	defer log.Close()
	c := &serviceChild{cmd: exec.Command(executable, args...), done: make(chan struct{})}
	c.cmd.Env = s.env
	c.cmd.Stdout, c.cmd.Stderr = log, log
	c.cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := c.cmd.Start(); err != nil {
		return fmt.Errorf("start %s: %w", name, err)
	}
	s.children[name] = c
	go func() { c.err = c.cmd.Wait(); close(c.done) }()
	id, err := processIdentity(c.cmd.Process.Pid)
	if err != nil {
		return err
	}
	if name == "driver" {
		s.record.Driver = &id
	} else {
		s.record.Services[name] = id
	}
	if err := writeAtomic(filepath.Join(s.runtime, "session-"+name+".pid"), []byte(strconv.Itoa(id.PID)+"\n")); err != nil {
		return err
	}
	return s.publish("starting", "")
}

func childExited(c *serviceChild) bool {
	if c == nil {
		return false
	}
	select {
	case <-c.done:
		return true
	default:
		return false
	}
}

func (s *sessionSupervisor) stop(name string) {
	c := s.children[name]
	if c == nil || c.stopped {
		return
	}
	c.stopped = true
	// Check live group members against our cgroup and use pidfds. Reaped leader
	// PIDs can be reused; a negative-PID kill after Wait would be unsafe.
	signalOwnedGroup(c.cmd.Process.Pid, syscall.SIGTERM)
	select {
	case <-c.done:
	case <-time.After(1500 * time.Millisecond):
	}
	signalOwnedGroup(c.cmd.Process.Pid, syscall.SIGKILL)
	select {
	case <-c.done:
	case <-time.After(500 * time.Millisecond):
	}
}

func signalOwnedGroup(group int, sig syscall.Signal) {
	self, err := os.ReadFile("/proc/self/cgroup")
	if err != nil {
		return
	}
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return
	}
	for _, entry := range entries {
		pid, err := strconv.Atoi(entry.Name())
		if err != nil || pid <= 1 || pid == os.Getpid() {
			continue
		}
		root := filepath.Join("/proc", entry.Name())
		stat, err := os.ReadFile(filepath.Join(root, "stat"))
		if err != nil {
			continue
		}
		end := strings.LastIndexByte(string(stat), ')')
		if end < 0 {
			continue
		}
		fields := strings.Fields(string(stat)[end+1:])
		if len(fields) < 20 || fields[2] != strconv.Itoa(group) {
			continue
		}
		cgroup, err := os.ReadFile(filepath.Join(root, "cgroup"))
		if err != nil || string(cgroup) != string(self) {
			continue
		}
		fd, err := unix.PidfdOpen(pid, 0)
		if err != nil {
			continue
		}
		identity, err := processIdentity(pid)
		if err == nil && identity.StartTime == fields[19] {
			_ = unix.PidfdSendSignal(fd, unix.Signal(sig), nil, 0)
		}
		_ = unix.Close(fd)
	}
}

func (s *sessionSupervisor) rememberEndpoints() {
	for _, name := range []string{"session-bus.sock", "ibus.sock", "unicode.sock"} {
		if name == "session-bus.sock" && s.record.BorrowedBus {
			continue
		}
		path := filepath.Join(s.socketRuntime, name)
		if _, ok := s.endpoints[path]; ok {
			continue
		}
		if info, err := os.Lstat(path); err == nil && info.Mode()&os.ModeSocket != 0 {
			s.endpoints[path] = info
		}
	}
}

func (s *sessionSupervisor) cleanup() {
	s.rememberEndpoints()
	for _, name := range []string{"driver", "engine", "ibus", "dbus"} {
		s.stop(name)
	}
	for path, original := range s.endpoints {
		if current, err := os.Lstat(path); err == nil && os.SameFile(original, current) {
			_ = os.Remove(path)
		}
	}
	for name := range s.children {
		_ = os.Remove(filepath.Join(s.runtime, "session-"+name+".pid"))
	}
	_ = os.Remove(filepath.Join(s.runtime, "session-dbus-address"))
}

func (s *sessionSupervisor) command(ctx context.Context, executable string, args ...string) error {
	probe, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	defer cancel()
	cmd := exec.CommandContext(probe, executable, args...)
	cmd.Env = s.env
	// Never log protocol output: bus names, environment and payloads are private.
	return cmd.Run()
}

func (s *sessionSupervisor) wait(ctx context.Context, check func() bool) error {
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		for name, child := range s.children {
			if childExited(child) {
				return fmt.Errorf("%s exited during session startup", name)
			}
		}
		if check() {
			s.rememberEndpoints()
			return nil
		}
		select {
		case <-ctx.Done():
			return errors.New("session startup deadline exceeded")
		case <-ticker.C:
		}
	}
}

func probeUnicode(path string) bool {
	c, err := net.DialTimeout("unix", path, 200*time.Millisecond)
	if err != nil {
		return false
	}
	defer c.Close()
	_ = c.SetDeadline(time.Now().Add(200 * time.Millisecond))
	if _, err = io.WriteString(c, "{\"action\":\"cursor\"}\n"); err != nil {
		return false
	}
	var reply struct {
		Type string `json:"type"`
		OK   bool   `json:"ok"`
	}
	return json.NewDecoder(io.LimitReader(c, 4096)).Decode(&reply) == nil && reply.Type == "cursor-position" && reply.OK
}

func (s *sessionSupervisor) startServices(ctx context.Context) error {
	if err := s.startupStage("D-Bus startup"); err != nil {
		return err
	}
	bus := "unix:path=" + filepath.Join(s.socketRuntime, "session-bus.sock")
	if s.record.BorrowedBus {
		bus = os.Getenv("DBUS_SESSION_BUS_ADDRESS")
		if bus != fmt.Sprintf("unix:path=/run/user/%d/bus", os.Getuid()) {
			return errors.New("invalid borrowed account bus")
		}
	} else {
		if err := s.start("dbus", "dbus-daemon", "--session", "--nofork", "--address="+bus); err != nil {
			return err
		}
	}
	s.env = append(s.env, "DBUS_SESSION_BUS_ADDRESS="+bus, "IBUS_ADDRESS=unix:path="+filepath.Join(s.socketRuntime, "ibus.sock"),
		"GTK_IM_MODULE=ibus", "QT_IM_MODULE=ibus", "XMODIFIERS=@im=ibus")
	if err := s.startupStage("D-Bus readiness"); err != nil {
		return err
	}
	if err := s.wait(ctx, func() bool {
		return s.command(ctx, "dbus-send", "--bus="+bus, "--print-reply", "--reply-timeout=400", "--dest=org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus.ListNames") == nil
	}); err != nil {
		return fmt.Errorf("D-Bus readiness: %w", err)
	}
	if err := writeAtomic(filepath.Join(s.runtime, "session-dbus-address"), []byte(bus+"\n")); err != nil {
		return err
	}
	if err := s.startupStage("IBus startup"); err != nil {
		return err
	}
	if err := s.start("ibus", "ibus-daemon", "--single", "--panel=disable", "--emoji-extension=disable", "--config=disable", "--cache=none", "--address=unix:path="+filepath.Join(s.socketRuntime, "ibus.sock")); err != nil {
		return err
	}
	if err := s.startupStage("IBus readiness"); err != nil {
		return err
	}
	if err := s.wait(ctx, func() bool { return s.command(ctx, "ibus", "list-engine", "--name-only") == nil }); err != nil {
		return fmt.Errorf("IBus readiness: %w", err)
	}
	// Use the established identity writer, before the Driver's first status write.
	if err := recordIBusAddress(s.publicPath, s.generation, s.children["ibus"].cmd.Process.Pid, "unix:path="+filepath.Join(s.socketRuntime, "ibus.sock")); err != nil {
		return errors.New("record IBus identity")
	}
	if err := s.startupStage("Unicode startup"); err != nil {
		return err
	}
	if err := s.start("engine", "python3", os.Getenv("REMOTE_UNICODE_ENGINE"), "--socket", filepath.Join(s.socketRuntime, "unicode.sock"), "--log", filepath.Join(s.runtime, "session-engine.log")); err != nil {
		return err
	}
	if err := s.startupStage("Unicode readiness"); err != nil {
		return err
	}
	return s.wait(ctx, func() bool {
		return s.command(ctx, "ibus", "engine", "remote-unicode") == nil && probeUnicode(filepath.Join(s.socketRuntime, "unicode.sock"))
	})
}

func supervisorEnvironment(environment []string) []string {
	result := make([]string, 0, len(environment))
	for _, value := range environment {
		key, _, _ := strings.Cut(value, "=")
		switch key {
		case "DBUS_SESSION_BUS_ADDRESS", "DBUS_SESSION_BUS_PID", "IBUS_ADDRESS", "GTK_IM_MODULE", "QT_IM_MODULE", "XMODIFIERS":
			continue
		}
		result = append(result, value)
	}
	return result
}

func superviseSession(driver string) error {
	if os.Getenv("REMOTEXAPP_SESSION_SERVICES") != "core-v1" {
		return errors.New("core-v1 session services contract required")
	}
	generation, err := strconv.ParseInt(os.Getenv("REMOTEXAPP_SESSION_GENERATION"), 10, 64)
	if err != nil || generation < 1 {
		return errors.New("invalid session generation")
	}
	deadline, err := strconv.ParseInt(os.Getenv("REMOTEXAPP_SESSION_DEADLINE_MS"), 10, 64)
	if err != nil || deadline <= time.Now().UnixMilli() {
		return errors.New("invalid session deadline")
	}
	for _, key := range []string{"REMOTEXAPP_RUNTIME", "REMOTEXAPP_SOCKET_RUNTIME", "REMOTEXAPP_STATUS_PATH", "REMOTEXAPP_STATUS_SCHEMA", "REMOTE_UNICODE_ENGINE", "HOME", "XAUTHORITY"} {
		if !filepath.IsAbs(os.Getenv(key)) {
			return fmt.Errorf("absolute %s is required", key)
		}
	}
	if !filepath.IsAbs(driver) {
		return errors.New("absolute Driver path required")
	}
	mode := os.Getenv("REMOTEXAPP_RUN_MODE")
	if mode != "isolated" && mode != "shared" && mode != "user-home" {
		return errors.New("unsupported run mode")
	}
	syscall.Umask(0077)
	pidfd, err := unix.PidfdOpen(os.Getpid(), 0)
	if err != nil {
		return errors.New("Core session supervision requires Linux pidfd support")
	}
	_ = unix.Close(pidfd)
	s := &sessionSupervisor{runtime: os.Getenv("REMOTEXAPP_RUNTIME"), socketRuntime: os.Getenv("REMOTEXAPP_SOCKET_RUNTIME"), publicPath: os.Getenv("REMOTEXAPP_STATUS_PATH"), schemaPath: os.Getenv("REMOTEXAPP_STATUS_SCHEMA"), driver: driver, generation: generation,
		env: supervisorEnvironment(os.Environ()), children: map[string]*serviceChild{}, endpoints: map[string]os.FileInfo{}, record: serviceRecord{SchemaVersion: 1, Generation: generation, Services: map[string]serviceIdentity{}, BorrowedBus: mode == "user-home"}}
	s.record.DeadlineMS = deadline
	lock, err := os.OpenFile(filepath.Join(s.runtime, "session-services.lock"), os.O_CREATE|os.O_RDWR|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return err
	}
	defer lock.Close()
	if syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB) != nil {
		return errors.New("session supervisor already active")
	}
	for _, name := range []string{"session-bus.sock", "ibus.sock", "unicode.sock"} {
		if _, err := os.Lstat(filepath.Join(s.socketRuntime, name)); !os.IsNotExist(err) {
			return fmt.Errorf("session endpoint occupied: %s; stop its owner before relaunch", name)
		}
	}
	s.record.Supervisor, err = processIdentity(os.Getpid())
	if err != nil {
		return err
	}
	if err := s.publish("starting", ""); err != nil {
		return err
	}
	lifetime, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()
	// Keep signal handling installed until cleanup finishes. A second TERM
	// must not restore the default action and abort ordered child cleanup.
	defer s.cleanup()
	ctx, cancel := context.WithDeadline(lifetime, time.UnixMilli(deadline))
	defer cancel()
	err = s.startServices(ctx)
	if err == nil {
		err = s.startupStage("Driver startup")
	}
	if err == nil {
		err = s.start("driver", driver)
	}
	if err == nil {
		// Once the Driver runs it owns public progress; never overwrite its
		// ready/error status with a late supervisor "starting" write.
		s.stage = "application readiness"
		err = s.wait(ctx, func() bool {
			status, e := readStatus(s.publicPath)
			return e == nil && status.Generation == generation && status.State == "ready"
		})
	}
	if err != nil {
		_ = s.publish("failed", "startup-failed")
		failure := sessionstartup.Failure(sessionstartup.Summary(s.stage))
		if failure == "" {
			failure = "Core session startup failed; inspect the session unit journal"
		}
		current, readErr := readStatus(s.publicPath)
		if readErr != nil || current.Generation != generation || current.State != "error" {
			_ = report(s.publicPath, s.schemaPath, generation, "error", "Session service startup failed", failure, nil, nil, nil, nil)
		}
		return err
	}
	if err := s.publish("ready", ""); err != nil {
		return err
	}
	return s.observe(lifetime)
}

func (s *sessionSupervisor) observe(lifetime context.Context) error {
	var borrowedBusCheck <-chan time.Time
	if s.record.BorrowedBus {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		borrowedBusCheck = ticker.C
	}
	childChannel := func(name string) <-chan struct{} {
		if c := s.children[name]; c != nil {
			return c.done
		}
		return nil
	}
	bus, ibus, engine := childChannel("dbus"), childChannel("ibus"), childChannel("engine")
	for {
		select {
		case <-lifetime.Done():
			return s.publish("stopped", "")
		case <-s.children["driver"].done:
			// Driver has already published its canonical App exit status. Returning
			// tears down services, allowing the existing cgroup observer to run once.
			failure := s.record.Failure
			if failure == "" {
				for _, name := range []string{"dbus", "ibus", "engine"} {
					child := s.children[name]
					if child == nil || child.stopped {
						continue
					}
					if _, err := processIdentity(child.cmd.Process.Pid); err != nil {
						failure = map[string]string{"dbus": "dbus-exited", "ibus": "ibus-exited", "engine": "unicode-exited"}[name]
						break
					}
				}
			}
			if failure != "" {
				_ = report(s.publicPath, s.schemaPath, s.generation, "error", "Application exited after a session service failure", failure, nil, nil, nil, nil)
			}
			return s.publish("exited", failure)
		case <-borrowedBusCheck:
			address := fmt.Sprintf("unix:path=/run/user/%d/bus", os.Getuid())
			if s.command(lifetime, "dbus-send", "--bus="+address, "--print-reply", "--reply-timeout=400", "--dest=org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus.ListNames") != nil {
				borrowedBusCheck, ibus, engine = nil, nil, nil
				s.stop("engine")
				s.stop("ibus")
				if err := s.publish("degraded", "borrowed-dbus-unavailable"); err != nil {
					return err
				}
			}
		case <-bus:
			bus, ibus, engine = nil, nil, nil
			s.stop("engine")
			s.stop("ibus")
			if err := s.publish("degraded", "dbus-exited"); err != nil {
				return err
			}
		case <-ibus:
			ibus, engine = nil, nil
			s.stop("engine")
			if err := s.publish("degraded", "ibus-exited"); err != nil {
				return err
			}
		case <-engine:
			engine = nil
			if err := s.publish("degraded", "unicode-exited"); err != nil {
				return err
			}
		}
	}
}
