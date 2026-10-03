package main

import (
	"errors"
	"sync"
	"testing"
	"time"
)

type recordingJSONWriter struct {
	mu     sync.Mutex
	values []any
}

func (writer *recordingJSONWriter) WriteJSON(value any) error {
	writer.mu.Lock()
	writer.values = append(writer.values, value)
	writer.mu.Unlock()
	return nil
}

func (writer *recordingJSONWriter) SetWriteDeadline(time.Time) error { return nil }

func (writer *recordingJSONWriter) cursorEvents() []cursorAck {
	writer.mu.Lock()
	defer writer.mu.Unlock()
	var events []cursorAck
	for _, value := range writer.values {
		if cursor, ok := value.(cursorAck); ok {
			events = append(events, cursor)
		}
		if cursor, ok := value.(*cursorAck); ok {
			events = append(events, *cursor)
		}
	}
	return events
}

func waitForCursorEvents(t *testing.T, writer *recordingJSONWriter, count int) []cursorAck {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if events := writer.cursorEvents(); len(events) >= count {
			return events
		}
		time.Sleep(time.Millisecond)
	}
	return writer.cursorEvents()
}

func waitForCursorSequence(t *testing.T, writer *recordingJSONWriter, sequence uint64) []cursorAck {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		events := writer.cursorEvents()
		if len(events) > 0 && events[len(events)-1].Sequence == sequence {
			return events
		}
		time.Sleep(time.Millisecond)
	}
	return writer.cursorEvents()
}

func TestCursorPushCachesAndBroadcasts(t *testing.T) {
	controller := &inputController{peers: make(map[*inputPeer]struct{})}
	firstWriter := &recordingJSONWriter{}
	firstPeer := newInputPeer(firstWriter)
	controller.addPeer(firstPeer)
	defer controller.removePeer(firstPeer)

	controller.publishCursor(cursorAck{
		Type: "cursor-position", Sequence: 7, UpdatedMS: 1234, Focused: true, Enabled: true,
		Cursor: &cursorPosition{X: 10, Y: 20, Width: 1, Height: 18},
	})
	if events := waitForCursorEvents(t, firstWriter, 1); len(events) != 1 || events[0].Sequence != 7 || events[0].Cursor.X != 10 {
		t.Fatalf("first peer events: %#v", events)
	}

	secondWriter := &recordingJSONWriter{}
	secondPeer := newInputPeer(secondWriter)
	controller.addPeer(secondPeer)
	defer controller.removePeer(secondPeer)
	if events := waitForCursorEvents(t, secondWriter, 1); len(events) != 1 || events[0].Sequence != 7 {
		t.Fatalf("new peer did not receive cached snapshot: %#v", events)
	}

	controller.publishCursor(cursorAck{Type: "cursor-position", Sequence: 6, UpdatedMS: 1200})
	if snapshot := controller.cursorSnapshot(); snapshot.Sequence != 7 || snapshot.Cursor.X != 10 {
		t.Fatalf("stale cursor replaced snapshot: %#v", snapshot)
	}
	if events := firstWriter.cursorEvents(); len(events) != 1 {
		t.Fatalf("stale cursor was broadcast: %#v", events)
	}

	controller.publishCursor(cursorAck{Type: "cursor-position", Sequence: 8, UpdatedMS: 1300, Focused: true, Enabled: true})
	if events := waitForCursorEvents(t, firstWriter, 2); len(events) != 2 || events[1].Sequence != 8 {
		t.Fatalf("new cursor was not broadcast: %#v", events)
	}
}

func TestCursorAckIncludesFreshnessFields(t *testing.T) {
	cursor := cursorAck{Type: "cursor-position", Sequence: 418, UpdatedMS: 2976900055, Focused: true, Enabled: true}
	if cursor.Sequence != 418 || cursor.UpdatedMS != 2976900055 {
		t.Fatalf("unexpected cursor freshness fields: %#v", cursor)
	}
}

func TestGatewayCursorSequenceSurvivesEngineRestart(t *testing.T) {
	controller := &inputController{peers: make(map[*inputPeer]struct{})}
	controller.publishCursor(cursorAck{Type: "cursor-position", Sequence: 11, UpdatedMS: 100})

	controller.publishSourceCursor(cursorAck{Type: "cursor-position", Sequence: 2, UpdatedMS: 200})
	controller.publishSourceCursor(cursorAck{Type: "cursor-position", Sequence: 1, UpdatedMS: 201})

	snapshot := controller.cursorSnapshot()
	if snapshot == nil || snapshot.Sequence != 13 || snapshot.UpdatedMS != 201 {
		t.Fatalf("gateway cursor snapshot = %#v, want sequence 13 across restarted engines", snapshot)
	}
	if sequence := controller.cursorSequence(); sequence != 13 {
		t.Fatalf("gateway cursor sequence = %d, want 13", sequence)
	}
}

type blockingJSONWriter struct {
	started chan struct{}
	release chan struct{}
	once    sync.Once

	recordingJSONWriter
}

func newBlockingJSONWriter() *blockingJSONWriter {
	return &blockingJSONWriter{started: make(chan struct{}), release: make(chan struct{})}
}

func (writer *blockingJSONWriter) WriteJSON(value any) error {
	writer.once.Do(func() { close(writer.started) })
	<-writer.release
	return writer.recordingJSONWriter.WriteJSON(value)
}

func TestSlowCursorPeerDoesNotBlockPublisherOrFastPeer(t *testing.T) {
	controller := &inputController{peers: make(map[*inputPeer]struct{})}
	slowWriter := newBlockingJSONWriter()
	fastWriter := &recordingJSONWriter{}
	slowPeer := newInputPeer(slowWriter)
	fastPeer := newInputPeer(fastWriter)
	controller.addPeer(slowPeer)
	controller.addPeer(fastPeer)
	defer controller.removePeer(slowPeer)
	defer controller.removePeer(fastPeer)

	controller.publishCursor(cursorAck{Type: "cursor-position", Sequence: 1})
	select {
	case <-slowWriter.started:
	case <-time.After(time.Second):
		t.Fatal("slow cursor writer did not start")
	}

	started := time.Now()
	for sequence := uint64(2); sequence <= 20; sequence++ {
		controller.publishCursor(cursorAck{Type: "cursor-position", Sequence: sequence})
	}
	if elapsed := time.Since(started); elapsed > 50*time.Millisecond {
		t.Fatalf("slow peer blocked cursor publisher for %s", elapsed)
	}
	fastEvents := waitForCursorSequence(t, fastWriter, 20)
	if latest := fastEvents[len(fastEvents)-1].Sequence; latest != 20 {
		t.Fatalf("fast peer latest sequence=%d, want 20; events=%#v", latest, fastEvents)
	}

	close(slowWriter.release)
	slowEvents := waitForCursorEvents(t, &slowWriter.recordingJSONWriter, 2)
	if latest := slowEvents[len(slowEvents)-1].Sequence; latest != 20 {
		t.Fatalf("slow peer latest sequence=%d, want 20; events=%#v", latest, slowEvents)
	}
	if len(slowEvents) > 2 {
		t.Fatalf("slow peer received obsolete queued cursors: %#v", slowEvents)
	}
}

type failingJSONWriter struct {
	closed chan struct{}
	once   sync.Once
}

func (writer *failingJSONWriter) SetWriteDeadline(time.Time) error { return nil }
func (writer *failingJSONWriter) WriteJSON(any) error              { return errors.New("write failed") }
func (writer *failingJSONWriter) Close() error {
	writer.once.Do(func() { close(writer.closed) })
	return nil
}

func TestCursorWriterFailureRemovesAndClosesPeer(t *testing.T) {
	controller := &inputController{peers: make(map[*inputPeer]struct{})}
	writer := &failingJSONWriter{closed: make(chan struct{})}
	peer := newInputPeer(writer)
	controller.addPeer(peer)
	controller.publishCursor(cursorAck{Type: "cursor-position", Sequence: 1})

	select {
	case <-writer.closed:
	case <-time.After(time.Second):
		t.Fatal("failed cursor writer did not close its connection")
	}
	controller.peersMu.RLock()
	_, present := controller.peers[peer]
	controller.peersMu.RUnlock()
	if present {
		t.Fatal("failed cursor writer remained registered")
	}
}

type serializedJSONWriter struct {
	entered chan any
	release chan struct{}

	mu            sync.Mutex
	activeWriters int
	maxWriters    int
}

func newSerializedJSONWriter() *serializedJSONWriter {
	return &serializedJSONWriter{entered: make(chan any, 2), release: make(chan struct{}, 2)}
}

func (writer *serializedJSONWriter) SetWriteDeadline(time.Time) error { return nil }

func (writer *serializedJSONWriter) WriteJSON(value any) error {
	writer.mu.Lock()
	writer.activeWriters++
	if writer.activeWriters > writer.maxWriters {
		writer.maxWriters = writer.activeWriters
	}
	writer.mu.Unlock()
	writer.entered <- value
	<-writer.release
	writer.mu.Lock()
	writer.activeWriters--
	writer.mu.Unlock()
	return nil
}

func TestReliableReplyAndCursorWriterAreSerializedPerPeer(t *testing.T) {
	controller := &inputController{peers: make(map[*inputPeer]struct{})}
	writer := newSerializedJSONWriter()
	peer := newInputPeer(writer)
	controller.addPeer(peer)
	defer controller.removePeer(peer)

	controller.publishCursor(cursorAck{Type: "cursor-position", Sequence: 1})
	select {
	case <-writer.entered:
	case <-time.After(time.Second):
		t.Fatal("cursor write did not start")
	}

	replyDone := make(chan error, 1)
	go func() { replyDone <- peer.writeJSON(inputAck{Type: "text-ack", ID: 7}) }()
	select {
	case value := <-writer.entered:
		t.Fatalf("reliable reply wrote concurrently with cursor: %#v", value)
	case <-time.After(20 * time.Millisecond):
	}

	writer.release <- struct{}{}
	select {
	case <-writer.entered:
	case <-time.After(time.Second):
		t.Fatal("reliable reply did not run after cursor write")
	}
	writer.release <- struct{}{}
	if err := <-replyDone; err != nil {
		t.Fatalf("reliable reply: %v", err)
	}
	writer.mu.Lock()
	maxWriters := writer.maxWriters
	writer.mu.Unlock()
	if maxWriters != 1 {
		t.Fatalf("maximum concurrent writers=%d, want 1", maxWriters)
	}
}
