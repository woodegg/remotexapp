// Real isolated LightView/Viewer/lifecycle acceptance. Never touches deployed runtimes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, stat, unlink, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { RemoteXAppManager } from '../../cmd/remotexappd/web/sdk/remotexapp-manager.js';

const exec = promisify(execFile);
const delay = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
const root = resolve(process.env.REMOTEXAPP_SHIPPED_E2E_RELEASE_ROOT || '.');
const work = await mkdtemp('/tmp/remotexapp-lightview-e2e-');
const base = 'http://127.0.0.1:21996';
const manager = new RemoteXAppManager({ baseURL:base });
const uid = process.getuid();
const env = { ...process.env, XDG_RUNTIME_DIR:`/run/user/${uid}`, DBUS_SESSION_BUS_ADDRESS:`unix:path=/run/user/${uid}/bus` };
const apps = join(work, 'apps'), enabled = join(work, 'enabled'), state = join(work, 'state'), classes = join(work, 'classes');
const shippedManifest = JSON.parse(await readFile(join(root, 'apps/lightview/manifest.json'), 'utf8'));
const currentVersion = shippedManifest.driverVersion;
// Test provenance only, not a Driver compatibility gate. Callers qualifying a
// different installed host release must declare the exact expected version.
const expectedExecutableVersion = process.env.REMOTEXAPP_LIGHTVIEW_EXPECT_VERSION || '0.1.10';
const versionParts = currentVersion.split('-')[0].split('.').map(Number);
const nextVersionValue = `${versionParts[0]}.${versionParts[1]}.${versionParts[2] + 1}`;
const unsafeKeys = ['WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS', 'WEBKIT_DISABLE_DMABUF_RENDERER', 'WEBKIT_DMABUF_RENDERER_FORCE_SHM', 'LIBGL_ALWAYS_SOFTWARE'];
const viewers = [], created = [], checks = [];
let managerProcess;

async function waitFor(predicate, label, attempts = 600) {
  let last;
  for (let index = 0; index < attempts; index++) {
    last = await predicate();
    if (last) return last;
    await delay(100);
  }
  throw new Error(`${label} timed out; last=${JSON.stringify(last)}`);
}

async function setTestWebKitEnvironment() {
  const { stdout } = await exec('systemctl', ['--user', 'show-environment'], { env });
  const previous = new Map(stdout.split('\n').filter(Boolean).map(line => {
    const offset = line.indexOf('=');
    return [line.slice(0, offset), line.slice(offset + 1)];
  }));
  await exec('systemctl', ['--user', 'set-environment',
    'WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1', 'WEBKIT_DMABUF_RENDERER_FORCE_SHM=1', 'LIBGL_ALWAYS_SOFTWARE=1'], { env });
  return async () => {
    await exec('systemctl', ['--user', 'unset-environment', ...unsafeKeys], { env });
    const restore = unsafeKeys.filter(key => previous.has(key)).map(key => `${key}=${previous.get(key)}`);
    if (restore.length) await exec('systemctl', ['--user', 'set-environment', ...restore], { env });
  };
}

async function startManager() {
  managerProcess = spawn(join(root, 'bin/remotexappd'), [
    '-listen', '127.0.0.1:21996', '-auth-mode', 'none', '-expose-internals=true',
    '-state-dir', state, '-class-config', classes, '-app-package-root', apps,
    '-apps-enabled', enabled, '-gateway-bin', join(root, 'bin/novnc-input'),
    '-status-bin', join(root, 'bin/remotexapp-status'), '-core-driver-dir', join(root, 'drivers/common'),
    '-ibus-engine', join(root, 'components/remote-unicode-engine/engine.py'),
  ], { env, stdio:['ignore', 'ignore', 'pipe'] });
  managerProcess.stderr.on('data', chunk => process.stderr.write(chunk));
  await waitFor(async () => {
    if (managerProcess.exitCode !== null) throw new Error(`manager exited ${managerProcess.exitCode}`);
    try { return (await fetch(`${base}/readyz`)).ok; } catch { return false; }
  }, 'manager readiness', 200);
}

async function stopManager(signal = 'SIGTERM') {
  if (!managerProcess || managerProcess.exitCode !== null) return;
  await new Promise(resolveExit => { managerProcess.once('exit', resolveExit); managerProcess.kill(signal); });
  managerProcess = undefined;
}

async function launchViewer(instanceId, port) {
  const profile = join(work, `chrome-${port}`);
  await mkdir(profile, { recursive:true });
  const child = spawn('google-chrome', [
    '--headless=new', '--disable-background-networking', '--disable-default-apps', '--disable-extensions',
    '--disable-sync', '--metrics-recording-only', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${port}`, '--window-size=1100,760', `--user-data-dir=${profile}`,
    instanceId ? `${base}/remotexapps/${instanceId}/kiosk.html?diagnostics=on` : `${base}/sdk/minimal.html`,
  ], { env, stdio:['ignore', 'ignore', 'pipe'] });
  viewers.push(child);
  await waitFor(async () => {
    if (child.exitCode !== null) throw new Error(`viewer exited ${child.exitCode}`);
    try { return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch { return false; }
  }, 'viewer readiness', 300);
  return child;
}

async function navigateViewer(port, url) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method:'PUT' });
  assert.equal(response.ok, true, `prepared Viewer navigation failed: ${response.status}`);
  const page = await response.json();
  assert.equal(page.type, 'page');
}

async function stopViewer(child) {
  if (child.exitCode !== null) return;
  await new Promise(resolveExit => { child.once('exit', resolveExit); child.kill('SIGTERM'); });
}

async function waitReady(id, generation = 1) {
  return waitFor(async () => {
    const instance = await manager.getInstance(id);
    if (instance.state === 'failed' || instance.applicationStatus?.state === 'error') {
      throw new Error(`LightView failed: ${JSON.stringify(instance.applicationStatus)}`);
    }
    return instance.sessionGeneration >= generation && instance.applicationStatus?.state === 'ready' ? instance : false;
  }, `${id} ready`);
}

async function unixRequest(path, command, fields = {}) {
  return new Promise((resolveReply, rejectReply) => {
    const client = net.createConnection(path);
    let response = Buffer.alloc(0);
    const timer = setTimeout(() => { client.destroy(); rejectReply(new Error('LightView socket timeout')); }, 5000);
    client.once('connect', () => client.write(`${JSON.stringify({ command, ...fields })}\n`));
    client.on('data', chunk => {
      response = Buffer.concat([response, chunk]);
      if (response.length > 4 * 1024 * 1024 + 1) client.destroy(new Error('oversized LightView response'));
    });
    client.once('error', error => { clearTimeout(timer); rejectReply(error); });
    client.once('end', () => {
      clearTimeout(timer);
      try {
        assert.equal(response.at(-1), 10);
        const envelope = JSON.parse(response.subarray(0, -1));
        if (!envelope.ok) throw new Error(envelope.error);
        resolveReply(envelope.result);
      } catch (error) { rejectReply(error); }
    });
  });
}

async function activateLightView(port) {
  const launch = await manager.createInstance({ templateId:'lightview', parameters:{ startUrl:'about:blank' } });
  created.push(launch.id);
  await waitFor(async () => (await manager.getInstance(launch.id)).state === 'server-ready', 'server ready', 300);
  const viewer = await launchViewer(launch.id, port);
  return { instance:await waitReady(launch.id), viewer };
}

async function setMemoryPolicy(socket, enabled, threshold = 3072) {
  await unixRequest(socket, 'memory-protection', { enabled, kill_threshold_mib:threshold });
  return waitFor(async () => {
    const status = await unixRequest(socket, 'status');
    return status.engine_state === 'ready' && status.loading === false &&
      status.memory_protection_enabled === enabled &&
      status.memory_kill_threshold_mib === (enabled ? threshold : 0) ? status : false;
  }, 'settled memory policy');
}

let restoreEnvironment = async () => {};
try {
  let occupied = false;
  try { occupied = (await fetch(`${base}/readyz`)).ok; } catch {}
  assert.equal(occupied, false, 'isolated port 21996 is already in use');
  for (const path of [apps, enabled, state, classes]) await mkdir(path, { recursive:true });
  restoreEnvironment = await setTestWebKitEnvironment();
  await exec(join(root, 'scripts/install-shipped-apps.sh'), [join(root, 'bin/remotexappd'), apps, enabled], { env, timeout:60000 });

  const firstArchiveDir = join(work, 'archive-a'), secondArchiveDir = join(work, 'archive-b');
  const firstArchive = (await exec(join(root, 'scripts/package-app.sh'), [join(root, 'apps/lightview'), firstArchiveDir], { env })).stdout.trim();
  const secondArchive = (await exec(join(root, 'scripts/package-app.sh'), [join(root, 'apps/lightview'), secondArchiveDir], { env })).stdout.trim();
  assert.equal(createHash('sha256').update(await readFile(firstArchive)).digest('hex'),
    createHash('sha256').update(await readFile(secondArchive)).digest('hex'));
  checks.push('deterministic-package');

  const broken = join(work, 'missing-dependency');
  await cp(join(root, 'apps/lightview'), broken, { recursive:true });
  const brokenManifest = JSON.parse(await readFile(join(broken, 'manifest.json')));
  brokenManifest.id = 'lightview-missing-dependency';
  brokenManifest.dependencies.executables.push('definitely-missing-lightview-dependency');
  await writeFile(join(broken, 'manifest.json'), `${JSON.stringify(brokenManifest, null, 2)}\n`);
  const brokenArchive = (await exec(join(root, 'scripts/package-app.sh'), [broken, join(work, 'broken-dist')], { env })).stdout.trim();
  await assert.rejects(exec(join(root, 'scripts/install-app.sh'), ['--archive', brokenArchive,
    '--sha256', createHash('sha256').update(await readFile(brokenArchive)).digest('hex'),
    '--package-root', apps, '--enabled-root', enabled], { env }), error => /missing executable dependency/.test(String(error.stderr)));
  checks.push('missing-dependency-fails-closed');

  const nextVersion = join(work, 'lightview-next');
  await cp(join(root, 'apps/lightview'), nextVersion, { recursive:true });
  const nextManifest = JSON.parse(await readFile(join(nextVersion, 'manifest.json')));
  nextManifest.driverVersion = nextVersionValue;
  await writeFile(join(nextVersion, 'manifest.json'), `${JSON.stringify(nextManifest, null, 2)}\n`);
  const nextArchive = (await exec(join(root, 'scripts/package-app.sh'), [nextVersion, join(work, 'next-dist')], { env })).stdout.trim();
  await exec(join(root, 'scripts/install-app.sh'), ['--archive', nextArchive,
    '--sha256', createHash('sha256').update(await readFile(nextArchive)).digest('hex'),
    '--package-root', apps, '--enabled-root', enabled], { env });
  assert.equal((await readFile(join(apps, `lightview/${nextVersionValue}/manifest.json`), 'utf8')).includes(`"${nextVersionValue}"`), true);
  await exec(join(root, 'scripts/manage-app.sh'), ['--activate', `lightview@${currentVersion}`, '--package-root', apps, '--enabled-root', enabled], { env });
  assert.equal(basename(await realpath(join(enabled, 'lightview'))), currentVersion);
  checks.push('package-only-upgrade-and-rollback');

  const vacancyFixture = join(work, 'lightview-vacancy');
  await cp(join(root, 'apps/lightview'), vacancyFixture, { recursive:true });
  const vacancyManifest = JSON.parse(await readFile(join(vacancyFixture, 'manifest.json')));
  vacancyManifest.id = 'lightview-vacancy';
  vacancyManifest.name = 'LightView vacancy fixture';
  // Preserve enough margin for a cold VNC server and Viewer while still
  // exercising the same stop-instance transition as the six-hour policy.
  vacancyManifest.session.vacantTimeout = '60s';
  await writeFile(join(vacancyFixture, 'manifest.json'), `${JSON.stringify(vacancyManifest, null, 2)}\n`);
  const vacancyArchive = (await exec(join(root, 'scripts/package-app.sh'), [vacancyFixture, join(work, 'vacancy-dist')], { env })).stdout.trim();
  await exec(join(root, 'scripts/install-app.sh'), ['--archive', vacancyArchive,
    '--sha256', createHash('sha256').update(await readFile(vacancyArchive)).digest('hex'),
    '--package-root', apps, '--enabled-root', enabled], { env });

  await startManager();
  let { instance, viewer } = await activateLightView(9296);
  const originalId = instance.id, originalGeneration = instance.sessionGeneration;
  assert.equal(instance.driverVersion, currentVersion);
  assert.deepEqual(instance.resources, {});
  assert.deepEqual(instance.applicationStatus.details,
    { application:'lightview', launchLowMemory:true });
  assert.deepEqual(instance.effectivePolicy.display,
    { mode:'dynamic', number:0, size:'1280x720', depth:16, frameRate:5, allowClientResize:true });
  assert.equal(JSON.stringify(instance).includes('control.sock'), false);
  assert.equal((await manager.createInstance({ templateId:'lightview', parameters:{ startUrl:'https://example.invalid/ignored' } })).id, instance.id);
  const secondViewer = await launchViewer(instance.id, 9298);
  await waitFor(async () => (await manager.getInstance(instance.id)).attachedClients >= 2, 'two attached viewers');
  await stopViewer(secondViewer);
  checks.push('singleton-two-Viewer-sharing');

  const connections = await manager.getConnections(instance.id, { sessionGeneration:instance.sessionGeneration });
  assert.equal(connections.application.protocol, 'lightview-json-v1');
  assert.equal(connections.application.transport, 'unix');
  assert.equal(connections.application.socketPath, join(instance.runtimePath, 'lightview/control.sock'));
  const socketInfo = await lstat(connections.application.socketPath);
  assert(socketInfo.isSocket());
  assert.equal(socketInfo.uid, uid);
  const directoryInfo = await stat(join(instance.runtimePath, 'lightview'));
  assert.equal(directoryInfo.mode & 0o777, 0o700);
  let nativeStatus = await unixRequest(connections.application.socketPath, 'status');
  assert.equal(nativeStatus.low_memory, true);
  assert.equal(nativeStatus.memory_limit_mib, 384);
  assert.equal(nativeStatus.memory_kill_threshold_mib, 3072);
  assert.equal(nativeStatus.engine_state, 'ready');
  assert.equal(nativeStatus.version, expectedExecutableVersion);
  assert(Number.isSafeInteger(nativeStatus.web_process_generation));
  assert(nativeStatus.web_process_generation >= 1);
  assert.equal(nativeStatus.pid, Number(await readFile(join(instance.runtimePath, 'lightview-process.pid'))));
  assert.equal(await unixRequest(connections.application.socketPath, 'eval', {
    script:"Boolean(document.createElement('canvas').getContext('webgl'))",
  }), false);
  checks.push('private-descriptor-low-memory-WebGL-disabled');

  const viewerResult = JSON.parse((await exec('node', [join(root, 'tests/go-live-validation/check-browser-client.mjs')], {
    env:{ ...env, VALIDATION_CDP_PORT:'9296', VALIDATION_EXPECT_RESIZE:'1', VALIDATION_TIMEOUT_MS:'45000' }, timeout:60000,
  })).stdout);
  assert(viewerResult.connected);
  const inputResult = JSON.parse((await exec('node', [join(root, 'tests/go-live-validation/check-sdk-lifecycle.mjs')], {
    env:{ ...env, VALIDATION_CDP_PORT:'9296', VALIDATION_INSTANCE_ID:instance.id, VALIDATION_TEXT:'LightView ASCII 你好' }, timeout:60000,
  })).stdout);
  assert.equal(inputResult.textAck.error, '');
  const clipboardResult = JSON.parse((await exec('node', [join(root, 'tests/go-live-validation/check-clipboard-client.mjs')], {
    env:{ ...env, VALIDATION_CLIPBOARD_MODE:'smoke', VALIDATION_CDP_PORTS:'9296', VALIDATION_DISPLAY:instance.display,
      VALIDATION_XAUTHORITY:join(instance.homePath, '.Xauthority'), VALIDATION_TIMEOUT_MS:'45000' }, timeout:90000,
  })).stdout);
  assert.equal(clipboardResult.result, 'passed');
  checks.push('real-Viewer-resize-IME-clipboard');

  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi']) {
    await assert.rejects(manager.invokeAction(instance.id, 'openUrl', { url }, { sessionGeneration:instance.sessionGeneration }), error => error.status === 400);
  }
  const target = `${base}/sdk/minimal.html`;
  const action = await manager.invokeAction(instance.id, 'openUrl', { url:target }, { sessionGeneration:instance.sessionGeneration });
  assert.equal(action.result.requestedUrl, target);
  assert.equal(action.result.currentUri, target);
  assert.equal((await unixRequest(connections.application.socketPath, 'status')).uri, target);
  checks.push('bounded-openUrl');

  const beforeHibernate = await unixRequest(connections.application.socketPath, 'status');
  try {
    await exec('lightviewctl', ['--socket', connections.application.socketPath, 'hibernate-after', '2'], { env });
    await waitFor(async () => {
      const status = await unixRequest(connections.application.socketPath, 'status');
      return status.engine_state === 'suspended' ? status : false;
    }, 'LightView WebKit hibernation', 200);
    const wake = await manager.invokeAction(instance.id, 'openUrl', { url:target },
      { sessionGeneration:instance.sessionGeneration });
    assert.equal(wake.result.currentUri, target);
    const afterWake = await unixRequest(connections.application.socketPath, 'status');
    assert.equal(afterWake.engine_state, 'ready');
    assert.equal(afterWake.pid, beforeHibernate.pid, 'hibernation must not replace the native process');
    checks.push('suspended-WebKit-openUrl-wakeup');
  } finally {
    await exec('lightviewctl', ['--socket', connections.application.socketPath, 'hibernate-after',
      String(beforeHibernate.idle_hibernate_seconds)], { env });
  }

  // A Viewer reconnect must wake a native-suspended engine without requiring
  // any explicit App action or replacing the LightView process/socket.
  await stopViewer(viewer);
  await waitFor(async () => (await manager.getInstance(instance.id)).attachedClients === 0,
    'all LightView viewers detached');
  await waitFor(async () => (await unixRequest(connections.application.socketPath, 'status')).idle_hibernate_seconds === 3600,
    'last Viewer restored LightView idle policy');
  await exec('lightviewctl', ['--socket', connections.application.socketPath, 'hibernate-after', '2'], { env });
  await waitFor(async () => (await unixRequest(connections.application.socketPath, 'status')).engine_state === 'suspended',
    'detached LightView hibernation', 200);
  await exec('lightviewctl', ['--socket', connections.application.socketPath, 'hibernate-after', '3600'], { env });
  viewer = await launchViewer(instance.id, 9296);
  await waitFor(async () => (await manager.getInstance(instance.id)).attachedClients === 1,
    'hibernated Viewer reattached');
  nativeStatus = await unixRequest(connections.application.socketPath, 'status');
  assert.equal(nativeStatus.engine_state, 'ready');
  assert.equal(nativeStatus.uri, target);
  assert.equal(nativeStatus.idle_hibernate_seconds, 0);
  assert.equal(nativeStatus.pid, beforeHibernate.pid);
  checks.push('suspended-WebKit-Viewer-reattach-wakeup');

  for (const [enabled, threshold] of [[false,3072],[true,4096],[true,3072],[false,3072]]) {
    const current = await setMemoryPolicy(connections.application.socketPath, enabled, threshold);
    assert.equal(current.pid, nativeStatus.pid);
    for (let repetition = 0; repetition < 2; repetition++) {
      const result = await manager.invokeAction(instance.id, 'openUrl', { url:target }, { sessionGeneration:instance.sessionGeneration });
      assert.equal(result.result.currentUri, target);
    }
    const after = await unixRequest(connections.application.socketPath, 'status');
    assert.equal(after.memory_protection_enabled, enabled, 'navigation must not override user policy');
    assert.equal(after.memory_kill_threshold_mib, enabled ? threshold : 0);
    assert.deepEqual((await manager.getInstance(instance.id)).applicationStatus.details,
      { application:'lightview', launchLowMemory:true }, 'status must not claim a live enforced threshold');
  }
  checks.push('memory-policy-off-on-alternate-threshold-repeated-navigation');

  await unixRequest(connections.application.socketPath, 'eval', {
    script:"(() => { localStorage.setItem('remotexapp-lightview-e2e','preserved'); return true; })()",
  });
  // A hard WebKit reset can discard pending writes. Prove committed profile
  // data survives, rather than racing WebKit's asynchronous SQLite flush.
  const profileDatabase = join(instance.homePath, '.local/share/remotexapp/lightview/default/localstorage/http_127.0.0.1_21996.localstorage');
  await waitFor(async () => {
    try {
      const result = await exec('/usr/bin/python3', ['-c',
        'import sqlite3,sys; c=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True); r=c.execute("SELECT hex(value) FROM ItemTable WHERE key=?",("remotexapp-lightview-e2e",)).fetchone(); print(r[0] if r else "")',
        profileDatabase], { env });
      return result.stdout.trim() === '700072006500730065007200760065006400';
    } catch { return false; }
  }, 'persistent profile marker committed to disk', 100);
  const beforeSoftReset = await unixRequest(connections.application.socketPath, 'status');
  const socketInode = (await stat(connections.application.socketPath)).ino;
  const softReset = await unixRequest(connections.application.socketPath, 'reset', { hard:false });
  assert(softReset.target_generation > beforeSoftReset.web_process_generation);
  nativeStatus = await waitFor(async () => {
    const status = await unixRequest(connections.application.socketPath, 'status');
    return status.engine_state === 'ready' && status.web_process_generation >= softReset.target_generation ? status : false;
  }, 'LightView soft reset');
  assert.equal(nativeStatus.pid, beforeSoftReset.pid);
  assert.equal((await stat(connections.application.socketPath)).ino, socketInode);
  assert.equal(nativeStatus.last_termination_reason, 'terminated-by-api');
  assert.equal(nativeStatus.uri, 'about:blank');
  const hardReset = await unixRequest(connections.application.socketPath, 'reset', { hard:true });
  nativeStatus = await waitFor(async () => {
    const status = await unixRequest(connections.application.socketPath, 'status');
    return status.engine_state === 'ready' && status.web_process_generation >= hardReset.target_generation ? status : false;
  }, 'LightView hard reset');
  assert.equal(nativeStatus.pid, beforeSoftReset.pid);
  assert.equal((await stat(connections.application.socketPath)).ino, socketInode);
  await manager.invokeAction(instance.id, 'openUrl', { url:target }, { sessionGeneration:instance.sessionGeneration });
  assert.equal(await unixRequest(connections.application.socketPath, 'eval', {
    script:"localStorage.getItem('remotexapp-lightview-e2e')",
  }), 'preserved');
  checks.push('stable-socket-soft-hard-WebKit-recovery');
  const processBeforeAdoption = nativeStatus.pid;
  await stopViewer(viewer);
  await waitFor(async () => (await manager.getInstance(originalId)).attachedClients === 0,
    'all LightView viewers detached before adoption');
  await stopManager();
  await startManager();
  instance = await waitReady(originalId, originalGeneration);
  nativeStatus = await unixRequest((await manager.getConnections(originalId)).application.socketPath, 'status');
  assert.equal(instance.sessionGeneration, originalGeneration);
  assert.equal(nativeStatus.pid, processBeforeAdoption);
  assert.equal(nativeStatus.idle_hibernate_seconds, 3600, 'adoption restores policy after all Viewer sockets are lost');
  assert.equal(await lstat(join(instance.runtimePath, 'lightview/viewer-hibernate-policy.json')).then(() => true, () => false),
    false, 'adoption clears the viewer policy journal');
  checks.push('Manager-restart-adoption');

  await setMemoryPolicy((await manager.getConnections(originalId)).application.socketPath, false);
  const restarted = await manager.restartInstance(originalId, { sessionGeneration:originalGeneration });
  viewer = await launchViewer(originalId, 9296);
  instance = await waitReady(originalId, restarted.sessionGeneration);
  const restartedConnections = await manager.getConnections(originalId, { sessionGeneration:instance.sessionGeneration });
  nativeStatus = await unixRequest(restartedConnections.application.socketPath, 'status');
  assert.notEqual(nativeStatus.pid, processBeforeAdoption);
  await manager.invokeAction(originalId, 'openUrl', { url:target }, { sessionGeneration:instance.sessionGeneration });
  assert.equal(await unixRequest(restartedConnections.application.socketPath, 'eval', {
    script:"localStorage.getItem('remotexapp-lightview-e2e')",
  }), 'preserved');
  checks.push('ordinary-restart-profile-continuity');

  for (const version of [nextVersionValue]) {
    await setMemoryPolicy((await manager.getConnections(originalId)).application.socketPath, false);
    await exec(join(root, 'scripts/manage-app.sh'), ['--activate', `lightview@${version}`, '--package-root', apps, '--enabled-root', enabled], { env });
    await stopManager(); await startManager();
    const versions = await manager.getRuntimeVersions(originalId);
    const upgrade = await manager.upgradeAndRestartInstance(originalId, {
      sessionGeneration:instance.sessionGeneration, targetRevision:versions.versions.targetRevision,
    });
    instance = await waitReady(originalId, upgrade.sessionGeneration);
    assert.equal(instance.driverVersion, version);
    nativeStatus = await unixRequest((await manager.getConnections(originalId)).application.socketPath, 'status');
    await manager.invokeAction(originalId, 'openUrl', { url:target }, { sessionGeneration:instance.sessionGeneration });
  }
  // Runtime downgrades are deliberately rejected. Rolling back the selector
  // affects future launches, not this upgraded runtime's immutable pin.
  await exec(join(root, 'scripts/manage-app.sh'), ['--activate', `lightview@${currentVersion}`, '--package-root', apps, '--enabled-root', enabled], { env });
  await stopManager(); await startManager();
  const downgrade = await manager.getRuntimeVersions(originalId);
  await assert.rejects(manager.upgradeAndRestartInstance(originalId, {
    sessionGeneration:instance.sessionGeneration, targetRevision:downgrade.versions.targetRevision,
  }), error => error.status === 409 && /downgrade/.test(error.message));
  assert.equal((await manager.getInstance(originalId)).driverVersion, nextVersionValue);
  checks.push('disabled-protection-graceful-App-upgrade-and-downgrade-rejection');

  const crashedPid = nativeStatus.pid;
  process.kill(crashedPid, 'SIGKILL');
  await waitFor(async () => {
    const current = await manager.getInstance(originalId);
    return current.applicationStatus?.state === 'error' || current.sessionState === 'failed' ? current : false;
  }, 'crash observation');
  const crashed = await manager.getInstance(originalId);
  const recoveredRequest = await manager.restartInstance(originalId, { sessionGeneration:crashed.sessionGeneration, force:true });
  instance = await waitReady(originalId, recoveredRequest.sessionGeneration);
  nativeStatus = await unixRequest((await manager.getConnections(originalId)).application.socketPath, 'status');
  assert.notEqual(nativeStatus.pid, crashedPid);
  checks.push('crash-stale-socket-recovery');

  const liveSocket = (await manager.getConnections(originalId)).application.socketPath;
  const livePid = nativeStatus.pid;
  process.kill(livePid, 'SIGKILL');
  await waitFor(async () => (await manager.getInstance(originalId)).applicationStatus?.state === 'error', 'substitution crash');
  await unlink(liveSocket);
  await writeFile(liveSocket, 'not a socket', { mode:0o600 });
  const rejectedControl = await exec('python3', [join(root, 'apps/lightview/control.py'), liveSocket, String(livePid), 'status'], { env }).catch(error => error);
  assert.notEqual(rejectedControl.code, 0);
  assert.match(String(rejectedControl.stderr), /not an owned Unix socket/);
  assert.equal((await lstat(liveSocket)).isFile(), true);
  await unlink(liveSocket);
  const rejected = await manager.getInstance(originalId);
  const afterRepair = await manager.restartInstance(originalId, { sessionGeneration:rejected.sessionGeneration, force:true });
  instance = await waitReady(originalId, afterRepair.sessionGeneration);
  checks.push('socket-substitution-control-fails-closed-and-runtime-recovers');

  const quitSocket = (await manager.getConnections(originalId)).application.socketPath;
  await unixRequest(quitSocket, 'quit');
  await waitFor(async () => {
    const current = await manager.getInstance(originalId);
    return current.state === 'stopped' && current.sessionState === 'stopped' ? current : false;
  }, 'native quit cleanup');
  await assert.rejects(stat(instance.runtimePath), error => error.code === 'ENOENT');
  checks.push('native-app-exit-stop-instance-cleanup');
  await stopViewer(viewer);

  const second = await activateLightView(9297);
  instance = second.instance;
  assert.notEqual(instance.id, originalId);
  const secondConnections = await manager.getConnections(instance.id);
  await manager.invokeAction(instance.id, 'openUrl', { url:target }, { sessionGeneration:instance.sessionGeneration });
  assert.equal(await unixRequest(secondConnections.application.socketPath, 'eval', {
    script:"localStorage.getItem('remotexapp-lightview-e2e')",
  }), 'preserved');
  await setMemoryPolicy(secondConnections.application.socketPath, false);
  const stopResult = await manager.stopInstance(instance.id);
  assert.equal(stopResult.state, 'stopped');
  await stopViewer(second.viewer);
  checks.push('disabled-protection-graceful-stop-and-recreated-profile-continuity');

  const vacancyViewer = await launchViewer('', 9299);
  const vacancyLaunch = await manager.createInstance({ templateId:'lightview-vacancy' });
  created.push(vacancyLaunch.id);
  await waitFor(async () => (await manager.getInstance(vacancyLaunch.id)).state === 'server-ready', 'vacancy server ready', 300);
  await navigateViewer(9299, `${base}/remotexapps/${vacancyLaunch.id}/kiosk.html?diagnostics=on`);
  await waitReady(vacancyLaunch.id);
  const vacancyRuntimePath = (await manager.getInstance(vacancyLaunch.id)).runtimePath;
  await stopViewer(vacancyViewer);
  await waitFor(async () => {
    const current = await manager.getInstance(vacancyLaunch.id);
    return current.state === 'stopped' && current.sessionState === 'stopped' ? current : false;
  }, 'simulated vacancy cleanup', 900);
  await assert.rejects(stat(vacancyRuntimePath), error => error.code === 'ENOENT');
  checks.push('simulated-six-hour-vacancy-stop-instance');

  const result = { passed:true, work, appVersion:currentVersion, executableVersion:expectedExecutableVersion, checks };
  await writeFile(join(work, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result));
} finally {
  for (const id of created) {
    try { await manager.stopInstance(id, { force:true }); } catch (error) { if (error.status !== 404) process.stderr.write(`cleanup ${id}: ${error.message}\n`); }
  }
  for (const viewer of viewers) await stopViewer(viewer);
  await stopManager();
  await restoreEnvironment();
  process.stderr.write(`retained LightView evidence: ${work}\n`);
}
