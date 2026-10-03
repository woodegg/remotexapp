package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

type standaloneComponentIdentity struct {
	SchemaVersion int    `json:"schemaVersion"`
	Unit          string `json:"unit"`
	BootID        string `json:"bootId"`
	UID           int    `json:"uid"`
	PID           int    `json:"pid"`
	StartTime     string `json:"startTime"`
	CgroupInode   uint64 `json:"cgroupInode"`
}

func (m *manager) standaloneIdentityDir() string {
	return filepath.Join(m.cfg.stateDir, "standalone-components")
}

func (m *manager) standaloneIdentityPath(unit string) (string, error) {
	if _, err := m.standalone.componentPath(unit); err != nil {
		return "", err
	}
	return filepath.Join(m.standaloneIdentityDir(), unit+".json"), nil
}

func (m *manager) persistStandaloneIdentity(unit string, pid int, startTime string) error {
	path, err := m.standaloneIdentityPath(unit)
	if err != nil {
		return err
	}
	cgroupPath, _ := m.standalone.componentPath(unit)
	info, err := os.Stat(cgroupPath)
	if err != nil {
		return err
	}
	owner, ok := info.Sys().(*syscall.Stat_t)
	if !ok || owner.Uid != uint32(os.Getuid()) || owner.Ino == 0 {
		return errors.New("component cgroup identity is unavailable")
	}
	record := standaloneComponentIdentity{SchemaVersion: 1, Unit: unit, BootID: m.bootID, UID: os.Getuid(), PID: pid, StartTime: startTime, CgroupInode: owner.Ino}
	payload, err := json.Marshal(record)
	if err != nil {
		return err
	}
	directory := m.standaloneIdentityDir()
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return err
	}
	file, err := os.CreateTemp(directory, ".component-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if err := file.Chmod(0o600); err != nil {
		_ = file.Close()
		return err
	}
	if _, err := file.Write(append(payload, '\n')); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := os.Rename(file.Name(), path); err != nil {
		return err
	}
	return syncDirectory(directory)
}

func (m *manager) readStandaloneIdentity(unit string) (standaloneComponentIdentity, error) {
	path, err := m.standaloneIdentityPath(unit)
	if err != nil {
		return standaloneComponentIdentity{}, err
	}
	file, err := openPrivateRegular(path)
	if err != nil {
		return standaloneComponentIdentity{}, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return standaloneComponentIdentity{}, err
	}
	owner, ok := info.Sys().(*syscall.Stat_t)
	if !ok || owner.Uid != uint32(os.Getuid()) || info.Mode().Perm() != 0o600 || info.Size() > 2048 {
		return standaloneComponentIdentity{}, errors.New("unsafe standalone component identity record")
	}
	var record standaloneComponentIdentity
	decoder := json.NewDecoder(io.LimitReader(file, 2048))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&record); err != nil {
		return standaloneComponentIdentity{}, err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return standaloneComponentIdentity{}, errors.New("standalone component identity has trailing data")
	}
	if record.SchemaVersion != 1 || record.Unit != unit || record.BootID != m.bootID || record.UID != os.Getuid() || record.CgroupInode == 0 || (record.PID == 0 && record.StartTime != "") || (record.PID != 0 && (record.PID <= 1 || record.StartTime == "")) {
		return standaloneComponentIdentity{}, errors.New("standalone component identity mismatch")
	}
	cgroupPath, _ := m.standalone.componentPath(unit)
	group, err := os.Stat(cgroupPath)
	if err != nil {
		return standaloneComponentIdentity{}, err
	}
	groupOwner, ok := group.Sys().(*syscall.Stat_t)
	if !ok || groupOwner.Uid != uint32(record.UID) || groupOwner.Ino != record.CgroupInode {
		return standaloneComponentIdentity{}, errors.New("standalone component cgroup changed")
	}
	return record, nil
}

func (m *manager) standaloneComponentActive(unit string) bool {
	if !m.standalone.active(unit) {
		return false
	}
	record, err := m.readStandaloneIdentity(unit)
	if err != nil || record.PID == 0 {
		return false
	}
	identity, err := canonicalProcess("/proc", record.PID)
	if err != nil || identity.UID != uint32(record.UID) || identity.StartTime != record.StartTime {
		return false
	}
	cgroupPath, _ := m.standalone.componentPath(unit)
	belongs, err := processBelongsToStandaloneCgroup("/proc", record.PID, cgroupPath)
	return err == nil && belongs
}

// A launch intent is written before the component is spawned. If Manager
// exits before it can durably record the PID, the cgroup inode still proves
// which tree belongs to that attempt. Retire that tree before restoring
// runtime manifests; never adopt it based on an unrecorded PID.
func (m *manager) reconcileStandaloneLaunchIntents() error {
	if m.standalone == nil {
		return nil
	}
	entries, err := os.ReadDir(m.standaloneIdentityDir())
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		unit := entry.Name()[:len(entry.Name())-len(".json")]
		if _, err := m.standalone.componentPath(unit); err != nil {
			continue
		}
		record, err := m.readStandaloneIdentity(unit)
		if err != nil || record.PID != 0 {
			continue
		}
		if err := m.stopStandaloneComponent(unit); err != nil {
			return fmt.Errorf("retire interrupted component launch %s: %w", unit, err)
		}
	}
	return nil
}

// Reclaim empty component leaves left by an earlier Manager, including older
// standalone builds that stopped processes but did not remove their cgroups.
// Never touch a populated leaf: runtime adoption must decide its fate using
// the durable component identity and runtime manifest.
func (m *manager) reconcileStandaloneEmptyComponents() error {
	if m.standalone == nil {
		return nil
	}
	entries, err := os.ReadDir(m.standalone.path)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		unit := entry.Name()
		if _, err := m.standalone.componentPath(unit); err != nil || !entry.IsDir() {
			continue
		}
		live, err := m.standalone.populated(unit)
		if err != nil {
			return fmt.Errorf("inspect standalone component %s: %w", unit, err)
		}
		if !live {
			if err := m.stopStandaloneComponent(unit); err != nil {
				return fmt.Errorf("reclaim empty standalone component %s: %w", unit, err)
			}
		}
	}
	return nil
}

func (m *manager) stopStandaloneComponent(unit string) error {
	record, identityErr := m.readStandaloneIdentity(unit)
	if identityErr != nil && m.standalone.active(unit) {
		return fmt.Errorf("refuse to kill populated component without verified identity: %w", identityErr)
	}
	pid, started := 0, ""
	if identityErr == nil {
		pid, started = record.PID, record.StartTime
	}
	if err := m.standalone.stop(unit, pid, started, 10*time.Second); err != nil {
		return err
	}
	path, err := m.standaloneIdentityPath(unit)
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove component identity: %w", err)
	}
	if _, err := os.Stat(m.standaloneIdentityDir()); err == nil {
		return syncDirectory(m.standaloneIdentityDir())
	}
	return nil
}
