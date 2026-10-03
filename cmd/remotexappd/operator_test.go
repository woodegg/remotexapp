package main

import (
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestOperatorServiceRestartRequiresCapabilityIdentityAndConfirmation(t *testing.T) {
	networks, err := parseTrustedNetworks("127.0.0.0/8")
	if err != nil {
		t.Fatal(err)
	}
	called := 0
	m := &manager{
		cfg:       config{authMode: "trusted-header", identityHeader: "X-Remote-User", trustedProxyNetworks: networks, enableServiceRestart: true},
		instances: map[string]*instance{}, idleTimers: map[string]*time.Timer{},
		operatorCall: func(request operatorHelperRequest) (*operatorHelperResponse, error) {
			called++
			if request.Action != "restart-manager" || request.Actor != "operator@example.test" || !validOperatorOperationID(request.OperationID) {
				t.Fatalf("operator helper request = %#v", request)
			}
			return &operatorHelperResponse{Operation: &operatorOperation{ID: request.OperationID, Action: request.Action, State: "accepted"}}, nil
		},
	}
	request := httptest.NewRequest(http.MethodPost, "/api/operator/service/restart", strings.NewReader("{}"))
	request.RemoteAddr = "127.0.0.1:12345"
	request.Header.Set("X-Remote-User", "operator@example.test")
	missingConfirmation := httptest.NewRecorder()
	m.handler().ServeHTTP(missingConfirmation, request)
	if missingConfirmation.Code != http.StatusForbidden || called != 0 {
		t.Fatalf("missing confirmation = %d calls=%d", missingConfirmation.Code, called)
	}

	request = httptest.NewRequest(http.MethodPost, "/api/operator/service/restart", strings.NewReader("{}"))
	request.RemoteAddr = "127.0.0.1:12345"
	request.Header.Set("X-Remote-User", "operator@example.test")
	request.Header.Set(operatorRequestHeader, "console-v1")
	response := httptest.NewRecorder()
	m.handler().ServeHTTP(response, request)
	if response.Code != http.StatusAccepted || called != 1 {
		t.Fatalf("authorized restart = %d calls=%d body=%s", response.Code, called, response.Body.String())
	}
	var operation operatorOperation
	if err := json.Unmarshal(response.Body.Bytes(), &operation); err != nil || operation.State != "accepted" {
		t.Fatalf("operation = %#v, %v", operation, err)
	}
}

func TestOperatorServiceRestartIsHiddenWhenDisabledOrUnauthenticated(t *testing.T) {
	m := &manager{cfg: config{authMode: "none"}, instances: map[string]*instance{}, idleTimers: map[string]*time.Timer{}}
	response := httptest.NewRecorder()
	m.handler().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/operator/service/restart", strings.NewReader("{}")))
	if response.Code != http.StatusNotFound {
		t.Fatalf("disabled restart = %d", response.Code)
	}
	version := httptest.NewRecorder()
	m.handler().ServeHTTP(version, httptest.NewRequest(http.MethodGet, "/api/version", nil))
	var payload struct {
		Capabilities map[string]bool `json:"capabilities"`
	}
	if err := json.Unmarshal(version.Body.Bytes(), &payload); err != nil || payload.Capabilities["serviceRestart"] || !payload.Capabilities["runtimeRestart"] {
		t.Fatalf("capabilities = %#v, %v", payload.Capabilities, err)
	}
}

func TestOperatorOperationStatusUsesOnlyValidatedOpaqueID(t *testing.T) {
	networks, _ := parseTrustedNetworks("127.0.0.0/8")
	id := "operator-0123456789abcdef01234567"
	m := &manager{
		cfg:       config{authMode: "trusted-header", identityHeader: "X-Remote-User", trustedProxyNetworks: networks, enableServiceRestart: true},
		instances: map[string]*instance{}, idleTimers: map[string]*time.Timer{},
		operatorCall: func(request operatorHelperRequest) (*operatorHelperResponse, error) {
			if request != (operatorHelperRequest{Action: "status", OperationID: id}) {
				t.Fatalf("status request = %#v", request)
			}
			return &operatorHelperResponse{Operation: &operatorOperation{ID: id, Action: "restart-manager", State: "succeeded"}}, nil
		},
	}
	request := httptest.NewRequest(http.MethodGet, "/api/operator/operations/"+id, nil)
	request.RemoteAddr = "127.0.0.1:12345"
	request.Header.Set("X-Remote-User", "operator@example.test")
	response := httptest.NewRecorder()
	m.handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("operation status = %d %s", response.Code, response.Body.String())
	}
}

func TestOperatorSocketMustRemainInsideCurrentUserRuntime(t *testing.T) {
	if pathWithinUserRuntime("/tmp/operator.sock") || !pathWithinUserRuntime("/run/user/"+portString(userIDForTest())+"/remotexapp/operator.sock") {
		t.Fatal("operator socket boundary was not enforced")
	}
}

func TestOperatorClientHalfClosesRequestBeforeReadingResponse(t *testing.T) {
	listener, err := net.Listen("unix", t.TempDir()+"/operator.sock")
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
		var request operatorHelperRequest
		if err := json.NewDecoder(connection).Decode(&request); err != nil {
			serverDone <- err
			return
		}
		trailing, err := io.ReadAll(connection)
		if err != nil || len(trailing) != 0 {
			serverDone <- errors.New("operator client did not terminate its request stream")
			return
		}
		serverDone <- json.NewEncoder(connection).Encode(operatorHelperResponse{Status: "ok"})
	}()
	result, err := callOperatorHelper(listener.Addr().String(), operatorHelperRequest{Action: "ping"})
	if err != nil || result.Status != "ok" {
		t.Fatalf("operator call = %#v, %v", result, err)
	}
	if err := <-serverDone; err != nil {
		t.Fatal(err)
	}
}

func userIDForTest() int { return os.Getuid() }
