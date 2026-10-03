package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/jezek/xgb/xproto"
)

func TestXClipboardBridgeNormalXFixesAndINCR(t *testing.T) {
	if testing.Short() {
		t.Skip("requires local Xvfb and xclip")
	}
	for _, binary := range []string{"Xvfb", "xclip"} {
		if _, err := exec.LookPath(binary); err != nil {
			t.Skipf("%s is unavailable", binary)
		}
	}
	display := startTestXvfb(t)
	t.Setenv("DISPLAY", display)
	t.Setenv("XAUTHORITY", "")

	remote := make(chan []clipboardItem, 4)
	bridgeValue, err := newXClipboardBridge(display, func(items []clipboardItem, _ string) { remote <- items })
	if err != nil {
		t.Fatal(err)
	}
	bridge := bridgeValue.(*xClipboardBridge)
	bridge.SetMonitoring(true)
	t.Cleanup(func() { _ = bridge.Close() })

	for _, test := range []struct {
		name string
		data []byte
	}{
		{"normal", []byte("RemoteXApp clipboard normal 你好")},
		{"incr", bytes.Repeat([]byte("large-clipboard-"), 24_000)},
	} {
		t.Run("to-remote-"+test.name, func(t *testing.T) {
			if err := bridge.Set([]clipboardItem{{Type: "text/plain", Data: test.data}}, func(string, error) {}); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			command := exec.CommandContext(ctx, "xclip", "-selection", "clipboard", "-target", "UTF8_STRING", "-out")
			command.Env = xDisplayEnvironment(display)
			output, err := command.Output()
			if err != nil {
				t.Fatalf("xclip read: %v", err)
			}
			if !bytes.Equal(output, test.data) {
				t.Fatalf("read %d bytes, want %d", len(output), len(test.data))
			}
		})
	}

	bridge.Clear()
	owner, err := xproto.GetSelectionOwner(bridge.conn, bridge.atoms.clipboard).Reply()
	if err != nil {
		t.Fatal(err)
	}
	if owner.Owner != bridge.emptyWindow {
		t.Fatalf("cleared clipboard owner = %#x, want empty bridge owner %#x", owner.Owner, bridge.emptyWindow)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	clearedRead := exec.CommandContext(ctx, "xclip", "-selection", "clipboard", "-target", "UTF8_STRING", "-out")
	clearedRead.Env = xDisplayEnvironment(display)
	clearedOutput, clearedErr := clearedRead.Output()
	cancel()
	if len(clearedOutput) != 0 {
		t.Fatalf("cleared clipboard remained readable: output=%q err=%v", clearedOutput, clearedErr)
	}
	for _, test := range []struct {
		name string
		data []byte
	}{
		{"normal", []byte("remote owner normal")},
		{"incr", bytes.Repeat([]byte("remote-owner-large-"), 20_000)},
	} {
		t.Run("to-local-"+test.name, func(t *testing.T) {
			command := exec.Command("xclip", "-selection", "clipboard", "-target", "UTF8_STRING", "-in")
			command.Env = xDisplayEnvironment(display)
			command.Stdin = bytes.NewReader(test.data)
			if err := command.Start(); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				if command.Process != nil {
					_ = command.Process.Kill()
				}
				_, _ = command.Process.Wait()
			})
			select {
			case items := <-remote:
				plain := findClipboardItem(items, "text/plain")
				if !bytes.Equal(plain, test.data) {
					t.Fatalf("captured %d bytes, want %d", len(plain), len(test.data))
				}
			case <-time.After(5 * time.Second):
				t.Fatal("timed out waiting for XFixes clipboard snapshot")
			}
			_ = command.Process.Kill()
			_, _ = command.Process.Wait()
		})
	}

	t.Run("rich-multi-representation", func(t *testing.T) {
		ownerValue, err := newXClipboardBridge(display, func([]clipboardItem, string) {})
		if err != nil {
			t.Fatal(err)
		}
		owner := ownerValue.(*xClipboardBridge)
		t.Cleanup(func() { _ = owner.Close() })
		png := []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01")
		wanted := []clipboardItem{
			{Type: "text/plain", Data: []byte("rich plain")},
			{Type: "text/html", Data: []byte("<b>rich plain</b>")},
			{Type: "text/rtf", Data: []byte(`{\rtf1 rich plain}`)},
			{Type: "image/png", Data: png},
		}
		if err := owner.Set(wanted, func(string, error) {}); err != nil {
			t.Fatal(err)
		}
		select {
		case items := <-remote:
			for _, expected := range wanted {
				if !bytes.Equal(findClipboardItem(items, expected.Type), expected.Data) {
					t.Fatalf("captured %s does not match", expected.Type)
				}
			}
		case <-time.After(5 * time.Second):
			t.Fatal("timed out waiting for rich XFixes clipboard snapshot")
		}
	})
}

func TestXClipboardEmptyAndInvalidRemoteFormats(t *testing.T) {
	if testing.Short() {
		t.Skip("requires Xvfb")
	}
	if _, err := exec.LookPath("Xvfb"); err != nil {
		t.Skip("requires Xvfb")
	}
	t.Setenv("XAUTHORITY", "")
	for _, tc := range []struct {
		name    string
		items   []clipboardItem
		want    int
		invalid bool
	}{
		{"mixed-empty", []clipboardItem{{Type: "text/plain"}, {Type: "text/rtf", Data: []byte(`{\rtf1 valid}`)}}, 1, false},
		{"all-empty", []clipboardItem{{Type: "text/plain"}, {Type: "image/png"}}, 0, false},
		{"html-empty-fallback", []clipboardItem{{Type: "text/plain"}, {Type: "text/html", Data: []byte("<b>x</b>")}}, 0, true},
		{"late-invalid", []clipboardItem{{Type: "text/plain", Data: []byte("valid")}, {Type: "image/png", Data: []byte("invalid")}}, 0, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			display := startTestXvfb(t)
			remote := make(chan []clipboardItem, 8)
			failures := make(chan error, 8)
			reader, err := newXClipboardBridge(display, func(items []clipboardItem, _ string) { remote <- items }, func() func(error) { return func(err error) { failures <- err } })
			if err != nil {
				t.Fatal(err)
			}
			defer reader.Close()
			reader.SetMonitoring(true)
			owner, err := newXClipboardBridge(display, func([]clipboardItem, string) {})
			if err != nil {
				t.Fatal(err)
			}
			defer owner.Close()
			if err := owner.Set(tc.items, func(string, error) {}); err != nil {
				t.Fatal(err)
			}
			if tc.want > 0 {
				select {
				case items := <-remote:
					if len(items) != tc.want || items[0].Type != "text/rtf" {
						t.Fatal(items)
					}
				case err := <-failures:
					t.Fatal(err)
				case <-time.After(5 * time.Second):
					t.Fatal("capture timed out")
				}
			} else if tc.invalid {
				select {
				case <-failures:
				case items := <-remote:
					t.Fatalf("partial publication: %#v", items)
				case <-time.After(5 * time.Second):
					t.Fatal("missing capture error")
				}
			} else {
				select {
				case items := <-remote:
					t.Fatalf("empty publication: %#v", items)
				case err := <-failures:
					t.Fatal(err)
				case <-time.After(300 * time.Millisecond):
				}
			}
		})
	}
}

func TestXClipboardConsistencyAcrossMonitoringPause(t *testing.T) {
	if testing.Short() {
		t.Skip("requires Xvfb")
	}
	if _, err := exec.LookPath("Xvfb"); err != nil {
		t.Skip("requires Xvfb")
	}
	t.Setenv("XAUTHORITY", "")
	display := startTestXvfb(t)
	s, _, _ := testClipboardService(t)
	events := make(chan clipboardEvent, 16)
	s.publish = func(event clipboardEvent) { events <- event }
	readerValue, err := newXClipboardBridge(display, s.captureRemote)
	if err != nil {
		t.Fatal(err)
	}
	reader := readerValue.(*xClipboardBridge)
	defer reader.Close()
	reader.mu.Lock()
	reader.captureRemote = s.remoteCaptureReporter
	reader.mu.Unlock()
	s.bridge = reader
	owner, err := newXClipboardBridge(display, func([]clipboardItem, string) {})
	if err != nil {
		t.Fatal(err)
	}
	defer owner.Close()
	set := func(value string) {
		t.Helper()
		if err := owner.Set([]clipboardItem{{Type: "text/plain", Data: []byte(value)}}, func(string, error) {}); err != nil {
			t.Fatal(err)
		}
	}
	wait := func(condition func() bool) {
		t.Helper()
		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			s.mu.RLock()
			ready := condition()
			s.mu.RUnlock()
			if ready {
				return
			}
			time.Sleep(5 * time.Millisecond)
		}
		t.Fatal("native clipboard state did not settle")
	}
	next := func() clipboardEvent {
		t.Helper()
		select {
		case event := <-events:
			return event
		case <-time.After(5 * time.Second):
			t.Fatal("missing native event")
			return clipboardEvent{}
		}
	}
	set("A")
	s.setViewerCount(1)
	initial := next()
	if initial.Offer == nil || !initial.Offer.Baseline {
		t.Fatalf("resume must establish baseline: %#v", initial)
	}
	wait(func() bool { return !s.remoteUncertain })
	s.setViewerCount(0)
	set("B")
	wait(func() bool { return s.remoteUncertain })
	s.setViewerCount(1)
	resumed := next()
	if resumed.Offer == nil || !resumed.Offer.Baseline || resumed.Offer.Sequence <= initial.Offer.Sequence {
		t.Fatal("offline copy was not recaptured")
	}
	wait(func() bool { return !s.remoteUncertain })
	s.mu.RLock()
	epoch, sequence := s.captureEpoch, s.sequence
	s.mu.RUnlock()
	set("B")
	wait(func() bool { return s.captureEpoch > epoch && !s.remoteUncertain })
	s.mu.RLock()
	unchanged := s.sequence == sequence
	s.mu.RUnlock()
	if !unchanged {
		t.Fatal("unchanged owner takeover created a revision")
	}
	set("")
	if event := next(); event.Type != "clipboard-invalidated" || event.Offer != nil {
		t.Fatal("empty selection must only invalidate metadata")
	}
	set("B")
	if event := next(); event.Offer == nil || event.Offer.Sequence <= sequence {
		t.Fatal("A-empty-A suppressed")
	}
}

func TestXClipboardBridgeExpiryAndClipmanStaleReplay(t *testing.T) {
	if testing.Short() {
		t.Skip("requires local Xvfb, xclip, D-Bus, and Clipman")
	}
	for _, binary := range []string{"Xvfb", "xclip", "dbus-run-session", "xfce4-clipman"} {
		if _, err := exec.LookPath(binary); err != nil {
			t.Skipf("%s is unavailable", binary)
		}
	}
	display := startTestXvfb(t)
	t.Setenv("DISPLAY", display)
	t.Setenv("XAUTHORITY", "")

	bridgeValue, err := newXClipboardBridge(display, func([]clipboardItem, string) {})
	if err != nil {
		t.Fatal(err)
	}
	bridge := bridgeValue.(*xClipboardBridge)
	bridge.SetMonitoring(true)
	t.Cleanup(func() { _ = bridge.Close() })

	clipmanHome := t.TempDir()
	runtimeDir := filepath.Join(clipmanHome, "run")
	if err := os.Mkdir(runtimeDir, 0o700); err != nil {
		t.Fatal(err)
	}
	// Match the production xfce-user-desktop launch. Hosted runners do not
	// provide an Xfce session manager, so Clipman must not wait for or register
	// with one before it owns CLIPBOARD_MANAGER.
	clipman := exec.Command("dbus-run-session", "--", "xfce4-clipman", "--sm-client-disable")
	clipman.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	clipman.Env = append(xDisplayEnvironment(display),
		"HOME="+clipmanHome,
		"XDG_CONFIG_HOME="+filepath.Join(clipmanHome, "config"),
		"XDG_CACHE_HOME="+filepath.Join(clipmanHome, "cache"),
		"XDG_DATA_HOME="+filepath.Join(clipmanHome, "data"),
		"XDG_RUNTIME_DIR="+runtimeDir,
		"GTK_USE_PORTAL=0",
		"GIO_USE_PORTALS=0",
	)
	var clipmanOutput bytes.Buffer
	clipman.Stdout, clipman.Stderr = &clipmanOutput, &clipmanOutput
	if err := clipman.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if clipman.Process != nil {
			// dbus-run-session owns both a private bus and Clipman. Kill the
			// test-owned process group so neither child leaks past the test.
			_ = syscall.Kill(-clipman.Process.Pid, syscall.SIGKILL)
		}
		_, _ = clipman.Process.Wait()
		// Some distro builds activate xdg-document-portal even with portals
		// disabled. Detach its per-test FUSE mount before TempDir cleanup.
		if fusermount, err := exec.LookPath("fusermount3"); err == nil {
			_ = exec.Command(fusermount, "-uz", filepath.Join(runtimeDir, "doc")).Run()
		}
	})
	waitForSelectionOwner(t, bridge, "CLIPBOARD_MANAGER", &clipmanOutput)

	service := &clipboardService{
		bridge: bridge, generation: 7, active: true,
		offers: make(map[string]*clipboardOffer), history: make(map[string]*clipboardOffer),
		done: make(chan struct{}),
	}
	if _, err := service.setRemote(7, "viewer_abcdefgh", "set", []clipboardItem{{Type: "text/plain", Data: []byte("stale text")}}); err != nil {
		t.Fatal(err)
	}
	if output, err := readXClipboard(display, "UTF8_STRING"); err != nil || !bytes.Equal(output, []byte("stale text")) {
		t.Fatalf("prime Clipman text history: output=%q err=%v", output, err)
	}

	png, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.setRemote(7, "viewer_abcdefgh", "set", []clipboardItem{{Type: "image/png", Data: png}}); err != nil {
		t.Fatal(err)
	}
	if output, err := readXClipboard(display, "image/png"); err != nil || !bytes.Equal(output, png) {
		t.Fatalf("prime Clipman image history: bytes=%d err=%v", len(output), err)
	}
	time.Sleep(200 * time.Millisecond)

	service.mu.Lock()
	for _, offer := range service.offers {
		offer.ExpiresAt = time.Now().Add(-time.Second)
	}
	service.expireLocked(time.Now())
	service.mu.Unlock()
	if output, err := readXClipboard(display, "image/png"); err != nil || !bytes.Equal(output, png) {
		t.Fatalf("image did not survive offer metadata expiry: bytes=%d err=%v", len(output), err)
	}

	bridge.Clear()
	time.Sleep(300 * time.Millisecond)
	if output, err := readXClipboard(display, "UTF8_STRING"); len(output) != 0 {
		t.Fatalf("Clipman replayed stale text after explicit clear: output=%q err=%v", output, err)
	}
	if output, err := readXClipboard(display, "image/png"); err == nil || len(output) != 0 {
		t.Fatalf("cleared image remained available: bytes=%d err=%v", len(output), err)
	}
	if err := bridge.Close(); err != nil {
		t.Fatal(err)
	}
	time.Sleep(300 * time.Millisecond)
	if output, err := readXClipboard(display, "UTF8_STRING"); len(output) != 0 {
		t.Fatalf("Clipman replayed stale text after cleared gateway exit: output=%q err=%v", output, err)
	}
}

func TestXClipboardBridgeOfferExpiryWithoutClipman(t *testing.T) {
	if testing.Short() {
		t.Skip("requires local Xvfb and xclip")
	}
	for _, binary := range []string{"Xvfb", "xclip"} {
		if _, err := exec.LookPath(binary); err != nil {
			t.Skipf("%s is unavailable", binary)
		}
	}
	display := startTestXvfb(t)
	t.Setenv("DISPLAY", display)
	t.Setenv("XAUTHORITY", "")

	bridgeValue, err := newXClipboardBridge(display, func([]clipboardItem, string) {})
	if err != nil {
		t.Fatal(err)
	}
	bridge := bridgeValue.(*xClipboardBridge)
	t.Cleanup(func() { _ = bridge.Close() })
	service := &clipboardService{
		bridge: bridge, generation: 7, active: true,
		offers: make(map[string]*clipboardOffer), history: make(map[string]*clipboardOffer),
		done: make(chan struct{}),
	}
	png, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.setRemote(7, "viewer_abcdefgh", "set", []clipboardItem{{Type: "image/png", Data: png}}); err != nil {
		t.Fatal(err)
	}
	service.mu.Lock()
	for _, offer := range service.offers {
		offer.ExpiresAt = time.Now().Add(-time.Second)
	}
	service.expireLocked(time.Now())
	service.mu.Unlock()
	for attempt := 0; attempt < 2; attempt++ {
		if output, err := readXClipboard(display, "image/png"); err != nil || !bytes.Equal(output, png) {
			t.Fatalf("repeat paste %d after metadata expiry: bytes=%d err=%v", attempt+1, len(output), err)
		}
	}

	request := httptest.NewRequest(http.MethodPost, "/v1/session", bytes.NewBufferString(`{"generation":7,"active":false}`))
	response := httptest.NewRecorder()
	service.handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("end session = %d: %s", response.Code, response.Body.String())
	}
	if output, err := readXClipboard(display, "image/png"); err == nil || len(output) != 0 {
		t.Fatalf("session cleanup retained image: bytes=%d err=%v", len(output), err)
	}
	owner, err := xproto.GetSelectionOwner(bridge.conn, bridge.atoms.clipboard).Reply()
	if err != nil || owner.Owner != bridge.emptyWindow {
		t.Fatalf("session cleanup owner = %#x, err=%v; want empty bridge owner %#x", owner.Owner, err, bridge.emptyWindow)
	}
}

func startTestXvfb(t *testing.T) string {
	t.Helper()
	displayReader, displayWriter, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	server := exec.Command("Xvfb", "-displayfd", "3", "-screen", "0", "1280x720x24", "-nolisten", "tcp")
	server.ExtraFiles = []*os.File{displayWriter}
	server.Stdout, server.Stderr = os.Stderr, os.Stderr
	if err := server.Start(); err != nil {
		_ = displayReader.Close()
		_ = displayWriter.Close()
		t.Fatal(err)
	}
	_ = displayWriter.Close()
	_ = displayReader.SetReadDeadline(time.Now().Add(5 * time.Second))
	line, readErr := bufio.NewReader(displayReader).ReadString('\n')
	_ = displayReader.Close()
	if readErr != nil {
		_ = server.Process.Kill()
		_, _ = server.Process.Wait()
		t.Fatalf("Xvfb did not allocate a display: %v", readErr)
	}
	displayNumber, parseErr := strconv.Atoi(strings.TrimSpace(line))
	if parseErr != nil || displayNumber < 0 {
		_ = server.Process.Kill()
		_, _ = server.Process.Wait()
		t.Fatalf("Xvfb returned invalid display %q", strings.TrimSpace(line))
	}
	display := fmt.Sprintf(":%d", displayNumber)
	cleanupXvfb(t, server, display)
	return display
}

func waitForSelectionOwner(t *testing.T, bridge *xClipboardBridge, name string, processOutput *bytes.Buffer) {
	t.Helper()
	reply, err := xproto.InternAtom(bridge.conn, false, uint16(len(name)), name).Reply()
	if err != nil {
		t.Fatal(err)
	}
	// The first GTK/Xfconf startup on a fresh hosted runner can exceed five
	// seconds while package and font caches are cold.
	deadline := time.Now().Add(20 * time.Second)
	for {
		owner, ownerErr := xproto.GetSelectionOwner(bridge.conn, reply.Atom).Reply()
		if ownerErr == nil && owner.Owner != xproto.WindowNone {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("%s owner did not appear: %s", name, processOutput.String())
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func readXClipboard(display, target string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, "xclip", "-selection", "clipboard", "-target", target, "-out")
	command.Env = xDisplayEnvironment(display)
	return command.Output()
}

func cleanupXvfb(t *testing.T, server *exec.Cmd, display string) {
	t.Helper()
	t.Cleanup(func() {
		_ = server.Process.Kill()
		_, _ = server.Process.Wait()
		// SIGKILL does not let every Xvfb build remove its lock and socket.
		// This test exclusively created this previously vacant display.
		_ = os.Remove(filepath.Join("/tmp/.X11-unix", "X"+display[1:]))
		_ = os.Remove(filepath.Join("/tmp", ".X"+display[1:]+"-lock"))
	})
}

func xDisplayEnvironment(display string) []string {
	result := make([]string, 0, len(os.Environ())+2)
	for _, value := range os.Environ() {
		if len(value) >= 8 && value[:8] == "DISPLAY=" || len(value) >= 11 && value[:11] == "XAUTHORITY=" {
			continue
		}
		result = append(result, value)
	}
	return append(result, "DISPLAY="+display, "XAUTHORITY=")
}

func findClipboardItem(items []clipboardItem, mediaType string) []byte {
	for _, item := range items {
		if item.Type == mediaType {
			return item.Data
		}
	}
	return nil
}
