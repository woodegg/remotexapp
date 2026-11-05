package sessionaudio

import (
	"context"
	"encoding/binary"
	"errors"
	"io"
	"os"
	"os/exec"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

const Samples = 960 // 20 ms at 48 kHz
const SpeakerBytes = Samples * 2 * 2
const MicBytes = Samples * 2
const HeaderBytes = 8

// Packet v1: version, kind (1 speaker/2 mic), slot, silence flag, uint32 sequence
// followed by a complete PCM16LE frame, or no payload for exact digital silence.
func Packet(kind, slot byte, seq uint32, pcm []byte) []byte {
	silent := true
	for _, v := range pcm {
		if v != 0 {
			silent = false
			break
		}
	}
	length := HeaderBytes
	if !silent {
		length += len(pcm)
	}
	out := make([]byte, length)
	out[0] = 1
	out[1] = kind
	out[2] = slot
	binary.LittleEndian.PutUint32(out[4:8], seq)
	if silent {
		out[3] = 1
	} else {
		copy(out[HeaderBytes:], pcm)
	}
	return out
}

func ParsePacket(data []byte, kind byte) (byte, uint32, []byte, error) {
	size := MicBytes
	if kind == 1 {
		size = SpeakerBytes
	}
	if len(data) < HeaderBytes || data[0] != 1 || data[1] != kind || data[2] > 8 || data[3] > 1 || (kind == 2 && data[2] != 0) || (kind == 1 && data[2] == 0) {
		return 0, 0, nil, errors.New("invalid audio packet")
	}
	if data[3] == 1 {
		if len(data) != HeaderBytes {
			return 0, 0, nil, errors.New("invalid silence packet")
		}
		return data[2], binary.LittleEndian.Uint32(data[4:8]), make([]byte, size), nil
	}
	if len(data) != HeaderBytes+size {
		return 0, 0, nil, errors.New("invalid audio frame length")
	}
	return data[2], binary.LittleEndian.Uint32(data[4:8]), data[HeaderBytes:], nil
}

type Stream struct {
	cancel  context.CancelFunc
	done    chan struct{}
	input   chan []byte
	once    sync.Once
	Dropped atomic.Uint64
}

func (s *Stream) Close() {
	if s != nil {
		s.once.Do(s.cancel)
	}
}
func (s *Stream) Done() <-chan struct{} { return s.done }
func (s *Stream) Push(data []byte) bool {
	if len(data) != MicBytes || s.input == nil {
		return false
	}
	select {
	case <-s.done:
		return false
	default:
	}
	copyData := append([]byte(nil), data...)
	select {
	case s.input <- copyData:
		return true
	default:
	}
	// Drop oldest queued microphone data instead of accumulating stale speech.
	select {
	case <-s.input:
		s.Dropped.Add(1)
	default:
	}
	select {
	case s.input <- copyData:
		return true
	default:
		s.Dropped.Add(1)
		return false
	}
}

// OpenReader/OpenWriter are invoked only after validation of a private domain.
// No network message can select a command, arbitrary server or sink name.
func OpenReader(record Record, onFrame func([]byte)) (*Stream, error) {
	ctx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx, "parec", "--raw", "--format=s16le", "--rate=48000", "--channels=2", "--latency-msec=20", "--device="+Speaker+".monitor")
	cmd.Env = Environment(record, os.Environ())
	cmd.SysProcAttr = &syscall.SysProcAttr{Pdeathsig: syscall.SIGTERM}
	output, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return nil, err
	}
	s := &Stream{cancel: cancel, done: make(chan struct{})}
	if err = cmd.Start(); err != nil {
		cancel()
		_ = output.Close()
		return nil, err
	}
	go func() {
		defer close(s.done)
		defer cancel()
		defer cmd.Wait()
		defer output.Close()
		for {
			buf := make([]byte, SpeakerBytes)
			if _, err := io.ReadFull(output, buf); err != nil {
				return
			}
			onFrame(buf)
		}
	}()
	return s, nil
}

func OpenWriter(record Record) (*Stream, error) {
	ctx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx, "pacat", "--playback", "--raw", "--format=s16le", "--rate=48000", "--channels=1", "--latency-msec=20", "--device="+MicrophoneSink)
	cmd.Env = Environment(record, os.Environ())
	cmd.SysProcAttr = &syscall.SysProcAttr{Pdeathsig: syscall.SIGTERM}
	input, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		return nil, err
	}
	s := &Stream{cancel: cancel, done: make(chan struct{}), input: make(chan []byte, 5)}
	if err = cmd.Start(); err != nil {
		cancel()
		_ = input.Close()
		return nil, err
	}
	go func() {
		defer close(s.done)
		defer cancel()
		defer cmd.Wait()
		defer input.Close()
		// Keep the selected source live during exact silence; this is independent
		// of whether the browser sends audio or its leased route expires.
		timer := time.NewTicker(20 * time.Millisecond)
		defer timer.Stop()
		silence := make([]byte, MicBytes)
		for {
			var data []byte
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				select {
				case data = <-s.input:
				default:
					data = silence
				}
			}
			if _, err := input.Write(data); err != nil {
				return
			}
		}
	}()
	return s, nil
}
