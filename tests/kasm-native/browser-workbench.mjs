// Call only with an owned browser tab and a disposable Mousepad document.
// The caller supplies its authenticated CDP client and target-side file readback.
import assert from 'node:assert/strict';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function wait(fn,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await delay(150);}throw Error('workbench condition timed out');}
export async function checkWorkbench(c,{readDocument,screenshot=async()=>{}}){
  const checks=[],layouts=[];
  const check=(name,value)=>{assert(value,name);checks.push(name);};
  const stats=()=>c.evaluate(`[...document.querySelectorAll('iframe')].map(f=>f.contentWindow.remoteXAppViewerStats?.()||{state:"loading"})`);
  const ready=()=>wait(async()=>{const s=await stats();return s.length===2&&s.every(v=>v.state==='ready'&&v.renderedFrames>0);});
  const button=selector=>c.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const key=async(key,code,vk,modifiers=0)=>{for(const type of ['keyDown','keyUp'])await c.call('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:vk,modifiers});};
  const ctrl=async(k,code,vk)=>{await c.call('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Control',code:'ControlLeft',windowsVirtualKeyCode:17,modifiers:2});await key(k,code,vk,2);await c.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Control',code:'ControlLeft',windowsVirtualKeyCode:17});};
  async function click(selector){const p=await c.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);for(const type of ['mousePressed','mouseReleased'])await c.call('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});}
  async function focusApp(slot){const p=await c.evaluate(`(()=>{const f=document.querySelector('#slot-${slot} iframe'),cv=f.contentDocument.querySelector('canvas'),r=cv.getBoundingClientRect(),fr=f.getBoundingClientRect();return{x:fr.x+r.x+Math.min(150,cv.width/2)*r.width/cv.width,y:fr.y+r.y+Math.min(180,cv.height/2)*r.height/cv.height}})()`);for(const type of ['mousePressed','mouseReleased'])await c.call('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});}
  async function geometry(label){
    const g=await c.evaluate(`(()=>{const box=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};const visible=e=>getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';const cards=[...document.querySelectorAll('.connection-card')].filter(visible);return{viewport:{width:innerWidth,height:innerHeight},overflow:document.documentElement.scrollWidth>innerWidth+1||document.documentElement.scrollHeight>innerHeight+1,rail:box(document.querySelector('.connections')),views:[...document.querySelectorAll('[data-viewer]')].filter(visible).map(box),metrics:cards.flatMap(card=>[...card.querySelectorAll('.stat-grid')[0].querySelectorAll('dd')]).map(box),sameFrames:window.workbenchFrames.every((f,i)=>document.querySelectorAll('iframe')[i]===f)}})()`);
    check(label+': page has no outer scroll',!g.overflow);
    check(label+': live rail remains inside viewport',g.rail.y>=0&&g.rail.bottom<=g.viewport.height+1&&g.rail.right<=g.viewport.width+1);
    check(label+': remote surface is usable',g.views.length>0&&g.views.every(v=>v.width>=150&&v.height>=150&&v.y>=0&&v.bottom<=g.viewport.height+1));
    check(label+': key metrics visible with remote window',g.metrics.length>=6&&g.metrics.every(v=>v.y>=g.rail.y&&v.bottom<=g.rail.bottom+1));
    check(label+': same iframe connections retained',g.sameFrames);
    layouts.push({label,...g});
  }
  await c.call('Page.bringToFront');await c.call('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});await ready();
  await c.evaluate(`window.workbenchFrames=[...document.querySelectorAll('iframe')]`);
  const epochs=(await stats()).map(s=>s.connectionEpoch);
  for(const mode of ['a','b','split','a']){await button(`button[data-layout="${mode}"]`);await delay(400);await ready();await geometry('layout '+mode);check('layout '+mode+': epochs unchanged',(await stats()).every((s,i)=>s.connectionEpoch===epochs[i]));}
  await focusApp('a');await ctrl('a','KeyA',65);await c.call('Input.imeSetComposition',{text:'zhongwen',selectionStart:8,selectionEnd:8});await c.call('Input.insertText',{text:'RemoteXApp · 工作台验证'});await key('ArrowLeft','ArrowLeft',37);await c.call('Input.insertText',{text:'✓'});await ctrl('s','KeyS',83);
  await wait(async()=>await readDocument()==='RemoteXApp · 工作台验✓证');check('pointer, Unicode, arrow and saved file readback',true);
  await button('#toggle-tools');check('input tools expanded',await c.evaluate(`!document.querySelector('#input-tools').hidden&&document.querySelector('#toggle-tools').getAttribute('aria-expanded')==='true'`));
  await c.evaluate(`document.querySelector('#local-text').value=''`);await click('#local-text');await c.call('Input.insertText',{text:'本机中文 → RemoteXApp'});check('local input is usable beside remote app',await c.evaluate(`document.querySelector('#local-text').value==='本机中文 → RemoteXApp'`));await geometry('input tools open');
  const origin=await c.evaluate('location.origin');
  await c.call('Browser.setPermission',{permission:{name:'clipboard-read',allowWithoutSanitization:true},setting:'granted',origin});
  await click('#local-copy');await wait(()=>c.evaluate(`navigator.clipboard.readText().then(s=>s==='本机中文 → RemoteXApp')`));
  await c.evaluate(`document.querySelector('#local-text').value=''`);await click('#local-read');await wait(()=>c.evaluate(`document.querySelector('#local-text').value==='本机中文 → RemoteXApp'`));check('explicit local clipboard copy and read',true);
  await c.call('Browser.setPermission',{permission:{name:'clipboard-read',allowWithoutSanitization:true},setting:'denied',origin});await click('#local-read');await wait(()=>c.evaluate(`document.querySelector('#status').textContent==='浏览器拒绝剪贴板读取。'`));check('local clipboard permission denial is visible',true);
  await c.call('Browser.setPermission',{permission:{name:'clipboard-read',allowWithoutSanitization:true},setting:'granted',origin});
  await focusApp('a');await key('End','End',35);await c.call('Input.insertText',{text:'!'});await ctrl('s','KeyS',83);await wait(async()=>await readDocument()==='RemoteXApp · 工作台验✓证!');check('outside/inside input focus returns to remote app',true);
  await button('#toggle-tools');
  await click('#fullscreen');await wait(()=>c.evaluate('!!document.fullscreenElement'));
  check('fullscreen includes stats and viewers',await c.evaluate(`document.fullscreenElement.id==='workbench'&&document.fullscreenElement.contains(document.querySelector('.connections'))`));await geometry('fullscreen');await c.evaluate('document.exitFullscreen()');await wait(()=>c.evaluate('!document.fullscreenElement'));
  for(const [width,height]of [[1920,1080],[1440,900],[1366,768],[1024,640],[900,700],[800,600],[768,1024],[390,844]]){
    await c.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await delay(450);await geometry(width+'x'+height);
    if(width===390){await button('button[data-stats="b"]');check('narrow screen can inspect B independently',await c.evaluate(`getComputedStyle(document.querySelector('#connection-b')).display!=='none'&&getComputedStyle(document.querySelector('#connection-a')).display==='none'`));await geometry('mobile stats B');await screenshot('mobile');await button('button[data-stats="a"]');}
  }
  await c.call('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});await delay(500);
  await button('#dispose-a');await wait(()=>c.evaluate(`document.querySelector('#connection-a').dataset.state==='disposed'`));check('close clears A metrics and retains B',(await stats()).length===1&&(await stats())[0].state==='ready');
  check('closed stats have no stale values',await c.evaluate(`document.querySelector('#connection-a [data-stat=down]').textContent==='—'`));await button('#recreate-a');await ready();
  await button('#toggle-a');check('explicit hide control remains available',await c.evaluate(`document.querySelector('#slot-a').hidden`));await button('#toggle-a');await ready();
  await button('button[data-layout="split"]');await delay(600);await screenshot('split');await button('button[data-layout="a"]');await delay(600);await screenshot('focus');
  check('no browser exceptions',c.errors.length===0);
  return{checks,layouts,passed:true,viewers:2,inputReadback:true};
}
