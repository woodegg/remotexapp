package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"strings"
	"time"
)

const (
	textLogErrors   = "errors"
	textLogMetadata = "metadata"
	textLogContent  = "content"
)

func normalizedTextLogLevel(level string) string {
	if level == "" {
		return textLogErrors
	}
	return level
}

func validTextLogLevel(level string) bool {
	switch normalizedTextLogLevel(level) {
	case textLogErrors, textLogMetadata, textLogContent:
		return true
	default:
		return false
	}
}

func (i *inputController) textMetadataEnabled() bool {
	level := normalizedTextLogLevel(i.textLogLevel)
	return level == textLogMetadata || level == textLogContent
}

func (i *inputController) textContentEnabled() bool {
	return normalizedTextLogLevel(i.textLogLevel) == textLogContent
}

func (i *inputController) logTextMetadata(format string, arguments ...any) {
	if i.textMetadataEnabled() {
		log.Printf(format, arguments...)
	}
}

func (i *inputController) logTextReceived(value string) {
	if i.textContentEnabled() {
		log.Printf("text input received: bytes=%d value=%q", len(value), value)
	} else {
		i.logTextMetadata("text input received: bytes=%d", len(value))
	}
}

func (i *inputController) serve(w http.ResponseWriter, r *http.Request) {
	connection, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	connection.SetReadLimit(16 << 10)
	peer := newInputPeer(connection, normalizedViewerID(r.URL.Query().Get("viewerId")))
	i.addPeer(peer)
	defer func() { i.removePeer(peer) }()
	metrics.activeInput.Add(1)
	metrics.totalInput.Add(1)
	defer metrics.activeInput.Add(-1)
	for {
		_, payload, err := connection.ReadMessage()
		if err != nil {
			return
		}
		var message inputMessage
		if len(payload) > 8192 || json.Unmarshal(payload, &message) != nil {
			continue
		}
		started := time.Now()
		inputErr := i.handle(message)
		if message.Type == "text" {
			elapsed := time.Since(started)
			metrics.textRequests.Add(1)
			metrics.textBytes.Add(uint64(len(message.Value)))
			metrics.textMicros.Add(uint64(elapsed.Microseconds()))
			errorText := ""
			if inputErr != nil {
				metrics.textErrors.Add(1)
				errorText = inputErr.Error()
				log.Printf("text input rejected: id=%d elapsed=%s error=%v", message.ID, elapsed.Round(time.Microsecond), inputErr)
			} else if i.textMetadataEnabled() {
				log.Printf("text input complete: id=%d elapsed=%s", message.ID, elapsed.Round(time.Microsecond))
			}
			if err := peer.writeJSON(inputAck{
				Type:     "text-ack",
				ID:       message.ID,
				ServerMS: float64(elapsed.Microseconds()) / 1000,
				Error:    errorText,
			}); err != nil {
				return
			}
		} else if message.Type == "cursor" {
			response, cursorErr := i.ibusCursor()
			if cursorErr != nil {
				response.Error = cursorErr.Error()
			}
			if err := peer.writeJSON(response); err != nil {
				return
			}
		}
	}
}

func (i *inputController) handle(message inputMessage) error {
	switch message.Type {
	case "pointer":
		i.pointer(message)
	case "wheel":
		i.wheel(message)
	case "key":
		if validKey(message.Value) {
			if err := i.x11.key(message.Value); err != nil {
				log.Printf("XTEST key %q: %v", message.Value, err)
			}
		}
	case "text":
		if len(message.Value) > 0 && len(message.Value) <= 4096 {
			i.logTextReceived(message.Value)
			return i.pasteUnicode(message.Value)
		}
		return fmt.Errorf("invalid text input")
	case "client-event":
		// Browser IME behaviour varies by engine. Keep a short, explicit trace
		// in the gateway log while this POC validates input-method switching.
		log.Printf("client event: %s", message.Value)
	}
	return nil
}

func (i *inputController) pointer(message inputMessage) {
	if message.X < 0 || message.X > 1 || message.Y < 0 || message.Y > 1 {
		return
	}
	width, height := i.x11.size()
	if width < 1 || height < 1 {
		return
	}
	x := int(message.X*float64(width-1) + .5)
	y := int(message.Y*float64(height-1) + .5)
	switch message.Action {
	case "move":
		if err := i.x11.move(x, y); err != nil {
			log.Printf("XTEST move: %v", err)
		}
	case "down":
		if err := i.x11.button(x, y, xButton(message.Button), true); err != nil {
			log.Printf("XTEST button down: %v", err)
		}
	case "up":
		if err := i.x11.button(x, y, xButton(message.Button), false); err != nil {
			log.Printf("XTEST button up: %v", err)
		}
	}
}

func (i *inputController) wheel(message inputMessage) {
	if message.X < 0 || message.X > 1 || message.Y < 0 || message.Y > 1 || message.DeltaY == 0 {
		return
	}
	width, height := i.x11.size()
	if width < 1 || height < 1 {
		return
	}
	x := int(message.X*float64(width-1) + .5)
	y := int(message.Y*float64(height-1) + .5)
	button := 4
	if message.DeltaY > 0 {
		button = 5
	}
	if err := i.x11.click(x, y, button); err != nil {
		log.Printf("XTEST wheel: %v", err)
	}
}

func xButton(button int) int {
	switch button {
	case 1:
		return 2
	case 2:
		return 3
	default:
		return 1
	}
}

func classAllowList(value string) map[string]struct{} {
	allowed := make(map[string]struct{})
	for _, class := range strings.Split(value, ",") {
		class = normalizeX11Class(class)
		if class != "" {
			allowed[class] = struct{}{}
		}
	}
	return allowed
}

// WM_CLASS casing is application-defined. For example Mousepad currently
// reports "Mousepad", while its executable and our class configuration use
// "mousepad". Treat class identifiers as case-insensitive without weakening
// the exact-name allow-list.
func normalizeX11Class(class string) string {
	return strings.ToLower(strings.TrimSpace(class))
}

func x11ClassAllowed(allowed map[string]struct{}, class string) bool {
	if _, ok := allowed["*"]; ok {
		return normalizeX11Class(class) != ""
	}
	_, ok := allowed[normalizeX11Class(class)]
	return ok
}

func validKey(value string) bool {
	if len(value) == 0 || len(value) > 48 {
		return false
	}
	parts := strings.Split(value, "+")
	if len(parts) == 0 || len(parts) > 5 {
		return false
	}
	for _, modifier := range parts[:len(parts)-1] {
		if modifier != "ctrl" && modifier != "alt" && modifier != "shift" && modifier != "super" {
			return false
		}
	}
	key := parts[len(parts)-1]
	if len(key) == 1 && ((key[0] >= 'a' && key[0] <= 'z') || (key[0] >= 'A' && key[0] <= 'Z') || (key[0] >= '0' && key[0] <= '9')) {
		return true
	}
	switch key {
	case "Return", "BackSpace", "Escape", "Tab", "Left", "Right", "Up", "Down", "Delete", "Home", "End", "Prior", "Next":
		return true
	}
	return len(key) == 2 && key[0] == 'F' && key[1] >= '1' && key[1] <= '9' ||
		len(key) == 3 && key[0] == 'F' && key[1] == '1' && key[2] >= '0' && key[2] <= '2'
}

func (i *inputController) pasteUnicode(value string) error {
	if i.textBackend == "ibus" {
		i.logTextMetadata("text input: start IBus commit bytes=%d", len(value))
		return i.ibusCommit(value)
	}
	if i.textBackend == "keysym" {
		i.logTextMetadata("text input: start Unicode keysym injection bytes=%d", len(value))
		sent, err := i.x11.unicodeKeysyms(value)
		if err != nil {
			return fmt.Errorf("Unicode keysyms sent=%d: %w", sent, err)
		}
		i.logTextMetadata("text input: Unicode keysyms sent characters=%d", sent)
		return nil
	}
	i.logTextMetadata("text input: start clipboard paste bytes=%d", len(value))
	served, err := i.x11.clipboardPaste(value, 120*time.Millisecond)
	if err != nil {
		return err
	}
	if served {
		i.logTextMetadata("text input: native X11 selection served UTF-8")
	} else {
		log.Printf("text input: native X11 selection timed out without a UTF-8 request")
	}
	return nil
}

type imeSocketRequest struct {
	Text string `json:"text"`
}

type imeSocketResponse struct {
	OK        bool            `json:"ok"`
	Error     string          `json:"error,omitempty"`
	Focused   bool            `json:"focused,omitempty"`
	Enabled   bool            `json:"enabled,omitempty"`
	Cursor    *cursorPosition `json:"cursor,omitempty"`
	UpdatedMS int64           `json:"updatedMs,omitempty"`
	Type      string          `json:"type,omitempty"`
	Sequence  uint64          `json:"sequence,omitempty"`
}

func (i *inputController) ibusCursor() (cursorAck, error) {
	response := cursorAck{Type: "cursor-position"}
	if i.textBackend != "ibus" {
		return response, fmt.Errorf("cursor position requires the ibus backend")
	}
	connection, err := net.DialTimeout("unix", i.imeSocket, 250*time.Millisecond)
	if err != nil {
		return response, err
	}
	defer connection.Close()
	if err := connection.SetDeadline(time.Now().Add(250 * time.Millisecond)); err != nil {
		return response, err
	}
	if err := json.NewEncoder(connection).Encode(map[string]string{"action": "cursor"}); err != nil {
		return response, err
	}
	var socketResponse imeSocketResponse
	if err := json.NewDecoder(connection).Decode(&socketResponse); err != nil {
		return response, err
	}
	if !socketResponse.OK {
		return response, errors.New("IBus engine is not active")
	}
	response.Focused = socketResponse.Focused
	response.Enabled = socketResponse.Enabled
	response.Cursor = socketResponse.Cursor
	response.Sequence = i.cursorSequence()
	response.UpdatedMS = socketResponse.UpdatedMS
	return response, nil
}

func (p *inputPeer) writeJSON(value any) error {
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	if err := p.connection.SetWriteDeadline(time.Now().Add(500 * time.Millisecond)); err != nil {
		return err
	}
	err := p.connection.WriteJSON(value)
	_ = p.connection.SetWriteDeadline(time.Time{})
	return err
}

func newInputPeer(connection jsonWriter, viewerID ...string) *inputPeer {
	id := ""
	if len(viewerID) != 0 {
		id = viewerID[0]
	}
	return &inputPeer{
		viewerID:    id,
		connection:  connection,
		cursorQueue: make(chan cursorAck, 1),
		reliable:    make(chan any, 32),
		done:        make(chan struct{}),
	}
}

// startCursorWriter gives each input peer an independent cursor-snapshot
// writer. Reliable replies still use writeJSON directly; writeMu serializes
// both paths because Gorilla WebSocket permits only one concurrent writer.
func (p *inputPeer) startCursorWriter(onError func(error)) {
	p.writerOnce.Do(func() {
		go func() {
			for {
				select {
				case <-p.done:
					return
				case event := <-p.reliable:
					if err := p.writeJSON(event); err != nil {
						onError(err)
						return
					}
				case cursor := <-p.cursorQueue:
					select {
					case <-p.done:
						return
					default:
					}
					if err := p.writeJSON(cursor); err != nil {
						onError(err)
						return
					}
				}
			}
		}()
	})
}

// offerReliable queues ordered, non-replaceable metadata. A peer that cannot
// keep up is disconnected instead of silently losing an event; reconnect and
// the Manager list API provide deterministic recovery.
func (p *inputPeer) offerReliable(event any) bool {
	select {
	case <-p.done:
		return false
	case p.reliable <- event:
		return true
	default:
		p.stop()
		return false
	}
}

func (i *inputController) broadcastClipboard(event clipboardEvent) {
	i.peersMu.RLock()
	peers := make([]*inputPeer, 0, len(i.peers))
	for peer := range i.peers {
		peers = append(peers, peer)
	}
	i.peersMu.RUnlock()
	for _, peer := range peers {
		if !peer.offerReliable(event) {
			i.removePeer(peer)
		}
	}
}

// offerCursor never performs network I/O and never blocks. Cursor messages are
// state snapshots, so replacing an older queued position is lossless: after an
// in-flight write finishes, the peer receives the newest known position.
func (p *inputPeer) offerCursor(cursor cursorAck) {
	copy := cursor
	if cursor.Cursor != nil {
		cursorCopy := *cursor.Cursor
		copy.Cursor = &cursorCopy
	}
	p.cursorMu.Lock()
	defer p.cursorMu.Unlock()
	select {
	case <-p.done:
		return
	default:
	}
	select {
	case <-p.cursorQueue:
	default:
	}
	p.cursorQueue <- copy
}

func (p *inputPeer) stop() {
	p.stopOnce.Do(func() {
		close(p.done)
		if closer, ok := p.connection.(interface{ Close() error }); ok {
			_ = closer.Close()
		}
	})
}

func (i *inputController) addPeer(peer *inputPeer) {
	peer.startCursorWriter(func(error) {
		i.removePeer(peer)
	})
	i.peersMu.Lock()
	if i.peers == nil {
		i.peers = make(map[*inputPeer]struct{})
	}
	i.peers[peer] = struct{}{}
	peerCount := len(i.peers)
	i.peersMu.Unlock()
	if i.clipboard != nil {
		i.clipboard.setViewerCount(peerCount)
	}
	if cursor := i.cursorSnapshot(); cursor != nil {
		peer.offerCursor(*cursor)
	}
}

func (i *inputController) removePeer(peer *inputPeer) {
	i.peersMu.Lock()
	delete(i.peers, peer)
	peerCount := len(i.peers)
	i.peersMu.Unlock()
	if i.clipboard != nil {
		i.clipboard.setViewerCount(peerCount)
	}
	peer.stop()
}

func (i *inputController) cursorSnapshot() *cursorAck {
	i.cursorMu.RLock()
	defer i.cursorMu.RUnlock()
	if i.latestCursor == nil {
		return nil
	}
	copy := *i.latestCursor
	if i.latestCursor.Cursor != nil {
		cursorCopy := *i.latestCursor.Cursor
		copy.Cursor = &cursorCopy
	}
	return &copy
}

func (i *inputController) cursorSequence() uint64 {
	i.cursorMu.RLock()
	defer i.cursorMu.RUnlock()
	if i.latestCursor == nil {
		return 0
	}
	return i.latestCursor.Sequence
}

func (i *inputController) publishCursor(cursor cursorAck) {
	if cursor.Type == "" {
		cursor.Type = "cursor-position"
	}
	i.cursorMu.Lock()
	if i.latestCursor != nil && cursor.Sequence < i.latestCursor.Sequence {
		i.cursorMu.Unlock()
		return
	}
	copy := cursor
	i.latestCursor = &copy
	i.cursorMu.Unlock()

	i.peersMu.RLock()
	peers := make([]*inputPeer, 0, len(i.peers))
	for peer := range i.peers {
		peers = append(peers, peer)
	}
	i.peersMu.RUnlock()
	for _, peer := range peers {
		peer.offerCursor(cursor)
	}
}

func (i *inputController) publishSourceCursor(cursor cursorAck) {
	if cursor.Type == "" {
		cursor.Type = "cursor-position"
	}
	i.cursorMu.Lock()
	cursor.Sequence = 1
	if i.latestCursor != nil {
		cursor.Sequence = i.latestCursor.Sequence + 1
	}
	copy := cursor
	i.latestCursor = &copy
	i.cursorMu.Unlock()

	i.peersMu.RLock()
	peers := make([]*inputPeer, 0, len(i.peers))
	for peer := range i.peers {
		peers = append(peers, peer)
	}
	i.peersMu.RUnlock()
	for _, peer := range peers {
		peer.offerCursor(cursor)
	}
}

func (i *inputController) subscribeIBusCursor() {
	delay := 100 * time.Millisecond
	unavailableLogged := false
	for {
		connection, err := net.DialTimeout("unix", i.imeSocket, time.Second)
		if err != nil {
			if !unavailableLogged {
				log.Printf("IBus cursor subscription unavailable; retrying: %v", err)
				unavailableLogged = true
			}
			time.Sleep(delay)
			if delay < time.Second {
				delay *= 2
			}
			continue
		}
		if err := json.NewEncoder(connection).Encode(map[string]string{"action": "subscribe-cursor"}); err != nil {
			_ = connection.Close()
			time.Sleep(delay)
			continue
		}
		log.Printf("IBus cursor subscription connected")
		unavailableLogged = false
		delay = 100 * time.Millisecond
		decoder := json.NewDecoder(connection)
		for {
			var cursor cursorAck
			if err := decoder.Decode(&cursor); err != nil {
				log.Printf("IBus cursor subscription ended: %v", err)
				break
			}
			if cursor.Type != "cursor-position" {
				continue
			}
			// Engine sequence numbers restart both when a session is recreated and
			// when the user switches away from and back to this engine. The gateway
			// owns the public sequence so its long-lived stream remains monotonic.
			i.publishSourceCursor(cursor)
		}
		_ = connection.Close()
		time.Sleep(delay)
	}
}

// ibusCommit talks only to a mode-0600 Unix socket owned by the same disposable
// VNC session. The browser never gets access to D-Bus or to an arbitrary socket.
func (i *inputController) ibusCommit(value string) error {
	class, err := i.x11.focusedClass()
	if err != nil {
		return err
	}
	if !x11ClassAllowed(i.ibusFocusClasses, class) {
		return fmt.Errorf("IBus commit refused: focused X11 class %q is not allowed", class)
	}
	connection, err := net.DialTimeout("unix", i.imeSocket, time.Second)
	if err != nil {
		return err
	}
	defer connection.Close()
	if err := connection.SetDeadline(time.Now().Add(time.Second)); err != nil {
		return err
	}
	if err := json.NewEncoder(connection).Encode(imeSocketRequest{Text: value}); err != nil {
		return err
	}
	var response imeSocketResponse
	if err := json.NewDecoder(connection).Decode(&response); err != nil {
		return err
	}
	if !response.OK {
		if response.Error == "" {
			response.Error = "engine rejected text"
		}
		return fmt.Errorf("%s", response.Error)
	}
	i.logTextMetadata("text input: IBus committed")
	return nil
}
