// novnc-input serves noVNC plus a same-origin X11 input bridge.
package main

import (
	"context"
	_ "embed"
	"flag"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"syscall"
	"time"
)

//go:embed web/kiosk.html
var kioskHTML []byte

//go:embed uno_api.py
var unoAPIScript []byte

func main() {
	cfg := config{}
	flag.StringVar(&cfg.listen, "listen", "127.0.0.1:1984", "HTTP/WebSocket listen address")
	flag.StringVar(&cfg.display, "display", ":23", "X11 display to control")
	flag.StringVar(&cfg.vncAddr, "vnc-addr", "127.0.0.1:5923", "loopback TigerVNC TCP/RFB address")
	flag.StringVar(&cfg.legacyRFB, "legacy-rfb", "", "optional internal websockify WebSocket URL for A/B testing")
	flag.StringVar(&cfg.unoURL, "uno-url", "", "optional loopback LibreOffice UNO URL")
	flag.StringVar(&cfg.textBackend, "text-backend", "clipboard", "Unicode text backend: clipboard, keysym, or ibus")
	flag.StringVar(&cfg.textLogLevel, "text-log", textLogErrors, "text request log level: errors, metadata, or content")
	flag.StringVar(&cfg.imeSocket, "ime-socket", "", "private Unix socket for the ibus text backend")
	flag.StringVar(&cfg.ibusFocusClass, "ibus-focus-class", "", "comma-separated X11 WM_CLASS allow-list required for the ibus backend")
	flag.IntVar(&cfg.maxRFBConnections, "max-rfb-connections", 8, "maximum concurrent RFB WebSocket connections")
	flag.IntVar(&cfg.maxInputConnections, "max-input-connections", 8, "maximum concurrent input WebSocket connections")
	flag.StringVar(&cfg.clipboardSocket, "clipboard-socket", os.Getenv("REMOTEXAPP_CLIPBOARD_SOCKET"), "private Manager clipboard Unix socket")
	flag.Parse()
	if cfg.maxRFBConnections < 1 || cfg.maxRFBConnections > 128 || cfg.maxInputConnections < 1 || cfg.maxInputConnections > 128 {
		log.Fatal("connection limits must be between 1 and 128")
	}

	if _, _, err := net.SplitHostPort(cfg.vncAddr); err != nil {
		log.Fatalf("invalid -vnc-addr: %v", err)
	}
	if cfg.legacyRFB != "" {
		if _, err := url.ParseRequestURI(cfg.legacyRFB); err != nil {
			log.Fatalf("invalid -legacy-rfb: %v", err)
		}
	}
	if cfg.textBackend != "clipboard" && cfg.textBackend != "keysym" && cfg.textBackend != "ibus" {
		log.Fatalf("invalid -text-backend %q (want clipboard, keysym, or ibus)", cfg.textBackend)
	}
	if !validTextLogLevel(cfg.textLogLevel) {
		log.Fatalf("invalid -text-log %q (want errors, metadata, or content)", cfg.textLogLevel)
	}
	if cfg.textBackend == "ibus" && cfg.imeSocket == "" {
		log.Fatal("-ime-socket is required with -text-backend=ibus")
	}
	if cfg.textBackend == "ibus" && cfg.ibusFocusClass == "" {
		log.Fatal("-ibus-focus-class is required with -text-backend=ibus")
	}

	native, err := openNativeX11(cfg.display)
	if err != nil {
		log.Fatal(err)
	}
	defer native.close()
	input := &inputController{
		display: cfg.display, x11: native, textBackend: cfg.textBackend, imeSocket: cfg.imeSocket,
		textLogLevel: cfg.textLogLevel, ibusFocusClasses: classAllowList(cfg.ibusFocusClass), peers: make(map[*inputPeer]struct{}),
	}
	if cfg.clipboardSocket != "" {
		clipboard, err := newClipboardService(cfg.display, cfg.clipboardSocket, input.broadcastClipboard, func() error {
			return native.key("shift+Insert")
		})
		if err != nil {
			log.Fatalf("clipboard bridge: %v", err)
		}
		defer clipboard.Close()
		input.clipboard = clipboard
		log.Printf("Rich clipboard bridge enabled")
	}
	if cfg.textBackend == "ibus" {
		go input.subscribeIBusCursor()
	}
	log.Printf("Unicode text backend: %s", cfg.textBackend)
	log.Printf("Text request log level: %s", cfg.textLogLevel)
	log.Printf("remotexapp gateway: http://%s/kiosk.html (X11 %s, RFB TCP %s, UNO enabled=%t)", cfg.listen, cfg.display, cfg.vncAddr, cfg.unoURL != "")
	server := &http.Server{Addr: cfg.listen, Handler: gatewayHandler(cfg, input), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 75 * time.Second, MaxHeaderBytes: 1 << 20}
	errors := make(chan error, 1)
	go func() { errors <- server.ListenAndServe() }()
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	select {
	case err := <-errors:
		if err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	case <-signals:
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			log.Printf("HTTP shutdown: %v", err)
		}
	}
}
