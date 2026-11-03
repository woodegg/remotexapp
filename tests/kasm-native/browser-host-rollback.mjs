// Scoped Manager rollback on the disposable fixture, preserving pinned Apps.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {config,api,remote,open,wait} from './host-browser.mjs';
assert.match(config.rollbackCore,/^\/opt\/remotexapp-clipboard-[a-f0-9]{12}$/);
assert.match(config.rollbackSource,/^[a-f0-9]{40}$/);
const unit='/home/rxhost/.config/systemd/user/remotexapp-host.service';
const original=remote(['cat',unit]);const current=original.match(/ExecStart=(\S+)\/bin\/remotexappd/)[1];
const asUser=args=>remote(['runuser','-u',config.user,'--','env','XDG_RUNTIME_DIR=/run/user/'+config.uid,'DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/'+config.uid+'/bus',...args]);
const install=value=>{remote(['python3','-c','from pathlib import Path;import sys;Path(sys.argv[1]).write_text(sys.stdin.read())',unit],value);asUser(['systemctl','--user','daemon-reload']);asUser(['systemctl','--user','restart','remotexapp-host.service']);};
const health=()=>wait(async()=>{try{return await api('/readyz');}catch{return false;}},45000);
const b=await open(config.ingressURL+'/rx/sdk/host.html'),checks=[];let owned,failure;
const path='/home/rxhost/documents/host-rollback-'+Date.now()+'.txt';asUser(['python3','-c','from pathlib import Path;import sys;Path(sys.argv[1]).write_text("")',path]);
try{
 await wait(()=>b.evaluate('document.querySelector("#template")?.options.length===8'));
 await b.evaluate(`(async()=>{const sdk=await import('./index.js');window.qHost=new sdk.RemoteXAppHost({baseURL:'/rx',scope:'host-rollback'});window.qDisplay=document.createElement('div');qDisplay.style='position:fixed;inset:20px;z-index:100';document.body.append(qDisplay);window.qS=await qHost.open({templateId:'mousepad',parameters:{filePath:${JSON.stringify(path)}},keepAlive:true});window.qV=await qS.attach(qDisplay);qV.sendText('Rollback 中文');qV.sendKey('s',{modifiers:['Control']});})()`);
 owned=await b.evaluate('qS.instance');await wait(()=>remote(['cat',path])==='Rollback 中文');
 const services=remote(['cat','/home/rxhost/state/instances/'+owned.id+'/session-services.json']);
 install(original.replaceAll(current+'/bin/',config.rollbackCore+'/bin/').replace(current+'/drivers/common',config.rollbackCore+'/drivers/common'));await health();
 const after=await api('/api/instances/'+owned.id);assert.equal(after.sessionGeneration,owned.sessionGeneration);assert.deepEqual(after.versions.current,owned.versions.current);assert.equal(remote(['cat','/home/rxhost/state/instances/'+owned.id+'/session-services.json']),services);assert.equal(remote(['cat',path]),'Rollback 中文');
 checks.push({name:'previous Manager adopts current pinned App without changing processes generation or saved data',status:'passed'});
 // Old Core lacks the new read-only grant contract: keep the old Viewer retired.
 install(original);await health();
 await b.evaluate('(async()=>{await qHost.dispose();const sdk=await import("./index.js");qHost=new sdk.RemoteXAppHost({baseURL:"/rx",scope:"host-rollback-restored"});qS=await qHost.open({instanceId:'+JSON.stringify(owned.id)+'});qV=await qS.attach(qDisplay)})()');
 assert((await b.evaluate('qV.getStats()')).renderedFrames>0);assert.equal((await api('/api/instances/'+owned.id)).sessionGeneration,owned.sessionGeneration);
 await b.evaluate("qV.sendKey('End');qV.sendText(' restored');qV.sendKey('s',{modifiers:['Control']})");await wait(()=>remote(['cat',path])==='Rollback 中文 restored');
 checks.push({name:'restored candidate reattaches same pinned App and saves after scoped rollback',status:'passed'});
}catch(error){failure=error.stack;console.error(failure);checks.push({name:'suite',status:'failed',error:error.name});}
finally{
 if(remote(['cat',unit])!==original){install(original);await health();}
 await b.evaluate('window.qHost?.dispose()').catch(()=>{});await b.close();
 if(owned){const actual=await api('/api/instances/'+owned.id);await api('/api/instances/'+owned.id+'/stop',{force:true,sessionGeneration:actual.sessionGeneration});}
 writeFileSync(config.evidenceDirectory+'/host-rollback.json',JSON.stringify({schemaVersion:1,priorSource:config.rollbackSource,priorArchiveSHA256:config.rollbackArchiveSHA256,scope:'Manager-only rollback/adoption; no provider or runtime component downgrade',status:failure?'failed':'passed',checks,humanAcceptance:'not-evaluated'},null,2));
}
if(failure)process.exitCode=1;
