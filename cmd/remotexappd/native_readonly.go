package main

import (
	"context"
	"io"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
	"github.com/woodegg/remotexapp/internal/nativewire"
)

// The browser-facing proxy owns WebSocket control frames. Read-only filtering
// continues to depend solely on the server-issued Viewer grant.
func (m *manager) serveKasmNative(w http.ResponseWriter, r *http.Request, item *instance, channel *viewerChannel, readOnly bool) {
	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second, WriteBufferSize: 16384, Subprotocols: []string{"binary"}}
	// Preserve the already-validated browser origin/Host pair for the loopback
	// gateway's independent same-origin check. Never forward the grant or login.
	headers := http.Header{"Origin": []string{r.Header.Get("Origin")}, "Host": []string{r.Host}}
	up, response, err := dialer.DialContext(r.Context(), "ws://"+item.GatewayAddr+"/websockify", headers)
	if err != nil {
		if response != nil {
			response.Body.Close()
		}
		writeError(w, http.StatusBadGateway, "native display unavailable")
		return
	}
	defer up.Close()
	body := &nativeSocketCloser{Conn: up}
	if m.bindViewerChannel(channel, &http.Response{StatusCode: http.StatusSwitchingProtocols, Body: body}) != nil {
		writeError(w, http.StatusConflict, "native Viewer generation retired")
		return
	}
	// The outer secure handler already validates same-origin authenticated requests.
	upgrade := websocket.Upgrader{Subprotocols: []string{r.Header.Get("Sec-WebSocket-Protocol")}, WriteBufferSize: 16384, CheckOrigin: func(*http.Request) bool { return true }}
	client, err := upgrade.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer client.Close()
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	closed := make(chan struct{})
	go func() { defer close(closed); <-ctx.Done(); up.Close(); client.Close() }()
	defer func() { cancel(); <-closed }()
	stopPing := startNativeViewerHeartbeat(ctx, client, 30*time.Second, cancel)
	defer stopPing()
	if readOnly {
		client.SetReadLimit(nativewire.MaxBuffered)
		up.SetReadLimit(8 * 1024 * 1024)
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		defer cancel()
		if readOnly {
			filterNativeViewer(client, up)
		} else {
			copyNativeViewer(client, up)
		}
	}()
	copyNativeViewer(up, client)
	cancel()
	<-done
}

// Ping is a control frame on the browser-facing authenticated WSS. It does not
// enter Kasm's RFB stream, renew the grant or count as user activity.
func startNativeViewerHeartbeat(ctx context.Context, client *websocket.Conn, interval time.Duration, cancel context.CancelFunc) func() {
	ctx, stop := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if client.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)) != nil {
					cancel()
					return
				}
			}
		}
	}()
	return func() { stop(); <-done }
}

func copyNativeViewer(from, to *websocket.Conn) {
	for {
		kind, message, err := from.NextReader()
		if err != nil || kind != websocket.BinaryMessage {
			return
		}
		_ = to.SetWriteDeadline(time.Now().Add(15 * time.Second))
		writer, err := to.NextWriter(kind)
		if err != nil {
			return
		}
		_, err = io.Copy(writer, message)
		if closeErr := writer.Close(); err != nil || closeErr != nil {
			return
		}
	}
}

func filterNativeViewer(client, up *websocket.Conn) {
	filter := nativewire.ClientFilter{ReadOnly: true}
	for {
		kind, payload, err := client.ReadMessage()
		if err != nil || kind != websocket.BinaryMessage {
			return
		}
		payload, err = filter.Feed(payload)
		if err != nil {
			return
		}
		_ = up.SetWriteDeadline(time.Now().Add(15 * time.Second))
		for len(payload) > 0 {
			n := min(len(payload), 16384)
			if up.WriteMessage(websocket.BinaryMessage, payload[:n]) != nil {
				return
			}
			payload = payload[n:]
		}
	}
}

type nativeSocketCloser struct{ *websocket.Conn }

func (*nativeSocketCloser) Read([]byte) (int, error) { return 0, io.EOF }
