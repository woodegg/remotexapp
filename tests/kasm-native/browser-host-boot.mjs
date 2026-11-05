// Two real container reboots, scoped to the explicitly disposable host fixture.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {config,api,remote,open,wait,delay} from './host-browser.mjs';
const b=await open(config.ingressURL+'/rx/sdk/host.html'),checks=[];
const pass=name=>{checks.push({name,status:'passed'});console.log(name);};
const boot=()=>remote(['cat','/proc/sys/kernel/random/boot_id']).trim();
const health=()=>wait(async()=>{try{return await api('/readyz');}catch{return false;}},60000);
const sentinel='/home/rxhost/documents/host-reboot-persistence.txt';
remote(['runuser','-u',config.user,'--','python3','-c','from pathlib import Path;import sys;Path(sys.argv[1]).write_text("saved before actual reboot 中文")',sentinel]);
let failure;
try{
  await api('/api/managed-instances/host-desktop',{desiredState:'running'},'PATCH');
  await wait(()=>b.evaluate("document.querySelector('#template')?.options.length>=8"));
  await b.evaluate("(async()=>{const sdk=await import('./index.js');window.qHost=new sdk.RemoteXAppHost({baseURL:'/rx',scope:'host-reboot'});window.qDisplay=document.createElement('div');qDisplay.style='position:fixed;inset:20px;z-index:100';document.body.append(qDisplay);window.qSession=await qHost.open({managedId:'host-desktop'});window.qViewer=await qSession.attach(qDisplay)})()");
  const before=await api('/api/managed-instances/host-desktop'),beforeBoot=boot(),old=before.runtime;
  assert(await b.evaluate('qViewer.getStats().renderedFrames>0'));
  execFileSync('sudo',['-n','/snap/bin/lxc','restart','local:'+config.container,'--timeout','30'],{timeout:60000,stdio:'pipe'});
  await health();assert.notEqual(boot(),beforeBoot);
  const restored=await wait(async()=>{const m=await api('/api/managed-instances/host-desktop');return m.observedState==='running'&&m;},60000);
  assert.equal(restored.desiredState,'running');assert.equal(restored.profileRef,before.profileRef);
  assert.equal(restored.runtime.displayComponentDigest,old.displayComponentDigest);assert.deepEqual(restored.runtime.versions.current,old.versions.current);
  assert.equal(remote(['cat',sentinel]),'saved before actual reboot 中文');
  await wait(()=>b.evaluate("qSession.state==='invalidated'"));
  await assert.rejects(api('/remotexapps/'+old.id+'/native/prepare',{sessionGeneration:old.sessionGeneration,componentDigest:old.displayComponentDigest}),e=>e.status===409 || e.status===404);
  await b.evaluate("(async()=>{await qSession.release();qSession=await qHost.open({managedId:'host-desktop'});qViewer=await qSession.attach(qDisplay)})()");
  const current=await b.evaluate('({id:qSession.id,generation:qSession.generation,paint:qViewer.getStats().renderedFrames})');
  assert(current.paint>0);assert(current.id!==old.id || current.generation>old.sessionGeneration);
  pass('actual reboot preserves managed intent HOME data and pins; fresh generation paints and rejects retired prepare');
  await b.evaluate('qHost.dispose()');
  await api('/api/managed-instances/host-desktop',{desiredState:'stopped',force:true},'PATCH');
  const stoppedBoot=boot();
  execFileSync('sudo',['-n','/snap/bin/lxc','restart','local:'+config.container,'--timeout','30'],{timeout:60000,stdio:'pipe'});
  await health();assert.notEqual(boot(),stoppedBoot);await delay(1000);
  const stopped=await api('/api/managed-instances/host-desktop');assert.equal(stopped.desiredState,'stopped');assert.equal(stopped.observedState,'stopped');
  assert.equal(remote(['cat',sentinel]),'saved before actual reboot 中文');
  assert.equal((await api('/api/instances')).filter(i=>i.managedInstanceId==='host-desktop' && i.state!=='stopped').length,0);
  pass('second actual reboot respects explicit stop and preserves saved data');
}catch(error){failure=error.stack;console.error(failure);checks.push({name:'suite',status:'failed',error:error.name});}
finally{
  await b.evaluate('qHost?.dispose()').catch(()=>{});await b.close();
  await api('/api/managed-instances/host-desktop',{desiredState:'stopped',force:true},'PATCH').catch(()=>{});
  writeFileSync(config.evidenceDirectory+'/host-boot.json',JSON.stringify({schemaVersion:1,checks,status:failure?'failed':'passed',humanAcceptance:'not-evaluated'},null,2));
}
if(failure)process.exitCode=1;
