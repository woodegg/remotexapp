package main

import (
	"errors"
	"fmt"
	"log"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/jezek/xgb"
	"github.com/jezek/xgb/xfixes"
	"github.com/jezek/xgb/xproto"
)

const (
	xClipboardINCRThreshold  = 256 << 10
	xClipboardINCRChunk      = 64 << 10
	xClipboardCaptureTimeout = 5 * time.Second
)

type xClipboardAtoms struct {
	clipboard xproto.Atom
	targets   xproto.Atom
	timestamp xproto.Atom
	incr      xproto.Atom
	property  xproto.Atom
	byName    map[string]xproto.Atom
	byAtom    map[xproto.Atom]string
}

type xClipboardTransferKey struct {
	window   xproto.Window
	property xproto.Atom
}

type xClipboardSend struct {
	typeAtom xproto.Atom
	data     []byte
	offset   int
}

type xClipboardCapture struct {
	onRemote    func([]clipboardItem, string)
	onError     func(error)
	owner       xproto.Window
	timestamp   xproto.Timestamp
	targets     []xproto.Atom
	index       int
	current     xproto.Atom
	canonical   string
	items       []clipboardItem
	total       int64
	incremental bool
	data        []byte
}

type xClipboardBridge struct {
	mu              sync.Mutex
	conn            *xgb.Conn
	window          xproto.Window
	emptyWindow     xproto.Window
	atoms           xClipboardAtoms
	owned           map[xproto.Atom]clipboardItem
	state           func(string, error)
	transfers       map[xClipboardTransferKey]*xClipboardSend
	capture         *xClipboardCapture
	captureTimer    *time.Timer
	monitoring      bool
	baselinePending bool
	onRemote        func([]clipboardItem, string)
	captureRemote   func(...bool) func([]clipboardItem, string)
	onCaptureError  func() func(error)
	closed          chan struct{}
	closeOnce       sync.Once
}

func newXClipboardBridge(display string, onRemote func([]clipboardItem, string), onError ...func() func(error)) (clipboardBridge, error) {
	conn, err := xgb.NewConnDisplay(display)
	if err != nil {
		return nil, fmt.Errorf("open pure-Go X11 clipboard connection: %w", err)
	}
	if err := xfixes.Init(conn); err != nil {
		conn.Close()
		return nil, fmt.Errorf("initialize XFixes clipboard monitoring: %w", err)
	}
	if _, err := xfixes.QueryVersion(conn, 5, 0).Reply(); err != nil {
		conn.Close()
		return nil, fmt.Errorf("query XFixes clipboard version: %w", err)
	}
	window, err := xproto.NewWindowId(conn)
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("allocate clipboard window: %w", err)
	}
	screen := xproto.Setup(conn).DefaultScreen(conn)
	if err := xproto.CreateWindowChecked(
		conn, 0, window, screen.Root, 0, 0, 1, 1, 0,
		xproto.WindowClassInputOnly, 0,
		xproto.CwEventMask, []uint32{xproto.EventMaskPropertyChange},
	).Check(); err != nil {
		conn.Close()
		return nil, fmt.Errorf("create clipboard event window: %w", err)
	}
	emptyWindow, err := xproto.NewWindowId(conn)
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("allocate empty clipboard window: %w", err)
	}
	if err := xproto.CreateWindowChecked(
		conn, 0, emptyWindow, screen.Root, 0, 0, 1, 1, 0,
		xproto.WindowClassInputOnly, 0,
		xproto.CwEventMask, []uint32{xproto.EventMaskPropertyChange},
	).Check(); err != nil {
		conn.Close()
		return nil, fmt.Errorf("create empty clipboard window: %w", err)
	}
	atoms, err := internClipboardAtoms(conn)
	if err != nil {
		conn.Close()
		return nil, err
	}
	if err := xfixes.SelectSelectionInputChecked(
		conn, window, atoms.clipboard,
		xfixes.SelectionEventMaskSetSelectionOwner|
			xfixes.SelectionEventMaskSelectionWindowDestroy|
			xfixes.SelectionEventMaskSelectionClientClose,
	).Check(); err != nil {
		conn.Close()
		return nil, fmt.Errorf("subscribe to XFixes CLIPBOARD changes: %w", err)
	}
	bridge := &xClipboardBridge{
		conn: conn, window: window, emptyWindow: emptyWindow, atoms: atoms, onRemote: onRemote,
		owned:     make(map[xproto.Atom]clipboardItem),
		transfers: make(map[xClipboardTransferKey]*xClipboardSend),
		closed:    make(chan struct{}),
	}
	if len(onError) > 0 {
		bridge.onCaptureError = onError[0]
	}
	go bridge.eventLoop()
	return bridge, nil
}

func internClipboardAtoms(conn *xgb.Conn) (xClipboardAtoms, error) {
	result := xClipboardAtoms{byName: make(map[string]xproto.Atom), byAtom: make(map[xproto.Atom]string)}
	names := []string{
		"CLIPBOARD", "TARGETS", "TIMESTAMP", "INCR", "_REMOTEXAPP_CLIPBOARD",
		"UTF8_STRING", "text/plain", "text/plain;charset=utf-8", "text/html",
		"text/rtf", "application/rtf", "image/png",
	}
	for _, name := range names {
		reply, err := xproto.InternAtom(conn, false, uint16(len(name)), name).Reply()
		if err != nil {
			return result, fmt.Errorf("intern X11 clipboard atom %s: %w", name, err)
		}
		result.byName[name] = reply.Atom
		result.byAtom[reply.Atom] = name
	}
	result.clipboard = result.byName["CLIPBOARD"]
	result.targets = result.byName["TARGETS"]
	result.timestamp = result.byName["TIMESTAMP"]
	result.incr = result.byName["INCR"]
	result.property = result.byName["_REMOTEXAPP_CLIPBOARD"]
	return result, nil
}

func (b *xClipboardBridge) Set(items []clipboardItem, state func(string, error)) error {
	owned := make(map[xproto.Atom]clipboardItem)
	for _, item := range items {
		for _, atomName := range xTargetNames(item.Type) {
			atom := b.atoms.byName[atomName]
			if atom != xproto.AtomNone {
				owned[atom] = clipboardItem{Type: item.Type, Data: append([]byte(nil), item.Data...)}
			}
		}
	}
	if len(owned) == 0 {
		return errors.New("clipboard offer has no supported X11 targets")
	}
	b.mu.Lock()
	b.cancelTransfersLocked()
	b.stopCaptureLocked()
	b.owned = owned
	b.state = state
	b.mu.Unlock()
	if err := xproto.SetSelectionOwnerChecked(b.conn, b.window, b.atoms.clipboard, xproto.TimeCurrentTime).Check(); err != nil {
		return fmt.Errorf("own X11 CLIPBOARD selection: %w", err)
	}
	reply, err := xproto.GetSelectionOwner(b.conn, b.atoms.clipboard).Reply()
	if err != nil || reply.Owner != b.window {
		if err == nil {
			err = errors.New("selection ownership was not granted")
		}
		return fmt.Errorf("verify X11 CLIPBOARD ownership: %w", err)
	}
	return nil
}

func (b *xClipboardBridge) Clear() {
	b.mu.Lock()
	b.cancelTransfersLocked()
	b.stopCaptureLocked()
	b.owned = make(map[xproto.Atom]clipboardItem)
	b.state = nil
	b.mu.Unlock()
	// If the data window owns CLIPBOARD, transfer ownership to a separate empty
	// window that advertises only an empty text tombstone. The owner transition
	// tells clipboard managers to discard stale cached representations before a
	// later gateway exit. Releasing ownership to WindowNone instead lets them
	// replay stale content. A real application can replace the empty owner
	// normally, and Clear never steals ownership from an external owner.
	reply, err := xproto.GetSelectionOwner(b.conn, b.atoms.clipboard).Reply()
	if err == nil && reply.Owner == b.window {
		_ = xproto.SetSelectionOwnerChecked(b.conn, b.emptyWindow, b.atoms.clipboard, xproto.TimeCurrentTime).Check()
	}
}

func (b *xClipboardBridge) SetMonitoring(value bool) {
	b.mu.Lock()
	resume := value && !b.monitoring && b.captureRemote != nil
	if resume {
		b.baselinePending = true
	}
	b.monitoring = value
	if !value {
		b.stopCaptureLocked()
	}
	b.mu.Unlock()
	if resume {
		// XFixes does not replay owner changes made while monitoring was paused.
		if reply, err := xproto.GetSelectionOwner(b.conn, b.atoms.clipboard).Reply(); err == nil {
			b.handleOwnerChange(xfixes.SelectionNotifyEvent{Selection: b.atoms.clipboard, Owner: reply.Owner, Timestamp: xproto.TimeCurrentTime})
		}
	}
}

func (b *xClipboardBridge) Close() error {
	b.closeOnce.Do(func() {
		b.mu.Lock()
		b.stopCaptureLocked()
		b.mu.Unlock()
		close(b.closed)
		b.conn.Close()
	})
	return nil
}

func (b *xClipboardBridge) eventLoop() {
	for {
		event, err := b.conn.WaitForEvent()
		if err != nil {
			select {
			case <-b.closed:
				return
			default:
				log.Printf("X11 clipboard event loop ended: %v", err)
				return
			}
		}
		if event == nil {
			return
		}
		switch value := event.(type) {
		case xfixes.SelectionNotifyEvent:
			b.handleOwnerChange(value)
		case xproto.SelectionRequestEvent:
			b.handleSelectionRequest(value)
		case xproto.SelectionClearEvent:
			if value.Owner == b.window {
				b.mu.Lock()
				b.cancelTransfersLocked()
				b.owned = make(map[xproto.Atom]clipboardItem)
				b.mu.Unlock()
			}
		case xproto.SelectionNotifyEvent:
			b.handleSelectionNotify(value)
		case xproto.PropertyNotifyEvent:
			b.handlePropertyNotify(value)
		}
	}
}

func (b *xClipboardBridge) handleOwnerChange(event xfixes.SelectionNotifyEvent) {
	if event.Selection != b.atoms.clipboard || event.Owner == b.window {
		return
	}
	b.mu.Lock()
	if !b.monitoring {
		if b.captureRemote != nil {
			// Metadata-only invalidation: no clipboard payload is read without viewers.
			b.captureRemote()
		}
		b.mu.Unlock()
		return
	}
	b.stopCaptureLocked()
	capture := &xClipboardCapture{owner: event.Owner, timestamp: event.Timestamp, current: b.atoms.targets}
	capture.onRemote = b.onRemote
	if b.captureRemote != nil {
		capture.onRemote = b.captureRemote(b.baselinePending || event.Timestamp == xproto.TimeCurrentTime)
	}
	if event.Owner == b.emptyWindow || event.Owner == xproto.WindowNone {
		observeEmpty := b.captureRemote != nil
		b.baselinePending = false
		b.mu.Unlock()
		if observeEmpty && capture.onRemote != nil {
			go capture.onRemote(nil, "")
		}
		return
	}
	if b.onCaptureError != nil {
		capture.onError = b.onCaptureError()
	}
	b.capture = capture
	b.captureTimer = time.AfterFunc(xClipboardCaptureTimeout, func() {
		b.mu.Lock()
		if b.capture == capture {
			b.failCaptureLocked(capture, "remote clipboard read timed out")
		}
		b.mu.Unlock()
	})
	b.mu.Unlock()
	_ = xproto.DeletePropertyChecked(b.conn, b.window, b.atoms.property).Check()
	_ = xproto.ConvertSelectionChecked(
		b.conn, b.window, b.atoms.clipboard, b.atoms.targets,
		b.atoms.property, event.Timestamp,
	).Check()
}

func (b *xClipboardBridge) handleSelectionRequest(event xproto.SelectionRequestEvent) {
	property := event.Property
	if property == xproto.AtomNone {
		property = event.Target
	}
	success := false
	b.mu.Lock()
	state := b.state
	if event.Selection == b.atoms.clipboard && (event.Owner == b.window || event.Owner == b.emptyWindow) {
		dataOwner := event.Owner == b.window
		switch event.Target {
		case b.atoms.targets:
			atoms := []xproto.Atom{b.atoms.targets, b.atoms.timestamp}
			if dataOwner {
				for atom := range b.owned {
					atoms = append(atoms, atom)
				}
			} else {
				for _, atomName := range xTargetNames("text/plain") {
					atoms = append(atoms, b.atoms.byName[atomName])
				}
			}
			sortAtoms(atoms)
			data := atomsToBytes(atoms)
			success = xproto.ChangePropertyChecked(b.conn, xproto.PropModeReplace, event.Requestor, property, xproto.AtomAtom, 32, uint32(len(atoms)), data).Check() == nil
		case b.atoms.timestamp:
			data := make([]byte, 4)
			xgb.Put32(data, uint32(event.Time))
			success = xproto.ChangePropertyChecked(b.conn, xproto.PropModeReplace, event.Requestor, property, xproto.AtomInteger, 32, 1, data).Check() == nil
		default:
			if item, ok := b.owned[event.Target]; dataOwner && ok {
				if state != nil {
					state("requested", nil)
				}
				if len(item.Data) > xClipboardINCRThreshold {
					_ = xproto.ChangeWindowAttributesChecked(b.conn, event.Requestor, xproto.CwEventMask, []uint32{xproto.EventMaskPropertyChange}).Check()
					size := make([]byte, 4)
					xgb.Put32(size, uint32(len(item.Data)))
					if xproto.ChangePropertyChecked(b.conn, xproto.PropModeReplace, event.Requestor, property, b.atoms.incr, 32, 1, size).Check() == nil {
						b.transfers[xClipboardTransferKey{window: event.Requestor, property: property}] = &xClipboardSend{typeAtom: event.Target, data: append([]byte(nil), item.Data...)}
						success = true
					}
				} else {
					success = xproto.ChangePropertyChecked(b.conn, xproto.PropModeReplace, event.Requestor, property, event.Target, 8, uint32(len(item.Data)), item.Data).Check() == nil
					if success && state != nil {
						state("served", nil)
					}
				}
			} else if !dataOwner && canonicalClipboardType(b.atoms.byAtom[event.Target]) == "text/plain" {
				success = xproto.ChangePropertyChecked(
					b.conn, xproto.PropModeReplace, event.Requestor, property,
					event.Target, 8, 0, nil,
				).Check() == nil
			}
		}
	}
	b.mu.Unlock()
	if !success {
		property = xproto.AtomNone
	}
	notify := xproto.SelectionNotifyEvent{
		Time: event.Time, Requestor: event.Requestor, Selection: event.Selection,
		Target: event.Target, Property: property,
	}
	_ = xproto.SendEventChecked(b.conn, false, event.Requestor, 0, string(notify.Bytes())).Check()
}

func (b *xClipboardBridge) handlePropertyNotify(event xproto.PropertyNotifyEvent) {
	key := xClipboardTransferKey{window: event.Window, property: event.Atom}
	b.mu.Lock()
	if transfer := b.transfers[key]; transfer != nil && event.State == xproto.PropertyDelete {
		remaining := len(transfer.data) - transfer.offset
		chunk := remaining
		if chunk > xClipboardINCRChunk {
			chunk = xClipboardINCRChunk
		}
		data := transfer.data[transfer.offset : transfer.offset+chunk]
		if err := xproto.ChangePropertyChecked(b.conn, xproto.PropModeReplace, event.Window, event.Atom, transfer.typeAtom, 8, uint32(len(data)), data).Check(); err != nil {
			delete(b.transfers, key)
			if b.state != nil {
				b.state("failed", err)
			}
			b.mu.Unlock()
			return
		}
		transfer.offset += chunk
		if chunk == 0 {
			delete(b.transfers, key)
			if b.state != nil {
				b.state("served", nil)
			}
		}
		b.mu.Unlock()
		return
	}
	capture := b.capture
	if capture == nil || event.Window != b.window || event.Atom != b.atoms.property || event.State != xproto.PropertyNewValue || !capture.incremental {
		b.mu.Unlock()
		return
	}
	reply, err := xproto.GetProperty(b.conn, true, b.window, b.atoms.property, xproto.GetPropertyTypeAny, 0, uint32((clipboardTotalLimit+3)/4+1)).Reply()
	if err != nil {
		b.failCaptureLocked(capture, "remote clipboard incremental read failed")
		b.mu.Unlock()
		return
	}
	if len(reply.Value) == 0 {
		capture.incremental = false
		data := append([]byte(nil), capture.data...)
		capture.data = nil
		b.acceptCapturedValueLocked(capture, data)
		b.requestNextTargetLocked(capture)
		b.mu.Unlock()
		return
	}
	limit := clipboardTypeLimits[capture.canonical]
	if int64(len(capture.data)+len(reply.Value)) > limit || capture.total+int64(len(capture.data)+len(reply.Value)) > clipboardTotalLimit {
		b.failCaptureLocked(capture, "remote clipboard incremental transfer exceeds platform limits")
		b.mu.Unlock()
		return
	}
	capture.data = append(capture.data, reply.Value...)
	b.mu.Unlock()
}

func (b *xClipboardBridge) handleSelectionNotify(event xproto.SelectionNotifyEvent) {
	b.mu.Lock()
	capture := b.capture
	if capture == nil || event.Requestor != b.window || event.Selection != b.atoms.clipboard || event.Target != capture.current || event.Time != capture.timestamp {
		b.mu.Unlock()
		return
	}
	if event.Property == xproto.AtomNone {
		b.failCaptureLocked(capture, "remote clipboard owner refused a requested representation")
		b.mu.Unlock()
		return
	}
	reply, err := xproto.GetProperty(b.conn, false, b.window, b.atoms.property, xproto.GetPropertyTypeAny, 0, uint32((clipboardTotalLimit+3)/4+1)).Reply()
	if err != nil {
		b.failCaptureLocked(capture, "remote clipboard representation read failed")
		b.mu.Unlock()
		return
	}
	if capture.current == b.atoms.targets {
		_ = xproto.DeletePropertyChecked(b.conn, b.window, b.atoms.property).Check()
		if reply.Format != 32 || reply.Type != xproto.AtomAtom {
			b.failCaptureLocked(capture, "remote clipboard target list is invalid")
			b.mu.Unlock()
			return
		}
		available := bytesToAtoms(reply.Value)
		capture.targets = b.captureTargets(available)
		capture.index = 0
		b.requestNextTargetLocked(capture)
		b.mu.Unlock()
		return
	}
	if reply.Type == b.atoms.incr {
		capture.incremental = true
		capture.data = nil
		_ = xproto.DeletePropertyChecked(b.conn, b.window, b.atoms.property).Check()
		b.mu.Unlock()
		return
	}
	_ = xproto.DeletePropertyChecked(b.conn, b.window, b.atoms.property).Check()
	b.acceptCapturedValueLocked(capture, append([]byte(nil), reply.Value...))
	b.requestNextTargetLocked(capture)
	b.mu.Unlock()
}

func (b *xClipboardBridge) requestNextTargetLocked(capture *xClipboardCapture) {
	if b.capture != capture {
		return
	}
	if capture.index >= len(capture.targets) {
		items := capture.items
		if hasClipboardType(items, "text/html") && !hasClipboardType(items, "text/plain") {
			b.failCaptureLocked(capture, "text/html clipboard representation requires nonempty text/plain fallback")
			return
		}
		b.stopCaptureLocked()
		b.baselinePending = false
		if capture.onRemote != nil && (len(items) != 0 || b.captureRemote != nil) {
			go capture.onRemote(cloneClipboardItems(items), "")
		}
		return
	}
	target := capture.targets[capture.index]
	capture.index++
	capture.current = target
	capture.canonical = canonicalClipboardType(b.atoms.byAtom[target])
	capture.incremental = false
	capture.data = nil
	_ = xproto.DeletePropertyChecked(b.conn, b.window, b.atoms.property).Check()
	if err := xproto.ConvertSelectionChecked(b.conn, b.window, b.atoms.clipboard, target, b.atoms.property, capture.timestamp).Check(); err != nil {
		b.failCaptureLocked(capture, "remote clipboard conversion request failed")
	}
}

func (b *xClipboardBridge) acceptCapturedValueLocked(capture *xClipboardCapture, data []byte) {
	limit, ok := clipboardTypeLimits[capture.canonical]
	if len(data) == 0 {
		return
	}
	if !ok || int64(len(data)) > limit || capture.total+int64(len(data)) > clipboardTotalLimit {
		b.failCaptureLocked(capture, "remote clipboard representation exceeds platform limits")
		return
	}
	if capture.canonical == "image/png" && validateClipboardPNG(data) != nil {
		b.failCaptureLocked(capture, "remote image/png clipboard representation is invalid")
		return
	}
	if (capture.canonical == "text/plain" || capture.canonical == "text/html") && !utf8.Valid(data) {
		b.failCaptureLocked(capture, "remote text clipboard representation is not valid UTF-8")
		return
	}
	capture.items = append(capture.items, clipboardItem{Type: capture.canonical, Data: data})
	capture.total += int64(len(data))
}

func (b *xClipboardBridge) failCaptureLocked(capture *xClipboardCapture, message string) {
	if b.capture != capture {
		return
	}
	b.stopCaptureLocked()
	if capture.onError != nil {
		capture.onError(errors.New(message))
	}
}

func (b *xClipboardBridge) stopCaptureLocked() {
	if b.captureTimer != nil {
		b.captureTimer.Stop()
		b.captureTimer = nil
	}
	b.capture = nil
}

func (b *xClipboardBridge) cancelTransfersLocked() {
	for key, transfer := range b.transfers {
		_ = xproto.ChangePropertyChecked(
			b.conn, xproto.PropModeReplace, key.window, key.property,
			transfer.typeAtom, 8, 0, nil,
		).Check()
	}
	b.transfers = make(map[xClipboardTransferKey]*xClipboardSend)
}

func (b *xClipboardBridge) captureTargets(available []xproto.Atom) []xproto.Atom {
	has := make(map[xproto.Atom]bool)
	for _, atom := range available {
		has[atom] = true
	}
	result := make([]xproto.Atom, 0, 4)
	for _, names := range [][]string{
		{"UTF8_STRING", "text/plain;charset=utf-8", "text/plain"},
		{"text/html"}, {"text/rtf", "application/rtf"}, {"image/png"},
	} {
		for _, name := range names {
			if atom := b.atoms.byName[name]; has[atom] {
				result = append(result, atom)
				break
			}
		}
	}
	return result
}

func xTargetNames(canonical string) []string {
	switch canonical {
	case "text/plain":
		return []string{"UTF8_STRING", "text/plain", "text/plain;charset=utf-8"}
	case "text/html":
		return []string{"text/html"}
	case "text/rtf":
		return []string{"text/rtf", "application/rtf"}
	case "image/png":
		return []string{"image/png"}
	default:
		return nil
	}
}

func atomsToBytes(atoms []xproto.Atom) []byte {
	data := make([]byte, 4*len(atoms))
	for index, atom := range atoms {
		xgb.Put32(data[index*4:], uint32(atom))
	}
	return data
}

func bytesToAtoms(data []byte) []xproto.Atom {
	atoms := make([]xproto.Atom, 0, len(data)/4)
	for len(data) >= 4 {
		atoms = append(atoms, xproto.Atom(xgb.Get32(data)))
		data = data[4:]
	}
	return atoms
}

func sortAtoms(atoms []xproto.Atom) {
	for left := 0; left < len(atoms); left++ {
		for right := left + 1; right < len(atoms); right++ {
			if atoms[right] < atoms[left] {
				atoms[left], atoms[right] = atoms[right], atoms[left]
			}
		}
	}
}

func hasClipboardType(items []clipboardItem, mediaType string) bool {
	for _, item := range items {
		if item.Type == mediaType {
			return true
		}
	}
	return false
}

func removeClipboardType(items []clipboardItem, mediaType string) []clipboardItem {
	result := items[:0]
	for _, item := range items {
		if item.Type != mediaType {
			result = append(result, item)
		}
	}
	return result
}
