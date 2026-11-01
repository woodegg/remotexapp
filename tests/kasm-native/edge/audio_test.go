package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAudioOnlyForwardsEpochCookieAndSanitizesResponse(t *testing.T) {
	name := "rxa_audio_123456abcdef"
	value := strings.Repeat("a", 64)
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Cookie") != name+"="+value {
			t.Error("wrong scoped cookies", r.Header.Get("Cookie"))
		}
		for _, header := range []string{"Authorization", "CF-Access-Jwt-Assertion", "CF-Connecting-IP", "X-Forwarded-For"} {
			if r.Header.Get(header) != "" {
				t.Errorf("private metadata escaped: %s", header)
			}
		}
		if r.Header.Get("X-Forwarded-Proto") != "https" {
			t.Error("secure origin lost")
		}
		w.Header().Add("Set-Cookie", name+"="+value+"; Domain=evil.example; Path=/danger; SameSite=None")
		w.Header().Add("Set-Cookie", "CF_Authorization=private")
		io.WriteString(w, `{"ok":true}`)
	}))
	defer backend.Close()
	h, err := edgeHandler(configuration{Origin: "https://uat.example", Backend: backend.URL})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("POST", "https://uat.example/rx/api/audio/context", strings.NewReader(`{}`))
	req.RemoteAddr = "127.0.0.1:12345"
	req.Header.Set("Cookie", "CF_Authorization=private; "+name+"="+value+"; login=private")
	for _, key := range []string{"Authorization", "CF-Access-Jwt-Assertion", "CF-Connecting-IP", "X-Forwarded-For"} {
		req.Header.Set(key, "private")
	}
	response := httptest.NewRecorder()
	h.ServeHTTP(response, req)
	if response.Code != 200 {
		t.Fatal(response.Code)
	}
	cookies := response.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatal("unexpected cookie escape", len(cookies))
	}
	cookie := cookies[0]
	if cookie.Name != name || cookie.Domain != "" || cookie.Path != "/" || !cookie.Secure || !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode {
		t.Fatal("cookie scope not constrained")
	}
	req.URL.Path = "/rx/api/instances"
	if upstreamHeaders(req).Get("Cookie") != "" {
		t.Fatal("audio cookie escaped to other APIs")
	}
}
