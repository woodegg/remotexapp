package main

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestRFBProxyBridgesWebSocketAndTCP(t *testing.T) {
	testRFBProxy(t, proxyRFB)
}

func TestRFBCompatBridgesWebSocketAndTCP(t *testing.T) {
	testRFBProxy(t, proxyRFBCompat)
}

func TestRFBCompatSmallQueueBridgesWebSocketAndTCP(t *testing.T) {
	testRFBProxy(t, func(w http.ResponseWriter, r *http.Request, address string) {
		proxyRFBCompatWithOptions(w, r, address, rfbCompatOptions{queueCapacity: 1})
	})
}

func testRFBProxy(t *testing.T, handler func(http.ResponseWriter, *http.Request, string)) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	serverDone := make(chan error, 1)
	go func() {
		connection, err := listener.Accept()
		if err != nil {
			serverDone <- err
			return
		}
		defer connection.Close()
		if _, err := connection.Write([]byte{'R', 'F', 'B', ' ', '0', '0', '3', '.', '0', '0', '8', '\n'}); err != nil {
			serverDone <- err
			return
		}
		buffer := make([]byte, 3)
		if _, err := connection.Read(buffer); err != nil {
			serverDone <- err
			return
		}
		if string(buffer) != "abc" {
			serverDone <- &unexpectedBytes{got: string(buffer)}
			return
		}
		_, err = connection.Write([]byte("ok"))
		serverDone <- err
	}()

	mux := http.NewServeMux()
	mux.HandleFunc("/rfb", func(w http.ResponseWriter, r *http.Request) {
		handler(w, r, listener.Addr().String())
	})
	httpServer := httptest.NewServer(mux)
	defer httpServer.Close()

	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/rfb"
	client, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	_ = client.SetReadDeadline(time.Now().Add(2 * time.Second))
	messageType, payload, err := client.ReadMessage()
	if err != nil {
		t.Fatal(err)
	}
	if messageType != websocket.BinaryMessage || string(payload) != "RFB 003.008\n" {
		t.Fatalf("unexpected TCP banner: type=%d payload=%q", messageType, payload)
	}
	if err := client.WriteMessage(websocket.BinaryMessage, []byte("abc")); err != nil {
		t.Fatal(err)
	}
	messageType, payload, err = client.ReadMessage()
	if err != nil {
		t.Fatal(err)
	}
	if messageType != websocket.BinaryMessage || string(payload) != "ok" {
		t.Fatalf("unexpected TCP reply: type=%d payload=%q", messageType, payload)
	}
	if err := <-serverDone; err != nil {
		t.Fatal(err)
	}
}

func TestValidUNORequest(t *testing.T) {
	for _, request := range []unoRequest{
		{Action: "state"},
		{Action: "gotoSlide", Slide: 1},
		{Action: "replaceSelection", Text: "你好"},
	} {
		if !validUNORequest(request) {
			t.Fatalf("expected valid request: %#v", request)
		}
	}
	for _, request := range []unoRequest{
		{Action: "unknown"},
		{Action: "gotoSlide", Slide: 0},
		{Action: "replaceSelection"},
		{Action: "state", Text: "unexpected"},
	} {
		if validUNORequest(request) {
			t.Fatalf("expected invalid request: %#v", request)
		}
	}
}

type unexpectedBytes struct{ got string }

func (e *unexpectedBytes) Error() string { return "unexpected bytes: " + e.got }

func TestGatewayHTTPRoutes(t *testing.T) {
	handler := gatewayHandler(config{}, &inputController{})
	for _, path := range []string{"/", "/kiosk.html"} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusOK || !strings.HasPrefix(response.Header().Get("Content-Type"), "text/html") {
			t.Errorf("GET %s = %d %q", path, response.Code, response.Header().Get("Content-Type"))
		}
		if response.Header().Get("Cache-Control") != "no-store" {
			t.Errorf("GET %s missing no-store", path)
		}
	}
	for _, path := range []string{"/compare.html", "/input-ab.html", "/api/uno"} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusNotFound {
			t.Errorf("GET %s = %d, want 404 in production gateway", path, response.Code)
		}
	}

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	var health map[string]any
	if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &health) != nil || health["status"] != "ok" {
		t.Fatalf("health response = %d %s", response.Code, response.Body.String())
	}
	if health["textLogLevel"] != textLogErrors {
		t.Fatalf("health textLogLevel = %#v", health["textLogLevel"])
	}
	for _, field := range []string{"textRequests", "textErrors", "textInputBytes", "textServerMicroseconds"} {
		if _, ok := health[field]; !ok {
			t.Errorf("health response is missing %s", field)
		}
	}
}

func TestSameHostOrigin(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "http://test-host:1991/rfb", nil)
	for _, origin := range []string{"", "http://test-host:1991", "https://test-host:1991"} {
		request.Header.Set("Origin", origin)
		if !sameHostOrigin(request) {
			t.Errorf("same host origin %q rejected", origin)
		}
	}
	request.Header.Set("Origin", "https://attacker.example")
	if sameHostOrigin(request) {
		t.Error("cross-origin request accepted")
	}
	request.Header.Set("Origin", "https://test-host:1991.attacker.example")
	if sameHostOrigin(request) {
		t.Error("host-prefix attack origin accepted")
	}
}
