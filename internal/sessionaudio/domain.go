// Package sessionaudio owns a private PulseAudio domain. It never loads hardware
// modules or edits account configuration. Same-UID domains are routing boundaries,
// not security boundaries between mutually untrusted applications.
package sessionaudio

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const Protocol = "pcm-s16le-48k-v1"
const Speaker = "rx_speaker"
const Microphone = "rx_mic"
const MicrophoneSink = "rx_mic_in"

// Record is private supervisor metadata, never a browser-supplied endpoint.
type Record struct {
	Protocol   string `json:"protocol"`
	Generation int64  `json:"generation"`
	ID         string `json:"id"`
	Root       string `json:"root"`
	State      string `json:"state"`
	PID        int    `json:"pid,omitempty"`
	StartTime  string `json:"startTime,omitempty"`
	Restarts   int    `json:"restarts"`
}

type Domain struct {
	Record      Record
	rootInfo    os.FileInfo
	environment []string
	command     *exec.Cmd
	done        chan struct{}
	log         *os.File
	retryAfter  time.Time
	failures    int
}

func CheckDependencies() error {
	for _, name := range []string{"pulseaudio", "pactl", "pacat", "parec"} {
		if _, err := exec.LookPath(name); err != nil {
			return fmt.Errorf("native audio requires %s", name)
		}
	}
	return nil
}

func token() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func CleanEnvironment(env []string) []string {
	result := make([]string, 0, len(env))
	for _, value := range env {
		if !strings.HasPrefix(value, "PULSE_") {
			result = append(result, value)
		}
	}
	return result
}

// Environment routes cooperating applications without changing HOME or their bus.
func Environment(record Record, base []string) []string {
	root := record.Root
	return append(CleanEnvironment(base),
		"PULSE_RUNTIME_PATH="+filepath.Join(root, "run"), "PULSE_STATE_PATH="+filepath.Join(root, "state"),
		"PULSE_CONFIG_PATH="+filepath.Join(root, "config"), "PULSE_CLIENTCONFIG="+filepath.Join(root, "config/client.conf"),
		"PULSE_SERVER=unix:"+filepath.Join(root, "run/native"), "PULSE_COOKIE="+filepath.Join(root, "cookie"),
		"PULSE_SINK="+Speaker, "PULSE_SOURCE="+Microphone)
}

func Prepare(parent string, generation int64, environment []string) (*Domain, error) {
	if generation < 1 || !filepath.IsAbs(parent) {
		return nil, errors.New("invalid audio generation or parent")
	}
	root, err := os.MkdirTemp(parent, "audio-")
	if err != nil {
		return nil, err
	}
	ok := false
	defer func() {
		if !ok {
			_ = os.RemoveAll(root)
		}
	}()
	if len(filepath.Join(root, "run/native")) >= 104 || strings.ContainsAny(root, " \t\r\n\"\\") {
		return nil, errors.New("unsupported private Pulse path")
	}
	for _, part := range []string{"run", "state", "config"} {
		if err = os.Mkdir(filepath.Join(root, part), 0700); err != nil {
			return nil, err
		}
	}
	cookie := make([]byte, 256)
	if _, err = rand.Read(cookie); err != nil {
		return nil, err
	}
	if err = os.WriteFile(filepath.Join(root, "cookie"), cookie, 0600); err != nil {
		return nil, err
	}
	files := map[string]string{
		"config/daemon.conf": "enable-shm = no\n",
		"config/client.conf": "autospawn = no\nenable-shm = no\n",
		"start.pa":           fmt.Sprintf("load-module module-native-protocol-unix socket=%s auth-anonymous=0 auth-cookie=%s\nload-module module-null-sink sink_name=%s rate=48000 channels=2 norewinds=1\nload-module module-null-sink sink_name=%s rate=48000 channels=1 channel_map=mono norewinds=1\nload-module module-remap-source master=%s.monitor source_name=%s master_channel_map=mono channel_map=mono remix=no\nset-default-sink %s\nset-default-source %s\n", filepath.Join(root, "run/native"), filepath.Join(root, "cookie"), Speaker, MicrophoneSink, MicrophoneSink, Microphone, Speaker, Microphone),
	}
	for path, value := range files {
		if err = os.WriteFile(filepath.Join(root, path), []byte(value), 0600); err != nil {
			return nil, err
		}
	}
	info, err := os.Lstat(root)
	if err != nil {
		return nil, err
	}
	id, err := token()
	if err != nil {
		return nil, err
	}
	d := &Domain{Record: Record{Protocol: Protocol, Generation: generation, ID: id, Root: root, State: "unavailable"}, rootInfo: info, environment: append([]string{}, environment...)}
	ok = true
	return d, nil
}

func startTime(pid int) (string, error) {
	b, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if err != nil {
		return "", err
	}
	end := strings.LastIndexByte(string(b), ')')
	if end < 0 {
		return "", errors.New("invalid process stat")
	}
	f := strings.Fields(string(b)[end+1:])
	if len(f) < 20 || f[0] == "Z" {
		return "", errors.New("audio process exited")
	}
	return f[19], nil
}

func (d *Domain) exited() bool {
	if d.command == nil {
		return true
	}
	select {
	case <-d.done:
		return true
	default:
		return false
	}
}

// Start is called only by the owning supervisor. A replacement keeps the App's
// private socket address but changes domain ID, fencing all old network grants.
func (d *Domain) Start(ctx context.Context) error {
	if !d.exited() {
		return errors.New("audio already running")
	}
	if d.log != nil {
		_ = d.log.Close()
		d.log = nil
	}
	if d.command != nil {
		d.Record.Restarts++
	}
	d.Record.State = "unavailable"
	d.Record.PID = 0
	d.Record.StartTime = ""
	id, err := token()
	if err != nil {
		return err
	}
	d.Record.ID = id
	// Pulse removes its normal endpoint on exit. An owned crashed daemon may leave
	// its socket; never remove a file supplied by another owner/type.
	socket := filepath.Join(d.Record.Root, "run/native")
	if info, e := os.Lstat(socket); e == nil {
		stat, owned := info.Sys().(*syscall.Stat_t)
		if info.Mode()&os.ModeSocket == 0 || !owned || stat.Uid != uint32(os.Getuid()) {
			return errors.New("audio endpoint ownership changed")
		}
		if err = os.Remove(socket); err != nil {
			return err
		}
	} else if !os.IsNotExist(e) {
		return e
	}
	d.log, err = os.OpenFile(filepath.Join(d.Record.Root, "pulse.log"), os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		return err
	}
	cmd := exec.Command("pulseaudio", "--daemonize=no", "--system=no", "--fail=yes", "--use-pid-file=no", "--exit-idle-time=-1", "--high-priority=no", "--realtime=no", "--disable-shm=yes", "--log-target=stderr", "-n", "--file="+filepath.Join(d.Record.Root, "start.pa"))
	env := Environment(d.Record, d.environment)
	filtered := make([]string, 0, len(env))
	for _, v := range env {
		key, _, _ := strings.Cut(v, "=")
		if key != "DBUS_SESSION_BUS_ADDRESS" && key != "DISPLAY" && key != "WAYLAND_DISPLAY" {
			filtered = append(filtered, v)
		}
	}
	cmd.Env = append(filtered, "DBUS_SESSION_BUS_ADDRESS=unix:path="+filepath.Join(d.Record.Root, "no-bus"))
	cmd.Stdout, cmd.Stderr = d.log, d.log
	cmd.SysProcAttr = &syscall.SysProcAttr{Pdeathsig: syscall.SIGTERM}
	if err = cmd.Start(); err != nil {
		return err
	}
	d.command = cmd
	d.done = make(chan struct{})
	done := d.done
	go func() { _ = cmd.Wait(); close(done) }()
	identity, err := startTime(cmd.Process.Pid)
	if err != nil {
		d.stopProcess()
		return err
	}
	deadline, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	for {
		if d.exited() {
			return errors.New("private audio server exited")
		}
		probe, stop := context.WithTimeout(deadline, 250*time.Millisecond)
		check := exec.CommandContext(probe, "pactl", "info")
		check.Env = Environment(d.Record, d.environment)
		ready := check.Run() == nil
		stop()
		if ready {
			if err := os.Chmod(socket, 0600); err != nil {
				d.stopProcess()
				return err
			}
			d.Record.PID = cmd.Process.Pid
			d.Record.StartTime = identity
			d.Record.State = "ready"
			return nil
		}
		select {
		case <-deadline.Done():
			d.stopProcess()
			return errors.New("private audio readiness timed out")
		case <-time.After(50 * time.Millisecond):
		}
	}
}

func (d *Domain) stopProcess() {
	if d.command == nil {
		return
	}
	if !d.exited() {
		_ = d.command.Process.Signal(syscall.SIGTERM)
	}
	select {
	case <-d.done:
	case <-time.After(time.Second):
		_ = d.command.Process.Kill()
		<-d.done
	}
}

// Poll applies bounded recovery. A failed domain never stops the App or bus.
// Three immediate retries then a 30-second cooldown prevents a crash loop.
func (d *Domain) Poll(ctx context.Context) bool {
	if !d.exited() {
		return false
	}
	if time.Now().Before(d.retryAfter) {
		return false
	}
	d.Record.State = "unavailable"
	d.Record.PID = 0
	d.Record.StartTime = ""
	d.failures++
	delay := time.Second * time.Duration(d.failures)
	if d.failures > 3 {
		delay = 30 * time.Second
	}
	_ = d.Start(ctx)
	d.retryAfter = time.Now().Add(delay)
	return true
}

func (d *Domain) Close() {
	d.stopProcess()
	if d.log != nil {
		_ = d.log.Close()
	}
	d.Record.State = "stopped"
	d.Record.PID = 0
	d.Record.StartTime = ""
	if info, err := os.Lstat(d.Record.Root); err == nil && os.SameFile(info, d.rootInfo) {
		_ = os.RemoveAll(d.Record.Root)
	}
}

// Validate checks private metadata and every fixed filesystem component without
// accepting paths from a browser. The caller additionally validates PID/unit.
func Validate(r Record, parent string, generation int64) error {
	id, err := hex.DecodeString(r.ID)
	if err != nil || len(id) != 16 || r.Protocol != Protocol || r.Generation != generation || r.State != "ready" || r.PID <= 1 || r.StartTime == "" || r.Restarts < 0 {
		return errors.New("audio domain unavailable")
	}
	if filepath.Clean(r.Root) != r.Root || filepath.Dir(r.Root) != parent || !strings.HasPrefix(filepath.Base(r.Root), "audio-") {
		return errors.New("invalid audio root")
	}
	if _, err = strconv.ParseUint(r.StartTime, 10, 64); err != nil {
		return errors.New("invalid audio process identity")
	}
	for _, part := range []string{"", "run", "state", "config", "cookie", "config/client.conf", "run/native"} {
		info, e := os.Lstat(filepath.Join(r.Root, part))
		if e != nil {
			return errors.New("audio endpoint unavailable")
		}
		st, ok := info.Sys().(*syscall.Stat_t)
		if !ok || st.Uid != uint32(os.Getuid()) || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0077 != 0 {
			return errors.New("audio endpoint ownership differs")
		}
		switch part {
		case "", "run", "state", "config":
			if !info.IsDir() {
				return errors.New("invalid audio directory")
			}
		case "run/native":
			if info.Mode()&os.ModeSocket == 0 {
				return errors.New("invalid audio socket")
			}
		default:
			if !info.Mode().IsRegular() {
				return errors.New("invalid audio file")
			}
		}
	}
	return nil
}
