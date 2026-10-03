#!/usr/bin/env python3
"""Per-session IBus engine that accepts committed UTF-8 over a private socket."""

import argparse
import json
import os
import socket
import sys
import time

import gi

gi.require_version("GLib", "2.0")
gi.require_version("IBus", "1.0")
from gi.repository import GLib, IBus


ENGINE_NAME = "remote-unicode"
MAX_TEXT_BYTES = 4096
cursor_subscribers = set()
cursor_log_path = None


def write_log(path, message):
    line = f"{GLib.get_monotonic_time() // 1000} {message}\n"
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(line)


class RemoteUnicodeEngine(IBus.Engine):
    current = None

    def __init__(self):
        super().__init__()
        self._has_remote_focus = False
        self._is_enabled = False
        self._cursor_location = None
        self._cursor_updated_ms = 0
        self._cursor_sequence = 0
        RemoteUnicodeEngine.current = self

    def do_focus_in(self):
        self._has_remote_focus = True
        self._publish_cursor()

    def do_focus_out(self):
        self._has_remote_focus = False
        self._publish_cursor()

    def do_enable(self):
        self._is_enabled = True
        self._publish_cursor()

    def do_disable(self):
        self._is_enabled = False
        self._publish_cursor()

    def do_set_cursor_location(self, x, y, width, height):
        # IBus supplies screen coordinates for the focused application's
        # insertion caret. The browser maps these display pixels into the
        # scaled noVNC canvas and anchors its local IME textarea there.
        self._cursor_location = {
            "x": int(x),
            "y": int(y),
            "width": max(1, int(width)),
            "height": max(1, int(height)),
        }
        self._cursor_updated_ms = time.monotonic_ns() // 1_000_000
        self._publish_cursor()

    def _cursor_event(self):
        return {
            "type": "cursor-position",
            "sequence": self._cursor_sequence,
            "updatedMs": self._cursor_updated_ms,
            "focused": self._has_remote_focus,
            "enabled": self._is_enabled,
            "cursor": self._cursor_location,
        }

    def _publish_cursor(self):
        self._cursor_sequence += 1
        payload = (json.dumps(self._cursor_event()) + "\n").encode("utf-8")
        stale = []
        for connection in tuple(cursor_subscribers):
            try:
                connection.sendall(payload)
            except (BrokenPipeError, ConnectionResetError, BlockingIOError, OSError):
                stale.append(connection)
        for connection in stale:
            cursor_subscribers.discard(connection)
            try:
                connection.close()
            except OSError:
                pass


def main():
    global cursor_log_path
    parser = argparse.ArgumentParser()
    parser.add_argument("--socket", required=True)
    parser.add_argument("--log", required=True)
    args = parser.parse_args()
    cursor_log_path = args.log

    if os.path.exists(args.socket):
        raise SystemExit(f"refusing to replace existing socket: {args.socket}")

    IBus.init()
    bus = IBus.Bus.new()
    if not bus.is_connected():
        raise SystemExit("cannot connect to the session IBus daemon")

    component = IBus.Component.new(
        "org.remotexapp.RemoteUnicode",
        "Private remote UTF-8 commit engine",
        "0.1",
        "MIT",
        "remotexapp",
        "https://example.invalid/remotexapp",
        sys.argv[0],
        "",
    )
    component.add_engine(
        IBus.EngineDesc.new(
            ENGINE_NAME,
            "Remote Unicode",
            "Commit already-composed UTF-8 from a private Unix socket",
            "other",
            "MIT",
            "remotexapp",
            "",
            "us",
        )
    )
    factory = IBus.Factory.new(bus.get_connection())
    factory.add_engine(ENGINE_NAME, RemoteUnicodeEngine.__gtype__)
    if not bus.register_component(component):
        raise SystemExit("cannot register IBus component")

    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(args.socket)
    os.chmod(args.socket, 0o600)
    server.listen(8)
    server.setblocking(False)
    write_log(args.log, "engine registered; socket ready")

    def commit_request(text):
        encoded = text.encode("utf-8")
        if not text or len(encoded) > MAX_TEXT_BYTES or "\x00" in text:
            return False, "invalid text"
        engine = RemoteUnicodeEngine.current
        if engine is None:
            return False, "engine is not active"
        if not engine._is_enabled:
            return False, "engine is disabled"
        if not engine._has_remote_focus:
            return False, "no focused IBus input context"
        engine.commit_text(IBus.Text.new_from_string(text))
        write_log(args.log, f"committed bytes={len(encoded)} characters={len(text)}")
        return True, ""

    def on_socket_ready(_source, _condition):
        connection = None
        try:
            connection, _ = server.accept()
            data = connection.recv(MAX_TEXT_BYTES + 1024)
            request = json.loads(data.decode("utf-8"))
            if isinstance(request, dict) and request.get("action") == "subscribe-cursor":
                engine = RemoteUnicodeEngine.current
                if engine is None:
                    connection.sendall(b'{"type":"cursor-position","sequence":0,"updatedMs":0,"focused":false,"enabled":false,"error":"engine is not active"}\n')
                    connection.close()
                else:
                    connection.sendall((json.dumps(engine._cursor_event()) + "\n").encode("utf-8"))
                    connection.setblocking(False)
                    cursor_subscribers.add(connection)
                    write_log(args.log, f"cursor subscriber connected; total={len(cursor_subscribers)}")
                return True
            with connection:
                if not isinstance(request, dict):
                    response = {"ok": False, "error": "invalid request"}
                elif request.get("action") == "cursor":
                    engine = RemoteUnicodeEngine.current
                    response = {
                        "ok": engine is not None,
                        "type": "cursor-position",
                        "sequence": engine._cursor_sequence if engine else 0,
                        "focused": bool(engine and engine._has_remote_focus),
                        "enabled": bool(engine and engine._is_enabled),
                        "cursor": engine._cursor_location if engine else None,
                        "updatedMs": engine._cursor_updated_ms if engine else 0,
                    }
                elif not isinstance(request.get("text"), str):
                    response = {"ok": False, "error": "invalid request"}
                else:
                    ok, error = commit_request(request["text"])
                    response = {"ok": ok, "error": error}
                connection.sendall((json.dumps(response) + "\n").encode("utf-8"))
        except Exception as error:
            if connection is not None and connection not in cursor_subscribers:
                try:
                    connection.close()
                except OSError:
                    pass
            write_log(args.log, f"socket error: {error}")
        return True

    GLib.io_add_watch(server.fileno(), GLib.IO_IN, on_socket_ready)
    GLib.MainLoop().run()


if __name__ == "__main__":
    main()
