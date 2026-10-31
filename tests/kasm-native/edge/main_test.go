package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
)

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
	c, _, e := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(edge.URL, "http")+"/rx/remotexapps/test/native/websockify?componentDigest="+pin, head)
	if e != nil {
		t.Fatal(e)
	}
	defer c.Close()
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
