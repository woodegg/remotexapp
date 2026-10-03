import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

for (const [name, visible, expected] of [
  ['missing-window', false, 'Edge browser window did not become visible'],
  ['missing-cdp', true, 'Edge CDP endpoint did not become ready'],
]) {
  test(`Edge reports ${name} before Core's deadline`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'remotexapp-edge-readiness-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const bin = join(root, 'bin');
    const core = join(root, 'core');
    const home = join(root, 'home');
    const runtime = join(root, 'runtime');
    await Promise.all([bin, core, home, runtime].map(path => mkdir(path)));
    const executable = async (path, source) => {
      await writeFile(path, source);
      await chmod(path, 0o700);
    };
    await executable(join(core, 'session-status.sh'),
      'session_status_report() { printf "%s\\n" "$*" >> "$REMOTEXAPP_RUNTIME/reports.log"; }\n');
    await executable(join(bin, 'microsoft-edge'), '#!/bin/sh\nexec sleep 30\n');
    await executable(join(bin, 'matchbox-window-manager'), '#!/bin/sh\nexec sleep 30\n');
    await executable(join(bin, 'xdotool'), visible ? '#!/bin/sh\necho 123\n' : '#!/bin/sh\nexit 0\n');
    const resources = join(root, 'resources.json');
    const config = join(root, 'driver.json');
    const parameters = join(root, 'parameters.json');
    await writeFile(resources, JSON.stringify({ control: { address: '127.0.0.1', port: 65432 } }));
    await writeFile(config, JSON.stringify({ protocol: 'cdp' }));
    await writeFile(parameters, JSON.stringify({ startUrl: 'about:blank', incognito: false }));
    const started = Date.now();
    const result = spawnSync('/bin/sh', ['apps/edge/session.sh'], {
      encoding: 'utf8', timeout: 6000,
      env: {
        ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: home,
        REMOTEXAPP_RUNTIME: runtime, REMOTEXAPP_PARAMETERS: parameters,
        REMOTEXAPP_STATUS_PATH: join(runtime, 'status.json'),
        REMOTEXAPP_DRIVER_CONFIG: config, REMOTEXAPP_RESOURCES: resources,
        REMOTEXAPP_CORE_DRIVER_DIR: core, REMOTEXAPP_SESSION_SERVICES: 'core-v1',
        REMOTEXAPP_SESSION_DEADLINE_MS: String(started + 5000),
      },
    });
    assert.equal(result.status, 1, result.stderr);
    assert.ok(Date.now() - started < 5000, 'Driver did not report before Core deadline');
    assert.match(result.stderr, new RegExp(expected));
    const reports = await readFile(join(runtime, 'reports.log'), 'utf8');
    assert.match(reports, new RegExp(`--state error --summary Edge readiness failed --error ${expected}`));
    assert.doesNotMatch(reports, /Traceback/);
  });
}
