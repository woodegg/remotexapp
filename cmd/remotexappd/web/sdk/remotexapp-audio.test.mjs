import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {RemoteXAppAudio} from './remotexapp-audio.js';

function fixture() {
  const f={intervals:new Map(),closedPorts:0,stops:0,contextClosed:0};let next=0;
  const port={start(){},close(){f.closedPorts++;},postMessage(m){if(m.op==='init')queueMicrotask(()=>port.onmessage({data:{reply:m.request,value:{protocol:'pcm-s16le-48k-v1'}}}));}};
  f.env={location:{href:'https://audio.test/',origin:'https://audio.test'},crypto:webcrypto,isSecureContext:true,SharedWorker:class{constructor(){this.port=port;}},AudioContext:class{},AudioWorkletNode:class{},
    addEventListener(){},removeEventListener(){},setTimeout,clearTimeout,
    setInterval(fn){const id=++next;f.intervals.set(id,fn);return id;},clearInterval(id){f.intervals.delete(id);}};
  f.audio=new RemoteXAppAudio({environment:f.env});
  f.attachCapture=()=>{
    f.track={onended:null,onmute:null,stop(){f.stops++;}};
    f.audio.stream={getTracks:()=>[f.track]};f.audio.context={state:'running',close(){f.contextClosed++;return Promise.resolve();}};
  };
  f.tick=()=>{for(const fn of f.intervals.values())fn();};
  return f;
}

test('a silently terminated worker releases capture, closes graph and retires the controller',async()=>{
  const original=Date.now;let now=1000;Date.now=()=>now;const f=fixture();
  try{await f.audio.ready;f.attachCapture();for(let i=0;i<11;i++){now+=1000;f.tick();}
    assert.equal(f.stops,1);assert.equal(f.contextClosed,1);assert.equal(f.closedPorts,1);assert.equal(f.audio.closed,true);
    assert.equal(f.audio.stats.connection,'failed');assert.equal(f.audio.stats.reason,'audio-worker-unresponsive');assert.equal(f.intervals.size,0);
    await assert.rejects(f.audio.acquire({id:'app',sessionGeneration:1}),/disposed/);
  }finally{Date.now=original;f.audio.dispose();}
});

test('worker errors stop capture immediately and disposal remains idempotent',async()=>{
  const f=fixture();try{await f.audio.ready;f.attachCapture();f.audio.worker.onerror();f.audio.worker.onerror();f.audio.dispose();
    assert.equal(f.stops,1);assert.equal(f.closedPorts,1);assert.equal(f.audio.stats.reason,'audio-worker-ended');
  }finally{f.audio.dispose();}
});

test('page suspension receives a recovery grace period before the worker watchdog acts',async()=>{
  const original=Date.now;let now=1000;Date.now=()=>now;const f=fixture();
  try{await f.audio.ready;now+=60000;f.tick();assert.equal(f.audio.closed,false);
    for(let i=0;i<9;i++){now+=1000;f.tick();}assert.equal(f.audio.closed,false);
    f.audio._message({type:'ping'});now+=1000;f.tick();assert.equal(f.audio.closed,false);
  }finally{Date.now=original;f.audio.dispose();}
});
