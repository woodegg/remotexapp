// One-time deployment rehearsal, not a legacy runtime compatibility path.
// Explicit baseline archive + candidate; only disposable local state/units.
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,cp,rename,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {RemoteXAppManager} from '../../cmd/remotexappd/web/sdk/remotexapp-manager.js';
const exec=promisify(execFile),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const roots={old:resolve(process.argv[2]),next:resolve(process.argv[3]||'.')};
const work=await mkdtemp('/tmp/remotexapp-svc-cutover-'),state=join(work,'state');
const baseURL='http://127.0.0.1:21997',api=new RemoteXAppManager({baseURL});
const env={...process.env,XDG_RUNTIME_DIR:`/run/user/${process.getuid()}`,DBUS_SESSION_BUS_ADDRESS:`unix:path=/run/user/${process.getuid()}/bus`};
const intent={id:'cutover-doc',templateId:'cutover-pad',desiredState:'running',profileRef:'preserved',overrides:{},parameters:{}};
let child,active;
async function wait(fn,label){for(let i=0;i<450;i++){const x=await fn();if(x)return x;await sleep(100)}throw Error(label)}
async function stop(){if(child&&child.exitCode===null&&child.signalCode===null)await new Promise(r=>{child.once('exit',r);child.kill('SIGTERM')})}
async function start(core,catalog=core,expectFailure=false){
 const root=roots[core];let logs='';
 child=spawn(join(root,'bin/remotexappd'),['-listen','127.0.0.1:21997','-auth-mode','none','-state-dir',state,'-class-config',join(work,'legacy'),'-app-package-root',join(work,catalog,'apps'),'-apps-enabled',join(work,catalog,'enabled'),'-expose-internals=true',
 '-gateway-bin',join(root,'bin/novnc-input'),'-status-bin',join(root,'bin/remotexapp-status'),'-core-driver-dir',join(root,'drivers/common'),'-ibus-engine',join(root,'components/remote-unicode-engine/engine.py')],{env,stdio:['ignore','ignore','pipe']});
 child.stderr.on('data',b=>{logs+=b;process.stderr.write(b)});
 if(expectFailure){await wait(()=>child.exitCode!==null,'invalid stack did not fail');assert.notEqual(child.exitCode,0);return logs}
 await wait(async()=>{if(child.exitCode!==null)throw Error('Manager exited');try{return(await fetch(baseURL+'/readyz')).ok}catch{return false}},'Manager not ready');
}
async function install(label){
 const root=roots[label],dir=join(work,label),source=join(dir,'fixture');await mkdir(dir,{recursive:true});await cp(join(root,'apps/mousepad'),source,{recursive:true});
 const manifest=JSON.parse(await readFile(join(source,'manifest.json'),'utf8'));
 Object.assign(manifest,{id:'cutover-pad',runMode:'shared',driverVersion:label==='old'?'1.0.0':'2.0.0'});
 manifest.session.vacantAction='stop-session';manifest.session.vacantTimeout='1h';
 await writeFile(join(source,'manifest.json'),JSON.stringify(manifest));
 const archive=(await exec(join(root,'scripts/package-app.sh'),[source,join(dir,'artifacts')],{env})).stdout.trim();
 await exec(join(root,'scripts/install-app.sh'),['--archive',archive,'--sha256',createHash('sha256').update(await readFile(archive)).digest('hex'),'--package-root',join(dir,'apps'),'--enabled-root',join(dir,'enabled')],{env});
}
async function ready(){const m=await api.getManagedInstance(intent.id);active=m.runtime;assert(active);return wait(async()=>{const x=await api.getInstance(active.id);return x.applicationStatus?.state==='ready'&&x},'App not ready')}
try{
 let busy=false;try{busy=(await fetch(baseURL+'/readyz')).ok}catch{}assert(!busy,'21997 occupied');
 await mkdir(state);await mkdir(join(work,'legacy'));await install('old');await install('next');
 await start('old');await api.createManagedInstance(intent);const before=await ready();
 const profile=before.homePath;assert(profile.startsWith(join(state,'profiles')+'/'));
 await writeFile(join(profile,'preserved-document.txt'),'saved document survives\n',{mode:0o600});
 const hash=()=>readFile(join(profile,'preserved-document.txt')).then(b=>createHash('sha256').update(b).digest('hex'));
 const originalHash=await hash();
 await api.request('/api/managed-instances/'+intent.id,{method:'PATCH',body:{desiredState:'stopped'}});
 assert.equal((await api.getInstance(before.id)).state,'stopped');await stop();
 // Interrupted partial selection must fail without launching a mixed stack.
 const mixed=await start('next','old',true);assert.match(mixed,/core-v1|session.services/);
 const stale=await start('next','next',true);assert.match(stale,/old session services contract|schema/);
 assert.equal(await hash(),originalHash);
 // Offline intent-only conversion; keep old records recoverable, never feed
 // resolved old Core/App pins into the new Manager. Simulate a pause here.
 const retired=join(work,'retired');await mkdir(retired,{mode:0o700});
 for(const name of ['runtime-manifests','managed-instances'])await rename(join(state,name),join(retired,name));
 await mkdir(join(state,'managed-instances'),{mode:0o700});
 assert.equal(await hash(),originalHash);assert.equal(child.exitCode!==null,true);
 await writeFile(join(state,'managed-instances',intent.id+'.json'),JSON.stringify({...intent,observedState:'stopped',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}),{mode:0o600});
 await start('next');const after=await ready();assert.notEqual(after.id,before.id);assert.equal(after.homePath,profile);assert.equal(await hash(),originalHash);
 assert.equal(after.driverVersion,'2.0.0');assert.equal(after.sessionGeneration,1);
 const manifest=JSON.parse(await readFile(join(state,'runtime-manifests',after.id+'.json'),'utf8'));assert.equal(manifest.schemaVersion,2);
 const services=JSON.parse(await readFile(join(state,'instances',after.id,'session-services.json'),'utf8'));assert.equal(services.state,'ready');
 await stop();await start('next');const adopted=await ready();assert.equal(adopted.id,after.id);assert.equal(adopted.sessionGeneration,1);
 const current=JSON.parse(await readFile(join(state,'instances',after.id,'session-services.json'),'utf8'));assert.deepEqual(current.supervisor,services.supervisor);
 const checks=['old-manager-graceful-stop','mixed-Core-catalog-rejected-before-launch','old-runtime-pins-rejected-no-implicit-migration','stopped-interrupted-cutover-retains-recoverable-records','intent-profile-document-preserved-new-runtime-schema-and-generation','new-architecture-Manager-adoption'];
 await writeFile(join(work,'result.json'),JSON.stringify({passed:true,checks,documentHashPreserved:await hash()===originalHash},null,2)+'\n');console.log(JSON.stringify({passed:true,work,checks}));
}finally{if(child?.exitCode===null)try{await api.request('/api/managed-instances/'+intent.id,{method:'PATCH',body:{desiredState:'stopped',force:true}})}catch{}await stop()}
