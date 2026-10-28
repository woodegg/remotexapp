package kasmbundle_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/woodegg/remotexapp/internal/kasmbundle"
	"github.com/woodegg/remotexapp/internal/testfixture"
)

func TestBundlePinsAndTampering(t *testing.T) {
	for _, fault := range []string{"none", "manifest", "client", "library", "missing", "unlisted", "writable", "symlink", "traversal", "unknown-contract", "extra-json"} {
		t.Run(fault, func(t *testing.T) {
			p := testfixture.Kasm(t)
			manifest := filepath.Join(p.Directory, "manifest.json")
			client := filepath.Join(p.Directory, "web/client.js")
			var err error
			switch fault {
			case "manifest":
				p.SHA256 = strings.Repeat("0", 64)
			case "client":
				err = os.WriteFile(client, []byte("replaced"), 0600)
			case "library":
				err = os.WriteFile(filepath.Join(p.Directory, "lib/libfixture.so"), []byte("replaced"), 0600)
			case "missing":
				err = os.Remove(client)
			case "unlisted":
				err = os.WriteFile(filepath.Join(p.Directory, "lib/extra.so"), []byte("extra"), 0600)
			case "writable":
				err = os.Chmod(filepath.Join(p.Directory, "web"), 0777)
			case "symlink":
				err = os.Rename(client, filepath.Join(p.Directory, "client-copy"))
				if err == nil {
					err = os.Symlink("../client-copy", client)
				}
			case "traversal", "unknown-contract", "extra-json":
				b, e := os.ReadFile(manifest)
				if e != nil {
					t.Fatal(e)
				}
				s := string(b)
				if fault == "traversal" {
					s = strings.ReplaceAll(s, "lib/libfixture.so", "../libfixture.so")
				}
				if fault == "unknown-contract" {
					s = strings.ReplaceAll(s, "kasm-wss-v1", "kasm-unknown")
				}
				if fault == "extra-json" {
					s += "{}"
				}
				err = os.WriteFile(manifest, []byte(s), 0600)
				p.SHA256 = kasmbundle.Digest([]byte(s))
			}
			if err != nil {
				t.Fatal(err)
			}
			bundle, err := kasmbundle.Load(p.Directory, p.SHA256)
			if fault == "none" {
				if err != nil || bundle.Pin != p {
					t.Fatalf("valid pair rejected: %v", err)
				}
			} else if err == nil {
				t.Fatal("tampered pair accepted")
			}
		})
	}
}
