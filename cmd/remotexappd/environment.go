package main

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"unicode/utf8"
)

const applicationEnvironmentLimit = 128 << 10

type applicationEnvironmentRequest struct {
	SessionGeneration int64 `json:"sessionGeneration"`
}

type applicationEnvironmentResponse struct {
	InstanceID        string            `json:"instanceId"`
	SessionGeneration int64             `json:"sessionGeneration"`
	ApplicationState  string            `json:"applicationState"`
	Environment       map[string]string `json:"environment"`
	WorkingDirectory  string            `json:"workingDirectory"`
}

type applicationEnvironmentError struct {
	Status  int
	Message string
}

func (err *applicationEnvironmentError) Error() string { return err.Message }

func environmentError(status int, message string) error {
	return &applicationEnvironmentError{Status: status, Message: message}
}

func (m *manager) applicationEnvironment(id string, generation int64) (*applicationEnvironmentResponse, error) {
	if generation < 1 {
		return nil, environmentError(http.StatusBadRequest, "sessionGeneration must be a positive integer")
	}
	if (m.cfg.authMode == "" || m.cfg.authMode == "none") && !listenIsLoopback(m.cfg.listen) && !m.cfg.allowInsecure {
		return nil, environmentError(http.StatusForbidden, "application environment lookup requires an authenticated or loopback manager endpoint unless allow-insecure-public is enabled")
	}
	if os.Getuid() == 0 {
		return nil, environmentError(http.StatusServiceUnavailable, "application environment lookup is unavailable to UID 0")
	}

	// Environment reads are short and lifecycle-sensitive. Holding lifecycleMu
	// prevents a manager-initiated stop or new generation from crossing the
	// canonical-process checks below. The driver can still exit independently,
	// so PID, cgroup, status and generation are all checked again before return.
	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()

	item := m.get(id)
	if item == nil {
		return nil, environmentError(http.StatusNotFound, "instance not found")
	}
	class := m.specFor(item)
	if class.Session.Status.Mode != "driver" {
		return nil, environmentError(http.StatusNotFound, "template does not provide application status")
	}
	if item.SessionGeneration != generation {
		return nil, environmentError(http.StatusConflict, "session generation does not match the current instance")
	}
	if item.State != "server-ready" || item.SessionState != "running" {
		return nil, environmentError(http.StatusConflict, "application session is not running")
	}
	status, err := readyApplicationStatus(item, generation)
	if err != nil {
		return nil, err
	}

	pidPath := filepath.Join(item.Runtime, class.Session.ReadinessPID)
	pid, err := readCanonicalPID(pidPath)
	if err != nil {
		return nil, environmentError(http.StatusConflict, "canonical application process is unavailable")
	}
	procRoot := m.canonicalProcRoot()
	identity, err := m.inspectCanonicalProcess(procRoot, pid, item.SessionUnit)
	if err != nil {
		return nil, err
	}

	rawEnvironment, err := readLimitedFile(procPath(procRoot, pid, "environ"), applicationEnvironmentLimit)
	if err != nil {
		if errors.Is(err, errReadLimitExceeded) {
			return nil, environmentError(http.StatusRequestEntityTooLarge, "application environment exceeds the response limit")
		}
		return nil, environmentError(http.StatusConflict, "canonical application environment is unavailable")
	}
	environment, err := parseApplicationEnvironment(rawEnvironment)
	if err != nil {
		return nil, environmentError(http.StatusUnprocessableEntity, "application environment cannot be represented losslessly")
	}
	workingDirectory, err := os.Readlink(procPath(procRoot, pid, "cwd"))
	if err != nil || !filepath.IsAbs(workingDirectory) || !utf8.ValidString(workingDirectory) {
		return nil, environmentError(http.StatusConflict, "canonical application working directory is unavailable")
	}

	confirmedPID, err := readCanonicalPID(pidPath)
	if err != nil || confirmedPID != pid {
		return nil, environmentError(http.StatusConflict, "canonical application process changed during environment lookup")
	}
	if err := m.confirmCanonicalProcess(procRoot, pid, item.SessionUnit, identity); err != nil {
		return nil, err
	}
	confirmed := m.get(id)
	if confirmed == nil || confirmed.SessionGeneration != generation || confirmed.SessionState != "running" || confirmed.State != "server-ready" {
		return nil, environmentError(http.StatusConflict, "application session changed during environment lookup")
	}
	if _, err := readyApplicationStatus(confirmed, generation); err != nil {
		return nil, environmentError(http.StatusConflict, "application state changed during environment lookup")
	}

	return &applicationEnvironmentResponse{
		InstanceID: id, SessionGeneration: generation, ApplicationState: status.State,
		Environment: environment, WorkingDirectory: workingDirectory,
	}, nil
}

func readyApplicationStatus(item *instance, generation int64) (*applicationStatus, error) {
	status, err := readApplicationStatus(item.Runtime)
	if err != nil || status.Generation != generation || status.State != "ready" {
		return nil, environmentError(http.StatusConflict, "application is not ready in the requested session generation")
	}
	return status, nil
}

func readCanonicalPID(path string) (int, error) {
	payload, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(payload)))
	if err != nil || pid <= 1 {
		return 0, errors.New("invalid canonical process PID")
	}
	return pid, nil
}

type canonicalProcessIdentity struct {
	StartTime string
	UID       uint32
}

func inspectCanonicalProcess(procRoot string, pid int, unit string) (canonicalProcessIdentity, error) {
	identity, err := canonicalProcess(procRoot, pid)
	if err != nil {
		return identity, environmentError(http.StatusConflict, "canonical application process is unavailable")
	}
	if identity.UID == 0 || int(identity.UID) != os.Getuid() {
		return identity, environmentError(http.StatusConflict, "canonical application process has an invalid runtime UID")
	}
	inUnit, err := processBelongsToUnit(procRoot, pid, unit)
	if err != nil || !inUnit {
		return identity, environmentError(http.StatusConflict, "canonical application process is outside the session cgroup")
	}
	return identity, nil
}

func (m *manager) inspectCanonicalProcess(procRoot string, pid int, unit string) (canonicalProcessIdentity, error) {
	identity, err := inspectCanonicalProcess(procRoot, pid, unit)
	if err != nil {
		return identity, err
	}
	if err := m.confirmStandaloneCgroupMembership(procRoot, pid, unit); err != nil {
		return identity, err
	}
	return identity, nil
}

func (m *manager) confirmCanonicalProcess(procRoot string, pid int, unit string, expected canonicalProcessIdentity) error {
	if err := confirmCanonicalProcess(procRoot, pid, unit, expected); err != nil {
		return err
	}
	return m.confirmStandaloneCgroupMembership(procRoot, pid, unit)
}

func (m *manager) confirmStandaloneCgroupMembership(procRoot string, pid int, unit string) error {
	if m.standalone == nil {
		return nil
	}
	path, err := m.standalone.componentPath(unit)
	if err != nil {
		return environmentError(http.StatusConflict, "invalid standalone session cgroup")
	}
	belongs, err := processBelongsToStandaloneCgroup(procRoot, pid, path)
	if err != nil || !belongs {
		return environmentError(http.StatusConflict, "canonical application process is outside the delegated session cgroup")
	}
	return nil
}

func confirmCanonicalProcess(procRoot string, pid int, unit string, expected canonicalProcessIdentity) error {
	actual, err := canonicalProcess(procRoot, pid)
	if err != nil || actual != expected {
		return environmentError(http.StatusConflict, "canonical application process changed during environment lookup")
	}
	inUnit, err := processBelongsToUnit(procRoot, pid, unit)
	if err != nil || !inUnit {
		return environmentError(http.StatusConflict, "canonical application process left the session cgroup")
	}
	return nil
}

func canonicalProcess(procRoot string, pid int) (canonicalProcessIdentity, error) {
	info, err := os.Stat(procPath(procRoot, pid, ""))
	if err != nil {
		return canonicalProcessIdentity{}, err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return canonicalProcessIdentity{}, errors.New("process ownership is unavailable")
	}
	payload, err := os.ReadFile(procPath(procRoot, pid, "stat"))
	if err != nil {
		return canonicalProcessIdentity{}, err
	}
	closing := bytes.LastIndexByte(payload, ')')
	if closing < 0 {
		return canonicalProcessIdentity{}, errors.New("invalid process stat")
	}
	fields := strings.Fields(string(payload[closing+1:]))
	// fields starts at proc stat field 3; starttime is field 22.
	if len(fields) <= 19 {
		return canonicalProcessIdentity{}, errors.New("process stat has no start time")
	}
	if fields[0] == "Z" || fields[0] == "X" {
		return canonicalProcessIdentity{}, errors.New("process has exited")
	}
	if _, err := strconv.ParseUint(fields[19], 10, 64); err != nil {
		return canonicalProcessIdentity{}, errors.New("invalid process start time")
	}
	return canonicalProcessIdentity{StartTime: fields[19], UID: stat.Uid}, nil
}

func processBelongsToUnit(procRoot string, pid int, unit string) (bool, error) {
	if unit == "" || filepath.Base(unit) != unit {
		return false, errors.New("invalid session unit")
	}
	payload, err := os.ReadFile(procPath(procRoot, pid, "cgroup"))
	if err != nil {
		return false, err
	}
	for _, line := range strings.Split(strings.TrimSpace(string(payload)), "\n") {
		parts := strings.SplitN(line, ":", 3)
		if len(parts) != 3 {
			continue
		}
		for _, segment := range strings.Split(filepath.Clean(parts[2]), string(filepath.Separator)) {
			if segment == unit {
				return true, nil
			}
		}
	}
	return false, nil
}

func (m *manager) canonicalProcRoot() string {
	if m.environmentProcRoot != "" {
		return m.environmentProcRoot
	}
	return "/proc"
}

func procPath(procRoot string, pid int, name string) string {
	root := filepath.Join(procRoot, strconv.Itoa(pid))
	if name == "" {
		return root
	}
	return filepath.Join(root, name)
}

var errReadLimitExceeded = errors.New("read limit exceeded")

func readLimitedFile(path string, limit int64) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	payload, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(payload)) > limit {
		return nil, errReadLimitExceeded
	}
	return payload, nil
}

func parseApplicationEnvironment(payload []byte) (map[string]string, error) {
	environment := make(map[string]string)
	for len(payload) > 0 {
		entry := payload
		if index := bytes.IndexByte(payload, 0); index >= 0 {
			entry, payload = payload[:index], payload[index+1:]
		} else {
			payload = nil
		}
		if len(entry) == 0 {
			continue
		}
		separator := bytes.IndexByte(entry, '=')
		if separator <= 0 || !utf8.Valid(entry) {
			return nil, errors.New("invalid environment entry")
		}
		name, value := string(entry[:separator]), string(entry[separator+1:])
		if _, duplicate := environment[name]; duplicate {
			return nil, fmt.Errorf("duplicate environment variable %q", name)
		}
		environment[name] = value
	}
	return environment, nil
}
