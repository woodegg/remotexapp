#!/usr/bin/python3
"""Package-owned bounded openUrl handler. No shell interpolation or control proxy."""
import base64
import hashlib
import json
import os
import socket
import sys
from urllib.parse import urlsplit
sys.dont_write_bytecode = True
import probe

def connect(address, port, path):
    key = base64.b64encode(os.urandom(16)).decode("ascii")
    sock = socket.create_connection((address, port), 3)
    sock.settimeout(3)
    try:
        sock.sendall((f"GET {path} HTTP/1.1\r\nHost: {address}:{port}\r\n"
                      f"Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
                      "Sec-WebSocket-Version: 13\r\n\r\n").encode("ascii"))
        data = b""
        while b"\r\n\r\n" not in data:
            part = sock.recv(4096)
            if not part or len(data) > 16384:
                raise RuntimeError("handshake failed")
            data += part
        header, rest = data.split(b"\r\n\r\n", 1)
        lines = header.decode("latin1").split("\r\n")
        headers = {name.strip().lower(): value.strip() for name, value in (line.split(":", 1) for line in lines[1:])}
        expected = base64.b64encode(hashlib.sha1((key + probe.GUID).encode()).digest()).decode()
        if " 101 " not in lines[0] or headers.get("sec-websocket-accept") != expected:
            raise RuntimeError("handshake rejected")
        return sock, probe.WebSocket(sock, rest)
    except BaseException:
        sock.close()
        raise

def call(ws, ident, method, params):
    ws.send_frame(1, json.dumps({"id": ident, "method": method, "params": params}).encode())
    for _ in range(128):
        opcode, data = ws.read_frame()
        if opcode == 9:
            ws.send_frame(10, data)
            continue
        if opcode != 1:
            raise RuntimeError("unexpected frame")
        message = json.loads(data)
        if message.get("id") != ident:
            continue
        if "error" in message:
            raise RuntimeError("control rejected command")
        return message["result"]
    raise RuntimeError("response limit")

def inputs():
    data = json.loads(sys.stdin.buffer.read(65537))
    params = data["parameters"]
    url = params["url"]
    parsed = urlsplit(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or len(url) > 2048 or any(ord(c) < 32 for c in url) or params.get("disposition") != "new-tab":
        raise ValueError("invalid parameters")
    with open(os.environ["REMOTEXAPP_RESOURCES"], encoding="utf-8") as stream:
        resource = json.load(stream)["control"]
    control = data["connections"]["application"]
    if resource["address"] != "127.0.0.1" or control["address"] != resource["address"] or control["port"] != resource["port"] or not 1024 <= resource["port"] <= 65535:
        raise ValueError("invalid endpoint")
    return url, resource, control

def main():
    url, resource, control = inputs()
    if control["protocol"] != "cdp":
        raise ValueError("wrong protocol")
    _, endpoint = probe.read_version(resource["address"], resource["port"])
    sock, ws = connect(resource["address"], resource["port"], urlsplit(endpoint).path)
    try:
        call(ws, 1, "Browser.getVersion", {})
        tab = call(ws, 2, "Target.createTarget", {"url": url})["targetId"]
        call(ws, 3, "Target.activateTarget", {"targetId": tab})
        print(json.dumps({"tabId": tab, "url": url}))
    finally:
        sock.close()

if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.exit(1)
