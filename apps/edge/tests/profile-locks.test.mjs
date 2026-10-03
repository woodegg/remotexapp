import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readlink, readdir, rm, symlink } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const helper = 'apps/edge/profile-locks.py';

async function fixture(t) {
  const root = await mkdtemp('/tmp/remotexapp-edge-locks-');
  const profile = join(root, 'profile');
  await mkdir(profile, { mode:0o700 });
  t.after(() => rm(root, { recursive:true, force:true }));
  return { root, profile };
}

function run(profile) {
  return spawnSync('/usr/bin/python3', [helper, profile], { encoding:'utf8' });
}

async function staleLinks(profile, { host='foreign-host', pid=123456, socketPath='/tmp/missing-edge-singleton.sock', names=['SingletonLock', 'SingletonSocket', 'SingletonCookie'] } = {}) {
  const values = {
    SingletonLock:`${host}-${pid}`,
    SingletonSocket:socketPath,
    SingletonCookie:'1234567890',
  };
  for (const name of names) await symlink(values[name], join(profile, name));
}

async function quarantineEntries(profile) {
  const root = join(profile, '.remotexapp-lock-quarantine');
  return (await readdir(root)).filter(name => name !== '.guard');
}

test('clean profile is unchanged and private quarantine metadata is bounded', async t => {
  const { profile } = await fixture(t);
  const result = run(profile);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { action:'clean', count:0 });
  assert.equal((await lstat(join(profile, '.remotexapp-lock-quarantine'))).mode & 0o777, 0o700);
});

test('foreign-host stale singleton trio is quarantined without touching profile data', async t => {
  const { profile } = await fixture(t);
  await staleLinks(profile);
  await mkdir(join(profile, 'Default'));
  const result = run(profile);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).count, 3);
  const [record] = await quarantineEntries(profile);
  assert.deepEqual((await readdir(join(profile, '.remotexapp-lock-quarantine', record))).sort(), ['SingletonCookie', 'SingletonLock', 'SingletonSocket']);
  assert.equal((await lstat(join(profile, 'Default'))).isDirectory(), true);
});

test('partial residue and reused mismatched local PID are recoverable', async t => {
  const first = await fixture(t);
  await staleLinks(first.profile, { names:['SingletonCookie'] });
  assert.equal(run(first.profile).status, 0);
  const second = await fixture(t);
  await staleLinks(second.profile, { host:os.hostname(), pid:process.pid, names:['SingletonLock'] });
  assert.equal(run(second.profile).status, 0);
});

test('live exact profile owner fails closed and leaves links unchanged', async t => {
  const { profile } = await fixture(t);
  const child = spawn('/usr/bin/python3', ['-c', 'import time; time.sleep(30)', `--user-data-dir=${profile}`], { stdio:'ignore' });
  t.after(() => child.kill('SIGKILL'));
  await staleLinks(profile, { host:os.hostname(), pid:child.pid, names:['SingletonLock', 'SingletonCookie'] });
  const result = run(profile);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /profile is used by live local PID|owned by live PID/);
  assert.equal(await readlink(join(profile, 'SingletonLock')), `${os.hostname()}-${child.pid}`);
});

test('reachable singleton socket fails closed', async t => {
  const { root, profile } = await fixture(t);
  const socketPath = join(root, 'owner.sock');
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(socketPath, resolve).once('error', reject));
  t.after(() => new Promise(resolve => server.close(resolve)));
  await staleLinks(profile, { socketPath });
  const result = run(profile);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /reachable SingletonSocket/);
  assert.equal(await readlink(join(profile, 'SingletonSocket')), socketPath);
});

test('unknown profile lock types fail closed', async t => {
  const first = await fixture(t);
  await mkdir(join(first.profile, 'SingletonLock'));
  const unknown = run(first.profile);
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /not a symbolic link/);
});

test('quarantine rotates only trusted records and fails closed on unknown data', async t => {
  const { profile } = await fixture(t);
  assert.equal(run(profile).status, 0);
  const quarantine = join(profile, '.remotexapp-lock-quarantine');
  for (let index = 0; index < 5; index++) {
    await staleLinks(profile, { pid:123456 + index, names:['SingletonCookie'] });
    const result = run(profile);
    assert.equal(result.status, 0, result.stderr);
  }
  assert.equal((await quarantineEntries(profile)).length, 4);

  const oldest = (await quarantineEntries(profile)).sort()[0];
  await mkdir(join(quarantine, oldest, 'unknown'));
  await staleLinks(profile, { names:['SingletonCookie'] });
  const refused = run(profile);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /unknown data/);
  assert.equal(await readlink(join(profile, 'SingletonCookie')), '1234567890');
});

test('untrusted quarantine records fail closed without moving locks', async t => {
  const { profile } = await fixture(t);
  await staleLinks(profile, { names:['SingletonCookie'] });
  const quarantine = join(profile, '.remotexapp-lock-quarantine');
  await mkdir(quarantine, { mode:0o700 });
  await chmod(quarantine, 0o700);
  for (let index = 0; index < 4; index++) {
    const record = join(quarantine, `record-${index}`);
    await mkdir(record);
    await symlink('saved', join(record, 'SingletonCookie'));
  }
  await mkdir(join(quarantine, 'record-0', 'unknown'));
  const result = run(profile);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown data/);
  assert.equal(await readlink(join(profile, 'SingletonCookie')), '1234567890');
});
