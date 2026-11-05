// Read-only attachment to an owned running desktop; negative states are synthetic HTTP responses.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {config,api,wait} from './host-browser.mjs';
import {chrome} from '../native-audio/browser-cdp.mjs';
import {open} from './host-public-browser.mjs';
const initial=await api('/api/managed-instances/host-desktop');
assert.equal(initial.desiredState,'running');assert.equal(initial.observedState,'running');
assert.equal(initial.runtime.sessionState,'running','Read-only probe requires an already running desktop');
const browser=await chrome(''),p=await open(browser.base),checks=[],requests=[];let mode='stopped',failed;
p.on('Network.requestWillBeSent',async e=>{const u=new URL(e.request.url);if(u.pathname.startsWith('/rx/api/'))requests.push({path:u.pathname,method:e.request.method});});
const assets=new Map(['host-workbench.mjs','host-workbench-model.mjs'].map(name=>[name,readFileSync(new URL('../../cmd/remotexappd/web/sdk/'+name,import.meta.url))]));
p.on('Fetch.requestPaused',async e=>{const path=new URL(e.request.url).pathname;if(path.endsWith('/api/managed-instances')){const actual=await api('/api/managed-instances');let rows=actual;if(mode==='stopped')rows=actual.map(m=>m.id==='host-desktop'?{...m,desiredState:'stopped',observedState:'stopped'}:m);if(mode==='ambiguous')rows=[...actual,{...initial,id:'synthetic-second-desktop'}];if(mode==='missing')rows=actual.filter(m=>m.templateId!==initial.templateId);await p.call('Fetch.fulfillRequest',{requestId:e.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(rows)).toString('base64')});return;}const name=path.split('/').pop();assert(assets.has(name));await p.call('Fetch.fulfillRequest',{requestId:e.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/javascript'},{name:'Cache-Control',value:'no-store'}],body:assets.get(name).toString('base64')});});
const choose=()=>p.evaluate("document.querySelector('#template').value='xfce-user-desktop';document.querySelector('#template').dispatchEvent(new Event('change'))");
try{
 await p.call('Fetch.enable',{patterns:[...[...assets.keys()].map(n=>({urlPattern:config.ingressURL+'/rx/sdk/'+n,requestStage:'Request'})),{urlPattern:config.ingressURL+'/rx/api/managed-instances',requestStage:'Request'}]});
 await p.call('Page.navigate',{url:config.ingressURL+'/rx/sdk/host.html'});
 await wait(()=>p.evaluate('document.querySelector("#template")?.options.length===8'));await choose();
 assert.equal(await p.evaluate('document.querySelector("#launch-button").textContent'),'连接托管桌面');
 assert.equal(await p.evaluate('document.querySelector("#profile").disabled'),true);
 await p.evaluate('document.querySelector("#launch-button").click()');
 await wait(()=>p.evaluate('remoteXAppHostWorkbench.snapshot().records.some(r=>r.code==="managed-start-required")'));
 assert.equal((await api('/api/managed-instances/host-desktop')).desiredState,initial.desiredState);
 assert.equal(await p.evaluate('remoteXAppHostWorkbench.snapshot().windows.length'),0);
 checks.push({name:'synthetic stopped response explains explicit Start without creating or changing real desired state',status:'passed'});
 for(const [scenario,code]of [['ambiguous','managed-selection-required'],['missing','managed-registration-required']]){mode=scenario;await p.evaluate('document.querySelector("#launch-button").click()');await wait(()=>p.evaluate('remoteXAppHostWorkbench.snapshot().records.some(r=>r.code==='+JSON.stringify(code)+')'));}
 checks.push({name:'synthetic missing and ambiguous registrations require explicit configuration or selection',status:'passed'});
 mode='live';
 // The workbench still holds the old catalog snapshot; click must read fresh registrations.
 await p.evaluate('document.querySelector("#launch-button").click()');
 await wait(()=>p.evaluate('remoteXAppHostWorkbench.snapshot().windows[0]?.stats?.state==="ready"'),90000);
 const m=await api('/api/managed-instances/host-desktop'),first=await p.evaluate('remoteXAppHostWorkbench.snapshot().windows[0]');
 assert.equal(first.instanceId,m.runtimeInstanceId);assert(first.stats.renderedFrames>0);
 await p.evaluate('document.querySelector("#launch-button").click()');
 await wait(()=>p.evaluate('remoteXAppHostWorkbench.snapshot().windows.length===2&&remoteXAppHostWorkbench.snapshot().windows.every(w=>w.stats?.state==="ready")'));
 const windows=await p.evaluate('remoteXAppHostWorkbench.snapshot().windows');assert(windows.every(w=>w.instanceId===first.instanceId&&w.generation===first.generation));
 assert(!requests.some(r=>r.method==='POST'&&r.path==='/rx/api/instances'));
 assert(!requests.some(r=>r.method==='PATCH'));
 checks.push({name:'catalog button reads fresh managed state and paints two attachments of one generation without ordinary creation or desired-state mutation',status:'passed'});
 assert.equal(p.errors.length,0);
}catch(error){failed=error.stack;console.error(failed);}
finally{
 await p.evaluate('document.querySelector("#logout")?.click()').catch(()=>{});
 await wait(()=>p.evaluate('remoteXAppHostWorkbench.snapshot().diagnostics.destroyed')).catch(()=>{});
 await p.close();await browser.close();
 const after=await api('/api/managed-instances/host-desktop');assert.equal(after.desiredState,initial.desiredState);assert.equal(after.runtimeInstanceId,initial.runtimeInstanceId);assert.equal(after.runtime.sessionGeneration,initial.runtime.sessionGeneration);
 writeFileSync(config.evidenceDirectory+'/host-managed-entry.json',JSON.stringify({status:failed?'failed':'passed',checks,humanAcceptance:'not-evaluated'},null,2));
}
if(failed)process.exitCode=1;
