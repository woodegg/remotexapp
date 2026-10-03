import assert from 'node:assert/strict';
import test from 'node:test';
import { RemoteXAppCoordinator } from './remotexapp-coordinator.js';
import { RemoteXAppManager, RemoteXAppAPIError } from './remotexapp-manager.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('diagnostics are passive, cloned, bounded and content-free', async t => {
  const { coordinator:c, calls } = fixture(t);
  for (let n=0;n<10;n++) assert.equal(c.getDiagnostics().runtimes.length, 0);
  assert.deepEqual(calls, { get:0, renew:0 });
  const handle = c.track('app-123', {sessionGeneration:1, keepAlive:true});
  await until(() => c.getDiagnostics().runtimes[0]?.lease);
  const state = c.getDiagnostics(), row = state.runtimes[0];
  assert.equal(row.isLeader, true); assert.equal(row.localHandles, 1);
  assert.equal(row.lease.outcome, 'renewed');
  assert.ok(state.events.some(e => e.type === 'leader-changed'));
  assert.doesNotMatch(JSON.stringify(state), /never-broadcast|private\/control|parameters|socketPath/);
  row.instance.state = 'corrupt'; state.events.length = 0;
  assert.notEqual(c.getDiagnostics().runtimes[0].instance.state, 'corrupt');
  assert.ok(c.getDiagnostics().events.length);
  handle.release();
  for(let n=0;n<60;n++) c.track('app-123').release();
  assert.equal(c.getDiagnostics().events.length, 100);
  c.destroy(); assert.equal(c.getDiagnostics().destroyed, true);
  assert.equal(c.getDiagnostics().runtimes.length, 0);
});

test('diagnostics reflect follower receipts, silent peers, takeover and sanitized failures', async t => {
  const { coordinator:c, manager } = fixture(t);
  const owner='00000000-0000-0000-0000-000000000000';
  c.track('app-123', {sessionGeneration:1, keepAlive:true});
  c._receive({owner,sequence:1,type:'interests',interests:[{id:'app-123',generation:1,keepAlive:true}]});
  await until(() => c.getDiagnostics().runtimes[0]?.leaderId === owner);
  c._receive({owner,sequence:2,type:'state',id:'app-123',generation:1,
    instance:{id:'app-123',sessionGeneration:1,state:'ready',sessionState:'running',parameters:{password:'secret'}}});
  c._receive({owner,sequence:3,type:'lease',id:'app-123',generation:1,
    lease:{instanceId:'app-123',sessionGeneration:1,outcome:'attached',idleTimeoutMs:1000,idleAction:'stop-instance',serverTime:new Date().toISOString(),expiresAt:null,password:'secret'}});
  let state=c.getDiagnostics();
  assert.equal(state.runtimes[0].remoteInterests,1);
  assert.equal(state.runtimes[0].lease.outcome,'attached');
  assert.equal(state.runtimes[0].nextRenewalInMs,null);
  assert.equal(state.runtimes[0].instance.state,'ready');
  assert.doesNotMatch(JSON.stringify(state), /password|secret/);
  manager.getInstance=async()=>{throw new RemoteXAppAPIError('private secret', {status:503})};
  c.peers.get(owner).seen=performance.now()-6100;
  assert.equal(c.getDiagnostics().peers[0].eligible,false);
  assert.equal(c.getDiagnostics().peers[0].retained,true);
  await until(()=>c.getDiagnostics().events.some(e=>e.type==='request-error'));
  state=c.getDiagnostics();
  assert.equal(state.runtimes[0].isLeader,true);
  assert.ok(state.events.some(e=>e.previousLeaderId===owner && e.leaderId===c.ownerId));
  assert.doesNotMatch(JSON.stringify(state), /private secret/);
});
async function until(predicate) {
  for (let n = 0; n < 100; n++) { if (predicate()) return; await sleep(20); }
  assert.ok(predicate(), 'condition timed out');
}
function fixture(t, { scope = crypto.randomUUID(), crossTabs = false, baseURL = 'http://manager.test/sub' } = {}) {
  const calls = { get:0, renew:0 };
  const instance = { id:'app-123', sessionGeneration:1, state:'server-ready', sessionState:'running', attachedClients:0,
    parameters:{ secret:'never-broadcast' }, applicationStatus:{ state:'ready', details:{ socketPath:'/private/control' } } };
  const manager = new RemoteXAppManager({ baseURL });
  manager.getInstance = async () => { calls.get++; return structuredClone(instance); };
  manager.renewIdleLease = async (id, { sessionGeneration }) => {
    calls.renew++;
    return { instanceId:id, sessionGeneration, idleTimeoutMs:1000, idleAction:'stop-instance', outcome:'renewed',
      serverTime:new Date().toISOString(), expiresAt:new Date(Date.now()+1000).toISOString() };
  };
  const coordinator = new RemoteXAppCoordinator({ manager, scope, crossTabs });
  t.after(() => coordinator.destroy());
  return { coordinator, manager, calls, instance };
}

test('single-shot validates identity, bounds and nullable expiry through the public HTTP SDK', async () => {
  let sent;
  const valid = { instanceId:'app-123', sessionGeneration:0, outcome:'renewed', idleAction:'stop-instance', idleTimeoutMs:60000,
    serverTime:'2026-09-18T00:00:00Z', expiresAt:'2026-09-18T00:01:00Z' };
  let result = valid;
  const manager = new RemoteXAppManager({ baseURL:'/prefix', fetchImpl:async (url, options) => { sent = { url, options }; return Response.json(result); } });
  assert.deepEqual(await manager.renewIdleLease('app-123', { sessionGeneration:0 }), valid);
  assert.equal(sent.url, '/prefix/api/instances/app-123/idle-lease');
  assert.equal(sent.options.method, 'POST');
  assert.deepEqual(JSON.parse(sent.options.body), { sessionGeneration:0 });
  for (const generation of [-1, 1.2, Infinity, undefined]) await assert.rejects(manager.renewIdleLease('app-123', { sessionGeneration:generation }), RangeError);
  for (const patch of [{ instanceId:'other' }, { sessionGeneration:2 }, { outcome:'unknown' }, { idleTimeoutMs:0 }, { serverTime:'invalid' }, { expiresAt:null }]) {
    result = { ...valid, ...patch }; await assert.rejects(manager.renewIdleLease('app-123', { sessionGeneration:0 }), /Invalid idle/);
  }
  result = { ...valid, outcome:'attached', expiresAt:null };
  assert.equal((await manager.renewIdleLease('app-123', { sessionGeneration:0 })).outcome, 'attached');
});

test('observation alone does not renew; shared handles release independently without stopping the App', async t => {
  const { coordinator, calls } = fixture(t);
  const first = coordinator.track('app-123');
  const second = coordinator.track('app-123');
  await Promise.all([first.ready, second.ready]);
  assert.equal(calls.get, 1);
  assert.equal(calls.renew, 0);
  first.setKeepAlive(true); second.setKeepAlive(true);
  await until(() => calls.renew > 0);
  first.release(); first.release();
  assert.equal(second.state, 'tracking');
  const renewed = calls.renew;
  await until(() => calls.renew > renewed);
  second.release();
  await sleep(150);
  const stopped = calls.renew;
  await sleep(450);
  assert.equal(calls.renew, stopped);
  assert.equal(coordinator.jobs.size, 0);
  assert.throws(() => first.setKeepAlive(true), /no longer/);
  await assert.rejects(first.renewIdleLease(), /not ready/);
});

test('generation change and terminal states invalidate interests, never reacquire automatically', async t => {
  for (const mutation of [{ sessionGeneration:2 }, { state:'stopping' }, { sessionState:'shutdown-blocked' }, { sessionState:'stopped' }]) {
    const { coordinator, instance, calls } = fixture(t);
    const handle = coordinator.track('app-123', { keepAlive:true });
    await handle.ready; await until(() => calls.renew > 0);
    Object.assign(instance, mutation);
    coordinator._resume();
    await until(() => handle.state === 'invalidated');
    await sleep(120);
    const count = calls.renew; await sleep(350);
    assert.equal(calls.renew, count);
    coordinator.destroy();
  }
});

test('stale initial generation, authorization loss and missing runtimes stop ownership', async t => {
  const { coordinator } = fixture(t);
  const stale = coordinator.track('app-123', { sessionGeneration:0, keepAlive:true });
  await assert.rejects(stale.ready, /invalidated/);
  for (const status of [401,403,404,409]) {
    const f = fixture(t);
    f.manager.getInstance = async () => { throw new RemoteXAppAPIError('unavailable', { status }); };
    const handle = f.coordinator.track('app-123', { keepAlive:true });
    await assert.rejects(handle.ready, /invalidated/);
    assert.equal(handle.keepAlive, false);
  }
});

test('busy/network errors report and retain bounded retry intent', async t => {
  const { coordinator, manager, calls } = fixture(t);
  const errors = [];
  coordinator.addEventListener('error', event => errors.push(event.detail));
  manager.renewIdleLease = async () => { calls.renew++; throw new RemoteXAppAPIError('busy', { status:409, body:{ code:'busy' } }); };
  const handle = coordinator.track('app-123', { keepAlive:true });
  await handle.ready; await until(() => errors.length);
  assert.equal(handle.state, 'tracking');
  const count = calls.renew; await sleep(300);
  assert.equal(calls.renew, count);
  await until(() => calls.renew > count);
});

test('released pending requests cannot resolve handles or publish late status', async t => {
  const { coordinator, manager } = fixture(t);
  let resolve;
  manager.getInstance = () => new Promise(done => { resolve = done; });
  const handle = coordinator.track('app-123', { keepAlive:true });
  await until(() => resolve);
  handle.release();
  await assert.rejects(handle.ready, /released/);
  await sleep(120);
  resolve({ id:'app-123', sessionGeneration:1, state:'server-ready', sessionState:'running' });
  await sleep(20);
  assert.equal(handle.instance, null);
});

test('cross-tab handoff, stale-owner retention and pruning are scoped and content-free', async t => {
  const scope = crypto.randomUUID();
  const a = fixture(t, { scope, crossTabs:true });
  const b = fixture(t, { scope, crossTabs:true });
  const ha = a.coordinator.track('app-123', { sessionGeneration:1, keepAlive:true });
  const hb = b.coordinator.track('app-123', { sessionGeneration:1 });
  await Promise.all([ha.ready, hb.ready]);
  await until(() => a.coordinator.peers.size && b.coordinator.peers.size);
  const all = [a,b].sort((x,y) => x.coordinator.ownerId.localeCompare(y.coordinator.ownerId));
  const [leader, follower] = all;
  leader.coordinator._changed(); follower.coordinator._changed();
  await sleep(150);
  const followerGets = follower.calls.get;
  await sleep(450);
  assert.equal(follower.calls.get, followerGets, 'follower duplicates polling');
  assert.equal(JSON.stringify(hb.instance).includes('secret'), false);
  assert.equal(JSON.stringify(hb.instance).includes('socket'), false);
  // Model a frozen owner without closing its channel, then allow awake takeover.
  clearTimeout(leader.coordinator.timer); leader.coordinator.timer = null;
  leader.coordinator.channel.onmessage = null;
  const peer = follower.coordinator.peers.get(leader.coordinator.ownerId);
  peer.seen = performance.now() - 6100;
  const before = follower.calls.get;
  follower.coordinator._wake();
  await until(() => follower.calls.get > before);
  assert.ok(follower.coordinator.peers.has(leader.coordinator.ownerId), 'interest lost on leader timeout');
  peer.seen = performance.now() - 300001;
  await until(() => !follower.coordinator.peers.has(leader.coordinator.ownerId));
  const other = fixture(t, { scope:'different-login', crossTabs:true });
  const h = other.coordinator.track('app-123'); await h.ready;
  await sleep(50); assert.equal(other.coordinator.peers.size, 0);
});

test('scope, fallback, identity limits, malformed broadcasts and destroy', async t => {
  assert.throws(() => new RemoteXAppCoordinator(), /scope/);
  assert.throws(() => new RemoteXAppCoordinator({ scope:'login', manager:new RemoteXAppManager({ baseURL:'https://user:password@host/' }) }), /credentials/);
  const { coordinator } = fixture(t);
  assert.equal(coordinator.mode, 'local');
  assert.equal(coordinator.serverKey, 'http://manager.test/sub');
  assert.throws(() => coordinator.track('../bad'), /Invalid runtime/);
  assert.throws(() => coordinator.track('app-123', { sessionGeneration:-1 }), /generation/i);
  assert.throws(() => coordinator.track('app-123', { keepAlive:'true' }), /boolean/);
  coordinator._receive({ owner:'peer', sequence:1, type:'interests', interests:[{ id:'app-123', generation:1, keepAlive:'yes' }] });
  assert.equal(coordinator.peers.size, 0);
  coordinator._receive({ owner:'peer', sequence:2, type:'interests', interests:[] });
  coordinator._receive({ owner:'peer', sequence:1, type:'interests', interests:[{ id:'app-123', generation:1, keepAlive:true }] });
  assert.equal(coordinator.peers.get('peer').interests.length, 0);
  for (let n=0;n<128;n++) coordinator.track('app-123');
  assert.throws(() => coordinator.track('app-123'), /128/);
  coordinator.destroy(); coordinator.destroy();
  assert.equal(coordinator.handles.size, 0); assert.equal(coordinator.jobs.size, 0);
  assert.throws(() => coordinator.track('app-123'), /destroyed/);
});
