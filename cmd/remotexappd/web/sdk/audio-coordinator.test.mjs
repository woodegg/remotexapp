import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {AudioCoordinator} from './audio-coordinator.js';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const f={sockets:[],http:[],scope:'a'.repeat(64),service:'b'.repeat(64),login:'1'.repeat(64),conflict:false,denied:false};
 class Socket {
  constructor(){this.readyState=1;this.bufferedAmount=0;this.sent=[];f.sockets.push(this);queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({type:'connected',connection:'connection-'+f.sockets.length})}));}
  send(data){this.sent.push(data);if(typeof data!=='string')return;const c=JSON.parse(data);const respond=()=>this.onmessage?.({data:JSON.stringify(c.op==='unsubscribe'?{type:'ack',request:c.request,slot:c.slot}:{type:'state',request:c.request,slot:c.slot,speaker:c.speaker,mic:c.mic&&!f.conflict,reason:c.mic&&f.conflict?'mic-conflict':'',domain:'d'.repeat(32)})});if(f.holdMic&&c.mic)f.held={command:c,respond};else queueMicrotask(respond);}
  close(){this.readyState=3;queueMicrotask(()=>this.onclose?.());}
 }
 const env={crypto:webcrypto,location:{origin:'https://audio.test'},WebSocket:Socket,setInterval:()=>1,setTimeout,clearTimeout,fetch:async(url,options)=>{
  const body=JSON.parse(options.body),action=url.split('/').at(-1);f.http.push({action,body});
  if(action==='grant'&&f.busy)return {ok:false,status:409,json:async()=>({error:'audio connection already owned'})};
  if(f.offline)throw TypeError('offline');
  if(f.holdContext && action==='context') await f.holdContext;
  if(action==='route'&&body.runtime===f.retiredRuntime)return {ok:false,status:410,json:async()=>({error:'audio runtime generation retired'})};
  if(f.denied)return {ok:false,status:403,json:async()=>({error:'auth rejected'})};
  if(action==='route'&&body.runtime===f.unavailableRuntime)return {ok:false,status:409,json:async()=>({error:'session audio unavailable'})};
  const data=action==='context'?{service:f.service,scope:f.scope,login:f.login,...(f.principal !== undefined ? {principal:f.principal} : {}),protocol:'pcm-s16le-48k-v1'}:action==='route'?{token:'c'.repeat(64),domain:'d'.repeat(32)}:action==='grant'?{token:'c'.repeat(64)}:{ok:true};
  return {ok:true,json:async()=>data};
 }};
 f.coordinator=new AudioCoordinator(env);
 f.peer=()=>{
  const messages=[],pending=new Map();let next=0;
  const port={start(){},close(){},postMessage(m){messages.push(m);if(m.reply){const p=pending.get(m.reply);pending.delete(m.reply);m.error?p.reject(Error(m.error)):p.resolve(m.value);}else if(m.type==='capture-delivery'&&m.delivery&&port.allowDelivery!==false){queueMicrotask(()=>port.onmessage({data:{op:'capture-delivery-ready',token:m.token,delivery:m.delivery}}));}else if(m.type==='capture'&&port.allowCapture!==false){queueMicrotask(()=>{port.onmessage({data:{op:'capture-ready',token:m.token}});if(port.endAfterCapture)port.onmessage({data:{op:'capture-failed',token:m.token,reason:'microphone-device-ended'}});});}}};
  f.coordinator.add(port);
  const request=(op,extra={})=>new Promise((resolve,reject)=>{const request=String(++next);pending.set(request,{resolve,reject});port.onmessage({data:{op,request,...extra}});});
  const send=(op,extra={})=>port.onmessage({data:{op,...extra}});
  return {port,messages,request,send,state:()=>messages.findLast(m=>m.type==='state')};
 };
 f.cleanup=()=>f.coordinator._retire('test-finished');
 return f;
}
async function ready(peer){await peer.request('init',{base:'https://audio.test',workerProtocol:7});}
async function acquire(peer,ref,runtime='app'){await peer.request('acquire',{ref,runtime,generation:1});}

test('native cookie refresh retains valid audio intent under the same ingress principal',async()=>{
 const f=fixture();f.principal='2'.repeat(64);f.login='';try{
  const a=f.peer();await ready(a);await acquire(a,'a');
  await a.request('speaker',{ref:'a',enabled:true});await a.request('microphone',{ref:'a',enabled:true});
  const capture=f.coordinator.capture, oldDelivery=capture.delivery;
  f.scope='e'.repeat(64);f.coordinator.lastRenew=0;
  f.coordinator._tick();await f.coordinator.serial;
  assert.equal(f.sockets.length,2);assert.equal(f.sockets[0].readyState,3);
  assert.equal(f.coordinator.capture,capture);assert.notEqual(capture.delivery,oldDelivery);
  assert.equal(a.state().routes[0].actualSpeaker,true);assert.equal(a.state().routes[0].actualMic,true);
  assert.equal(a.messages.filter(m=>m.type==='capture').length,1);
  assert.ok(!a.messages.some(m=>m.type==='retired'));
  assert.deepEqual(a.state().routes[0].requested,{speaker:true,microphone:true});
 }finally{f.cleanup();}
});

test('principal or previously present login binding changes retire authority even across service restarts',async()=>{
 for(const change of ['principal','missing-principal','login','missing-login']){
  const f=fixture();f.principal='2'.repeat(64);try{
   const a=f.peer();await ready(a);await acquire(a,'a');await a.request('microphone',{ref:'a',enabled:true});
   f.service='e'.repeat(64);f.scope='f'.repeat(64);
   if(change==='principal') f.principal='3'.repeat(64);
   if(change==='missing-principal') f.principal=undefined;
   if(change==='login') f.login='4'.repeat(64);
   if(change==='missing-login') f.login='';
   await assert.rejects(f.coordinator._context(),/epoch changed/,change);
   assert.equal(f.coordinator.capture,null,change);assert.equal(f.coordinator.routes.size,0,change);
   assert.equal(f.sockets.length,1,change);assert.equal(f.sockets[0].readyState,3,change);
   assert.ok(a.messages.some(m=>m.type==='retired'),change);
  }finally{f.cleanup();}
 }
});

test('malformed principal correlation never replaces a valid context',async()=>{
 const f=fixture();f.principal='2'.repeat(64);try{
  const a=f.peer();await ready(a);await f.coordinator._context();const before=f.coordinator.context;
  for(const invalid of ['',null,{},'not-a-principal']){
   f.principal=invalid;await assert.rejects(f.coordinator._context(),/Unsupported audio contract/);
   assert.equal(f.coordinator.context,before);
  }
 }finally{f.cleanup();}
});

test('an old on or delayed owner cancellation cannot undo a newer shared off/on epoch',async()=>{
 const f=fixture();try{
  const a=f.peer(),b=f.peer();await ready(a);await ready(b);await acquire(a,'a');await acquire(b,'b');
  const stamp=(revision,enabled,epoch=revision)=>({available:true,enabled,participating:enabled,revision,epoch});
  await a.request('microphone',{ref:'a',enabled:true,intent:stamp(1,true)});
  await b.request('microphone',{ref:'b',enabled:false,intent:stamp(2,false)});
  await b.request('microphone',{ref:'b',enabled:true,intent:stamp(3,true)});
  const live=f.coordinator.capture;assert.equal(live.peer.port,b.port);
  await a.request('microphone',{ref:'a',enabled:true,intent:stamp(1,true)});
  await a.request('forget-intent',{ref:'a',kind:'microphone'});
  assert.equal(f.coordinator.capture,live);assert.equal(a.state().routes[0].actualMic,true);
  await assert.rejects(a.request('microphone',{ref:'a',enabled:false,intent:stamp(3,true)}),/Invalid audio intent stamp/);
  assert.equal(a.state().routes[0].requested.microphone,true);assert.equal(f.coordinator.capture,live);
 }finally{f.cleanup();}
});

test('offline initialization and first speaker intent recover without another enable call',async()=>{
 const f=fixture();try{
  f.offline=true;const a=f.peer();await ready(a);await acquire(a,'a');assert.equal(f.http.length,0);
  const state=await a.request('speaker',{ref:'a',enabled:true});assert.equal(state.requested.speaker,true);assert.equal(state.actualSpeaker,false);
  f.offline=false;f.coordinator.retryAfter=0;f.coordinator._tick();await f.coordinator.serial;
  assert.equal(a.state().routes[0].actualSpeaker,true);assert.equal(f.sockets.length,1);
 }finally{f.cleanup();}
});

test('writer eligibility precedes capture, and delivery ACK precedes effective microphone activity',async()=>{
 const f=fixture();try{
  const a=f.peer();await ready(a);await acquire(a,'a');a.port.allowDelivery=false;
  f.holdMic=true;const enabling=a.request('microphone',{ref:'a',enabled:true});await turn();
  assert(f.held);assert.equal(a.messages.filter(m=>m.type==='capture').length,0);
  assert.equal(a.state().routes[0].actualMic,false);
  f.holdMic=false;f.held.respond();await enabling;
  const capture=f.coordinator.capture;assert(capture?.ready);assert(capture.delivery);
  assert.equal(a.state().routes[0].actualMic,false);assert.equal(a.state().routes[0].microphonePending,true);
  const pcm=new Int16Array(960).fill(100).buffer;
  a.send('microphone-frame',{token:capture.token,delivery:capture.delivery,pcm});
  assert.equal(f.sockets[0].sent.filter(m=>m instanceof ArrayBuffer).length,0);
  a.send('capture-delivery-ready',{token:capture.token,delivery:'stale'});
  assert.equal(a.state().routes[0].actualMic,false);
  a.send('capture-delivery-ready',{token:capture.token,delivery:capture.delivery});
  assert.equal(a.state().routes[0].actualMic,true);
  a.send('microphone-frame',{token:capture.token,delivery:capture.delivery,pcm});
  assert.equal(f.sockets[0].sent.filter(m=>m instanceof ArrayBuffer).length,1);
 }finally{f.cleanup();}
});

test('unavailable or contended target writers do not open a browser microphone',async()=>{
 for(const fault of ['conflict','domain']){
  const f=fixture();try{
   const a=f.peer();await ready(a);await acquire(a,'a');
   if(fault==='conflict')f.conflict=true;else f.unavailableRuntime='app';
   const state=await a.request('microphone',{ref:'a',enabled:true});
   assert.equal(state.actualMic,false);assert.equal(state.requested.microphone,true);
   assert.equal(a.messages.filter(m=>m.type==='capture').length,0);
  }finally{f.cleanup();}
 }
});

test('same-session references deduplicate switches, first/last interests own one socket',async()=>{
 const f=fixture();try{
  const a=f.peer(),b=f.peer();await ready(a);await ready(b);await acquire(a,'a');await acquire(b,'b');
  assert.equal(f.sockets.length,0);a.send('playback-ready',{ready:true});await a.request('speaker',{ref:'a',enabled:true});assert.equal(f.sockets.length,1);
  await b.request('speaker',{ref:'b',enabled:true});assert.equal(f.sockets.length,1);assert.equal(f.sockets[0].sent.filter(s=>typeof s==='string').length,1);
  assert.equal(a.state().routes[0].refs,2);assert.equal(a.state().speakerOwner,true);assert.equal(b.state().speakerOwner,false);
  await a.request('release',{ref:'a'});assert.equal(f.sockets[0].readyState,1);assert.equal(b.state().routes[0].speaker,true);
  await b.request('release',{ref:'b'});assert.equal(f.sockets[0].readyState,3);assert.equal(f.coordinator.routes.size,0);
 }finally{f.cleanup();}
});

test('microphone routes recover a live capture and discard audio from the disconnected channel',async()=>{
 const f=fixture();try{
  const a=f.peer(),b=f.peer();await ready(a);await ready(b);await acquire(a,'a','app-a');await acquire(b,'b','app-b');
  await a.request('microphone',{ref:'a',enabled:true});await b.request('microphone',{ref:'b',enabled:true});
  assert.equal(a.messages.filter(m=>m.type==='capture').length,1);assert.equal(b.messages.filter(m=>m.type==='capture').length,0);
  const capture=f.coordinator.capture;const pcm=new Int16Array(960).fill(100).buffer;
  a.send('microphone-frame',{token:capture.token,delivery:capture.delivery,pcm});assert.equal(f.sockets[0].sent.filter(s=>s instanceof ArrayBuffer).length,1);
  b.send('microphone-frame',{token:capture.token,delivery:capture.delivery,pcm});assert.equal(f.sockets[0].sent.filter(s=>s instanceof ArrayBuffer).length,1);
  await a.request('microphone',{ref:'a',enabled:false});assert.ok(f.coordinator.capture);await b.request('microphone',{ref:'b',enabled:false});assert.equal(f.coordinator.capture,null);
  f.conflict=true;const result=await b.request('microphone',{ref:'b',enabled:true});assert.equal(result.reason,'mic-conflict');assert.equal(f.coordinator.capture,null);
  f.conflict=false;await a.request('microphone',{ref:'a',enabled:true});
  const live=f.coordinator.capture, oldDelivery=live.delivery, count=a.messages.filter(m=>m.type==='capture').length;
  const oldSocket=f.sockets.at(-1);oldSocket.close();await turn();
  assert.equal(f.coordinator.capture,live);assert.equal(live.delivery,null);
  assert.equal(a.state().routes[0].mic,true);assert.equal(a.state().routes[0].actualMic,false);
  f.coordinator.retryAfter=0;f.coordinator._tick();await f.coordinator.serial;
  assert.equal(a.messages.filter(m=>m.type==='capture').length,count);
  assert.equal(a.state().routes[0].actualMic,true);assert.notEqual(live.delivery,oldDelivery);
  const resumed=f.sockets.at(-1);
  a.send('microphone-frame',{token:live.token,delivery:oldDelivery,pcm});
  assert.equal(resumed.sent.filter(s=>s instanceof ArrayBuffer).length,0);
  a.send('microphone-frame',{token:live.token,delivery:live.delivery,pcm});
  assert.equal(resumed.sent.filter(s=>s instanceof ArrayBuffer).length,1);
  assert.equal(a.state().routes[1].actualMic,false);
 }finally{f.cleanup();}
});

test('late permission cancellation, missing owner and changed login epoch fence references',async()=>{
 const f=fixture();try{
  const a=f.peer();await ready(a);await acquire(a,'a');a.port.allowCapture=false;
  const pending=a.request('microphone',{ref:'a',enabled:true});await turn();assert.ok(f.coordinator.capture);
  const cancelled=assert.rejects(pending,/cancelled/);await a.request('microphone',{ref:'a',enabled:false});await cancelled;assert.equal(f.coordinator.capture,null);
  a.port.allowCapture=true;await a.request('microphone',{ref:'a',enabled:true});a.send('dispose');await f.coordinator.serial;assert.equal(f.coordinator.capture,null);
  const b=f.peer();await ready(b);await acquire(b,'b');f.scope='e'.repeat(64);
  await assert.rejects(b.request('speaker',{ref:'b',enabled:true}),/epoch changed/);assert.equal(f.coordinator.routes.size,0);assert.ok(b.messages.some(m=>m.type==='retired'));
 }finally{f.cleanup();}
});

test('speaker delivery is bounded by credits and capture respects websocket pressure',async()=>{
 const f=fixture();try{
  const a=f.peer();await ready(a);await acquire(a,'a');a.send('playback-ready',{ready:true});await a.request('speaker',{ref:'a',enabled:true});
  const packet=new ArrayBuffer(3848);const view=new Uint8Array(packet);view.set([1,1,1,0]);
  for(let i=0;i<100;i++)f.coordinator._speaker(packet);assert.equal(a.messages.filter(m=>m.type==='playback').length,8);assert.equal(f.coordinator.dropped,92);
  a.send('playback-credit');f.coordinator._speaker(packet);assert.equal(a.messages.filter(m=>m.type==='playback').length,9);
  await a.request('microphone',{ref:'a',enabled:true});const token=f.coordinator.capture.token;f.sockets.at(-1).bufferedAmount=10000;
  const before=f.sockets.at(-1).sent.length;a.send('microphone-frame',{token,delivery:f.coordinator.capture.delivery,pcm:new ArrayBuffer(1920)});assert.equal(f.sockets.at(-1).sent.length,before);
  f.sockets.at(-1).bufferedAmount=0;a.send('microphone-frame',{token,delivery:f.coordinator.capture.delivery,pcm:new ArrayBuffer(1920)});assert.equal(f.sockets.at(-1).sent.at(-1).byteLength,8);
  a.send('playback-ready',{ready:false});await f.coordinator.serial;assert.equal(a.state().playbackBlocked,true);
 }finally{f.cleanup();}
});

test('route quota, auth failure, logout and session release remain explicit',async()=>{
 const f=fixture();try{
  const a=f.peer();await ready(a);for(let i=0;i<8;i++)await acquire(a,String(i),'app-'+i);
  await assert.rejects(acquire(a,'ninth','app-9'),/capacity/);await assert.rejects(a.request('release',{ref:'missing'}),/retired/);
  f.denied=true;await assert.rejects(a.request('speaker',{ref:'0',enabled:true}),/auth rejected/);assert.equal(f.sockets.length,0);
  f.denied=false;await a.request('logout');assert.equal(f.coordinator.routes.size,0);assert.equal(f.coordinator.context,null);
 }finally{f.cleanup();}
});


test('device loss while a mic route ACK is pending retires that writer and preserves speaker',async()=>{
 const f=fixture();try{
  const a=f.peer();await ready(a);await acquire(a,'a');await a.request('speaker',{ref:'a',enabled:true});
  await a.request('microphone',{ref:'a',enabled:true});await acquire(a,'b','app-b');
  f.holdMic=true;const enabling=a.request('microphone',{ref:'b',enabled:true});await turn();assert.ok(f.held);
  a.send('capture-failed',{token:f.coordinator.capture.token,reason:'microphone-device-ended'});
  f.holdMic=false;f.held.respond();await enabling;await f.coordinator.serial;
  assert.equal(f.coordinator.capture,null);assert.equal(a.state().routes[0].mic,false);assert.equal(a.state().routes[0].actualMic,false);
  assert.equal(a.state().routes[0].actualSpeaker,true);assert.equal(f.sockets[0].readyState,1);
  const sent=f.sockets[0].sent.filter(s=>typeof s==='string').map(JSON.parse);
  assert.equal(sent.filter(m=>m.slot===1).at(-1).mic,false);
  assert.equal(sent.filter(m=>m.slot===2).at(-1).op,'unsubscribe');
  assert.equal(a.messages.filter(m=>m.type==='capture').length,1);
 }finally{f.cleanup();}
});

test('a device ending immediately after permission cannot deliver to its preauthorized microphone route',async()=>{
 const f=fixture();try{
  const a=f.peer();await ready(a);await acquire(a,'a');a.port.endAfterCapture=true;
  await assert.rejects(a.request('microphone',{ref:'a',enabled:true}),/ended-before-routing/);
  await f.coordinator.serial;assert.equal(f.coordinator.capture,null);assert.equal(f.sockets.length,1);assert.equal(a.state().routes[0].mic,false);
  assert.equal(f.sockets[0].readyState,3);assert.equal(f.sockets[0].sent.filter(m=>m instanceof ArrayBuffer).length,0);
 }finally{f.cleanup();}
});


test('Manager restart recovers enabled audio through one fresh socket under the verified login',async()=>{
 const f=fixture();try{
  const a=f.peer(),b=f.peer();await ready(a);await ready(b);await acquire(a,'a');await acquire(b,'b');
  await a.request('speaker',{ref:'a',enabled:true});await a.request('microphone',{ref:'a',enabled:true});
  f.service='f'.repeat(64);f.scope='e'.repeat(64);f.coordinator.lastRenew=0;
  a.send('wake');b.send('wake');await f.coordinator.serial;
  assert.equal(f.sockets.length,2);assert.equal(f.sockets[0].readyState,3);
  assert.equal(a.state().routes[0].actualSpeaker,true);assert.equal(b.state().routes[0].refs,2);
  assert.equal(b.state().routes[0].actualMic,true);
  assert.equal(a.messages.filter(m=>m.type==='capture').length,1);
  assert.ok(!a.messages.some(m=>m.type==='retired'));
  await a.request('speaker',{ref:'a',enabled:false});assert.equal(f.sockets[1].readyState,1);
  await a.request('microphone',{ref:'a',enabled:false});assert.equal(f.sockets[1].readyState,3);
 }finally{f.cleanup();}
});

test('ingress-authorized audio without a login header recovers after loss and Manager restart',async()=>{
 const f=fixture();f.login='';
 try{
  const a=f.peer();await ready(a);await acquire(a,'a');
  await a.request('speaker',{ref:'a',enabled:true});await a.request('microphone',{ref:'a',enabled:true});
  const capture=f.coordinator.capture;
  for(let i=0;i<3;i++){
   f.sockets.at(-1).close();await turn();
   assert.equal(f.coordinator.capture,capture);
   f.service=String(i+3).repeat(64);f.scope=String(i+6).repeat(64);
   f.coordinator.retryAfter=0;a.send('wake');await f.coordinator.serial;
   assert.equal(a.state().routes[0].actualSpeaker,true);
   assert.equal(a.state().routes[0].actualMic,true);
  }
  assert.equal(f.sockets.length,4);
  assert.equal(a.messages.filter(m=>m.type==='capture').length,1);
  assert.deepEqual(a.state().routes[0].requested,{speaker:true,microphone:true});
 }finally{f.cleanup();}
});

test('a different login and a stale runtime generation cannot reuse old speaker intent',async()=>{
 const f=fixture();try{
  const a=f.peer();await ready(a);await acquire(a,'a');await a.request('speaker',{ref:'a',enabled:true});
  f.sockets[0].close();await turn();f.service='f'.repeat(64);f.login='2'.repeat(64);f.scope='e'.repeat(64);
  f.coordinator.retryAfter=0;a.send('wake');await f.coordinator.serial;
  assert.equal(f.sockets.length,1);assert.ok(a.messages.some(m=>m.type==='retired'));
  await assert.rejects(a.request('speaker',{ref:'a',enabled:true}),/retired/);
  await acquire(a,'stale','app');f.retiredRuntime='app';
  const route=await a.request('speaker',{ref:'stale',enabled:true});
  assert.equal(route.reason,'generation-retired');assert.equal(route.speaker,false);
  assert.equal(f.sockets[1].readyState,3);
 }finally{f.cleanup();}
});

test('a late context response cannot undo Speaker off during recovery',async()=>{
 const f=fixture();try{
  const a=f.peer();await ready(a);await acquire(a,'a');
  let resume;f.holdContext=new Promise(resolve=>{resume=resolve;});
  const enabling=a.request('speaker',{ref:'a',enabled:true});
  await turn();
  const disabling=a.request('speaker',{ref:'a',enabled:false});
  resume();
  await Promise.all([enabling,disabling]);
  assert.equal(f.sockets.length,0);assert.equal(a.state().routes[0].speaker,false);
 }finally{f.cleanup();}
});

test('worker heartbeats continue while a permission prompt is pending',async()=>{
 const f=fixture();try{
  const a=f.peer();await ready(a);await acquire(a,'a');a.port.allowCapture=false;
  const pending=a.request('microphone',{ref:'a',enabled:true});const rejected=assert.rejects(pending,/cancelled/);await turn();
  const before=a.messages.filter(m=>m.type==='ping').length;
  f.coordinator._tick();f.coordinator._tick();assert.equal(a.messages.filter(m=>m.type==='ping').length,before+2);
  await a.request('microphone',{ref:'a',enabled:false});await rejected;
 }finally{f.cleanup();}
});

test('server retirement of the final App releases an empty shared channel',async()=>{
 const f=fixture();try{
  const a=f.peer();await ready(a);await acquire(a,'a','app-a');await acquire(a,'b','app-b');
  await a.request('speaker',{ref:'a',enabled:true});await a.request('microphone',{ref:'b',enabled:true});
  const socket=f.sockets[0],retire=slot=>socket.onmessage({data:JSON.stringify({type:'state',slot,speaker:false,mic:false,reason:'generation-retired'})});
  retire(1);f.coordinator._tick();await f.coordinator.serial;await turn();
  assert.equal(socket.readyState,1);assert.equal(a.state().routes[1].actualMic,true);
  retire(2);f.coordinator._tick();await f.coordinator.serial;await turn();
  assert.equal(socket.readyState,3);assert.equal(f.coordinator.connection,null);assert.equal(f.coordinator.capture,null);
  assert.equal(a.state().connection,'idle');assert.equal(a.state().routes.every(r=>!r.speaker&&!r.mic),true);
 }finally{f.cleanup();}
});

test('playback credits cover each enabled speaker without starving multiplexed bursts',async()=>{
 const f=fixture();try{
  const a=f.peer();await ready(a);await acquire(a,'a','app-a');await acquire(a,'b','app-b');a.send('playback-ready',{ready:true});
  await a.request('speaker',{ref:'a',enabled:true});await a.request('speaker',{ref:'b',enabled:true});
  for(let i=0;i<5;i++)for(const slot of [1,2]){const packet=new ArrayBuffer(3848);new Uint8Array(packet).set([1,1,slot,0]);f.coordinator._speaker(packet);}
  assert.equal(a.messages.filter(m=>m.type==='playback').length,10,'a 100 ms burst per speaker fits its own bounded queue');
  assert.equal(f.coordinator.dropped,0);
  const packet=new ArrayBuffer(3848);new Uint8Array(packet).set([1,1,2,0]);for(let i=0;i<100;i++)f.coordinator._speaker(packet);
  assert.equal(a.messages.filter(m=>m.type==='playback').length,16,'two speakers have a bounded aggregate budget');
  await a.request('speaker',{ref:'a',enabled:false});for(let i=0;i<100;i++)a.send('playback-credit');
  const peer=[...f.coordinator.ports.values()][0];assert.equal(peer.credits,8,'removed speaker cannot retain extra credits');
 }finally{f.cleanup();}
});


test('one unavailable domain does not disconnect another App or stop its microphone',async()=>{
 const f=fixture();try{
  const a=f.peer();await ready(a);await acquire(a,'a','app-a');await acquire(a,'b','app-b');
  for(const ref of ['a','b']){await a.request('speaker',{ref,enabled:true});await a.request('microphone',{ref,enabled:true});}
  const socket=f.sockets[0],capture=f.coordinator.capture;
  f.unavailableRuntime='app-a';socket.onmessage({data:JSON.stringify({type:'state',slot:1,speaker:false,mic:false,reason:'domain-retired'})});
  f.coordinator._tick();await f.coordinator.serial;await turn();
  assert.equal(socket.readyState,1);assert.equal(f.coordinator.capture,capture);assert.equal(a.state().routes[1].actualSpeaker,true);assert.equal(a.state().routes[1].actualMic,true);
  assert.equal(a.state().routes[0].mic,false);assert.equal(a.state().routes[0].actualSpeaker,false);
  f.unavailableRuntime=null;f.coordinator.retryAfter=0;f.coordinator._tick();await f.coordinator.serial;await turn();
  assert.equal(a.state().routes[0].actualSpeaker,true);assert.equal(a.state().routes[0].reason,'');assert.equal(a.state().routes[0].mic,false);assert.equal(f.coordinator.capture,capture);
  f.denied=true;f.coordinator.lastRenew=0;f.coordinator._tick();await f.coordinator.serial;await turn();
  assert.equal(socket.readyState,3);assert.equal(f.coordinator.capture,null,'scope authentication failure still fences all capture');
 }finally{f.cleanup();}
});


test('audio ownership contention defers speaker without making a duplicate connection',async()=>{
  const f=fixture();try {
    const a=f.peer();await ready(a);await acquire(a,'a');
    f.busy=true;
    const pending=await a.request('speaker',{ref:'a',enabled:true});
    assert.equal(pending.actualSpeaker,false);
    assert.equal(a.state().connection,'recovering');
    assert.equal(f.sockets.length,0);
    f.busy=false;f.coordinator.retryAfter=0;a.send('wake');await f.coordinator.serial;
    assert.equal(f.sockets.length,1);
    assert.equal(a.state().routes[0].actualSpeaker,true);
  }finally{f.cleanup();}
});

test('speaker restore requires the same login and respects a newer explicit cancellation',async()=>{
  const f=fixture();try {
    const a=f.peer();await ready(a);await acquire(a,'a');
    const old=await a.request('restore-speaker',{ref:'a',login:'2'.repeat(64)});
    assert.equal(old.speaker,false);
    await a.request('speaker',{ref:'a',enabled:false});
    const result=await a.request('restore-speaker',{ref:'a',login:f.login});
    assert.equal(result.speaker,false);
    assert.equal(f.sockets.length,0);
  }finally{f.cleanup();}
});

test('microphone owner loss during an outage still terminates its source',async()=>{
 const f=fixture();try{
  const a=f.peer();await ready(a);await acquire(a,'a');await a.request('microphone',{ref:'a',enabled:true});
  f.sockets[0].close();await turn();a.send('dispose');await f.coordinator.serial;
  assert.equal(f.coordinator.capture,null);
  assert.equal(a.messages.filter(m=>m.type==='capture').length,1);
  assert.ok(a.messages.some(m=>m.type==='stop-capture'));
 }finally{f.cleanup();}
});

test('two-minute outage retains a heartbeating live source and resumes only fresh delivery',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const original=Date.now;let now=100000;Date.now=()=>now;
 const f=fixture();try{
  const a=f.peer();await ready(a);await acquire(a,'a');await a.request('microphone',{ref:'a',enabled:true});
  const capture=f.coordinator.capture, previousDelivery=capture.delivery;
  f.offline=true;f.sockets[0].close();await turn();
  for(let second=0;second<120;second++){
   now+=1000;a.send('pong');t.mock.timers.tick(1000);f.coordinator._tick();await f.coordinator.serial;await turn();
   assert.equal(f.coordinator.capture,capture,'source retired during transport outage');
   assert.equal(capture.delivery,null);assert.equal(a.state().routes[0].actualMic,false);
  }
  assert.equal(a.messages.filter(m=>m.type==='capture').length,1);
  assert.equal(a.messages.filter(m=>m.type==='stop-capture').length,0);
  f.offline=false;f.coordinator.retryAfter=0;f.coordinator._tick();await f.coordinator.serial;
  assert.equal(f.coordinator.capture,capture);assert.equal(a.state().routes[0].actualMic,true);
  assert.notEqual(capture.delivery,previousDelivery);assert.equal(f.sockets.length,2);
  const pcm=new Int16Array(960).fill(123).buffer;
  a.send('microphone-frame',{token:capture.token,delivery:previousDelivery,pcm});
  assert.equal(f.sockets[1].sent.filter(m=>m instanceof ArrayBuffer).length,0);
  a.send('microphone-frame',{token:capture.token,delivery:capture.delivery,pcm});
  assert.equal(f.sockets[1].sent.filter(m=>m instanceof ArrayBuffer).length,1);
  await a.request('microphone',{ref:'a',enabled:false});assert.equal(f.coordinator.capture,null);
 }finally{f.cleanup();Date.now=original;t.mock.timers.reset();}
});

test('capture retained through connection ownership contention is never delivered before fresh authorization',async()=>{
 const f=fixture();try{
  const a=f.peer();await ready(a);await acquire(a,'a');await a.request('microphone',{ref:'a',enabled:true});
  const capture=f.coordinator.capture;f.sockets[0].close();await turn();f.busy=true;
  f.coordinator.retryAfter=0;f.coordinator._tick();await f.coordinator.serial;
  assert.equal(f.coordinator.capture,capture);assert.equal(capture.delivery,null);
  assert.equal(a.state().routes[0].actualMic,false);assert.equal(f.sockets.length,1);
  await turn(); // Allow the first tick's finally to release its one-operation guard.
  f.busy=false;f.coordinator.retryAfter=0;f.coordinator._tick();await f.coordinator.serial;
  assert.equal(a.state().routes[0].actualMic,true);assert.equal(f.sockets.length,2);
  assert.equal(a.messages.filter(m=>m.type==='capture').length,1);
 }finally{f.cleanup();}
});

test('explicit audio off succeeds locally while reconnection HTTP is unavailable',async()=>{
 const f=fixture();f.login='';
 try {
  const a=f.peer();await ready(a);await acquire(a,'a');
  await a.request('speaker',{ref:'a',enabled:true});await a.request('microphone',{ref:'a',enabled:true});
  f.offline=true;f.sockets.at(-1).close();await turn();
  assert.equal((await a.request('speaker',{ref:'a',enabled:false})).speaker,false);
  assert.equal((await a.request('microphone',{ref:'a',enabled:false})).requested.microphone,false);
  f.offline=false;f.coordinator.retryAfter=0;f.coordinator._tick();await f.coordinator.serial;
  assert.equal(f.sockets.length,1);assert.equal(f.coordinator.capture,null);
 } finally { f.cleanup(); }
});
