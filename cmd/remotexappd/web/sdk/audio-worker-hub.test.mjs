import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
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
  const {env,workers}=fixture(t);let keeper=connectAudioWorker(env,'https://audio.test/sdk/audio-worker.js','v6:0');
  try {
    for(let i=0;i<50;i++){
      const client=connectAudioWorker(env,'https://audio.test/sdk/audio-worker.js','v6:0');
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
  const a=connectAudioWorker(env,'https://audio.test/sdk/audio-worker.js','v6:0');
  const b=connectAudioWorker(env,'https://audio.test/sdk/audio-worker.js','v6:0');
  const other=connectAudioWorker(env,'https://other.test/sdk/audio-worker.js','v6:0');
  let next,failed=0;
  a.onerror=()=>{failed++;a.port.close();a.release();next=connectAudioWorker(env,'https://audio.test/sdk/audio-worker.js','v6:0');};
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
    clients.push(connectAudioWorker(f.env,'https://audio.test/sdk/audio-worker.js','v6:0'));
    clients.push(connectAudioWorker(f.env,'https://audio.test/sdk/audio-worker.js','v6:1'));
    clients.push(connectAudioWorker(g.env,'https://audio.test/sdk/audio-worker.js','v6:0'));
    assert.equal(f.workers.length,2);assert.equal(g.workers.length,1);
  } finally {for(const c of clients){c.port.close();c.release();}}
});
