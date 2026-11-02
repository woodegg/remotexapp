// Real input batching in an owned disposable browser and single-App fixture.
// Coalescing existing RFB messages models a network read, without changing order.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {config,instance,open,ready,focus,ctrl,key,wait,save,x} from './browser-fixture.mjs';
const c=await open(config.ingressURL+config.basePath+instance.viewerUrl),results=[];
let completed=false;
const gesture=async(expression)=>{const r=await c.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value};
try {
 await ready(c);await c.call('Browser.setPermission',{permission:{name:'clipboard-read',allowWithoutSanitization:true},setting:'granted',origin:config.ingressURL});
 await gesture("remoteXAppViewerClipboard.configure({toRemote:'auto',toLocal:'off'})");await focus(c);
 await gesture("navigator.clipboard.writeText('original sentinel')");await ctrl(c,'a','KeyA',65);await ctrl(c,'v','KeyV',86);await wait(async()=>await save(c)==='original sentinel');
 await c.evaluate(`(()=>{const send=WebSocket.prototype.send;window.inputBatch={holding:false,queue:[]};WebSocket.prototype.send=function(data){if(inputBatch.holding){if(!(data instanceof ArrayBuffer)&&!ArrayBuffer.isView(data))throw Error('binary expected');if(inputBatch.queue.length>=128)throw Error('batch message limit');inputBatch.queue.push({socket:this,bytes:new Uint8Array(data.buffer??data,data.byteOffset??0,data.byteLength).slice()});return;}return send.call(this,data)};inputBatch.restore=()=>{WebSocket.prototype.send=send};inputBatch.flush=()=>{inputBatch.holding=false;const q=inputBatch.queue.splice(0);if(!q.length)throw Error('empty batch');if(q.some(x=>x.socket!==q[0].socket))throw Error('multiple sockets');const size=q.reduce((n,x)=>n+x.bytes.length,0);if(size>65536)throw Error('batch byte limit');const bytes=new Uint8Array(size);let n=0;for(const x of q){bytes.set(x.bytes,n);n+=x.bytes.length}send.call(q[0].socket,bytes);return {messages:q.length,bytes:n}}})()`);
 for(let i=0;i<20;i++){
  const value='Batched paste '+i;await gesture(`navigator.clipboard.writeText(${JSON.stringify(value)})`);
  await c.evaluate('inputBatch.holding=true');await focus(c);await ctrl(c,'a','KeyA',65);await c.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');const batch=await c.evaluate('inputBatch.flush()');
  await ctrl(c,'v','KeyV',86);await wait(async()=>await save(c)===value,5000);results.push({iteration:i,...batch});console.log('PASS batched click/select/paste '+i);assert.ok(batch.messages>=6&&batch.bytes>=70);
 }
 const title=()=>x(['xdotool','getwindowfocus','getwindowname']).trim();
 await ctrl(c,'o','KeyO',79);await wait(()=>/Open File/.test(title()));
 await key(c,'Escape','Escape',27);await wait(()=>!/Open File/.test(title()));
 await focus(c);await ctrl(c,'a','KeyA',65);await ctrl(c,'v','KeyV',86);assert.equal(await save(c),'Batched paste 19');
 results.push({name:'open-file dialog and return preserve editor focus',status:'pass'});
 await c.call('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Control',code:'ControlLeft',windowsVirtualKeyCode:17,modifiers:2});
 await c.call('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Shift',code:'ShiftLeft',windowsVirtualKeyCode:16,modifiers:10});
 await key(c,'S','KeyS',83,10);
 await c.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Shift',code:'ShiftLeft',windowsVirtualKeyCode:16,modifiers:2});
 await c.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Control',code:'ControlLeft',windowsVirtualKeyCode:17});
 await wait(()=>/Save As/.test(title()));await key(c,'Escape','Escape',27);await wait(()=>!/Save As/.test(title()));
 await focus(c);await ctrl(c,'a','KeyA',65);await ctrl(c,'v','KeyV',86);assert.equal(await save(c),'Batched paste 19');
 results.push({name:'save-as dialog and return preserve editor focus',status:'pass'});
 completed=true;
}finally{writeFileSync(config.evidenceDirectory+'/batched-input-results.json',JSON.stringify({status:completed&&results.length===22?'pass':'fail',component:instance.displayComponentDigest,app:instance.driverVersion,cases:results},null,2));await c.evaluate('if(window.inputBatch){if(inputBatch.holding)inputBatch.flush();inputBatch.restore()}remoteXAppViewerClipboard.reset()').catch(()=>{});c.close();await fetch(config.cdpURL+'/json/close/'+c.page.id);}
