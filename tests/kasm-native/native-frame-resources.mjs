import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';

// Count the pinned decoder's owned flag field rather than a minified class
// name. A live-view positive control must accompany retired-view assertions.
export function nativeFrameResources(snapshot) {
  const {meta} = snapshot.snapshot;
  const fields = meta.node_fields, edgeFields = meta.edge_fields;
  const nodes = snapshot.nodes, edges = snapshot.edges, strings = snapshot.strings;
  const countAt = fields.indexOf('edge_count'), nameAt = fields.indexOf('name');
  const sizeAt = fields.indexOf('self_size'), typeAt = edgeFields.indexOf('type');
  const edgeNameAt = edgeFields.indexOf('name_or_index');
  assert([countAt, nameAt, sizeAt, typeAt, edgeNameAt].every(index => index >= 0));
  assert.equal(nodes.length % fields.length, 0, 'incomplete heap nodes');
  const edgeTypes = meta.edge_types[typeAt];
  let cursor = 0, frameBufferOwners = 0, arrayBufferBackingBytes = 0;
  for (let offset = 0; offset < nodes.length; offset += fields.length) {
    const end = cursor + nodes[offset + countAt] * edgeFields.length;
    assert(end <= edges.length, 'incomplete heap edge stream');
    let ownsFlags = false;
    for (; cursor < end; cursor += edgeFields.length) {
      if (edgeTypes[edges[cursor + typeAt]] === 'property' &&
          strings[edges[cursor + edgeNameAt]] === '_screenFlags') ownsFlags = true;
    }
    if (ownsFlags) frameBufferOwners++;
    if (strings[nodes[offset + nameAt]] === 'system / JSArrayBufferData') {
      arrayBufferBackingBytes += nodes[offset + sizeAt];
    }
  }
  assert.equal(cursor, edges.length, 'unassigned heap edges');
  return {frameBufferOwners, arrayBufferBackingBytes};
}

export async function takeNativeFrameSnapshot(browser, destination) {
  const chunks = [];
  const unsubscribe = browser.onEvent('HeapProfiler.addHeapSnapshotChunk', event => chunks.push(event.params.chunk));
  try {
    await browser.call('HeapProfiler.enable');
    await browser.call('HeapProfiler.takeHeapSnapshot', {reportProgress:false});
    const raw = chunks.join('');
    const resources = nativeFrameResources(JSON.parse(raw));
    // Raw snapshots can contain application content: only the caller's private
    // evidence directory receives them; reports contain counts and a digest.
    writeFileSync(destination, raw, {mode:0o600});
    return {...resources, heapSHA256:createHash('sha256').update(raw).digest('hex')};
  } finally { unsubscribe(); }
}
