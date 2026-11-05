import test from 'node:test';
import assert from 'node:assert/strict';
import {ClipboardInputGate} from '../clipboard-input.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture(t,prepare=()=>null) {const sent=[];const gate=new ClipboardInputGate({send:(...args)=>sent.push(args),prepare});t.after(()=>gate.cancel());return {gate,sent};}

test('manual path preserves key order; automatic paste submits before paste and subsequent keys',async t=>{
 const p=deferred(),{gate,sent}=fixture(t,()=>p.promise);
 gate.key(65507,'ControlLeft',true);gate.key(118,'KeyV',true);gate.key(118,'KeyV',false);
 gate.key(65507,'ControlLeft',false);gate.key(97,'KeyA',true);
 assert.deepEqual(sent,[[65507,'ControlLeft',true]]);
 p.resolve(true);await tick();
 assert.deepEqual(sent,[[65507,'ControlLeft',true],[118,'KeyV',true],[118,'KeyV',false],[65507,'ControlLeft',false],[97,'KeyA',true]]);
 const manual=fixture(t);manual.gate.key(65507,'ControlLeft',true);manual.gate.key(118,'KeyV',true);
 assert.equal(manual.sent.length,2);
});
test('blur/retirement releases submitted modifiers and cannot replay delayed paste',async t=>{
 const p=deferred(),{gate,sent}=fixture(t,()=>p.promise);
 gate.key(65507,'ControlLeft',true);gate.key(118,'KeyV',true);gate.cancel();p.resolve(true);await tick();
 assert.deepEqual(sent,[[65507,'ControlLeft',true],[65507,'ControlLeft',false]]);
});
test('denial, empty local text and bounded overflow suppress the paste and release keys',async t=>{
 for(const reason of ['denied','empty','overflow']){
  const p=deferred(),{gate,sent}=fixture(t,()=>p.promise);
  gate.key(65507,'ControlLeft',true);gate.key(118,'KeyV',true);
  if(reason==='denied')p.reject(Error('denied'));
  else if(reason==='empty')p.resolve(false);
  else {for(let i=0;i<130;i++)gate.key(97,'KeyA',true);p.resolve(true);}
  await tick();assert.equal(sent.some(e=>e[1]==='KeyV'),false);
  assert.ok(sent.some(e=>e[1]==='ControlLeft'&&!e[2]));
 }
});
test('Shift+Insert uses the same ordering gate',async t=>{
 const p=deferred(),{gate,sent}=fixture(t,()=>p.promise);
 gate.key(65505,'ShiftLeft',true);gate.key(65379,'Insert',true);gate.key(65379,'Insert',false);
 assert.equal(sent.length,1);p.resolve(true);await tick();assert.equal(sent.length,3);
});
