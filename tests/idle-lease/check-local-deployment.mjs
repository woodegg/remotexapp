// Explicit local UAT gate: creates/stops only its own temporary Mousepad Apps.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {RemoteXAppManager} from '../../cmd/remotexappd/web/sdk/remotexapp-manager.js';
assert(process.argv.includes('--local-deployment'),'explicit local test flag required');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const expected=(await readFile(new URL('../../VERSION',import.meta.url),'utf8')).trim();
const work=await mkdtemp('/tmp/remotexapp-lease-deployment-'),results=[];
async function wait(fn,label,timeout=45000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await sleep(100)}throw Error(label)}
// These Managers share a host/UID; serialize live X display allocation.
for(const port of [2992,1991]){
  const base=`http://127.0.0.1:${port}`,api=new RemoteXAppManager({baseURL:base});
  let child,ws,instance;
  const existingIDs=new Set((await api.listInstances()).map(item=>item.id));
  try{
    assert.equal((await api.getVersion()).version,expected);
    const created=await api.createInstance({templateId:'mousepad'});
    assert(!existingIDs.has(created.id),'test must not take ownership of an existing runtime');
    instance=created;
    const profile=await mkdtemp(join(work,`browser-${port}-`));
    child=spawn('google-chrome',['--headless=new','--disable-extensions','--disable-background-networking','--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
    let cdpPort;
    await wait(async()=>{try{cdpPort=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);return !!cdpPort}catch{return false}},'Chrome startup');
    const target=(await(await fetch(`http://127.0.0.1:${cdpPort}/json`)).json()).find(p=>p.type==='page');
    ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
    let serial=0;const pending=new Map();
    ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}};
    const command=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))});
    const evaluate=async expression=>{const r=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});assert(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value};
    await command('Page.navigate',{url:base+instance.viewerUrl});
    await wait(()=>evaluate('window.remoteXApp?.client?.state === "connected" && !!document.querySelector("canvas")?.width'),'Viewer');
    const checkbox=`document.querySelector(${JSON.stringify('[aria-label="Keep running while disconnected"]')})`;
    assert.equal(await evaluate(`${checkbox}.checked`),false);
    assert.equal(await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Coordinator');b?.click();return !!b})()`),true);
    await wait(()=>evaluate('document.querySelector(".coordinator-panel")?.innerText.includes("0 local handles")'),'passive Coordinator panel');
    await evaluate(`${checkbox}.click()`);
    await wait(()=>evaluate('document.body.innerText.includes("Keep running · attached")'),'attached lease receipt');
    await wait(()=>evaluate('document.querySelector(".coordinator-panel")?.innerText.includes("attached · no timed deadline")'),'panel attached receipt');
    await evaluate('window.remoteXApp.client.disconnect()');
    await wait(async()=>!(await api.getInstance(instance.id)).attachedClients,'RFB detached');
    await wait(()=>evaluate('document.body.innerText.includes("Keep until")'),'detached lease receipt');
    await wait(()=>evaluate('document.querySelector(".coordinator-panel")?.innerText.includes("renewed · server expiry")'),'panel detached deadline');
    const before=await api.getInstance(instance.id);
    await sleep(65000); // Shipped Mousepad timeout is 60 seconds.
    const after=await api.getInstance(instance.id);
    assert.equal(after.sessionState,'running');assert.equal(after.attachedClients,0);
    assert.equal(after.sessionGeneration,before.sessionGeneration);
    await evaluate(`${checkbox}.click()`);
    await wait(()=>evaluate('document.body.innerText.includes("Idle lease off")'),'release');
    await wait(()=>evaluate('document.querySelector(".coordinator-panel")?.innerText.includes("0 local handles")'),'panel released interest');
    const png=await command('Page.captureScreenshot',{format:'png'});
    await writeFile(join(work,`lease-${port}.png`),Buffer.from(png.data,'base64'));
    await evaluate(`document.querySelector('.coordinator-panel header button:last-child').click()`);
    assert.equal(await evaluate('document.querySelector(".coordinator-panel").hidden'),true);
    results.push({port,result:'passed',checks:['served-SDK-and-Viewer','default-off-Console-control','passive-Coordinator-panel','panel-attached-receipt','panel-detached-deadline','panel-released-interest','panel-close','attached-then-detached-receipts','disconnected-App-survives-60s-template-timeout','checkbox-release']});
  }finally{
    ws?.close();if(child&&child.exitCode===null)await new Promise(r=>{child.once('exit',r);child.kill('SIGTERM')});
    if(instance)await api.stopInstance(instance.id,{force:true});
  }
}
await writeFile(join(work,'result.json'),JSON.stringify({result:'passed',results},null,2));
console.log(JSON.stringify({result:'passed',work,results},null,2));
