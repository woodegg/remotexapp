package main

import (
	"fmt"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/woodegg/remotexapp/internal/sessionaudio"
)

func audioBurstConnection(t *testing.T) (*audioService, *websocket.Conn, *audioConnection) {
	t.Helper()
	a := newAudioService("burst-test", nil)
	server := audioTestServer(t, a)
	client := audioTestClient(t)
	_, ctx := audioPost(t, client, server.URL, "context", "alice", audioRequest{})
	request := audioRequest{Scope: ctx["scope"].(string), Client: "burst-test"}
	_, grant := audioPost(t, client, server.URL, "grant", "alice", request)
	ws, _ := audioDial(t, client, server, grant["token"].(string), "alice")
	var hello map[string]any
	if err := ws.ReadJSON(&hello); err != nil {
		t.Fatal(err)
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, scope := range a.scopes {
		if scope.id == request.Scope {
			return a, ws, scope.connection
		}
	}
	t.Fatal("missing connection")
	return nil, nil, nil
}

func TestAudioBufferedMicrophonePreservesSharedConnection(t *testing.T) {
	for _, silent := range []bool{false, true} {
		t.Run(fmt.Sprintf("silent=%v", silent), func(t *testing.T) {
			a, ws, connection := audioBurstConnection(t)
			pcm := make([]byte, sessionaudio.MicBytes)
			if !silent {
				pcm[0] = 1
			}
			// A 2.8-second network backlog is still ordinary 50 fps capture.
			for sequence := uint32(1); sequence <= 140; sequence++ {
				if err := ws.WriteMessage(websocket.BinaryMessage, sessionaudio.Packet(2, 0, sequence, pcm)); err != nil {
					t.Fatalf("buffered frame %d closed the shared audio: %v", sequence, err)
				}
			}
			if err := ws.WriteJSON(audioControl{Op: "unsubscribe", Request: "after-burst", Slot: 1}); err != nil {
				t.Fatal(err)
			}
			_ = ws.SetReadDeadline(time.Now().Add(2 * time.Second))
			var ack map[string]any
			if err := ws.ReadJSON(&ack); err != nil || ack["type"] != "ack" || ack["request"] != "after-burst" {
				t.Fatalf("burst lost subsequent control traffic: %v, %v", ack, err)
			}
			a.mu.Lock()
			defer a.mu.Unlock()
			if connection.scope.connection != connection || connection.sequence != 140 {
				t.Fatal("valid backlog replaced the scope or lost sequence validation")
			}
		})
	}
}
