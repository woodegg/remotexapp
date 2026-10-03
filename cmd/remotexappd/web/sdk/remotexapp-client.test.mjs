import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.Element = class Element {
  constructor() {
    this.clientWidth = 1280;
    this.clientHeight = 720;
    this.style = {};
  }
  querySelector() { return null; }
};
globalThis.CustomEvent = class CustomEvent extends Event {
  constructor(type, options = {}) {
    super(type);
    this.detail = options.detail;
  }
};
globalThis.window = { devicePixelRatio: 1, innerWidth:1920, innerHeight:1080 };
globalThis.document = { querySelector: () => null, activeElement:null };

const { RemoteXAppClient } = await import('./remotexapp-client.js');
const { createRemoteResizeBridge } = await import('../assets-src/novnc-resize-bridge.mjs');
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

test('Viewer-owned idle lease survives disconnect and stops on explicit release/destroy', async () => {
  let renewals = 0;
  const instance = { id:'app-lease', sessionGeneration:1, state:'server-ready', sessionState:'running' };
  const manager = {
    url:path => `http://manager.test${path}`,
    getInstance:async () => instance,
    renewIdleLease:async (id, options) => {
      assert.equal(options.sessionGeneration, 1); renewals++;
      return { instanceId:id, sessionGeneration:1, outcome:'renewed', idleAction:'stop-instance', idleTimeoutMs:1000,
        serverTime:new Date().toISOString(), expiresAt:new Date(Date.now()+1000).toISOString() };
    },
  };
  const client = new RemoteXAppClient({ manager, instance, container:new Element() });
  const handle = await client.startIdleLease();
  client.disconnect();
  assert.equal(handle.state, 'tracking');
  await sleep(450);
  assert.ok(renewals > 0);
  await client.renewIdleLease();
  client.stopIdleLease();
  assert.equal(handle.state, 'released');
  const owned = await client.startIdleLease();
  client.container.replaceChildren = () => {};
  client.destroy();
  assert.equal(owned.state, 'released');
  await assert.rejects(client.startIdleLease(), /unavailable/);
  await assert.rejects(client.renewIdleLease(), /unavailable/);
});

test('host-owned runtime handle supplies shared monitoring and survives Viewer destruction', async () => {
  const manager = {};
  const runtime = new EventTarget();
  Object.assign(runtime, { manager, instanceId:'shared-app', state:'tracking', instance:{ id:'shared-app', sessionGeneration:2, state:'server-ready', sessionState:'running' } });
  const client = new RemoteXAppClient({ runtime, container:new Element() });
  assert.equal(client.manager, manager);
  client._startInstanceWatcher();
  assert.equal(client.instance.sessionGeneration, 2);
  runtime.instance = { ...runtime.instance, attachedClients:2 };
  runtime.dispatchEvent(new Event('statechange'));
  assert.equal(client.instance.attachedClients, 2);
  client.container.replaceChildren = () => {};
  client.destroy();
  assert.equal(runtime.state, 'tracking');
  assert.throws(() => new RemoteXAppClient({ runtime, manager:{}, container:new Element() }), /does not match/);
});

function recordingTextClient(textBatchDelay = 16) {
  const client = new RemoteXAppClient({
    manager:{}, container:new Element(), viewOnly:false, textBatchDelay,
  });
  const sent = [];
  client.sendText = value => {
    sent.push(value);
    return Promise.resolve({ value });
  };
  return { client, sent };
}

test('invalidated shared handle disconnects and cannot reconnect; release falls back to standalone observation', async () => {
  let standalone = 0;
  const manager = {watchInstance:() => {standalone++;return () => {}}};
  const makeRuntime = () => Object.assign(new EventTarget(), { manager, instanceId:'shared-app', sessionGeneration:2, state:'tracking',
    instance:{id:'shared-app',sessionGeneration:2,state:'server-ready',sessionState:'running'} });
  const runtime = makeRuntime();
  const client = new RemoteXAppClient({ runtime, container:new Element() });
  client._startInstanceWatcher();client.state = 'connected';
  runtime.state = 'invalidated';runtime.dispatchEvent(new Event('invalidated'));
  assert.equal(client.state,'disconnected');assert.equal(client.intentionalDisconnect,true);
  await assert.rejects(client.connect(),/no longer tracking/);
  await assert.rejects(client.reconnect(),/no longer tracking/);
  await assert.rejects(client._connectChannels(),/no longer tracking/);
  client.stopInstanceWatcher();
  const released = makeRuntime();
  const other = new RemoteXAppClient({runtime:released,container:new Element()});
  other._startInstanceWatcher();released.state='released';released.dispatchEvent(new Event('release'));
  assert.equal(other.runtime,null);assert.equal(standalone,1);
  other.stopInstanceWatcher();
});

function eventWith(type, properties = {}) {
  const event = new Event(type, { cancelable:true });
  for (const [name, value] of Object.entries(properties)) {
    Object.defineProperty(event, name, { value });
  }
  return event;
}

test('diagnostics are demand-driven while lifecycle timers remain independent', async () => {
  const calls = [];
  const manager = {
    async request(path) {
      calls.push(path);
      return { rfbToBrowserBytes: calls.length * 100, browserToRfbBytes: calls.length * 10 };
    },
  };
  const client = new RemoteXAppClient({
    manager,
    container: new Element(),
    instanceId: 'mousepad-test',
    viewOnly: true,
    diagnosticsInterval: 60_000,
  });
  let events = 0;
  client.addEventListener('diagnostics', () => { events += 1; });

  client._startTimers();
  assert.equal(client.diagnosticsTimer, null);
  assert.equal(calls.length, 0);
  client._setState('connecting');
  assert.equal(events, 0);

  const manual = await client.refreshDiagnostics();
  assert.equal(calls.length, 1);
  assert.equal(events, 0);
  assert.equal(manual.traffic.rfbToBrowserBytes, 100);

  const enabled = await client.setDiagnosticsEnabled(true);
  assert.equal(calls.length, 2);
  assert.equal(events, 1);
  assert.notEqual(client.diagnosticsTimer, null);
  assert.equal(enabled.diagnosticsEnabled, true);

  const timer = client.diagnosticsTimer;
  await client.setDiagnosticsEnabled(true);
  assert.equal(client.diagnosticsTimer, timer);
  assert.equal(calls.length, 2);

  client._setState('connected');
  assert.equal(events, 2);
  const disabled = await client.setDiagnosticsEnabled(false);
  assert.equal(disabled.diagnosticsEnabled, false);
  assert.equal(client.diagnosticsTimer, null);
  client._setState('disconnected');
  assert.equal(events, 2);
  assert.equal(calls.length, 2);
  client._stopTimers();
});

test('text batching defaults to 16ms and validates explicit compatibility values', () => {
  const standard = new RemoteXAppClient({ manager:{}, container:new Element() });
  const compatibility = new RemoteXAppClient({ manager:{}, container:new Element(), textBatchDelay:40 });
  const immediate = new RemoteXAppClient({ manager:{}, container:new Element(), textBatchDelay:0 });
  assert.equal(standard.textBatchDelay, 16);
  assert.equal(standard.getDiagnostics().textBatchDelay, 16);
  assert.equal(compatibility.textBatchDelay, 40);
  assert.equal(immediate.textBatchDelay, 0);
  assert.throws(() => new RemoteXAppClient({ manager:{}, container:new Element(), textBatchDelay:-1 }), RangeError);
  assert.throws(() => new RemoteXAppClient({ manager:{}, container:new Element(), textBatchDelay:Infinity }), RangeError);
  assert.throws(() => new RemoteXAppClient({ manager:{}, container:new Element(), textBatchDelay:1001 }), RangeError);
});

test('only an explicitly active connected Client enables local clipboard monitoring', () => {
  const activations = [];
  const client = new RemoteXAppClient({ manager:{}, container:new Element() });
  client.clipboard._setInputActive = (active, options) => { activations.push([active, options.reason]); };
  client.ime = {
    focus() { document.activeElement = this; },
    blur() { document.activeElement = null; },
  };
  document.hidden = false;
  document.hasFocus = () => true;
  client.state = 'connected';

  client._focusInput({ onlyIfUnfocused:true });
  assert.equal(client.inputOwner, false, 'RFB connection focus must not claim clipboard ownership');
  client.focus();
  assert.equal(client.inputOwner, true);
  assert.deepEqual(activations.at(-1), [true, 'client-focus']);

  document.hidden = true;
  client._updateClipboardActivity('document-hidden');
  assert.deepEqual(activations.at(-1), [false, 'document-hidden']);
  document.hidden = false;
  client._updateClipboardActivity('document-visible');
  assert.deepEqual(activations.at(-1), [true, 'document-visible']);

  client.blur();
  assert.equal(client.inputOwner, false);
  assert.deepEqual(activations.at(-1), [false, 'client-blur']);
  delete document.hasFocus;
});

test('remote resize scheduling validates debounce and maximum wait', () => {
  const trailing = new RemoteXAppClient({ manager:{}, container:new Element(), resizeDebounce:300 });
  const periodic = new RemoteXAppClient({ manager:{}, container:new Element(), resizeDebounce:300, resizeMaxWait:1000 });
  assert.equal(trailing.resizeDebounce, 300);
  assert.equal(trailing.resizeMaxWait, Infinity);
  assert.equal(periodic.resizeMaxWait, 1000);
  for (const value of [-1, NaN, Infinity]) {
    assert.throws(() => new RemoteXAppClient({ manager:{}, container:new Element(), resizeDebounce:value }), RangeError);
  }
  for (const value of [-1, NaN, 299]) {
    assert.throws(() => new RemoteXAppClient({ manager:{}, container:new Element(), resizeDebounce:300, resizeMaxWait:value }), RangeError);
  }
});

test('guarded noVNC bridge intercepts, snapshots, submits, and restores resize requests', () => {
  class FakeRFB {
    constructor() {
      this.resizeSession = true;
      this.viewOnly = false;
      this._supportsSetDesktopSize = true;
      this._pendingRemoteResize = false;
      this._lastResize = 1000;
      this._fbWidth = 800;
      this._fbHeight = 600;
      this.requests = 0;
    }
    _screenSize() { return { w:1024.9, h:768.4 }; }
    _requestRemoteResize() { this.requests += 1; }
  }
  const rfb = new FakeRFB();
  let intercepted = 0;
  const bridge = createRemoteResizeBridge(rfb, () => { intercepted += 1; });

  rfb._requestRemoteResize();
  assert.equal(intercepted, 1);
  assert.equal(rfb.requests, 0);
  assert.deepEqual(bridge.snapshot(), {
    enabled:true, supported:true, pending:false,
    width:1024, height:768, framebufferWidth:800, framebufferHeight:600,
    needsResize:true, earliestAt:1100,
  });
  assert.equal(bridge.request(), true);
  assert.equal(rfb.requests, 1);
  bridge.dispose();
  rfb._requestRemoteResize();
  assert.equal(rfb.requests, 2);
});

function fakeResizeBridge(state) {
  const requests = [];
  return {
    requests,
    snapshot:() => ({ earliestAt:0, ...state }),
    request:() => { requests.push(`${state.width}x${state.height}`); state.pending = true; return true; },
    dispose:() => { state.disposed = true; },
  };
}

test('remote resize debounce sends only the latest quiet size', async () => {
  const state = {
    enabled:true, supported:true, pending:false, needsResize:true,
    width:900, height:640, framebufferWidth:800, framebufferHeight:600,
  };
  const bridge = fakeResizeBridge(state);
  const client = new RemoteXAppClient({ manager:{}, container:new Element(), resizeDebounce:25 });
  client.remoteResizeBridge = bridge;

  client._captureRemoteResize(bridge.snapshot());
  await sleep(10);
  state.width = 1000; state.height = 700;
  client._captureRemoteResize(bridge.snapshot());
  await sleep(18);
  assert.deepEqual(bridge.requests, []);
  await sleep(20);
  assert.deepEqual(bridge.requests, ['1000x700']);
  client._disposeRemoteResizeScheduling();
});

test('remote resize maximum wait makes progress and flush submits the final size', async () => {
  const state = {
    enabled:true, supported:true, pending:false, needsResize:true,
    width:900, height:640, framebufferWidth:800, framebufferHeight:600,
  };
  const bridge = fakeResizeBridge(state);
  const client = new RemoteXAppClient({ manager:{}, container:new Element(), resizeDebounce:25, resizeMaxWait:50 });
  client.remoteResizeBridge = bridge;

  client._captureRemoteResize(bridge.snapshot());
  for (const width of [910, 920, 930]) {
    await sleep(12);
    state.width = width;
    client._captureRemoteResize(bridge.snapshot());
  }
  await sleep(20);
  assert.deepEqual(bridge.requests, ['930x640']);

  state.pending = false;
  state.framebufferWidth = 930;
  state.width = 1100;
  state.height = 720;
  state.framebufferHeight = 640;
  client._captureRemoteResize(bridge.snapshot());
  assert.equal(client.flushResize(), true);
  await sleep(5);
  assert.deepEqual(bridge.requests, ['930x640', '1100x720']);
  client._disposeRemoteResizeScheduling();
});

test('remote resize retains a newer target across an in-flight request and cancels on disposal', async () => {
  const state = {
    enabled:true, supported:true, pending:false, needsResize:true,
    width:900, height:640, framebufferWidth:800, framebufferHeight:600,
  };
  const bridge = fakeResizeBridge(state);
  const client = new RemoteXAppClient({ manager:{}, container:new Element(), resizeDebounce:15 });
  client.remoteResizeBridge = bridge;

  client._captureRemoteResize(bridge.snapshot());
  await sleep(20);
  assert.deepEqual(bridge.requests, ['900x640']);
  state.width = 1200;
  state.height = 800;
  client._captureRemoteResize(bridge.snapshot());
  await sleep(20);
  assert.deepEqual(bridge.requests, ['900x640']);
  state.pending = false;
  state.framebufferWidth = 900;
  state.framebufferHeight = 640;
  client._captureRemoteResize(bridge.snapshot());
  await sleep(5);
  assert.deepEqual(bridge.requests, ['900x640', '1200x800']);

  state.pending = false;
  state.width = 1300;
  client._captureRemoteResize(bridge.snapshot());
  client._disposeRemoteResizeScheduling();
  await sleep(20);
  assert.equal(state.disposed, true);
  assert.deepEqual(bridge.requests, ['900x640', '1200x800']);
});

test('automatic reconnect budget accepts Infinity or a non-negative integer', () => {
  const unlimited = new RemoteXAppClient({ manager:{}, container:new Element() });
  const disabled = new RemoteXAppClient({ manager:{}, container:new Element(), maxReconnectAttempts:0 });
  const finite = new RemoteXAppClient({ manager:{}, container:new Element(), maxReconnectAttempts:3 });
  assert.equal(unlimited.maxReconnectAttempts, Infinity);
  assert.equal(disabled.maxReconnectAttempts, 0);
  assert.equal(finite.maxReconnectAttempts, 3);
  for (const value of [-1, 1.5, NaN, -Infinity]) {
    assert.throws(() => new RemoteXAppClient({ manager:{}, container:new Element(), maxReconnectAttempts:value }), RangeError);
  }
});

test('connection mask defaults on and rejects non-booleans', () => {
  const client = new RemoteXAppClient({manager:{},container:new Element()});
  assert.equal(client.connectionMask,true);
  client.setConnectionMaskEnabled(false);
  assert.equal(client.connectionMask,false);
  assert.throws(()=>client.setConnectionMaskEnabled('off'),TypeError);
  assert.throws(()=>new RemoteXAppClient({manager:{},container:new Element(),connectionMask:0}),TypeError);
});

test('cancel during instance lookup cannot start late channels', async () => {
  let resolve; let channels=0;
  const client = new RemoteXAppClient({manager:{getInstance:()=>new Promise(r=>resolve=r)},container:new Element(),connectionMask:false,instanceId:'late'});
  client._connectChannels=async()=>{channels++};
  const pending=client.connect();client.disconnect();
  resolve({id:'late',state:'server-ready'});
  await assert.rejects(pending,{name:'AbortError'});
  assert.equal(channels,0);assert.equal(client.state,'disconnected');
});

test('successful channel connection resets the reconnect budget and honors fixed display scaling', async () => {
  globalThis.window.location = { href:'https://viewer.example.test/' };
  class FakeWebSocket extends EventTarget {
    close() { this.dispatchEvent(new Event('close')); }
    send() {}
  }
  globalThis.WebSocket = FakeWebSocket;
  class FakeRFB extends EventTarget {
    disconnect() {}
  }
  const client = new RemoteXAppClient({
    manager:{ url:path => path }, container:new Element(), connectionMask:false, viewOnly:true, resize:'remote', resizeDebounce:300,
    instance:{ id:'desktop-1', effectivePolicy:{ display:{ allowClientResize:false } } },
  });
  client.instanceId = 'desktop-1';
  client.classInfo = { display:{ allowClientResize:true } };
  client.RFBClass = FakeRFB;
  client.disableNoVNCKeyboardCapture = () => {};
  client.reconnectAttempt = 4;
  client.reconnectExhausted = true;
  client.diagnostics.reconnectAttempt = 4;
  client.diagnostics.reconnectExhausted = true;

  const connected = client._connectChannels();
  assert.equal(client.rfb.resizeSession, false);
  assert.equal(client.rfb.scaleViewport, true);
  assert.equal(client.remoteResizeBridge, null);
  client.input.dispatchEvent(new Event('open'));
  client.rfb.dispatchEvent(new Event('connect'));
  await connected;

  assert.equal(client.reconnectAttempt, 0);
  assert.equal(client.reconnectExhausted, false);
  assert.equal(client.state, 'connected');
  client.disconnect();
});

test('debounced remote mode installs the guarded bridge, scales locally, and negotiates the initial size immediately', async () => {
  globalThis.window.location = { href:'https://viewer.example.test/' };
  class FakeWebSocket extends EventTarget {
    close() { this.dispatchEvent(new Event('close')); }
    send() {}
  }
  globalThis.WebSocket = FakeWebSocket;
  class FakeRFB extends EventTarget {
    constructor() {
      super();
      this._resizeSession = false;
      this._supportsSetDesktopSize = false;
      this._pendingRemoteResize = false;
      this._lastResize = 0;
      this._fbWidth = 800;
      this._fbHeight = 600;
      this.sentSizes = [];
    }
    get resizeSession() { return this._resizeSession; }
    set resizeSession(value) { this._resizeSession = value; if (value) this._requestRemoteResize(); }
    _screenSize() { return { w:1000, h:700 }; }
    _requestRemoteResize() {
      if (!this._resizeSession || !this._supportsSetDesktopSize || this._pendingRemoteResize) return;
      this._pendingRemoteResize = true;
      this._lastResize = Date.now();
      this.sentSizes.push('1000x700');
    }
    sendKey() {}
    disconnect() {}
  }
  const client = new RemoteXAppClient({
    manager:{ url:path => path }, container:new Element(), connectionMask:false, viewOnly:false,
    resize:'remote', resizeDebounce:300,
    instance:{ id:'desktop-2', effectivePolicy:{ display:{ allowClientResize:true } } },
  });
  client.instanceId = 'desktop-2';
  client.classInfo = { display:{ allowClientResize:true } };
  client.RFBClass = FakeRFB;
  client.disableNoVNCKeyboardCapture = () => {};
  client.createRemoteResizeBridge = createRemoteResizeBridge;

  const connected = client._connectChannels();
  assert.equal(client.rfb.resizeSession, true);
  assert.equal(client.rfb.scaleViewport, true);
  assert.notEqual(client.remoteResizeBridge, null);
  assert.deepEqual(client.rfb.sentSizes, []);
  client.rfb._supportsSetDesktopSize = true;
  client.rfb._requestRemoteResize();
  assert.deepEqual(client.rfb.sentSizes, ['1000x700']);
  client.input.dispatchEvent(new Event('open'));
  client.rfb.dispatchEvent(new Event('connect'));
  await connected;
  client.disconnect();
  assert.equal(client.remoteResizeBridge, null);
});

test('explicit connect and reconnect each start a new retry budget', async () => {
  const instance = { id:'desktop-1', classId:'xfce-user-desktop', state:'server-ready' };
  const client = new RemoteXAppClient({
    manager:{ getClass:async () => ({ display:{ allowClientResize:false } }) },
    container:new Element(), connectionMask:false, viewOnly:true, instance,
  });
  client._loadNoVNC = async () => {};
  client._setupDOM = () => {};
  client._startInstanceWatcher = () => {};
  client._connectChannels = async () => client;

  client.reconnectAttempt = 2;
  client.reconnectExhausted = true;
  await client.connect();
  assert.equal(client.reconnectAttempt, 0);
  assert.equal(client.reconnectExhausted, false);

  client.reconnectAttempt = 2;
  client.reconnectExhausted = true;
  await client.reconnect();
  assert.equal(client.reconnectAttempt, 0);
  assert.equal(client.reconnectExhausted, false);
});

test('finite reconnect budget exhausts once and closes residual channels', async () => {
  let exhausted = 0;
  let reconnecting = 0;
  let inputCloses = 0;
  let rfbCloses = 0;
  let resolveExhausted;
  let rejectExhausted;
  const exhaustedEvent = new Promise((resolve, reject) => {
    resolveExhausted = resolve;
    rejectExhausted = reject;
  });
  const exhaustedTimeout = setTimeout(
    () => rejectExhausted(new Error('timed out waiting for reconnect exhaustion')),
    1000,
  );
  const client = new RemoteXAppClient({
    manager:{ getInstance:async () => { throw new Error('manager unavailable'); } },
    container:new Element(), viewOnly:true, instanceId:'desktop-1',
    reconnectDelays:[0], maxReconnectAttempts:2,
  });
  client.state = 'connected';
  client.input = { close:() => { inputCloses += 1; } };
  client.rfb = { disconnect:() => { rfbCloses += 1; } };
  client.addEventListener('reconnecting', () => { reconnecting += 1; });
  client.addEventListener('reconnectexhausted', event => {
    exhausted += 1;
    assert.equal(event.detail.attempts, 2);
    assert.equal(event.detail.maxReconnectAttempts, 2);
    clearTimeout(exhaustedTimeout);
    resolveExhausted();
  });

  client._channelFailed('connection lost');
  await exhaustedEvent;
  client._channelFailed('duplicate failure');

  assert.equal(reconnecting, 2);
  assert.equal(exhausted, 1);
  assert.equal(client.reconnectAttempt, 2);
  assert.equal(client.reconnectExhausted, true);
  assert.equal(client.reconnectTimer, null);
  assert.equal(client.state, 'disconnected');
  assert.equal(inputCloses, 1);
  assert.equal(rfbCloses, 1);
});

test('zero reconnect budget exhausts without scheduling an automatic attempt', () => {
  const client = new RemoteXAppClient({
    manager:{}, container:new Element(), viewOnly:true,
    maxReconnectAttempts:0,
  });
  let reconnecting = 0;
  let exhausted = 0;
  client.addEventListener('reconnecting', () => { reconnecting += 1; });
  client.addEventListener('reconnectexhausted', () => { exhausted += 1; });

  client._channelFailed('connection lost');

  assert.equal(reconnecting, 0);
  assert.equal(exhausted, 1);
  assert.equal(client.reconnectAttempt, 0);
  assert.equal(client.reconnectTimer, null);
  assert.equal(client.state, 'disconnected');
});

test('unlimited reconnect budget does not exhaust', () => {
  const client = new RemoteXAppClient({
    manager:{}, container:new Element(), viewOnly:true,
    reconnectDelays:[60_000],
  });
  let exhausted = 0;
  client.addEventListener('reconnectexhausted', () => { exhausted += 1; });
  for (let attempt = 1; attempt <= 5; attempt++) {
    client._channelFailed('connection lost');
    clearTimeout(client.reconnectTimer);
    client.reconnectTimer = null;
    assert.equal(client.reconnectAttempt, attempt);
  }
  assert.equal(exhausted, 0);
  client.disconnect();
});

test('intentional disconnect from reconnecting cancels the old retry cycle', async () => {
  let managerCalls = 0;
  let exhausted = 0;
  const client = new RemoteXAppClient({
    manager:{ getInstance:async () => { managerCalls += 1; return { state:'ready' }; } },
    container:new Element(), viewOnly:true, instanceId:'desktop-1',
    reconnectDelays:[0], maxReconnectAttempts:1,
  });
  client.addEventListener('reconnecting', () => client.disconnect());
  client.addEventListener('reconnectexhausted', () => { exhausted += 1; });

  client._channelFailed('connection lost');
  await sleep(10);

  assert.equal(managerCalls, 0);
  assert.equal(exhausted, 0);
  assert.equal(client.reconnectTimer, null);
  assert.equal(client.intentionalDisconnect, true);
  assert.equal(client.state, 'disconnected');
});

test('ordinary input batches briefly and 40ms compatibility mode remains available', async () => {
  const standard = recordingTextClient();
  standard.client._queueText('a');
  standard.client._queueText('b');
  standard.client._queueText('c');
  assert.deepEqual(standard.sent, []);
  await sleep(25);
  assert.deepEqual(standard.sent, ['abc']);

  const compatibility = recordingTextClient(40);
  compatibility.client._queueText('x');
  await sleep(15);
  assert.deepEqual(compatibility.sent, []);
  await sleep(40);
  assert.deepEqual(compatibility.sent, ['x']);

  const immediate = recordingTextClient(0);
  immediate.client._queueText('1');
  immediate.client._queueText('2');
  assert.deepEqual(immediate.sent, ['1', '2']);
});

test('composition commits immediately in order and first English input survives both switches', async () => {
  const { client, sent } = recordingTextClient();
  const ime = new EventTarget();
  ime.value = '';
  client.ime = ime;
  client._bindInputEvents();

  client._queueText('before-');
  ime.dispatchEvent(eventWith('compositionstart', { data:'' }));
  ime.dispatchEvent(eventWith('compositionend', { data:'你好' }));
  assert.equal(client.composing, false);
  assert.deepEqual(sent, ['before-你好']);

  ime.value = 'i';
  ime.dispatchEvent(eventWith('input', { data:'i', inputType:'insertText', isComposing:false }));
  await sleep(25);
  assert.deepEqual(sent, ['before-你好', 'i']);

  ime.dispatchEvent(eventWith('compositionstart', { data:'' }));
  ime.dispatchEvent(eventWith('compositionend', { data:'世界' }));
  assert.deepEqual(sent, ['before-你好', 'i', '世界']);
  ime.value = 'x';
  ime.dispatchEvent(eventWith('input', { data:'x', inputType:'insertText', isComposing:false }));
  await sleep(25);
  assert.deepEqual(sent, ['before-你好', 'i', '世界', 'x']);
});

function positionedIME() {
  const ime = new EventTarget();
  ime.style = {};
  ime.value = '';
  ime.focusCalls = 0;
  ime.blurCalls = 0;
  ime.layoutReads = 0;
  ime.focus = () => { ime.focusCalls += 1; document.activeElement = ime; };
  ime.blur = () => { ime.blurCalls += 1; if (document.activeElement === ime) document.activeElement = null; };
  ime.getBoundingClientRect = () => { ime.layoutReads += 1; return { left:0, top:0, width:2, height:2 }; };
  return ime;
}

test('primary mouse, touch, and pen re-anchor the native IME while other buttons do not replace it', () => {
  const client = new RemoteXAppClient({ manager:{}, container:new Element() });
  const ime = positionedIME();
  client.ime = ime;
  document.activeElement = ime;

  client._handlePointerDown({ button:0, isPrimary:true, clientX:480, clientY:320 });
  assert.equal(ime.style.left, '480px');
  assert.equal(ime.style.top, '320px');
  assert.equal(ime.layoutReads, 1);
  assert.equal(ime.blurCalls, 1);
  assert.equal(ime.focusCalls, 1);
  assert.equal(client.pendingCaret.epoch, 1);
  const initialPending = client.pendingCaret;

  client._handlePointerDown({ button:2, isPrimary:true, clientX:900, clientY:700 });
  client._handlePointerDown({ button:1, isPrimary:true, clientX:800, clientY:600 });
  client._handlePointerDown({ button:0, isPrimary:false, clientX:700, clientY:500 });
  assert.equal(ime.style.left, '480px');
  assert.equal(ime.style.top, '320px');
  assert.equal(client.pendingCaret, initialPending);
  assert.equal(ime.blurCalls, 1);
  assert.equal(ime.focusCalls, 1);

  client._handlePointerDown({ button:0, isPrimary:true, pointerType:'touch', clientX:560, clientY:410 });
  assert.equal(ime.style.left, '560px');
  assert.equal(ime.style.top, '410px');
  client._handlePointerDown({ button:0, isPrimary:true, pointerType:'pen', clientX:620, clientY:450 });
  assert.equal(ime.style.left, '620px');
  assert.equal(ime.style.top, '450px');
  client._clearPendingCaret();
});

test('click fallback remains authoritative after its recovery window until a fresh caret arrives', async () => {
  const client = new RemoteXAppClient({ manager:{}, container:new Element() });
  client.ime = positionedIME();
  document.activeElement = client.ime;

  client._handlePointerDown({ button:0, isPrimary:true, clientX:360, clientY:240 });
  await sleep(780);
  assert.notEqual(client.pendingCaret, null);
  assert.equal(client.pendingCaret.fallbackActive, true);
  assert.equal(client.diagnostics.cursor.positionSource, 'click-fallback');
  assert.equal(client.ime.style.left, '360px');
  assert.equal(client.ime.style.top, '240px');
  client._clearPendingCaret();
});

test('primary pointer never refreshes focus during composition or queued and in-flight text', () => {
  for (const blocked of ['composition', 'queued', 'in-flight']) {
    const client = new RemoteXAppClient({ manager:{}, container:new Element() });
    const ime = positionedIME();
    client.ime = ime;
    document.activeElement = ime;
    if (blocked === 'composition') client.composing = true;
    if (blocked === 'queued') client.pendingText = 'pending';
    if (blocked === 'in-flight') client.textRequests.set(1, {});

    client._handlePointerDown({ button:0, isPrimary:true, clientX:300, clientY:200 });
    assert.equal(ime.style.left, '300px', blocked);
    assert.equal(ime.style.top, '200px', blocked);
    assert.equal(ime.layoutReads, 0, blocked);
    assert.equal(ime.blurCalls, 0, blocked);
    assert.equal(ime.focusCalls, 0, blocked);
    client._clearPendingCaret();
  }
});

test('fresh remote caret supersedes a retained primary-pointer fallback', () => {
  class CanvasContainer extends Element {
    querySelector(selector) {
      if (selector !== 'canvas') return null;
      return {
        width:1280, height:720,
        getBoundingClientRect:() => ({ left:100, top:50, width:640, height:360 }),
      };
    }
  }
  const client = new RemoteXAppClient({ manager:{}, container:new CanvasContainer() });
  const ime = positionedIME();
  client.ime = ime;
  document.activeElement = ime;
  client.lastCursorUpdatedMS = 10;

  client._handlePointerDown({ button:0, isPrimary:true, clientX:480, clientY:320 });
  client.pendingCaret.fallbackActive = true;
  client._handleInputMessage({ data:JSON.stringify({
    type:'cursor-position', sequence:2, updatedMs:20, focused:true, enabled:true,
    cursor:{ x:640, y:360, width:1, height:20 },
  }) });

  assert.equal(ime.style.left, '420px');
  assert.equal(ime.style.top, '230px');
  assert.equal(ime.style.height, '10px');
  assert.equal(ime.blurCalls, 2);
  assert.equal(ime.focusCalls, 2);
  assert.equal(client.pendingCaret, null);
  assert.equal(client.diagnostics.cursor.positionSource, 'remote-caret');
  assert.equal(client.diagnostics.cursor.freshForPointer, true);
  assert.equal(client.diagnostics.cursor.refocused, true);
});

test('fresh caret correction does not refocus during composition or queued and in-flight text', () => {
  class CanvasContainer extends Element {
    querySelector(selector) {
      if (selector !== 'canvas') return null;
      return {
        width:1280, height:720,
        getBoundingClientRect:() => ({ left:0, top:0, width:1280, height:720 }),
      };
    }
  }
  for (const blocked of ['composition', 'queued', 'in-flight']) {
    const client = new RemoteXAppClient({ manager:{}, container:new CanvasContainer() });
    const ime = positionedIME();
    client.ime = ime;
    document.activeElement = ime;
    client.lastCursorUpdatedMS = 10;
    if (blocked === 'composition') client.composing = true;
    if (blocked === 'queued') client.pendingText = 'pending';
    if (blocked === 'in-flight') client.textRequests.set(1, {});

    client._handlePointerDown({ button:0, isPrimary:true, clientX:300, clientY:200 });
    client._handleInputMessage({ data:JSON.stringify({
      type:'cursor-position', sequence:2, updatedMs:20, focused:true, enabled:true,
      cursor:{ x:640, y:360, width:1, height:20 },
    }) });

    assert.equal(ime.blurCalls, 0, blocked);
    assert.equal(ime.focusCalls, 0, blocked);
    assert.equal(client.pendingCaret, null, blocked);
    assert.equal(client.diagnostics.cursor.refocused, false, blocked);
    assert.equal(client.diagnostics.cursor.positionSource, 'remote-caret', blocked);
  }
});

test('physical ASCII uses RFB while non-ASCII and composition use IBus text', async () => {
  const { client, sent } = recordingTextClient(0);
  const remoteKeys = [];
  const ime = new EventTarget();
  ime.value = '';
  client.ime = ime;
  client.rfb = { sendKey:(keysym, code, down) => remoteKeys.push({ keysym, code, down }) };
  client.KeyboardUtil = {
    getKeycode:event => event.code,
    getKeysym:event => ({ a:0x61, A:0x41, '!':0x21, Shift:0xffe1, é:0xe9 })[event.key] || 0,
  };
  client._bindInputEvents();

  const asciiDown = eventWith('keydown', {
    key:'a', code:'KeyA', shiftKey:false, ctrlKey:false, altKey:false, metaKey:false,
  });
  ime.dispatchEvent(asciiDown);
  ime.dispatchEvent(eventWith('keyup', { key:'a', code:'KeyA' }));
  assert.equal(asciiDown.defaultPrevented, true);
  assert.deepEqual(remoteKeys.map(({ code, down }) => `${code}:${down}`), ['KeyA:true', 'KeyA:false']);
  assert.deepEqual(sent, []);

  const unicodeDown = eventWith('keydown', {
    key:'é', code:'KeyE', shiftKey:false, ctrlKey:false, altKey:false, metaKey:false,
  });
  ime.dispatchEvent(unicodeDown);
  assert.equal(unicodeDown.defaultPrevented, false);
  ime.value = 'é';
  ime.dispatchEvent(eventWith('input', { data:'é', inputType:'insertText', isComposing:false }));

  ime.dispatchEvent(eventWith('compositionstart', { data:'' }));
  const composingDown = eventWith('keydown', {
    key:'a', code:'KeyA', keyCode:229, isComposing:true,
    shiftKey:false, ctrlKey:false, altKey:false, metaKey:false,
  });
  ime.dispatchEvent(composingDown);
  ime.dispatchEvent(eventWith('keyup', { key:'a', code:'KeyA' }));
  ime.dispatchEvent(eventWith('compositionend', { data:'你好' }));

  const deadDown = eventWith('keydown', {
    key:'Dead', code:'Quote', keyCode:0, isComposing:false,
    shiftKey:false, ctrlKey:false, altKey:false, metaKey:false,
  });
  ime.dispatchEvent(deadDown);
  ime.dispatchEvent(eventWith('keyup', { key:'Dead', code:'Quote' }));
  assert.equal(deadDown.defaultPrevented, false);

  assert.deepEqual(
    remoteKeys.filter(({ code }) => code === 'KeyA' || code === 'KeyE').map(({ code, down }) => `${code}:${down}`),
    ['KeyA:true', 'KeyA:false'],
  );
  assert.deepEqual(sent, ['é', '你好']);
});

test('shifted ASCII, punctuation and repeats retain RFB key pairing', () => {
  const client = new RemoteXAppClient({ manager:{}, container:new Element() });
  const remoteKeys = [];
  client.rfb = { sendKey:(keysym, code, down) => remoteKeys.push({ keysym, code, down }) };
  client.KeyboardUtil = {
    getKeycode:event => event.code,
    getKeysym:event => ({ Shift:0xffe1, A:0x41, '!':0x21, a:0x61 })[event.key] || 0,
  };

  client._keyDown(eventWith('keydown', { key:'Shift', code:'ShiftLeft', shiftKey:true, ctrlKey:false, altKey:false, metaKey:false }));
  client._keyDown(eventWith('keydown', { key:'A', code:'KeyA', shiftKey:true, ctrlKey:false, altKey:false, metaKey:false }));
  client._keyUp(eventWith('keyup', { key:'A', code:'KeyA', shiftKey:true }));
  client._keyDown(eventWith('keydown', { key:'!', code:'Digit1', shiftKey:true, ctrlKey:false, altKey:false, metaKey:false }));
  client._keyUp(eventWith('keyup', { key:'!', code:'Digit1', shiftKey:true }));
  client._keyUp(eventWith('keyup', { key:'Shift', code:'ShiftLeft', shiftKey:false }));
  client._keyDown(eventWith('keydown', { key:'a', code:'KeyA', repeat:false, shiftKey:false, ctrlKey:false, altKey:false, metaKey:false }));
  client._keyDown(eventWith('keydown', { key:'a', code:'KeyA', repeat:true, shiftKey:false, ctrlKey:false, altKey:false, metaKey:false }));
  client._keyUp(eventWith('keyup', { key:'a', code:'KeyA', shiftKey:false }));

  assert.deepEqual(remoteKeys.map(({ code, down }) => `${code}:${down}`), [
    'ShiftLeft:true', 'KeyA:true', 'KeyA:false',
    'Digit1:true', 'Digit1:false', 'ShiftLeft:false',
    'KeyA:true', 'KeyA:true', 'KeyA:false',
  ]);
  assert.deepEqual([...client.sentKeys], []);
  assert.deepEqual([...client.pendingModifiers], []);
  assert.deepEqual([...client.pendingModifierReleases], []);
});

test('unidentified ASCII and paste fall back to the IBus text path', async () => {
  const { client, sent } = recordingTextClient(0);
  const remoteKeys = [];
  const ime = new EventTarget();
  ime.value = '';
  client.ime = ime;
  client.rfb = { sendKey:(...args) => remoteKeys.push(args) };
  client.KeyboardUtil = {
    getKeycode:() => 'Unidentified',
    getKeysym:() => 0x61,
  };
  client._bindInputEvents();

  const keydown = eventWith('keydown', {
    key:'a', code:'', shiftKey:false, ctrlKey:false, altKey:false, metaKey:false,
  });
  ime.dispatchEvent(keydown);
  assert.equal(keydown.defaultPrevented, false);
  ime.value = 'a';
  ime.dispatchEvent(eventWith('input', { data:'a', inputType:'insertText', isComposing:false }));
  ime.value = 'paste42';
  ime.dispatchEvent(eventWith('input', { data:'paste42', inputType:'insertFromPaste', isComposing:false }));

  assert.deepEqual(remoteKeys, []);
  assert.deepEqual(sent, ['a', 'paste42']);
});

test('disconnect discards a pending batch instead of sending it through a replacement channel', async () => {
  const { client, sent } = recordingTextClient(40);
  client._queueText('stale');
  client.disconnect();
  await sleep(55);
  assert.deepEqual(sent, []);
  assert.equal(client.pendingText, '');
  assert.equal(client.textTimer, null);
});

test('clean application exit ends the viewer without automatic reconnect', () => {
  let watcher;
  const manager = {
    watchInstance(_id, options) { watcher = options.onChange; return () => {}; },
  };
  const client = new RemoteXAppClient({
    manager, container:new Element(), viewOnly:true,
    instance:{ id:'desktop-1', sessionState:'running' },
    maxReconnectAttempts:0,
  });
  client.instanceId = 'desktop-1';
  client.state = 'connected';
  client._startInstanceWatcher();
  let ended = 0;
  let exhausted = 0;
  client.addEventListener('sessionended', event => {
    ended += 1;
    assert.equal(event.detail.reason, 'application-exited');
  });
  client.addEventListener('reconnectexhausted', () => { exhausted += 1; });

  watcher({ id:'desktop-1', sessionState:'stopped', applicationStatus:{ state:'exited' } });

  assert.equal(ended, 1);
  assert.equal(exhausted, 0);
  assert.equal(client.intentionalDisconnect, true);
  assert.equal(client.state, 'disconnected');
});

test('channel loss discovers a clean application exit without reporting an error', async () => {
  const terminal = {
    id:'desktop-1', state:'stopped', sessionState:'stopped', sessionGeneration:1,
    applicationStatus:{ state:'exited' },
  };
  const client = new RemoteXAppClient({
    manager:{ getInstance:async () => terminal }, container:new Element(), viewOnly:true,
    instance:{ id:'desktop-1', state:'server-ready', sessionState:'running', sessionGeneration:1 },
    reconnectDelays:[0],
  });
  client.instanceId = 'desktop-1';
  client.state = 'connected';
  let ended = 0;
  let errors = 0;
  client.addEventListener('sessionended', () => { ended += 1; });
  client.addEventListener('error', () => { errors += 1; });

  client._channelFailed('RFB disconnected');
  await sleep(10);

  assert.equal(ended, 1);
  assert.equal(errors, 0);
  assert.equal(client.intentionalDisconnect, true);
  assert.equal(client.state, 'disconnected');
});

test('IME modifier chord stays local while an ordinary shortcut remains ordered', () => {
  const client = new RemoteXAppClient({ manager:{}, container:new Element() });
  const remoteKeys = [];
  client.rfb = { sendKey:(keysym, code, down) => remoteKeys.push({ keysym, code, down }) };
  client.KeyboardUtil = {
    getKeycode:event => event.code,
    getKeysym:event => ({ Control:0xffe3, a:0x61 })[event.key] || 0,
  };

  client._keyDown(eventWith('keydown', { key:'Control', code:'ControlLeft', ctrlKey:true, altKey:false, metaKey:false }));
  client._keyUp(eventWith('keyup', { key:'Control', code:'ControlLeft', ctrlKey:false, altKey:false, metaKey:false }));
  assert.deepEqual(remoteKeys, []);

  client._keyDown(eventWith('keydown', { key:'Control', code:'ControlLeft', ctrlKey:true, altKey:false, metaKey:false }));
  client._keyDown(eventWith('keydown', { key:'a', code:'KeyA', ctrlKey:true, altKey:false, metaKey:false }));
  client._keyUp(eventWith('keyup', { key:'a', code:'KeyA', ctrlKey:true, altKey:false, metaKey:false }));
  client._keyUp(eventWith('keyup', { key:'Control', code:'ControlLeft', ctrlKey:false, altKey:false, metaKey:false }));
  assert.deepEqual(remoteKeys.map(({ code, down }) => `${code}:${down}`), [
    'ControlLeft:true', 'KeyA:true', 'KeyA:false', 'ControlLeft:false',
  ]);
});
