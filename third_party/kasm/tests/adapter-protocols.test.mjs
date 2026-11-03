import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LatencyProbe} from '../latency.mjs';
import {ClipboardInputGate} from '../clipboard-input.mjs';

test('adapter passes the one-use grant through RFB WebSocket options, not video codecs',async()=>{
  const originalDocument=globalThis.document;
  const calls=[];
  globalThis.__adapterRFB=class extends EventTarget {
    constructor(target,input,url,options,videoCodecs){super();calls.push({url,options,videoCodecs});this._keyboard={};}
    disconnect(){}
  };
  globalThis.document={createElement:()=>({setAttribute(){},addEventListener(){},style:{},remove(){}})};
  globalThis.REMOTEXAPP_UDP=true;
  globalThis.__latencyProbe=LatencyProbe;
  globalThis.__clipboardInputGate=ClipboardInputGate;
  try {
    const source=readFileSync(new URL('../client-entry.js',import.meta.url),'utf8')
      .replace("import RFB from './core/rfb.js';",'const RFB=globalThis.__adapterRFB;')
      .replace("import MouseButtonMapper, {XVNC_BUTTONS} from './core/mousebuttonmapper.js';",'const MouseButtonMapper=Map, XVNC_BUTTONS={LEFT_BUTTON:1,MIDDLE_BUTTON:2,RIGHT_BUTTON:4,BACK_BUTTON:8,FORWARD_BUTTON:16};')
      .replace("import {normalizePolicy} from './core/input/poc-input-policy.mjs';",'const normalizePolicy=x=>x;')
      .replace("import { clipboardBytes } from './core/remotexapp-server-messages.mjs';",'const clipboardBytes=x=>new TextEncoder().encode(x);')
      .replace("import { LatencyProbe } from './core/remotexapp-latency.mjs';",'const LatencyProbe=globalThis.__latencyProbe;')
      .replace("import { ClipboardInputGate } from './core/remotexapp-clipboard-input.mjs';",'const ClipboardInputGate=globalThis.__clipboardInputGate;');
    const {default:Display}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
    const container={appendChild(){}};
    new Display(container,'wss://example.test/native',{udp:true,protocols:['remotexapp-grant.'+'a'.repeat(64)]}).disconnect();
    new Display(container,'wss://example.test/native').disconnect();
    assert.deepEqual(calls[0].options.wsProtocols,['remotexapp-grant.'+'a'.repeat(64)]);
    assert.deepEqual(calls[0].videoCodecs,[]);
    assert.deepEqual(calls[1].options.wsProtocols,['binary']);
    assert.equal(calls[0].url.includes('remotexapp-grant'),false);
  }finally{
    globalThis.document=originalDocument;delete globalThis.__adapterRFB;delete globalThis.REMOTEXAPP_UDP;delete globalThis.__latencyProbe;delete globalThis.__clipboardInputGate;
  }
});
