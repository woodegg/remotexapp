import assert from 'node:assert/strict';
import test from 'node:test';
import { RemoteXAppNativeClient } from './remotexapp-native-client.js';

globalThis.CustomEvent ||= class extends Event { constructor(type,options) { super(type); this.detail = options?.detail; } };
globalThis.location = new URL('https://viewer.example.test/remotexapps/app/kiosk.html');

function fixture({ ready = true, frame = true, timeout = 200, clipboard = false } = {}) {
  const state = { id:'app', displayProvider:'kasm', displayComponentDigest:'a'.repeat(64), sessionGeneration:3, sessionState:'running', applicationStatus:{ generation:3, state:ready ? 'ready' : 'starting' } };
  state.nativeClipboard = clipboard ? "text" : undefined;
  let display, reads = 0;
  class Display extends EventTarget {
    static capabilities = {keyboardPolicy:true,clipboardText:true,clipboardMaxBytes:65536};
    sent = [];
    sendClipboardText(text) { this.sent.push(text); }
    keyboardPolicy = {profile:"unknown",mode:"local",bindings:[]};
    configureKeyboard(settings) { this.keyboardPolicy = settings;return true; }
    constructor(container,url) {
      super(); display = this; this.url = url; this.closed = 0;
      queueMicrotask(() => { this.dispatchEvent(new Event('connect')); if (frame) this.dispatchEvent(new Event('frame')); });
    }
    disconnect() { this.closed++; this.dispatchEvent(new Event('disconnect')); }
  }
  const manager = {
    url:path => path,
    getInstance:async () => { reads++; return structuredClone(state); },
    request:async (path,options) => {
      assert.equal(options.body.sessionGeneration,3);
      assert.equal(path,'/remotexapps/app/native/prepare');
      return structuredClone(state);
    },
  };
  const viewer = new RemoteXAppNativeClient({ container:{ replaceChildren(){} }, manager, timeout });
  viewer._loadDisplay = async () => ({ default:Display });
  return { viewer,state,get display(){return display;},get reads(){return reads;} };
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
