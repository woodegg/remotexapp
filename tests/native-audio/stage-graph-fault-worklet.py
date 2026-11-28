#!/usr/bin/env python3
"""Stage an owned test Worklet with actual processor throws; never install it."""
import argparse
import hashlib
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path(__file__).resolve().parents[2] / 'cmd/remotexappd/web/sdk/audio-worklet.js')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--ignore-dispose', action='store_true', help='Also stage an owned missing-terminal-ACK fault')
    args = parser.parse_args()
    assert not args.output.exists(), 'Refuse to overwrite a staged or production file'
    assert not args.output.resolve().is_relative_to(args.source.resolve().parent), 'Use a private fixture directory outside the SDK'
    source = args.source.read_text()
    for kind, name in [('playback', 'RemoteXAppPlayback'), ('capture', 'RemoteXAppCapture')]:
        original = "registerProcessor('remotexapp-" + kind + "-v1'," + name + ");"
        replacement = """registerProcessor('remotexapp-%s-v1',class extends %s {
  constructor(){super();const receive=this.port.onmessage;this.port.onmessage=event=>{if(event.data.fixtureThrow===true)this.fixtureThrow=true;else receive(event);};}
  process(...args){if(this.fixtureThrow)throw Error('Owned fixture processor failure');return super.process(...args);}
});""" % (kind, name)
        assert source.count(original) == 1, 'Unsupported or already instrumented Worklet'
        source = source.replace(original, replacement)
    if args.ignore_dispose:
        marker = 'if(event.data.fixtureThrow===true)this.fixtureThrow=true;else receive(event);'
        assert source.count(marker) == 2
        source = source.replace(marker, "if(event.data.fixtureIgnoreDispose===true)this.fixtureIgnoreDispose=true;else if(event.data.op==='dispose'&&this.fixtureIgnoreDispose)return;else " + marker)
    args.output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with args.output.open('x') as output:
        output.write(source)
    print(hashlib.sha256(args.output.read_bytes()).hexdigest())


if __name__ == '__main__':
    main()
