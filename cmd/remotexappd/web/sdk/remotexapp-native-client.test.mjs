import assert from 'node:assert/strict';
import test from 'node:test';
import { RemoteXAppNativeClient } from './remotexapp-native-client.js';

globalThis.CustomEvent ||= class extends Event { constructor(type,options) { super(type); this.detail = options?.detail; } };
globalThis.location = new URL('https://viewer.example.test/remotexapps/app/kiosk.html');

function fixture({ ready = true, frame = true, timeout = 200 } = {}) {
  const state = { id:'app', displayProvider:'kasm', displayComponentDigest:'a'.repeat(64), sessionGeneration:3, sessionState:'running', applicationStatus:{ generation:3, state:ready ? 'ready' : 'starting' } };
  let display, reads = 0;
  class Display extends EventTarget {
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
