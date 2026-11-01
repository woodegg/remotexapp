package main

import (
	"context"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"github.com/woodegg/remotexapp/internal/sessionaudio"
)

var audioCookieName = regexp.MustCompile(`^rxa_audio_[a-f0-9]{12}$`)
var audioCookieValue = regexp.MustCompile(`^[a-f0-9]{64}$`)

// Only the product audio epoch crosses this boundary. Cloudflare credentials,
// account cookies, raw peer addresses and arbitrary client headers terminate here.
func audioCookies(r *http.Request) string {
	values := []string{}
	for _, c := range r.Cookies() {
		if audioCookieName.MatchString(c.Name) && audioCookieValue.MatchString(c.Value) {
			values = append(values, c.Name+"="+c.Value)
			if len(values) == 8 {
				break
			}
		}
	}
	return strings.Join(values, "; ")
}
func audioResponseCookies(r *http.Response) []string {
	if !strings.HasPrefix(r.Request.URL.Path, "/rx/api/audio/") {
		return nil
	}
	result := []string{}
	for _, c := range r.Cookies() {
		if audioCookieName.MatchString(c.Name) && (audioCookieValue.MatchString(c.Value) || c.MaxAge < 0) {
			c.Domain = ""
			c.Path = "/"
			c.HttpOnly = true
			c.Secure = true
			c.SameSite = http.SameSiteStrictMode
			c.Raw = ""
			c.Unparsed = nil
			result = append(result, c.String())
		}
	}
	return result
}

func audioBridge(w http.ResponseWriter, r *http.Request, target *url.URL) {
	protocol := r.Header.Get("Sec-WebSocket-Protocol")
	if r.Method != "GET" || !websocket.IsWebSocketUpgrade(r) || !strings.HasPrefix(protocol, "remotexapp-audio.") || !audioCookieValue.MatchString(strings.TrimPrefix(protocol, "remotexapp-audio.")) {
		http.Error(w, "audio upgrade required", 400)
		return
	}
	u := *r.URL
	u.Scheme = "ws"
	u.Host = target.Host
	headers := upstreamHeaders(r)
	headers.Del("Sec-WebSocket-Protocol")
	headers.Set("Host", r.Host)
	dial := websocket.Dialer{HandshakeTimeout: 5 * time.Second, ReadBufferSize: 4096, WriteBufferSize: 4096, Subprotocols: []string{protocol}}
	up, response, err := dial.DialContext(r.Context(), u.String(), headers)
	if err != nil {
		status := 502
		if response != nil {
			if response.StatusCode == 403 || response.StatusCode == 409 {
				status = response.StatusCode
			}
			response.Body.Close()
		}
		http.Error(w, "audio upgrade rejected", status)
		return
	}
	defer up.Close()
	upgrade := websocket.Upgrader{Subprotocols: []string{protocol}, CheckOrigin: func(*http.Request) bool { return true }, ReadBufferSize: 4096, WriteBufferSize: 4096}
	client, err := upgrade.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer client.Close()
	client.SetReadLimit(4096)
	up.SetReadLimit(4096)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	heartbeat := browserHeartbeat(ctx, client, 20*time.Second, 60*time.Second)
	defer func() { cancel(); <-heartbeat }()
	relay := func(dst, src *websocket.Conn, kind byte) {
		for {
			typ, data, err := src.ReadMessage()
			if err != nil {
				return
			}
			if typ == websocket.BinaryMessage {
				if _, _, _, err = sessionaudio.ParsePacket(data, kind); err != nil {
					return
				}
			} else if typ != websocket.TextMessage || len(data) > 4096 {
				return
			}
			_ = dst.SetWriteDeadline(time.Now().Add(3 * time.Second))
			if dst.WriteMessage(typ, data) != nil {
				return
			}
		}
	}
	done := make(chan struct{})
	go func() { defer close(done); defer client.Close(); defer up.Close(); relay(up, client, 2) }()
	relay(client, up, 1)
	client.Close()
	up.Close()
	<-done
}
