import assert from 'node:assert/strict';
import test from 'node:test';
import { RemoteXAppNativeClient } from './remotexapp-native-client.js';

globalThis.CustomEvent ||= class extends Event { constructor(type,options) { super(type); this.detail = options?.detail; } };
globalThis.location = new URL('https://viewer.example.test/remotexapps/app/kiosk.html');

function fixture({ ready = true, frame = true, timeout = 200, clipboard = false, statistics = false, udp = false, latency = false, udpLoss = false } = {}) {
  const state = { id:'app', displayProvider:'kasm', displayComponentDigest:'a'.repeat(64), sessionGeneration:3, sessionState:'running', applicationStatus:{ generation:3, state:ready ? 'ready' : 'starting' } };
  if (udp) state.nativeTransport={available:true,grantRequired:true,policy:'prefer-udp'};
  const calls=[];
  state.nativeClipboard = clipboard ? "text" : undefined;
  let display, reads = 0;
  class Display extends EventTarget {
    static capabilities = {keyboardPolicy:true,clipboardText:true,clipboardMaxBytes:65536,statistics,udp,latency,udpLoss};
    counters = {receivedBytes:100, sentBytes:20, bufferedBytes:0, renderedFrames:2, width:1024, height:768};
    getStats() { return this.counters; }
    probes = 0;
    measureLatency() {this.probes++;return true;}
    sent = [];
    sendClipboardText(text) { this.sent.push(text); }
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
      if(path.endsWith('/grant')) return {token:'b'.repeat(64),expiresInMs:90000,renewAfterMs:20000};
      if(path.endsWith('/lease') || path.endsWith('/revoke')) return {status:'ok'};
      assert.equal(path,'/remotexapps/app/native/prepare');
      return structuredClone(state);
    },
  };
  const viewer = new RemoteXAppNativeClient({ container:{ replaceChildren(){} }, manager, timeout });
  viewer._loadDisplay = async () => ({ default:Display });
  return { viewer,state,calls,get display(){return display;},get reads(){return reads;} };
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
  assert.equal(f.viewer.clipboardEnabled,false);assert.deepEqual(old.sent,[]);assert.deepEqual(f.display.sent,[]);
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
test('UDP renewal failure retires the display and does not renew a replacement',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture({udp:true});await f.viewer.connect('app');
  const old=f.display;
  const request=f.viewer.manager.request;
  f.viewer.manager.request=async(path,options)=>{if(path.endsWith('/lease'))throw Error('authorization lost');return request(path,options);};
  t.mock.timers.tick(20000);
  await new Promise(resolve=>queueMicrotask(resolve));await new Promise(resolve=>queueMicrotask(resolve));
  assert.equal(f.viewer.state,'failed');assert.equal(old.closed,1);
  assert.equal(f.viewer.getStats().code,'grant-expired');f.viewer.dispose();
});

test('RTT sampling is explicit, capability-gated, content-free and reset on reconnect', async () => {
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
