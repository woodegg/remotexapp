import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {randomUUID} from 'node:crypto';
import {connectAudioWorker} from './audio-worker-hub.js';

function fixture(t) {
  const workers = [], remote = [];
  const env = {MessageChannel, SharedWorker:class {
    constructor(url, options) {
      this.url=url;this.name=options.name;workers.push(this);
      this.port={start(){},close(){},postMessage({op,port},transfer) {
        assert.equal(op,'attach');assert.equal(transfer[0],port);
        remote.push(port);port.onmessage=({data})=>port.postMessage(data);port.start();
      }};
    }
  }};
  t.after(()=>{for(const port of remote)port.close();});
  return {env,workers};
}
const receive = port => new Promise(resolve => {port.onmessage=({data})=>resolve(data);port.start();});

test('fifty same-document owners share one native worker and have independent disposable ports',async t=>{
  const {env,workers}=fixture(t);let keeper=connectAudioWorker(env,'https://audio.test/sdk/audio-worker.js','v8:0');
  try {
    for(let i=0;i<50;i++){
      const client=connectAudioWorker(env,'https://audio.test/sdk/audio-worker.js','v8:0');
      assert.notEqual(client.port,keeper.port);
      const response=receive(client.port);client.port.postMessage(i);assert.equal(await response,i);
      client.port.close();client.release();client.release();
    }
    assert.equal(workers.length,1);
    const response=receive(keeper.port);keeper.port.postMessage('still alive');assert.equal(await response,'still alive');
  } finally {keeper.port.close();keeper.release();}
});

test('a native worker error invalidates its hub before peers rebind and fences only that hub',async t=>{
  const {env,workers}=fixture(t);
  const a=connectAudioWorker(env,'https://audio.test/sdk/audio-worker.js','v8:0');
  const b=connectAudioWorker(env,'https://audio.test/sdk/audio-worker.js','v8:0');
  const other=connectAudioWorker(env,'https://other.test/sdk/audio-worker.js','v8:0');
  let next,failed=0;
  a.onerror=()=>{failed++;a.port.close();a.release();next=connectAudioWorker(env,'https://audio.test/sdk/audio-worker.js','v8:0');};
  b.onerror=()=>{failed++;b.port.close();b.release();};
  other.onerror=()=>assert.fail('another Manager is independent');
  try {
    workers[0].onerror();assert.equal(failed,2);assert.equal(workers.length,3);
    const response=receive(next.port);next.port.postMessage('fresh');assert.equal(await response,'fresh');
  } finally {for(const client of [a,b,other,next]){client.port.close();client.release();}}
});

test('worker generations and documents do not share native handles',t=>{
  const f=fixture(t),g=fixture(t),clients=[];
  try {
    clients.push(connectAudioWorker(f.env,'https://audio.test/sdk/audio-worker.js','v8:0'));
    clients.push(connectAudioWorker(f.env,'https://audio.test/sdk/audio-worker.js','v8:1'));
    clients.push(connectAudioWorker(g.env,'https://audio.test/sdk/audio-worker.js','v8:0'));
    assert.equal(f.workers.length,2);assert.equal(g.workers.length,1);
  } finally {for(const c of clients){c.port.close();c.release();}}
});

test('two recovery names retain reusable bootstraps and reject unbounded replacement clients',t=>{
 const {env,workers}=fixture(t),url='https://audio.test/sdk/audio-worker.js',key=Symbol.for('remotexapp.audio-worker-hubs.v8');
 let old=connectAudioWorker(env,url,'v8:0'),current=connectAudioWorker(env,url,'v8:1');
 assert.equal(env[key].size,2);
 old.port.close();old.release();
 const next=connectAudioWorker(env,url,'v8:1');
 assert.equal(workers.length,2);assert.equal(env[key].size,2);assert.equal(typeof workers[0].onerror,'function');
 assert.throws(()=>connectAudioWorker(env,url,'v8:2'),/capacity/);
 const reused=connectAudioWorker(env,url,'v8:0');assert.equal(workers.length,2);reused.port.close();reused.release();
 current.port.close();current.release();next.port.close();next.release();
});

test('one hundred confirmed dead incarnations rebind the same name without exhausting its bounded probe budget',t=>{
 const {env,workers}=fixture(t),url='https://audio.test/sdk/audio-worker.js',name='v8:0';
 let client=connectAudioWorker(env,url,name);client.confirm(randomUUID());
 try {
  for(let i=0;i<100;i++){
   const old=client;
   client=connectAudioWorker(env,url,name,{probeOf:old});client.confirm(randomUUID());
   assert.throws(()=>old.confirm(randomUUID()),/superseded/);
   old.port.close();old.release();
   const hubs=env[Symbol.for('remotexapp.audio-worker-hubs.v8')];
   assert.equal(hubs.size,1);assert.equal([...hubs.values()][0].clients.size,1);
   assert.equal([...hubs.values()][0].lineage.probes,0);
  }
  assert.equal(workers.length,101);assert.equal(new Set(workers.map(w=>w.name)).size,1);
  assert(workers.slice(0,-1).every(w=>w.onerror===null));
 } finally {client.port.close();client.release();}
});

test('an alive or unidentified incarnation cannot reset a consumed probe budget',t=>{
 for(const known of [false,true]){
  const {env,workers}=fixture(t),url='https://audio.test/sdk/audio-worker.js',id=randomUUID();
  const first=connectAudioWorker(env,url,'v8:0');if(known)first.confirm(id);
  const probe=connectAudioWorker(env,url,'v8:0',{probeOf:first});probe.confirm(id);
  assert.throws(()=>connectAudioWorker(env,url,'v8:0',{probeOf:probe}),/probe-exhausted/);
  assert.throws(()=>probe.confirm(randomUUID()),/contract/);
  assert.equal(workers.length,2);
  for(const c of [first,probe]){c.port.close();c.release();}
 }
});

test('concurrent stale probes reuse the newer bootstrap and native errors do not erase the lineage budget',t=>{
 const {env,workers}=fixture(t),url='https://audio.test/sdk/audio-worker.js',id=randomUUID();
 const first=connectAudioWorker(env,url,'v8:0');first.confirm(id);
 const probe=connectAudioWorker(env,url,'v8:0',{probeOf:first});probe.confirm(id);
 const concurrent=connectAudioWorker(env,url,'v8:0',{probeOf:first});concurrent.confirm(id);
 assert.equal(workers.length,2);
 workers[1].onerror();
 assert.throws(()=>connectAudioWorker(env,url,'v8:0'),/probe-exhausted/);
 for(const c of [first,probe,concurrent]){c.port.close();c.release();}
});
