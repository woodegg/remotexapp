package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/woodegg/remotexapp/internal/sessionaudio"
)

const audioLease = 30 * time.Second
const audioMaxRoutes = 8
const audioMaxScopes = 64
const audioGrantPrefix = "remotexapp-audio."

type audioScope struct {
	id, principal, client string
	seen                  time.Time
	connection            *audioConnection
}
type audioGrant struct {
	scope      *audioScope
	runtime    string
	generation int64
	record     sessionaudio.Record
	expires    time.Time
	connection string
}
type audioRoute struct {
	runtime      string
	generation   int64
	record       sessionaudio.Record
	speaker, mic bool
	hub          *audioHub
}
type audioHub struct {
	record         sessionaudio.Record
	reader, writer *sessionaudio.Stream
	writerOwner    *audioConnection
	sequence       uint32
}
type audioOutput struct {
	kind int
	data []byte
}
type audioConnection struct {
	service     *audioService
	scope       *audioScope
	id          string
	socket      *websocket.Conn
	expires     time.Time
	routes      map[byte]*audioRoute
	output      chan audioOutput
	done        chan struct{}
	once        sync.Once
	sequence    uint32
	hasSequence bool
	dropped     uint64
}
type audioService struct {
	closed     bool
	mu         sync.Mutex
	id, cookie string
	scopes     map[[32]byte]*audioScope
	grants     map[[32]byte]*audioGrant
	hubs       map[string]*audioHub
	resolve    func(string, int64) (sessionaudio.Record, error)
}

func audioToken() string {
	var data [32]byte
	if _, err := rand.Read(data[:]); err != nil {
		panic("audio entropy unavailable")
	}
	return hex.EncodeToString(data[:])
}
func newAudioService(cookieIdentity string, resolve func(string, int64) (sessionaudio.Record, error)) *audioService {
	hash := sha256.Sum256([]byte(cookieIdentity))
	return &audioService{id: audioToken(), cookie: fmt.Sprintf("rxa_audio_%x", hash[:6]), scopes: map[[32]byte]*audioScope{}, grants: map[[32]byte]*audioGrant{}, hubs: map[string]*audioHub{}, resolve: resolve}
}
func (m *manager) audioService() *audioService {
	m.audioOnce.Do(func() { m.audio = newAudioService(m.cfg.stateDir+"\n"+m.cfg.listen, m.resolveAudioDomain) })
	return m.audio
}

// Audio only observes an already-running App. It does not attach a Viewer,
// cancel a stop, start an App, or renew its keepalive/vacancy lease.
func (m *manager) resolveAudioDomain(id string, generation int64) (sessionaudio.Record, error) {
	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()
	item := m.get(id)
	if item == nil || !isKasm(item) || item.Components.NativeAudio != sessionaudio.Protocol || item.SessionGeneration != generation || item.SessionState != "running" || (item.State != "ready" && item.State != "server-ready") {
		return sessionaudio.Record{}, errors.New("session audio unavailable")
	}
	services, err := m.readSessionServices(item)
	if err != nil || services.Audio == nil || services.State != "ready" {
		return sessionaudio.Record{}, errors.New("private audio domain unavailable")
	}
	record := *services.Audio
	if err = sessionaudio.Validate(record, item.SocketRuntime, generation); err != nil {
		return sessionaudio.Record{}, err
	}
	if err = m.checkServiceIdentity(item, sessionServiceIdentity{PID: record.PID, StartTime: record.StartTime}); err != nil {
		return sessionaudio.Record{}, err
	}
	return record, nil
}

func (m *manager) serveAudio(w http.ResponseWriter, r *http.Request) {
	if !m.cfg.nativeAudio {
		writeError(w, http.StatusNotImplemented, "native audio is not enabled")
		return
	}
	m.audioService().serve(w, r)
}

func (a *audioService) scopeLocked(r *http.Request) *audioScope {
	cookie, err := r.Cookie(a.cookie)
	if err != nil {
		return nil
	}
	key, valid := grantKey(cookie.Value)
	if !valid {
		return nil
	}
	scope := a.scopes[key]
	if scope == nil || scope.principal != grantIdentity(r) {
		return nil
	}
	return scope
}

func (a *audioService) pruneLocked() {
	now := time.Now()
	for key, g := range a.grants {
		if !now.Before(g.expires) {
			delete(a.grants, key)
		}
	}
	for key, s := range a.scopes {
		if s.connection == nil && now.Sub(s.seen) > 24*time.Hour {
			delete(a.scopes, key)
		}
	}
}

type audioRequest struct {
	Scope      string `json:"scope"`
	Client     string `json:"client"`
	Connection string `json:"connection"`
	Runtime    string `json:"runtime"`
	Generation int64  `json:"generation"`
}

func (a *audioService) serve(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	action := strings.TrimPrefix(r.URL.Path, "/api/audio/")
	if action == "ws" {
		a.upgrade(w, r)
		return
	}
	if r.Method != http.MethodPost {
		methodNotAllowed(w, "POST")
		return
	}
	var req audioRequest
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if decodeStrictJSON(r.Body, &req) != nil || grantIdentity(r) == "" {
		writeError(w, 400, "invalid audio request")
		return
	}
	// Resolve outside audio.mu: lifecycle fencing acquires lifecycleMu first.
	var record sessionaudio.Record
	if action == "route" {
		var err error
		record, err = a.resolve(req.Runtime, req.Generation)
		if err != nil {
			writeError(w, 409, "session audio unavailable")
			return
		}
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.pruneLocked()
	if a.closed {
		writeError(w, 503, "audio service is draining")
		return
	}
	scope := a.scopeLocked(r)
	if action == "context" {
		if scope == nil {
			// If the authentication principal changed, retire the old cookie epoch.
			if cookie, err := r.Cookie(a.cookie); err == nil {
				key, _ := grantKey(cookie.Value)
				if old := a.scopes[key]; old != nil {
					if old.connection != nil {
						old.connection.closeLocked("account-changed")
					}
					delete(a.scopes, key)
				}
			}
			if len(a.scopes) >= audioMaxScopes {
				writeError(w, 429, "audio scope capacity reached")
				return
			}
			token := audioToken()
			key, _ := grantKey(token)
			scope = &audioScope{id: audioToken(), principal: grantIdentity(r), seen: time.Now()}
			a.scopes[key] = scope
			http.SetCookie(w, &http.Cookie{Name: a.cookie, Value: token, Path: "/", HttpOnly: true, Secure: r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https"), SameSite: http.SameSiteStrictMode})
		}
		scope.seen = time.Now()
		writeJSON(w, 200, map[string]any{"service": a.id, "scope": scope.id, "protocol": sessionaudio.Protocol, "maxRoutes": audioMaxRoutes, "renewAfterMs": 10000, "expiresInMs": audioLease.Milliseconds()})
		return
	}
	if scope == nil || req.Scope != scope.id {
		writeError(w, 403, "audio scope rejected")
		return
	}
	scope.seen = time.Now()
	switch action {
	case "logout":
		if scope.connection != nil {
			scope.connection.closeLocked("logout")
		}
		for key, s := range a.scopes {
			if s == scope {
				delete(a.scopes, key)
			}
		}
		for key, g := range a.grants {
			if g.scope == scope {
				delete(a.grants, key)
			}
		}
		http.SetCookie(w, &http.Cookie{Name: a.cookie, Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteStrictMode})
		writeJSON(w, 200, map[string]bool{"ok": true})
	case "grant":
		if !validRequestID(req.Client) || len(req.Client) > 64 {
			writeError(w, 400, "invalid audio client")
			return
		}
		if scope.connection != nil {
			writeError(w, 409, "audio connection already owned")
			return
		}
		if len(a.grants) >= 256 {
			writeError(w, 429, "audio grant capacity reached")
			return
		}
		// One pending upgrade per scope; competing coordinators cannot grow grants.
		for key, g := range a.grants {
			if g.scope == scope && g.runtime == "" {
				delete(a.grants, key)
			}
		}
		scope.client = req.Client
		token := audioToken()
		key, _ := grantKey(token)
		a.grants[key] = &audioGrant{scope: scope, expires: time.Now().Add(audioLease)}
		writeJSON(w, 200, map[string]any{"token": token, "expiresInMs": audioLease.Milliseconds()})
	case "renew":
		c := scope.connection
		if c == nil || c.id != req.Connection || scope.client != req.Client || !time.Now().Before(c.expires) {
			writeError(w, 403, "audio connection retired")
			return
		}
		c.expires = time.Now().Add(audioLease)
		writeJSON(w, 200, map[string]any{"connection": c.id, "expiresInMs": audioLease.Milliseconds()})
	case "route":
		c := scope.connection
		if c == nil || c.id != req.Connection || scope.client != req.Client || !time.Now().Before(c.expires) {
			writeError(w, 403, "audio connection retired")
			return
		}
		if len(a.grants) >= 256 {
			writeError(w, 429, "audio grant capacity reached")
			return
		}
		token := audioToken()
		key, _ := grantKey(token)
		a.grants[key] = &audioGrant{scope: scope, runtime: req.Runtime, generation: req.Generation, record: record, connection: c.id, expires: time.Now().Add(audioLease)}
		writeJSON(w, 200, map[string]any{"token": token, "domain": record.ID, "generation": record.Generation, "protocol": record.Protocol})
	default:
		http.NotFound(w, r)
	}
}

func (a *audioService) upgrade(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, "GET")
		return
	}
	protocol := r.Header.Get("Sec-WebSocket-Protocol")
	if !strings.HasPrefix(protocol, audioGrantPrefix) || strings.Contains(protocol, ",") {
		writeError(w, 403, "audio grant required")
		return
	}
	key, valid := grantKey(strings.TrimPrefix(protocol, audioGrantPrefix))
	a.mu.Lock()
	scope := a.scopeLocked(r)
	g := a.grants[key]
	if a.closed || !valid || g == nil || scope == nil || g.scope != scope || g.runtime != "" || !time.Now().Before(g.expires) || scope.connection != nil {
		a.mu.Unlock()
		writeError(w, 403, "audio grant rejected")
		return
	}
	delete(a.grants, key)
	// Reserve before upgrade so two simultaneous handshakes cannot own one scope.
	c := &audioConnection{service: a, scope: scope, id: audioToken(), expires: time.Now().Add(audioLease), routes: map[byte]*audioRoute{}, output: make(chan audioOutput, 8), done: make(chan struct{})}
	scope.connection = c
	up := websocket.Upgrader{ReadBufferSize: 4096, WriteBufferSize: 4096, CheckOrigin: sameOrigin, Subprotocols: []string{protocol}}
	socket, err := up.Upgrade(w, r, nil)
	if err != nil {
		scope.connection = nil
		a.mu.Unlock()
		return
	}
	c.socket = socket
	a.mu.Unlock()
	defer func() { a.mu.Lock(); c.closeLocked("closed"); a.mu.Unlock() }()
	socket.SetReadLimit(8192)
	_ = socket.SetReadDeadline(time.Now().Add(45 * time.Second))
	socket.SetPongHandler(func(string) error { return socket.SetReadDeadline(time.Now().Add(45 * time.Second)) })
	go c.writeLoop()
	go c.watch()
	c.sendJSON(map[string]any{"type": "connected", "connection": c.id, "protocol": sessionaudio.Protocol, "expiresInMs": audioLease.Milliseconds()})
	window := time.Now()
	messages := 0
	binaryMessages := 0
	for {
		kind, data, err := socket.ReadMessage()
		if err != nil {
			return
		}
		if time.Since(window) >= time.Second {
			window = time.Now()
			messages = 0
			binaryMessages = 0
		}
		if kind == websocket.BinaryMessage {
			binaryMessages++
			if binaryMessages > 100 {
				return
			}
			if !c.microphone(data) {
				return
			}
			continue
		}
		if kind != websocket.TextMessage || len(data) > 4096 {
			return
		}
		messages++
		if messages > 30 {
			return
		}
		if !c.control(data) {
			return
		}
	}
}

func (c *audioConnection) sendJSON(value any) {
	data, _ := json.Marshal(value)
	select {
	case c.output <- audioOutput{websocket.TextMessage, data}:
	case <-c.done:
	default:
		c.socket.Close()
	}
}
func (c *audioConnection) sendPCM(data []byte) {
	select {
	case c.output <- audioOutput{websocket.BinaryMessage, data}:
	default:
		c.dropped++
	}
}
func (c *audioConnection) writeLoop() {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-c.done:
			return
		case out := <-c.output:
			_ = c.socket.SetWriteDeadline(time.Now().Add(3 * time.Second))
			if c.socket.WriteMessage(out.kind, out.data) != nil {
				c.socket.Close()
				return
			}
		case <-ticker.C:
			if c.socket.WriteControl(websocket.PingMessage, nil, time.Now().Add(3*time.Second)) != nil {
				c.socket.Close()
				return
			}
		}
	}
}

func (c *audioConnection) closeLocked(reason string) {
	c.once.Do(func() {
		close(c.done)
		if c.socket != nil {
			_ = c.socket.Close()
		}
		for slot := range c.routes {
			c.removeLocked(slot, reason)
		}
		if c.scope.connection == c {
			c.scope.connection = nil
		}
		c.scope.seen = time.Now()
	})
}
func (c *audioConnection) removeLocked(slot byte, reason string) {
	route := c.routes[slot]
	if route == nil {
		return
	}
	delete(c.routes, slot)
	hub := route.hub
	if hub.writerOwner == c {
		c.service.retireWriterLocked(hub)
	}
	c.service.trimHubLocked(hub)
	c.sendJSON(map[string]any{"type": "state", "slot": slot, "runtime": route.runtime, "generation": route.generation, "speaker": false, "mic": false, "reason": reason})
}
func (a *audioService) trimHubLocked(hub *audioHub) {
	speaker := false
	used := false
	for _, scope := range a.scopes {
		if c := scope.connection; c != nil {
			for _, r := range c.routes {
				if r.hub == hub {
					used = true
					speaker = speaker || r.speaker
				}
			}
		}
	}
	if !speaker && hub.reader != nil {
		hub.reader.Close()
		hub.reader = nil
	}
	if !used && hub.writer == nil {
		delete(a.hubs, hub.record.ID)
	}
}

// Fence the old process before granting a new microphone writer. A slow exit
// keeps the domain reserved; it must never result in overlapping writers.
func (a *audioService) retireWriterLocked(hub *audioHub) {
	hub.writerOwner = nil
	writer := hub.writer
	if writer == nil {
		return
	}
	writer.Close()
	select {
	case <-writer.Done():
		hub.writer = nil
	case <-time.After(time.Second):
		go func() {
			<-writer.Done()
			a.mu.Lock()
			defer a.mu.Unlock()
			if a.hubs[hub.record.ID] == hub && hub.writer == writer {
				hub.writer = nil
				a.trimHubLocked(hub)
			}
		}()
	}
}

type audioControl struct {
	Op       string `json:"op"`
	Request  string `json:"request"`
	Slot     byte   `json:"slot"`
	Token    string `json:"token,omitempty"`
	Speaker  bool   `json:"speaker"`
	Mic      bool   `json:"mic"`
	Takeover bool   `json:"takeover"`
}

func (c *audioConnection) control(data []byte) bool {
	var cmd audioControl
	dec := json.NewDecoder(strings.NewReader(string(data)))
	dec.DisallowUnknownFields()
	if dec.Decode(&cmd) != nil || cmd.Slot < 1 || cmd.Slot > audioMaxRoutes || len(cmd.Request) > 64 {
		return false
	}
	var trailing any
	if dec.Decode(&trailing) != io.EOF {
		return false
	}
	a := c.service
	// Read the grant identity, validate it against lifecycle outside audio.mu,
	// then consume under lock. Fencing also deletes unconsumed runtime grants.
	var validated sessionaudio.Record
	if cmd.Op == "subscribe" {
		key, valid := grantKey(cmd.Token)
		a.mu.Lock()
		g := a.grants[key]
		var runtime string
		var generation int64
		if valid && g != nil && g.scope == c.scope && g.connection == c.id && time.Now().Before(g.expires) {
			runtime, generation = g.runtime, g.generation
		}
		a.mu.Unlock()
		var err error
		if runtime == "" {
			err = errors.New("grant rejected")
		} else {
			validated, err = a.resolve(runtime, generation)
		}
		if err != nil {
			c.sendJSON(map[string]any{"type": "error", "request": cmd.Request, "slot": cmd.Slot, "reason": "audio-grant-rejected"})
			return true
		}
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if c.scope.connection != c || !time.Now().Before(c.expires) {
		return false
	}
	if cmd.Op == "unsubscribe" {
		c.removeLocked(cmd.Slot, "disabled")
		c.sendJSON(map[string]any{"type": "ack", "request": cmd.Request, "slot": cmd.Slot})
		return true
	}
	if cmd.Op != "subscribe" {
		return false
	}
	key, valid := grantKey(cmd.Token)
	g := a.grants[key]
	if !valid || g == nil || g.scope != c.scope || g.connection != c.id || !time.Now().Before(g.expires) || g.record.ID != validated.ID {
		c.sendJSON(map[string]any{"type": "error", "request": cmd.Request, "slot": cmd.Slot, "reason": "audio-grant-retired"})
		return true
	}
	delete(a.grants, key)
	for slot, r := range c.routes {
		if slot != cmd.Slot && r.runtime == g.runtime {
			c.sendJSON(map[string]any{"type": "error", "request": cmd.Request, "slot": cmd.Slot, "reason": "duplicate-session"})
			return true
		}
	}
	if old := c.routes[cmd.Slot]; old != nil {
		c.removeLocked(cmd.Slot, "reconfigured")
	}
	hub := a.hubs[g.record.ID]
	if hub == nil {
		hub = &audioHub{record: g.record}
		a.hubs[g.record.ID] = hub
	}
	route := &audioRoute{runtime: g.runtime, generation: g.generation, record: g.record, hub: hub, speaker: cmd.Speaker}
	c.routes[cmd.Slot] = route
	reason := ""
	if cmd.Speaker && hub.reader == nil {
		reader, err := sessionaudio.OpenReader(g.record, func(pcm []byte) {
			a.mu.Lock()
			defer a.mu.Unlock()
			if a.hubs[hub.record.ID] != hub {
				return
			}
			hub.sequence++
			for _, scope := range a.scopes {
				if peer := scope.connection; peer != nil {
					for slot, r := range peer.routes {
						if r.hub == hub && r.speaker {
							peer.sendPCM(sessionaudio.Packet(1, slot, hub.sequence, pcm))
						}
					}
				}
			}
		})
		if err != nil {
			route.speaker = false
			reason = "speaker-unavailable"
		} else {
			hub.reader = reader
		}
	}
	if cmd.Mic {
		if hub.writerOwner != nil && hub.writerOwner != c && !cmd.Takeover {
			reason = "mic-conflict"
		} else {
			if old := hub.writerOwner; old != nil && old != c {
				a.retireWriterLocked(hub)
				for slot, r := range old.routes {
					if r.hub == hub {
						r.mic = false
						old.sendJSON(map[string]any{"type": "state", "slot": slot, "runtime": r.runtime, "generation": r.generation, "speaker": r.speaker, "mic": false, "reason": "mic-taken-over"})
					}
				}
			}
			hub.writerOwner = nil
			var writer *sessionaudio.Stream
			var err error
			if hub.writer != nil {
				err = errors.New("previous microphone writer is still retiring")
			} else {
				writer, err = sessionaudio.OpenWriter(g.record)
			}
			if err != nil {
				reason = "mic-unavailable"
			} else {
				hub.writer = writer
				hub.writerOwner = c
				route.mic = true
			}
		}
	}
	a.trimHubLocked(hub)
	c.sendJSON(map[string]any{"type": "state", "request": cmd.Request, "slot": cmd.Slot, "runtime": route.runtime, "generation": route.generation, "domain": route.record.ID, "speaker": route.speaker, "mic": route.mic, "reason": reason})
	return true
}

func (c *audioConnection) microphone(data []byte) bool {
	_, sequence, pcm, err := sessionaudio.ParsePacket(data, 2)
	if err != nil {
		return false
	}
	a := c.service
	a.mu.Lock()
	defer a.mu.Unlock()
	if c.scope.connection != c || !time.Now().Before(c.expires) {
		return false
	}
	if c.hasSequence && (sequence-c.sequence == 0 || sequence-c.sequence >= 1<<31) {
		return false
	}
	c.sequence = sequence
	c.hasSequence = true
	for _, route := range c.routes {
		if route.mic && route.hub.writerOwner == c && route.hub.writer != nil {
			route.hub.writer.Push(pcm)
		}
	}
	return true
}

func (c *audioConnection) watch() {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-c.done:
			return
		case <-ticker.C:
		}
		a := c.service
		a.mu.Lock()
		if !time.Now().Before(c.expires) {
			c.closeLocked("lease-expired")
			a.mu.Unlock()
			return
		}
		type snapshot struct {
			slot  byte
			route *audioRoute
		}
		routes := make([]snapshot, 0, len(c.routes))
		for slot, r := range c.routes {
			routes = append(routes, snapshot{slot, r})
		}
		a.mu.Unlock()
		for _, snap := range routes {
			record, err := a.resolve(snap.route.runtime, snap.route.generation)
			a.mu.Lock()
			if c.routes[snap.slot] == snap.route {
				if err != nil || record.ID != snap.route.record.ID {
					c.removeLocked(snap.slot, "domain-retired")
				} else {
					hub := snap.route.hub
					if hub.reader != nil {
						select {
						case <-hub.reader.Done():
							hub.reader = nil
							a.failStreamLocked(hub, "speaker-ended")
						default:
						}
					}
					if hub.writer != nil && hub.writerOwner == c {
						select {
						case <-hub.writer.Done():
							hub.writer = nil
							hub.writerOwner = nil
							a.failStreamLocked(hub, "mic-ended")
						default:
						}
					}
				}
			}
			a.mu.Unlock()
		}
	}
}

// Requires lifecycle serialization, but never takes it while holding audio.mu.
func (m *manager) fenceAudio(id string, generation int64) {
	a := m.audioService()
	a.mu.Lock()
	defer a.mu.Unlock()
	for key, g := range a.grants {
		if g.runtime == id && g.generation <= generation {
			delete(a.grants, key)
		}
	}
	for _, scope := range a.scopes {
		if c := scope.connection; c != nil {
			for slot, r := range c.routes {
				if r.runtime == id && r.generation <= generation {
					c.removeLocked(slot, "generation-retired")
				}
			}
		}
	}
}

// HTTP Shutdown does not own upgraded sockets. Close and reap relay children
// explicitly; the session supervisors/private Pulse domains remain App-owned.
func (m *manager) closeAudio() {
	a := m.audioService()
	a.mu.Lock()
	a.closed = true
	var streams []*sessionaudio.Stream
	for _, hub := range a.hubs {
		if hub.reader != nil {
			streams = append(streams, hub.reader)
		}
		if hub.writer != nil {
			streams = append(streams, hub.writer)
		}
	}
	for _, scope := range a.scopes {
		if c := scope.connection; c != nil {
			c.closeLocked("manager-stopping")
		}
	}
	a.grants = map[[32]byte]*audioGrant{}
	a.mu.Unlock()
	deadline := time.After(2 * time.Second)
	for _, stream := range streams {
		stream.Close()
		select {
		case <-stream.Done():
		case <-deadline:
			return
		}
	}
}

func (a *audioService) failStreamLocked(hub *audioHub, reason string) {
	for _, scope := range a.scopes {
		if peer := scope.connection; peer != nil {
			for slot, route := range peer.routes {
				if route.hub == hub {
					if reason == "speaker-ended" {
						route.speaker = false
					} else {
						route.mic = false
					}
					peer.sendJSON(map[string]any{"type": "state", "slot": slot, "runtime": route.runtime, "generation": route.generation, "speaker": route.speaker, "mic": route.mic, "reason": reason})
				}
			}
		}
	}
}
