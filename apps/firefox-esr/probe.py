#!/usr/bin/python3
"""Probe Firefox's loopback WebDriver BiDi endpoint without third-party code."""

import base64
import hashlib
import json
import os
import socket
import struct
import sys


GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
PATH = "/session"
TIMEOUT_SECONDS = 2.0


class WebSocket:
    def __init__(self, connection, initial=b""):
        self.connection = connection
        self.buffer = bytearray(initial)

    def read_exact(self, length):
        while len(self.buffer) < length:
            chunk = self.connection.recv(4096)
            if not chunk:
                raise RuntimeError("WebSocket closed before the BiDi response")
            self.buffer.extend(chunk)
        result = bytes(self.buffer[:length])
        del self.buffer[:length]
        return result

    def send_frame(self, opcode, payload):
        mask = os.urandom(4)
        length = len(payload)
        if length < 126:
            header = bytes((0x80 | opcode, 0x80 | length))
        elif length <= 0xFFFF:
            header = bytes((0x80 | opcode, 0xFE)) + struct.pack("!H", length)
        else:
            header = bytes((0x80 | opcode, 0xFF)) + struct.pack("!Q", length)
        masked = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
        self.connection.sendall(header + mask + masked)

    def read_frame(self):
        first, second = self.read_exact(2)
        opcode = first & 0x0F
        length = second & 0x7F
        if length == 126:
            length = struct.unpack("!H", self.read_exact(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", self.read_exact(8))[0]
        if length > 1 << 20:
            raise RuntimeError("WebSocket frame exceeds the probe limit")
        mask = self.read_exact(4) if second & 0x80 else None
        payload = self.read_exact(length)
        if mask:
            payload = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
        return opcode, payload


def connect(address, port):
    key = base64.b64encode(os.urandom(16)).decode("ascii")
    request = (
        f"GET {PATH} HTTP/1.1\r\n"
        f"Host: {address}:{port}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n\r\n"
    ).encode("ascii")
    connection = socket.create_connection((address, port), TIMEOUT_SECONDS)
    try:
        connection.settimeout(TIMEOUT_SECONDS)
        connection.sendall(request)
        response = bytearray()
        while b"\r\n\r\n" not in response:
            chunk = connection.recv(4096)
            if not chunk:
                raise RuntimeError("control endpoint closed during WebSocket handshake")
            response.extend(chunk)
            if len(response) > 16384:
                raise RuntimeError("WebSocket handshake exceeds the probe limit")
        header_bytes, initial = bytes(response).split(b"\r\n\r\n", 1)
        lines = header_bytes.decode("iso-8859-1").split("\r\n")
        if len(lines) < 2 or not lines[0].startswith("HTTP/1.1 101 "):
            raise RuntimeError("control endpoint rejected the WebSocket handshake")
        headers = {}
        for line in lines[1:]:
            name, separator, value = line.partition(":")
            if not separator:
                raise RuntimeError("malformed WebSocket response header")
            headers[name.strip().lower()] = value.strip()
        expected = base64.b64encode(hashlib.sha1((key + GUID).encode("ascii")).digest()).decode("ascii")
        if headers.get("upgrade", "").lower() != "websocket" or headers.get("sec-websocket-accept") != expected:
            raise RuntimeError("control endpoint returned an invalid WebSocket upgrade")
        return connection, WebSocket(connection, initial)
    except Exception:
        connection.close()
        raise


def probe(address, port):
    if address != "127.0.0.1":
        raise ValueError("control address must be exactly 127.0.0.1")
    if not 1024 <= port <= 65535:
        raise ValueError("control port must be an unprivileged TCP port")
    connection, websocket = connect(address, port)
    try:
        request = json.dumps({"id": 1, "method": "session.status", "params": {}}, separators=(",", ":"))
        websocket.send_frame(0x1, request.encode("utf-8"))
        for _ in range(8):
            opcode, payload = websocket.read_frame()
            if opcode == 0x9:
                websocket.send_frame(0xA, payload)
                continue
            if opcode == 0x8:
                raise RuntimeError("WebSocket closed before session.status completed")
            if opcode != 0x1:
                continue
            response = json.loads(payload.decode("utf-8"))
            if response.get("id") != 1:
                continue
            ready = response.get("result", {}).get("ready")
            if response.get("type") != "success" or not isinstance(ready, bool):
                raise RuntimeError("session.status returned an invalid BiDi response")
            return
        raise RuntimeError("session.status did not return a matching BiDi response")
    finally:
        connection.close()


def main():
    if len(sys.argv) != 3:
        raise ValueError("usage: probe.py 127.0.0.1 PORT")
    probe(sys.argv[1], int(sys.argv[2], 10))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as error:
        print(f"Firefox WebDriver BiDi probe failed: {error}", file=sys.stderr)
        sys.exit(1)
