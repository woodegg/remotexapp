#!/usr/bin/env python3
"""Build the experimental WSS component from checked archives in a fresh directory.

This never installs services or changes the running provider. Build dependencies
must already exist on an Ubuntu 24.04 amd64 build host.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parent.parent
COMPONENT = ROOT / 'third_party/kasm'
INPUTS = {
    'server.tar.gz': '478f4d6a973fc6f51cc5c711d37ff3ba30007792e481a7074cc5e5ce63f2eca1',
    'client.tar.gz': '325084abe7af9174812f06933a9f154d044b485254eda9f49ce511552a262420',
    'xorg.tar.xz': '1e016e2be1b5ccdd65eac3ea08e54bd13ce8f4f6c3fb32ad6fdac4e71729a90f',
}
SERVER = '17265facc40ab50db5740cdf0d12c61173edafc9'
CLIENT = '475ecfa5356579ef222983c7ce4619a7576a3bce'
LIBRARIES = {'libtbb.so.12':'libtbb12', 'libyuv.so.0':'libyuv0',
             'libcpuid.so.16':'libcpuid16', 'libfmt.so.9':'libfmt9',
             'libjpeg.so.8':'libjpeg-turbo8'}


def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def run(args, cwd, **kwargs):
    subprocess.run(args, cwd=cwd, check=True, **kwargs)


def extract(source, destination):
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(source) as archive:
        for member in archive.getmembers():
            parts = Path(member.name).parts[1:]
            if not parts:
                continue
            member.name = str(Path(*parts))
            archive.extract(member, destination, filter='data')


def build(inputs, work):
    work.mkdir(parents=True, exist_ok=False)
    server, client = work / 'server', work / 'client'
    extract(inputs / 'server.tar.gz', server)
    extract(inputs / 'client.tar.gz', client)
    extract(inputs / 'xorg.tar.xz', server / 'unix/xserver')
    for patch in sorted((COMPONENT / 'patches').glob('*.patch')):
        target = server if patch.name.startswith('000') else client
        run(['patch', '--batch', '-p1', '-i', str(patch)], target)
    run(['cmake', '.', '-DBUILD_VIEWER=OFF', '-DENABLE_GNUTLS=OFF',
         '-DCMAKE_BUILD_TYPE=RelWithDebInfo'], server)
    run(['make', '-j4'], server)
    xorg = server / 'unix/xserver'
    run(['patch', '--batch', '-p1', '-i', str(server / 'unix/xserver21.patch')], xorg)
    run(['autoreconf', '-fi'], xorg)
    run(['./configure', '--disable-config-hal', '--disable-config-udev',
         '--disable-dri', '--disable-dri2', '--disable-kdrive', '--disable-static',
         '--disable-xephyr', '--disable-xinerama', '--disable-xnest', '--disable-xorg',
         '--disable-xvfb', '--disable-xwin', '--enable-glx', '--prefix=/opt/kasmweb',
         '--with-default-font-path=/usr/share/fonts/X11/misc,built-ins',
         '--without-dtrace', '--with-sha1=libcrypto', '--with-xkb-bin-directory=/usr/bin',
         '--with-xkb-output=/var/lib/xkb', '--with-xkb-path=/usr/share/X11/xkb'], xorg)
    run(['make', '-j4'], xorg)
    deps = work / 'dependencies'
    deps.mkdir()
    for name in ['package.json', 'package-lock.json']:
        shutil.copyfile(COMPONENT / name, deps / name)
    run(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], deps)
    shutil.copyfile(COMPONENT / 'client-entry.js', client / 'remotexapp-entry.js')
    shutil.copyfile(COMPONENT / 'server-messages.mjs', client / 'core/remotexapp-server-messages.mjs')
    run(['node', '--test', *[str(p) for p in sorted((COMPONENT / 'tests').glob('*.test.mjs'))]], client,
        env=dict(os.environ, KASM_CLIENT_SOURCE=str(client)))
    env = dict(os.environ, NODE_PATH=str(deps / 'node_modules'))
    run([str(deps / 'node_modules/.bin/esbuild'), 'remotexapp-entry.js', '--bundle',
         '--format=esm', '--target=es2022', '--loader:.bin=dataurl',
         '--outfile=' + str(work / 'client.js')], client, env=env)


def package(inputs, work, output):
    output.mkdir(parents=True, exist_ok=False)
    def copy(source, name):
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        target.chmod(0o644)
    copy(work / 'server/unix/xserver/hw/vnc/Xvnc', 'bin/Xkasmvnc')
    (output / 'bin/Xkasmvnc').chmod(0o755)
    run(['strip', '--strip-debug', str(output / 'bin/Xkasmvnc')], work)
    copy(work / 'client.js', 'web/client.js')
    copy(COMPONENT / 'server-messages.mjs', 'sources/server-messages.mjs')
    for test in sorted((COMPONENT / 'tests').glob('*.test.mjs')):
        copy(test, 'sources/tests/' + test.name)
    copy(work / 'server/LICENSE.TXT', 'LICENSE.server.txt')
    copy(work / 'client/LICENSE.txt', 'LICENSE.client.txt')
    packages = {}
    for name, pkg in LIBRARIES.items():
        copy(Path('/usr/lib/x86_64-linux-gnu') / name, 'lib/' + name)
        copy(Path('/usr/share/doc') / pkg / 'copyright', 'notices/' + pkg + '.txt')
        packages[pkg] = subprocess.check_output(['dpkg-query', '-W', '-f=${Version}', pkg], text=True)
    copy(work / 'dependencies/node_modules/pako/LICENSE', 'notices/pako.txt')
    for name in INPUTS:
        copy(inputs / name, 'sources/' + name)
    for name in ['package.json', 'package-lock.json', 'client-entry.js']:
        copy(COMPONENT / name, 'sources/build/' + name)
    copy(Path(__file__), 'sources/build/build-kasm-component.py')
    patches = {}
    for patch in sorted((COMPONENT / 'patches').glob('*.patch')):
        copy(patch, 'sources/patches/' + patch.name)
        patches[patch.name] = digest(patch)
    source = {'status':'experimental-d2-not-a-release', 'serverCommit':SERVER, 'clientCommit':CLIENT,
              'archives':INPUTS, 'patches':patches, 'runtimeLibraryPackages':packages,
              'clientDependencies':{'pako':'2.1.0'}, 'clientBuilder':{'esbuild':'0.20.1'},
              'scope':'WSS only; bounded explicit text clipboard; no UDP, QOI workers, audio or rich clipboard qualification',
              'tools':{name:subprocess.check_output([name,'--version'],text=True).splitlines()[0]
                       for name in ['c++','cmake','node','npm']}}
    (output / 'SOURCE.json').write_text(json.dumps(source, indent=2)+'\n')
    files = {str(p.relative_to(output)):digest(p) for p in sorted(output.rglob('*')) if p.is_file()}
    manifest = {'schemaVersion':1, 'protocol':'kasm-wss-text-v1', 'serverCommit':SERVER,
                'clientCommit':CLIENT, 'binary':'bin/Xkasmvnc', 'client':'web/client.js', 'files':files}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    print('Kasm component manifest SHA256:', digest(output / 'manifest.json'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inputs', required=True, type=Path)
    parser.add_argument('--work', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    inputs, work, output = (p.resolve() for p in [args.inputs,args.work,args.output])
    for name, expected in INPUTS.items():
        if digest(inputs / name) != expected:
            raise SystemExit('Source archive checksum mismatch: ' + name)
    if output.exists() or work.exists():
        raise SystemExit('Work and output directories must be new')
    build(inputs,work)
    package(inputs,work,output)


if __name__ == '__main__':
    main()
