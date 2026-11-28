import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {config,api,open,wait,delay} from './host-browser.mjs';
import {takeNativeFrameSnapshot} from './native-frame-resources.mjs';
const b=await open(config.ingressURL+'/rx/sdk/recovery.html'),checks=[];
let owned,failure,before,after,afterRepeat,active,component;
const sample=async label=>({frame:await takeNativeFrameSnapshot(b,config.evidenceDirectory+'/native-frame-'+label+'.heapsnapshot'),dom:await b.call('Memory.getDOMCounters'),
  heap:(await b.call('Performance.getMetrics')).metrics.find(x=>x.name==='JSHeapUsedSize')?.value,
  owners:await b.evaluate('({views:h.views.size,sessions:h.sessions.size,handles:h.diagnostics().localHandles,canvases:d.querySelectorAll("canvas").length,audio:h.getAudioState().connection})')});
const retired=sample=>{assert.equal(sample.frame.frameBufferOwners,0,'released input retains an RFB frame buffer owner');assert(sample.frame.arrayBufferBackingBytes<4*1024*1024,'released Viewers retain native backing stores');};
async function cycle(){
  await b.evaluate('(async()=>{window.w=h.mount(d,{instanceId:seed.id});await w.settled;if(!w.getState().displayReady)throw Error("cycle did not paint");await w.release();window.w=null})()');
  assert.deepEqual(await b.evaluate('[h.views.size,h.sessions.size,h.diagnostics().localHandles,d.childElementCount]'),[0,1,1,0]);
}
try{
  await wait(()=>b.evaluate('!!window.remoteXAppRecoveryWorkbench'));
  if(config.expectedCoreCommit)assert.equal((await api('/api/version')).commit,config.expectedCoreCommit);
  await b.call('Performance.enable');
  await b.evaluate("(async()=>{const sdk=await import('./index.js');window.h=new sdk.RemoteXAppHost({baseURL:'/rx',scope:'resource-cycles'});window.seed=await h.open({templateId:'mousepad',keepAlive:true});window.d=document.body.appendChild(document.createElement('div'));d.style='position:fixed;inset:20px;z-index:300';})()");
  owned=await b.evaluate('seed.id');
  await b.evaluate('(async()=>{window.w=h.mount(d,{instanceId:seed.id});await w.settled;if(!w.getState().displayReady)throw Error("positive control did not paint");w.viewer.focus()})()');
  const descriptor=await api('/api/instances/'+owned);
  if(config.expectedComponentDigest)assert.equal(descriptor.displayComponentDigest,config.expectedComponentDigest);
  component={manifestSHA256:descriptor.displayComponentDigest,clientSHA256:await b.evaluate(`(async()=>{const r=await fetch('/rx/remotexapps/'+seed.id+'/native/client.js?componentDigest='+${JSON.stringify(descriptor.displayComponentDigest)});if(!r.ok)throw Error('native client unavailable');return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await r.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('')})()`)};
  active=await takeNativeFrameSnapshot(b,config.evidenceDirectory+'/native-frame-active.heapsnapshot');
  assert.equal(active.frameBufferOwners,1,'positive live RFB control is missing');
  assert(active.arrayBufferBackingBytes>=4*1024*1024,'positive native backing store control is missing');
  await b.evaluate('(async()=>{await w.release();window.w=null})()');
  await b.call('HeapProfiler.collectGarbage');before=await sample('before');retired(before);
  for(let n=0;n<20;n++)await cycle();
  await delay(2000);await b.call('HeapProfiler.collectGarbage');after=await sample('after');retired(after);
  assert.deepEqual(after.owners,before.owners);
  assert.equal(after.dom.documents,before.dom.documents);
  assert.equal(after.dom.jsEventListeners,before.dom.jsEventListeners,'released Viewers retain event listeners');
  assert(after.dom.nodes<=before.dom.nodes+5,'released Viewers retain DOM nodes');
  checks.push({name:'twenty painted mount/release cycles return to one explicit background owner and zero Viewer DOM/audio',result:'passed'});
  for(let n=0;n<20;n++)await cycle();
  await delay(2000);await b.call('HeapProfiler.collectGarbage');afterRepeat=await sample('repeat');retired(afterRepeat);
  assert.deepEqual(afterRepeat.owners,before.owners);
  assert.deepEqual(afterRepeat.dom,after.dom,'a second repetition block retains released browser resources');
  checks.push({name:'twenty additional cycles retain the same collected DOM/listener baseline',result:'passed'});
  await b.evaluate('h.logout()');await delay(300);
  assert.deepEqual(await b.evaluate('[h.views.size,h.sessions.size,h.diagnostics().localHandles]'),[0,0,0]);
  checks.push({name:'logout releases the final owner and leaves no SDK-owned windows or handles',result:'passed'});
}catch(e){failure=e.message;checks.push({name:'suite',result:'failed',error:failure});console.error(e.stack);}
finally{
  await b.evaluate('window.h?.dispose()').catch(()=>{});await b.close();
  if(owned){const x=await api('/api/instances/'+owned);await api('/api/instances/'+owned+'/stop',{force:true,sessionGeneration:x.sessionGeneration});}
  writeFileSync(config.evidenceDirectory+'/recovery-cycles.json',JSON.stringify({result:failure?'failed':'passed',checks,component,active,before,after,afterRepeat,
    scope:'short repetition; heap/DOM observations after diagnostic GC, not a long-duration memory qualification'},null,2));
}
if(failure)process.exitCode=1;
