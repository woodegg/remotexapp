// Managed survivor and empty-generation recovery through the public recovery UI.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {config,api,remote,open,wait,delay,click} from './host-browser.mjs';
const checks=[],owned=new Set(),b=await open(config.ingressURL+'/rx/sdk/host.html');
const asUser=args=>remote(['runuser','-u',config.user,'--','env','XDG_RUNTIME_DIR=/run/user/'+config.uid,'DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/'+config.uid+'/bus',...args]);
const record=id=>JSON.parse(remote(['cat','/home/rxhost/state/runtime-manifests/'+id+'.json']));
const services=id=>JSON.parse(remote(['cat','/home/rxhost/state/instances/'+id+'/session-services.json']));
const pass=name=>{checks.push({name,status:'passed'});console.log(name);};
const health=()=>wait(async()=>{try{return await api('/readyz');}catch{return false;}},45000);
const bus=()=>asUser(['gdbus','call','--session','--dest','org.freedesktop.DBus','--object-path','/org/freedesktop/DBus','--method','org.freedesktop.DBus.GetId']);
const alive=identity=>remote(['python3','-c',`from pathlib import Path;import json;p=Path('/proc/${identity.pid}/stat');s=p.read_text() if p.exists() else '';v=s[s.rfind(')')+1:].split();print(bool(v) and v[0] not in ['Z','X'] and v[19]==${JSON.stringify(identity.startTime)})`]).trim()==='True';
let failure;
async function action(kind){
 await wait(()=>b.evaluate(`!qView.getState().busy && qView.getState().actions.some(a=>a.kind==='${kind}')`));
 await click(b,`[data-recovery-action="${kind}"]`);
 await wait(()=>b.evaluate('!qView.getState().busy'));
}
try{
 await wait(()=>b.evaluate("!!window.remoteXAppHostWorkbench"));
  await api('/api/managed-instances/host-desktop',{desiredState:'running'},'PATCH');
  await b.evaluate("(async()=>{const sdk=await import('./index.js');window.qHost=new sdk.RemoteXAppHost({baseURL:'/rx',scope:'recovery-managed'});window.qDisplay=document.createElement('div');qDisplay.style='position:fixed;inset:20px;z-index:400';document.body.append(qDisplay);window.qView=qHost.mount(qDisplay,{managedId:'host-desktop'});await qView.settled;Object.defineProperty(window,'qManaged',{get:()=>qView.session});Object.defineProperty(window,'qManagedViewer',{get:()=>qView.viewer})})()");
  const desktop=await b.evaluate('({id:qManaged.id,generation:qManaged.generation})'),desktopServices=services(desktop.id),desktopManifest=record(desktop.id),accountBus=bus();
  owned.add(desktop.id);assert.equal(desktopManifest.runtime.homePath,'/home/rxhost');
  const driver=desktopServices.driver;assert(alive(driver));
  const injection=`import os,subprocess,json\nfrom pathlib import Path\nroot=Path('/home/rxhost/state/instances/${desktop.id}');s=json.loads((root/'session-services.json').read_text());driver=s['driver'];v=Path('/proc/'+str(driver['pid'])+'/stat').read_text().split(')')[-1].split();assert v[19]==driver['startTime'];cg=Path('/proc/'+str(driver['pid'])+'/cgroup').read_text().strip().split('::')[1]\ndef enter():\n Path('/sys/fs/cgroup'+cg+'/cgroup.procs').write_text(str(os.getpid()));os.setgroups([]);os.setgid(1004);os.setuid(1004)\nenv=dict(os.environ,HOME='/home/rxhost',DISPLAY=${JSON.stringify((await api('/api/instances/'+desktop.id)).display)},XAUTHORITY='/home/rxhost/.Xauthority',XDG_RUNTIME_DIR='/run/user/1004',DBUS_SESSION_BUS_ADDRESS='unix:path=/run/user/1004/bus')\np=subprocess.Popen(['mousepad','--disable-server'],env=env,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True,preexec_fn=enter);v=Path('/proc/'+str(p.pid)+'/stat').read_text().split(')')[-1].split();print(json.dumps({'pid':p.pid,'startTime':v[19],'cgroup':cg}))`;
  const editor=JSON.parse(remote(['python3','-c',injection]));await delay(1000);assert(alive(editor));
  remote(['kill','-KILL',String(driver.pid)]);
  await wait(async()=>{const i=await api('/api/instances/'+desktop.id);return i.sessionState==='failed' && i.recovery?.reason==='session-populated-or-unknown';},45000);
  assert(alive(editor));assert.equal((await api('/api/instances/'+desktop.id)).sessionGeneration,desktop.generation);assert.equal(bus(),accountBus);
  await wait(()=>b.evaluate("qView.getState().state==='attention'"));
  await action('refresh');const blocked=await b.evaluate('qView.getState()');
  assert.equal(blocked.displayReady,false);assert.equal(blocked.recovery.reason,'session-populated-or-unknown');
  assert(blocked.actions.some(a=>a.kind==='recheck'));assert(!blocked.actions.some(a=>['restart','retry','reattach'].includes(a.kind)));
  const attempts=(await api('/api/instances/'+desktop.id)).recovery.attempts;
  await action('recheck');assert.equal(await b.evaluate('qView.getState().reason'),'recheck-submitted');
  await delay(1500);assert(alive(editor));assert.equal((await api('/api/instances/'+desktop.id)).sessionGeneration,desktop.generation);
  assert.equal((await api('/api/instances/'+desktop.id)).recovery.attempts,attempts);
  pass('live editor blocks recovery; panel explains blocker and recheck neither kills nor resets budget');
  assert(editor.cgroup.includes('remotexapp-'+desktop.id+'-session.service'));
  remote(['python3','-c',`from pathlib import Path;Path(${JSON.stringify('/sys/fs/cgroup'+editor.cgroup+'/cgroup.kill')}).write_text('1')`]);
  const recovered=await wait(async()=>{const i=await api('/api/instances/'+desktop.id);return i.sessionGeneration>desktop.generation && i.sessionState==='running' && i.applicationStatus?.state==='ready' && i;},110000);
  assert.deepEqual(record(desktop.id).components,desktopManifest.components);assert.equal(bus(),accountBus);
  await wait(()=>b.evaluate("qManaged.state==='invalidated'"));
  assert.equal(await b.evaluate('qView.getState().displayReady'),false);await action('refresh');await action('reattach');
  assert(await b.evaluate('qManagedViewer.getStats().renderedFrames>0'));
  assert.equal(await b.evaluate('qView.getState().displayReady'),true);pass('empty failed desktop self-recovers with pinned components; explicit panel reattach paints new generation');
  await api('/api/managed-instances/host-desktop',{desiredState:'stopped',force:true},'PATCH');
  await wait(()=>b.evaluate("qView.getState().state==='attention'"));await action('refresh');assert(!(await b.evaluate('qView.getState().actions')).some(a=>['retry','restart','reattach','recheck'].includes(a.kind)));
  const denied=await b.evaluate("qHost.open({managedId:'host-desktop'}).then(()=>'',e=>e.code)");assert.equal(denied,'managed-unavailable');
  await delay(1500);assert.equal((await api('/api/managed-instances/host-desktop')).desiredState,'stopped');assert.equal(bus(),accountBus);
  pass('explicit managed stop is durable and observation cannot revive it');
}catch(error){failure=error.stack;console.error(failure);checks.push({name:'suite',status:'failed',error:error.name});}
finally{
  await b.evaluate('qHost?.dispose()').catch(()=>{});await b.close();
  await api('/api/managed-instances/host-desktop',{desiredState:'stopped',force:true},'PATCH').catch(()=>{});
  for(const id of owned){const i=await api('/api/instances/'+id);if(i.state!=='stopped')await api('/api/instances/'+id+'/stop',{force:true,sessionGeneration:i.sessionGeneration});}
  writeFileSync(config.evidenceDirectory+'/recovery-managed.json',JSON.stringify({schemaVersion:1,checks,status:failure?'failed':'passed',humanAcceptance:'not-evaluated'},null,2));
}
if(failure)process.exitCode=1;
