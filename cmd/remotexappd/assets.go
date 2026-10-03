package main

import (
	"bytes"
	"embed"
	"encoding/json"
	"fmt"
	"net/http"
	"path"
	"strings"
	"time"
)

//go:embed web/assets/*
var bundledWebAssets embed.FS

type assetManifest struct {
	FormatVersion      int    `json:"formatVersion"`
	SDK                string `json:"sdk"`
	Console            string `json:"console"`
	NoVNC              string `json:"novnc"`
	NoVNCVersion       string `json:"novncVersion"`
	NoVNCCommit        string `json:"novncCommit"`
	NoVNCArchiveSHA256 string `json:"novncArchiveSha256"`
	ESBuildVersion     string `json:"esbuildVersion"`
}

var builtAssetManifest assetManifest
var builtAssetBytes map[string][]byte

func init() {
	manifestData, err := bundledWebAssets.ReadFile("web/assets/manifest.json")
	if err != nil {
		panic(fmt.Errorf("read web asset manifest: %w", err))
	}
	if err := json.Unmarshal(manifestData, &builtAssetManifest); err != nil {
		panic(fmt.Errorf("decode web asset manifest: %w", err))
	}
	if builtAssetManifest.FormatVersion != 1 {
		panic(fmt.Errorf("unsupported web asset manifest version %d", builtAssetManifest.FormatVersion))
	}
	if builtAssetManifest.NoVNCVersion == "" || len(builtAssetManifest.NoVNCCommit) != 40 || len(builtAssetManifest.NoVNCArchiveSHA256) != 64 {
		panic(fmt.Errorf("incomplete noVNC provenance in web asset manifest"))
	}
	builtAssetBytes = make(map[string][]byte, 3)
	for _, name := range []string{builtAssetManifest.SDK, builtAssetManifest.Console, builtAssetManifest.NoVNC} {
		if path.Base(name) != name || !strings.HasSuffix(name, ".js") {
			panic(fmt.Errorf("invalid bundled web asset name %q", name))
		}
		data, err := bundledWebAssets.ReadFile("web/assets/" + name)
		if err != nil {
			panic(fmt.Errorf("read bundled web asset %q: %w", name, err))
		}
		builtAssetBytes[name] = data
	}
}

func serveConsoleEntry(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		methodNotAllowed(w, "GET, HEAD")
		return
	}
	content := []byte(fmt.Sprintf("import %q;\n", "../assets/"+builtAssetManifest.Console))
	w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("ETag", `"`+strings.TrimSuffix(builtAssetManifest.Console, ".js")+`"`)
	http.ServeContent(w, r, "index.js", time.Time{}, bytes.NewReader(content))
}

func serveSDKEntry(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		methodNotAllowed(w, "GET, HEAD")
		return
	}
	content := []byte(fmt.Sprintf("export * from %q;\n", "../assets/"+builtAssetManifest.SDK))
	w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("ETag", `"`+strings.TrimSuffix(builtAssetManifest.SDK, ".js")+`"`)
	http.ServeContent(w, r, "index.js", time.Time{}, bytes.NewReader(content))
}

func serveBundledAsset(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		methodNotAllowed(w, "GET, HEAD")
		return
	}
	name := strings.TrimPrefix(r.URL.Path, "/assets/")
	content, ok := builtAssetBytes[name]
	if !ok {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("ETag", `"`+strings.TrimSuffix(name, ".js")+`"`)
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(content))
}
