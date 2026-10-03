// SVC-001–010: disposable real X11/IBus fault and Manager-crash tests.
// Never point this harness at an existing Manager or a user's App instance.
import assert from 'node:assert/strict';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,cp,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {RemoteXAppManager} from '../../cmd/remotexappd/web/sdk/remotexapp-manager.js';

const exec=promisify(execFile), sleep=ms=>new Promise(r=>setTimeout(r,ms));
const root=resolve(process.env.REMOTEXAPP_SVC_RELEASE_ROOT||'.');
const work=await mkdtemp('/tmp/remotexapp-svc-e2e-');
const base='http://127.0.0.1:21995',api=new RemoteXAppManager({baseURL:base});
const state=join(work,'state'),apps=join(work,'apps'),enabled=join(work,'enabled'),legacy=join(work,'legacy');
const uid=process.getuid();
const env={...process.env,XDG_RUNTIME_DIR:`/run/user/${uid}`,DBUS_SESSION_BUS_ADDRESS:`unix:path=/run/user/${uid}/bus`};
const created=new Set(),checks=[];
let manager;

async function wait(check,message,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){const value=await check();if(value)return value;await sleep(50)}throw Error(message)}
async function startManager(){
  manager=spawn(join(root,'bin/remotexappd'),['-listen','127.0.0.1:21995','-auth-mode','none','-state-dir',state,
    '-class-config',legacy,'-app-package-root',apps,'-apps-enabled',enabled,'-expose-internals=true',
    '-gateway-bin',join(root,'bin/novnc-input'),'-status-bin',join(root,'bin/remotexapp-status'),
    '-core-driver-dir',join(root,'drivers/common'),'-ibus-engine',join(root,'components/remote-unicode-engine/engine.py'),
    '-shutdown-grace-timeout','2s','-shutdown-blocked-warning-after','1s','-shutdown-force-after','5s'],{env,stdio:['ignore','ignore','pipe']});
  manager.stderr.on('data',b=>process.stderr.write(b));
  await wait(async()=>{if(manager.exitCode!==null)throw Error('Manager exited');try{return(await fetch(base+'/readyz')).ok}catch{return false}},'Manager not ready',45000);
}
async function stopManager(signal='SIGTERM'){
  if(!manager||manager.exitCode!==null||manager.signalCode!==null)return;
  const exited=new Promise(r=>manager.once('exit',r));manager.kill(signal);await exited;
}
async function record(id){return JSON.parse(await readFile(join(state,'instances',id,'session-services.json'),'utf8'))}
async function launch(parameters={}){const instance=await api.createInstance({templateId:'svc-fixture',parameters});created.add(instance.id);await wait(async()=>{const x=await api.getInstance(instance.id);return x.applicationStatus?.state==='ready'},'App not ready');return instance.id}
async function stop(id){await api.request(`/api/instances/${id}/stop`,{method:'POST',body:{force:true}})}
async function alive(identity){try{const b=await readFile(`/proc/${identity.pid}/stat`,'utf8'),fields=b.slice(b.lastIndexOf(')')+1).trim().split(/\s+/);return fields[0]!=='Z'&&fields[19]===identity.startTime}catch{return false}}
async function killOwned(identity){assert(await alive(identity),'refuse to signal stale PID');process.kill(identity.pid,'SIGKILL')}
async function noChildren(r){await wait(async()=>!(await Promise.all([r.supervisor,r.driver,...Object.values(r.services)].filter(Boolean).map(alive))).some(Boolean),'owned processes leaked',12000)}
async function rawReadback(id,text){
  // The API intentionally rejects a descriptor if health changes between its
  // two identity reads. After fault injection, wait for a stable snapshot.
  const info=await wait(async()=>{try{return await api.getConnections(id)}catch(e){if(e.status===409)return false;throw e}},'connection descriptor did not settle',3000),xenv={...env,DISPLAY:info.environment.display,XAUTHORITY:info.environment.xauthorityPath};
  await exec('xdotool',['key','--clearmodifiers','ctrl+a'],{env:xenv,timeout:3000});
  await exec('xdotool',['type','--clearmodifiers','--delay','1',text],{env:xenv,timeout:3000});
  await exec('xdotool',['key','--clearmodifiers','ctrl+a','ctrl+c'],{env:xenv,timeout:3000});
  await wait(async()=>{try{return(await exec('xclip',['-selection','clipboard','-out','-target','UTF8_STRING'],{env:xenv,timeout:1000})).stdout===text}catch{return false}},'raw input readback failed');
}
async function installFixture(){
  const source=join(work,'fixture');await cp(join(root,'apps/mousepad'),source,{recursive:true});
  const manifest=JSON.parse(await readFile(join(source,'manifest.json'),'utf8'));
  manifest.id='svc-fixture';manifest.driverVersion='1.0.0';manifest.session.vacantAction='stop-session';manifest.session.vacantTimeout='1h';
  manifest.parameters.startupDelay={type:'integer',minimum:0,maximum:12,default:0};
  await writeFile(join(source,'manifest.json'),JSON.stringify(manifest));
  let script=await readFile(join(source,'session.sh'),'utf8');
  script=script.replace('umask 077','umask 077\nsleep "$(jq -r .startupDelay "$REMOTEXAPP_PARAMETERS")"');
  await writeFile(join(source,'session.sh'),script);
  await writeFile(join(source,'shutdown.sh'),'#!/bin/sh\nif [ -f "$REMOTEXAPP_RUNTIME/refuse-shutdown" ]; then exit 10; fi\nexec '+JSON.stringify(join(root,'apps/mousepad/shutdown.sh'))+'\n',{mode:0o755});
  const archive=(await exec(join(root,'scripts/package-app.sh'),[source,join(work,'artifacts')],{env})).stdout.trim();
  const digest=createHash('sha256').update(await readFile(archive)).digest('hex');
  await exec(join(root,'scripts/install-app.sh'),['--archive',archive,'--sha256',digest,'--package-root',apps,'--enabled-root',enabled],{env});
}

try{
  let occupied=false;try{occupied=(await fetch(base+'/readyz')).ok}catch{}assert(!occupied,'21995 already in use');
  for(const dir of [apps,enabled,legacy,state])await mkdir(dir,{recursive:true});
  await installFixture();await startManager();
  for(const name of ['engine','ibus','dbus']){
    const id=await launch(),before=await record(id),info=await api.getConnections(id);
    const environment=await api.request(`/api/instances/${id}/status/environment`,{method:'POST',body:{sessionGeneration:1}});
    assert.equal(environment.environment.DBUS_SESSION_BUS_ADDRESS,info.environment.sessionBus.address);
    assert.equal(environment.environment.IBUS_ADDRESS,info.environment.ibus.address);
    await killOwned(before.services[name]);await wait(async()=> (await record(id)).failure,'missing service failure');
    if(name==='dbus') {
      // GTK may terminate itself when its bus disconnects. Core must retain
      // the cause and never call this a user exit or silently replace the bus.
      await wait(async()=> (await api.getInstance(id)).sessionState==='failed','D-Bus-dependent App exit was not reported as failure');
      assert.equal((await record(id)).failure,'dbus-exited');
      assert.equal((await api.getInstance(id)).sessionGeneration,1);
      await noChildren(before);await stop(id);checks.push('private-D-Bus-loss-App-self-exit-cause-retained-no-replacement');
      continue;
    }
    assert(await alive(before.driver));assert.equal((await api.getInstance(id)).sessionState,'running');
    await rawReadback(id,`raw-${name}-survives`);
    await stopManager('SIGKILL');await startManager();
    assert.deepEqual((await record(id)).supervisor,before.supervisor);assert(await alive(before.driver));
    assert.equal((await api.getInstance(id)).sessionGeneration,1);
    await stop(id);await noChildren(before);checks.push(`${name}-fault-raw-input-live-App-adoption-cleanup`);
  }
  {
    const id=await launch(),before=await record(id),info=await api.getConnections(id);
    await exec('xdotool',['key','--clearmodifiers','ctrl+q'],{env:{...env,DISPLAY:info.environment.display,XAUTHORITY:info.environment.xauthorityPath},timeout:3000});
    await wait(async()=> (await api.getInstance(id)).sessionState==='stopped','natural exit did not apply early idle');
    await noChildren(before);assert.equal((await api.getInstance(id)).state,'server-ready');
    await stop(id);checks.push('natural-App-exit-stop-session-keeps-VNC');
  }
  {
    const id=await launch(),before=await record(id);
    await rawReadback(id,'unsaved-blocked-document');
    await writeFile(join(state,'instances',id,'refuse-shutdown'),'fixture');
    await assert.rejects(api.request(`/api/instances/${id}/stop`,{method:'POST',body:{force:false}}),e=>e.status===409);
    assert.equal((await api.getInstance(id)).sessionState,'shutdown-blocked');
    for(const identity of [before.driver,...Object.values(before.services)])assert(await alive(identity));
    await stopManager('SIGKILL');await startManager();
    await wait(async()=> (await api.getInstance(id)).state==='stopped','durable host force deadline not enforced',12000);
    await noChildren(before);checks.push('unsaved-refusing-hook-services-preserved-Manager-crash-host-force');
  }
  {
    const previous=new Set(await readdir(join(state,'instances')));
    const request=api.createInstance({templateId:'svc-fixture',parameters:{startupDelay:6}}).catch(()=>null);
    const id=await wait(async()=> (await readdir(join(state,'instances'))).find(id=>!previous.has(id)),'startup runtime missing');created.add(id);
    const before=await wait(async()=>{try{const r=await record(id);return r.driver&&r}catch{return false}},'Driver startup not observed');
    await stopManager('SIGKILL');await request;await startManager();
    const after=await api.getInstance(id);assert.equal(after.sessionGeneration,before.generation);assert.equal(after.sessionState,'running');
    assert.deepEqual((await record(id)).supervisor,before.supervisor);
    await stop(id);await noChildren(before);checks.push('Manager-crash-during-startup-resumes-same-generation');
  }
  {
    const a=await launch(),b=await launch(),ra=await record(a),rb=await record(b);
    assert.notEqual(ra.services.ibus.pid,rb.services.ibus.pid);
    await killOwned(ra.supervisor);await wait(async()=> (await api.getInstance(a)).sessionState==='failed','supervisor crash not observed');
    await noChildren(ra);assert(await alive(rb.driver));await rawReadback(b,'other-runtime-survives');
    await stop(a);await stop(b);await noChildren(rb);checks.push('supervisor-crash-cgroup-cleanup-other-runtime-independent');
  }
  console.log(JSON.stringify({result:'passed',work,checks},null,2));
}finally{
  if(manager?.exitCode===null&&manager?.signalCode===null){for(const id of created)try{await stop(id)}catch{}await stopManager()}
  for(const id of created)await exec('systemctl',['--user','stop',...['session','gateway','server','vnc'].map(layer=>`remotexapp-${id}-${layer}.service`)],{env,timeout:15000}).catch(()=>{});
  console.error('Retained disposable evidence:',work);
}
