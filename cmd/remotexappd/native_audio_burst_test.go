package main

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/woodegg/remotexapp/internal/sessionaudio"
)

type audioBurstSession struct {
	service    *audioService
	socket     *websocket.Conn
	connection *audioConnection
	client     *http.Client
	server     *httptest.Server
	request    audioRequest
}

func audioBurstConnection(t *testing.T) audioBurstSession {
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
			request.Connection = scope.connection.id
			return audioBurstSession{a, ws, scope.connection, client, server, request}
		}
	}
	t.Fatal("missing connection")
	return audioBurstSession{}
}

func TestAudioBufferedMicrophonePreservesSharedConnection(t *testing.T) {
	for _, silent := range []bool{false, true} {
		t.Run(fmt.Sprintf("silent=%v", silent), func(t *testing.T) {
			s := audioBurstConnection(t)
			a, ws, connection := s.service, s.socket, s.connection
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
			// A longer backlog uses the same authorization and channel too.
			for sequence := uint32(141); sequence <= 2390; sequence++ {
				if err := ws.WriteMessage(websocket.BinaryMessage, sessionaudio.Packet(2, 0, sequence, pcm)); err != nil {
					t.Fatal(err)
				}
			}
			if err := ws.WriteJSON(audioControl{Op: "unsubscribe", Request: "longer-burst", Slot: 1}); err != nil {
				t.Fatal(err)
			}
			_ = ws.SetReadDeadline(time.Now().Add(2 * time.Second))
			if err := ws.ReadJSON(&ack); err != nil || ack["request"] != "longer-burst" {
				t.Fatalf("longer burst lost control: %v, %v", ack, err)
			}
			if status, _ := audioPost(t, s.client, s.server.URL, "renew", "alice", s.request); status != 200 {
				t.Fatal("burst lost authorized renewal")
			}
			a.mu.Lock()
			defer a.mu.Unlock()
			if connection.scope.connection != connection || connection.sequence != 2390 {
				t.Fatal("valid backlog replaced the scope or lost sequence validation")
			}
		})
	}
}

func TestAudioBufferedMicrophoneStillFencesInvalidFrames(t *testing.T) {
	for _, fault := range []string{"replay", "backwards", "wrong-kind", "wrong-slot", "truncated", "expired", "retired"} {
		t.Run(fault, func(t *testing.T) {
			s := audioBurstConnection(t)
			pcm := make([]byte, sessionaudio.MicBytes)
			pcm[0] = 1
			for sequence := uint32(1); sequence <= 140; sequence++ {
				if err := s.socket.WriteMessage(websocket.BinaryMessage, sessionaudio.Packet(2, 0, sequence, pcm)); err != nil {
					t.Fatal(err)
				}
			}
			if err := s.socket.WriteJSON(audioControl{Op: "unsubscribe", Request: "barrier", Slot: 1}); err != nil {
				t.Fatal(err)
			}
			var ack any
			if err := s.socket.ReadJSON(&ack); err != nil {
				t.Fatal(err)
			}
			packet := sessionaudio.Packet(2, 0, 141, pcm)
			switch fault {
			case "replay":
				packet = sessionaudio.Packet(2, 0, 140, pcm)
			case "backwards":
				packet = sessionaudio.Packet(2, 0, 139, pcm)
			case "wrong-kind":
				packet[1] = 1
			case "wrong-slot":
				packet[2] = 1
			case "truncated":
				packet = packet[:len(packet)-1]
			case "expired":
				s.service.mu.Lock()
				s.connection.expires = time.Now().Add(-time.Second)
				s.service.mu.Unlock()
			case "retired":
				s.service.mu.Lock()
				s.connection.scope.connection = nil
				s.service.mu.Unlock()
			}
			if err := s.socket.WriteMessage(websocket.BinaryMessage, packet); err != nil {
				t.Fatal(err)
			}
			_ = s.socket.SetReadDeadline(time.Now().Add(2 * time.Second))
			_, _, err := s.socket.ReadMessage()
			if err == nil {
				t.Fatal("invalid or unauthorized frame retained the channel")
			}
			var timeout net.Error
			if errors.As(err, &timeout) && timeout.Timeout() {
				t.Fatal("timed out instead of rejecting invalid frame")
			}
			s.service.mu.Lock()
			defer s.service.mu.Unlock()
			if s.connection.sequence != 140 {
				t.Fatal("invalid frame advanced sequence")
			}
		})
	}
}
