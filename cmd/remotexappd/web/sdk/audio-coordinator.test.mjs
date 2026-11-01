import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {AudioCoordinator} from './audio-coordinator.js';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const f={sockets:[],http:[],scope:'a'.repeat(64),service:'b'.repeat(64),conflict:false,denied:false};
 class Socket {
  constructor(){this.readyState=1;this.bufferedAmount=0;this.sent=[];f.sockets.push(this);queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({type:'connected',connection:'connection-'+f.sockets.length})}));}
  send(data){this.sent.push(data);if(typeof data!=='string')return;const c=JSON.parse(data);queueMicrotask(()=>this.onmessage?.({data:JSON.stringify(c.op==='unsubscribe'?{type:'ack',request:c.request,slot:c.slot}:{type:'state',request:c.request,slot:c.slot,speaker:c.speaker,mic:c.mic&&!f.conflict,reason:c.mic&&f.conflict?'mic-conflict':'',domain:'d'.repeat(32)})}));}
  close(){this.readyState=3;queueMicrotask(()=>this.onclose?.());}
 }
 const env={crypto:webcrypto,location:{origin:'https://audio.test'},WebSocket:Socket,setInterval:()=>1,setTimeout,clearTimeout,fetch:async(url,options)=>{
  const body=JSON.parse(options.body),action=url.split('/').at(-1);f.http.push({action,body});
  if(f.denied)return {ok:false,status:403,json:async()=>({error:'auth rejected'})};
  const data=action==='context'?{service:f.service,scope:f.scope,protocol:'pcm-s16le-48k-v1'}:action==='route'?{token:'c'.repeat(64),domain:'d'.repeat(32)}:action==='grant'?{token:'c'.repeat(64)}:{ok:true};
  return {ok:true,json:async()=>data};
 }};
 f.coordinator=new AudioCoordinator(env);
 f.peer=()=>{
  const messages=[],pending=new Map();let next=0;
  const port={start(){},close(){},postMessage(m){messages.push(m);if(m.reply){const p=pending.get(m.reply);pending.delete(m.reply);m.error?p.reject(Error(m.error)):p.resolve(m.value);}else if(m.type==='capture'&&port.allowCapture!==false){queueMicrotask(()=>port.onmessage({data:{op:'capture-ready',token:m.token}}));}}};
  f.coordinator.add(port);
  const request=(op,extra={})=>new Promise((resolve,reject)=>{const request=String(++next);pending.set(request,{resolve,reject});port.onmessage({data:{op,request,...extra}});});
  const send=(op,extra={})=>port.onmessage({data:{op,...extra}});
  return {port,messages,request,send,state:()=>messages.findLast(m=>m.type==='state')};
 };
 f.cleanup=()=>f.coordinator._retire('test-finished');
 return f;
}
async function ready(peer){await peer.request('init',{base:'https://audio.test'});}
async function acquire(peer,ref,runtime='app'){await peer.request('acquire',{ref,runtime,generation:1});}

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

test('capture fans out explicit targets, denied writer stops capture, network loss never recaptures',async()=>{
 const f=fixture();try{
  const a=f.peer(),b=f.peer();await ready(a);await ready(b);await acquire(a,'a','app-a');await acquire(b,'b','app-b');
  await a.request('microphone',{ref:'a',enabled:true});await b.request('microphone',{ref:'b',enabled:true});
  assert.equal(a.messages.filter(m=>m.type==='capture').length,1);assert.equal(b.messages.filter(m=>m.type==='capture').length,0);
  const capture=f.coordinator.capture;const pcm=new Int16Array(960).fill(100).buffer;
  a.send('microphone-frame',{token:capture.token,pcm});assert.equal(f.sockets[0].sent.filter(s=>s instanceof ArrayBuffer).length,1);
  b.send('microphone-frame',{token:capture.token,pcm});assert.equal(f.sockets[0].sent.filter(s=>s instanceof ArrayBuffer).length,1);
  await a.request('microphone',{ref:'a',enabled:false});assert.ok(f.coordinator.capture);await b.request('microphone',{ref:'b',enabled:false});assert.equal(f.coordinator.capture,null);
  f.conflict=true;const result=await b.request('microphone',{ref:'b',enabled:true});assert.equal(result.reason,'mic-conflict');assert.equal(f.coordinator.capture,null);
  f.conflict=false;await a.request('microphone',{ref:'a',enabled:true});const count=a.messages.filter(m=>m.type==='capture').length;
  f.sockets.at(-1).close();await turn();assert.equal(f.coordinator.capture,null);assert.equal(a.state().routes.some(r=>r.mic),false);
  f.coordinator.retryAfter=0;f.coordinator._tick();await f.coordinator.serial;assert.equal(a.messages.filter(m=>m.type==='capture').length,count);
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
  const before=f.sockets.at(-1).sent.length;a.send('microphone-frame',{token,pcm:new ArrayBuffer(1920)});assert.equal(f.sockets.at(-1).sent.length,before);
  f.sockets.at(-1).bufferedAmount=0;a.send('microphone-frame',{token,pcm:new ArrayBuffer(1920)});assert.equal(f.sockets.at(-1).sent.at(-1).byteLength,8);
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
