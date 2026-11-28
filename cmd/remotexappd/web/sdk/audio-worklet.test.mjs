import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./audio-worklet.js',import.meta.url),'utf8');
function worklet(name){const classes=new Map();class AudioWorkletProcessor{constructor(){this.messages=[];this.port={postMessage:m=>this.messages.push(m)};}}const context={AudioWorkletProcessor,registerProcessor:(name,Class)=>classes.set(name,Class),Float32Array,Int16Array,ArrayBuffer,Math,Map};vm.runInNewContext(source,context);return new(classes.get(name))();}
function run(processor,input,channels=2){const output=Array.from({length:channels},()=>new Float32Array(128));processor.process(input,[output]);return output;}
test('playback preserves stereo samples, clips mixed streams and bounds queues',()=>{
 const p=worklet('remotexapp-playback-v1');const frame=new Int16Array(1920);for(let i=0;i<960;i++){frame[2*i]=16384;frame[2*i+1]=-8192;}
 p.port.onmessage({data:{op:'frame',slot:1,pcm:frame.buffer}});const out=run(p,[]);assert.equal(out[0][0],.5);assert.equal(out[1][0],-.25);
 for(let i=0;i<100;i++)p.port.onmessage({data:{op:'frame',slot:1,pcm:frame.buffer}});assert.equal(p.streams.get(1).queue.length,8);assert.equal(p.dropped,93);
 for(let slot=2;slot<=8;slot++)p.port.onmessage({data:{op:'frame',slot,pcm:frame.buffer}});const mixed=run(p,[]);assert.equal(mixed[0][0],1);assert.equal(mixed[1][0],-1);
 p.port.onmessage({data:{op:'reset'}});assert.equal(p.streams.size,0);assert.ok(run(p,[]).every(c=>c.every(v=>v===0)));
});
test('removing one speaker does not mute the other; short or unknown payloads cannot enter',()=>{
 const p=worklet('remotexapp-playback-v1');const frame=new Int16Array(1920).fill(8192);for(const slot of [1,2])p.port.onmessage({data:{op:'frame',slot,pcm:frame.buffer}});
 p.port.onmessage({data:{op:'frame',slot:3,pcm:new ArrayBuffer(2)}});p.port.onmessage({data:{op:'frame',slot:9,pcm:frame.buffer}});p.port.onmessage({data:{op:'remove',slot:1}});
 assert.equal(p.streams.size,1);assert.equal(run(p,[])[0][0],.25);
});
test('mic emits complete 20 ms frames, bounds credits and never monitors locally',()=>{
 const p=worklet('remotexapp-capture-v1');const input=[new Float32Array(128).fill(.25)];
 for(let i=0;i<20;i++)run(p,[input],1);
 assert.equal(p.messages.length,0);
 p.port.onmessage({data:{op:'delivery',delivery:'lease-a'}});
 for(let i=0;i<7;i++)assert.ok(run(p,[input],1)[0].every(v=>v===0));assert.equal(p.messages.filter(m=>m.type==='pcm').length,0);
 run(p,[input],1);let packets=p.messages.filter(m=>m.type==='pcm');assert.equal(packets.length,1);assert.equal(packets[0].pcm.byteLength,1920);assert.equal(packets[0].delivery,'lease-a');assert.equal(new Int16Array(packets[0].pcm)[0],8192);
 for(let i=0;i<1000;i++)run(p,[input],1);packets=p.messages.filter(m=>m.type==='pcm');assert.equal(packets.length,8);assert.ok(p.dropped>0);
 p.port.onmessage({data:{op:'credit'}});for(let i=0;i<8;i++)run(p,[input],1);assert.equal(p.messages.filter(m=>m.type==='pcm').length,9);
});

test('resumed microphone delivery discards the partial old frame',()=>{
 const p=worklet('remotexapp-capture-v1');
 const old=[new Float32Array(128).fill(.5)],fresh=[new Float32Array(128).fill(.25)];
 p.port.onmessage({data:{op:'delivery',delivery:'old'}});
 for(let i=0;i<7;i++)run(p,[old],1);
 p.port.onmessage({data:{op:'delivery',delivery:null}});
 for(let i=0;i<20;i++)run(p,[old],1);
 p.port.onmessage({data:{op:'delivery',delivery:'fresh'}});
 for(let i=0;i<8;i++)run(p,[fresh],1);
 const packets=p.messages.filter(m=>m.type==='pcm');assert.equal(packets.length,1);assert.equal(packets[0].delivery,'fresh');
 assert.ok(new Int16Array(packets[0].pcm).every(sample=>sample===8192));
});

for (const name of ['playback','capture']) test(`${name} terminal retirement drops state, acknowledges once and stops processing`,()=>{
 const p=worklet(`remotexapp-${name}-v1`);
 if(name==='playback')p.port.onmessage({data:{op:'frame',slot:1,pcm:new Int16Array(1920).fill(8192).buffer}});
 else {p.port.onmessage({data:{op:'delivery',delivery:'old'}});run(p,[[new Float32Array(128).fill(.5)]],1);}
 p.port.onmessage({data:{op:'dispose'}});
 // No later credit/frame/delivery can resurrect a terminal processor.
 p.port.onmessage({data:{op:'delivery',delivery:'new'}});
 p.port.onmessage({data:{op:'frame',slot:1,pcm:new Int16Array(1920).fill(8192).buffer}});
 const output=[new Float32Array(128).fill(1)];
 assert.equal(p.process([[new Float32Array(128).fill(.5)]],[output]),false);
 assert.ok(output[0].every(v=>v===0));
 assert.deepEqual(p.messages.filter(m=>m.type==='disposed').map(m=>m.type),['disposed']);
 assert.equal(p.process([],[]),false);
 assert.equal(p.messages.filter(m=>m.type==='disposed').length,1);
 if(name==='playback')assert.equal(p.streams.size,0);
 else {assert.equal(p.frame,null);assert.equal(p.delivery,null);assert.equal(p.offset,0);}
});

test('playback data and credits use the media port while control and retirement stay local',()=>{
 const p=worklet('remotexapp-playback-v1'),media={messages:[],start(){},close(){this.closed=true;},postMessage(m){this.messages.push(m);}};
 p.port.onmessage({data:{op:'media-bind',binding:'bound',port:media}});
 media.onmessage({data:{op:'reset',epoch:'current'}});
 const frame=new Int16Array(1920).fill(8192);
 media.onmessage({data:{op:'frame',slot:1,epoch:'current',pcm:frame.buffer}});
 for(let i=0;i<8;i++)assert.equal(run(p,[])[0][0],.25);
 assert.equal(media.messages.filter(m=>m.type==='credit').length,1);
 assert.equal(media.messages[0].binding,'bound');assert.equal(media.messages[0].epoch,'current');
 assert.equal(p.messages.filter(m=>m.type==='credit').length,0);
 p.port.onmessage({data:{op:'dispose'}});assert.equal(p.process([],[[new Float32Array(128)]]),false);
 assert.equal(media.closed,true);assert.ok(p.messages.some(m=>m.type==='disposed'));
});

test('playback media replacement fences stale frames and old reset credits',()=>{
 const p=worklet('remotexapp-playback-v1'),make=()=>({messages:[],start(){},close(){this.closed=true;},postMessage(m){this.messages.push(m);}}),old=make(),next=make();
 p.port.onmessage({data:{op:'media-bind',binding:'old',port:old}});const oldCallback=old.onmessage;
 old.onmessage({data:{op:'reset',epoch:'old-epoch'}});old.onmessage({data:{op:'frame',slot:1,epoch:'old-epoch',pcm:new Int16Array(1920).fill(16384).buffer}});
 p.port.onmessage({data:{op:'media-bind',binding:'next',port:next}});assert.equal(old.closed,true);
 next.onmessage({data:{op:'reset',epoch:'new-epoch'}});
 oldCallback({data:{op:'frame',slot:1,epoch:'old-epoch',pcm:new Int16Array(1920).fill(16384).buffer}});
 next.onmessage({data:{op:'frame',slot:1,epoch:'old-epoch',pcm:new Int16Array(1920).fill(16384).buffer}});
 assert.ok(run(p,[])[0].every(v=>v===0));assert.equal(next.messages.length,0);
 next.onmessage({data:{op:'frame',slot:1,epoch:'new-epoch',pcm:new Int16Array(1920).fill(8192).buffer}});
 assert.equal(run(p,[])[0][0],.25);
});

test('malformed playback binding or media data cannot disrupt a current processor',()=>{
 const p=worklet('remotexapp-playback-v1'),media={messages:[],start(){},close(){this.closed=true;},postMessage(m){this.messages.push(m);}};
 for(const data of [null,{op:'media-bind',binding:'',port:media},{op:'media-bind',binding:'bad',port:{close:'not-callable'}}])assert.doesNotThrow(()=>p.port.onmessage({data}));
 p.port.onmessage({data:{op:'media-bind',binding:'valid',port:media}});
 media.onmessage({data:{op:'reset',epoch:'current'}});
 for(const data of [null,{}, {op:'reset',epoch:null},{op:'frame',epoch:'wrong'}])assert.doesNotThrow(()=>media.onmessage({data}));
 p.port.onmessage({data:{op:'media-unbind',binding:'old'}});assert.equal(p.media.port,media);
 media.onmessage({data:{op:'frame',slot:1,epoch:'current',pcm:new Int16Array(1920).fill(8192).buffer}});assert.equal(run(p,[])[0][0],.25);
 p.port.onmessage({data:{op:'media-unbind',binding:'valid'}});assert.equal(media.closed,true);assert.equal(p.streams.size,0);
});
