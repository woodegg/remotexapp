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
 for(let i=0;i<7;i++)assert.ok(run(p,[input],1)[0].every(v=>v===0));assert.equal(p.messages.length,0);
 run(p,[input],1);let packets=p.messages.filter(m=>m.type==='pcm');assert.equal(packets.length,1);assert.equal(packets[0].pcm.byteLength,1920);assert.equal(new Int16Array(packets[0].pcm)[0],8192);
 for(let i=0;i<1000;i++)run(p,[input],1);packets=p.messages.filter(m=>m.type==='pcm');assert.equal(packets.length,8);assert.ok(p.dropped>0);
 p.port.onmessage({data:{op:'credit'}});for(let i=0;i<8;i++)run(p,[input],1);assert.equal(p.messages.filter(m=>m.type==='pcm').length,9);
});
