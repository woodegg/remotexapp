import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioContextOperations} from './audio-context-operations.js';

const turn=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
  let next=0;const timers=new Map(),events=[];
  const env={setTimeout(fn){timers.set(++next,fn);return next;},clearTimeout(id){timers.delete(id);}};
  return {ops:new AudioContextOperations(env,(context,kind)=>events.push({context,kind})),timers,events,context:{state:'suspended'},timeout(){for(const fn of [...timers.values()])fn();}};
}

test('a timed-out module remains one native flight until it actually settles',async()=>{
  const f=fixture();let loaded,calls=0;
  const first=f.ops.run(f.context,'module',()=>{calls++;return new Promise(r=>{loaded=r;});});
  f.timeout();await assert.rejects(first,/module-timeout/);
  for(let i=0;i<100;i++)assert.equal(f.ops.run(f.context,'module',()=>{calls++;}),first);
  assert.equal(calls,1);assert.equal(f.ops.pending(f.context),true);
  loaded('ready');await turn();assert.equal(f.ops.pending(f.context),false);
  assert.equal(await f.ops.run(f.context,'module',()=>assert.fail('must reuse settled module')),'ready');
  f.context.state='closed';assert.equal(f.ops.forget(f.context),true);assert.equal(f.ops.contexts.size,0);
});

test('one real gesture can unblock a pending automatic resume without accumulating native calls',async()=>{
  const f=fixture(),complete=[];let calls=0;
  const start=()=>{calls++;return new Promise(resolve=>complete.push(resolve));};
  const automatic=f.ops.run(f.context,'resume',start);
  const gesture=f.ops.run(f.context,'resume',start,{gesture:true});
  assert.notEqual(automatic,gesture);
  for(let i=0;i<100;i++)assert.equal(f.ops.run(f.context,'resume',start,{gesture:true}),gesture);
  assert.equal(calls,2);f.timeout();await assert.rejects(automatic,/resume-timeout/);await assert.rejects(gesture,/resume-timeout/);
  assert.equal(f.ops.forget(f.context),false);
  complete.forEach(resolve=>resolve());await turn();f.context.state='closed';assert.equal(f.ops.forget(f.context),true);
});

test('an explicit pending resume cannot be multiplied by automatic retries or more clicks',async()=>{
  const f=fixture();let finish,calls=0;
  const first=f.ops.run(f.context,'resume',()=>{calls++;return new Promise(r=>{finish=r;});},{gesture:true});
  for(let i=0;i<100;i++)assert.equal(f.ops.run(f.context,'resume',()=>{calls++;},{gesture:i%2===0}),first);
  assert.equal(calls,1);finish();await first;assert.equal(f.timers.size,0);
});

test('a closed context with unresolved native work stays quarantined',async()=>{
  const f=fixture();let loaded,closed;
  const module=f.ops.run(f.context,'module',()=>new Promise(r=>{loaded=r;}));
  const close=f.ops.run(f.context,'close',()=>new Promise(r=>{closed=r;}));
  f.context.state='closed';assert.equal(f.ops.forget(f.context),false);
  assert.equal(f.ops.run(f.context,'close',()=>assert.fail('must join native close')),close);
  closed();await close;assert.equal(f.ops.forget(f.context),false);
  loaded();await module;assert.equal(f.ops.forget(f.context),true);assert.equal(f.timers.size,0);
});

test('settled resume/close rejections may retry without retaining every failed native operation',async()=>{
  const f=fixture();
  for(let i=0;i<100;i++)await assert.rejects(f.ops.run(f.context,'close',()=>Promise.reject(Error('controlled rejection'))),/controlled/);
  assert.equal(f.ops.contexts.get(f.context).get('close').length,1);assert.equal(f.timers.size,0);
  await f.ops.run(f.context,'close',()=>{f.context.state='closed';});assert.equal(f.ops.forget(f.context),true);
});

test('synchronous errors are observed and module failures are not silently reused as success',async()=>{
  const f=fixture();let calls=0;
  await assert.rejects(f.ops.run(f.context,'module',()=>{calls++;throw Error('controlled module');}),/controlled module/);
  await assert.rejects(f.ops.run(f.context,'module',()=>{calls++;}),/controlled module/);
  assert.equal(calls,1);assert.equal(f.events.length,1);assert.equal(f.timers.size,0);
});

test('retired pending graphs bound new owners in the same document scope and late completion frees the pool',async()=>{
 const f=fixture(),other=new AudioContextOperations(f.ops.env,()=>{},3000),isolated=new AudioContextOperations(f.ops.env,()=>{},3000,'another-manager');
 const contexts=[{state:'running'},{state:'running'}],complete=[],waits=[];
 for(const context of contexts){
  const op=context===contexts[0]?f.ops:other;
  op.retire(context);waits.push(op.run(context,'close',()=>new Promise(resolve=>complete.push(()=>{context.state='closed';resolve();}))));
 }
 assert.equal(new AudioContextOperations(f.ops.env).canCreate(),false);assert.equal(isolated.canCreate(),true);
 f.timeout();for(const promise of waits)await assert.rejects(promise,/close-timeout/);
 f.ops.detach();other.detach();complete.forEach(fn=>fn());await turn();
 assert.equal(f.ops.contexts.size,0);assert.equal(other.contexts.size,0);
 assert.equal(f.ops.retired.size,0);assert.equal(other.retired.size,0);assert.equal(f.ops.pools.size,0);
 assert.equal(new AudioContextOperations(f.ops.env).canCreate(),true);
});
