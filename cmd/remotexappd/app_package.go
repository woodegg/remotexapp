package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"syscall"
	"time"
)

const (
	appPackageAPIVersion = "remotexapp/v1"
	appPackageMetadata   = ".remotexapp-package.json"
	maxDriverConfigBytes = 64 << 10
	maxAppArchiveBytes   = 64 << 20
	maxAppArchiveEntries = 1024
)

type appPackageReference struct {
	APIVersion    string `json:"apiVersion"`
	ID            string `json:"id"`
	Version       string `json:"version"`
	ContentSHA256 string `json:"contentSha256"`
	ArchiveSHA256 string `json:"archiveSha256,omitempty"`
	Path          string `json:"path"`
}

type appPackageSeal struct {
	SchemaVersion int    `json:"schemaVersion"`
	ArchiveSHA256 string `json:"archiveSha256,omitempty"`
	ContentSHA256 string `json:"contentSha256"`
}

var (
	safeDependencyName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$`)
	safePythonModule   = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*(?:[.][A-Za-z_][A-Za-z0-9_]*)*$`)
)

func readinessTimeout(value string) (time.Duration, error) {
	if value == "" {
		return 20 * time.Second, nil
	}
	timeout, err := time.ParseDuration(value)
	if err != nil || timeout < time.Second || timeout > 5*time.Minute {
		return 0, errors.New("must be a duration from 1s through 5m")
	}
	return timeout, nil
}

func driverConfigPath(runtime string) string { return filepath.Join(runtime, "driver-config.json") }
func resourcesPath(runtime string) string    { return filepath.Join(runtime, "allocated-resources.json") }

func writeAppLaunchContract(runtime string, class classConfig, resources map[string]allocatedResource) error {
	if class.APIVersion == "" {
		return nil
	}
	if class.Driver == nil {
		return errors.New("App Package driver config is unavailable")
	}
	var indented bytes.Buffer
	if err := json.Indent(&indented, class.Driver.Config, "", "  "); err != nil {
		return fmt.Errorf("encode driver config: %w", err)
	}
	indented.WriteByte('\n')
	if err := writePrivateAtomic(driverConfigPath(runtime), indented.Bytes()); err != nil {
		return err
	}
	payload, err := json.MarshalIndent(resources, "", "  ")
	if err != nil {
		return err
	}
	return writePrivateAtomic(resourcesPath(runtime), append(payload, '\n'))
}

func appSystemdEnvironmentArgs(item *instance, class classConfig) []string {
	if class.APIVersion == "" {
		return nil
	}
	return []string{
		"--setenv=REMOTEXAPP_API_VERSION=" + class.APIVersion,
		"--setenv=REMOTEXAPP_DRIVER_CONFIG=" + driverConfigPath(item.Runtime),
		"--setenv=REMOTEXAPP_RESOURCES=" + resourcesPath(item.Runtime),
		"--setenv=REMOTEXAPP_CORE_DRIVER_DIR=" + item.Components.CoreDriverDir,
	}
}

func appendAppProcessEnvironment(environment []string, item *instance, class classConfig) []string {
	if class.APIVersion == "" {
		return environment
	}
	return append(environment,
		"REMOTEXAPP_API_VERSION="+class.APIVersion,
		"REMOTEXAPP_DRIVER_CONFIG="+driverConfigPath(item.Runtime),
		"REMOTEXAPP_RESOURCES="+resourcesPath(item.Runtime),
		"REMOTEXAPP_CORE_DRIVER_DIR="+item.Components.CoreDriverDir,
	)
}

func validateClassExtensions(class *classConfig) error {
	if err := validateActions(class); err != nil {
		return err
	}
	if class.APIVersion == "" {
		if class.Session.ViewerAttachDriver != "" || class.Session.ViewerDetachDriver != "" {
			return errors.New("viewer transition drivers require an App Package")
		}
		if len(class.Ports) != 0 || class.Driver != nil || class.Overrides != nil || class.Dependencies != nil {
			return errors.New("ports, driver, overrides, and dependencies require apiVersion")
		}
		return nil
	}
	if class.APIVersion != appPackageAPIVersion {
		return fmt.Errorf("unsupported apiVersion %q", class.APIVersion)
	}
	if (class.Session.ViewerAttachDriver == "") != (class.Session.ViewerDetachDriver == "") {
		return errors.New("viewer attach and detach drivers must be declared together")
	}
	if class.Control.Protocol != "" || class.Control.Address != "" || class.Control.Port != 0 || class.Control.Path != "" {
		return errors.New("App Package V1 uses ports instead of legacy control")
	}
	if class.Ports == nil {
		return errors.New("App Package V1 manifest must declare ports, using an empty object when none are required")
	}
	for name, port := range class.Ports {
		if !safeRef.MatchString(name) {
			return fmt.Errorf("port name %q must be a safe lowercase reference", name)
		}
		if port.Kind != "loopback-tcp" {
			return fmt.Errorf("port %q has unsupported kind %q", name, port.Kind)
		}
		if port.Port < 0 || port.Port > 65535 || (port.Port > 0 && port.Port < 1024) {
			return fmt.Errorf("port %q must use zero or an unprivileged TCP port", name)
		}
	}
	if class.Driver == nil {
		class.Driver = &driverClassConfig{Config: json.RawMessage(`{}`)}
	}
	if len(class.Driver.Config) == 0 || len(class.Driver.Config) > maxDriverConfigBytes {
		return fmt.Errorf("driver.config must be a JSON object no larger than %d bytes", maxDriverConfigBytes)
	}
	decoder := json.NewDecoder(bytes.NewReader(class.Driver.Config))
	decoder.UseNumber()
	var driverConfig map[string]any
	if err := decoder.Decode(&driverConfig); err != nil || driverConfig == nil {
		return errors.New("driver.config must be a JSON object")
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("driver.config must contain one JSON object")
	}
	if class.Overrides == nil || class.Overrides.Allowed == nil {
		return errors.New("App Package V1 manifest must declare overrides.allowed")
	}
	allowedOverrides := map[string]bool{
		"displayMode": true, "display": true, "geometry": true, "frameRate": true,
		"allowClientResize": true, "workspaceMode": true, "sessionActivation": true,
		"idleTimeout": true, "idleAction": true, "singleton": true,
	}
	seenOverrides := make(map[string]bool, len(class.Overrides.Allowed))
	for _, name := range class.Overrides.Allowed {
		if !allowedOverrides[name] {
			return fmt.Errorf("overrides.allowed contains unsupported field %q", name)
		}
		if seenOverrides[name] {
			return fmt.Errorf("overrides.allowed repeats field %q", name)
		}
		seenOverrides[name] = true
	}
	if class.Dependencies == nil {
		return errors.New("App Package V1 manifest must declare dependencies")
	}
	if class.Dependencies.Executables == nil || class.Dependencies.PythonModules == nil {
		return errors.New("App Package V1 dependencies must declare executables and pythonModules arrays")
	}
	seenDependencies := make(map[string]bool)
	for _, name := range class.Dependencies.Executables {
		if !safeDependencyName.MatchString(name) || strings.Contains(name, "/") {
			return fmt.Errorf("dependency executable %q is invalid", name)
		}
		if seenDependencies["exec:"+name] {
			return fmt.Errorf("dependency executable %q is repeated", name)
		}
		seenDependencies["exec:"+name] = true
	}
	for _, name := range class.Dependencies.PythonModules {
		if !safePythonModule.MatchString(name) {
			return fmt.Errorf("dependency Python module %q is invalid", name)
		}
		if seenDependencies["python:"+name] {
			return fmt.Errorf("dependency Python module %q is repeated", name)
		}
		seenDependencies["python:"+name] = true
	}
	if class.Server.ReadinessTimeout == "" || class.Session.ReadinessTimeout == "" {
		return errors.New("App Package V1 requires explicit server and session readinessTimeout")
	}
	return nil
}

func loadAppPackageCatalog(packageRoot, enabledRoot string) (map[string]classConfig, map[string]time.Duration, error) {
	root, err := canonicalDirectory(packageRoot)
	if err != nil {
		return nil, nil, fmt.Errorf("App Package root: %w", err)
	}
	enabled, err := canonicalDirectory(enabledRoot)
	if err != nil {
		return nil, nil, fmt.Errorf("enabled App Package catalog: %w", err)
	}
	if err := validateInstallRoot(root); err != nil {
		return nil, nil, err
	}
	if err := validateInstallRoot(enabled); err != nil {
		return nil, nil, err
	}
	entries, err := os.ReadDir(enabled)
	if err != nil {
		return nil, nil, err
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	classes := make(map[string]classConfig, len(entries))
	timeouts := make(map[string]time.Duration, len(entries))
	for _, entry := range entries {
		if !safeRef.MatchString(entry.Name()) {
			return nil, nil, fmt.Errorf("enabled App Package selector %q has an unsafe name", entry.Name())
		}
		selector := filepath.Join(enabled, entry.Name())
		info, err := os.Lstat(selector)
		if err != nil {
			return nil, nil, err
		}
		if info.Mode()&os.ModeSymlink == 0 {
			return nil, nil, fmt.Errorf("enabled App Package selector %s must be a symlink", selector)
		}
		if err := validateOwnedPath(selector, info); err != nil {
			return nil, nil, err
		}
		resolved, err := filepath.EvalSymlinks(selector)
		if err != nil {
			return nil, nil, fmt.Errorf("resolve enabled App Package %s: %w", selector, err)
		}
		resolved, err = filepath.Abs(resolved)
		if err != nil {
			return nil, nil, err
		}
		if !pathWithin(root, resolved) {
			return nil, nil, fmt.Errorf("enabled App Package %s resolves outside %s", selector, root)
		}
		if err := validateInstallRoot(filepath.Dir(resolved)); err != nil {
			return nil, nil, err
		}
		class, timeout, err := loadAppPackageDirectory(resolved, entry.Name())
		if err != nil {
			return nil, nil, fmt.Errorf("enabled App Package %s: %w", entry.Name(), err)
		}
		if _, exists := classes[class.ID]; exists {
			return nil, nil, fmt.Errorf("duplicate App Package id %q", class.ID)
		}
		classes[class.ID] = class
		timeouts[class.ID] = timeout
	}
	return classes, timeouts, nil
}

func loadAppPackageDirectory(packagePath, expectedID string) (classConfig, time.Duration, error) {
	var empty classConfig
	canonical, err := canonicalDirectory(packagePath)
	if err != nil {
		return empty, 0, err
	}
	seal, err := readAppPackageSeal(canonical)
	if err != nil {
		return empty, 0, err
	}
	digest, err := appPackageContentDigest(canonical)
	if err != nil {
		return empty, 0, err
	}
	if !strings.EqualFold(seal.ContentSHA256, digest) {
		return empty, 0, errors.New("installed App Package content digest does not match its seal")
	}
	class, timeout, err := validateAppPackageContents(canonical)
	if err != nil {
		return empty, 0, err
	}
	if class.ID != expectedID {
		return empty, 0, fmt.Errorf("manifest id %q does not match enabled selector %q", class.ID, expectedID)
	}
	if filepath.Base(canonical) != class.DriverVersion || filepath.Base(filepath.Dir(canonical)) != class.ID {
		return empty, 0, errors.New("package path must be <root>/<id>/<driverVersion>")
	}
	class.Package = &appPackageReference{
		APIVersion: appPackageAPIVersion, ID: class.ID, Version: class.DriverVersion,
		ContentSHA256: digest, ArchiveSHA256: strings.ToLower(seal.ArchiveSHA256), Path: canonical,
	}
	return class, timeout, nil
}

func validateAppPackageContents(canonical string) (classConfig, time.Duration, error) {
	var empty classConfig
	if err := validatePackageTree(canonical); err != nil {
		return empty, 0, err
	}
	license, err := os.Stat(filepath.Join(canonical, "LICENSE"))
	if err != nil || !license.Mode().IsRegular() {
		return empty, 0, errors.New("App Package must include a regular LICENSE file")
	}
	manifestPath := filepath.Join(canonical, "manifest.json")
	class, timeout, err := loadClassConfig(manifestPath)
	if err != nil {
		return empty, 0, err
	}
	if err := resolveClassDrivers(&class, manifestPath); err != nil {
		return empty, 0, err
	}
	for name, action := range class.Actions {
		file := filepath.Join(canonical, action.Handler)
		info, err := os.Lstat(file)
		if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0111 == 0 || !pathWithin(canonical, file) {
			return empty, 0, fmt.Errorf("action %s requires a package-relative executable regular handler", name)
		}
	}
	if class.APIVersion != appPackageAPIVersion {
		return empty, 0, fmt.Errorf("manifest apiVersion must be %q", appPackageAPIVersion)
	}
	for _, driver := range []string{class.Server.Driver, class.Session.Driver, class.Session.ShutdownDriver, class.Session.ViewerAttachDriver, class.Session.ViewerDetachDriver} {
		if driver == "" {
			continue
		}
		if !pathWithin(canonical, driver) {
			return empty, 0, fmt.Errorf("driver %s resolves outside the App Package", driver)
		}
		info, err := os.Stat(driver)
		if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0o111 == 0 {
			return empty, 0, fmt.Errorf("driver %s must be a readable executable regular file", driver)
		}
	}
	if err := checkAppDependencies(class.ID, class.Dependencies); err != nil {
		return empty, 0, err
	}
	return class, timeout, nil
}

func installAppPackageArchive(archivePath, expectedSHA256, packageRoot, enabledRoot string, activate bool) (*appPackageReference, error) {
	if !validSHA256(expectedSHA256) {
		return nil, errors.New("expected archive SHA-256 must be 64 lowercase hexadecimal characters")
	}
	archivePath, err := filepath.Abs(archivePath)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(archivePath)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() < 1 || info.Size() > maxAppArchiveBytes {
		return nil, fmt.Errorf("App Package archive must be a regular file no larger than %d bytes", maxAppArchiveBytes)
	}
	actualArchiveDigest, err := fileSHA256(archivePath)
	if err != nil {
		return nil, err
	}
	if actualArchiveDigest != expectedSHA256 {
		return nil, errors.New("App Package archive SHA-256 mismatch")
	}
	for _, root := range []string{packageRoot, enabledRoot} {
		if !filepath.IsAbs(root) {
			return nil, errors.New("App Package installation roots must be absolute")
		}
		if err := os.MkdirAll(root, 0o755); err != nil {
			return nil, err
		}
	}
	packageRoot, err = canonicalDirectory(packageRoot)
	if err != nil {
		return nil, err
	}
	enabledRoot, err = canonicalDirectory(enabledRoot)
	if err != nil {
		return nil, err
	}
	if err := validateInstallRoot(packageRoot); err != nil {
		return nil, err
	}
	if err := validateInstallRoot(enabledRoot); err != nil {
		return nil, err
	}
	staging, err := os.MkdirTemp(packageRoot, ".install-*")
	if err != nil {
		return nil, err
	}
	if err := os.Chmod(staging, 0o755); err != nil {
		_ = os.RemoveAll(staging)
		return nil, err
	}
	defer os.RemoveAll(staging)
	if err := extractAppPackageArchive(archivePath, staging); err != nil {
		return nil, err
	}
	class, _, err := validateAppPackageContents(staging)
	if err != nil {
		return nil, fmt.Errorf("validate staged App Package: %w", err)
	}
	seal, err := sealAppPackageDirectory(staging, actualArchiveDigest)
	if err != nil {
		return nil, err
	}
	versionRoot := filepath.Join(packageRoot, class.ID)
	if err := os.MkdirAll(versionRoot, 0o755); err != nil {
		return nil, err
	}
	if err := validateInstallRoot(versionRoot); err != nil {
		return nil, err
	}
	target := filepath.Join(versionRoot, class.DriverVersion)
	if targetInfo, err := os.Lstat(target); err == nil {
		if targetInfo.Mode()&os.ModeSymlink != 0 || !targetInfo.IsDir() {
			return nil, fmt.Errorf("existing App Package target %s must be a real directory", target)
		}
		installed, _, loadErr := loadAppPackageDirectory(target, class.ID)
		if loadErr != nil {
			return nil, fmt.Errorf("validate installed App Package: %w", loadErr)
		}
		if installed.Package == nil || installed.DriverVersion != class.DriverVersion {
			return nil, errors.New("installed App Package identity does not match the staged archive")
		}
		if installed.Package.ContentSHA256 != seal.ContentSHA256 {
			return nil, fmt.Errorf("App Package %s version %s already exists with different content", class.ID, class.DriverVersion)
		}
		// Archive metadata may differ for a package produced before canonical
		// timestamps were introduced. The immutable content seal is the semantic
		// identity; retain the original transport digest and directory.
		reference := installed.Package
		if activate {
			if err := activateAppPackage(reference, packageRoot, enabledRoot); err != nil {
				return reference, err
			}
		}
		return reference, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if err := os.Rename(staging, target); err != nil {
		return nil, err
	}
	if err := syncDirectory(versionRoot); err != nil {
		return nil, err
	}
	reference := &appPackageReference{
		APIVersion: appPackageAPIVersion, ID: class.ID, Version: class.DriverVersion,
		ContentSHA256: seal.ContentSHA256, ArchiveSHA256: actualArchiveDigest, Path: target,
	}
	if activate {
		if err := activateAppPackage(reference, packageRoot, enabledRoot); err != nil {
			return reference, err
		}
	}
	return reference, nil
}

func activateInstalledAppPackage(id, version, packageRoot, enabledRoot string) (*appPackageReference, error) {
	if !safeRef.MatchString(id) || !semanticVersion.MatchString(version) {
		return nil, errors.New("App Package activation requires a safe id and semantic version")
	}
	root, err := canonicalDirectory(packageRoot)
	if err != nil {
		return nil, fmt.Errorf("App Package root: %w", err)
	}
	enabled, err := canonicalDirectory(enabledRoot)
	if err != nil {
		return nil, fmt.Errorf("enabled App Package catalog: %w", err)
	}
	if err := validateInstallRoot(root); err != nil {
		return nil, err
	}
	if err := validateInstallRoot(enabled); err != nil {
		return nil, err
	}
	target := filepath.Join(root, id, version)
	class, _, err := loadAppPackageDirectory(target, id)
	if err != nil {
		return nil, err
	}
	if class.Package == nil || class.DriverVersion != version {
		return nil, errors.New("installed App Package identity does not match the requested version")
	}
	if err := validateInstallRoot(filepath.Dir(class.Package.Path)); err != nil {
		return nil, err
	}
	if err := activateAppPackage(class.Package, root, enabled); err != nil {
		return nil, err
	}
	return class.Package, nil
}

type appRetirementRuntimeRecord struct {
	Runtime struct {
		ID         string `json:"id"`
		ClassID    string `json:"classId"`
		TemplateID string `json:"templateId"`
	} `json:"runtime"`
	ResolvedSpec struct {
		ID string `json:"id"`
	} `json:"resolvedSpec"`
	AppPackage *struct {
		ID string `json:"id"`
	} `json:"appPackage"`
}

type appRetirementManagedRecord struct {
	ID         string `json:"id"`
	TemplateID string `json:"templateId"`
	Runtime    *struct {
		ClassID    string `json:"classId"`
		TemplateID string `json:"templateId"`
	} `json:"runtime"`
	AppliedSpec *struct {
		ID string `json:"id"`
	} `json:"appliedSpec"`
}

func decodeAppRetirementRecord(path string, destination any) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() < 1 || info.Size() > 512<<10 {
		return fmt.Errorf("state record must be a regular file no larger than %d bytes", 512<<10)
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	decoder := json.NewDecoder(io.LimitReader(file, (512<<10)+1))
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return err
	}
	return nil
}

func appRetirementReferences(id, stateDir string) ([]string, error) {
	if !safeRef.MatchString(id) {
		return nil, errors.New("App Package retirement requires a safe id")
	}
	if !filepath.IsAbs(stateDir) || filepath.Clean(stateDir) == string(filepath.Separator) {
		return nil, errors.New("App Package retirement state directory must be an absolute path other than /")
	}
	stateDir = filepath.Clean(stateDir)
	stateInfo, err := os.Lstat(stateDir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if !stateInfo.IsDir() || stateInfo.Mode()&os.ModeSymlink != 0 {
		return nil, fmt.Errorf("App Package retirement state path %s must be a real directory", stateDir)
	}

	references := make([]string, 0)
	for _, kind := range []string{"runtime-manifests", "managed-instances"} {
		directory := filepath.Join(stateDir, kind)
		info, err := os.Lstat(directory)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return nil, fmt.Errorf("App Package retirement reference path %s must be a real directory", directory)
		}
		entries, err := os.ReadDir(directory)
		if err != nil {
			return nil, err
		}
		sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
		for _, entry := range entries {
			if filepath.Ext(entry.Name()) != ".json" {
				continue
			}
			path := filepath.Join(directory, entry.Name())
			referenced := false
			if kind == "runtime-manifests" {
				var record appRetirementRuntimeRecord
				if err := decodeAppRetirementRecord(path, &record); err != nil {
					return nil, fmt.Errorf("inspect App Package retirement reference %s: %w", path, err)
				}
				referenced = record.Runtime.TemplateID == id || record.Runtime.ClassID == id ||
					record.ResolvedSpec.ID == id || (record.AppPackage != nil && record.AppPackage.ID == id)
			} else {
				var record appRetirementManagedRecord
				if err := decodeAppRetirementRecord(path, &record); err != nil {
					return nil, fmt.Errorf("inspect App Package retirement reference %s: %w", path, err)
				}
				referenced = record.TemplateID == id ||
					(record.Runtime != nil && (record.Runtime.TemplateID == id || record.Runtime.ClassID == id)) ||
					(record.AppliedSpec != nil && record.AppliedSpec.ID == id)
			}
			if referenced {
				references = append(references, filepath.Join(kind, entry.Name()))
			}
		}
	}
	return references, nil
}

func retireAppPackage(id, packageRoot, enabledRoot, stateDir string) error {
	references, err := appRetirementReferences(id, stateDir)
	if err != nil {
		return err
	}
	if len(references) != 0 {
		return fmt.Errorf("App Package %s retirement is blocked by durable references: %s", id, strings.Join(references, ", "))
	}
	return disableAppPackage(id, packageRoot, enabledRoot)
}

func disableAppPackage(id, packageRoot, enabledRoot string) error {
	if !safeRef.MatchString(id) {
		return errors.New("App Package disable requires a safe id")
	}
	root, err := canonicalDirectory(packageRoot)
	if err != nil {
		return fmt.Errorf("App Package root: %w", err)
	}
	enabled, err := canonicalDirectory(enabledRoot)
	if err != nil {
		return fmt.Errorf("enabled App Package catalog: %w", err)
	}
	if err := validateInstallRoot(root); err != nil {
		return err
	}
	if err := validateInstallRoot(enabled); err != nil {
		return err
	}
	selector := filepath.Join(enabled, id)
	info, err := os.Lstat(selector)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink == 0 {
		return fmt.Errorf("refusing to remove non-symlink selector %s", selector)
	}
	if err := validateOwnedPath(selector, info); err != nil {
		return err
	}
	resolved, err := filepath.EvalSymlinks(selector)
	if err != nil {
		return err
	}
	if !pathWithin(root, resolved) {
		return fmt.Errorf("enabled App Package %s resolves outside %s", selector, root)
	}
	if err := os.Remove(selector); err != nil {
		return err
	}
	return syncDirectory(enabled)
}

func activateAppPackage(reference *appPackageReference, packageRoot, enabledRoot string) error {
	if reference == nil || !safeRef.MatchString(reference.ID) || !semanticVersion.MatchString(reference.Version) {
		return errors.New("valid App Package reference is required")
	}
	target, err := filepath.EvalSymlinks(reference.Path)
	if err != nil {
		return err
	}
	if !pathWithin(packageRoot, target) {
		return errors.New("App Package activation target is outside the package root")
	}
	loaded, _, err := loadAppPackageDirectory(target, reference.ID)
	if err != nil {
		return err
	}
	if loaded.Package == nil || loaded.Package.ContentSHA256 != reference.ContentSHA256 || loaded.DriverVersion != reference.Version {
		return errors.New("App Package activation reference does not match installed content")
	}
	selector := filepath.Join(enabledRoot, reference.ID)
	if current, err := os.Lstat(selector); err == nil {
		if current.Mode()&os.ModeSymlink == 0 {
			return fmt.Errorf("refusing to replace non-symlink selector %s", selector)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	temporary := filepath.Join(enabledRoot, "."+reference.ID+"-activate-"+fmt.Sprintf("%d", time.Now().UnixNano()))
	if err := os.Symlink(target, temporary); err != nil {
		return err
	}
	defer os.Remove(temporary)
	if err := os.Rename(temporary, selector); err != nil {
		return err
	}
	return syncDirectory(enabledRoot)
}

func extractAppPackageArchive(archivePath, staging string) error {
	file, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer file.Close()
	gzipReader, err := gzip.NewReader(io.LimitReader(file, maxAppArchiveBytes+1))
	if err != nil {
		return fmt.Errorf("open App Package gzip stream: %w", err)
	}
	defer gzipReader.Close()
	tarReader := tar.NewReader(gzipReader)
	seen := make(map[string]bool)
	entries := 0
	var total int64
	for {
		header, err := tarReader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return fmt.Errorf("read App Package archive: %w", err)
		}
		entries++
		if entries > maxAppArchiveEntries {
			return fmt.Errorf("App Package archive exceeds %d entries", maxAppArchiveEntries)
		}
		name := path.Clean(header.Name)
		if name == "." && header.Typeflag == tar.TypeDir {
			continue
		}
		unsafeSegment := false
		for _, segment := range strings.Split(header.Name, "/") {
			if segment == ".." {
				unsafeSegment = true
				break
			}
		}
		if name == "." || name == "" || strings.HasPrefix(name, "/") || unsafeSegment || strings.Contains(name, "\\") {
			return fmt.Errorf("App Package archive has unsafe path %q", header.Name)
		}
		if seen[name] {
			return fmt.Errorf("App Package archive repeats path %q", name)
		}
		seen[name] = true
		target := filepath.Join(staging, filepath.FromSlash(name))
		if !pathWithin(staging, target) {
			return fmt.Errorf("App Package archive path %q escapes staging", name)
		}
		switch header.Typeflag {
		case tar.TypeDir:
			if err := ensureAppArchiveDirectory(staging, target); err != nil {
				return err
			}
		case tar.TypeReg, tar.TypeRegA:
			if header.Size < 0 || total+header.Size > maxAppArchiveBytes {
				return fmt.Errorf("App Package archive exceeds %d extracted bytes", maxAppArchiveBytes)
			}
			total += header.Size
			if err := ensureAppArchiveDirectory(staging, filepath.Dir(target)); err != nil {
				return err
			}
			mode := os.FileMode(0o644)
			if header.Mode&0o111 != 0 {
				mode = 0o755
			}
			output, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
			if err != nil {
				return err
			}
			written, copyErr := io.CopyN(output, tarReader, header.Size)
			closeErr := output.Close()
			if copyErr != nil || written != header.Size {
				return fmt.Errorf("extract App Package file %s: %w", name, copyErr)
			}
			if closeErr != nil {
				return closeErr
			}
			// OpenFile's creation mode is filtered by the process umask. The
			// content seal includes permissions, so normalize them before sealing.
			if err := os.Chmod(target, mode); err != nil {
				return err
			}
		default:
			return fmt.Errorf("App Package archive path %q has unsupported type", name)
		}
	}
	if entries == 0 {
		return errors.New("App Package archive is empty")
	}
	return syncDirectory(staging)
}

func ensureAppArchiveDirectory(staging, directory string) error {
	if directory != staging && !pathWithin(staging, directory) {
		return errors.New("App Package archive directory escapes staging")
	}
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return err
	}
	for current := directory; current != staging; current = filepath.Dir(current) {
		info, err := os.Lstat(current)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return errors.New("App Package archive directory is not a real directory")
		}
		if err := os.Chmod(current, 0o755); err != nil {
			return err
		}
	}
	return nil
}

func fileSHA256(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func validateInstallRoot(root string) error {
	info, err := os.Stat(root)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("App Package install root %s must be a directory", root)
	}
	if err := validateOwnedPath(root, info); err != nil || info.Mode().Perm()&0o022 != 0 {
		return fmt.Errorf("App Package install root %s must be owned by root or uid %d and not group/world writable", root, os.Geteuid())
	}
	return nil
}

func validateOwnedPath(path string, info fs.FileInfo) error {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || (stat.Uid != uint32(os.Geteuid()) && stat.Uid != 0) {
		return fmt.Errorf("App Package path %s must be owned by root or uid %d", path, os.Geteuid())
	}
	return nil
}

func checkAppDependencies(id string, dependencies *dependencyClassConfig) error {
	if dependencies == nil {
		return fmt.Errorf("App Package %s has no dependency declaration", id)
	}
	for _, name := range dependencies.Executables {
		if _, err := exec.LookPath(name); err != nil {
			return fmt.Errorf("App Package %s is missing executable dependency %q", id, name)
		}
	}
	if len(dependencies.PythonModules) == 0 {
		return nil
	}
	python, err := exec.LookPath("python3")
	if err != nil {
		return fmt.Errorf("App Package %s requires Python modules but python3 is unavailable", id)
	}
	for _, module := range dependencies.PythonModules {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		command := exec.CommandContext(ctx, python, "-I", "-c", "import importlib,sys;importlib.import_module(sys.argv[1])", module)
		err := command.Run()
		cancel()
		if err != nil {
			return fmt.Errorf("App Package %s cannot import Python module dependency %q", id, module)
		}
	}
	return nil
}

func canonicalDirectory(path string) (string, error) {
	if !filepath.IsAbs(path) {
		return "", errors.New("path must be absolute")
	}
	resolved, err := filepath.EvalSymlinks(filepath.Clean(path))
	if err != nil {
		return "", err
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", errors.New("path must be a directory")
	}
	return resolved, nil
}

func pathWithin(root, candidate string) bool {
	relative, err := filepath.Rel(root, candidate)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func validatePackageTree(root string) error {
	return filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if err := validateOwnedPath(path, info); err != nil {
			return err
		}
		if entry.Type()&os.ModeSymlink != 0 || (!info.Mode().IsDir() && !info.Mode().IsRegular()) {
			return fmt.Errorf("package path %s must be a regular file or directory and cannot be a symlink", path)
		}
		if info.Mode().Perm()&0o022 != 0 {
			return fmt.Errorf("package path %s must not be group/world writable", path)
		}
		return nil
	})
}

func appPackageContentDigest(root string) (string, error) {
	hash := sha256.New()
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == root {
			return nil
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		relative = filepath.ToSlash(relative)
		if relative == appPackageMetadata {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		kind := byte('f')
		if info.IsDir() {
			kind = 'd'
		}
		if _, err := fmt.Fprintf(hash, "%c\x00%s\x00%04o\x00%d\x00", kind, relative, info.Mode().Perm(), info.Size()); err != nil {
			return err
		}
		if info.Mode().IsRegular() {
			file, err := os.Open(path)
			if err != nil {
				return err
			}
			_, copyErr := io.Copy(hash, file)
			closeErr := file.Close()
			if copyErr != nil {
				return copyErr
			}
			if closeErr != nil {
				return closeErr
			}
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func readAppPackageSeal(root string) (appPackageSeal, error) {
	var seal appPackageSeal
	file, err := os.Open(filepath.Join(root, appPackageMetadata))
	if err != nil {
		return seal, fmt.Errorf("open App Package seal: %w", err)
	}
	defer file.Close()
	if info, err := file.Stat(); err != nil {
		return seal, err
	} else if info.Size() > 4<<10 {
		return seal, errors.New("App Package seal exceeds 4096 bytes")
	}
	decoder := json.NewDecoder(io.LimitReader(file, 4<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&seal); err != nil {
		return seal, fmt.Errorf("decode App Package seal: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return seal, errors.New("App Package seal must contain exactly one JSON object")
	}
	if seal.SchemaVersion != 1 || !validSHA256(seal.ContentSHA256) || (seal.ArchiveSHA256 != "" && !validSHA256(seal.ArchiveSHA256)) {
		return seal, errors.New("App Package seal has invalid schema or digest")
	}
	return seal, nil
}

func validSHA256(value string) bool {
	if len(value) != sha256.Size*2 || value != strings.ToLower(value) {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func sealAppPackageDirectory(root, archiveSHA256 string) (appPackageSeal, error) {
	var seal appPackageSeal
	if archiveSHA256 != "" && !validSHA256(archiveSHA256) {
		return seal, errors.New("archive SHA-256 must be 64 lowercase hexadecimal characters")
	}
	digest, err := appPackageContentDigest(root)
	if err != nil {
		return seal, err
	}
	seal = appPackageSeal{SchemaVersion: 1, ArchiveSHA256: archiveSHA256, ContentSHA256: digest}
	payload, err := json.MarshalIndent(seal, "", "  ")
	if err != nil {
		return seal, err
	}
	payload = append(payload, '\n')
	temporary, err := os.CreateTemp(root, ".package-seal-*.tmp")
	if err != nil {
		return seal, err
	}
	name := temporary.Name()
	defer os.Remove(name)
	if err := temporary.Chmod(0o644); err != nil {
		_ = temporary.Close()
		return seal, err
	}
	if _, err := temporary.Write(payload); err != nil {
		_ = temporary.Close()
		return seal, err
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return seal, err
	}
	if err := temporary.Close(); err != nil {
		return seal, err
	}
	if err := os.Rename(name, filepath.Join(root, appPackageMetadata)); err != nil {
		return seal, err
	}
	return seal, syncDirectory(root)
}
