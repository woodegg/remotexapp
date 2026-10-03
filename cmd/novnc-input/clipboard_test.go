package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"sync"
	"testing"
	"time"
)

type fakeClipboardBridge struct {
	mu     sync.Mutex
	items  []clipboardItem
	state  func(string, error)
	clears int
}

func (f *fakeClipboardBridge) Set(items []clipboardItem, state func(string, error)) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.items = cloneClipboardItems(items)
	f.state = state
	return nil
}
func (f *fakeClipboardBridge) Clear()             { f.mu.Lock(); f.clears++; f.items = nil; f.mu.Unlock() }
func (f *fakeClipboardBridge) SetMonitoring(bool) {}
func (f *fakeClipboardBridge) Close() error       { return nil }

func testClipboardService(t *testing.T) (*clipboardService, *fakeClipboardBridge, *[]clipboardEvent) {
	t.Helper()
	bridge := &fakeClipboardBridge{}
	events := make([]clipboardEvent, 0)
	service := &clipboardService{
		bridge: bridge, generation: 7, active: true, offers: make(map[string]*clipboardOffer),
		publish: func(event clipboardEvent) { events = append(events, event) }, done: make(chan struct{}),
	}
	return service, bridge, &events
}

func clipboardMultipartRequest(t *testing.T, target string, generation int, viewerID, action string, items []clipboardItem) *http.Request {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for _, item := range items {
		header := make(textproto.MIMEHeader)
		header["Content-Disposition"] = []string{`form-data; name="item"; filename="clipboard"`}
		header["Content-Type"] = []string{item.Type}
		part, err := writer.CreatePart(header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(item.Data); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, target, &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("X-RemoteXApp-Session-Generation", string(rune('0'+generation)))
	request.Header.Set("X-RemoteXApp-Viewer-ID", viewerID)
	request.Header.Set("X-RemoteXApp-Clipboard-Action", action)
	return request
}

func TestClipboardOfferRoundTripIsNonConsumingAndBroadcast(t *testing.T) {
	service, bridge, events := testClipboardService(t)
	request := clipboardMultipartRequest(t, "/v1/offers", 7, "viewer_abcdefgh", "set", []clipboardItem{
		{Type: "text/plain;charset=utf-8", Data: []byte("plain")},
		{Type: "text/html", Data: []byte("<b>plain</b>")},
	})
	response := httptest.NewRecorder()
	service.handler().ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("create = %d: %s", response.Code, response.Body.String())
	}
	var created clipboardOffer
	if err := json.Unmarshal(response.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.Direction != "toRemote" || created.State != "owned" {
		t.Fatalf("created = %#v", created)
	}
	if created.Sequence != 0 || (*events)[0].Offer.Sequence != 1 {
		t.Fatalf("private/broadcast sequences = %d/%d", created.Sequence, (*events)[0].Offer.Sequence)
	}
	if len(*events) != 1 || (*events)[0].Offer.Direction != "toLocal" || (*events)[0].Offer.SourceViewerID != "viewer_abcdefgh" {
		t.Fatalf("events = %#v", *events)
	}
	if len(bridge.items) != 2 {
		t.Fatalf("owned items = %d", len(bridge.items))
	}

	remote := (*events)[0].Offer
	for attempt := 0; attempt < 2; attempt++ {
		accept := httptest.NewRequest(http.MethodPost, "/v1/offers/"+remote.ID+"/accept", nil)
		accept.Header.Set("X-RemoteXApp-Session-Generation", "7")
		accepted := httptest.NewRecorder()
		service.handler().ServeHTTP(accepted, accept)
		if accepted.Code != http.StatusOK {
			t.Fatalf("accept %d = %d: %s", attempt, accepted.Code, accepted.Body.String())
		}
		parsed, err := multipart.NewReader(bytes.NewReader(accepted.Body.Bytes()), boundaryFromContentType(t, accepted.Header().Get("Content-Type"))).ReadForm(clipboardTotalLimit)
		if err != nil {
			t.Fatal(err)
		}
		if len(parsed.File["item"]) != 2 {
			t.Fatalf("accept %d representations = %d", attempt, len(parsed.File["item"]))
		}
	}
}

func TestClipboardCaptureErrorsAreGenerationBound(t *testing.T) {
	s, _, events := testClipboardService(t)
	s.viewers = 1
	report := s.captureErrorReporter()
	report(errors.New("synthetic read failure"))
	if len(*events) != 1 || (*events)[0].Type != "clipboard-error" || (*events)[0].Generation != 7 {
		t.Fatal(*events)
	}
	s.generation++
	report(errors.New("stale failure"))
	if len(*events) != 1 {
		t.Fatal("stale capture leaked into new generation")
	}
}

func TestXClipboardCaptureDoesNotPublishPartialInvalidContent(t *testing.T) {
	for _, tc := range []struct {
		name, kind string
		data       []byte
	}{
		{"invalid-utf8", "text/plain", []byte{0xff}},
		{"invalid-png", "image/png", []byte("bad")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			failures := 0
			c := &xClipboardCapture{canonical: tc.kind, items: []clipboardItem{{Type: "text/rtf", Data: []byte("valid")}}, onError: func(error) { failures++ }}
			b := &xClipboardBridge{capture: c}
			b.acceptCapturedValueLocked(c, tc.data)
			if b.capture != nil || failures != 1 {
				t.Fatal("invalid representation did not abort entire capture")
			}
		})
	}
	failures := 0
	c := &xClipboardCapture{items: []clipboardItem{{Type: "text/html", Data: []byte("<b>x</b>")}}, onError: func(error) { failures++ }}
	b := &xClipboardBridge{capture: c}
	b.requestNextTargetLocked(c)
	if b.capture != nil || failures != 1 {
		t.Fatal("HTML was silently removed")
	}
	c = &xClipboardCapture{canonical: "text/plain"}
	b.capture = c
	b.acceptCapturedValueLocked(c, nil)
	if b.capture != c || len(c.items) != 0 {
		t.Fatal("empty part is not a capture failure")
	}
	b.acceptCapturedValueLocked(c, []byte(" \n"))
	if len(c.items) != 1 || string(c.items[0].Data) != " \n" {
		t.Fatal("whitespace lost")
	}
}

func TestClipboardEmptyOffersPreserveDestination(t *testing.T) {
	for _, tc := range []struct {
		name  string
		items []clipboardItem
		code  int
	}{
		{"empty", []clipboardItem{{Type: "text/plain"}}, 200},
		{"all-empty", []clipboardItem{{Type: "text/plain"}, {Type: "image/png"}}, 200},
		{"late-invalid", []clipboardItem{{Type: "text/plain", Data: []byte("new")}, {Type: "image/png", Data: []byte("bad")}}, 400},
		{"html-empty-fallback", []clipboardItem{{Type: "text/plain"}, {Type: "text/html", Data: []byte("<b>new</b>")}}, 400},
		{"duplicate", []clipboardItem{{Type: "text/plain"}, {Type: "text/plain", Data: []byte("new")}}, 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, bridge, events := testClipboardService(t)
			bridge.items = []clipboardItem{{Type: "text/plain", Data: []byte("original")}}
			r := clipboardMultipartRequest(t, "/v1/offers", 7, "viewer_abcdefgh", "set", tc.items)
			w := httptest.NewRecorder()
			s.handler().ServeHTTP(w, r)
			if w.Code != tc.code {
				t.Fatalf("%d: %s", w.Code, w.Body.String())
			}
			if tc.code == 200 && !bytes.Contains(w.Body.Bytes(), []byte(`"skipped":true`)) {
				t.Fatal(w.Body.String())
			}
			if len(bridge.items) != 1 || string(bridge.items[0].Data) != "original" || bridge.clears != 0 || len(*events) != 0 || len(s.offers) != 0 {
				t.Fatal("failed/no-op upload changed destination or published an offer")
			}
		})
	}
}

func TestClipboardEmptyMixedWhitespace(t *testing.T) {
	s, bridge, _ := testClipboardService(t)
	r := clipboardMultipartRequest(t, "/v1/offers", 7, "viewer_abcdefgh", "set", []clipboardItem{{Type: "text/rtf"}, {Type: "text/plain", Data: []byte(" \t\n")}, {Type: "image/png"}})
	w := httptest.NewRecorder()
	s.handler().ServeHTTP(w, r)
	if w.Code != 201 || len(bridge.items) != 1 || string(bridge.items[0].Data) != " \t\n" {
		t.Fatalf("%d %s %#v", w.Code, w.Body.String(), bridge.items)
	}
}

func TestClipboardValidationAndGenerationCleanup(t *testing.T) {
	service, bridge, _ := testClipboardService(t)
	for name, items := range map[string][]clipboardItem{
		"html-without-plain": {{Type: "text/html", Data: []byte("<b>x</b>")}},
		"unknown":            {{Type: "application/octet-stream", Data: []byte("x")}},
		"invalid-png":        {{Type: "image/png", Data: []byte("not png")}},
		"invalid-utf8":       {{Type: "text/plain", Data: []byte{0xff}}},
	} {
		t.Run(name, func(t *testing.T) {
			request := clipboardMultipartRequest(t, "/v1/offers", 7, "viewer_abcdefgh", "set", items)
			response := httptest.NewRecorder()
			service.handler().ServeHTTP(response, request)
			if response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d: %s", response.Code, response.Body.String())
			}
		})
	}

	session := httptest.NewRequest(http.MethodPost, "/v1/session", bytes.NewBufferString(`{"generation":8,"active":true}`))
	changed := httptest.NewRecorder()
	service.handler().ServeHTTP(changed, session)
	if changed.Code != http.StatusOK {
		t.Fatalf("session = %d: %s", changed.Code, changed.Body.String())
	}
	if bridge.clears != 1 || len(service.offers) != 0 {
		t.Fatalf("clear count=%d offers=%d", bridge.clears, len(service.offers))
	}
	stale := httptest.NewRequest(http.MethodGet, "/v1/offers", nil)
	stale.Header.Set("X-RemoteXApp-Session-Generation", "7")
	staleResponse := httptest.NewRecorder()
	service.handler().ServeHTTP(staleResponse, stale)
	if staleResponse.Code != http.StatusConflict {
		t.Fatalf("stale status = %d", staleResponse.Code)
	}
}

func TestClipboardTransactionLimitIsBounded(t *testing.T) {
	service, _, _ := testClipboardService(t)
	for index := 0; index < clipboardTransactions; index++ {
		if !service.beginTransaction() {
			t.Fatalf("transaction %d was rejected early", index)
		}
	}
	if service.beginTransaction() {
		t.Fatal("transaction above the runtime limit was accepted")
	}
	for index := 0; index < clipboardTransactions; index++ {
		service.endTransaction()
	}
}

func TestClipboardExpiryRetainsCurrentSelectionAndOnlyTerminalMetadata(t *testing.T) {
	service, bridge, _ := testClipboardService(t)
	offer, err := service.setRemote(7, "viewer_abcdefgh", "set", []clipboardItem{{Type: "text/plain", Data: []byte("expires")}})
	if err != nil {
		t.Fatal(err)
	}
	service.mu.Lock()
	service.offers[offer.ID].ExpiresAt = time.Now().Add(-time.Second)
	service.mu.Unlock()
	request := httptest.NewRequest(http.MethodGet, "/v1/offers/"+offer.ID, nil)
	request.Header.Set("X-RemoteXApp-Session-Generation", "7")
	response := httptest.NewRecorder()
	service.handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("terminal status = %d: %s", response.Code, response.Body.String())
	}
	var terminal clipboardOffer
	if err := json.Unmarshal(response.Body.Bytes(), &terminal); err != nil {
		t.Fatal(err)
	}
	if terminal.State != "not-consumed" || len(terminal.Items) != 0 || bridge.clears != 0 {
		t.Fatalf("terminal=%#v clears=%d", terminal, bridge.clears)
	}
	if got := findClipboardItem(bridge.items, "text/plain"); !bytes.Equal(got, []byte("expires")) {
		t.Fatalf("current X11 selection was not retained after metadata expiry: %q", got)
	}
}

func TestCancellingOldFailedOfferDoesNotClearNewSelection(t *testing.T) {
	service, bridge, _ := testClipboardService(t)
	old, err := service.setRemote(7, "viewer_abcdefgh", "set", []clipboardItem{{Type: "text/plain", Data: []byte("old")}})
	if err != nil {
		t.Fatal(err)
	}
	service.updateOffer(old.ID, "failed", errors.New("injected paste failure"))
	service.clearOwnedOffer(old.ID)
	bridge.Clear()
	if _, err := service.setRemote(7, "viewer_abcdefgh", "set", []clipboardItem{{Type: "text/plain", Data: []byte("new")}}); err != nil {
		t.Fatal(err)
	}
	before := bridge.clears
	request := httptest.NewRequest(http.MethodDelete, "/v1/offers/"+old.ID, nil)
	request.Header.Set("X-RemoteXApp-Session-Generation", "7")
	request.Header.Set("X-RemoteXApp-Viewer-ID", "viewer_abcdefgh")
	response := httptest.NewRecorder()
	service.handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("cancel = %d: %s", response.Code, response.Body.String())
	}
	if bridge.clears != before {
		t.Fatalf("cancel old offer cleared current selection: before=%d after=%d", before, bridge.clears)
	}
}

func TestClipboardExactTextLimit(t *testing.T) {
	service, _, _ := testClipboardService(t)
	for _, test := range []struct {
		name string
		size int
		want int
	}{
		{"exact", clipboardPlainLimit, http.StatusCreated},
		{"over", clipboardPlainLimit + 1, http.StatusBadRequest},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := clipboardMultipartRequest(t, "/v1/offers", 7, "viewer_abcdefgh", "set", []clipboardItem{{Type: "text/plain", Data: bytes.Repeat([]byte("x"), test.size)}})
			response := httptest.NewRecorder()
			service.handler().ServeHTTP(response, request)
			if response.Code != test.want {
				t.Fatalf("status = %d want %d: %s", response.Code, test.want, response.Body.String())
			}
		})
	}
}

func TestReliableClipboardQueueDisconnectsInsteadOfDropping(t *testing.T) {
	peer := newInputPeer(&recordingJSONWriter{}, "viewer_abcdefgh")
	for index := 0; index < cap(peer.reliable); index++ {
		if !peer.offerReliable(index) {
			t.Fatalf("queue rejected event %d early", index)
		}
	}
	if peer.offerReliable("overflow") {
		t.Fatal("overflow event was accepted")
	}
	select {
	case <-peer.done:
	default:
		t.Fatal("slow peer was not disconnected")
	}
}

func boundaryFromContentType(t *testing.T, value string) string {
	t.Helper()
	const marker = "boundary="
	index := bytes.Index([]byte(value), []byte(marker))
	if index < 0 {
		t.Fatalf("missing multipart boundary in %q", value)
	}
	return value[index+len(marker):]
}

func FuzzValidateClipboardPNG(f *testing.F) {
	f.Add([]byte("not-png"))
	f.Add(append([]byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"), 0, 0, 0, 1, 0, 0, 0, 1))
	f.Fuzz(func(t *testing.T, data []byte) {
		if err := validateClipboardPNG(data); err != nil {
			return
		}
		if len(data) < 24 || string(data[:8]) != "\x89PNG\r\n\x1a\n" || string(data[12:16]) != "IHDR" {
			t.Fatal("PNG validator accepted an incomplete header")
		}
		width := int64(data[16])<<24 | int64(data[17])<<16 | int64(data[18])<<8 | int64(data[19])
		height := int64(data[20])<<24 | int64(data[21])<<16 | int64(data[22])<<8 | int64(data[23])
		if width < 1 || height < 1 || width > clipboardPNGMaxDimension || height > clipboardPNGMaxDimension || width*height > clipboardPNGMaxPixels {
			t.Fatalf("PNG validator accepted unsafe dimensions %dx%d", width, height)
		}
	})
}
