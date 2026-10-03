package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAppDependencyProbeImportsBindings(t *testing.T) {
	root := t.TempDir()
	// A found module is insufficient: an import can fail on a missing shared
	// library. This fixture accepts only the actual isolated-import invocation.
	script := `#!/bin/sh
test "$1" = '-I' && test "$2" = '-c' || exit 10
test "$3" = 'import importlib,sys;importlib.import_module(sys.argv[1])' || exit 11
if test "$4" = working; then exit 0; fi
echo 'private native binding traceback' >&2
exit 1
`
	if err := os.WriteFile(filepath.Join(root, "python3"), []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", root)
	if err := checkAppDependencies("fixture", &dependencyClassConfig{PythonModules: []string{"working"}}); err != nil {
		t.Fatal(err)
	}
	err := checkAppDependencies("fixture", &dependencyClassConfig{PythonModules: []string{"broken"}})
	if err == nil || !strings.Contains(err.Error(), `cannot import Python module dependency "broken"`) || strings.Contains(err.Error(), "traceback") {
		t.Fatalf("expected safe binding-import failure, got %v", err)
	}
}
