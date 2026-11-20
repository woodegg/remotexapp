import test from 'node:test';
import assert from 'node:assert/strict';
import {RemoteXAppView} from './native-recovery-view.js';

globalThis.CustomEvent ||= class extends Event {constructor(name,options){super(name);this.detail=options?.detail;}};
const emit=(target,name,detail)=>target.dispatchEvent(new CustomEvent(name,{detail}));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(r=>setTimeout(r,0));
function container() {
  const doc={createElement:()=>({ownerDocument:doc,style:{},dataset:{},setAttribute(){},append(){},replaceChildren(){},contains(){return false;},remove(){}})};
  return doc.createElement();
}
async function fixture(t,{target={instanceId:'editor'},openError}={}) {
  const actual={id:'editor',createdAt:'2026-11-20T00:00:00Z',templateId:'mousepad',profileRef:'profile',
    displayProvider:'kasm',displayComponentDigest:'a'.repeat(64),sessionGeneration:3,sessionState:'running',state:'ready',
    applicationStatus:{state:'ready'},versions:{current:{core:{sha256:'b'.repeat(64)}}}};
  const calls=[],sessions=[],manager={
    getInstance:async()=>structuredClone(actual),
    getVersion:async()=>({capabilities:{runtimeRestart:true}}),
    getManagedInstance:async()=>({id:'desktop',runtimeInstanceId:actual.id,desiredState:'running'}),
    retryRecovery:async(id,options)=>{calls.push(['recheck',id,options]);},
    restartInstance:async(id,options)=>{calls.push(['restart',id,options]);actual.sessionGeneration++;return structuredClone(actual);},
  };
  const host={manager,views:new Set(),open:async options=>{
    calls.push(['open',options]);if(openError)throw openError;
    const session=new EventTarget();Object.assign(session,{instance:structuredClone(actual),id:actual.id,generation:actual.sessionGeneration,state:'active',handle:new EventTarget(),
      attach:async()=>{
        const viewer=new EventTarget();Object.assign(viewer,{state:'ready',connect:async x=>{calls.push(['connect',x.sessionGeneration]);viewer.state='ready';emit(viewer,'statechange',{state:'ready'});},
          disconnect:()=>{viewer.state='disconnected';emit(viewer,'statechange',{state:'disconnected'});},dispose:()=>{viewer.state='disposed';}});
        session.viewer=viewer;return viewer;
      },release:async()=>{session.state='released';session.viewer?.dispose();calls.push(['release',session.generation]);}});
    sessions.push(session);return session;
  }};
  const view=new RemoteXAppView(host,container(),target,{panel:false});host.views.add(view);t.after(()=>view.release());
  await view.settled;
  const action=kind=>{const a=view.getState().actions.find(a=>a.kind===kind);assert(a,`missing ${kind}: ${JSON.stringify(view.getState())}`);return a.id;};
  const fault=(code='connection-unavailable')=>{view.viewer.state='failed';emit(view.viewer,'statechange',{state:'failed',code});};
  const refresh=async()=>view.run(action('refresh'));
  const invalidate=()=>{view.session.state='invalidated';emit(view.session,'invalidated',{});};
  return {view,actual,manager,host,calls,sessions,action,fault,refresh,invalidate};
}

test('mount retains a stable window and readiness is an observed result',async t=>{
  const f=await fixture(t);assert.equal(f.view.getState().state,'ready');assert.equal(f.view.getState().displayReady,true);
  const copy=f.view.getState();copy.state='failed';assert.equal(f.view.getState().state,'ready');
  await f.view.release();assert.equal(f.view.getState().state,'closed');assert.equal(f.host.views.size,0);
});
test('initial uncertain create is not replayable from recovery actions',async t=>{
  const f=await fixture(t,{target:{templateId:'mousepad'},openError:Error('socket reset')});
  assert.equal(f.view.getState().reason,'launch-uncertain');assert.equal(f.calls.length,1);
  await f.refresh();assert(!f.view.getState().actions.some(a=>a.kind==='retry'));assert.equal(f.calls.length,1);
});
test('initial read-only failure preserves explicit retry without relaunch',async t=>{
  const f=await fixture(t,{openError:Error('offline')});
  assert.equal(f.view.getState().state,'attention');await assert.rejects(f.view.run(f.action('retry')));
  assert.equal(f.calls.length,2);assert(f.calls.every(c=>c[1].instanceId==='editor'));
});
test('retry uses fresh same-generation identity without runtime restart',async t=>{
  const f=await fixture(t);f.fault();await f.view.run(f.action('retry'));
  assert.equal(f.view.getState().state,'ready');assert.deepEqual(f.calls.filter(c=>c[0]==='connect'),[['connect',3]]);
  assert(!f.calls.some(c=>c[0]==='restart'));
});
test('automatic reconnect events project progress without another retry loop',async t=>{
  const f=await fixture(t),n=f.calls.length;f.view.viewer.state='reconnecting';emit(f.view.viewer,'statechange',{state:'reconnecting',attempt:1});
  assert.equal(f.view.getState().state,'recovering');await tick();assert.equal(f.calls.length,n);
  f.fault('reconnect-exhausted');assert.equal(f.view.getState().state,'attention');assert(f.action('retry'));
});
test('stale UI action and duplicate click never create a second operation',async t=>{
  const f=await fixture(t);f.fault();const id=f.action('retry'),pending=deferred();f.manager.getInstance=()=>pending.promise;
  const running=f.view.run(id);await assert.rejects(f.view.run(id),{code:'stale-recovery-action'});
  pending.resolve(structuredClone(f.actual));await running;
  assert.equal(f.calls.filter(c=>c[0]==='connect').length,1);
});
for (const field of ['id','createdAt','templateId','profileRef','displayComponentDigest']) test(`changed ${field} cannot be retried or adopted`,async t=>{
  const f=await fixture(t);f.fault();const id=f.action('retry');f.actual[field]='changed';
  await assert.rejects(f.view.run(id),{code:'target-changed'});assert(!f.calls.some(c=>c[0]==='connect'));
  assert(!f.view.getState().actions.some(a=>['retry','restart','reattach'].includes(a.kind)));
});
for (const status of [401,403]) test(`HTTP ${status} stops at the authority boundary`,async t=>{
  const f=await fixture(t);f.fault();f.manager.getInstance=async()=>{throw Object.assign(Error('denied'),{status});};
  await assert.rejects(f.view.run(f.action('retry')));assert.equal(f.view.getState().reason,status===401?'authentication-required':'permission-denied');
  assert(!f.view.getState().actions.some(a=>a.kind==='retry'));assert(!f.calls.some(c=>c[0]==='connect'));
});
for (const sessionState of ['stopped','failed','shutdown-blocked']) test(`${sessionState} never becomes an implicit activation`,async t=>{
  const f=await fixture(t);f.fault();f.actual.sessionState=sessionState;
  await assert.rejects(f.view.run(f.action('retry')),{code:'runtime-unavailable'});
  assert(!f.calls.some(c=>c[0]==='connect'||c[0]==='restart'));
});
test('replacement requires refresh and explicit reattach; old handle stays invalid',async t=>{
  const f=await fixture(t),old=f.view.session;f.actual.sessionGeneration++;f.invalidate();
  assert(!f.view.getState().actions.some(a=>a.kind==='reattach'));await f.refresh();
  assert.equal(f.calls.filter(c=>c[0]==='open').length,1);
  await f.view.run(f.action('reattach'));assert.equal(f.view.session.generation,4);assert.equal(old.state,'released');
  assert.notEqual(f.view.session,old);assert.equal(f.view.getState().state,'ready');
});
test('new generation cannot race into a retry chosen from an old snapshot',async t=>{
  const f=await fixture(t);f.fault();const a=f.action('retry');f.actual.sessionGeneration++;
  await assert.rejects(f.view.run(a),{code:'stale-generation'});assert(!f.calls.some(c=>c[0]==='connect'));
});
test('restart requires confirmation and does not include force or upgrade',async t=>{
  const f=await fixture(t);f.fault();await f.refresh();await f.view.run(f.action('restart'));
  assert.equal(f.calls.filter(c=>c[0]==='restart').length,0);
  const confirmation=f.view.getState().confirmation;assert.equal(confirmation.scope,'runtime');assert.equal(confirmation.mayDiscardUnsavedWork,true);
  await f.view.confirm(confirmation.id);const calls=f.calls.filter(c=>c[0]==='restart');assert.equal(calls.length,1);
  assert.equal(calls[0][2].sessionGeneration,3);assert.equal(calls[0][2].force,undefined);
  assert.equal(f.view.session.generation,4);assert.equal(f.view.getState().state,'ready');
});
test('cancelled, consumed and expired confirmations cannot restart',async t=>{
  const f=await fixture(t);f.fault();await f.refresh();await f.view.run(f.action('restart'));const old=f.view.getState().confirmation.id;
  f.view.cancelConfirmation();await assert.rejects(f.view.confirm(old),{code:'stale-confirmation'});
  await f.view.run(f.action('restart'));f.view._confirmation.expiresAt=0;
  await assert.rejects(f.view.confirm(f.view.getState().confirmation.id),{code:'stale-confirmation'});
  assert(!f.calls.some(c=>c[0]==='restart'));
});
test('changed generation after confirmation cannot retarget restart',async t=>{
  const f=await fixture(t);f.fault();await f.refresh();await f.view.run(f.action('restart'));const id=f.view.getState().confirmation.id;
  f.actual.sessionGeneration++;await assert.rejects(f.view.confirm(id),{code:'stale-confirmation'});
  assert(!f.calls.some(c=>c[0]==='restart'));
});
test('shutdown refusal stays visible without force escalation',async t=>{
  const f=await fixture(t);f.fault();await f.refresh();await f.view.run(f.action('restart'));
  f.manager.restartInstance=async()=>{f.calls.push(['refused']);throw Object.assign(Error('veto'),{status:409});};
  await assert.rejects(f.view.confirm(f.view.getState().confirmation.id));
  assert.equal(f.view.getState().reason,'operation-refused');assert.equal(f.calls.filter(c=>c[0]==='refused').length,1);
});
test('lost restart response is uncertain and is not automatically replayed',async t=>{
  const f=await fixture(t);f.fault();await f.refresh();await f.view.run(f.action('restart'));
  f.manager.restartInstance=async()=>{f.calls.push(['lost-response']);f.actual.sessionGeneration++;throw Error('response lost');};
  await assert.rejects(f.view.confirm(f.view.getState().confirmation.id),{code:'operation-uncertain'});
  await tick();assert.equal(f.view.getState().reason,'operation-uncertain');assert.equal(f.calls.filter(c=>c[0]==='lost-response').length,1);
  assert.equal(f.view.session.generation,3);
});
test('recheck is accepted scheduling, not successful repair or forced restart',async t=>{
  const f=await fixture(t);f.actual.managedInstanceId='desktop';f.view._anchor={...f.view._anchor,managedInstanceId:'desktop'};
  f.actual.recovery={phase:'blocked',reason:'session-populated-or-unknown'};f.actual.sessionState='failed';f.invalidate();await f.refresh();
  await f.view.run(f.action('recheck'));assert.equal(f.view.getState().reason,'recheck-submitted');assert.equal(f.view.getState().state,'attention');
  assert.equal(f.calls.filter(c=>c[0]==='recheck').length,1);assert(!f.calls.some(c=>c[0]==='restart'));
});
test('borrowed/native unavailable features do not create repair work',async t=>{
  const f=await fixture(t);f.actual.ibus={available:false,reason:'unsupported-provider'};
  assert.equal(f.view.getState().state,'ready');assert.deepEqual(f.view.getState().actions,[]);assert.equal(f.calls.length,1);
});
test('late status read after release cannot reconnect or mutate the runtime',async t=>{
  const f=await fixture(t);f.fault();const pending=deferred();f.manager.getVersion=()=>pending.promise;
  const work=f.view.run(f.action('retry'));await tick();await f.view.release();pending.resolve({capabilities:{runtimeRestart:true}});
  await assert.rejects(work);assert.equal(f.view.getState().state,'closed');assert(!f.calls.some(c=>c[0]==='connect'));
});
test('release while restart is in flight cannot attach its eventual result',async t=>{
  const f=await fixture(t);f.fault();await f.refresh();await f.view.run(f.action('restart'));const pending=deferred();f.manager.restartInstance=()=>pending.promise;
  const work=f.view.confirm(f.view.getState().confirmation.id);await tick();await f.view.release();f.actual.sessionGeneration++;
  pending.resolve(structuredClone(f.actual));await assert.rejects(work,{code:'operation-uncertain'});
  assert.equal(f.calls.filter(c=>c[0]==='open').length,1);assert.equal(f.view.getState().state,'closed');
});
test('authority restoration needs an explicit new handle even for the same generation',async t=>{
  const f=await fixture(t),old=f.view.session;f.invalidate();await f.refresh();
  await f.view.run(f.action('reattach'));assert.notEqual(f.view.session,old);assert.equal(f.view.session.generation,3);
  assert.equal(old.state,'released');
});
test('HTTP status events are visible without an extra authority-probing request',async t=>{
  const f=await fixture(t),n=f.calls.length;f.view.viewer.state='failed';
  emit(f.view.viewer,'statechange',{state:'failed',code:'grant-expired',httpStatus:401});
  assert.equal(f.view.getState().reason,'authentication-required');assert.equal(f.calls.length,n);
  let request;f.view.addEventListener('request',e=>{request=e.detail;});await f.view.run(f.action('authenticate'));
  assert.equal(request.kind,'authenticate');assert.equal(f.calls.length,n);
});
test('a container cannot acquire a second view owner and is reusable after release',async t=>{
  const f=await fixture(t),c=container();const first=new RemoteXAppView(f.host,c,{instanceId:'editor'},{panel:false});
  assert.throws(()=>new RemoteXAppView(f.host,c,{instanceId:'editor'},{panel:false}),{code:'container-in-use'});
  await first.settled;await first.release();const second=new RemoteXAppView(f.host,c,{instanceId:'editor'},{panel:false});
  await second.settled;await second.release();
});
test('two views do not share connection retry or disposal',async t=>{
  const a=await fixture(t),b=await fixture(t);a.fault();await a.view.run(a.action('retry'));await a.view.release();
  assert.equal(b.view.getState().state,'ready');assert.equal(b.calls.length,1);
});
test('generation change and release during restart confirmation keep the mutation fenced',async t=>{
  const f=await fixture(t);f.fault();await f.refresh();await f.view.run(f.action('restart'));
  const id=f.view.getState().confirmation.id,pending=deferred();f.manager.getInstance=()=>pending.promise;
  const work=f.view.confirm(id);await f.view.release();pending.resolve(structuredClone(f.actual));
  await assert.rejects(work);assert(!f.calls.some(c=>c[0]==='restart'));
});
