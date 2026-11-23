import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {RemoteXAppAudio} from './remotexapp-audio.js';

function fixture() {
  const f={intervals:new Map(),closedPorts:0,stops:0,contextClosed:0};let next=0;
  f.messages=[];f.workerNames=[];f.binding={service:'service',scope:'scope',login:'login'};
  function newPort(){
    const port={start(){},close(){f.closedPorts++;},postMessage(m){
      f.messages.push(m);if(m.request)queueMicrotask(()=>port.onmessage?.({data:{reply:m.request,value:m.op==='init'?{protocol:'pcm-s16le-48k-v1',binding:f.binding}:{speaker:true}}}));
    }};
    return port;
  }
  f.env={location:{href:'https://audio.test/',origin:'https://audio.test'},crypto:webcrypto,isSecureContext:true,SharedWorker:class{constructor(_url,{name}){this.port=newPort();f.workerNames.push(name);}},AudioContext:class{},AudioWorkletNode:class{},
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

test('a silently terminated worker stops capture and a click rebinds the same interest',async()=>{
  const original=Date.now;let now=1000;Date.now=()=>now;const f=fixture();
  try{await f.audio.ready;const interest=await f.audio.acquire({id:'app',sessionGeneration:1});f.attachCapture();for(let i=0;i<11;i++){now+=1000;f.tick();}
    assert.equal(f.stops,1);assert.equal(f.closedPorts,1);assert.equal(f.audio.closed,false);assert.equal(interest.released,false);
    assert.equal(f.audio.stats.connection,'failed');assert.equal(f.audio.stats.reason,'audio-worker-unresponsive');assert.equal(f.intervals.size,1);
    assert.equal(f.messages.filter(m=>m.op==='microphone').length,0);
    f.audio._preparePlayback=async()=>{};
    assert.equal((await interest.setSpeaker(true)).speaker,true);
    assert.deepEqual(f.messages.filter(m=>m.op==='acquire').map(m=>m.ref),[interest.ref,interest.ref]);
    await interest.release();
    await assert.rejects(interest.setSpeaker(true),/released/);
  }finally{Date.now=original;f.audio.dispose();}
});

test('worker errors stop capture immediately and disposal remains idempotent',async()=>{
  const f=fixture();try{await f.audio.ready;f.attachCapture();const fail=f.audio.worker.onerror;fail();fail();f.audio.dispose();
    assert.equal(f.stops,1);assert.equal(f.closedPorts,1);assert.equal(f.audio.stats.reason,'audio-worker-ended');
  }finally{f.audio.dispose();}
});

test('page suspension receives a recovery grace period before the worker watchdog acts',async()=>{
  const original=Date.now;let now=1000;Date.now=()=>now;const f=fixture();
  try{await f.audio.ready;now+=60000;f.tick();assert.ok(f.audio.port);
    for(let i=0;i<9;i++){now+=1000;f.tick();}assert.ok(f.audio.port);
    f.audio._message({type:'ping'});now+=1000;f.tick();assert.equal(f.audio.closed,false);
  }finally{Date.now=original;f.audio.dispose();}
});


test('worker replacement rejects an old interest after same-account re-login',async()=>{
  const f=fixture();try{
    const interest=await f.audio.acquire({id:'app',sessionGeneration:1});
    f.audio.worker.onerror();f.binding={...f.binding,scope:'different',login:'new-login'};
    f.audio._preparePlayback=async()=>{};
    await assert.rejects(interest.setSpeaker(true),/released/);
    assert.equal(f.messages.filter(m=>m.op==='speaker').length,0);
  }finally{f.audio.dispose();}
});


test('worker termination reopens the same shared name and replays authenticated speaker only',async()=>{
  const f=fixture();
  try {
    const interest=await f.audio.acquire({id:'app',sessionGeneration:1});
    f.audio._message({type:'state',connection:'connected',connectionId:'previous',routes:[
      {runtime:'app',generation:1,speaker:true,actualSpeaker:true,mic:true,actualMic:true}
    ]});
    f.attachCapture();
    f.audio.worker.onerror();
    await f.audio.rebind;
    assert.equal(interest.released,false);
    assert.equal(f.workerNames.length,2);
    assert.equal(f.workerNames[0],f.workerNames[1]);
    assert.deepEqual(f.messages.filter(m=>m.op==='restore-speaker').map(m=>m.ref),[interest.ref]);
    assert.equal(f.messages.filter(m=>m.op==='microphone').length,0);
    assert.equal(f.audio.stats.lastDisconnect.code,'audio-worker-ended');
  } finally { f.audio.dispose(); }
});
