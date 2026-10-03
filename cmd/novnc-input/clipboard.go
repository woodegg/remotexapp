package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/textproto"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	clipboardProtocolVersion = 1
	clipboardPlainLimit      = 4 << 20
	clipboardHTMLLimit       = 4 << 20
	clipboardRTFLimit        = 16 << 20
	clipboardPNGLimit        = 64 << 20
	clipboardTotalLimit      = 80 << 20
	clipboardRuntimeLimit    = 160 << 20
	clipboardOfferTTL        = time.Minute
	clipboardTransactions    = 4
	clipboardHistoryLimit    = 64
	clipboardPNGMaxDimension = 32768
	clipboardPNGMaxPixels    = 100_000_000
)

var clipboardTypeLimits = map[string]int64{
	"text/plain": clipboardPlainLimit,
	"text/html":  clipboardHTMLLimit,
	"text/rtf":   clipboardRTFLimit,
	"image/png":  clipboardPNGLimit,
}

type clipboardItem struct {
	Type string
	Data []byte
}

type clipboardOffer struct {
	ID             string          `json:"id"`
	Direction      string          `json:"direction"`
	Generation     int64           `json:"generation"`
	Sequence       uint64          `json:"sequence"`
	Baseline       bool            `json:"baseline,omitempty"`
	SourceViewerID string          `json:"sourceViewerId,omitempty"`
	Types          []string        `json:"types"`
	TotalBytes     int64           `json:"totalBytes"`
	State          string          `json:"state"`
	CreatedAt      time.Time       `json:"createdAt"`
	ExpiresAt      time.Time       `json:"expiresAt"`
	Items          []clipboardItem `json:"-"`
}

type clipboardEvent struct {
	Type       string          `json:"type"`
	Offer      *clipboardOffer `json:"offer,omitempty"`
	Generation int64           `json:"generation,omitempty"`
	Sequence   uint64          `json:"sequence,omitempty"`
	Error      string          `json:"error,omitempty"`
}

type clipboardSessionRequest struct {
	Generation int64 `json:"generation"`
	Active     bool  `json:"active"`
}

type clipboardBridge interface {
	Set([]clipboardItem, func(string, error)) error
	SetMonitoring(bool)
	Clear()
	Close() error
}

type clipboardService struct {
	mu              sync.RWMutex
	operationMu     sync.Mutex
	bridge          clipboardBridge
	generation      int64
	active          bool
	sequence        uint64
	contentDigest   string
	captureEpoch    uint64
	remoteUncertain bool
	offers          map[string]*clipboardOffer
	order           []string
	history         map[string]*clipboardOffer
	historyOrder    []string
	totalBytes      int64
	ownedOffer      string
	viewers         int
	publish         func(clipboardEvent)
	paste           func() error
	server          *http.Server
	listener        net.Listener
	done            chan struct{}
	transactionOnce sync.Once
	transactions    chan struct{}
}

func newClipboardService(display, socketPath string, publish func(clipboardEvent), paste func() error) (*clipboardService, error) {
	if !filepath.IsAbs(socketPath) {
		return nil, errors.New("clipboard socket must be an absolute path")
	}
	if err := os.MkdirAll(filepath.Dir(socketPath), 0o700); err != nil {
		return nil, fmt.Errorf("create clipboard socket directory: %w", err)
	}
	if info, err := os.Lstat(socketPath); err == nil {
		if info.Mode()&os.ModeSocket == 0 {
			return nil, fmt.Errorf("refusing to replace non-socket clipboard path %s", socketPath)
		}
		if err := os.Remove(socketPath); err != nil {
			return nil, fmt.Errorf("remove stale clipboard socket: %w", err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("inspect clipboard socket: %w", err)
	}
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		return nil, fmt.Errorf("listen on clipboard socket: %w", err)
	}
	if err := os.Chmod(socketPath, 0o600); err != nil {
		_ = listener.Close()
		return nil, fmt.Errorf("protect clipboard socket: %w", err)
	}
	service := &clipboardService{
		offers: make(map[string]*clipboardOffer), history: make(map[string]*clipboardOffer), publish: publish, paste: paste,
		listener: listener, done: make(chan struct{}), transactions: make(chan struct{}, clipboardTransactions),
	}
	bridge, err := newXClipboardBridge(display, service.captureRemote, service.captureErrorReporter)
	if err != nil {
		_ = listener.Close()
		_ = os.Remove(socketPath)
		return nil, err
	}
	service.bridge = bridge
	if native, ok := bridge.(*xClipboardBridge); ok {
		native.mu.Lock()
		native.captureRemote = service.remoteCaptureReporter
		native.mu.Unlock()
	}
	service.server = &http.Server{Handler: service.handler(), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 64 << 10}
	go func() {
		if err := service.server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			// The gateway HTTP listener and systemd lifecycle remain authoritative;
			// an internal socket failure is visible through Manager API failures.
		}
	}()
	go service.expireLoop()
	return service, nil
}

func (s *clipboardService) Close() error {
	select {
	case <-s.done:
		return nil
	default:
		close(s.done)
	}
	s.mu.Lock()
	s.active = false
	s.clearLocked()
	s.mu.Unlock()
	s.bridge.Clear()
	_ = s.bridge.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	err := s.server.Shutdown(ctx)
	_ = os.Remove(s.listener.Addr().String())
	return err
}

func (s *clipboardService) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/session", s.serveSession)
	mux.HandleFunc("/v1/capabilities", s.serveCapabilities)
	mux.HandleFunc("/v1/offers", s.serveOffers)
	mux.HandleFunc("/v1/offers/", s.serveOffer)
	return mux
}

func (s *clipboardService) serveSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, "POST")
		return
	}
	var request clipboardSessionRequest
	decoder := json.NewDecoder(io.LimitReader(r.Body, 4096))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil || request.Generation < 0 || (request.Active && request.Generation < 1) {
		writeError(w, http.StatusBadRequest, "invalid clipboard session")
		return
	}
	s.operationMu.Lock()
	defer s.operationMu.Unlock()
	s.mu.Lock()
	changed := request.Generation != s.generation || request.Active != s.active
	if changed {
		s.clearLocked()
		s.generation = request.Generation
		s.active = request.Active
	}
	viewers := s.viewers
	s.mu.Unlock()
	if changed {
		s.bridge.Clear()
	}
	s.bridge.SetMonitoring(request.Active && viewers > 0)
	writeJSON(w, http.StatusOK, map[string]any{"generation": request.Generation, "active": request.Active})
}

func (s *clipboardService) serveCapabilities(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, "GET")
		return
	}
	generation, ok := s.requireGeneration(w, r)
	if !ok {
		return
	}
	s.mu.RLock()
	sequence, settled := s.sequence, !s.remoteUncertain
	s.mu.RUnlock()
	writeJSON(w, http.StatusOK, map[string]any{
		"protocolVersion":    clipboardProtocolVersion,
		"consistencyVersion": 1,
		"sequence":           sequence,
		"settled":            settled,
		"generation":         generation,
		"directions":         map[string]bool{"toRemote": true, "toLocal": true},
		"formats":            []string{"text/plain", "text/html", "text/rtf", "image/png"},
		"limits": map[string]any{
			"text/plain": clipboardPlainLimit, "text/html": clipboardHTMLLimit,
			"text/rtf": clipboardRTFLimit, "image/png": clipboardPNGLimit,
			"total": clipboardTotalLimit, "pngMaxDimension": clipboardPNGMaxDimension,
			"pngMaxPixels": clipboardPNGMaxPixels,
		},
		"events": map[string]any{"webSocket": true, "ordered": true, "recovery": true},
	})
}

func (s *clipboardService) serveOffers(w http.ResponseWriter, r *http.Request) {
	generation, ok := s.requireGeneration(w, r)
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		s.mu.Lock()
		s.expireLocked(time.Now())
		offers := make([]*clipboardOffer, 0, len(s.order))
		for _, id := range s.order {
			if offer := s.offers[id]; offer != nil && offer.Generation == generation {
				offers = append(offers, cloneClipboardOffer(offer, false))
			}
		}
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, offers)
	case http.MethodPost:
		if !s.beginTransaction() {
			writeError(w, http.StatusTooManyRequests, "too many concurrent clipboard transactions")
			return
		}
		defer s.endTransaction()
		if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "multipart/form-data") {
			writeError(w, http.StatusUnsupportedMediaType, "clipboard offer requires multipart/form-data")
			return
		}
		action := r.Header.Get("X-RemoteXApp-Clipboard-Action")
		if action != "set" && action != "paste" {
			writeError(w, http.StatusBadRequest, "clipboard action must be set or paste")
			return
		}
		viewerID := normalizedViewerID(r.Header.Get("X-RemoteXApp-Viewer-ID"))
		if viewerID == "" {
			writeError(w, http.StatusBadRequest, "valid clipboard viewer ID is required")
			return
		}
		items, err := readClipboardMultipart(w, r)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if len(items) == 0 {
			writeJSON(w, http.StatusOK, map[string]any{"skipped": true, "reason": "empty-clipboard"})
			return
		}
		var expected *uint64
		if raw := r.Header.Get("X-RemoteXApp-Clipboard-Sequence"); raw != "" {
			value, err := strconv.ParseUint(raw, 10, 53)
			if err != nil {
				writeError(w, http.StatusBadRequest, "invalid clipboard sequence")
				return
			}
			expected = &value
		}
		offer, err := s.setRemote(generation, viewerID, action, items, expected)
		if err != nil {
			writeError(w, http.StatusConflict, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, offer)
	default:
		methodNotAllowed(w, "GET, POST")
	}
}

func (s *clipboardService) serveOffer(w http.ResponseWriter, r *http.Request) {
	_, ok := s.requireGeneration(w, r)
	if !ok {
		return
	}
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/offers/"), "/")
	parts := strings.Split(path, "/")
	if len(parts) == 0 || parts[0] == "" {
		http.NotFound(w, r)
		return
	}
	s.mu.Lock()
	s.expireLocked(time.Now())
	offer := s.offers[parts[0]]
	terminal := false
	if offer == nil {
		offer = s.history[parts[0]]
		terminal = offer != nil
	}
	if offer != nil {
		offer = cloneClipboardOffer(offer, true)
	}
	s.mu.Unlock()
	if offer == nil {
		writeError(w, http.StatusNotFound, "clipboard offer not found")
		return
	}
	if len(parts) == 1 {
		switch r.Method {
		case http.MethodGet:
			writeJSON(w, http.StatusOK, cloneClipboardOffer(offer, false))
		case http.MethodDelete:
			if terminal {
				writeError(w, http.StatusConflict, "clipboard offer is already terminal")
				return
			}
			if offer.Direction != "toRemote" {
				writeError(w, http.StatusConflict, "only toRemote offers can be cancelled")
				return
			}
			viewerID := normalizedViewerID(r.Header.Get("X-RemoteXApp-Viewer-ID"))
			if viewerID == "" || viewerID != offer.SourceViewerID {
				writeError(w, http.StatusForbidden, "only the source Viewer can cancel this offer")
				return
			}
			if s.removeOffer(offer.ID, "cancelled") {
				s.bridge.Clear()
			}
			writeJSON(w, http.StatusOK, map[string]string{"state": "cancelled"})
		default:
			methodNotAllowed(w, "GET, DELETE")
		}
		return
	}
	if len(parts) == 2 && parts[1] == "accept" && r.Method == http.MethodPost {
		s.mu.RLock()
		current := s.active && !s.remoteUncertain && offer.Generation == s.generation && offer.Sequence == s.sequence
		s.mu.RUnlock()
		if !current {
			writeError(w, http.StatusConflict, "clipboard source changed; refresh the offer")
			return
		}
		if terminal {
			writeError(w, http.StatusConflict, "clipboard offer is already terminal")
			return
		}
		if offer.Direction != "toLocal" {
			writeError(w, http.StatusConflict, "only toLocal offers can be accepted")
			return
		}
		if !s.beginTransaction() {
			writeError(w, http.StatusTooManyRequests, "too many concurrent clipboard transactions")
			return
		}
		defer s.endTransaction()
		writeClipboardMultipart(w, offer)
		return
	}
	methodNotAllowed(w, "GET, POST, DELETE")
}

func (s *clipboardService) requireGeneration(w http.ResponseWriter, r *http.Request) (int64, bool) {
	generation, err := strconv.ParseInt(r.Header.Get("X-RemoteXApp-Session-Generation"), 10, 64)
	if err != nil || generation < 1 {
		writeError(w, http.StatusBadRequest, "positive session generation is required")
		return 0, false
	}
	s.mu.RLock()
	active, current := s.active, s.generation
	s.mu.RUnlock()
	if !active {
		writeError(w, http.StatusConflict, "application session is not active")
		return 0, false
	}
	if generation != current {
		writeError(w, http.StatusConflict, "stale session generation")
		return 0, false
	}
	return generation, true
}

func (s *clipboardService) setRemote(generation int64, viewerID, action string, items []clipboardItem, expected ...*uint64) (*clipboardOffer, error) {
	s.operationMu.Lock()
	defer s.operationMu.Unlock()
	s.mu.RLock()
	valid := s.active && generation == s.generation
	if len(expected) > 0 && expected[0] != nil {
		valid = valid && !s.remoteUncertain && *expected[0] == s.sequence
	}
	s.mu.RUnlock()
	if !valid {
		return nil, errors.New("clipboard destination changed; refresh before synchronizing")
	}
	s.mu.Lock()
	s.captureEpoch++ // A pending external capture must not replay over this write.
	s.mu.Unlock()
	toRemote := s.newOffer("toRemote", generation, viewerID, items, "accepted")
	offerID := toRemote.ID
	if err := s.bridge.Set(items, func(state string, err error) {
		s.updateOffer(offerID, state, err)
	}); err != nil {
		s.updateOffer(offerID, "failed", err)
		return nil, err
	}
	s.mu.Lock()
	if offer := s.offers[offerID]; offer != nil && offer.State == "accepted" {
		offer.State = "owned"
	}
	previous := s.ownedOffer
	s.ownedOffer = offerID
	if previous != "" && previous != offerID {
		s.removeOfferLocked(previous, "cancelled")
	}
	s.mu.Unlock()
	// A Viewer-originated ownership change is still a remote clipboard change.
	// The item byte slices are shared read-only; only metadata is duplicated.
	s.captureRemoteLocked(items, viewerID)
	if action == "paste" {
		// The native bridge has already validated Shift+Insert for the supported
		// X11 applications. Selection ownership is established first.
		// paste is intentionally triggered outside the X11 selection connection.
		// The input controller owns that XTEST connection.
		if s.paste == nil {
			s.updateOffer(offerID, "failed", errors.New("clipboard paste gesture is unavailable"))
			s.clearOwnedOffer(offerID)
			s.bridge.Clear()
			return nil, errors.New("clipboard paste gesture is unavailable")
		}
		if err := s.paste(); err != nil {
			s.updateOffer(offerID, "failed", err)
			s.clearOwnedOffer(offerID)
			s.bridge.Clear()
			return nil, fmt.Errorf("send clipboard paste gesture: %w", err)
		}
	}
	s.mu.RLock()
	result := cloneClipboardOffer(s.offers[offerID], false)
	s.mu.RUnlock()
	return result, nil
}

func (s *clipboardService) captureErrorReporter() func(error) {
	s.mu.RLock()
	generation := s.generation
	s.mu.RUnlock()
	return func(err error) {
		s.mu.RLock()
		defer s.mu.RUnlock()
		if s.active && generation > 0 && generation == s.generation && s.viewers > 0 && s.publish != nil {
			s.publish(clipboardEvent{Type: "clipboard-error", Generation: generation, Error: err.Error()})
		}
	}
}

// Bind asynchronous native reads to the session and latest observed owner.
// A superseded read must not become the clipboard of a newer session/write.
func (s *clipboardService) remoteCaptureReporter(baseline ...bool) func([]clipboardItem, string) {
	s.mu.Lock()
	s.captureEpoch++
	s.remoteUncertain = true
	epoch, generation := s.captureEpoch, s.generation
	s.mu.Unlock()
	return func(items []clipboardItem, source string) {
		s.operationMu.Lock()
		defer s.operationMu.Unlock()
		s.mu.RLock()
		valid := s.active && s.generation == generation && s.captureEpoch == epoch
		s.mu.RUnlock()
		if valid {
			s.captureRemoteLocked(items, source, baseline...)
		}
	}
}

func (s *clipboardService) captureRemote(items []clipboardItem, sourceViewerID string) {
	s.operationMu.Lock()
	defer s.operationMu.Unlock()
	s.captureRemoteLocked(items, sourceViewerID)
}

// operationMu orders observed snapshots and guarded writes. This is not an
// atomic compare-and-swap with external X11 applications.
func (s *clipboardService) captureRemoteLocked(items []clipboardItem, sourceViewerID string, baseline ...bool) {
	s.mu.RLock()
	generation, active, viewers := s.generation, s.active, s.viewers
	s.mu.RUnlock()
	if !active || generation < 1 || (viewers == 0 && sourceViewerID == "") {
		return
	}
	digest := clipboardContentDigest(items)
	s.mu.Lock()
	s.remoteUncertain = false
	if digest == s.contentDigest {
		s.mu.Unlock()
		return
	}
	s.contentDigest = digest
	s.mu.Unlock()
	// Empty snapshots invalidate older offers without publishing empty payloads.
	if len(items) == 0 {
		s.mu.Lock()
		s.sequence++
		sequence := s.sequence
		s.mu.Unlock()
		if s.publish != nil {
			s.publish(clipboardEvent{Type: "clipboard-invalidated", Generation: generation, Sequence: sequence})
		}
		return
	}
	offer := s.newOffer("toLocal", generation, sourceViewerID, items, "accepted")
	// This flag describes a monitor-resumption snapshot, not a user copy.
	// Existing Viewers still compare its new revision against their own baseline.
	s.mu.Lock()
	if len(baseline) > 0 && baseline[0] {
		offer.Baseline = true
	}
	metadata := cloneClipboardOffer(offer, false)
	s.mu.Unlock()
	if s.publish != nil {
		s.publish(clipboardEvent{Type: "clipboard-offer", Offer: metadata})
	}
}

func clipboardContentDigest(items []clipboardItem) string {
	ordered := append([]clipboardItem(nil), items...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].Type < ordered[j].Type })
	h := sha256.New()
	for _, item := range ordered {
		fmt.Fprintf(h, "%d:%s:%d:", len(item.Type), item.Type, len(item.Data))
		_, _ = h.Write(item.Data)
	}
	return hex.EncodeToString(h.Sum(nil))
}

func (s *clipboardService) setViewerCount(count int) {
	if count < 0 {
		count = 0
	}
	s.mu.Lock()
	s.viewers = count
	active := s.active
	s.mu.Unlock()
	s.bridge.SetMonitoring(active && count > 0)
}

func (s *clipboardService) newOffer(direction string, generation int64, viewerID string, items []clipboardItem, state string) *clipboardOffer {
	now := time.Now().UTC()
	offer := &clipboardOffer{
		ID: newClipboardOfferID(), Direction: direction, Generation: generation,
		SourceViewerID: viewerID, State: state, CreatedAt: now, ExpiresAt: now.Add(clipboardOfferTTL),
		Items: cloneClipboardItems(items),
	}
	for _, item := range items {
		offer.Types = append(offer.Types, item.Type)
		offer.TotalBytes += int64(len(item.Data))
	}
	sort.Strings(offer.Types)
	s.mu.Lock()
	s.expireLocked(now)
	for s.totalBytes+offer.TotalBytes > clipboardRuntimeLimit && len(s.order) != 0 {
		s.removeOldestLocked("expired")
	}
	// Only broadcast offers consume the event sequence. Private toRemote
	// request records do not have a WebSocket event and must not create a false
	// sequence gap for every attached Viewer.
	if direction == "toLocal" {
		s.sequence++
		offer.Sequence = s.sequence
	}
	s.offers[offer.ID] = offer
	s.order = append(s.order, offer.ID)
	s.totalBytes += offer.TotalBytes
	s.mu.Unlock()
	return offer
}

func (s *clipboardService) clearOwnedOffer(id string) {
	s.mu.Lock()
	if s.ownedOffer == id {
		s.ownedOffer = ""
	}
	s.mu.Unlock()
}

func (s *clipboardService) beginTransaction() bool {
	s.transactionOnce.Do(func() {
		if s.transactions == nil {
			s.transactions = make(chan struct{}, clipboardTransactions)
		}
	})
	select {
	case s.transactions <- struct{}{}:
		return true
	default:
		return false
	}
}

func (s *clipboardService) endTransaction() {
	<-s.transactions
}

func (s *clipboardService) updateOffer(id, state string, stateErr error) {
	if stateErr != nil {
		state = "failed"
	}
	s.mu.Lock()
	if offer := s.offers[id]; offer != nil {
		offer.State = state
	}
	s.mu.Unlock()
}

func (s *clipboardService) removeOffer(id, state string) bool {
	s.mu.Lock()
	wasOwned := s.ownedOffer == id
	s.removeOfferLocked(id, state)
	s.mu.Unlock()
	return wasOwned
}

func (s *clipboardService) removeOfferLocked(id, state string) {
	if offer := s.offers[id]; offer != nil {
		if state == "expired" && offer.Direction == "toRemote" && (offer.State == "accepted" || offer.State == "owned") {
			state = "not-consumed"
		}
		offer.State = state
		s.totalBytes -= offer.TotalBytes
		s.rememberTerminalLocked(offer)
		delete(s.offers, id)
		for index, orderedID := range s.order {
			if orderedID == id {
				s.order = append(s.order[:index], s.order[index+1:]...)
				break
			}
		}
	}
	if s.ownedOffer == id {
		s.ownedOffer = ""
	}
}

func (s *clipboardService) rememberTerminalLocked(offer *clipboardOffer) {
	if s.history == nil {
		s.history = make(map[string]*clipboardOffer)
	}
	s.history[offer.ID] = cloneClipboardOffer(offer, false)
	s.historyOrder = append(s.historyOrder, offer.ID)
	for len(s.historyOrder) > clipboardHistoryLimit {
		delete(s.history, s.historyOrder[0])
		s.historyOrder = s.historyOrder[1:]
	}
}

func (s *clipboardService) expireLoop() {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-s.done:
			return
		case now := <-ticker.C:
			s.mu.Lock()
			s.expireLocked(now)
			s.mu.Unlock()
		}
	}
}

func (s *clipboardService) expireLocked(now time.Time) {
	for len(s.order) != 0 {
		offer := s.offers[s.order[0]]
		if offer != nil && now.Before(offer.ExpiresAt) {
			break
		}
		s.removeOldestLocked("expired")
	}
}

func (s *clipboardService) removeOldestLocked(state string) {
	if len(s.order) == 0 {
		return
	}
	id := s.order[0]
	s.removeOfferLocked(id, state)
}

func (s *clipboardService) clearLocked() {
	s.contentDigest = ""
	s.remoteUncertain = false
	s.captureEpoch++
	for id, offer := range s.offers {
		offer.State = "expired"
		delete(s.offers, id)
	}
	s.order = nil
	s.totalBytes = 0
	s.ownedOffer = ""
	s.history = make(map[string]*clipboardOffer)
	s.historyOrder = nil
}

func readClipboardMultipart(w http.ResponseWriter, r *http.Request) ([]clipboardItem, error) {
	r.Body = http.MaxBytesReader(w, r.Body, clipboardTotalLimit+(1<<20))
	reader, err := r.MultipartReader()
	if err != nil {
		return nil, fmt.Errorf("invalid multipart clipboard offer: %w", err)
	}
	seen := make(map[string]bool)
	items := make([]clipboardItem, 0, 4)
	populated := make(map[string]bool)
	var total int64
	for {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("read multipart clipboard offer: %w", err)
		}
		mediaType := canonicalClipboardType(part.Header.Get("Content-Type"))
		limit, ok := clipboardTypeLimits[mediaType]
		if !ok || seen[mediaType] {
			_ = part.Close()
			return nil, fmt.Errorf("unsupported or duplicate clipboard representation %q", mediaType)
		}
		data, err := io.ReadAll(io.LimitReader(part, limit+1))
		seen[mediaType] = true
		_ = part.Close()
		if err != nil {
			return nil, fmt.Errorf("read %s clipboard representation: %w", mediaType, err)
		}
		if int64(len(data)) > limit {
			return nil, fmt.Errorf("%s clipboard representation exceeds %d bytes", mediaType, limit)
		}
		if len(data) == 0 {
			continue
		}
		if (mediaType == "text/plain" || mediaType == "text/html") && !utf8.Valid(data) {
			return nil, fmt.Errorf("%s clipboard representation is not valid UTF-8", mediaType)
		}
		total += int64(len(data))
		if total > clipboardTotalLimit {
			return nil, fmt.Errorf("clipboard offer exceeds %d bytes", clipboardTotalLimit)
		}
		if mediaType == "image/png" {
			if err := validateClipboardPNG(data); err != nil {
				return nil, err
			}
		}
		populated[mediaType] = true
		items = append(items, clipboardItem{Type: mediaType, Data: data})
	}
	if len(seen) == 0 {
		return nil, errors.New("clipboard offer has no representations")
	}
	if populated["text/html"] && !populated["text/plain"] {
		return nil, errors.New("text/html clipboard representation requires text/plain fallback")
	}
	return items, nil
}

func writeClipboardMultipart(w http.ResponseWriter, offer *clipboardOffer) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-RemoteXApp-Clipboard-Offer-ID", offer.ID)
	writer := multipart.NewWriter(w)
	w.Header().Set("Content-Type", writer.FormDataContentType())
	for _, item := range offer.Items {
		header := make(textproto.MIMEHeader)
		header.Set("Content-Disposition", `form-data; name="item"; filename="clipboard"`)
		header.Set("Content-Type", item.Type)
		part, err := writer.CreatePart(header)
		if err != nil {
			return
		}
		if _, err := part.Write(item.Data); err != nil {
			return
		}
	}
	_ = writer.Close()
}

func canonicalClipboardType(value string) string {
	value = strings.ToLower(strings.TrimSpace(strings.Split(value, ";")[0]))
	switch value {
	case "text/plain", "text/plain;charset=utf-8", "utf8_string", "utf-8":
		return "text/plain"
	case "text/html":
		return "text/html"
	case "text/rtf", "application/rtf":
		return "text/rtf"
	case "image/png":
		return "image/png"
	default:
		return value
	}
}

func validateClipboardPNG(data []byte) error {
	if len(data) < 24 || string(data[:8]) != "\x89PNG\r\n\x1a\n" || string(data[12:16]) != "IHDR" {
		return errors.New("image/png clipboard representation has an invalid signature or IHDR")
	}
	width := int64(data[16])<<24 | int64(data[17])<<16 | int64(data[18])<<8 | int64(data[19])
	height := int64(data[20])<<24 | int64(data[21])<<16 | int64(data[22])<<8 | int64(data[23])
	if width < 1 || height < 1 || width > clipboardPNGMaxDimension || height > clipboardPNGMaxDimension || width*height > clipboardPNGMaxPixels {
		return errors.New("image/png clipboard dimensions exceed the platform limit")
	}
	return nil
}

func newClipboardOfferID() string {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		panic("crypto/rand failed: " + err.Error())
	}
	return "clp_" + hex.EncodeToString(value[:])
}

func normalizedViewerID(value string) string {
	value = strings.TrimSpace(value)
	if len(value) < 10 || len(value) > 96 || !strings.HasPrefix(value, "viewer_") {
		return ""
	}
	for _, character := range value[len("viewer_"):] {
		if character < 'a' || character > 'z' {
			if character < 'A' || character > 'Z' {
				if character < '0' || character > '9' {
					if character != '-' && character != '_' {
						return ""
					}
				}
			}
		}
	}
	return value
}

func cloneClipboardItems(items []clipboardItem) []clipboardItem {
	copyItems := make([]clipboardItem, len(items))
	for index, item := range items {
		copyItems[index] = clipboardItem{Type: item.Type, Data: append([]byte(nil), item.Data...)}
	}
	return copyItems
}

func cloneClipboardOffer(offer *clipboardOffer, includeItems bool) *clipboardOffer {
	copyOffer := *offer
	copyOffer.Types = append([]string(nil), offer.Types...)
	if includeItems {
		copyOffer.Items = cloneClipboardItems(offer.Items)
	} else {
		copyOffer.Items = nil
	}
	return &copyOffer
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func methodNotAllowed(w http.ResponseWriter, allow string) {
	w.Header().Set("Allow", allow)
	writeError(w, http.StatusMethodNotAllowed, "method not allowed")
}
