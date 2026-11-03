package main

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestNativeReadOnlyGrantBlocksDirectWireWrites(t *testing.T) {
	for _, udp := range []bool{false, true} {
		m, item, req := grantFixture(t)
		item.Components.NativeUDP = udp
		req.ReadOnly = true
		q := issueGrant(t, m, item, req)
		bad := q
		bad.ReadOnly = false
		if grantCall(m, item, bad, "alice", "lease").Code != 403 {
			t.Fatal("read-only grant promoted")
		}
		received := make(chan []byte, 8)
		backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Origin") != "http://"+r.Host {
				http.Error(w, "same-origin required", 403)
				return
			}
			if r.Header.Get("Sec-WebSocket-Protocol") != "binary" {
				t.Error("upstream received a credential")
			}
			up := websocket.Upgrader{Subprotocols: []string{"binary"}, CheckOrigin: func(*http.Request) bool { return true }}
			c, err := up.Upgrade(w, r, nil)
			if err != nil {
				return
			}
			defer c.Close()
			for {
				kind, payload, err := c.ReadMessage()
				if err != nil {
					return
				}
				received <- payload
				if c.WriteMessage(kind, payload) != nil {
					return
				}
			}
		}))
		item.GatewayAddr = strings.TrimPrefix(backend.URL, "http://")
		front := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r = r.WithContext(context.WithValue(r.Context(), requestIdentityKey{}, "alice"))
			m.serveNativeInstance(w, r, m.get(item.ID), "native/websockify")
		}))
		d := websocket.Dialer{Subprotocols: []string{nativeGrantProtocol + q.Token}}
		c, _, err := d.Dial("ws"+strings.TrimPrefix(front.URL, "http")+"/?sessionGeneration=3&componentDigest="+q.ComponentDigest+"&readOnly=false", http.Header{"Origin": []string{front.URL}})
		if err != nil {
			t.Fatal(err)
		}
		wire := append([]byte("RFB 003.008\n"), 1, 1, 185)
		if err = c.WriteMessage(websocket.BinaryMessage, wire); err != nil {
			t.Fatal(err)
		}
		c.SetReadDeadline(time.Now().Add(time.Second))
		_, echo, err := c.ReadMessage()
		if err != nil || !bytes.Equal(echo, wire) {
			t.Fatal("display negotiation failed", err)
		}
		if !bytes.Equal(<-received, wire) {
			t.Fatal("handshake altered")
		}
		key := []byte{4, 1, 0, 0, 0, 0, 0, 65}
		if err = c.WriteMessage(websocket.BinaryMessage, key); err != nil {
			t.Fatal(err)
		}
		if _, _, err = c.ReadMessage(); err == nil {
			t.Fatal("read-only key reached upstream")
		}
		select {
		case unexpected := <-received:
			t.Fatalf("write escaped: %d bytes", len(unexpected))
		default:
		}
		c.Close()
		front.Close()
		backend.Close()
	}
}
