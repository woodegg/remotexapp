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
  f.env={location:{href:'https://audio.test/',origin:'https://audio.test'},crypto:webcrypto,isSecureContext:true,SharedWorker:class{constructor(_url,{name}){this.port=newPort();f.workerNames.push(name);}},MessageChannel:class{constructor(){this.port1=newPort();this.port2={close(){}};}},AudioContext:class{},AudioWorkletNode:class{},
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

test('worker rebind preserves live interests across native cookie refresh under the same principal',async()=>{
  const f=fixture();try{
    f.binding={...f.binding,login:'',principal:'same-principal'};
    const interest=await f.audio.acquire({id:'app',sessionGeneration:1});
    f.audio.worker.onerror();f.binding={...f.binding,scope:'new-native-cookie-scope'};
    await f.audio._ensureWorker();
    assert.equal(interest.released,false);assert.equal(f.audio.interests.size,1);
    assert.equal(f.messages.filter(m=>m.op==='acquire').length,2);
  }finally{await f.audio.dispose();}
});

test('worker rebind never crosses an observed principal change or missing previous correlation',async()=>{
  for(const principal of ['different-principal',undefined]){
    const f=fixture();try{
      f.binding={...f.binding,login:'',principal:'original-principal'};
      const interest=await f.audio.acquire({id:'app',sessionGeneration:1});
      f.audio.worker.onerror();f.binding={...f.binding,service:'new-service',scope:'new-scope',principal};
      await f.audio._ensureWorker();
      assert.equal(interest.released,true);assert.equal(f.audio.interests.size,0);
      assert.equal(f.messages.filter(m=>m.op==='acquire').length,1);
    }finally{await f.audio.dispose();}
  }
});


test('worker termination without a login header restores speaker without reopening microphone',async()=>{
  const f=fixture();
  try {
    f.binding={...f.binding,login:''};
    const interest=await f.audio.acquire({id:'app',sessionGeneration:1});
    f.audio._message({type:'state',connection:'connected',connectionId:'previous',routes:[
      {runtime:'app',generation:1,speaker:true,actualSpeaker:true,mic:true,actualMic:true}
    ]});
    f.attachCapture();
    f.audio.worker.onerror();
    await f.audio.rebind;
    assert.equal(interest.released,false);
    assert.equal(f.workerNames.length,1); // Rebind a logical port, reuse the document hub.
    assert.deepEqual(f.messages.filter(m=>m.op==='restore-speaker').map(m=>m.ref),[interest.ref]);
    assert.equal(f.messages.filter(m=>m.op==='microphone').length,0);
    assert.equal(f.audio.stats.lastDisconnect.code,'audio-worker-ended');
  } finally { f.audio.dispose(); }
});

test('worker replacement follows the latest shared microphone request',async()=>{
  const f=fixture();
  try {
    f.binding={...f.binding,login:''};
    const interest=await f.audio.acquire({id:'app',sessionGeneration:1});
    f.audio._preparePlayback=async()=>{};
    await interest.setSpeaker(true);
    f.audio._context=async()=>({});
    await interest.setMicrophone(true);
    // Another tab disabled this session's microphone before worker loss.
    f.audio._message({type:'state',connection:'connected',routes:[
      {runtime:'app',generation:1,speaker:true,mic:false,actualSpeaker:true,actualMic:false,
        requested:{speaker:true,microphone:false}}
    ]});
    f.audio.worker.onerror();await f.audio.rebind;
    const restore=f.messages.findLast(m=>m.op==='restore-speaker');
    assert.equal(restore.microphoneRequested,false);
    assert.equal(f.messages.filter(m=>m.op==='microphone').length,1);
  }finally{f.audio.dispose();}
});

function graphFixture() {
  const f=fixture();f.nodes=[];f.resumes=0;f.events=[];
  const context=new EventTarget();
  Object.assign(context,{state:'running',resume:async()=>{f.resumes++;context.state='running';context.dispatchEvent(new Event('statechange'));},
    close:async()=>{f.events.push('close');f.contextClosed++;context.state='closed';}});
  f.audio.context=context;
  f.audio.output={gain:{value:1},disconnect(){f.events.push('output-disconnect');}};
  f.node=()=>{
    const node={disconnected:false,closed:false,messages:[],disconnect(){this.disconnected=true;},port:{
      close(){node.closed=true;},postMessage(message){node.messages.push(message);}
    }};
    node.ack=()=>node.port.onmessage?.({data:{type:'disposed'}});f.nodes.push(node);return node;
  };
  f.attach=()=>{
    f.track={stop(){f.stops++;f.events.push('track-stop');}};
    f.audio.stream={getTracks:()=>[f.track]};f.audio.capture=f.node();
    f.audio.captureSource={disconnect(){f.events.push('source-disconnect');}};
  };
  return f;
}

test('transport delivery fencing disables a live track without retiring its source',async()=>{
  const f=graphFixture();await f.audio.ready;f.attach();
  f.track.readyState='live';f.track.enabled=true;f.track.muted=false;
  f.audio.stream.getAudioTracks=()=>[f.track];f.audio.captureToken='current-token';
  const source=f.audio.stream,node=f.audio.capture;
  f.audio._message({type:'capture-delivery',token:'current-token',delivery:null});
  assert.equal(f.track.enabled,false);assert.equal(f.stops,0);assert.equal(f.audio.stream,source);
  assert.deepEqual(node.messages.at(-1),{op:'delivery',delivery:null});
  f.audio._message({type:'capture-delivery',token:'old-token',delivery:'old-delivery'});
  assert.equal(f.track.enabled,false);
  f.audio._message({type:'capture-delivery',token:'current-token',delivery:'fresh-delivery'});
  assert.equal(f.track.enabled,true);assert.equal(f.stops,0);assert.equal(f.audio.capture,node);
  const disposed=f.audio.dispose();node.ack();await disposed;assert.equal(f.stops,1);
});

test('audio disposal synchronously fences capture then joins terminal ACKs and context close',async()=>{
  const f=graphFixture();await f.audio.ready;f.attach();f.audio.playback=f.node();
  const oldEpoch=f.audio.captureEpoch;
  const pending=f.audio.dispose();
  assert.equal(f.audio.dispose(),pending);assert.equal(f.stops,1);
  assert.ok(f.audio.captureEpoch>oldEpoch);assert.equal(f.audio.output,null);
  assert.equal(f.contextClosed,0);assert.equal(f.nodes.every(n=>!n.disconnected),true);
  assert.ok(f.nodes.every(n=>n.messages[0].op==='dispose'));
  f.nodes[0].ack();assert.equal(f.contextClosed,0);
  f.nodes[1].ack();await pending;
  assert.equal(f.contextClosed,1);assert.equal(f.audio.retirements.size,0);
  assert.ok(f.nodes.every(n=>n.closed&&n.disconnected&&n.port.onmessage===null));
  assert.equal(f.events[0],'track-stop');assert.deepEqual(f.audio.retirementErrors,[]);
  await assert.rejects(f.audio._context(),/disposed/);
});

test('suspended capture retirement waits for the next authorized resume without resuming playback',async()=>{
  const f=graphFixture();await f.audio.ready;f.attach();const context=f.audio.context;context.state='suspended';
  f.audio._stopCapture();assert.equal(f.stops,1);assert.equal(f.resumes,0);
  assert.equal(f.audio.retirements.size,1);assert.equal(f.nodes[0].disconnected,false);
  await context.resume();f.nodes[0].ack();await Promise.resolve();
  assert.equal(f.audio.retirements.size,0);assert.equal(context.state,'running');
  await f.audio.dispose();
});

test('final suspended disposal drains only a muted graph after synchronously stopping capture',async()=>{
  const f=graphFixture();await f.audio.ready;f.attach();f.audio.playback=f.node();
  f.audio.context.state='suspended';const output=f.audio.output;
  f.audio.context.resume=async()=>{
    assert.equal(f.stops,1);assert.equal(output.gain.value,0);f.resumes++;
  };
  const done=f.audio.dispose();assert.equal(f.resumes,1);
  f.nodes.forEach(n=>n.ack());await done;assert.equal(f.contextClosed,1);
});

test('missing terminal ACK is bounded, closes the context and reports incomplete retirement',async()=>{
  const f=graphFixture();await f.audio.ready;f.audio.playback=f.node();
  const timers=[];f.audio.env.setTimeout=fn=>{timers.push(fn);return timers.length;};f.audio.env.clearTimeout=()=>{};
  const done=f.audio.dispose();timers.forEach(fn=>fn());
  await assert.rejects(done,/retirement incomplete/);
  assert.equal(f.contextClosed,1);assert.equal(f.nodes[0].closed,true);
  assert.equal(f.audio.dispose(),done);
});

test('late microphone permission after disposal stops the track without creating a processor',async()=>{
  const f=graphFixture();await f.audio.ready;let granted;
  f.audio._context=async()=>f.audio.context;
  f.audio.env.navigator={mediaDevices:{getUserMedia:()=>new Promise(r=>{granted=r;})}};
  f.audio.captureAllowed=true;const capture=f.audio._startCapture('old');
  await f.audio.dispose();granted({getTracks:()=>[{stop(){f.stops++;}}]});await capture;
  assert.equal(f.stops,1);assert.equal(f.nodes.length,0);assert.equal(f.audio.stream,null);
});

test('direct audio logout fences all handles immediately and awaits native retirement',async()=>{
  const f=graphFixture();await f.audio.ready;
  const interest=await f.audio.acquire({id:'app',sessionGeneration:1});f.attach();
  const done=f.audio.logout();assert.equal(f.stops,1);assert.equal(interest.released,true);
  assert.equal(f.audio.logout(),done);
  await assert.rejects(interest.setMicrophone(true),/released/);
  await assert.rejects(f.audio.acquire({id:'app',sessionGeneration:1}),/logging out/);
  f.nodes[0].ack();await done;assert.equal(f.contextClosed,1);
});

test('capture retirement pauses its ACK deadline while suspended, final disposal bounds a blocked resume',async()=>{
  const f=graphFixture();await f.audio.ready;f.attach();const context=f.audio.context;
  const timers=new Map();let next=0;
  f.audio.env.setTimeout=fn=>{timers.set(++next,fn);return next;};
  f.audio.env.clearTimeout=id=>timers.delete(id);
  f.audio._stopCapture();assert.equal(timers.size,1);
  context.state='suspended';context.dispatchEvent(new Event('statechange'));
  assert.equal(timers.size,0);assert.equal(f.resumes,0);
  context.resume=()=>new Promise(()=>{});
  const done=f.audio.dispose();assert.equal(timers.size,1);
  for(const fn of timers.values())fn();
  await assert.rejects(done,/retirement incomplete/);
  assert.equal(f.contextClosed,1);assert.equal(f.audio.retirements.size,0);
});

test('disposal during Worklet loading fences late speaker activation without constructing a node',async()=>{
  const f=fixture();await f.audio.ready;let loaded,constructed=0;
  f.audio.env.AudioContext=class {
    constructor(){this.sampleRate=48000;this.state='running';this.audioWorklet={addModule:()=>new Promise(resolve=>{loaded=resolve;})};}
    createGain(){return {gain:{value:1},connect(){},disconnect(){}};}
    async resume(){}
    async close(){f.contextClosed++;this.state='closed';}
  };
  f.audio.env.AudioWorkletNode=class {constructor(){constructed++;}};
  const interest=await f.audio.acquire({id:'app',sessionGeneration:1});
  const activation=interest.setSpeaker(true);await f.audio.dispose();loaded();
  await assert.rejects(activation,/retired/);
  assert.equal(constructed,0);assert.equal(f.contextClosed,1);assert.equal(interest.released,true);
});
