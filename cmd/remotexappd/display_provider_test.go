package main

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/woodegg/remotexapp/internal/testfixture"
)

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
