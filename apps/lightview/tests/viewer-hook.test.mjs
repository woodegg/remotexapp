import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const hook = resolve('apps/lightview/viewer-hook.py');

async function fixture(t, initial = {}) {
  const runtime = mkdtempSync(join(tmpdir(), 'lightview-viewer-'));
  const directory = join(runtime, 'lightview');
  mkdirSync(directory, { mode: 0o700 });
  chmodSync(directory, 0o700);
  const socket = join(directory, 'control.sock');
  writeFileSync(join(runtime, 'lightview-process.pid'), `${process.pid}\n`);
  const state = { pid: process.pid, private: false, engine_state: 'ready',
    web_process_generation: 1, uri: 'https://example.org/current',
    last_committed_uri: 'https://example.org/current', title: 'fixture',
    loading: false, load_error: null, idle_hibernate_seconds: 3600, ...initial };
  const calls = [];
  const server = net.createServer(connection => {
    connection.on('error', () => {});
    let input = '';
    connection.on('data', chunk => {
      input += chunk;
      if (!input.includes('\n')) return;
      const request = JSON.parse(input);
      calls.push(request);
      if (request.command === 'hibernate-after') state.idle_hibernate_seconds = request.seconds;
      if (request.command === 'open') {
        state.engine_state = 'ready';
        state.web_process_generation++;
        state.uri = request.uri;
      }
      connection.end(`${JSON.stringify({ ok: true, result: request.command === 'status' ? state : {} })}\n`);
    });
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(socket, resolveListen);
  });
  t.after(async () => { await new Promise(done => server.close(done)); rmSync(runtime, { recursive: true, force: true }); });
  const run = phase => new Promise((done, reject) => {
    const child = spawn('/usr/bin/python3', [hook, phase], {
      env: { ...process.env, REMOTEXAPP_RUNTIME: runtime,
        REMOTEXAPP_SESSION_GENERATION: '5', PYTHONDONTWRITEBYTECODE: '1' },
      timeout: 5000,
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => done({ code, stderr }));
  });
  return { runtime, state, calls, run, policy: join(directory, 'viewer-hibernate-policy.json') };
}

test('first attach inhibits hibernation and final detach restores the exact user policy', async t => {
  const f = await fixture(t, { idle_hibernate_seconds: 150 });
  assert.equal((await f.run('attach')).code, 0);
  assert.equal(f.state.idle_hibernate_seconds, 0);
  assert.equal(JSON.parse(readFileSync(f.policy)).seconds, 150);
  assert.equal((await f.run('attach')).code, 0);
  assert.equal(f.calls.filter(call => call.command === 'hibernate-after').length, 1);
  assert.equal((await f.run('detach')).code, 0);
  assert.equal(f.state.idle_hibernate_seconds, 150);
  assert.equal(existsSync(f.policy), false);
  assert.equal((await f.run('detach')).code, 0);
});

test('suspended browser restores last committed page, not its empty live URI', async t => {
  const f = await fixture(t, { engine_state: 'suspended', uri: '',
    last_committed_uri: 'https://example.org/restored' });
  assert.equal((await f.run('attach')).code, 0);
  assert.deepEqual(f.calls.filter(call => call.command === 'open').map(call => call.uri),
    ['https://example.org/restored']);
  assert.equal(f.state.engine_state, 'ready');
});

test('unsafe or absent restore URL falls back to a blank page', async t => {
  const f = await fixture(t, { engine_state: 'suspended', uri: '', last_committed_uri: 'file:///secret' });
  assert.equal((await f.run('attach')).code, 0);
  assert.equal(f.calls.find(call => call.command === 'open').uri, 'about:blank');
});

test('detach preserves a policy changed locally while Viewer was attached', async t => {
  const f = await fixture(t);
  assert.equal((await f.run('attach')).code, 0);
  f.state.idle_hibernate_seconds = 42;
  assert.equal((await f.run('detach')).code, 0);
  assert.equal(f.state.idle_hibernate_seconds, 42);
  assert.equal(existsSync(f.policy), false);
});

test('invalid process identity prevents attaching and changing native policy', async t => {
  const f = await fixture(t, { pid: process.pid + 1 });
  assert.notEqual((await f.run('attach')).code, 0);
  assert.equal(f.state.idle_hibernate_seconds, 3600);
  assert.equal(existsSync(f.policy), false);
});
