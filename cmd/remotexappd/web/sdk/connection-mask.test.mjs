import test from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionMask } from './connection-mask.js';
import { observePaintedFrame } from '../assets-src/novnc-frame-bridge.mjs';

function fixture(t, enabled = true) {
  const instance = { id:'app', sessionGeneration:2, sessionState:'running', applicationStatus:{ generation:2, state:'ready' } };
  const events = [];
  const client = { connectionMask:enabled, state:'connecting', instanceId:'app', instance,
    manager:{ getInstance:async () => instance }, _emit:(...args) => events.push(args) };
  const mask = new ConnectionMask(client);
  mask.mount = () => {};
  mask.show = (message, step, failed) => { if (mask.enabled) { mask.visible = true; mask.presentation = {message, step, failed}; } };
  t.after(() => mask.destroy());
  return {client, mask, instance, events};
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test('paint and current-generation app ready are both necessary, in either order', async t => {
  for (const paintFirst of [true,false]) {
    const {client,mask,events} = fixture(t);
    mask.begin(); await flush();
    if (paintFirst) mask.frame();
    assert.equal(mask.visible,true);
    client.state='connected'; mask.connected();
    if (!paintFirst) { assert.equal(mask.visible,true); mask.frame(); }
    assert.equal(mask.phase,'ready'); assert.equal(mask.visible,false);
    mask.frame(); assert.equal(events.length,1);
  }
});
test('old status generation and other runtime identity never uncover', t => {
  const {client,mask,instance} = fixture(t);
  client.state='connected'; mask.begin(); mask.connected();
  instance.applicationStatus.generation=1; mask.frame(); assert.equal(mask.visible,true);
  instance.applicationStatus.generation=2; mask.readyInstance={...instance,id:'other'}; mask.check(); assert.equal(mask.visible,true);
});
test('opt-out skips mount and polls; switching on checks the already painted frame', async t => {
  const {client,mask} = fixture(t,false);
  let reads=0; client.manager.getInstance=async()=>{reads++;return client.instance};
  mask.begin(); client.state='connected'; mask.connected(); mask.frame(); await flush();
  assert.equal(mask.visible,false); assert.equal(reads,0);
  mask.setEnabled(true); await flush(); assert.equal(mask.phase,'ready');
  assert.throws(()=>mask.setEnabled('false'),TypeError);
});
test('switching off cancels a late readiness result without changing transport', async t => {
  const {client,mask} = fixture(t); let resolve;
  client.manager.getInstance=()=>new Promise(r=>resolve=r);
  mask.begin(); mask.setEnabled(false); resolve(client.instance); await flush();
  assert.equal(mask.visible,false); assert.equal(client.state,'connecting');
});
test('superseded and destroyed polling results cannot change a replacement', async t => {
  const {client,mask} = fixture(t); const callbacks=[];
  client.manager.getInstance=()=>new Promise(r=>callbacks.push(r));
  mask.begin(); mask.begin(true); callbacks[0]({...client.instance, state:'failed'}); await flush();
  assert.equal(mask.phase,'loading'); assert.equal(mask.reconnecting,true);
  mask.destroy(); callbacks[1](client.instance); await flush(); assert.equal(mask.phase,'idle');
});
test('45 second timeout ends spinner without mutating the app', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const {mask,client} = fixture(t);
  client.manager.getInstance=()=>new Promise(()=>{});
  mask.begin(); t.mock.timers.tick(45000); await flush();
  assert.equal(mask.phase,'error'); assert.equal(mask.presentation.failed,true);
  assert.equal(client.instance.sessionState,'running');
});
test('application failure and exit show bounded error, not readiness', async t => {
  for (const state of ['error','exited']) {
    const {mask,instance,client}=fixture(t); instance.applicationStatus.state=state;
    mask.begin(); client.state='connected'; mask.connected(); await flush(); assert.equal(mask.phase,'error');
  }
});
test('an exited previous generation during on-attach startup is not a new failure', async t => {
  const {mask,instance}=fixture(t);
  instance.sessionState='stopped';instance.applicationStatus={generation:1,state:'exited'};
  mask.begin();await flush();assert.equal(mask.phase,'loading');
});
test('temporary status errors remain covered and disconnect clears timers', async t => {
  const {mask,client}=fixture(t);
  client.manager.getInstance=async()=>{throw Error('network')};
  mask.begin(); await flush(); assert.equal(mask.phase,'loading');
  mask.disconnect(); assert.equal(mask.visible,false); assert.equal(mask.phase,'idle');
});
test('independent viewers never share readiness or enabled preference', t => {
  const a=fixture(t),b=fixture(t); a.mask.begin();b.mask.begin();a.mask.setEnabled(false);
  assert.equal(a.mask.visible,false);assert.equal(b.mask.visible,true);
});
test('frame adapter observes actual paints including black, not allocation, restores on disposal', () => {
  let draws=0,paints=0;
  const original=function(){assert.equal(this,context);draws++};
  const context={drawImage:original};
  const rfb={_display:{_targetCtx:context},_rfbConnectionState:'connecting',_fbWidth:1280,_fbHeight:720};
  const dispose=observePaintedFrame(rfb,()=>paints++);
  context.drawImage('black');assert.equal(paints,0);
  rfb._rfbConnectionState='connected'; context.drawImage('black');assert.equal(paints,1);
  const late=context.drawImage; dispose();assert.equal(context.drawImage,original);
  late.call(context,'stale');assert.equal(paints,1);assert.equal(draws,3);
  assert.throws(()=>observePaintedFrame({},()=>{}),/Unsupported/);
});
