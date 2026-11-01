// Requires the owned X11 input-probe.py on this instance's private display.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {config,instance,open,ready,wait,delay,key,ctrl,remote} from './browser-fixture.mjs';
assert.ok(config.probeOutput.startsWith('/home/'+config.user+'/documents/'));
const read=()=>JSON.parse(remote(['cat',config.probeOutput]));
const reports=[];
const created=[];
const errorsSource=`window.fixtureInputErrors=[];addEventListener('error',e=>fixtureInputErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureInputErrors.push(String(e.reason?.message||e.reason)));`;
async function mouse(c,type,point,extra={}) {await c.call('Input.dispatchMouseEvent',{type,...point,...extra});}
async function point(c,frame,where,fx=.5,fy=.5) {
 const g=read().geometry[where];const sx=g.x+g.width*fx,sy=g.y+g.height*fy;
 return c.evaluate(`(()=>{const f=${frame===null?'null':`document.querySelectorAll('iframe')[${frame}]`};if(f)f.scrollIntoView({block:'center'});const d=f?f.contentDocument:document;const cv=d.querySelector('canvas'),r=cv.getBoundingClientRect(),fr=f?f.getBoundingClientRect():{x:0,y:0};return {x:fr.x+r.x+${sx}*r.width/cv.width,y:fr.y+r.y+${sy}*r.height/cv.height}})()`);
}
async function click(c,frame,where,options={}) {
 const p=await point(c,frame,where,options.fx??.5,options.fy??.5),button=options.button||'left';
 await mouse(c,'mouseMoved',p);
 // RFB carries button transitions, not DOM clickCount. A remote double click
 // requires both actual down/up pairs within the desktop's double-click time.
 for(let clickCount=1;clickCount<=(options.clickCount||1);clickCount++){
  await mouse(c,'mousePressed',p,{button,clickCount});
  await mouse(c,'mouseReleased',p,{button,clickCount});
 }
 await delay(180);
}
async function noErrors(c){
 const e=await c.evaluate(`[...(fixtureInputErrors||[]),...[...document.querySelectorAll('iframe')].flatMap(f=>f.contentWindow.fixtureInputErrors||[])]`);assert.deepEqual(e,[],'browser input errors');
 assert.deepEqual(c.events.filter(e=>e.method==='Runtime.exceptionThrown'),[],'uncaught browser exceptions');
}
async function readyFrames(c){
 await wait(async()=>{
  await noErrors(c);
  const states=await c.evaluate(`[...document.querySelectorAll('iframe')].map(f=>f.contentDocument?.querySelector('#status')?.textContent)`);
  assert.ok(!states.some(s=>s?.startsWith('failed')),JSON.stringify(states));
  return states.length===2&&states.every(s=>s?.startsWith('Ready'));
 });
}
async function exercise(c,frame,label) {
 await c.call('Page.bringToFront');
 // Button command is executed by the real remote GUI, not the DOM click handler.
 const before=read().clicks;await click(c,frame,'button');await noErrors(c);await wait(()=>read().clicks===before+1);
 const motion=await point(c,frame,'area',.3,.4);await mouse(c,'mouseMoved',motion);await delay(200);let s=read();const moved=s.events.filter(e=>e.type==='6').at(-1),g=s.geometry.area;assert.ok(moved);assert.ok(Math.abs(moved.x-(g.x+g.width*.3))<=3);assert.ok(Math.abs(moved.y-(g.y+g.height*.4))<=3);
 for(const [button,num]of [['left',1],['middle',2],['right',3],['back',8],['forward',9]]){
  const n=read().events.length;await click(c,frame,'area',{button});const ev=read().events.slice(n);assert.ok(ev.some(e=>e.type==='4'&&e.button===num),button+' down');assert.ok(ev.some(e=>e.type==='5'&&e.button===num),button+' up');
 }
 await click(c,frame,'a');await ctrl(c,'a','KeyA',65);await c.call('Input.insertText',{text:'ABCD'});await delay(200);
 await key(c,'End','End',35);await key(c,'ArrowLeft','ArrowLeft',37);await key(c,'ArrowLeft','ArrowLeft',37);await c.call('Input.insertText',{text:'Z'});await wait(()=>read().entries.a.value==='ABZCD');
 await key(c,'ArrowRight','ArrowRight',39);await c.call('Input.insertText',{text:'Y'});await wait(()=>read().entries.a.value==='ABZCYD');
 await key(c,'Home','Home',36);await key(c,'Delete','Delete',46);await key(c,'End','End',35);await key(c,'Backspace','Backspace',8);await wait(()=>read().entries.a.value==='BZCY');
 await click(c,frame,'b');await ctrl(c,'a','KeyA',65);await c.call('Input.insertText',{text:'target B'});await wait(()=>read().entries.b.value==='target B');assert.equal(read().entries.a.value,'BZCY');
 await click(c,frame,'a',{clickCount:2,fx:.08});await wait(()=>read().entries.a.selection.length===2);assert.ok(read().entries.a.selection[1]>read().entries.a.selection[0]);
 await click(c,frame,'a');const start=await point(c,frame,'a',.03,.5),end=await point(c,frame,'a',.18,.5);await mouse(c,'mouseMoved',start);await mouse(c,'mousePressed',start,{button:'left',buttons:1,clickCount:1});for(let i=1;i<=8;i++)await mouse(c,'mouseMoved',{x:start.x+(end.x-start.x)*i/8,y:start.y},{button:'left',buttons:1});await mouse(c,'mouseReleased',end,{button:'left',buttons:0,clickCount:1});await wait(()=>read().entries.a.selection.length===2);assert.ok(read().entries.a.selection[1]>read().entries.a.selection[0]);
 await click(c,frame,'list', {fx:.3,fy:.1});const selection=read().listSelection[0];await key(c,'ArrowDown','ArrowDown',40);await wait(()=>read().listSelection[0]===selection+1);await key(c,'ArrowUp','ArrowUp',38);await wait(()=>read().listSelection[0]===selection);
 const wheel=await point(c,frame,'list',.5,.5),view=read().listView[0];await mouse(c,'mouseWheel',wheel,{deltaX:0,deltaY:280});await wait(()=>read().listView[0]>view);await mouse(c,'mouseWheel',wheel,{deltaX:0,deltaY:-280});await delay(200);
 await noErrors(c);reports.push({label,remoteMotion:true,buttons:[1,2,3,8,9],clickCommand:true,doubleClickSelection:true,dragSelection:true,arrowsAndEditingKeys:true,targetFocus:true,wheel:true,browserExceptions:0});console.log(label,'remote pointer/focus/navigation passed');
}
try {
 const c=await open('about:blank');created.push(c);await c.call('Page.addScriptToEvaluateOnNewDocument',{source:errorsSource});await c.call('Page.navigate',{url:config.ingressURL+config.basePath+instance.viewerUrl});await ready(c);await exercise(c,null,'standalone');
 const h=await open('about:blank');created.push(h);await h.call('Page.addScriptToEvaluateOnNewDocument',{source:errorsSource});await h.call('Page.navigate',{url:config.ingressURL+'/'});await wait(()=>h.evaluate('document.readyState==="complete"&&document.querySelector("#status")?.textContent!=="加载测试配置…"'));
 await h.evaluate(`document.body.replaceChildren();document.body.style.cssText='margin:20px;display:flex;gap:20px';for(let i=0;i<2;i++){const f=document.createElement('iframe');f.style.cssText='width:720px;height:720px;border:0';f.src=${JSON.stringify(config.basePath+instance.viewerUrl)};document.body.append(f)}`);
 await h.call('Page.bringToFront');await readyFrames(h);await exercise(h,0,'iframe-A');await exercise(h,1,'iframe-B');
 await h.evaluate('document.querySelectorAll("iframe")[0].hidden=true');await delay(100);await h.evaluate('document.querySelectorAll("iframe")[0].hidden=false');await exercise(h,0,'iframe-A-after-hide-show');
 await h.evaluate('document.querySelectorAll("iframe")[0].contentDocument.querySelector("#reconnect").click()');await wait(()=>h.evaluate('document.querySelectorAll("iframe")[0].contentDocument.querySelector("#status").textContent.startsWith("Ready")'));await exercise(h,0,'iframe-A-after-reconnect');
} finally {
 writeFileSync(config.evidenceDirectory+'/pointer-results.json',JSON.stringify(reports,null,2));
 writeFileSync(config.evidenceDirectory+'/pointer-browser-events.json',JSON.stringify(created.flatMap(c=>c.events.filter(e=>['Runtime.exceptionThrown','Runtime.consoleAPICalled','Network.webSocketFrameError'].includes(e.method))),null,2));
 for(const c of created){c.close();await fetch(config.cdpURL+'/json/close/'+c.page.id);}
}
