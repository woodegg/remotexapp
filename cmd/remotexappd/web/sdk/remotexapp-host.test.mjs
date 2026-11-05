import test from 'node:test';
import assert from 'node:assert/strict';
import {RemoteXAppHost} from './remotexapp-host.js';

globalThis.CustomEvent ||= class extends Event {constructor(type,options){super(type);this.detail=options?.detail;}};
const tick = () => new Promise(resolve=>setTimeout(resolve,10));
function fixture(t) {
  const state={id:'app-123',templateId:'editor',displayProvider:'kasm',displayComponentDigest:'a'.repeat(64),
    state:'server-ready',sessionState:'running',sessionGeneration:3,applicationStatus:{state:'ready',generation:3}};
  const calls=[];
  const manager={url:path=>'https://host.example.test/rx'+path,
    listTemplates:async()=>[{id:'editor'}],
    getInstance:async()=>structuredClone(state),
    createInstance:async options=>{calls.push(['create',options]);return structuredClone(state);},
    prepareNativeInstance:async()=>{state.sessionState='running';state.sessionGeneration++;return structuredClone(state);},
    getManagedInstance:async id=>({id,desiredState:'running',observedState:'running',runtimeInstanceId:state.id,runtime:structuredClone(state)}),
    getActions:async()=>({instanceId:state.id,sessionGeneration:state.sessionGeneration,actions:{openUrl:{}}}),
    invokeAction:async(id,action,parameters,options)=>{calls.push(['action',id,action,parameters,options]);return {instanceId:id,sessionGeneration:state.sessionGeneration,action};},
    getConnections:async()=>({instanceId:state.id,sessionGeneration:state.sessionGeneration,application:{protocol:'test'}}),
    stopInstance:async(id,options)=>{calls.push(['stop',id,options]);return {id,state:'stopped'};},
    renewIdleLease:async(id,{sessionGeneration})=>({instanceId:id,sessionGeneration,outcome:'kept',idleAction:'keep',idleTimeoutMs:0,serverTime:new Date().toISOString(),expiresAt:null}),
  };
  const host=new RemoteXAppHost({manager,scope:crypto.randomUUID(),crossTabs:false});t.after(()=>host.dispose());
  const viewers=[];
  host._viewer=options=>{
    const v=new EventTarget();Object.assign(v,{options,state:'disconnected',connect:async()=>{v.state='ready';},
      disconnect(){v.state='disconnected';},dispose(){v.state='disposed';v.dispatchEvent(new CustomEvent('statechange',{detail:{state:'disposed'}}));}});
    viewers.push(v);return v;
  };
  return {host,manager,state,calls,viewers};
}
test('templates and launch parameters use public Manager operations',async t=>{
  const {host,calls}=fixture(t);
  assert.deepEqual(await host.templates(),[{id:'editor'}]);
  const s=await host.open({templateId:'editor',parameters:{filePath:'/documents/demo.txt'},profileRef:'test'});
  assert.equal(s.id,'app-123');assert.equal(s.generation,3);
  assert.deepEqual(calls[0][1].parameters,{filePath:'/documents/demo.txt'});
  assert.equal(s.handle.keepAlive,false);
  await assert.rejects(host.open({}),TypeError);
  await assert.rejects(host.open({templateId:'editor',instanceId:'app-123'}),TypeError);
  await assert.rejects(host.open({instanceId:'app-123',keepAlive:'yes'}),TypeError);
});
test('two windows own independent handles and viewers; release does not stop the App',async t=>{
  const {host,calls}=fixture(t);
  const a=await host.open({instanceId:'app-123'}),b=await host.open({instanceId:'app-123'});
  const va=await a.attach({}),vb=await b.attach({});
  assert.equal(host.diagnostics().localHandles,2);
  assert.equal(va.options.runtime,a.handle);assert.equal(va.options.reconnect,true);
  await a.release();await a.release();
  assert.equal(va.state,'disposed');assert.equal(vb.state,'ready');assert.equal(host.diagnostics().localHandles,1);
  assert.equal(calls.filter(c=>c[0]==='stop').length,0);
  await b.stop();assert.equal(calls.at(-1)[2].sessionGeneration,3);
  await b.release();assert.equal(host.sessions.size,0);assert.equal(host.diagnostics().localHandles,0);
});
test('stopped managed Apps and mismatched identities cannot be activated by open',async t=>{
  const {host,manager,state}=fixture(t);
  state.managedInstanceId='desktop';
  const s=await host.open({managedId:'desktop'});await assert.rejects(s.stop(),{code:'managed-stop-required'});
  await s.release();
  manager.getManagedInstance=async()=>({id:'desktop',desiredState:'stopped',observedState:'stopped'});
  await assert.rejects(host.open({managedId:'desktop'}),{code:'managed-unavailable'});
  await assert.rejects(host.open({instanceId:'other'}),{code:'invalid-descriptor'});
});
test('on-attach activation binds the resulting generation, not generation zero',async t=>{
  const {host,state}=fixture(t);state.sessionGeneration=0;state.sessionState='stopped';
  const s=await host.open({instanceId:'app-123'});
  assert.equal(s.generation,1);assert.equal(s.handle.sessionGeneration,1);assert.equal(s.handle.state,'tracking');
});
test('concurrent on-attach activation follows only one unchanged component transition',async t=>{
  const {host,manager,state}=fixture(t);state.sessionGeneration=0;state.sessionState='stopped';
  manager.prepareNativeInstance=async()=>{state.sessionGeneration++;state.sessionState='running';throw Object.assign(Error('conflict'),{status:409});};
  const s=await host.open({instanceId:'app-123'});assert.equal(s.generation,1);await s.release();
  state.sessionState='stopped';
  manager.prepareNativeInstance=async()=>{state.sessionGeneration++;state.sessionState='running';state.displayComponentDigest='b'.repeat(64);throw Object.assign(Error('conflict'),{status:409});};
  await assert.rejects(host.open({instanceId:'app-123'}),{status:409});
});
test('actions and control descriptors remain tied to the current generation',async t=>{
  const {host,manager,calls,state}=fixture(t),s=await host.open({instanceId:'app-123'});
  assert.ok((await s.actions()).actions.openUrl);
  assert.equal((await s.connections()).application.protocol,'test');
  await s.invoke('openUrl',{url:'https://example.test'});
  assert.equal(calls.at(-1)[4].sessionGeneration,3);
  state.sessionGeneration++;
  await assert.rejects(s.actions(),{code:'stale-generation'});
  await assert.rejects(s.connections(),{code:'stale-generation'});
  await assert.rejects(s.stop(),{code:'stale-generation'});
  manager.invokeAction=async()=>{await s.release();return {instanceId:s.id,sessionGeneration:s.generation,action:'openUrl'};};
  await assert.rejects(s.invoke('openUrl'),{code:'action-uncertain'});
});
test('late launch responses after cancellation do not attach, stop shared Apps or retain handles',async t=>{
  const {host,manager,state,calls}=fixture(t);let resolve;
  manager.createInstance=()=>new Promise(r=>{resolve=r;});
  const abort=new AbortController(),pending=host.open({templateId:'editor',signal:abort.signal});
  abort.abort();resolve(structuredClone(state));await assert.rejects(pending,{name:'AbortError'});
  assert.equal(host.sessions.size,0);assert.equal(host.diagnostics().localHandles,0);assert.equal(calls.length,0);
});
test('audio acquisition is lazy, idempotent and independent of Viewers',async t=>{
  const {host}=fixture(t);let initialized=0,acquired=0,released=0,logout=0,disposed=0;
  host._audioService=()=>host._audio ||= (initialized++,{ready:Promise.resolve(),
    acquire:async()=>{acquired++;return {released:false,async release(){if(!this.released){this.released=true;released++;}}};},
    logout:async()=>{logout++;},dispose:()=>{disposed++;}});
  const s=await host.open({instanceId:'app-123'}),v=await s.attach({});assert.equal(initialized,0);
  const [a,b]=await Promise.all([s.audio(),s.audio()]);assert.equal(a,b);assert.equal(acquired,1);
  v.dispose();assert.equal(released,0);
  await host.logout();assert.equal(released,1);assert.equal(logout,1);assert.equal(disposed,1);
  await assert.rejects(host.open({instanceId:'app-123'}),{code:'disposed'});
});
test('invalidation retires viewers and audio without silently taking the replacement',async t=>{
  const {host}=fixture(t),s=await host.open({instanceId:'app-123'}),v=await s.attach({});
  host.coordinator._invalidate(s.id,s.generation);
  await tick();assert.equal(s.state,'invalidated');assert.equal(v.state,'disconnected');
  await assert.rejects(s.attach({}),{code:'runtime-invalidated'});
  await s.release();assert.equal(v.state,'disposed');
});
test('failed Viewer attach cleans its attachment but retains the host handle',async t=>{
  const {host,viewers}=fixture(t),s=await host.open({instanceId:'app-123'}),create=host._viewer;
  host._viewer=options=>{const v=create(options);v.connect=async()=>{throw Error('no first frame');};return v;};
  await assert.rejects(s.attach({}),/no first frame/);
  assert.equal(viewers[0].state,'disposed');assert.equal(s.viewers.size,0);assert.equal(s.handle.state,'tracking');
});
