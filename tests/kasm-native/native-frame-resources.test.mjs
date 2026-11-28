import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nativeFrameResources, takeNativeFrameSnapshot} from './native-frame-resources.mjs';

const fixture = () => ({
  snapshot:{meta:{
    node_fields:['type','name','id','self_size','edge_count'],
    edge_fields:['type','name_or_index','to_node'],
    edge_types:[['property','element','weak'],'string_or_number','node'],
  }},
  strings:['RenamedDecoder','_screenFlags','system / JSArrayBufferData'],
  nodes:[0,0,1,32,1, 1,2,2,4194304,0],
  edges:[0,1,5],
});

test('frame resource counts follow owned properties rather than constructor names', () => {
  assert.deepEqual(nativeFrameResources(fixture()), {frameBufferOwners:1,arrayBufferBackingBytes:4194304});
  const weak = fixture(); weak.edges[0] = 2;
  assert.deepEqual(nativeFrameResources(weak), {frameBufferOwners:0,arrayBufferBackingBytes:4194304});
  const repeated = fixture(); repeated.nodes[4] = 2; repeated.edges.push(0,1,5);
  assert.equal(nativeFrameResources(repeated).frameBufferOwners, 1);
});

test('incomplete heap structures fail instead of returning a false zero', () => {
  const truncated = fixture(); truncated.nodes.pop();
  assert.throws(() => nativeFrameResources(truncated), /incomplete heap nodes/);
  const missing = fixture(); missing.edges = [];
  assert.throws(() => nativeFrameResources(missing), /incomplete heap edge/);
  const extra = fixture(); extra.edges.push(0,1,5);
  assert.throws(() => nativeFrameResources(extra), /unassigned heap edges/);
});

test('snapshot chunks are captured independently of bounded event history and subscription is retired', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'native-frame-resources-'));
  const path = join(directory, 'private.heapsnapshot');
  const raw = JSON.stringify(fixture());
  let handler, subscriptions = 0;
  const browser = {
    onEvent(method, callback) {
      assert.equal(method, 'HeapProfiler.addHeapSnapshotChunk');
      handler = callback; subscriptions++;
      return () => { handler = null; subscriptions--; };
    },
    async call(method) {
      if (method === 'HeapProfiler.takeHeapSnapshot') {
        for (const chunk of [raw.slice(0,20),raw.slice(20)]) handler({params:{chunk}});
      }
    },
  };
  try {
    const result = await takeNativeFrameSnapshot(browser, path);
    assert.equal(result.frameBufferOwners, 1);
    assert.equal(result.arrayBufferBackingBytes, 4194304);
    assert.match(result.heapSHA256, /^[a-f0-9]{64}$/);
    assert.equal(readFileSync(path, 'utf8'), raw);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(subscriptions, 0);
    browser.call = async () => { throw Error('injected snapshot failure'); };
    await assert.rejects(takeNativeFrameSnapshot(browser, path), /injected snapshot failure/);
    assert.equal(subscriptions, 0);
  } finally { rmSync(directory, {recursive:true,force:true}); }
});
