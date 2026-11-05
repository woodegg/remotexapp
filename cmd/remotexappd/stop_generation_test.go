package main

import (
	"errors"
	"testing"
	"time"
)

func TestStopGenerationFencePrecedesAllLifecycleMutation(t *testing.T) {
	old := &instance{ID: "owned", SessionGeneration: 3, State: "ready", SessionState: "running"}
	current := *old
	current.SessionGeneration = 4
	timer := time.NewTimer(time.Hour)
	defer timer.Stop()
	m := &manager{instances: map[string]*instance{old.ID: &current}, idleTimers: map[string]*time.Timer{old.ID: timer}}
	generation := int64(3)
	if err := m.stop(old, stopOptions{Force: true, ExpectedGeneration: &generation}); !errors.Is(err, errStopGeneration) {
		t.Fatal(err)
	}
	if m.idleTimers[old.ID] != timer || current.State != "ready" || current.SessionState != "running" || current.RuntimeDesired != "" {
		t.Fatal("stale stop mutated replacement runtime")
	}
	delete(m.instances, old.ID)
	if err := m.stop(old, stopOptions{ExpectedGeneration: &generation}); !errors.Is(err, errStopGeneration) {
		t.Fatal("missing runtime accepted", err)
	}
}
