package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClipboardContentIdentityAndRevisions(t *testing.T) {
	s, _, events := testClipboardService(t)
	s.setViewerCount(2)
	a := []clipboardItem{{Type: "text/plain", Data: []byte("A")}, {Type: "text/html", Data: []byte("<b>A</b>")}}
	s.captureRemote(a, "viewer_abcdefgh")
	s.captureRemote([]clipboardItem{a[1], a[0]}, "") // Clipman ownership takeover.
	if len(*events) != 1 || s.sequence != 1 {
		t.Fatal("unchanged ownership generated a new change")
	}
	if (*events)[0].Offer.SourceViewerID != "viewer_abcdefgh" {
		t.Fatal("origin lost")
	}
	s.captureRemote(a[:1], "") // Losing a representation is a real content change.
	s.captureRemote(a, "")
	if len(*events) != 3 || s.sequence != 3 {
		t.Fatal("rich change or A-B-A suppressed")
	}
	s.captureRemote(nil, "")
	s.captureRemote(a, "")
	if len(*events) != 5 || (*events)[3].Type != "clipboard-invalidated" || (*events)[3].Offer != nil || s.sequence != 5 {
		t.Fatal("empty transition did not invalidate content identity")
	}
}

func TestClipboardStaleAcceptAndGuardedWrite(t *testing.T) {
	s, bridge, events := testClipboardService(t)
	s.setViewerCount(1)
	s.captureRemote([]clipboardItem{{Type: "text/plain", Data: []byte("old")}}, "")
	old := (*events)[0].Offer.ID
	s.captureRemote([]clipboardItem{{Type: "text/plain", Data: []byte("new")}}, "")
	r := httptest.NewRequest(http.MethodPost, "/v1/offers/"+old+"/accept", nil)
	r.Header.Set("X-RemoteXApp-Session-Generation", "7")
	w := httptest.NewRecorder()
	s.handler().ServeHTTP(w, r)
	if w.Code != http.StatusConflict {
		t.Fatalf("stale accept: %d", w.Code)
	}
	items := []clipboardItem{{Type: "text/plain", Data: []byte("local")}}
	for _, sequence := range []string{"1", "-1", "9007199254740992"} {
		r = clipboardMultipartRequest(t, "/v1/offers", 7, "viewer_abcdefgh", "set", items)
		r.Header.Set("X-RemoteXApp-Clipboard-Sequence", sequence)
		w = httptest.NewRecorder()
		s.handler().ServeHTTP(w, r)
		if w.Code < 400 || len(bridge.items) != 0 {
			t.Fatalf("invalid guard %s wrote clipboard: %d", sequence, w.Code)
		}
	}
	r = clipboardMultipartRequest(t, "/v1/offers", 7, "viewer_abcdefgh", "set", items)
	r.Header.Set("X-RemoteXApp-Clipboard-Sequence", "2")
	w = httptest.NewRecorder()
	s.handler().ServeHTTP(w, r)
	if w.Code != http.StatusCreated || string(bridge.items[0].Data) != "local" {
		t.Fatalf("current write: %d %s", w.Code, w.Body.String())
	}
}

func TestClipboardAsyncCaptureCannotReplayAfterNewOwnerWriteOrSession(t *testing.T) {
	s, _, events := testClipboardService(t)
	s.setViewerCount(1)
	items := []clipboardItem{{Type: "text/plain", Data: []byte("copy")}}
	old := s.remoteCaptureReporter()
	latest := s.remoteCaptureReporter()
	old(items, "")
	if len(*events) != 0 {
		t.Fatal("old capture published")
	}
	latest(items, "")
	if len(*events) != 1 {
		t.Fatal("latest capture missing")
	}
	old = s.remoteCaptureReporter()
	if _, err := s.setRemote(7, "viewer_abcdefgh", "set", []clipboardItem{{Type: "text/plain", Data: []byte("viewer")}}); err != nil {
		t.Fatal(err)
	}
	old(items, "")
	if len(*events) != 2 {
		t.Fatal("old capture replayed over viewer write")
	}
	old = s.remoteCaptureReporter()
	s.mu.Lock()
	s.clearLocked()
	s.generation = 8
	s.mu.Unlock()
	old(items, "")
	if len(*events) != 2 {
		t.Fatal("old session capture published")
	}
	if _, err := s.setRemote(7, "viewer_abcdefgh", "set", items); err == nil {
		t.Fatal("old generation mutated clipboard")
	}
}
