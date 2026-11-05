// Package nativewire implements the trusted edge's bounded native client stream.
// It is deliberately tied to the pinned Kasm protocol, not a generic RFB proxy.
package nativewire

import (
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

var errOffer = errors.New("unsupported native WebRTC offer")
var media = regexp.MustCompile(`^application ([0-9]{1,5}) UDP/DTLS/SCTP webrtc-datachannel$`)
var ufrag = regexp.MustCompile(`^[A-Za-z0-9+/]{4,128}$`)
var password = regexp.MustCompile(`^[A-Za-z0-9+/]{22,128}$`)
var midPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,32}$`)
var fingerprint = regexp.MustCompile(`^sha-256 (?:[A-Fa-f0-9]{2}:){31}[A-Fa-f0-9]{2}$`)
var decimal = regexp.MustCompile(`^[0-9]{1,10}$`)

// PrivateOffer rebuilds the allowed fields; no client origin, candidates, names,
// addresses or unrecognized extension survives this boundary.
func PrivateOffer(sdp []byte) ([]byte, error) {
	if len(sdp) > 32768 {
		return nil, errOffer
	}
	for _, c := range sdp {
		if (c < 32 || c > 126) && c != '\r' && c != '\n' {
			return nil, errOffer
		}
	}
	lines := strings.Split(strings.ReplaceAll(string(sdp), "\r\n", "\n"), "\n")
	one := func(prefix string) (string, bool) {
		value, count := "", 0
		for _, line := range lines {
			if strings.HasPrefix(line, prefix) {
				value = strings.TrimPrefix(line, prefix)
				count++
			}
		}
		return value, count == 1
	}
	values := map[string]string{}
	for _, key := range []string{"v=", "m=", "a=ice-ufrag:", "a=ice-pwd:", "a=mid:", "a=fingerprint:", "a=setup:", "a=sctp-port:"} {
		v, ok := one(key)
		if !ok {
			return nil, errOffer
		}
		values[key] = v
	}
	m := media.FindStringSubmatch(values["m="])
	validPort := func(v string) bool {
		n, err := strconv.Atoi(v)
		return len(v) <= 5 && decimal.MatchString(v) && err == nil && n > 0 && n <= 65535
	}
	if values["v="] != "0" || len(m) != 2 || !validPort(m[1]) || !validPort(values["a=sctp-port:"]) ||
		!ufrag.MatchString(values["a=ice-ufrag:"]) || !password.MatchString(values["a=ice-pwd:"]) ||
		!midPattern.MatchString(values["a=mid:"]) || !fingerprint.MatchString(values["a=fingerprint:"]) || values["a=setup:"] != "actpass" {
		return nil, errOffer
	}
	out := []string{"v=0", "o=- 0 0 IN IP4 0.0.0.0", "s=-", "t=0 0", "a=group:BUNDLE " + values["a=mid:"],
		"m=application 9 UDP/DTLS/SCTP webrtc-datachannel", "c=IN IP4 0.0.0.0"}
	for _, key := range []string{"a=ice-ufrag:", "a=ice-pwd:", "a=fingerprint:", "a=setup:", "a=mid:", "a=sctp-port:"} {
		out = append(out, key+values[key])
	}
	count := 0
	for _, line := range lines {
		if strings.HasPrefix(line, "a=max-message-size:") {
			count++
			value := strings.TrimPrefix(line, "a=max-message-size:")
			n, err := strconv.ParseUint(value, 10, 32)
			if count > 1 || err != nil || !decimal.MatchString(value) {
				return nil, errOffer
			}
			out = append(out, fmt.Sprintf("a=max-message-size:%d", n))
		}
	}
	return []byte(strings.Join(append(out, ""), "\r\n")), nil
}
