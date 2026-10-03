//go:build rfbqueueexperiment

package main

import (
	"encoding/binary"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

type queueExperimentResult struct {
	QueueCapacity                 int     `json:"queueCapacity"`
	FrameBytes                    int     `json:"frameBytes"`
	Frames                        int     `json:"frames"`
	TotalBytes                    int64   `json:"totalBytes"`
	InitialClientStallMillis      int64   `json:"initialClientStallMillis"`
	ClientDelayPerMessageMillis   int64   `json:"clientDelayPerMessageMillis"`
	MaxRFBToBrowserQueueDepth     int64   `json:"maxRfbToBrowserQueueDepth"`
	HeapAllocBeforeBytes          uint64  `json:"heapAllocBeforeBytes"`
	HeapAllocDuringStallBytes     uint64  `json:"heapAllocDuringStallBytes"`
	HeapAllocIncreaseBytes        int64   `json:"heapAllocIncreaseBytes"`
	UpstreamSendMillis            float64 `json:"upstreamSendMillis"`
	ClientDrainMillis             float64 `json:"clientDrainMillis"`
	FinalFrameGeneratedToClientMs float64 `json:"finalFrameGeneratedToClientMillis"`
	FinalFrameWrittenToClientMs   float64 `json:"finalFrameWrittenToClientMillis"`
	AverageSourceFrameAgeMillis   float64 `json:"averageSourceFrameAgeMillis"`
	MaximumSourceFrameAgeMillis   float64 `json:"maximumSourceFrameAgeMillis"`
	WebSocketMessages             int     `json:"webSocketMessages"`
}

type sourceTiming struct {
	started        time.Time
	finished       time.Time
	finalGenerated time.Time
	finalWritten   time.Time
}

// TestRFBCompatSlowClientExperiment is intentionally excluded from ordinary
// builds. Run it in a separate process for each capacity so one run's heap
// does not contaminate another:
//
//	RFB_QUEUE_CAPACITY=8 go test -tags rfbqueueexperiment ./cmd/novnc-input \
//	  -run '^TestRFBCompatSlowClientExperiment$' -count=1 -v
func TestRFBCompatSlowClientExperiment(t *testing.T) {
	capacity := experimentInt(t, "RFB_QUEUE_CAPACITY", 0)
	if capacity < 1 {
		t.Skip("set RFB_QUEUE_CAPACITY to run the isolated experiment")
	}
	frames := experimentInt(t, "RFB_QUEUE_FRAMES", 512)
	frameBytes := experimentInt(t, "RFB_QUEUE_FRAME_BYTES", 64<<10)
	stall := time.Duration(experimentInt(t, "RFB_QUEUE_STALL_MS", 1000)) * time.Millisecond
	readDelay := time.Duration(experimentInt(t, "RFB_QUEUE_READ_DELAY_MS", 2)) * time.Millisecond
	if frames < 2 || frameBytes < 16 {
		t.Fatal("experiment requires at least two frames of at least 16 bytes")
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	releaseSource := make(chan struct{})
	sourceDone := make(chan sourceTiming, 1)
	go runQueueExperimentSource(t, listener, releaseSource, sourceDone, frames, frameBytes)

	var maxToClientDepth atomic.Int64
	observe := func(direction string, depth int) {
		if direction != "rfb-to-browser" {
			return
		}
		for current := maxToClientDepth.Load(); int64(depth) > current; current = maxToClientDepth.Load() {
			if maxToClientDepth.CompareAndSwap(current, int64(depth)) {
				break
			}
		}
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/rfb", func(w http.ResponseWriter, r *http.Request) {
		proxyRFBCompatWithOptions(w, r, listener.Addr().String(), rfbCompatOptions{
			queueCapacity: capacity,
			observeQueue:  observe,
		})
	})
	httpServer := httptest.NewServer(mux)
	defer httpServer.Close()

	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/rfb"
	client, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	_ = client.SetReadDeadline(time.Now().Add(60 * time.Second))

	runtime.GC()
	var before runtime.MemStats
	runtime.ReadMemStats(&before)
	close(releaseSource)
	time.Sleep(stall)
	runtime.GC()
	var duringStall runtime.MemStats
	runtime.ReadMemStats(&duringStall)

	drainStarted := time.Now()
	totalExpected := int64(frames * frameBytes)
	var received int64
	var messageCount int
	var header [16]byte
	headerBytes := 0
	frameOffset := 0
	var ageTotal time.Duration
	var ageMaximum time.Duration
	var finalArrived time.Time
	for received < totalExpected {
		messageType, payload, readErr := client.ReadMessage()
		if readErr != nil {
			t.Fatalf("read after %d of %d bytes: %v", received, totalExpected, readErr)
		}
		if messageType != websocket.BinaryMessage {
			continue
		}
		messageCount++
		now := time.Now()
		for len(payload) > 0 {
			remaining := frameBytes - frameOffset
			consume := len(payload)
			if consume > remaining {
				consume = remaining
			}
			if headerBytes < len(header) {
				copyCount := consume
				if copyCount > len(header)-headerBytes {
					copyCount = len(header) - headerBytes
				}
				copy(header[headerBytes:], payload[:copyCount])
				headerBytes += copyCount
			}
			frameOffset += consume
			received += int64(consume)
			payload = payload[consume:]
			if frameOffset == frameBytes {
				sequence := binary.BigEndian.Uint64(header[:8])
				expected := uint64(received/int64(frameBytes) - 1)
				if sequence != expected {
					t.Fatalf("frame sequence %d, want %d", sequence, expected)
				}
				generated := time.Unix(0, int64(binary.BigEndian.Uint64(header[8:])))
				age := now.Sub(generated)
				ageTotal += age
				if age > ageMaximum {
					ageMaximum = age
				}
				if sequence == uint64(frames-1) {
					finalArrived = now
				}
				frameOffset = 0
				headerBytes = 0
			}
		}
		if readDelay > 0 {
			time.Sleep(readDelay)
		}
	}
	drainFinished := time.Now()
	timing := <-sourceDone
	if finalArrived.IsZero() {
		t.Fatal("final source frame was not observed")
	}

	result := queueExperimentResult{
		QueueCapacity:                 capacity,
		FrameBytes:                    frameBytes,
		Frames:                        frames,
		TotalBytes:                    totalExpected,
		InitialClientStallMillis:      stall.Milliseconds(),
		ClientDelayPerMessageMillis:   readDelay.Milliseconds(),
		MaxRFBToBrowserQueueDepth:     maxToClientDepth.Load(),
		HeapAllocBeforeBytes:          before.HeapAlloc,
		HeapAllocDuringStallBytes:     duringStall.HeapAlloc,
		HeapAllocIncreaseBytes:        int64(duringStall.HeapAlloc) - int64(before.HeapAlloc),
		UpstreamSendMillis:            milliseconds(timing.finished.Sub(timing.started)),
		ClientDrainMillis:             milliseconds(drainFinished.Sub(drainStarted)),
		FinalFrameGeneratedToClientMs: milliseconds(finalArrived.Sub(timing.finalGenerated)),
		FinalFrameWrittenToClientMs:   milliseconds(finalArrived.Sub(timing.finalWritten)),
		AverageSourceFrameAgeMillis:   milliseconds(ageTotal / time.Duration(frames)),
		MaximumSourceFrameAgeMillis:   milliseconds(ageMaximum),
		WebSocketMessages:             messageCount,
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("RFB_QUEUE_RESULT %s", encoded)
}

func runQueueExperimentSource(t *testing.T, listener net.Listener, release <-chan struct{}, done chan<- sourceTiming, frames, frameBytes int) {
	t.Helper()
	connection, err := listener.Accept()
	if err != nil {
		t.Errorf("source accept: %v", err)
		return
	}
	defer connection.Close()
	<-release
	payload := make([]byte, frameBytes)
	timing := sourceTiming{started: time.Now()}
	for sequence := 0; sequence < frames; sequence++ {
		now := time.Now()
		binary.BigEndian.PutUint64(payload[:8], uint64(sequence))
		binary.BigEndian.PutUint64(payload[8:16], uint64(now.UnixNano()))
		if sequence == frames-1 {
			timing.finalGenerated = now
		}
		if err := writeAll(connection, payload); err != nil {
			t.Errorf("source write frame %d: %v", sequence, err)
			return
		}
		if sequence == frames-1 {
			timing.finalWritten = time.Now()
		}
	}
	timing.finished = time.Now()
	done <- timing
}

func experimentInt(t *testing.T, name string, fallback int) int {
	t.Helper()
	value := os.Getenv(name)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		t.Fatalf("%s=%q: %v", name, value, err)
	}
	return parsed
}

func milliseconds(duration time.Duration) float64 {
	return float64(duration) / float64(time.Millisecond)
}
