// Disposable local Manager; never uses or replaces a deployed user runtime.
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,cp,stat} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {RemoteXAppManager} from '../../cmd/remotexappd/web/sdk/remotexapp-manager.js';
const exec=promisify(execFile), delay=ms=>new Promise(r=>setTimeout(r,ms));
const root=resolve(process.env.REMOTEXAPP_SHIPPED_E2E_RELEASE_ROOT||'.');
const harness=fileURLToPath(new URL('../go-live-validation/',import.meta.url));
const work=await mkdtemp('/tmp/remotexapp-upgrade-kde-e2e-');
const base='http://127.0.0.1:21993',token=randomBytes(32).toString('hex');
const state=join(work,'state'),apps=join(work,'apps'),enabled=join(work,'enabled'),legacy=join(work,'legacy');
const oldCommon=join(work,'old-common'),currentCommon=join(root,'drivers/common');
const env={...process.env,XDG_RUNTIME_DIR:process.env.XDG_RUNTIME_DIR||'/run/user/1000',DBUS_SESSION_BUS_ADDRESS:process.env.DBUS_SESSION_BUS_ADDRESS||'unix:path=/run/user/1000/bus'};
const manager=new RemoteXAppManager({baseURL:base}),created=[],checks=[];
let child,browser;
async function stopManager(){if(child&&child.exitCode===null)await new Promise((r,j)=>{const t=setTimeout(()=>j(Error('manager did not stop')),15000);child.once('exit',()=>{clearTimeout(t);r();});child.kill('SIGTERM');});}
async function crashManager(){await new Promise(r=>{child.once('exit',r);child.kill('SIGKILL');});}
async function startManager(common){
 child=spawn(join(root,'bin/remotexappd'),['-listen','127.0.0.1:21993','-auth-mode','none','-state-dir',state,'-class-config',legacy,
 '-app-package-root',apps,'-apps-enabled',enabled,'-connections-token-file',join(work,'token'),
 '-gateway-bin',join(root,'bin/novnc-input'),'-status-bin',join(root,'bin/remotexapp-status'),
 '-core-driver-dir',common,'-ibus-engine',join(root,'components/remote-unicode-engine/engine.py')],{env,stdio:['ignore','ignore','pipe']});
 child.stderr.on('data',data=>process.stderr.write(data));
 for(let n=0;n<150;n++){if(child.exitCode!==null)throw Error('manager exited');try{if((await fetch(base+'/readyz')).ok)return;}catch{}await delay(100);}throw Error('manager not ready');
}
async function ready(id){for(let n=0;n<600;n++){const x=await manager.getInstance(id);if(x.applicationStatus?.state==='ready')return x;if(['error','exited'].includes(x.applicationStatus?.state)||x.state==='failed')throw Error(JSON.stringify(x));await delay(100);}throw Error('app not ready '+id);}
async function activate(id){
 const socket=new WebSocket(base.replace('http:','ws:')+'/remotexapps/'+id+'/rfb-compat');
 await new Promise((r,j)=>{const timer=setTimeout(()=>{socket.close();j(Error('RFB activation timed out'));},45000);socket.addEventListener('open',()=>{clearTimeout(timer);r();},{once:true});socket.addEventListener('error',()=>{clearTimeout(timer);j(Error('RFB activation failed'));},{once:true});});
 const closed=new Promise(r=>socket.addEventListener('close',r,{once:true}));socket.close();await closed;
 return ready(id);
}
async function create(templateId,parameters){const x=await manager.createInstance({templateId,...(parameters?{parameters}:{})});created.push(x.id);return activate(x.id);}
const checkedIBus = new Set();
async function info(id){
 const x=await manager.getInstance(id), connection=await manager.getConnections(id,{token,sessionGeneration:x.sessionGeneration});
 assert.equal(connection.environment.ibus?.scope,'runtime');
 assert.notEqual(connection.environment.ibus.address,connection.environment.sessionBus?.address);
 if(!checkedIBus.has(connection.revision)){
  await exec('gdbus',['call','--address',connection.environment.ibus.address,'--dest','org.freedesktop.IBus','--object-path','/org/freedesktop/IBus','--method','org.freedesktop.IBus.ListEngines'],{timeout:5000});
  checkedIBus.add(connection.revision);
 }
 return connection;
}
async function dbus(x,method,args=[]){return (await exec('gdbus',['call','--address',x.environment.sessionBus.address,'--dest',x.application.uniqueName,'--object-path',x.application.objectPath,'--method',x.application.interface+'.'+method,...args],{timeout:5000})).stdout.trim();}
function xenv(x){return{...env,DISPLAY:x.environment.display,XAUTHORITY:x.environment.xauthorityPath};}
async function key(x,keys){await exec('xdotool',['key','--clearmodifiers',...keys],{env:xenv(x),timeout:5000});}
async function readEditor(x){await key(x,['ctrl+a','ctrl+c']);await delay(200);return(await exec('xclip',['-selection','clipboard','-out','-target','UTF8_STRING'],{env:xenv(x),timeout:5000})).stdout;}
async function stop(id){const x=await manager.getInstance(id);if(x.managedInstanceId)await manager.setManagedInstanceState(x.managedInstanceId,'stopped',{force:true});else await manager.stopInstance(id,{force:true});}
async function installManagedFixture(version){
 const path=join(work,'managed-editor-'+version);await cp(join(root,'apps/mousepad'),path,{recursive:true});
 const manifest=JSON.parse(await readFile(join(path,'manifest.json'),'utf8'));manifest.id='managed-editor';manifest.driverVersion=version;manifest.runMode='shared';manifest.session.vacantAction='stop-session';manifest.session.vacantTimeout='6h';
 // Exercise the real fixed-display allocator, not just dynamic editor upgrades.
 Object.assign(manifest.server,{displayMode:'fixed',display:89,rfbPort:5989,gatewayPort:39089});
 await writeFile(join(path,'manifest.json'),JSON.stringify(manifest));
 const archive=(await exec(join(root,'scripts/package-app.sh'),[path,join(work,'fixture-artifacts')],{env})).stdout.trim();
 const digest=createHash('sha256').update(await readFile(archive)).digest('hex');
 await exec(join(root,'scripts/install-app.sh'),['--archive',archive,'--sha256',digest,'--package-root',apps,'--enabled-root',enabled],{env});
}
async function stopped(id,timeout=15000){const deadline=Date.now()+timeout;while(Date.now()<deadline){if((await manager.getInstance(id)).state==='stopped')return;await delay(200);}throw Error('runtime did not stop '+id);}
async function startBrowser(id){
 browser=spawn('google-chrome',['--headless=new','--disable-background-networking','--disable-default-apps','--disable-extensions','--disable-sync','--no-first-run','--no-default-browser-check','--remote-debugging-port=9273','--window-size=1100,760','--user-data-dir='+join(work,'browser-'+id),base+'/remotexapps/'+id+'/kiosk.html?diagnostics=on'],{stdio:'ignore'});
 const result=await exec('node',[join(harness,'check-browser-client.mjs')],{env:{...env,VALIDATION_CDP_PORT:'9273',VALIDATION_EXPECT_RESIZE:'true',VALIDATION_TIMEOUT_MS:'45000'},timeout:60000});
 assert.equal(JSON.parse(result.stdout).finalState,'connected');
}
async function stopBrowser(){if(browser&&browser.exitCode===null)await new Promise(r=>{browser.once('exit',r);browser.kill('SIGTERM');});browser=null;}
try{
 let occupied=false;try{occupied=(await fetch(base+'/readyz')).ok;}catch{}assert(!occupied,'21993 occupied');
 for(const p of [apps,enabled,legacy,join(state,'documents')])await mkdir(p,{recursive:true});
 await writeFile(join(work,'token'),token+'\n',{mode:0o600});
 await cp(currentCommon,oldCommon,{recursive:true});
 // Different immutable helper content simulates a core-only update, without
 // maintaining an obsolete release binary fixture or changing App versions.
 await writeFile(join(oldCommon,'upgrade-fixture-marker'),'old component bundle\n');
 await exec(join(root,'scripts/install-shipped-apps.sh'),[join(root,'bin/remotexappd'),apps,enabled],{env,timeout:60000});
 await installManagedFixture('1.0.0');
 await startManager(oldCommon);
 // Cache tests open two separate browsers. Use an independent long-vacancy
 // fixture instead of consuming the editors' intentional 60-second idle budget.
 const cacheFixture=await create('edge');
 try {
  const cacheCheck=await exec('node',[fileURLToPath(new URL('./check-console-sdk-cache.mjs',import.meta.url)),base,cacheFixture.id,'--require-deployed-assets'],{env,timeout:120000});
  await writeFile(join(work,'console-sdk-cache-result.jsonl'),cacheCheck.stdout);
  checks.push('Console-matching-SDK-with-stale-entry-root-and-proxy-prefix');
 } finally { await stop(cacheFixture.id); }
 const file=join(state,'documents','编辑器 space.txt'),original='Original text 中文\n';await writeFile(file,original);
 const editors=[];
 for(const app of ['kate','kwrite']){
  for(const value of ['',null,42,'/outside/file',join(state,'documents','missing'),join(state,'documents')])await assert.rejects(manager.createInstance({templateId:app,parameters:{filePath:value}}));
  const blank=await create(app),opened=await create(app,{filePath:file});editors.push(blank,opened);
  const b=await info(blank.id),o=await info(opened.id);
  if(app==='kate'){
   const privatePath=join(state,'instances',blank.id,'connection-status.json');
   const privateBefore=await readFile(privatePath,'utf8'), privateValue=JSON.parse(privateBefore);
   privateValue.details.application.testLabel='<img src=x onerror="window.connectionXSS=true">';
   await writeFile(privatePath,JSON.stringify(privateValue));
   const consoleCheck=await exec('node',[fileURLToPath(new URL('./check-console-connections.mjs',import.meta.url)),base,blank.id,join(work,'token'),'hostile-text'],{env,timeout:60000});
   await writeFile(privatePath,privateBefore);
   const consoleResult=JSON.parse(consoleCheck.stdout);assert.equal(consoleResult.passed,true);
   await writeFile(join(work,'console-result.json'),JSON.stringify(consoleResult,null,2));checks.push('trusted-console-descriptor-token-copy-no-mutation-browser');
  }
  assert.equal(b.application.protocol,'dbus');assert(b.application.service.startsWith('org.kde.'+app+'-'));assert.notEqual(b.environment.sessionBus.address,o.environment.sessionBus.address);
  assert.notEqual(b.application.service,o.application.service);
  assert.equal(await readEditor(o),original);
  const text='Control input 中文 '+app;
  assert.equal(await dbus(b,'openInput',[text,'UTF-8']),'(true,)');await delay(300);assert.equal(await readEditor(b),text);
  assert.equal(await dbus(b,'setCursor',['0','2']),'(true,)');
  const openedToken=await dbus(b,'tokenOpenUrl',[new URL('file://'+file).href,'UTF-8','false']);assert.match(openedToken,/\('.*'[,]?\)/);
  await delay(300);assert.equal(await readEditor(b),original);
  const publicBody=JSON.stringify(await manager.getInstance(blank.id));assert(!publicBody.includes(b.application.uniqueName));assert(!publicBody.includes(b.environment.sessionBus.address));
  await key(o,['ctrl+a']);await exec('xdotool',['type','--clearmodifiers','--delay','0','discard unsaved changes'],{env:xenv(o),timeout:5000});
  await stop(opened.id);assert.equal(await readFile(file,'utf8'),original);await ready(blank.id);
  await manager.stopInstance(blank.id);assert.equal(await readFile(file,'utf8'),original);
  const saved=await create(app,{filePath:file}),s=await info(saved.id);
  await key(s,['ctrl+a']);await exec('xdotool',['type','--clearmodifiers','--delay','0','explicitly saved'],{env:xenv(s),timeout:5000});await key(s,['ctrl+s']);
  for(let n=0;n<30&&(await readFile(file,'utf8')).trimEnd()!=='explicitly saved';n++)await delay(100);
  assert.match(await readFile(file,'utf8'),/^explicitly saved\n?$/);await stop(saved.id);assert.match(await readFile(file,'utf8'),/^explicitly saved\n?$/);await writeFile(file,original);
  const closed=await create(app);await key(await info(closed.id),['ctrl+q']);await stopped(closed.id);
  checks.push(app+'-optional-file-invalid-inputs-private-dbus-all-three-controls-GUI-readback-normal-and-force-no-save-stop-isolation');
 }
 // Sequential fixtures avoid accidentally exercising 60-second vacancy while
 // a different editor's assertions are running.
 for(const app of ['kate','kwrite','mousepad','libreoffice','firefox-esr','edge']){
  await stopManager();await startManager(oldCommon);
  const old=await create(app);
  await stopManager();await startManager(currentCommon);
  let current=await manager.getInstance(old.id);assert.equal(current.sessionGeneration,old.sessionGeneration);assert(current.versions.updateAvailable);assert(current.versions.eligible);
  // Ordinary restart retains the old core helper pin.
  const oldHash=current.versions.current.core.sha256;
  await manager.restartInstance(old.id,{sessionGeneration:current.sessionGeneration,force:true});
  current=await activate(old.id);assert.equal(current.versions.current.core.sha256,oldHash);
  const record=JSON.parse(await readFile(join(state,'runtime-manifests',old.id+'.json'),'utf8'));
  const homeMarker=join(record.runtime.homePath,'upgrade-data-marker');await writeFile(homeMarker,'retained persistent data');
  const generation=current.sessionGeneration,revision=current.versions.targetRevision;
  await assert.rejects(manager.upgradeAndRestartInstance(old.id,{sessionGeneration:generation-1,targetRevision:revision}),e=>e.status===409);
  await assert.rejects(manager.upgradeAndRestartInstance(old.id,{sessionGeneration:generation,targetRevision:'0'.repeat(64)}),e=>e.status===409);
  let upgraded;
  if(['kate','kwrite'].includes(app)){
   await startBrowser(old.id);
   const result=await exec('node',[join(harness,'check-sdk-lifecycle.mjs')],{env:{...env,VALIDATION_CDP_PORT:'9273',VALIDATION_INSTANCE_ID:old.id,VALIDATION_SDK_ACTION:'upgrade',VALIDATION_TIMEOUT_MS:'45000'},timeout:60000});
   assert.equal(JSON.parse(result.stdout).upgrade.phase,'completed');
   upgraded=await manager.getInstance(old.id);
  }else upgraded=await manager.upgradeAndRestartInstance(old.id,{sessionGeneration:generation,targetRevision:revision,force:true});
  assert.equal(upgraded.id,old.id);assert(upgraded.sessionGeneration>generation);assert.equal(upgraded.upgrade.phase,'completed');assert(!upgraded.versions.updateAvailable);
  assert.notEqual(upgraded.versions.current.core.sha256,oldHash);
  if(old.workspaceMode==='persistent')assert.equal(await readFile(homeMarker,'utf8'),'retained persistent data');
  else await assert.rejects(stat(homeMarker));
  const applied=await activate(old.id);const descriptor=await info(old.id);
  await assert.rejects(manager.getConnections(old.id,{token,sessionGeneration:generation}),e=>e.status===409);
  if(['kate','kwrite'].includes(old.templateId)){
   assert.equal(await dbus(descriptor,'openInput',['Upgraded editor','UTF-8']),'(true,)');
   await key(descriptor,['ctrl+a']);
   await exec('node',[join(harness,'check-sdk-lifecycle.mjs')],{env:{...env,VALIDATION_CDP_PORT:'9273',VALIDATION_INSTANCE_ID:old.id,VALIDATION_TEXT:'SDK 输入测试',VALIDATION_TIMEOUT_MS:'45000'},timeout:60000});
   assert.equal(await readEditor(descriptor),'SDK 输入测试');
   checks.push(app+'-browser-resize-bound-SDK-upgrade-reconnect-clipboard-policy-IME-readback');
   await stopBrowser();
  }
  assert.equal(applied.driverVersion,old.driverVersion);checks.push(old.templateId+'-adopt-ordinary-restart-retains-pin-core-only-upgrade-monotonic-generation-new-connections');
  await stop(old.id);
 }
 // Inject the exact durable boundary record, then actually SIGKILL/restart
 // the disposable Manager. No test-only recovery hooks exist in the binary.
 for(const phase of ['stopping','launching','blocked','failed','launched-before-complete']){
  await stopManager();await startManager(oldCommon);const source=await create('mousepad');
  await stopManager();await startManager(currentCommon);
  let current=await manager.getInstance(source.id);
  if(phase==='launched-before-complete')current=await manager.upgradeAndRestartInstance(source.id,{sessionGeneration:current.sessionGeneration,targetRevision:current.versions.targetRevision,force:true});
  const manifestPath=join(state,'runtime-manifests',source.id+'.json');
  const record=JSON.parse(await readFile(manifestPath,'utf8'));
  if(phase==='launched-before-complete')record.runtime.upgrade.status.phase='launching';
  else record.runtime.upgrade={status:{id:'upgrade-'+randomBytes(6).toString('hex'),phase,targetRevision:current.versions.targetRevision,updatedAt:new Date().toISOString()},target:record.resolvedSpec,package:record.appPackage,components:{...record.components,coreDriverDir:currentCommon,identity:current.versions.available.core},sourceGeneration:current.sessionGeneration,force:true};
  await writeFile(manifestPath,JSON.stringify(record)+'\n',{mode:0o600});await crashManager();await startManager(currentCommon);
  const recovered=await manager.getInstance(source.id);
  if(['blocked','failed'].includes(phase)){assert.equal(recovered.sessionGeneration,current.sessionGeneration);assert.equal(recovered.upgrade.phase,phase);}
  else {assert.equal(recovered.upgrade.phase,'completed');assert(!recovered.versions.updateAvailable);assert(phase==='launched-before-complete'?recovered.sessionGeneration===current.sessionGeneration:recovered.sessionGeneration>current.sessionGeneration);}
  assert.equal((await manager.listInstances()).filter(x=>x.state!=='stopped').length,1);
  await stop(source.id);checks.push('SIGKILL-durable-'+phase+'-recovery-single-owner');
 }
 await stopManager();await startManager(oldCommon);
 const managed=await manager.createManagedInstance({id:'upgrade-managed',templateId:'managed-editor',parameters:{filePath:file}});
 const managedBefore=await ready(managed.runtime.id);created.push(managedBefore.id);
 const managedRecord=JSON.parse(await readFile(join(state,'runtime-manifests',managedBefore.id+'.json'),'utf8'));
 const marker=join(managedRecord.runtime.homePath,'managed-data');await writeFile(marker,'persistent');
 await stopManager();await installManagedFixture('1.1.0');await startManager(currentCommon);
 const managedCurrent=await manager.getInstance(managedBefore.id);
 const managedAfter=await manager.upgradeAndRestartInstance(managedBefore.id,{sessionGeneration:managedCurrent.sessionGeneration,targetRevision:managedCurrent.versions.targetRevision,force:true});
 assert.equal(managedAfter.display,':89');assert.equal(managedAfter.versions.updateAvailable,false);
 await ready(managedAfter.id);await info(managedAfter.id);
 assert.equal(managedAfter.id,managedBefore.id);assert.equal(managedAfter.managedInstanceId,managed.id);assert.equal(managedAfter.driverVersion,'1.1.0');assert.deepEqual(managedAfter.parameters,managedBefore.parameters);assert.equal(await readFile(marker,'utf8'),'persistent');
 await stopManager();await startManager(currentCommon);
 const registration=await manager.getManagedInstance(managed.id);assert.equal(registration.runtime.id,managedBefore.id);assert.equal(registration.appliedDriverVersion,'1.1.0');assert.equal(registration.runtime.sessionGeneration,managedAfter.sessionGeneration);
 await stop(managedBefore.id);await manager.deleteManagedInstance(managed.id);
 checks.push('managed-fixed-display-App-and-core-upgrade-parameters-HOME-association-durable-adoption');
 const idle=[];
 for(const app of ['kate','kwrite']){const x=await create(app);idle.push(x.id);await dbus(await info(x.id),'openInput',['idle unsaved text','UTF-8']);}
 await Promise.all(idle.map(id=>stopped(id,75000)));
 checks.push('kate-and-kwrite-modified-blank-vacancy-60-second-stop');
 assert.deepEqual((await manager.listInstances()).filter(x=>x.state!=='stopped'),[]);
 await writeFile(join(work,'result.json'),JSON.stringify({passed:true,root,checks,scope:'disposable loopback 21993; user-home XFCE excluded to preserve real desktop'},null,2)+'\n');
 console.log(JSON.stringify({passed:true,evidence:join(work,'result.json'),checks},null,2));
}finally{
 await stopBrowser();
 if(child&&child.exitCode===null)for(const id of created)try{const x=await manager.getInstance(id);if(x.state!=='stopped')await stop(id);}catch(error){if(error.status!==404)console.error('cleanup',id,error.message);}
 await stopManager();
}
