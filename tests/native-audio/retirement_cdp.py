"""Small owned-browser CDP driver; deliberately never enables Network."""
import contextlib
import json
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request

from websockets.sync.client import connect


class CDP:
    def __init__(self, url):
        self.socket = connect(url, max_size=64 * 1024 * 1024)
        self.next = 0
        self.events = {}

    def send(self, method, params=None):
        self.next += 1
        request = self.next
        self.socket.send(json.dumps({'id': request, 'method': method, 'params': params or {}}))
        while True:
            response = json.loads(self.socket.recv(timeout=40))
            if response.get('method') in self.events:
                self.events[response['method']](response.get('params', {}))
            if response.get('id') != request:
                continue
            if 'error' in response:
                raise RuntimeError(method + ': ' + str(response['error']))
            return response.get('result', {})

    def on(self, event, handler):
        self.events[event] = handler

    def remove_listener(self, event, _handler):
        self.events.pop(event, None)

    def close(self):
        self.socket.close()


class Page:
    def __init__(self, browser, url):
        self.browser = browser
        self.target = browser.http('/json/new?' + urllib.parse.quote(url, safe=''), 'PUT')
        self.session = CDP(self.target['webSocketDebuggerUrl'])
        self.errors = []
        self.session.on('Runtime.exceptionThrown', lambda event: self.errors.append(event['exceptionDetails'].get('exception', {}).get('description') or event['exceptionDetails'].get('text')))
        self.session.send('Page.enable')
        self.session.send('Runtime.enable')
        self.session.send('Performance.enable')
        self.wait('()=>document.readyState==="complete"')

    def evaluate(self, expression, arg=None):
        result = self.session.send('Runtime.evaluate', {'expression': '(' + expression + ')(' +
            ('' if arg is None else json.dumps(arg)) + ')', 'awaitPromise': True, 'returnByValue': True})
        if result.get('exceptionDetails'):
            raise RuntimeError(str(result['exceptionDetails']))
        return result.get('result', {}).get('value')

    def wait(self, expression, timeout=30):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if value := self.evaluate(expression):
                return value
            time.sleep(.12)
        raise TimeoutError(expression[:140])

    def click(self, selector):
        point = self.evaluate('s=>{const e=document.querySelector(s);e.scrollIntoView();const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}}', selector)
        for kind in ['mouseMoved', 'mousePressed', 'mouseReleased']:
            self.session.send('Input.dispatchMouseEvent', {'type': kind, **point,
                **({'button': 'left', 'clickCount': 1} if kind != 'mouseMoved' else {})})

    def front(self):
        self.session.send('Page.bringToFront')

    def close(self):
        self.browser.http('/json/close/' + self.target['id'])
        self.session.close()


class Browser:
    def __init__(self, binary, wav, spki, output):
        self.profile = tempfile.TemporaryDirectory(prefix='browser-', dir=output)
        self.log = (Path(output) / 'browser.log').open('w')
        self.process = subprocess.Popen([str(binary), '--headless=new', '--no-sandbox',
            '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
            '--disable-background-networking', '--user-data-dir=' + self.profile.name,
            '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
            '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
            '--use-file-for-fake-audio-capture=' + str(wav),
            '--ignore-certificate-errors-spki-list=' + spki, 'about:blank'], stdout=self.log, stderr=self.log)
        deadline = time.monotonic() + 25
        portfile = Path(self.profile.name) / 'DevToolsActivePort'
        while not portfile.exists():
            if time.monotonic() > deadline or self.process.poll() is not None:
                self.close()
                raise RuntimeError('Owned browser did not start')
            time.sleep(.1)
        self.origin = 'http://127.0.0.1:' + portfile.read_text().splitlines()[0]
        metadata = self.http('/json/version')
        self.version = metadata['Browser']
        self.session = CDP(metadata['webSocketDebuggerUrl'])

    def http(self, path, method='GET'):
        with urllib.request.urlopen(urllib.request.Request(self.origin + path, method=method), timeout=10) as response:
            return json.load(response) if path != '/json/close/' and not path.startswith('/json/close/') else response.read()

    def permissions(self, origin):
        self.session.send('Browser.grantPermissions', {'origin': origin,
            'permissions': ['audioCapture', 'clipboardReadWrite', 'clipboardSanitizedWrite']})

    def close(self):
        if hasattr(self, 'session'):
            with contextlib.suppress(Exception):
                self.session.close()
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
        self.log.close()
        # Chromium's child cache writers can finish shortly after its main PID.
        for attempt in range(20):
            try:
                self.profile.cleanup()
                break
            except OSError:
                if attempt == 19:
                    raise
                time.sleep(.1)
