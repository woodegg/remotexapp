import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeReconnect, reconnectPolicy, retryable} from './native-reconnect.js';

const record = () => ({id:'app',state:'ready',displayProvider:'kasm',sessionState:'running',
  sessionGeneration:3,displayComponentDigest:'a'.repeat(64),applicationStatus:{state:'ready'}});
const tick = () => new Promise(resolve => setTimeout(resolve, 8));
function fixture(overrides = {}) {
  const events = [], connections = [];
  const r = new NativeReconnect({policy:{maxAttempts:2,delays:[1]},read:async()=>record(),
    connect:async value=>connections.push(value),event:(name,value)=>events.push({name,...value}),...overrides});
  return {r,events,connections};
}
async function until(predicate) {
  for(let i=0;i<100;i++) {if(predicate()) return;await tick();}
  assert.fail('Reconnect outcome timed out');
}
test('reconnect attaches only the same running generation and resets after success', async t => {
  const f=fixture();t.after(()=>f.r.cancel());
  f.r.begin(record(),new Error('network'));
  await until(()=>f.events.some(e=>e.name==='reconnected'));
  assert.equal(f.connections.length,1);
  assert.deepEqual(f.events.map(e=>e.name),['reconnecting','reconnected']);
  f.r.begin(record(),new Error('network'));
  await until(()=>f.connections.length===2);
  assert.deepEqual(f.events.filter(e=>e.name==='reconnecting').map(e=>e.attempt),[1,1]);
});
test('transient failures consume a finite budget and emit exhaustion once', async t => {
  let calls=0;
  const f=fixture({connect:async()=>{calls++;throw new Error('offline');}});t.after(()=>f.r.cancel());
  f.r.begin(record(),new Error('offline'));
  await until(()=>f.events.some(e=>e.name==='reconnectexhausted'));
  await tick();assert.equal(calls,2);
  assert.equal(f.events.filter(e=>e.name==='reconnectexhausted').length,1);
});
test('stop, failed session, component/generation replacement and shutdown veto never reattach', async t => {
  for(const changes of [{state:'stopped'},{sessionState:'stopped'},{sessionState:'failed'},
    {sessionGeneration:4},{displayComponentDigest:'b'.repeat(64)},{id:'other'},
    {displayProvider:'tigervnc'},{shutdown:{state:'blocked'}},{applicationStatus:{state:'exited'}}]) {
    const f=fixture({read:async()=>({...record(),...changes})});t.after(()=>f.r.cancel());
    f.r.begin(record(),new Error('closed'));
    await until(()=>f.events.some(e=>e.name==='reconnectstopped'));
    assert.equal(f.connections.length,0,JSON.stringify(changes));
  }
});
test('authentication refusal does not retry or conceal a rejected grant', async t => {
  const f=fixture({read:async()=>{throw Object.assign(new Error('denied'),{status:403});}});t.after(()=>f.r.cancel());
  f.r.begin(record(),new Error('closed'));
  await until(()=>f.events.some(e=>e.name==='reconnectstopped'));
  assert.equal(f.events.filter(e=>e.name==='reconnecting').length,1);
  assert.equal(f.connections.length,0);
  assert.equal(f.r.begin(record(),{code:'grant-expired'}),false);
});
test('cancel during an outstanding status read fences its late response', async t => {
  let resolve;
  const f=fixture({read:()=>new Promise(r=>{resolve=r;})});t.after(()=>f.r.cancel());
  f.r.begin(record(),new Error('network'));await until(()=>resolve);
  f.r.cancel();resolve(record());await tick();
  assert.equal(f.connections.length,0);
  assert.equal(f.events.length,1);
});
test('cancel from the reconnecting event prevents even the first request', async () => {
  let reads=0,r;
  r=new NativeReconnect({policy:true,read:async()=>{reads++;return record();},connect:async()=>assert.fail(),event:()=>r.cancel()});
  r.begin(record(),new Error('network'));await tick();assert.equal(reads,0);assert.equal(r.timer,null);
});
test('policy validation and permanent errors are explicit', () => {
  assert.equal(reconnectPolicy(false),null);
  assert.equal(reconnectPolicy(true).maxAttempts,4);
  for(const value of [null,0,'yes',[],{maxAttempts:Infinity},{maxAttempts:21},{delays:[]},{delays:[0]},{delays:[60001]}])
    assert.throws(()=>reconnectPolicy(value));
  assert.equal(retryable({cause:{status:401}}),false);
  assert.equal(retryable({name:'AbortError'}),false);
  assert.equal(retryable({code:'stale-generation'}),false);
  const f=fixture({policy:false});assert.equal(f.r.begin(record(),new Error()),false);
});
