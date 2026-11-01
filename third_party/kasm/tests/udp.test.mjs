import test from 'node:test';
import assert from 'node:assert/strict';
import {UDPAssembler, UDPLossTracker} from '../udp.mjs';
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

test('loss observes whole-block gaps and incomplete fragments after the reorder allowance', () => {
  const a=new UDPAssembler();
  assert.equal(a.lossStats(0).state,'waiting');
  a.push(packet(100,0,1),0); a.push(packet(102,0,2),10); a.push(packet(103,0,1),20);
  assert.equal(a.lossStats(2009).lostBlocks,0);
  const s=a.lossStats(2010);
  assert.equal(s.receivedBlocks,2); assert.equal(s.lostBlocks,2);
  assert.equal(s.expectedBlocks,4); assert.equal(s.ratio,.5);
  assert.deepEqual(a.lossStats(2010),s); // Getter does not finalize or double-count.
  a.push(packet(104,0,1),2020);
  assert.equal(a.lossStats(2020).lostBlocks,2);
});
test('loss tolerates reordering and duplicates, including completed block duplicates', () => {
  const a=new UDPAssembler();a.push(packet(8,0,1),0);a.push(packet(11,1,2),10);
  a.push(packet(9,0,1),20);a.push(packet(10,0,1),30);
  a.push(packet(11,1,2),40);a.push(packet(11,0,2),50);a.push(packet(11,0,2),60);
  a.push(packet(7,0,1),70); // Cannot infer blocks before the first observed ID.
  const s=a.lossStats(2100);assert.equal(s.receivedBlocks,4);assert.equal(s.lostBlocks,0);assert.equal(s.ratio,0);
});
test('loss sequence arithmetic wraps at 32 bits without a huge false gap', () => {
  const a=new UDPAssembler();a.push(packet(0xfffffffe,0,1),0);a.push(packet(1,0,1),20);
  a.push(packet(0,0,1),30);
  assert.equal(a.lossStats(2020).expectedBlocks,4);
  assert.equal(a.lossStats(2020).lostBlocks,1); // Only ID 0xffffffff did not arrive.
});
test('late fragments do not reverse finalized loss; fresh healthy traffic ages loss out', () => {
  const a=new UDPAssembler();a.push(packet(1,0,2),0);
  assert.equal(a.lossStats(2000).ratio,1);
  a.push(packet(1,1,2),2001);assert.equal(a.lossStats(2001).ratio,1);
  a.push(packet(2,0,1),3000);assert.equal(a.lossStats(3000).ratio,.5);
  assert.equal(a.lossStats(13000).state,'stale');
  a.push(packet(3,0,1),13000);assert.equal(a.lossStats(13000).ratio,0);
  a.clear();assert.equal(a.lossStats(13000).state,'waiting');
});
test('malformed datagrams do not invent observations or keep stale loss alive', () => {
  const a=new UDPAssembler();
  for(const p of [new Uint8Array(20),packet(1,2,2),packet(1,0,0),packet(1,0,8193)])a.push(p,0);
  assert.equal(a.lossStats(0).state,'waiting');
  a.push(packet(1,0,1),1);a.push(packet(1,0,1),10000);
  assert.equal(a.lossStats(10001).state,'stale');
});
test('loss observation budgets and inconsistent metadata report unavailable, not invented percentages', () => {
  const a=new UDPAssembler();a.push(packet(1,0,1),0);a.push(packet(600,0,1),10);
  assert.equal(a.lossStats(10).state,'unavailable');
  a.push(packet(601,0,1),10011);assert.equal(a.lossStats(10011).ratio,0);
  a.push(packet(602,0,2),10012);a.push(packet(602,1,3),10013);
  assert.equal(a.lossStats(10013).state,'unavailable');
  const t=new UDPLossTracker();
  for(let n=0;n<1200;n++)t.observe(n,0,8192,n,0);
  assert.ok(t.pendingBlocks<=512);assert.equal(t.snapshot(0).state,'unavailable');
});
test('statistics are isolated per assembler and do not change existing assembly retention', () => {
  const a=new UDPAssembler(),b=new UDPAssembler();
  a.push(packet(1,0,2),0);b.push(packet(1,0,1),0);
  const retained=a.retainedBytes;a.lossStats(2500);assert.equal(a.retainedBytes,retained);
  assert.equal(a.lossStats(2500).ratio,1);assert.equal(b.lossStats(2500).ratio,0);
  a.clear();assert.equal(b.lossStats(2500).ratio,0);
});
