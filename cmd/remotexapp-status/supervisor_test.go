package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

// Portable process fixtures test ownership, faults and cleanup. Actual D-Bus,
// IBus/Unicode and application protocol tests run in the local E2E tier.
func TestSessionServiceProcess(t *testing.T) {
	role := os.Getenv("REMOTEXAPP_TEST_SERVICE")
	if role == "" {
		return
	}
	if role == "supervisor" {
		if err := superviseSession(os.Getenv("REMOTEXAPP_TEST_DRIVER")); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(2)
		}
		os.Exit(0)
	}
	if role == "driver" {
		if os.Getenv("REMOTEXAPP_TEST_IGNORE_DRIVER_TERM") == "1" {
			signal.Ignore(syscall.SIGTERM)
		}
		_ = os.WriteFile(filepath.Join(os.Getenv("REMOTEXAPP_RUNTIME"), "driver-environment.json"), mustJSON(os.Environ()), 0600)
		generation, _ := strconv.ParseInt(os.Getenv("REMOTEXAPP_SESSION_GENERATION"), 10, 64)
		if os.Getenv("REMOTEXAPP_TEST_DRIVER_ERROR") == "1" {
			_ = report(os.Getenv("REMOTEXAPP_STATUS_PATH"), os.Getenv("REMOTEXAPP_STATUS_SCHEMA"), generation,
				"error", "Driver fixture", "fixture Driver-specific error", nil, nil, nil, nil)
			os.Exit(7)
		}
		// Mirror the real Driver's private-then-public publication contract.
		if err := report(filepath.Join(os.Getenv("REMOTEXAPP_RUNTIME"), "connection-status.json"),
			filepath.Join(os.Getenv("REMOTEXAPP_RUNTIME"), "connection-schema.json"), generation, "ready", "", "", nil, nil, nil, nil); err != nil {
			os.Exit(3)
		}
		if err := report(os.Getenv("REMOTEXAPP_STATUS_PATH"), os.Getenv("REMOTEXAPP_STATUS_SCHEMA"), generation, "ready", "fixture", "", nil, nil, nil, nil); err != nil {
			os.Exit(3)
		}
		for {
			time.Sleep(time.Hour)
		}
	}
	name := map[string]string{"dbus": "session-bus.sock", "ibus": "ibus.sock", "engine": "unicode.sock"}[role]
	if name == "" {
		os.Exit(4)
	}
	l, err := net.Listen("unix", filepath.Join(os.Getenv("REMOTEXAPP_SOCKET_RUNTIME"), name))
	if err != nil {
		os.Exit(5)
	}
	for {
		c, err := l.Accept()
		if err != nil {
			os.Exit(6)
		}
		_, _ = c.Write([]byte("{\"ok\":true,\"type\":\"cursor-position\"}\n"))
		_ = c.Close()
	}
}

func mustJSON(v any) []byte { b, _ := json.Marshal(v); return b }

type supervisorFixture struct {
	runtime, socket, driver string
	env                     []string
}

func newSupervisorFixture(t *testing.T, mode string) supervisorFixture {
	t.Helper()
	root := t.TempDir()
	f := supervisorFixture{runtime: filepath.Join(root, "r"), socket: filepath.Join(root, "s"), driver: filepath.Join(root, "bin", "driver")}
	for _, p := range []string{f.runtime, f.socket, filepath.Join(root, "bin")} {
		if err := os.Mkdir(p, 0700); err != nil {
			t.Fatal(err)
		}
	}
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for name, role := range map[string]string{"dbus-daemon": "dbus", "ibus-daemon": "ibus", "python3": "engine", "driver": "driver"} {
		body := "#!/bin/sh\nexport REMOTEXAPP_TEST_SERVICE=" + role + "\nexec \"$REMOTEXAPP_TEST_BINARY\" -test.run='^TestSessionServiceProcess$'\n"
		if err := os.WriteFile(filepath.Join(root, "bin", name), []byte(body), 0700); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"dbus-send", "ibus"} {
		if err := os.WriteFile(filepath.Join(root, "bin", name), []byte("#!/bin/sh\nexit 0\n"), 0700); err != nil {
			t.Fatal(err)
		}
	}
	for name, data := range map[string]string{
		"schema.json": "{}", "status.json": "{\"generation\":1,\"revision\":1,\"state\":\"starting\"}",
		"connection-schema.json": "{}", "connection-status.json": "{\"generation\":1,\"revision\":1,\"state\":\"starting\"}",
	} {
		if err := os.WriteFile(filepath.Join(f.runtime, name), []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
	}
	f.env = append(os.Environ(), "PATH="+filepath.Join(root, "bin")+":"+os.Getenv("PATH"), "REMOTEXAPP_TEST_BINARY="+binary,
		"REMOTEXAPP_TEST_SERVICE=supervisor", "REMOTEXAPP_TEST_DRIVER="+f.driver, "REMOTEXAPP_RUNTIME="+f.runtime, "REMOTEXAPP_SOCKET_RUNTIME="+f.socket,
		"REMOTEXAPP_SESSION_SERVICES=core-v1", "REMOTEXAPP_SESSION_GENERATION=1", "REMOTEXAPP_SESSION_DEADLINE_MS="+strconv.FormatInt(time.Now().Add(10*time.Second).UnixMilli(), 10),
		"REMOTEXAPP_STATUS_PATH="+filepath.Join(f.runtime, "status.json"), "REMOTEXAPP_STATUS_SCHEMA="+filepath.Join(f.runtime, "schema.json"),
		"REMOTE_UNICODE_ENGINE="+filepath.Join(root, "engine.py"), "HOME="+root, "XAUTHORITY="+filepath.Join(root, "authority"), "REMOTEXAPP_RUN_MODE="+mode,
		fmt.Sprintf("DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/%d/bus", os.Getuid()))
	return f
}

func (f supervisorFixture) start(t *testing.T) *exec.Cmd {
	t.Helper()
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	c := exec.Command(binary, "-test.run=^TestSessionServiceProcess$")
	c.Env = f.env
	log, err := os.Create(filepath.Join(f.runtime, "test-supervisor.log"))
	if err != nil {
		t.Fatal(err)
	}
	c.Stdout, c.Stderr = log, log
	if err := c.Start(); err != nil {
		t.Fatal(err)
	}
	_ = log.Close()
	t.Cleanup(func() {
		b, _ := os.ReadFile(filepath.Join(f.runtime, "session-services.json"))
		var last serviceRecord
		_ = json.Unmarshal(b, &last)
		_ = c.Process.Signal(syscall.SIGTERM)
		done := make(chan struct{})
		go func() { _ = c.Wait(); close(done) }()
		select {
		case <-done:
		case <-time.After(8 * time.Second):
			_ = c.Process.Kill()
			t.Error("supervisor cleanup timeout")
		}
		for name, id := range last.Services {
			if actual, err := processIdentity(id.PID); err == nil && actual == id {
				_ = syscall.Kill(id.PID, syscall.SIGKILL) // exact disposable fixture identity
				t.Errorf("supervisor leaked %s child %d", name, id.PID)
			}
		}
	})
	return c
}

func (f supervisorFixture) record(t *testing.T, state string) serviceRecord {
	t.Helper()
	until := time.Now().Add(8 * time.Second)
	for time.Now().Before(until) {
		b, _ := os.ReadFile(filepath.Join(f.runtime, "session-services.json"))
		var r serviceRecord
		if json.Unmarshal(b, &r) == nil && r.State == state {
			return r
		}
		time.Sleep(20 * time.Millisecond)
	}
	b, _ := os.ReadFile(filepath.Join(f.runtime, "test-supervisor.log"))
	t.Fatalf("services never reached %s: %s", state, b)
	return serviceRecord{}
}

func TestSupervisorEnvironmentAndBorrowedBus(t *testing.T) {
	for _, mode := range []string{"isolated", "shared", "user-home"} {
		t.Run(mode, func(t *testing.T) {
			f := newSupervisorFixture(t, mode)
			c := f.start(t)
			r := f.record(t, "ready")
			if r.Driver == nil || r.Supervisor.PID != c.Process.Pid || r.Driver.PID == c.Process.Pid {
				t.Fatal("driver and supervisor identity conflated")
			}
			_, ownsBus := r.Services["dbus"]
			if ownsBus == (mode == "user-home") {
				t.Fatal("incorrect borrowed bus ownership")
			}
			b, err := os.ReadFile(filepath.Join(f.runtime, "driver-environment.json"))
			if err != nil {
				t.Fatal(err)
			}
			var env []string
			_ = json.Unmarshal(b, &env)
			for _, key := range []string{"HOME=", "XAUTHORITY=", "DBUS_SESSION_BUS_ADDRESS=", "IBUS_ADDRESS=", "GTK_IM_MODULE=", "QT_IM_MODULE="} {
				count := 0
				for _, v := range env {
					if strings.HasPrefix(v, key) {
						count++
					}
				}
				if count != 1 {
					t.Fatalf("%s has %d values", key, count)
				}
			}
			if err := c.Process.Signal(syscall.SIGTERM); err != nil {
				t.Fatal(err)
			}
			f.record(t, "stopped")
		})
	}
}

func TestSupervisorServiceFaultPreservesApplication(t *testing.T) {
	for _, name := range []string{"dbus", "ibus", "engine"} {
		t.Run(name, func(t *testing.T) {
			f := newSupervisorFixture(t, "isolated")
			f.start(t)
			r := f.record(t, "ready")
			if err := syscall.Kill(r.Services[name].PID, syscall.SIGKILL); err != nil {
				t.Fatal(err)
			}
			bad := f.record(t, "degraded")
			if bad.Failure == "" {
				t.Fatal("missing typed service failure")
			}
			id, err := processIdentity(r.Driver.PID)
			if err != nil || id != *r.Driver {
				t.Fatal("service fault replaced or killed App")
			}
			if id, err := processIdentity(r.Supervisor.PID); err != nil || id != r.Supervisor {
				t.Fatal("service fault restarted supervisor")
			}
		})
	}
}

func TestSupervisorDriverExitCleansServices(t *testing.T) {
	f := newSupervisorFixture(t, "isolated")
	f.start(t)
	r := f.record(t, "ready")
	if err := syscall.Kill(r.Driver.PID, syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	f.record(t, "exited")
	until := time.Now().Add(6 * time.Second)
	for time.Now().Before(until) {
		alive := false
		for _, id := range r.Services {
			if got, err := processIdentity(id.PID); err == nil && got == id {
				alive = true
			}
		}
		if !alive {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("helpers kept exited Driver alive")
}

func TestSupervisorRefusesOccupiedEndpoint(t *testing.T) {
	f := newSupervisorFixture(t, "isolated")
	path := filepath.Join(f.socket, "ibus.sock")
	l, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	binary, _ := os.Executable()
	c := exec.Command(binary, "-test.run=^TestSessionServiceProcess$")
	c.Env = f.env
	if b, err := c.CombinedOutput(); err == nil || !strings.Contains(string(b), "occupied") {
		t.Fatalf("occupied socket was not rejected: %s %v", b, err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal("foreign endpoint removed")
	}
}

func TestSupervisorRefusesSecondOwner(t *testing.T) {
	f := newSupervisorFixture(t, "isolated")
	f.start(t)
	before := f.record(t, "ready")
	binary, _ := os.Executable()
	c := exec.Command(binary, "-test.run=^TestSessionServiceProcess$")
	c.Env = f.env
	if b, err := c.CombinedOutput(); err == nil || !strings.Contains(string(b), "already active") {
		t.Fatalf("second supervisor acquired ownership: %s %v", b, err)
	}
	after := f.record(t, "ready")
	if before.Supervisor != after.Supervisor || *before.Driver != *after.Driver {
		t.Fatal("second launch modified live ownership")
	}
	if got, err := processIdentity(before.Driver.PID); err != nil || got != *before.Driver {
		t.Fatal("rejected second launch harmed live Driver")
	}
}

func TestSupervisorStartupTimeoutAndNoDriver(t *testing.T) {
	f := newSupervisorFixture(t, "isolated")
	f.env = append(f.env, "REMOTEXAPP_SESSION_DEADLINE_MS="+strconv.FormatInt(time.Now().Add(700*time.Millisecond).UnixMilli(), 10))
	if err := os.WriteFile(filepath.Join(filepath.Dir(f.driver), "dbus-send"), []byte("#!/bin/sh\nexit 1\n"), 0700); err != nil {
		t.Fatal(err)
	}
	f.start(t)
	r := f.record(t, "failed")
	if r.Driver != nil {
		t.Fatal("Driver launched with unusable bus")
	}
}

func TestSupervisorUsesMachineReadableIBusProbe(t *testing.T) {
	f := newSupervisorFixture(t, "isolated")
	script := "#!/bin/sh\nif [ \"$1\" = list-engine ]; then\n if [ \"$#\" != 2 ] || [ \"$2\" != --name-only ]; then exec sleep 2; fi\n printf 'checked' > \"$REMOTEXAPP_RUNTIME/name-only-probe\"\nfi\nexit 0\n"
	if err := os.WriteFile(filepath.Join(filepath.Dir(f.driver), "ibus"), []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	f.start(t)
	f.record(t, "ready")
	public, err := readStatus(filepath.Join(f.runtime, "status.json"))
	if err != nil {
		t.Fatal(err)
	}
	private, err := readStatus(filepath.Join(f.runtime, "connection-status.json"))
	if err != nil || public.Revision != private.Revision || private.State != "ready" {
		t.Fatalf("startup diagnostics broke connection revision pairing: public=%+v private=%+v error=%v", public, private, err)
	}
	if _, err := os.Stat(filepath.Join(f.runtime, "name-only-probe")); err != nil {
		t.Fatal(err)
	}
}

func TestSupervisorReadinessFailuresHaveSafeStage(t *testing.T) {
	for _, test := range []struct{ executable, body, stage string }{
		{"dbus-send", "exit 1", "D-Bus readiness"},
		{"ibus", "exit 1", "IBus readiness"},
		{"ibus", "[ \"$1\" = list-engine ] && exit 0; exit 1", "Unicode readiness"},
	} {
		t.Run(test.stage, func(t *testing.T) {
			f := newSupervisorFixture(t, "isolated")
			// This checks failure attribution, not startup performance. Allow the
			// race-instrumented subprocesses to reach the injected failing probe
			// on a busy host; a sub-second fixture deadline can fail an earlier
			// healthy stage instead. Probe cancellation has its own bounded test.
			f.env = append(f.env, "REMOTEXAPP_SESSION_DEADLINE_MS="+strconv.FormatInt(time.Now().Add(5*time.Second).UnixMilli(), 10))
			if err := os.WriteFile(filepath.Join(filepath.Dir(f.driver), test.executable), []byte("#!/bin/sh\necho 'private-bus-payload' >&2\n"+test.body+"\n"), 0700); err != nil {
				t.Fatal(err)
			}
			f.start(t)
			r := f.record(t, "failed")
			if r.Driver != nil {
				t.Fatal("Driver started without input readiness")
			}
			// The durable service record is published before the public status;
			// do not impose a sub-second filesystem performance requirement here.
			until := time.Now().Add(5 * time.Second)
			for time.Now().Before(until) {
				status, err := readStatus(filepath.Join(f.runtime, "status.json"))
				if err == nil && status.State == "error" {
					if !strings.Contains(status.Error, test.stage) || strings.Contains(status.Error, "private-bus") {
						t.Fatalf("unsafe/missing stage: %q", status.Error)
					}
					return
				}
				time.Sleep(10 * time.Millisecond)
			}
			status, readErr := readStatus(filepath.Join(f.runtime, "status.json"))
			log, _ := os.ReadFile(filepath.Join(f.runtime, "test-supervisor.log"))
			t.Fatalf("no public startup failure: status=%+v read error=%v supervisor=%s", status, readErr, log)
		})
	}
}

func TestSupervisorProbeDeadlinesAndCancellation(t *testing.T) {
	s := &sessionSupervisor{env: os.Environ()}
	for _, limit := range []time.Duration{100 * time.Millisecond, 2 * time.Second} {
		ctx, cancel := context.WithTimeout(context.Background(), limit)
		start := time.Now()
		err := s.command(ctx, "sleep", "10")
		cancel()
		if err == nil || time.Since(start) > time.Second {
			t.Fatalf("probe exceeded bounded deadline: %v", err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if s.command(ctx, "true") == nil {
		t.Fatal("cancelled probe succeeded")
	}
}

func TestSupervisorDriverStartupFailureDetails(t *testing.T) {
	for _, kind := range []string{"missing-executable", "never-ready", "driver-error"} {
		t.Run(kind, func(t *testing.T) {
			f := newSupervisorFixture(t, "isolated")
			// Under -race, private D-Bus/IBus startup can consume most of 1.5s.
			// Give those stages room so this test actually reaches Driver readiness.
			f.env = append(f.env, "REMOTEXAPP_SESSION_DEADLINE_MS="+strconv.FormatInt(time.Now().Add(5*time.Second).UnixMilli(), 10))
			want := "application readiness"
			switch kind {
			case "missing-executable":
				f.env = append(f.env, "REMOTEXAPP_TEST_DRIVER="+filepath.Join(f.runtime, "absent-private-driver"))
				want = "Driver startup"
			case "never-ready":
				if err := os.WriteFile(f.driver, []byte("#!/bin/sh\nexec sleep 10\n"), 0700); err != nil {
					t.Fatal(err)
				}
			case "driver-error":
				f.env = append(f.env, "REMOTEXAPP_TEST_DRIVER_ERROR=1")
				want = "fixture Driver-specific error"
			}
			f.start(t)
			f.record(t, "failed")
			for deadline := time.Now().Add(time.Second); time.Now().Before(deadline); time.Sleep(10 * time.Millisecond) {
				status, err := readStatus(filepath.Join(f.runtime, "status.json"))
				if err == nil && status.State == "error" {
					if !strings.Contains(status.Error, want) || strings.Contains(status.Error, "absent-private-driver") {
						t.Fatalf("wrong startup diagnostic: %q, want %q", status.Error, want)
					}
					return
				}
			}
			t.Fatal("startup error not published")
		})
	}
}

func TestSupervisorPrimitives(t *testing.T) {
	if _, err := processIdentity(-1); err == nil {
		t.Fatal("invalid PID accepted")
	}
	if probeUnicode(filepath.Join(t.TempDir(), "absent")) {
		t.Fatal("missing socket ready")
	}
	s := &sessionSupervisor{children: map[string]*serviceChild{}}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if s.wait(ctx, func() bool { return false }) == nil {
		t.Fatal("cancelled startup accepted")
	}
	t.Setenv("REMOTEXAPP_SESSION_SERVICES", "")
	if superviseSession("/bin/true") == nil {
		t.Fatal("legacy contract accepted")
	}
}

func TestSupervisorOwnedGroupActuallyTerminatesChild(t *testing.T) {
	c := exec.Command("sleep", "120")
	c.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := c.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = c.Process.Kill(); _ = c.Wait() })
	id, err := processIdentity(c.Process.Pid)
	if err != nil {
		t.Fatal(err)
	}
	fd, err := unix.PidfdOpen(id.PID, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer unix.Close(fd)
	if err := unix.PidfdSendSignal(fd, 0, nil, 0); err != nil {
		t.Fatalf("pidfd signal permission: %v", err)
	}
	signalOwnedGroup(id.PID, syscall.SIGKILL)
	time.Sleep(100 * time.Millisecond)
	if _, err := processIdentity(id.PID); err == nil {
		t.Fatal("owned group signal did not terminate child")
	}
}

func TestSupervisorRepeatedTermCannotAbortCleanup(t *testing.T) {
	f := newSupervisorFixture(t, "isolated")
	f.env = append(f.env, "REMOTEXAPP_TEST_IGNORE_DRIVER_TERM=1")
	c := f.start(t)
	r := f.record(t, "ready")
	if err := c.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	f.record(t, "stopped") // Driver ignores TERM, so bounded cleanup is in flight.
	if err := c.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	ids := []serviceIdentity{*r.Driver}
	for _, id := range r.Services {
		ids = append(ids, id)
	}
	deadline := time.Now().Add(6 * time.Second)
	for time.Now().Before(deadline) {
		live := false
		for _, id := range ids {
			if got, err := processIdentity(id.PID); err == nil && got == id {
				live = true
			}
		}
		if !live {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("repeated TERM interrupted ordered cleanup")
}
