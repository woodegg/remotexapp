package main

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/woodegg/remotexapp/internal/testfixture"
)

func TestKasmPrerequisitesFailClosed(t *testing.T) {
	pin := testfixture.Kasm(t)
	for _, cfg := range []config{
		{displayProvider: "unknown"},
		{displayProvider: "tigervnc", kasmBundle: pin.Directory},
		{displayProvider: "kasm", vncLauncher: "wrapper", kasmBundle: pin.Directory},
		{displayProvider: "kasm", vncLauncher: "direct", kasmBundle: filepath.Join(t.TempDir(), "missing")},
	} {
		if cfg.configureDisplayProvider() == nil {
			t.Fatal("invalid provider prerequisites accepted")
		}
	}
	cfg := config{displayProvider: "kasm", vncLauncher: "direct", kasmBundle: pin.Directory}
	if err := cfg.configureDisplayProvider(); err != nil || cfg.kasmPin == nil || *cfg.kasmPin != pin {
		t.Fatalf("paired selection: %v", err)
	}
	legacy := config{}
	if err := legacy.configureDisplayProvider(); err != nil || legacy.displayProvider != "tigervnc" {
		t.Fatal("default provider changed")
	}
}

func TestNativeRecoveryWriteFailurePreservesOldGeneration(t *testing.T) {
	m, item, marker, _ := recoveryIntentFixture(t, "")
	pin := testfixture.Kasm(t)
	item.Components.DisplayProvider, item.Components.Kasm, item.Components.UnicodeEngine = "kasm", &pin, ""
	if err := m.persistRuntime(item); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(m.runtimeManifestDir(), item.ID+".json")
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	m.cfg.stateDir = filepath.Join(t.TempDir(), "blocked")
	if err := os.WriteFile(m.cfg.stateDir, []byte("not a directory"), 0600); err != nil {
		t.Fatal(err)
	}
	m.lifecycleMu.Lock()
	err = m.startSession(item.ID)
	m.lifecycleMu.Unlock()
	if err == nil || !strings.Contains(err.Error(), "persist managed session recovery intent") {
		t.Fatalf("unexpected result: %v", err)
	}
	after, err := os.ReadFile(path)
	if err != nil || string(after) != string(before) {
		t.Fatal("failed transaction changed durable generation")
	}
	if _, err := os.Stat(marker); err != nil {
		t.Fatal("failed transaction cleaned owned resources")
	}
	if m.get(item.ID).SessionGeneration != 9 {
		t.Fatal("failed transaction advanced generation")
	}
}

func TestNativeConcurrentRecoveryStartsOnce(t *testing.T) {
	m, item, now, starts := backgroundRecoveryFixture(t)
	pin := testfixture.Kasm(t)
	item.Components.DisplayProvider, item.Components.Kasm, item.Components.UnicodeEngine = "kasm", &pin, ""
	next := stepBackgroundRecovery(t, m, item, *now)
	*now = next
	var group sync.WaitGroup
	for range 8 {
		group.Go(func() { m.notifySessionRecovery(); m.reconcileSessionRecovery(*now) })
	}
	group.Wait()
	if starts.Load() != 1 || m.get(item.ID).Recovery.Attempts != 1 {
		t.Fatal("duplicate native launch or charge")
	}
	records, err := m.loadRuntimeManifests()
	if err != nil || len(records) != 1 || records[0].SchemaVersion != nativeManifestSchema {
		t.Fatalf("native transaction lost its schema: %v", err)
	}
}

func TestKasmManifestRequiresExplicitSchemaAndPinnedPair(t *testing.T) {
	pin := testfixture.Kasm(t)
	m := &manager{cfg: config{stateDir: t.TempDir()}}
	item := testRuntimeManifest(t, m.cfg.stateDir, "mousepad-0123456789ab", "")
	item.Components.DisplayProvider, item.Components.Kasm, item.Components.UnicodeEngine = "kasm", &pin, ""
	if err := m.persistRuntime(item); err != nil {
		t.Fatal(err)
	}
	records, err := m.loadRuntimeManifests()
	if err != nil || len(records) != 1 {
		t.Fatalf("load: %v", err)
	}
	r := records[0]
	if r.SchemaVersion != 4 || !isKasm(&r.Runtime) || *r.Components.Kasm != pin {
		t.Fatal("native identity not preserved")
	}
	if err := validateDisplayComponents(r.Components, true); err != nil {
		t.Fatal(err)
	}
	for _, schema := range []int{2, 3} {
		copy := r
		copy.SchemaVersion = schema
		if m.validateRuntimeManifest("fixture", &copy) == nil {
			t.Fatal("native runtime accepted as legacy")
		}
	}
	copy := r
	copy.Components.DisplayProvider = ""
	if m.validateRuntimeManifest("fixture", &copy) == nil {
		t.Fatal("ambiguous native record accepted")
	}
	if m.versionView(item).Eligible {
		t.Fatal("implicit provider migration offered")
	}
	if m.preflightUpgrade(item, item.Spec) == nil {
		t.Fatal("implicit provider migration allowed")
	}
}

func TestNativeViewerRejectsStaleAndLegacyRoutesBeforeAttach(t *testing.T) {
	m, item, _, _ := backgroundRecoveryFixture(t)
	item.Components.DisplayProvider = "kasm"
	item.SessionState = "running"
	for _, route := range []string{"input", "rfb-compat", "websockify", "native/api/users"} {
		w := httptest.NewRecorder()
		m.serveInstanceRoute(w, httptest.NewRequest("GET", "/remotexapps/"+item.ID+"/"+route, nil))
		if w.Code != 404 {
			t.Fatalf("route %s: %d", route, w.Code)
		}
	}
	for _, query := range []string{"", "?sessionGeneration=0", "?sessionGeneration=999", "?sessionGeneration=1&sessionGeneration=2"} {
		_, _, err := m.openViewerChannel(item.ID, true, httptest.NewRequest("GET", "/native/websockify"+query, nil))
		if err == nil {
			t.Fatalf("accepted unsafe generation %s", query)
		}
	}
	for _, body := range []string{`{}`, `{"sessionGeneration":-1}`, `{"sessionGeneration":999}`} {
		w := httptest.NewRecorder()
		m.prepareNativeViewer(w, httptest.NewRequest("POST", "/native/prepare", strings.NewReader(body)), item.ID)
		if w.Code != 400 && w.Code != 409 {
			t.Fatalf("accepted unsafe prepare: %d", w.Code)
		}
	}
	if m.get(item.ID).AttachedClients != 0 {
		t.Fatal("rejected request attached a Viewer")
	}
}

func TestNativeAssetRejectsOldComponentBeforeProxy(t *testing.T) {
	m, item, _, _ := backgroundRecoveryFixture(t)
	pin := testfixture.Kasm(t)
	item.Components.DisplayProvider, item.Components.Kasm = "kasm", &pin
	if bus, reason, err := m.ibusConnection(item, nil); err != nil || bus != nil || reason != "unsupported-provider" {
		t.Fatal("native descriptor invents an IBus service")
	}
	for _, query := range []string{"", "?componentDigest=" + strings.Repeat("0", 64), "?componentDigest=" + pin.SHA256 + "&componentDigest=" + pin.SHA256} {
		w := httptest.NewRecorder()
		m.serveInstanceRoute(w, httptest.NewRequest("GET", "/remotexapps/"+item.ID+"/native/client.js"+query, nil))
		if w.Code != 409 {
			t.Fatalf("accepted unpinned/stale component: %d", w.Code)
		}
	}
}

func TestKasmLaunchKeepsClassDisplayPolicy(t *testing.T) {
	pin := testfixture.Kasm(t)
	item := &instance{Display: ":3", VNCUnit: "remotexapp-fixture-vnc.service", Home: "/home/fixture", Components: runtimeComponents{DisplayProvider: "kasm", Kasm: &pin}}
	args := strings.Join(kasmLaunchArgs(item, classConfig{Server: serverClassConfig{Geometry: "1280x720", FrameRate: 10, AllowClientResize: false}}, 5903, "/home/fixture/.Xauthority"), " ")
	for _, expected := range []string{"-FrameRate 10", "-IgnoreClientSettingsKasm=1", "-AcceptSetDesktopSize=0", "-AcceptCutText=0", "-SendCutText=0", "-interface 127.0.0.1"} {
		if !strings.Contains(args, expected) {
			t.Fatalf("missing class/transport policy %s", expected)
		}
	}
}

func TestNativeClipboardIsPinnedAndServerEnforced(t *testing.T) {
	old := testfixture.Kasm(t)
	cfg := config{displayProvider: "kasm", vncLauncher: "direct", kasmBundle: old.Directory, nativeClipboard: true}
	if cfg.configureDisplayProvider() == nil {
		t.Fatal("old component accepted clipboard")
	}
	pin := testfixture.KasmProtocol(t, "kasm-wss-text-v1")
	cfg.kasmBundle = pin.Directory
	if err := cfg.configureDisplayProvider(); err != nil {
		t.Fatal(err)
	}
	m := manager{cfg: cfg}
	c := m.newRuntimeComponents()
	if c.NativeClipboard != "text" {
		t.Fatal("policy was not snapshotted")
	}
	if err := validateDisplayComponents(c, true); err != nil {
		t.Fatal(err)
	}
	c.Kasm = &old
	if validateDisplayComponents(c, true) == nil {
		t.Fatal("old pair adopted text policy")
	}
	c.Kasm = &pin
	c.NativeClipboard = "rich"
	if validateDisplayComponents(c, false) == nil {
		t.Fatal("unknown policy accepted")
	}
	c.NativeClipboard = "text"
	item := &instance{Components: c}
	args := strings.Join(kasmLaunchArgs(item, classConfig{}, 5903, "/tmp/fixture-authority"), " ")
	for _, value := range []string{"-AcceptCutText=1", "-SendCutText=1", "-DLP_ClipAcceptMax=65536", "-DLP_ClipSendMax=65537", "-DLP_ClipTypes=text/plain", "-DLP_Log=off"} {
		if !strings.Contains(args, value) {
			t.Fatalf("missing server policy %s", value)
		}
	}
}
