package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// Viewer hooks are optional package-owned transitions, not per-websocket actions.
// They run only on the first attach and final detach of a session generation.
func (m *manager) runViewerHook(item *instance, attaching bool) error {
	if item == nil || item.SessionState != "running" {
		return nil
	}
	class := m.specFor(item)
	driver := class.Session.ViewerDetachDriver
	if attaching {
		driver = class.Session.ViewerAttachDriver
	}
	if driver == "" {
		return nil
	}
	if class.Package != nil {
		verified, _, err := loadAppPackageDirectory(class.Package.Path, class.ID)
		if err != nil || verified.Package.ContentSHA256 != class.Package.ContentSHA256 {
			return errors.New("viewer hook package integrity failed")
		}
	}
	if os.Geteuid() == 0 {
		return errors.New("viewer hook cannot execute as root")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, driver)
	command.Dir = filepath.Dir(driver)
	command.Env = []string{
		"PATH=/usr/local/bin:/usr/bin:/bin", "HOME=" + item.Home,
		"DISPLAY=" + item.Display, "XAUTHORITY=" + authorityPath(item),
		"REMOTEXAPP_RUNTIME=" + item.Runtime,
		"REMOTEXAPP_SESSION_GENERATION=" + strconv.FormatInt(item.SessionGeneration, 10),
		"PYTHONDONTWRITEBYTECODE=1",
	}
	command.Env = appendAppProcessEnvironment(command.Env, item, class)
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true, Pdeathsig: syscall.SIGTERM}
	command.Cancel = func() error {
		if command.Process != nil {
			return syscall.Kill(-command.Process.Pid, syscall.SIGTERM)
		}
		return nil
	}
	command.WaitDelay = 2 * time.Second
	var output shutdownOutput
	command.Stdout, command.Stderr = &output, &output
	if err := command.Start(); err != nil {
		return fmt.Errorf("start viewer hook: %w", err)
	}
	err := command.Wait()
	_ = syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
	if err != nil {
		// Hook output may contain a browser URL. Do not expose it to clients/logs.
		if ctx.Err() != nil {
			return errors.New("viewer hook timed out")
		}
		return fmt.Errorf("viewer hook failed: %w", err)
	}
	if message := strings.TrimSpace(output.String()); message != "" {
		log.Printf("instance %s viewer hook completed", item.ID)
	}
	return nil
}
