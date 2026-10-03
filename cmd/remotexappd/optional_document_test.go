package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestOptionalDocumentParameters(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(root, "文档 space.txt")
	os.WriteFile(file, []byte("original"), 0600)
	for _, name := range []string{"mousepad", "libreoffice"} {
		class, _, err := loadClassConfig(filepath.Join("..", "..", "apps", name, "manifest.json"))
		if err != nil {
			t.Fatal(err)
		}
		empty, err := resolveLaunchParameters(class.Parameters, nil, []string{root})
		if err != nil || len(empty) != 0 {
			t.Fatal(empty, err)
		}
		good, err := resolveLaunchParameters(class.Parameters, map[string]any{"filePath": file}, []string{root})
		if err != nil || good["filePath"] != file {
			t.Fatal(good, err)
		}
		for _, value := range []any{"", nil, 4, true, "relative.txt", root, filepath.Join(root, "missing"), "/outside/document"} {
			if _, err := resolveLaunchParameters(class.Parameters, map[string]any{"filePath": value}, []string{root}); err == nil {
				t.Fatal(name, value)
			}
		}
	}
}
