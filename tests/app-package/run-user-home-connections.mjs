import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile,cp,lstat,readdir,stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
process.umask(0o077);
const exec=promisify(execFile),delay=ms=>new Promise(r=>setTimeout(r,ms)),root=process.argv[2],work=join(homedir(),'test');
assert.equal(process.getuid(),Number(process.env.REMOTEXAPP_CONNECTIONS_DISPOSABLE_UID),'run through the disposable-UID wrapper');
assert(process.getuid()>0&&homedir().startsWith('/var/tmp/remotexapp-conn-user.')&&homedir()===join(root,'../home'),'refusing to change an existing user HOME');
const base='http://127.0.0.1:21994',token=randomBytes(32).toString('hex');
const state=join(work,'state'),apps=join(work,'apps'),enabled=join(work,'enabled'),legacy=join(work,'legacy');
let child,instance;
async function request(path,body,capability=false,method=body?'POST':'GET'){const response=await fetch(base+path,{method,signal:AbortSignal.timeout(45000),headers:{'Content-Type':'application/json',...(capability?{'X-RemoteXApp-Connections-Token':token}:{})},...(body?{body:JSON.stringify(body)}:{})});const result=await response.json();if(!response.ok)throw Object.assign(Error('API '+response.status),{status:response.status,response:result});return result;}
async function stopManager(){if(child&&child.exitCode===null)await new Promise(r=>{child.once('exit',r);child.kill('SIGTERM');});}
async function startManager(){child=spawn(join(root,'bin/remotexappd'),['-listen','127.0.0.1:21994','-auth-mode','none','-state-dir',state,'-class-config',legacy,'-app-package-root',apps,'-apps-enabled',enabled,'-connections-token-file',join(work,'token'),'-gateway-bin',join(root,'bin/novnc-input'),'-status-bin',join(root,'bin/remotexapp-status'),'-core-driver-dir',join(root,'drivers/common'),'-ibus-engine',join(root,'components/remote-unicode-engine/engine.py')],{stdio:['ignore','ignore','inherit']});for(let n=0;n<150;n++){try{if((await fetch(base+'/readyz')).ok)return;}catch{}if(child.exitCode!==null)throw Error('Manager exited');await delay(100);}throw Error('Manager timeout');}
async function activate(id){const ws=new WebSocket(base.replace('http:','ws:')+'/remotexapps/'+id+'/rfb-compat');await new Promise((r,j)=>{const t=setTimeout(()=>{ws.close();j(Error('activation timeout'));},45000);ws.addEventListener('open',()=>{clearTimeout(t);r()},{once:true});ws.addEventListener('error',()=>{clearTimeout(t);j(Error('activation failed'))},{once:true});});ws.close();for(let n=0;n<450;n++){const x=await request('/api/instances/'+id);if(x.applicationStatus?.state==='ready')return x;await delay(100);}throw Error('XFCE not ready');}
async function info(){const x=await request('/api/instances/'+instance);return request(`/api/instances/${instance}/connections?sessionGeneration=${x.sessionGeneration}`,null,true);}
async function verify(x){assert.equal(x.environment.sessionBus.scope,'user');assert.equal(x.environment.sessionBus.address,process.env.DBUS_SESSION_BUS_ADDRESS);assert.equal(x.environment.ibus.scope,'runtime');assert.notEqual(x.environment.ibus.address,x.environment.sessionBus.address);assert.equal(x.environment.xauthorityPath,join(homedir(),'.Xauthority'));assert.equal(x.application,undefined);await exec('gdbus',['call','--address',x.environment.ibus.address,'--dest','org.freedesktop.IBus','--object-path','/org/freedesktop/IBus','--method','org.freedesktop.IBus.ListEngines'],{timeout:5000});await exec('gdbus',['call','--address',x.environment.sessionBus.address,'--dest','org.freedesktop.DBus','--object-path','/org/freedesktop/DBus','--method','org.freedesktop.DBus.ListNames'],{timeout:5000});}
async function busID(){return (await exec('gdbus',['call','--session','--dest','org.freedesktop.DBus','--object-path','/org/freedesktop/DBus','--method','org.freedesktop.DBus.GetId'],{timeout:5000})).stdout;}
async function services(){return JSON.parse(await readFile(join(state,'instances',instance,'session-services.json'),'utf8'));}
async function wait(fn,label){for(let n=0;n<200;n++){const v=await fn();if(v)return v;await delay(100)}throw Error(label);}
async function verifyServedViewer(xenv,existingWindow,phaseName='initial') {
 const profile=join(work,'viewer-browser-'+phaseName);let browser,editor;
 const stopChild=async child=>{if(child&&child.exitCode===null&&child.signalCode===null)await new Promise(r=>{child.once('exit',r);child.kill('SIGTERM')})};
 try {
  browser=spawn('google-chrome',['--headless=new','--disable-background-networking','--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,base+'/remotexapps/'+instance+'/kiosk.html?diagnostics=on'],{stdio:'ignore'});
  const port=await wait(async()=>{try{return Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0])}catch{return false}},'XFCE Viewer browser not ready');
  const checkEnv={...process.env,VALIDATION_CDP_PORT:String(port),VALIDATION_INSTANCE_ID:instance,VALIDATION_EXPECT_RESIZE:'0',VALIDATION_TIMEOUT_MS:'45000'};
  const layout=JSON.parse((await exec('node',[join(root,'../check-browser-client.mjs')],{env:checkEnv,timeout:60000})).stdout);
  assert.equal(layout.finalState,'connected');
  assert.equal(layout.framebufferBefore.width,1280);assert.equal(layout.framebufferBefore.height,720);
  assert.equal(layout.framebufferAfter.width,1280);assert.equal(layout.framebufferAfter.height,720);
  if(!existingWindow)editor=spawn('mousepad',['--disable-server'],{env:xenv,stdio:'ignore'});
  const window=existingWindow||await wait(async()=>{try{return(await exec('xdotool',['search','--onlyvisible','--pid',String(editor.pid)],{env:xenv,timeout:2000})).stdout.trim().split('\n')[0]}catch{return false}},'XFCE test editor missing');
  const before=await services();
  for(const phase of ['before','after']) {
   if(phase==='after'){await stopManager();await startManager();assert.deepEqual(await services(),before)}
   await exec('xdotool',['windowactivate','--sync',window,'mousemove','--window',window,'100','100','click','1','key','--clearmodifiers','ctrl+a','BackSpace'],{env:xenv,timeout:5000});await delay(200);
   const text='XFCE 中文 service test '+phase;
   const result=JSON.parse((await exec('node',[join(root,'../check-sdk-lifecycle.mjs')],{env:{...checkEnv,VALIDATION_TEXT:text},timeout:60000})).stdout);
   assert.equal(result.textAck.error,'');assert.equal(result.finalState,'connected');
   await wait(async()=>{await exec('xdotool',['key','--clearmodifiers','ctrl+a','ctrl+c'],{env:xenv,timeout:3000});try{return(await exec('xclip',['-selection','clipboard','-out','-target','UTF8_STRING'],{env:xenv,timeout:1000})).stdout===text}catch{return false}},'XFCE served-SDK Unicode/clipboard readback failed');
  }
  await writeFile(join(work,phaseName==='initial'?'served-viewer.json':'saved-session-viewer.json'),JSON.stringify({passed:true,phase:phaseName,layout,checks:['fixed-framebuffer-Viewer-reconnect','served-SDK-Unicode-clipboard-readback-before-after-Manager-restart','supervisor-and-service-identities-preserved']}));
 }finally{await stopChild(editor);await stopChild(browser)}
}

async function processEnvironment(pid) {
 const directory=join('/proc',String(pid));
 assert.equal((await stat(directory)).uid,process.getuid(),'fixture process belongs to another UID');
 return Object.fromEntries((await readFile(join(directory,'environ'),'utf8')).split('\0').filter(v=>v.includes('=')).map(v=>[v.slice(0,v.indexOf('=')),v.slice(v.indexOf('=')+1)]));
}

async function verifySingleInputGeneration() {
 const record=await services();assert.equal(record.state,'ready');assert.equal(record.borrowedBus,true);
 assert.deepEqual(Object.keys(record.services).sort(),['engine','ibus']);
 const processes={ibus:[],engine:[]};
 for(const entry of await readdir('/proc')) {
  if(!/^\d+$/.test(entry))continue;
  let command,args;
  try {
   if((await stat('/proc/'+entry)).uid!==process.getuid())continue;
   const fields=(await readFile('/proc/'+entry+'/stat','utf8')).split(') ').at(-1).split(' ');
   if(['Z','X'].includes(fields[0]))continue;
   command=(await readFile('/proc/'+entry+'/comm','utf8')).trim();
   args=(await readFile('/proc/'+entry+'/cmdline','utf8')).split('\0');
  }catch(error){if(error.code==='ENOENT'||error.code==='ESRCH')continue;throw error}
  if(command==='ibus-daemon')processes.ibus.push(Number(entry));
  // Manager also carries an --ibus-engine PATH option; that is configuration,
  // not an engine process. Match the actual Python interpreter/script argv.
  if(/^python3(?:\.\d+)?$/.test(command)&&args[1]?.endsWith('/remote-unicode-engine/engine.py'))processes.engine.push(Number(entry));
 }
 const group=await readFile('/proc/'+record.supervisor.pid+'/cgroup','utf8');
 for(const kind of ['ibus','engine']) {
  assert.deepEqual(processes[kind],[record.services[kind].pid],kind+' duplicate or missing after XFCE restore');
  assert.equal(await readFile('/proc/'+processes[kind][0]+'/cgroup','utf8'),group);
  const fields=(await readFile('/proc/'+processes[kind][0]+'/stat','utf8')).split(') ').at(-1).split(' ');
  assert.equal(fields[19],record.services[kind].startTime);
 }
 return record;
}

async function verifySavedSession(xenv,originalBus) {
 // The canonical Driver starts before XFCE creates its XSMP address. Obtain
 // only SESSION_MANAGER from a validated fixture panel, not from the real user.
 const panels=(await exec('pgrep',['-u',String(process.getuid()),'-x','xfce4-panel'])).stdout.trim().split('\n');
 let sessionManager;
 for(const pid of panels){const env=await processEnvironment(pid);if(env.DISPLAY===xenv.DISPLAY)sessionManager=env.SESSION_MANAGER}
 assert(sessionManager,'XFCE panel has no session-manager address');
 for(const [property,value] of [['/general/SaveOnExit','true'],['/general/PromptOnLogout','false']]) {
  await exec('xfconf-query',['-c','xfce4-session','-p',property,'-n','-t','bool','-s',value],{env:xenv,timeout:5000});
 }
 const document=join(work,'saved-session-document.txt'),contents='XFCE saved session fixture\n';
 await writeFile(document,contents);
 // XFCE Terminal is an actual XSMP client. Its saved command reopens the
 // document in Mousepad; do not manufacture a saved-session file or relaunch
 // either application from the test after login.
 const terminal=spawn('xfce4-terminal',['--disable-server','--title=SVC saved session fixture','--dynamic-title-mode=none','--execute','mousepad','--disable-server',document],{env:{...xenv,SESSION_MANAGER:sessionManager},stdio:['ignore','ignore','inherit']});
 const findWindow=async()=>{try{return(await exec('xdotool',['search','--onlyvisible','--name','saved-session-document.txt'],{env:xenv,timeout:2000})).stdout.trim().split('\n')[0]}catch{return false}};
 const window=await wait(findWindow,'saved-session editor not visible');
 const editorPID=Number((await exec('xdotool',['getwindowpid',window],{env:xenv,timeout:2000})).stdout.trim());
 const before=await verifySingleInputGeneration();
 await exec('xfce4-session-logout',['--logout'],{env:xenv,timeout:5000});
 await wait(async()=> (await request('/api/instances/'+instance)).sessionState==='stopped','saved XFCE logout did not stop session');
 assert.equal((await request('/api/instances/'+instance)).state,'server-ready');
 await wait(async()=>terminal.exitCode!==null||terminal.signalCode!==null,'saved-session terminal survived logout');
 await wait(async()=>{try{const fields=(await readFile('/proc/'+editorPID+'/stat','utf8')).split(') ').at(-1).split(' ');return ['Z','X'].includes(fields[0])}catch(error){if(error.code==='ENOENT')return true;throw error}},'saved-session editor survived logout');
 assert.equal(await busID(),originalBus);
 const cache=join(xenv.XDG_CACHE_HOME||join(homedir(),'.cache'),'sessions');
 const saved=[];
 for(const file of await readdir(cache)) {
  const path=join(cache,file);if(!(await stat(path)).isFile())continue;
  const content=await readFile(path,'utf8');
  if(content.includes('xfce4-terminal')&&content.includes(document))saved.push({name:file,sha256:createHash('sha256').update(content).digest('hex')});
 }
 assert(saved.length,'XFCE did not save the real terminal/document restart command');
 await activate(instance);const restored=await info();await verify(restored);
 assert(restored.sessionGeneration>before.generation);
 const restoredWindow=await wait(findWindow,'XFCE did not restore the saved document window');
 const restoredPID=Number((await exec('xdotool',['getwindowpid',restoredWindow],{env:xenv,timeout:2000})).stdout.trim());
 assert.notEqual(restoredPID,editorPID);
 const env=await processEnvironment(restoredPID);
 for(const key of ['HOME','XAUTHORITY','DBUS_SESSION_BUS_ADDRESS','IBUS_ADDRESS','GTK_IM_MODULE','QT_IM_MODULE','XMODIFIERS'])assert.equal(env[key],xenv[key],key+' lost during saved-session restore');
 assert.equal(env.DISPLAY.replace(/\.0$/,''),xenv.DISPLAY.replace(/\.0$/,''));
 assert.equal(env.REMOTEXAPP_SESSION_GENERATION,String(restored.sessionGeneration));
 const after=await verifySingleInputGeneration();assert.equal(after.generation,restored.sessionGeneration);
 for(const kind of ['ibus','engine'])assert.notDeepEqual(after.services[kind],before.services[kind]);
 await exec('xdotool',['windowactivate','--sync',restoredWindow,'mousemove','--window',restoredWindow,'100','100','click','1','key','--clearmodifiers','ctrl+a','ctrl+c'],{env:xenv,timeout:5000});
 await wait(async()=>{try{return(await exec('xclip',['-selection','clipboard','-out','-target','UTF8_STRING'],{env:xenv,timeout:1000})).stdout===contents}catch{return false}},'restored document content differs');
 await verifyServedViewer(xenv,restoredWindow,'saved-session');
 assert.deepEqual(await verifySingleInputGeneration(),after);
 assert.equal(await busID(),originalBus);
 // Viewer input intentionally modified only this disposable document buffer;
 // restore its saved contents so a later logout does not leave an unsaved dialog.
 await exec('xdotool',['windowactivate','--sync',restoredWindow,'key','--clearmodifiers','ctrl+a','BackSpace','type','--clearmodifiers',contents,'key','--clearmodifiers','ctrl+s'],{env:xenv,timeout:5000});
 await wait(async()=>await readFile(document,'utf8')===contents,'fixture reset was not saved');
 await writeFile(join(work,'saved-session.json'),JSON.stringify({passed:true,checks:['real-XSMP-save-and-restore-without-test-relaunch','restored-document-content-and-final-input-environment','one-current-generation-IBus-and-engine-no-autostart-takeover','served-SDK-Unicode-clipboard-readback-Manager-adoption-after-restore','borrowed-account-bus-survives-logout-and-restoration'],saved,oldEditorPID:editorPID,restoredEditorPID:restoredPID,before,after}));
 return restored;
}
try {
 let busy=false;try{busy=(await fetch(base+'/readyz')).ok}catch{}assert(!busy,'21994 occupied');
 for(const p of [state,apps,enabled,legacy])await mkdir(p,{recursive:true});await writeFile(join(work,'token'),token+'\n',{mode:0o600});
 // Exact shipped driver/policy except explicit display/port relocation; :1 is
 // occupied by the real user's desktop and is never stopped for this test.
 const fixture=join(work,'xfce');await cp(join(root,'apps/xfce-user-desktop'),fixture,{recursive:true});
 const manifest=JSON.parse(await readFile(join(fixture,'manifest.json'),'utf8'));
 const ports=(await exec('ss',['-ltnH'])).stdout;
 let display;
 for(let n=90;n<100;n++){try{await lstat('/tmp/.X11-unix/X'+n);continue;}catch{}if(!ports.includes(':'+(5900+n)+' ')&&!ports.includes(':'+(39000+n)+' ')){display=n;break;}}
 assert(display);Object.assign(manifest.server,{display,rfbPort:5900+display,gatewayPort:39000+display});await writeFile(join(fixture,'manifest.json'),JSON.stringify(manifest));
 const archive=(await exec(join(root,'scripts/package-app.sh'),[fixture,join(work,'artifacts')])).stdout.trim();const sha=createHash('sha256').update(await readFile(archive)).digest('hex');
 await exec(join(root,'scripts/install-app.sh'),['--archive',archive,'--sha256',sha,'--package-root',apps,'--enabled-root',enabled]);
 const originalBus=await busID();
 await startManager();const managed=await request('/api/managed-instances',{id:'test-desktop',templateId:'xfce-user-desktop',desiredState:'running'});instance=managed.runtime.id;await activate(instance);
 const first=await info();await verify(first);await stopManager();await startManager();const adopted=await info();assert.equal(adopted.revision,first.revision);await verify(adopted);
 const initialServices=await services();assert.equal(initialServices.borrowedBus,true);assert.equal(initialServices.services.dbus,undefined);
 const appenv=await request('/api/instances/'+instance+'/status/environment',{sessionGeneration:adopted.sessionGeneration});
 assert.equal(appenv.environment.DBUS_SESSION_BUS_ADDRESS,adopted.environment.sessionBus.address);assert.equal(appenv.environment.IBUS_ADDRESS,adopted.environment.ibus.address);assert.equal(appenv.environment.HOME,homedir());
 const xenv={...process.env,...appenv.environment};
 // The Viewer prelude terminates its disposable unsaved editor. Disable only
 // Mousepad's independent crash-backup restoration in this fresh test HOME;
 // otherwise its recovery dialog hides the saved XFCE command's document.
 await exec('gsettings',['set','org.xfce.mousepad.preferences.file','session-restore','never'],{env:xenv,timeout:5000});
 await verifyServedViewer(xenv);
 await exec('xfconf-query',['-c','svc-e2e','-p','/preserved','-n','-t','string','-s','fixture'],{env:xenv,timeout:5000});
 assert.equal((await exec('xfconf-query',['-c','svc-e2e','-p','/preserved'],{env:xenv,timeout:5000})).stdout.trim(),'fixture');
 await exec('gdbus',['call','--session','--dest','org.freedesktop.DBus','--object-path','/org/freedesktop/DBus','--method','org.freedesktop.DBus.StartServiceByName','org.xfce.FileManager','0'],{env:xenv,timeout:5000});
 await exec('gdbus',['call','--session','--dest','org.freedesktop.FileManager1','--object-path','/org/freedesktop/FileManager1','--method','org.freedesktop.FileManager1.ShowFolders',`['file://${homedir()}']`,"''"],{env:xenv,timeout:5000});
 await exec('xdotool',['search','--sync','--onlyvisible','--class','Thunar'],{env:xenv,timeout:5000});
 await exec('thunar',['--quit'],{env:xenv,timeout:5000});
 await exec('xfce4-session-logout',['--logout','--fast'],{env:xenv,timeout:5000});
 await wait(async()=> (await request('/api/instances/'+instance)).sessionState==='stopped','XFCE logout did not stop session');
 assert.equal((await request('/api/instances/'+instance)).state,'server-ready');assert.equal(await busID(),originalBus);
 await activate(instance);const relogged=await info();assert(relogged.sessionGeneration>first.sessionGeneration);await verify(relogged);
 assert.equal((await exec('xfconf-query',['-c','svc-e2e','-p','/preserved'],{env:{...xenv,IBUS_ADDRESS:relogged.environment.ibus.address},timeout:5000})).stdout.trim(),'fixture');
 const restored=await verifySavedSession(xenv,originalBus);
 await request('/api/instances/'+instance+'/restart',{sessionGeneration:restored.sessionGeneration,force:true});await activate(instance);const restarted=await info();assert(restarted.sessionGeneration>restored.sessionGeneration);await verify(restarted);
 const launch=JSON.parse(await readFile(join(state,'instances',instance,'session-ibus-identity.json'),'utf8'));assert.equal(launch.generation,restarted.sessionGeneration);process.kill(launch.pid,'SIGTERM');
 const faultProbeStatuses=[],faultStarted=performance.now();let dead;
 for(let n=0;n<50;n++) {
  try{dead=await info();faultProbeStatuses.push(200);if(dead.unavailableReasons?.ibus==='not-running')break}
  catch(error){if(error.status!==409)throw error;faultProbeStatuses.push(409)}
  // A process dying between identity reads can produce a fail-closed 409.
  // Require the stable degraded descriptor within the same bounded deadline;
  // never accept an App restart or a permanent 409 as successful degradation.
  const current=await request('/api/instances/'+instance);assert.equal(current.sessionGeneration,restarted.sessionGeneration);assert.equal(current.sessionState,'running');
  await delay(100);
 }
 assert.equal(dead?.unavailableReasons?.ibus,'not-running');assert.equal(dead.environment.ibus,undefined);
 const faultElapsedMs=performance.now()-faultStarted;assert(faultElapsedMs<5000,'IBus degradation exceeded five seconds');
 const degraded=await request('/api/instances/'+instance);assert.equal(degraded.sessionGeneration,restarted.sessionGeneration);assert.equal(degraded.sessionState,'running');
 assert.equal(await busID(),originalBus);
 const sessionUnit=`remotexapp-${instance}-session.service`;
 await exec('systemctl',['--user','stop',sessionUnit],{timeout:15000});
 await wait(async()=> (await request('/api/instances/'+instance)).sessionState==='failed','externally stopped XFCE session was not classified');
 const failed=await request('/api/instances/'+instance);
 assert.equal(failed.state,'server-ready');
 assert.equal(failed.attachedClients,0);
 await activate(instance);
 const recovered=await request('/api/instances/'+instance);
 assert(recovered.sessionGeneration>failed.sessionGeneration);
 assert.equal(recovered.sessionState,'running');
 assert.equal(recovered.sessionRecovery?.attempts,1);
 assert.equal(await busID(),originalBus);
 await stopManager();await startManager();
 const adoptedRecovery=await request('/api/instances/'+instance);
 assert.equal(adoptedRecovery.sessionGeneration,recovered.sessionGeneration);
 assert.equal(adoptedRecovery.sessionRecovery?.attempts,1,'Manager restart reset the bounded recovery counter');
 const readinessPID=Number((await readFile(join(state,'instances',instance,'xfce.pid'),'utf8')).trim());
 process.kill(readinessPID,'SIGKILL');
 const blocked=await wait(async()=>{const current=await request('/api/instances/'+instance);return current.sessionState==='failed'?current:false},'dead XFCE leader was not detected promptly');
 assert.equal(blocked.sessionGeneration,recovered.sessionGeneration);
 await wait(async()=> (await request('/api/managed-instances/test-desktop')).observedState==='failed',
  'managed failure was not reconciled after the session exit');
 assert.equal(await busID(),originalBus);
 let leaderExitPath;
 if (/other processes remain/.test(blocked.error)) {
  leaderExitPath='populated-preserved';
  assert.equal((await exec('systemctl',['--user','is-active',sessionUnit],{timeout:5000})).stdout.trim(),'active');
 } else {
  leaderExitPath='empty-on-attach-recovered';
  assert.match(blocked.error,/application session terminated unexpectedly/);
  await wait(async()=>{try{await exec('systemctl',['--user','is-active','--quiet',sessionUnit],{timeout:5000});return false}catch{return true}},'dead session component remained active');
  await activate(instance);
  const secondRecovery=await request('/api/instances/'+instance);
  assert(secondRecovery.sessionGeneration>blocked.sessionGeneration);
  assert.equal(secondRecovery.sessionRecovery?.attempts,2);
  assert.equal(await busID(),originalBus);
 }
 console.log(JSON.stringify({passed:true,uid:process.getuid(),display,checks:['real-shipped-XFCE-driver-disposable-UID-relocated-fixed-display','default-user-dbus-distinct-runtime-ibus-protocol-query','default-Xauthority','Manager-adoption-stable-descriptor','EXP007-final-HOME-and-input-environment','real-served-Viewer-fixed-framebuffer-reconnect-Unicode-clipboard-before-after-Manager-restart','Xfconf-persistence-Thunar-activation-visible-window','natural-XFCE-logout-stop-session-VNC-retained-and-relogin','saved-XFCE-session-restores-real-document-window-without-test-relaunch','restored-App-environment-current-generation-single-IBus-engine-and-Viewer-readback','borrowed-account-bus-identity-preserved-no-owned-bus','ordinary-restart-new-generation-IBus','dead-IBus-explicit-unavailability','empty-session-on-attach-recovery-with-generation-and-attempt-fence','recovery-counter-persists-across-Manager-restart','leader-death-generation-fenced-failure-and-safe-next-step'],leaderExitPath,faultProbeStatuses,faultElapsedMs,productionDesktopTouched:false}));
} finally {if(instance)try{await request('/api/managed-instances/test-desktop',{desiredState:'stopped',force:true},false,'PATCH');}catch{}await stopManager();}
