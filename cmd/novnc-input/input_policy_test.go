package main

import "testing"

func TestMousepadDistroClassNamesRemainExact(t *testing.T) {
	allowed := classAllowList("Mousepad,Org.xfce.mousepad")
	for _, class := range []string{"Mousepad", "Org.xfce.mousepad", "org.xfce.mousepad"} {
		if !x11ClassAllowed(allowed, class) {
			t.Errorf("verified Mousepad identity rejected: %q", class)
		}
	}
	for _, class := range []string{"", "Authentication", "Org.xfce.mousepad.other", "prefix.Mousepad", "*"} {
		if x11ClassAllowed(allowed, class) {
			t.Errorf("unrelated identity allowed: %q", class)
		}
	}
}

func TestClassAllowListIsCaseInsensitive(t *testing.T) {
	allowed := classAllowList("xfce4-terminal, mousepad, LibreOffice-Writer")
	for _, class := range []string{"Xfce4-terminal", "Mousepad", "libreoffice-writer", " LIBREOFFICE-WRITER "} {
		if !x11ClassAllowed(allowed, class) {
			t.Errorf("class %q was not allowed after normalization", class)
		}
	}
	if x11ClassAllowed(allowed, "xmessage") {
		t.Error("unlisted class xmessage was unexpectedly allowed")
	}
}

func TestClassAllowListWildcard(t *testing.T) {
	allowed := classAllowList("*")
	for _, class := range []string{"Mousepad", "org.example.NewApplication"} {
		if !x11ClassAllowed(allowed, class) {
			t.Errorf("wildcard did not allow class %q", class)
		}
	}
	if x11ClassAllowed(allowed, "  ") {
		t.Error("wildcard allowed an empty focused class")
	}
}
