import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioIntentJournal} from './audio-intent-journal.js';
function fixture() {
  const values=new Map(),events=new Map();let next=0,serial=Promise.resolve();
  const env={location:{href:'https://audio.test/rx/',origin:'https://audio.test'},crypto:{randomUUID:()=>`owner-${++next}`},
    localStorage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)},
    navigator:{locks:{request(_key,_options,fn){const p=serial.then(fn);serial=p.catch(()=>{});return p;}}},
    addEventListener(_name,fn){events.set(fn,true);},removeEventListener(_name,fn){events.delete(fn);}};
  const create=()=>new AudioIntentJournal(env,'/rx/');
  return {env,values,events,create};
}

test('no journal state or mere construction grants microphone participation',async()=>{
  const f=fixture(),a=f.create();
  assert.deepEqual(a.read('app',1,'microphone'),{available:true,enabled:false,participating:false,revision:0,epoch:0});
  assert.equal(f.values.size,0);await a.dispose();
  assert.equal(f.values.size,0,'an unused owner does not create persistent switch metadata');
  assert.equal(a.read('app',1,'microphone').available,false);
});

test('shared off followed by another owner on invalidates old participation across Worker loss',async()=>{
  const f=fixture(),a=f.create(),b=f.create();
  const first=await a.publish('app',1,'microphone',true);
  await b.publish('app',1,'microphone',true);
  assert.equal(a.read('app',1,'microphone').epoch,first.epoch);
  assert(a.read('app',1,'microphone').participating);
  await b.publish('app',1,'microphone',false);await b.publish('app',1,'microphone',true);
  assert(!a.read('app',1,'microphone').participating);
  assert(b.read('app',1,'microphone').participating);
  assert(b.read('app',1,'microphone').epoch>first.epoch);
  await a.dispose();await b.dispose();
});

test('runtime generation, integration kind, Manager base and storage partition are isolated',async()=>{
  const f=fixture(),a=f.create();await a.publish('app',1,'microphone',true);
  for(const [runtime,generation,kind] of [['app',2,'microphone'],['other',1,'microphone'],['app',1,'speaker']])assert(!a.read(runtime,generation,kind).participating);
  const other=new AudioIntentJournal(f.env,'/different');assert(!other.read('app',1,'microphone').enabled);
  const partition=fixture().create();assert(!partition.read('app',1,'microphone').enabled);
  assert.throws(()=>new AudioIntentJournal(f.env,'https://other.test/'),/same origin/);
  await a.dispose();await other.dispose();await partition.dispose();
});

test('owner retirement removes only its participation and is one idempotent operation',async()=>{
  const f=fixture(),a=f.create(),b=f.create();await a.publish('app',1,'microphone',true);await b.publish('app',1,'microphone',true);
  const pending=a.dispose();assert.equal(a.dispose(),pending);await pending;
  assert(b.read('app',1,'microphone').participating);assert(b.read('app',1,'microphone').enabled);
  assert.equal(f.events.size,1);await b.dispose();assert.equal(f.events.size,0);
});

test('logout fences every old participant and target, without authorizing a fresh document',async()=>{
  const f=fixture(),a=f.create(),b=f.create();await a.publish('app',1,'speaker',true);await b.publish('other',1,'microphone',true);
  await a.dispose({logout:true});assert(!b.read('other',1,'microphone').enabled);
  const fresh=f.create();assert(!fresh.read('other',1,'microphone').participating);
  await b.publish('other',1,'microphone',true);assert(b.read('other',1,'microphone').participating);assert(!fresh.read('other',1,'microphone').participating);
  await b.dispose();await fresh.dispose();
});

test('queued publication cannot restore on after local retirement',async()=>{
  const f=fixture(),a=f.create();let unlock;const gate=new Promise(r=>unlock=r),locks=f.env.navigator.locks;
  f.env.navigator.locks={request:async(k,o,fn)=>{await gate;return locks.request(k,o,fn);}};
  const enabling=a.publish('app',1,'microphone',true),retiring=a.dispose();unlock();
  assert.equal((await enabling).available,false);await retiring;
  const b=f.create();assert(!b.read('app',1,'microphone').enabled);await b.dispose();
});

test('lock and storage failure or corruption never authorize recovery or destroy stored evidence',async()=>{
  for(const mode of ['locks','storage','corrupt','oversize']){
    const f=fixture(),a=f.create();await a.publish('app',1,'microphone',true);
    if(mode==='locks')f.env.navigator.locks=null;
    if(mode==='storage')f.env.localStorage={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};
    if(mode==='corrupt')f.values.set(a.key,'{"version":1,"revision":1,"entries":[{}]}');
    if(mode==='oversize')f.values.set(a.key,'x'.repeat(262145));
    const before=f.values.get(a.key);assert.equal((await a.publish('app',1,'microphone',true)).available,false);
    assert.equal(f.values.get(a.key),before);
    assert.equal(a.read('app',1,'microphone').available,false);
    await a.dispose();
  }
});

test('participants and target cache are bounded and eviction cannot grant an old owner authority',async()=>{
  const f=fixture(),owners=Array.from({length:40},()=>f.create());
  for(const a of owners)await a.publish('app',1,'microphone',true);
  assert(!owners[0].read('app',1,'microphone').participating);assert(owners.at(-1).read('app',1,'microphone').participating);
  for(let i=0;i<140;i++)await owners[0].publish('app-'+i,1,'speaker',true);
  const raw=JSON.parse(f.values.get(owners[0].key));assert.equal(raw.entries.length,128);
  assert(!owners.at(-1).read('app',1,'microphone').participating);
  for(const a of owners)await a.dispose();
});

test('invalid targets and nonboolean intent are rejected; malformed shared entries fail closed',async()=>{
  const f=fixture(),a=f.create();
  for(const args of [['app',0,'speaker'],['app',1,'other'],['bad/key',1,'microphone']])assert.throws(()=>a.read(...args),TypeError);
  assert.throws(()=>a.publish('app',1,'microphone',1),TypeError);
  await a.publish('app',1,'microphone',true);const raw=JSON.parse(f.values.get(a.key));raw.entries[0].participants.push(raw.entries[0].participants[0]);f.values.set(a.key,JSON.stringify(raw));
  assert.equal(a.read('app',1,'microphone').available,false);await a.dispose();
});

test('storage notifications wake reconciliation without exposing stored content or retaining disposed listeners',async()=>{
  const f=fixture(),a=f.create();let calls=0;const unsubscribe=a.subscribe(()=>calls++);
  for(const fn of f.events.keys()){fn({key:'unrelated'});fn({key:a.key});fn({key:null});}
  assert.equal(calls,2);unsubscribe();for(const fn of f.events.keys())fn({key:a.key});assert.equal(calls,2);
  await a.dispose();assert.equal(f.events.size,0);
});

test('a browser SecurityError while accessing localStorage fails closed',async()=>{
  const f=fixture(),a=f.create();Object.defineProperty(f.env,'localStorage',{get(){throw new DOMException('blocked','SecurityError');}});
  assert.equal(a.read('app',1,'microphone').available,false);
  assert.equal((await a.publish('app',1,'microphone',true)).available,false);
  assert.equal((await a.dispose()).available,false);
});

test('retired targets lose participation and are evicted before an older live target',async()=>{
  const f=fixture(),a=f.create();await a.publish('live',1,'microphone',true);
  for(let i=0;i<140;i++){await a.publish('closed-'+i,1,'speaker',true);await a.leave('closed-'+i,1);}
  assert(a.read('live',1,'microphone').participating);
  assert(!a.read('closed-139',1,'speaker').participating);
  assert.equal(JSON.parse(f.values.get(a.key)).entries.length,128);
  await a.dispose();
});

test('a revision that cannot be incremented cannot authorize stale recovery',async()=>{
  const f=fixture(),a=f.create();await a.publish('app',1,'microphone',true);
  const raw=JSON.parse(f.values.get(a.key));raw.revision=Number.MAX_SAFE_INTEGER;f.values.set(a.key,JSON.stringify(raw));
  assert.equal(a.read('app',1,'microphone').available,false);
  assert.equal((await a.publish('app',1,'microphone',false)).available,false);
  await a.dispose();
});

test('a valid near-limit journal cannot be made unreadable by another publication',async()=>{
  const f=fixture();f.env.crypto.randomUUID=()=> 'owner-'+'z'.repeat(120);const a=f.create();
  const state={version:1,revision:1,entries:[]};
  const raw=()=>JSON.stringify(state);
  while(raw().length<256000){
    const index=state.entries.length;
    state.entries.push({runtime:'seed-'+index,generation:1,kind:'microphone',enabled:true,revision:1,epoch:1,
      participants:Array.from({length:32},(_,i)=>'participant-'+i+'x'.repeat(110))});
  }
  for(const e of state.entries){
    const extra=Math.min(128-e.runtime.length,262140-raw().length);
    if(extra>0)e.runtime+='x'.repeat(extra);
  }
  const before=raw();assert(before.length>262000 && before.length<262144);
  f.values.set(a.key,before);assert.equal(a.read('new',1,'microphone').available,true);
  assert.equal((await a.publish('new',1,'microphone',true)).available,false);
  assert.equal(f.values.get(a.key),before);await a.dispose();
});

test('a blocked lock has a bounded deadline and a late callback cannot publish intent',async()=>{
  const f=fixture(),a=f.create(),locks=f.env.navigator.locks;let deadline,queued,unlock,signal,cancelled=0;
  f.env.setTimeout=fn=>{deadline=fn;return 1;};f.env.clearTimeout=()=>{cancelled++;};
  f.env.navigator.locks={request(_key,options,fn){queued=fn;signal=options.signal;return new Promise(r=>unlock=r);}};
  const pending=a.publish('app',1,'microphone',true);deadline();
  assert.equal((await pending).available,false);assert(signal.aborted);assert.equal(cancelled,1);
  unlock(queued());await Promise.resolve();assert.equal(f.values.size,0);
  f.env.navigator.locks=locks;delete f.env.setTimeout;delete f.env.clearTimeout;await a.dispose();
});
