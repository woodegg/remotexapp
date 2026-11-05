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

func (m *manager) newRuntimeComponents() runtimeComponents {
	c := runtimeComponents{GatewayBinary: m.cfg.gatewayBinary, StatusBinary: m.cfg.statusBinary, UnicodeEngine: m.cfg.engine, CoreDriverDir: m.cfg.coreDriverDir}
	if m.cfg.displayProvider == "kasm" {
		c.DisplayProvider, c.Kasm, c.UnicodeEngine = "kasm", m.cfg.kasmPin, ""
		c.NativeUDP = m.cfg.nativeUDPCapable
		if m.cfg.nativeAudio {
			c.NativeAudio = sessionaudio.Protocol
		}
		if m.cfg.nativeClipboard {
			c.NativeClipboard = "text"
			if m.cfg.nativeRichClipboard {
				c.NativeClipboard = "rich-v1"
			}
		}
	}
	return c
}

func (cfg *config) configureDisplayProvider() error {
	if cfg.displayProvider == "" {
		cfg.displayProvider = "tigervnc"
	}
	if cfg.displayProvider != "tigervnc" && cfg.displayProvider != "kasm" {
		return errors.New("display-provider must be tigervnc or kasm")
	}
	if cfg.displayProvider == "tigervnc" {
		if cfg.kasmBundle != "" || cfg.nativeClipboard || cfg.nativeAudio || cfg.udpEndpointsFile != "" {
			return errors.New("kasm-bundle requires display-provider=kasm")
		}
		return nil
	}
	if cfg.vncLauncher != "direct" {
		return errors.New("Kasm requires the direct launcher")
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
	cfg.nativeRichClipboard = kasmbundle.SupportsRichClipboard(bundle.Manifest.Protocol)
	return cfg.loadUDPEndpoints()
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
		if !validUDPLease(c.UDPEndpoint) || (!c.NativeUDP && (c.UDPEndpoint != nil || c.UDPUnavailableReason != "")) || (c.UDPEndpoint != nil && c.UDPUnavailableReason != "") || (c.UDPUnavailableReason != "" && c.UDPUnavailableReason != "endpoint-pool-full" && c.UDPUnavailableReason != "endpoints-not-configured") {
			return errors.New("invalid native UDP snapshot")
		}
		if (c.NativeClipboard != "" && c.NativeClipboard != "text" && c.NativeClipboard != "rich-v1") || c.Kasm == nil || !kasmbundle.ValidDigest(c.Kasm.SHA256) || !filepath.IsAbs(c.Kasm.Directory) || filepath.Clean(c.Kasm.Directory) != c.Kasm.Directory || c.UnicodeEngine != "" {
			return errors.New("invalid Kasm component snapshot")
		}
		if verify {
			bundle, err := kasmbundle.Load(c.Kasm.Directory, c.Kasm.SHA256)
			if err != nil {
				return fmt.Errorf("locked Kasm bundle: %w", err)
			}
			if c.NativeUDP != kasmbundle.SupportsUDP(bundle.Manifest.Protocol) {
				return errors.New("native UDP capability differs from pinned component")
			}
			if c.NativeClipboard == "rich-v1" && !kasmbundle.SupportsRichClipboard(bundle.Manifest.Protocol) {
				return errors.New("locked component does not support native rich clipboard")
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
	accept, send, types := "65536", "65537", "text/plain"
	if item.Components.NativeClipboard == "rich-v1" {
		accept, send, types = "2097152", "2097153", "text/plain,text/html,image/png"
	}
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
	}
	return args
}
