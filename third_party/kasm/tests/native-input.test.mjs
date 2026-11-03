import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeInput} from '../native-input.mjs';

function fixture() {
  const sent=[], rfb={isConnected:true,viewOnly:false,_keyboard:{inputPolicy:{neutral:true},_rfbKeyQueue:[],_submittedKeys:new Map()},
    _sock:{trafficStats:{bufferedBytes:0}},sendKey:(...args)=>sent.push(args)};
  let busy=false;
  const input=new NativeInput({current:()=>rfb,lookup:point=>point < 256 ? point : 0x1000000+point,busy:()=>busy});
  return {input,rfb,sent,setBusy:()=>{busy=true;}};
}
test('Unicode, normalized newlines and tab use native keys without clipboard access',()=>{
  const f=fixture();
  assert.deepEqual(f.input.text('A中文😀\r\n\t'),{status:'submitted',count:6});
  assert.deepEqual(f.sent.map(v=>v[0]),[65,0x1004e2d,0x1006587,0x101f600,0xff0d,0xff09]);
  assert.ok(f.sent.every(v=>v[1]==='Unidentified' && v.length===2));
});
test('invalid/oversized text is rejected atomically before any native write',()=>{
  const f=fixture();
  for (const text of ['',null,'a\u0000','\ud800','a'.repeat(4097)]) assert.throws(()=>f.input.text(text),{code:'invalid-text'});
  assert.equal(f.sent.length,0);
  assert.equal(f.input.text('a'.repeat(4096)).count,4096);
});
test('a shortcut releases its own modifiers in reverse order, including submission errors',()=>{
  const f=fixture();
  f.input.key('ArrowLeft',{modifiers:['Control','Shift']});
  assert.deepEqual(f.sent,[[0xffe3,'ControlLeft',true],[0xffe1,'ShiftLeft',true],[0xff51,'Unidentified'],[0xffe1,'ShiftLeft',false],[0xffe3,'ControlLeft',false]]);
  f.sent.length=0;
  f.rfb.sendKey=(...args)=>{if(args[1]==='Unidentified')throw Error('closed');f.sent.push(args);};
  assert.throws(()=>f.input.key('s',{modifiers:['Control']}),/closed/);
  assert.deepEqual(f.sent,[[0xffe3,'ControlLeft',true],[0xffe3,'ControlLeft',false]]);
});
test('invalid shortcut cannot leave modifiers down',()=>{
  const f=fixture();
  for (const [key,options] of [['bad',{}],['a',{modifiers:['Control','Control']}],['a',{modifiers:['Super']}],['\ud800',{}],['\n',{}]])
    assert.throws(()=>f.input.key(key,options),{code:'invalid-key'});
  assert.equal(f.sent.length,0);
  f.input.key('😀'); f.input.key('F12');
  assert.deepEqual(f.sent.map(v=>v[0]),[0x101f600,0xffc9]);
});
test('human composition, queued paste, held keys, backlog and readonly are fenced',()=>{
  for (const change of [f=>f.setBusy(), f=>f.rfb._keyboard.inputPolicy.neutral=false,
    f=>f.rfb._keyboard._rfbKeyQueue.push({}),f=>f.rfb._keyboard._submittedKeys.set('KeyA',65),f=>f.rfb._keyboard._keyDownList={KeyA:65}]) {
    const f=fixture();change(f);assert.throws(()=>f.input.text('safe'),{code:'input-busy'});assert.equal(f.sent.length,0);
  }
  const f=fixture(); f.rfb._sock.trafficStats.bufferedBytes=65537;
  assert.throws(()=>f.input.key('Enter'),{code:'input-backpressure'});
  f.rfb.viewOnly=true; assert.throws(()=>f.input.text('safe'),{code:'input-unavailable'});
  f.rfb.viewOnly=false; f.rfb.isConnected=false; assert.throws(()=>f.input.text('safe'),{code:'input-unavailable'});
});
