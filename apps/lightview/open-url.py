#!/usr/bin/python3
"""Bounded package-owned openUrl action for LightView's existing view."""

import json
import os
import signal
import sys
import time
from urllib.parse import urlsplit

sys.dont_write_bytecode = True
import control


def terminate(_signal, _frame):
    raise SystemExit(1)


signal.signal(signal.SIGTERM, terminate)


def valid_url(value):
    if not isinstance(value, str) or len(value) > 2048 or any(ord(char) < 32 for char in value):
        return False
    parsed = urlsplit(value)
    return parsed.scheme in ("http", "https") and bool(parsed.hostname)


def inputs():
    raw = sys.stdin.buffer.read(65537)
    if len(raw) > 65536:
        raise ValueError("action input is too large")
    data = json.loads(raw)
    url = data["parameters"]["url"]
    if not valid_url(url):
        raise ValueError("invalid URL")
    descriptor = data["connections"]["application"]
    expected_socket = os.path.join(os.environ["REMOTEXAPP_RUNTIME"], "lightview", "control.sock")
    if descriptor != {"protocol": "lightview-json-v1", "transport": "unix", "socketPath": expected_socket}:
        raise ValueError("invalid LightView connection descriptor")
    with open(os.path.join(os.environ["REMOTEXAPP_RUNTIME"], "lightview-process.pid"), encoding="ascii") as source:
        pid = int(source.read().strip(), 10)
    return url, expected_socket, pid


def main():
    url, path, pid = inputs()
    before = control.identity_status(path, pid)
    if before.get("engine_state") == "ready":
        control.ready_status(before)
    elif before.get("engine_state") != "suspended":
        raise RuntimeError("LightView WebKit engine is not ready for navigation")
    # The native open command wakes a hibernated WebKit worker. Keep the
    # complete action inside the Manager's 15-second deadline.
    deadline = time.monotonic() + 12
    control.request(path, "open", timeout=5, uri=url)
    latest = None
    while time.monotonic() < deadline:
        latest = control.identity_status(path, pid)
        if latest.get("engine_state") in ("suspended", "recovering"):
            time.sleep(0.1)
            continue
        latest = control.ready_status(latest)
        if latest["load_error"]:
            raise RuntimeError("LightView navigation failed")
        if not latest["loading"]:
            current = latest["uri"]
            if not valid_url(current):
                raise RuntimeError("LightView returned an invalid current URI")
            print(json.dumps({"requestedUrl": url, "currentUri": current, "title": latest["title"]},
                             separators=(",", ":"), ensure_ascii=False))
            return
        time.sleep(0.1)
    raise RuntimeError("LightView navigation timed out")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, KeyError, json.JSONDecodeError):
        sys.exit(1)
