// Explicit disposable local gate. The boot marker is changed only in this
// test's private state to simulate a prior boot; real reboot acceptance is separate.
import assert from 'node:assert/strict';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, mkdir, readFile, writeFile, cp, rename, symlink} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {createHash} from 'node:crypto';
import {RemoteXAppManager} from '../../cmd/remotexappd/web/sdk/remotexapp-manager.js';

const exec = promisify(execFile), sleep = ms => new Promise(r => setTimeout(r, ms));
const root = resolve(process.env.REMOTEXAPP_BOOT_RELEASE_ROOT || '.');
const work = await mkdtemp('/tmp/remotexapp-boot-e2e-');
const state = join(work, 'state'), apps = join(work, 'apps'), enabled = join(work, 'enabled');
const baseURL = 'http://127.0.0.1:21996', api = new RemoteXAppManager({baseURL});
const env = {...process.env, XDG_RUNTIME_DIR: `/run/user/${process.getuid()}`, DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${process.getuid()}/bus`};
const owned = new Set(), checks = [], bootID = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
const oldBootID = bootID === '11111111-1111-4111-8111-111111111111' ? '22222222-2222-4222-8222-222222222222' : '11111111-1111-4111-8111-111111111111';
const offlineRoot = join(work, 'offline-disk'), localRoot = join(work, 'local-documents'), notDirectory = join(work, 'not-directory');
let manager, managerOutput = '';
async function wait(fn, label, timeout = 45000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { const value = await fn(); if (value) return value; await sleep(100); }
  throw Error(label);
}
async function stopManager() {
  if (manager && manager.exitCode === null && manager.signalCode === null) await new Promise(r => { manager.once('exit', r); manager.kill('SIGTERM'); });
}
async function startManager() {
  manager = spawn(join(root, 'bin/remotexappd'), ['-listen', '127.0.0.1:21996', '-auth-mode', 'none', '-state-dir', state,
    '-document-roots', [offlineRoot, notDirectory, localRoot].join(':'),
    '-class-config', join(work, 'legacy'), '-app-package-root', apps, '-apps-enabled', enabled, '-expose-internals=true',
    '-gateway-bin', join(root, 'bin/novnc-input'), '-status-bin', join(root, 'bin/remotexapp-status'),
    '-core-driver-dir', join(root, 'drivers/common'), '-ibus-engine', join(root, 'components/remote-unicode-engine/engine.py')], {env, stdio: ['ignore', 'ignore', 'pipe']});
  manager.stderr.on('data', chunk => { managerOutput += chunk; process.stderr.write(chunk); });
  await wait(async () => { if (manager.exitCode !== null) throw Error('Manager exited'); try { return (await fetch(baseURL + '/readyz')).ok; } catch { return false; } }, 'Manager not ready');
}
async function install(id, activation) {
  const source = join(work, id);
  await cp(join(root, 'apps/mousepad'), source, {recursive: true});
  const manifest = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'));
  Object.assign(manifest, {id, driverVersion: '1.0.0', singleton: false});
  if (activation === 'on-attach') manifest.runMode = 'shared';
  Object.assign(manifest.session, {activation, vacantAction: 'stop-session', vacantTimeout: '1h'});
  await writeFile(join(source, 'manifest.json'), JSON.stringify(manifest));
  const archive = (await exec(join(root, 'scripts/package-app.sh'), [source, join(work, 'archives')], {env})).stdout.trim();
  await exec(join(root, 'scripts/install-app.sh'), ['--archive', archive, '--sha256', createHash('sha256').update(await readFile(archive)).digest('hex'), '--package-root', apps, '--enabled-root', enabled], {env});
}
async function ready(id) {
  return wait(async () => { const x = await api.getInstance(id); return x.sessionState === 'running' && x.applicationStatus?.state === 'ready' && x; }, 'App not ready');
}
async function activate(id) {
  const socket = new WebSocket(baseURL.replace('http:', 'ws:') + '/remotexapps/' + id + '/rfb-compat');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(Error('attach timeout')); }, 45000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, {once: true});
    socket.addEventListener('error', () => { clearTimeout(timer); reject(Error('attach failed')); }, {once: true});
  });
  socket.close();
  return ready(id);
}
async function services(id) { return JSON.parse(await readFile(join(state, 'instances', id, 'session-services.json'), 'utf8')); }
async function simulateOldBoot(items) {
  await stopManager();
  for (const x of items) {
    assert(owned.has(x.id) && x.runtimePath === join(state, 'instances', x.id));
    // No wildcard units, no default bus and no existing user's runtime.
    for (const unit of [x.sessionUnit, x.gatewayUnit, x.serverUnit, x.vncUnit].filter(Boolean)) {
      assert(unit.startsWith('remotexapp-' + x.id + '-'));
      try { await exec('systemctl', ['--user', 'stop', unit], {env, timeout: 25000}); }
      catch (e) { if (!e.stderr?.includes('not loaded')) throw e; }
    }
    const marker = join(x.runtimePath, 'runtime-boot.json');
    const record = JSON.parse(await readFile(marker, 'utf8'));
    assert.equal(record.runtimeId, x.id); assert.equal(record.bootId, bootID);
    record.bootId = oldBootID;
    await writeFile(marker, JSON.stringify(record), {mode: 0o600});
  }
}

try {
  let occupied = false; try { occupied = (await fetch(baseURL + '/readyz')).ok; } catch {}
  assert(!occupied, '21996 occupied');
  for (const path of [state, apps, enabled, join(work, 'legacy'), localRoot]) await mkdir(path);
  await writeFile(notDirectory, 'not a directory');
  await install('boot-immediate', 'immediate'); await install('boot-on-attach', 'on-attach');
  await startManager();
  await wait(() => managerOutput.includes('ERROR document root unavailable "' + offlineRoot + '"') && managerOutput.includes('ERROR document root unavailable "' + notDirectory + '"'), 'unavailable roots not reported');
  const lateDocument = join(offlineRoot, 'document.txt');
  const openDocument = filePath => api.createInstance({templateId: 'boot-immediate', parameters: {filePath}});
  await assert.rejects(openDocument(lateDocument), e => e.status === 409);
  assert.equal((await api.listInstances()).length, 0);
  const localDocument = join(localRoot, 'local.txt'); await writeFile(localDocument, 'available local document\n');
  const localApp = await openDocument(localDocument); owned.add(localApp.id); await ready(localApp.id); await api.stopInstance(localApp.id);
  await mkdir(offlineRoot); await writeFile(lateDocument, 'storage restored without restarting Manager\n');
  const lateApp = await openDocument(lateDocument); owned.add(lateApp.id); await ready(lateApp.id); await api.stopInstance(lateApp.id);
  await rename(offlineRoot, offlineRoot + '-detached');
  await stopManager(); await startManager();
  await assert.rejects(openDocument(lateDocument), e => e.status === 409);
  await assert.rejects(openDocument(join(offlineRoot + '-detached', 'document.txt')), e => e.status === 409);
  await rename(offlineRoot + '-detached', offlineRoot);
  const recoveredApp = await openDocument(lateDocument); owned.add(recoveredApp.id); await ready(recoveredApp.id); await api.stopInstance(recoveredApp.id);
  const outside = join(work, 'outside.txt'); await writeFile(outside, 'outside allowlist');
  const escape = join(localRoot, 'escape.txt'); await symlink(outside, escape);
  await assert.rejects(openDocument(escape), e => e.status === 409);
  checks.push('offline-document-roots-log-errors-without-blocking-HTTP-local-App-or-Manager-restart');
  checks.push('document-root-recovery-without-Manager-restart-and-file-request-fail-closed-no-parent-or-symlink-escape');
  const immediate = await api.createInstance({templateId: 'boot-immediate'}); owned.add(immediate.id);
  const registration = await api.createManagedInstance({id: 'boot-desktop-fixture', templateId: 'boot-on-attach', desiredState: 'running'});
  assert(registration.runtime && !owned.has(registration.runtime.id)); owned.add(registration.runtime.id);
  let before = [await ready(immediate.id), await activate(registration.runtime.id)];
  const document = join(before[0].homePath, 'boot-preserved-document.txt');
  await writeFile(document, 'saved data survives boot recovery\n');
  const initialServices = await Promise.all(before.map(x => services(x.id)));
  await stopManager(); await startManager();
  assert.deepEqual(await Promise.all(before.map(x => services(x.id))), initialServices);
  checks.push('same-boot-Manager-restart-keeps-App-service-identities');
  for (let round = 0; round < 2; round++) {
    await simulateOldBoot(before); await startManager();
    const pending = await api.getInstance(before[1].id);
    assert.equal(pending.state, 'server-ready'); assert.equal(pending.sessionState, 'stopped');
    assert(pending.sessionGeneration > before[1].sessionGeneration);
    const after = [await ready(before[0].id), await activate(before[1].id)];
    for (let i = 0; i < after.length; i++) {
      for (const key of ['id', 'profileRef', 'homePath', 'createdAt', 'driverVersion']) assert.equal(after[i][key], before[i][key]);
      assert(after[i].sessionGeneration > before[i].sessionGeneration);
      const info = await api.getConnections(after[i].id);
      assert.equal(info.sessionGeneration, after[i].sessionGeneration); assert(info.environment.ibus.address);
      assert.equal((await services(after[i].id)).generation, after[i].sessionGeneration);
    }
    assert.equal(await readFile(document, 'utf8'), 'saved data survives boot recovery\n');
    before = after;
    checks.push(`simulated-cross-boot-${round + 1}-same-ID-pins-profile-new-generation-activation-and-connections`);
  }
  const failed = await api.createInstance({templateId: 'boot-immediate'}); owned.add(failed.id);
  await ready(failed.id);
  const record = await services(failed.id);
  const stat = await readFile('/proc/' + record.supervisor.pid + '/stat', 'utf8');
  assert.equal(stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/)[19], record.supervisor.startTime);
  process.kill(record.supervisor.pid, 'SIGKILL');
  const failure = await wait(async () => { const x = await api.getInstance(failed.id); return x.sessionState === 'failed' && x; }, 'supervisor failure not observed');
  await simulateOldBoot([...before, failure]); await startManager();
  const retained = await api.getInstance(failure.id);
  assert.equal(retained.sessionState, 'failed'); assert.equal(retained.sessionGeneration, failure.sessionGeneration);
  assert.equal((await api.getManagedInstance('boot-desktop-fixture')).runtime.id, before[1].id);
  checks.push('pre-existing-session-failure-not-revived-by-boot-change');
  await api.request('/api/managed-instances/boot-desktop-fixture', {method: 'PATCH', body: {desiredState: 'stopped'}});
  await stopManager(); await startManager();
  assert.equal((await api.getManagedInstance('boot-desktop-fixture')).observedState, 'stopped');
  checks.push('explicit-managed-stop-remains-stopped');
  await writeFile(join(work, 'result.json'), JSON.stringify({passed: true, checks, instrumentation: 'Private boot marker simulation only, not a real container reboot.'}, null, 2));
  console.log(JSON.stringify({passed: true, work, checks}));
} catch (error) {
  await writeFile(join(work, 'result.json'), JSON.stringify({passed: false, checks, error: error.message}));
  throw error;
} finally {
  if (manager?.exitCode === null && manager?.signalCode === null) for (const id of owned) {
    try { await api.request('/api/instances/' + id + '/stop', {method: 'POST', body: {force: true}}); } catch {}
  }
  await stopManager();
  console.log('Retained boot fixture evidence: ' + work);
}
