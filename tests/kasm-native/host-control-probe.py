"""Trusted local executor for the disposable native host qualification only.

Descriptors never become browser-reachable proxies. Revalidate the generation
and revision immediately before control and after readback; emit no endpoints.
"""
import importlib.util
import json
import os
import subprocess
import sys
import urllib.request
from urllib.parse import urlsplit

sys.dont_write_bytecode = True
descriptor = json.loads(sys.argv[1])
template = sys.argv[2]
assert os.environ.get('USER') == 'rxhost' and os.getuid() != 0
assert template in ['edge', 'firefox-esr', 'lightview', 'kate', 'kwrite', 'libreoffice', 'mousepad', 'xfce-user-desktop']

def current():
    request = urllib.request.Request('http://127.0.0.1:1995/api/instances/' + descriptor['instanceId'] + '/connections?sessionGeneration=' + str(descriptor['sessionGeneration']), headers={'X-RemoteXApp-Test-User': 'alpine-uat'})
    with urllib.request.urlopen(request, timeout=5) as response:
        value = json.load(response)
    assert value['revision'] == descriptor['revision']
    assert value['sessionGeneration'] == descriptor['sessionGeneration']

def module(name, filename):
    root = '/home/rxhost/enabled/' + template
    sys.path.insert(0, root)
    spec = importlib.util.spec_from_file_location(name, root + '/' + filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result

current()
environment = dict(os.environ, DISPLAY=descriptor['environment']['display'], XAUTHORITY=descriptor['environment']['xauthorityPath'])
if descriptor['environment'].get('sessionBus'):
    environment['DBUS_SESSION_BUS_ADDRESS'] = descriptor['environment']['sessionBus']['address']
subprocess.check_output(['xdotool', 'getdisplaygeometry'], env=environment, timeout=5)
application = descriptor.get('application') or {}
protocol = application.get('protocol', 'environment')
if template in ['edge', 'firefox-esr']:
    action = module('host_action', 'open-url.py')
    if template == 'edge':
        with urllib.request.urlopen('http://127.0.0.1:' + str(application['port']) + '/json/list', timeout=5) as response:
            targets = json.load(response)
        target = next(t for t in targets if t.get('type') == 'page' and t.get('url', '').startswith('http://127.0.0.1:1988/'))
        endpoint = urlsplit(target['webSocketDebuggerUrl'])
        sock, ws = action.connect('127.0.0.1', application['port'], endpoint.path)
        try:
            value = action.call(ws, 1, 'Runtime.evaluate', {'expression': 'document.querySelector("#marker").textContent', 'returnByValue': True})
            assert value['result']['value'] == 'Native template qualification'
        finally:
            sock.close()
    else:
        endpoint = urlsplit(application['endpoints']['webSocketUrl'])
        sock, ws = action.connect('127.0.0.1', application['port'], endpoint.path)
        try:
            action.call(ws, 1, 'session.new', {'capabilities': {}})
            try:
                tree = action.call(ws, 2, 'browsingContext.getTree', {})
                context = next(c for c in tree['contexts'] if c['url'].startswith('http://127.0.0.1:1988/'))['context']
                value = action.call(ws, 3, 'script.evaluate', {'expression': 'document.querySelector("#marker").textContent', 'target': {'context': context}, 'awaitPromise': True})
                assert value['result']['value'] == 'Native template qualification'
            finally:
                action.call(ws, 4, 'session.end', {})
        finally:
            sock.close()
elif template == 'lightview':
    control = module('host_control', 'control.py')
    value = control.request(application['socketPath'], 'eval', script='document.querySelector("#marker").textContent')
    assert 'Native template qualification' in json.dumps(value)
elif template in ['kate', 'kwrite']:
    target = application.get('uniqueName', application['service'])
    args = ['gdbus', 'call', '--address', environment['DBUS_SESSION_BUS_ADDRESS'], '--dest', target, '--object-path', application['objectPath']]
    subprocess.check_output(args + ['--method', 'org.freedesktop.DBus.Peer.Ping'], env=environment, timeout=5)
    value = subprocess.check_output(args + ['--method', application['interface'] + '.setCursor', '0', '0'], env=environment, timeout=5)
    assert b'true' in value
elif template == 'libreoffice':
    import uno
    context = uno.getComponentContext()
    resolver = context.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', context)
    remote = resolver.resolve('uno:socket,host=127.0.0.1,port=' + str(application['port']) + ';urp;StarOffice.ComponentContext')
    desktop = remote.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', remote)
    doc = desktop.getCurrentComponent()
    assert doc.supportsService('com.sun.star.text.TextDocument')
    assert 'Native document' in doc.Text.String
    doc.Text.String = 'Native document UNO 中文 readback'
    doc.store()
    assert doc.Text.String == 'Native document UNO 中文 readback'
else:
    names = subprocess.check_output(['gdbus', 'call', '--address', environment['DBUS_SESSION_BUS_ADDRESS'], '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus', '--method', 'org.freedesktop.DBus.ListNames'], env=environment, timeout=5)
    assert b'org.freedesktop.DBus' in names
current()
print(json.dumps({'protocol': protocol, 'currentGeneration': True, 'controlReadback': True}))
