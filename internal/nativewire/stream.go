package nativewire

import (
	"bytes"
	"encoding/binary"
	"errors"
	"unicode/utf8"
)

var ErrStream = errors.New("unsupported native client stream")

const MaxBuffered = 128 * 1024

// ClientFilter accepts arbitrary WebSocket message boundaries. No byte of a
// client message is forwarded until its complete bounded grammar is validated.
type ClientFilter struct {
	pending   []byte
	handshake int
	failed    bool
}

func (f *ClientFilter) Feed(data []byte) ([]byte, error) {
	if f.failed || len(f.pending)+len(data) > MaxBuffered {
		f.failed = true
		return nil, ErrStream
	}
	f.pending = append(f.pending, data...)
	var output []byte
	for len(f.pending) > 0 {
		n, err := f.length()
		if err != nil {
			f.failed = true
			f.pending = nil
			return nil, err
		}
		if n == 0 || len(f.pending) < n {
			break
		}
		message := f.pending[:n]
		if f.handshake < 3 {
			valid := (f.handshake == 0 && bytes.Equal(message, []byte("RFB 003.008\n"))) || (f.handshake == 1 && message[0] == 1) || (f.handshake == 2 && message[0] <= 1)
			if !valid {
				f.failed = true
				return nil, ErrStream
			}
			f.handshake++
		} else if message[0] == 181 && n > 3 {
			offer, e := PrivateOffer(message[3:])
			if e != nil {
				f.failed = true
				return nil, e
			}
			message = append([]byte{181, byte(len(offer) >> 8), byte(len(offer))}, offer...)
		} else if message[0] == 180 && (!utf8.Valid(message[17:]) || bytes.IndexByte(message[17:], 0) >= 0) {
			f.failed = true
			return nil, ErrStream
		}
		output = append(output, message...)
		f.pending = f.pending[n:]
	}
	// Do not retain a large underlying array after a clipboard or offer message.
	if len(f.pending) == 0 {
		f.pending = nil
	}
	return output, nil
}

func (f *ClientFilter) length() (int, error) {
	p := f.pending
	if f.handshake == 0 {
		return 12, nil
	}
	if f.handshake < 3 {
		return 1, nil
	}
	switch p[0] {
	case 0:
		return 20, nil
	case 2:
		if len(p) < 4 {
			return 0, nil
		}
		count := int(binary.BigEndian.Uint16(p[2:]))
		if count > 1024 {
			return 0, ErrStream
		}
		return 4 + count*4, nil
	case 3, 150, 188:
		return 10, nil
	case 4:
		return 8, nil
	case 5:
		return 11, nil
	case 178:
		return 4, nil
	case 179:
		return 12, nil
	case 180:
		if len(p) < 17 {
			return 0, nil
		}
		if p[1] != 1 || p[2] != 10 || string(p[3:13]) != "text/plain" {
			return 0, ErrStream
		}
		length := binary.BigEndian.Uint32(p[13:])
		if length > 65536 {
			return 0, ErrStream
		}
		return 17 + int(length), nil
	case 181:
		if len(p) < 3 {
			return 0, nil
		}
		length := int(binary.BigEndian.Uint16(p[1:]))
		if length >= 4096 {
			return 0, ErrStream
		}
		return 3 + length, nil
	case 184:
		if len(p) < 2 {
			return 0, nil
		}
		return 2 + int(p[1])*4, nil
	case 185:
		return 1, nil
	case 248:
		if len(p) < 9 {
			return 0, nil
		}
		if p[8] > 64 {
			return 0, ErrStream
		}
		return 9 + int(p[8]), nil
	case 251:
		if len(p) < 8 {
			return 0, nil
		}
		if p[6] > 16 {
			return 0, ErrStream
		}
		return 8 + int(p[6])*16, nil
	case 252:
		return 5, nil
	case 255:
		if len(p) < 2 {
			return 0, nil
		}
		if p[1] != 0 {
			return 0, ErrStream
		}
		return 12, nil
	default:
		return 0, ErrStream
	}
}
