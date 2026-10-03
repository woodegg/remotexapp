// Explicit live gate; run through run-state-matrix.sh, never as an existing user.
// Real shipped applications, with declared test-only startup/shutdown barriers.
import assert from 'node:assert/strict';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir, readFile, writeFile, appendFile, cp, lstat, unlink} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {RemoteXAppManager} from '../../cmd/remotexappd/web/sdk/remotexapp-manager.js';

process.umask(0o077);
const exec = promisify(execFile), delay = ms => new Promise(r => setTimeout(r, ms));
const root = resolve(process.argv[2]), work = join(homedir(), 'matrix');
const uid = process.getuid();
assert(uid > 0 && String(uid) === process.env.REMOTEXAPP_MATRIX_DISPOSABLE_UID);
assert.match(homedir(), /^\/var\/tmp\/remotexapp-svc-matrix\.[^/]+\/home$/);
const allApps = ['mousepad', 'libreoffice', 'kate', 'kwrite', 'firefox-esr', 'edge', 'xfce-user-desktop'];
const selected = process.argv[3] === 'all' ? allApps : process.argv[3].split(',');
assert(selected.length && selected.every(x => allApps.includes(x)));
const mode = process.argv[4] || 'main'; assert(['main', 'interaction', 'transport', 'managed-transport', 'borrowed-bus', 'shutdown-outcomes'].includes(mode));
if (mode === 'borrowed-bus') assert.deepEqual(selected, ['xfce-user-desktop']);
const port = 21996, base = `http://127.0.0.1:${port}`;
const state = join(work, 'state'), apps = join(work, 'apps'), enabled = join(work, 'enabled');
const oldCommon = join(work, 'old-common'), currentCommon = join(root, 'drivers/common');
const api = new RemoteXAppManager({baseURL: base});
const created = new Set(), sockets = new Map(), manifests = new Map(), results = [];
let child, currentPhase = 'setup', currentApp, variant = 0;
const startedAt = new Date().toISOString();

async function wait(fn, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await delay(75); }
  throw Error(`${currentApp}/${currentPhase}: ${label}`);
}
async function checkpoint(label, details = {}) {
  results.push({app: currentApp, scenario: label, result: 'passed', ...details});
  console.log(JSON.stringify(results.at(-1)));
  await save('running');
}
async function finding(label, details) {
  results.push({app: currentApp, scenario: label, result: 'failed', ...details});
  console.log(JSON.stringify(results.at(-1)));
  await save('running');
}
async function save(result, error) {
  await writeFile(join(work, 'result.json'), JSON.stringify({result, startedAt, updatedAt: new Date().toISOString(),
    root, uid, selected, mode, instrumentation: ['Driver pre-exec file barrier', 'shutdown hook refusal/file barrier',
      'test App patch versions for update selection', 'old Core helper content marker', 'XFCE fixed display relocation',
      ...(mode === 'managed-transport' ? ['managed comparison uses stop-session vacancy policy'] : [])],
    results, ...(error ? {failure: {app: currentApp, phase: currentPhase, message: error.message, stack: error.stack}} : {})}, null, 2));
}
async function startManager(common = currentCommon) {
  child = spawn(join(root, 'bin/remotexappd'), ['-listen', `127.0.0.1:${port}`, '-auth-mode', 'none',
    '-state-dir', state, '-class-config', join(work, 'legacy'), '-app-package-root', apps, '-apps-enabled', enabled,
    '-gateway-bin', join(root, 'bin/novnc-input'), '-status-bin', join(root, 'bin/remotexapp-status'),
    '-core-driver-dir', common, '-ibus-engine', join(root, 'components/remote-unicode-engine/engine.py'),
    '-expose-internals=true', '-shutdown-grace-timeout', '3s', '-shutdown-blocked-warning-after', '1s',
    '-shutdown-force-after', '8s'], {stdio: ['ignore', 'ignore', 'pipe']});
  child.stderr.on('data', b => { appendFile(join(work, 'manager.log'), b).catch(() => {}); });
  await wait(async () => {
    if (child.exitCode !== null || child.signalCode !== null) throw Error('Manager exited during startup');
    try { return (await fetch(base + '/readyz')).ok; } catch { return false; }
  }, 'Manager not ready', 60000);
}
async function stopManager(signal = 'SIGTERM') {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const finished = new Promise(r => child.once('exit', r)); child.kill(signal);
  await Promise.race([finished, delay(15000).then(() => { throw Error('Manager did not exit'); })]);
}
async function raw(path, {method = 'GET', body, generation, timeout = 60000} = {}) {
  const response = await fetch(base + path, {method, signal: AbortSignal.timeout(timeout), headers: {
    'Content-Type': 'application/json', ...(generation ? {'X-RemoteXApp-Session-Generation': String(generation)} : {}),
  }, ...(body !== undefined ? {body: JSON.stringify(body)} : {})});
  const data = await response.json();
  return {status: response.status, data};
}
async function record(id) { return JSON.parse(await readFile(join(state, 'instances', id, 'session-services.json'), 'utf8')); }
function identities(r) { return [r.supervisor, r.driver, ...Object.values(r.services)].filter(Boolean); }
async function alive(identity) {
  try {
    const b = await readFile(`/proc/${identity.pid}/stat`, 'utf8');
    const f = b.slice(b.lastIndexOf(')') + 1).trim().split(/\s+/);
    return f[0] !== 'Z' && f[19] === identity.startTime;
  } catch { return false; }
}
async function killOwned(identity, signal = 'SIGKILL') {
  assert(['SIGKILL', 'SIGSTOP', 'SIGCONT'].includes(signal));
  assert(await alive(identity), 'stale PID must not be signalled');
  const status = await readFile(`/proc/${identity.pid}/status`, 'utf8');
  assert.equal(Number(status.match(/^Uid:\s+(\d+)/m)[1]), uid, 'foreign UID must not be signalled');
  process.kill(identity.pid, signal);
}
async function cleaned(r) {
  await wait(async () => !(await Promise.all(identities(r).map(alive))).some(Boolean), 'owned process leak', 15000);
}
async function busID() {
  return (await exec('gdbus', ['call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path',
    '/org/freedesktop/DBus', '--method', 'org.freedesktop.DBus.GetId'], {timeout: 5000})).stdout;
}
async function ready(id) {
  return wait(async () => {
    const x = await api.getInstance(id);
    if (x.sessionState === 'failed' || x.state === 'failed') throw Error(`App failed: ${JSON.stringify(x)}`);
    return x.sessionState === 'running' && x.applicationStatus?.state === 'ready' && x;
  }, 'application not ready', 60000);
}
async function attach(id) {
  const ws = new WebSocket(base.replace('http:', 'ws:') + `/remotexapps/${id}/rfb-compat`);
  ws.addEventListener('error', () => {});
  sockets.set(id, ws);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.close(); reject(Error('RFB activation timeout')); }, 55000);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, {once: true});
    ws.addEventListener('error', () => { clearTimeout(timer); reject(Error('RFB activation failed')); }, {once: true});
  });
  return ready(id);
}
function detach(id) { sockets.get(id)?.close(); sockets.delete(id); }
async function stop(id, force = true) {
  detach(id);
  const x = await api.getInstance(id);
  if (x.managedInstanceId) return api.setManagedInstanceState(x.managedInstanceId, 'stopped', {force});
  return api.stopInstance(id, {force});
}
async function install(app, revision) {
  const src = join(work, `${app}-${revision}`);
  await cp(join(root, 'apps', app), src, {recursive: true});
  const manifest = JSON.parse(await readFile(join(src, 'manifest.json'), 'utf8'));
  const parts = manifest.driverVersion.split('.'); parts[2] = String(100 + revision); manifest.driverVersion = parts.join('.');
  // Shipped browsers intentionally use the unmanaged stop-instance workaround.
  // For the dedicated managed comparison, declare an eligible test-only policy.
  if (mode === 'managed-transport') manifest.session.vacantAction = 'stop-session';
  if (app === 'xfce-user-desktop') {
    const previous = manifests.get(app);
    let display = previous?.server.display;
    const ports = (await exec('ss', ['-ltnH'])).stdout;
    for (let n = 90; !display && n < 100; n++) {
      try { await lstat('/tmp/.X11-unix/X' + n); continue; } catch {}
      if (!ports.includes(':' + (5900 + n) + ' ') && !ports.includes(':' + (39000 + n) + ' ')) display = n;
    }
    assert(display); Object.assign(manifest.server, {display, rfbPort: 5900 + display, gatewayPort: 39000 + display});
  }
  // Exact App scripts are preserved. Only an outer barrier/hook wrapper differs.
  manifest.session.driver = 'matrix-session.sh'; manifest.session.shutdownDriver = 'matrix-shutdown.sh';
  await writeFile(join(src, 'matrix-session.sh'), '#!/bin/sh\nset -eu\nwhile [ -f ' + JSON.stringify(join(work, 'hold-start')) + ' ]; do sleep 0.1; done\nexec "$(dirname "$0")/session.sh"\n', {mode: 0o755});
  await writeFile(join(src, 'matrix-shutdown.sh'), '#!/bin/sh\nset -eu\nif [ -f "$REMOTEXAPP_RUNTIME/matrix-refuse" ]; then exit 10; fi\nif [ -f "$REMOTEXAPP_RUNTIME/matrix-fail" ]; then exit 17; fi\nif [ -f "$REMOTEXAPP_RUNTIME/matrix-hold-stop" ]; then echo $$ > "$REMOTEXAPP_RUNTIME/matrix-stop-entered"; fi\nwhile [ -f "$REMOTEXAPP_RUNTIME/matrix-hold-stop" ]; do sleep 0.1; done\nexec "$(dirname "$0")/shutdown.sh"\n', {mode: 0o755});
  await writeFile(join(src, 'manifest.json'), JSON.stringify(manifest));
  manifests.set(app, manifest);
  const archive = (await exec(join(root, 'scripts/package-app.sh'), [src, join(work, 'artifacts')], {timeout: 30000})).stdout.trim();
  const sha = createHash('sha256').update(await readFile(archive)).digest('hex');
  await exec(join(root, 'scripts/install-app.sh'), ['--archive', archive, '--sha256', sha,
    '--package-root', apps, '--enabled-root', enabled], {timeout: 30000});
}
async function newRuntime(app, barrier = false) {
  const old = new Set((await api.listInstances()).map(x => x.id));
  if (barrier) await writeFile(join(work, 'hold-start'), 'test');
  const creation = (app === 'xfce-user-desktop' || mode === 'managed-transport'
    ? api.createManagedInstance({id: `matrix-desktop-${++variant}`, templateId: app}).then(x => x.runtime)
    : api.createInstance({templateId: app}));
  // Register rejection immediately while probing the in-flight creation.
  let creationError;
  creation.catch(error => { creationError = error; });
  const x = await wait(async () => {
    if (creationError) throw creationError;
    return (await api.listInstances()).find(x => !old.has(x.id));
  }, 'runtime not allocated');
  created.add(x.id);
  if (manifests.get(app).session.activation === 'on-attach') {
    await creation;
    if (barrier) await probe(x.id, 'never-started', false);
  }
  let activation;
  if (manifests.get(app).session.activation === 'on-attach') { activation = attach(x.id); activation.catch(() => {}); }
  if (barrier) {
    await wait(async () => { try { return (await record(x.id)).driver; } catch { return false; } }, 'startup barrier not reached');
    const starting = await api.getInstance(x.id); assert.equal(starting.sessionState, 'starting');
    const checks = await Promise.all([
      raw(`/api/instances/${x.id}/actions`),
      raw(`/api/instances/${x.id}/clipboard/capabilities`, {generation: starting.sessionGeneration}),
    ]);
    assert.equal(checks[0].status, 409); assert.equal(checks[1].status, 409);
    // Locking reads may wait for startup; they must never return early readiness.
    let premature = false;
    const connections = api.getConnections(x.id).then(v => { premature = true; return v; }); connections.catch(() => {});
    await delay(200); assert(!premature, 'connection descriptor published before Driver readiness');
    const before = await record(x.id);
    await stopManager('SIGKILL');
    await unlink(join(work, 'hold-start'));
    await Promise.allSettled([creation, activation, connections].filter(Boolean));
    await startManager(oldCommon);
    const recovered = await ready(x.id);
    const recoveredServices = await record(x.id);
    if (recovered.sessionGeneration !== before.generation || recoveredServices.supervisor.pid !== before.supervisor.pid) {
      await finding('starting-Manager-SIGKILL-replaced-original-startup', {
        beforeGeneration: before.generation, afterGeneration: recovered.sessionGeneration,
        oldSupervisor: before.supervisor, newSupervisor: recoveredServices.supervisor,
      });
      await cleaned(before);
    } else await checkpoint('starting-API-fences-Manager-SIGKILL-same-generation-adoption');
  } else { await creation; if (activation) await activation; }
  if (!sockets.has(x.id) || sockets.get(x.id).readyState !== WebSocket.OPEN) await attach(x.id);
  return ready(x.id);
}
async function probe(id, label, running, {fault} = {}) {
  const x = await api.getInstance(id), g = Math.max(x.sessionGeneration, 1), path = `/api/instances/${id}`;
  const statuses = {};
  const requests = [
    ['instance', path, {}], ['status', path + '/status', {}], ['versions', path + '/upgrade-and-restart', {}],
    ['attach', path + '/attach', {method: 'POST'}],
    ['connections', path + '/connections', {}],
    ['environment', path + '/status/environment', {method: 'POST', body: {sessionGeneration: g}}],
    ['actions', path + '/actions', {}],
    ['clipboard', path + '/clipboard/capabilities', {generation: g}],
    ['offers', path + '/clipboard/offers', {generation: g}],
  ];
  // Stable-state probes are sequential: getActions deliberately TryLocks.
  const responses = {};
  for (const [name, url, options] of requests) { responses[name] = await raw(url, options); statuses[name] = responses[name].status; }
  for (const name of ['instance', 'status', 'versions', 'actions']) assert.equal(statuses[name], 200, `${label}/${name}`);
  assert.equal(statuses.attach, x.state === 'server-ready' ? 200 : 409, `${label}/attach`);
  assert.equal(responses.actions.data.ready, running, `${label}/actions readiness`);
  for (const name of ['connections', 'environment', 'clipboard', 'offers']) assert.equal(statuses[name], running ? 200 : 409, `${label}/${name}: ${JSON.stringify(responses[name])}`);
  if (running) {
    const d = responses.connections.data, e = responses.environment.data;
    assert.equal(d.sessionGeneration, g); assert.equal(e.sessionGeneration, g);
    assert.equal(e.environment.DISPLAY, d.environment.display);
    assert.equal(e.environment.XAUTHORITY, d.environment.xauthorityPath);
    const r = await record(id); assert.equal(e.environment.REMOTEXAPP_SESSION_GENERATION, String(g));
    const canonical = Number((await readFile(join(state, 'instances', id, manifests.get(x.templateId).session.readinessPid), 'utf8')).trim());
    assert.notEqual(canonical, r.supervisor.pid, 'EXP-007 must not report supervisor identity');
    if (fault === 'ibus') { assert.equal(d.environment.ibus, undefined); assert.equal(d.unavailableReasons.ibus, 'not-running'); }
    else { assert.equal(e.environment.IBUS_ADDRESS, d.environment.ibus.address); }
    if (fault !== 'dbus') assert.equal(e.environment.DBUS_SESSION_BUS_ADDRESS, d.environment.sessionBus.address);
    if (x.templateId === 'xfce-user-desktop') { assert.equal(d.environment.sessionBus.scope, 'user'); assert.equal(d.application, undefined); }
    else assert.equal(d.environment.sessionBus?.scope, 'runtime');
    for (const [name, url, options] of [
      ['connections-stale', path + `/connections?sessionGeneration=${g + 999}`, {}],
      ['environment-stale', path + '/status/environment', {method: 'POST', body: {sessionGeneration: g + 999}}],
      ['clipboard-stale', path + '/clipboard/capabilities', {generation: g + 999}],
      ['restart-stale', path + '/restart', {method: 'POST', body: {sessionGeneration: g + 999, force: true}}],
      ['upgrade-stale', path + '/upgrade-and-restart', {method: 'POST', body: {sessionGeneration: g + 999, targetRevision: x.versions.targetRevision, force: true}}],
    ]) { const v = await raw(url, options); statuses[name] = v.status; assert.equal(v.status, 409, name); }
  }
  const action = await raw(path + '/actions/openUrl', {method: 'POST', body: {
    sessionGeneration: g, parameters: {url: base + '/healthz'},
  }});
  const hasAction = !!manifests.get(x.templateId).actions?.openUrl;
  statuses.invokeAction = action.status;
  assert.equal(action.status, hasAction ? (running ? 200 : 409) : 404, `${label}/invokeAction ${JSON.stringify(action)}`);
  await checkpoint(`API-${label}`, {state: x.state, sessionState: x.sessionState, generation: x.sessionGeneration, statuses});
  return x;
}
async function replace(id, kind = 'restart', concurrent = false) {
  detach(id);
  const before = await api.getInstance(id), processes = await record(id);
  const call = () => kind === 'upgrade' ? api.upgradeAndRestartInstance(id, {
    sessionGeneration: before.sessionGeneration, targetRevision: before.versions.targetRevision, force: true,
  }) : api.restartInstance(id, {sessionGeneration: before.sessionGeneration, force: true});
  if (concurrent) {
    const attempts = await Promise.allSettled([call(), call(), call()]);
    const accepted = attempts.filter(x => x.status === 'fulfilled').length;
    if (accepted !== 1) await finding(`${kind}-duplicate-concurrent-requests-accepted`, {
      accepted, requested: attempts.length, generation: before.sessionGeneration,
      returnedGenerations: attempts.filter(x => x.status === 'fulfilled').map(x => x.value.sessionGeneration),
    });
    for (const x of attempts.filter(x => x.status === 'rejected')) assert.equal(x.reason.status, 409);
  } else await call();
  const after = await attach(id);
  assert(after.sessionGeneration > before.sessionGeneration); await cleaned(processes);
  const later = await record(id); assert.notDeepEqual(later.supervisor, processes.supervisor);
  if (kind === 'restart') assert.equal(after.versions.current.core.sha256, before.versions.current.core.sha256);
  else { assert.equal(after.upgrade.phase, 'completed'); assert(!after.versions.updateAvailable); }
  await assert.rejects(api.getConnections(id, {sessionGeneration: before.sessionGeneration}), e => e.status === 409);
  await checkpoint(`${kind}${concurrent ? '-three-concurrent-requests' : ''}-new-generation-old-process-cleanup`);
  return after;
}
async function interruptedUpgrade(id, boundary, revision) {
  currentPhase = 'upgrade-interrupted-' + boundary;
  detach(id);
  await stopManager(); await install(currentApp, revision); await startManager();
  const before = await api.getInstance(id), oldProcesses = await record(id);
  const barrier = boundary === 'stopping' ? join(state, 'instances', id, 'matrix-hold-stop') : join(work, 'hold-start');
  await writeFile(barrier, 'test');
  const pending = api.upgradeAndRestartInstance(id, {sessionGeneration: before.sessionGeneration,
    targetRevision: before.versions.targetRevision, force: boundary !== 'stopping'});
  pending.catch(() => {});
  let activation;
  let inFlight;
  let shutdownChildren = [];
  if (boundary === 'stopping') {
    await wait(async () => (await api.getInstance(id)).upgrade?.phase === 'stopping', 'upgrade stopping boundary missing');
    await wait(async () => { try { return await readFile(join(state, 'instances', id, 'matrix-stop-entered')); } catch { return false; } }, 'shutdown hook did not enter barrier', 5000);
    const lines = (await exec('ps', ['-u', String(uid), '-o', 'pid=,ppid=,args='])).stdout.split('\n');
    const ownedParents = new Set([child.pid]);
    const tree = lines.map(line => line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean);
    for (let pass = 0; pass < tree.length; pass++) {
      for (const match of tree) if (ownedParents.has(Number(match[2]))) ownedParents.add(Number(match[1]));
    }
    for (const line of lines) {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
      if (!match || !ownedParents.has(Number(match[1])) || Number(match[1]) === child.pid) continue;
      const pid = Number(match[1]);
      const b = await readFile(`/proc/${pid}/stat`, 'utf8');
      shutdownChildren.push({pid, startTime: b.slice(b.lastIndexOf(')') + 1).trim().split(/\s+/)[19]});
    }
    assert(shutdownChildren.length, 'shutdown barrier process not observed');
  } else {
    if (manifests.get(currentApp).session.activation === 'on-attach') {
      await pending;
      activation = attach(id); activation.catch(() => {});
    }
    await wait(async () => {
      try { const r = await record(id); if (r.generation > before.sessionGeneration && r.driver) { inFlight = r; return true; } }
      catch {} return false;
    }, 'upgrade launching boundary missing');
  }
  await stopManager('SIGKILL');
  if (shutdownChildren.length) {
    await delay(150);
    const surviving = [];
    for (const identity of shutdownChildren) if (await alive(identity)) surviving.push(identity);
    if (surviving.length) await finding('shutdown-hook-survives-Manager-SIGKILL', {identities: surviving});
  }
  await unlink(barrier); await Promise.allSettled([pending, activation].filter(Boolean));
  await startManager();
  const outcome = await api.getInstance(id);
  if (outcome.upgrade?.phase === 'blocked') {
    await checkpoint('interrupted-upgrade-reports-blocked-without-assuming-success', {message: outcome.shutdown?.message});
    // Record the actual refusal. Only this disposable test then requests force.
    await api.upgradeAndRestartInstance(id, {sessionGeneration: outcome.sessionGeneration,
      targetRevision: outcome.versions.targetRevision, force: true});
    await checkpoint('blocked-upgrade-explicit-force-recovery');
  }
  const after = await attach(id);
  assert.equal(after.upgrade.phase, 'completed'); assert(!after.versions.updateAvailable);
  assert(after.sessionGeneration > before.sessionGeneration); await cleaned(oldProcesses);
  if (inFlight && (after.sessionGeneration !== inFlight.generation ||
      (await record(id)).supervisor.pid !== inFlight.supervisor.pid)) {
    await finding('upgrade-launching-crash-replaced-live-startup', {
      beforeGeneration: inFlight.generation, afterGeneration: after.sessionGeneration,
      oldSupervisor: inFlight.supervisor, newSupervisor: (await record(id)).supervisor,
    });
    await cleaned(inFlight);
  } else await checkpoint(`upgrade-${boundary}${activation ? '-post-upgrade-first-attach' : ''}-SIGKILL-durable-completion-single-owner`);
  await probe(id, `upgrade-${boundary}-recovered`, true);
}
async function clipboardRoundTrip(id, label) {
  const x = await api.getInstance(id), sessionGeneration = x.sessionGeneration;
  const items = [{type: 'text/plain', data: `matrix-${label}-中文`}, {type: 'text/html', data: `<b>matrix-${label}-中文</b>`}];
  const viewerId = 'viewer_matrix';
  await api.sendClipboardOffer(id, {sessionGeneration, viewerId, items});
  const offer = await wait(async () => (await api.listClipboardOffers(id, {sessionGeneration}))
    .filter(x => x.direction === 'toLocal' && x.sourceViewerId === viewerId).sort((a, b) => b.sequence - a.sequence)[0], 'clipboard offer missing');
  const received = await api.acceptClipboardOffer(id, offer.id, {sessionGeneration});
  for (const expected of items) {
    const got = received.items.find(x => x.type === expected.type); assert(got, 'clipboard format lost');
    assert.equal(new TextDecoder().decode(got.data), expected.data);
  }
  await assert.rejects(api.sendClipboardOffer(id, {sessionGeneration: sessionGeneration + 999, viewerId, items}), e => e.status === 409);
}
async function rejectUnicode(id) {
  const socket = new WebSocket(base.replace('http:', 'ws:') + `/remotexapps/${id}/input?viewerId=viewer_matrix_input`);
  socket.addEventListener('error', () => {});
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('input channel timeout')), 10000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, {once: true});
      socket.addEventListener('error', () => { clearTimeout(timer); reject(Error('input channel error')); }, {once: true});
    });
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('text failure acknowledgement timed out')), 10000);
      socket.addEventListener('message', e => {
        const message = JSON.parse(e.data);
        if (message.id === 991) { clearTimeout(timer); resolve(message); }
      });
    });
    socket.send(JSON.stringify({type: 'text', id: 991, value: 'MUST_NOT_BE_REPLAYED'}));
    const reply = await response;
    assert(reply.error || reply.ok === false || reply.type === 'error', 'Unicode loss was acknowledged as success: ' + JSON.stringify(reply));
  } finally { socket.close(); }
}
async function interactionMatrix(app, originalBus) {
  await stopManager(); await startManager();
  currentPhase = 'interaction';
  const sentinel = await newRuntime('mousepad'), sentinelProcesses = await record(sentinel.id);
  await clipboardRoundTrip(sentinel.id, 'sentinel');
  let x = await newRuntime(app), id = x.id;
  await clipboardRoundTrip(id, app + '-before-fault');
  for (const fault of ['engine', 'ibus']) {
    const before = await record(id); await killOwned(before.services[fault]);
    await wait(async () => (await record(id)).state === 'degraded', 'input not degraded');
    await rejectUnicode(id); await clipboardRoundTrip(id, app + '-during-' + fault + '-loss');
    assert(await alive(before.driver));
    assert.deepEqual(identities(await record(sentinel.id)), identities(sentinelProcesses));
    await replace(id); await clipboardRoundTrip(id, app + '-after-' + fault + '-recovery');
    await checkpoint(fault + '-loss-WebSocket-text-rejected-clipboard-roundtrip-other-runtime-preserved');
  }
  currentPhase = 'natural-exit-concurrent-readers';
  const before = await record(id), descriptor = await api.getConnections(id);
  const e = (await api.getApplicationEnvironment(id, {sessionGeneration: before.generation})).environment;
  const env = {...process.env, ...e}, responses = [];
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      const row = await Promise.all([
        raw(`/api/instances/${id}`), raw(`/api/instances/${id}/status`),
        raw(`/api/instances/${id}/connections?sessionGeneration=${before.generation}`),
        raw(`/api/instances/${id}/status/environment`, {method: 'POST', body: {sessionGeneration: before.generation}}),
        raw(`/api/instances/${id}/clipboard/capabilities`, {generation: before.generation}),
      ]);
      for (const r of row) assert([200, 409].includes(r.status), 'unexpected API response during natural exit');
      responses.push(row.map(r => r.status)); await delay(40);
    }
  })();
  sampler.catch(() => {});
  try {
    if (app === 'xfce-user-desktop') await exec('xfce4-session-logout', ['--logout', '--fast'], {env, timeout: 5000});
    else await exec('xdotool', ['key', '--clearmodifiers', app === 'edge' ? 'alt+F4' : 'ctrl+q'], {env, timeout: 5000});
    await wait(async () => {
      const current = await api.getInstance(id);
      return current.sessionState === 'stopped' && (app === 'xfce-user-desktop' ? current.state === 'server-ready' : current.state === 'stopped');
    }, 'natural exit did not apply template policy', 25000);
  } finally { sampling = false; await sampler; }
  await cleaned(before);
  assert.deepEqual(identities(await record(sentinel.id)), identities(sentinelProcesses));
  await clipboardRoundTrip(sentinel.id, 'sentinel-after-other-App-exit');
  await probe(id, 'naturally-exited', false);
  if (app === 'xfce-user-desktop') {
    const relogged = await attach(id), next = await api.getConnections(id);
    assert(relogged.sessionGeneration > before.generation); assert.equal(next.environment.display, descriptor.environment.display);
    assert.equal(await busID(), originalBus);
    await clipboardRoundTrip(id, 'desktop-relogin');
    await checkpoint('XFCE-logout-preserves-server-account-bus-other-runtime-and-relogin');
  }
  await stop(id); await stop(sentinel.id); await cleaned(sentinelProcesses);
  await checkpoint('natural-exit-parallel-API-no-5xx-cross-runtime-independence', {apiSamples: responses.length, observedHTTP: [...new Set(responses.map(x => x.join(',')))]});
}
async function unitIdentity(unit) {
  assert.match(unit, /^remotexapp-[a-z0-9-]+-(gateway|vnc)\.service$/);
  const pid = Number((await exec('systemctl', ['--user', 'show', unit, '--property=MainPID', '--value'], {timeout: 5000})).stdout.trim());
  assert(pid > 1);
  const b = await readFile(`/proc/${pid}/stat`, 'utf8');
  return {pid, startTime: b.slice(b.lastIndexOf(')') + 1).trim().split(/\s+/)[19]};
}

async function borrowedBusMatrix(originalBus) {
  currentPhase = 'borrowed-account-bus-outage';
  await startManager();
  const x = await newRuntime('xfce-user-desktop'), before = await record(x.id);
  const answer = (await exec('gdbus', ['call', '--session', '--dest', 'org.freedesktop.DBus',
    '--object-path', '/org/freedesktop/DBus', '--method', 'org.freedesktop.DBus.GetConnectionUnixProcessID', 'org.freedesktop.DBus'])).stdout;
  const pid = Number(answer.match(/uint32 (\d+)/)?.[1]); assert(pid > 1);
  const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
  const owner = {pid, startTime: stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/)[19]};
  try {
    await killOwned(owner, 'SIGSTOP'); // Only the disposable UID's account bus.
    await wait(async () => (await record(x.id)).failure === 'borrowed-dbus-unavailable', 'borrowed bus loss not observed', 45000);
    assert(await alive(owner), 'Core killed borrowed account bus');
    assert(!(await record(x.id)).services.dbus, 'Core created a private replacement bus');
  } finally {
    if (await alive(owner)) await killOwned(owner, 'SIGCONT');
  }
  assert.equal(await busID(), originalBus);
  const after = await api.getInstance(x.id); assert.equal(after.sessionGeneration, before.generation);
  if (after.sessionState === 'running') {
    const d = await api.getConnections(x.id);
    assert.equal(d.environment.ibus, undefined, 'dead private IBus advertised after borrowed bus outage');
    await rejectUnicode(x.id);
    await clipboardRoundTrip(x.id, 'borrowed-bus-outage');
  }
  await checkpoint('borrowed-bus-outage-no-Core-replacement-no-App-relaunch', {sessionState: after.sessionState});
  await replace(x.id); await probe(x.id, 'explicit-recovery-after-borrowed-bus-outage', true);
  await stop(x.id); assert.equal(await busID(), originalBus);
}

async function shutdownOutcomes(app, originalBus) {
  await stopManager(); await startManager();
  for (const outcome of ['timeout', 'failed']) {
    currentPhase = 'shutdown-hook-' + outcome;
    const x = await newRuntime(app), before = await record(x.id);
    await writeFile(join(state, 'instances', x.id, outcome === 'timeout' ? 'matrix-hold-stop' : 'matrix-fail'), 'test');
    await assert.rejects(stop(x.id, false), e => e.status === 409);
    const blocked = await api.getInstance(x.id);
    assert.equal(blocked.sessionState, 'shutdown-blocked');
    assert.equal(blocked.shutdown.state, outcome);
    assert((await Promise.all(identities(before).map(alive))).every(Boolean));
    await stopManager('SIGKILL'); await startManager();
    const restored = await api.getInstance(x.id);
    assert.equal(restored.shutdown.forceAt, blocked.shutdown.forceAt);
    assert.equal(restored.sessionGeneration, before.generation);
    await wait(async () => (await api.getInstance(x.id)).state === 'stopped', 'host enforcement deadline lost', 15000);
    await cleaned(before);
    await probe(x.id, 'host-enforced-' + outcome, false);
    await checkpoint('hook-' + outcome + '-services-preserved-Manager-crash-host-deadline-enforced');
  }
  assert.equal(await busID(), originalBus);
}
async function transportMatrix(app, originalBus) {
  currentPhase = 'gateway-loss';
  await stopManager(); await startManager();
  let x = await newRuntime(app), id = x.id;
  const before = await record(id), descriptor = await api.getConnections(id);
  if (x.managedInstanceId) await writeFile(join(state, 'instances', id, 'matrix-refuse'), 'refuse every graceful hook in this fixture');
  const gateway = await unitIdentity(x.gatewayUnit);
  await killOwned(gateway); await delay(300);
  if (!(await alive(before.driver))) {
    await finding('gateway-loss-stopped-live-managed-application', {
      managed: !!x.managedInstanceId, beforeGeneration: before.generation,
      after: await api.getInstance(id),
    });
    await cleaned(before);
    await wait(async () => (await api.getInstance(id)).state === 'server-ready', 'managed server did not recover');
    const relaunched = await attach(id);
    if (relaunched.sessionGeneration <= before.generation) {
      const stale = await raw(`/api/instances/${id}/connections?sessionGeneration=${before.generation}`);
      await finding('managed-recovery-reused-generation-stale-connections-accepted', {
        beforeGeneration: before.generation, afterGeneration: relaunched.sessionGeneration,
        oldSupervisor: before.supervisor, newSupervisor: (await record(id)).supervisor,
        oldGenerationHTTPStatus: stale.status,
      });
    }
    await clipboardRoundTrip(id, app + '-explicit-attach-after-unrequested-stop');
  } else {
  assert.equal((await raw(`/api/instances/${id}/clipboard/capabilities`, {generation: before.generation})).status, 409);
  await stopManager('SIGKILL'); await startManager();
  assert.deepEqual(identities(await record(id)), identities(before));
  assert.equal((await api.getConnections(id)).revision, descriptor.revision);
  await checkpoint('gateway-loss-clipboard-unavailable-Manager-adopts-live-App-without-replacement');
  await replace(id); await clipboardRoundTrip(id, app + '-gateway-recovered');
  await checkpoint('explicit-restart-restores-gateway-and-clipboard');
  }
  currentPhase = 'VNC-loss';
  x = await api.getInstance(id);
  const session = await record(id), vnc = await unitIdentity(x.vncUnit);
  await killOwned(vnc);
  await wait(async () => !(await alive(session.driver)), 'App did not resolve display loss', 20000);
  await cleaned(session);
  const after = await api.getInstance(id);
  if (after.sessionGeneration !== session.generation) await finding('display-loss-managed-recovery-generation-changed', {
    beforeGeneration: session.generation, afterGeneration: after.sessionGeneration, state: after.state,
  });
  for (const [suffix, options] of [
    ['/connections', {}], ['/status/environment', {method: 'POST', body: {sessionGeneration: session.generation}}],
    ['/clipboard/capabilities', {generation: session.generation}],
  ]) assert.equal((await raw(`/api/instances/${id}` + suffix, options)).status, 409);
  await stop(id); await cleaned(session);
  await checkpoint('VNC-loss-no-stale-connections-complete-session-cleanup', {state: after.state, sessionState: after.sessionState});
  x = await newRuntime(app); await clipboardRoundTrip(x.id, app + '-display-recovered');
  await probe(x.id, 'new-runtime-after-display-loss', true); await stop(x.id);
  assert.equal(await busID(), originalBus);
  await checkpoint('new-runtime-after-display-loss-ready-account-bus-preserved');
}

try {
  for (const p of [work, state, apps, enabled, join(work, 'legacy')]) await mkdir(p, {recursive: true});
  let occupied = false; try { occupied = (await fetch(base + '/readyz')).ok; } catch {} assert(!occupied, 'test port occupied');
  await cp(currentCommon, oldCommon, {recursive: true});
  await writeFile(join(oldCommon, 'matrix-old-pin'), 'old new-architecture helper selection');
  for (const app of new Set([...selected, ...(mode === 'interaction' ? ['mousepad'] : [])])) await install(app, 0);
  const accountBus = await busID();
  for (const app of selected) {
    currentApp = app; currentPhase = 'starting';
    try {
    if (mode === 'borrowed-bus') { await borrowedBusMatrix(accountBus); continue; }
    if (mode === 'shutdown-outcomes') { await shutdownOutcomes(app, accountBus); continue; }
    if (mode === 'interaction') { await interactionMatrix(app, accountBus); continue; }
    if (mode === 'transport' || mode === 'managed-transport') { await transportMatrix(app, accountBus); continue; }
    await stopManager(); await startManager(oldCommon);
    let x = await newRuntime(app, true), id = x.id;
    await probe(id, 'running', true);
    for (const signal of ['SIGTERM', 'SIGKILL']) {
      currentPhase = 'Manager-' + signal;
      const before = await record(id), d = await api.getConnections(id);
      await stopManager(signal); await startManager(oldCommon);
      assert.deepEqual(identities(await record(id)), identities(before));
      assert.equal((await api.getConnections(id)).revision, d.revision);
      await probe(id, 'adopted-' + signal, true);
    }
    currentPhase = 'restart'; await replace(id, 'restart', true); await probe(id, 'restarted', true);
    currentPhase = 'upgrade';
    await stopManager(); await install(app, 1); await startManager();
    assert((await api.getInstance(id)).versions.updateAvailable);
    const oldVersion = (await api.getInstance(id)).driverVersion;
    await replace(id); assert.equal((await api.getInstance(id)).driverVersion, oldVersion);
    await replace(id, 'upgrade', true); await probe(id, 'upgraded', true);
    await interruptedUpgrade(id, 'stopping', 2);
    await interruptedUpgrade(id, 'launching', 3);
    for (const fault of ['engine', 'ibus']) {
      currentPhase = fault + '-loss';
      const before = await record(id); await killOwned(before.services[fault]);
      await wait(async () => (await record(id)).failure === (fault === 'engine' ? 'unicode-exited' : 'ibus-exited'), 'missing service-failure cause');
      assert(await alive(before.driver)); await probe(id, fault + '-degraded', true, {fault});
      await stopManager('SIGKILL'); await startManager();
      assert.deepEqual((await record(id)).supervisor, before.supervisor);
      await probe(id, fault + '-degraded-adopted', true, {fault});
      await replace(id); await probe(id, fault + '-recovered', true);
    }
    currentPhase = 'shutdown-blocked';
    const beforeBlocked = await record(id);
    await writeFile(join(state, 'instances', id, 'matrix-refuse'), 'fixture');
    await assert.rejects(stop(id, false), e => e.status === 409);
    await probe(id, 'shutdown-blocked', false);
    assert((await Promise.all(identities(beforeBlocked).map(alive))).every(Boolean));
    await stopManager('SIGKILL'); await startManager();
    await wait(async () => (await api.getInstance(id)).state === 'stopped', 'host force deadline lost', 20000);
    await cleaned(beforeBlocked); await probe(id, 'host-forced-stopped', false);
    await assert.rejects(api.restartInstance(id, {sessionGeneration: (await api.getInstance(id)).sessionGeneration, force: true}), e => e.status === 409);
    await checkpoint('blocked-Manager-crash-host-deadline-complete-cleanup');
    if (app !== 'xfce-user-desktop') {
      currentPhase = 'private-dbus-loss'; x = await newRuntime(app); id = x.id;
      const before = await record(id); await killOwned(before.services.dbus);
      await wait(async () => (await record(id)).failure === 'dbus-exited', 'D-Bus failure cause missing');
      await delay(1000);
      const after = await api.getInstance(id); assert.equal(after.sessionGeneration, before.generation);
      if (after.sessionState === 'running') {
        const d = await api.getConnections(id); assert.equal(d.environment.sessionBus, undefined); assert(d.unavailable.includes('sessionBus'));
      } else { await probe(id, 'dbus-dependent-App-failed', false); await cleaned(before); }
      await stopManager('SIGKILL'); await startManager();
      const restored = await api.getInstance(id);
      if (restored.sessionGeneration !== before.generation) {
        await finding('Manager-restart-silently-relaunched-dbus-failed-App', {
          beforeGeneration: before.generation, afterGeneration: restored.sessionGeneration,
          observedState: restored.sessionState,
        });
      }
      await stop(id); await cleaned(before);
      await checkpoint('dbus-loss-cleanup', {observedSessionState: after.sessionState});
    }
    currentPhase = 'supervisor-loss'; x = await newRuntime(app); id = x.id;
    const before = await record(id); await killOwned(before.supervisor);
    await wait(async () => (await api.getInstance(id)).sessionState === 'failed', 'supervisor loss not observed');
    await cleaned(before); await probe(id, 'supervisor-failed', false);
    await stopManager('SIGKILL'); await startManager();
    const restored = await api.getInstance(id);
    if (restored.sessionGeneration !== before.generation || restored.sessionState !== 'failed') {
      await finding('Manager-restart-changed-supervisor-failed-session', {
        beforeGeneration: before.generation, afterGeneration: restored.sessionGeneration,
        observedState: restored.sessionState,
      });
    } else await probe(id, 'supervisor-failed-adopted', false);
    await stop(id); await checkpoint('supervisor-loss-complete-owned-cleanup');
    currentPhase = 'supervisor-loss-Manager-offline';
    x = await newRuntime(app); id = x.id;
    const offline = await record(id);
    await stopManager('SIGKILL'); await killOwned(offline.supervisor); await cleaned(offline);
    await startManager();
    const observedOffline = await api.getInstance(id);
    assert.equal(observedOffline.sessionGeneration, offline.generation);
    assert.equal(observedOffline.sessionState, 'failed');
    await probe(id, 'offline-supervisor-failure', false);
    await assert.rejects(attach(id), /RFB activation failed/);
    assert.equal((await api.getInstance(id)).sessionGeneration, offline.generation);
    await checkpoint('offline-supervisor-failure-no-relaunch-by-Manager-or-Viewer');
    await replace(id); await probe(id, 'explicit-recovery-after-offline-failure', true);
    await stop(id);
    assert.equal(await busID(), accountBus, 'borrowed account bus was replaced');
    currentPhase = 'final-cleanup';
    const active = (await api.listInstances()).filter(x => x.state !== 'stopped'); assert.deepEqual(active, []);
    await checkpoint('all-owned-runtimes-stopped-account-bus-unchanged');
    } catch (error) {
      await finding('matrix-scenario-aborted', {phase: currentPhase, message: error.message, stack: error.stack});
      await cp(join(state, 'instances'), join(work, 'failure-' + app), {recursive: true}).catch(() => {});
      await unlink(join(work, 'hold-start')).catch(() => {});
      for (const id of created) try { await stop(id); } catch {}
    }
  }
  const failed = results.some(x => x.result === 'failed');
  await save(failed ? 'failed' : 'passed');
  if (failed) process.exitCode = 1;
} catch (error) {
  await save('failed', error);
  await cp(join(state, 'instances'), join(work, 'failure-instances'), {recursive: true}).catch(() => {});
  throw error;
} finally {
  for (const id of created) detach(id);
  if (child && child.exitCode === null && child.signalCode === null) {
    for (const id of created) try { await stop(id); } catch {}
    await stopManager();
  }
  // The shell wrapper additionally terminates only this newly created UID.
}
