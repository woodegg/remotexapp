package main

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestPinnedControlPortTimeWaitReuse(t *testing.T) {
	for _, reusable := range []bool{false, true} {
		t.Run(map[bool]string{false: "non-reusable", true: "reusable"}[reusable], func(t *testing.T) {
			lc := net.ListenConfig{Control: func(_, _ string, raw syscall.RawConn) error {
				var optionErr error
				err := raw.Control(func(fd uintptr) {
					value := 0
					if reusable {
						value = 1
					}
					optionErr = syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, syscall.SO_REUSEADDR, value)
				})
				if err != nil {
					return err
				}
				return optionErr
			}}
			listener, err := lc.Listen(context.Background(), "tcp4", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			port := listener.Addr().(*net.TCPAddr).Port
			m := &manager{instances: map[string]*instance{}}
			if !m.controlPortBusyExcept(port, "self") {
				t.Fatal("live listener accepted")
			}
			client, err := net.DialTimeout("tcp4", listener.Addr().String(), time.Second)
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()
			server, err := listener.Accept()
			if err != nil {
				t.Fatal(err)
			}
			_ = client.SetDeadline(time.Now().Add(time.Second))
			_ = server.Close() // Server actively closes so its port enters TIME_WAIT.
			_, _ = client.Read(make([]byte, 1))
			_ = client.Close()
			_ = listener.Close()
			if !portBusy(port) {
				t.Fatal("fixture did not produce a non-plain-bindable port")
			}
			if !m.controlPortBusy(port) {
				t.Fatal("fresh allocation relaxed TIME_WAIT safety")
			}
			if busy := m.controlPortBusyExcept(port, "self"); busy == reusable {
				t.Fatalf("pinned reuse=%v busy=%v", reusable, busy)
			}
			m.instances["other"] = &instance{State: "ready", Resources: map[string]allocatedResource{
				"control": {Kind: "loopback-tcp", Address: "127.0.0.1", Port: port},
			}}
			if !m.controlPortBusyExcept(port, "self") {
				t.Fatal("other runtime ownership ignored")
			}
		})
	}
}

func TestRuntimeRestartReusesDurableIdentitySnapshotAndGeneration(t *testing.T) {
	generation := int64(7)
	class := classConfig{
		ID: "fixture-app", DriverVersion: "1.2.3", RunMode: "shared", ProfileRef: "default",
		Server:  serverClassConfig{DisplayMode: "dynamic"},
		Session: sessionClassConfig{Activation: "on-attach", VacantTimeout: "1h", VacantAction: "stop-instance"},
	}
	item := &instance{
		ID: "fixture-app-001122334455", ClassID: class.ID, TemplateID: class.ID, DriverVersion: class.DriverVersion,
		ProfileRef: "default", WorkspaceMode: "persistent", State: "server-ready", SessionState: "running",
		SessionGeneration: generation, Display: ":44", RFBAddr: "127.0.0.1:5944", GatewayAddr: "127.0.0.1:39044",
		Parameters: map[string]any{"url": "https://example.test"}, Resources: map[string]allocatedResource{"automation": {Kind: "loopback-tcp", Address: "127.0.0.1", Port: 21444}},
		Spec: class, Components: runtimeComponents{GatewayBinary: "/locked/gateway", UnicodeEngine: "/locked/engine"},
		RuntimeDesired: "running", CreatedAt: time.Unix(123, 0),
	}
	m := &manager{cfg: config{classes: map[string]classConfig{class.ID: class}}, instances: map[string]*instance{item.ID: item}, idleTimers: map[string]*time.Timer{}}
	stopCalled := false
	m.runtimeRestartStop = func(got *instance, options stopOptions) error {
		stopCalled = true
		if got.ID != item.ID || !options.Force || !options.PreserveRuntime || options.Reason != "api-restart" || options.Scope != "instance" {
			t.Fatalf("restart stop = %#v %#v", got, options)
		}
		return nil
	}
	m.runtimeRecoveryCreate = func(request createRequest) (*instance, error) {
		if request.RuntimeID != item.ID || request.CreatedAt != item.CreatedAt || request.SessionGeneration != generation+1 || request.PinnedSpec.DriverVersion != class.DriverVersion || request.PinnedComponents.GatewayBinary != "/locked/gateway" {
			t.Fatalf("recovery request lost durable intent: %#v", request)
		}
		if request.PinnedAllocation == nil || request.PinnedAllocation.Display != item.Display || request.PinnedAllocation.Resources["automation"].Port != 21444 {
			t.Fatalf("recovery request lost allocation: %#v", request.PinnedAllocation)
		}
		restarted := *item
		restarted.SessionState = "stopped"
		restarted.SessionGeneration = request.SessionGeneration
		m.storeRuntime(&restarted)
		return &restarted, nil
	}
	restarted, err := m.restartRuntime(item.ID, restartRequest{SessionGeneration: &generation, Force: true})
	if err != nil || !stopCalled || restarted == nil || restarted.ID != item.ID || restarted.SessionGeneration != generation+1 {
		t.Fatalf("restart = %#v, %v stop=%v", restarted, err, stopCalled)
	}
	stopCalled = false
	if _, err := m.restartRuntime(item.ID, restartRequest{SessionGeneration: &generation, Force: true}); err == nil || stopCalled {
		t.Fatal("duplicate on-attach restart was not fenced before stopping")
	}
}

func TestRuntimeRestartRejectsStaleGenerationBeforeStopping(t *testing.T) {
	current, stale := int64(4), int64(3)
	item := &instance{ID: "fixture-app-001122334455", State: "server-ready", SessionGeneration: current}
	m := &manager{instances: map[string]*instance{item.ID: item}, idleTimers: map[string]*time.Timer{}, runtimeRestartStop: func(*instance, stopOptions) error {
		t.Fatal("stale restart reached stop")
		return nil
	}}
	if _, err := m.restartRuntime(item.ID, restartRequest{SessionGeneration: &stale}); err == nil || !strings.Contains(err.Error(), "stale session generation") {
		t.Fatalf("stale restart error = %v", err)
	}
}

func TestRuntimeRestartFailureRetainsRetryableRunningIntent(t *testing.T) {
	generation := int64(2)
	item := &instance{
		ID: "fixture-app-556677889900", ClassID: "fixture-app", TemplateID: "fixture-app",
		State: "server-ready", SessionState: "stopped", SessionGeneration: generation,
		RuntimeDesired: "running", Spec: classConfig{ID: "fixture-app"},
	}
	m := &manager{
		instances: map[string]*instance{item.ID: item}, idleTimers: map[string]*time.Timer{},
		runtimeRestartStop:    func(*instance, stopOptions) error { return nil },
		runtimeRecoveryCreate: func(createRequest) (*instance, error) { return nil, errors.New("injected allocation failure") },
	}
	restarted, err := m.restartRuntime(item.ID, restartRequest{SessionGeneration: &generation})
	if err == nil || restarted == nil || restarted.ID != item.ID || restarted.State != "failed" || restarted.RuntimeDesired != "running" || !strings.Contains(restarted.Error, "allocation failure") {
		t.Fatalf("failed restart = %#v, %v", restarted, err)
	}
	stored := m.get(item.ID)
	if stored == nil || stored.RuntimeDesired != "running" || stored.ID != item.ID {
		t.Fatalf("retryable restart intent = %#v", stored)
	}
}

func TestRuntimeRestartHTTPRequiresExactGeneration(t *testing.T) {
	generation := int64(5)
	class := classConfig{ID: "fixture-app", Session: sessionClassConfig{Status: statusClassConfig{}}}
	item := &instance{ID: "fixture-app-112233445566", ClassID: class.ID, TemplateID: class.ID, State: "server-ready", SessionState: "stopped", SessionGeneration: generation, Spec: class}
	m := &manager{
		cfg:       config{authMode: "none", classes: map[string]classConfig{class.ID: class}},
		instances: map[string]*instance{item.ID: item}, idleTimers: map[string]*time.Timer{},
		runtimeRestartStop: func(*instance, stopOptions) error { return nil },
	}
	m.runtimeRecoveryCreate = func(createRequest) (*instance, error) { m.storeRuntime(item); return item, nil }
	for _, test := range []struct {
		body string
		want int
	}{
		{`{}`, http.StatusBadRequest},
		{`{"sessionGeneration":4}`, http.StatusConflict},
		{`{"sessionGeneration":5,"unknown":true}`, http.StatusBadRequest},
		{`{"sessionGeneration":5}`, http.StatusOK},
	} {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/api/instances/"+item.ID+"/restart", strings.NewReader(test.body))
		m.handler().ServeHTTP(response, request)
		if response.Code != test.want {
			t.Errorf("restart %s = %d, want %d: %s", test.body, response.Code, test.want, response.Body.String())
		}
	}
}

func TestPinnedRuntimeAllocationPreservesEveryPortAndFailsWhenBusy(t *testing.T) {
	ports := freePorts(t, 3)
	rfb, gateway, resource := ports[0], ports[1], ports[2]
	class := classConfig{
		Server: serverClassConfig{DisplayMode: "dynamic"},
		Ports:  map[string]portClassConfig{"automation": {Kind: "loopback-tcp"}},
	}
	pinned := &instance{
		ID: "fixture-app-001122334455", State: "restarting", Display: ":98",
		RFBAddr: net.JoinHostPort("127.0.0.1", portString(rfb)), GatewayAddr: net.JoinHostPort("127.0.0.1", portString(gateway)),
		Resources: map[string]allocatedResource{"automation": {Kind: "loopback-tcp", Address: "127.0.0.1", Port: resource}},
	}
	m := &manager{instances: map[string]*instance{pinned.ID: pinned}}
	display, gotRFB, gotGateway, _, resources, err := m.allocateRuntimeRequest(class, pinned)
	if err != nil || display != 98 || gotRFB != rfb || gotGateway != gateway || resources["automation"].Port != resource {
		t.Fatalf("pinned allocation = %d %d %d %#v, %v", display, gotRFB, gotGateway, resources, err)
	}
	listener, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", portString(resource)))
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	if _, _, _, _, _, err := m.allocateRuntimeRequest(class, pinned); err == nil {
		t.Fatal("busy pinned resource was accepted")
	}
	listener.Close()
	other := *pinned
	other.ID = "fixture-app-aabbccddeeff"
	m.instances[other.ID] = &other
	if _, _, _, _, _, err := m.allocateRuntimeRequest(class, pinned); err == nil {
		t.Fatal("another runtime using the pinned allocation was ignored")
	}
}

func TestRuntimeRecoveryIgnoresOnlyItsOwnSingletonConflict(t *testing.T) {
	class := classConfig{ID: "fixture-app", Singleton: true, RunMode: "shared"}
	self := &instance{ID: "fixture-app-001122334455", ClassID: class.ID, State: "restarting", Spec: class}
	m := &manager{cfg: config{classes: map[string]classConfig{class.ID: class}}, instances: map[string]*instance{self.ID: self}}
	existing, active, err := m.createConflict(class, createRequest{RuntimeID: self.ID})
	if err != nil || existing != nil || active != 0 {
		t.Fatalf("self recovery conflict = %#v active=%d err=%v", existing, active, err)
	}
	other := *self
	other.ID = "fixture-app-aabbccddeeff"
	m.instances[other.ID] = &other
	existing, active, err = m.createConflict(class, createRequest{RuntimeID: self.ID})
	if err != nil || existing == nil || existing.ID != other.ID || active != 1 {
		t.Fatalf("other singleton conflict = %#v active=%d err=%v", existing, active, err)
	}

	userHome := class
	userHome.RunMode = "user-home"
	other.Spec = userHome
	if _, _, err := m.createConflict(userHome, createRequest{RuntimeID: self.ID, ManagedID: "desktop"}); err == nil || !strings.Contains(err.Error(), "owns the current Unix user HOME") {
		t.Fatalf("other user-home conflict = %v", err)
	}
}

func freePorts(t *testing.T, count int) []int {
	t.Helper()
	listeners := make([]net.Listener, 0, count)
	ports := make([]int, 0, count)
	for range count {
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		listeners = append(listeners, listener)
		ports = append(ports, listener.Addr().(*net.TCPAddr).Port)
	}
	for _, listener := range listeners {
		listener.Close()
	}
	return ports
}

func portString(port int) string {
	const digits = "0123456789"
	if port == 0 {
		return "0"
	}
	value := make([]byte, 0, 5)
	for port > 0 {
		value = append([]byte{digits[port%10]}, value...)
		port /= 10
	}
	return string(value)
}
