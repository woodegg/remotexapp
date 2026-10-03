package main

import (
	"net"
	"os"
	"path/filepath"
	"testing"
)

func TestUserBusAddressAtChecksPrivateOwnedPath(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "runtime")
	if err := os.Mkdir(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("unix", filepath.Join(directory, "bus"))
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	// A public socket is normal when protected by the private parent.
	if err := os.Chmod(filepath.Join(directory, "bus"), 0o666); err != nil {
		t.Fatal(err)
	}
	if _, err := userBusAddressAt(directory, os.Getuid()); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(directory, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := userBusAddressAt(directory, os.Getuid()); err == nil {
		t.Fatal("accepted public account runtime directory")
	}
	if err := os.Chmod(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := userBusAddressAt(directory, os.Getuid()+1); err == nil {
		t.Fatal("accepted another account's runtime directory")
	}
}
