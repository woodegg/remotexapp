#!/usr/bin/python3
"""Keep an attached LightView awake; restore its own idle policy on detach."""

import json
import os
import stat
import sys
import time
from urllib.parse import urlsplit

sys.dont_write_bytecode = True
import control

STATE_NAME = "viewer-hibernate-policy.json"


def private_state_path(runtime):
    directory = os.path.join(runtime, "lightview")
    info = os.lstat(directory)
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
        raise RuntimeError("LightView runtime directory is not private")
    return os.path.join(directory, STATE_NAME)


def saved_policy(path, generation):
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
        raise RuntimeError("LightView saved policy is not a private owned file")
    if info.st_size > 256:
        raise RuntimeError("LightView saved policy is oversized")
    with open(path, encoding="ascii") as source:
        data = json.load(source)
    if (not isinstance(data, dict) or type(data.get("generation")) is not int
            or type(data.get("seconds")) is not int or not 0 <= data["seconds"] <= 86400):
        raise RuntimeError("LightView saved policy is invalid")
    if data["generation"] != generation:
        os.unlink(path)
        return None
    return data["seconds"]


def save_policy(path, generation, seconds):
    temporary = path + ".tmp-" + str(os.getpid())
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="ascii") as target:
            json.dump({"generation": generation, "seconds": seconds}, target)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, path)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def hibernate_seconds(result):
    value = result.get("idle_hibernate_seconds")
    if type(value) is not int or not 0 <= value <= 86400:
        raise RuntimeError("LightView returned an invalid hibernation interval")
    return value


def restore_url(result):
    value = result.get("last_committed_uri")
    if value == "about:blank":
        return value
    if isinstance(value, str) and len(value) <= 4096 and not any(ord(char) < 32 for char in value):
        parsed = urlsplit(value)
        if parsed.scheme in ("http", "https") and parsed.hostname:
            return value
    return "about:blank"


def attach(path, socket_path, pid, generation):
    before = control.identity_status(socket_path, pid)
    current = hibernate_seconds(before)
    previous = saved_policy(path, generation)
    if previous is None:
        previous = current
        save_policy(path, generation, previous)
    try:
        if current != 0:
            control.request(socket_path, "hibernate-after", seconds=0)
        if before.get("engine_state") == "suspended":
            control.request(socket_path, "open", timeout=5, uri=restore_url(before))
        elif before.get("engine_state") != "ready":
            raise RuntimeError("LightView engine cannot accept a viewer")
        deadline = time.monotonic() + 11
        while time.monotonic() < deadline:
            latest = control.identity_status(socket_path, pid)
            if latest.get("engine_state") in ("suspended", "recovering"):
                time.sleep(0.1)
                continue
            control.ready_status(latest)
            if latest["load_error"]:
                raise RuntimeError("LightView wake navigation failed")
            if not latest["loading"]:
                return
            time.sleep(0.1)
        raise RuntimeError("LightView wake timed out")
    except (OSError, ValueError, RuntimeError):
        try:
            control.request(socket_path, "hibernate-after", seconds=previous)
            os.unlink(path)
        except (OSError, ValueError, RuntimeError):
            pass
        raise


def detach(path, socket_path, pid, generation):
    previous = saved_policy(path, generation)
    if previous is None:
        return
    current = hibernate_seconds(control.identity_status(socket_path, pid))
    # A local Agent may have changed the interval while attached. Respect it.
    if current == 0 and previous != 0:
        control.request(socket_path, "hibernate-after", seconds=previous)
    os.unlink(path)


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ("attach", "detach"):
        raise ValueError("usage: viewer-hook.py attach|detach")
    runtime = os.environ["REMOTEXAPP_RUNTIME"]
    generation = int(os.environ["REMOTEXAPP_SESSION_GENERATION"])
    if generation < 1:
        raise ValueError("invalid session generation")
    state = private_state_path(runtime)
    if sys.argv[1] == "detach" and saved_policy(state, generation) is None:
        return
    with open(os.path.join(runtime, "lightview-process.pid"), encoding="ascii") as source:
        pid = int(source.read().strip(), 10)
    if pid <= 1:
        raise ValueError("invalid LightView PID")
    socket_path = os.path.join(runtime, "lightview", "control.sock")
    if sys.argv[1] == "attach":
        attach(state, socket_path, pid, generation)
    else:
        detach(state, socket_path, pid, generation)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, KeyError, json.JSONDecodeError) as error:
        print(f"LightView viewer transition failed: {error}", file=sys.stderr)
        sys.exit(1)
