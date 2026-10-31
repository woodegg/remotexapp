import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LatencyProbe} from '../latency.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));
const report = (responses = 1, rtt = .025) => new Map([
  ['transport', {type:'transport', selectedCandidatePairId:'selected'}],
  ['unused', {type:'candidate-pair', state:'succeeded', currentRoundTripTime:99, responsesReceived:99}],
  ['selected', {id:'selected', type:'candidate-pair', state:'succeeded', currentRoundTripTime:rtt,
    responsesReceived:responses, localCandidateId:'private', remoteCandidateId:'private'}],
]);
function fixture() {
  let now = 0, connected = true, active = true;
  let peer = {connectionState:'connected', getStats:async () => report()};
  const timers = new Map(), sent = [];
  const p = new LatencyProbe({connected:() => connected, udpActive:() => active,
    peer:() => peer, sendFence:payload => {sent.push(payload);return true;}, token:'test-connection',
    now:() => now, setTimer:(fn, ms) => {const id={};timers.set(id,{fn,at:now+ms});return id;},
    clearTimer:id => timers.delete(id)});
  return {p, sent, timers, set peer(value) {peer=value;}, set active(value) {active=value;},
    set connected(value) {connected=value;},
    tick(ms) {now+=ms;for (const [id,t] of [...timers]) if (t.at<=now) {timers.delete(id);t.fn();}}};
}

test('snapshot is passive; Fence RTT is correlated, rate limited, and zero is valid', async () => {
  const f=fixture();f.p.snapshot();f.p.snapshot();assert.equal(f.sent.length,0);
  assert.equal(f.p.measure(),true);assert.equal(f.p.measure(),false);
  assert.equal(f.p.fence('unrelated',0),false);assert.equal(f.p.fence(f.sent[0],1),false);
  assert.equal(f.p.fence(f.sent[0],0),true);assert.equal(f.p.snapshot().wss.rttMs,0);
  await flush();f.tick(5000);f.p.measure();f.tick(42.5);f.p.fence(f.sent[1],0);
  assert.equal(f.p.snapshot().wss.rttMs,42.5);f.p.dispose();assert.equal(f.timers.size,0);
});
test('timeout never fabricates a value; late owned replies are ignored, unknown replies stay strict', async () => {
  const f=fixture();f.p.measure();await flush();f.tick(5000);
  assert.deepEqual(f.p.snapshot().wss,{state:'timeout'});
  assert.equal(f.p.fence(f.sent[0],0),true);assert.equal(f.p.snapshot().wss.state,'timeout');
  assert.equal(f.p.fence('rx-rtt:test-connection:9999',0),false);
  f.p.dispose();assert.equal(f.p.measure(),false);assert.equal(f.timers.size,0);
});
test('UDP uses only the selected ICE pair and ages cached responses without exposing candidates', async () => {
  const f=fixture();f.p.measure();await flush();assert.deepEqual(f.p.snapshot().udp,{state:'ready',rttMs:25,ageMs:0});
  f.tick(5000);f.p.measure();await flush();assert.equal(f.p.snapshot().udp.ageMs,5000);
  f.tick(6000);assert.deepEqual(f.p.snapshot().udp,{state:'stale',ageMs:11000});
  f.peer={connectionState:'connected',getStats:async()=>report(2,0)};
  assert.equal(f.p.snapshot().udp.state,'waiting');f.p.measure();await flush();assert.equal(f.p.snapshot().udp.rttMs,0);
  f.active=false;assert.deepEqual(f.p.snapshot().udp,{state:'inactive'});f.p.dispose();
});
test('retired peers and disposed connections cannot publish late RTCStats', async () => {
  const f=fixture();let resolve;f.peer={connectionState:'connected',getStats:()=>new Promise(r=>resolve=r)};
  f.p.measure();await flush();f.peer={connectionState:'connected',getStats:async()=>report(2,.1)};
  resolve(report());await flush();assert.equal(f.p.snapshot().udp.state,'waiting');
  f.tick(5000);f.p.measure();f.p.dispose();await flush();
  assert.deepEqual(f.p.snapshot(),{wss:{state:'inactive'},udp:{state:'inactive'}});assert.equal(f.timers.size,0);
});
test('missing, rejected and hanging UDP stats do not break WebSocket measurement', async () => {
  for (const getStats of [async()=>new Map(),async()=>{throw Error('not supported');},()=>new Promise(()=>{})]) {
    const f=fixture();f.peer={connectionState:'connected',getStats};f.p.measure();f.tick(15);f.p.fence(f.sent[0],0);
    await flush();f.tick(5000);assert.equal(f.p.snapshot().wss.rttMs,15);
    assert.ok(['unavailable','timeout'].includes(f.p.snapshot().udp.state));f.p.dispose();assert.equal(f.timers.size,0);
  }
});
test('disconnect and unsupported Fence leave no RTT or pending timer', async () => {
  const f=fixture();f.p.sendFence=()=>false;f.p.measure();await flush();assert.equal(f.p.snapshot().wss.state,'unavailable');
  f.connected=false;assert.equal(f.p.snapshot().wss.state,'inactive');assert.equal(f.p.measure(),false);f.p.dispose();
});
test('applied Fence parser accepts only owned responses and retains server-request echo', {skip:!process.env.KASM_CLIENT_SOURCE}, () => {
  const source=readFileSync(process.env.KASM_CLIENT_SOURCE+'/core/rfb.js','utf8');
  const body=source.slice(source.indexOf('    _handleServerFenceMsg() {')+'    _handleServerFenceMsg() {'.length,source.indexOf('    _handleXvpMsg() {'));
  const method=new Function('RFB','Log',`return function(){${body.slice(0,body.lastIndexOf('}'))}}`);
  const sent=[],handler=method({messages:{clientFence:(_,flags,payload)=>sent.push({flags,payload})}},{Warn(){}});
  function call(flags,payload,accepted) {const r={_sock:{rQwait:()=>false,rQskipBytes(){},rQshift32:()=>flags,rQshift8:()=>payload.length,rQshiftStr:()=>payload},_remoteXAppFenceResponse:()=>accepted,_fail:()=>false};return handler.call(r);}
  assert.equal(call(0,'owned',true),true);assert.equal(call(0,'foreign',false),false);
  assert.equal(call(0x80000000,'server',false),true);assert.deepEqual(sent,[{flags:0,payload:'server'}]);
});
