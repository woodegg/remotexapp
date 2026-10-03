import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const manifest = JSON.parse(readFileSync('apps/lightview/manifest.json'));
const session = readFileSync('apps/lightview/session.sh', 'utf8');
const control = readFileSync('apps/lightview/control.py', 'utf8');
const action = readFileSync('apps/lightview/open-url.py', 'utf8');

test('LightView owns the locked low-memory shared-browser contract', () => {
  assert.deepEqual([manifest.id, manifest.name, manifest.driverVersion], ['lightview', 'LightView', '1.0.13']);
  assert.deepEqual([manifest.runMode, manifest.singleton, manifest.profileRef], ['shared', true, 'default']);
  assert.deepEqual(
    [manifest.server.displayMode, manifest.server.geometry, manifest.server.depth, manifest.server.frameRate, manifest.server.allowClientResize],
    ['dynamic', '1280x720', 16, 5, true],
  );
  assert.deepEqual([manifest.session.activation, manifest.session.vacantTimeout, manifest.session.vacantAction], ['on-attach', '6h', 'stop-instance']);
  assert.deepEqual(manifest.overrides.allowed, []);
  assert.deepEqual(manifest.ports, {});
  assert.match(session, /lightview --low-memory --profile/);
  assert.doesNotMatch(session, /lightview --version|Unsupported LightView executable/);
  assert.match(session, /about:blank\|http:\/\/\*\|https:\/\/\*/);
  assert.doesNotMatch(session, /--memory-limit|--private|--no-control/);
  assert.deepEqual(manifest.session.status.details.launchLowMemory, { type:'boolean' });
  assert.equal(manifest.session.status.details.memoryLimitMiB, undefined);
  assert.equal(manifest.session.status.details.memoryKillThresholdMiB, undefined);
  assert.doesNotMatch(session, /--detail-bool lowMemory|--detail-integer memory/);
});

test('real session launcher does not gate on executable version banners', async t => {
  for (const banner of ['Lightview 0.1.8 (fixture)', 'Lightview 0.1.9 (fixture)',
    'Lightview 0.2.0 (fixture)', 'Lightview 1.0.0 (fixture)', 'custom-build']) {
    await t.test(banner, async () => {
      const directory = mkdtempSync(join(tmpdir(), 'lightview-launch-contract-'));
      const bin = join(directory, 'bin');
      mkdirSync(bin);
      const executable = (name, source) => writeFileSync(join(bin, name), '#!/bin/sh\n' + source, { mode:0o755 });
      executable('lightview', 'if [ "$1" = --version ]; then printf "%s\\n" "$TEST_BANNER"; exit 0; fi\nprintf "%s\\n" "$@" > "$TEST_LAUNCH_ARGS"\nexit 23\n');
      executable('matchbox-window-manager', 'exit 0\n');
      executable('xdotool', 'exit 1\n');
      writeFileSync(join(directory, 'parameters.json'), JSON.stringify({ startUrl:'about:blank' }));
      writeFileSync(join(directory, 'config.json'), JSON.stringify(manifest.driver.config));
      try {
        const result = await new Promise((resolveExit, reject) => {
          const child = spawn('/bin/sh', [resolve('apps/lightview/session.sh')], {
            env:{ ...process.env, PATH:`${bin}:/usr/bin:/bin`, HOME:directory,
              REMOTEXAPP_RUNTIME:directory, REMOTEXAPP_PARAMETERS:join(directory, 'parameters.json'),
              REMOTEXAPP_DRIVER_CONFIG:join(directory, 'config.json'), REMOTEXAPP_SESSION_SERVICES:'core-v1',
              REMOTEXAPP_CORE_DRIVER_DIR:resolve('drivers/common'), REMOTEXAPP_SESSION_GENERATION:'1',
              REMOTEXAPP_STATUS_PATH:join(directory, 'status.json'), REMOTEXAPP_STATUS_SCHEMA:join(directory, 'schema.json'),
              REMOTEXAPP_STATUS_HELPER:'/bin/true', TEST_BANNER:banner, TEST_LAUNCH_ARGS:join(directory, 'args') },
            stdio:['ignore', 'ignore', 'pipe'], timeout:5000,
          });
          let stderr = '';
          child.stderr.on('data', data => { stderr += data; });
          child.once('error', reject);
          child.once('exit', code => resolveExit({ code, stderr }));
        });
        const args = readFileSync(join(directory, 'args'), 'utf8').trim().split('\n');
        assert.deepEqual(args, ['--low-memory', '--profile', join(directory, '.local/share/remotexapp/lightview/default'),
          '--socket', join(directory, 'lightview/control.sock'), 'about:blank']);
        assert.notEqual(result.code, 0, 'a version-independent launch must still reject a failed process/readiness');
        assert.match(result.stderr, /exited before its window and control socket became ready/);
      } finally {
        rmSync(directory, { recursive:true, force:true });
      }
    });
  }
});

test('LightView publishes only a bounded private Unix descriptor', () => {
  assert.deepEqual(manifest.driver.config, { protocol:'lightview-json-v1', socketRelativePath:'lightview/control.sock' });
  assert.deepEqual(manifest.session.status.privateDetails.application, { type:'json', maxBytes:4096, maxDepth:4, maxItems:32 });
  assert.match(session, /--connection-application "\$descriptor"/);
  assert.match(control, /S_ISSOCK/);
  assert.match(control, /st_uid != os\.getuid\(\)/);
  assert.match(control, /result\.get\("pid"\) != expected_pid/);
  assert.doesNotMatch(control, /result\.get\("low_memory"\)/);
  assert.match(control, /result\.get\("engine_state"\) != "ready"/);
  assert.doesNotMatch(control, /result\.get\("memory_kill_threshold_mib"\)/);
  assert.equal(JSON.stringify(manifest).includes('eval'), false);
});

test('LightView exposes only bounded HTTP(S) openUrl', () => {
  assert.deepEqual(Object.keys(manifest.actions), ['openUrl']);
  assert.deepEqual(manifest.actions.openUrl.parameters.url.allowedSchemes, ['http', 'https']);
  assert.match(action, /parsed\.scheme in \("http", "https"\)/);
  assert.match(action, /control\.request\(path, "open"/);
  assert.doesNotMatch(action, /"eval"/);
});

function runControl(socketPath, pid, response) {
  return new Promise((resolve, reject) => {
    const server = net.createServer(connection => {
      connection.once('data', () => connection.end(`${JSON.stringify(response)}\n`));
    });
    server.once('error', reject);
    server.listen(socketPath, () => {
      const child = spawn('python3', ['apps/lightview/control.py', socketPath, String(pid), 'status'], {
        stdio:['ignore', 'pipe', 'pipe'],
      });
      let stdout = '', stderr = '';
      child.stdout.on('data', data => { stdout += data; });
      child.stderr.on('data', data => { stderr += data; });
      child.once('exit', code => server.close(() => resolve({ code, stdout, stderr })));
    });
  });
}

test('LightView control client fails closed on identity and readiness mismatches', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'lightview-control-'));
  chmodSync(directory, 0o700);
  const socketPath = join(directory, 'control.sock');
  const pid = process.pid;
  const valid = { ok:true, result:{ pid, private:false, low_memory:true, memory_limit_mib:384,
    memory_kill_threshold_mib:3072, engine_state:'ready', web_process_generation:1,
    uri:'about:blank', title:'', loading:false, load_error:null } };
  try {
    let result = await runControl(socketPath, pid, valid);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).pid, pid);

    result = await runControl(socketPath, pid, { ...valid, result:{ ...valid.result, pid:pid + 1 } });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /PID does not match/);

    result = await runControl(socketPath, pid, { ...valid, result:{ ...valid.result, low_memory:false } });
    assert.equal(result.code, 0, result.stderr);

    result = await runControl(socketPath, pid, { ...valid, result:{ ...valid.result, engine_state:'recovering' } });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /WebKit engine is not ready/);

    result = await runControl(socketPath, pid, { ...valid, result:{ ...valid.result, memory_kill_threshold_mib:1536 } });
    assert.equal(result.code, 0, result.stderr);

    for (const field of ['pid', 'private', 'engine_state', 'web_process_generation']) {
      const missing = { ...valid.result };
      delete missing[field];
      result = await runControl(socketPath, pid, { ok:true, result:missing });
      assert.equal(result.code, 1, `missing ${field} must fail even without an executable version gate`);
    }

    chmodSync(directory, 0o755);
    result = await runControl(socketPath, pid, valid);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /directory is not private/);
  } finally {
    rmSync(directory, { recursive:true, force:true });
  }
});
