import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,cp,stat} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {RemoteXAppManager} from '../../cmd/remotexappd/web/sdk/remotexapp-manager.js';
const exec=promisify(execFile),delay=ms=>new Promise(r=>setTimeout(r,ms));
const root=resolve(process.env.REMOTEXAPP_SHIPPED_E2E_RELEASE_ROOT||'.');
const work=await mkdtemp('/tmp/remotexapp-document-e2e-');
const base='http://127.0.0.1:21992', token=randomBytes(32).toString('hex');
const state=join(work,'state'),apps=join(work,'apps'),enabled=join(work,'enabled'),legacy=join(work,'legacy');
const manager=new RemoteXAppManager({baseURL:base});
let child; const created=[]; const checks=[];
const env={...process.env,XDG_RUNTIME_DIR:process.env.XDG_RUNTIME_DIR||'/run/user/1000',DBUS_SESSION_BUS_ADDRESS:process.env.DBUS_SESSION_BUS_ADDRESS||'unix:path=/run/user/1000/bus'};
async function stopManager(){if(child&&child.exitCode===null){await new Promise((r,j)=>{const t=setTimeout(()=>j(Error('manager stop timed out')),15000);child.once('exit',()=>{clearTimeout(t);r()});child.kill('SIGTERM')});}}
async function startManager(){
 child=spawn(join(root,'bin/remotexappd'),['-listen','127.0.0.1:21992','-auth-mode','none','-state-dir',state,'-class-config',legacy,
 '-app-package-root',apps,'-apps-enabled',enabled,'-connections-token-file',join(work,'token'),
 '-gateway-bin',join(root,'bin/novnc-input'),'-status-bin',join(root,'bin/remotexapp-status'),
 '-core-driver-dir',join(root,'drivers/common'),'-ibus-engine',join(root,'components/remote-unicode-engine/engine.py')],{env,stdio:['ignore','ignore','pipe']});
 child.stderr.on('data',data=>process.stderr.write(data));
 for(let n=0;n<100;n++){if(child.exitCode!==null)throw Error('manager exited');try{if((await fetch(base+'/readyz')).ok)return}catch{}await delay(100)}throw Error('manager not ready');
}
async function ready(id){for(let n=0;n<600;n++){const x=await manager.getInstance(id);if(x.applicationStatus?.state==='ready')return x;if(['error','exited'].includes(x.applicationStatus?.state))throw Error('app failed '+x.applicationStatus.state);await delay(100)}throw Error('app not ready')}
async function create(templateId,parameters){const x=await manager.createInstance({templateId,...(parameters?{parameters}:{})});created.push(x.id);await ready(x.id);return x.id}
async function info(id){const x=await manager.getInstance(id);return manager.getConnections(id,{token,sessionGeneration:x.sessionGeneration})}
async function stop(id,force=false){await manager.request('/api/instances/'+id+'/stop',{method:'POST',body:{force}})}
async function key(id,keys){const x=await info(id);await exec('xdotool',['key','--clearmodifiers',...keys],{env:{...env,DISPLAY:x.environment.display,XAUTHORITY:x.environment.xauthorityPath},timeout:5000})}
async function type(id,text){const x=await info(id);await exec('xdotool',['type','--clearmodifiers','--delay','0',text],{env:{...env,DISPLAY:x.environment.display,XAUTHORITY:x.environment.xauthorityPath},timeout:5000})}
async function readEditor(id){const x=await info(id);await key(id,['ctrl+a','ctrl+c']);await delay(200);return(await exec('xclip',['-selection','clipboard','-out','-target','UTF8_STRING'],{env:{...env,DISPLAY:x.environment.display,XAUTHORITY:x.environment.xauthorityPath},timeout:5000})).stdout}
async function busCall(x){return exec('gdbus',['call','--address',x.environment.sessionBus.address,'--dest',x.application.service,'--object-path',x.application.objectPath,'--method',x.application.interface+'.ListNames'],{timeout:5000})}
try{
 let occupied=false;try{occupied=(await fetch(base+'/readyz')).ok}catch{}assert(!occupied,'21992 occupied');
 for(const path of [apps,enabled,legacy,join(state,'documents')])await mkdir(path,{recursive:true});
 await writeFile(join(work,'token'),token+'\n',{mode:0o600});
 await exec(join(root,'scripts/install-shipped-apps.sh'),[join(root,'bin/remotexappd'),apps,enabled],{env,timeout:60000});
 // A test-only package proves new private protocols without core App branches.
 const fixture=join(work,'synthetic-dbus');await cp(join(root,'apps/mousepad'),fixture,{recursive:true});
 const manifest=JSON.parse(await readFile(join(fixture,'manifest.json'),'utf8'));
 manifest.id='synthetic-dbus';manifest.driverVersion='1.0.0';manifest.session.status.privateDetails={application:{type:'json',maxBytes:4096,maxDepth:4,maxItems:32}};
 await writeFile(join(fixture,'manifest.json'),JSON.stringify(manifest));
 const application=JSON.stringify({protocol:'dbus',service:'org.freedesktop.DBus',objectPath:'/org/freedesktop/DBus',interface:'org.freedesktop.DBus'});
 const script=await readFile(join(fixture,'session.sh'),'utf8');
 await writeFile(join(fixture,'session.sh'),script.replaceAll('--detail-string application=mousepad',`--detail-string application=mousepad --connection-application '${application}'`));
 const archive=(await exec(join(root,'scripts/package-app.sh'),[fixture,join(work,'artifacts')],{env})).stdout.trim();
 const digest=createHash('sha256').update(await readFile(archive)).digest('hex');
 await exec(join(root,'scripts/install-app.sh'),['--archive',archive,'--sha256',digest,'--package-root',apps,'--enabled-root',enabled],{env});
 await startManager();
 const file=join(state,'documents','文档 space.txt'),original='Original document text\n';
 await writeFile(file,original);
 for(const app of ['mousepad','libreoffice'])for(const value of ['',null,42,'/outside/doc',join(state,'documents','missing'),join(state,'documents')]){
  await assert.rejects(manager.createInstance({templateId:app,parameters:{filePath:value}}));
 }
 checks.push('invalid-optional-file-matrix');
 const first=await create('mousepad',{filePath:file}),second=await create('mousepad',{filePath:file});
 assert.equal(await readEditor(first),original);assert.equal(await readEditor(second),original);
 await type(first,'discard these modifications');
 await stop(first);
 assert.equal(await readFile(file,'utf8'),original);
 assert.equal((await ready(second)).sessionState,'running');
 checks.push('file-open-readback-destructive-normal-stop-other-instance-survives');
 await key(second,['ctrl+a']);await type(second,'explicitly saved');await key(second,['ctrl+s']);
 for(let n=0;n<30&&(await readFile(file,'utf8'))!=='explicitly saved';n++)await delay(100);
 assert.equal(await readFile(file,'utf8'),'explicitly saved');
 await stop(second,true);checks.push('explicit-save-before-force-stop');
 const synthetic=await create('synthetic-dbus'),before=await info(synthetic);
 await busCall(before);
 for(const path of ['/api/instances/'+synthetic,'/api/instances/'+synthetic+'/status','/api/instances']){
  const body=await(await fetch(base+path)).text();assert(!body.includes('org.freedesktop.DBus'));assert(!body.includes(before.environment.sessionBus.address));
 }
 await stopManager();await startManager();
 const adopted=await info(synthetic);assert.equal(adopted.sessionGeneration,before.sessionGeneration);assert.equal(adopted.revision,before.revision);await busCall(adopted);
 await manager.request('/api/instances/'+synthetic+'/restart',{method:'POST',body:{force:true,sessionGeneration:adopted.sessionGeneration}});await ready(synthetic);
 const restarted=await info(synthetic);assert(restarted.sessionGeneration>before.sessionGeneration);
 await assert.rejects(manager.getConnections(synthetic,{token,sessionGeneration:before.sessionGeneration}),error=>error.status===409);
 await busCall(restarted);await stop(synthetic);checks.push('synthetic-private-dbus-no-public-leak-adoption-restart');
 const lo=await create('libreoffice');let loInfo=await info(lo);
 await stopManager();await startManager();
 assert.equal((await info(lo)).revision,loInfo.revision);
 await manager.request('/api/instances/'+lo+'/restart',{method:'POST',body:{force:true,sessionGeneration:loInfo.sessionGeneration}});
 await ready(lo);const loRestarted=await info(lo);assert(loRestarted.sessionGeneration>loInfo.sessionGeneration);loInfo=loRestarted;
 await exec('/usr/bin/python3',[join(root,'apps/libreoffice/probe.py'),String(loInfo.application.port),''],{timeout:10000});
 await exec('/usr/bin/python3',['-c',`import uno,sys
ctx=uno.getComponentContext()
r=ctx.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver",ctx)
c=r.resolve("uno:socket,host=127.0.0.1,port="+sys.argv[1]+";urp;StarOffice.ComponentContext")
d=c.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop",c)
doc=d.loadComponentFromURL("private:factory/swriter","_blank",0,())
doc.Text.String="discard unsaved untitled document"
assert doc.isModified()
`,String(loInfo.application.port)],{timeout:10000});
 await stop(lo);checks.push('libreoffice-startcenter-uno-create-modified-untitled-destructive-stop');
 const vacant=await create('mousepad');await type(vacant,'idle unsaved');
 await delay(2000);assert.equal((await ready(vacant)).sessionState,'running');
 const deadline=Date.now()+75000;
 while(Date.now()<deadline){const x=await manager.getInstance(vacant);if(x.state==='stopped')break;await delay(500)}
 assert.equal((await manager.getInstance(vacant)).state,'stopped');
 await assert.rejects(info(vacant));checks.push('60-second-no-viewer-unsaved-stop');
 assert.deepEqual((await manager.listInstances()).filter(x=>x.state!=='stopped'),[]);
 console.log(JSON.stringify({result:'passed',checks,work}));
}finally{
 if(child?.exitCode===null){for(const id of created){try{await stop(id,true)}catch{}}await stopManager()}
}
