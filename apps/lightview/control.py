#!/usr/bin/python3
"""Bounded same-UID client for LightView's private JSON socket."""

import json
import os
import socket
import stat
import sys

MAX_REQUEST = 1024 * 1024
MAX_RESPONSE = 4 * 1024 * 1024


def validate_socket(path):
    absolute = os.path.abspath(path)
    parent = os.path.dirname(absolute)
    parent_stat = os.lstat(parent)
    socket_stat = os.lstat(absolute)
    if not stat.S_ISDIR(parent_stat.st_mode) or parent_stat.st_uid != os.getuid():
        raise ValueError("LightView socket directory has the wrong identity")
    if stat.S_IMODE(parent_stat.st_mode) & 0o077:
        raise ValueError("LightView socket directory is not private")
    if not stat.S_ISSOCK(socket_stat.st_mode) or socket_stat.st_uid != os.getuid():
        raise ValueError("LightView control path is not an owned Unix socket")
    return absolute


def request(path, command, timeout=2.0, **fields):
    path = validate_socket(path)
    payload = json.dumps({"command": command, **fields}, separators=(",", ":")).encode("utf-8") + b"\n"
    if len(payload) > MAX_REQUEST:
        raise ValueError("LightView request exceeds 1 MiB")
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(timeout)
        connection.connect(path)
        connection.sendall(payload)
        chunks = bytearray()
        while b"\n" not in chunks:
            part = connection.recv(min(65536, MAX_RESPONSE + 2 - len(chunks)))
            if not part:
                raise RuntimeError("LightView closed before completing its response")
            chunks.extend(part)
            if len(chunks) > MAX_RESPONSE + 1:
                raise RuntimeError("LightView response exceeds 4 MiB")
    line, separator, remainder = bytes(chunks).partition(b"\n")
    if not separator or remainder:
        raise RuntimeError("LightView returned an invalid response frame")
    response = json.loads(line)
    if not isinstance(response, dict) or response.get("ok") is not True or "result" not in response:
        error = response.get("error") if isinstance(response, dict) else None
        raise RuntimeError(error if isinstance(error, str) else "LightView rejected the request")
    return response["result"]


def identity_status(path, expected_pid):
    """Validate the control target independently of mutable page/memory state."""
    result = request(path, "status")
    if (not isinstance(result, dict) or type(result.get("pid")) is not int
            or result.get("pid") != expected_pid):
        raise RuntimeError("LightView control PID does not match the launched process")
    if result.get("private") is not False:
        raise RuntimeError("LightView unexpectedly launched in private mode")
    return result


def status(path, expected_pid):
    """Startup/navigation readiness; memory settings are user-owned policy."""
    return ready_status(identity_status(path, expected_pid))


def ready_status(result):
    """Validate one identity-checked status after navigation or wakeup."""
    if result.get("engine_state") != "ready":
        raise RuntimeError("LightView WebKit engine is not ready")
    generation = result.get("web_process_generation")
    if not isinstance(generation, int) or isinstance(generation, bool) or generation < 1:
        raise RuntimeError("LightView WebKit generation is invalid")
    for field in ("uri", "title"):
        if not isinstance(result.get(field), str):
            raise RuntimeError(f"LightView status field {field} is invalid")
    if not isinstance(result.get("loading"), bool):
        raise RuntimeError("LightView loading state is invalid")
    if result.get("load_error") is not None and not isinstance(result.get("load_error"), str):
        raise RuntimeError("LightView load error is invalid")
    return result


def main(argv):
    if len(argv) not in (4, 5):
        raise ValueError("usage: control.py SOCKET EXPECTED_PID status|quit|open [URL]")
    path, pid_text, command = argv[1:4]
    expected_pid = int(pid_text, 10)
    if expected_pid <= 1:
        raise ValueError("invalid LightView PID")
    if command == "quit" and len(argv) == 4:
        # Recovery or a failed page must not prevent graceful process shutdown.
        identity_status(path, expected_pid)
        result = request(path, "quit")
    elif command == "status" and len(argv) == 4:
        result = status(path, expected_pid)
    elif command == "open" and len(argv) == 5:
        before = identity_status(path, expected_pid)
        if before.get("engine_state") == "ready":
            ready_status(before)
        elif before.get("engine_state") != "suspended":
            raise RuntimeError("LightView WebKit engine is not ready for navigation")
        result = request(path, "open", timeout=5, uri=argv[4])
    else:
        raise ValueError("invalid LightView control command")
    print(json.dumps(result, separators=(",", ":"), ensure_ascii=False))


if __name__ == "__main__":
    try:
        main(sys.argv)
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as error:
        print(f"LightView control failed: {error}", file=sys.stderr)
        sys.exit(1)
