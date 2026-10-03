package main

import (
	"sync"
	"time"
)

type inputMessage struct {
	ID     uint64  `json:"id"`
	Type   string  `json:"type"`
	Action string  `json:"action"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Button int     `json:"button"`
	Value  string  `json:"value"`
	DeltaY float64 `json:"deltaY"`
}

// unoRequest is intentionally a small allow-list, not a raw UNO proxy. The
// browser must never gain arbitrary access to LibreOffice's unauthenticated
// URP socket.
type unoRequest struct {
	Action string `json:"action"`
	Slide  int    `json:"slide,omitempty"`
	Text   string `json:"text,omitempty"`
}

type inputAck struct {
	Type     string  `json:"type"`
	ID       uint64  `json:"id"`
	ServerMS float64 `json:"serverMs"`
	Error    string  `json:"error,omitempty"`
}

type cursorPosition struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

type cursorAck struct {
	Type      string          `json:"type"`
	Sequence  uint64          `json:"sequence"`
	UpdatedMS int64           `json:"updatedMs"`
	Focused   bool            `json:"focused"`
	Enabled   bool            `json:"enabled"`
	Cursor    *cursorPosition `json:"cursor,omitempty"`
	Error     string          `json:"error,omitempty"`
}

type inputPeer struct {
	viewerID    string
	connection  jsonWriter
	writeMu     sync.Mutex
	cursorMu    sync.Mutex
	cursorQueue chan cursorAck
	reliable    chan any
	done        chan struct{}
	writerOnce  sync.Once
	stopOnce    sync.Once
}

type jsonWriter interface {
	WriteJSON(any) error
	SetWriteDeadline(time.Time) error
}

type inputController struct {
	display          string
	x11              *nativeX11
	textBackend      string
	textLogLevel     string
	imeSocket        string
	ibusFocusClasses map[string]struct{}
	peersMu          sync.RWMutex
	peers            map[*inputPeer]struct{}
	cursorMu         sync.RWMutex
	latestCursor     *cursorAck
	clipboard        *clipboardService
}
