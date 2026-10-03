// Isolated real-browser action tests. Never attach to deployed user runtimes.
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,cp,stat,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {RemoteXAppManager} from '../../cmd/remotexappd/web/sdk/remotexapp-manager.js';
const exec=promisify(execFile),delay=ms=>new Promise(r=>setTimeout(r,ms));
const root=resolve(process.env.REMOTEXAPP_SHIPPED_E2E_RELEASE_ROOT||'.'),work=await mkdtemp('/tmp/remotexapp-actions-e2e-');
const base='http://127.0.0.1:21995',manager=new RemoteXAppManager({baseURL:base}),created=[],checks=[];
const env={...process.env,XDG_RUNTIME_DIR:'/run/user/'+process.getuid(),DBUS_SESSION_BUS_ADDRESS:'unix:path=/run/user/'+process.getuid()+'/bus'};
const apps=join(work,'apps'),enabled=join(work,'enabled'),state=join(work,'state'),legacy=join(work,'legacy');
let child;
async function stopManager(){if(child&&child.exitCode===null)await new Promise(r=>{child.once('exit',r);child.kill('SIGTERM')});}
async function startManager(){
 child=spawn(join(root,'bin/remotexappd'),['-listen','127.0.0.1:21995','-auth-mode','none','-state-dir',state,'-class-config',legacy,'-app-package-root',apps,'-apps-enabled',enabled,'-gateway-bin',join(root,'bin/novnc-input'),'-status-bin',join(root,'bin/remotexapp-status'),'-core-driver-dir',join(root,'drivers/common'),'-ibus-engine',join(root,'components/remote-unicode-engine/engine.py')],{env,stdio:['ignore','ignore','pipe']});
 child.stderr.on('data',x=>process.stderr.write(x));
 await wait(async()=>{if(child.exitCode!==null)throw Error('manager exited');try{return(await fetch(base+'/readyz')).ok}catch{return false}});
}
async function wait(fn){for(let n=0;n<450;n++){const result=await fn();if(result)return result;await delay(100);}throw Error('condition timed out');}
async function rpc(endpoint){
 const ws=new WebSocket(endpoint);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})});
 let seq=0;const pending=new Map();
 ws.addEventListener('message',e=>{const v=JSON.parse(e.data),p=pending.get(v.id);if(p){pending.delete(v.id);clearTimeout(p.timer);v.error?p.reject(Error(JSON.stringify(v))):p.resolve(v.result)}});
 return {close:()=>ws.close(),call:(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('RPC timeout '+method))},10000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))})};
}
async function activate(id){const s=new WebSocket(base.replace('http:','ws:')+'/remotexapps/'+id+'/rfb-compat');await new Promise((r,j)=>{s.addEventListener('open',r,{once:true});s.addEventListener('error',j,{once:true})});s.close();return wait(async()=>{const x=await manager.getInstance(id);if(x.state==='failed'||x.applicationStatus?.state==='error')throw Error(JSON.stringify(x));return x.applicationStatus?.state==='ready'&&x;});}
async function tabs(info){
 const firefox=info.application.protocol==='webdriver-bidi';
 const endpoint=firefox?info.application.endpoints.webSocketUrl:(await(await fetch(info.application.endpoints.versionUrl)).json()).webSocketDebuggerUrl;
 const control=await rpc(endpoint);
 try{if(firefox){await control.call('session.new',{capabilities:{}});try{return(await control.call('browsingContext.getTree')).contexts.map(x=>({id:x.context,url:x.url}));}finally{await control.call('session.end');}}
 return(await control.call('Target.getTargets')).targetInfos.filter(x=>x.type==='page').map(x=>({id:x.targetId,url:x.url}));}finally{control.close();}
}
try{
 let occupied=false;try{occupied=(await fetch(base+'/readyz')).ok}catch{}assert(!occupied,'21995 already occupied');
 for(const path of [apps,enabled,state,legacy])await mkdir(path,{recursive:true});
 await exec(join(root,'scripts/install-shipped-apps.sh'),[join(root,'bin/remotexappd'),apps,enabled],{env,timeout:60000});
 const fixture=join(work,'synthetic');await cp(resolve('tests/app-package/synthetic'),fixture,{recursive:true});
 const manifest=JSON.parse(await readFile(join(fixture,'manifest.json'),'utf8'));
 manifest.session.vacantTimeout='6h';
 manifest.actions={echo:{handler:'echo.py',timeout:'2s',parameters:{mode:{type:'enum',values:['echo','sleep'],default:'echo'}},result:{text:{type:'string',required:true}}}};
 await writeFile(join(fixture,'manifest.json'),JSON.stringify(manifest));
 await writeFile(join(fixture,'echo.py'),`#!/usr/bin/python3\nimport json,sys,os,time\np=json.load(sys.stdin)\nif p['parameters']['mode']=='sleep':\n open(os.environ['REMOTEXAPP_RUNTIME']+'/action-running','w').write(str(os.getpid()))\n time.sleep(10)\nprint(json.dumps({'text':'<img onerror=bad> 通用'}))\n`,{mode:0o755});
 const binaryHash=createHash('sha256').update(await readFile(join(root,'bin/remotexappd'))).digest('hex');
 const archive=(await exec(join(root,'scripts/package-app.sh'),[fixture,join(work,'artifacts')],{env})).stdout.trim();
 await exec(join(root,'scripts/install-app.sh'),['--archive',archive,'--sha256',createHash('sha256').update(await readFile(archive)).digest('hex'),'--package-root',apps,'--enabled-root',enabled],{env});
 const firefoxFixture=join(work,'firefox-cancel');await cp(join(root,'apps/firefox-esr'),firefoxFixture,{recursive:true});
 const firefoxManifest=JSON.parse(await readFile(join(firefoxFixture,'manifest.json'),'utf8'));firefoxManifest.id='firefox-cancel-fixture';firefoxManifest.driverVersion='1.0.0';firefoxManifest.singleton=false;
 await writeFile(join(firefoxFixture,'manifest.json'),JSON.stringify(firefoxManifest));
 const handler=(await readFile(join(firefoxFixture,'open-url.py'),'utf8')).replace('import socket','import socket\nimport time').replace('call(ws, 2, "session.new", {"capabilities": {}})','call(ws, 2, "session.new", {"capabilities": {}})\n            if "/cancel-fixture" in url:\n                open(os.environ["REMOTEXAPP_RUNTIME"]+"/action-running", "w").write(str(os.getpid()))\n                time.sleep(10)');
 const racingHandler=handler.replace('attempted = True','attempted = True\n        if "/race-fixture" in url:\n            open(os.environ["REMOTEXAPP_RUNTIME"]+"/action-running", "w").write(str(os.getpid()))\n            time.sleep(1)');
 await writeFile(join(firefoxFixture,'open-url.py'),racingHandler);
 const firefoxArchive=(await exec(join(root,'scripts/package-app.sh'),[firefoxFixture,join(work,'artifacts')],{env})).stdout.trim();
 await exec(join(root,'scripts/install-app.sh'),['--archive',firefoxArchive,'--sha256',createHash('sha256').update(await readFile(firefoxArchive)).digest('hex'),'--package-root',apps,'--enabled-root',enabled],{env});
 await startManager();
 for(const templateId of ['edge','firefox-esr']){
  let x=await manager.createInstance({templateId});created.push(x.id);
  const idle=await manager.getActions(x.id);assert.equal(idle.ready,false);assert(idle.actions.openUrl);assert(!JSON.stringify(idle).includes('open-url.py'));
  x=await activate(x.id);const original=x,info=await manager.getConnections(x.id),before=await tabs(info);
  assert(before.length>0);assert.equal((await manager.createInstance({templateId,parameters:{startUrl:'https://example.test/ignored'}})).id,x.id);
  for(const url of ['file:///etc/passwd','javascript:alert(1)','data:text/html,hi','https://example.test/\n'])await assert.rejects(manager.invokeAction(x.id,'openUrl',{url},{sessionGeneration:x.sessionGeneration}),e=>e.status===400);
  await assert.rejects(manager.invokeAction(x.id,'openUrl',{url:base},{sessionGeneration:x.sessionGeneration+1}),e=>e.status===409);
  await assert.rejects(manager.invokeAction(x.id,'openUrl',{url:base,disposition:'replace'},{sessionGeneration:x.sessionGeneration}),e=>e.status===400);
  const requested=base+'/healthz?app='+templateId;
  const result=await manager.invokeAction(x.id,'openUrl',{url:requested},{sessionGeneration:x.sessionGeneration});assert.equal(result.result.url,requested);
  await wait(async()=>{const all=await tabs(info);return all.find(t=>t.id===result.result.tabId&&t.url===requested)});
  const after=await tabs(info);for(const tab of before)assert(after.find(t=>t.id===tab.id),'original tab removed');assert.equal(after.length,before.length+1);
  if(templateId==='firefox-esr'){
   const owner=await rpc(info.application.endpoints.webSocketUrl);try{await owner.call('session.new',{capabilities:{}});await assert.rejects(manager.invokeAction(x.id,'openUrl',{url:base},{sessionGeneration:x.sessionGeneration}),e=>e.status===409&&e.body.code==='control-busy');assert((await owner.call('browsingContext.getTree')).contexts.length>0);await owner.call('session.end');}finally{owner.close()}
   const again=await manager.invokeAction(x.id,'openUrl',{url:base+'/readyz'},{sessionGeneration:x.sessionGeneration});assert(again.result.tabId);checks.push('Firefox-owned-BiDi-session-not-stolen-and-released');
  }
  const consoleResult=await exec('node',[resolve('tests/app-package/check-console-actions.mjs'),base,x.id],{env,timeout:90000});checks.push(JSON.parse(consoleResult.stdout).check);
  x=await manager.getInstance(x.id);assert.equal(x.sessionGeneration,original.sessionGeneration);assert.equal(x.display,original.display);checks.push(templateId+'-new-activated-tab-original-tabs-preserved-singleton-reuse-url-validation-SDK');
 }
 let cancelled=await manager.createInstance({templateId:'firefox-cancel-fixture'});created.push(cancelled.id);cancelled=await activate(cancelled.id);
 const cancelInfo=await manager.getConnections(cancelled.id),marker=join(state,'instances',cancelled.id,'action-running');
 const racing=manager.invokeAction(cancelled.id,'openUrl',{url:base+'/race-fixture'},{sessionGeneration:cancelled.sessionGeneration}).catch(e=>e);
 await wait(async()=>{try{return await stat(marker)}catch{return false}});
 const foreign=await rpc(cancelInfo.application.endpoints.webSocketUrl);
 try{await foreign.call('session.new',{capabilities:{}});assert.equal((await racing).body.code,'control-busy');assert((await foreign.call('browsingContext.getTree')).contexts.length);await foreign.call('session.end');}finally{foreign.close()}
 await unlink(marker);checks.push('Firefox-session-creation-race-never-ends-foreign-session');
 for(const mode of ['abort','manager-crash']){
  const controller=new AbortController();const pending=manager.invokeAction(cancelled.id,'openUrl',{url:base+'/cancel-fixture'},{sessionGeneration:cancelled.sessionGeneration,signal:controller.signal}).catch(e=>e);
  await wait(async()=>{try{return await stat(marker)}catch{return false}});const pid=Number(await readFile(marker,'utf8'));
  if(mode==='abort')controller.abort();else{await new Promise(r=>{child.once('exit',r);child.kill('SIGKILL')});await startManager();}
  assert.equal((await pending).name,'RemoteXAppAPIError');
  await wait(async()=>{const control=await rpc(cancelInfo.application.endpoints.webSocketUrl);try{return(await control.call('session.status')).ready}finally{control.close()}});
  await wait(async()=>{try{process.kill(pid,0);return false}catch{return true}});
  assert((await manager.invokeAction(cancelled.id,'openUrl',{url:base+'/readyz'},{sessionGeneration:cancelled.sessionGeneration})).result.tabId);
  await unlink(marker);checks.push('Firefox-'+mode+'-owned-BiDi-session-released-and-next-action-succeeds');
 }
 await manager.stopInstance(cancelled.id,{force:true});
 let generic=await manager.createInstance({templateId:'synthetic-app'});created.push(generic.id);generic=await activate(generic.id);
 const opts={sessionGeneration:generic.sessionGeneration};assert.equal((await manager.invokeAction(generic.id,'echo',{},opts)).result.text,'<img onerror=bad> 通用');
 assert.equal(createHash('sha256').update(await readFile(join(root,'bin/remotexappd'))).digest('hex'),binaryHash);
 const slow=manager.invokeAction(generic.id,'echo',{mode:'sleep'},opts).catch(e=>e);
 await wait(async()=>{try{return await stat(join(state,'instances',generic.id,'action-running'))}catch{return false}});
 await assert.rejects(manager.invokeAction(generic.id,'echo',{},opts),e=>e.status===409&&e.body.code==='busy');
 assert((await manager.getActions(created[0])).actions.openUrl);
 const oldPID=Number(await readFile(join(state,'instances',generic.id,'action-running'),'utf8'));
 await manager.restartInstance(generic.id,{sessionGeneration:generic.sessionGeneration,force:true});
 assert.equal((await slow).body.code,'outcome-unknown');assert.throws(()=>process.kill(oldPID,0));generic=await activate(generic.id);
 await assert.rejects(manager.invokeAction(generic.id,'echo',{},opts),e=>e.status===409);assert((await manager.invokeAction(generic.id,'echo',{}, {sessionGeneration:generic.sessionGeneration})).result.text);
 const snapshots=(await manager.listInstances()).filter(x=>x.state!=='stopped');await stopManager();await startManager();
 for(const x of snapshots){const adopted=await manager.getInstance(x.id);assert.equal(adopted.sessionGeneration,x.sessionGeneration);assert.equal(adopted.driverVersion,x.driverVersion);assert((await manager.getActions(x.id)).ready);}
 assert((await manager.invokeAction(generic.id,'echo',{}, {sessionGeneration:generic.sessionGeneration})).result.text);
 checks.push('synthetic-action-without-rebuild-busy-unrelated-runtime-responsive-restart-cancels-process-stale-generation-Manager-adoption');
 await writeFile(join(work,'result.json'),JSON.stringify({passed:true,version:await(await fetch(base+'/api/version')).json(),checks},null,2));
 console.log(JSON.stringify({passed:true,work,checks}));
}finally{
 for(const id of created)try{await manager.stopInstance(id,{force:true})}catch(error){if(error.status!==404)process.stderr.write('cleanup '+id+': '+error.message+'\n')}
 await stopManager();
}
