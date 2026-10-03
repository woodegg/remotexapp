package main

import "testing"

func TestGatewayTextLogLevels(t *testing.T) {
	for _, level := range []string{"errors", "metadata", "content"} {
		if !validGatewayTextLog(level) {
			t.Errorf("validGatewayTextLog(%q) = false", level)
		}
	}
	for _, level := range []string{"", "off", "verbose", "CONTENT"} {
		if validGatewayTextLog(level) {
			t.Errorf("validGatewayTextLog(%q) = true", level)
		}
	}
}
