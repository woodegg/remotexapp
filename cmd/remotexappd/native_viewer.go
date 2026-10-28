package main

import (
	"net/http"
	"net/http/httputil"
	"net/url"
	"path"
	"strings"
)

// Authentication and Origin validation are applied by the Manager's secure
// handler. This allowlist prevents the upstream server's management API from
// becoming part of the public Viewer surface.
func (m *manager) serveNativeInstance(w http.ResponseWriter, r *http.Request, item *instance, route string) {
	if route == "native/prepare" {
		m.prepareNativeViewer(w, r, item.ID)
		return
	}
	if route == "kiosk.html" {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			methodNotAllowed(w, "GET, HEAD")
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		if r.Method == http.MethodGet {
			_, _ = w.Write(nativeViewerHTML)
		}
		return
	}
	if !strings.HasPrefix(route, "native/") || path.Clean(route) != route {
		http.NotFound(w, r)
		return
	}
	member := strings.TrimPrefix(route, "native/")
	var channel *viewerChannel
	if member == "websockify" {
		if r.Method != http.MethodGet || !isWebSocket(r) {
			writeError(w, http.StatusBadRequest, "WebSocket upgrade required")
			return
		}
		var err error
		channel, r, err = m.openViewerChannel(item.ID, true, r)
		if err != nil {
			writeError(w, http.StatusConflict, "Viewer channel unavailable: "+err.Error())
			return
		}
		defer m.closeViewerChannel(channel)
	} else if r.Method != http.MethodGet && r.Method != http.MethodHead {
		methodNotAllowed(w, "GET, HEAD")
		return
	} else if member != "client.js" && !strings.HasSuffix(member, ".wasm") {
		http.NotFound(w, r)
		return
	}
	target := &url.URL{Scheme: "http", Host: item.GatewayAddr}
	proxy := httputil.NewSingleHostReverseProxy(target)
	director := proxy.Director
	proxy.Director = func(request *http.Request) {
		director(request)
		request.URL.Path, request.URL.RawPath = "/"+member, ""
	}
	if channel != nil {
		proxy.ModifyResponse = func(response *http.Response) error { return m.bindViewerChannel(channel, response) }
	}
	proxy.ErrorHandler = func(writer http.ResponseWriter, _ *http.Request, _ error) {
		writeError(writer, http.StatusBadGateway, "native display unavailable")
	}
	proxy.ServeHTTP(w, r)
}

func (m *manager) prepareNativeViewer(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, "POST")
		return
	}
	var request struct {
		SessionGeneration *int64 `json:"sessionGeneration"`
	}
	if err := decodeStrictJSON(r.Body, &request); err != nil || request.SessionGeneration == nil || *request.SessionGeneration < 0 {
		writeError(w, http.StatusBadRequest, "sessionGeneration is required")
		return
	}
	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()
	item := m.get(id)
	if !isKasm(item) || (item.State != "server-ready" && item.State != "ready") || item.SessionGeneration != *request.SessionGeneration {
		writeError(w, http.StatusConflict, "stale native Viewer descriptor")
		return
	}
	if item.SessionState != "running" && item.SessionState != "stopped" && item.SessionState != "failed" {
		writeError(w, http.StatusConflict, "session transition is in progress")
		return
	}
	m.cancelBlockedShutdown(id)
	if err := m.startSession(id); err != nil {
		writeError(w, http.StatusConflict, "native session could not start")
		return
	}
	// Preparation is not an attachment. A client which abandons this response
	// must still obey the App's vacancy policy.
	m.scheduleVacancy(id)
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, m.publicInstance(m.get(id)))
}
