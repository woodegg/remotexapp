package main

import (
	"errors"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/woodegg/remotexapp/internal/kasmbundle"
)

const nativeManifestSchema = 4

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
		if m.cfg.nativeClipboard {
			c.NativeClipboard = "text"
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
		if cfg.kasmBundle != "" || cfg.nativeClipboard {
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
	if cfg.nativeClipboard && bundle.Manifest.Protocol != kasmbundle.TextProtocol {
		return errors.New("native clipboard requires the pinned text clipboard component")
	}
	cfg.kasmPin = &bundle.Pin
	return nil
}

func validateDisplayComponents(c runtimeComponents, verify bool) error {
	switch displayProvider(c) {
	case "tigervnc":
		if c.Kasm != nil || c.NativeClipboard != "" {
			return errors.New("TigerVNC cannot carry a Kasm component pin")
		}
		if c.UnicodeEngine == "" {
			return errors.New("TigerVNC requires the Unicode engine")
		}
	case "kasm":
		if (c.NativeClipboard != "" && c.NativeClipboard != "text") || c.Kasm == nil || !kasmbundle.ValidDigest(c.Kasm.SHA256) || !filepath.IsAbs(c.Kasm.Directory) || filepath.Clean(c.Kasm.Directory) != c.Kasm.Directory || c.UnicodeEngine != "" {
			return errors.New("invalid Kasm component snapshot")
		}
		if verify {
			bundle, err := kasmbundle.Load(c.Kasm.Directory, c.Kasm.SHA256)
			if err != nil {
				return fmt.Errorf("locked Kasm bundle: %w", err)
			}
			if c.NativeClipboard == "text" && bundle.Manifest.Protocol != kasmbundle.TextProtocol {
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
	return []string{
		"--user", "--unit=" + strings.TrimSuffix(item.VNCUnit, ".service"), "--collect",
		"--property=WorkingDirectory=" + item.Home, "--setenv=HOME=" + item.Home,
		"--setenv=LD_LIBRARY_PATH=" + filepath.Join(root, "lib"),
		"--", filepath.Join(root, "bin/Xkasmvnc"), item.Display,
		"-interface", "127.0.0.1", "-websocketPort", strconv.Itoa(port),
		"-DisableBasicAuth", "-sslOnly", "0", "-SecurityTypes", "None",
		"-publicIP", "127.0.0.1", "-httpd", "", "-nolisten", "tcp",
		"-AcceptCutText=" + boolDigit(item.Components.NativeClipboard == "text"), "-SendCutText=" + boolDigit(item.Components.NativeClipboard == "text"),
		"-DLP_ClipAcceptMax=65536", "-DLP_ClipSendMax=65537", "-DLP_ClipTypes=text/plain", "-DLP_Log=off",
		"-IgnoreClientSettingsKasm=1",
		"-geometry", class.Server.Geometry, "-depth", "24", "-FrameRate", strconv.Itoa(class.Server.FrameRate),
		"-AcceptSetDesktopSize=" + boolDigit(class.Server.AllowClientResize), "-FreeKeyMappings", "-auth", authority,
	}
}
