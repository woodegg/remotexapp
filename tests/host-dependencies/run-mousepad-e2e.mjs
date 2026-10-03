// Explicit local live test. Own temporary Manager/App state only; no installed
// service, existing desktop, package selector or default account bus is changed.
import assert from 'node:assert/strict';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, mkdir, readFile, writeFile, cp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join, resolve} from 'node:path';
import {RemoteXAppManager} from '../../cmd/remotexappd/web/sdk/remotexapp-manager.js';

const exec = promisify(execFile), sleep = ms => new Promise(r => setTimeout(r, ms));
const root = resolve(process.env.REMOTEXAPP_U26_RELEASE_ROOT || '.');
const work = await mkdtemp('/tmp/remotexapp-u26-mousepad-');
const base = 'http://127.0.0.1:21997', api = new RemoteXAppManager({baseURL: base});
const state = join(work, 'state'), apps = join(work, 'apps'), enabled = join(work, 'enabled');
const created = [], checks = [], startedAt = new Date().toISOString();
let manager, socket, sequence = 0;
async function wait(fn, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await sleep(100); }
  throw Error(label);
}
async function ready(id) {
  return wait(async () => { const x = await api.getInstance(id); return x.sessionState === 'running' && x.applicationStatus.state === 'ready' && x; }, 'Mousepad not ready');
}
async function install(version) {
  const source = join(work, 'source-' + version);
  await cp(join(root, 'apps/mousepad'), source, {recursive: true});
  const manifest = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'));
  assert.equal(manifest.driverVersion, '4.0.1');
  manifest.driverVersion = version;
  if (version === '4.0.0') manifest.input.allowedWmClasses = ['Mousepad'];
  await writeFile(join(source, 'manifest.json'), JSON.stringify(manifest));
  const archive = (await exec(join(root, 'scripts/package-app.sh'), [source, join(work, 'archives')])).stdout.trim();
  const sha256 = createHash('sha256').update(await readFile(archive)).digest('hex');
  await exec(join(root, 'scripts/install-app.sh'), ['--archive', archive, '--sha256', sha256, '--package-root', apps, '--enabled-root', enabled]);
  if (manager) {
    // Selectors are read at Manager startup, not watched automatically. Refresh
    // only this test Manager; adoption must preserve already-running App pins.
    await new Promise(resolve => { manager.once('exit', resolve); manager.kill('SIGTERM'); });
    manager = spawn(manager.spawnfile, manager.spawnargs.slice(1), {stdio: 'ignore'});
    await wait(async () => { if (manager.exitCode !== null) throw Error('Manager exited'); try { return (await fetch(base + '/readyz')).ok; } catch { return false; } }, 'Manager catalog refresh failed');
  }
}
async function text(value) {
  const id = ++sequence;
  const response = new Promise((resolve, reject) => {
    const receive = event => { const message = JSON.parse(event.data); if (message.id === id) { clearTimeout(timer); socket.removeEventListener('message', receive); resolve(message); } };
    const timer = setTimeout(() => { socket.removeEventListener('message', receive); reject(Error('text ACK timeout')); }, 10000);
    socket.addEventListener('message', receive);
  });
  socket.send(JSON.stringify({type: 'text', id, value}));
  return response;
}
async function inputReadback(id) {
  const info = await api.getConnections(id);
  const env = {...process.env, DISPLAY: info.environment.display, XAUTHORITY: info.environment.xauthorityPath};
  assert(info.environment.ibus?.address && info.environment.sessionBus?.address);
  const window = (await exec('xdotool', ['search', '--onlyvisible', '--class', 'mousepad'], {env})).stdout.trim().split('\n')[0];
  socket = new WebSocket(base.replace('http:', 'ws:') + `/remotexapps/${id}/input?viewerId=viewer_u26`);
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('input connection timeout')), 10000); socket.onopen = () => { clearTimeout(timer); resolve(); }; socket.onerror = () => { clearTimeout(timer); reject(Error('input connection failed')); }; });
  const read = async () => {
    await exec('xdotool', ['key', '--clearmodifiers', 'ctrl+a', 'ctrl+c'], {env, timeout: 3000});
    return (await exec('xclip', ['-selection', 'clipboard', '-out', '-target', 'UTF8_STRING'], {env, timeout: 3000})).stdout;
  };
  try {
    for (const wmClass of ['Mousepad', 'Org.xfce.mousepad']) {
      await exec('xdotool', ['set_window', '--classname', wmClass, '--class', wmClass, window], {env, timeout: 3000});
      await exec('xdotool', ['windowactivate', '--sync', window, 'mousemove', '--window', window, '100', '100', 'click', '1', 'key', '--clearmodifiers', 'ctrl+a', 'BackSpace'], {env, timeout: 5000});
      await sleep(250);
      const value = 'Unicode 中文 日本語\nsecond line';
      const ack = await text(value); assert.equal(ack.type, 'text-ack'); assert(!ack.error);
      await wait(async () => (await read()) === value, 'ACK without actual document delivery', 6000);
      checks.push({id: `readback-${id}-${wmClass}`, result: 'passed'});
    }
    await exec('xdotool', ['set_window', '--classname', 'Authentication', '--class', 'Authentication', window], {env});
    const before = await read(), reply = await text('MUST_NOT_APPEAR');
    assert(reply.error || reply.ok === false || reply.type === 'error');
    assert.equal(await read(), before);
    checks.push({id: `wrong-class-rejected-${id}`, result: 'passed'});
  } finally { socket.close(); socket = null; }
}

try {
  let occupied = false; try { occupied = (await fetch(base + '/readyz')).ok; } catch {}
  assert(!occupied, 'temporary Manager port already in use');
  for (const path of [state, apps, enabled, join(work, 'legacy')]) await mkdir(path, {recursive: true});
  await install('4.0.0');
  manager = spawn(join(root, 'bin/remotexappd'), ['-listen', '127.0.0.1:21997', '-auth-mode', 'none',
    '-state-dir', state, '-class-config', join(work, 'legacy'), '-app-package-root', apps, '-apps-enabled', enabled,
    '-gateway-bin', join(root, 'bin/novnc-input'), '-status-bin', join(root, 'bin/remotexapp-status'),
    '-core-driver-dir', join(root, 'drivers/common'), '-ibus-engine', join(root, 'components/remote-unicode-engine/engine.py'), '-expose-internals=true'], {stdio: 'ignore'});
  await wait(async () => { if (manager.exitCode !== null) throw Error('Manager exited'); try { return (await fetch(base + '/readyz')).ok; } catch { return false; } }, 'Manager not ready');
  for (const old of ['4.0.0', '4.0.0-sandbox.ubuntu2604.1']) {
    if (old !== '4.0.0') await install(old);
    const instance = await api.createInstance({templateId: 'mousepad'}); created.push(instance.id);
    const before = await ready(instance.id); assert.equal(before.versions.current.app.version, old);
    await install('4.0.1');
    const {versions} = await api.getRuntimeVersions(instance.id);
    assert.equal(versions.current.app.version, old); assert.equal(versions.available.app.version, '4.0.1');
    assert(versions.eligible && versions.updateAvailable);
    await api.upgradeAndRestartInstance(instance.id, {sessionGeneration: before.sessionGeneration, targetRevision: versions.targetRevision, force: true});
    const after = await ready(instance.id);
    assert.equal(after.versions.current.app.version, '4.0.1'); assert(after.sessionGeneration > before.sessionGeneration);
    await assert.rejects(api.getConnections(instance.id, {sessionGeneration: before.sessionGeneration}), error => error.status === 409);
    checks.push({id: `upgrade-${old}-to-4.0.1`, result: 'passed'});
    await inputReadback(instance.id);
    await api.stopInstance(instance.id, {force: true});
  }
  await writeFile(join(work, 'result.json'), JSON.stringify({result: 'passed', startedAt, completedAt: new Date().toISOString(),
    instrumentation: ['old version selector fixtures use current Driver scripts', 'WM_CLASS changed only on owned Mousepad windows; not a native Ubuntu 26.04 binary'], checks}, null, 2));
  console.log(JSON.stringify({result: 'passed', work, checks}));
} catch (error) {
  await writeFile(join(work, 'result.json'), JSON.stringify({result: 'failed', startedAt,
    completedAt: new Date().toISOString(), checks, error: error.message}, null, 2));
  throw error;
} finally {
  socket?.close();
  if (manager?.exitCode === null) {
    for (const id of created) { try { await api.stopInstance(id, {force: true}); } catch {} }
    await new Promise(resolve => { manager.once('exit', resolve); manager.kill('SIGTERM'); });
  }
  console.error('Retained local evidence: ' + work);
}
