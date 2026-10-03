package main

import "testing"

func TestBooleanEnvironmentDefault(t *testing.T) {
	const name = "REMOTEXAPP_TEST_BOOLEAN_DEFAULT"
	t.Setenv(name, "true")
	if value, err := booleanEnvironmentDefault(name, false); err != nil || !value {
		t.Fatalf("true environment = %v, %v", value, err)
	}
	t.Setenv(name, "false")
	if value, err := booleanEnvironmentDefault(name, true); err != nil || value {
		t.Fatalf("false environment = %v, %v", value, err)
	}
	t.Setenv(name, "yes")
	if _, err := booleanEnvironmentDefault(name, false); err == nil {
		t.Fatal("invalid boolean environment was accepted")
	}
	t.Setenv(name, "")
	if value, err := booleanEnvironmentDefault(name, true); err != nil || !value {
		t.Fatalf("empty environment fallback = %v, %v", value, err)
	}
}
