// Explicit post-deployment gate. Restarts the two LOCAL Managers, never existing
// Apps. Creates/stops only its own disposable Mousepad runtimes.
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {RemoteXAppManager} from '../../cmd/remotexappd/web/sdk/remotexapp-manager.js';
assert(process.argv.includes('--restart-local-managers'),'explicit local Manager restart flag required');
const exec=promisify(execFile),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const expectedVersion=(process.env.REMOTEXAPP_SVC_EXPECTED_VERSION||await readFile(new URL('../../VERSION',import.meta.url),'utf8')).trim();
const env={...process.env,XDG_RUNTIME_DIR:`/run/user/${process.getuid()}`,DBUS_SESSION_BUS_ADDRESS:`unix:path=/run/user/${process.getuid()}/bus`};
const work=await mkdtemp('/tmp/remotexapp-svc-deployment-check-'),results=[];
async function wait(fn,label,timeout=45000){const end=Date.now()+timeout;while(Date.now()<end){const v=await fn();if(v)return v;await sleep(100)}throw Error(label)}
for(const port of [2992,1991]){
 const baseURL=`http://127.0.0.1:${port}`,api=new RemoteXAppManager({baseURL});
 const unit=port===1991?'remotexapp.service':'remotexapp-test.service';
 const state=port===1991?join(process.env.HOME,'.local/state/remotexapp'):join(process.env.HOME,'.local/state/remotexapp-test/state');
 const profile=await mkdtemp('/tmp/remotexapp-svc-browser-');let child,ws,instance;
 try{
  assert.equal((await(await fetch(baseURL+'/api/version')).json()).version,expectedVersion);
  instance=await api.createInstance({templateId:'mousepad'});
  child=spawn('google-chrome',['--headless=new','--disable-background-networking','--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
  const cdpPort=await wait(async()=>{try{return Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0])}catch{return false}},'browser CDP not ready');
  const page=(await(await fetch(`http://127.0.0.1:${cdpPort}/json`)).json()).find(p=>p.type==='page');
  ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});let sequence=0;const pending=new Map();
  ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}};
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});assert(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value};
  await call('Page.navigate',{url:baseURL+instance.viewerUrl});
  await wait(()=>evaluate('window.remoteXApp?.client?.state === "connected" && document.querySelector("canvas")?.width>0'),'Viewer did not paint');
  const info=await api.getConnections(instance.id),xenv={...env,DISPLAY:info.environment.display,XAUTHORITY:info.environment.xauthorityPath};
  const canonical=await api.request(`/api/instances/${instance.id}/status/environment`,{method:'POST',body:{sessionGeneration:info.sessionGeneration}});
  assert.equal(canonical.environment.IBUS_ADDRESS,info.environment.ibus.address);assert.equal(canonical.environment.DBUS_SESSION_BUS_ADDRESS,info.environment.sessionBus.address);
  async function inputAndReadback(text){
   const window=(await exec('xdotool',['search','--onlyvisible','--class','mousepad'],{env:xenv,timeout:3000})).stdout.trim().split('\n')[0];
   await exec('xdotool',['windowactivate','--sync',window,'mousemove','--window',window,'100','100','click','1','key','--clearmodifiers','ctrl+a','BackSpace'],{env:xenv,timeout:5000});await sleep(200);
   const ack=await evaluate(`window.remoteXApp.client.sendText(${JSON.stringify(text)})`);assert.equal(ack.error,'');
   await wait(async()=>{try{
    await exec('xdotool',['key','--clearmodifiers','ctrl+a','ctrl+c'],{env:xenv,timeout:3000});
    return(await exec('xclip',['-selection','clipboard','-out','-target','UTF8_STRING'],{env:xenv,timeout:1000})).stdout===text;
   }catch{return false}},'actual remote Unicode/clipboard readback failed',5000);
  }
  await inputAndReadback('Core服务 before restart');
  const recordPath=join(state,'instances',instance.id,'session-services.json'),before=JSON.parse(await readFile(recordPath,'utf8'));
  await exec('systemctl',['--user','restart',unit],{env,timeout:45000});
  await wait(async()=>{try{return(await fetch(baseURL+'/readyz')).ok}catch{return false}},'Manager did not restart');
  await wait(async()=>await evaluate('window.remoteXApp.client.state === "connected"')&&(await api.getInstance(instance.id)).attachedClients>0,'Viewer did not reconnect',60000);
  const after=JSON.parse(await readFile(recordPath,'utf8'));assert.deepEqual(after,before);
  assert.equal((await api.getInstance(instance.id)).sessionGeneration,info.sessionGeneration);
  await inputAndReadback('Core服务 after restart');
  assert.equal((await api.getConnections(instance.id)).environment.ibus.address,info.environment.ibus.address);
  // Fail only a helper belonging to this newly created disposable App. Prove
  // raw input through the actual browser SDK/RFB path, not xdotool injection.
  const fault=port===1991?'ibus':'engine',identity=after.services[fault];
  const proc=await readFile(`/proc/${identity.pid}/stat`,'utf8');assert.equal(proc.slice(proc.lastIndexOf(')')+1).trim().split(/\s+/)[19],identity.startTime);
  process.kill(identity.pid,'SIGTERM');
  await wait(async()=>JSON.parse(await readFile(recordPath,'utf8')).state==='degraded','service fault not observed');
  const rejected=await evaluate("window.remoteXApp.client.sendText('MUST_NOT_APPEAR').then(()=>false,()=>true)");assert.equal(rejected,true);
  await exec('xdotool',['key','--clearmodifiers','ctrl+a','BackSpace'],{env:xenv,timeout:3000});
  await evaluate("(()=>{const c=window.remoteXApp.client;c.sendKey(120,'KeyX',true);c.sendKey(120,'KeyX',false);return true})()");
  await wait(async()=>{await exec('xdotool',['key','--clearmodifiers','ctrl+a','ctrl+c'],{env:xenv,timeout:3000});try{return(await exec('xclip',['-selection','clipboard','-out','-target','UTF8_STRING'],{env:xenv,timeout:1000})).stdout==='x'}catch{return false}},'SDK raw RFB key failed after input service loss',5000);
  await sleep(1000);assert.equal(await evaluate('window.remoteXApp.client.state'),'connected');
  assert.equal((await api.getInstance(instance.id)).sessionState,'running');
  const png=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(work,`viewer-${port}.png`),Buffer.from(png.data,'base64'));
  results.push({port,passed:true,checks:['served-SDK-framebuffer','getConnections-and-EXP007-final-environment','actual-Unicode-clipboard-readback-before-and-after','Manager-restart-attached-Viewer-reconnect','supervisor-Driver-service-identities-and-generation-unchanged',`${fault}-fault-rejects-Unicode-SDK-raw-RFB-key-readback-and-Viewer-survive`]});
 }finally{ws?.close();if(child&&child.exitCode===null)await new Promise(r=>{child.once('exit',r);child.kill('SIGTERM')});if(instance)await api.stopInstance(instance.id,{force:true})}
}
await writeFile(join(work,'result.json'),JSON.stringify({passed:true,results},null,2)+'\n');console.log(JSON.stringify({passed:true,work,results}));
