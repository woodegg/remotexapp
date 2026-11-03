// Authenticated public SDK check; only new synthetic Apps/files are owned.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {open,wait,delay} from './host-public-browser.mjs';
const config=JSON.parse(await readFile(process.argv[2],'utf8'));
assert.equal(config.purpose,'remotexapp-native-host-public-owned');
assert.equal(config.projectOwnedDisposable,true);
assert.equal(new URL(config.origin).protocol,'https:');
assert.equal(new URL(config.cdpURL).hostname,'127.0.0.1');
assert.match(config.sourceCommit,/^[a-f0-9]{40}$/);assert.match(config.componentManifest,/^[a-f0-9]{64}$/);
assert(Array.isArray(config.remoteCommand)&&config.remoteCommand.length>0&&config.remoteCommand.every(x=>typeof x==='string'));
assert(config.evidenceDirectory.startsWith('/'));await mkdir(config.evidenceDirectory,{recursive:true});
const s=config,browser={base:config.cdpURL};
const run=(...args)=>new Promise((resolve,reject)=>{const p=execFile(config.remoteCommand[0],[...config.remoteCommand.slice(1),...args],{timeout:120000,maxBuffer:4*1024*1024},(e,out)=>e?reject(e):resolve(out));p.stdin.end();});
const file='/home/uat/documents/host-public-'+randomUUID()+'.txt';await run('python3','-c',`from pathlib import Path;import os;p=Path(${JSON.stringify(file)});p.touch(mode=0o600,exist_ok=False);os.chown(p,1000,1000)`);
const p=await open(browser.base),checks=[];let owned,success=false,lastStats;
const pass=name=>{checks.push({name,status:'passed'});console.log(name);};
async function paintUDP(){for(let n=0;n<40;n++){await p.evaluate(`qV.sendText(' '+${n});qV.sendKey('a',{modifiers:['Control']})`);await delay(300);await p.evaluate("qV.sendKey('ArrowRight')");await delay(300);const v=await p.evaluate('qV.getStats()');if(v.transport==='webrtc-udp'&&v.udpReceivedBytes>0&&v.renderedFrames>0)return v;}throw Error('UDP actual paint unavailable');}
try{
 await p.call('Page.bringToFront');
 await p.call('Page.navigate',{url:s.origin+'/rx/sdk/host.html'});await wait(()=>p.evaluate('document.querySelector("#template")?.options.length>=4'));
 assert(await p.evaluate('!!window.remoteXAppHostWorkbench'));pass('authenticated public host workbench loads template metadata');
 await p.evaluate(`(async()=>{const sdk=await import('./index.js');window.qHost=new sdk.RemoteXAppHost({baseURL:'/rx',scope:'public-host-test'});window.qDisplay=document.createElement('div');qDisplay.style='position:fixed;inset:20px;z-index:200;background:#172030';document.body.append(qDisplay);window.qS=await qHost.open({templateId:'alpine-mousepad',parameters:{filePath:${JSON.stringify(file)}},keepAlive:true});window.qV=await qS.attach(qDisplay);})()`);
 owned=await p.evaluate('qS.instance');assert.equal(owned.versions.current.core.commit,s.sourceCommit);assert.equal(owned.displayComponentDigest,s.componentManifest);assert((await p.evaluate('qV.getStats()')).renderedFrames>0);assert.equal(await p.evaluate('qHost.getAudioState().connection'),'idle');pass('exact new Core/component paints with no implicit audio channel');
 await p.evaluate("qV.sendText('Host WAN 中文 😀');qV.sendKey('s',{modifiers:['Control']})");await wait(async()=>await run('cat',file)==='Host WAN 中文 😀');pass('public host native text and save shortcut persist exact Unicode');
 const descriptor=await p.evaluate('qS.connections()');assert.equal(descriptor.sessionGeneration,owned.sessionGeneration);assert.equal(descriptor.unavailableReasons.ibus,'unsupported-provider');pass('generation-qualified control descriptor accepts native unsupported IBus');
 await paintUDP();await p.evaluate('qV.measureLatency()');await delay(1500);lastStats=await p.evaluate('qV.getStats()');pass('actual native UDP display frames coexist with public host input and statistics');
 await p.evaluate('qV.configureTransport(false)');await wait(()=>p.evaluate("qV.getStats().transport==='wss'"));await p.evaluate("qV.sendText(' WSS');qV.sendKey('s',{modifiers:['Control']})");await wait(async()=>(await run('cat',file)).endsWith(' WSS'));await p.evaluate('qV.configureTransport(true)');await paintUDP();pass('explicit WSS fallback and return to painted UDP retain the same session');
 await p.evaluate("(async()=>{window.qOther=document.createElement('div');qOther.style='position:fixed;inset:35px;z-index:201';document.body.append(qOther);window.qSecond=await qHost.open({instanceId:qS.id});window.qV2=await qSecond.attach(qOther,{readOnly:true});})()");assert((await p.evaluate('qV2.getStats()')).renderedFrames>0);assert.equal(await p.evaluate("(()=>{try{qV2.sendText('forbidden');return ''}catch(e){return e.code}})()"),'input-unavailable');await p.evaluate('qSecond.release();qOther.remove()');assert.equal(await p.evaluate('qS.state'),'active');pass('second read-only host owner paints and releases without closing writable owner');
 await p.evaluate('qV.dispose()');await p.evaluate('(async()=>{qV=await qS.attach(qDisplay)})()');assert((await p.evaluate('qV.getStats()')).renderedFrames>0);assert.equal(await p.evaluate('qS.generation'),owned.sessionGeneration);pass('display unload and restore retain runtime generation');
 await p.evaluate('qHost.dispose()');await wait(()=>p.evaluate(`fetch('/rx/api/instances/'+${JSON.stringify(owned.id)}).then(r=>r.json()).then(x=>x.attachedClients===0)`));assert.equal(p.errors.length,0);pass('host disposal releases every display without uncaught browser errors');success=true;
}catch(e){console.error(e.stack);console.log('diagnostic',JSON.stringify(await p.evaluate('({viewer:window.qV?.getStats(),session:window.qS?.state})').catch(()=>null)));throw e;}
finally{
 await p.evaluate('window.qHost?.dispose()').catch(()=>{});
 if(!owned)owned=await p.evaluate(`fetch('/rx/api/instances').then(r=>r.json()).then(xs=>xs.find(x=>x.parameters?.filePath===${JSON.stringify(file)}))`).catch(()=>null);
 if(owned)await p.evaluate(`fetch('/rx/api/instances/'+${JSON.stringify(owned.id)}+'/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionGeneration:${owned.sessionGeneration}})}).then(r=>{if(!r.ok)throw Error('Owned cleanup failed')})`);
 await run('python3','-c',`from pathlib import Path;p=Path(${JSON.stringify(file)});assert p.name.startswith('host-public-');p.unlink(missing_ok=True)`);
 await writeFile(config.evidenceDirectory+'/public-host-results.json',JSON.stringify({source:s.sourceCommit,component:s.componentManifest,status:success?'passed':'failed',checks,lastStats,humanAcceptance:'not-evaluated'},null,2));await p.close();
}
