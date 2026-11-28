"""Private, hardware-free Pulse devices for headed browser fault tests.

This helper never changes the account's default Pulse server. Pass ``env`` to
the owned browser/clients. A pipe source carries a live, changeable marker;
``output.monitor`` observes actual browser playback instead of SDK counters.
All runtime paths must remain in private evidence, outside the repository.
"""
import array
import contextlib
import json
import math
import os
from pathlib import Path
import selectors
import shutil
import subprocess
import sys
import tempfile
import threading
import time


def pcm_summary(data, channels=1, expected_hz=None, rate=48000):
    samples = array.array('h')
    samples.frombytes(data[:len(data) - len(data) % (2 * channels)])
    if sys.byteorder != 'little':
        samples.byteswap()
    samples = samples[::channels]
    count = len(samples)
    square = sum(value * value for value in samples)
    result = {'frames': count, 'peak': max(map(abs, samples), default=0),
              'rms': math.sqrt(square / count) if count else 0}
    if expected_hz is not None and count:
        # Normalized energy at the new marker distinguishes fresh PCM from
        # silence or an old buffered frequency after recovery.
        real = sum(value * math.cos(2 * math.pi * expected_hz * i / rate)
                   for i, value in enumerate(samples))
        imag = sum(value * math.sin(2 * math.pi * expected_hz * i / rate)
                   for i, value in enumerate(samples))
        result['expectedHz'] = expected_hz
        result['markerEnergyFraction'] = (
            2 * (real * real + imag * imag) / (count * square) if square else 0)
    return result


def capture(env, device, seconds=.5, channels=1, expected_hz=None, timeout=5):
    """Capture a bounded PCM window; no unbounded read on a missing device."""
    needed = round(seconds * 48000) * channels * 2
    process = subprocess.Popen([
        'parec', '--device=' + device, '--raw', '--format=s16le',
        '--rate=48000', '--channels=' + str(channels), '--latency-msec=20'],
        env=env, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    data = bytearray()
    try:
        with selectors.DefaultSelector() as ready:
            ready.register(process.stdout, selectors.EVENT_READ)
            deadline = time.monotonic() + timeout
            while len(data) < needed:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError('Private Pulse capture did not produce a full window')
                if not ready.select(min(remaining, .2)):
                    if process.poll() is not None:
                        raise RuntimeError('Private Pulse capture exited early')
                    continue
                chunk = os.read(process.stdout.fileno(), min(65536, needed - len(data)))
                if not chunk:
                    raise RuntimeError('Private Pulse capture reached EOF')
                data.extend(chunk)
    finally:
        if process.poll() is None:
            process.terminate()
        process.wait(timeout=3)
        process.stdout.close()
    return pcm_summary(data, channels, expected_hz)


class VirtualPulse:
    def __init__(self, output):
        self.output = Path(output)
        self.output.mkdir(parents=True, exist_ok=True)
        runtime = Path(os.environ.get('XDG_RUNTIME_DIR', '/run/user/' + str(os.getuid())))
        if runtime.stat().st_uid != os.getuid():
            raise RuntimeError('Private Pulse runtime parent is not owned by this UID')
        # Short paths avoid the Unix-domain socket length limit.
        self.root = Path(tempfile.mkdtemp(prefix='rx-audio-', dir=runtime))
        self.process = None
        self.thread = None
        self.stop = threading.Event()
        self.lock = threading.Lock()
        self.frequency = 880
        self.source_module = None
        self.writer_error = None
        self.log = None
        self.env = {key: value for key, value in os.environ.items()
                    if not key.startswith('PULSE_')}
        self.env.update(PULSE_SERVER='unix:' + str(self.root / 'native'),
                        PULSE_COOKIE=str(self.root / 'cookie'),
                        PULSE_CLIENTCONFIG=str(self.root / 'client.conf'),
                        PULSE_CONFIG_PATH=str(self.root / 'config'),
                        PULSE_STATE_PATH=str(self.root / 'state'),
                        PULSE_RUNTIME_PATH=str(self.root / 'run'),
                        DBUS_SESSION_BUS_ADDRESS='unix:path=' + str(self.root / 'no-bus'))

    def pactl(self, *args):
        return subprocess.check_output(['pactl', *args], env=self.env,
                                       stderr=subprocess.PIPE, timeout=5, text=True).strip()

    def start(self):
        for name in ['run', 'config', 'state']:
            (self.root / name).mkdir(mode=0o700)
        (self.root / 'cookie').write_bytes(os.urandom(256))
        (self.root / 'cookie').chmod(0o600)
        (self.root / 'client.conf').write_text('autospawn = no\nenable-shm = no\n')
        config = self.root / 'daemon.pa'
        config.write_text(
            'load-module module-native-protocol-unix socket=' + str(self.root / 'native') +
            ' auth-cookie=' + str(self.root / 'cookie') + '\n' +
            'load-module module-null-sink sink_name=output rate=48000 channels=2 '
            'format=s16le norewinds=1\nset-default-sink output\n')
        self.log = (self.output / 'pulse.log').open('w')
        self.process = subprocess.Popen([
            'pulseaudio', '-n', '--daemonize=no', '--use-pid-file=no',
            '--exit-idle-time=-1', '--disallow-exit', '--high-priority=no',
            '--realtime=no', '--disable-shm=yes', '--file=' + str(config)],
            env=self.env, stdout=self.log, stderr=self.log)
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                raise RuntimeError('Private Pulse server exited during startup')
            try:
                self.pactl('info')
                break
            except subprocess.CalledProcessError:
                time.sleep(.05)
        else:
            raise TimeoutError('Private Pulse server socket did not become ready')
        self.restore_source()
        self.thread = threading.Thread(target=self._write, name='private-pulse-marker', daemon=True)
        self.thread.start()
        return self

    def set_marker(self, hz):
        if not 100 <= hz <= 4000:
            raise ValueError('Use a 100–4000 Hz synthetic marker')
        with self.lock:
            self.frequency = hz

    def remove_source(self):
        if self.source_module is not None:
            self.pactl('unload-module', str(self.source_module))
            self.source_module = None

    def restore_source(self):
        if self.source_module is not None:
            raise RuntimeError('Private microphone already exists')
        self.source_module = int(self.pactl(
            'load-module', 'module-pipe-source', 'source_name=input',
            'file=' + str(self.root / 'input.fifo'), 'format=s16le', 'rate=48000',
            'channels=1', 'channel_map=mono'))
        self.pactl('set-default-source', 'input')

    def _write(self):
        fd = None
        identity = None
        try:
            phase = 0.0
            deadline = time.monotonic()
            while not self.stop.is_set():
                try:
                    inode = (self.root / 'input.fifo').stat().st_ino
                except FileNotFoundError:
                    self.stop.wait(.01)
                    continue
                if identity != inode:
                    if fd is not None:
                        os.close(fd)
                    fd = os.open(self.root / 'input.fifo', os.O_RDWR | os.O_NONBLOCK)
                    identity = inode
                    phase = 0.0
                with self.lock:
                    hz = self.frequency
                samples = array.array('h', (round(9000 * math.sin(
                    phase + 2 * math.pi * hz * i / 48000)) for i in range(480)))
                if sys.byteorder != 'little':
                    samples.byteswap()
                try:
                    # <= PIPE_BUF: a nonblocking write is all-or-nothing. A
                    # removed device can fill the FIFO; never grow a queue.
                    count = os.write(fd, samples.tobytes())
                    if count != len(samples) * 2:
                        raise RuntimeError('Partial synthetic PCM pipe write')
                    phase = (phase + 2 * math.pi * hz * 480 / 48000) % (2 * math.pi)
                except BlockingIOError:
                    pass
                deadline += .01
                self.stop.wait(max(0, deadline - time.monotonic()))
                if deadline < time.monotonic() - .1:
                    deadline = time.monotonic()
        except BaseException as error:
            self.writer_error = repr(error)
        finally:
            if fd is not None:
                os.close(fd)

    def close(self):
        self.stop.set()
        if self.thread is not None:
            self.thread.join(timeout=3)
            if self.thread.is_alive():
                raise RuntimeError('Private PCM writer did not stop')
        if self.process is not None:
            if self.process.poll() is None:
                self.process.terminate()
            self.process.wait(timeout=5)
        if self.log is not None:
            self.log.close()
        shutil.rmtree(self.root)

    def __enter__(self):
        try:
            return self.start()
        except BaseException:
            with contextlib.suppress(Exception):
                self.close()
            raise

    def __exit__(self, *_):
        self.close()


def main():
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    report = {'status': 'running', 'scope': 'Private Pulse fixture only; not SDK or browser qualification',
              'checks': []}
    args.output.mkdir(parents=True, exist_ok=True)
    def steady(pulse, hz):
        windows = []
        consecutive = 0
        for _ in range(8):
            value = capture(pulse.env, 'input', expected_hz=hz)
            windows.append(value)
            consecutive = consecutive + 1 if value['markerEnergyFraction'] > .9 else 0
            if consecutive == 2:
                return windows
        raise AssertionError({'markerHz': hz, 'noTwoSteadyWindows': windows})
    try:
        with VirtualPulse(args.output) as pulse:
            for hz in [660, 1100]:
                pulse.set_marker(hz)
                time.sleep(.25)
                windows = steady(pulse, hz)
                report['checks'].append({'name': 'live-source-' + str(hz), 'windows': windows})
            pulse.remove_source()
            assert not any(line.split()[1] == 'input' for line in pulse.pactl('list', 'short', 'sources').splitlines())
            pulse.restore_source()
            pulse.set_marker(1540)
            time.sleep(.25)
            windows = steady(pulse, 1540)
            report['checks'].append({'name': 'source-module-replacement', 'windows': windows})
            assert pulse.writer_error is None, pulse.writer_error
        report.update(status='passed', cleanup=True)
    except BaseException as error:
        report.update(status='failed', error=repr(error))
        raise
    finally:
        (args.output / 'results.json').write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
