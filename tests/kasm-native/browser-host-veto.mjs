// A separately packaged explicit veto fixture; shipped editor policy is unchanged.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {config,api,remote,open,wait} from './host-browser.mjs';
const ctl=(...args)=>remote(['runuser','-u',config.user,'--','env','XDG_RUNTIME_DIR=/run/user/'+config.uid,'DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/'+config.uid+'/bus','systemctl','--user',...args]);
const health=()=>wait(async()=>{try{return await api('/readyz');}catch{return false;}},45000);
ctl('restart','remotexapp-host.service');await health();
const b=await open(config.ingressURL+'/rx/sdk/host.html'),checks=[];let id,failure;
try{
 await wait(()=>b.evaluate('[...document.querySelector("#template")?.options||[]].some(o=>o.value==="host-veto")'));
 await b.evaluate('(async()=>{const sdk=await import("./index.js");window.qHost=new sdk.RemoteXAppHost({baseURL:"/rx",scope:"host-veto"});window.qD=document.createElement("div");qD.style="position:fixed;inset:20px;z-index:100";document.body.append(qD);window.qS=await qHost.open({templateId:"host-veto",keepAlive:true});window.qV=await qS.attach(qD);})()');
 id=await b.evaluate('qS.id');const before=await api('/api/instances/'+id);const services=remote(['cat','/home/rxhost/state/instances/'+id+'/session-services.json']);
 const result=await b.evaluate('qS.stop().then(x=>({ok:true,state:x.sessionState}),e=>({ok:false,status:e.status,code:e.code}))');
 const blocked=await wait(async()=>{const x=await api('/api/instances/'+id);return x.sessionState==='shutdown-blocked'&&x;});
 assert.equal(blocked.sessionGeneration,before.sessionGeneration);assert.equal(remote(['cat','/home/rxhost/state/instances/'+id+'/session-services.json']),services);
 assert.equal(await b.evaluate('qS.state'),'active');assert.equal(await b.evaluate('qV.getStats().state'),'ready');
 checks.push({name:'public session stop honors explicit veto and retains the same live generation and display',status:'passed'});
 await b.evaluate('qHost.dispose()');assert.equal((await api('/api/instances/'+id)).sessionState,'shutdown-blocked');
 checks.push({name:'release does not turn a refused normal stop into a force stop',status:'passed'});
}catch(error){failure=error.stack;console.error(failure);checks.push({name:'suite',status:'failed',error:error.name});}
finally{
 await b.evaluate('window.qHost?.dispose()').catch(()=>{});await b.close();
 if(id){const current=await api('/api/instances/'+id);await api('/api/instances/'+id+'/stop',{force:true,sessionGeneration:current.sessionGeneration});}
 // Remove only this disposable fixture's enabled link, retaining package evidence.
 remote(['python3','-c','from pathlib import Path;p=Path("/home/rxhost/enabled/host-veto");assert p.exists();p.unlink()']);ctl('restart','remotexapp-host.service');await health();
 writeFileSync(config.evidenceDirectory+'/host-veto.json',JSON.stringify({schemaVersion:1,checks,status:failure?'failed':'passed',humanAcceptance:'not-evaluated'},null,2));
}
if(failure)process.exitCode=1;
