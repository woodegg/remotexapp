package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestShutdownOwnerReapsDetachedDescendants(t *testing.T) {
	t.Setenv("GORACE", os.Getenv("GORACE")+" atexit_sleep_ms=0")
	for _, end := range []string{"normal", "cancel", "parent-pipe-closed"} {
		t.Run(end, func(t *testing.T) {
			root := t.TempDir()
			driver := filepath.Join(root, "hook.sh")
			// setsid + a shell grandchild exercises escape from a process group.
			body := "#!/bin/sh\nsetsid sh -c 'sleep 120 & echo $! > \"$CHILD_PID\"; wait' &\nwhile [ ! -s \"$CHILD_PID\" ]; do sleep .01; done\n"
			if end == "normal" {
				body += "exit 10\n"
			} else {
				body += "wait\n"
			}
			if err := os.WriteFile(driver, []byte(body), 0700); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			c, cleanup, err := ownedShutdownCommand(ctx, driver)
			if err != nil {
				t.Fatal(err)
			}
			defer cleanup()
			pidPath := filepath.Join(root, "child.pid")
			c.Env = append(os.Environ(), "CHILD_PID="+pidPath, "REMOTEXAPP_RUNTIME="+root)
			if err := c.Start(); err != nil {
				t.Fatal(err)
			}
			done := make(chan error, 1)
			go func() { done <- c.Wait() }()
			if err := waitFor(3*time.Second, func() bool { b, _ := os.ReadFile(pidPath); return len(b) > 0 }); err != nil {
				t.Fatal(err)
			}
			b, _ := os.ReadFile(pidPath)
			pid, err := strconv.Atoi(strings.TrimSpace(string(b)))
			if err != nil {
				t.Fatal(err)
			}
			if end == "cancel" {
				cancel()
			}
			if end == "parent-pipe-closed" {
				cleanup()
			}
			select {
			case err := <-done:
				if end == "normal" {
					e, ok := err.(*exec.ExitError)
					if !ok || e.ExitCode() != 10 {
						t.Fatalf("exit=%v", err)
					}
				}
			case <-time.After(4 * time.Second):
				t.Fatal("hook owner did not terminate")
			}
			if _, err := os.Stat(filepath.Join("/proc", strconv.Itoa(pid))); !os.IsNotExist(err) {
				t.Fatalf("descendant %d leaked: %v", pid, err)
			}
		})
	}
}

func TestShutdownOwnerSerializesAcrossManagers(t *testing.T) {
	t.Setenv("GORACE", os.Getenv("GORACE")+" atexit_sleep_ms=0")
	root := t.TempDir()
	driver := filepath.Join(root, "hook.sh")
	if err := os.WriteFile(driver, []byte("#!/bin/sh\necho entered > \"$MARKER\"\nsleep 120 & wait\n"), 0700); err != nil {
		t.Fatal(err)
	}
	start := func(marker string) (func(), <-chan error) {
		c, closePipe, err := ownedShutdownCommand(context.Background(), driver)
		if err != nil {
			t.Fatal(err)
		}
		c.Env = append(os.Environ(), "REMOTEXAPP_RUNTIME="+root, "MARKER="+filepath.Join(root, marker))
		if err := c.Start(); err != nil {
			t.Fatal(err)
		}
		done := make(chan error, 1)
		go func() { done <- c.Wait() }()
		t.Cleanup(closePipe)
		return closePipe, done
	}
	first, done1 := start("first")
	if err := waitFor(time.Second, func() bool { _, err := os.Stat(filepath.Join(root, "first")); return err == nil }); err != nil {
		t.Fatal(err)
	}
	second, done2 := start("second")
	time.Sleep(100 * time.Millisecond)
	if _, err := os.Stat(filepath.Join(root, "second")); !os.IsNotExist(err) {
		t.Fatal("concurrent hooks entered same runtime")
	}
	first() // Manager death closes pipe while a replacement Manager is waiting.
	if err := waitFor(2*time.Second, func() bool { _, err := os.Stat(filepath.Join(root, "second")); return err == nil }); err != nil {
		t.Fatal(err)
	}
	second()
	for _, done := range []<-chan error{done1, done2} {
		select {
		case <-done:
		case <-time.After(3 * time.Second):
			t.Fatal("hook owner leaked")
		}
	}
}

func TestShutdownOutputIsBoundedAndDrained(t *testing.T) {
	var output shutdownOutput
	payload := []byte(strings.Repeat("x", 1<<20))
	for n := 0; n < 3; n++ {
		if got, err := output.Write(payload); got != len(payload) || err != nil {
			t.Fatalf("write=%d %v", got, err)
		}
	}
	if output.Len() != 4096 {
		t.Fatalf("retained=%d", output.Len())
	}
}
