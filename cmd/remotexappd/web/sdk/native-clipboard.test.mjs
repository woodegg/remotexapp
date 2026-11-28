import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeClipboard} from './native-clipboard.js';
// #117 remains unfixed. CI reports these desired-behavior assertions as TODO;
// set REMOTEXAPP_TEST_CLIPBOARD_ABA=1 for a strict, nonzero red reproduction.
const knownABA = process.env.REMOTEXAPP_TEST_CLIPBOARD_ABA === '1' ? {} :
  {todo:'Issue #117: stale lastSent suppresses a later legitimate remote copy'};
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; };
function fixture(t) {
  const old = Object.fromEntries(['navigator','document'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const doc = new EventTarget();doc.hidden=false;doc.hasFocus=()=>true;
  const permissions = Object.fromEntries(['clipboard-read','clipboard-write'].map(name=>{const p=new EventTarget();p.state='granted';return [name,p];}));
  const io={text:'baseline',writes:[],reads:0,lock:true};
  const nav={userActivation:{isActive:true},permissions:{query:async ({name})=>permissions[name]},
    locks:{request:async (_,options,fn)=>fn(io.lock ? {} : null)},
    clipboard:{readText:async()=>{io.reads++;return io.text;},writeText:async text=>{io.writes.push(text);io.text=text;}}};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:nav});
  Object.defineProperty(globalThis,'document',{configurable:true,value:doc});
  const clients=[];
  const create=()=>{
    const client=new EventTarget();client.container=new EventTarget();client.state='ready';
    client.capabilities={clipboard:true,clipboardAutomatic:true,clipboardMaxBytes:65536};
    client.sent=[];client.events=[];client.cancelled=0;
    client._display={sendClipboardText:text=>client.sent.push(text),cancelClipboardPaste:()=>client.cancelled++};
    client.addEventListener('clipboardstatechange',e=>client.events.push(e.detail));
    const clipboard=new NativeClipboard(client,code=>Object.assign(new Error(code),{code}));
    client.clipboard=clipboard;clients.push(client);return client;
  };
  t.after(()=>{for(const client of clients)client.clipboard.dispose();for(const [key,value] of Object.entries(old)){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}});
  const start=async(client=create(),options={toRemote:'auto',toLocal:'auto'})=>{
    await client.clipboard.configure(options);client.clipboard.activate();await client.clipboard.sync();return client;
  };
  return {io,nav,doc,permissions,create,start};
}

test('default off, explicit auto opt-in, unchanged baseline and old component manual fallback',async t=>{
  const f=fixture(t),c=f.create(),s=c.clipboard;
  assert.deepEqual(s.snapshot().requested,{toRemote:'off',toLocal:'off'});
  f.nav.userActivation.isActive=false;
  assert.throws(()=>s.configure({toRemote:'auto',toLocal:'off'}),{code:'clipboard-gesture'});
  await s.configure({toRemote:'manual',toLocal:'off'});assert.equal(f.io.reads,0);
  f.nav.userActivation.isActive=true;await f.start(c);
  assert.equal(f.io.reads,1);assert.deepEqual(c.sent,[]);assert.deepEqual(f.io.writes,[]);
  c.capabilities.clipboardAutomatic=false;assert.equal(s.snapshot().effective.toRemote,'manual');
  assert.throws(()=>s.configure({toRemote:'bogus',toLocal:'auto'}),TypeError);
});
test('native bidirectional sync, echo suppression and payload-free snapshots',async t=>{
  const f=fixture(t),c=await f.start(),s=c.clipboard;
  f.io.text='中文\n😀';await s.sync();assert.deepEqual(c.sent,['中文\n😀']);
  s.offer('中文\n😀');await s.sync();assert.deepEqual(f.io.writes,[]);
  s.offer('远端\n文本');await s.sync();assert.deepEqual(f.io.writes,['远端\n文本']);
  await s.sync();assert.equal(c.sent.length,1);
  assert.equal(JSON.stringify(c.events).includes('中文'),false);assert.equal(JSON.stringify(c.events).includes('远端'),false);
});
test('directions are independent; conflicts stop automatic mutation until explicit paste choice',async t=>{
  const f=fixture(t),c=await f.start(),s=c.clipboard;
  f.io.text='local change';s.offer('remote change');await s.sync();
  assert.equal(s.snapshot().phase,'conflict');assert.deepEqual(c.sent,[]);assert.deepEqual(f.io.writes,[]);
  assert.equal(await s.paste(),true);assert.deepEqual(c.sent,['local change']);
  await s.configure({toRemote:'off',toLocal:'auto'});await s.sync();
  f.io.text='local only';await s.sync();assert.equal(c.sent.length,1);assert.equal(s.paste(),null);
  await s.configure({toRemote:'auto',toLocal:'off'});await s.sync();s.offer('ignored');await s.sync();assert.equal(f.io.writes.length,0);
});
test('focus ownership, inactive offers and fresh baseline prevent cross-viewer fan-out',async t=>{
  const f=fixture(t),a=await f.start(),b=await f.start();
  assert.equal(a.clipboard.snapshot().active,false);assert.equal(b.clipboard.snapshot().active,true);
  a.clipboard.offer('inactive');await assert.rejects(a.clipboard.sync(),{code:'clipboard-cancelled'});
  f.io.text='B';await b.clipboard.sync();assert.deepEqual(a.sent,[]);assert.deepEqual(b.sent,['B']);
  a.clipboard.activate();await a.clipboard.sync();assert.deepEqual(a.sent,[]);assert.deepEqual(f.io.writes,[]);
  f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(a.clipboard.snapshot().active,false);assert.equal(a.clipboard.baseline,undefined);
});
test('a delayed local read cannot submit after target change, disable or reconnect reset',async t=>{
  for (const retire of ['deactivate','reset']) {
    const f=fixture(t),c=await f.start(),read=deferred();
    f.nav.clipboard.readText=()=>read.promise;
    const action=c.clipboard.sync();await turn();c.clipboard[retire]();read.resolve('retired');await action;
    assert.deepEqual(c.sent,[]);assert.deepEqual(f.io.writes,[]);
  }
});
test('already-started local write reports uncertainty on blur; never retries',async t=>{
  const f=fixture(t),c=await f.start(),write=deferred();
  f.nav.clipboard.writeText=text=>{f.io.writes.push(text);return write.promise;};
  c.clipboard.offer('remote');const action=c.clipboard.sync();await turn();
  c.clipboard.deactivate();write.resolve();await action;
  assert.equal(c.clipboard.phase,'clipboard-uncertain');assert.deepEqual(f.io.writes,['remote']);
  c.clipboard.activate();await c.clipboard.sync();assert.deepEqual(f.io.writes,['remote']);
});
test('permissions never prompt on focus; denial, revocation and unsupported query use manual fallback',async t=>{
  const f=fixture(t);f.permissions['clipboard-read'].state='prompt';
  const c=await f.start();assert.equal(f.io.reads,0);
  c.clipboard.deactivate();c.clipboard.activate();await new Promise(r=>setTimeout(r,15));
  assert.equal(f.io.reads,0);assert.equal(c.clipboard.snapshot().effective.toRemote,'manual');
  f.permissions['clipboard-read'].state='granted';f.permissions['clipboard-read'].dispatchEvent(new Event('change'));
  await c.clipboard.sync();assert.equal(c.clipboard.snapshot().effective.toRemote,'auto');
  f.permissions['clipboard-read'].state='denied';f.permissions['clipboard-read'].dispatchEvent(new Event('change'));
  assert.equal(c.clipboard.snapshot().effective.toRemote,'manual');
  f.nav.permissions.query=async()=>{throw Error('unsupported');};
  await c.clipboard.configure({toRemote:'auto',toLocal:'auto'});assert.equal(c.clipboard.snapshot().permissions.read,'unsupported');
});
test('UTF-8 boundary, malformed/oversize and empty input cannot mutate destination',async t=>{
  const f=fixture(t),c=await f.start();
  f.io.text='界'.repeat(21845)+'A';await c.clipboard.paste();assert.equal(new TextEncoder().encode(c.sent[0]).length,65536);
  for (const text of [f.io.text+'B','\ud800','x\0y']) {
    f.io.text=text;await assert.rejects(c.clipboard.paste());assert.equal(c.sent.length,1);
  }
  f.io.text='';assert.equal(await c.clipboard.paste(),false);assert.equal(c.sent.length,1);
});
test('paste waits for an existing read and submits fresh text before allowing keys',async t=>{
  const f=fixture(t),c=await f.start(),read=deferred();f.nav.clipboard.readText=()=>read.promise;
  const poll=c.clipboard.sync();const paste=c.clipboard.paste();await turn();
  f.nav.clipboard.readText=async()=> 'paste';read.resolve('baseline');await poll;
  assert.equal(await paste,true);assert.deepEqual(c.sent,['paste']);
});
test('unavailable cross-tab lock suppresses writes; scope reset revokes requested consent',async t=>{
  const f=fixture(t),c=await f.start();f.io.lock=false;
  c.clipboard.offer('remote');await c.clipboard.sync();assert.deepEqual(f.io.writes,[]);
  await assert.rejects(c.clipboard.paste(),{code:'clipboard-busy'});
  c.clipboard.reset();assert.deepEqual(c.clipboard.snapshot().requested,{toRemote:'off',toLocal:'off'});
});


test('explicit permission action reads once but never transfers, even when it grants access',async t=>{
  const f=fixture(t),c=f.create();f.permissions['clipboard-read'].state='prompt';
  await c.clipboard.configure({toRemote:'auto',toLocal:'auto'});
  f.nav.clipboard.readText=async()=>{f.io.reads++;f.permissions['clipboard-read'].state='granted';return 'permission-only';};
  await c.clipboard.requestPermission();assert.equal(f.io.reads,1);assert.deepEqual(c.sent,[]);assert.deepEqual(f.io.writes,[]);
  f.nav.userActivation.isActive=false;await assert.rejects(c.clipboard.requestPermission(),{code:'clipboard-gesture'});
});
test('a real browser denial changes effective mode; fallback leaves native manual paste available',async t=>{
  const f=fixture(t),c=await f.start();
  f.nav.clipboard.readText=async()=>{throw new DOMException('denied','NotAllowedError');};
  await assert.rejects(c.clipboard.paste(),{name:'NotAllowedError'});
  assert.equal(c.clipboard.snapshot().effective.toRemote,'manual');assert.equal(c.clipboard.paste(),null);
  assert.deepEqual(c.sent,[]);
});


test('clicking an already-focused native input selects it only after readiness',async t=>{
  const f=fixture(t),c=f.create();c.state='connecting';
  c.container.dispatchEvent(new Event('focusin'));assert.equal(c.clipboard.snapshot().active,false);
  c.state='ready';await c.clipboard.configure({toRemote:'auto',toLocal:'auto'});
  assert.equal(c.clipboard.snapshot().active,false);
  c.container.dispatchEvent(new Event('pointerdown'));assert.equal(c.clipboard.snapshot().active,true);
  await c.clipboard.sync();assert.deepEqual(c.sent,[]);
});

import {textPayload,clipboardPayload,payloadText,sameClipboard} from '../../../../third_party/kasm/clipboard-payload.mjs';
function richFixture(t) {
  const f=fixture(t),old=Object.getOwnPropertyDescriptor(globalThis,'ClipboardItem');
  class Item { constructor(values) { this.values=values;this.types=Object.keys(values); } async getType(type) { return this.values[type]; } static supports() { return true; } }
  Object.defineProperty(globalThis,'ClipboardItem',{configurable:true,value:Item});
  t.after(()=>{if(old)Object.defineProperty(globalThis,'ClipboardItem',old);else delete globalThis.ClipboardItem;});
  f.io.payload=textPayload('baseline');f.io.richWrites=[];
  f.nav.clipboard.read=async()=>[new Item({...Object.fromEntries(f.io.payload.items.map(({type,data})=>[type,new Blob([data],{type})])),...(f.io.receipt ? {[f.io.receipt.type]:f.io.receipt.blob} : {})})];
  f.nav.clipboard.write=async items=>{
    const representations=[];
    for(const type of items[0].types){if(type.startsWith('web ')){f.io.receipt={type,blob:await items[0].getType(type)};continue;}representations.push({type,data:new Uint8Array(await (await items[0].getType(type)).arrayBuffer())});}
    f.io.payload=clipboardPayload(representations);f.io.richWrites.push(f.io.payload);
  };
  const client=f.create();client.capabilities.clipboardRich=true;client.capabilities.clipboardMaxBytes=2097152;
  client._display.sendClipboard=items=>client.sent.push(clipboardPayload(items));
  return {...f,client};
}
const richText = (plain,html) => clipboardPayload([{type:'text/html',data:new TextEncoder().encode(html)},{type:'text/plain',data:new TextEncoder().encode(plain)}]);
test('rich automatic payload preserves representations, paste ordering and browser normalization without echo',async t=>{
  const f=richFixture(t),c=await f.start(f.client),s=c.clipboard;
  f.io.payload=richText('local','<b>local</b>');assert.equal(await s.paste(),true);
  assert(sameClipboard(c.sent[0],f.io.payload));s.offer(f.io.payload);await s.sync();assert.equal(f.io.richWrites.length,0);
  const originalWrite=f.nav.clipboard.write;
  f.nav.clipboard.write=async items=>{await originalWrite(items);f.io.payload=richText('remote','<html><b>remote</b></html>');};
  s.offer(richText('remote','<b>remote</b>'));await s.sync();await s.sync();
  assert.equal(f.io.richWrites.length,1);assert.equal(c.sent.length,1);
  assert.deepEqual(s.snapshot().formats,['text/plain','text/html','image/png']);
  assert.equal(JSON.stringify(c.events).includes('<b>'),false);
});
test('rich browser denial, oversize and unsupported representations never submit partial text',async t=>{
  const f=richFixture(t),c=await f.start(f.client),s=c.clipboard;
  f.nav.clipboard.read=async()=>[new ClipboardItem({'text/plain':new Blob(['small']), 'text/html':new Blob(['x'.repeat(2097152)])})];
  await assert.rejects(s.paste(),{code:'clipboard-size'});assert.equal(c.sent.length,0);
  f.nav.clipboard.read=async()=>[new ClipboardItem({'text/plain':new Blob(['small']), 'text/uri-list':new Blob(['file:///example'])})];
  await assert.rejects(s.paste(),{code:'clipboard-format'});assert.equal(c.sent.length,0);
  delete f.nav.clipboard.read;assert.equal(s.snapshot().effective.toRemote,'manual');assert.deepEqual(s.snapshot().formats,['text/plain']);
});
test('rich delayed read is retired on target change and late write stays uncertain',async t=>{
  const f=richFixture(t),c=await f.start(f.client),s=c.clipboard,read=deferred();
  f.nav.clipboard.read=()=>read.promise;const pending=s.sync();await turn();s.deactivate();
  read.resolve([new ClipboardItem({'text/html':new Blob(['<b>retired</b>'])})]);await pending;assert.equal(c.sent.length,0);
  f.nav.clipboard.read=async()=>[new ClipboardItem({'text/plain':new Blob(['baseline'])})];s.activate();await s.sync();
  const write=deferred();f.nav.clipboard.write=()=>write.promise;s.offer(richText('remote','<b>remote</b>'));
  const writing=s.sync();await turn();s.deactivate();write.resolve();await writing;assert.equal(s.phase,'clipboard-uncertain');
});
test('rich focus ownership, conflict and permission retirement preserve independent viewers',async t=>{
  const f=richFixture(t),a=await f.start(f.client),b=f.create();
  b.capabilities={...a.capabilities};b._display.sendClipboard=items=>b.sent.push(clipboardPayload(items));await f.start(b);
  a.clipboard.offer(richText('inactive','<b>inactive</b>'));
  await assert.rejects(a.clipboard.sync(),{code:'clipboard-cancelled'});
  f.io.payload=richText('B local','<b>B local</b>');await b.clipboard.sync();
  assert.equal(a.sent.length,0);assert.equal(b.sent.length,1);assert.equal(f.io.richWrites.length,0);
  f.io.payload=richText('local conflict','<b>local conflict</b>');b.clipboard.offer(richText('remote conflict','<b>remote conflict</b>'));await b.clipboard.sync();
  assert.equal(b.clipboard.snapshot().phase,'conflict');assert.equal(b.sent.length,1);assert.equal(f.io.richWrites.length,0);
  assert.equal(await b.clipboard.paste(),true);assert.equal(b.sent.length,2);
  f.permissions['clipboard-read'].state='denied';f.permissions['clipboard-read'].dispatchEvent(new Event('change'));
  assert.equal(b.clipboard.snapshot().effective.toRemote,'manual');
  b.clipboard.reset();assert.deepEqual(b.clipboard.snapshot().requested,{toRemote:'off',toLocal:'off'});
  a.clipboard.activate();await a.clipboard.sync();assert.equal(a.sent.length,0);
});
test('rich image normalization is reconciled; unavailable tab lock cannot write',async t=>{
  const f=richFixture(t),c=await f.start(f.client),s=c.clipboard;
  const image=bytes=>clipboardPayload([{type:'image/png',data:new Uint8Array(bytes)}]);
  const originalWrite=f.nav.clipboard.write;
  f.nav.clipboard.write=async items=>{await originalWrite(items);f.io.payload=image([1,2,3,4]);};
  s.offer(image([1,2,3]));await s.sync();await s.sync();assert.equal(f.io.richWrites.length,1);assert.equal(c.sent.length,0);
  f.io.lock=false;s.offer(image([5,6,7]));await s.sync();assert.equal(f.io.richWrites.length,1);
  f.io.lock=true;s.reset();s.offer(image([8,9]));assert.equal(f.io.richWrites.length,1);
});

test('an unchanged oversized local PNG can be replaced by a remote copy without an upload',async t=>{
  const f=richFixture(t),c=f.client,s=c.clipboard;
  const caps=c.capabilities;
  caps.clipboardMaxBytes=10*1024*1024;
  const large=new Uint8Array(caps.clipboardMaxBytes+1);
  f.nav.clipboard.read=async()=>f.io.richWrites.length ? [
    new ClipboardItem({'text/plain':new Blob(['fresh remote text'])}),
  ] : [new ClipboardItem({'image/png':new Blob([large],{type:'image/png'})})];
  await f.start(c);
  assert.equal(s.phase,'watching');
  await assert.rejects(s.paste(),{code:'clipboard-size'});
  assert.equal(s.conflict,false);assert.deepEqual(c.sent,[]);
  s.offer('fresh remote text');await s.sync();
  assert.equal(s.phase,'copied-to-local');
  assert.equal(payloadText(f.io.richWrites[0]),'fresh remote text');
});

test('a changed oversized image preserves the local clipboard even if its length matches',async t=>{
  const f=richFixture(t),c=f.client,s=c.clipboard;
  const large=new Uint8Array(c.capabilities.clipboardMaxBytes+1);
  f.nav.clipboard.read=async()=>[new ClipboardItem({'image/png':new Blob([large],{type:'image/png'})})];
  await f.start(c);
  large[large.length-1]=1;
  s.offer('conflicting remote text');await s.sync();
  assert.equal(s.phase,'conflict');
  assert.deepEqual(c.sent,[]);assert.deepEqual(f.io.richWrites,[]);
});

test('resolved text writes with empty or stale readback never report copied-to-local or consume local state',async t=>{
  const f=fixture(t),c=await f.start(),s=c.clipboard;
  const baseline=s.baseline;
  for(const readback of ['', 'stale']) {
    s.conflict=false;f.io.text='baseline';
    f.nav.clipboard.writeText=async text=>{f.io.writes.push(text);f.io.text=readback;};
    s.offer('fresh remote');await s.sync();
    assert.equal(s.phase,'clipboard-uncertain');assert.equal(s.baseline,baseline);
    assert.equal(s.conflict,true);assert.equal(f.io.text,readback);
    assert.deepEqual(s.requested,{toRemote:'auto',toLocal:'auto'});
  }
  assert.deepEqual(c.sent,[]);assert.equal(f.io.writes.length,2);
});

test('a distinct local copy during remote normalization is preserved and requires an explicit source choice',async t=>{
  const f=richFixture(t),c=await f.start(f.client),s=c.clipboard;
  const originalWrite=f.nav.clipboard.write,gate=deferred(),entered=deferred();
  f.nav.clipboard.write=async items=>{await originalWrite(items);entered.resolve();await gate.promise;};
  const baseline=s.baseline;
  s.offer(richText('remote','<b>remote</b>'));const pending=s.sync();await entered.promise;
  f.io.payload=richText('fresh local','<i>fresh local</i>');f.io.receipt=null;gate.resolve();await pending;
  assert.equal(s.phase,'clipboard-uncertain');assert.equal(s.conflict,true);
  assert.equal(s.baseline,baseline);assert.equal(payloadText(f.io.payload),'fresh local');assert.deepEqual(c.sent,[]);
  await s.sync();assert.equal(f.io.richWrites.length,1);assert.deepEqual(c.sent,[]);
  assert.equal(await s.paste(),true);assert.equal(payloadText(c.sent[0]),'fresh local');
});

test('a receipt cannot hide missing representations or corrupted plain text',async t=>{
  const f=richFixture(t),c=await f.start(f.client),s=c.clipboard,write=f.nav.clipboard.write;
  f.nav.clipboard.write=async items=>{await write(items);f.io.payload=textPayload('remote');};
  s.offer(richText('remote','<b>remote</b>'));await s.sync();assert.equal(s.phase,'clipboard-uncertain');
  s.conflict=false;f.io.payload=s.baseline;f.io.receipt=null;
  f.nav.clipboard.write=async items=>{await write(items);f.io.payload=richText('lost plain','<b>remote</b>');};
  s.offer(richText('remote','<b>remote</b>'));await s.sync();assert.equal(s.phase,'clipboard-uncertain');
  assert.deepEqual(c.sent,[]);
});

test('normalized rich writes without browser receipt support remain uncertain unless content is exact',async t=>{
  const f=richFixture(t),c=await f.start(f.client),s=c.clipboard,write=f.nav.clipboard.write;
  ClipboardItem.supports=type=>!type.startsWith('web ');
  f.nav.clipboard.write=async items=>{await write(items);f.io.payload=richText('remote','<html><b>remote</b></html>');};
  s.offer(richText('remote','<b>remote</b>'));await s.sync();assert.equal(s.phase,'clipboard-uncertain');
  s.conflict=false;f.nav.clipboard.write=write;f.io.payload=s.baseline;
  s.offer(richText('exact','<b>exact</b>'));await s.sync();assert.equal(s.phase,'copied-to-local');
});

test('a genuine upload echo is ignored but a distinct later remote copy is delivered',async t=>{
  const f=fixture(t),c=await f.start(),s=c.clipboard;
  f.io.text='A';await s.sync();s.offer('A');await s.sync();
  assert.deepEqual(c.sent,['A']);assert.deepEqual(f.io.writes,[]);
  s.offer('B');await s.sync();
  assert.equal(f.io.text,'B');assert.deepEqual(f.io.writes,['B']);
  for(let i=0;i<10;i++)await s.sync();
  assert.deepEqual(c.sent,['A']);assert.deepEqual(f.io.writes,['B']);
});

test('a legitimate remote text A-B-A is not an old local upload echo',knownABA,async t=>{
  const f=fixture(t),c=await f.start(),s=c.clipboard;
  f.io.text='A';await s.sync();s.offer('A');await s.sync();
  s.offer('B');await s.sync();assert.equal(f.io.text,'B');
  s.offer('A');await s.sync();
  assert.equal(f.io.text,'A','a new remote A must replace local B');
  assert.deepEqual(c.sent,['A'],'remote delivery must not echo back as an upload');
});

for(const format of ['HTML','PNG + text'])test(`a legitimate remote ${format} A-B-A is delivered`,knownABA,async t=>{
  const f=richFixture(t),c=await f.start(f.client),s=c.clipboard;
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
  // This is a state-machine/representation identity test, not PNG decoding.
  const payload=value=>format==='HTML' ? richText(value,`<b>${value}</b>`) :
    clipboardPayload([{type:'image/png',data:png},{type:'text/plain',data:new TextEncoder().encode(value)}]);
  const a=payload('A'),b=payload('B');
  f.io.payload=a;await s.sync();s.offer(a);await s.sync();
  assert.equal(f.io.richWrites.length,0,'the actual upload echo must stay suppressed');
  s.offer(b);await s.sync();assert(sameClipboard(f.io.payload,b));
  s.offer(a);await s.sync();
  assert(sameClipboard(f.io.payload,a),'the new remote offer must be delivered');
  assert.equal(c.sent.length,1,'remote delivery must not create an upload loop');
});

test('paste after remote A-B-A cannot upload the stale intermediate B',knownABA,async t=>{
  const f=fixture(t),c=await f.start(),s=c.clipboard;
  f.io.text='A';await s.sync();s.offer('B');await s.sync();
  s.offer('A');await s.sync();await s.paste();
  assert.equal(c.sent.at(-1),'A','paste must not overwrite the newest remote A with stale B');
});
