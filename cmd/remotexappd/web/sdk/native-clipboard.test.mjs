import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeClipboard} from './native-clipboard.js';
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
