"""Synthetic waveform probe for the owned rxhost account, never physical audio."""
import array
import json
import math
import os
import re
import subprocess
import sys
from pathlib import Path

assert os.getuid() != 0 and os.environ.get('USER') == 'rxhost'
instance, operation = sys.argv[1:3]
assert re.fullmatch(r'mousepad-[a-f0-9]+', instance)
root = Path('/home/rxhost/state/instances') / instance
record = json.loads((root / 'session-services.json').read_text())['audio']
assert record['state'] == 'ready'
audio = Path(record['root'])
assert audio.is_relative_to(root) or audio.is_relative_to('/run/user/1004/remotexappd')
environment = dict(os.environ, PULSE_SERVER='unix:' + str(audio / 'run/native'), PULSE_COOKIE=str(audio / 'cookie'))
if operation == 'tone':
    frequency = int(sys.argv[3])
    assert frequency in (440, 660)
    samples = array.array('h', (int(10000 * math.sin(2 * math.pi * frequency * i / 48000)) for i in range(48000 * 4)))
    if sys.byteorder != 'little':
        samples.byteswap()
    wave = root / 'qualification-tone.pcm'
    wave.write_bytes(samples.tobytes())
    with wave.open('rb') as source:
        process = subprocess.Popen(['pacat', '--playback', '--raw', '--format=s16le', '--rate=48000', '--channels=1', '--device=rx_speaker'], env=environment, stdin=source, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    print(json.dumps({'pid': process.pid}))
elif operation == 'readback':
    process = subprocess.Popen(['parec', '--raw', '--format=s16le', '--rate=48000', '--channels=1', '--device=rx_mic', '--latency-msec=20'], env=environment, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        try:
            process.communicate(timeout=1.5)
        except subprocess.TimeoutExpired:
            process.terminate()
        data = process.communicate(timeout=3)[0]
    finally:
        if process.poll() is None:
            process.kill()
        process.wait(timeout=3)
    samples = array.array('h')
    samples.frombytes(data[:len(data) // 2 * 2])
    if sys.byteorder != 'little':
        samples.byteswap()
    assert len(samples) >= 4800
    peak = 0
    for start in range(0, len(samples) - 4800, 2400):
        block = samples[start:start + 4800]
        re_value = sum(v * math.cos(2 * math.pi * 880 * i / 48000) for i, v in enumerate(block))
        im_value = sum(v * math.sin(2 * math.pi * 880 * i / 48000) for i, v in enumerate(block))
        peak = max(peak, 2 * math.hypot(re_value, im_value) / 4800)
    print(json.dumps({'samples': len(samples), 'tone880': round(peak, 2)}))
else:
    raise ValueError('unknown operation')
