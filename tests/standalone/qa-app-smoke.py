#!/usr/bin/env python3
"""Smoke every enabled App through a live Manager without extra Python modules."""

import argparse
import base64
import json
import secrets
import socket
import time
import urllib.error
import urllib.parse
import urllib.request


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("base_url", help="loopback Manager URL, e.g. http://127.0.0.1:2992")
    parser.add_argument("--identity", help="trusted-header test identity")
    parser.add_argument("--exclude", action="append", default=[], help="App ID to exclude")
    parser.add_argument("--only", action="append", default=[], help="test only this App ID")
    args = parser.parse_args()
    base = urllib.parse.urlsplit(args.base_url)
    if base.scheme != "http" or base.hostname not in ("127.0.0.1", "localhost", "::1") or not base.port:
        parser.error("base_url must be an explicit loopback HTTP listener")
    headers = {"Content-Type": "application/json"}
    if args.identity:
        headers["Cf-Access-Authenticated-User-Email"] = args.identity

    def request(path, method="GET", body=None):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(args.base_url + path, data=data, headers=headers, method=method)
        with urllib.request.urlopen(req, timeout=75) as response:
            return json.load(response)

    def attach(instance_id):
        path = "/remotexapps/" + urllib.parse.quote(instance_id, safe="") + "/rfb-compat"
        key = base64.b64encode(secrets.token_bytes(16)).decode("ascii")
        target = f"{base.hostname}:{base.port}"
        lines = [
            f"GET {path} HTTP/1.1", f"Host: {target}", f"Origin: {args.base_url}",
            "Connection: Upgrade", "Upgrade: websocket", "Sec-WebSocket-Version: 13",
            f"Sec-WebSocket-Key: {key}",
        ]
        if args.identity:
            lines.append("Cf-Access-Authenticated-User-Email: " + args.identity)
        with socket.create_connection((base.hostname, base.port), timeout=65) as conn:
            conn.settimeout(65)
            conn.sendall(("\r\n".join(lines) + "\r\n\r\n").encode())
            response = bytearray()
            while b"\r\n\r\n" not in response and len(response) < 16384:
                chunk = conn.recv(4096)
                if not chunk:
                    break
                response.extend(chunk)
            status = response.split(b"\r\n", 1)[0]
            if b" 101 " not in status:
                raise RuntimeError(f"Viewer attach failed: {status.decode(errors='replace')}")

    templates = request("/api/templates")
    tested = []
    for template in templates:
        app_id = template["id"]
        if app_id in args.exclude or (args.only and app_id not in args.only) or template["runMode"] == "user-home":
            continue
        created = request("/api/instances", "POST", {"templateId": app_id})
        instance_id = created["id"]
        print(f"{app_id}: created {instance_id}", flush=True)
        ready = False
        try:
            if template["sessionActivation"] == "on-attach":
                attach(instance_id)
            deadline = time.monotonic() + 65
            while True:
                current = request("/api/instances/" + urllib.parse.quote(instance_id, safe=""))
                if current.get("applicationStatus", {}).get("state") == "ready":
                    break
                if current.get("sessionState") == "failed" or time.monotonic() >= deadline:
                    raise RuntimeError(f"{app_id} did not become ready: {current.get('error') or current.get('applicationStatus')}")
                time.sleep(0.2)
            print(f"{app_id}: ready generation={current['sessionGeneration']} display={current['display']}", flush=True)
            tested.append(app_id)
            ready = True
        finally:
            if ready:
                request("/api/instances/" + urllib.parse.quote(instance_id, safe="") + "/stop", "POST", {"force": True})
                print(f"{app_id}: stopped", flush=True)
            else:
                print(f"{app_id}: failed runtime retained for diagnosis: {instance_id}", flush=True)
    print("PASS Apps: " + ", ".join(tested), flush=True)


if __name__ == "__main__":
    main()
