#!/usr/bin/env python3
"""Native worker-client counts in an owned page; no audio, SDK patch or Network CDP."""
import argparse
import functools
import hashlib
import http.server
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import threading
import time
from retirement_cdp import Browser, Page


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--cycles', type=int, default=50)
    parser.add_argument('--idle-seconds', type=int, default=5)
    parser.add_argument('--legacy', action='store_true')
    args = parser.parse_args()
    assert args.cycles > 0 and args.idle_seconds >= 0
    args.output.mkdir(parents=True, exist_ok=True, mode=0o700)
    root = Path(__file__).resolve().parents[2]
    spec = importlib.util.spec_from_file_location('retirement_snapshot', Path(__file__).with_name('browser-retirement.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    report = {'status':'preparing', 'legacy':args.legacy, 'cycles':args.cycles,
        'idleSeconds':args.idle_seconds, 'noAudio':True, 'noNetworkDebugger':True,
        'hubSourceSHA256':hashlib.sha256((root/'cmd/remotexappd/web/sdk/audio-worker-hub.js').read_bytes()).hexdigest(),
        'launcherSHA256':hashlib.sha256(args.browser.read_bytes()).hexdigest(), 'counts':{}}
    browser = page = None

    def counts(name):
        path = args.output/(name+'.heapsnapshot')
        module.snapshot(page.session, path)
        heap = json.loads(path.read_text())
        meta = heap['snapshot']['meta']; fields = meta['node_fields']; nodes = heap['nodes']; strings = heap['strings']
        types = meta['node_types'][fields.index('type')]
        result = dict.fromkeys(['SharedWorker','MessagePort','AudioContext','AudioWorkletNode','blink::AudioWorkletMessagingProxy'],0)
        for offset in range(0,len(nodes),len(fields)):
            name = strings[nodes[offset+fields.index('name')]]
            if types[nodes[offset+fields.index('type')]] == 'native' and name in result:
                result[name] += 1
        return result

    class QuietHandler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *_args):
            pass

    with tempfile.TemporaryDirectory(prefix='worker-hub-',dir=args.output) as directory:
        stage = Path(directory)
        shutil.copy2(Path(__file__).with_name('worker-hub-retirement.html'),stage/'index.html')
        shutil.copy2(root/'cmd/remotexappd/web/sdk/audio-worker-hub.js',stage/'audio-worker-hub.js')
        server = http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=directory))
        thread = threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            browser = Browser(args.browser,stage/'unused-no-capture.wav','',args.output)
            report['browser'] = browser.version
            page = Page(browser,'http://127.0.0.1:'+str(server.server_port)+'/index.html'+('?legacy' if args.legacy else ''))
            page.wait('()=>!!window.lab')
            report['counts']['keeper'] = counts('keeper')
            page.evaluate('async n=>lab.cycles(n)',args.cycles)
            report['counts']['cyclesWithKeeper'] = counts('cycles-with-keeper')
            report['keeperSurvives'] = page.evaluate('()=>lab.checkKeeper()')
            page.evaluate('()=>lab.retireKeeper()')
            report['counts']['allOwnersRetired'] = counts('all-owners-retired')
            time.sleep(args.idle_seconds)
            report['counts']['idlePageAlive'] = final = counts('idle-page-alive')
            report['pageAlive'] = page.evaluate('n=>lab.done===n&&lab.keeper===null',args.cycles)
            assert report['keeperSurvives'] and report['pageAlive']
            expected = args.cycles+1 if args.legacy else 1
            assert final['SharedWorker'] == expected and final['MessagePort'] == expected, final
            assert all(final[name] == 0 for name in ['AudioContext','AudioWorkletNode','blink::AudioWorkletMessagingProxy'])
            report['status'] = 'passed'
        except BaseException as error:
            report.update(status='failed',error=type(error).__name__+': '+str(error))
            raise
        finally:
            if page:
                page.session.close()
            if browser:
                browser.close();report['ownedBrowserClosed']=True
            server.shutdown();thread.join(timeout=3);server.server_close()
            (args.output/'results.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__ == '__main__':
    main()
