package main

import (
	"context"
	"io"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
	"github.com/woodegg/remotexapp/internal/nativewire"
)

// Only the server-issued grant selects this path. Query parameters cannot
// promote a read-only connection. Authentication still owns account access;
// this is an immutable attachment permission, not a new tenant ACL.
func (m *manager) serveReadOnlyNative(w http.ResponseWriter, r *http.Request, item *instance, channel *viewerChannel) {
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
	upgrade := websocket.Upgrader{Subprotocols: []string{r.Header.Get("Sec-WebSocket-Protocol")}, CheckOrigin: func(*http.Request) bool { return true }}
	client, err := upgrade.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer client.Close()
	client.SetReadLimit(nativewire.MaxBuffered)
	up.SetReadLimit(8 * 1024 * 1024)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	closed := make(chan struct{})
	go func() { defer close(closed); <-ctx.Done(); up.Close(); client.Close() }()
	defer func() { cancel(); <-closed }()
	done := make(chan struct{})
	go func() {
		defer close(done)
		defer cancel()
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
			up.SetWriteDeadline(time.Now().Add(15 * time.Second))
			for len(payload) > 0 {
				n := min(len(payload), 16384)
				if up.WriteMessage(websocket.BinaryMessage, payload[:n]) != nil {
					return
				}
				payload = payload[n:]
			}
		}
	}()
	for ctx.Err() == nil {
		kind, payload, err := up.ReadMessage()
		if err != nil || kind != websocket.BinaryMessage {
			break
		}
		client.SetWriteDeadline(time.Now().Add(15 * time.Second))
		if client.WriteMessage(kind, payload) != nil {
			break
		}
	}
	cancel()
	<-done
}

type nativeSocketCloser struct{ *websocket.Conn }

func (*nativeSocketCloser) Read([]byte) (int, error) { return 0, io.EOF }
