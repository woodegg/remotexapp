package main

import (
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestRFBHeartbeatInterval(t *testing.T) {
	if rfbPingInterval != 30*time.Second {
		t.Fatal("production RFB heartbeat must be 30 seconds")
	}
}

func TestRFBHeartbeatIdleDataAndCleanup(t *testing.T) {
	for _, compat := range []bool{false, true} {
		for _, closeTarget := range []bool{false, true} {
			name := "direct"
			if compat {
				name = "compat"
			}
			if closeTarget {
				name += "/target-close"
			} else {
				name += "/client-close"
			}
			t.Run(name, func(t *testing.T) {
				listener, err := net.Listen("tcp", "127.0.0.1:0")
				if err != nil {
					t.Fatal(err)
				}
				defer listener.Close()
				accepted := make(chan net.Conn, 1)
				targetDone := make(chan struct{})
				go func() {
					defer close(targetDone)
					c, err := listener.Accept()
					if err != nil {
						return
					}
					defer c.Close()
					accepted <- c
					_, _ = io.Copy(c, c)
				}()
				handlerDone := make(chan struct{})
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					defer close(handlerDone)
					if compat {
						proxyRFBCompatWithHeartbeat(w, r, listener.Addr().String(), rfbCompatOptions{queueCapacity: 8}, 20*time.Millisecond)
					} else {
						proxyRFBWithHeartbeat(w, r, listener.Addr().String(), 20*time.Millisecond)
					}
				}))
				defer server.Close()
				client, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
				if err != nil {
					t.Fatal(err)
				}
				defer client.Close()
				var target net.Conn
				select {
				case target = <-accepted:
				case <-time.After(2 * time.Second):
					t.Fatal("target not connected")
				}
				defer target.Close()
				pings := make(chan struct{}, 100)
				client.SetPingHandler(func(payload string) error {
					select {
					case pings <- struct{}{}:
					default:
					}
					// Model a transport that expires an idle WebSocket. Repeated
					// control traffic must sustain it without any RFB data.
					_ = client.SetReadDeadline(time.Now().Add(250 * time.Millisecond))
					return client.WriteControl(websocket.PongMessage, []byte(payload), time.Now().Add(time.Second))
				})
				_ = client.SetReadDeadline(time.Now().Add(250 * time.Millisecond))
				readDone := make(chan error, 1)
				messages := make(chan string, 10)
				go func() {
					for {
						_, data, err := client.ReadMessage()
						if err != nil {
							readDone <- err
							return
						}
						messages <- string(data)
					}
				}()
				timer := time.NewTimer(550 * time.Millisecond)
				defer timer.Stop()
				count := 0
			idle:
				for {
					select {
					case <-pings:
						count++
					case err := <-readDone:
						t.Fatalf("idle connection failed: %v", err)
					case data := <-messages:
						t.Fatalf("heartbeat leaked into RFB: %q", data)
					case <-timer.C:
						break idle
					}
				}
				if count < 2 {
					t.Fatalf("expected repeated Ping, got %d", count)
				}
				if err := client.WriteMessage(websocket.BinaryMessage, []byte("RFB payload")); err != nil {
					t.Fatal(err)
				}
				select {
				case data := <-messages:
					if data != "RFB payload" {
						t.Fatalf("corrupted data: %q", data)
					}
				case err := <-readDone:
					t.Fatalf("data connection failed: %v", err)
				case <-time.After(2 * time.Second):
					t.Fatal("missing echo")
				}
				if closeTarget {
					_ = target.Close()
				} else {
					_ = client.Close()
				}
				for _, done := range []<-chan struct{}{handlerDone, targetDone} {
					select {
					case <-done:
					case <-time.After(2 * time.Second):
						t.Fatal("relay/heartbeat leaked after close")
					}
				}
				select {
				case <-readDone:
				case <-time.After(2 * time.Second):
					t.Fatal("reader leaked")
				}
			})
		}
	}
}

func TestRFBHeartbeatWriteFailureAndStop(t *testing.T) {
	connections := make(chan *websocket.Conn, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := upgrader.Upgrade(w, r, nil)
		if err == nil {
			connections <- c
		}
	}))
	defer server.Close()
	client, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	connection := <-connections
	defer connection.Close()
	// Stopping before the first tick joins the worker without closing transport.
	failed := make(chan struct{}, 1)
	stop := startRFBHeartbeat(connection, time.Hour, func() { failed <- struct{}{} })
	stop()
	select {
	case <-failed:
		t.Fatal("stop invoked failure callback")
	default:
	}
	_ = connection.Close()
	stop = startRFBHeartbeat(connection, time.Millisecond, func() { failed <- struct{}{} })
	defer stop()
	select {
	case <-failed:
	case <-time.After(2 * time.Second):
		t.Fatal("write failure did not trigger cleanup")
	}
}
