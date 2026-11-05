import test from 'node:test';
import assert from 'node:assert/strict';
import {templateTarget,parameterValue,rateSnapshot,latencyText} from './host-workbench-model.mjs';
test('user-home catalog launch attaches the registered desktop rather than creating a runtime',()=>{
  const desktop={id:'openbox',runMode:'user-home'};
  const running={id:'managed-desktop',templateId:'openbox',desiredState:'running',observedState:'running'};
  assert.deepEqual(templateTarget(desktop,[{...running,id:'unrelated',templateId:'other'},running]),{managedId:'managed-desktop'});
  assert.deepEqual(templateTarget({id:'editor',runMode:'isolated'},[running]),{templateId:'editor'});
  assert.deepEqual(templateTarget({id:'browser',runMode:'shared'},[running]),{templateId:'browser'});
  assert.throws(()=>templateTarget(undefined),/template-unavailable/);
  assert.throws(()=>templateTarget(desktop,[]),/managed-registration-required/);
  assert.throws(()=>templateTarget(desktop,[running,{...running,id:'another'}]),/managed-selection-required/);
  assert.throws(()=>templateTarget(desktop,[{...running,desiredState:'stopped'}]),/managed-start-required/);
  assert.throws(()=>templateTarget(desktop,[{...running,observedState:'failed'}]),/managed-unavailable/);
  assert.equal(running.desiredState,'running');
});
test('template forms preserve typed booleans, integers, JSON and omitted defaults',()=>{
  assert.equal(parameterValue({type:'boolean'},false),false);
  assert.equal(parameterValue({type:'file'},''),undefined);
  assert.equal(parameterValue({type:'integer',minimum:0,maximum:5},'0'),0);
  assert.deepEqual(parameterValue({type:'json'},'{"test":true}'),{test:true});
  assert.equal(parameterValue({type:'enum',values:['a','b']},'b'),'b');
  for(const [definition,value] of [[{required:true},''],[{type:'integer'},'1.5'],[{type:'integer',minimum:1},'0'],[{type:'enum',values:['a']},'b'],[{maxLength:2},'long']])
    assert.throws(()=>parameterValue(definition,value));
});
test('bandwidth and paint counters never span a reconnect or hidden long interval',()=>{
  const first={available:true,connectionEpoch:1,observedAt:1000,receivedBytes:100,sentBytes:10,udpReceivedBytes:1000,renderedFrames:2};
  const next={...first,observedAt:3000,receivedBytes:300,sentBytes:20,udpReceivedBytes:3000,renderedFrames:12};
  assert.deepEqual(rateSnapshot(first,next),{download:8.8,upload:.04,fps:5});
  assert.equal(rateSnapshot(null,next),null);
  assert.equal(rateSnapshot(first,{...next,connectionEpoch:2}),null);
  assert.equal(rateSnapshot(first,{...next,observedAt:20000}),null);
  assert.equal(rateSnapshot(first,{...next,available:false}),null);
});
test('latency labels do not turn missing or stale samples into zero milliseconds',()=>{
  assert.equal(latencyText({state:'ready',rttMs:12.5}),'13 ms');
  assert.equal(latencyText({state:'stale'}),'已过期');
  assert.equal(latencyText(undefined),'不可用');
});
