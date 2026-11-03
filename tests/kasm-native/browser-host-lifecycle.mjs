// Fault injection is limited to the validated disposable rxhost fixture.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {config,api,remote,open,wait,delay} from './host-browser.mjs';

const checks=[],owned=new Set(),b=await open(config.ingressURL+'/rx/sdk/host.html');
const asUser=args=>remote(['runuser','-u',config.user,'--','env','XDG_RUNTIME_DIR=/run/user/'+config.uid,'DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/'+config.uid+'/bus',...args]);
const record=id=>JSON.parse(remote(['cat','/home/rxhost/state/runtime-manifests/'+id+'.json']));
const services=id=>JSON.parse(remote(['cat','/home/rxhost/state/instances/'+id+'/session-services.json']));
const pass=name=>{checks.push({name,status:'passed'});console.log(name);};
const health=()=>wait(async()=>{try{return await api('/readyz');}catch{return false;}},45000);
const bus=()=>asUser(['gdbus','call','--session','--dest','org.freedesktop.DBus','--object-path','/org/freedesktop/DBus','--method','org.freedesktop.DBus.GetId']);
const alive=identity=>remote(['python3','-c',`from pathlib import Path;import json;p=Path('/proc/${identity.pid}/stat');s=p.read_text() if p.exists() else '';v=s[s.rfind(')')+1:].split();print(bool(v) and v[0] not in ['Z','X'] and v[19]==${JSON.stringify(identity.startTime)})`]).trim()==='True';
const path='/home/rxhost/documents/lifecycle-'+Date.now()+'.txt';
asUser(['python3','-c','from pathlib import Path;import sys;Path(sys.argv[1]).write_text("")',path]);
let failure;
try{
  await wait(()=>b.evaluate("document.querySelector('#template')?.options.length>=8"));
  await b.call('Browser.grantPermissions',{origin:config.ingressURL,permissions:['clipboardReadWrite','clipboardSanitizedWrite','audioCapture']});
  await b.evaluate(`(async()=>{window.streams=[];const capture=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async c=>{const s=await capture(c);streams.push(s);return s};const sdk=await import('./index.js');window.qHost=new sdk.RemoteXAppHost({baseURL:'/rx',scope:'host-lifecycle'});window.qDisplay=document.createElement('div');qDisplay.style='position:fixed;inset:20px;z-index:100';document.body.append(qDisplay);window.qSession=await qHost.open({templateId:'mousepad',parameters:{filePath:${JSON.stringify(path)}},keepAlive:true});window.qViewer=await qSession.attach(qDisplay);window.qAudio=await qSession.audio();window.qEvents=[];for(const n of ['reconnecting','reconnected','reconnectstopped','reconnectexhausted'])qViewer.addEventListener(n,e=>qEvents.push({name:n,detail:e.detail}));})()`);
  const first=await b.evaluate('({id:qSession.id,generation:qSession.generation,epoch:qViewer.getStats().connectionEpoch})');owned.add(first.id);
  await b.evaluate("qViewer.sendText('Lifecycle 中文 saved');qViewer.sendKey('s',{modifiers:['Control']})");await wait(()=>remote(['cat',path])==='Lifecycle 中文 saved');
  await assert.rejects(api('/api/instances',{templateId:'mousepad',parameters:{filePath:'/root/disallowed.txt'}}),e=>e.status===409 && e.message.includes('filePath'));
  pass('native file save readback and independent document-root rejection');
  await b.evaluate("qViewer.configureClipboard({toRemote:'manual',toLocal:'manual'});qViewer.focus()",true);
  await b.evaluate('qAudio.setSpeaker(true)',true);await b.evaluate('qAudio.setMicrophone(true)',true);
  const before=await api('/api/instances/'+first.id),manifest=record(first.id),service=services(first.id),busBefore=bus();
  asUser(['systemctl','--user','restart','remotexapp-host.service']);await health();
  await wait(()=>b.evaluate(`qViewer.getStats().state==='ready' && qViewer.getStats().connectionEpoch>${first.epoch}`),60000);
  const after=await api('/api/instances/'+first.id);
  assert.equal(after.sessionGeneration,before.sessionGeneration);assert.deepEqual(after.versions.current,before.versions.current);
  assert.deepEqual(record(first.id).components,manifest.components);assert.deepEqual(services(first.id),service);assert.equal(bus(),busBefore);
  assert(await b.evaluate("qEvents.some(e=>e.name==='reconnected')"));
  assert.deepEqual(await b.evaluate('qViewer.getClipboardState().requested'),{toRemote:'off',toLocal:'off'});
  await wait(()=>b.evaluate('streams.every(s=>s.getTracks().every(t=>t.readyState==="ended"))'));
  pass('Manager restart adopts identical App processes and pins; bounded Viewer reconnect resets consent and ends mic');
  await b.evaluate("qDisplay.style.width='1000px';qDisplay.style.height='600px';qViewer.configureDisplay({scale:true,resize:true});qViewer.flushResize()");
  await wait(()=>b.evaluate('qViewer.getStats().width===1000 && qViewer.getStats().height===600'));
  await b.evaluate("qViewer.configureDisplay({scale:true,resize:false});qDisplay.style.width='800px'");await delay(500);
  assert.equal(await b.evaluate('qViewer.getStats().width'),1000);
  pass('native remote resize converges and scale-only retains framebuffer size');
  await b.evaluate("window.qHidden=document.createElement('div');qHidden.style='width:700px;height:500px;display:none';document.body.append(qHidden);window.hiddenReady=false;window.hiddenAttach=qSession.attach(qHidden).then(v=>{window.hiddenViewer=v;hiddenReady=true})");
  await delay(500);assert(await b.evaluate('!hiddenReady || hiddenViewer.getStats().renderedFrames>0'));
  await b.evaluate("qHidden.style.display='block'");await b.evaluate('hiddenAttach');assert(await b.evaluate('hiddenViewer.getStats().renderedFrames>0'));await b.evaluate('hiddenViewer.dispose();qHidden.remove()');
  assert.equal((await api('/api/instances/'+first.id)).sessionGeneration,first.generation);
  pass('initially hidden attachment and reveal retain generation and real canvas paint');
  await api('/api/instances/'+first.id+'/restart',{sessionGeneration:first.generation});
  await wait(async()=>(await api('/api/instances/'+first.id)).sessionGeneration>first.generation,45000);
  await wait(()=>b.evaluate("qSession.state==='invalidated'"));
  assert.equal(await b.evaluate("(()=>{try{qViewer.sendText('stale');return ''}catch(e){return e.code}})()"),'input-unavailable');
  await assert.rejects(api('/api/instances/'+first.id+'/stop',{sessionGeneration:first.generation}),e=>e.status===409);
  assert.equal(remote(['cat',path]),'Lifecycle 中文 saved');
  await b.evaluate('qSession.release()');
  pass('explicit runtime replacement fences old Viewer input audio and generation-qualified stop');

  await api('/api/managed-instances/host-desktop',{desiredState:'running'},'PATCH');
  await b.evaluate("(async()=>{window.qManaged=await qHost.open({managedId:'host-desktop'});window.qManagedViewer=await qManaged.attach(qDisplay)})()");
  const desktop=await b.evaluate('({id:qManaged.id,generation:qManaged.generation})'),desktopServices=services(desktop.id),desktopManifest=record(desktop.id),accountBus=bus();
  owned.add(desktop.id);assert.equal(desktopManifest.runtime.homePath,'/home/rxhost');
  const driver=desktopServices.driver;assert(alive(driver));
  const injection=`import os,subprocess,json\nfrom pathlib import Path\nroot=Path('/home/rxhost/state/instances/${desktop.id}');s=json.loads((root/'session-services.json').read_text());driver=s['driver'];v=Path('/proc/'+str(driver['pid'])+'/stat').read_text().split(')')[-1].split();assert v[19]==driver['startTime'];cg=Path('/proc/'+str(driver['pid'])+'/cgroup').read_text().strip().split('::')[1]\ndef enter():\n Path('/sys/fs/cgroup'+cg+'/cgroup.procs').write_text(str(os.getpid()));os.setgroups([]);os.setgid(1004);os.setuid(1004)\nenv=dict(os.environ,HOME='/home/rxhost',DISPLAY=${JSON.stringify((await api('/api/instances/'+desktop.id)).display)},XAUTHORITY='/home/rxhost/.Xauthority',XDG_RUNTIME_DIR='/run/user/1004',DBUS_SESSION_BUS_ADDRESS='unix:path=/run/user/1004/bus')\np=subprocess.Popen(['mousepad','--disable-server'],env=env,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True,preexec_fn=enter);v=Path('/proc/'+str(p.pid)+'/stat').read_text().split(')')[-1].split();print(json.dumps({'pid':p.pid,'startTime':v[19],'cgroup':cg}))`;
  const editor=JSON.parse(remote(['python3','-c',injection]));await delay(1000);assert(alive(editor));
  remote(['kill','-KILL',String(driver.pid)]);
  await wait(async()=>{const i=await api('/api/instances/'+desktop.id);return i.sessionState==='failed' && i.recovery?.reason==='session-populated-or-unknown';},45000);
  assert(alive(editor));assert.equal((await api('/api/instances/'+desktop.id)).sessionGeneration,desktop.generation);assert.equal(bus(),accountBus);
  pass('unexpected managed Driver loss preserves live editor and blocks destructive replacement');
  assert(editor.cgroup.includes('remotexapp-'+desktop.id+'-session.service'));
  remote(['python3','-c',`from pathlib import Path;Path(${JSON.stringify('/sys/fs/cgroup'+editor.cgroup+'/cgroup.kill')}).write_text('1')`]);
  const recovered=await wait(async()=>{const i=await api('/api/instances/'+desktop.id);return i.sessionGeneration>desktop.generation && i.sessionState==='running' && i.applicationStatus?.state==='ready' && i;},110000);
  assert.deepEqual(record(desktop.id).components,desktopManifest.components);assert.equal(bus(),accountBus);
  await wait(()=>b.evaluate("qManaged.state==='invalidated'"));
  await b.evaluate("(async()=>{await qManaged.release();qManaged=await qHost.open({managedId:'host-desktop'});qManagedViewer=await qManaged.attach(qDisplay)})()");
  assert(await b.evaluate('qManagedViewer.getStats().renderedFrames>0'));
  pass('confirmed empty failed desktop self-recovers with pinned components and fresh painted generation');
  await api('/api/managed-instances/host-desktop',{desiredState:'stopped',force:true},'PATCH');
  const denied=await b.evaluate("qHost.open({managedId:'host-desktop'}).then(()=>'',e=>e.code)");assert.equal(denied,'managed-unavailable');
  await delay(1500);assert.equal((await api('/api/managed-instances/host-desktop')).desiredState,'stopped');assert.equal(bus(),accountBus);
  pass('explicit managed stop is durable and observation cannot revive it');
}catch(error){failure=error.stack;console.error(failure);checks.push({name:'suite',status:'failed',error:error.name});}
finally{
  await b.evaluate('qHost?.dispose()').catch(()=>{});await b.close();
  await api('/api/managed-instances/host-desktop',{desiredState:'stopped',force:true},'PATCH').catch(()=>{});
  for(const id of owned){const i=await api('/api/instances/'+id);if(i.state!=='stopped')await api('/api/instances/'+id+'/stop',{force:true,sessionGeneration:i.sessionGeneration});}
  writeFileSync(config.evidenceDirectory+'/host-lifecycle.json',JSON.stringify({schemaVersion:1,checks,status:failure?'failed':'passed',humanAcceptance:'not-evaluated'},null,2));
}
if(failure)process.exitCode=1;
