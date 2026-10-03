package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

const operatorRequestHeader = "X-RemoteXApp-Operator-Request"

type operatorHelperRequest struct {
	Action      string `json:"action"`
	OperationID string `json:"operationId,omitempty"`
	Actor       string `json:"actor,omitempty"`
}

type operatorOperation struct {
	ID          string     `json:"id"`
	Action      string     `json:"action"`
	State       string     `json:"state"`
	RequestedAt time.Time  `json:"requestedAt"`
	StartedAt   *time.Time `json:"startedAt,omitempty"`
	FinishedAt  *time.Time `json:"finishedAt,omitempty"`
	Error       string     `json:"error,omitempty"`
}

type operatorHelperResponse struct {
	Status    string             `json:"status,omitempty"`
	Operation *operatorOperation `json:"operation,omitempty"`
	Error     string             `json:"error,omitempty"`
}

func probeOperatorHelper(socketPath string) error {
	result, err := callOperatorHelper(socketPath, operatorHelperRequest{Action: "ping"})
	if err != nil {
		return err
	}
	if result.Status != "ok" {
		return errors.New("operator helper returned an invalid health response")
	}
	return nil
}

func callOperatorHelper(socketPath string, request operatorHelperRequest) (*operatorHelperResponse, error) {
	connection, err := net.DialTimeout("unix", socketPath, 2*time.Second)
	if err != nil {
		return nil, err
	}
	defer connection.Close()
	_ = connection.SetDeadline(time.Now().Add(5 * time.Second))
	if err := json.NewEncoder(connection).Encode(request); err != nil {
		return nil, err
	}
	unixConnection, ok := connection.(*net.UnixConn)
	if !ok {
		return nil, errors.New("operator helper requires a Unix connection")
	}
	// The helper rejects trailing JSON and therefore reads through EOF before
	// replying. Half-close only the request side so its response remains readable.
	if err := unixConnection.CloseWrite(); err != nil {
		return nil, err
	}
	var result operatorHelperResponse
	decoder := json.NewDecoder(io.LimitReader(connection, 16<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&result); err != nil {
		return nil, err
	}
	if result.Error != "" {
		return nil, errors.New(result.Error)
	}
	return &result, nil
}

func (m *manager) serveOperatorServiceRestart(w http.ResponseWriter, r *http.Request) {
	if !m.cfg.enableServiceRestart || m.cfg.authMode != "trusted-header" {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodPost {
		methodNotAllowed(w, "POST")
		return
	}
	if r.Header.Get(operatorRequestHeader) != "console-v1" {
		writeError(w, http.StatusForbidden, "operator request confirmation header is required")
		return
	}
	if r.ContentLength > 0 {
		var request struct{}
		if err := decodeStrictJSON(r.Body, &request); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
			return
		}
	}
	actor, _ := r.Context().Value(requestIdentityKey{}).(string)
	if actor == "" || actor == "development" {
		writeError(w, http.StatusForbidden, "authenticated operator identity required")
		return
	}
	id, err := newOperatorOperationID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "cannot allocate operator operation")
		return
	}
	result, err := m.callOperator(operatorHelperRequest{
		Action: "restart-manager", OperationID: id, Actor: actor,
	})
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "operator helper: "+err.Error())
		return
	}
	if result.Operation == nil {
		writeError(w, http.StatusBadGateway, "operator helper omitted operation status")
		return
	}
	writeJSON(w, http.StatusAccepted, result.Operation)
}

func (m *manager) serveOperatorOperation(w http.ResponseWriter, r *http.Request) {
	if !m.cfg.enableServiceRestart || m.cfg.authMode != "trusted-header" {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodGet {
		methodNotAllowed(w, "GET")
		return
	}
	id := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/operator/operations/"), "/")
	if !validOperatorOperationID(id) {
		http.NotFound(w, r)
		return
	}
	result, err := m.callOperator(operatorHelperRequest{Action: "status", OperationID: id})
	if err != nil {
		status := http.StatusServiceUnavailable
		if strings.Contains(err.Error(), "not found") {
			status = http.StatusNotFound
		}
		writeError(w, status, "operator helper: "+err.Error())
		return
	}
	if result.Operation == nil {
		writeError(w, http.StatusBadGateway, "operator helper omitted operation status")
		return
	}
	writeJSON(w, http.StatusOK, result.Operation)
}

func newOperatorOperationID() (string, error) {
	value := make([]byte, 12)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return "operator-" + hex.EncodeToString(value), nil
}

func validOperatorOperationID(value string) bool {
	if !strings.HasPrefix(value, "operator-") || len(value) != len("operator-")+24 {
		return false
	}
	_, err := hex.DecodeString(strings.TrimPrefix(value, "operator-"))
	return err == nil
}

func (m *manager) callOperator(request operatorHelperRequest) (*operatorHelperResponse, error) {
	if m.operatorCall != nil {
		return m.operatorCall(request)
	}
	return callOperatorHelper(m.cfg.operatorSocket, request)
}
