import test from 'node:test';
import assert from 'node:assert/strict';
import {ClipboardOrder} from '../clipboard-order.mjs';
import {clipboardTransferTimeout,MAX_CLIPBOARD_TRANSFER_TIMEOUT_MS,MAX_RICH_CLIPBOARD_BYTES} from '../clipboard-payload.mjs';
const rev = n => n.toString(16).padStart(16, '0');
const wire = (op, id, revision) => `rx-clip:1:${op}:${id.toString(16).padStart(8, '0')}:${rev(revision)}`;
function fixture() {
  const sent = [], bodies = [], timers = new Map(); let changes = 0;
  const order = new ClipboardOrder({sendFence:message => { sent.push(message); return true; }, send:body => bodies.push(body),
    changed:() => { changes++; }, setTimer:fn => { const id = {}; timers.set(id, fn); return id; }, clearTimer:id => timers.delete(id)});
  const reply = (op, revision, id = order.pending?.id ?? 0) => order.fence(wire(op, id, revision), 0);
  const ready = async () => { const pending = order.start(); reply('I', 5); await pending; };
  return {order, sent, bodies, timers, reply, ready, get changes() { return changes; }, expire() { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } }};
}

test('ordinary Fence echo is not capability negotiation and never submits content', async () => {
  const f = fixture(), pending = f.order.start();
  assert.equal(f.order.fence(f.sent[0], 0), true); assert.equal(f.order.ready, false);
  f.expire(); await assert.rejects(pending, {code:'clipboard-ordering-unavailable'});
  assert.deepEqual(f.bodies, []); assert.equal(f.timers.size, 0);
  f.reply('I', 5, 1); assert.equal(f.order.ready, true, 'late same-connection capability may recover after background delay');
  await f.order.start(); assert.equal(f.sent.length, 1); f.order.dispose();
});

test('conditional body and admission remain correlated; snapshot revision is distinct from latest metadata', async () => {
  const f = fixture(); await f.ready();
  f.reply('O', 5, 0); f.reply('V', 6, 0);
  assert.equal(f.order.takeOfferRevision(), rev(5)); assert.equal(f.order.takeOfferRevision(), null);
  assert.equal(f.order.revision, rev(6));
  const pending = f.order.submit(['synthetic'], rev(5));
  assert.equal(JSON.stringify(f.order.pending).includes('synthetic'), false, 'the pending admission keeps no clipboard payload');
  assert.equal(f.sent.at(-1), wire('A', 2, 5)); assert.deepEqual(f.bodies, [['synthetic']]);
  f.reply('F', 6); await assert.rejects(pending, {code:'clipboard-conflict'});
  assert.equal(f.timers.size, 0); assert.equal(f.order.ready, true);
  const accepted = f.order.submit(['new synthetic'], rev(6)); f.reply('V', 7, 0); f.reply('S', 7);
  assert.deepEqual(await accepted, {revision:rev(7)}); assert.equal(f.order.revision, rev(7));
  f.reply('I', 5, 1); assert.equal(f.order.revision, rev(7), 'duplicate capability reply cannot rewind destination ordering');
  assert.equal(JSON.stringify(f.order.pending).includes('synthetic'), false);
  f.order.dispose();
});

test('two pending submissions do not overlap; explicit source choice is unconditional but acknowledged', async () => {
  const f = fixture(); await f.ready();
  const first = f.order.submit(['one'], rev(5));
  await assert.rejects(f.order.submit(['two'], rev(5)), {code:'clipboard-busy'});
  assert.equal(f.bodies.length, 1); f.reply('S', 6); await first;
  const manual = f.order.submit(['explicit'], null); assert.equal(f.sent.at(-1), wire('U', 3, 0));
  f.reply('S', 7); assert.deepEqual(await manual, {revision:rev(7)}); f.order.dispose();
});

test('timeout cancels a bounded arm; stale ACK cannot finish or rebase a new operation', async () => {
  const f = fixture(); await f.ready();
  const old = f.order.submit(['old'], rev(5)); f.expire();
  await assert.rejects(old, {code:'clipboard-uncertain'}); assert.equal(f.sent.at(-1), wire('C', 2, 0));
  const current = f.order.submit(['chosen'], null); const record = f.order.pending;
  f.reply('S', 6, 2); assert.equal(f.order.pending, record); assert.equal(f.order.revision, rev(5));
  f.reply('S', 7); await current; assert.equal(f.timers.size, 0); f.order.dispose();
});

test('invalid or nonadvancing completion is uncertain, never a successful delivery', async () => {
  const f = fixture(); await f.ready();
  const first = f.order.submit(['same'], rev(5)); f.reply('S', 5);
  await assert.rejects(first, {code:'clipboard-uncertain'});
  assert.equal(f.order.revision, rev(5));
  const next = f.order.submit(['other'], rev(5)); f.reply('E', 5);
  await assert.rejects(next, {code:'clipboard-uncertain'}); f.order.dispose();
});

test('disposal and invalid metadata retire observers without tearing down the display', async () => {
  const f = fixture(); await f.ready(); const pending = f.order.submit(['test'], rev(5));
  f.reply('V', 0, 0); await assert.rejects(pending, {code:'clipboard-ordering-unavailable'});
  assert.equal(f.order.ready, false); assert.equal(f.timers.size, 0);
  const g = fixture(), setup = g.order.start(); g.order.dispose();
  await assert.rejects(setup, {code:'clipboard-cancelled'}); g.reply('I', 5, 1);
  assert.equal(g.order.ready, false); assert.equal(g.timers.size, 0); f.order.dispose();
  assert.equal(g.order.started,null);assert.equal(g.order.send(['retired']),undefined);assert.deepEqual(g.bodies,[]);
});

test('transaction identifiers never wrap and transport failures never replay a body', async () => {
  const f = fixture(); await f.ready(); f.order.sequence = 0xffffffff;
  assert.throws(() => f.order.submit(['test'], rev(5)), {code:'clipboard-ordering-exhausted'});
  assert.deepEqual(f.bodies, []); f.order.dispose();
  const g = fixture(); await g.ready(); g.order.send = () => { throw Error('socket lost'); };
  const failed = g.order.submit(['test'], rev(5)); await assert.rejects(failed, {code:'clipboard-uncertain'});
  assert.equal(g.sent.filter(m => m.includes(':A:')).length, 1); assert.equal(g.timers.size, 0); g.order.dispose();
});

test('missing expected revision is not an implicit unconditional source choice', async () => {
  const f = fixture(); await f.ready();
  await assert.rejects(f.order.submit(['test']), {code:'clipboard-ordering-unavailable'});
  assert.deepEqual(f.bodies, []); assert.equal(f.sent.length, 1); f.order.dispose();
});

test('a snapshot carries fresh metadata ahead of coalesced notifications without relabelling an old snapshot', async () => {
  const f=fixture();await f.ready();f.reply('O',7,0);
  assert.equal(f.order.revision,rev(7));assert.equal(f.order.takeOfferRevision(),rev(7));
  f.reply('O',6,0);assert.equal(f.order.revision,rev(7));assert.equal(f.order.takeOfferRevision(),rev(6));
  f.order.dispose();
});

test('cancelled submission is uncertain and its late ACK cannot mutate the next source choice', async () => {
  const f=fixture();await f.ready();const old=f.order.submit(['old'],rev(5));f.order.cancelSubmission();
  await assert.rejects(old,{code:'clipboard-uncertain'});assert.equal(f.sent.at(-1),wire('C',2,0));
  const next=f.order.submit(['chosen'],null);f.reply('S',6,2);assert.equal(f.order.pending.id,3);
  f.reply('S',7);await next;assert.equal(f.timers.size,0);f.order.dispose();
});

test('metadata notification is acknowledged only as content-free connection state', async () => {
  const f=fixture();await f.ready();f.reply('V',7,0);
  assert.equal(f.sent.at(-1),wire('K',1,7));assert.deepEqual(f.bodies,[]);assert.equal(f.order.pending,null);
  f.order.dispose();
});

test('large acknowledged transfers have a finite size budget independent of browser I/O', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const order=new ClipboardOrder({sendFence:()=>true,send:()=>{}});
  const hello=order.start();order.fence(wire('I',1,5),0);await hello;
  const pending=order.submit(['bounded synthetic content'],rev(5),MAX_RICH_CLIPBOARD_BYTES);
  assert.equal(clipboardTransferTimeout(MAX_RICH_CLIPBOARD_BYTES),50000);
  assert.equal(MAX_CLIPBOARD_TRANSFER_TIMEOUT_MS,50000);
  assert.throws(()=>clipboardTransferTimeout(MAX_RICH_CLIPBOARD_BYTES+1),{code:'clipboard-size'});
  t.mock.timers.tick(10000);assert.equal(order.pending.id,2);
  order.fence(wire('S',2,6),0);await pending;order.dispose();
});

test('an ACK arriving after a suspension gap cannot commit before the overdue timer runs', async t => {
  let clock=Date.now();t.mock.method(Date,'now',()=>clock);
  const f=fixture();await f.ready();const pending=f.order.submit(['expired'],rev(5));
  clock+=10001;f.reply('S',6);await assert.rejects(pending,{code:'clipboard-uncertain'});
  assert.equal(f.order.revision,rev(5));assert.equal(f.order.pending,null);f.order.dispose();
});
