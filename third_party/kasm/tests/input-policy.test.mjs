import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
// Exercise the exact added patch source in portable CI, and the actual applied
// upstream file during a component build. No parallel policy implementation.
const root=process.env.KASM_CLIENT_SOURCE;
const patch=readFileSync(new URL('../patches/0010-client-research-baseline.patch',import.meta.url),'utf8');
const section=patch.split('+++ b/core/input/poc-input-policy.mjs\n')[1].split('--- /dev/null')[0];
const source=section.split('\n').filter(line=>line.startsWith('+')).map(line=>line.slice(1)).join('\n');
const {InputPolicy,normalizePolicy,detectProfile}=await import(root ? pathToFileURL(root+'/core/input/poc-input-policy.mjs').href : 'data:text/javascript;base64,'+Buffer.from(source).toString('base64'));


function fixture(config={profile:'windows'}) {
  const sent=[],released=[];
  const policy=new InputPolicy({...config,emit:(e,down)=>{sent.push([e.code,down]);e.preventDefault();},release:codes=>released.push(...codes)});
  const down=(code,flags)=>{const e=keyEvent(code,flags);policy.down(e,code);return e;};
  const up=(code,flags)=>{const e=keyEvent(code,flags);policy.up(e,code);return e;};
  return {policy,sent,released,down,up};
}
test('profiles, strict configuration and unknown Linux require explicit selection',()=>{
  assert.equal(detectProfile('Win32'),'windows');assert.equal(detectProfile('MacIntel'),'mac');assert.equal(detectProfile('Linux x86_64'),'unknown');
  assert.deepEqual(normalizePolicy({profile:'unknown'}).bindings,[]);
  for(const config of [{profile:'bad'},{mode:'bad'},{bindings:['Control+Control+Space']},{bindings:['a']},{bindings:['Control+']},{bindings:Array(17).fill('Space')}]) assert.throws(()=>normalizePolicy(config));
});
for(const profile of ['windows','gnome']) for(const side of ['Left','Right']) for(const reverse of [false,true]) {
  test(`${profile} ${side} ${reverse?'reverse':'forward'} switch stays local across repeats and releases`,()=>{
    const f=fixture({profile}),meta='Meta'+side;
    if(reverse) f.down('ShiftLeft',{shiftKey:true});
    const m=f.down(meta,{metaKey:true,shiftKey:reverse});
    const space=f.down('Space',{metaKey:true,shiftKey:reverse});
    for(let i=0;i<40;i++) f.down('Space',{metaKey:true,shiftKey:reverse,repeat:true});
    f.up(meta,{shiftKey:reverse});f.up('Space',{shiftKey:reverse});if(reverse) f.up('ShiftLeft');
    assert.deepEqual(f.sent,[]);assert.deepEqual(f.released,[]);assert.equal(m.defaultPrevented,false);assert.equal(space.defaultPrevented,false);assert.equal(f.policy.neutral,true);
  });
}
for(const profile of ['mac','fcitx']) test(`${profile} Control+Space, hidden terminal and orphan keyup`,()=>{
  const f=fixture({profile});f.down('ControlLeft',{ctrlKey:true});f.down('Space',{ctrlKey:true});f.up('Space',{ctrlKey:true});f.up('ControlLeft');
  f.down('ControlLeft',{ctrlKey:true});f.up('ControlLeft');f.up('Space');assert.deepEqual(f.sent,[]);
});
for(const order of [['ControlLeft','AltLeft'],['AltLeft','ControlLeft']]) test(`mac Control+Option+Space order ${order.join(',')}`,()=>{
  const f=fixture({profile:'mac'});let flags={};
  for(const code of order) {flags={...flags,[code.startsWith('Control')?'ctrlKey':'altKey']:true};f.down(code,flags);}
  f.down('Space',flags);f.up('Space',flags);f.up('AltLeft',{ctrlKey:true});f.up('ControlLeft');assert.deepEqual(f.sent,[]);
});
test('pending prefix has no timer, remains bounded, and ordinary shortcut commits in order',()=>{
  const f=fixture();for(let i=0;i<2000;i++)f.down('MetaLeft',{metaKey:true,repeat:i>0});
  assert.equal(f.policy.pending.size,1);assert.deepEqual(f.sent,[]);
  f.down('KeyA',{metaKey:true});f.up('KeyA',{metaKey:true});f.up('MetaLeft');
  assert.deepEqual(f.sent,[['MetaLeft',true],['KeyA',true],['KeyA',false],['MetaLeft',false]]);
});
test('missing prefix keydown uses flags without inventing a remote modifier',()=>{
  const f=fixture();f.down('Space',{metaKey:true});f.up('Space');f.down('KeyA');f.up('KeyA');assert.deepEqual(f.sent,[['KeyA',true],['KeyA',false]]);
});
test('modifier reconciliation removes lost releases before new typing',()=>{
  const f=fixture();f.down('MetaLeft',{metaKey:true});f.down('KeyA');f.up('KeyA');assert.deepEqual(f.sent,[['KeyA',true],['KeyA',false]]);assert.equal(f.policy.neutral,true);
});
test('extra modifiers do not accidentally match a local chord',()=>{
  const f=fixture();f.down('MetaLeft',{metaKey:true});f.down('ControlLeft',{metaKey:true,ctrlKey:true});f.down('Space',{metaKey:true,ctrlKey:true});assert.ok(f.sent.some(e=>e[0]==='Space'));
});
test('Shift tap and modifier-only chords preserve capitals and extended shortcuts',()=>{
  for(const binding of ['Shift','Control+Shift','Alt+Shift']) {
    const f=fixture({profile:'custom',bindings:[binding]});
    f.down('ShiftLeft',{shiftKey:true});f.up('ShiftLeft');assert.deepEqual(f.sent,[]);
    f.down('ShiftLeft',{shiftKey:true});f.down('KeyA',{key:'A',shiftKey:true});f.up('KeyA',{key:'A',shiftKey:true});f.up('ShiftLeft');
    assert.deepEqual(f.sent,[['ShiftLeft',true],['KeyA',true],['KeyA',false],['ShiftLeft',false]]);
  }
  const f=fixture({profile:'custom',bindings:['Control+Shift']});f.down('ControlLeft',{ctrlKey:true});f.down('ShiftLeft',{ctrlKey:true,shiftKey:true});f.down('KeyS',{ctrlKey:true,shiftKey:true});
  assert.deepEqual(f.sent,[['ControlLeft',true],['ShiftLeft',true],['KeyS',true]]);
});
test('Caps Lock is local only when explicitly selected',()=>{
  const f=fixture({profile:'mac',bindings:['CapsLock']});f.down('CapsLock');f.up('CapsLock');assert.deepEqual(f.sent,[]);
  const normal=fixture({profile:'mac'});normal.down('CapsLock');normal.up('CapsLock');assert.equal(normal.sent.length,2);
});
test('AltGraph and synthetic Windows Ctrl+Alt are not a configured Ctrl shortcut',()=>{
  const f=fixture({profile:'windows',bindings:['Control+Space']});
  f.down('ControlLeft',{ctrlKey:true});f.down('AltRight',{key:'AltGraph',ctrlKey:true,altKey:true,altGraph:true});f.down('Space',{ctrlKey:true,altKey:true,altGraph:true});assert.ok(f.sent.some(e=>e[0]==='Space'));
});
test('residual shortcut input is suppressed only for the active exact gesture',()=>{
  const f=fixture();f.down('MetaLeft',{metaKey:true});f.down('Space',{metaKey:true});
  assert.equal(f.policy.consumeInput({data:' ',inputType:'insertText'}),true);
  assert.equal(f.policy.consumeInput({data:'你好',inputType:'insertText'}),false);
  assert.equal(f.policy.consumeInput({data:' ',inputType:'insertFromPaste'}),false);
  assert.equal(f.policy.consumeInput({data:' ',inputType:'insertText',isComposing:true}),false);
  f.up('Space',{metaKey:true});assert.equal(f.policy.consumeInput({data:' ',inputType:'insertText'}),false);
});
test('composition clears ambiguous modifiers without sending them or losing committed text',()=>{
  const f=fixture({profile:'mac'});f.down('ControlLeft',{ctrlKey:true});f.policy.composition(true);
  f.down('Space',{key:'Process',keyCode:229,isComposing:true,ctrlKey:true});f.up('Space',{ctrlKey:true});f.policy.composition(false);f.up('ControlLeft');assert.deepEqual(f.sent,[]);
});
test('pointer motion does not flush prefix; modified click does and DOM getters survive',()=>{
  const f=fixture({profile:'mac'});f.down('ControlLeft',{ctrlKey:true});
  const event=Object.assign(Object.create({get clientX(){return 12;}}),{ctrlKey:true,buttons:0,preventDefault(){this.prevented=true;}});
  f.policy.pointer(event,false);assert.deepEqual(f.sent,[]);
  const out=f.policy.pointer({...event,buttons:1},true);assert.deepEqual(f.sent,[['ControlLeft',true]]);assert.equal(out.ctrlKey,true);
  assert.equal(f.policy.pointer(event).clientX,12);
});
test('consumed modifiers cannot reappear through pointer flags',()=>{
  const f=fixture({profile:'mac'});f.down('ControlLeft',{ctrlKey:true});f.down('Space',{ctrlKey:true});
  const out=f.policy.pointer({ctrlKey:true,buttons:1},true);assert.equal(out.ctrlKey,false);assert.deepEqual(f.sent,[]);
});
test('reset releases only accepted keys, and never replays pending input',()=>{
  const f=fixture();f.down('MetaLeft',{metaKey:true});f.policy.reset();assert.deepEqual(f.released,[]);
  f.down('KeyA');f.policy.reset();assert.deepEqual(f.released,['KeyA']);assert.equal(f.policy.neutral,true);
});
test('configuration waits for neutral keys, composition and pointer',()=>{
  const f=fixture();f.down('MetaLeft',{metaKey:true});assert.equal(f.policy.configure({profile:'mac'}),false);f.up('MetaLeft');assert.equal(f.policy.config.profile,'mac');
  f.policy.composition(true);f.policy.configure({profile:'gnome'});assert.equal(f.policy.config.profile,'mac');f.policy.composition(false);assert.equal(f.policy.config.profile,'gnome');
  f.policy.pointer({buttons:1},true);f.policy.configure({profile:'windows'});assert.equal(f.policy.config.profile,'gnome');f.policy.pointer({buttons:0});assert.equal(f.policy.config.profile,'windows');
});
test('remote mode explicitly forwards chords',()=>{
  const f=fixture({profile:'windows',mode:'remote'});f.down('MetaLeft',{metaKey:true});f.down('Space',{metaKey:true});f.up('Space',{metaKey:true});f.up('MetaLeft');assert.equal(f.sent.length,4);
});
test('mixed remote/local gesture withholds new terminal and releases submitted modifiers',()=>{
  const f=fixture({profile:'mac'});f.down('ControlLeft',{ctrlKey:true});f.down('KeyA',{ctrlKey:true});f.up('KeyA',{ctrlKey:true});f.down('Space',{ctrlKey:true});
  assert.equal(f.sent.some(e=>e[0]==='Space'),false);assert.deepEqual(f.released,['ControlLeft']);
});

function keyEvent(code, {key, ...flags} = {}) {
  const keys = {MetaLeft:'Meta',MetaRight:'Meta',ControlLeft:'Control',ControlRight:'Control',ShiftLeft:'Shift',ShiftRight:'Shift',AltLeft:'Alt',AltRight:'Alt',Space:' ',KeyA:'a',KeyS:'s',KeyV:'v',Period:'.'};
  return {code,key:key ?? keys[code] ?? code,keyCode:0,location:code.endsWith('Right')?2:1,
    shiftKey:false,ctrlKey:false,altKey:false,metaKey:false,isComposing:false,repeat:false,timeStamp:100,
    defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){},
    getModifierState(name){return name==='AltGraph' && Boolean(this.altGraph);},...flags};
}
