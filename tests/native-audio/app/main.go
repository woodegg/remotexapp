// Owned UAT application. It renders X11 controls and exercises the App's actual
// Pulse environment. Recording is explicit, bounded and held only in memory.
package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/jezek/xgb"
	"github.com/jezek/xgb/xproto"
)

type observation struct {
	Mode    string  `json:"mode"`
	Samples int     `json:"samples"`
	RMS     float64 `json:"rms"`
	Tone880 float64 `json:"tone880"`
	Message string  `json:"message"`
}
type application struct {
	lastDraw   string
	jobs       sync.WaitGroup
	mu         sync.Mutex
	state      observation
	recording  []byte
	cancel     context.CancelFunc
	job        uint64
	conn       *xgb.Conn
	window     xproto.Window
	gc         xproto.Gcontext
	statusAtom xproto.Atom
}

func tone(frequency float64) []byte {
	data := make([]byte, 48000*2*2)
	for i := 0; i < len(data)/2; i++ {
		binary.LittleEndian.PutUint16(data[i*2:], uint16(int16(6000*math.Sin(2*math.Pi*frequency*float64(i)/48000))))
	}
	return data
}
func measure(data []byte) (float64, float64) {
	n := len(data) / 2
	if n == 0 {
		return 0, 0
	}
	power, re, im := 0.0, 0.0, 0.0
	for i := 0; i < n; i++ {
		v := float64(int16(binary.LittleEndian.Uint16(data[2*i:])))
		power += v * v
		re += v * math.Cos(2*math.Pi*880*float64(i)/48000)
		im += v * math.Sin(2*math.Pi*880*float64(i)/48000)
	}
	return math.Sqrt(power/float64(n)) / 32768, 2 * math.Hypot(re, im) / float64(n)
}
func (a *application) action(mode string) {
	a.mu.Lock()
	if a.cancel != nil {
		a.cancel()
		a.cancel = nil
	}
	a.job++
	job := a.job
	if mode == "stop" {
		a.state.Mode = "idle"
		a.state.Message = "Stopped. Recording stays in this App's memory until closed."
		a.mu.Unlock()
		return
	}
	data := append([]byte(nil), a.recording...)
	if mode == "replay" && len(data) == 0 {
		a.state.Message = "Record first: enable this session's Mic, then Record 3 seconds."
		a.mu.Unlock()
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	a.cancel = cancel
	a.state.Mode = mode
	a.state.Message = "Running: " + mode
	if mode == "record" {
		a.recording = nil
		a.state.Samples = 0
		a.state.RMS = 0
		a.state.Tone880 = 0
	}
	a.mu.Unlock()
	a.jobs.Add(1)
	go func() {
		defer a.jobs.Done()
		defer cancel()
		var err error
		if mode == "record" {
			cmd := exec.CommandContext(ctx, "parec", "--raw", "--format=s16le", "--rate=48000", "--channels=1", "--latency-msec=20")
			var pipe io.ReadCloser
			pipe, err = cmd.StdoutPipe()
			if err == nil {
				err = cmd.Start()
			}
			if err == nil {
				all := make([]byte, 0, 48000*2*3)
				for len(all) < cap(all) {
					block := make([]byte, 9600)
					var n int
					n, err = io.ReadFull(pipe, block)
					block = block[:n]
					all = append(all, block...)
					rms, amp := measure(block)
					a.mu.Lock()
					if job == a.job {
						a.state.Samples = len(all) / 2
						a.state.RMS = rms
						if amp > a.state.Tone880 {
							a.state.Tone880 = amp
						}
					}
					a.mu.Unlock()
					if err != nil {
						break
					}
				}
				cancel()
				pipe.Close()
				_ = cmd.Wait()
				a.mu.Lock()
				if job == a.job {
					a.recording = all
				}
				a.mu.Unlock()
				if len(all) == 48000*2*3 {
					err = nil
				}
			}
		} else {
			if mode == "tone440" {
				data = tone(440)
			}
			if mode == "tone660" {
				data = tone(660)
			}
			cmd := exec.CommandContext(ctx, "pacat", "--playback", "--raw", "--format=s16le", "--rate=48000", "--channels=1", "--latency-msec=20")
			cmd.Stdin = bytes.NewReader(data)
			err = cmd.Run()
		}
		a.mu.Lock()
		defer a.mu.Unlock()
		if job != a.job {
			return
		}
		a.state.Mode = "idle"
		a.cancel = nil
		if err != nil {
			a.state.Message = "Audio unavailable or cancelled; check the session's private Pulse domain."
		} else if mode == "record" {
			a.state.Message = "Recorded 3 seconds in App memory. Enable Speaker, then Replay."
		} else {
			a.state.Message = "Playback finished. Human listening confirmation is still required."
		}
	}()
}
func atom(c *xgb.Conn, name string) xproto.Atom {
	r, e := xproto.InternAtom(c, false, uint16(len(name)), name).Reply()
	if e != nil {
		panic(e)
	}
	return r.Atom
}
func (a *application) text(x, y int16, label string, color uint32) {
	_ = xproto.ChangeGCChecked(a.conn, a.gc, xproto.GcForeground, []uint32{color}).Check()
	xproto.ImageText8(a.conn, byte(len(label)), xproto.Drawable(a.window), a.gc, x, y, label)
}
func (a *application) rectangle(x, y int16, w, h uint16, color uint32) {
	xproto.ChangeGC(a.conn, a.gc, xproto.GcForeground, []uint32{color})
	xproto.PolyFillRectangle(a.conn, xproto.Drawable(a.window), a.gc, []xproto.Rectangle{{X: x, Y: y, Width: w, Height: h}})
}

var labels = []string{"Play 440 Hz", "Play 660 Hz", "Record 3 seconds", "Replay recording", "Stop"}
var modes = []string{"tone440", "tone660", "record", "replay", "stop"}

func (a *application) draw(force bool) {
	a.mu.Lock()
	state := a.state
	a.mu.Unlock()
	payload, _ := json.Marshal(state)
	if !force && string(payload) == a.lastDraw {
		return
	}
	a.lastDraw = string(payload)
	a.rectangle(0, 0, 1100, 720, 0x101d2b)
	a.text(28, 42, "RemoteXApp | Remote audio test", 0x9cedd8)
	a.text(28, 72, "These controls run inside this remote App, using its own speaker and microphone.", 0xd6e4f2)
	a.text(28, 96, "Enable Speaker / Mic for this session in the UAT sidebar before using these controls.", 0x9aafc6)
	for i, label := range labels {
		x := int16(28 + i*166)
		a.rectangle(x, 128, 156, 46, 0x28483f)
		a.text(x+8, 156, label, 0xc4f8e9)
	}
	a.text(28, 214, "State: "+state.Mode, 0xd6e4f2)
	a.text(28, 245, state.Message, 0xd6e4f2)
	a.text(28, 283, fmt.Sprintf("Remote microphone level: %.4f RMS | recorded samples: %d / 144000", state.RMS, state.Samples), 0x9aafc6)
	a.rectangle(28, 305, 800, 18, 0x223347)
	level := uint16(math.Min(1, state.RMS*4) * 800)
	if level > 0 {
		a.rectangle(28, 305, level, 18, 0x7ce3cc)
	}
	a.text(28, 366, "Recording is explicit, limited to 3 seconds, and never written to a file.", 0x9aafc6)
	a.text(28, 391, "Closing this test App clears the recording. Replay sends it through remote Speaker.", 0x9aafc6)
	a.text(28, 438, "Two Apps can play different tones. Turning one session off must not mute the other.", 0x9aafc6)
	a.text(28, 463, "Tabs sharing one session must not duplicate playback. Microphone targets are explicit.", 0x9aafc6)
	xproto.ChangeProperty(a.conn, xproto.PropModeReplace, a.window, a.statusAtom, xproto.AtomString, 8, uint32(len(payload)), payload)
	a.conn.Sync()
}
func run() error {
	if os.Getenv("PULSE_SERVER") == "" || os.Getenv("PULSE_COOKIE") == "" {
		return fmt.Errorf("explicit private session audio environment required")
	}
	c, err := xgb.NewConn()
	if err != nil {
		return err
	}
	defer c.Close()
	screen := xproto.Setup(c).DefaultScreen(c)
	w, err := xproto.NewWindowId(c)
	if err != nil {
		return err
	}
	gc, err := xproto.NewGcontextId(c)
	if err != nil {
		return err
	}
	if err = xproto.CreateWindowChecked(c, screen.RootDepth, w, screen.Root, 0, 0, 1000, 540, 0, xproto.WindowClassInputOutput, screen.RootVisual, xproto.CwBackPixel|xproto.CwEventMask, []uint32{0x101d2b, xproto.EventMaskExposure | xproto.EventMaskButtonPress | xproto.EventMaskStructureNotify}).Check(); err != nil {
		return err
	}
	if err = xproto.CreateGCChecked(c, gc, xproto.Drawable(w), xproto.GcForeground|xproto.GcBackground, []uint32{0xd6e4f2, 0x101d2b}).Check(); err != nil {
		return err
	}
	name := "RemoteXApp Audio Test"
	xproto.ChangeProperty(c, xproto.PropModeReplace, w, xproto.AtomWmName, xproto.AtomString, 8, uint32(len(name)), []byte(name))
	class := []byte("rxa-audio-test\x00RemoteXAppAudioTest\x00")
	xproto.ChangeProperty(c, xproto.PropModeReplace, w, xproto.AtomWmClass, xproto.AtomString, 8, uint32(len(class)), class)
	pid := make([]byte, 4)
	binary.LittleEndian.PutUint32(pid, uint32(os.Getpid()))
	xproto.ChangeProperty(c, xproto.PropModeReplace, w, atom(c, "_NET_WM_PID"), xproto.AtomCardinal, 32, 1, pid)
	deleteAtom := atom(c, "WM_DELETE_WINDOW")
	protocol := make([]byte, 4)
	binary.LittleEndian.PutUint32(protocol, uint32(deleteAtom))
	xproto.ChangeProperty(c, xproto.PropModeReplace, w, atom(c, "WM_PROTOCOLS"), xproto.AtomAtom, 32, 1, protocol)
	xproto.MapWindow(c, w)
	a := &application{conn: c, window: w, gc: gc, statusAtom: atom(c, "_REMOTEXAPP_AUDIO_TEST_STATUS"), state: observation{Mode: "idle", Message: "Choose a remote audio test above."}}
	defer func() { a.action("stop"); a.jobs.Wait() }()
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()
	events := make(chan xgb.Event, 8)
	go func() {
		defer close(events)
		for {
			event, err := c.WaitForEvent()
			if err != nil || event == nil {
				return
			}
			select {
			case events <- event:
			case <-ctx.Done():
				return
			}
		}
	}()
	tick := time.NewTicker(100 * time.Millisecond)
	defer tick.Stop()
	a.draw(true)
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-tick.C:
			a.draw(false)
		case event, ok := <-events:
			if !ok {
				return nil
			}
			switch e := event.(type) {
			case xproto.ExposeEvent, xproto.ConfigureNotifyEvent:
				a.draw(true)
			case xproto.ButtonPressEvent:
				if e.Detail == 1 && e.EventY >= 128 && e.EventY < 174 && e.EventX >= 28 {
					index := int(e.EventX-28) / 166
					if index < len(modes) && int(e.EventX-28)%166 < 156 {
						a.action(modes[index])
					}
				}
			case xproto.ClientMessageEvent:
				if e.Data.Data32[0] == uint32(deleteAtom) {
					return nil
				}
			case xproto.DestroyNotifyEvent:
				return nil
			}
		}
	}
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
