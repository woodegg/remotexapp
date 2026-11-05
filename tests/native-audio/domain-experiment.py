#!/usr/bin/env python3
"""Same-UID Pulse routing experiment; synthetic signals only, no device modules."""
import argparse
import array
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import signal
import subprocess
import sys
import tempfile
import time

RATE = 48000
FREQUENCIES = [440, 660, 880, 1100]
WINDOW = RATE // 10
BASIS = {f: ([math.cos(2 * math.pi * f * i / RATE) for i in range(WINDOW)],
             [math.sin(2 * math.pi * f * i / RATE) for i in range(WINDOW)]) for f in FREQUENCIES}


def process_identity(pid):
    stat = Path('/proc', str(pid), 'stat').read_text()
    return stat[stat.rfind(')') + 1:].split()[19]


def account_state():
    processes = {}
    for entry in Path('/proc').glob('[0-9]*'):
        try:
            if (entry / 'comm').read_text().strip() in ('pulseaudio', 'pipewire', 'wireplumber'):
                processes[int(entry.name)] = process_identity(entry.name)
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            pass
    files = {}
    for base in (Path.home() / '.pulse', Path.home() / '.config/pulse'):
        if base.exists():
            for entry in base.rglob('*'):
                if entry.is_file() and not entry.is_symlink():
                    files[str(entry)] = hashlib.sha256(entry.read_bytes()).hexdigest()
    return processes, files


class Domain:
    def __init__(self, root, name):
        self.root = root / name
        self.root.mkdir(mode=0o700)
        for part in ('run', 'state', 'config'):
            (self.root / part).mkdir(mode=0o700)
        self.socket = self.root / 'run/native'
        self.cookie = self.root / 'cookie'
        self.cookie.write_bytes(os.urandom(256)); self.cookie.chmod(0o600)
        (self.root / 'config/daemon.conf').write_text('enable-shm = no\n')
        (self.root / 'config/client.conf').write_text('autospawn = no\nenable-shm = no\n')
        self.env = {k: v for k, v in os.environ.items() if k not in ('DISPLAY', 'WAYLAND_DISPLAY') and not k.startswith('PULSE_')}
        self.env.update(PULSE_RUNTIME_PATH=str(self.root / 'run'), PULSE_STATE_PATH=str(self.root / 'state'),
                        PULSE_CONFIG_PATH=str(self.root / 'config'), PULSE_CLIENTCONFIG=str(self.root / 'config/client.conf'),
                        PULSE_SERVER='unix:' + str(self.socket), PULSE_COOKIE=str(self.cookie),
                        PULSE_SINK='rx_speaker', PULSE_SOURCE='rx_mic',
                        DBUS_SESSION_BUS_ADDRESS='unix:path=' + str(self.root / 'no-bus'))
        script = '\n'.join([
            'load-module module-native-protocol-unix socket=' + str(self.socket) + ' auth-anonymous=0 auth-cookie=' + str(self.cookie),
            'load-module module-null-sink sink_name=rx_speaker rate=48000 channels=2 norewinds=1',
            'load-module module-null-sink sink_name=rx_mic_in rate=48000 channels=1 channel_map=mono norewinds=1',
            'load-module module-remap-source master=rx_mic_in.monitor source_name=rx_mic master_channel_map=mono channel_map=mono remix=no',
            'set-default-sink rx_speaker', 'set-default-source rx_mic', ''])
        (self.root / 'start.pa').write_text(script)
        self.log = (self.root / 'pulse.log').open('wb')
        self.process = subprocess.Popen(['pulseaudio', '--daemonize=no', '--system=no', '--fail=yes', '--use-pid-file=no',
            '--exit-idle-time=-1', '--high-priority=no', '--realtime=no', '--disable-shm=yes', '--log-target=stderr',
            '-n', '--file=' + str(self.root / 'start.pa')], env=self.env, stdout=self.log, stderr=self.log, start_new_session=True)
        self.identity = process_identity(self.process.pid)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                raise RuntimeError('private Pulse startup failed: ' + (self.root / 'pulse.log').read_text()[-1800:])
            if self.command('info', check=False).returncode == 0:
                break
            time.sleep(.05)
        else:
            self.stop(); raise RuntimeError('private Pulse readiness timed out')

    def command(self, *args, check=True):
        return subprocess.run(['pactl', *args], env=self.env, capture_output=True, text=True, timeout=3, check=check)

    def stop(self, crash=False):
        if self.process.poll() is None:
            assert process_identity(self.process.pid) == self.identity
            self.process.send_signal(signal.SIGKILL if crash else signal.SIGTERM)
            self.process.wait(timeout=5)
        self.log.close()

    def resources(self):
        data = Path('/proc', str(self.process.pid), 'smaps_rollup').read_text().splitlines()
        memory = {line.split(':')[0]: int(line.split()[1]) for line in data if line.startswith(('Rss:', 'Pss:', 'Pss_Anon:'))}
        return {'memoryKiB': memory, 'fdCount': len(list(Path('/proc', str(self.process.pid), 'fd').iterdir()))}


def pcm(frequency, duration):
    result = array.array('h', (int(6000 * math.sin(2 * math.pi * frequency * i / RATE)) for i in range(int(RATE * duration))))
    if sys.byteorder != 'little': result.byteswap()
    return result.tobytes()


def wave_round(root, domains, label, active):
    captures, children, handles = {}, [], []
    try:
        for index, (domain, kind) in enumerate((d, k) for d in domains for k in ('speaker', 'mic')):
            path = root / (label + '-' + str(index) + '.pcm'); out = path.open('wb'); handles.append(out)
            args = ['parec', '--raw', '--format=s16le', '--rate=48000', '--channels=1', '--latency-msec=20']
            if kind == 'speaker': args += ['--device=rx_speaker.monitor']
            child = subprocess.Popen(args, env=domain.env, stdout=out, stderr=subprocess.DEVNULL)
            children.append(child); captures[(domain.root.name, kind)] = path
        time.sleep(.25)
        for domain, kind, frequency in active:
            path = root / ('tone-' + str(frequency) + '.pcm'); path.write_bytes(pcm(frequency, 1.5))
            source = path.open('rb'); handles.append(source)
            env = dict(domain.env)
            if kind == 'mic': env['PULSE_SINK'] = 'rx_mic_in'
            child = subprocess.Popen(['pacat', '--playback', '--raw', '--format=s16le', '--rate=48000', '--channels=1', '--latency-msec=20'],
                env=env, stdin=source, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            children.append(child)
        time.sleep(2.2)
    finally:
        for child in children:
            if child.poll() is None: child.terminate()
            child.wait(timeout=5)
        for handle in handles: handle.close()
    results = []
    expected = {(d.root.name, kind): freq for d, kind, freq in active}
    for key, path in captures.items():
        samples = array.array('h'); samples.frombytes(path.read_bytes())
        if sys.byteorder != 'little': samples.byteswap()
        assert len(samples) >= RATE, ('capture did not yield enough real Pulse samples', label, key, len(samples))
        # Find steady 100 ms windows: startup and drain timing are independent of
        # routing. Require multiple strong windows and inspect every silent route.
        windows = []
        for start in range(0, len(samples) - WINDOW, WINDOW // 2):
            values = samples[start:start + WINDOW]
            windows.append({f: 2 * math.hypot(sum(v*c for v,c in zip(values, basis[0])),
                sum(v*c for v,c in zip(values, basis[1]))) / WINDOW for f,basis in BASIS.items()})
        target = expected.get(key)
        if target:
            peak = max(w[target] for w in windows)
            steady = [w for w in windows if w[target] > max(3000, peak * .98)]
            assert len(steady) >= 3, (label, key, 'expected steady tone absent', max(w[target] for w in windows))
            amplitudes = max(steady, key=lambda w:w[target])
            assert all(max(v for f,v in w.items() if f != target) < w[target] * .005 for w in steady), (label, key, 'cross-route tone', [{'expected':w[target],'others':{f:v for f,v in w.items()if f!=target}}for w in steady])
        else:
            amplitudes = {f:max(w[f] for w in windows) for f in FREQUENCIES}
            assert max(amplitudes.values()) < 10, (label, key, 'inactive route received tone', amplitudes)
        results.append({'domain':key[0], 'route':key[1], 'expectedHz':target, 'toneAmplitudes':{str(k):round(v,3) for k,v in amplitudes.items()}})
    return {'case':label, 'readbacks':results}


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--output', type=Path, required=True); args = parser.parse_args()
    if os.getuid() == 0: raise SystemExit('Run as the selected non-root application UID')
    before = account_state(); domains = []; results = []
    with tempfile.TemporaryDirectory(prefix='rxa-audio-') as temporary:
        root = Path(temporary)
        try:
            a = Domain(root, 'a-generation-1'); domains.append(a)
            b = Domain(root, 'b-generation-1'); domains.append(b)
            versions = subprocess.check_output(['pulseaudio','--version'], text=True).strip()
            resources = {'a':a.resources(), 'b':b.resources()}
            results.append(wave_round(root, [a,b], 'all-four-routes', [(a,'speaker',440),(b,'speaker',660),(a,'mic',880),(b,'mic',1100)]))
            results.append(wave_round(root, [a,b], 'only-b-speaker-a-mic', [(b,'speaker',660),(a,'mic',880)]))
            a.stop()
            assert a.command('info',check=False).returncode != 0
            results.append(wave_round(root, [b], 'b-survives-a-stop', [(b,'speaker',660),(b,'mic',1100)]))
            anew = Domain(root, 'a-generation-2'); domains.append(anew)
            assert anew.socket != a.socket and a.command('info',check=False).returncode != 0
            results.append(wave_round(root, [anew,b], 'new-generation-old-endpoint-rejected', [(anew,'speaker',440),(b,'speaker',660),(anew,'mic',880),(b,'mic',1100)]))
            anew.stop(crash=True)
            assert anew.command('info',check=False).returncode != 0
            results.append(wave_round(root, [b], 'b-survives-a-crash', [(b,'speaker',660),(b,'mic',1100)]))
        finally:
            for domain in domains: domain.stop()
        assert all(d.process.poll() is not None for d in domains)
    after = account_state(); assert before == after, 'borrowed account audio processes/configuration changed'
    record = {'schema':1,'scope':'same-uid-synthetic-pulse-routing','platform':platform.system()+' '+platform.machine(),
        'pulse':versions,'sameNonRootUID':True,'sampleRate':RATE,'nullSinkNoRewinds':True,'signalAmplitude':6000,'minimumExpectedAmplitude':3000,
        'maximumRelativeCrossTone':.005,'maximumInactiveAmplitude':10,'cases':results,'initialIdleResources':resources,
        'cleanup':{'ownedProcessesReaped':True,'temporarySocketsAndFilesRemoved':not root.exists(),'accountAudioProcessesAndConfigPreserved':True},
        'notQualified':['Manager/SDK integration','physical audio devices','browser/WAN quality','malicious same-UID security isolation','long-duration resource trend']}
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(record,indent=2)+'\n')
    print(json.dumps({'passed':True,'cases':len(results),'pulse':versions,'cleanup':record['cleanup']}))


if __name__ == '__main__': main()
