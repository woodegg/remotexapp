#!/usr/bin/python3
"""Verify one loopback Microsoft Edge CDP browser endpoint."""

import base64
import hashlib
import json
import os
import socket
import struct
import sys
import urllib.request
from urllib.parse import urlparse


GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
TIMEOUT_SECONDS = 2.0


class WebSocket:
    def __init__(self, connection: socket.socket, initial: bytes = b"") -> None:
        self.connection = connection
        self.buffer = bytearray(initial)

    def read_exact(self, length: int) -> bytes:
        while len(self.buffer) < length:
            chunk = self.connection.recv(4096)
            if not chunk:
                raise RuntimeError("CDP WebSocket closed before Browser.getVersion")
            self.buffer.extend(chunk)
        result = bytes(self.buffer[:length])
        del self.buffer[:length]
        return result

    def send_frame(self, opcode: int, payload: bytes) -> None:
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

    def read_frame(self) -> tuple[int, bytes]:
        first, second = self.read_exact(2)
        opcode = first & 0x0F
        length = second & 0x7F
        if length == 126:
            length = struct.unpack("!H", self.read_exact(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", self.read_exact(8))[0]
        if length > 1 << 20:
            raise RuntimeError("CDP WebSocket frame exceeds the probe limit")
        mask = self.read_exact(4) if second & 0x80 else None
        payload = self.read_exact(length)
        if mask:
            payload = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
        return opcode, payload


def read_version(address: str, port: int) -> tuple[str, str]:
    version_url = f"http://{address}:{port}/json/version"
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(version_url, timeout=TIMEOUT_SECONDS) as response:
        payload = response.read(65537)
    if len(payload) > 65536:
        raise RuntimeError("CDP /json/version response exceeds the probe limit")
    document = json.loads(payload)
    websocket_url = document.get("webSocketDebuggerUrl")
    if not isinstance(websocket_url, str):
        raise RuntimeError("CDP /json/version omitted webSocketDebuggerUrl")
    parsed = urlparse(websocket_url)
    if parsed.scheme != "ws" or parsed.hostname != address or parsed.port != port:
        raise RuntimeError("CDP browser WebSocket is not the allocated loopback endpoint")
    if not parsed.path.startswith("/devtools/browser/"):
        raise RuntimeError("CDP browser WebSocket has an unexpected path")
    return version_url, websocket_url


def probe_websocket(websocket_url: str) -> dict:
    parsed = urlparse(websocket_url)
    key = base64.b64encode(os.urandom(16)).decode("ascii")
    request = (
        f"GET {parsed.path} HTTP/1.1\r\n"
        f"Host: {parsed.hostname}:{parsed.port}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n\r\n"
    ).encode("ascii")
    connection = socket.create_connection((parsed.hostname, parsed.port), TIMEOUT_SECONDS)
    try:
        connection.settimeout(TIMEOUT_SECONDS)
        connection.sendall(request)
        response = bytearray()
        while b"\r\n\r\n" not in response:
            chunk = connection.recv(4096)
            if not chunk:
                raise RuntimeError("CDP endpoint closed during WebSocket handshake")
            response.extend(chunk)
            if len(response) > 16384:
                raise RuntimeError("CDP WebSocket handshake exceeds the probe limit")
        header, initial = bytes(response).split(b"\r\n\r\n", 1)
        lines = header.decode("iso-8859-1").split("\r\n")
        if " 101 " not in f" {lines[0]} ":
            raise RuntimeError("CDP endpoint rejected the WebSocket handshake")
        headers = {}
        for line in lines[1:]:
            name, value = line.split(":", 1)
            headers[name.strip().lower()] = value.strip()
        expected = base64.b64encode(hashlib.sha1((key + GUID).encode("ascii")).digest()).decode("ascii")
        if headers.get("sec-websocket-accept") != expected:
            raise RuntimeError("CDP WebSocket accept value is invalid")

        websocket = WebSocket(connection, initial)
        websocket.send_frame(1, b'{"id":1,"method":"Browser.getVersion"}')
        while True:
            opcode, payload = websocket.read_frame()
            if opcode == 9:
                websocket.send_frame(10, payload)
                continue
            if opcode != 1:
                raise RuntimeError("CDP returned an unexpected WebSocket frame")
            message = json.loads(payload)
            if message.get("id") != 1:
                continue
            if "error" in message or not isinstance(message.get("result"), dict):
                raise RuntimeError("CDP Browser.getVersion failed")
            return message["result"]
    finally:
        connection.close()


def main() -> None:
    if len(sys.argv) != 3:
        raise RuntimeError("control address and port are required")
    address = sys.argv[1]
    port = int(sys.argv[2])
    if address != "127.0.0.1" or not 1024 <= port <= 65535:
        raise RuntimeError("CDP endpoint must be an allocated loopback port")
    version_url, websocket_url = read_version(address, port)
    version = probe_websocket(websocket_url)
    print(json.dumps({
        "protocol": "cdp",
        "address": address,
        "port": port,
        "endpoints": {
            "versionUrl": version_url,
            "browserWebSocketUrl": websocket_url,
        },
        "browser": {
            "product": version.get("product", ""),
            "protocolVersion": version.get("protocolVersion", ""),
        },
    }, separators=(",", ":"), sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"{type(error).__name__}: {str(error)[:220]}", file=sys.stderr)
        sys.exit(1)
