package main

import (
	"bytes"
	"log"
	"strings"
	"testing"
)

func TestTextLogLevels(t *testing.T) {
	for _, level := range []string{"", textLogErrors, textLogMetadata, textLogContent} {
		if !validTextLogLevel(level) {
			t.Errorf("validTextLogLevel(%q) = false", level)
		}
	}
	for _, level := range []string{"off", "verbose", "CONTENT"} {
		if validTextLogLevel(level) {
			t.Errorf("validTextLogLevel(%q) = true", level)
		}
	}
	if normalizedTextLogLevel("") != textLogErrors {
		t.Fatalf("empty level normalized to %q", normalizedTextLogLevel(""))
	}

	tests := []struct {
		level    string
		metadata bool
		content  bool
	}{
		{level: "", metadata: false, content: false},
		{level: textLogErrors, metadata: false, content: false},
		{level: textLogMetadata, metadata: true, content: false},
		{level: textLogContent, metadata: true, content: true},
	}
	for _, test := range tests {
		controller := &inputController{textLogLevel: test.level}
		if got := controller.textMetadataEnabled(); got != test.metadata {
			t.Errorf("level %q metadata=%v, want %v", test.level, got, test.metadata)
		}
		if got := controller.textContentEnabled(); got != test.content {
			t.Errorf("level %q content=%v, want %v", test.level, got, test.content)
		}
	}
}

func TestTextReceivedLoggingDoesNotExposeContentByDefault(t *testing.T) {
	var output bytes.Buffer
	previousWriter := log.Writer()
	previousFlags := log.Flags()
	log.SetOutput(&output)
	log.SetFlags(0)
	t.Cleanup(func() {
		log.SetOutput(previousWriter)
		log.SetFlags(previousFlags)
	})

	(&inputController{textLogLevel: textLogErrors}).logTextReceived("你好")
	if output.Len() != 0 {
		t.Fatalf("errors mode logged successful text: %q", output.String())
	}

	(&inputController{textLogLevel: textLogMetadata}).logTextReceived("你好")
	if got := output.String(); got != "text input received: bytes=6\n" {
		t.Fatalf("metadata log = %q", got)
	}
	output.Reset()

	(&inputController{textLogLevel: textLogContent}).logTextReceived("你好")
	if got := output.String(); !strings.Contains(got, `bytes=6 value="你好"`) {
		t.Fatalf("content log = %q", got)
	}
}
