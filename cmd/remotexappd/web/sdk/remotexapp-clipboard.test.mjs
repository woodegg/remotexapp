import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

globalThis.CustomEvent ||= class CustomEvent extends Event {
  constructor(type, options = {}) { super(type); this.detail = options.detail; }
};

const { RemoteXAppClipboard, RemoteXAppClipboardPrompts } = await import('./remotexapp-clipboard.js');
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function installEventDOM() {
  const fakeWindow = new EventTarget();
  const fakeDocument = new EventTarget();
  fakeDocument.hidden = false;
  fakeDocument.hasFocus = () => true;
  Object.defineProperty(globalThis, 'window', { value:fakeWindow, configurable:true });
  Object.defineProperty(globalThis, 'document', { value:fakeDocument, configurable:true });
  return { fakeWindow, fakeDocument };
}

function fixture({ viewOnly = false } = {}) {
  const calls = [];
  const manager = {
    async getClipboardCapabilities() { return { protocolVersion:1, consistencyVersion:1, sequence:clipboard.lastSequence }; },
    async listClipboardOffers() { calls.push(['list']); return []; },
    async sendClipboardOffer(_id, options) { calls.push(['send', options]); return { id:'clp_'+'1'.repeat(32), direction:'toRemote', state:'owned' }; },
    async acceptClipboardOffer(_id, offerId) {
      calls.push(['accept', offerId]);
      return { offerId, items:[{ type:'text/plain', data:new TextEncoder().encode('remote').buffer }] };
    },
    async cancelClipboardOffer(_id, offerId) { calls.push(['cancel', offerId]); return { state:'cancelled' }; },
  };
  const client = new EventTarget();
  Object.assign(client, {
    manager, viewOnly, instanceId:'desktop-1', instance:{ sessionGeneration:5 },
    _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); },
  });
  const clipboard = new RemoteXAppClipboard(client);
  client.clipboard = clipboard;
  return { clipboard, client, manager, calls };
}

test('empty representations normalize before upload without changing whitespace', async () => {
  const { clipboard, calls } = fixture();
  assert.deepEqual(await clipboard.syncToRemote({items:[{type:'text/plain',data:''}]}), {skipped:true,reason:'empty-clipboard'});
  assert.equal(calls.length,0);
  let syncs=0;
  clipboard.addEventListener('sync',()=>syncs++);
  await clipboard.syncToRemote({items:[{type:'text/plain',data:new Blob([])},{type:'image/png',data:new Uint8Array([1,2,3])}]});
  assert.deepEqual(calls[0][1].items.map(x=>x.type),['image/png']);
  assert.equal(syncs,1);
  await clipboard.syncToRemote({items:[{type:'text/plain',data:' \t\n'},{type:'text/html',data:''}]});
  assert.equal(calls[1][1].items[0].data,' \t\n');
  await clipboard.syncToRemote({items:[{type:'text/plain',data:''}]});
  assert.equal(syncs,2);
});

test('HTML empty fallback and invalid representations reject instead of losing formats', async () => {
  const {clipboard,calls}=fixture();
  await assert.rejects(clipboard.send([{type:'text/html',data:'<b>x</b>'},{type:'text/plain',data:''}]),/nonempty text\/plain/);
  await assert.rejects(clipboard.send([{type:'text/plain',data:''},{type:'text/plain',data:'x'}]),/duplicate/);
  assert.equal(calls.length,0);
});

test('empty automatic observations do not prompt and later nonempty content does', async () => {
  const {clipboard}=fixture();
  clipboard.config.toRemote='prompt'; clipboard.inputActive=true;
  let offers=0; clipboard.addEventListener('offer',()=>offers++);
  await clipboard._offerLocal([{type:'text/plain',data:''}],'test');
  await clipboard._offerLocal([],'test');
  assert.equal(offers,0);
  await clipboard._offerLocal([{type:'text/plain',data:'hello'},{type:'text/rtf',data:''}],'test');
  await clipboard._offerLocal([{type:'text/plain',data:'hello'}],'test');
  assert.equal(offers,1);
  clipboard.destroy();
});

test('pending previews read offered content without writing or leaking payloads', async () => {
  const { clipboard, calls } = fixture();
  const text = '中文 <script>alert(1)</script>';
  const offer = { id:'preview-local', direction:'toRemote', generation:5,
    expiresAt:new Date(Date.now() + 60000).toISOString(),
    items:[{type:'text/plain',data:text},{type:'text/html',data:'<b>hello</b>'}] };
  clipboard.pending.set(offer.id, offer);
  const result = await clipboard._previewOffer(offer.id);
  assert.equal(result.summary.preview, text);
  assert.equal(result.summary.representations[0].bytes, new TextEncoder().encode(text).length);
  assert.equal(result.thumbnail, null);
  assert.equal(calls.length, 0);
  assert.equal(JSON.stringify(clipboard.snapshot()).includes(text), false);
  const remote = { ...offer, id:'preview-remote', direction:'toLocal', items:undefined };
  clipboard.pending.set(remote.id, remote);
  const received = await clipboard._previewOffer(remote.id);
  assert.equal(received.summary.preview, 'remote');
  assert.deepEqual(calls, [['accept', remote.id]]);
  assert.equal(clipboard.pending.has(remote.id), true);
  clipboard.destroy();
});

test('PNG previews preserve dimensions but do not decode oversized images; empty previews stay empty', async () => {
  const {clipboard} = fixture();
  const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
  const offer = {id:'image',direction:'toRemote',generation:5,expiresAt:new Date(Date.now()+60000).toISOString(),items:[{type:'image/png',data:png}]};
  clipboard.pending.set(offer.id,offer);
  assert.equal((await clipboard._previewOffer(offer.id)).thumbnail.type,'image/png');
  new DataView(png.buffer).setUint32(16,10000);
  new DataView(png.buffer).setUint32(20,10000);
  const oversized = await clipboard._previewOffer(offer.id);
  assert.equal(oversized.thumbnail,null);
  assert.equal(oversized.summary.representations[0].width,10000);
  offer.items = [];
  const empty = await clipboard._previewOffer(offer.id);
  assert.equal(empty.summary.totalBytes,0); assert.deepEqual(empty.summary.types,[]);
  assert.equal(empty.thumbnail,null);
  clipboard.destroy();
});

test('preview discards replaced, expired, mismatched and cancelled reads', async () => {
  for (const condition of ['replaced', 'expired', 'mismatch', 'cancelled', 'denied']) {
    const { clipboard, manager } = fixture();
    const offer = { id:'remote', direction:'toLocal', generation:5, expiresAt:new Date(Date.now() + 60000).toISOString() };
    clipboard.pending.set(offer.id, offer);
    const controller = new AbortController();
    manager.acceptClipboardOffer = async () => {
      if (condition === 'replaced') clipboard.pending.set(offer.id, {...offer});
      if (condition === 'expired') offer.expiresAt = new Date(0).toISOString();
      if (condition === 'cancelled') controller.abort();
      if (condition === 'denied') throw new Error('permission denied');
      return {offerId:condition === 'mismatch' ? 'another' : offer.id, items:[{type:'text/plain',data:'sample'}]};
    };
    await assert.rejects(clipboard._previewOffer(offer.id, {signal:controller.signal}));
    clipboard.destroy();
  }
});

test('capture error messages are direction and generation scoped', () => {
  const {clipboard}=fixture(); clipboard.config.toLocal='prompt';
  const errors=[]; clipboard.addEventListener('error',event=>errors.push(event.detail));
  assert.equal(clipboard._handleMessage({type:'clipboard-error',generation:4,error:'stale'}),true);
  assert.equal(errors.length,0);
  clipboard._handleMessage({type:'clipboard-error',generation:5,error:'read failed'});
  assert.equal(errors[0].direction,'toLocal'); assert.equal(errors[0].error.message,'read failed');
  clipboard.config.toLocal='off';
  clipboard._handleMessage({type:'clipboard-error',generation:5,error:'disabled'});
  assert.equal(errors.length,1);
});

test('remote empty acceptance is a no-op and local read errors never upload a subset', async () => {
  const {clipboard,manager,calls}=fixture();
  manager.acceptClipboardOffer=async()=>({items:[{type:'text/plain',data:''}]});
  clipboard.pending.set('test',{id:'test',direction:'toLocal'});
  let success=0; clipboard.addEventListener('sync',()=>success++);
  assert.deepEqual(await clipboard.syncToLocal('test'),{skipped:true,reason:'empty-clipboard'});
  assert.equal(success,0); assert.equal(clipboard.pending.size,0);
  const nav=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  const secure=Object.getOwnPropertyDescriptor(globalThis,'isSecureContext');
  try {
    Object.defineProperty(globalThis,'isSecureContext',{value:true,configurable:true});
    Object.defineProperty(globalThis,'navigator',{value:{clipboard:{read:async()=>[{types:['text/plain','image/png'],getType:async type=>{if(type==='image/png')throw Error('read failed');return new Blob(['valid'])}}]}},configurable:true});
    await assert.rejects(clipboard.syncToRemote(),/read failed/);
    assert.equal(calls.length,0);
  } finally {
    if(nav) Object.defineProperty(globalThis,'navigator',nav); else delete globalThis.navigator;
    if(secure) Object.defineProperty(globalThis,'isSecureContext',secure); else delete globalThis.isSecureContext;
  }
});

test('clipboard modes are independent and view-only prevents monitored toRemote transfer', () => {
  const normal = fixture().clipboard;
  assert.deepEqual(normal.configure({ toRemote:'manual', toLocal:'prompt' }).config, { toRemote:'manual', toLocal:'prompt', checkOnFocus:true });
  assert.throws(() => normal.configure({ toRemote:'sometimes' }), /off, manual, prompt, or auto/);
  const viewOnly = fixture({ viewOnly:true }).clipboard;
  assert.equal(viewOnly.configure({ toRemote:'auto', toLocal:'prompt' }).config.toRemote, 'manual');
});

test('source Viewer suppresses only its own remote offer and other Viewers remain independent', () => {
  const first = fixture();
  const second = fixture();
  first.clipboard.configure({ toLocal:'prompt' });
  second.clipboard.configure({ toLocal:'prompt' });
  const offer = {
    id:'clp_'+'2'.repeat(32), direction:'toLocal', generation:5, sequence:1,
    sourceViewerId:first.clipboard.viewerId, types:['text/plain'], totalBytes:6,
    state:'accepted', createdAt:new Date().toISOString(), expiresAt:new Date(Date.now()+60000).toISOString(),
  };
  assert.equal(first.clipboard._handleMessage({ type:'clipboard-offer', offer }), true);
  assert.equal(second.clipboard._handleMessage({ type:'clipboard-offer', offer }), true);
  assert.equal(first.clipboard.snapshot().pending.length, 0);
  assert.equal(second.clipboard.snapshot().pending.length, 1);
  second.clipboard.dismiss(offer.id);
  assert.equal(second.clipboard.snapshot().pending.length, 0);
});

test('explicit items send without browser clipboard permission and generation qualifies the request', async () => {
  const { clipboard, calls } = fixture();
  await clipboard.send([{ type:'text/plain', data:new TextEncoder().encode('hello') }], { action:'paste' });
  assert.equal(calls[0][0], 'send');
  assert.equal(calls[0][1].sessionGeneration, 5);
  assert.equal(calls[0][1].viewerId, clipboard.viewerId);
  assert.equal(calls[0][1].action, 'paste');
});

test('sequence gap reconciles through the pending-offer list', async () => {
  const { clipboard, calls } = fixture();
  clipboard.configure({ toLocal:'manual' });
  const base = { direction:'toLocal', generation:5, sourceViewerId:'viewer_other000', types:['text/plain'], totalBytes:1, state:'accepted', createdAt:new Date().toISOString() };
  clipboard._handleMessage({ type:'clipboard-offer', offer:{ ...base, id:'clp_'+'3'.repeat(32), sequence:1 } });
  clipboard._handleMessage({ type:'clipboard-offer', offer:{ ...base, id:'clp_'+'4'.repeat(32), sequence:3 } });
  await sleep(0);
  assert.equal(calls.filter(call => call[0] === 'list').length, 1);
});

test('focus reconciliation queries permission but never reads or prompts when it is not granted', async () => {
  const reads = [];
  const fakeWindow = new EventTarget();
  const fakeDocument = new EventTarget();
  fakeDocument.hidden = false;
  Object.defineProperty(globalThis, 'window', { value:fakeWindow, configurable:true });
  Object.defineProperty(globalThis, 'document', { value:fakeDocument, configurable:true });
  Object.defineProperty(globalThis, 'navigator', { value:{
    permissions:{ query:async () => ({ state:'prompt' }) },
    clipboard:{ read:async () => { reads.push(true); return []; }, addEventListener() {}, removeEventListener() {} },
  }, configurable:true });
  globalThis.isSecureContext = true;
  const { clipboard } = fixture();
  let permissionEvents = 0;
  clipboard.addEventListener('permissionrequired', () => { permissionEvents++; });
  clipboard.configure({ toRemote:'prompt' });
  clipboard._setInputActive(true, { reconcile:false });
  fakeWindow.dispatchEvent(new Event('focus'));
  await sleep(150);
  assert.equal(reads.length, 0);
  assert.equal(permissionEvents, 1);
  clipboard.destroy();
});

test('inactive Viewer does not inspect local clipboard and activation creates a fresh prompt', async () => {
  const reads = [];
  const clipboardEvents = new EventTarget();
  clipboardEvents.read = async () => {
    reads.push(Date.now());
    return [{ types:['text/plain'], getType:async () => new Blob(['new local content'], { type:'text/plain' }) }];
  };
  const fakeWindow = new EventTarget();
  const fakeDocument = new EventTarget();
  fakeDocument.hidden = false;
  Object.defineProperty(globalThis, 'window', { value:fakeWindow, configurable:true });
  Object.defineProperty(globalThis, 'document', { value:fakeDocument, configurable:true });
  Object.defineProperty(globalThis, 'navigator', { value:{
    permissions:{ query:async () => ({ state:'granted' }) },
    clipboard:clipboardEvents,
  }, configurable:true });
  globalThis.isSecureContext = true;
  const { clipboard } = fixture();
  clipboard.configure({ toRemote:'prompt' });
  clipboardEvents.dispatchEvent(new Event('clipboardchange'));
  fakeWindow.dispatchEvent(new Event('focus'));
  await sleep(150);
  assert.equal(reads.length, 0);
  assert.equal(clipboard.snapshot().pending.length, 0);

  const activatedAt = Date.now();
  clipboard._setInputActive(true);
  await sleep(150);
  assert.equal(reads.length, 1);
  assert.equal(clipboard.snapshot().inputActive, true);
  assert.equal(clipboard.snapshot().pending.length, 1);
  assert.ok(Date.parse(clipboard.snapshot().pending[0].expiresAt) >= activatedAt + 59000);
  clipboard.destroy();
});

test('remote write suppression is local to Viewer A and Viewer B can offer the same clipboard after activation', async () => {
  const clipboardEvents = new EventTarget();
  clipboardEvents.read = async () => [{
    types:['text/plain'], getType:async () => new Blob(['remote'], { type:'text/plain' }),
  }];
  clipboardEvents.writeText = async () => {};
  const fakeWindow = new EventTarget();
  const fakeDocument = new EventTarget();
  fakeDocument.hidden = false;
  Object.defineProperty(globalThis, 'window', { value:fakeWindow, configurable:true });
  Object.defineProperty(globalThis, 'document', { value:fakeDocument, configurable:true });
  Object.defineProperty(globalThis, 'navigator', { value:{
    permissions:{ query:async () => ({ state:'granted' }) },
    clipboard:clipboardEvents,
  }, configurable:true });
  globalThis.isSecureContext = true;

  const first = fixture();
  const second = fixture();
  first.clipboard.configure({ toRemote:'prompt', toLocal:'manual' });
  second.clipboard.configure({ toRemote:'prompt' });
  const offer = {
    id:'clp_'+'a'.repeat(32), direction:'toLocal', generation:5, sequence:1,
    sourceViewerId:'viewer_other000', types:['text/plain'], totalBytes:6, state:'accepted',
    createdAt:new Date().toISOString(), expiresAt:new Date(Date.now()+60000).toISOString(),
  };
  first.clipboard._handleMessage({ type:'clipboard-offer', offer });
  await first.clipboard.syncToLocal(offer.id);

  first.clipboard._setInputActive(true);
  await sleep(150);
  assert.equal(first.clipboard.snapshot().pending.length, 0);
  assert.equal(second.clipboard.snapshot().pending.length, 0);

  second.clipboard._setInputActive(true);
  await sleep(150);
  assert.equal(second.clipboard.snapshot().pending.length, 1);
  assert.equal(second.clipboard.snapshot().pending[0].direction, 'toRemote');
  first.clipboard.destroy();
  second.clipboard.destroy();
});

test('deactivation cancels delayed local reconciliation', async () => {
  let reads = 0;
  const fakeWindow = new EventTarget();
  const fakeDocument = new EventTarget();
  fakeDocument.hidden = false;
  Object.defineProperty(globalThis, 'window', { value:fakeWindow, configurable:true });
  Object.defineProperty(globalThis, 'document', { value:fakeDocument, configurable:true });
  Object.defineProperty(globalThis, 'navigator', { value:{
    permissions:{ query:async () => ({ state:'granted' }) },
    clipboard:{ read:async () => { reads++; return []; }, addEventListener() {}, removeEventListener() {} },
  }, configurable:true });
  globalThis.isSecureContext = true;
  const { clipboard } = fixture();
  clipboard.configure({ toRemote:'prompt' });
  clipboard._setInputActive(true);
  clipboard._setInputActive(false);
  await sleep(150);
  assert.equal(reads, 0);
  assert.equal(clipboard.snapshot().inputActive, false);
  clipboard.destroy();
});

test('auto mode visibly degrades to prompt when browser permission is unavailable', async () => {
  Object.defineProperty(globalThis, 'navigator', { value:{
    permissions:{ query:async ({ name }) => ({ state:name === 'clipboard-read' ? 'prompt' : 'denied' }) },
    clipboard:{ read:async () => [], write:async () => {} },
  }, configurable:true });
  globalThis.ClipboardItem = class ClipboardItem {};
  globalThis.isSecureContext = true;
  const { clipboard } = fixture();
  clipboard.configure({ toRemote:'auto', toLocal:'auto' });
  const snapshot = await clipboard.refreshCapabilities();
  assert.equal(snapshot.config.toRemote, 'prompt');
  assert.equal(snapshot.config.toLocal, 'prompt');
});

test('access check is side-effect free and reports browser context and permission state', async () => {
  const reads = [];
  const writes = [];
  Object.defineProperty(globalThis, 'document', { value:{ hasFocus:() => true }, configurable:true });
  Object.defineProperty(globalThis, 'navigator', { value:{
    userActivation:{ isActive:false },
    permissions:{ query:async ({ name }) => ({ state:name === 'clipboard-read' ? 'prompt' : 'granted' }) },
    clipboard:{ read:async () => { reads.push(true); return []; }, write:async () => { writes.push(true); } },
  }, configurable:true });
  globalThis.ClipboardItem = class ClipboardItem {};
  globalThis.isSecureContext = true;
  const { clipboard, calls } = fixture();
  const snapshot = await clipboard.checkAccess();
  assert.equal(snapshot.access.secureContext, true);
  assert.equal(snapshot.access.focused, true);
  assert.equal(snapshot.access.userActivation, false);
  assert.deepEqual(snapshot.access.read, { supported:true, permission:'prompt', state:'prompt', verified:false });
  assert.deepEqual(snapshot.access.write, { supported:true, permission:'granted', state:'granted', verified:false });
  assert.equal(reads.length, 0);
  assert.equal(writes.length, 0);
  assert.equal(calls.length, 0);
});

test('explicit read authorization verifies access without decoding, writing, or sending clipboard content', async () => {
  const order = [];
  const reads = [];
  const getTypes = [];
  const writes = [];
  Object.defineProperty(globalThis, 'document', { value:{ hasFocus:() => true }, configurable:true });
  Object.defineProperty(globalThis, 'navigator', { value:{
    userActivation:{ isActive:true },
    permissions:{ query:async () => { order.push('query'); return { state:'granted' }; } },
    clipboard:{
      read:() => { order.push('read'); reads.push(true); return Promise.resolve([{ types:['text/plain'], getType:() => { getTypes.push(true); } }]); },
      write:async () => { writes.push(true); },
    },
  }, configurable:true });
  globalThis.ClipboardItem = class ClipboardItem {};
  globalThis.isSecureContext = true;
  const { clipboard, calls } = fixture();
  const snapshot = await clipboard.requestReadAccess();
  assert.equal(snapshot.access.read.state, 'granted');
  assert.equal(snapshot.access.read.verified, true);
  assert.equal(reads.length, 1);
  assert.equal(getTypes.length, 0);
  assert.equal(writes.length, 0);
  assert.equal(calls.length, 0);
  assert.equal(order[0], 'read');
});

test('read authorization reports missing activation without attempting a write or remote transfer', async () => {
  const writes = [];
  Object.defineProperty(globalThis, 'document', { value:{ hasFocus:() => true }, configurable:true });
  Object.defineProperty(globalThis, 'navigator', { value:{
    userActivation:{ isActive:false },
    permissions:{ query:async () => ({ state:'prompt' }) },
    clipboard:{
      read:() => Promise.reject(Object.assign(new Error('activation required'), { name:'NotAllowedError' })),
      write:async () => { writes.push(true); },
    },
  }, configurable:true });
  globalThis.ClipboardItem = class ClipboardItem {};
  globalThis.isSecureContext = true;
  const { clipboard, calls } = fixture();
  const snapshot = await clipboard.requestReadAccess();
  assert.equal(snapshot.access.read.state, 'requires-user-activation');
  assert.equal(snapshot.access.read.verified, false);
  assert.equal(writes.length, 0);
  assert.equal(calls.length, 0);
});

test('read authorization reports secure-context, focus, unsupported, and denied failures as state', async t => {
  const cases = [
    { name:'secure context', secure:false, focused:true, clipboard:{ read:async () => [] }, expected:'secure-context-required' },
    { name:'document focus', secure:true, focused:false, clipboard:{ read:async () => [] }, expected:'document-not-focused' },
    { name:'unsupported API', secure:true, focused:true, clipboard:{}, expected:'unsupported' },
    { name:'permission denial', secure:true, focused:true, activation:true, clipboard:{ read:() => Promise.reject(Object.assign(new Error('no'), { name:'NotAllowedError' })) }, expected:'denied' },
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      Object.defineProperty(globalThis, 'document', { value:{ hasFocus:() => item.focused }, configurable:true });
      Object.defineProperty(globalThis, 'navigator', { value:{
        userActivation:{ isActive:Boolean(item.activation) },
        permissions:{ query:async () => ({ state:'prompt' }) },
        clipboard:item.clipboard,
      }, configurable:true });
      globalThis.isSecureContext = item.secure;
      const snapshot = await fixture().clipboard.requestReadAccess();
      assert.equal(snapshot.access.read.state, item.expected);
      assert.equal(snapshot.access.read.verified, false);
    });
  }
});

test('local write keeps browser-supported representations and omits unsupported RTF', async () => {
  const writes = [];
  Object.defineProperty(globalThis, 'navigator', { value:{ clipboard:{
    write:async values => writes.push(values), writeText:async () => {},
  } }, configurable:true });
  globalThis.ClipboardItem = class ClipboardItem {
    static supports(type) { return type !== 'text/rtf'; }
    constructor(values) { this.values = values; }
  };
  globalThis.isSecureContext = true;
  const { clipboard } = fixture();
  const receipt = await clipboard._writeLocalClipboard([
    { type:'text/plain', data:'plain' },
    { type:'text/html', data:'<b>plain</b>' },
    { type:'text/rtf', data:'{\\rtf1 plain}' },
  ]);
  assert.deepEqual(receipt.types, ['text/plain', 'text/html']);
  assert.deepEqual(receipt.items.map(item => item.type), ['text/plain', 'text/html']);
  assert.deepEqual(Object.keys(writes[0][0].values), ['text/plain', 'text/html']);
});

test('same Viewer suppresses rich remote write rebound after unsupported omission and MIME reordering', async () => {
  installEventDOM();
  const plain = new TextEncoder().encode('remote rich');
  const html = new TextEncoder().encode('<b>remote rich</b>');
  const normalizedHTML = new TextEncoder().encode('<meta charset="utf-8"><b>remote rich</b>');
  const rtf = new TextEncoder().encode('{\\rtf1 remote rich}');
  let localItems = [
    { types:['text/html', 'text/plain'], getType:async type => new Blob([type === 'text/plain' ? plain : normalizedHTML], { type }) },
  ];
  Object.defineProperty(globalThis, 'navigator', { value:{ clipboard:{
    write:async () => {}, read:async () => localItems,
  } }, configurable:true });
  globalThis.ClipboardItem = class ClipboardItem {
    static supports(type) { return type !== 'text/rtf'; }
    constructor(values) { this.values = values; }
  };
  globalThis.isSecureContext = true;
  const { clipboard, manager } = fixture();
  manager.acceptClipboardOffer = async (_id, offerId) => ({ offerId, items:[
    { type:'text/plain', data:plain }, { type:'text/html', data:html }, { type:'text/rtf', data:rtf },
  ] });
  clipboard.configure({ toRemote:'prompt', toLocal:'manual' });
  clipboard.permissions.read = 'granted';
  clipboard._setInputActive(true, { reconcile:false });
  const offer = {
    id:'clp_'+'b'.repeat(32), direction:'toLocal', generation:5, sequence:1,
    sourceViewerId:'viewer_other000', types:['text/plain', 'text/html', 'text/rtf'], totalBytes:42,
    state:'accepted', createdAt:new Date().toISOString(), expiresAt:new Date(Date.now()+60000).toISOString(),
  };
  clipboard._handleMessage({ type:'clipboard-offer', offer });
  assert.deepEqual((await clipboard.syncToLocal(offer.id)).types, ['text/plain', 'text/html']);
  await clipboard._offerLocal([
    { type:'text/html', data:normalizedHTML }, { type:'text/plain', data:plain },
  ], 'test-readback');
  assert.equal(clipboard.snapshot().pending.length, 0);

  localItems = [{ types:['text/plain'], getType:async () => new Blob(['genuinely new'], { type:'text/plain' }) }];
  await clipboard._offerLocal([{ type:'text/plain', data:new TextEncoder().encode('genuinely new') }], 'real-change');
  assert.equal(clipboard.snapshot().pending.length, 1);
  assert.equal(clipboard.snapshot().pending[0].direction, 'toRemote');
  clipboard.destroy();
});

test('plain-text fallback receipt suppresses rebound without clipboard-read permission', async () => {
  installEventDOM();
  const writes = [];
  Object.defineProperty(globalThis, 'navigator', { value:{ clipboard:{
    write:async () => { throw new DOMException('unsupported', 'DataError'); },
    writeText:async value => writes.push(value),
  } }, configurable:true });
  globalThis.ClipboardItem = class ClipboardItem { static supports() { return true; } constructor(values) { this.values = values; } };
  globalThis.isSecureContext = true;
  const { clipboard, manager } = fixture();
  manager.acceptClipboardOffer = async (_id, offerId) => ({ offerId, items:[
    { type:'text/plain', data:new TextEncoder().encode('fallback') },
    { type:'text/html', data:new TextEncoder().encode('<b>fallback</b>') },
  ] });
  clipboard.configure({ toRemote:'prompt', toLocal:'manual' });
  clipboard._setInputActive(true, { reconcile:false });
  const offer = {
    id:'clp_'+'c'.repeat(32), direction:'toLocal', generation:5, sequence:1,
    sourceViewerId:'viewer_other000', types:['text/plain', 'text/html'], totalBytes:24,
    state:'accepted', createdAt:new Date().toISOString(), expiresAt:new Date(Date.now()+60000).toISOString(),
  };
  clipboard._handleMessage({ type:'clipboard-offer', offer });
  const receipt = await clipboard.syncToLocal(offer.id);
  assert.deepEqual(receipt.types, ['text/plain']);
  assert.deepEqual(receipt.summary, { types:['text/plain'], preview:'fallback', totalBytes:8, representations:[{type:'text/plain',bytes:8}] });
  assert.deepEqual(writes, ['fallback']);
  await clipboard._offerLocal([{ type:'text/plain', data:new TextEncoder().encode('fallback') }], 'fallback-readback');
  assert.equal(clipboard.snapshot().pending.length, 0);
  clipboard.destroy();
});

test('transfer summaries bound Unicode previews and never enter public offer events', async () => {
  installEventDOM();
  Object.defineProperty(globalThis, 'navigator', { value:{ clipboard:{ writeText:async () => {} } }, configurable:true });
  const { clipboard, manager } = fixture();
  const payload = '<b>sample</b>\n\u202e' + '😀'.repeat(100);
  manager.acceptClipboardOffer = async () => ({ items:[{ type:'text/plain', data:new Blob([payload]) }] });
  clipboard._writeLocalClipboard = async items => ({ types:['text/plain'], items });
  const offer = { id:'preview', direction:'toLocal', generation:5, sequence:0, expiresAt:new Date(Date.now()+60000).toISOString() };
  clipboard.pending.set(offer.id, offer);
  let sync;
  clipboard.addEventListener('sync', event => { sync = event.detail; });
  const receipt = await clipboard.syncToLocal(offer.id);
  assert.equal([...receipt.summary.preview].length, 81);
  assert.ok(receipt.summary.preview.startsWith('<b>sample</b> '));
  assert.ok(receipt.summary.preview.endsWith('…'));
  assert.doesNotMatch(receipt.summary.preview, /[\n\u202e\ufffd]/);
  assert.equal(JSON.stringify(sync).includes('sample'), false);
  assert.equal(JSON.stringify(clipboard.snapshot()).includes('sample'), false);
  clipboard.destroy();
});

test('focus reconciliation waits for an in-flight browser write before inspecting clipboard', async () => {
  installEventDOM();
  let releaseWrite;
  let readCount = 0;
  const writeStarted = new Promise(resolve => { releaseWrite = resolve; });
  let finishWrite;
  const writeBlocked = new Promise(resolve => { finishWrite = resolve; });
  Object.defineProperty(globalThis, 'navigator', { value:{
    permissions:{ query:async () => ({ state:'granted' }) },
    clipboard:{
      write:async () => { releaseWrite(); await writeBlocked; },
      read:async () => {
        readCount++;
        return [{ types:['text/plain'], getType:async () => new Blob(['serialized'], { type:'text/plain' }) }];
      },
    },
  }, configurable:true });
  globalThis.ClipboardItem = class ClipboardItem { static supports() { return true; } constructor(values) { this.values = values; } };
  globalThis.isSecureContext = true;
  const { clipboard, manager } = fixture();
  manager.acceptClipboardOffer = async (_id, offerId) => ({ offerId, items:[
    { type:'text/plain', data:new TextEncoder().encode('serialized') },
  ] });
  clipboard.configure({ toRemote:'prompt', toLocal:'manual' });
  clipboard.permissions.read = 'granted';
  clipboard._setInputActive(true, { reconcile:false });
  const offer = {
    id:'clp_'+'d'.repeat(32), direction:'toLocal', generation:5, sequence:1,
    sourceViewerId:'viewer_other000', types:['text/plain'], totalBytes:10,
    state:'accepted', createdAt:new Date().toISOString(), expiresAt:new Date(Date.now()+60000).toISOString(),
  };
  clipboard._handleMessage({ type:'clipboard-offer', offer });
  const synchronization = clipboard.syncToLocal(offer.id);
  await writeStarted;
  const reconciliation = clipboard._reconcileLocal('focus');
  await sleep(0);
  assert.equal(readCount, 1); // Acceptance revalidation precedes the write.
  finishWrite();
  await Promise.all([synchronization, reconciliation]);
  assert.equal(readCount, 3);
  assert.equal(clipboard.snapshot().pending.length, 0);
  clipboard.destroy();
});

test('successful remote-to-local synchronization marks write access verified', async () => {
  Object.defineProperty(globalThis, 'navigator', { value:{ clipboard:{ writeText:async () => {} } }, configurable:true });
  globalThis.isSecureContext = true;
  const { clipboard } = fixture();
  clipboard.configure({ toLocal:'manual' });
  const offer = {
    id:'clp_'+'8'.repeat(32), direction:'toLocal', generation:5, sequence:1,
    sourceViewerId:'viewer_other000', types:['text/plain'], totalBytes:6,
    state:'accepted', createdAt:new Date().toISOString(), expiresAt:new Date(Date.now()+60000).toISOString(),
  };
  clipboard._handleMessage({ type:'clipboard-offer', offer });
  await clipboard.syncToLocal(offer.id);
  assert.equal(clipboard.snapshot().access.write.state, 'granted');
  assert.equal(clipboard.snapshot().access.write.verified, true);
});

test('pending offers expire locally and emit one terminal event', async () => {
  const { clipboard } = fixture();
  clipboard.configure({ toLocal:'prompt' });
  const expired = [];
  clipboard.addEventListener('expired', event => expired.push(event.detail.offer));
  clipboard._handleMessage({ type:'clipboard-offer', offer:{
    id:'clp_'+'9'.repeat(32), direction:'toLocal', generation:5, sequence:1,
    sourceViewerId:'viewer_other000', types:['text/plain'], totalBytes:1,
    state:'accepted', createdAt:new Date(Date.now()-1000).toISOString(), expiresAt:new Date(Date.now()-1).toISOString(),
  } });
  await sleep(5);
  assert.equal(clipboard.snapshot().pending.length, 0);
  assert.equal(expired.length, 1);
  assert.equal(expired[0].state, 'expired');
});

test('declarative element forwards clipboard expiry with the other client events', () => {
  const source = readFileSync(new URL('./remotexapp-element.js', import.meta.url), 'utf8');
  assert.match(source, /['"]clipboardexpired['"]/);
});

test('standard prompts stack newest first and dismiss only the selected Viewer notice', () => {
  class FakeNode extends EventTarget {
    constructor(tag = 'div') { super(); this.tagName = tag; this.children = []; this.style = {}; this.dataset = {}; this.attributes = {}; this.parent = null; this.textContent = ''; }
    append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
    prepend(node) { node.parent = this; this.children.unshift(node); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
    setAttribute(name, value) { this.attributes[name] = value; }
  }
  const fakeDocument = { createElement:tag => new FakeNode(tag) };
  Object.defineProperty(globalThis, 'document', { value:fakeDocument, configurable:true });
  const clipboard = new EventTarget();
  const dismissed = [];
  clipboard.dismiss = id => { dismissed.push(id); return true; };
  clipboard.approve = async () => {};
  const container = new FakeNode();
  const client = { container, clipboard, focus() {} };
  const prompts = new RemoteXAppClipboardPrompts(client, { limit:2 });
  assert.equal(prompts.successDuration, 3000);
  const first = { id:'first', direction:'toRemote' };
  const second = { id:'second', direction:'toLocal' };
  clipboard.dispatchEvent(new CustomEvent('offer', { detail:{ offer:first, mode:'manual' } }));
  assert.equal(prompts.root.children.length, 0);
  clipboard.dispatchEvent(new CustomEvent('offer', { detail:{ offer:first, mode:'prompt' } }));
  clipboard.dispatchEvent(new CustomEvent('offer', { detail:{ offer:second, mode:'prompt' } }));
  assert.equal(prompts.root.children[0].dataset.offerId, 'second');
  assert.equal(prompts.root.children[1].dataset.offerId, 'first');
  assert.equal(prompts.root.style.height, 'fit-content');
  assert.equal(prompts.root.style.maxHeight, '100%');
  assert.equal(prompts.root.style.alignContent, 'start');
  assert.equal(prompts.root.children[0].dataset.direction, 'toLocal');
  assert.equal(prompts.root.children[0].style.background, '#075985');
  assert.match(prompts.root.children[0].children[0].textContent, /Remote → Local/);
  assert.equal(prompts.root.children[1].style.background, '#b42318');
  assert.match(prompts.root.children[1].children[0].textContent, /Local → Remote/);
  assert.match(prompts.root.children[0].children[1].attributes['aria-label'], /Remote to Local/);
  const dismissButton = prompts.root.children[0].children[2];
  const approveButton = prompts.root.children[0].children[1];
  assert.equal(approveButton.textContent, '');
  assert.equal(approveButton.style.width, dismissButton.style.width);
  assert.equal(approveButton.style.height, dismissButton.style.height);
  assert.equal(approveButton.style.backgroundSize, '15.4px 15.4px');
  assert.equal(approveButton.attributes.title, approveButton.attributes['aria-label']);
  assert.match(decodeURIComponent(approveButton.style.backgroundImage), /stroke-width="3".*M4 12l5 5L20 6/);
  assert.match(decodeURIComponent(dismissButton.style.backgroundImage), /stroke-width="3".*M6 6l12 12/);
  assert.equal(prompts.root.children[0].children[0].style.backgroundSize, '19.6px 19.6px');
  assert.equal(prompts.root.children[0].children[0].style.backgroundPosition, 'left center');
  assert.equal(prompts.root.children[0].children[0].style.minHeight, undefined);
  assert.equal(prompts.root.children[0].children[0].style.lineHeight, '1.4');
  assert.match(decodeURIComponent(prompts.root.children[0].children[0].style.backgroundImage), /M12 3v18/);
  assert.match(decodeURIComponent(prompts.root.children[1].children[0].style.backgroundImage), /M12 21V3/);
  dismissButton.onclick();
  assert.deepEqual(dismissed, ['second']);
  assert.equal(prompts.root.children.length, 1);
  prompts.destroy();
});

test('standard prompt terminal states retain direction and use distinct high-contrast backgrounds', async () => {
  class FakeNode extends EventTarget {
    constructor() { super(); this.children = []; this.style = {}; this.dataset = {}; this.attributes = {}; this.parent = null; this.textContent = ''; }
    append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
    prepend(node) { node.parent = this; this.children.unshift(node); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
    setAttribute(name, value) { this.attributes[name] = value; }
  }
  Object.defineProperty(globalThis, 'document', { value:{ createElement:() => new FakeNode() }, configurable:true });
  const clipboard = new EventTarget();
  clipboard.dismiss = () => true;
  clipboard.approve = async () => { throw new Error('write denied'); };
  const client = { container:new FakeNode(), clipboard, focus() {} };
  const prompts = new RemoteXAppClipboardPrompts(client, { successDuration:10000 });
  assert.equal(prompts.successDuration, 10000);
  const failed = { id:'failed', direction:'toRemote' };
  clipboard.dispatchEvent(new CustomEvent('offer', { detail:{ offer:failed, mode:'prompt' } }));
  await prompts.root.children[0].children[1].onclick();
  assert.equal(prompts.root.children[0].dataset.state, 'failure');
  assert.equal(prompts.root.children[0].style.background, '#7f1d1d');
  assert.match(prompts.root.children[0].children[0].textContent, /Local → Remote/);

  assert.equal(prompts.root.children[0].children[1].disabled, false);
  for (const direction of ['toLocal', 'toRemote']) {
    for (const summary of [
      { types:['text/plain'], preview:'<b>sample</b>' },
      { types:['image/png'], preview:'', totalBytes:2048, representations:[{type:'image/png',bytes:2048,width:1280,height:720}] },
      { types:['text/plain', 'text/html', 'text/rtf'], preview:'formatted' },
    ]) {
      clipboard.approve = async () => ({ summary });
      const id = direction + summary.types.join();
      prompts.add({ id, direction });
      const bar = prompts.nodes.get(id);
      assert.equal(bar.children.length, 3);
      await bar.children[1].onclick();
      assert.equal(bar.children.length, 1, 'success must not retain Yes or dismiss');
      assert.equal(bar.dataset.state, 'success');
      assert.equal(bar.style.background, '#166534');
      for (const type of summary.types) assert.ok(bar.children[0].textContent.includes({ 'text/plain':'Plain text', 'image/png':'PNG image', 'text/html':'Rich text (HTML)', 'text/rtf':'Rich text (RTF)' }[type]));
      assert.ok(bar.children[0].textContent.includes(summary.preview));
      if (summary.representations) assert.match(bar.children[0].textContent, /PNG image · 2.0 KiB · 1280 × 720 px/);
    }
  }
  clipboard.approve = async () => ({ skipped:true });
  prompts.add({ id:'empty', direction:'toLocal' });
  const empty = prompts.nodes.get('empty');
  await empty.children[1].onclick();
  assert.equal(empty.children.length, 1);
  assert.match(empty.children[0].textContent, /nothing synchronized/);

  const expired = { id:'expired', direction:'toLocal' };
  clipboard.dispatchEvent(new CustomEvent('offer', { detail:{ offer:expired, mode:'prompt' } }));
  clipboard.dispatchEvent(new CustomEvent('expired', { detail:{ offer:expired } }));
  assert.equal(prompts.root.children[0].dataset.state, 'expired');
  assert.equal(prompts.root.children[0].style.background, '#374151');
  assert.match(prompts.root.children[0].children[0].textContent, /Remote → Local/);
  prompts.destroy();
});
