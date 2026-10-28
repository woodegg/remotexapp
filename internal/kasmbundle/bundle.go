// Package kasmbundle validates a separately installed, immutable Kasm pair.
// Runtime records pin the manifest digest, never a moving package selector.
package kasmbundle

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

const ServerCommit = "17265facc40ab50db5740cdf0d12c61173edafc9"
const ClientCommit = "475ecfa5356579ef222983c7ce4619a7576a3bce"

type Pin struct {
	Directory string `json:"directory"`
	SHA256    string `json:"sha256"`
}

type Manifest struct {
	SchemaVersion int               `json:"schemaVersion"`
	Protocol      string            `json:"protocol"`
	ServerCommit  string            `json:"serverCommit"`
	ClientCommit  string            `json:"clientCommit"`
	Binary        string            `json:"binary"`
	Client        string            `json:"client"`
	Files         map[string]string `json:"files"`
}

type Bundle struct {
	Pin      Pin
	Manifest Manifest
}

func Digest(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func ValidDigest(value string) bool {
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == sha256.Size && value == strings.ToLower(value)
}

// checkedPath rejects symlinks at every component, including the bundle root.
// Bundles are administrator-selected local files, not tenant upload locations.
func checkedPath(root, name string) (string, error) {
	if !filepath.IsAbs(root) || filepath.Clean(root) != root || root == "/" {
		return "", errors.New("bundle directory must be an absolute canonical path")
	}
	if name == "" || filepath.IsAbs(name) || filepath.Clean(name) != name || name == "." || name == ".." || strings.HasPrefix(name, "../") || strings.ContainsAny(name, "\\\x00\r\n") {
		return "", errors.New("invalid bundle member path")
	}
	target := filepath.Join(root, name)
	current := string(filepath.Separator)
	for _, part := range strings.Split(strings.TrimPrefix(target, "/"), "/") {
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if err != nil {
			return "", err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return "", errors.New("bundle paths cannot contain symlinks")
		}
		if current == target {
			if !info.Mode().IsRegular() || info.Mode().Perm()&0022 != 0 {
				return "", errors.New("bundle members must be regular files without group/world write access")
			}
		} else if !info.IsDir() {
			return "", errors.New("invalid bundle directory")
		} else if (current == root || strings.HasPrefix(current, root+"/")) && info.Mode().Perm()&0022 != 0 {
			return "", errors.New("bundle directories cannot be group/world writable")
		}
	}
	return target, nil
}

func Load(root, expected string) (*Bundle, error) {
	if expected != "" && !ValidDigest(expected) {
		return nil, errors.New("invalid pinned bundle digest")
	}
	manifestPath, err := checkedPath(root, "manifest.json")
	if err != nil {
		return nil, fmt.Errorf("Kasm manifest: %w", err)
	}
	f, err := os.Open(manifestPath)
	if err != nil {
		return nil, err
	}
	data, readErr := io.ReadAll(io.LimitReader(f, (1<<20)+1))
	f.Close()
	if readErr != nil || len(data) > 1<<20 {
		return nil, errors.New("Kasm manifest is unreadable or too large")
	}
	digest := Digest(data)
	if expected != "" && digest != expected {
		return nil, errors.New("Kasm manifest differs from pinned digest")
	}
	var manifest Manifest
	d := json.NewDecoder(strings.NewReader(string(data)))
	d.DisallowUnknownFields()
	if err := d.Decode(&manifest); err != nil {
		return nil, fmt.Errorf("Kasm manifest: %w", err)
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		return nil, errors.New("Kasm manifest has trailing data")
	}
	if manifest.SchemaVersion != 1 || manifest.Protocol != "kasm-wss-v1" || manifest.ServerCommit != ServerCommit || manifest.ClientCommit != ClientCommit {
		return nil, errors.New("unsupported Kasm server/client contract")
	}
	if manifest.Binary != "bin/Xkasmvnc" || manifest.Client != "web/client.js" || len(manifest.Files) < 5 || len(manifest.Files) > 4096 {
		return nil, errors.New("invalid Kasm bundle layout")
	}
	for _, required := range []string{manifest.Binary, manifest.Client, "LICENSE.server.txt", "LICENSE.client.txt", "SOURCE.json"} {
		if !ValidDigest(manifest.Files[required]) {
			return nil, fmt.Errorf("missing Kasm bundle member: %s", required)
		}
	}
	for name, want := range manifest.Files {
		if !ValidDigest(want) || name == "manifest.json" {
			return nil, errors.New("invalid Kasm member digest")
		}
		path, err := checkedPath(root, name)
		if err != nil {
			return nil, fmt.Errorf("Kasm member %s: %w", name, err)
		}
		file, err := os.Open(path)
		if err != nil {
			return nil, err
		}
		h := sha256.New()
		_, copyErr := io.Copy(h, file)
		file.Close()
		if copyErr != nil || hex.EncodeToString(h.Sum(nil)) != want {
			return nil, fmt.Errorf("Kasm member digest mismatch: %s", name)
		}
	}
	// In particular LD_LIBRARY_PATH must not load an unpinned extra library.
	if err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		name, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		if name != "manifest.json" && manifest.Files[name] == "" {
			return fmt.Errorf("unlisted Kasm bundle member: %s", name)
		}
		return nil
	}); err != nil {
		return nil, err
	}
	info, err := os.Stat(filepath.Join(root, manifest.Binary))
	if err != nil || info.Mode().Perm()&0111 == 0 {
		return nil, errors.New("Kasm server is not executable")
	}
	return &Bundle{Pin: Pin{Directory: root, SHA256: digest}, Manifest: manifest}, nil
}
