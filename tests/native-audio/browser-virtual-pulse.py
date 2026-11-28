#!/usr/bin/env python3
"""Verify the private Pulse/Chrome measurement fixture without loading the SDK."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
import time

from headed_cdp import HeadedBrowser, OwnedX11
from virtual_pulse import VirtualPulse, capture


class ControlPage(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != '/':
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(b'<!doctype html><title>Native audio control</title>'
                         b'<button id="start">Start synthetic microphone</button>')

    def log_message(self, *_):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    report = {'status': 'running', 'scope': 'No SDK; private virtual devices and native browser graph only',
              'checks': []}
    server = ThreadingHTTPServer(('127.0.0.1', 0), ControlPage)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with VirtualPulse(args.output) as pulse, OwnedX11(args.output) as x11:
            env = {**pulse.env, 'DISPLAY': x11.env['DISPLAY'], 'XAUTHORITY': x11.env['XAUTHORITY']}
            with HeadedBrowser(args.browser, args.output, env,
                               args=['--use-fake-ui-for-media-stream']) as browser:
                page = browser.new_page()
                page.goto('http://127.0.0.1:' + str(server.server_port) + '/')
                page.evaluate('''()=>{
                  document.getElementById('start').onclick=async()=>{
                    window.controlReady=false;
                    if(window.stream)stream.getTracks().forEach(t=>t.stop());
                    window.source?.disconnect();
                    window.context ||= new AudioContext({sampleRate:48000});
                    window.stream=await navigator.mediaDevices.getUserMedia({audio:{
                      echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
                    window.source=context.createMediaStreamSource(stream);
                    source.connect(context.destination);await context.resume();window.controlReady=true;
                  };
                }''')
                page.click('#start')
                page.wait('()=>window.controlReady')
                report['browser'] = browser.version
                for hz in [660, 1100, 1540]:
                    pulse.set_marker(hz)
                    time.sleep(.6)
                    windows = read_marker(pulse, hz)
                    assert windows[-1]['markerEnergyFraction'] > .8, windows
                    report['checks'].append({'name': 'fresh-native-output-' + str(hz), 'windows': windows})
                pulse.remove_source()
                page.wait('async()=>!(await navigator.mediaDevices.enumerateDevices()).some(d=>d.kind==="audioinput")')
                report['removedSourceTrack'] = page.evaluate('()=>stream.getTracks().map(t=>({state:t.readyState,muted:t.muted}))')
                pulse.restore_source()
                pulse.set_marker(1760)
                time.sleep(.65)
                windows = read_marker(pulse, 1760)
                report['automaticBrowserRestore'] = windows
                # Default-device removal can leave a live but silent native
                # track. Record it; do not call that SDK recovery or a failure
                # of the measurement device. A new capture is a positive control.
                report['recaptureNeeded'] = windows[-1]['markerEnergyFraction'] <= .8
                if report['recaptureNeeded']:
                    page.click('#start')
                    page.wait('()=>window.controlReady')
                    time.sleep(.5)
                    windows = read_marker(pulse, 1760)
                assert windows[-1]['markerEnergyFraction'] > .8, windows
                report['checks'].append({'name': 'restored-device-positive-control', 'windows': windows})
                page.evaluate('async()=>{stream.getTracks().forEach(t=>t.stop());source.disconnect();await context.close();window.stream=window.source=window.context=null;}')
                report['pageErrors'] = list(page.errors)
                assert not report['pageErrors'], report['pageErrors']
        report.update(status='passed', cleanup=True)
    except BaseException as error:
        report.update(status='failed', error=repr(error))
        raise
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)
        (args.output / 'results.json').write_text(json.dumps(report, indent=2) + '\n')


def read_marker(pulse, hz):
    windows = []
    for _ in range(8):
        value = capture(pulse.env, 'output.monitor', channels=2, expected_hz=hz)
        windows.append(value)
        if value['markerEnergyFraction'] > .8:
            break
    return windows


if __name__ == '__main__':
    main()
