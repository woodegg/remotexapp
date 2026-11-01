package main

import (
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestBrowserHeartbeatKeepsIdleReaderAndRetiresSilentPeer(t *testing.T) {
	for _, read := range []bool{true, false} {
		t.Run(map[bool]string{true: "responding", false: "silent"}[read], func(t *testing.T) {
			ended := make(chan struct{})
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				u := websocket.Upgrader{}
				c, err := u.Upgrade(w, r, nil)
				if err != nil {
					return
				}
				defer c.Close()
				ctx, cancel := context.WithCancel(r.Context())
				done := browserHeartbeat(ctx, c, 50*time.Millisecond, 500*time.Millisecond)
				defer func() { cancel(); <-done; close(ended) }()
				timer := time.AfterFunc(1200*time.Millisecond, func() {
					c.WriteMessage(websocket.BinaryMessage, []byte("still alive"))
				})
				defer timer.Stop()
				for {
					if _, _, err := c.ReadMessage(); err != nil {
						return
					}
				}
			}))
			defer s.Close()
			c, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(s.URL, "http"), nil)
			if err != nil {
				t.Fatal(err)
			}
			defer c.Close()
			if read {
				c.SetReadDeadline(time.Now().Add(3 * time.Second))
				_, payload, err := c.ReadMessage() // Native handler automatically replies to pings.
				if err != nil || string(payload) != "still alive" {
					t.Fatal("idle reader lost", err)
				}
				c.Close()
			}
			select {
			case <-ended:
			case <-time.After(3 * time.Second):
				t.Fatal("heartbeat owner did not retire")
			}
		})
	}
}

func TestEdgeHeadersAndStaticTrustBoundary(t *testing.T) {
	calls := 0
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		for _, key := range []string{"Forwarded", "X-Forwarded-For", "CF-Connecting-IP", "CF-Access-Jwt-Assertion", "Cookie", "Authorization", "X-Unknown-Origin"} {
			if r.Header.Get(key) != "" {
				t.Errorf("source-bearing header forwarded: %s", key)
			}
		}
		w.Header().Set("Content-Type", "text/html")
		w.Header().Set("Set-Cookie", "spoofed=yes")
		io.WriteString(w, `{"ok":true}`)
	}))
	defer backend.Close()
	c := configuration{Origin: "https://uat.example", Backend: backend.URL, Assets: map[string]asset{"/": {Type: "text/html", data: []byte("trusted HTML")}, "native-viewer": {Type: "text/html", data: []byte("trusted Viewer")}}, Components: map[string]asset{strings.Repeat("a", 64): {Type: "text/javascript", data: []byte("trusted component")}}}
	h, err := edgeHandler(c)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		path, peer, origin string
		status             int
	}{
		{"/", "127.0.0.1:5000", "", 200}, {"/rx/api/instances", "127.0.0.1:5000", "https://uat.example", 200},
		{"/rx/api/instances", "192.0.2.1:5000", "", 403}, {"/rx/api/instances", "127.0.0.1:5000", "https://evil.example", 403},
		{"/rx/sdk/untrusted.js", "127.0.0.1:5000", "", 404}, {"/rx/remotexapps/runtime/kiosk.html", "127.0.0.1:5000", "", 200},
		{"/rx/remotexapps/runtime/native/client.js?componentDigest=" + strings.Repeat("a", 64), "127.0.0.1:5000", "", 200},
		{"/rx/remotexapps/runtime/native/client.js?componentDigest=" + strings.Repeat("b", 64), "127.0.0.1:5000", "", 409},
	} {
		r := httptest.NewRequest("GET", tc.path, nil)
		r.Host = "uat.example"
		r.RemoteAddr = tc.peer
		r.Header.Set("Origin", tc.origin)
		for _, key := range []string{"Forwarded", "X-Forwarded-For", "CF-Connecting-IP", "CF-Access-Jwt-Assertion", "Cookie", "Authorization", "X-Unknown-Origin"} {
			r.Header.Set(key, "private")
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != tc.status {
			t.Errorf("%s: %d", tc.path, w.Code)
		}
		if tc.path == "/rx/api/instances" && w.Code == 200 {
			if w.Header().Get("Content-Type") != "application/json" || w.Header().Get("Set-Cookie") != "" {
				t.Fatal("backend executable content escaped")
			}
			var result any
			if json.Unmarshal(w.Body.Bytes(), &result) != nil {
				t.Fatal("bad JSON")
			}
		}
	}
	if calls != 1 {
		t.Fatal("untrusted assets reached backend", calls)
	}
}
func TestEdgeBinaryStreamAndDisconnect(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
		c, e := u.Upgrade(w, r, nil)
		if e != nil {
			return
		}
		defer c.Close()
		for {
			kind, p, e := c.ReadMessage()
			if e != nil {
				return
			}
			if c.WriteMessage(kind, p) != nil {
				return
			}
		}
	}))
	defer backend.Close()
	pin := strings.Repeat("a", 64)
	h, e := edgeHandler(configuration{Origin: "https://uat.example", Backend: backend.URL, Components: map[string]asset{pin: {}}})
	if e != nil {
		t.Fatal(e)
	}
	edge := httptest.NewServer(h)
	defer edge.Close()
	head := http.Header{"Host": []string{"uat.example"}, "Origin": []string{"https://uat.example"}, "CF-Connecting-IP": []string{"private"}}
	dialer := websocket.Dialer{Subprotocols: []string{"binary"}}
	c, _, e := dialer.Dial("ws"+strings.TrimPrefix(edge.URL, "http")+"/rx/remotexapps/test/native/websockify?componentDigest="+pin, head)
	if e != nil {
		t.Fatal(e)
	}
	defer c.Close()
	if c.Subprotocol() != "binary" {
		t.Fatal("browser subprotocol was not acknowledged")
	}
	for _, p := range [][]byte{[]byte("RFB 003.008\n"), {1, 1, 185}} {
		if e = c.WriteMessage(websocket.BinaryMessage, p); e != nil {
			t.Fatal(e)
		}
		_, got, e := c.ReadMessage()
		if e != nil || string(got) != string(p) {
			t.Fatal("stream changed", e)
		}
	}
	c.WriteMessage(websocket.BinaryMessage, []byte{182})
	if _, _, e = c.ReadMessage(); e == nil {
		t.Fatal("unsupported stream not closed")
	}
}

// Read physical frames: a normal WebSocket library would rejoin continuation
// frames and conceal the pinned native decoder's incompatibility.
func TestEdgeFullClipboardUsesIndependentNativeFrames(t *testing.T) {
	text := []byte(strings.Repeat("界", 21845) + "A")
	clipboard := append([]byte{180, 1, 10}, []byte("text/plain")...)
	clipboard = binary.BigEndian.AppendUint32(clipboard, uint32(len(text)))
	clipboard = append(clipboard, text...)
	want := append([]byte("RFB 003.008\n\x01\x01"), clipboard...)
	want = append(want, 185) // Subsequent reliable control must not disappear.
	result := make(chan error, 1)
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, rw, err := w.(http.Hijacker).Hijack()
		if err != nil {
			result <- err
			return
		}
		defer c.Close()
		c.SetDeadline(time.Now().Add(5 * time.Second))
		sum := sha1.Sum([]byte(r.Header.Get("Sec-WebSocket-Key") + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
		fmt.Fprintf(rw, "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n", base64.StdEncoding.EncodeToString(sum[:]))
		if err := rw.Flush(); err != nil {
			result <- err
			return
		}
		var got []byte
		for len(got) < len(want) {
			var h [2]byte
			if _, err := io.ReadFull(rw, h[:]); err != nil {
				result <- err
				return
			}
			if h[0] != 0x82 || h[1]&0x80 == 0 || h[1]&127 == 127 {
				result <- fmt.Errorf("unsupported native frame header %x", h)
				return
			}
			size := int(h[1] & 127)
			if size == 126 {
				var b [2]byte
				if _, err := io.ReadFull(rw, b[:]); err != nil {
					result <- err
					return
				}
				size = int(binary.BigEndian.Uint16(b[:]))
			}
			if size == 0 || size > nativeFrameBytes {
				result <- fmt.Errorf("unexpected frame size %d", size)
				return
			}
			var mask [4]byte
			if _, err := io.ReadFull(rw, mask[:]); err != nil {
				result <- err
				return
			}
			body := make([]byte, size)
			if _, err := io.ReadFull(rw, body); err != nil {
				result <- err
				return
			}
			for i := range body {
				body[i] ^= mask[i%4]
			}
			got = append(got, body...)
		}
		if !bytes.Equal(got, want) {
			result <- fmt.Errorf("validated byte stream changed: %d != %d", len(got), len(want))
			return
		}
		result <- nil
	}))
	defer backend.Close()
	pin := strings.Repeat("a", 64)
	h, err := edgeHandler(configuration{Origin: "https://uat.example", Backend: backend.URL, Components: map[string]asset{pin: {}}})
	if err != nil {
		t.Fatal(err)
	}
	edge := httptest.NewServer(h)
	defer edge.Close()
	c, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(edge.URL, "http")+"/rx/remotexapps/test/native/websockify?componentDigest="+pin, http.Header{"Host": []string{"uat.example"}, "Origin": []string{"https://uat.example"}})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	// Incoming boundaries deliberately split the RFB clipboard header and text.
	for start := 0; start < len(want); start += 997 {
		end := min(start+997, len(want))
		if err := c.WriteMessage(websocket.BinaryMessage, want[start:end]); err != nil {
			t.Fatal(err)
		}
	}
	select {
	case err := <-result:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(6 * time.Second):
		t.Fatal("native stream did not complete")
	}
}
