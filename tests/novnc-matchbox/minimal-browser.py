#!/usr/bin/env python3
"""A browser window containing only an address field and web content."""

import os
import re
import sys

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gdk, Gtk, WebKit2


def normalise_address(value):
    value = value.strip()
    if not value:
        return "about:blank"
    if re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", value):
        return value
    return "https://" + value


class MinimalBrowser:
    def __init__(self):
        self.window = Gtk.Window()
        self.window.set_decorated(False)
        self.window.set_default_size(1280, 720)
        self.window.connect("destroy", Gtk.main_quit)
        self.window.connect("key-press-event", self.on_key_press)

        container = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=0)
        self.window.add(container)

        self.address = Gtk.Entry()
        self.address.set_placeholder_text("Enter address")
        self.address.set_margin_start(8)
        self.address.set_margin_end(8)
        self.address.set_margin_top(7)
        self.address.set_margin_bottom(7)
        self.address.connect("activate", self.navigate)
        container.pack_start(self.address, False, False, 0)

        self.web_view = WebKit2.WebView()
        self.web_view.connect("notify::uri", self.on_uri_change)
        container.pack_start(self.web_view, True, True, 0)

        self.window.show_all()
        self.window.maximize()
        self.address.grab_focus()
        self.web_view.load_uri(normalise_address(os.environ.get("BROWSER_START_URL", "about:blank")))

    def on_key_press(self, _widget, event):
        if event.keyval == Gdk.KEY_F6 or (event.state & Gdk.ModifierType.CONTROL_MASK and event.keyval in (Gdk.KEY_l, Gdk.KEY_L)):
            self.address.grab_focus()
            self.address.select_region(0, -1)
            return True
        return False

    def navigate(self, _entry):
        self.web_view.load_uri(normalise_address(self.address.get_text()))

    def on_uri_change(self, view, _parameter):
        uri = view.get_uri()
        if uri:
            self.address.set_text(uri)


if __name__ == "__main__":
    MinimalBrowser()
    Gtk.main()
