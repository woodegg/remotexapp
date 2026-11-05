package sessionaudio

import (
	"bytes"
	"testing"
)

func TestPCMProtocolBoundsSilenceAndSequence(t *testing.T) {
	for _, kind := range []byte{1, 2} {
		size := SpeakerBytes
		slot := byte(3)
		if kind == 2 {
			size = MicBytes
			slot = 0
		}
		pcm := make([]byte, size)
		packet := Packet(kind, slot, ^uint32(0), pcm)
		if len(packet) != HeaderBytes {
			t.Fatal("digital silence not compact")
		}
		gotSlot, seq, decoded, err := ParsePacket(packet, kind)
		if err != nil || gotSlot != slot || seq != ^uint32(0) || !bytes.Equal(decoded, pcm) {
			t.Fatal("silence roundtrip failed")
		}
		pcm[0] = 1
		pcm[size-1] = 255
		packet = Packet(kind, slot, 0, pcm)
		if len(packet) != HeaderBytes+size {
			t.Fatal("PCM truncated")
		}
		_, seq, decoded, err = ParsePacket(packet, kind)
		if err != nil || seq != 0 || !bytes.Equal(decoded, pcm) {
			t.Fatal("non-silent PCM roundtrip failed")
		}
		for _, bad := range [][]byte{packet[:len(packet)-1], append(append([]byte{}, packet...), 0), {1, kind, slot, 0, 0, 0, 0, 0}, {2, kind, slot, 1, 0, 0, 0, 0}, {1, kind, 9, 1, 0, 0, 0, 0}, {1, kind, slot, 2, 0, 0, 0, 0}} {
			if _, _, _, err := ParsePacket(bad, kind); err == nil {
				t.Fatal("accepted invalid packet", bad[:min(len(bad), 8)])
			}
		}
	}
	for _, bad := range [][]byte{{1, 1, 0, 1, 0, 0, 0, 0}, {1, 2, 1, 1, 0, 0, 0, 0}} {
		if _, _, _, err := ParsePacket(bad, bad[1]); err == nil {
			t.Fatal("wrong stream slot accepted")
		}
	}
}
func TestMicQueueBoundedAndOldestDropped(t *testing.T) {
	s := &Stream{done: make(chan struct{}), input: make(chan []byte, 5)}
	for i := 0; i < 100; i++ {
		frame := make([]byte, MicBytes)
		frame[0] = byte(i)
		if !s.Push(frame) {
			t.Fatal("live queue rejected frame")
		}
		frame[0] = 255
	}
	if len(s.input) != 5 || s.Dropped.Load() != 95 {
		t.Fatal("queue grew or drops uncounted")
	}
	for i := 95; i < 100; i++ {
		if frame := <-s.input; frame[0] != byte(i) {
			t.Fatal("retained stale/aliased PCM")
		}
	}
	close(s.done)
	if s.Push(make([]byte, MicBytes)) || s.Push([]byte{0}) {
		t.Fatal("closed/invalid mic accepted")
	}
}
