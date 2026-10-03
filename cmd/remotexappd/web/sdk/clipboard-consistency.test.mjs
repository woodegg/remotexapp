import assert from 'node:assert/strict';
import test from 'node:test';
import { RemoteXAppClipboard } from './remotexapp-clipboard.js';

globalThis.CustomEvent ||= class extends Event {
  constructor(type, { detail } = {}) { super(type); this.detail = detail; }
};
const text = value => value ? [{ type:'text/plain', data:value }] : [];
function fixture(t) {
  const state = { local:text('initial'), remote:text('remote'), sequence:0, writes:0, sends:0, offers:[] };
  const manager = {
    async getClipboardCapabilities() { return { consistencyVersion:1, sequence:state.sequence }; },
    async listClipboardOffers() { return state.offers; },
    async acceptClipboardOffer() { return { items:state.remote }; },
    async sendClipboardOffer(_id, options) {
      assert.equal(options.expectedSequence, state.sequence);
      state.sends++; state.remote = options.items;
      return { id:'sent' };
    },
  };
  const clipboard = new RemoteXAppClipboard({ manager, instanceId:'runtime', instance:{ sessionGeneration:1 }, _emit() {} });
  clipboard.config = { toRemote:'prompt', toLocal:'prompt', checkOnFocus:false };
  clipboard.inputActive = true;
  clipboard._readLocalClipboard = async () => state.local;
  clipboard._writeLocalClipboard = async items => { state.writes++; state.local = items; return { items, types:items.map(i => i.type) }; };
  const events = [];
  clipboard.addEventListener('offer', e => events.push(e.detail));
  function remote(sequence, extra = {}) {
    state.sequence = Math.max(sequence, state.sequence);
    const offer = { id:`remote-${sequence}`, direction:'toLocal', generation:1, sequence,
      createdAt:new Date().toISOString(), expiresAt:new Date(Date.now()+60000).toISOString(), ...extra };
    state.offers = [offer];
    clipboard._receiveOffer(offer);
    return offer;
  }
  t.after(() => clipboard.destroy());
  return { clipboard, state, manager, events, remote };
}

test('approved uploads describe transferred text and image without exposing previews in events', async t => {
  const { clipboard, state, events } = fixture(t);
  for (const items of [text('sample'), [{ type:'image/png', data:new Uint8Array([1, 2, 3]) }]]) {
    state.local = items;
    await clipboard._offerLocal(items, 'test');
    const result = await clipboard.approve(clipboard._pendingDirection('toRemote').id);
    const representations = items.map(item => ({type:item.type,bytes:new Blob([item.data]).size}));
    assert.deepEqual(result.summary, { types:items.map(item => item.type), preview:items[0].type === 'text/plain' ? 'sample' : '', representations, totalBytes:representations.reduce((sum,item)=>sum+item.bytes,0) });
    assert.equal(result.id, 'sent');
  }
  assert.equal(JSON.stringify(events).includes('sample'), false);
});

test('receipts describe PNG pixels and exact representation sizes without changing payloads', async t => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const padded = Buffer.concat([Buffer.from([0,0]), png, Buffer.from([0])]);
  for (const data of [new Blob([png]), padded.subarray(2,-1), Uint8Array.from(png).buffer]) {
    const { clipboard, state } = fixture(t);
    state.local = [{type:'image/png',data}, {type:'text/plain',data:'中文'}];
    await clipboard._offerLocal(state.local, 'test');
    const { summary } = await clipboard.approve(clipboard._pendingDirection('toRemote').id);
    assert.deepEqual(summary.representations, [{type:'image/png',bytes:png.length,width:1,height:1},{type:'text/plain',bytes:6}]);
    assert.equal(summary.totalBytes,png.length+6);
    assert.equal(summary.preview,'中文');
  }
  // Optional display metadata is not an image validator; incomplete or invalid
  // headers must omit dimensions rather than fail a successful receipt.
  for (const data of [png.subarray(0,20), Buffer.alloc(33), Buffer.concat([png.subarray(0,16),Buffer.alloc(8),png.subarray(24)])]) {
    const { clipboard, state } = fixture(t);
    state.local = [{type:'image/png',data}];
    await clipboard._offerLocal(state.local,'test');
    const { summary } = await clipboard.approve(clipboard._pendingDirection('toRemote').id);
    assert.deepEqual(summary.representations,[{type:'image/png',bytes:data.length}]);
  }
});

test('replay, out-of-order delivery and dismissed offers cannot re-prompt', t => {
  const { clipboard, remote, events } = fixture(t);
  remote(2); remote(1); remote(2);
  assert.deepEqual([...clipboard.pending.keys()], ['remote-2']);
  clipboard.dismiss('remote-2'); remote(2);
  assert.equal(clipboard.pending.size, 0);
  assert.equal(events.length, 1);
  remote(3);
  assert.deepEqual([...clipboard.pending.keys()], ['remote-3']);
});

test('first recovery is manual baseline; same-generation reconnect does not resurrect it', async t => {
  const { clipboard, state, events } = fixture(t);
  state.sequence = 4;
  state.offers = [{ id:'baseline', direction:'toLocal', generation:1, sequence:4 }];
  await clipboard._connected();
  assert.equal(events.length, 1);
  assert.equal(events[0].mode, 'manual');
  clipboard.dismiss('baseline');
  clipboard._disconnected();
  await clipboard._connected();
  assert.equal(events.length, 1);
  assert.equal(clipboard.pending.size, 0);
});

test('latest local prompt preserves rich changes and legitimate A-B-A', async t => {
  const { clipboard } = fixture(t);
  for (const value of ['A', 'B', 'A']) await clipboard._offerLocal(text(value), 'test');
  assert.equal(clipboard.pending.size, 1);
  const first = clipboard._pendingDirection('toRemote').id;
  await clipboard._offerLocal([...text('A'), { type:'text/rtf', data:'{rich}' }], 'test');
  assert.notEqual(clipboard._pendingDirection('toRemote').id, first);
  await clipboard._offerLocal([], 'test');
  assert.equal(clipboard.pending.size, 0);
});

test('delayed Yes never uploads cached old source or silently substitutes new source', async t => {
  const { clipboard, state } = fixture(t);
  await clipboard._offerLocal(state.local, 'test');
  const id = clipboard._pendingDirection('toRemote').id;
  state.local = text('new copy');
  await assert.rejects(clipboard.approve(id), /Local clipboard changed/);
  assert.equal(state.sends, 0);
  const latest = clipboard._pendingDirection('toRemote');
  assert.notEqual(latest.id, id);
  await clipboard.approve(latest.id);
  assert.equal(state.sends, 1);
});

test('destination changes during delayed local Yes require a new explicit choice', async t => {
  const { clipboard, state, remote } = fixture(t);
  await clipboard._offerLocal(state.local, 'test');
  const id = clipboard._pendingDirection('toRemote').id;
  remote(1);
  await assert.rejects(clipboard.approve(id), /Remote clipboard changed/);
  assert.equal(clipboard.pending.size, 2);
  assert.equal(state.sends, 0);
  await clipboard.approve(id);
  assert.equal(state.sends, 1);
  assert.equal(clipboard.pending.size, 0);
});

test('remote Yes checks local changes, source revision, and preserves a later opposite prompt', async t => {
  const { clipboard, state, remote } = fixture(t);
  await clipboard._offerLocal(state.local, 'test');
  remote(1);
  state.local = text('later local');
  await assert.rejects(clipboard.approve('remote-1'), /Local clipboard changed/);
  assert.equal(state.writes, 0);
  state.sequence = 2;
  await assert.rejects(clipboard.approve('remote-1'), /Remote clipboard changed/);
  assert.equal(state.writes, 0);
});

test('permission/read failures are not empty content and cannot authorize a write', async t => {
  const { clipboard, state, remote } = fixture(t);
  await clipboard._offerLocal(state.local, 'test'); remote(1);
  clipboard._readLocalClipboard = async () => { throw new Error('permission denied'); };
  await assert.rejects(clipboard.approve('remote-1'), /permission denied/);
  assert.equal(state.writes, 0);
  assert.equal(clipboard.pending.size, 2);
});

test('disconnect while a read is in flight invalidates its consent', async t => {
  const { clipboard, state } = fixture(t);
  await clipboard._offerLocal(state.local, 'test');
  const id = clipboard._pendingDirection('toRemote').id;
  let finish;
  clipboard._readLocalClipboard = () => new Promise(resolve => { finish = resolve; });
  const operation = clipboard.approve(id);
  clipboard._disconnected(); finish(state.local);
  await assert.rejects(operation, /expired or was superseded/);
  assert.equal(state.sends, 0);
});

test('auto mode preserves two independent changes for explicit user choice', async t => {
  const { clipboard, state, remote, events } = fixture(t);
  Object.defineProperty(globalThis, 'navigator', { configurable:true, value:{ permissions:{ query:async () => ({ state:'granted' }) } } });
  await clipboard._offerLocal(state.local, 'test'); remote(1);
  clipboard.config.toRemote = clipboard.config.toLocal = 'auto';
  await clipboard._autoApprove('remote-1');
  assert.equal(state.writes + state.sends, 0);
  assert.equal(clipboard.pending.size, 2);
  assert.equal(events.filter(e => e.conflict && e.mode === 'prompt').length, 2);
});

test('source Viewer echo clears superseded remote notice, not another Viewer', t => {
  const first = fixture(t), second = fixture(t);
  first.remote(1); second.remote(1);
  first.remote(2, { sourceViewerId:first.clipboard.viewerId });
  second.remote(2, { sourceViewerId:first.clipboard.viewerId });
  assert.equal(first.clipboard.pending.size, 0);
  assert.equal(second.clipboard.pending.size, 1);
});

test('empty remote invalidation removes only remote prompts and ignores old generations', async t => {
  const { clipboard, state, remote } = fixture(t);
  await clipboard._offerLocal(state.local, 'test'); remote(1);
  clipboard._handleMessage({ type:'clipboard-invalidated', generation:2, sequence:8 });
  assert.equal(clipboard.pending.size, 2);
  clipboard._handleMessage({ type:'clipboard-invalidated', generation:1, sequence:2 });
  assert.equal(clipboard.pending.size, 1);
  assert.equal(clipboard._pendingDirection('toRemote').direction, 'toRemote');
  remote(1);
  assert.equal(clipboard.pending.size, 1);
});

test('manual current-offer access does not re-prompt dismissed history', async t => {
  const { clipboard, events, remote } = fixture(t);
  remote(1); clipboard.dismiss('remote-1');
  await clipboard.list({ recovery:true });
  assert.equal(clipboard.pending.size, 0);
  await clipboard.list();
  assert.equal(clipboard.pending.size, 1);
  assert.equal(events.at(-1).mode, 'manual');
});

test('off remains off on first baseline, and a different runtime resets sequence scope', async t => {
  const { clipboard, state } = fixture(t);
  clipboard.config.toLocal = 'off'; state.sequence = 5;
  state.offers = [{id:'old', direction:'toLocal', generation:1, sequence:5}];
  await clipboard._connected();
  assert.equal(clipboard.pending.size, 0);
  clipboard.client.instanceId = 'different-runtime'; state.sequence = 1;
  state.offers = [{id:'new', direction:'toLocal', generation:1, sequence:1}];
  clipboard.config.toLocal = 'prompt';
  await clipboard._connected();
  assert.equal(clipboard.pending.has('new'), true);
  assert.equal(clipboard.lastSequence, 1);
});

test('a monitor-resumption baseline does not prompt a first-time Viewer', async t => {
  const { clipboard, manager, remote, events, state } = fixture(t);
  manager.getClipboardCapabilities = async () => ({ consistencyVersion:1, sequence:state.sequence, settled:false });
  await clipboard._connected();
  remote(1, { baseline:true });
  assert.equal(events.at(-1).mode, 'manual');
  await assert.rejects(clipboard.approve('remote-1'), /being rechecked/);
  assert.equal(state.writes, 0);
  clipboard._disconnected();
  await clipboard._connected();
  remote(2, { baseline:true });
  assert.equal(events.at(-1).mode, 'prompt');
});

test('a delayed recovery list cannot delete a newer WebSocket offer', async t => {
  const { clipboard, manager, remote } = fixture(t);
  remote(1);
  let finish;
  manager.listClipboardOffers = () => new Promise(resolve => { finish = resolve; });
  const request = clipboard.list({recovery:true});
  remote(2);
  finish([]);
  await request;
  assert.deepEqual([...clipboard.pending.keys()], ['remote-2']);
});

test('explicit payload upload cannot replace the observed browser clipboard baseline', async t => {
  const {clipboard,state,manager,remote}=fixture(t);
  await clipboard._offerLocal(state.local,'test');
  const observed=clipboard.localFingerprint;
  manager.sendClipboardOffer=async()=>({id:'explicit'});
  await clipboard.syncToRemote({items:text('arbitrary supplied payload')});
  assert.equal(clipboard.localFingerprint,observed);
  remote(1);
  await clipboard.approve('remote-1');
  assert.equal(state.writes,1);
});

test('session generation changing before socket closure invalidates old consent', async t => {
  const {clipboard,state}=fixture(t);
  await clipboard._offerLocal(state.local,'test');
  const id=clipboard._pendingDirection('toRemote').id;
  clipboard.client.instance.sessionGeneration=2;
  await assert.rejects(clipboard.approve(id), /superseded/);
  assert.equal(state.sends,0);
});
