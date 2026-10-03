// remotexapp-operator-helper performs the one user-service action that the
// RemoteXApp operator console cannot safely perform inside the manager process.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const maxRequestBytes = 4096

var operationIDPattern = regexp.MustCompile(`^operator-[a-f0-9]{24}$`)

type request struct {
	Action      string `json:"action"`
	OperationID string `json:"operationId,omitempty"`
	Actor       string `json:"actor,omitempty"`
}

type operation struct {
	ID          string     `json:"id"`
	Action      string     `json:"action"`
	State       string     `json:"state"`
	RequestedAt time.Time  `json:"requestedAt"`
	StartedAt   *time.Time `json:"startedAt,omitempty"`
	FinishedAt  *time.Time `json:"finishedAt,omitempty"`
	Error       string     `json:"error,omitempty"`
}

type response struct {
	Status    string     `json:"status,omitempty"`
	Operation *operation `json:"operation,omitempty"`
	Error     string     `json:"error,omitempty"`
}

type helper struct {
	unit          string
	minimum       time.Duration
	restartDelay  time.Duration
	restart       func(context.Context, string) error
	mu            sync.Mutex
	lastAccepted  time.Time
	operations    map[string]*operation
	operationFIFO []string
}

func main() {
	defaultSocket := filepath.Join("/run/user", strconv.Itoa(os.Getuid()), "remotexapp", "operator.sock")
	var socketPath, unit string
	var minimum, restartDelay time.Duration
	flag.StringVar(&socketPath, "socket", defaultSocket, "owner-only Unix control socket")
	flag.StringVar(&unit, "unit", "remotexapp.service", "exact user service allowed to restart")
	flag.DurationVar(&minimum, "minimum-interval", 30*time.Second, "minimum interval between accepted restarts")
	flag.DurationVar(&restartDelay, "restart-delay", 500*time.Millisecond, "delay before restarting the manager")
	flag.Parse()

	if os.Getuid() == 0 {
		log.Fatal("operator helper must not run as root")
	}
	if unit != "remotexapp.service" {
		log.Fatalf("unsupported service allowlist entry %q", unit)
	}
	if !filepath.IsAbs(socketPath) || minimum < time.Second || restartDelay < 100*time.Millisecond {
		log.Fatal("operator socket must be absolute, minimum interval at least 1s, and restart delay at least 100ms")
	}
	if err := prepareSocketParent(socketPath); err != nil {
		log.Fatal(err)
	}
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		log.Fatal(err)
	}
	defer func() {
		_ = listener.Close()
		_ = os.Remove(socketPath)
	}()
	if err := os.Chmod(socketPath, 0o600); err != nil {
		log.Fatal(err)
	}

	h := &helper{
		unit: unit, minimum: minimum, restartDelay: restartDelay,
		operations: make(map[string]*operation), restart: restartUserService,
	}
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	go func() {
		<-ctx.Done()
		_ = listener.Close()
	}()
	log.Printf("RemoteXApp operator helper listening on %s; allowlist=%s", socketPath, unit)
	for {
		connection, err := listener.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			log.Printf("accept operator request: %v", err)
			continue
		}
		go h.serve(connection)
	}
}

func prepareSocketParent(socketPath string) error {
	parent := filepath.Dir(socketPath)
	if err := os.MkdirAll(parent, 0o700); err != nil {
		return err
	}
	info, err := os.Stat(parent)
	if err != nil {
		return err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !info.IsDir() || info.Mode().Perm() != 0o700 || !ok || int(stat.Uid) != os.Getuid() {
		return fmt.Errorf("operator socket directory must be owned by uid %d and mode 0700", os.Getuid())
	}
	if info, err := os.Lstat(socketPath); err == nil {
		stat, ok := info.Sys().(*syscall.Stat_t)
		if info.Mode()&os.ModeSocket == 0 || !ok || int(stat.Uid) != os.Getuid() {
			return errors.New("refusing to replace unsafe operator socket path")
		}
		if err := os.Remove(socketPath); err != nil {
			return err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func (h *helper) serve(connection net.Conn) {
	defer connection.Close()
	if err := verifyPeerUID(connection, os.Getuid()); err != nil {
		_ = json.NewEncoder(connection).Encode(response{Error: err.Error()})
		return
	}
	_ = connection.SetDeadline(time.Now().Add(5 * time.Second))
	decoder := json.NewDecoder(io.LimitReader(bufio.NewReader(connection), maxRequestBytes))
	decoder.DisallowUnknownFields()
	var value request
	if err := decoder.Decode(&value); err != nil {
		_ = json.NewEncoder(connection).Encode(response{Error: "invalid request: " + err.Error()})
		return
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		_ = json.NewEncoder(connection).Encode(response{Error: "request must contain exactly one JSON object"})
		return
	}
	result := h.handle(value)
	_ = json.NewEncoder(connection).Encode(result)
}

func (h *helper) handle(value request) response {
	switch value.Action {
	case "ping":
		if value.OperationID != "" || value.Actor != "" {
			return response{Error: "ping accepts no additional fields"}
		}
		return response{Status: "ok"}
	case "status":
		if !operationIDPattern.MatchString(value.OperationID) || value.Actor != "" {
			return response{Error: "status requires one valid operationId"}
		}
		h.mu.Lock()
		defer h.mu.Unlock()
		item := h.operations[value.OperationID]
		if item == nil {
			return response{Error: "operator operation not found"}
		}
		copy := *item
		return response{Operation: &copy}
	case "restart-manager":
		if !operationIDPattern.MatchString(value.OperationID) || !validActor(value.Actor) {
			return response{Error: "restart-manager requires a valid operationId and actor"}
		}
		return h.acceptRestart(value)
	default:
		return response{Error: "unsupported operator action"}
	}
}

func (h *helper) acceptRestart(value request) response {
	h.mu.Lock()
	if existing := h.operations[value.OperationID]; existing != nil {
		copy := *existing
		h.mu.Unlock()
		return response{Operation: &copy}
	}
	now := time.Now().UTC()
	if !h.lastAccepted.IsZero() && now.Sub(h.lastAccepted) < h.minimum {
		retry := h.minimum - now.Sub(h.lastAccepted)
		h.mu.Unlock()
		return response{Error: fmt.Sprintf("service restart rate limit; retry after %s", retry.Round(time.Second))}
	}
	item := &operation{ID: value.OperationID, Action: value.Action, State: "accepted", RequestedAt: now}
	h.operations[item.ID] = item
	h.operationFIFO = append(h.operationFIFO, item.ID)
	for len(h.operationFIFO) > 128 {
		delete(h.operations, h.operationFIFO[0])
		h.operationFIFO = h.operationFIFO[1:]
	}
	h.lastAccepted = now
	copy := *item
	h.mu.Unlock()
	log.Printf("operator action accepted id=%s actor=%q action=restart-manager", item.ID, value.Actor)
	go h.runRestart(item.ID)
	return response{Operation: &copy}
}

func (h *helper) runRestart(id string) {
	time.Sleep(h.restartDelay)
	started := time.Now().UTC()
	h.mu.Lock()
	item := h.operations[id]
	if item == nil {
		h.mu.Unlock()
		return
	}
	item.State, item.StartedAt = "running", &started
	h.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	err := h.restart(ctx, h.unit)
	cancel()
	finished := time.Now().UTC()
	h.mu.Lock()
	item = h.operations[id]
	if item != nil {
		item.FinishedAt = &finished
		if err == nil {
			item.State = "succeeded"
		} else {
			item.State = "failed"
			item.Error = boundedError(err)
		}
	}
	h.mu.Unlock()
	if err != nil {
		log.Printf("operator action failed id=%s action=restart-manager error=%q", id, boundedError(err))
	} else {
		log.Printf("operator action completed id=%s action=restart-manager", id)
	}
}

func restartUserService(ctx context.Context, unit string) error {
	command := exec.CommandContext(ctx, "systemctl", "--user", "restart", unit)
	uid := strconv.Itoa(os.Getuid())
	command.Env = append(os.Environ(), "XDG_RUNTIME_DIR=/run/user/"+uid, "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/"+uid+"/bus")
	output, err := command.CombinedOutput()
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if err != nil {
		message := strings.TrimSpace(string(output))
		if message == "" {
			message = err.Error()
		}
		return errors.New(message)
	}
	return nil
}

func verifyPeerUID(connection net.Conn, expected int) error {
	unixConnection, ok := connection.(*net.UnixConn)
	if !ok {
		return errors.New("operator helper accepts only Unix connections")
	}
	raw, err := unixConnection.SyscallConn()
	if err != nil {
		return err
	}
	var credential *syscall.Ucred
	var socketError error
	if err := raw.Control(func(fd uintptr) {
		credential, socketError = syscall.GetsockoptUcred(int(fd), syscall.SOL_SOCKET, syscall.SO_PEERCRED)
	}); err != nil {
		return err
	}
	if socketError != nil {
		return socketError
	}
	if credential == nil || int(credential.Uid) != expected {
		return errors.New("operator helper rejected a different Unix uid")
	}
	return nil
}

func validActor(actor string) bool {
	if len(actor) < 1 || len(actor) > 512 {
		return false
	}
	for _, character := range actor {
		if character < 0x20 || character == 0x7f {
			return false
		}
	}
	return true
}

func boundedError(err error) string {
	if err == nil {
		return ""
	}
	message := err.Error()
	if len(message) > 1024 {
		message = message[:1024]
	}
	return message
}
