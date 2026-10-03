#!/usr/bin/python3
"""Discover the launched editor's actual private-bus control endpoint."""
import ast
import json
import os
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

pid, app, document = int(sys.argv[1]), sys.argv[2], sys.argv[3]
if app not in ("kate", "kwrite") or pid <= 1:
    raise SystemExit("Invalid editor probe identity")
start = open(f"/proc/{pid}/stat").read().rsplit(")", 1)[1].split()[19]
def call(args):
    return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL, timeout=2).strip()
def dbus(method, *args):
    return call(["gdbus", "call", "--session", "--dest", "org.freedesktop.DBus",
                 "--object-path", "/org/freedesktop/DBus",
                 "--method", "org.freedesktop.DBus." + method, *args])
deadline = time.monotonic() + 20
while time.monotonic() < deadline:
    try:
        names = ast.literal_eval(dbus("ListNames"))[0]
        owners = []
        for name in names:
            if not name.startswith("org.kde." + app + "-"):
                continue
            owner = ast.literal_eval(dbus("GetNameOwner", name))[0]
            reported_pid = int(re.findall(r"\d+", dbus("GetConnectionUnixProcessID", owner))[-1])
            if reported_pid == pid:
                owners.append((name, owner))
        if len(owners) != 1:
            raise ValueError("No unique editor owner")
        service, owner = owners[0]
        xml = call(["gdbus", "introspect", "--session", "--dest", owner,
                    "--object-path", "/MainApplication", "--xml"])
        interface = ET.fromstring(xml).find("interface[@name='org.kde.Kate.Application']")
        required = {"tokenOpenUrl": ("s", "s", "b"), "setCursor": ("i", "i"), "openInput": ("s", "s")}
        if interface is None:
            raise ValueError("Application interface missing")
        for name, inputs in required.items():
            if not any(tuple(a.get("type") for a in m.findall("arg") if a.get("direction") == "in") == inputs for m in interface.findall("method") if m.get("name") == name):
                raise ValueError("Required method signature missing")
        if not call(["xdotool", "search", "--onlyvisible", "--pid", str(pid)]):
            raise ValueError("Editor window missing")
        call(["gdbus", "call", "--session", "--dest", owner, "--object-path", "/MainApplication",
              "--method", "org.freedesktop.DBus.Peer.Ping"])
        if open(f"/proc/{pid}/stat").read().rsplit(")", 1)[1].split()[19] != start:
            raise ValueError("Process identity changed")
        if ast.literal_eval(dbus("GetNameOwner", service))[0] != owner:
            raise ValueError("Service owner changed")
        break
    except (OSError, ValueError, SyntaxError, ET.ParseError, subprocess.SubprocessError):
        if not os.path.exists(f"/proc/{pid}"):
            raise SystemExit("Editor exited before control readiness")
        time.sleep(0.1)
else:
    raise SystemExit("Editor control/window readiness timed out")

# Initial no-file launch deliberately opens a blank editor, including Kate's
# default welcome-screen configuration. This is initialization, not a poll.
if not document:
    result = call(["gdbus", "call", "--session", "--dest", owner, "--object-path", "/MainApplication",
                   "--method", "org.kde.Kate.Application.openInput", "", "UTF-8"])
    if result != "(true,)":
        raise SystemExit("Could not initialize blank editor")
print(json.dumps({"protocol": "dbus", "service": service, "uniqueName": owner,
                  "objectPath": "/MainApplication", "interface": "org.kde.Kate.Application",
                  "capabilities": list(required)}))
