import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {MessageChannel} from 'node:worker_threads';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {AudioCoordinator} from './audio-coordinator.js';
import {RemoteXAppAudio} from './remotexapp-audio.js';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
async function until(fn){const end=performance.now()+3000;while(performance.now()<end){if(fn())return;await new Promise(resolve=>setTimeout(resolve,2));}throw Error('state did not settle');}
function fixture(t){
 const f={docs:[],cores:new Map(),sockets:[],nodes:[],values:new Map(),service:'b'.repeat(64),scope:'a'.repeat(64),principal:'c'.repeat(64),events:[],gum:0};let sequence=0,locks=Promise.resolve();
 class Socket {
  constructor(){this.readyState=1;this.bufferedAmount=0;this.sent=[];f.sockets.push(this);queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({type:'connected',connection:'connection-'+(++sequence)})}));}
  send(data){this.sent.push(data);if(typeof data!=='string')return;const cmd=JSON.parse(data);f.events.push('route:'+cmd.op);
   queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({type:cmd.op==='unsubscribe'?'ack':'state',request:cmd.request,slot:cmd.slot,speaker:!!cmd.speaker,mic:!!cmd.mic&&!f.conflict,reason:cmd.mic&&f.conflict?'mic-conflict':'',domain:'d'.repeat(32)})}));}
  close(){if(this.readyState===3)return;this.readyState=3;queueMicrotask(()=>this.onclose?.());}
 }
 function coordinator(){return new AudioCoordinator({crypto:webcrypto,location:{origin:'https://audio.test'},WebSocket:Socket,setInterval:()=>0,setTimeout,clearTimeout,
  fetch:async(url,options)=>{
   if(f.offline)throw TypeError('network unavailable');const action=url.split('/').at(-1),body=JSON.parse(options.body);f.events.push('http:'+action);
   if(f.accessDenied)return {ok:false,status:401,json:async()=>({error:'current ingress access required'})};
   if(action==='route'&&body.runtime===f.unavailable)return {ok:false,status:409,json:async()=>({error:'session audio unavailable'})};
   return {ok:true,json:async()=>action==='context'?{scope:f.scope,service:f.service,principal:f.principal,login:'',protocol:'pcm-s16le-48k-v1'}:action==='grant'||action==='route'?{token:'e'.repeat(64),domain:'d'.repeat(32)}:{ok:true}};
  }});}
 f.makeDoc=()=>{
  const doc={captures:0,bootstraps:0,streams:[],contexts:[],listeners:new Map(),timers:new Map(),permission:Object.assign(new EventTarget(),{state:'granted'})};f.docs.push(doc);
  const env={location:{href:'https://audio.test/',origin:'https://audio.test'},crypto:webcrypto,isSecureContext:true,MessageChannel,setTimeout,clearTimeout,
   setInterval(fn){const key=++sequence;doc.timers.set(key,fn);return key;},clearInterval(key){doc.timers.delete(key);},document:Object.assign(new EventTarget(),{visibilityState:'visible'}),
   addEventListener(name,fn){if(!doc.listeners.has(name))doc.listeners.set(name,new Set());doc.listeners.get(name).add(fn);},removeEventListener(name,fn){doc.listeners.get(name)?.delete(fn);},
   localStorage:{getItem:key=>f.values.get(key)??null,setItem(key,value){f.values.set(key,value);for(const other of f.docs)if(other!==doc)queueMicrotask(()=>{for(const fn of other.listeners.get('storage')||[])fn({key});});}},
   navigator:{locks:{request(_key,options,fn){const run=fn || options,p=locks.then(run);locks=p.catch(()=>{});return p;}},permissions:{query:async()=>doc.permission},mediaDevices:Object.assign(new EventTarget(),{getUserMedia:async()=>{
    doc.captures++;f.gum++;f.events.push('device');if(doc.failDevice)throw new DOMException('device unavailable','NotFoundError');
    const track={readyState:'live',muted:false,enabled:true,stop(){this.readyState='ended';}},stream={getTracks:()=>[track],getAudioTracks:()=>[track]};doc.streams.push(stream);return stream;
   }})}};
  env.SharedWorker=class {
   constructor(_url,{name}){
    doc.bootstraps++;
    let core=f.cores.get(name);if(!core){core={coordinator:coordinator(),clients:[]};f.cores.set(name,core);}core.clients.push(this);
    this.port={start(){},close(){},postMessage:({port})=>{if(core.terminated || f.hangWorkers)port.close();else core.coordinator.add(port);}};
   }
  };
  env.AudioContext=class extends EventTarget {
   constructor(){super();doc.contextAttempts=(doc.contextAttempts || 0)+1;if(doc.contextFailures>0){doc.contextFailures--;throw new DOMException('controlled Context construction failure','NotSupportedError');}doc.contexts.push(this);this.state='running';this.sampleRate=48000;this.destination={};this.audioWorklet={addModule:async()=>{if(doc.moduleFailures>0){doc.moduleFailures--;throw new DOMException('controlled module failure','AbortError');}if(doc.loadModule)return doc.loadModule(this);}};}
   createGain(){return {gain:{value:1},connect(){},disconnect(){}};}
   createMediaStreamSource(){return {connect(){},disconnect(){}};}
   async resume(){this.state='running';this.onstatechange?.();this.dispatchEvent(new Event('statechange'));}
   async suspend(){this.state='suspended';this.onstatechange?.();this.dispatchEvent(new Event('statechange'));}
   async close(){this.state='closed';this.onstatechange?.();this.dispatchEvent(new Event('statechange'));}
  };
  const classes=new Map();class Base{constructor(){this.port={};}}
  vm.runInNewContext(readFileSync(new URL('./audio-worklet.js',import.meta.url),'utf8'),{AudioWorkletProcessor:Base,registerProcessor:(name,Class)=>classes.set(name,Class),Float32Array,Int16Array,ArrayBuffer,Math,Map});
  env.AudioWorkletNode=class {
   constructor(_context,name){this.processor=new(classes.get(name))();this.name=name;this.closed=false;f.nodes.push(this);
    this.port={postMessage:data=>queueMicrotask(()=>{this.processor.port.onmessage?.({data});if(data.op==='dispose')this.processor.process([],[[new Float32Array(128)]]);}),close:()=>{this.closed=true;}};
    this.processor.port.postMessage=data=>queueMicrotask(()=>this.port.onmessage?.({data}));
   }
   connect(){}disconnect(){}
  };
  doc.env=env;doc.audio=new RemoteXAppAudio({environment:env});return doc;
 };
 f.tick=async()=>{for(const core of f.cores.values())core.coordinator._tick();for(const doc of f.docs)for(const fn of doc.timers.values())fn();await turn();await turn();};
 f.killWorker=({silent=false}={})=>{
  const old=[...f.cores.entries()];f.cores.clear();for(const [,core] of old){
   core.terminated=true;
   core.coordinator._disconnect('actual-worker-exit-model');for(const peer of core.coordinator.ports.values())peer.port.close();core.coordinator.ports.clear();core.coordinator._stopCapture('actual-worker-exit-model');
   if(!silent)for(const worker of core.clients)worker.onerror?.();
  }
 };
 f.route=doc=>doc.audio.stats.routes[0];
 t.after(async()=>{
  await Promise.all(f.docs.map(doc=>doc.audio.dispose()));await turn();
  for(const core of f.cores.values()){core.coordinator._retire('test-complete');for(const peer of core.coordinator.ports.values())peer.port.close();core.coordinator.ports.clear();}
 });
 return f;
}

test('owner/coordinator/journal/worklet model rebinds a live source after Worker replacement',async t=>{
 const f=fixture(t),doc=f.makeDoc(),interest=await doc.audio.acquire({id:'app',sessionGeneration:1});
 await interest.setSpeaker(true);await interest.setMicrophone(true);await until(()=>f.route(doc)?.actualMic);
 assert.equal(f.gum,1);assert(f.events.indexOf('route:subscribe')<f.events.indexOf('device'));
 const source=doc.audio.stream,node=doc.audio.capture;
 f.killWorker();await until(()=>doc.audio.port&&f.route(doc)?.actualMic&&f.sockets.length===2);
 assert.equal(doc.audio.stream,source);assert.equal(doc.audio.capture,node);assert.equal(f.gum,1);
 assert.equal(source.getAudioTracks()[0].enabled,true);assert.equal(interest.released,false);
});

test('repeated silent exits require a fresh native bootstrap and retain the same live source and processor',async t=>{
 const f=fixture(t),doc=f.makeDoc(),interest=await doc.audio.acquire({id:'app',sessionGeneration:1});
 // Shorten only the init deadline; an old native bootstrap deliberately drops
 // attached ports after silent termination instead of resurrecting its Worker.
 doc.env.setTimeout=(fn,ms)=>setTimeout(fn,ms===7000?25:ms);
 await interest.setSpeaker(true);await interest.setMicrophone(true);await until(()=>f.route(doc)?.actualMic);
 const source=doc.audio.stream,node=doc.audio.capture;
 for(let i=0;i<20;i++){
  f.killWorker({silent:true});assert.equal(doc.audio.port!==null,true,'silent exit has no native error callback');
  doc.audio._fail('audio-worker-unresponsive');
  await until(()=>doc.audio.port&&f.route(doc)?.actualMic&&f.sockets.length===i+2);
  assert.equal(doc.audio.stream,source);assert.equal(doc.audio.capture,node);assert.equal(f.gum,1);
  assert.equal(doc.audio.workerGeneration,0);assert.equal(doc.audio.workerExhausted,undefined);
  const hubs=doc.env[Symbol.for('remotexapp.audio-worker-hubs.v8')];
  assert.equal(hubs.size,1);assert.equal([...hubs.values()][0].clients.size,1);
  assert.equal(f.cores.size,1);assert.equal([...f.cores.values()][0].clients.length,1);
 }
 assert.equal(interest.released,false);assert.equal(source.getAudioTracks()[0].enabled,true);
});

test('two unresponsive recovery names block within four native bootstraps and an explicit off still cancels intent',async t=>{
 const f=fixture(t),doc=f.makeDoc(),interest=await doc.audio.acquire({id:'app',sessionGeneration:1});
 doc.env.setTimeout=(fn,ms)=>setTimeout(fn,ms===7000?25:ms);
 await interest.setMicrophone(true);await until(()=>f.route(doc)?.actualMic);
 const source=doc.audio.stream;
 f.killWorker({silent:true});f.hangWorkers=true;doc.audio._fail('audio-worker-unresponsive');
 await until(()=>doc.audio.workerExhausted && doc.audio.stats.connection==='blocked');
 assert.equal(doc.bootstraps,4);assert.equal(f.gum,1);assert.equal(source.getAudioTracks()[0].enabled,false);
 for(let i=0;i<20;i++){doc.audio._wake();await f.tick();}
 assert.equal(doc.bootstraps,4);assert.equal(f.gum,1);
 await interest.setMicrophone(false);assert.equal(doc.audio.stream,null);
 assert.equal(doc.audio.journal.read('app',1,'microphone').enabled,false);
});

test('off during a silent-exit rebind prevents microphone replay and releases the retained source',async t=>{
 const f=fixture(t),doc=f.makeDoc(),interest=await doc.audio.acquire({id:'app',sessionGeneration:1});
 doc.env.setTimeout=(fn,ms)=>setTimeout(fn,ms===7000?25:ms);
 await interest.setSpeaker(true);await interest.setMicrophone(true);await until(()=>f.route(doc)?.actualMic);
 f.killWorker({silent:true});doc.audio._fail('audio-worker-unresponsive');
 await interest.setMicrophone(false);
 await until(()=>doc.audio.port&&f.route(doc)?.actualSpeaker&&f.sockets.length===2);
 assert.equal(f.route(doc).requested.microphone,false);assert.equal(f.route(doc).actualMic,false);
 assert.equal(doc.audio.stream,null);assert.equal(f.gum,1);
});

test('two participating documents rebind a silently dead Worker without retaining an unused source',async t=>{
 const f=fixture(t),a=f.makeDoc(),b=f.makeDoc();
 for(const doc of [a,b])doc.env.setTimeout=(fn,ms)=>setTimeout(fn,ms===7000?25:ms);
 const first=await a.audio.acquire({id:'app',sessionGeneration:1}),second=await b.audio.acquire({id:'app',sessionGeneration:1});
 await first.setMicrophone(true);await second.setMicrophone(true);await until(()=>f.route(a)?.actualMic&&f.route(b)?.actualMic);
 assert.equal(f.gum,1);
 for(let i=0;i<5;i++){
  f.killWorker({silent:true});a.audio._fail('audio-worker-unresponsive');b.audio._fail('audio-worker-unresponsive');
  await until(()=>a.audio.port&&b.audio.port&&f.route(a)?.actualMic&&f.route(b)?.actualMic&&f.sockets.length===i+2);
  assert.equal([...a.streams,...b.streams].filter(s=>s.getAudioTracks()[0].readyState==='live').length,1);
  assert.equal(f.cores.size,1);
 }
 assert.equal(first.released,false);assert.equal(second.released,false);
});

test('ended capture is reacquired automatically under granted permission after fresh route authorization',async t=>{
 const f=fixture(t),doc=f.makeDoc(),interest=await doc.audio.acquire({id:'app',sessionGeneration:1});
 await interest.setMicrophone(true);await until(()=>f.route(doc)?.actualMic);
 const old=doc.audio.stream.getAudioTracks()[0];old.readyState='ended';old.onended();
 await until(()=>!f.route(doc)?.actualMic);assert.equal(f.route(doc).requested.microphone,true);
 for(const core of f.cores.values())for(const peer of core.coordinator.ports.values())peer.captureRetryAfter=0;
 await f.tick();await until(()=>f.route(doc)?.actualMic);
 assert.equal(f.gum,2);assert.notEqual(doc.audio.stream.getAudioTracks()[0],old);
 assert(f.events.lastIndexOf('http:route')<f.events.lastIndexOf('device'));
});

test('permission revocation blocks capture, a grant resumes valid intent, and explicit off forbids later recovery',async t=>{
 const f=fixture(t),doc=f.makeDoc(),interest=await doc.audio.acquire({id:'app',sessionGeneration:1});
 await interest.setMicrophone(true);await until(()=>f.route(doc)?.actualMic);
 doc.permission.state='prompt';doc.permission.dispatchEvent(new Event('change'));
 await until(()=>!f.route(doc)?.actualMic);await f.tick();assert.equal(f.gum,1);
 doc.permission.state='granted';doc.permission.dispatchEvent(new Event('change'));
 await f.tick();await until(()=>f.route(doc)?.actualMic);assert.equal(f.gum,2);
 await interest.setMicrophone(false);await until(()=>!f.route(doc)?.requested.microphone);
 doc.permission.dispatchEvent(new Event('change'));f.killWorker();await f.tick();
 assert.equal(f.gum,2);assert.equal(doc.audio.stream,null);
});

test('other-document off/on invalidates old participation even across Worker loss',async t=>{
 const f=fixture(t),a=f.makeDoc(),b=f.makeDoc();
 const first=await a.audio.acquire({id:'app',sessionGeneration:1}),second=await b.audio.acquire({id:'app',sessionGeneration:1});
 await first.setMicrophone(true);await until(()=>f.route(a)?.actualMic);
 await second.setMicrophone(false);await second.setMicrophone(true);await until(()=>f.route(b)?.actualMic);
 await until(()=>a.audio.stream===null);
 const oldCount=a.captures;f.killWorker();await until(()=>f.route(b)?.actualMic&&f.sockets.length>=2);
 assert.equal(a.captures,oldCount);assert.equal(a.audio.stream,null);assert.equal(b.captures,1);
});

test('an unavailable domain recovers without a device reopen or changing a healthy peer delivery fence',async t=>{
 const f=fixture(t),doc=f.makeDoc(),a=await doc.audio.acquire({id:'app',sessionGeneration:1}),b=await doc.audio.acquire({id:'other',sessionGeneration:1});
 await a.setMicrophone(true);await b.setMicrophone(true);await until(()=>doc.audio.stats.routes.every(r=>r.actualMic));
 const core=[...f.cores.values()][0].coordinator,token=core.capture.delivery;
 f.unavailable='app';core._serverMessage({type:'state',slot:1,speaker:false,mic:false,reason:'domain-retired'});
 await f.tick();await until(()=>doc.audio.stats.routes.find(r=>r.runtime==='app')?.reason==='session-audio-unavailable');
 assert.equal(core.capture.delivery,token);assert.equal(f.gum,1);
 assert.equal(doc.audio.stats.routes.find(r=>r.runtime==='other').actualMic,true);
 f.unavailable=null;core.routes.get('app:1').micRetryAfter=0;
 await f.tick();await until(()=>doc.audio.stats.routes.every(r=>r.actualMic));
 assert.equal(f.gum,1);assert.equal(core.capture.delivery,token);
});

test('device recovery cannot replay a switch turned off while acquisition is pending',async t=>{
 const f=fixture(t),doc=f.makeDoc(),interest=await doc.audio.acquire({id:'app',sessionGeneration:1});
 await interest.setMicrophone(true);await until(()=>f.route(doc)?.actualMic);
 const old=doc.audio.stream.getAudioTracks()[0];old.readyState='ended';old.onended();await until(()=>!f.route(doc)?.actualMic);
 let grant;doc.env.navigator.mediaDevices.getUserMedia=()=>new Promise(r=>{grant=r;});
 const core=[...f.cores.values()][0].coordinator;for(const peer of core.ports.values())peer.captureRetryAfter=0;
 await f.tick();await until(()=>!!grant);
 const off=interest.setMicrophone(false);await turn();
 const track={readyState:'live',stop(){this.readyState='ended';}};
 grant({getTracks:()=>[track],getAudioTracks:()=>[track]});await off;
 await until(()=>track.readyState==='ended');assert.equal(doc.audio.stream,null);
 assert.equal(f.route(doc).requested.microphone,false);assert.equal(f.route(doc).actualMic,false);
});

test('temporary access rejection preserves intent but stops capture until fresh same-principal access',async t=>{
 const f=fixture(t),doc=f.makeDoc(),interest=await doc.audio.acquire({id:'app',sessionGeneration:1});
 await interest.setSpeaker(true);await interest.setMicrophone(true);await until(()=>f.route(doc)?.actualMic);
 f.accessDenied=true;f.sockets[0].close();
 await until(()=>!f.route(doc)?.actualMic);for(const core of f.cores.values())core.coordinator.retryAfter=0;
 await f.tick();await until(()=>doc.audio.stats.connection==='blocked');
 assert.equal(doc.audio.stream,null);assert.equal(interest.released,false);assert.equal(f.route(doc).requested.microphone,true);
 f.accessDenied=false;for(const core of f.cores.values())core.coordinator.retryAfter=0;
 await f.tick();await until(()=>f.route(doc)?.actualMic);assert.equal(f.gum,2);assert.equal(interest.released,false);
});

test('fresh access for a different observed principal retires old intent instead of reacquiring a device',async t=>{
 const f=fixture(t),doc=f.makeDoc(),interest=await doc.audio.acquire({id:'app',sessionGeneration:1});
 await interest.setMicrophone(true);await until(()=>f.route(doc)?.actualMic);
 f.sockets[0].close();f.principal='f'.repeat(64);f.service='e'.repeat(64);f.scope='d'.repeat(64);
 await turn();
 for(const core of f.cores.values())core.coordinator.retryAfter=0;
 await f.tick();await until(()=>interest.released);assert.equal(f.gum,1);assert.equal(doc.audio.stream,null);
});

test('temporary track mute waits for actual unmute and reuses the source without a device reopen',async t=>{
 const f=fixture(t),doc=f.makeDoc(),interest=await doc.audio.acquire({id:'app',sessionGeneration:1});
 await interest.setMicrophone(true);await until(()=>f.route(doc)?.actualMic);
 const stream=doc.audio.stream,node=doc.audio.capture,track=stream.getAudioTracks()[0];
 track.muted=true;track.onmute();await until(()=>!f.route(doc)?.actualMic);
 await f.tick();assert.equal(doc.audio.stream,stream);assert.equal(track.readyState,'live');assert.equal(track.enabled,true);assert.equal(f.gum,1);
 track.muted=false;track.onunmute();await f.tick();await until(()=>f.route(doc)?.actualMic);
 assert.equal(f.gum,1);assert.equal(doc.audio.stream,stream);assert.equal(doc.audio.capture,node);
});

test('local off cancels every same-owner reference even when shared metadata is unreadable',async t=>{
 const f=fixture(t),doc=f.makeDoc(),a=await doc.audio.acquire({id:'app',sessionGeneration:1});
 await a.setMicrophone(true);const b=await doc.audio.acquire({id:'app',sessionGeneration:1});await b.setMicrophone(true);
 await until(()=>f.route(doc)?.actualMic);
 f.values.set(doc.audio.journal.key,'corrupt');await a.setMicrophone(false);
 await until(()=>!f.route(doc)?.requested.microphone);assert.equal(doc.audio.stream,null);
 f.killWorker();await f.tick();assert.equal(f.gum,1);
});

test('off during the post-acquisition permission check stops the late stream before constructing a processor',async t=>{
 const f=fixture(t),doc=f.makeDoc(),interest=await doc.audio.acquire({id:'app',sessionGeneration:1});
 await interest.setMicrophone(true);await until(()=>f.route(doc)?.actualMic);
 const old=doc.audio.stream.getAudioTracks()[0];old.readyState='ended';old.onended();await until(()=>!f.route(doc)?.actualMic);
 let checks=0,checked;doc.audio._permission=async()=>++checks===2?new Promise(resolve=>{checked=resolve;}):'granted';
 const fresh={readyState:'live',stop(){this.readyState='ended';}};
 doc.env.navigator.mediaDevices.getUserMedia=async()=>({getTracks:()=>[fresh],getAudioTracks:()=>[fresh]});
 const core=[...f.cores.values()][0].coordinator;for(const peer of core.ports.values())peer.captureRetryAfter=0;
 const before=f.nodes.length;await f.tick();await until(()=>!!checked);
 const off=interest.setMicrophone(false);await until(()=>!f.route(doc)?.requested.microphone);
 checked('granted');await off;await until(()=>fresh.readyState==='ended');
 assert.equal(doc.audio.stream,null);assert.equal(f.nodes.length,before);
});

test('browser focus mute after background device release does not deadlock a still-live source disabled by the SDK',async t=>{
 const f=fixture(t),doc=f.makeDoc(),interest=await doc.audio.acquire({id:'app',sessionGeneration:1});
 await interest.setMicrophone(true);await until(()=>f.route(doc)?.actualMic);
 const source=doc.audio.stream,track=source.getAudioTracks()[0];let enabled=track.enabled;
 Object.defineProperty(track,'enabled',{get:()=>enabled,set:value=>{
  enabled=value;
  if(value && doc.env.document.visibilityState==='hidden')queueMicrotask(()=>{track.muted=true;track.onmute?.();});
 }});
 doc.env.document.visibilityState='hidden';f.sockets[0].close();await until(()=>!f.route(doc)?.actualMic);
 for(const core of f.cores.values())core.coordinator.retryAfter=0;
 await f.tick();await until(()=>track.muted);assert.equal(track.enabled,true);assert.equal(f.gum,1);
 doc.env.document.visibilityState='visible';
 // Model the UA's unmute-on-view transition only while the track is enabled.
 assert.equal(track.enabled,true);track.muted=false;track.onunmute();
 await f.tick();await until(()=>f.route(doc)?.actualMic);
 assert.equal(f.gum,1);assert.equal(doc.audio.stream,source);
});

test('a temporarily suspended Context resumes valid speaker and mic intent without stopping its source',async t=>{
 const f=fixture(t),doc=f.makeDoc(),interest=await doc.audio.acquire({id:'app',sessionGeneration:1});
 await interest.setSpeaker(true);await interest.setMicrophone(true);await until(()=>f.route(doc)?.actualMic);
 const source=doc.audio.stream,processor=doc.audio.capture,context=doc.audio.context;
 await context.suspend();await until(()=>!f.route(doc)?.actualMic);
 assert.equal(source.getAudioTracks()[0].readyState,'live');assert.equal(f.gum,1);
 await f.tick();await until(()=>f.route(doc)?.actualMic&&f.route(doc)?.actualSpeaker);
 assert.equal(doc.audio.context,context);assert.equal(doc.audio.stream,source);assert.equal(doc.audio.capture,processor);assert.equal(f.gum,1);
});

test('a transient Context construction failure does not strand the first speaker intent',async t=>{
 const f=fixture(t),doc=f.makeDoc(),interest=await doc.audio.acquire({id:'app',sessionGeneration:1});doc.contextFailures=1;
 await assert.rejects(interest.setSpeaker(true),/controlled Context construction failure/);
 assert.equal(doc.contexts.length,0);await f.tick();await until(()=>f.route(doc)?.actualSpeaker);
 assert.equal(doc.contextAttempts,2);assert.equal(doc.contexts.length,1);assert.equal(f.gum,0);
});

test('an externally closed Context rebuilds both graphs around the same live microphone source',async t=>{
 const f=fixture(t),doc=f.makeDoc(),interest=await doc.audio.acquire({id:'app',sessionGeneration:1});
 await interest.setSpeaker(true);await interest.setMicrophone(true);await until(()=>f.route(doc)?.actualMic);
 const source=doc.audio.stream,processor=doc.audio.capture,context=doc.audio.context;
 await context.close();await until(()=>!f.route(doc)?.actualMic);
 await f.tick();await until(()=>f.route(doc)?.actualMic&&f.route(doc)?.actualSpeaker);
 assert.notEqual(doc.audio.context,context);assert.notEqual(doc.audio.capture,processor);
 assert.equal(doc.audio.stream,source);assert.equal(f.gum,1);assert.equal(processor.closed,true);
 assert.equal(doc.audio.contextOps.contexts.size,1);assert.equal(doc.audio.retirements.size,0);
});

test('an initial rejected Worklet module is retired and valid speaker intent retries on a fresh Context',async t=>{
 const f=fixture(t),doc=f.makeDoc(),interest=await doc.audio.acquire({id:'app',sessionGeneration:1});doc.moduleFailures=1;
 await assert.rejects(interest.setSpeaker(true),/audio-context-module-failed/);
 assert.equal(doc.contexts.length,1);assert.equal(doc.contexts[0].state,'closed');
 await f.tick();await until(()=>f.route(doc)?.actualSpeaker);
 assert.equal(doc.contexts.length,2);assert.equal(f.gum,0);assert.equal(doc.audio.contextOps.contexts.size,1);
});

test('processor errors replace only the failed node and stale old errors cannot retire its healthy sibling',async t=>{
 const f=fixture(t),doc=f.makeDoc(),interest=await doc.audio.acquire({id:'app',sessionGeneration:1});
 await interest.setSpeaker(true);await interest.setMicrophone(true);await until(()=>f.route(doc)?.actualMic);
 const source=doc.audio.stream;
 for(let i=0;i<10;i++){
  const old=doc.audio.context,kind=i%2?'playback':'capture',other=i%2?'capture':'playback',sibling=doc.audio[other],node=doc.audio[kind],late=node.onprocessorerror;
  late();await until(()=>doc.audio[kind]!==node&&doc.audio[kind]&&f.route(doc)?.actualMic&&f.route(doc)?.actualSpeaker);
  const current=doc.audio.context;late();await turn();assert.equal(doc.audio.context,current);
  assert.equal(current,old);assert.equal(doc.audio[other],sibling);
  assert.equal(node.closed,true);assert.equal(doc.audio.stream,source);assert.equal(f.gum,1);
  assert.equal(doc.audio.contextOps.contexts.size,1);
 }
 assert.equal(doc.contexts.filter(c=>c.state!=='closed').length,1);
});

test('a timed-out native close prevents new graphs, preserves local cancellation and can finish later',async t=>{
 const f=fixture(t),doc=f.makeDoc(),interest=await doc.audio.acquire({id:'app',sessionGeneration:1});
 doc.env.setTimeout=(fn,ms)=>setTimeout(fn,ms===3000?25:ms);
 await interest.setSpeaker(true);await interest.setMicrophone(true);await until(()=>f.route(doc)?.actualMic);
 const old=doc.audio.context,source=doc.audio.stream;let closeCalls=0,closed;
 old.close=()=>{closeCalls++;return new Promise(resolve=>{closed=()=>{old.state='closed';resolve();};});};
 doc.audio._graphFault('controlled-close-required',{retire:true});doc.audio._recoverGraph();
 await until(()=>doc.audio.graphReason==='audio-context-close-timeout');
 for(let i=0;i<20;i++){doc.audio.graphRetryAfter=0;await f.tick();}
 assert.equal(closeCalls,1);assert.equal(doc.contexts.length,1);assert.equal(doc.audio.stream,source);
 assert.equal(source.getAudioTracks()[0].enabled,false);assert.equal(f.gum,1);
 await interest.setMicrophone(false);await interest.setSpeaker(false);assert.equal(doc.audio.stream,null);
 closed();doc.audio.graphRetryAfter=0;await f.tick();await until(()=>!doc.audio.graphInvalid&&!doc.audio.graphDisposal);
 assert.equal(doc.contexts.length,1);assert.equal(old.state,'closed');assert.equal(doc.audio.contextOps.contexts.size,0);
});

test('a hung module is quarantined after close and cannot multiply Contexts before late settlement',async t=>{
 const f=fixture(t),doc=f.makeDoc(),interest=await doc.audio.acquire({id:'app',sessionGeneration:1});let loaded;
 doc.env.setTimeout=(fn,ms)=>setTimeout(fn,ms===3000?25:ms);
 doc.loadModule=()=>new Promise(resolve=>{loaded=resolve;});
 await assert.rejects(interest.setSpeaker(true),/audio-context-module-timeout/);
 assert.equal(doc.contexts[0].state,'closed');assert.equal(doc.audio.graphQuarantine,doc.contexts[0]);
 for(let i=0;i<20;i++){doc.audio.graphRetryAfter=0;await f.tick();}
 assert.equal(doc.contexts.length,1);assert.equal(f.gum,0);
 doc.loadModule=null;loaded();doc.audio.graphRetryAfter=0;
 await f.tick();await until(()=>f.route(doc)?.actualSpeaker);
 assert.equal(doc.contexts.length,2);assert.equal(doc.audio.contextOps.contexts.size,1);
});

test('off while native module work is quarantined prevents late graph and playback construction',async t=>{
 const f=fixture(t),doc=f.makeDoc(),interest=await doc.audio.acquire({id:'app',sessionGeneration:1});let loaded;
 doc.env.setTimeout=(fn,ms)=>setTimeout(fn,ms===3000?25:ms);
 doc.loadModule=()=>new Promise(resolve=>{loaded=resolve;});
 await assert.rejects(interest.setSpeaker(true),/audio-context-module-timeout/);
 await interest.setSpeaker(false);doc.loadModule=null;loaded();await turn();await f.tick();
 assert.equal(doc.contexts.length,1);assert.equal(doc.audio.playback,null);assert.equal(f.nodes.length,0);
 assert.equal(f.gum,0);
});

test('a real gesture can resume a prior automatic policy block without repeated native pending promises',async t=>{
 const f=fixture(t),doc=f.makeDoc(),interest=await doc.audio.acquire({id:'app',sessionGeneration:1});
 doc.env.setTimeout=(fn,ms)=>setTimeout(fn,ms===3000?25:ms);
 await interest.setSpeaker(true);await interest.setMicrophone(true);await until(()=>f.route(doc)?.actualMic);
 const context=doc.audio.context,source=doc.audio.stream;let calls=0,unblock;
 context.resume=()=>{calls++;if(calls===1)return new Promise(resolve=>{unblock=resolve;});context.state='running';context.onstatechange?.();unblock();return Promise.resolve();};
 await context.suspend();await f.tick();await until(()=>doc.audio.graphReason==='audio-context-resume-timeout');
 for(let i=0;i<20;i++){doc.audio.graphRetryAfter=0;await f.tick();}
 assert.equal(calls,1);assert.equal(source.getAudioTracks()[0].readyState,'live');
 doc.env.navigator.userActivation={isActive:true};await interest.setSpeaker(true);
 await f.tick();await until(()=>f.route(doc)?.actualMic&&f.route(doc)?.actualSpeaker);
 assert.equal(calls,2);assert.equal(doc.audio.stream,source);assert.equal(f.gum,1);assert.equal(doc.contexts.length,1);
});
