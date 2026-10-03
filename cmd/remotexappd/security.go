package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net"
	"net/http"
	"net/url"
	"strings"
)

type requestIdentityKey struct{}

func (m *manager) secure(handler http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		setSecurityHeaders(w)
		requestID := strings.TrimSpace(r.Header.Get("X-Request-ID"))
		if !validRequestID(requestID) {
			var value [12]byte
			if _, err := rand.Read(value[:]); err == nil {
				requestID = hex.EncodeToString(value[:])
			}
		}
		if requestID != "" {
			w.Header().Set("X-Request-ID", requestID)
		}
		if !sameOrigin(r) {
			writeError(w, http.StatusForbidden, "cross-origin request rejected")
			return
		}
		if r.URL.Path != "/healthz" && r.URL.Path != "/readyz" {
			identity, ok := m.authenticate(r)
			if !ok {
				w.Header().Set("WWW-Authenticate", `RemoteXApp realm="trusted-proxy"`)
				writeError(w, http.StatusUnauthorized, "authenticated identity required")
				return
			}
			r = r.WithContext(context.WithValue(r.Context(), requestIdentityKey{}, identity))
		}
		handler.ServeHTTP(w, r)
	})
}

func (m *manager) authenticate(r *http.Request) (string, bool) {
	if m.cfg.authMode == "" || m.cfg.authMode == "none" {
		return "development", true
	}
	if m.cfg.authMode != "trusted-header" || !addressInNetworks(r.RemoteAddr, m.cfg.trustedProxyNetworks) {
		return "", false
	}
	identity := strings.TrimSpace(r.Header.Get(m.cfg.identityHeader))
	return identity, identity != "" && len(identity) <= 512
}

func addressInNetworks(remoteAddr string, networks []*net.IPNet) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	ip := net.ParseIP(strings.Trim(host, "[]"))
	if ip == nil {
		return false
	}
	for _, network := range networks {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

func sameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	return err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.User == nil && parsed.Path == "" && parsed.RawQuery == "" && parsed.Fragment == "" && parsed.Host != "" && strings.EqualFold(parsed.Host, r.Host)
}

func validRequestID(value string) bool {
	if len(value) < 1 || len(value) > 128 {
		return false
	}
	for _, character := range value {
		if (character < 'a' || character > 'z') && (character < 'A' || character > 'Z') && (character < '0' || character > '9') && character != '-' && character != '_' && character != '.' {
			return false
		}
	}
	return true
}

func setSecurityHeaders(w http.ResponseWriter) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "SAMEORIGIN")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), clipboard-read=(self), clipboard-write=(self)")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'self'")
}
