package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestNativeViewerHeartbeatAcrossIdleProxy(t *testing.T) {
	for _, withHeartbeat := range []bool{false, true} {
		name := "without heartbeat"
		if withHeartbeat {
			name = "with heartbeat"
		}
		t.Run(name, func(t *testing.T) {
			origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				upgrade := websocket.Upgrader{}
				socket, err := upgrade.Upgrade(w, r, nil)
				if err != nil {
					return
				}
				defer socket.Close()
				ctx, cancel := context.WithCancel(r.Context())
				defer cancel()
				if withHeartbeat {
					defer startNativeViewerHeartbeat(ctx, socket, 20*time.Millisecond, cancel)()
				}
				for {
					if _, _, err := socket.NextReader(); err != nil {
						return
					}
				}
			}))
			defer origin.Close()
			socket, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(origin.URL, "http"), nil)
			if err != nil {
				t.Fatal(err)
			}
			defer socket.Close()
			pings := 0
			// Model an intermediary's read-idle threshold. The Ping handler
			// refreshes it without receiving any RFB message.
			_ = socket.SetReadDeadline(time.Now().Add(90 * time.Millisecond))
			socket.SetPingHandler(func(payload string) error {
				pings++
				if pings >= 6 {
					_ = socket.SetReadDeadline(time.Now())
				} else {
					_ = socket.SetReadDeadline(time.Now().Add(90 * time.Millisecond))
				}
				return socket.WriteControl(websocket.PongMessage, []byte(payload), time.Now().Add(time.Second))
			})
			_, _, err = socket.NextReader()
			if err == nil || withHeartbeat && pings != 6 || !withHeartbeat && pings != 0 {
				t.Fatalf("expected idle-only control frames, got %d pings: %v", pings, err)
			}
		})
	}
}
