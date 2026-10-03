package main

import (
	"context"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestHelperRejectsAnythingExceptFixedActions(t *testing.T) {
	h := &helper{unit: "remotexapp.service", minimum: time.Second, restartDelay: time.Millisecond, operations: make(map[string]*operation)}
	for _, value := range []request{
		{Action: "restart-manager", OperationID: "operator-0123456789abcdef01234567", Actor: ""},
		{Action: "restart-unit", OperationID: "operator-0123456789abcdef01234567", Actor: "operator@example.test"},
		{Action: "status", OperationID: "../../etc/passwd"},
		{Action: "ping", Actor: "unexpected"},
	} {
		if result := h.handle(value); result.Error == "" {
			t.Fatalf("unsafe request was accepted: %#v => %#v", value, result)
		}
	}
}

func TestHelperRestartIsIdempotentRateLimitedAndObservable(t *testing.T) {
	var calls atomic.Int32
	h := &helper{
		unit: "remotexapp.service", minimum: time.Minute, restartDelay: time.Millisecond,
		operations: make(map[string]*operation),
		restart: func(_ context.Context, unit string) error {
			if unit != "remotexapp.service" {
				t.Fatalf("unit = %q", unit)
			}
			calls.Add(1)
			return nil
		},
	}
	firstRequest := request{Action: "restart-manager", OperationID: "operator-0123456789abcdef01234567", Actor: "operator@example.test"}
	first := h.handle(firstRequest)
	if first.Error != "" || first.Operation == nil || first.Operation.State != "accepted" {
		t.Fatalf("first restart = %#v", first)
	}
	if repeated := h.handle(firstRequest); repeated.Error != "" || repeated.Operation == nil || repeated.Operation.ID != firstRequest.OperationID {
		t.Fatalf("idempotent restart = %#v", repeated)
	}
	second := h.handle(requestWithID("operator-89abcdef0123456701234567"))
	if !strings.Contains(second.Error, "rate limit") {
		t.Fatalf("second restart = %#v", second)
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		status := h.handle(request{Action: "status", OperationID: firstRequest.OperationID})
		if status.Operation != nil && status.Operation.State == "succeeded" {
			if calls.Load() != 1 {
				t.Fatalf("restart calls = %d", calls.Load())
			}
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("restart did not reach succeeded")
}

func TestHelperSurfacesBoundedRestartFailure(t *testing.T) {
	h := &helper{
		unit: "remotexapp.service", minimum: time.Second, restartDelay: time.Millisecond,
		operations: make(map[string]*operation),
		restart:    func(context.Context, string) error { return errors.New(strings.Repeat("x", 2048)) },
	}
	value := requestWithID("operator-fedcba987654321001234567")
	if result := h.handle(value); result.Error != "" {
		t.Fatal(result.Error)
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		status := h.handle(request{Action: "status", OperationID: value.OperationID})
		if status.Operation != nil && status.Operation.State == "failed" {
			if len(status.Operation.Error) != 1024 {
				t.Fatalf("bounded error length = %d", len(status.Operation.Error))
			}
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("restart did not reach failed")
}

func requestWithID(id string) request {
	return request{Action: "restart-manager", OperationID: id, Actor: "operator@example.test"}
}
