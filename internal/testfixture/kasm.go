// Package testfixture contains synthetic component fixtures, never real servers.
package testfixture

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/woodegg/remotexapp/internal/kasmbundle"
)

func Kasm(t testing.TB) kasmbundle.Pin { return KasmProtocol(t, "kasm-wss-v1") }

func KasmProtocol(t testing.TB, protocol string) kasmbundle.Pin {
	t.Helper()
	root := t.TempDir()
	m := kasmbundle.Manifest{SchemaVersion: 1, Protocol: protocol, ServerCommit: kasmbundle.ServerCommit, ClientCommit: kasmbundle.ClientCommit, Binary: "bin/Xkasmvnc", Client: "web/client.js", Files: map[string]string{}}
	for _, name := range []string{m.Binary, m.Client, "LICENSE.server.txt", "LICENSE.client.txt", "SOURCE.json", "lib/libfixture.so"} {
		file := filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			t.Fatal(err)
		}
		data := []byte("synthetic test fixture: " + name)
		if err := os.WriteFile(file, data, 0700); err != nil {
			t.Fatal(err)
		}
		m.Files[name] = kasmbundle.Digest(data)
	}
	data, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "manifest.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	return kasmbundle.Pin{Directory: root, SHA256: kasmbundle.Digest(data)}
}
