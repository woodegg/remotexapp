package main

import (
	"net"
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

func TestOwnedX11CleanupRequiresExactDeadAllocation(t *testing.T) {
	for _, scenario := range []string{"stale", "already-removed", "live-socket", "live-process", "changed-socket", "changed-lock", "symlink-lock"} {
		t.Run(scenario, func(t *testing.T) {
			root := t.TempDir()
			item := &instance{ID: "fixture-abcdef012345", Display: ":77"}
			lock, socket, err := x11Paths(root, item.Display)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.Mkdir(filepath.Dir(socket), 0700); err != nil {
				t.Fatal(err)
			}
			listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: socket, Net: "unix"})
			if err != nil {
				t.Fatal(err)
			}
			listener.SetUnlinkOnClose(false)
			defer listener.Close()
			pid := 9999999
			start := "1"
			if scenario == "live-process" {
				pid = os.Getpid()
				p, err := canonicalProcess("/proc", pid)
				if err != nil {
					t.Fatal(err)
				}
				start = p.StartTime
			}
			if err := os.WriteFile(lock, []byte(strconv.Itoa(pid)+"\n"), 0600); err != nil {
				t.Fatal(err)
			}
			l, err := x11File(lock, false)
			if err != nil {
				t.Fatal(err)
			}
			s, err := x11File(socket, true)
			if err != nil {
				t.Fatal(err)
			}
			v := &x11Ownership{SchemaVersion: 1, RuntimeID: item.ID, Display: item.Display, VNC: sessionServiceIdentity{pid, start}, Lock: l, Socket: s}
			if scenario != "live-socket" {
				_ = listener.Close()
			}
			switch scenario {
			case "already-removed":
				_ = os.Remove(lock)
				_ = os.Remove(socket)
			case "changed-socket":
				v.Socket.Inode++
			case "changed-lock":
				if err := os.WriteFile(lock, []byte("9999998\n"), 0600); err != nil {
					t.Fatal(err)
				}
			case "symlink-lock":
				_ = os.Rename(lock, lock+".original")
				if err := os.Symlink(lock+".original", lock); err != nil {
					t.Fatal(err)
				}
			}
			err = removeX11Files(root, item, v)
			wantSuccess := scenario == "stale" || scenario == "already-removed"
			if (err == nil) != wantSuccess {
				t.Fatalf("cleanup=%v", err)
			}
			for _, path := range []string{socket, lock} {
				_, err := os.Lstat(path)
				if wantSuccess {
					if !os.IsNotExist(err) {
						t.Fatalf("owned endpoint remains: %s", path)
					}
				} else if err != nil {
					t.Fatalf("refused cleanup changed endpoint: %s", path)
				}
			}
		})
	}
}

func TestX11CleanupWithoutOwnershipDoesNothing(t *testing.T) {
	item := &instance{Runtime: t.TempDir(), Display: ":77"}
	if err := removeOwnedX11(item); err != nil {
		t.Fatal(err)
	}
	for _, display := range []string{"", ":0", ":100", ":../1", ":01"} {
		if _, _, err := x11Paths(t.TempDir(), display); err == nil {
			t.Fatalf("accepted %q", display)
		}
	}
}
