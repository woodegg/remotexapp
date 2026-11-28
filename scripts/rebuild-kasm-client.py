#!/usr/bin/env python3
"""Build a new immutable native pair, reusing a verified unchanged server.

Only client-side changes are allowed. The parent component and its server source
provenance stay intact. This script never installs or restarts a service.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('component_build', ROOT / 'scripts/build-kasm-component.py')
recipe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recipe)


def rebuild(parent, expected, work, output):
    manifest_path = parent / 'manifest.json'
    if recipe.digest(manifest_path) != expected:
        raise ValueError('Parent manifest hash mismatch')
    manifest = json.loads(manifest_path.read_text())
    source = json.loads((parent / 'SOURCE.json').read_text())
    for name, digest in manifest['files'].items():
        path = parent / name
        if path.is_symlink() or not path.resolve().is_relative_to(parent) or recipe.digest(path) != digest:
            raise ValueError('Parent member verification failed: ' + name)
    if (manifest['serverCommit'], manifest['clientCommit']) != (recipe.SERVER, recipe.CLIENT):
        raise ValueError('Parent upstream source pins differ')
    transport = source['transport']
    if transport not in ('wss', 'udp'):
        raise ValueError('Unknown parent transport')
    patches = recipe.selected_patches(transport)
    server_patches = {p.name:recipe.digest(p) for p in patches
                      if p.name.startswith('000') or '-server-' in p.name}
    prior_server_patches = {name:digest for name,digest in source['patches'].items()
                            if name.startswith('000') or '-server-' in name}
    if server_patches != prior_server_patches:
        raise ValueError('Server patch changes require a full component build')
    for name, digest in recipe.INPUTS.items():
        if recipe.digest(parent / 'sources' / name) != digest:
            raise ValueError('Parent source archive mismatch: ' + name)
    if output.exists():
        raise ValueError('Output must be new')
    work.mkdir(parents=True, exist_ok=False)
    client = work / 'client'
    recipe.extract(parent / 'sources/client.tar.gz', client)
    for patch in patches:
        if patch.name not in server_patches:
            recipe.run(['patch', '--batch', '-p1', '-i', str(patch)], client)
    deps = work / 'dependencies'
    deps.mkdir()
    for name in ('package.json', 'package-lock.json'):
        shutil.copyfile(recipe.COMPONENT / name, deps / name)
    recipe.run(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], deps)
    shutil.copyfile(recipe.COMPONENT / 'client-entry.js', client / 'remotexapp-entry.js')
    modules = {'clipboard-payload.mjs':'clipboard-payload.mjs',
               'server-messages.mjs':'remotexapp-server-messages.mjs',
               'udp.mjs':'remotexapp-udp.mjs', 'latency.mjs':'remotexapp-latency.mjs',
               'clipboard-input.mjs':'remotexapp-clipboard-input.mjs',
               'clipboard-order.mjs':'remotexapp-clipboard-order.mjs',
               'native-input.mjs':'remotexapp-native-input.mjs'}
    for name, target in modules.items():
        shutil.copyfile(recipe.COMPONENT / name, client / 'core' / target)
    recipe.run(['node', '--test', *map(str, sorted((recipe.COMPONENT / 'tests').glob('*.test.mjs')))],
               client, env=dict(os.environ, KASM_CLIENT_SOURCE=str(client), KASM_TRANSPORT=transport))
    recipe.run([str(deps / 'node_modules/.bin/esbuild'), 'remotexapp-entry.js', '--bundle',
                '--define:REMOTEXAPP_UDP=' + ('true' if transport == 'udp' else 'false'),
                '--format=esm', '--target=es2022', '--loader:.bin=dataurl',
                '--outfile=' + str(work / 'client.js')], client,
               env=dict(os.environ, NODE_PATH=str(deps / 'node_modules')))
    # Copy only verified manifest members, never unknown parent directory files.
    output.mkdir(parents=True)
    def copy(path, name):
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)
        target.chmod(0o755 if name == manifest['binary'] else 0o644)
    for name in manifest['files']:
        copy(parent / name, name)
    copy(parent / 'SOURCE.json', 'sources/build/parent-SOURCE.json')
    copy(manifest_path, 'sources/build/parent-manifest.json')
    copy(work / 'client.js', manifest['client'])
    for name in modules:
        copy(recipe.COMPONENT / name, 'sources/' + name)
    for path in (recipe.COMPONENT / 'tests').iterdir():
        if path.suffix in ('.mjs', '.cpp'):
            copy(path, 'sources/tests/' + path.name)
    for path in patches:
        copy(path, 'sources/patches/' + path.name)
    for name in ('package.json', 'package-lock.json', 'client-entry.js'):
        copy(recipe.COMPONENT / name, 'sources/build/' + name)
    for name in ('build-kasm-component.py', 'rebuild-kasm-client.py'):
        copy(ROOT / 'scripts' / name, 'sources/build/' + name)
    source['patches'] = {p.name:recipe.digest(p) for p in patches}
    source['clientRebuild'] = {'parentManifestSHA256':expected,
        'unchangedServerSHA256':recipe.digest(parent / manifest['binary']),
        'method':'verified parent server reuse; clean pinned client reconstruction',
        'serverRecompiled':False,
        'tools':{name:subprocess.check_output([name,'--version'],text=True).strip()
                 for name in ('node','npm')},
        'clientBuilder':'esbuild 0.20.1; locked npm dependency integrity'}
    (output / 'SOURCE.json').write_text(json.dumps(source, indent=2)+'\n')
    manifest['files'] = {str(p.relative_to(output)):recipe.digest(p)
                         for p in sorted(output.rglob('*')) if p.is_file()}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    print('Kasm component manifest SHA256:', recipe.digest(output / 'manifest.json'))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('parent', 'work', 'output'):
        parser.add_argument('--'+name, type=Path, required=True)
    parser.add_argument('--parent-sha256', required=True)
    args = parser.parse_args()
    rebuild(args.parent.resolve(), args.parent_sha256, args.work.resolve(), args.output.resolve())
