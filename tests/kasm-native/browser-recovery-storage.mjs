// Mount faults are confined to a four-KiB tmpfs in the owned disposable clone.
// The original launch ledger remains underneath and is restored by unmounting.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {config,api,remote,open,wait} from './host-browser.mjs';
assert.equal(config.container,'remotexapp-host-liveness-native-20261120');
const path='/home/rxhost/state/launch-intents',checks=[];
const b=await open(config.ingressURL+'/rx/sdk/recovery.html');
let mounted=false,owned,failure;
const entries=()=>remote(['python3','-c',`from pathlib import Path;import hashlib,json;print(json.dumps(sorted((p.name,hashlib.sha256(p.read_bytes()).hexdigest()) for p in Path('${path}').iterdir())))`]);
const pass=name=>{checks.push({name,result:'passed'});console.log(name);};
const original=entries();
try{
  if(config.expectedCoreCommit)assert.equal((await api('/api/version')).commit,config.expectedCoreCommit);
  assert((await api('/api/instances')).every(x=>!x.attachedClients&&x.sessionState!=='running'));
  await wait(()=>b.evaluate('!!window.remoteXAppRecoveryWorkbench'));
  const before=(await api('/api/instances')).map(x=>x.id).sort();
  // A mount must succeed before any space is consumed; never fill the root FS.
  remote(['mount','-t','tmpfs','-o','size=4k,uid=1004,gid=1004,mode=0700','tmpfs',path]);mounted=true;
  remote(['python3','-c',`from pathlib import Path;Path('${path}/filler').write_bytes(b'x'*4096)`]);
  for(const kind of ['full','read-only']){
    if(kind==='read-only')remote(['mount','-o','remount,ro',path]);
    await b.evaluate(`(async()=>{const sdk=await import('./index.js');window.h ||= new sdk.RemoteXAppHost({baseURL:'/rx',scope:'storage-fault'});window.d ||= document.body.appendChild(document.createElement('div'));d.style='position:fixed;inset:20px;z-index:100';window.w=h.mount(d,{templateId:'mousepad'});await w.settled;})()`);
    const s=await b.evaluate('w.getState()');assert.equal(s.state,'attention');assert.equal(s.displayReady,false);
    assert(!s.actions.some(a=>['retry','restart','reattach'].includes(a.kind)));
    assert.deepEqual((await api('/api/instances')).map(x=>x.id).sort(),before);
    await b.evaluate('w.release()');
    pass(`live ${kind} launch-ledger storage rejects launch before any runtime or Viewer is created`);
  }
  remote(['umount',path]);mounted=false;assert.equal(entries(),original);
  await b.evaluate("(async()=>{window.w=h.mount(d,{templateId:'mousepad',keepAlive:true});await w.settled;})()");
  assert.equal(await b.evaluate('w.getState().displayReady'),true);owned=await b.evaluate('w.session.id');
  assert(await b.evaluate('w.viewer.getStats().renderedFrames>0'));
  pass('restoring the untouched ledger permits a new explicit launch and real paint');
}catch(e){failure=e.message;checks.push({name:'suite',result:'failed',error:failure});console.error(e.stack);}
finally{
  if(mounted)remote(['umount',path]);
  owned ||= await b.evaluate('window.w?.session?.id').catch(()=>undefined);
  await b.evaluate('window.h?.dispose()').catch(()=>{});await b.close();
  if(owned){const x=await api('/api/instances/'+owned);await api('/api/instances/'+owned+'/stop',{force:true,sessionGeneration:x.sessionGeneration});}
  assert.equal(remote(['python3','-c',`import subprocess;print(subprocess.run(['mountpoint','-q','${path}']).returncode!=0)`]).trim(),'True');
  writeFileSync(config.evidenceDirectory+'/recovery-storage.json',JSON.stringify({result:failure?'failed':'passed',checks,scope:'four-KiB isolated launch ledger; not root filesystem exhaustion'},null,2));
}
if(failure)process.exitCode=1;
