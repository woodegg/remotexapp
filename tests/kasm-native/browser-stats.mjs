// Owned disposable fixture only; synthetic input never targets a user's App.
import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import {config,open,wait,delay,key,ctrl,remote,api} from './browser-fixture.mjs';
const c=await open('about:blank'),checks=[];
const check=(name,condition)=>{assert(condition,name);checks.push(name);};
const evalJS=s=>c.evaluate(s);
const cards=()=>evalJS(`Object.fromEntries(['a','b'].map(s=>{const el=document.querySelector('#connection-'+s);return[s,{state:el.dataset.state,values:Object.fromEntries([...el.querySelectorAll('[data-stat]')].map(x=>[x.dataset.stat,x.textContent]))}]}))`);
const snap=slot=>evalJS(`document.querySelector('#slot-${slot} iframe').contentWindow.remoteXAppViewerStats()`);
const button=(slot,id)=>evalJS(`document.querySelector('#slot-${slot} iframe').contentDocument.querySelector('#${id}').click()`);
const ready=()=>wait(async()=>{const v=await cards();return v.a.state==='ready'&&v.b.state==='ready';});
let ownId;
try{
 await c.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.statsErrors=[];addEventListener('error',e=>statsErrors.push(e.message));addEventListener('unhandledrejection',e=>statsErrors.push(String(e.reason)));`});
 await c.call('Page.navigate',{url:config.ingressURL+'/'});await c.call('Page.bringToFront');
 await wait(()=>evalJS(`document.querySelector('#status')?.textContent==='请选择测试应用。'`));
 check('initial cards have no fabricated metrics',(await cards()).a.values.down==='—');
 await evalJS(`document.querySelector('#launch-mousepad').click()`);await ready();
 ownId=await evalJS(`document.querySelector('#slot-a iframe').src.split('/remotexapps/')[1].split('/')[0]`);
 await delay(1200);
 const initial=await snap('a');check('paired component supplies actual WSS counters',initial.available&&initial.transport==='wss'&&initial.receivedBytes>0&&initial.sentBytes>0&&initial.renderedFrames>0);
 check('framebuffer resolution and uptime are available',initial.width>0&&initial.height>0&&initial.connectedForMs>0);
 // Compare counters against Chrome's independent WebSocket protocol events.
 let matched=false;
 for(let i=0;i<40&&!matched;i++){
  const current=await snap('a');await delay(10);
  const requests=c.events.filter(e=>e.method==='Network.webSocketCreated'&&e.params.url.includes('/'+ownId+'/native/')).map(e=>e.params.requestId);
  matched=requests.some(id=>{
   const size=method=>c.events.filter(e=>e.method===method&&e.params.requestId===id&&e.params.response.opcode<8).reduce((n,e)=>n+Buffer.byteLength(e.params.response.payloadData,e.params.response.opcode===2?'base64':'utf8'),0);
   return size('Network.webSocketFrameReceived')===current.receivedBytes&&size('Network.webSocketFrameSent')===current.sentBytes;
  });
 }
 check('payload totals match independent Chrome WebSocket events',matched);
 const point=await evalJS(`(()=>{const f=document.querySelector('#slot-a iframe');f.scrollIntoView({block:'center'});const cv=f.contentDocument.querySelector('canvas'),r=cv.getBoundingClientRect(),fr=f.getBoundingClientRect();return{x:fr.x+f.clientLeft+r.x+150*r.width/cv.width,y:fr.y+f.clientTop+r.y+180*r.height/cv.height}})()`);
 await c.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
 for(const type of ['mousePressed','mouseReleased'])await c.call('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
 await ctrl(c,'a','KeyA',65);await c.call('Input.insertText',{text:'stats'});await key(c,'ArrowLeft','ArrowLeft',37);await c.call('Input.insertText',{text:'X'});await ctrl(c,'s','KeyS',83);
 await wait(()=>remote(['cat',config.documentFile])==='statXs');
 check('real pointer, arrow and saved document readback pass',true);
 await wait(async()=>Number.parseFloat((await cards()).a.values.fps)>0);
 const updated=await snap('a');check('paint and input grow measured counters',updated.sentBytes>initial.sentBytes&&updated.renderedFrames>initial.renderedFrames);
 check('rate and FPS use numeric live values',(await cards()).a.values.down!=='—');
 await evalJS(`document.querySelector('#toggle-a').click()`);await delay(1100);
 check('hidden panel stays connected independently',(await cards()).a.state==='ready'&&(await cards()).b.state==='ready');
 await evalJS(`document.querySelector('#toggle-a').click()`);
 await button('a','disconnect');await wait(async()=>(await cards()).a.state==='disconnected');
 let v=await cards();check('disconnect clears stale metrics while B stays ready',v.a.values.down==='—'&&v.a.values.protocol==='—'&&v.b.state==='ready');
 await button('a','reconnect');await ready();check('reconnect advances epoch',(await snap('a')).connectionEpoch>updated.connectionEpoch);
 await c.call('Network.setBlockedURLs',{urls:['*/native/prepare']});await button('a','reconnect');
 await wait(async()=>(await cards()).a.state==='failed');v=await cards();check('connection failure is explicit and isolated',v.a.values.fps==='—'&&v.b.state==='ready');
 await c.call('Network.setBlockedURLs',{urls:[]});await button('a','reconnect');await ready();
 check('explicit retry restores a healthy connection',true);
 await evalJS(`Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))`);
 const frozen=await cards();await delay(2300);check('hidden host pauses displayed samples',JSON.stringify(await cards())===JSON.stringify(frozen));
 await evalJS(`delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))`);
 check('return to visible host resets rate baseline',(await cards()).a.values.down==='—');await delay(1200);
 await evalJS(`document.querySelector('#dispose-a').click()`);v=await cards();check('close A releases only A and clears metrics',v.a.state==='disposed'&&v.a.values.received==='—'&&v.b.state==='ready');
 await evalJS(`document.querySelector('#recreate-a').click()`);await ready();check('recreated iframe measures a fresh connection',(await snap('a')).connectedForMs<5000);
 await evalJS(`document.querySelector('#slot-a iframe').src='about:blank'`);await wait(async()=>(await cards()).a.state==='unknown');
 check('missing Viewer cannot display a healthy status',(await cards()).a.values.down==='—');
 await evalJS(`document.querySelector('#recreate-a').click()`);await ready();await delay(1200);
 check('no browser exceptions',c.events.filter(e=>e.method==='Runtime.exceptionThrown').length===0);
 check('no iframe input errors',(await evalJS(`[...statsErrors,...[...document.querySelectorAll('iframe')].flatMap(f=>f.contentWindow.statsErrors||[])]`)).length===0);
 const requestsBefore=c.events.filter(e=>e.method==='Network.requestWillBeSent').length;
 await delay(2100);check('sampling makes no HTTP requests',c.events.filter(e=>e.method==='Network.requestWillBeSent').length===requestsBefore);
 await evalJS(`window.scrollTo(0,0)`);
 const bounds=await evalJS(`(()=>{const r=document.querySelector('.connections').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()`);
 const shot=await c.call('Page.captureScreenshot',{format:'png',clip:bounds});mkdirSync(config.evidenceDirectory,{recursive:true});writeFileSync(config.evidenceDirectory+'/connection-stats.png',Buffer.from(shot.data,'base64'));
 await evalJS(`document.querySelector('#launch-desktop').click()`);
 // The old editor remains ready while the asynchronous managed launch runs.
 // Require both iframes to change before checking the new desktop's state.
 await wait(()=>evalJS(`[...document.querySelectorAll('iframe')].length===2&&[...document.querySelectorAll('iframe')].every(f=>f.src.includes('/remotexapps/')&&!f.src.includes('/${ownId}/'))`));
 await ready();
 const desktopId=await evalJS(`document.querySelector('#slot-a iframe').src.split('/remotexapps/')[1].split('/')[0]`);
 const desktop=await api('/api/instances/'+desktopId);
 check('managed desktop is running with two independent stats snapshots',desktop.sessionState==='running'&&(await snap('a')).available&&(await snap('b')).available);
 writeFileSync(config.evidenceDirectory+'/stats-results.json',JSON.stringify({passed:checks.length,checks},null,2)+'\n');
 console.log('Connection stats browser checks passed:',checks.length);
}finally{
 c.close();await fetch(config.cdpURL+'/json/close/'+c.page.id);
 if(ownId)await api('/api/instances/'+ownId+'/stop',{method:'POST',body:JSON.stringify({force:true})});
}
