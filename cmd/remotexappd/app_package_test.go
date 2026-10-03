package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"testing"
	"time"
)

const syntheticAppManifest = `{
  "apiVersion": "remotexapp/v1",
  "id": "synthetic-app",
  "name": "Synthetic App",
  "driverVersion": "1.0.0",
  "singleton": false,
  "profileRef": "default",
  "runMode": "isolated",
  "ports": {
    "control": {"kind": "loopback-tcp", "port": 0}
  },
  "parameters": {
    "message": {"type": "string", "default": "hello", "maxLength": 64}
  },
  "driver": {
    "config": {"probe": "synthetic", "ready": true}
  },
  "overrides": {
    "allowed": ["geometry"]
  },
  "dependencies": {
    "executables": ["sh"],
    "pythonModules": []
  },
  "server": {
    "activation": "on-demand",
    "driver": "server.sh",
    "displayMode": "dynamic",
    "display": 0,
    "rfbPort": 0,
    "gatewayPort": 0,
    "geometry": "800x600",
    "depth": 16,
    "frameRate": 5,
    "allowClientResize": false,
    "readinessPids": ["server.pid"],
    "readinessTimeout": "3s"
  },
  "session": {
    "services": "core-v1",
    "activation": "on-attach",
    "driver": "session.sh",
    "shutdownDriver": "shutdown.sh",
    "readinessPid": "synthetic.pid",
    "readinessTimeout": "4s",
    "vacantTimeout": "5s",
    "vacantAction": "stop-instance",
    "status": {
      "mode": "driver",
      "details": {
        "application": {"type": "enum", "values": ["synthetic-app"]},
        "control": {"type": "json", "maxBytes": 8192, "maxDepth": 8, "maxItems": 128}
      }
    }
  },
  "input": {
    "backend": "ibus",
    "lifecycle": "session",
    "allowedWmClasses": ["SyntheticApp"]
  }
}`

func loadRepositoryAppPackage(t *testing.T, id string) (classConfig, time.Duration) {
	t.Helper()
	root, err := filepath.Abs(filepath.Join("..", "..", "apps", id))
	if err != nil {
		t.Fatal(err)
	}
	provideDeclaredExecutableDependencies(t, root)
	class, timeout, err := validateAppPackageContents(root)
	if err != nil {
		t.Fatal(err)
	}
	return class, timeout
}

// Repository source-package tests validate manifest structure and the complete
// dependency declaration, not the test host's desktop installation. Production
// catalog loading and preflight still resolve every executable from the real
// PATH. Provide executable shims only for the dependencies declared by the
// selected source fixture so these contract tests remain hermetic in CI.
func provideDeclaredExecutableDependencies(t *testing.T, root string) {
	t.Helper()
	payload, err := os.ReadFile(filepath.Join(root, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		Dependencies struct {
			Executables []string `json:"executables"`
		} `json:"dependencies"`
	}
	if err := json.Unmarshal(payload, &manifest); err != nil {
		t.Fatal(err)
	}
	bin := t.TempDir()
	for _, name := range manifest.Dependencies.Executables {
		if name == "" || filepath.Base(name) != name {
			t.Fatalf("unsafe executable dependency in repository fixture: %q", name)
		}
		if err := os.WriteFile(filepath.Join(bin, name), []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
}

func writeSyntheticAppPackage(t *testing.T, root string) string {
	return writeSyntheticAppPackageVersion(t, root, "1.0.0")
}

func writeSyntheticAppPackageVersion(t *testing.T, root, version string) string {
	t.Helper()
	packagePath := filepath.Join(root, "synthetic-app", version)
	if err := os.MkdirAll(packagePath, 0o755); err != nil {
		t.Fatal(err)
	}
	files := map[string]struct {
		content string
		mode    os.FileMode
	}{
		"manifest.json": {strings.Replace(syntheticAppManifest, `"driverVersion": "1.0.0"`, `"driverVersion": "`+version+`"`, 1), 0o644},
		"server.sh":     {"#!/bin/sh\nexit 0\n", 0o755},
		"session.sh":    {"#!/bin/sh\nexit 0\n", 0o755},
		"shutdown.sh":   {"#!/bin/sh\nexit 0\n", 0o755},
		"LICENSE":       {"Synthetic test package only.\n", 0o644},
	}
	for name, file := range files {
		if err := os.WriteFile(filepath.Join(packagePath, name), []byte(file.content), file.mode); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := sealAppPackageDirectory(packagePath, strings.Repeat("a", 64)); err != nil {
		t.Fatal(err)
	}
	return packagePath
}

func archiveSyntheticAppPackage(t *testing.T, source, target string) string {
	t.Helper()
	file, err := os.Create(target)
	if err != nil {
		t.Fatal(err)
	}
	gzipWriter := gzip.NewWriter(file)
	tarWriter := tar.NewWriter(gzipWriter)
	entries, err := os.ReadDir(source)
	if err != nil {
		t.Fatal(err)
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.Name() != appPackageMetadata {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	for _, name := range names {
		info, err := os.Stat(filepath.Join(source, name))
		if err != nil {
			t.Fatal(err)
		}
		header := &tar.Header{Name: name, Mode: int64(info.Mode().Perm()), Size: info.Size(), Typeflag: tar.TypeReg}
		if err := tarWriter.WriteHeader(header); err != nil {
			t.Fatal(err)
		}
		payload, err := os.ReadFile(filepath.Join(source, name))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := tarWriter.Write(payload); err != nil {
			t.Fatal(err)
		}
	}
	if err := tarWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	digest, err := fileSHA256(target)
	if err != nil {
		t.Fatal(err)
	}
	return digest
}

func writeRawAppArchive(t *testing.T, headers []tar.Header) string {
	t.Helper()
	target := filepath.Join(t.TempDir(), "malicious.tar.gz")
	file, err := os.Create(target)
	if err != nil {
		t.Fatal(err)
	}
	gzipWriter := gzip.NewWriter(file)
	tarWriter := tar.NewWriter(gzipWriter)
	for i := range headers {
		header := headers[i]
		if err := tarWriter.WriteHeader(&header); err != nil {
			t.Fatal(err)
		}
		if header.Size > 0 {
			if _, err := tarWriter.Write(make([]byte, header.Size)); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := tarWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	return target
}

func enableSyntheticAppPackage(t *testing.T, enabledRoot, packagePath string) {
	t.Helper()
	if err := os.MkdirAll(enabledRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(packagePath, filepath.Join(enabledRoot, "synthetic-app")); err != nil {
		t.Fatal(err)
	}
}

func TestLoadAppPackageCatalogPinsValidatedPackage(t *testing.T) {
	root := t.TempDir()
	packagePath := writeSyntheticAppPackage(t, root)
	enabled := filepath.Join(t.TempDir(), "enabled")
	enableSyntheticAppPackage(t, enabled, packagePath)

	classes, timeouts, err := loadAppPackageCatalog(root, enabled)
	if err != nil {
		t.Fatal(err)
	}
	class := classes["synthetic-app"]
	if len(classes) != 1 || class.APIVersion != appPackageAPIVersion || class.Package == nil || class.Package.Path != packagePath || !validSHA256(class.Package.ContentSHA256) {
		t.Fatalf("unexpected App Package catalog: %#v", classes)
	}
	if class.Server.Driver != filepath.Join(packagePath, "server.sh") || class.Session.Driver != filepath.Join(packagePath, "session.sh") {
		t.Fatalf("drivers were not pinned inside the package: %#v", class)
	}
	if timeouts[class.ID] != 5*time.Second || class.Ports["control"].Kind != "loopback-tcp" {
		t.Fatalf("package policy was not loaded: timeout=%s ports=%#v", timeouts[class.ID], class.Ports)
	}

	if err := os.WriteFile(filepath.Join(packagePath, "session.sh"), []byte("#!/bin/sh\nexit 9\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, _, err := loadAppPackageCatalog(root, enabled); err == nil || !strings.Contains(err.Error(), "digest") {
		t.Fatalf("tampered package error = %v, want digest rejection", err)
	}
}

func TestRepositorySyntheticAppPackageFixture(t *testing.T) {
	root, err := filepath.Abs(filepath.Join("..", "..", "tests", "app-package", "synthetic"))
	if err != nil {
		t.Fatal(err)
	}
	provideDeclaredExecutableDependencies(t, root)
	class, timeout, err := validateAppPackageContents(root)
	if err != nil {
		t.Fatal(err)
	}
	if class.ID != "synthetic-app" || class.APIVersion != appPackageAPIVersion || timeout != 30*time.Second || class.Session.Status.Details["control"].Type != "json" {
		t.Fatalf("synthetic fixture = %#v timeout=%s", class, timeout)
	}
}

func TestRepositoryShippedAppPackagesSatisfyGenericABI(t *testing.T) {
	root, err := filepath.Abs(filepath.Join("..", "..", "apps"))
	if err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	validated := 0
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		t.Run(entry.Name(), func(t *testing.T) {
			packageRoot := filepath.Join(root, entry.Name())
			provideDeclaredExecutableDependencies(t, packageRoot)
			class, _, err := validateAppPackageContents(packageRoot)
			if err != nil {
				t.Fatal(err)
			}
			if class.ID != entry.Name() || class.APIVersion != appPackageAPIVersion || class.Package != nil {
				t.Fatalf("invalid source package identity: %#v", class)
			}
		})
		validated++
	}
	if validated != 8 {
		t.Fatalf("validated %d shipped App Packages, want 8", validated)
	}
}

func TestAppPackageRejectsSelectorAndDriverEscapes(t *testing.T) {
	root := t.TempDir()
	outside := writeSyntheticAppPackage(t, t.TempDir())
	enabled := filepath.Join(t.TempDir(), "enabled")
	enableSyntheticAppPackage(t, enabled, outside)
	if _, _, err := loadAppPackageCatalog(root, enabled); err == nil || !strings.Contains(err.Error(), "outside") {
		t.Fatalf("selector escape error = %v", err)
	}

	root = t.TempDir()
	packagePath := writeSyntheticAppPackage(t, root)
	if err := os.Remove(filepath.Join(packagePath, "session.sh")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("/bin/true", filepath.Join(packagePath, "session.sh")); err != nil {
		t.Fatal(err)
	}
	if _, err := sealAppPackageDirectory(packagePath, strings.Repeat("b", 64)); err != nil {
		t.Fatal(err)
	}
	enabled = filepath.Join(t.TempDir(), "enabled")
	enableSyntheticAppPackage(t, enabled, packagePath)
	if _, _, err := loadAppPackageCatalog(root, enabled); err == nil || !strings.Contains(err.Error(), "cannot be a symlink") {
		t.Fatalf("driver escape error = %v", err)
	}
}

func TestAppPackageArchiveRejectsUnsafeEntries(t *testing.T) {
	tests := []struct {
		name    string
		headers []tar.Header
		want    string
	}{
		{"parent traversal", []tar.Header{{Name: "../escape", Typeflag: tar.TypeReg, Mode: 0o644}}, "unsafe path"},
		{"normalized traversal", []tar.Header{{Name: "directory/../escape", Typeflag: tar.TypeReg, Mode: 0o644}}, "unsafe path"},
		{"absolute path", []tar.Header{{Name: "/escape", Typeflag: tar.TypeReg, Mode: 0o644}}, "unsafe path"},
		{"symlink", []tar.Header{{Name: "escape", Typeflag: tar.TypeSymlink, Linkname: "/etc/passwd", Mode: 0o777}}, "unsupported type"},
		{"special file", []tar.Header{{Name: "pipe", Typeflag: tar.TypeFifo, Mode: 0o644}}, "unsupported type"},
		{"duplicate", []tar.Header{{Name: "same", Typeflag: tar.TypeReg, Mode: 0o644}, {Name: "same", Typeflag: tar.TypeReg, Mode: 0o644}}, "repeats path"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			archive := writeRawAppArchive(t, test.headers)
			if err := extractAppPackageArchive(archive, t.TempDir()); err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("archive rejection = %v, want %q", err, test.want)
			}
		})
	}
}

func TestAppArchiveExtractionNormalizesFilesAndImplicitDirectories(t *testing.T) {
	archive := writeRawAppArchive(t, []tar.Header{
		{Name: "nested/deeper/driver.sh", Typeflag: tar.TypeReg, Mode: 0o755, Size: 1},
		{Name: "nested/config.json", Typeflag: tar.TypeReg, Mode: 0o644, Size: 1},
	})
	staging := t.TempDir()
	previous := syscall.Umask(0o077)
	defer syscall.Umask(previous)
	if err := extractAppPackageArchive(archive, staging); err != nil {
		t.Fatal(err)
	}
	for name, want := range map[string]os.FileMode{
		"nested":                  0o755,
		"nested/deeper":           0o755,
		"nested/deeper/driver.sh": 0o755,
		"nested/config.json":      0o644,
	} {
		info, err := os.Stat(filepath.Join(staging, name))
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != want {
			t.Fatalf("%s permissions = %v; want %v", name, info.Mode().Perm(), want)
		}
	}
}

func TestAppPackageReinstallHasSameSealAcrossUmask(t *testing.T) {
	source := writeSyntheticAppPackage(t, t.TempDir())
	archive := filepath.Join(t.TempDir(), "synthetic-app.tar.gz")
	digest := archiveSyntheticAppPackage(t, source, archive)
	packageRoot := filepath.Join(t.TempDir(), "apps")
	enabledRoot := filepath.Join(t.TempDir(), "enabled")
	previous := syscall.Umask(0o077)
	defer syscall.Umask(previous)
	first, err := installAppPackageArchive(archive, digest, packageRoot, enabledRoot, true)
	if err != nil {
		t.Fatal(err)
	}
	syscall.Umask(0o022)
	second, err := installAppPackageArchive(archive, digest, packageRoot, enabledRoot, true)
	if err != nil || first.ContentSHA256 != second.ContentSHA256 {
		t.Fatalf("same archive changed seal across umask: first=%+v second=%+v err=%v", first, second, err)
	}
}

func TestAppPackageRejectsUnsupportedAPIAndUnknownCoreField(t *testing.T) {
	for _, test := range []struct {
		name    string
		mutate  func(string) string
		wantErr string
	}{
		{"unsupported API", func(value string) string { return strings.Replace(value, `"remotexapp/v1"`, `"remotexapp/v2"`, 1) }, "unsupported apiVersion"},
		{"unknown field", func(value string) string {
			return strings.Replace(value, `"name": "Synthetic App",`, `"name": "Synthetic App", "mystery": true,`, 1)
		}, "unknown field"},
		{"trailing JSON", func(value string) string { return value + ` {"second":true}` }, "exactly one JSON object"},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			packagePath := writeSyntheticAppPackage(t, root)
			manifestPath := filepath.Join(packagePath, "manifest.json")
			manifest, err := os.ReadFile(manifestPath)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(manifestPath, []byte(test.mutate(string(manifest))), 0o644); err != nil {
				t.Fatal(err)
			}
			if _, _, err := validateAppPackageContents(packagePath); err == nil || !strings.Contains(err.Error(), test.wantErr) {
				t.Fatalf("manifest rejection = %v, want %q", err, test.wantErr)
			}
		})
	}
}

func TestAppPackageDefaultsOptionalOpaqueDriverConfig(t *testing.T) {
	root := t.TempDir()
	packagePath := writeSyntheticAppPackage(t, root)
	manifestPath := filepath.Join(packagePath, "manifest.json")
	manifest, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := json.Unmarshal(manifest, &document); err != nil {
		t.Fatal(err)
	}
	delete(document, "driver")
	manifest, err = json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(manifestPath, manifest, 0o644); err != nil {
		t.Fatal(err)
	}
	class, _, err := validateAppPackageContents(packagePath)
	if err != nil {
		t.Fatal(err)
	}
	if class.Driver == nil || string(class.Driver.Config) != "{}" {
		t.Fatalf("optional driver config = %#v", class.Driver)
	}
}

func TestAppPackageRequiresExplicitDependencyInventories(t *testing.T) {
	root := t.TempDir()
	packagePath := writeSyntheticAppPackage(t, root)
	manifestPath := filepath.Join(packagePath, "manifest.json")
	manifest, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := json.Unmarshal(manifest, &document); err != nil {
		t.Fatal(err)
	}
	delete(document["dependencies"].(map[string]any), "pythonModules")
	manifest, err = json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(manifestPath, manifest, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, _, err := validateAppPackageContents(packagePath); err == nil || !strings.Contains(err.Error(), "dependencies must declare") {
		t.Fatalf("missing dependency inventory error = %v", err)
	}
}

func TestAppPackageRejectsWritableCatalogBoundaries(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(t *testing.T, root, enabled, packagePath string)
	}{
		{
			name: "package root",
			mutate: func(t *testing.T, root, _, _ string) {
				t.Helper()
				if err := os.Chmod(root, 0o777); err != nil {
					t.Fatal(err)
				}
			},
		},
		{
			name: "enabled root",
			mutate: func(t *testing.T, _, enabled, _ string) {
				t.Helper()
				if err := os.Chmod(enabled, 0o777); err != nil {
					t.Fatal(err)
				}
			},
		},
		{
			name: "app id directory",
			mutate: func(t *testing.T, _, _, packagePath string) {
				t.Helper()
				if err := os.Chmod(filepath.Dir(packagePath), 0o777); err != nil {
					t.Fatal(err)
				}
			},
		},
		{
			name: "version directory",
			mutate: func(t *testing.T, _, _, packagePath string) {
				t.Helper()
				if err := os.Chmod(packagePath, 0o777); err != nil {
					t.Fatal(err)
				}
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			packagePath := writeSyntheticAppPackage(t, root)
			enabled := filepath.Join(t.TempDir(), "enabled")
			enableSyntheticAppPackage(t, enabled, packagePath)
			test.mutate(t, root, enabled, packagePath)
			if _, _, err := loadAppPackageCatalog(root, enabled); err == nil || !strings.Contains(err.Error(), "writable") {
				t.Fatalf("writable boundary error = %v", err)
			}
		})
	}
}

func TestAppPackageOverridePolicyAndLaunchContract(t *testing.T) {
	root := t.TempDir()
	packagePath := writeSyntheticAppPackage(t, root)
	enabled := filepath.Join(t.TempDir(), "enabled")
	enableSyntheticAppPackage(t, enabled, packagePath)
	classes, _, err := loadAppPackageCatalog(root, enabled)
	if err != nil {
		t.Fatal(err)
	}
	class := classes["synthetic-app"]
	if _, _, _, err := applyOverrides(class, instanceOverrides{Geometry: "1024x768"}); err != nil {
		t.Fatalf("allowed geometry override failed: %v", err)
	}
	if _, _, _, err := applyOverrides(class, instanceOverrides{IdleTimeout: "10s"}); err == nil || !strings.Contains(err.Error(), "idleTimeout") {
		t.Fatalf("locked idleTimeout error = %v", err)
	}

	runtime := t.TempDir()
	resources := map[string]allocatedResource{"control": {Kind: "loopback-tcp", Address: "127.0.0.1", Port: 21001}}
	if err := writeAppLaunchContract(runtime, class, resources); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{driverConfigPath(runtime), resourcesPath(runtime)} {
		info, err := os.Stat(path)
		if err != nil || info.Mode().Perm() != 0o600 {
			t.Fatalf("launch contract %s: info=%v err=%v", path, info, err)
		}
	}
	driverConfig, err := os.ReadFile(driverConfigPath(runtime))
	if err != nil || !strings.Contains(string(driverConfig), `"probe": "synthetic"`) {
		t.Fatalf("driver config = %q err=%v", driverConfig, err)
	}
}

func TestAppPackageResourcesAllocateAndPersist(t *testing.T) {
	root := t.TempDir()
	packagePath := writeSyntheticAppPackage(t, root)
	enabled := filepath.Join(t.TempDir(), "enabled")
	enableSyntheticAppPackage(t, enabled, packagePath)
	classes, _, err := loadAppPackageCatalog(root, enabled)
	if err != nil {
		t.Fatal(err)
	}
	class := classes["synthetic-app"]
	m := &manager{cfg: config{stateDir: t.TempDir()}, instances: map[string]*instance{}}
	resources, err := m.allocateNamedResources(class.Ports)
	if err != nil {
		t.Fatal(err)
	}
	control := resources["control"]
	if control.Kind != "loopback-tcp" || control.Address != "127.0.0.1" || control.Port < 21000 || control.Port > 21999 {
		t.Fatalf("allocated resources: %#v", resources)
	}

	item := testRuntimeManifest(t, m.cfg.stateDir, "synthetic-app-1234567890ab", "")
	item.ClassID, item.TemplateID, item.DriverVersion = class.ID, class.ID, class.DriverVersion
	item.Spec, item.Resources = class, resources
	item.Components.CoreDriverDir = t.TempDir()
	if err := m.persistRuntime(item); err != nil {
		t.Fatal(err)
	}
	records, err := m.loadRuntimeManifests()
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 || records[0].Runtime.Spec.Package == nil || records[0].Runtime.Spec.Package.ContentSHA256 != class.Package.ContentSHA256 || records[0].Runtime.Resources["control"].Port != control.Port {
		t.Fatalf("reloaded package runtime: %#v", records)
	}
}

func TestAppPackageResourceAllocationRejectsCollisions(t *testing.T) {
	m := &manager{instances: map[string]*instance{
		"active": {
			ID: "active", State: "ready",
			Resources: map[string]allocatedResource{"control": {Kind: "loopback-tcp", Address: "127.0.0.1", Port: 21005}},
		},
	}}
	if _, err := m.allocateNamedResources(map[string]portClassConfig{"control": {Kind: "loopback-tcp", Port: 21005}}); err == nil || !strings.Contains(err.Error(), "already in use") {
		t.Fatalf("fixed collision error = %v", err)
	}
	resources, err := m.allocateNamedResources(map[string]portClassConfig{
		"alpha": {Kind: "loopback-tcp"},
		"beta":  {Kind: "loopback-tcp"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if resources["alpha"].Port == resources["beta"].Port || resources["alpha"].Port == 21005 || resources["beta"].Port == 21005 {
		t.Fatalf("dynamic allocation collided: %#v", resources)
	}
}

func TestAppPackageResourceAllocationSkipsTimeWaitPort(t *testing.T) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	accepted := make(chan net.Conn, 1)
	go func() {
		connection, acceptErr := listener.Accept()
		if acceptErr == nil {
			accepted <- connection
		}
	}()
	client, err := net.Dial("tcp4", listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	server := <-accepted
	if err := server.Close(); err != nil {
		t.Fatal(err)
	}
	buffer := make([]byte, 1)
	_, _ = client.Read(buffer)
	_ = client.Close()
	_ = listener.Close()
	if !portBusy(port) {
		t.Skip("kernel immediately permits a plain bind after close; no TIME_WAIT exclusion to assert")
	}
	m := &manager{instances: map[string]*instance{}}
	resources, err := m.allocateNamedResources(map[string]portClassConfig{"control": {Kind: "loopback-tcp", Port: port}})
	if err == nil || resources != nil || !strings.Contains(err.Error(), "already in use") {
		t.Fatalf("TIME_WAIT allocation result=%#v error=%v", resources, err)
	}
}

func TestRuntimeGatewayRestartAllowsTimeWaitPort(t *testing.T) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	accepted := make(chan net.Conn, 1)
	go func() {
		connection, acceptErr := listener.Accept()
		if acceptErr == nil {
			accepted <- connection
		}
	}()
	client, err := net.Dial("tcp4", listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	server := <-accepted
	if err := server.Close(); err != nil {
		t.Fatal(err)
	}
	buffer := make([]byte, 1)
	_, _ = client.Read(buffer)
	_ = client.Close()
	_ = listener.Close()
	if !portBusy(port) {
		t.Skip("kernel immediately permits a plain bind after close; no TIME_WAIT restart to assert")
	}
	if loopbackListenerActive(port) {
		t.Fatal("closed gateway port was reported as an active listener")
	}
	rfbListener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	rfbPort := rfbListener.Addr().(*net.TCPAddr).Port
	_ = rfbListener.Close()
	m := &manager{instances: map[string]*instance{}}
	if m.runtimeBusy(54321, rfbPort, port) {
		t.Fatal("TIME_WAIT gateway connection blocked an otherwise free runtime")
	}
}

func TestBoundedJSONStatusDetail(t *testing.T) {
	definition := parameterDefinition{Type: "json", MaxBytes: 128, MaxDepth: 3, MaxItems: 4}
	valid := map[string]any{"protocol": "synthetic-json-line-v1", "port": float64(21001)}
	if _, err := validateParameterValue("control", definition, valid); err != nil {
		t.Fatal(err)
	}
	if _, err := validateParameterValue("control", definition, map[string]any{"a": []any{map[string]any{"too": "deep"}}}); err == nil || !strings.Contains(err.Error(), "depth") {
		t.Fatalf("deep JSON error = %v", err)
	}
	if _, err := validateParameterValue("control", definition, []any{1, 2, 3, 4, 5}); err == nil || !strings.Contains(err.Error(), "items") {
		t.Fatalf("large collection error = %v", err)
	}
}

func TestApplicationStatusReaderRejectsTrailingAndOversizedJSON(t *testing.T) {
	for name, payload := range map[string][]byte{
		"trailing":  []byte(`{"generation":1,"revision":1,"state":"ready","updatedAt":"2026-08-29T00:00:00Z"} {}`),
		"oversized": append([]byte(`{"generation":1,"revision":1,"state":"ready","updatedAt":"2026-08-29T00:00:00Z","summary":"`), append(bytes.Repeat([]byte("x"), 64<<10), []byte(`"}`)...)...),
	} {
		t.Run(name, func(t *testing.T) {
			runtime := t.TempDir()
			if err := os.WriteFile(statusPath(runtime), payload, 0o600); err != nil {
				t.Fatal(err)
			}
			if _, err := readApplicationStatus(runtime); err == nil {
				t.Fatalf("%s status was accepted", name)
			}
		})
	}
}

func TestPublicAppPackageInstanceRefreshesStatusAndAlwaysExposesResources(t *testing.T) {
	class, _ := loadRepositoryAppPackage(t, "mousepad")
	runtime := t.TempDir()
	status := applicationStatus{
		Generation: 3, Revision: 2, State: "ready", UpdatedAt: time.Now(),
		Details: map[string]any{"application": "mousepad"},
	}
	payload, err := json.Marshal(status)
	if err != nil {
		t.Fatal(err)
	}
	if err := writePrivateAtomic(statusPath(runtime), payload); err != nil {
		t.Fatal(err)
	}
	item := &instance{ID: "mousepad-test", Runtime: runtime, Spec: class, SessionGeneration: 3}
	public := (&manager{}).publicInstance(item)
	if public.ApplicationStatus == nil || public.ApplicationStatus.State != "ready" || public.ApplicationStatus.Revision != 2 {
		t.Fatalf("public status was not refreshed: %#v", public.ApplicationStatus)
	}
	if public.Resources == nil || len(public.Resources) != 0 {
		t.Fatalf("no-port App must expose an empty resources object: %#v", public.Resources)
	}
	encoded, err := json.Marshal(public)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(encoded), `"resources":{}`) {
		t.Fatalf("public instance omitted resources: %s", encoded)
	}
}

func TestAppPackageReportsExactMissingDependency(t *testing.T) {
	root := t.TempDir()
	packagePath := writeSyntheticAppPackage(t, root)
	manifestPath := filepath.Join(packagePath, "manifest.json")
	manifest, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	manifest = []byte(strings.Replace(string(manifest), `"executables": ["sh"]`, `"executables": ["remotexapp-definitely-missing"]`, 1))
	if err := os.WriteFile(manifestPath, manifest, 0o644); err != nil {
		t.Fatal(err)
	}
	_, _, err = validateAppPackageContents(packagePath)
	if err == nil || !strings.Contains(err.Error(), "synthetic-app") || !strings.Contains(err.Error(), `executable dependency "remotexapp-definitely-missing"`) {
		t.Fatalf("missing dependency error = %v", err)
	}
}

func TestInstallUpdateAndRollbackAppPackageWithoutCoreRebuild(t *testing.T) {
	sources := t.TempDir()
	v1 := writeSyntheticAppPackageVersion(t, sources, "1.0.0")
	v2 := writeSyntheticAppPackageVersion(t, sources, "1.1.0")
	archives := t.TempDir()
	v1Archive := filepath.Join(archives, "synthetic-app-1.0.0.tar.gz")
	v2Archive := filepath.Join(archives, "synthetic-app-1.1.0.tar.gz")
	v1Digest := archiveSyntheticAppPackage(t, v1, v1Archive)
	v2Digest := archiveSyntheticAppPackage(t, v2, v2Archive)
	packageRoot := filepath.Join(t.TempDir(), "apps")
	enabledRoot := filepath.Join(t.TempDir(), "enabled")

	ref1, err := installAppPackageArchive(v1Archive, v1Digest, packageRoot, enabledRoot, true)
	if err != nil {
		t.Fatal(err)
	}
	classes, _, err := loadAppPackageCatalog(packageRoot, enabledRoot)
	if err != nil || classes["synthetic-app"].DriverVersion != "1.0.0" {
		t.Fatalf("installed V1 catalog=%#v err=%v", classes, err)
	}
	ref2, err := installAppPackageArchive(v2Archive, v2Digest, packageRoot, enabledRoot, true)
	if err != nil {
		t.Fatal(err)
	}
	classes, _, err = loadAppPackageCatalog(packageRoot, enabledRoot)
	if err != nil || classes["synthetic-app"].DriverVersion != "1.1.0" {
		t.Fatalf("updated V2 catalog=%#v err=%v", classes, err)
	}
	if err := activateAppPackage(ref1, packageRoot, enabledRoot); err != nil {
		t.Fatal(err)
	}
	classes, _, err = loadAppPackageCatalog(packageRoot, enabledRoot)
	if err != nil || classes["synthetic-app"].DriverVersion != "1.0.0" {
		t.Fatalf("rolled back catalog=%#v err=%v", classes, err)
	}
	if ref1.ContentSHA256 == ref2.ContentSHA256 || ref1.ArchiveSHA256 != v1Digest || ref2.ArchiveSHA256 != v2Digest {
		t.Fatalf("package references were not content-pinned: v1=%#v v2=%#v", ref1, ref2)
	}
	repeated, err := installAppPackageArchive(v1Archive, v1Digest, packageRoot, enabledRoot, true)
	if err != nil || repeated.ContentSHA256 != ref1.ContentSHA256 || repeated.ArchiveSHA256 != ref1.ArchiveSHA256 {
		t.Fatalf("idempotent package install reference=%#v err=%v", repeated, err)
	}
	changedV1 := writeSyntheticAppPackageVersion(t, t.TempDir(), "1.0.0")
	if err := os.WriteFile(filepath.Join(changedV1, "changed.txt"), []byte("different\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	changedArchive := filepath.Join(archives, "synthetic-app-1.0.0-changed.tar.gz")
	changedDigest := archiveSyntheticAppPackage(t, changedV1, changedArchive)
	if _, err := installAppPackageArchive(changedArchive, changedDigest, packageRoot, enabledRoot, true); err == nil || !strings.Contains(err.Error(), "already exists with different content") {
		t.Fatalf("version reuse error = %v", err)
	}
	if _, err := installAppPackageArchive(v1Archive, strings.Repeat("0", 64), packageRoot, enabledRoot, true); err == nil || !strings.Contains(err.Error(), "mismatch") {
		t.Fatalf("checksum mismatch error = %v", err)
	}
	if err := disableAppPackage("synthetic-app", packageRoot, enabledRoot); err != nil {
		t.Fatal(err)
	}
	classes, _, err = loadAppPackageCatalog(packageRoot, enabledRoot)
	if err != nil || len(classes) != 0 {
		t.Fatalf("disabled catalog=%#v err=%v", classes, err)
	}
	activated, err := activateInstalledAppPackage("synthetic-app", "1.1.0", packageRoot, enabledRoot)
	if err != nil || activated.ContentSHA256 != ref2.ContentSHA256 {
		t.Fatalf("reactivated reference=%#v err=%v", activated, err)
	}
	classes, _, err = loadAppPackageCatalog(packageRoot, enabledRoot)
	if err != nil || classes["synthetic-app"].DriverVersion != "1.1.0" {
		t.Fatalf("reactivated catalog=%#v err=%v", classes, err)
	}
}

func TestRetireAppPackageRequiresZeroDurableReferences(t *testing.T) {
	packageRoot := t.TempDir()
	packagePath := writeSyntheticAppPackage(t, packageRoot)
	enabledRoot := filepath.Join(t.TempDir(), "enabled")
	enableSyntheticAppPackage(t, enabledRoot, packagePath)
	stateDir := t.TempDir()
	runtimeDir := filepath.Join(stateDir, "runtime-manifests")
	if err := os.Mkdir(runtimeDir, 0o700); err != nil {
		t.Fatal(err)
	}
	runtimeRecord := `{
  "runtime":{"id":"synthetic-app-001122334455","classId":"synthetic-app","templateId":"synthetic-app"},
  "resolvedSpec":{"id":"synthetic-app"},
  "appPackage":{"id":"synthetic-app"}
}`
	runtimePath := filepath.Join(runtimeDir, "synthetic-app-001122334455.json")
	if err := os.WriteFile(runtimePath, []byte(runtimeRecord), 0o600); err != nil {
		t.Fatal(err)
	}

	err := retireAppPackage("synthetic-app", packageRoot, enabledRoot, stateDir)
	if err == nil || !strings.Contains(err.Error(), "runtime-manifests/synthetic-app-001122334455.json") {
		t.Fatalf("runtime reference retirement error = %v", err)
	}
	if _, err := os.Lstat(filepath.Join(enabledRoot, "synthetic-app")); err != nil {
		t.Fatalf("blocked retirement changed selector: %v", err)
	}

	if err := os.Remove(runtimePath); err != nil {
		t.Fatal(err)
	}
	managedDir := filepath.Join(stateDir, "managed-instances")
	if err := os.Mkdir(managedDir, 0o700); err != nil {
		t.Fatal(err)
	}
	managedPath := filepath.Join(managedDir, "reserved-app.json")
	if err := os.WriteFile(managedPath, []byte(`{"id":"reserved-app","templateId":"synthetic-app"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	err = retireAppPackage("synthetic-app", packageRoot, enabledRoot, stateDir)
	if err == nil || !strings.Contains(err.Error(), "managed-instances/reserved-app.json") {
		t.Fatalf("managed reference retirement error = %v", err)
	}
	if _, err := os.Lstat(filepath.Join(enabledRoot, "synthetic-app")); err != nil {
		t.Fatalf("blocked managed retirement changed selector: %v", err)
	}
}

func TestRetireAppPackagePreservesUnrelatedSelectors(t *testing.T) {
	packageRoot := t.TempDir()
	packagePath := writeSyntheticAppPackage(t, packageRoot)
	enabledRoot := filepath.Join(t.TempDir(), "enabled")
	enableSyntheticAppPackage(t, enabledRoot, packagePath)
	unrelated := filepath.Join(enabledRoot, "independent-app")
	if err := os.Symlink(packagePath, unrelated); err != nil {
		t.Fatal(err)
	}
	stateDir := t.TempDir()
	managedDir := filepath.Join(stateDir, "managed-instances")
	if err := os.Mkdir(managedDir, 0o700); err != nil {
		t.Fatal(err)
	}
	// An application-owned detail may reuse a display label. Only template,
	// class, applied-spec, and package identities are retirement references.
	unrelatedRecord := `{"id":"desktop","templateId":"other-template","runtime":{"classId":"other-template","templateId":"other-template"},"appliedSpec":{"id":"other-template"},"applicationStatus":{"details":{"application":"synthetic-app"}}}`
	if err := os.WriteFile(filepath.Join(managedDir, "desktop.json"), []byte(unrelatedRecord), 0o600); err != nil {
		t.Fatal(err)
	}

	if err := retireAppPackage("synthetic-app", packageRoot, enabledRoot, stateDir); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(filepath.Join(enabledRoot, "synthetic-app")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("retired selector still exists: %v", err)
	}
	if _, err := os.Lstat(unrelated); err != nil {
		t.Fatalf("retirement removed unrelated selector: %v", err)
	}
}

func TestRetireAppPackageFailsClosedOnInvalidState(t *testing.T) {
	packageRoot := t.TempDir()
	packagePath := writeSyntheticAppPackage(t, packageRoot)
	enabledRoot := filepath.Join(t.TempDir(), "enabled")
	enableSyntheticAppPackage(t, enabledRoot, packagePath)
	stateDir := t.TempDir()
	runtimeDir := filepath.Join(stateDir, "runtime-manifests")
	if err := os.Mkdir(runtimeDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(runtimeDir, "broken.json"), []byte("not-json\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := retireAppPackage("synthetic-app", packageRoot, enabledRoot, stateDir); err == nil || !strings.Contains(err.Error(), "inspect App Package retirement reference") {
		t.Fatalf("invalid state retirement error = %v", err)
	}
	if _, err := os.Lstat(filepath.Join(enabledRoot, "synthetic-app")); err != nil {
		t.Fatalf("failed retirement changed selector: %v", err)
	}
}

func TestFailedAppPackageActivationKeepsPreviousSelector(t *testing.T) {
	root := t.TempDir()
	v1 := writeSyntheticAppPackageVersion(t, root, "1.0.0")
	v2 := writeSyntheticAppPackageVersion(t, root, "1.1.0")
	enabled := filepath.Join(t.TempDir(), "enabled")
	enableSyntheticAppPackage(t, enabled, v1)
	if err := os.WriteFile(filepath.Join(v2, "session.sh"), []byte("#!/bin/sh\nexit 9\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := activateInstalledAppPackage("synthetic-app", "1.1.0", root, enabled); err == nil || !strings.Contains(err.Error(), "digest") {
		t.Fatalf("failed activation error = %v", err)
	}
	resolved, err := filepath.EvalSymlinks(filepath.Join(enabled, "synthetic-app"))
	if err != nil {
		t.Fatal(err)
	}
	if resolved != v1 {
		t.Fatalf("failed activation changed selector to %s, want %s", resolved, v1)
	}
}
