#!/usr/bin/env python3
"""Read-only Ubuntu deployment checks; never provisions packages or services."""

import argparse
import glob
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parent.parent
CORE_PACKAGES = "bash coreutils dbus dbus-user-session gir1.2-ibus-1.0 ibus libc-bin libpam-systemd libx11-6 libxtst6 libxdo3 python3 python3-gi systemd systemd-sysv tigervnc-standalone-server util-linux xauth xdotool"
APP_PACKAGES = {
    "edge": "jq matchbox-window-manager microsoft-edge-stable",
    "firefox-esr": "jq matchbox-window-manager firefox-esr ibus-gtk3",
    "kate": "jq matchbox-window-manager kate libglib2.0-bin",
    "kwrite": "jq matchbox-window-manager kwrite libglib2.0-bin",
    # LightView itself is externally provisioned; this list contains only its
    # Ubuntu-supplied companions. Capability checks still require the exact
    # manifest executable before activation.
    "lightview": "jq matchbox-window-manager ibus-gtk3 gstreamer1.0-plugins-bad gstreamer1.0-libav",
    "libreoffice": "jq matchbox-window-manager libreoffice libreoffice-gtk3 python3-uno psmisc findutils ibus-gtk3",
    "mousepad": "jq matchbox-window-manager mousepad ibus-gtk3",
    "xfce-user-desktop": "xfce4 xfce4-clipman x11-utils procps ibus-gtk3",
}
GTK3_COMMANDS = {"firefox-esr", "libreoffice", "lightview", "mousepad", "startxfce4"}
CORE_COMMANDS = "systemctl systemd-run Xtigervnc xauth dbus-daemon dbus-send ibus ibus-daemon python3 xdotool"
GI_PROBE = 'import gi; gi.require_version("IBus", "1.0"); from gi.repository import GLib, IBus'
PIDFD_PROBE = '''import os, signal, subprocess, sys
p = subprocess.Popen([sys.executable, "-I", "-c", "import sys; sys.stdin.buffer.read()"], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
fd = None
try:
    fd = os.pidfd_open(p.pid)
    signal.pidfd_send_signal(fd, 0)
    signal.pidfd_send_signal(fd, signal.SIGTERM)
    p.wait(timeout=2)
    assert p.returncode == -signal.SIGTERM
finally:
    if fd is not None: os.close(fd)
    if p.poll() is None: p.kill()
    p.wait(timeout=2)
    p.stdin.close()
'''


def run_probe(args, env=None):
    """Never include subprocess output (which may contain host secrets) in results."""
    try:
        return subprocess.run(args, env=env, stdin=subprocess.DEVNULL,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                              timeout=5, check=False).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def python_probe(code, *args):
    return run_probe([sys.executable, "-I", "-c", code, *args])


def load_manifests(apps, enabled_root=None):
    if enabled_root:
        paths = [p / "manifest.json" for p in sorted(Path(enabled_root).iterdir())
                 if not p.name.startswith(".")]
    else:
        ids = sorted(APP_PACKAGES) if apps == "all" else ([] if apps == "core" else apps.split(","))
        if not ids and apps != "core":
            raise ValueError("select all, core, or comma-separated shipped App IDs")
        if any(app not in APP_PACKAGES for app in ids):
            raise ValueError("unknown shipped App; use --enabled-root for a custom catalog")
        paths = [ROOT / "apps" / app / "manifest.json" for app in ids]
    manifests = [json.loads(p.read_text()) for p in paths]
    for manifest in manifests:
        if not isinstance(manifest.get("id"), str) or not isinstance(manifest.get("dependencies"), dict):
            raise ValueError("manifest must declare id and dependencies")
    return manifests


def package_list(manifests, ubuntu, gtk4=False):
    packages = set(CORE_PACKAGES.split())
    for manifest in manifests:
        app = manifest["id"]
        if app not in APP_PACKAGES:
            raise ValueError("custom Apps require an administrator-supplied package list")
        packages.update(APP_PACKAGES[app].split())
        if app in {"kate", "kwrite"}:
            packages.add("libqt5gui5t64" if ubuntu == "24.04" else "libqt6gui6")
    if gtk4:
        packages.add("ibus-gtk4")
    return sorted(packages)


def load_library(path):
    return python_probe("import ctypes, sys; ctypes.CDLL(sys.argv[1])", path)


def toolkit_module(pattern):
    return any(load_library(path) for path in glob.glob(pattern))


def qt_major(executable):
    path = shutil.which(executable)
    if not path:
        return None
    try:
        result = subprocess.run(["ldd", path], capture_output=True, text=True,
                                timeout=5, check=False)
        if result.returncode != 0:
            return None
        versions = set(re.findall(r"libQt([56])Gui\.so", result.stdout))
        return versions.pop() if len(versions) == 1 else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def check_host(manifests, gtk4=False, require_linger=False):
    results = []

    def check(name, ok, hint):
        results.append((name, bool(ok), hint))

    commands = set(CORE_COMMANDS.split())
    modules = set()
    for manifest in manifests:
        commands.update(manifest["dependencies"].get("executables", []))
        modules.update(manifest["dependencies"].get("pythonModules", []))
    for command in sorted(commands):
        check("command: " + command, shutil.which(command), "install the declared executable")
    for module in sorted(modules):
        check("Python import: " + module,
              python_probe("import importlib, sys; importlib.import_module(sys.argv[1])", module),
              "install/fix the binding for this Python interpreter")
    check("GI/GLib/IBus import", python_probe(GI_PROBE), "install python3-gi and gir1.2-ibus-1.0")
    for library in ("X11", "Xtst", "xdo"):
        check("native library: " + library, python_probe(
            "import ctypes, ctypes.util, sys; p = ctypes.util.find_library(sys.argv[1]); assert p; ctypes.CDLL(p)", library),
            "install the native library and its dependencies")
    # Site-specific template IDs must not hide the declared toolkit executables.
    if commands & GTK3_COMMANDS:
        check("GTK3 IBus module", toolkit_module("/usr/lib/*/gtk-3.0/3.0.0/immodules/im-ibus.so"), "install ibus-gtk3")
    if gtk4:
        check("GTK4 IBus module", toolkit_module("/usr/lib/*/gtk-4.0/4.0.0/immodules/libim-ibus.so"), "install ibus-gtk4 (only for GTK4 workloads)")
    for app in sorted(commands & {"kate", "kwrite"}):
        major = qt_major(app)
        check(app + " Qt IBus module", major and toolkit_module(
            "/usr/lib/*/qt" + major + "/plugins/platforminputcontexts/libibusplatforminputcontextplugin.so"),
            "verify native Qt version with ldd and install its matching IBus platform-input plugin")
    check("pidfd open/signal owned child", python_probe(PIDFD_PROBE),
          "kernel/container policy must permit pidfd_open and pidfd_send_signal")
    uid = os.geteuid()
    runtime = Path("/run/user") / str(uid)
    check("runtime directory ownership", runtime.is_dir() and runtime.stat().st_uid == uid,
          "start the runtime account's user manager")
    env = dict(os.environ, XDG_RUNTIME_DIR=str(runtime), DBUS_SESSION_BUS_ADDRESS="unix:path=" + str(runtime / "bus"))
    check("runtime user manager", run_probe(["systemctl", "--user", "show-environment"], env),
          "make the runtime account's systemd user manager available")
    if any(manifest.get("runMode") == "user-home" for manifest in manifests):
        check("borrowed user D-Bus", run_probe(["dbus-send", "--session", "--print-reply", "--reply-timeout=2000",
              "--dest=org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus.ListNames"], env),
              "make /run/user/<uid>/bus available; do not start a competing desktop")
    if require_linger:
        # Check the property as an exit status, without exposing the user's environment.
        check("unattended user lingering", Path("/var/lib/systemd/linger", pwd.getpwuid(uid).pw_name).is_file(),
              "administrator: enable lingering for this runtime account")
    return results


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument("--apps", default="all", help="all (default), core, or comma-separated shipped App IDs")
    selection.add_argument("--enabled-root", type=Path, help="check manifests selected by an installed catalog")
    parser.add_argument("--print-packages", action="store_true", help="print a package list; do not install anything")
    parser.add_argument("--ubuntu", choices=("24.04", "26.04"), help="target release for --print-packages")
    parser.add_argument("--gtk4", action="store_true", help="also require GTK4 integration for additional workloads")
    parser.add_argument("--user", help="assert checks are already running as this non-root account")
    parser.add_argument("--require-linger", action="store_true")
    args = parser.parse_args(argv)
    try:
        manifests = load_manifests(args.apps, args.enabled_root)
        if args.print_packages:
            if not args.ubuntu:
                parser.error("--print-packages requires --ubuntu")
            print(" ".join(package_list(manifests, args.ubuntu, args.gtk4)))
            return 0
        if args.ubuntu:
            parser.error("--ubuntu is only for package lists; capability checks always inspect this host")
        if os.geteuid() == 0 or (args.user and pwd.getpwnam(args.user).pw_uid != os.geteuid()):
            parser.error("run checks as the intended non-root runtime account, not the administrator")
        results = check_host(manifests, args.gtk4, args.require_linger)
        for name, ok, hint in results:
            print(("PASS " if ok else "FAIL ") + name + ("" if ok else ": " + hint))
        if any(manifest["id"] not in APP_PACKAGES for manifest in manifests):
            print("NOT CHECKED: custom App toolkit integration; administrator review is required.")
        print("Capability checks only: interactive App/input/clipboard acceptance is still required.")
        return 0 if all(ok for _, ok, _ in results) else 1
    except (OSError, ValueError, KeyError, TypeError):
        print("Cannot read dependency inputs; check manifest/catalog and runtime account configuration.", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
