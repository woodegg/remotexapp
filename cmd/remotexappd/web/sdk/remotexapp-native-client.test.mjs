import assert from 'node:assert/strict';
import test from 'node:test';
import { RemoteXAppNativeClient } from './remotexapp-native-client.js';

globalThis.CustomEvent ||= class extends Event { constructor(type,options) { super(type); this.detail = options?.detail; } };
globalThis.location = new URL('https://viewer.example.test/remotexapps/app/kiosk.html');

function fixture({ ready = true, frame = true, timeout = 200, clipboard = false, clipboardAutomatic = false, clipboardConditional = false, rich = false, richMode = 'rich-v1', componentRich = rich, componentLimit = richMode === 'rich-v2' ? 10485760 : 2097152, clipboardLogin, statistics = false, udp = false, turn = false, latency = false, udpLoss = false, controls = false, readOnly = false, reconnect = false, heartbeatIntervalMs, ownerDocument } = {}) {
  const state = { id:'app', displayProvider:'kasm', displayComponentDigest:'a'.repeat(64), sessionGeneration:3, sessionState:'running', applicationStatus:{ generation:3, state:ready ? 'ready' : 'starting' } };
  if (udp) state.nativeTransport={available:true,grantRequired:true,policy:'prefer-udp'};
  if (controls) state.nativeTransport={available:udp,grantRequired:true,policy:udp?'prefer-udp':'wss-only',readOnly:true};
  state.effectivePolicy={display:{allowClientResize:true}};
  const calls=[];
  const grantState={clipboardLogin};
  state.nativeClipboard = rich ? richMode : clipboard ? "text" : undefined;
  let display, reads = 0;
  class Display extends EventTarget {
    static capabilities = {programmaticInput:controls,displayControls:controls,readOnly:controls,keyboardPolicy:true,clipboardText:true,clipboardAutomatic,clipboardConditional,clipboardRich:componentRich,clipboardMaxBytes:componentRich?componentLimit:65536,statistics,udp,turn,latency,udpLoss};
    counters = {receivedBytes:100, sentBytes:20, bufferedBytes:0, renderedFrames:2, width:1024, height:768};
    getStats() { return this.counters; }
    sendText(text) {this.sent.push(text);return {status:'submitted',count:[...text].length};}
    sendKey(key,options) {this.sent.push({key,options});return {status:'submitted',count:1};}
    configureDisplay(options) {this.settings=options;return options;}
    flushResize() {return true;}
    probes = 0;
    measureLatency() {this.probes++;return true;}
    sent = [];
    sendClipboardText(text) { this.sent.push(text); }
    sendClipboard(items) { this.sent.push(items); }
    clipboardVersion = 1;
    get clipboardRevision() { return this.clipboardVersion.toString(16).padStart(16,'0'); }
    async submitClipboard(items, expected) {
      if(expected!==null&&expected!==this.clipboardRevision)throw Object.assign(Error('clipboard-conflict'),{code:'clipboard-conflict'});
      if(rich)this.sendClipboard(items);else this.sendClipboardText(new TextDecoder().decode(items[0].data));
      this.clipboardVersion++;return {revision:this.clipboardRevision};
    }
    keyboardPolicy = {profile:"unknown",mode:"local",bindings:[]};
    configureKeyboard(settings) { this.keyboardPolicy = settings;return true; }
    configureTransport(value) {this.preferUDP=value;}
    constructor(container,url,options) {
      super(); display = this; this.url = url; this.options=options; this.closed = 0;
      queueMicrotask(() => { this.dispatchEvent(new Event('connect')); if (frame) this.dispatchEvent(new Event('frame')); });
    }
    disconnect() { this.closed++; this.dispatchEvent(new Event('disconnect')); }
  }
  const manager = {
    url:path => path,
    getInstance:async () => { reads++; return structuredClone(state); },
    request:async (path,options) => {
      assert.equal(options.body.sessionGeneration,3);
      calls.push({path,options});
      if(path.endsWith('/grant')) return {token:'b'.repeat(64),expiresInMs:90000,renewAfterMs:20000,...grantState};
      if(path.endsWith('/lease') || path.endsWith('/revoke')) return {status:'ok'};
      assert.equal(path,'/remotexapps/app/native/prepare');
      return structuredClone(state);
    },
  };
  const viewer = new RemoteXAppNativeClient({ container:{ replaceChildren(){}, ownerDocument }, manager, timeout, readOnly, reconnect, heartbeatIntervalMs });
  viewer._loadDisplay = async () => ({ default:Display });
  return { viewer,state,calls,grantState,get display(){return display;},get reads(){return reads;} };
}

test('native ready needs current App and painted frame; dispose owns only one attachment', async () => {
  const f = fixture();
  await f.viewer.connect('app');
  assert.equal(f.viewer.state,'ready');
  assert.equal(f.display.url,'wss://viewer.example.test/remotexapps/app/native/websockify?sessionGeneration=3&componentDigest='+'a'.repeat(64));
  assert.equal(f.viewer.capabilities.udp,false);
  const old = f.display;
  await f.viewer.reconnect();
  assert.equal(old.closed,1);
  old.dispatchEvent(new Event('disconnect'));
  assert.equal(f.viewer.state,'ready');
  f.viewer.dispose(); f.viewer.dispose();
  assert.equal(f.display.closed,1);
  await assert.rejects(f.viewer.connect('app'),{ code:'disposed' });
});

test('protocol connect without paint or App readiness times out and disposes', async () => {
  for (const options of [{frame:false},{ready:false}]) {
    const f = fixture({ ...options, timeout:30 });
    await assert.rejects(f.viewer.connect('app'),{code:'timeout'});
    assert.equal(f.display.closed,1);
    assert.equal(f.viewer.state,'failed');
  }
});

test('late module import cannot create a Viewer after disposal or timeout', async () => {
  const f = fixture({timeout:30}); let release;
  f.viewer._loadDisplay = () => new Promise(resolve => { release = resolve; });
  await assert.rejects(f.viewer.connect('app'),{code:'timeout'});
  f.viewer.dispose();
  release({default:class { constructor(){throw new Error('late constructor');} }});
  await new Promise(resolve => setTimeout(resolve,10));
  assert.equal(f.viewer.state,'disposed');
});

test('stale generation, wrong provider and foreign origin fail before unsafe attachment', async () => {
  let f = fixture();
  f.state.displayProvider = 'tigervnc';
  await assert.rejects(f.viewer.connect('app'),{code:'provider-mismatch'});
  assert.equal(f.display,undefined);
  f = fixture(); f.viewer.manager.url = path => `https://foreign.example.test${path}`;
  f.viewer.manager.request = () => { throw new Error('foreign prepare must not run'); };
  await assert.rejects(f.viewer.connect('app'),{code:'origin'});
  f = fixture(); const load = f.viewer._loadDisplay;
  f.viewer._loadDisplay = (...args) => { f.state.sessionGeneration++; return load(...args); };
  await assert.rejects(f.viewer.connect('app'),{code:'stale-generation'});
  assert.equal(f.display.closed,1);
});

test('reconnect imports the exact new component instead of reusing a cached old module', async () => {
  const f = fixture(), urls = [], load = f.viewer._loadDisplay;
  f.viewer._loadDisplay = url => { urls.push(url); return load(url); };
  await f.viewer.connect('app');
  f.state.displayComponentDigest = 'b'.repeat(64);
  await f.viewer.reconnect();
  assert.notEqual(urls[0],urls[1]);
  assert.equal(new URL(urls[1]).searchParams.get('componentDigest'),f.state.displayComponentDigest);
  f.viewer.dispose();
});

function clipboardBrowser(t, values = {}) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis,'navigator'), oldDocument=globalThis.document;
  const browser={userActivation:{isActive:true},clipboard:{readText:async()=>'',writeText:async()=>{},...values}};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:browser});
  globalThis.document={hidden:false,hasFocus:()=>true};
  t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator;globalThis.document=oldDocument;});
  return browser;
}
test('clipboard requires capability, consent, gesture and focus; empty read differs from clear', async t => {
  let reads=0;const browser=clipboardBrowser(t,{readText:async()=>{reads++;return '';}});
  const disabled=fixture();await disabled.viewer.connect('app');assert.throws(()=>disabled.viewer.enableClipboard(),{code:'unsupported'});disabled.viewer.dispose();
  const f=fixture({clipboard:true});await f.viewer.connect('app');
  await assert.rejects(f.viewer.copyClipboardToRemote(),{code:'clipboard-cancelled'});
  f.viewer.enableClipboard();browser.userActivation.isActive=false;
  await assert.rejects(f.viewer.copyClipboardToRemote(),{code:'clipboard-gesture'});assert.equal(reads,0);
  browser.userActivation.isActive=true;document.hidden=true;
  await assert.rejects(f.viewer.copyClipboardToRemote(),{code:'clipboard-focus'});assert.equal(reads,0);document.hidden=false;
  assert.deepEqual(await f.viewer.copyClipboardToRemote(),{status:'empty-noop'});assert.deepEqual(f.display.sent,[]);
  assert.deepEqual(await f.viewer.clearRemoteClipboard(),{status:'submitted'});assert.deepEqual(f.display.sent,['']);
  f.viewer.dispose();
});
test('clipboard text is bounded, denial visible, and remote events never auto-write local data', async t => {
  let text='中文🙂',writes=[];const browser=clipboardBrowser(t,{readText:async()=>text,writeText:async value=>{writes.push(value);}});
  const f=fixture({clipboard:true});await f.viewer.connect('app');f.viewer.enableClipboard();
  await f.viewer.copyClipboardToRemote();assert.deepEqual(f.display.sent,[text]);
  text='x'.repeat(65537);await assert.rejects(f.viewer.copyClipboardToRemote(),{code:'clipboard-size'});
  text='x\0y';await assert.rejects(f.viewer.copyClipboardToRemote(),{code:'clipboard-format'});
  browser.clipboard.readText=async()=>{throw new DOMException('Denied','NotAllowedError');};
  await assert.rejects(f.viewer.copyClipboardToRemote(),{code:'clipboard-denied'});
  f.display.dispatchEvent(new CustomEvent('clipboard',{detail:{text:'remote'}}));assert.deepEqual(writes,[]);
  await f.viewer.copyClipboardToLocal();assert.deepEqual(writes,['remote']);
  f.viewer.dispose();
});
test('late local reads and retired offers cannot cross reconnect or revocation', async t => {
  let resolve;clipboardBrowser(t,{readText:()=>new Promise(r=>{resolve=r;})});
  const f=fixture({clipboard:true});await f.viewer.connect('app');f.viewer.enableClipboard();
  const old=f.display,pending=f.viewer.copyClipboardToRemote();
  await assert.rejects(f.viewer.copyClipboardToRemote(),{code:'clipboard-busy'});
  await f.viewer.reconnect();resolve('stale');await assert.rejects(pending,{code:'clipboard-cancelled'});
  assert.equal(f.viewer.clipboardEnabled,true);assert.deepEqual(old.sent,[]);assert.deepEqual(f.display.sent,[]);
  old.dispatchEvent(new CustomEvent('clipboard',{detail:{text:'stale'}}));
  f.viewer.enableClipboard();await assert.rejects(f.viewer.copyClipboardToLocal(),{code:'clipboard-empty'});
  const pendingRevoked=f.viewer.copyClipboardToRemote();f.viewer.enableClipboard(false);f.viewer.enableClipboard(true);resolve('stale again');
  await assert.rejects(pendingRevoked,{code:'clipboard-cancelled'});assert.deepEqual(f.display.sent,[]);f.viewer.dispose();
});
test('a local write racing retirement reports uncertainty and is never replayed', async t => {
  let resolve,writes=0;clipboardBrowser(t,{writeText:()=>{writes++;return new Promise(r=>{resolve=r;});}});
  const f=fixture({clipboard:true});await f.viewer.connect('app');f.viewer.enableClipboard();
  f.display.dispatchEvent(new CustomEvent('clipboard',{detail:{text:'remote'}}));
  const pending=f.viewer.copyClipboardToLocal();f.viewer.disconnect();resolve();
  await assert.rejects(pending,{code:'clipboard-uncertain'});assert.equal(writes,1);f.viewer.dispose();
});

test('concurrent ID connects may follow one stopped-session activation with unchanged pins', async () => {
  const f=fixture();f.state.sessionState='stopped';f.state.sessionGeneration=2;
  let calls=0;
  f.viewer.manager.request=async (_path,{body})=>{
    calls++;
    if(calls===1){assert.equal(body.sessionGeneration,2);f.state.sessionState='running';f.state.sessionGeneration=3;throw Object.assign(new Error('stale descriptor'),{status:409});}
    assert.equal(body.sessionGeneration,3);return structuredClone(f.state);
  };
  await f.viewer.connect('app');assert.equal(calls,2);assert.equal(f.viewer.state,'ready');f.viewer.dispose();
});
test('activation retry cannot follow explicit descriptors, upgrades, recovery or repeated conflicts', async () => {
  for(const scenario of ['descriptor','pin','core','policy','generation','running','repeat','cancel']){
    const f=fixture();f.state.sessionState=scenario==='running'?'running':'stopped';f.state.sessionGeneration=2;
    const descriptor=structuredClone(f.state);let calls=0;
    f.viewer.manager.request=async()=>{
      calls++;f.state.sessionState='running';f.state.sessionGeneration=scenario==='generation'?4:3;
      if(scenario==='pin')f.state.displayComponentDigest='b'.repeat(64);
      if(scenario==='core')f.state.versions={current:{core:{sha256:'changed'}}};
      if(scenario==='policy')f.state.nativeClipboard='text';
      if(scenario==='cancel')f.viewer.disconnect();
      throw Object.assign(new Error('conflict'),{status:409});
    };
    await assert.rejects(f.viewer.connect(scenario==='descriptor'?descriptor:'app'));
    assert.equal(calls,scenario==='repeat'?2:1,scenario);assert.equal(f.display,undefined);f.viewer.dispose();
  }
});


test('native statistics expose only per-connection counters and never poll the Manager', async () => {
  const f = fixture({statistics:true});
  assert.equal(f.viewer.getStats().available,false);
  await f.viewer.connect('app');
  const reads=f.reads, first=f.viewer.getStats();
  assert.equal(first.available,true);assert.equal(first.transport,'wss');
  assert.equal(first.receivedBytes,100);assert.equal(first.renderedFrames,2);
  f.display.counters.receivedBytes=120;f.display.counters.clipboard='private';
  const next=f.viewer.getStats();assert.equal(next.receivedBytes,120);
  assert.equal(first.receivedBytes,100);assert.equal(next.clipboard,undefined);
  assert(next.observedAt>=first.observedAt);assert(next.connectedForMs>=first.connectedForMs);
  assert.equal(f.reads,reads);
  const old=f.display;await f.viewer.reconnect();
  const fresh=f.viewer.getStats();assert(fresh.connectionEpoch>first.connectionEpoch);
  assert.equal(fresh.receivedBytes,100);
  old.counters.receivedBytes=999;old.dispatchEvent(new Event('disconnect'));
  assert.equal(f.viewer.getStats().state,'ready');assert.equal(f.viewer.getStats().receivedBytes,100);
  f.display.dispatchEvent(new Event('disconnect'));
  assert.equal(f.viewer.getStats().available,false);assert.equal(f.viewer.getStats().transport,null);
  assert.equal(f.viewer.getStats().code,'display-disconnected');
  f.viewer.dispose();assert.equal(f.viewer.getStats().state,'disposed');
});

test('old components and malformed statistics report unavailable instead of fabricated zeroes', async () => {
  const old=fixture();await old.viewer.connect('app');
  assert.equal(old.viewer.getStats().available,false);assert.equal(old.viewer.getStats().receivedBytes,undefined);old.viewer.dispose();
  const f=fixture({statistics:true});await f.viewer.connect('app');
  for(const value of [null,{}, {...f.display.counters,sentBytes:-1}, {...f.display.counters,width:NaN}, {...f.display.counters,receivedBytes:Infinity}]){
    f.display.counters=value;assert.equal(f.viewer.getStats().available,false);
  }
  f.viewer.dispose();
});


test('UDP uses a header grant, actual bytes/paint status, and per-Viewer preference',async()=>{
  const f=fixture({udp:true,statistics:true});await f.viewer.connect('app');
  assert.equal(f.viewer.capabilities.udp,true);
  assert.equal(f.display.options.udp,true);
  assert.deepEqual(f.display.options.protocols,['remotexapp-grant.'+'b'.repeat(64)]);
  assert.equal(f.display.url.includes('b'.repeat(64)),false);
  Object.assign(f.display.counters,{udpReceivedBytes:300,udpPackets:3,udpRectangles:0,screenTransport:'webrtc-udp',udpState:'udp'});
  assert.equal(f.viewer.getStats().transport,'wss');
  f.display.counters.udpRectangles=1;
  assert.equal(f.viewer.getStats().transport,'webrtc-udp');
  f.viewer.configureTransport(false);assert.equal(f.display.preferUDP,false);
  f.viewer.dispose();assert.equal(f.calls.at(-1).path,'/remotexapps/app/native/revoke');
});
test('TURN requires authorized relay credentials and displays only painted UDP', async t => {
  const credential = {urls:'turn:relay.example.test:3478?transport=udp',
    username:'1850000000:'+'a'.repeat(24), credential:'b'.repeat(27)+'='};
  for (const turn of [undefined, credential]) {
    await t.test(turn ? 'authenticated relay' : 'WSS fallback without credentials', async () => {
      const f=fixture({udp:true,turn:true,statistics:true});
      f.state.nativeTransport.mode='turn';
      const request=f.viewer.manager.request;
      f.viewer.manager.request=async (...args) => {
        const reply=await request(...args);
        return args[0].endsWith('/grant') ? {...reply,turn} : reply;
      };
      try {
        await f.viewer.connect('app');
        assert.equal(f.display.options.udp,!!turn);
        assert.deepEqual(f.display.options.turnServers,turn ? [turn] : null);
        assert.equal(f.viewer.getStats().transport,'wss');
        assert.equal(f.viewer.getStats().webRTCPath,undefined);
        Object.assign(f.display.counters,{udpReceivedBytes:500,udpPackets:4,udpRectangles:3,screenTransport:'webrtc-udp'});
        assert.equal(f.viewer.getStats().webRTCPath,turn ? 'turn' : undefined);
        assert.equal(f.display.url.includes(credential.username),false);
      } finally {
        f.viewer.dispose();
      }
    });
  }
});
test('lease network failure reconnects with a new grant and unchanged App identity', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const f = fixture({udp:true, controls:true, reconnect:{maxAttempts:2,delays:[1]}});
  t.after(() => f.viewer.dispose());
  f.state.state = 'ready';
  const request = f.viewer.manager.request;
  let grants = 0;
  f.viewer.manager.request = async (path, options) => {
    if (path.endsWith('/lease')) throw new TypeError('Failed to fetch');
    const value = await request(path, options);
    return path.endsWith('/grant') ? {...value, token:(grants++ ? 'c' : 'b').repeat(64)} : value;
  };
  await f.viewer.connect('app');
  const old = f.display, epoch = f.viewer.getStats().connectionEpoch;
  f.viewer.sendText('do not replay');
  await exhaustRenewal(t);
  assert.equal(old.closed, 1);
  assert.equal(f.viewer.state, 'reconnecting');
  assert.throws(() => f.viewer.sendText('offline'), {code:'input-unavailable'});
  t.mock.timers.tick(1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.viewer.state, 'ready');
  assert.equal(f.viewer.instance.sessionGeneration, 3);
  assert(f.viewer.getStats().connectionEpoch > epoch);
  assert.equal(grants, 2);
  assert.equal(f.viewer.getStats().lastDisconnect.code,'lease-unavailable');
  assert.notEqual(f.viewer.getStats().lastDisconnect.recoveredAt,undefined);
  assert.deepEqual(f.display.options.protocols, ['remotexapp-grant.'+'c'.repeat(64)]);
  assert.deepEqual(f.display.sent, []);
  assert.equal(f.calls.filter(c => c.path.endsWith('/prepare')).length, 2);
  assert.equal(f.calls.filter(c => c.path.endsWith('/revoke')).length, 1);
});

const settleLease = () => new Promise(resolve => setImmediate(resolve));
async function exhaustRenewal(t) {
  for (const delay of [20000,1000,2000]) { t.mock.timers.tick(delay); await settleLease(); }
}
async function leaseFailure(t, cause, reconnect = {maxAttempts:2,delays:[1]}) {
  t.mock.timers.enable({apis:['setTimeout']});
  const f = fixture({udp:true, controls:true, clipboard:true, reconnect});
  t.after(() => f.viewer.dispose());
  f.state.state = 'ready';
  const request = f.viewer.manager.request;
  f.viewer.manager.request = async (path, options) => {
    if (path.endsWith('/lease')) throw cause;
    return request(path, options);
  };
  await f.viewer.connect('app');
  f.old = f.display;
  return f;
}

test('transient lease service errors use bounded reconnect', async t => {
  for (const status of [0,429,500,502,503,504]) await t.test(String(status), async t => {
    const f = await leaseFailure(t, Object.assign(Error('temporarily unavailable'), {status}));
    await exhaustRenewal(t);
    assert.equal(f.viewer.state, 'reconnecting');
    t.mock.timers.tick(1); await settleLease();
    assert.equal(f.viewer.state, 'ready');
    assert.equal(f.old.closed, 1);
    assert.equal(f.calls.filter(c => c.path.endsWith('/grant')).length, 2);
  });
});

test('one transient renewal failure keeps the grant, Viewer epoch and clipboard consent', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const f = fixture({reconnect:true,clipboard:true,udp:true});
  t.after(()=>f.viewer.dispose());
  const request=f.viewer.manager.request;
  let renewals=0;
  f.viewer.manager.request=async(path,options)=>{
    if(path.endsWith('/lease')&&++renewals===1) throw Object.assign(Error('busy'),{status:503});
    return request(path,options);
  };
  await f.viewer.connect('app');
  const epoch=f.viewer.getStats().connectionEpoch;
  const display=f.display;
  f.viewer.enableClipboard(true);
  t.mock.timers.tick(20000);await settleLease();
  assert.equal(f.viewer.state,'ready');
  assert.equal(renewals,1);
  t.mock.timers.tick(1000);await settleLease();
  assert.equal(renewals,2);
  assert.equal(f.viewer.getStats().connectionEpoch,epoch);
  assert.equal(f.viewer.getStats().lastDisconnect,undefined);
  assert.equal(f.viewer.clipboardEnabled,true);
  assert.equal(display.closed,0);
});

test('lease authorization, revocation and generation rejection never obtain another grant', async t => {
  for (const status of [400,401,403,404,409,422]) await t.test(String(status), async t => {
    const f = await leaseFailure(t, Object.assign(Error('rejected'), {status}));
    t.mock.timers.tick(20000); await settleLease();
    assert.equal(f.viewer.state, 'failed');
    assert.equal(f.viewer.getStats().code, 'grant-expired');
    t.mock.timers.tick(60000); await settleLease();
    assert.equal(f.old.closed, 1);
    assert.equal(f.calls.filter(c => c.path.endsWith('/grant')).length, 1);
    assert.equal(f.viewer._reconnect.timer, null);
  });
});

test('lease recovery rechecks authentication and generation before requesting a fresh grant', async t => {
  for (const condition of ['unauthorized','forbidden','generation','component','stopped','veto']) await t.test(condition, async t => {
    const f = await leaseFailure(t, new TypeError('offline'));
    const events = [];
    f.viewer.addEventListener('reconnectstopped', e => events.push(e.detail));
    await exhaustRenewal(t);
    if (condition === 'unauthorized' || condition === 'forbidden')
      f.viewer.manager.getInstance = async () => { throw Object.assign(Error('denied'), {status:condition === 'unauthorized' ? 401 : 403}); };
    if (condition === 'generation') f.state.sessionGeneration++;
    if (condition === 'component') f.state.displayComponentDigest = 'c'.repeat(64);
    if (condition === 'stopped') f.state.sessionState = 'stopped';
    if (condition === 'veto') f.state.shutdown = {state:'blocked'};
    t.mock.timers.tick(1); await settleLease();
    t.mock.timers.tick(60000); await settleLease();
    assert.equal(events.length, 1);
    assert.equal(f.viewer.state, 'disconnected');
    assert.equal(f.calls.filter(c => c.path.endsWith('/grant')).length, 1);
  });
});

test('lease recovery exhausts its budget and explicit reconnect starts a fresh connection', async t => {
  const f = await leaseFailure(t, new TypeError('offline'));
  const read = f.viewer.manager.getInstance, events = [];
  let attempts = 0;
  f.viewer.addEventListener('reconnectexhausted', e => events.push(e.detail));
  f.viewer.manager.getInstance = async () => { attempts++; throw new TypeError('offline'); };
  await exhaustRenewal(t);
  for (let i = 0; i < 2; i++) { t.mock.timers.tick(1); await settleLease(); }
  t.mock.timers.tick(60000); await settleLease();
  assert.equal(attempts, 2);
  assert.equal(events.length, 1);
  assert.equal(f.viewer.getStats().code, 'reconnect-exhausted');
  assert.equal(f.viewer._reconnect.timer, null);
  f.viewer.manager.getInstance = read;
  await f.viewer.reconnect();
  assert.equal(f.viewer.state, 'ready');
  assert.equal(f.calls.filter(c => c.path.endsWith('/grant')).length, 2);
});

test('lease transport failure respects disabled automatic reconnect', async t => {
  const f = await leaseFailure(t, new TypeError('offline'), false);
  await exhaustRenewal(t);
  assert.equal(f.viewer.state, 'disconnected');
  assert.equal(f.viewer.getStats().code, 'lease-unavailable');
  t.mock.timers.tick(60000); await settleLease();
  assert.equal(f.calls.filter(c => c.path.endsWith('/grant')).length, 1);
  await f.viewer.reconnect(); assert.equal(f.viewer.state, 'ready');
});

test('disconnect, dispose and runtime release cancel a pending lease reconnect', async t => {
  for (const action of ['disconnect','dispose','release','state-listener']) await t.test(action, async t => {
    const f = await leaseFailure(t, new TypeError('offline'));
    const runtime = new EventTarget();
    Object.assign(runtime, {manager:f.viewer.manager,state:'tracking',instanceId:'app',sessionGeneration:3});
    f.viewer.bindRuntime(runtime);
    if (action === 'state-listener') f.viewer.addEventListener('statechange', e => {
      if (e.detail.code === 'lease-unavailable') f.viewer.disconnect();
    });
    await exhaustRenewal(t);
    if (action === 'disconnect' || action === 'dispose') f.viewer[action]();
    if (action === 'release') { runtime.state = 'released'; runtime.dispatchEvent(new Event('release')); }
    t.mock.timers.tick(60000); await settleLease();
    assert.equal(f.calls.filter(c => c.path.endsWith('/grant')).length, 1);
    assert.equal(f.viewer._reconnect.timer, null);
    assert.equal(f.viewer._grantTimer, null);
  });
});

test('late lease rejection cannot retire a manually replaced Viewer', async t => {
  const f = await leaseFailure(t, new TypeError('offline'));
  const request = f.viewer.manager.request;
  let reject;
  f.viewer.manager.request = (path, options) => path.endsWith('/lease')
    ? new Promise((resolve, fail) => { reject = fail; }) : request(path, options);
  t.mock.timers.tick(20000); await settleLease();
  assert.equal(typeof reject, 'function');
  await f.viewer.reconnect();
  const replacement = f.display, epoch = f.viewer.getStats().connectionEpoch;
  reject(new TypeError('late network error')); await settleLease();
  assert.equal(f.viewer.state, 'ready'); assert.equal(f.display, replacement);
  assert.equal(f.viewer.getStats().connectionEpoch, epoch);
  assert.equal(replacement.closed, 0);
});

test('lease HTTP request has a ten-second deadline and a timeout preserves a healthy Viewer during retry', async t => {
  const f = await leaseFailure(t, new TypeError('offline'));
  const deadline = new AbortController();
  t.mock.method(AbortSignal, 'timeout', ms => { assert.equal(ms, 10000); return deadline.signal; });
  const request = f.viewer.manager.request;
  let signal;
  f.viewer.manager.request = (path, options) => {
    if (!path.endsWith('/lease')) return request(path, options);
    signal = options.signal;
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once:true}));
  };
  t.mock.timers.tick(20000); await settleLease();
  assert.equal(signal.aborted, false);
  deadline.abort(new DOMException('Lease request timed out', 'TimeoutError')); await settleLease();
  assert.equal(signal.aborted, true);
  assert.equal(f.viewer.state, 'ready'); assert.equal(f.old.closed, 0);
});

test('one Viewer lease failure preserves clipboard intent and leaves a second Viewer ready', async t => {
  const f = await leaseFailure(t, new TypeError('offline'));
  const other = fixture({udp:true, controls:true}); t.after(() => other.viewer.dispose());
  await other.viewer.connect('app');
  f.viewer.enableClipboard(true);
  await exhaustRenewal(t);
  assert.equal(f.viewer.clipboardEnabled, false);
  assert.equal(other.viewer.state, 'ready'); assert.equal(other.display.closed, 0);
  other.viewer.sendText('other remains usable');
  t.mock.timers.tick(1); await settleLease();
  assert.equal(f.viewer.state, 'ready'); assert.equal(f.viewer.clipboardEnabled, true);
  assert.deepEqual(f.display.sent, []);
});

test('UDP renewal failure retires the display and does not renew a replacement',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture({udp:true});await f.viewer.connect('app');
  const old=f.display;
  const request=f.viewer.manager.request;
  f.viewer.manager.request=async(path,options)=>{if(path.endsWith('/lease'))throw Object.assign(Error('authorization lost'), {status:403});return request(path,options);};
  t.mock.timers.tick(20000);
  await new Promise(resolve=>queueMicrotask(resolve));await new Promise(resolve=>queueMicrotask(resolve));
  assert.equal(f.viewer.state,'failed');assert.equal(old.closed,1);
  assert.equal(f.viewer.getStats().code,'grant-expired');f.viewer.dispose();
});

test('RTT samples are capability-gated, content-free and reset on reconnect', async () => {
  const old=fixture({statistics:true});await old.viewer.connect('app');assert.equal(old.viewer.measureLatency(),false);old.viewer.dispose();
  const f=fixture({statistics:true,udp:true,latency:true});assert.equal(f.viewer.measureLatency(),false);await f.viewer.connect('app');
  Object.assign(f.display.counters,{udpReceivedBytes:5,udpPackets:1,udpRectangles:1,latency:{
    wss:{state:'ready',rttMs:0,ageMs:2,token:'must-not-leak'},udp:{state:'stale',ageMs:12000,candidates:['must-not-leak']}}});
  assert.deepEqual(f.viewer.getStats().latency,{wss:{state:'ready',rttMs:0,ageMs:2},udp:{state:'stale',ageMs:12000}});
  assert.equal(f.display.probes,0);assert.equal(f.viewer.measureLatency(),true);assert.equal(f.display.probes,1);
  for (const raw of [null,{state:'bad'},{state:'ready',rttMs:NaN,ageMs:0},{state:'ready',rttMs:1,ageMs:-1}]) {
    f.display.counters.latency={wss:raw,udp:raw};assert.equal(f.viewer.getStats().latency.wss.state,'unavailable');
  }
  for (const state of ['waiting','pending','timeout','inactive','unavailable']) {
    f.display.counters.latency={wss:{state,extra:'private'}};assert.deepEqual(f.viewer.getStats().latency.wss,{state});
  }
  await f.viewer.reconnect();assert.deepEqual(f.viewer.getStats().latency.wss,{state:'unavailable'});
  f.viewer.disconnect();assert.equal(f.viewer.getStats().latency,undefined);assert.equal(f.viewer.measureLatency(),false);f.viewer.dispose();
});

test('native heartbeat defaults to 15 seconds and retires with its Viewer connection', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const f = fixture({latency:true});
  assert.equal(f.viewer.heartbeatIntervalMs, 15000);
  t.mock.timers.tick(15000);
  await f.viewer.connect('app');
  const old = f.display;
  t.mock.timers.tick(14999);
  assert.equal(old.probes, 0);
  t.mock.timers.tick(1);
  assert.equal(old.probes, 1);

  old.dispatchEvent(new Event('disconnect'));
  t.mock.timers.tick(45000);
  assert.equal(old.probes, 1);
  await f.viewer.connect('app');
  t.mock.timers.tick(15000);
  assert.equal(f.display.probes, 1);
  f.viewer.dispose();
  t.mock.timers.tick(45000);
  assert.equal(f.display.probes, 1);
  assert.equal(old.probes, 1);
});

test('native heartbeat honors a per-Viewer interval, opt-out, and component support', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  for (const heartbeatIntervalMs of [-1, 4999, 15000.5, 2147483648, '15000', null]) {
    assert.throws(() => fixture({heartbeatIntervalMs}), /heartbeatIntervalMs/);
  }
  const fast = fixture({latency:true,heartbeatIntervalMs:5000});
  const slow = fixture({latency:true,heartbeatIntervalMs:20000});
  const disabled = fixture({latency:true,heartbeatIntervalMs:0});
  const old = fixture({latency:false,heartbeatIntervalMs:5000});
  const viewers = [fast, slow, disabled, old];
  for (const f of viewers) await f.viewer.connect('app');
  t.mock.timers.tick(5000);
  assert.deepEqual(viewers.map(f => f.display.probes), [1,0,0,0]);
  disabled.viewer.getStats();
  assert.equal(disabled.display.probes, 0);
  assert.equal(disabled.viewer.measureLatency(), true);
  for (let i = 0; i < 3; i++) t.mock.timers.tick(5000);
  assert.deepEqual(viewers.map(f => f.display.probes), [4,1,1,0]);
  for (const f of viewers) f.viewer.dispose();
});

test('native heartbeat sends one overdue probe when the document wakes', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const ownerDocument = Object.assign(new EventTarget(), {visibilityState:'hidden',defaultView:new EventTarget()});
  const f = fixture({latency:true,ownerDocument});
  await f.viewer.connect('app');

  now = 60000;
  ownerDocument.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.display.probes, 0);
  ownerDocument.visibilityState = 'visible';
  ownerDocument.dispatchEvent(new Event('visibilitychange'));
  ownerDocument.defaultView.dispatchEvent(new Event('pageshow'));
  ownerDocument.defaultView.dispatchEvent(new Event('online'));
  assert.equal(f.display.probes, 1);

  now = 75000;
  t.mock.timers.tick(15000);
  assert.equal(f.display.probes, 2);
  f.viewer.dispose();
  now = 120000;
  ownerDocument.defaultView.dispatchEvent(new Event('online'));
  t.mock.timers.tick(45000);
  assert.equal(f.display.probes, 2);
});

test('UDP block loss validates counts, stays passive, gates old components and clears on reconnect', async () => {
  const old=fixture({statistics:true,udp:true});await old.viewer.connect('app');
  assert.equal(old.viewer.capabilities.udpLoss,false);assert.equal(old.viewer.getStats().udpLoss,undefined);old.viewer.dispose();
  const f=fixture({statistics:true,udp:true,udpLoss:true});await f.viewer.connect('app');
  const loss={state:'ready',scope:'display-blocks',windowMs:10000,settleMs:2000,
    receivedBlocks:8,lostBlocks:2,expectedBlocks:10,ratio:999,ageMs:20,privateAddress:'must-not-escape'};
  Object.assign(f.display.counters,{udpReceivedBytes:10,udpPackets:1,udpRectangles:1,udpLoss:loss});
  const calls=f.calls.length,s=f.viewer.getStats().udpLoss;
  assert.equal(s.ratio,.2);assert.equal(s.privateAddress,undefined);assert.equal(f.calls.length,calls);assert.equal(f.display.probes,0);
  for(const bad of [{expectedBlocks:9},{lostBlocks:-1},{receivedBlocks:NaN},{ageMs:10000},{windowMs:20},{scope:'packets'},{state:'made-up'}]){
    f.display.counters.udpLoss={...loss,...bad};assert.equal(f.viewer.getStats().udpLoss.state,'unavailable');
  }
  for(const state of ['waiting','stale','inactive','unavailable']){
    f.display.counters.udpLoss={...loss,state};assert.deepEqual(f.viewer.getStats().udpLoss,{state});
  }
  f.viewer.disconnect();assert.equal(f.viewer.getStats().udpLoss,undefined);
  await f.viewer.connect('app');assert.equal(f.viewer.getStats().udpLoss.state,'inactive');f.viewer.dispose();
});


test('public directional configuration, native paste callback and reset are connection-scoped',async t=>{
  clipboardBrowser(t);
  navigator.permissions={query:async()=>({state:'granted'})};
  navigator.locks={request:async(name,options,fn)=>fn({})};
  navigator.clipboard.readText=async()=> 'fresh paste';
  const f=fixture({clipboard:true,clipboardAutomatic:true});await f.viewer.connect('app');t.after(()=>f.viewer.dispose());
  await f.viewer.configureClipboard({toRemote:'auto',toLocal:'off'});
  assert.equal(f.viewer.getClipboardState().effective.toRemote,'manual');
  assert.equal(f.viewer.getClipboardState().ordering,'unsupported');
  f.viewer.focus();assert.equal(await f.display.options.prepareClipboardPaste(),true);
  assert.deepEqual(f.display.sent,['fresh paste']);
  await assert.rejects(f.viewer.copyClipboardToLocal(),{code:'clipboard-disabled'});
  const retired=f.display;await f.viewer.reconnect();
  assert.deepEqual(f.viewer.getClipboardState().requested,{toRemote:'auto',toLocal:'off'});
  assert.throws(()=>retired.options.prepareClipboardPaste(),{name:'AbortError'});
  f.viewer.enableClipboard();assert.equal(f.viewer.getClipboardState().requested.toRemote,'manual');
  f.viewer.resetClipboard();assert.equal(f.viewer.clipboardEnabled,false);
});

test('manual calls respect another tab clipboard lock without starting a browser write',async t=>{
  clipboardBrowser(t);navigator.locks={request:async(name,options,fn)=>fn(null)};
  let writes=0;navigator.clipboard.writeText=async()=>{writes++;};
  const f=fixture({clipboard:true});await f.viewer.connect('app');t.after(()=>f.viewer.dispose());f.viewer.enableClipboard();
  f.display.dispatchEvent(new CustomEvent('clipboard',{detail:{text:'remote'}}));
  await assert.rejects(f.viewer.copyClipboardToLocal(),{code:'clipboard-busy'});assert.equal(writes,0);
});

test('ordered native capability exposes automatic upload and commits a manual admission revision',async t=>{
  clipboardBrowser(t,{readText:async()=> 'fresh chosen source'});
  navigator.permissions={query:async()=>({state:'granted'})};navigator.locks={request:async(_name,_options,fn)=>fn({})};
  const f=fixture({clipboard:true,clipboardAutomatic:true,clipboardConditional:true});
  await f.viewer.connect('app');t.after(()=>f.viewer.dispose());
  await f.viewer.configureClipboard({toRemote:'auto',toLocal:'auto'});f.viewer.focus();await f.viewer._clipboardSync.sync();
  assert.equal(f.viewer.capabilities.clipboardConditional,true);assert.equal(f.viewer.getClipboardState().effective.toRemote,'auto');
  assert.equal(f.viewer.getClipboardState().ordering,'ready');
  assert.deepEqual(await f.viewer.copyClipboardToRemote(),{status:'submitted'});
  assert.deepEqual(f.display.sent,['fresh chosen source']);
  assert.equal(f.viewer._clipboardSync.baselineRemoteRevision,f.display.clipboardRevision);
});


test('rich capability is pinned; old descriptors retain their text limit even with a newer adapter',async t=>{
  clipboardBrowser(t);
  for(const [options,enabled,limit] of [
    [{rich:true},true,2097152], [{rich:true,richMode:'rich-v2'},true,10485760],
    [{rich:true,componentLimit:10485760},false,0], [{rich:true,richMode:'rich-v2',componentLimit:2097152},false,0],
    [{rich:true,componentRich:false},false,0], [{clipboard:true,componentRich:true},true,65536],
  ]) {
    const f=fixture(options);await f.viewer.connect('app');
    assert.equal(f.viewer.capabilities.clipboard,enabled);assert.equal(f.viewer.capabilities.clipboardMaxBytes,limit);
    assert.equal(f.viewer.capabilities.clipboardRich,enabled&&options.rich===true);
    f.viewer.dispose();
  }
});
test('rich native metadata contains size only and unsupported remote offers cannot replace it',async t=>{
  clipboardBrowser(t);const f=fixture({rich:true});await f.viewer.connect('app');t.after(()=>f.viewer.dispose());f.viewer.enableClipboard();
  const events=[];f.viewer.addEventListener('clipboardchange',e=>events.push(e.detail));
  f.display.dispatchEvent(new CustomEvent('clipboard',{detail:{items:[{type:'text/html',data:new TextEncoder().encode('<b>private payload</b>')}]}}));
  assert.deepEqual(events.at(-1),{enabled:true,available:true,bytes:22});
  assert.equal(JSON.stringify(events).includes('private'),false);
  const count=events.length;f.display.dispatchEvent(new CustomEvent('clipboard',{detail:{items:[{type:'text/uri-list',data:Uint8Array.of(97)}]}}));
  assert.equal(events.length,count);
  await assert.rejects(f.viewer.copyClipboardToLocal(),{code:'clipboard-format'});
  assert.equal((await f.viewer.clearRemoteClipboard()).status,'submitted');assert.equal(f.display.sent.at(-1)[0].type,'text/plain');assert.equal(f.display.sent.at(-1)[0].data.length,0);
});


test('native input receipts identify the current target and reject cancellation and stale owners',async()=>{
  const f=fixture({controls:true});await f.viewer.connect('app');
  const receipt=f.viewer.sendText('中文😀',{requestId:'input-1'});
  assert.deepEqual(receipt,{status:'submitted',count:3,instanceId:'app',sessionGeneration:3,connectionEpoch:f.viewer.getStats().connectionEpoch,requestId:'input-1'});
  f.viewer.sendKey('ArrowLeft',{modifiers:['Control']});
  assert.equal(f.display.sent.length,2);
  const abort=new AbortController();abort.abort();
  assert.throws(()=>f.viewer.sendText('cancel',{signal:abort.signal}),{name:'AbortError'});
  assert.throws(()=>f.viewer.sendText('bad',{requestId:'contains spaces'}),TypeError);
  assert.equal(f.display.sent.length,2);
  f.viewer.disconnect();assert.throws(()=>f.viewer.sendText('late'),{code:'input-unavailable'});
  f.viewer.dispose();
});
test('readonly is immutable and requires both the server grant and native capability',async()=>{
  const f=fixture({controls:true,readOnly:true,clipboard:true});await f.viewer.connect('app');
  assert.equal(f.calls.find(c=>c.path.endsWith('/grant')).options.body.readOnly,true);
  assert.equal(f.display.options.readOnly,true);
  assert.equal(f.viewer.capabilities.pointer,false);assert.equal(f.viewer.capabilities.clipboard,false);
  assert.throws(()=>f.viewer.sendKey('Enter'),{code:'input-unavailable'});
  assert.throws(()=>f.viewer.configureDisplay({resize:true}),{code:'unsupported'});
  assert.throws(()=>{f.viewer.readOnly=false;},TypeError);f.viewer.dispose();
  const unsupported=fixture({readOnly:true});await assert.rejects(unsupported.viewer.connect('app'),{code:'unsupported'});unsupported.viewer.dispose();
});
test('display configuration is capability-gated and restored on reconnect',async()=>{
  const f=fixture({controls:true});await f.viewer.connect('app');
  assert.deepEqual(f.viewer.configureDisplay({scale:false,resize:true}),{scale:false,resize:true});
  assert.equal(f.viewer.flushResize(),true);
  assert.throws(()=>f.viewer.configureDisplay({scale:1}),TypeError);
  await f.viewer.reconnect();assert.deepEqual(f.display.settings,{scale:false,resize:true});
  f.viewer.dispose();assert.equal(f.viewer.flushResize(),false);
});
test('runtime handle release cancels reconnect and never releases the shared handle itself',async()=>{
  const f=fixture({reconnect:{maxAttempts:2,delays:[20]}});
  const runtime=new EventTarget();Object.assign(runtime,{manager:f.viewer.manager,state:'tracking',instanceId:'app',sessionGeneration:3});
  f.viewer.bindRuntime(runtime);await f.viewer.connect('app');
  const old=f.display;old.dispatchEvent(new Event('disconnect'));
  assert.equal(f.viewer.state,'reconnecting');
  runtime.state='released';runtime.dispatchEvent(new Event('release'));
  await new Promise(resolve=>setTimeout(resolve,35));
  assert.equal(f.viewer.state,'disconnected');assert.equal(f.display,old);
  await assert.rejects(f.viewer.connect('app'),{code:'stale-generation'});f.viewer.dispose();
});
test('real client retry fetches the current generation and reattaches once',async()=>{
  const f=fixture({reconnect:{maxAttempts:2,delays:[1]}});await f.viewer.connect('app');
  f.state.state='ready';const old=f.display;
  const ready=new Promise(resolve=>f.viewer.addEventListener('reconnected',resolve,{once:true}));
  old.dispatchEvent(new Event('disconnect'));await ready;
  assert.equal(f.viewer.state,'ready');assert.notEqual(f.display,old);f.viewer.dispose();
});

test('same-Viewer reconnect without a login header restores intent and accepts only fresh focused offers',async t=>{
  clipboardBrowser(t);
  navigator.permissions={query:async()=>({state:'granted'})};
  navigator.locks={request:async(_,options,fn)=>fn({})};
  const writes=[];
  navigator.clipboard.readText=async()=> 'local baseline';
  navigator.clipboard.writeText=async value=>writes.push(value);
  const f=fixture({clipboard:true,clipboardAutomatic:true,controls:true,clipboardLogin:undefined});
  await f.viewer.connect('app');t.after(()=>f.viewer.dispose());
  await f.viewer.configureClipboard({toRemote:'off',toLocal:'auto'});
  const retired=f.display;
  retired.dispatchEvent(new CustomEvent('clipboard',{detail:{text:'retire this'}}));
  await f.viewer.reconnect();
  assert.deepEqual(f.viewer.getClipboardState().requested,{toRemote:'off',toLocal:'auto'});
  assert.equal(f.viewer.getClipboardState().active,false);
  f.viewer.focus();
  await f.viewer._clipboardSync.sync();
  f.display.dispatchEvent(new CustomEvent('clipboard',{detail:{text:'new offer'}}));
  await f.viewer._clipboardSync.sync();
  assert.deepEqual(writes,['new offer']);
  f.grantState.clipboardLogin='d'.repeat(64);
  await f.viewer.reconnect();
  assert.deepEqual(f.viewer.getClipboardState().requested,{toRemote:'off',toLocal:'off'});
});

test('manual clipboard admission is distinct from verified delivery and never prompts for a new read permission',async t=>{
 let text='',reads=0;clipboardBrowser(t,{writeText:async value=>{text=value;},readText:async()=>{reads++;return text;}});
 const f=fixture({clipboard:true});await f.viewer.connect('app');f.viewer.enableClipboard();
 f.display.dispatchEvent(new CustomEvent('clipboard',{detail:{text:'remote'}}));
 assert.deepEqual(await f.viewer.copyClipboardToLocal(),{status:'write-accepted'});assert.equal(reads,0);
 f.viewer._clipboardSync.permissions.read='granted';
 assert.deepEqual(await f.viewer.copyClipboardToLocal(),{status:'copied-to-local'});assert.equal(reads,1);
 f.viewer.dispose();
});

test('unverified manual readback keeps an uncertain phase and does not replay the write',async t=>{
 let writes=0;clipboardBrowser(t,{writeText:async()=>{writes++;},readText:async()=>''});
 const f=fixture({clipboard:true});await f.viewer.connect('app');f.viewer.enableClipboard();f.viewer._clipboardSync.permissions.read='granted';
 f.display.dispatchEvent(new CustomEvent('clipboard',{detail:{text:'fresh'}}));
 await assert.rejects(f.viewer.copyClipboardToLocal(),{code:'clipboard-uncertain'});
 assert.equal(f.viewer.getClipboardState().phase,'clipboard-uncertain');assert.equal(f.viewer._clipboardSync.conflict,true);
 assert.equal(writes,1);assert.equal(f.viewer.getClipboardState().requested.toLocal,'manual');f.viewer.dispose();
});

test('a clipboard lock callback arriving after timeout cannot start a browser write',async t=>{
 let delayed,writes=0,expire;const nav=clipboardBrowser(t,{writeText:async()=>{writes++;}});
 nav.locks={request:(_name,_options,fn)=>new Promise(resolve=>{delayed=()=>Promise.resolve().then(()=>fn({})).then(resolve);})};
 const f=fixture({clipboard:true});await f.viewer.connect('app');f.viewer.enableClipboard();
 f.display.dispatchEvent(new CustomEvent('clipboard',{detail:{text:'fresh'}}));
 const set=globalThis.setTimeout;
 globalThis.setTimeout=(fn,ms,...args)=>ms===5000?(expire=fn,0):set(fn,ms,...args);
 try {
  const pending=f.viewer.copyClipboardToLocal();assert(expire);expire();
  await assert.rejects(pending,{code:'clipboard-timeout'});
  await assert.rejects(delayed(),{code:'clipboard-cancelled'});assert.equal(writes,0);
 } finally {globalThis.setTimeout=set;f.viewer.dispose();}
});
