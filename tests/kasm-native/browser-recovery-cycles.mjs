import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {config,api,open,wait,delay} from './host-browser.mjs';
const b=await open(config.ingressURL+'/rx/sdk/recovery.html'),checks=[];
let owned,failure,before,after,afterRepeat;
const sample=async()=>({dom:await b.call('Memory.getDOMCounters'),
  heap:(await b.call('Performance.getMetrics')).metrics.find(x=>x.name==='JSHeapUsedSize')?.value,
  owners:await b.evaluate('({views:h.views.size,sessions:h.sessions.size,handles:h.diagnostics().localHandles,canvases:d.querySelectorAll("canvas").length,audio:h.getAudioState().connection})')});
async function cycle(){
  await b.evaluate('(async()=>{window.w=h.mount(d,{instanceId:seed.id});await w.settled;if(!w.getState().displayReady)throw Error("cycle did not paint");await w.release();window.w=null})()');
  assert.deepEqual(await b.evaluate('[h.views.size,h.sessions.size,h.diagnostics().localHandles,d.childElementCount]'),[0,1,1,0]);
}
try{
  await wait(()=>b.evaluate('!!window.remoteXAppRecoveryWorkbench'));
  if(config.expectedCoreCommit)assert.equal((await api('/api/version')).commit,config.expectedCoreCommit);
  await b.call('Performance.enable');
  await b.evaluate("(async()=>{const sdk=await import('./index.js');window.h=new sdk.RemoteXAppHost({baseURL:'/rx',scope:'resource-cycles'});window.seed=await h.open({templateId:'mousepad',keepAlive:true});window.d=document.body.appendChild(document.createElement('div'));d.style='position:fixed;inset:20px;z-index:300';})()");
  owned=await b.evaluate('seed.id');await cycle();
  await b.call('HeapProfiler.collectGarbage');before=await sample();
  for(let n=0;n<20;n++)await cycle();
  await delay(2000);await b.call('HeapProfiler.collectGarbage');after=await sample();
  assert.deepEqual(after.owners,before.owners);
  assert.equal(after.dom.documents,before.dom.documents);
  assert.equal(after.dom.jsEventListeners,before.dom.jsEventListeners,'released Viewers retain event listeners');
  assert(after.dom.nodes<=before.dom.nodes+5,'released Viewers retain DOM nodes');
  checks.push({name:'twenty painted mount/release cycles return to one explicit background owner and zero Viewer DOM/audio',result:'passed'});
  for(let n=0;n<20;n++)await cycle();
  await delay(2000);await b.call('HeapProfiler.collectGarbage');afterRepeat=await sample();
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
  writeFileSync(config.evidenceDirectory+'/recovery-cycles.json',JSON.stringify({result:failure?'failed':'passed',checks,before,after,afterRepeat,
    scope:'short repetition; heap/DOM observations after diagnostic GC, not a long-duration memory qualification'},null,2));
}
if(failure)process.exitCode=1;
