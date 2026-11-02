package sessionaudio

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPrivateEnvironmentAndCleanup(t *testing.T) {
	parent := t.TempDir()
	// UNIX socket limits apply even before starting Pulse.
	short, err := os.MkdirTemp("", "rxa-domain-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(short)
	d, err := Prepare(short, 7, []string{"HOME=/account", "DBUS_SESSION_BUS_ADDRESS=unix:path=/account/bus", "PULSE_SERVER=global"})
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	env := Environment(d.Record, []string{"HOME=/account", "DBUS_SESSION_BUS_ADDRESS=unix:path=/account/bus", "PULSE_SERVER=global"})
	joined := strings.Join(env, "\n")
	if strings.Contains(joined, "global") || !strings.Contains(joined, "HOME=/account") || !strings.Contains(joined, "DBUS_SESSION_BUS_ADDRESS=unix:path=/account/bus") || strings.Count(joined, "PULSE_SERVER=") != 1 {
		t.Fatal("account environment or private routing differs")
	}
	for _, part := range []string{"cookie", "config/client.conf", "start.pa"} {
		info, e := os.Stat(filepath.Join(d.Record.Root, part))
		if e != nil || info.Mode().Perm() != 0600 {
			t.Fatalf("private file %s: %v", part, e)
		}
	}
	config, _ := os.ReadFile(filepath.Join(d.Record.Root, "config/client.conf"))
	if !strings.Contains(string(config), "autospawn = no") {
		t.Fatal("must not spawn account audio")
	}
	if _, err := Prepare(parent, 0, nil); err == nil {
		t.Fatal("accepted zero generation")
	}
	if _, err := Prepare(strings.Repeat("x", 120), 1, nil); err == nil {
		t.Fatal("accepted relative root")
	}
	root := d.Record.Root
	d.Close()
	if _, err := os.Stat(root); !os.IsNotExist(err) {
		t.Fatal("owned directory retained")
	}
}

func TestClosePreservesReplacedRoot(t *testing.T) {
	parent, err := os.MkdirTemp("", "rxa-own-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(parent)
	d, err := Prepare(parent, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	old := d.Record.Root + "-old"
	if err = os.Rename(d.Record.Root, old); err != nil {
		t.Fatal(err)
	}
	if err = os.Mkdir(d.Record.Root, 0700); err != nil {
		t.Fatal(err)
	}
	d.Close()
	if _, err = os.Stat(d.Record.Root); err != nil {
		t.Fatal("removed replacement directory")
	}
}

func TestLiveDomainRecovery(t *testing.T) {
	if os.Getenv("REMOTEXAPP_TEST_AUDIO_LIVE") != "1" {
		t.Skip("requires real PulseAudio tools and non-root UID")
	}
	if os.Getuid() == 0 {
		t.Fatal("run as non-root")
	}
	if err := CheckDependencies(); err != nil {
		t.Fatal(err)
	}
	parent, err := os.MkdirTemp("", "rxa-live-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(parent)
	d, err := Prepare(parent, 3, os.Environ())
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err = d.Start(ctx); err != nil {
		t.Fatal(err)
	}
	if err = Validate(d.Record, parent, 3); err != nil {
		t.Fatal(err)
	}
	original := d.Record
	if err = Validate(d.Record, parent, 4); err == nil {
		t.Fatal("accepted old generation")
	}
	_ = d.command.Process.Kill()
	<-d.done
	if !d.Poll(ctx) || d.Record.State != "ready" || d.Record.ID == original.ID || d.Record.Root != original.Root {
		t.Fatal("audio-only recovery did not replace identity at stable App endpoint")
	}
	if err = Validate(d.Record, parent, 3); err != nil {
		t.Fatal(err)
	}
	if d.Record.Restarts != 1 {
		t.Fatal("restart not counted")
	}
}
