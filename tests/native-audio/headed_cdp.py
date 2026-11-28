"""Owned, sandboxed headed Chrome and Xvfb; no Network/focus emulation.

Use with project-owned loopback fixtures. Browser profiles, Xauthority and logs
belong in a private output directory outside Git. System devices are not made
available by this driver; supply a VirtualPulse environment for audio tests.
"""
from collections import deque
import contextlib
import json
import os
from pathlib import Path
import secrets
import select
import shutil
import subprocess
import time
import urllib.request

from retirement_cdp import CDP, Page


class OwnedX11:
    def __init__(self, output):
        self.output = Path(output)
        self.process = None
        self.log = None
        self.auth = self.output / 'Xauthority'

    def __enter__(self):
        self.output.mkdir(parents=True, exist_ok=True)
        if self.auth.exists():
            raise RuntimeError('Refusing to replace an existing Xauthority')
        cookie = secrets.token_hex(16)
        subprocess.run(['xauth', '-f', str(self.auth), 'add', ':0',
                        'MIT-MAGIC-COOKIE-1', cookie], check=True, capture_output=True)
        self.auth.chmod(0o600)
        read, write = os.pipe()
        self.log = (self.output / 'xvfb.log').open('w')
        try:
            self.process = subprocess.Popen([
                'Xvfb', '-displayfd', str(write), '-auth', str(self.auth),
                '-noreset', '-nolisten', 'tcp', '-screen', '0', '1920x1080x24'],
                pass_fds=[write], stdout=subprocess.DEVNULL, stderr=self.log)
            os.close(write)
            write = None
            # A read can return a prefix before the newline. Closing this pipe
            # early can make Xvfb fail its displayfd write and exit.
            data = b''
            deadline = time.monotonic() + 10
            while b'\n' not in data:
                remaining = deadline - time.monotonic()
                if remaining <= 0 or not select.select([read], [], [], remaining)[0]:
                    raise TimeoutError('Owned Xvfb did not report a display')
                chunk = os.read(read, 64)
                if not chunk:
                    raise RuntimeError('Owned Xvfb exited before display readiness')
                data += chunk
            display = ':' + str(int(data.splitlines()[0]))
            subprocess.run(['xauth', '-f', str(self.auth), 'add', display,
                            'MIT-MAGIC-COOKIE-1', cookie], check=True, capture_output=True)
            self.env = {**os.environ, 'DISPLAY': display, 'XAUTHORITY': str(self.auth)}
            return self
        except BaseException:
            self.close()
            raise
        finally:
            os.close(read)
            if write is not None:
                os.close(write)

    def close(self):
        if self.process is not None:
            if self.process.poll() is None:
                self.process.terminate()
            self.process.wait(timeout=5)
        if self.log is not None:
            self.log.close()
        self.auth.unlink(missing_ok=True)

    def __exit__(self, *_):
        self.close()


class HeadedPage(Page):
    def __init__(self, browser):
        super().__init__(browser, 'about:blank')
        self.errors = deque(maxlen=50)
        self.session.on('Runtime.exceptionThrown', lambda event: self.errors.append(
            event['exceptionDetails'].get('exception', {}).get('description') or
            event['exceptionDetails'].get('text')))
        for script in browser.scripts:
            self.session.send('Page.addScriptToEvaluateOnNewDocument', {'source': script})

    def goto(self, url):
        self.session.send('Page.navigate', {'url': url})
        self.wait('()=>document.readyState === "complete"')

    def wait_for_function(self, expression, arg=None, timeout=30000):
        deadline = time.monotonic() + timeout / 1000
        while time.monotonic() < deadline:
            if value := self.evaluate('arg=>!!((' + expression + ')(arg))', arg):
                return value
            time.sleep(.08)
        raise TimeoutError(expression[:180])


class HeadedBrowser:
    def __init__(self, binary, output, env, args=(), scripts=()):
        self.output = Path(output)
        self.profile = self.output / 'profile'
        self.profile.mkdir(mode=0o700)
        self.log = (self.output / 'chrome.log').open('w')
        self.scripts = scripts
        self.session = None
        self.process = subprocess.Popen([
            str(binary), '--no-first-run', '--no-default-browser-check',
            '--disable-background-networking', '--remote-debugging-port=0',
            '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + str(self.profile),
            '--ozone-platform=x11', '--window-size=1600,1100', *args, 'about:blank'],
            env=env, stdout=self.log, stderr=self.log)
        try:
            portfile = self.profile / 'DevToolsActivePort'
            deadline = time.monotonic() + 20
            while not portfile.exists():
                if self.process.poll() is not None or time.monotonic() > deadline:
                    raise RuntimeError('Owned headed Chrome did not start')
                time.sleep(.1)
            self.origin = 'http://127.0.0.1:' + portfile.read_text().splitlines()[0]
            metadata = self.http('/json/version')
            self.version = metadata['Browser']
            self.session = CDP(metadata['webSocketDebuggerUrl'])
        except BaseException:
            self.close()
            raise

    def http(self, path, method='GET'):
        with urllib.request.urlopen(urllib.request.Request(self.origin + path, method=method), timeout=10) as response:
            body = response.read()
            return body if path.startswith('/json/close/') else json.loads(body)

    def new_page(self):
        return HeadedPage(self)

    def close(self):
        if self.session is not None:
            with contextlib.suppress(Exception):
                self.session.close()
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
        self.log.close()
        for attempt in range(30):
            try:
                shutil.rmtree(self.profile)
                break
            except FileNotFoundError:
                break
            except OSError:
                if attempt == 29:
                    raise
                time.sleep(.1)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
