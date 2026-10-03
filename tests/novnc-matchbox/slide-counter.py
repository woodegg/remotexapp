#!/usr/bin/env python3
"""A tiny always-on-top current-slide counter for the kiosk workspace."""

import os
import time

import gi
import uno

gi.require_version("Gdk", "3.0")
gi.require_version("Gtk", "3.0")
from gi.repository import Gdk, GLib, Gtk


UNO_URL = "uno:socket,host=127.0.0.1,port=2002;urp;StarOffice.ComponentContext"


def connect():
    local_context = uno.getComponentContext()
    resolver = local_context.ServiceManager.createInstanceWithContext(
        "com.sun.star.bridge.UnoUrlResolver", local_context
    )
    return resolver.resolve(UNO_URL)


class SlideCounter:
    def __init__(self):
        self.context = None
        self.document = None
        # A popup is not managed as a Matchbox dock/panel, so it stays a small
        # overlay instead of reserving an entire row across the desktop.
        self.window = Gtk.Window(type=Gtk.WindowType.POPUP)
        self.window.set_decorated(False)
        self.window.set_resizable(False)
        self.window.set_accept_focus(False)
        self.window.set_skip_taskbar_hint(True)
        self.window.set_skip_pager_hint(True)
        self.window.set_keep_above(True)
        self.window.set_type_hint(Gdk.WindowTypeHint.NOTIFICATION)
        self.window.connect("destroy", Gtk.main_quit)

        self.label = Gtk.Label(label="Slide — / —")
        self.label.set_margin_start(9)
        self.label.set_margin_end(9)
        self.label.set_margin_top(3)
        self.label.set_margin_bottom(3)
        self.window.add(self.label)

        css = Gtk.CssProvider()
        css.load_from_data(
            b"window { background: #1f2937; border-radius: 4px; }"
            b"label { color: #ffffff; font-weight: 600; font-size: 11px; }"
        )
        Gtk.StyleContext.add_provider_for_screen(
            Gdk.Screen.get_default(), css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
        )

        self.window.show_all()
        self.place_window()
        GLib.timeout_add(250, self.refresh)

    def place_window(self):
        screen = self.window.get_screen()
        self.window.move(8, max(0, screen.get_height() - 30))

    def get_document(self):
        if self.context is None:
            self.context = connect()
        desktop = self.context.ServiceManager.createInstanceWithContext(
            "com.sun.star.frame.Desktop", self.context
        )
        document = desktop.getCurrentComponent()
        if document is None or not document.supportsService(
            "com.sun.star.presentation.PresentationDocument"
        ):
            return None
        return document

    def refresh(self):
        try:
            self.document = self.get_document()
            if self.document is None:
                self.label.set_text("Slide — / —")
                return True

            pages = self.document.getDrawPages()
            current = self.document.getCurrentController().getCurrentPage()
            current_index = next(
                (
                    index + 1
                    for index in range(pages.getCount())
                    if pages.getByIndex(index) == current
                ),
                None,
            )
            if current_index is None:
                self.label.set_text(f"Slide — / {pages.getCount()}")
            else:
                self.label.set_text(f"Slide {current_index} / {pages.getCount()}")
        except Exception:
            # LibreOffice may be restarting or closing. Reconnect on the next
            # polling interval rather than leaving a stale number on screen.
            self.context = None
            self.document = None
            self.label.set_text("Slide — / —")
        return True


if __name__ == "__main__":
    SlideCounter()
    Gtk.main()
