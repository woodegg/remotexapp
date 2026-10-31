#!/usr/bin/env python3
"""Build four static Core binaries on Alpine; Kasm is a separate component.

Requires Go 1.27.3, build-base, Python, pkgconf, X11 development/static packages
and the three checksum-pinned source archives below. Never installs services.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parent.parent
INPUTS = {
    'libXau-1.0.12.tar.xz': '74d0e4dfa3d39ad8939e99bda37f5967aba528211076828464d2777d477fc0fb',
    'libXinerama-1.1.6.tar.xz': 'd00fc1599c303dc5cbc122b8068bdc7405d6fcb19060f4597fc51bd3a8be51d7',
    'xdotool-3.20160805.1.tar.gz': 'ddafca1239075c203769c17a5a184587731e56fbe0438c09d08f8af1704e117a',
}


def run(args, cwd, **kwargs):
    subprocess.run(args, cwd=cwd, check=True, **kwargs)


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inputs', type=Path, required=True)
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--source-commit', required=True)
    parser.add_argument('--source-epoch', type=int, required=True)
    args = parser.parse_args()
    if not re.fullmatch('[0-9a-f]{40}', args.source_commit):
        parser.error('source-commit must be a full verified source commit')
    if not Path('/etc/alpine-release').is_file():
        parser.error('run in the dedicated Alpine build environment')
    if subprocess.check_output(['go', 'env', 'GOVERSION'], text=True).strip() != 'go1.27.3':
        parser.error('Go 1.27.3 required')
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    epoch = int(subprocess.check_output(['git', 'log', '-1', '--format=%ct'], cwd=ROOT, text=True))
    if revision != args.source_commit or epoch != args.source_epoch:
        parser.error('source commit/epoch must match the actual Git checkout')
    if subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).strip():
        parser.error('build from a clean checkout with outputs outside the repository')
    inputs, work, output = (p.resolve() for p in (args.inputs, args.work, args.output))
    if work.exists() or output.exists():
        parser.error('work and output must be new directories')
    for name, expected in INPUTS.items():
        if sha(inputs / name) != expected:
            parser.error('source checksum mismatch: ' + name)
    work.mkdir(parents=True)
    output.mkdir(parents=True)
    prefix = work / 'static'
    sources = output / 'sources'
    sources.mkdir()
    for name in INPUTS:
        shutil.copyfile(inputs / name, sources / name)
        with tarfile.open(inputs / name) as archive:
            archive.extractall(work, filter='data')
    for name in ['libXau-1.0.12', 'libXinerama-1.1.6']:
        directory = work / name
        run(['./configure', '--disable-shared', '--enable-static', '--prefix=' + str(prefix)], directory)
        run(['make', '-j4'], directory)
        run(['make', 'install'], directory)
    xdo = work / 'xdotool-3.20160805.1'
    run(['make', '-j4', 'xdo.o', 'xdo_search.o'], xdo)
    run(['ar', 'rcs', str(prefix / 'lib/libxdo.a'), 'xdo.o', 'xdo_search.o'], xdo)
    binaries = output / 'bin'
    binaries.mkdir()
    stamp = datetime.datetime.fromtimestamp(args.source_epoch, datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    version = (ROOT / 'VERSION').read_text().strip()
    flags = f'-s -w -X main.version={version} -X main.commit={args.source_commit[:12]} -X main.buildDate={stamp}'
    records = {}
    for name in ['remotexappd', 'novnc-input', 'remotexapp-status', 'remotexapp-operator-helper']:
        cgo = name == 'novnc-input'
        env = dict(os.environ, CGO_ENABLED='1' if cgo else '0', CGO_LDFLAGS='-L' + str(prefix / 'lib'))
        run(['go', 'build', '-buildvcs=true', '-trimpath', '-tags=x11_static',
             '-ldflags', flags + (' -linkmode external -extldflags -static' if cgo else ''),
             '-o', str(binaries / name), './cmd/' + name], ROOT, env=env)
        elf = subprocess.check_output(['readelf', '-l', '-d', str(binaries / name)], text=True)
        if 'INTERP' in elf or '(NEEDED)' in elf:
            raise RuntimeError(name + ' has a dynamic interpreter or dependency')
        buildinfo = subprocess.check_output(['go', 'version', '-m', str(binaries / name)], text=True)
        if 'vcs.revision=' + args.source_commit not in buildinfo or 'vcs.modified=false' not in buildinfo:
            raise RuntimeError(name + ' does not retain the clean source identity')
        records[name] = {'sha256': sha(binaries / name), 'interpreter': False, 'dynamicDependencies': []}
    shutil.copyfile(Path(__file__), sources / Path(__file__).name)
    manifest = {'status': 'experimental-not-a-release', 'sourceCommit': args.source_commit,
                'sourceEpoch': args.source_epoch, 'version': version,
                'alpine': Path('/etc/alpine-release').read_text().strip(),
                'toolchain': 'go1.27.3', 'sources': INPUTS, 'binaries': records,
                'buildPackages': subprocess.check_output(['apk', 'info', '-v'], text=True).splitlines()}
    (output / 'static-build.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print('Verified four static ELF binaries')


if __name__ == '__main__':
    main()
