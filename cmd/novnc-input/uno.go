package main

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os/exec"
	"strings"
	"time"
)

func unoAPIHandler(unoURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		if r.Method == http.MethodGet {
			serveUNO(w, r, unoURL, unoRequest{Action: "state"})
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", "GET, POST")
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}
		defer r.Body.Close()
		var request unoRequest
		decoder := json.NewDecoder(io.LimitReader(r.Body, 16<<10))
		if err := decoder.Decode(&request); err != nil || !validUNORequest(request) {
			http.Error(w, `{"error":"invalid UNO request"}`, http.StatusBadRequest)
			return
		}
		serveUNO(w, r, unoURL, request)
	}
}

func validUNORequest(request unoRequest) bool {
	switch request.Action {
	case "state":
		return request.Slide == 0 && request.Text == ""
	case "gotoSlide":
		return request.Slide > 0 && request.Slide <= 10000 && request.Text == ""
	case "replaceSelection":
		return request.Slide == 0 && len(request.Text) > 0 && len(request.Text) <= 8192
	default:
		return false
	}
}

func serveUNO(w http.ResponseWriter, r *http.Request, unoURL string, request unoRequest) {
	payload, _ := json.Marshal(request)
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, "python3", "-c", string(unoAPIScript), unoURL)
	command.Stdin = strings.NewReader(string(payload))
	output, err := command.Output()
	if ctx.Err() != nil {
		http.Error(w, `{"error":"UNO request timed out"}`, http.StatusGatewayTimeout)
		return
	}
	if err != nil {
		log.Printf("UNO %s: %v", request.Action, err)
		http.Error(w, `{"error":"LibreOffice UNO request failed"}`, http.StatusBadGateway)
		return
	}
	if !json.Valid(output) {
		log.Printf("UNO %s returned invalid JSON", request.Action)
		http.Error(w, `{"error":"LibreOffice UNO returned invalid data"}`, http.StatusBadGateway)
		return
	}
	_, _ = w.Write(output)
}
