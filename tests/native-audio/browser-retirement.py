#!/usr/bin/env python3
"""Owned browser lifecycle diagnostics. Raw heaps stay in a private output dir."""
import argparse
import functools
import hashlib
import http.server
import json
from pathlib import Path
import threading
import time

from playwright.sync_api import sync_playwright


def snapshot(session, path):
    # Never enable Network: response-body caches invalidate memory comparisons.
    for _ in range(3):
        session.send('HeapProfiler.collectGarbage')
        time.sleep(.1)
    with path.open('w') as output:
        def chunk(event):
            output.write(event['chunk'])
        session.on('HeapProfiler.addHeapSnapshotChunk', chunk)
        try:
            session.send('HeapProfiler.takeHeapSnapshot', {'reportProgress': False})
        finally:
            session.remove_listener('HeapProfiler.addHeapSnapshotChunk', chunk)
    heap = json.loads(path.read_text())
    fields = heap['snapshot']['meta']['node_fields']
    types = heap['snapshot']['meta']['node_types'][fields.index('type')]
    counts = dict.fromkeys(['AudioContext', 'AudioWorkletNode', 'blink::AudioWorkletMessagingProxy'], 0)
    nodes, strings = heap['nodes'], heap['strings']
    for offset in range(0, len(nodes), len(fields)):
        if types[nodes[offset + fields.index('type')]] != 'native':
            continue
        name = strings[nodes[offset + fields.index('name')]]
        if name in counts:
            counts[name] += 1
    return counts


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser', type=Path, required=True)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--cycles', type=int, default=6)
    parser.add_argument('--page', default='repro.html')
    parser.add_argument('--expect', choices=['retained', 'released'], required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True, mode=0o700)
    handler = functools.partial(QuietHandler, directory=str(args.directory.resolve()))
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    report = {'browserSHA256': hashlib.sha256(args.browser.read_bytes()).hexdigest(),
              'cycles': args.cycles, 'expected': args.expect, 'samples': []}
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path=str(args.browser), headless=True,
                args=['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking'])
            try:
                report['browserVersion'] = browser.version
                page = browser.new_page()
                page.goto(f'http://127.0.0.1:{server.server_port}/' + args.page)
                session = page.context.new_cdp_session(page)
                report['baseline'] = snapshot(session, args.output / 'baseline.heapsnapshot')
                for i in range(args.cycles):
                    page.locator('button').click()
                    page.wait_for_function('(n)=>lab.error || lab.done === n', arg=i + 1)
                    result = page.evaluate('({done:lab.done,error:lab.error,last:lab.last})')
                    assert not result['error'], result
                    report['samples'].append(result)
                report['retired'] = snapshot(session, args.output / 'retired.heapsnapshot')
                time.sleep(10)
                report['idle'] = snapshot(session, args.output / 'idle.heapsnapshot')
                report['delta'] = {key: value - report['baseline'][key]
                    for key, value in report['idle'].items()}
                report['passed'] = all(value >= args.cycles for value in report['delta'].values()) if args.expect == 'retained' else all(value == 0 for value in report['delta'].values())
                print(json.dumps(report), flush=True)
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
        (args.output / 'results.json').write_text(json.dumps(report, indent=2) + '\n')
    assert report['passed'], report


if __name__ == '__main__':
    main()
