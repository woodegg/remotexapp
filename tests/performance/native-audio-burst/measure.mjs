// Deterministic transport burst experiment; no browser, network, or timing claim.
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash,webcrypto} from 'node:crypto';
import assert from 'node:assert/strict';
const baseline='299e0d4a1901ec0003efc3f15055c2372e34b024',path='cmd/remotexappd/web/sdk/audio-coordinator.js';
const old=execFileSync('git',['show',baseline+':'+path],{encoding:'utf8'}),current=await readFile(path,'utf8');
const hash=s=>createHash('sha256').update(s).digest('hex');
async function measure(source,count){
 const {AudioCoordinator}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 let coordinator,next=0;const pending=new Map(),frames=[];
 class Socket{
  constructor(){this.readyState=1;this.bufferedAmount=0;queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({type:'connected',connection:'synthetic'})}));}
  send(value){const m=JSON.parse(value);queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({type:'state',request:m.request,slot:m.slot,speaker:m.speaker,mic:false,domain:'d'.repeat(32)})}));}
  close(){this.readyState=3;}
 }
 const env={crypto:webcrypto,location:{origin:'https://audio.invalid'},WebSocket:Socket,setInterval:()=>0,setTimeout,clearTimeout,fetch:async(url)=>({ok:true,json:async()=>url.endsWith('/context')?{service:'a'.repeat(64),scope:'b'.repeat(64),protocol:'pcm-s16le-48k-v1'}:{token:'c'.repeat(64),domain:'d'.repeat(32)}})};
 const port={start(){},close(){},postMessage(m){if(m.reply){const p=pending.get(m.reply);pending.delete(m.reply);m.error?p.reject(Error(m.error)):p.resolve(m.value)}else if(m.type==='playback')frames.push(m.slot)}};
 coordinator=new AudioCoordinator(env);coordinator.add(port);
 const request=(op,body={})=>new Promise((resolve,reject)=>{const request=String(++next);pending.set(request,{resolve,reject});port.onmessage({data:{op,request,...body}})});
 try{
  await request('init',{base:'https://audio.invalid'});await request('playback-ready',{ready:true});
  for(let i=1;i<=count;i++){await request('acquire',{ref:String(i),runtime:'app-'+i,generation:1});await request('speaker',{ref:String(i),enabled:true})}
  const packet=slot=>{const data=new ArrayBuffer(3848);new Uint8Array(data).set([1,1,slot,0]);coordinator._speaker(data)};
  for(let n=0;n<5;n++)for(let slot=1;slot<=count;slot++)packet(slot);
  const result={speakers:count,burstMillisecondsPerSpeaker:100,offeredFrames:5*count,deliveredFrames:frames.length,droppedFrames:coordinator.dropped};
  for(let n=0;n<100;n++)packet(count);result.maxInFlightFrames=frames.length;
  return result;
 }finally{coordinator._retire('experiment-complete')}
}
const before=await measure(old,2),after=await measure(current,2),maximum=await measure(current,8);
assert.equal(before.deliveredFrames,8);assert.equal(before.droppedFrames,2);
assert.equal(after.deliveredFrames,10);assert.equal(after.droppedFrames,0);assert.equal(after.maxInFlightFrames,16);
assert.equal(maximum.deliveredFrames,40);assert.equal(maximum.droppedFrames,0);assert.equal(maximum.maxInFlightFrames,64);
const result={experiment:'P17',outcome:'accepted',status:'Bounded per-speaker credit selection passes deterministic multiplexed-burst checks; physical and WAN quality require separate evidence.',scope:'deterministic coordinator fixture, not a latency or acoustic benchmark',baselineCommit:baseline,baselineSourceSHA256:hash(old),candidateSourceSHA256:hash(current),harnessSHA256:hash(await readFile(new URL(import.meta.url))),before,after,maximum,limits:['No real browser scheduling or WAN emulation','No playback latency or acoustic-quality acceptance','Existing per-stream eight-frame worklet bound is unchanged']};
if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(result,null,2)+'\n');else console.log(JSON.stringify(result,null,2));
