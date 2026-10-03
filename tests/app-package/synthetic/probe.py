#!/usr/bin/env python3
import argparse
import json
import socketserver
from pathlib import Path


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        self.wfile.write(b'{"status":"ready","protocol":"synthetic-json-line-v1"}\n')


class Server(socketserver.TCPServer):
    allow_reuse_address = False


parser = argparse.ArgumentParser()
parser.add_argument("--address", required=True)
parser.add_argument("--port", required=True, type=int)
parser.add_argument("--ready-file", required=True)
args = parser.parse_args()

with Server((args.address, args.port), Handler) as server:
    Path(args.ready_file).write_text("ready\n", encoding="utf-8")
    server.serve_forever()
