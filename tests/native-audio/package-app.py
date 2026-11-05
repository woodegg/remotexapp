#!/usr/bin/env python3
"""Build the immutable UAT-only X11 audio App Package (GNU tar required)."""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--goarch', choices=['amd64', 'arm64'], required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    source = ROOT / 'tests/kasm-native/alpine-apps/alpine-audio-test'
    manifest = json.loads((source / 'manifest.json').read_text())
    archive = output / (manifest['id'] + '-' + manifest['driverVersion'] + '.tar.gz')
    if archive.exists():
        raise SystemExit('Refusing to overwrite an existing App Package')
    env = dict(os.environ, GOOS='linux', GOARCH=args.goarch, CGO_ENABLED='0', SOURCE_DATE_EPOCH='0')
    with tempfile.TemporaryDirectory(prefix='rxa-audio-package-') as directory:
        stage = Path(directory) / 'app'
        shutil.copytree(source, stage)
        (stage / 'bin').mkdir()
        binary = stage / 'bin/remotexapp-audio-test'
        # Package identity depends on this App's inputs, not unrelated Core commits.
        subprocess.run(['go', 'build', '-trimpath', '-buildvcs=false', '-ldflags=-s -w',
                        '-o', str(binary), './tests/native-audio/app'], cwd=ROOT, env=env, check=True)
        elf = subprocess.check_output(['readelf', '-h', '-l', '-d', str(binary)], text=True)
        machine = 'AArch64' if args.goarch == 'arm64' else 'X86-64'
        if 'INTERP' in elf or '(NEEDED)' in elf or machine not in elf:
            raise SystemExit('Test App must be a static Linux executable for the selected architecture')
        licenses = stage / 'licenses'
        licenses.mkdir()
        shutil.copyfile(ROOT / 'third_party/licenses/jezek-xgb-LICENSE.txt', licenses / 'jezek-xgb-LICENSE.txt')
        goroot = Path(subprocess.check_output(['go', 'env', 'GOROOT'], env=env, text=True).strip())
        shutil.copyfile(goroot / 'LICENSE', licenses / 'go-LICENSE.txt')
        inputs = [ROOT / 'go.mod', ROOT / 'go.sum', Path(__file__).resolve(),
                  *sorted((ROOT / 'tests/native-audio/app').glob('*.go'))]
        (stage / 'native-audio-test-build.json').write_text(json.dumps({
            'schema': 1, 'goarch': args.goarch,
            'toolchain': subprocess.check_output(['go', 'version'], env=env, text=True).strip(),
            'binarySHA256': digest(binary),
            'inputs': {str(p.relative_to(ROOT)): digest(p) for p in inputs},
            'vcsMetadata': False,
        }, indent=2) + '\n')
        subprocess.run(['bash', str(ROOT / 'scripts/package-app.sh'), str(stage), str(output)],
                       env=env, check=True)


if __name__ == '__main__':
    main()
