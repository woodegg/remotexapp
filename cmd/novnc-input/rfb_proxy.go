package main

import (
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

type gatewayMetrics struct {
	activeRFB    atomic.Int64
	totalRFB     atomic.Uint64
	activeInput  atomic.Int64
	totalInput   atomic.Uint64
	rfbToBrowser atomic.Uint64
	browserToRFB atomic.Uint64
	textRequests atomic.Uint64
	textErrors   atomic.Uint64
	textBytes    atomic.Uint64
	textMicros   atomic.Uint64
}

var upgrader = websocket.Upgrader{CheckOrigin: sameHostOrigin}
var metrics gatewayMetrics
var gatewayStarted = time.Now()

// Eight 64 KiB target reads bound the Go-side RFB-to-browser backlog to about
// 512 KiB per connection while still allowing a short burst to cross the
// WebSocket writer without a goroutine handoff for every read.
const rfbCompatQueueCapacity = 8

const rfbPingInterval = 30 * time.Second
const rfbPingWriteTimeout = 5 * time.Second

// WriteControl is safe alongside the data writer. Browsers answer Ping with
// Pong at the protocol layer; neither frame enters the RFB byte stream. Do not
// add a Pong/read deadline: downstream backpressure may delay the read loop.
func startRFBHeartbeat(client *websocket.Conn, interval time.Duration, closeBoth func()) func() {
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				if err := client.WriteControl(websocket.PingMessage, nil, time.Now().Add(rfbPingWriteTimeout)); err != nil {
					closeBoth()
					return
				}
			}
		}
	}()
	return func() {
		close(stop)
		<-done
	}
}

type rfbCompatOptions struct {
	queueCapacity int
	observeQueue  func(direction string, depth int)
}

func sameHostOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	return err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.User == nil && parsed.Path == "" && parsed.RawQuery == "" && parsed.Fragment == "" && parsed.Host != "" && strings.EqualFold(parsed.Host, r.Host)
}

// proxyRFB translates browser WebSocket binary messages to raw RFB/TCP. It
// does not inspect RFB, so TigerVNC's handshake, framebuffer updates and input
// messages pass through unchanged. This replaces the separate websockify
// process while keeping TigerVNC itself loopback-only.
func proxyRFB(w http.ResponseWriter, r *http.Request, vncAddr string) {
	proxyRFBWithHeartbeat(w, r, vncAddr, rfbPingInterval)
}

func proxyRFBWithHeartbeat(w http.ResponseWriter, r *http.Request, vncAddr string, pingInterval time.Duration) {
	client, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer client.Close()
	client.SetReadLimit(32 << 20)

	server, err := net.DialTimeout("tcp", vncAddr, 5*time.Second)
	if err != nil {
		log.Printf("RFB TCP dial %s: %v", vncAddr, err)
		return
	}
	defer server.Close()
	metrics.activeRFB.Add(1)
	metrics.totalRFB.Add(1)
	defer metrics.activeRFB.Add(-1)

	var closeOnce sync.Once
	closeBoth := func() {
		closeOnce.Do(func() {
			_ = client.Close()
			_ = server.Close()
		})
	}
	var copies sync.WaitGroup
	defer startRFBHeartbeat(client, pingInterval, closeBoth)()
	copies.Add(2)
	go func() {
		defer copies.Done()
		copyWebSocketToTCP(server, client)
		closeBoth()
	}()
	go func() {
		defer copies.Done()
		copyTCPToWebSocket(client, server)
		closeBoth()
	}()
	copies.Wait()
}

func copyWebSocketToTCP(destination net.Conn, source *websocket.Conn) {
	for {
		messageType, payload, err := source.ReadMessage()
		if err != nil {
			return
		}
		if messageType != websocket.BinaryMessage {
			continue
		}
		metrics.browserToRFB.Add(uint64(len(payload)))
		if _, err := destination.Write(payload); err != nil {
			return
		}
	}
}

func copyTCPToWebSocket(destination *websocket.Conn, source net.Conn) {
	buffer := make([]byte, 32<<10)
	for {
		count, err := source.Read(buffer)
		if count > 0 {
			metrics.rfbToBrowser.Add(uint64(count))
			if writeErr := destination.WriteMessage(websocket.BinaryMessage, buffer[:count]); writeErr != nil {
				return
			}
		}
		if err != nil {
			return
		}
	}
}

// proxyRFBCompat is the Go replacement candidate for websockify. Unlike the
// minimal direct relay, it keeps separate buffered queues in both directions,
// uses websockify's 64 KiB target-read size, accepts both WebSocket data frame
// types, completes partial TCP writes, and enables TCP_NODELAY explicitly.
// The established /websockify path remains the default until this path passes
// client IME tests.
func proxyRFBCompat(w http.ResponseWriter, r *http.Request, vncAddr string) {
	proxyRFBCompatWithOptions(w, r, vncAddr, rfbCompatOptions{queueCapacity: rfbCompatQueueCapacity})
}

func proxyRFBCompatWithOptions(w http.ResponseWriter, r *http.Request, vncAddr string, options rfbCompatOptions) {
	proxyRFBCompatWithHeartbeat(w, r, vncAddr, options, rfbPingInterval)
}

func proxyRFBCompatWithHeartbeat(w http.ResponseWriter, r *http.Request, vncAddr string, options rfbCompatOptions, pingInterval time.Duration) {
	if options.queueCapacity < 1 {
		http.Error(w, "invalid RFB relay queue capacity", http.StatusInternalServerError)
		return
	}
	client, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer client.Close()
	client.SetReadLimit(32 << 20)

	target, err := net.DialTimeout("tcp", vncAddr, 5*time.Second)
	if err != nil {
		log.Printf("compatible RFB TCP dial %s: %v", vncAddr, err)
		return
	}
	defer target.Close()
	metrics.activeRFB.Add(1)
	metrics.totalRFB.Add(1)
	defer metrics.activeRFB.Add(-1)
	if tcp, ok := target.(*net.TCPConn); ok {
		_ = tcp.SetNoDelay(true)
	}

	toTarget := make(chan []byte, options.queueCapacity)
	toClient := make(chan []byte, options.queueCapacity)
	closed := make(chan struct{})
	var closeOnce sync.Once
	closeBoth := func() {
		closeOnce.Do(func() {
			close(closed)
			_ = client.Close()
			_ = target.Close()
		})
	}
	var copies sync.WaitGroup
	defer startRFBHeartbeat(client, pingInterval, closeBoth)()
	copies.Add(4)
	go func() {
		defer copies.Done()
		for {
			messageType, payload, readErr := client.ReadMessage()
			if readErr != nil {
				closeBoth()
				return
			}
			if messageType != websocket.BinaryMessage && messageType != websocket.TextMessage {
				continue
			}
			frame := append([]byte(nil), payload...)
			metrics.browserToRFB.Add(uint64(len(frame)))
			select {
			case toTarget <- frame:
				if options.observeQueue != nil {
					options.observeQueue("browser-to-rfb", len(toTarget))
				}
			case <-closed:
				return
			}
		}
	}()
	go func() {
		defer copies.Done()
		for {
			select {
			case frame := <-toTarget:
				if err := writeAll(target, frame); err != nil {
					closeBoth()
					return
				}
			case <-closed:
				return
			}
		}
	}()
	go func() {
		defer copies.Done()
		defer close(toClient)
		buffer := make([]byte, 64<<10)
		for {
			count, readErr := target.Read(buffer)
			if count > 0 {
				metrics.rfbToBrowser.Add(uint64(count))
				frame := append([]byte(nil), buffer[:count]...)
				select {
				case toClient <- frame:
					if options.observeQueue != nil {
						options.observeQueue("rfb-to-browser", len(toClient))
					}
				case <-closed:
					return
				}
			}
			if readErr != nil {
				return
			}
		}
	}()
	go func() {
		defer copies.Done()
		for {
			select {
			case frame, open := <-toClient:
				if !open {
					closeBoth()
					return
				}
				if err := client.WriteMessage(websocket.BinaryMessage, frame); err != nil {
					closeBoth()
					return
				}
			case <-closed:
				return
			}
		}
	}()
	copies.Wait()
}

func writeAll(destination net.Conn, payload []byte) error {
	for len(payload) > 0 {
		count, err := destination.Write(payload)
		if err != nil {
			return err
		}
		if count == 0 {
			return io.ErrShortWrite
		}
		payload = payload[count:]
	}
	return nil
}

// proxyWebSocket is retained only for a controlled A/B comparison against the
// former websockify topology. Production uses proxyRFB above.
func proxyWebSocket(w http.ResponseWriter, r *http.Request, upstream string) {
	client, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer client.Close()
	server, _, err := websocket.DefaultDialer.Dial(upstream, nil)
	if err != nil {
		log.Printf("legacy RFB WebSocket dial %s: %v", upstream, err)
		return
	}
	defer server.Close()

	var copies sync.WaitGroup
	copies.Add(2)
	go func() {
		defer copies.Done()
		copyWebSocketFrames(client, server)
		_ = client.Close()
		_ = server.Close()
	}()
	go func() {
		defer copies.Done()
		copyWebSocketFrames(server, client)
		_ = client.Close()
		_ = server.Close()
	}()
	copies.Wait()
}

func copyWebSocketFrames(destination, source *websocket.Conn) {
	for {
		messageType, payload, err := source.ReadMessage()
		if err != nil {
			return
		}
		if err := destination.WriteMessage(messageType, payload); err != nil {
			return
		}
	}
}
