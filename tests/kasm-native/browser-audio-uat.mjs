// Owned Chrome + intercepted HTTPS fixtures. No real Manager, remote audio or hardware.
// Usage: node tests/kasm-native/browser-audio-uat.mjs /absolute/private/output-directory
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {isAbsolute, join} from 'node:path';

const output = process.argv[2];
if (!output || !isAbsolute(output)) throw Error('Supply an absolute evidence directory outside the repository');
await mkdir(output, {recursive:true,mode:0o700});
const html = await readFile(new URL('./uat.html', import.meta.url),'utf8');
const profile = await mkdtemp(join(tmpdir(),'remotexapp-audio-browser-'));
const browser = spawn(process.env.CHROME_BIN || 'google-chrome', [
  '--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking',
  '--no-first-run','--no-default-browser-check','--use-fake-device-for-media-stream',
  '--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+profile,'about:blank'
], {stdio:'ignore'});
const delay = ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn, timeout=10000) {
  const end=Date.now()+timeout;
  while(Date.now()<end){const value=await fn();if(value)return value;await delay(100);}
  throw Error('condition timed out');
}
let ws, call, cdp;
const checks=[], errors=[], requests=[];
const check=(name,condition)=>{assert.ok(condition,name);checks.push(name);};
try {
  const port=await wait(async()=>{try{return (await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];}catch{return false;}},20000);
  cdp='http://127.0.0.1:'+port;
  const page=await fetch(cdp+'/json/new?about:blank',{method:'PUT'}).then(r=>r.json());
  ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((yes,no)=>{ws.onopen=yes;ws.onerror=no;});
  let serial=0;const pending=new Map(), handlers=new Map();
  call=(method,params={})=>new Promise((yes,no)=>{
    const id=++serial,timer=setTimeout(()=>{pending.delete(id);no(Error(method+' timed out'));},20000);
    pending.set(id,{yes,no,timer});ws.send(JSON.stringify({id,method,params}));
  });
  ws.onmessage=({data})=>{
    const m=JSON.parse(data);
    if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.no(Error(m.error.message)):p.yes(m.result);}
    else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
    else if(handlers.has(m.method))handlers.get(m.method)(m.params).catch(e=>errors.push(e.message));
  };
  const evaluate=async expression=>{
    const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
    return r.result.value;
  };
  const click=async selector=>{
    const r=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...r});
    await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...r});
  };
  const shot=async name=>{const r=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(output,name+'.png'),Buffer.from(r.data,'base64'));};
  await call('Page.enable');await call('Runtime.enable');
  const origin='https://uat-audio.invalid';
  await call('Browser.setPermission',{permission:{name:'microphone'},setting:'granted',origin});
  await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:output});
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`
    if (window === window.top) {
      window.__streams=[];window.__contexts=[];
      const Context=AudioContext;
      window.AudioContext=class extends Context{constructor(...args){super(...args);window.__contexts.push(this);}};
      window.__getUserMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia=async constraints=>{const stream=await window.__getUserMedia(constraints);window.__streams.push(stream);return stream;};
      const create=URL.createObjectURL.bind(URL);
      URL.createObjectURL=blob=>{blob.text().then(text=>window.__export=JSON.parse(text));return create(blob);};
    }
  `});
  let failDesktop=false, holdDesktop=false, releaseDesktop, simulatedAudio=false;
  const runtime=id=>({id,viewerUrl:'/viewer/'+id,sessionGeneration:1,displayComponentDigest:'fixture-component',versions:{current:{core:'fixture-core'}},applicationStatus:{state:'ready'}});
  const viewer=id=>`<!doctype html><style>body{margin:0;background:#ecf2f5;color:#253441;font:14px system-ui}header{padding:10px;background:#1e3146;color:white}main{padding:26px}textarea{box-sizing:border-box;width:100%;height:180px;padding:12px;font:14px system-ui}</style><header><strong>Fixture Viewer</strong> <span id="status">Ready · WSS</span></header><main><h2>${id==='editor'?'Mousepad':'Test desktop'}</h2><p>SIMULATED VIEWER · Browser fixture only</p><textarea aria-label="fixture document">Audio UAT layout check\nNo remote backend or real audio session.</textarea></main><script>window.remoteXAppViewerStats=()=>({state:'ready',available:true,transport:'wss',connectionEpoch:1,observedAt:performance.now(),width:1280,height:720,connectedForMs:performance.now(),receivedBytes:24000,sentBytes:2000,udpReceivedBytes:0,renderedFrames:10,bufferedBytes:0,latency:{udp:{state:'inactive'},wss:{state:'ready',rttMs:24}},udpLoss:{state:'inactive'}});</script>`;
  handlers.set('Fetch.requestPaused',async e=>{
    const url=new URL(e.request.url);requests.push({path:url.pathname,method:e.request.method});
    let body='',type='application/json',code=200;
    if(url.origin!==origin)code=404;
    else if(url.pathname==='/'){body=html;type='text/html; charset=utf-8';}
    else if(url.pathname==='/rx/sdk/remotexapp-audio.js'&&simulatedAudio){body='export class RemoteXAppAudio extends EventTarget { constructor(){super();window.fixtureAudio=this;this.ready=Promise.resolve();} dispose(){} }';type='text/javascript; charset=utf-8';}
    else if(url.pathname==='/fixture-config')body=JSON.stringify({baseURL:'/rx',templateId:'mousepad',documentFile:'/fixture/document.txt',managedId:'desktop-fixture'});
    else if(url.pathname==='/rx/api/instances'&&e.request.method==='POST')body=JSON.stringify(runtime('editor'));
    else if(url.pathname.startsWith('/rx/api/managed-instances/')){if(holdDesktop)await new Promise(r=>releaseDesktop=r);body=JSON.stringify(failDesktop?{error:'fixture failure'}:{runtime:runtime('desktop')});if(failDesktop)code=503;}
    else if(url.pathname.startsWith('/rx/api/instances/'))body=JSON.stringify(runtime(url.pathname.split('/').at(-1)));
    else if(url.pathname.startsWith('/rx/viewer/')){body=viewer(url.pathname.split('/').at(-1));type='text/html; charset=utf-8';}
    else code=404;
    await call('Fetch.fulfillRequest',{requestId:e.requestId,responseCode:code,responseHeaders:[{name:'Content-Type',value:type}],body:Buffer.from(body).toString('base64')});
  });
  await call('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:origin+'/'});
  await wait(()=>evaluate('!!document.querySelector("#launch-mousepad")&&!document.querySelector("#launch-mousepad").disabled'));
  check('no audio capture/context before explicit click',await evaluate('__streams.length===0&&__contexts.length===0'));
  await click('#launch-mousepad');
  await wait(()=>evaluate('document.querySelector("#connection-summary").textContent.includes("2 / 2")'));
  await evaluate('window.__a=document.querySelector("#slot-a iframe");window.__b=document.querySelector("#slot-b iframe")');
  await click('#toggle-audio');
  check('initial same runtime shown',await evaluate('document.querySelector("#audio-topology").textContent.includes("同一会话")'));
  await click('#audio-separate');
  await wait(()=>evaluate('document.querySelector("#audio-topology").textContent.includes("两个不同会话")'));
  check('B-only switch preserves A iframe',await evaluate('__a===document.querySelector("#slot-a iframe")&&__b!==document.querySelector("#slot-b iframe")'));
  await click('[data-layout="b"]');await click('#dispose-b');await click('#recreate-b');
  check('recreated B uses its independent target',await evaluate('document.querySelector("#slot-b iframe").src.endsWith("/desktop")'));
  await click('#audio-same');
  check('return to same runtime preserves A',await evaluate('__a===document.querySelector("#slot-a iframe")&&document.querySelector("#slot-b iframe").src.endsWith("/editor")'));
  failDesktop=true;await click('#audio-separate');
  await wait(()=>evaluate('document.querySelector("#status").textContent.includes("失败")'));
  check('failed selection preserves both prior targets',await evaluate('document.querySelector("#slot-b iframe").src.endsWith("/editor")&&__a===document.querySelector("#slot-a iframe")'));
  failDesktop=false;holdDesktop=true;
  await click('#audio-separate');await wait(()=>!!releaseDesktop);await click('#dispose-b');
  releaseDesktop();holdDesktop=false;await wait(()=>evaluate('!document.querySelector("#audio-separate").disabled'));
  check('late session selection cannot reopen an explicitly closed B',await evaluate('!document.querySelector("#slot-b iframe")&&__a===document.querySelector("#slot-a iframe")'));
  await click('#recreate-b');
  check('cancelled selection retains previous B target',await evaluate('document.querySelector("#slot-b iframe").src.endsWith("/editor")'));
  await click('#audio-tone');await wait(()=>evaluate('!document.querySelector("#audio-heard").disabled'));
  check('tone completion requires human observation',await evaluate('document.querySelector("#audio-tone-status").textContent.includes("请确认")'));
  await click('#audio-heard');await click('#audio-export');await wait(()=>evaluate('!!window.__export'));
  check('explicit heard selection exported',await evaluate('__export.localDevices.speaker.observation==="heard"'));
  check('all remote cases remain unexecuted',await evaluate('__export.remoteAudio.available===false&&__export.remoteAudio.cases.length===8&&__export.remoteAudio.cases.every(c=>c.result==="not-run")'));
  check('export excludes private fields',await evaluate('!/(deviceId|groupId|viewerUrl|documentFile|token|credential|samples)/i.test(JSON.stringify(__export))'));
  await click('#audio-mic');await wait(()=>evaluate('document.querySelector("#audio-mic-status").textContent.includes("正在本机")'));
  await wait(()=>evaluate('document.querySelector("#audio-level").value>0'));
  check('synthetic microphone drives local RMS meter',await evaluate('__streams.some(s=>s.getTracks().some(t=>t.readyState==="live"))'));
  await click('#toggle-tools');
  check('switching to input tools releases tracks',await evaluate('__streams.every(s=>s.getTracks().every(t=>t.readyState==="ended"))&&document.querySelector("#audio-tools").hidden'));
  await wait(()=>evaluate('__contexts.every(c=>c.state==="closed")'));
  check('contexts close after cancellation',true);
  await click('#toggle-audio');
  await call('Browser.setPermission',{permission:{name:'microphone'},setting:'denied',origin});
  await click('#audio-mic');await wait(()=>evaluate('document.querySelector("#audio-mic-status").textContent.includes("拒绝")'));
  check('permission denied visibly without capture',await evaluate('__streams.every(s=>s.getTracks().every(t=>t.readyState==="ended"))'));
  await call('Browser.setPermission',{permission:{name:'microphone'},setting:'granted',origin});
  await evaluate('navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>window.__late=resolve)');
  await click('#audio-mic');await click('#audio-mic-stop');
  await evaluate('(async()=>{window.__lateStream=await __getUserMedia({audio:true});__late(__lateStream);})()');
  await wait(()=>evaluate('__lateStream.getTracks().every(t=>t.readyState==="ended")'));
  check('late permission after UI cancel releases stream',true);
  await evaluate('navigator.mediaDevices.getUserMedia=async c=>{const s=await __getUserMedia(c);__streams.push(s);return s;}');
  await click('#audio-mic');await wait(()=>evaluate('document.querySelector("#audio-mic-status").textContent.includes("正在本机")'));
  // A real foreground tab change exercises visibility cleanup, not a fabricated event.
  const other=await fetch(cdp+'/json/new?about:blank',{method:'PUT'}).then(r=>r.json());
  await wait(()=>evaluate('document.hidden'));
  await wait(()=>evaluate('__streams.every(s=>s.getTracks().every(t=>t.readyState==="ended"))'));
  check('real tab hiding stops local capture',true);
  await fetch(cdp+'/json/close/'+other.id);await call('Page.bringToFront');
  await click('[data-layout="a"]');
  for(const [width,height] of [[1920,1080],[1440,900],[1366,768],[1024,640],[900,700],[800,600],[768,1024],[390,844]]){
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await delay(100);
    const g=await evaluate(`(()=>{const bounds=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};};return {surface:bounds('#slot-a'),stats:bounds('.connections'),audio:bounds('#audio-tools'),scroll:document.documentElement.scrollHeight,client:innerHeight,width:document.documentElement.scrollWidth};})()`);
    if(g.surface.w<150||g.surface.h<150)console.error(JSON.stringify({width,height,...g}));
    check(`audio drawer retains remote surface ${width}x${height}`,g.surface.w>=150&&g.surface.h>=150);
    check(`stats remain inside viewport ${width}x${height}`,g.stats.bottom<=height&&g.stats.right<=width&&g.stats.h>=180);
    check(`audio drawer causes no outer scroll ${width}x${height}`,g.scroll<=height&&g.width<=width&&g.audio.bottom<=height);
    if(width===390)await shot('audio-uat-mobile');
  }
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await click('#audio-separate');await wait(()=>evaluate('document.querySelector("#audio-topology").textContent.includes("两个不同会话")'));
  await click('[data-layout="split"]');await click('#fullscreen');
  check('fullscreen retains audio and stats',await evaluate('document.fullscreenElement?.id==="workbench"&&!document.querySelector("#audio-tools").hidden'));
  check('layout and fullscreen preserve A connection',await evaluate('__a===document.querySelector("#slot-a iframe")'));
  await click('#fullscreen');await click('#audio-mic');await wait(()=>evaluate('document.querySelector("#audio-level").value>0'));
  await evaluate('document.querySelector("#audio-tools").scrollTop=0');await shot('audio-uat-desktop');
  await click('#audio-mic-stop');
  await click('#launch-desktop');await wait(()=>evaluate('document.querySelector("#slot-a iframe")?.src.endsWith("/desktop")'));
  await click('#audio-separate');await wait(()=>evaluate('!document.querySelector("#audio-separate").disabled'));
  check('desktop already in A is honestly reported as same runtime',await evaluate('document.querySelector("#audio-topology").textContent.includes("同一会话")'));
  await click('#audio-export');await wait(()=>evaluate('__export.viewers.a.runtimeId==="desktop"'));
  check('final export still has no remote pass',await evaluate('__export.remoteAudio.cases.every(c=>c.result==="not-run")'));
  await click('#audio-mic');await wait(()=>evaluate('document.querySelector("#audio-mic-status").textContent.includes("正在本机")'));
  await evaluate('window.dispatchEvent(new PageTransitionEvent("pagehide"))');
  check('page retirement handler stops tracks',await evaluate('__streams.every(s=>s.getTracks().every(t=>t.readyState==="ended"))'));
  await wait(()=>evaluate('__contexts.every(c=>c.state==="closed")'));
  check('all probe AudioContexts closed',true);
  check('unavailable backend sends no audio or device payloads',requests.every(r=>r.method!=='PUT'&&(!r.path.includes('audio')||(r.method==='GET'&&r.path==='/rx/sdk/remotexapp-audio.js'))));
  check('no browser exceptions',errors.length===0);
  simulatedAudio=true;await call('Page.reload',{ignoreCache:true});
  await wait(()=>evaluate('!!window.fixtureAudio&&document.querySelector("#remote-audio-availability").textContent.includes("Ready")'));
  await click('#toggle-audio');
  await evaluate('document.querySelector("#status").textContent="打开测试会话失败"');
  await click('#launch-audio-b');
  await wait(()=>evaluate('document.querySelector("#status").textContent.includes("App B 已打开")'));
  check('successful audio App B selection clears earlier failure message',await evaluate('!!document.querySelector("#slot-b iframe")'));
  const audioState=async(connection,id,received,sent)=>evaluate(`fixtureAudio.dispatchEvent(new CustomEvent('statechange',{detail:{connection:${JSON.stringify(connection)},connectionId:${JSON.stringify(id)},receivedBytes:${received},sentBytes:${sent},routes:[]}}))`);
  await audioState('connected','meter-a',0,0);await delay(800);await audioState('connected','meter-a',1000000,100000);
  const measuredRate=await evaluate('document.querySelector("#audio-link-summary").textContent');
  check('advancing audio counters produce positive bandwidth',/↓ [1-9][0-9]* \/ ↑ [1-9][0-9]* kbps/.test(measuredRate));
  await delay(900);await audioState('connected','meter-a',1000000,100000);
  check('repeated worklet state preserves measured bandwidth',await evaluate('document.querySelector("#audio-link-summary").textContent')===measuredRate);
  await audioState('connected','meter-b',0,0);
  check('new audio connection retires prior rates',await evaluate('document.querySelector("#audio-link-summary").textContent.includes("采样中")'));
  await audioState('idle',null,0,0);
  check('idle audio hides stale rates',await evaluate('!document.querySelector("#audio-link-summary").textContent.includes("kbps")'));
  check('bandwidth fixture has no browser exceptions',errors.length===0);
  const version=await call('Browser.getVersion');
  await writeFile(join(output,'browser-results.json'),JSON.stringify({schema:1,scope:'synthetic-browser-fixture-only',pageSHA256:createHash('sha256').update(html).digest('hex'),browser:version.product,checks,errors,notVerified:['real-Manager/runtime/audio-backend','physical speaker/microphone','other browser engines','embedding-host workspace lifecycle','live UAT rollout']},null,2)+'\n');
  console.log(JSON.stringify({checks:checks.length,errors:errors.length,pageSHA256:createHash('sha256').update(html).digest('hex')}));
} catch(error) {
  console.error(error.stack);
  if(call)try{const s=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(output,'failure.png'),Buffer.from(s.data,'base64'));}catch{}
  throw error;
} finally {
  if(call)try{await call('Browser.close');}catch{}
  if(ws)ws.close();
  browser.kill('SIGTERM');
  await Promise.race([new Promise(r=>browser.once('exit',r)),delay(3000)]);
  if(browser.exitCode===null&&browser.signalCode===null){browser.kill('SIGKILL');await new Promise(r=>browser.once('exit',r));}
  await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
