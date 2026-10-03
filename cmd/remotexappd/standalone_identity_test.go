package main

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

func TestRemoveOwnedEmptyCgroupReclaimsOnlyExactLeaf(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "remotexapp-fixture-vnc.service")
	if err := os.Mkdir(path, 0o700); err != nil {
		t.Fatal(err)
	}
	info, err := os.Lstat(path)
	if err != nil {
		t.Fatal(err)
	}
	inode := info.Sys().(*syscall.Stat_t).Ino
	populated := func(string) (bool, error) { return false, nil }
	if err := removeOwnedEmptyCgroup(path, inode, os.Getuid()+1, populated); err == nil {
		t.Fatal("removed a foreign-owned component cgroup")
	}
	if err := removeOwnedEmptyCgroup(path, inode+1, os.Getuid(), populated); err == nil {
		t.Fatal("removed a replaced component cgroup")
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal("identity mismatch changed cgroup:", err)
	}
	if err := removeOwnedEmptyCgroup(path, inode, os.Getuid(), func(string) (bool, error) { return true, nil }); err == nil {
		t.Fatal("removed a populated component cgroup")
	}
	if err := removeOwnedEmptyCgroup(path, inode, os.Getuid(), populated); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("empty component cgroup remains: %v", err)
	}
}

func TestStandaloneIdentityPinsCgroupInodeAndBoot(t *testing.T) {
	state := t.TempDir()
	group := filepath.Join(t.TempDir(), "delegate")
	unit := "remotexapp-fixture-vnc.service"
	if err := os.MkdirAll(filepath.Join(group, unit), 0o700); err != nil {
		t.Fatal(err)
	}
	m := &manager{cfg: config{stateDir: state}, bootID: "boot-one", standalone: &standaloneCgroupRoot{path: group, uid: os.Getuid()}}
	if err := m.persistStandaloneIdentity(unit, 12345, "45678"); err != nil {
		t.Fatal(err)
	}
	identity, err := m.readStandaloneIdentity(unit)
	if err != nil || identity.PID != 12345 || identity.StartTime != "45678" {
		t.Fatalf("identity=%+v err=%v", identity, err)
	}
	m.bootID = "boot-two"
	if _, err := m.readStandaloneIdentity(unit); err == nil {
		t.Fatal("accepted identity from a prior boot")
	}
	m.bootID = "boot-one"
	if err := os.Remove(filepath.Join(group, unit)); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(group, "inode-occupier"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(group, unit), 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := m.readStandaloneIdentity(unit); err == nil {
		t.Fatal("accepted replaced component cgroup")
	}
}

func TestStandaloneLaunchIntentIsNotAnActiveComponent(t *testing.T) {
	group := filepath.Join(t.TempDir(), "delegate")
	unit := "remotexapp-fixture-session.service"
	if err := os.MkdirAll(filepath.Join(group, unit), 0o700); err != nil {
		t.Fatal(err)
	}
	m := &manager{cfg: config{stateDir: t.TempDir()}, bootID: "boot-one", standalone: &standaloneCgroupRoot{path: group, uid: os.Getuid()}}
	if err := m.persistStandaloneIdentity(unit, 0, ""); err != nil {
		t.Fatal(err)
	}
	identity, err := m.readStandaloneIdentity(unit)
	if err != nil || identity.PID != 0 || identity.CgroupInode == 0 {
		t.Fatalf("launch intent=%+v err=%v", identity, err)
	}
	if m.standaloneComponentActive(unit) {
		t.Fatal("uncommitted launch intent was treated as an active component")
	}
	if err := m.persistStandaloneIdentity(unit, 1, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := m.readStandaloneIdentity(unit); err == nil {
		t.Fatal("accepted invalid finalized component identity")
	}
}

func TestReconcileStandaloneLaunchIntentRetiresEmptyInterruptedComponent(t *testing.T) {
	group := filepath.Join(t.TempDir(), "delegate")
	unit := "remotexapp-interrupted-vnc.service"
	component := filepath.Join(group, unit)
	if err := os.MkdirAll(component, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(component, "cgroup.events"), []byte("populated 0\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(component, "cgroup.procs"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	m := &manager{cfg: config{stateDir: t.TempDir()}, bootID: "boot-one", standalone: &standaloneCgroupRoot{path: group, uid: os.Getuid()}}
	if err := m.persistStandaloneIdentity(unit, 0, ""); err != nil {
		t.Fatal(err)
	}
	if err := m.reconcileStandaloneLaunchIntents(); err != nil {
		t.Fatal(err)
	}
	path, err := m.standaloneIdentityPath(unit)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("interrupted launch intent remains: %v", err)
	}
}

func TestReconcileStandaloneEmptyComponentsPreservesLiveIdentity(t *testing.T) {
	group := filepath.Join(t.TempDir(), "delegate")
	if err := os.MkdirAll(group, 0o700); err != nil {
		t.Fatal(err)
	}
	m := &manager{cfg: config{stateDir: t.TempDir()}, bootID: "boot-one", standalone: &standaloneCgroupRoot{path: group, uid: os.Getuid()}}
	for _, fixture := range []struct {
		unit      string
		populated bool
	}{
		{"remotexapp-stopped-vnc.service", false},
		{"remotexapp-running-vnc.service", true},
	} {
		path := filepath.Join(group, fixture.unit)
		if err := os.Mkdir(path, 0o700); err != nil {
			t.Fatal(err)
		}
		value := "populated 0\n"
		if fixture.populated {
			value = "populated 1\n"
		}
		if err := os.WriteFile(filepath.Join(path, "cgroup.events"), []byte(value), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(path, "cgroup.procs"), nil, 0o600); err != nil {
			t.Fatal(err)
		}
		if err := m.persistStandaloneIdentity(fixture.unit, 0, ""); err != nil {
			t.Fatal(err)
		}
	}
	if err := m.reconcileStandaloneEmptyComponents(); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range []struct {
		unit      string
		populated bool
	}{
		{"remotexapp-stopped-vnc.service", false},
		{"remotexapp-running-vnc.service", true},
	} {
		path, err := m.standaloneIdentityPath(fixture.unit)
		if err != nil {
			t.Fatal(err)
		}
		_, err = os.Stat(path)
		if fixture.populated && err != nil || !fixture.populated && !os.IsNotExist(err) {
			t.Fatalf("identity for %s: %v", fixture.unit, err)
		}
	}
}

func TestStandaloneMembershipRequiresExactDelegatedPath(t *testing.T) {
	proc := t.TempDir()
	pidDir := filepath.Join(proc, "123")
	if err := os.Mkdir(pidDir, 0o700); err != nil {
		t.Fatal(err)
	}
	path := "/sys/fs/cgroup/agent/ours/remotexapp-fixture-vnc.service"
	for _, tc := range []struct {
		membership string
		want       bool
	}{
		{"0::/agent/ours/remotexapp-fixture-vnc.service\n", true},
		{"0::/agent/ours/remotexapp-fixture-vnc.service/child\n", true},
		{"0::/agent/foreign/remotexapp-fixture-vnc.service\n", false},
		{"0::/agent/ours/remotexapp-fixture-vnc.service-foreign\n", false},
	} {
		if err := os.WriteFile(filepath.Join(pidDir, "cgroup"), []byte(tc.membership), 0o600); err != nil {
			t.Fatal(err)
		}
		got, err := processBelongsToStandaloneCgroup(proc, 123, path)
		if err != nil || got != tc.want {
			t.Fatalf("membership %q: got=%v err=%v want=%v", tc.membership, got, err, tc.want)
		}
	}
}

func TestStandaloneCanonicalMembershipRejectsForeignMatchingUnit(t *testing.T) {
	proc := t.TempDir()
	pidDir := filepath.Join(proc, "123")
	if err := os.Mkdir(pidDir, 0o700); err != nil {
		t.Fatal(err)
	}
	unit := "remotexapp-fixture-session.service"
	m := &manager{standalone: &standaloneCgroupRoot{path: "/sys/fs/cgroup/agent/ours", uid: os.Getuid()}}
	if err := os.WriteFile(filepath.Join(pidDir, "cgroup"), []byte("0::/agent/foreign/"+unit+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := m.confirmStandaloneCgroupMembership(proc, 123, unit); err == nil {
		t.Fatal("accepted a matching unit name in a foreign delegated subtree")
	}
	if err := os.WriteFile(filepath.Join(pidDir, "cgroup"), []byte("0::/agent/ours/"+unit+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := m.confirmStandaloneCgroupMembership(proc, 123, unit); err != nil {
		t.Fatal(err)
	}
}
