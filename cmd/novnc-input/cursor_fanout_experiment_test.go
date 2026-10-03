//go:build p11experiment

package main

import (
	"runtime"
	"sync"
	"testing"
	"time"
)

const p11CursorEvents = 32

type p11DelayedWriter struct {
	delay time.Duration

	mu        sync.Mutex
	sequences []uint64
	latestAt  time.Time
}

func (writer *p11DelayedWriter) SetWriteDeadline(time.Time) error { return nil }

func (writer *p11DelayedWriter) WriteJSON(value any) error {
	if writer.delay > 0 {
		time.Sleep(writer.delay)
	}
	cursor, ok := value.(cursorAck)
	if !ok {
		if pointer, pointerOK := value.(*cursorAck); pointerOK {
			cursor = *pointer
			ok = true
		}
	}
	if ok {
		writer.mu.Lock()
		writer.sequences = append(writer.sequences, cursor.Sequence)
		if cursor.Sequence == p11CursorEvents {
			writer.latestAt = time.Now()
		}
		writer.mu.Unlock()
	}
	return nil
}

func (writer *p11DelayedWriter) result(started time.Time) (int, time.Duration, bool) {
	writer.mu.Lock()
	defer writer.mu.Unlock()
	if writer.latestAt.IsZero() {
		return len(writer.sequences), 0, false
	}
	return len(writer.sequences), writer.latestAt.Sub(started), true
}

func waitP11Latest(t *testing.T, writer *p11DelayedWriter, started time.Time) (int, time.Duration) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if delivered, latency, ok := writer.result(started); ok {
			return delivered, latency
		}
		time.Sleep(time.Millisecond)
	}
	delivered, _, _ := writer.result(started)
	t.Fatalf("latest cursor sequence was not delivered; delivered=%d", delivered)
	return 0, 0
}

// TestP11CursorFanoutExperiment is deliberately build-tagged. It runs the
// production publishCursor path against one delayed peer and one fast peer.
// The pre-P11 serial implementation takes approximately events*delay to
// publish; the P11 implementation returns immediately and coalesces pending
// snapshots while still delivering the newest sequence.
func TestP11CursorFanoutExperiment(t *testing.T) {
	controller := &inputController{peers: make(map[*inputPeer]struct{})}
	slow := &p11DelayedWriter{delay: 10 * time.Millisecond}
	fast := &p11DelayedWriter{}
	slowPeer := newInputPeer(slow)
	fastPeer := newInputPeer(fast)
	controller.addPeer(slowPeer)
	controller.addPeer(fastPeer)
	defer controller.removePeer(slowPeer)
	defer controller.removePeer(fastPeer)

	started := time.Now()
	for sequence := uint64(1); sequence <= p11CursorEvents; sequence++ {
		controller.publishCursor(cursorAck{
			Type: "cursor-position", Sequence: sequence, UpdatedMS: int64(sequence),
			Focused: true, Enabled: true,
			Cursor: &cursorPosition{X: int(sequence), Y: 20, Width: 1, Height: 18},
		})
	}
	publishElapsed := time.Since(started)
	fastDelivered, fastLatest := waitP11Latest(t, fast, started)
	slowDelivered, slowLatest := waitP11Latest(t, slow, started)

	t.Logf("P11_RESULT events=%d slow_write_delay=%s publish_elapsed=%s fast_latest=%s fast_delivered=%d slow_latest=%s slow_delivered=%d",
		p11CursorEvents, slow.delay, publishElapsed, fastLatest, fastDelivered, slowLatest, slowDelivered)
}

type p11DiscardWriter struct{}

func (*p11DiscardWriter) SetWriteDeadline(time.Time) error { return nil }
func (*p11DiscardWriter) WriteJSON(any) error              { return nil }

func TestP11CursorPeerOverheadExperiment(t *testing.T) {
	const peersCount = 1000
	controller := &inputController{peers: make(map[*inputPeer]struct{})}
	runtime.GC()
	var before runtime.MemStats
	runtime.ReadMemStats(&before)
	beforeGoroutines := runtime.NumGoroutine()

	peers := make([]*inputPeer, 0, peersCount)
	for range peersCount {
		peer := newInputPeer(&p11DiscardWriter{})
		controller.addPeer(peer)
		peers = append(peers, peer)
	}
	deadline := time.Now().Add(time.Second)
	for runtime.NumGoroutine() < beforeGoroutines+peersCount && time.Now().Before(deadline) {
		runtime.Gosched()
	}
	runtime.GC()
	var after runtime.MemStats
	runtime.ReadMemStats(&after)
	afterGoroutines := runtime.NumGoroutine()
	heapIncrease := int64(after.HeapAlloc) - int64(before.HeapAlloc)
	stackIncrease := int64(after.StackInuse) - int64(before.StackInuse)

	t.Logf("P11_OVERHEAD peers=%d goroutines=%d heap_increase_bytes=%d stack_inuse_increase_bytes=%d combined_bytes_per_peer=%.1f",
		peersCount, afterGoroutines-beforeGoroutines, heapIncrease, stackIncrease,
		float64(heapIncrease+stackIncrease)/peersCount)

	for _, peer := range peers {
		controller.removePeer(peer)
	}
	deadline = time.Now().Add(time.Second)
	for runtime.NumGoroutine() > beforeGoroutines && time.Now().Before(deadline) {
		runtime.Gosched()
	}
	if remaining := runtime.NumGoroutine() - beforeGoroutines; remaining != 0 {
		t.Fatalf("cursor writer goroutines after peer cleanup=%d, want 0", remaining)
	}
}
