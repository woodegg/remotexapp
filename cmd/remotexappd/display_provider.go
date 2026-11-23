package main

import (
	"errors"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/woodegg/remotexapp/internal/kasmbundle"
	"github.com/woodegg/remotexapp/internal/sessionaudio"
)

const defaultDisplayProvider = "kasm"
const nativeManifestSchema = 4
const nativeAudioManifestSchema = 6

func displayProvider(c runtimeComponents) string {
	if c.DisplayProvider == "" {
		return "tigervnc"
	}
	return c.DisplayProvider
}

func isKasm(item *instance) bool {
	return item != nil && displayProvider(item.Components) == "kasm"
}

const nativeTextClipboardLimit = 64 * 1024
const nativeRichClipboardLimit = 2 * 1024 * 1024
const nativeLargeClipboardLimit = 10 * 1024 * 1024

func clipboardProtocol(bundleProtocol string) string {
	switch {
	case kasmbundle.SupportsLargeClipboard(bundleProtocol):
		return "rich-v2"
	case kasmbundle.SupportsRichClipboard(bundleProtocol):
		return "rich-v1"
	case supportsNativeText(bundleProtocol):
		return "text"
	default:
		return ""
	}
}

func (m *manager) newRuntimeComponents() runtimeComponents {
	c := runtimeComponents{GatewayBinary: m.cfg.gatewayBinary, StatusBinary: m.cfg.statusBinary, UnicodeEngine: m.cfg.engine, CoreDriverDir: m.cfg.coreDriverDir}
	if m.cfg.displayProvider == "kasm" {
		c.DisplayProvider, c.Kasm, c.UnicodeEngine = "kasm", m.cfg.kasmPin, ""
		c.NativeUDP = m.cfg.nativeUDPCapable
		if m.cfg.nativeAudio {
			c.NativeAudio = sessionaudio.Protocol
		}
		if m.cfg.nativeClipboard {
			c.NativeClipboard = m.cfg.nativeClipboardMode
		}
	}
	return c
}

func (cfg *config) configureDisplayProvider() error {
	if cfg.displayProvider == "" {
		cfg.displayProvider = defaultDisplayProvider
	}
	if cfg.displayProvider != "tigervnc" && cfg.displayProvider != "kasm" {
		return errors.New("display-provider must be tigervnc or kasm")
	}
	if cfg.displayProvider == "tigervnc" {
		if cfg.kasmBundle != "" || cfg.nativeClipboard || cfg.nativeAudio || cfg.webRTC != (webRTCConfig{}) {
			return errors.New("Kasm bundle, native clipboard, native audio and UDP configuration require display-provider=kasm")
		}
		return nil
	}
	if cfg.vncLauncher != "direct" {
		return errors.New("Kasm requires the direct launcher")
	}
	if cfg.kasmBundle == "" {
		return errors.New("KasmVNC requires a verified bundle via -kasm-bundle or REMOTEXAPP_KASM_BUNDLE; select -display-provider=tigervnc for a legacy deployment")
	}
	bundle, err := kasmbundle.Load(cfg.kasmBundle, "")
	if err != nil {
		return err
	}
	if cfg.nativeClipboard && !supportsNativeText(bundle.Manifest.Protocol) {
		return errors.New("native clipboard requires the pinned text clipboard component")
	}
	if cfg.nativeAudio {
		if err := sessionaudio.CheckDependencies(); err != nil {
			return err
		}
	}
	cfg.kasmPin = &bundle.Pin
	cfg.nativeUDPCapable = kasmbundle.SupportsUDP(bundle.Manifest.Protocol)
	cfg.nativeClipboardMode = clipboardProtocol(bundle.Manifest.Protocol)
	return cfg.webRTC.validate(bundle.Manifest.Protocol)
}

func validateDisplayComponents(c runtimeComponents, verify bool) error {
	switch displayProvider(c) {
	case "tigervnc":
		if c.Kasm != nil || c.NativeAudio != "" || c.NativeClipboard != "" || c.NativeUDP || c.UDPEndpoint != nil || c.UDPUnavailableReason != "" {
			return errors.New("TigerVNC cannot carry a Kasm component pin")
		}
		if c.UnicodeEngine == "" {
			return errors.New("TigerVNC requires the Unicode engine")
		}
	case "kasm":
		if c.NativeAudio != "" && c.NativeAudio != sessionaudio.Protocol {
			return errors.New("invalid native audio protocol")
		}
		if !validUDPLease(c.UDPEndpoint) || (!c.NativeUDP && (c.UDPEndpoint != nil || c.UDPUnavailableReason != "")) || (c.UDPEndpoint != nil && c.UDPUnavailableReason != "") {
			return errors.New("invalid native UDP snapshot")
		}
		switch c.UDPUnavailableReason {
		case "", "endpoint-pool-full", udpInterfaceUnavailable, "endpoints-not-configured":
			// Pre-routing Managers wrote endpoints-not-configured for WSS-only snapshots.
		default:
			return errors.New("invalid native UDP snapshot")
		}
		if (c.NativeClipboard != "" && c.NativeClipboard != "text" && c.NativeClipboard != "rich-v1" && c.NativeClipboard != "rich-v2") || c.Kasm == nil || !kasmbundle.ValidDigest(c.Kasm.SHA256) || !filepath.IsAbs(c.Kasm.Directory) || filepath.Clean(c.Kasm.Directory) != c.Kasm.Directory || c.UnicodeEngine != "" {
			return errors.New("invalid Kasm component snapshot")
		}
		if verify {
			bundle, err := kasmbundle.Load(c.Kasm.Directory, c.Kasm.SHA256)
			if err != nil {
				return fmt.Errorf("locked Kasm bundle: %w", err)
			}
			if c.UDPEndpoint != nil && !kasmbundle.SupportsRoutedUDP(bundle.Manifest.Protocol) {
				return errors.New("routed UDP requires the pinned routed Kasm component")
			}
			if c.NativeUDP != kasmbundle.SupportsUDP(bundle.Manifest.Protocol) {
				return errors.New("native UDP capability differs from pinned component")
			}
			if (c.NativeClipboard == "rich-v1" || c.NativeClipboard == "rich-v2") &&
				c.NativeClipboard != clipboardProtocol(bundle.Manifest.Protocol) {
				return errors.New("native rich clipboard capability differs from pinned component")
			}
			if c.NativeClipboard == "text" && !supportsNativeText(bundle.Manifest.Protocol) {
				return errors.New("locked component does not support native text clipboard")
			}
		}
	default:
		return errors.New("unknown display provider")
	}
	return nil
}

func kasmLaunchArgs(item *instance, class classConfig, port int, authority string) []string {
	root := item.Components.Kasm.Directory
	limit, types := nativeTextClipboardLimit, "text/plain"
	switch item.Components.NativeClipboard {
	case "rich-v1":
		limit, types = nativeRichClipboardLimit, "text/plain,text/html,image/png"
	case "rich-v2":
		limit, types = nativeLargeClipboardLimit, "text/plain,text/html,image/png"
	}
	accept, send := strconv.Itoa(limit), strconv.Itoa(limit+1)
	args := []string{
		"--user", "--unit=" + strings.TrimSuffix(item.VNCUnit, ".service"), "--collect",
		"--property=WorkingDirectory=" + item.Home, "--setenv=HOME=" + item.Home,
		"--setenv=LD_LIBRARY_PATH=" + filepath.Join(root, "lib"),
		"--", filepath.Join(root, "bin/Xkasmvnc"), item.Display,
		"-interface", "127.0.0.1", "-websocketPort", strconv.Itoa(port),
		"-DisableBasicAuth", "-sslOnly", "0", "-SecurityTypes", "None",
		"-publicIP", "127.0.0.1", "-httpd", "", "-nolisten", "tcp",
		"-AcceptCutText=" + boolDigit(item.Components.NativeClipboard != ""), "-SendCutText=" + boolDigit(item.Components.NativeClipboard != ""),
		"-SetPrimary=0", "-SendPrimary=0",
		"-DLP_ClipAcceptMax=" + accept, "-DLP_ClipSendMax=" + send, "-DLP_ClipTypes=" + types, "-DLP_Log=off",
		"-IgnoreClientSettingsKasm=1",
		"-geometry", class.Server.Geometry, "-depth", "24", "-FrameRate", strconv.Itoa(class.Server.FrameRate),
		"-AcceptSetDesktopSize=" + boolDigit(class.Server.AllowClientResize), "-FreeKeyMappings", "-auth", authority,
	}
	if lease := item.Components.UDPEndpoint; lease != nil {
		for i := range args {
			if args[i] == "-publicIP" {
				args[i+1] = lease.Address
			}
		}
		args = append(args, "-udpPort", strconv.Itoa(lease.Port))
		args = append(args, "-udpBindAddress", lease.Bind)
	}
	return args
}
