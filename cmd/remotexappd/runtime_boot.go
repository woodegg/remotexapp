package main

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
)

var bootIDPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

type runtimeBootIdentity struct {
	SchemaVersion int    `json:"schemaVersion"`
	RuntimeID     string `json:"runtimeId"`
	BootID        string `json:"bootId"`
}

func readSystemBootID() (string, error) {
	b, err := os.ReadFile("/proc/sys/kernel/random/boot_id")
	if err != nil {
		return "", err
	}
	id := strings.TrimSpace(string(b))
	if !bootIDPattern.MatchString(id) {
		return "", errors.New("invalid kernel boot identity")
	}
	return id, nil
}

func readRuntimeBoot(item *instance) (string, error) {
	f, err := openPrivateRegular(filepath.Join(item.Runtime, "runtime-boot.json"))
	if err != nil {
		return "", err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return "", err
	}
	owner, ok := info.Sys().(*syscall.Stat_t)
	if !ok || owner.Uid != uint32(os.Getuid()) || info.Mode().Perm() != 0600 || info.Size() > 1024 {
		return "", errors.New("unsafe runtime boot identity")
	}
	var identity runtimeBootIdentity
	d := json.NewDecoder(io.LimitReader(f, 1025))
	d.DisallowUnknownFields()
	if err := d.Decode(&identity); err != nil {
		return "", errors.New("invalid runtime boot identity")
	}
	var extra any
	if d.Decode(&extra) != io.EOF || identity.SchemaVersion != 1 || identity.RuntimeID != item.ID || !bootIDPattern.MatchString(identity.BootID) {
		return "", errors.New("invalid runtime boot identity")
	}
	return identity.BootID, nil
}

// Private sidecar: no public API or durable manifest schema change. Production
// always initializes bootID; the empty value is for existing in-memory tests.
func (m *manager) writeRuntimeBoot(item *instance) error {
	if m.bootID == "" {
		return nil
	}
	if !bootIDPattern.MatchString(m.bootID) {
		return errors.New("invalid current boot identity")
	}
	b, err := json.Marshal(runtimeBootIdentity{1, item.ID, m.bootID})
	if err != nil {
		return err
	}
	if err := writePrivateAtomic(filepath.Join(item.Runtime, "runtime-boot.json"), b); err != nil {
		return err
	}
	if err := syncDirectory(item.Runtime); err != nil {
		return err
	}
	return syncDirectory(filepath.Dir(item.Runtime))
}

func (m *manager) rememberAdoptedRuntimeBoot(item *instance) error {
	if m.bootID == "" {
		return nil
	}
	id, err := readRuntimeBoot(item)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err // Never erase malformed evidence to claim reboot protection.
	}
	if id == m.bootID {
		return nil
	}
	return m.writeRuntimeBoot(item)
}

// Enter the existing durable restart transaction before touching resources.
// A boot change is not evidence that an already failed/refusing App recovered.
func (m *manager) prepareBootRecovery(record *runtimeManifestRecord) (bool, error) {
	item := &record.Runtime
	if m.bootID == "" || record.DesiredState != "running" || !m.runtimeShouldRecover(record) ||
		(item.State != "server-ready" && item.State != "restarting") || (item.SessionState != "running" && item.SessionState != "stopped") ||
		(item.Shutdown != nil && item.Shutdown.State != "completed" && item.Shutdown.State != "cancelled") ||
		(item.Upgrade != nil && item.Upgrade.Status.Phase != "completed") {
		return false, nil
	}
	if m.recordedSessionAlive(item) {
		return false, nil // Boot metadata never authorizes replacing a live App.
	}
	id, err := readRuntimeBoot(item)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil // Old records need healthy adoption before backfill.
	}
	if err != nil {
		return false, err
	}
	if id == m.bootID {
		return false, nil
	}
	if item.SessionGeneration >= 1<<53-1 {
		return false, errors.New("session generation exhausted")
	}
	if item.State == "restarting" {
		return true, nil // Resume the already durable intent without another fence.
	}
	item.State = "restarting"
	if err := m.persistRuntime(item); err != nil {
		return false, err
	}
	return true, nil
}
