package nativewire

import (
	"bytes"
	"encoding/binary"
	"strings"
	"testing"
)

func sampleOffer() []byte {
	return []byte("v=0\r\no=user 123 1 IN IP4 203.0.113.7\r\ns=private-host\r\nt=0 0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 203.0.113.7\r\na=ice-ufrag:abcd\r\na=ice-pwd:abcdefghijklmnopqrstuvwxyz\r\na=mid:0\r\na=fingerprint:sha-256 " + strings.Repeat("AA:", 31) + "AA\r\na=setup:actpass\r\na=sctp-port:5000\r\na=candidate:1 1 UDP 123 203.0.113.7 50000 typ host\r\na=remote-candidates:1 203.0.113.7 50000\r\na=max-message-size:65536\r\n")
}
func offerMessage(p []byte) []byte { return append([]byte{181, byte(len(p) >> 8), byte(len(p))}, p...) }
func TestPrivacyOfferAllowlist(t *testing.T) {
	p, err := PrivateOffer(sampleOffer())
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"203.0.113.7", "private-host", "candidate", "o=user"} {
		if bytes.Contains(p, []byte(secret)) {
			t.Fatal("private SDP field survived")
		}
	}
	if !bytes.Contains(p, []byte("a=ice-pwd:abcdefghijklmnopqrstuvwxyz")) {
		t.Fatal("credential changed")
	}
	again, err := PrivateOffer(p)
	if err != nil || !bytes.Equal(again, p) {
		t.Fatal("canonical offer not stable")
	}
	for _, bad := range [][]byte{nil, append(sampleOffer(), []byte("a=ice-ufrag:duplicate\r\n")...), append(sampleOffer(), 0), bytes.ReplaceAll(sampleOffer(), []byte("actpass"), []byte("active")), bytes.ReplaceAll(sampleOffer(), []byte("5000"), []byte("999999")), append(sampleOffer(), []byte("m=audio 9 UDP/TLS/RTP/SAVPF 0\r\n")...)} {
		if _, err := PrivateOffer(bad); err == nil {
			t.Fatal("unsafe offer accepted")
		}
	}
}
func TestStreamEveryFragmentBoundary(t *testing.T) {
	handshake := append([]byte("RFB 003.008\n"), 1, 1)
	pointer := []byte{5, 0, 1, 0, 10, 0, 20, 0, 0, 0, 0}
	wire := append(append(append([]byte{}, handshake...), offerMessage(sampleOffer())...), pointer...)
	canonical, _ := PrivateOffer(sampleOffer())
	want := append(append(append([]byte{}, handshake...), offerMessage(canonical)...), pointer...)
	for split := 0; split <= len(wire); split++ {
		var f ClientFilter
		a, err := f.Feed(wire[:split])
		if err != nil {
			t.Fatal(split, err)
		}
		b, err := f.Feed(wire[split:])
		if err != nil {
			t.Fatal(split, err)
		}
		if !bytes.Equal(append(a, b...), want) {
			t.Fatalf("boundary %d changed stream", split)
		}
	}
	var f ClientFilter
	var output []byte
	for _, b := range wire {
		part, err := f.Feed([]byte{b})
		if err != nil {
			t.Fatal(err)
		}
		output = append(output, part...)
	}
	if !bytes.Equal(output, want) {
		t.Fatal("byte fragmentation")
	}
}
func TestStreamRejectsUnknownAndBounds(t *testing.T) {
	for _, payload := range [][]byte{{182}, {6, 0, 0, 0, 0, 0, 0, 0}, {181, 16, 0}, {255, 1}, {2, 0, 255, 255}, {248, 0, 0, 0, 0, 0, 0, 0, 65}, make([]byte, MaxBuffered+1)} {
		f := ClientFilter{handshake: 3}
		if _, err := f.Feed(payload); err == nil {
			t.Fatal("unsafe message accepted")
		}
		if _, err := f.Feed([]byte{185}); err == nil {
			t.Fatal("failed stream recovered")
		}
	}
	clip := append([]byte{180, 1, 10}, []byte("text/plain")...)
	clip = append(clip, 0, 0, 0, 3, 'a', 'b', 'c')
	f := ClientFilter{handshake: 3}
	out, err := f.Feed(clip)
	if err != nil || !bytes.Equal(out, clip) {
		t.Fatal("text clipboard changed")
	}
	for _, invalid := range [][]byte{append(append([]byte{}, clip[:17]...), 0, 0, 0), append([]byte{}, clip...)} {
		if invalid[17] != 0 {
			binary.BigEndian.PutUint32(invalid[13:], MaxClipboardBytes+1)
		}
		f := ClientFilter{handshake: 3}
		if _, err := f.Feed(invalid); err == nil {
			t.Fatal("unsafe clipboard accepted")
		}
	}
}
func FuzzClientStream(f *testing.F) {
	f.Add(sampleOffer())
	f.Add([]byte("RFB 003.008\n\x01\x01\xb9"))
	f.Fuzz(func(t *testing.T, p []byte) {
		var filter ClientFilter
		for len(p) > 0 {
			n := min(len(p), 257)
			_, err := filter.Feed(p[:n])
			if err != nil {
				return
			}
			p = p[n:]
		}
		if len(filter.pending) > MaxBuffered {
			t.Fatal("unbounded buffering")
		}
	})
}

func richClipboardMessage(items ...struct {
	mime string
	data []byte
}) []byte {
	p := []byte{180, byte(len(items))}
	for _, item := range items {
		p = append(p, byte(len(item.mime)))
		p = append(p, item.mime...)
		p = binary.BigEndian.AppendUint32(p, uint32(len(item.data)))
		p = append(p, item.data...)
	}
	return p
}
func TestRichClipboardAtomicFragmentsAndAggregateBound(t *testing.T) {
	type item = struct {
		mime string
		data []byte
	}
	wire := richClipboardMessage(item{"text/plain", []byte("中文🙂")}, item{"text/html", []byte("<b>中文🙂</b>")}, item{"image/png", []byte{137, 80, 78, 71}})
	for split := 0; split < len(wire); split++ {
		f := ClientFilter{handshake: 3}
		first, err := f.Feed(wire[:split])
		if err != nil || len(first) != 0 {
			t.Fatal("partial clipboard escaped", split, err)
		}
		out, err := f.Feed(append(append([]byte{}, wire[split:]...), 185))
		if err != nil || !bytes.Equal(out, append(append([]byte{}, wire...), 185)) {
			t.Fatal("complete clipboard changed", split, err)
		}
		if f.pending != nil {
			t.Fatal("large backing buffer retained")
		}
	}
	boundary := richClipboardMessage(item{"text/plain", bytes.Repeat([]byte{'x'}, MaxClipboardBytes-1)}, item{"text/html", []byte{'x'}})
	f := ClientFilter{handshake: 3}
	if out, err := f.Feed(boundary); err != nil || len(out) != len(boundary) {
		t.Fatal("exact boundary", err)
	}
	for _, invalid := range [][]byte{
		richClipboardMessage(item{"text/plain", []byte{'a'}}, item{"text/plain", []byte{'b'}}),
		richClipboardMessage(item{"text/plain", []byte{'a'}}, item{"text/html", []byte{255}}),
		richClipboardMessage(item{"text/plain", []byte{'a'}}, item{"text/rtf", []byte{'x'}}),
		richClipboardMessage(item{"text/plain", bytes.Repeat([]byte{'x'}, MaxClipboardBytes)}, item{"image/png", []byte{1}}),
	} {
		f := ClientFilter{handshake: 3}
		out, err := f.Feed(invalid)
		if err == nil || len(out) > 0 {
			t.Fatal("invalid rich transaction forwarded")
		}
	}
}
