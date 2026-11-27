#!/usr/bin/env python3
"""Public SDK lifecycle and natural/fault lanes in an owned local X11 fixture."""
import argparse
import contextlib
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import signal
import ssl
import struct
import subprocess
import time
import urllib.request
import uuid

from retirement_cdp import Browser, Page


def interrupted(_signum, _frame):
    raise KeyboardInterrupt('Owned test supervision stopped')


signal.signal(signal.SIGTERM, interrupted)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('fixture', type=Path)
    parser.add_argument('--browser', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--cycles', type=int, default=6)
    parser.add_argument('--natural-seconds', type=int, default=0)
    parser.add_argument('--expect', choices=['released', 'retained'], default='released')
    parser.add_argument('--instance')
    parser.add_argument('--keep-app', action='store_true')
    parser.add_argument('--fault-plan', type=Path, help='Owned preflight JSON of [elapsed seconds, fault name] pairs')
    args = parser.parse_args()
    if args.fault_plan and args.natural_seconds <= 0:
        parser.error('--fault-plan requires a timed preflight lane')
    config = json.loads(args.fixture.read_text())
    assert config['projectOwnedDisposable'] is True
    assert re.fullmatch(r'local:remotexapp-host-[a-z0-9-]+', config['container'])
    origin = config['origin']
    assert origin.startswith('https://127.0.0.1:')
    args.output.mkdir(parents=True, exist_ok=True, mode=0o700)
    root = args.fixture.resolve().parent
    report = {'status': 'preparing', 'browserSHA256': hashlib.sha256(args.browser.read_bytes()).hexdigest(),
        'microphoneInputSHA256': hashlib.sha256((root / 'mic-880.wav').read_bytes()).hexdigest(),
        'expected': args.expect, 'cycles': [], 'checks': [], 'samples': [], 'faults': [], 'noNetworkDomain': True}
    browser = page = background = None
    runtime = args.instance

    def save():
        (args.output / 'results.json').write_text(json.dumps(report, indent=2) + '\n')

    def log(name, value):
        with (args.output / name).open('a') as file:
            file.write(json.dumps(value) + '\n')

    def api(path, data=None):
        request = urllib.request.Request(origin + path, data=None if data is None else json.dumps(data).encode(),
            headers={'Content-Type': 'application/json', 'Origin': origin})
        with urllib.request.urlopen(request, context=ssl._create_unverified_context(), timeout=25) as response:
            return json.load(response)

    def fault(name):
        url = origin + '/fixture?action=' + name + '&runtime=' + runtime
        with urllib.request.urlopen(urllib.request.Request(url, method='POST', headers={'Origin': origin}),
                context=ssl._create_unverified_context(), timeout=30) as response:
            assert response.status == 204

    def owned(*command, stdin=None):
        result = subprocess.run(['sudo', '-n', 'lxc', 'exec', config['container'], '--', 'runuser', '-u', 'rxhost', '--',
            *command], input=stdin, capture_output=True, timeout=12, check=True)
        return result.stdout

    def click(name):
        page.front()
        page.evaluate('()=>{lab.reply=null}')
        page.click('#' + name)
        result = page.wait('()=>lab.reply', timeout=30)
        assert result['ok'], (name, result)

    def snap():
        return page.evaluate('()=>lab.snapshot()')

    def wait_audio(mic=True):
        page.wait('()=>{const s=lab.snapshot(),r=s.audio?.routes[0];return s.display?.state==="ready" && r?.actualSpeaker' +
            (' && r.actualMic && s.audio.sentBytes>0' if mic else '') + '}', timeout=40)

    def microphone():
        manifest = json.loads(owned('cat', config['state'] + '/runtime-manifests/' + runtime + '.json'))['runtime']
        audio = json.loads(owned('cat', manifest['runtimePath'] + '/session-services.json'))['audio']
        path = audio['root']
        code = """import subprocess,sys
p=subprocess.Popen(['parec','--device=rx_mic','--raw','--format=s16le','--rate=48000','--channels=1','--latency-msec=40'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
try:sys.stdout.buffer.write(p.stdout.read(48000))
finally:p.terminate();p.wait(timeout=2)
"""
        data = owned('env', 'PULSE_SERVER=unix:' + path + '/run/native', 'PULSE_COOKIE=' + path + '/cookie',
            'PULSE_CLIENTCONFIG=' + path + '/config/client.conf', 'python3', '-c', code)
        assert len(data) >= 12000
        peak = max(abs(value) for value, in struct.iter_unpack('<h', data))
        return peak

    def microphone_ready(label):
        # Route/capture readiness does not promise a first non-silent sample.
        # Observe actual fresh data without re-enabling, reconnecting or capture.
        deadline = time.monotonic() + 8
        windows = []
        consecutive = 0
        before = snap()
        while time.monotonic() < deadline:
            peak = microphone()
            current = snap()
            row = {'label':label, 'at':time.time(), 'peak':peak, 'captureRequests':current['requests'],
                'trackStops':current['stopped'], 'micFrames':current['micFrames'],
                'lastMicFrameAt':current['lastMicFrameAt'], 'audioConnection':current['audio']['connectionId']}
            windows.append(row)
            log('microphone-windows.jsonl', row)
            assert current['requests'] == before['requests'], 'Observation must not reopen capture'
            assert current['audio']['connectionId'] == before['audio']['connectionId'], 'Observation must not replace transport'
            consecutive = consecutive + 1 if peak > 250 else 0
            if consecutive == 2 and current['micFrames'] > before['micFrames']:
                return min(window['peak'] for window in windows[-2:])
        report['microphoneFailure'] = {'label':label,'before':before,'after':snap(),'windows':windows}
        save()
        raise AssertionError('Fresh synthetic microphone data missing after bounded observation')

    def clipboard(label):
        value = 'Audio retirement 中文🙂 ' + label
        target = api('/api/instances/' + runtime)
        display = target['display']
        assert re.fullmatch(r':\d+', display)
        authority = owned('python3', '-c', """from pathlib import Path
import os,sys
for p in Path('/proc').glob('[0-9]*/cmdline'):
 try:
  if p.stat().st_uid!=os.getuid():continue
  a=p.read_bytes().split(bytes([0]))
  if Path(os.fsdecode(a[0])).name=='Xkasmvnc' and os.fsencode(sys.argv[1]) in a:
   print(os.fsdecode(a[a.index(b'-auth')+1]));break
 except (FileNotFoundError,PermissionError):pass
""", display).decode().strip()
        assert authority.startswith('/home/rxhost/')
        env = ['env', 'DISPLAY=' + display, 'XAUTHORITY=' + authority]
        page.front()
        page.evaluate('()=>lab.owner.view.viewer.focus()')
        page.wait('()=>lab.owner.view.viewer.getClipboardState().effective.toLocal==="auto"')
        owned(*env, 'python3', '-c', """import subprocess,sys
subprocess.run(['xclip','-selection','clipboard','-in','-target','UTF8_STRING','-silent'],input=sys.stdin.buffer.read(),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
""", stdin=value.encode())
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            if page.evaluate('()=>navigator.clipboard.readText()') == value:
                break
            time.sleep(.15)
        else:
            raise AssertionError('Remote clipboard readback failed')
        local = value + ' local'
        page.evaluate('value=>navigator.clipboard.writeText(value)', local)
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            if owned(*env, 'xclip', '-selection', 'clipboard', '-out').decode() == local:
                break
            time.sleep(.15)
        else:
            raise AssertionError('Local clipboard readback failed')
        return {'bidirectional': True, 'bytes': len(local.encode())}

    def functional(label, clip=True):
        wait_audio()
        peak = microphone_ready(label)
        page.evaluate('()=>{lab.peak=0}')
        fault('tone')
        page.wait('()=>lab.peak>.02', timeout=8)
        row = {'label': label, 'at': time.time(), 'micPeak': peak, 'speakerPeak': snap()['peak']}
        if clip:
            row['clipboard'] = clipboard(label)
        report['checks'].append(row)
        log('functional.jsonl', row)

    def open_owner():
        click('open')
        click('speaker')
        click('mic')
        click('clipboard')
        wait_audio()

    def sample(start):
        snapshot = snap()
        metrics = {item['name']: item['value'] for item in page.session.send('Performance.getMetrics')['metrics']}
        processes = []
        for process in browser.session.send('SystemInfo.getProcessInfo')['processInfo']:
            try:
                memory = {}
                for line in Path('/proc/' + str(process['id']) + '/smaps_rollup').read_text().splitlines():
                    if line.split(':')[0] in ['Rss', 'Pss', 'Pss_Anon']:
                        key, value = line.split(':', 1)
                        memory[key + 'KiB'] = int(value.split()[0])
                processes.append({'type': process['type'], 'cpuTime': process['cpuTime'], **memory})
            except (FileNotFoundError, PermissionError):
                pass
        row = {'elapsedSeconds': time.monotonic() - start, 'at': time.time(), 'snapshot': snapshot,
            'hidden': page.evaluate('()=>document.hidden'), 'browserProcesses': processes,
            'heapBytes': metrics.get('JSHeapUsedSize'), 'nodes': metrics.get('Nodes'), 'listeners': metrics.get('JSEventListeners')}
        log('samples.jsonl', row)
        report['samples'].append({key: row[key] for key in ['elapsedSeconds', 'hidden', 'heapBytes', 'nodes', 'listeners']})
        if len(report['samples']) > 100:
            report['samples'] = report['samples'][:1] + report['samples'][-99:]
        return snapshot

    def server_sample():
        code = """import os,json
from pathlib import Path
rows=[]
for p in Path('/proc').glob('[0-9]*/comm'):
 try:
  if p.stat().st_uid!=os.getuid():continue
  name=p.read_text().strip()
  if name not in ['remotexappd','novnc-input','Xkasmvnc','pulseaudio','mousepad']:continue
  values={}
  for line in (p.parent/'smaps_rollup').read_text().splitlines():
   key,_,value=line.partition(':')
   if key in ['Rss','Pss','Pss_Anon']:values[key+'KiB']=int(value.split()[0])
  rows.append({'name':name,'pid':int(p.parent.name),**values})
 except (FileNotFoundError,PermissionError):pass
events=Path('/sys/fs/cgroup/memory.events')
print(json.dumps({'processes':rows,'memoryEvents':events.read_text() if events.exists() else None}))
"""
        row = json.loads(owned('python3', '-c', code))
        row['at'] = time.time()
        log('server-samples.jsonl', row)
        return row

    try:
        version = api('/api/version')
        assert version['commit'] == config['expectedCommit'][:12], version
        report['version'] = version
        if not runtime:
            runtime = api('/api/instances', {'templateId': 'mousepad', 'launchIntent': str(uuid.uuid4())})['id']
        assert api('/api/instances/' + runtime)['state'] in ['ready', 'server-ready'], 'Fixture App is stopped'
        report['runtime'] = runtime
        browser = Browser(args.browser, root / 'mic-880.wav', (root / 'loopback.spki').read_text().strip(), args.output)
        report['browserVersion'] = browser.version
        browser.permissions(origin)
        url = origin + '/retirement-host.html?instance=' + runtime + ('&baseline' if args.expect == 'retained' else '')
        page = Page(browser, url)
        page.wait('()=>typeof lab==="object" && (lab.error || typeof lab.snapshot==="function")')
        assert page.evaluate('()=>lab.error') is None
        background = Page(browser, 'about:blank')
        report['status'] = 'running'
        if args.natural_seconds:
            open_owner()
            functional('natural-start')
            initial = snap()
            start = time.monotonic()
            report['natural'] = {'durationSeconds': args.natural_seconds, 'startedAt': time.time(), 'noPeriodicGC': True}
            report['serverBefore'] = server_sample()
            report['generation'] = api('/api/instances/' + runtime)['sessionGeneration']
            faults = [(180, 'cut-viewer'), (360, 'cut-audio'), (540, 'lease-once'), (900, 'audio-block'),
                (1800, 'network-long'), (2700, 'freeze'), (3600, 'manager-restart'), (5400, 'capture-only'),
                (7200, 'suspended-retire')]
            if args.fault_plan:
                faults = json.loads(args.fault_plan.read_text())
                allowed = {'cut-viewer','cut-audio','lease-once','audio-block','network-long','freeze',
                    'manager-restart','capture-only','suspended-retire'}
                assert all(isinstance(t, int) and t >= 0 and name in allowed for t, name in faults)
                assert faults == sorted(faults, key=lambda item:item[0])
                report['faultPlanSHA256'] = hashlib.sha256(args.fault_plan.read_bytes()).hexdigest()
            next_function = 120
            next_visibility = 60
            next_server = 60
            visible = True
            while time.monotonic() - start < args.natural_seconds:
                elapsed = time.monotonic() - start
                if faults and elapsed >= faults[0][0]:
                    _, name = faults.pop(0)
                    before = snap()
                    if name == 'audio-block':
                        fault(name)
                        fault('cut-audio')
                        time.sleep(20)
                        fault('audio-unblock')
                        wait_audio(False)
                        page.wait('()=>lab.snapshot().audio.routes[0].microphoneActionRequired')
                        assert snap()['requests'] == before['requests']
                        click('mic')
                    elif name == 'network-long':
                        fault('network-block')
                        fault('cut-viewer')
                        fault('cut-audio')
                        time.sleep(40)
                        fault('network-unblock')
                        wait_audio(False)
                        assert snap()['requests'] == before['requests']
                        click('mic')
                    elif name == 'freeze':
                        page.evaluate("()=>document.dispatchEvent(new Event('freeze'))")
                        page.evaluate("()=>document.dispatchEvent(new Event('resume'))")
                        page.wait('()=>lab.snapshot().audio.routes[0].microphoneActionRequired')
                        assert snap()['requests'] == before['requests']
                        click('mic')
                    elif name == 'capture-only':
                        click('mic-off')
                        page.wait('()=>!lab.snapshot().audio.routes[0].actualMic')
                        assert snap()['audio']['connectionId'] == before['audio']['connectionId']
                        click('mic')
                    elif name == 'suspended-retire':
                        click('suspend')
                        click('dispose')
                        assert snap()['stopped'] == snap()['requests']
                        open_owner()
                    else:
                        fault(name)
                    wait_audio()
                    assert api('/api/instances/' + runtime)['sessionGeneration'] == report['generation']
                    report['faults'].append({'name': name, 'elapsedSeconds': elapsed})
                    functional('after-' + name)
                if elapsed >= next_function:
                    functional('natural-' + str(int(elapsed)))
                    next_function += 120
                if elapsed >= next_visibility:
                    visible = not visible
                    (page if visible else background).front()
                    next_visibility += 60
                if not visible:
                    background.front()
                current = sample(start)
                assert current['display']['state'] == 'ready', current['display']['state']
                assert current['audio']['routes'][0]['actualMic'] and current['audio']['routes'][0]['actualSpeaker']
                report['natural']['elapsedSeconds'] = time.monotonic() - start
                if elapsed >= next_server:
                    server_sample()
                    next_server += 60
                save()
                time.sleep(min(10, max(0, args.natural_seconds - (time.monotonic() - start))))
            report['natural']['elapsedSeconds'] = time.monotonic() - start
            if args.fault_plan and faults:
                report['unexecutedFaults'] = faults
                raise AssertionError('Timed preflight ended before all requested faults ran')
            report['natural']['completedNaturally'] = True
            functional('natural-end')
            report['serverAfter'] = server_sample()
            click('dispose')
        # Only now enter the separate diagnostic-GC lifecycle lane.
        spec = importlib.util.spec_from_file_location('retirement_snapshot', Path(__file__).with_name('browser-retirement.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        report['baselineHeap'] = module.snapshot(page.session, args.output / 'baseline.heapsnapshot')
        for cycle in range(args.cycles):
            open_owner()
            functional('cycle-' + str(cycle))
            if cycle == 0 and args.expect == 'released':
                for iteration in range(3):
                    acknowledgements = snap()['acks']
                    click('mic-off')
                    page.wait('()=>!lab.snapshot().audio.routes[0].actualMic')
                    page.wait('()=>lab.acks>' + str(acknowledgements))
                    counts = module.snapshot(page.session, args.output / ('capture-off-' + str(iteration) + '.heapsnapshot'))
                    assert counts == {'AudioContext': 1, 'AudioWorkletNode': 1, 'blink::AudioWorkletMessagingProxy': 1}, counts
                    click('mic')
                    functional('capture-churn-' + str(iteration), clip=False)
                click('suspend')
                page.wait('()=>lab.snapshot().audio.routes[0].microphoneActionRequired')
                click('mic')
                functional('suspended-capture-resume', clip=False)
                click('speaker-off')
                context_closes = snap()['closedContexts']
                for iteration in range(3):
                    click('mic-off')
                    page.wait('()=>lab.owner.host._audio.context.state==="suspended" && !lab.snapshot().audio.routes[0].actualMic')
                    time.sleep(.25)
                    assert page.evaluate('()=>lab.owner.host._audio.context.state') == 'suspended'
                    click('mic')
                    page.wait('()=>lab.snapshot().audio.routes[0].actualMic')
                    peak = microphone_ready('mic-only-resume-' + str(iteration))
                    page.wait('()=>lab.owner.host._audio.retirements.size===0')
                    counts = module.snapshot(page.session, args.output / ('mic-only-resume-' + str(iteration) + '.heapsnapshot'))
                    assert counts == {'AudioContext': 1, 'AudioWorkletNode': 2, 'blink::AudioWorkletMessagingProxy': 1}, counts
                    assert snap()['closedContexts'] == context_closes
                    report['checks'].append({'label':'mic-only-resume-' + str(iteration), 'micPeak':peak})
                click('speaker')
                functional('mic-only-owner-preserves-context', clip=False)
            if cycle % 3 == 1:
                before = snap()
                click('mic-off')
                page.wait('()=>!lab.snapshot().audio.routes[0].actualMic')
                click('mic')
                functional('capture-resume-' + str(cycle), clip=False)
                assert snap()['audio']['connectionId'] == before['audio']['connectionId']
            if cycle % 3 == 2:
                click('suspend')
            click('logout' if cycle % 4 == 3 else 'dispose')
            audit = snap()
            assert audit['requests'] == audit['stopped'], audit
            if args.expect == 'released':
                assert audit['stopped'] == audit['immediateStopped'], audit
            page.wait('()=>lab.closedContexts===lab.done')
            assert audit['error'] is None and not page.errors
            report['cycles'].append(audit)
            if cycle in [0, args.cycles // 2, args.cycles - 1]:
                counts = module.snapshot(page.session, args.output / ('cycle-' + str(cycle) + '.heapsnapshot'))
                report.setdefault('nativeCounts', {})[str(cycle)] = counts
                if args.expect == 'released':
                    assert all(counts[key] == value for key, value in report['baselineHeap'].items()), counts
            save()
        # No reload, exit, navigation or synthetic memory pressure at this endpoint.
        idle = 80 if args.cycles >= 50 else 10
        idle_start = time.monotonic()
        while time.monotonic() - idle_start < idle:
            time.sleep(5)
        report['idleSeconds'] = time.monotonic() - idle_start
        report['finalNativeCounts'] = module.snapshot(page.session, args.output / 'idle.heapsnapshot')
        if args.expect == 'released':
            assert report['finalNativeCounts'] == report['baselineHeap']
        else:
            assert all(report['finalNativeCounts'][key] - value >= args.cycles for key, value in report['baselineHeap'].items())
        report['status'] = 'passed'
    except BaseException as error:
        report['status'] = 'failed'
        report['error'] = type(error).__name__ + ': ' + str(error)
        raise
    finally:
        cleanup_errors = []
        if page:
            report['browserErrors'] = list(page.errors)
            try:
                page.evaluate('async()=>{if(typeof lab!=="object")return;try{if(lab.owner)await lab.owner.host.dispose();}finally{if(lab.releaseKeeper)await lab.releaseKeeper();lab.owner=null;}}')
            except Exception as error:
                cleanup_errors.append('SDK retirement: ' + type(error).__name__)
            with contextlib.suppress(Exception):
                page.close()
        if background:
            with contextlib.suppress(Exception):
                background.close()
        if browser:
            try:
                browser.close()
            except Exception as error:
                cleanup_errors.append('browser: ' + type(error).__name__)
        if runtime and not args.keep_app:
            try:
                fault('network-unblock')
                fault('audio-unblock')
                instance = api('/api/instances/' + runtime)
                api('/api/instances/' + runtime + '/stop', {'sessionGeneration': instance['sessionGeneration'], 'force': True})
                final_instance = api('/api/instances/' + runtime)
                report['appStopped'] = final_instance['state'] == 'stopped' and not final_instance.get('attachedClients')
                if not report['appStopped']:
                    cleanup_errors.append('App not stopped')
            except Exception as error:
                cleanup_errors.append('App: ' + type(error).__name__)
        report['ownedBrowserClosed'] = browser is None or browser.process.poll() is not None
        report['cleanupErrors'] = cleanup_errors
        if cleanup_errors:
            report['status'] = 'failed'
        save()
        print(json.dumps({key: value for key, value in report.items() if key not in ['samples', 'cycles', 'checks']}), flush=True)
        if cleanup_errors:
            raise RuntimeError('Owned fixture cleanup failed: ' + ', '.join(cleanup_errors))


if __name__ == '__main__':
    main()
