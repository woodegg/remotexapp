#!/usr/bin/python3
"""Conservatively quarantine stale Chromium singleton profile links."""

import argparse
import errno
import fcntl
import json
import os
from pathlib import Path
import socket
import stat
import sys
import time
import uuid

sys.dont_write_bytecode = True

LOCK_NAMES = ("SingletonLock", "SingletonSocket", "SingletonCookie")
MAX_QUARANTINES = 4


class UnsafeProfile(RuntimeError):
    pass


def cmdline(pid):
    try:
        data = Path(f"/proc/{pid}/cmdline").read_bytes()
    except FileNotFoundError:
        return None
    except OSError as error:
        if error.errno in (errno.ENOENT, errno.ESRCH):
            return None
        raise UnsafeProfile(f"cannot inspect profile owner PID {pid}: {error.strerror}") from error
    return [item.decode("utf-8", "surrogateescape") for item in data.split(b"\0") if item]


def uses_profile(arguments, profile):
    if arguments is None:
        return False
    expected = os.path.realpath(profile)
    for index, argument in enumerate(arguments):
        candidate = None
        if argument.startswith("--user-data-dir="):
            candidate = argument.split("=", 1)[1]
        elif argument == "--user-data-dir" and index + 1 < len(arguments):
            candidate = arguments[index + 1]
        if candidate and os.path.realpath(candidate) == expected:
            return True
    return False


def profile_users(profile):
    users = []
    uid = os.getuid()
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit() or int(entry.name) == os.getpid():
            continue
        try:
            if entry.stat().st_uid != uid:
                continue
        except FileNotFoundError:
            continue
        arguments = cmdline(int(entry.name))
        if uses_profile(arguments, profile):
            users.append(int(entry.name))
    return users


def socket_is_live(link):
    target = os.readlink(link)
    if not os.path.isabs(target):
        target = os.path.join(os.path.dirname(link), target)
    try:
        mode = os.stat(target).st_mode
    except FileNotFoundError:
        return False
    if not stat.S_ISSOCK(mode):
        raise UnsafeProfile("SingletonSocket target exists but is not a Unix socket")
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    client.settimeout(0.25)
    try:
        client.connect(target)
        return True
    except OSError as error:
        if error.errno in (errno.ENOENT, errno.ECONNREFUSED):
            return False
        raise UnsafeProfile(f"cannot prove SingletonSocket is stale: {error}") from error
    finally:
        client.close()


def validate_links(profile):
    links = [profile / name for name in LOCK_NAMES if os.path.lexists(profile / name)]
    if not links:
        return links
    for link in links:
        if not link.is_symlink():
            raise UnsafeProfile(f"{link.name} is not a symbolic link")

    users = profile_users(profile)
    if users:
        raise UnsafeProfile(f"profile is used by live local PID {users[0]}")

    socket_link = profile / "SingletonSocket"
    if socket_link in links and socket_is_live(socket_link):
        raise UnsafeProfile("profile has a reachable SingletonSocket")

    lock_link = profile / "SingletonLock"
    if lock_link in links:
        owner = os.readlink(lock_link)
        hostname, separator, pid_text = owner.rpartition("-")
        if not separator or not hostname or not pid_text.isdigit():
            raise UnsafeProfile("SingletonLock owner is malformed")
        if hostname == socket.gethostname():
            owner_arguments = cmdline(int(pid_text))
            if uses_profile(owner_arguments, profile):
                raise UnsafeProfile(f"SingletonLock is owned by live PID {pid_text}")
    return links


def prune_records(root, records, required_slots=1):
    prune_count = max(0, len(records) + required_slots - MAX_QUARANTINES)
    for record in sorted(records, key=lambda entry: entry.name)[:prune_count]:
        status = record.lstat()
        if not stat.S_ISDIR(status.st_mode) or stat.S_ISLNK(status.st_mode) or status.st_uid != os.getuid():
            raise UnsafeProfile("profile-lock quarantine contains an untrusted record")
        entries = list(record.iterdir())
        if not entries or any(
            entry.name not in LOCK_NAMES or not entry.is_symlink() for entry in entries
        ):
            raise UnsafeProfile("profile-lock quarantine contains unknown data")
        for entry in entries:
            entry.unlink()
        record.rmdir()


def quarantine(profile):
    profile = Path(profile).resolve(strict=True)
    if not profile.is_dir() or profile.stat().st_uid != os.getuid():
        raise UnsafeProfile("profile must be a directory owned by the current user")
    root = profile / ".remotexapp-lock-quarantine"
    root.mkdir(mode=0o700, exist_ok=True)
    root_status = root.lstat()
    if stat.S_ISLNK(root_status.st_mode) or not stat.S_ISDIR(root_status.st_mode) or root_status.st_uid != os.getuid():
        raise UnsafeProfile("profile-lock quarantine is not a trusted owned directory")
    os.chmod(root, 0o700)
    guard = os.open(root / ".guard", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(guard, fcntl.LOCK_EX)
        links = validate_links(profile)
        if not links:
            return {"action": "clean", "count": 0}
        # Revalidate under the Driver-owned guard immediately before mutation.
        links = validate_links(profile)
        records = [entry for entry in root.iterdir() if entry.name != ".guard"]
        prune_records(root, records)
        pending = root / f".pending-{os.getpid()}-{uuid.uuid4().hex}"
        pending.mkdir(mode=0o700)
        moved = []
        try:
            for link in links:
                destination = pending / link.name
                os.rename(link, destination)
                moved.append((link, destination))
            record = root / f"{time.time_ns()}-{os.getpid()}"
            os.rename(pending, record)
        except BaseException:
            for source, destination in reversed(moved):
                if os.path.lexists(destination) and not os.path.lexists(source):
                    os.rename(destination, source)
            try:
                pending.rmdir()
            except OSError:
                pass
            raise
        return {"action": "quarantined", "count": len(moved), "record": record.name}
    finally:
        os.close(guard)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("profile")
    arguments = parser.parse_args()
    try:
        print(json.dumps(quarantine(arguments.profile), sort_keys=True))
    except (OSError, UnsafeProfile) as error:
        print(f"Edge profile lock recovery refused: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
