// Read-only live Console check. Intercept only this isolated browser's assets
// with the current build; never replace deployed files or create real Apps.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const base=process.env.REMOTEXAPP_PANEL_TEST_URL || 'http://127.0.0.1:1991';
assert.equal(new URL(base).hostname,'127.0.0.1','local loopback only');
const assets=new URL('../../cmd/remotexappd/web/assets/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('manifest.json',assets),'utf8'));
const code={};
for(const key of ['console','sdk']) code[key]=await readFile(new URL(manifest[key],assets),'utf8');
const panelSource=await readFile(new URL('../../cmd/remotexappd/web/console-src/coordinator-panel.mjs',import.meta.url),'utf8');
code.panel=panelSource;
const panelURL=base+'/assets/test-panel.js';
const work=await mkdtemp('/tmp/remotexapp-coordinator-panel-');
const child=spawn('google-chrome',['--headless=new','--disable-extensions','--disable-background-networking','--no-first-run','--remote-debugging-port=0','--user-data-dir='+work,'about:blank'],{stdio:'ignore'});
const sockets=[];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function wait(fn,label,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await sleep(100)}throw Error(label)}
let fatal;
try {
  let port;
  await wait(async()=>{try{port=Number((await readFile(join(work,'DevToolsActivePort'),'utf8')).split('\n')[0]);return !!port}catch{return false}},'Chrome startup');
  async function connect(target){
    const ws=new WebSocket(target.webSocketDebuggerUrl);sockets.push(ws);
    await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
    let serial=0;const pending=new Map();
    const command=(method,params={})=>new Promise((resolve,reject)=>{
      const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},15000);
      pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));
    });
    ws.onmessage=event=>{
      const message=JSON.parse(event.data),entry=pending.get(message.id);
      if(entry){pending.delete(message.id);clearTimeout(entry.timer);message.error?entry.reject(Error(JSON.stringify(message.error))):entry.resolve(message.result)}
      if(message.method==='Fetch.requestPaused'){
        const {requestId,request}=message.params;
        const key=request.url===panelURL?'panel':/\/console-[^/]+\.js$/.test(request.url)?'console':/\/sdk-[^/]+\.js$/.test(request.url)?'sdk':null;
        const action=key?command('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/javascript'}],body:Buffer.from(code[key]).toString('base64')}):command('Fetch.continueRequest',{requestId});
        action.catch(error=>{fatal=error});
      }
    };
    const evaluate=async expression=>{
      if(fatal)throw fatal;
      const result=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
      assert(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));return result.result.value;
    };
    await command('Fetch.enable',{patterns:[{urlPattern:'*/assets/*',requestStage:'Request'}]});
    await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    await command('Page.navigate',{url:base+'/sdk/console.html'});
    await wait(()=>evaluate('!!window.remoteXApp'),'Console load');
    return {command,evaluate,target};
  }
  const targets=await(await fetch(`http://127.0.0.1:${port}/json`)).json();
  const first=await connect(targets.find(item=>item.type==='page'));
  assert.equal(await first.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Coordinator');b?.click();return !!b})()`),true);
  assert.match(await first.evaluate('document.querySelector(".coordinator-panel").innerText'),/0 local handles/);
  await first.evaluate(`document.querySelector('.coordinator-panel header button:last-child').click()`);
  const created=await first.command('Target.createTarget',{url:'about:blank'});
  const secondTarget=(await(await fetch(`http://127.0.0.1:${port}/json`)).json()).find(item=>item.id===created.targetId);
  const second=await connect(secondTarget);
  const scope='panel-test-'+crypto.randomUUID();
  for(const page of [first,second]) await page.evaluate(`(async()=>{
    const {RemoteXAppCoordinator,RemoteXAppManager}=await import(${JSON.stringify(base+'/assets/'+manifest.sdk)});
    const {createCoordinatorPanel}=await import(${JSON.stringify(panelURL)});
    const manager=new RemoteXAppManager({baseURL:${JSON.stringify(base)}});
    window.fixtureRenewals=0;
    manager.getInstance=async()=>({id:'fixture-app',sessionGeneration:1,state:'ready',sessionState:'running',attachedClients:0});
    manager.renewIdleLease=async()=>{window.fixtureRenewals++;return {instanceId:'fixture-app',sessionGeneration:1,outcome:'renewed',idleAction:'stop-instance',idleTimeoutMs:3000,serverTime:new Date().toISOString(),expiresAt:new Date(Date.now()+3000).toISOString()}};
    window.fixture=new RemoteXAppCoordinator({manager,scope:${JSON.stringify(scope)}});
    window.fixtureHandle=fixture.track('fixture-app',{sessionGeneration:1,keepAlive:true});
    window.fixturePanel=createCoordinatorPanel(()=>fixture);fixturePanel.open();
  })()`);
  await wait(async()=> (await first.evaluate('fixture.getDiagnostics().peers.length'))===1 && (await second.evaluate('fixture.getDiagnostics().peers.length'))===1,'cross-Tab peers');
  await wait(async()=> (await second.evaluate('fixture.getDiagnostics().runtimes[0]?.lease?.outcome'))==='renewed','follower receipt');
  const leader=(await first.evaluate('fixture.getDiagnostics().runtimes[0].isLeader'))?first:second;
  const follower=leader===first?second:first;
  await wait(()=>follower.evaluate(`document.querySelector('.coordinator-panel:last-of-type').innerText.includes('1 local / 1 remote')`),'panel interest counts');
  const before=await follower.evaluate('fixtureRenewals');
  await follower.command('Target.closeTarget',{targetId:leader.target.id});
  await wait(()=>follower.evaluate('fixture.getDiagnostics().runtimes[0].isLeader'),'leader takeover');
  await wait(()=>follower.evaluate(`fixtureRenewals > ${before}`),'renewals after takeover');
  await wait(()=>follower.evaluate(`document.querySelector('.coordinator-panel:last-of-type').innerText.includes('leader-changed')`),'event rendering');
  await wait(()=>follower.evaluate(`document.querySelector('.coordinator-panel:last-of-type').innerText.includes('This Tab ·')`),'panel leader refresh');
  const screenshot=await follower.command('Page.captureScreenshot',{format:'png'});
  await writeFile(join(work,'panel.png'),Buffer.from(screenshot.data,'base64'));
  await follower.evaluate('fixtureHandle.release();fixturePanel.close();fixture.destroy()');
  const result={result:'passed',assets:manifest,checks:['built-Console-button','empty-passive-panel','real-BroadcastChannel-two-Tabs','follower-lease-receipt','interest-counts','closed-leader-takeover','renewal-after-takeover','event-rendering','panel-close'],work};
  await writeFile(join(work,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
} finally {
  for(const ws of sockets)ws.close();
  if(child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM')});
}
