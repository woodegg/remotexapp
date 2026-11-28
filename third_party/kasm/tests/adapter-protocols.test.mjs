import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LatencyProbe} from '../latency.mjs';
import {ClipboardInputGate} from '../clipboard-input.mjs';
import {MAX_RICH_CLIPBOARD_BYTES} from '../clipboard-payload.mjs';

test('adapter passes the one-use grant through RFB WebSocket options, not video codecs',async t=>{
  const originalDocument=globalThis.document;
  const calls=[], clipboardCalls=[];
  t.mock.timers.enable({apis:['setTimeout']});
  globalThis.__adapterRFB=class extends EventTarget {
    static messages={sendBinaryClipboard:(_,data,mimes)=>clipboardCalls.push({data,mimes})};
    constructor(target,input,url,options,videoCodecs){super();calls.push({url,options,videoCodecs,rfb:this});this._keyboard={};this._rfbConnectionState='connected';}
    isConnected=true;
    refreshes=0;
    _requestFullRefresh(){this.refreshes++;}
    disconnect(){}
  };
  globalThis.document={createElement:()=>({setAttribute(){},addEventListener(){},removeEventListener(){},style:{},remove(){}})};
  globalThis.REMOTEXAPP_UDP=true;
  globalThis.__latencyProbe=LatencyProbe;
  globalThis.__clipboardInputGate=ClipboardInputGate;
  try {
    const source=readFileSync(new URL('../client-entry.js',import.meta.url),'utf8')
      .replace("import RFB from './core/rfb.js';",'const RFB=globalThis.__adapterRFB;')
      .replace("import MouseButtonMapper, {XVNC_BUTTONS} from './core/mousebuttonmapper.js';",'const MouseButtonMapper=Map, XVNC_BUTTONS={LEFT_BUTTON:1,MIDDLE_BUTTON:2,RIGHT_BUTTON:4,BACK_BUTTON:8,FORWARD_BUTTON:16};')
      .replace("import {normalizePolicy} from './core/input/poc-input-policy.mjs';",'const normalizePolicy=x=>x;')
      .replace("'./core/remotexapp-native-input.mjs'",JSON.stringify(new URL('../native-input.mjs',import.meta.url).href))
      .replace("'./core/remotexapp-clipboard-order.mjs'", JSON.stringify(new URL('../clipboard-order.mjs', import.meta.url).href))
      .replace("import keysyms from './core/input/keysymdef.js';",'const keysyms={lookup:x=>x};')
      .replace("'./core/clipboard-payload.mjs'",JSON.stringify(new URL('../clipboard-payload.mjs',import.meta.url).href))
      .replace("import { LatencyProbe } from './core/remotexapp-latency.mjs';",'const LatencyProbe=globalThis.__latencyProbe;')
      .replace("import { ClipboardInputGate } from './core/remotexapp-clipboard-input.mjs';",'const ClipboardInputGate=globalThis.__clipboardInputGate;');
    const {default:Display}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
    const container={appendChild(){}};
    const rich=new Display(container,'wss://example.test/native',{clipboard:true,udp:true,protocols:['remotexapp-grant.'+'a'.repeat(64)]});
    rich.sendClipboard([{type:'text/plain',data:Uint8Array.of(97)},{type:'text/html',data:Uint8Array.of(98)}]);
    assert.deepEqual(clipboardCalls[0].mimes,['text/plain','text/html']);
    assert.throws(()=>rich.sendClipboard([{type:'text/rtf',data:Uint8Array.of(97)}]));
    assert.equal(Display.capabilities.clipboardMaxBytes,MAX_RICH_CLIPBOARD_BYTES);
    assert.throws(()=>rich.sendClipboardText('x'.repeat(MAX_RICH_CLIPBOARD_BYTES+1)));
    const rfb=calls[0].rfb;
    rfb.dispatchEvent(new Event('connect'));
    t.mock.timers.tick(1000);
    assert.equal(rfb.refreshes,1);
    rfb.dispatchEvent(new Event('frame'));
    t.mock.timers.tick(4000);
    assert.equal(rfb.refreshes,1);
    assert.equal(clipboardCalls.length,1);rich.disconnect();
    assert.throws(()=>rich.sendClipboardText('retired'));
    const noFrame=new Display(container,'wss://example.test/native');
    const silent=calls[1].rfb;
    silent.dispatchEvent(new Event('connect'));
    for(let i=0;i<5;i++)t.mock.timers.tick(1000);
    assert.equal(silent.refreshes,3);
    noFrame.disconnect();
    const cancelled=new Display(container,'wss://example.test/native');
    calls[2].rfb.dispatchEvent(new Event('connect'));
    cancelled.disconnect();
    t.mock.timers.tick(4000);
    assert.equal(calls[2].rfb.refreshes,0);
    assert.deepEqual(calls[0].options.wsProtocols,['remotexapp-grant.'+'a'.repeat(64)]);
    assert.deepEqual(calls[0].videoCodecs,[]);
    assert.deepEqual(calls[1].options.wsProtocols,['binary']);
    assert.equal(calls[0].url.includes('remotexapp-grant'),false);
  }finally{
    globalThis.document=originalDocument;delete globalThis.__adapterRFB;delete globalThis.REMOTEXAPP_UDP;delete globalThis.__latencyProbe;delete globalThis.__clipboardInputGate;
  }
});

test('retired native input releases its own blur listener even when the browser retains the node', async () => {
  const saved = Object.fromEntries(['document', '__adapterRFB', '__latencyProbe', '__clipboardInputGate', 'REMOTEXAPP_UDP'].map(key => [key, globalThis[key]]));
  const inputs = [];
  let cancels = 0, otherBlurs = 0;
  class Input extends EventTarget {
    style = {};
    listeners = new Set();
    setAttribute() {}
    addEventListener(type, listener, options) {
      if (type === 'blur') this.listeners.add(listener);
      super.addEventListener(type, listener, options);
    }
    removeEventListener(type, listener, options) {
      if (type === 'blur') this.listeners.delete(listener);
      super.removeEventListener(type, listener, options);
    }
    remove() { this.removed = true; }
  }
  globalThis.document = {createElement() { const input = new Input(); inputs.push(input); return input; }};
  globalThis.__adapterRFB = class extends EventTarget {
    constructor() { super(); this._keyboard = {}; }
    disconnect() {}
  };
  globalThis.__latencyProbe = LatencyProbe;
  globalThis.__clipboardInputGate = class { cancel() { cancels++; } };
  globalThis.REMOTEXAPP_UDP = false;
  try {
    const source = readFileSync(new URL('../client-entry.js', import.meta.url), 'utf8')
      .replace("import RFB from './core/rfb.js';", 'const RFB=globalThis.__adapterRFB;')
      .replace("import MouseButtonMapper, {XVNC_BUTTONS} from './core/mousebuttonmapper.js';", 'const MouseButtonMapper=Map, XVNC_BUTTONS={LEFT_BUTTON:1,MIDDLE_BUTTON:2,RIGHT_BUTTON:4,BACK_BUTTON:8,FORWARD_BUTTON:16};')
      .replace("import {normalizePolicy} from './core/input/poc-input-policy.mjs';", 'const normalizePolicy=x=>x;')
      .replace("'./core/remotexapp-native-input.mjs'", JSON.stringify(new URL('../native-input.mjs', import.meta.url).href))
      .replace("'./core/remotexapp-clipboard-order.mjs'", JSON.stringify(new URL('../clipboard-order.mjs', import.meta.url).href))
      .replace("import keysyms from './core/input/keysymdef.js';", 'const keysyms={lookup:x=>x};')
      .replace("'./core/clipboard-payload.mjs'", JSON.stringify(new URL('../clipboard-payload.mjs', import.meta.url).href))
      .replace("import { LatencyProbe } from './core/remotexapp-latency.mjs';", 'const LatencyProbe=globalThis.__latencyProbe;')
      .replace("import { ClipboardInputGate } from './core/remotexapp-clipboard-input.mjs';", 'const ClipboardInputGate=globalThis.__clipboardInputGate;');
    const {default: Display} = await import('data:text/javascript;base64,' + Buffer.from(source + '\n// retained-native-input-regression').toString('base64'));
    const display = new Display({appendChild() {}}, 'wss://example.test/native');
    const retainedInput = inputs[0];
    const unrelated = () => otherBlurs++;
    retainedInput.addEventListener('blur', unrelated);
    retainedInput.dispatchEvent(new Event('blur'));
    assert.equal(cancels, 1, 'live input still cancels pending clipboard keys');
    display.disconnect();
    assert.equal(retainedInput.removed, true);
    assert.equal(retainedInput.listeners.size, 1, 'remove only the adapter-owned listener');
    const cancelledAtRetirement = cancels;
    retainedInput.dispatchEvent(new Event('blur'));
    assert.equal(cancels, cancelledAtRetirement, 'a retained detached node cannot call the retired adapter');
    assert.equal(otherBlurs, 2, 'do not remove another owner\'s listener');
    assert.doesNotThrow(() => display.disconnect());
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
