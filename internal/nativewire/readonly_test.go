package nativewire

import (
	"bytes"
	"testing"
)

func TestReadOnlyRejectsWritesAcrossEveryBoundary(t *testing.T) {
	for _, message := range [][]byte{
		{4, 1, 0, 0, 0, 0, 0, 65}, {5, 0, 1, 0, 10, 0, 20, 0, 0, 0, 0},
		{188, 0, 0, 0, 0, 0, 0, 0, 0, 0}, {251, 0, 0, 1, 0, 1, 0, 0},
		{255, 0, 0, 1, 0, 0, 0, 65, 0, 0, 0, 30},
		append([]byte{180, 1, 10}, append([]byte("text/plain"), 0, 0, 0, 1, 'x')...),
	} {
		for split := 0; split <= len(message); split++ {
			f := ClientFilter{ReadOnly: true, handshake: 3}
			a, e1 := f.Feed(message[:split])
			b, e2 := f.Feed(message[split:])
			if len(a)+len(b) != 0 || e1 == nil && e2 == nil {
				t.Fatalf("write %d escaped at %d", message[0], split)
			}
			if _, err := f.Feed([]byte{185}); err == nil {
				t.Fatal("failed connection resumed")
			}
		}
	}
}

func TestReadOnlyPreservesHandshakeDisplayAndLatency(t *testing.T) {
	f := ClientFilter{ReadOnly: true}
	if _, err := f.Feed(append([]byte("RFB 003.008\n"), 1, 0)); err == nil {
		t.Fatal("read-only Viewer requested exclusive ownership")
	}
	stream := append([]byte("RFB 003.008\n"), 1, 1)
	stream = append(stream, []byte{2, 0, 0, 0, 3, 1, 0, 0, 0, 0, 0, 10, 0, 10, 185, 248, 0, 0, 0, 0, 0, 0, 0, 0}...)
	for split := 0; split <= len(stream); split++ {
		f := ClientFilter{ReadOnly: true}
		a, err := f.Feed(stream[:split])
		if err != nil {
			t.Fatal(err)
		}
		b, err := f.Feed(stream[split:])
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(append(a, b...), stream) {
			t.Fatal("read-only display changed")
		}
	}
}
