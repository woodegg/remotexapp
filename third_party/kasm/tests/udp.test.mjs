import test from 'node:test';
import assert from 'node:assert/strict';
import {UDPAssembler} from '../udp.mjs';
function packet(id, index, count, data = [1,2], frame = 9) {
  const p = new Uint8Array(20 + data.length), v = new DataView(p.buffer);
  [id,index,count,0,frame].forEach((n,i) => v.setUint32(i*4,n,true)); p.set(data,20); return p;
}
test('UDP reassembles unordered fragments and ignores duplicate accounting', () => {
  const a = new UDPAssembler();
  assert.equal(a.push(packet(1,1,2,[3,4])),null);
  assert.equal(a.push(packet(1,1,2,[3,4])),null);
  assert.equal(a.retainedBytes,2);
  assert.deepEqual([...a.push(packet(1,0,2,[1,2])).data],[1,2,3,4]);
  assert.equal(a.retainedBytes,0); assert.equal(a.size,0);
});
test('UDP rejects malformed fragments, bounds partial messages and expires loss', () => {
  const a = new UDPAssembler();
  for (const p of [new Uint8Array(10),packet(1,3,2),packet(1,0,0),packet(1,0,0xffffffff)]) assert.equal(a.push(p,0),null);
  for (let id=0;id<50;id++) a.push(packet(id,0,2),0);
  assert.equal(a.size,16); assert.equal(a.retainedBytes,32);
  a.push(packet(99,0,2),2001); assert.equal(a.size,1);
  a.push(packet(99,1,3),2002); assert.equal(a.size,0);
  a.push(packet(1,0,2),2003); a.clear(); assert.equal(a.retainedBytes,0);
});
test('UDP byte budgets are independent of claimed fragment count', () => {
  const a = new UDPAssembler(), data = new Uint8Array(65516);
  for(let i=0;i<100;i++) a.push(packet(1,i,100,data),0);
  assert.ok(a.retainedBytes < 4*1024*1024);
});
