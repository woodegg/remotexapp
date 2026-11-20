// Real default/custom workbench controls, separate tabs and independent Apps.
// Requires the same disposable fixture as the host integration suite.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {config,api,remote,open,wait,click,delay} from './host-browser.mjs';

const checks=[],owned=[],pages=[];
const pass=name=>{checks.push({name,result:'passed'});console.log(name);};
const states=b=>b.evaluate('remoteXAppRecoveryWorkbench.snapshot()');
const ready=async(b,n)=>wait(async()=>{const s=await states(b);return s.length===n&&s.every(v=>v.displayReady&&v.state==='ready');});
async function control(b,text,index=0){
  await b.evaluate(`(()=>{document.querySelectorAll('[data-test-action]').forEach(e=>e.removeAttribute('data-test-action'));const card=document.querySelectorAll('#views article')[${index}];const button=[...card.querySelectorAll('button')].find(e=>e.textContent===${JSON.stringify(text)});if(!button)throw Error('button missing: '+${JSON.stringify(text)});button.dataset.testAction='';})()`);
  await click(b,'[data-test-action]');
}
async function attach(b,id,custom=false){
  await click(b,'#refresh');
  await wait(()=>b.evaluate(`!!document.querySelector('#existing option[value="${id}"]')`));
  await b.evaluate(`document.querySelector('#existing').value=${JSON.stringify(id)};document.querySelector('#custom').checked=${custom}`);
  await click(b,'#attach');
}
const files=[0,1].map(n=>'/home/rxhost/documents/recovery-ui-'+Date.now()+'-'+n+'.txt');
let failure,offline=false,b,b2;
try{
  b=await open(config.ingressURL+'/rx/sdk/recovery.html');pages.push(b);
  await b.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await wait(()=>b.evaluate('!!window.remoteXAppRecoveryWorkbench'));
  for(const file of files){
    remote(['runuser','-u',config.user,'--','python3','-c','from pathlib import Path;import sys;Path(sys.argv[1]).touch(exist_ok=False)',file]);
    // Public SDK launch is setup; all recovery actions below use visible controls.
    const id=await b.evaluate(`(async()=>{const sdk=await import('./index.js');window.setupHost ||= new sdk.RemoteXAppHost({baseURL:'/rx',scope:'recovery-ui-setup'});const s=await setupHost.open({templateId:'mousepad',parameters:{filePath:${JSON.stringify(file)}},keepAlive:true});return s.id;})()`);
    owned.push(id);
  }
  await attach(b,owned[0]);await ready(b,1);
  b2=await open(config.ingressURL+'/rx/sdk/recovery.html');pages.push(b2);
  await b2.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1500,deviceScaleFactor:1,mobile:false});
  await wait(()=>b2.evaluate('!!window.remoteXAppRecoveryWorkbench'));
  await attach(b2,owned[0],true);await ready(b2,1);
  await attach(b2,owned[1],true);await ready(b2,2);
  const generations=await Promise.all(owned.map(id=>api('/api/instances/'+id).then(x=>x.sessionGeneration)));
  assert.equal((await states(b2))[0].instanceId,(await states(b))[0].instanceId);
  pass('three real Viewers across two tabs and two Apps paint through mount');

  await control(b,'隐藏 / 显示画面');assert((await states(b))[0].displayReady);
  await control(b,'隐藏 / 显示画面');await ready(b,1);
  await control(b,'断开此 Viewer');
  await wait(async()=>(await states(b))[0].state==='attention');
  assert((await states(b2)).every(x=>x.displayReady));
  // DOM focus outside the failed Viewer is retained while the recovery UI updates.
  await b.evaluate("document.querySelector('#existing').focus()");
  await delay(500);assert.equal(await b.evaluate('document.activeElement.id'),'existing');
  await control(b,'重试连接 · Retry connection');await ready(b,1);
  pass('hide retains ownership; local disconnect leaves both peer Viewers ready and does not steal focus');

  await control(b2,'断开此 Viewer');
  await wait(async()=>(await states(b2))[0].state==='attention');
  assert((await states(b2))[1].displayReady);assert((await states(b))[0].displayReady);
  await control(b2,'刷新状态');await wait(async()=>!(await states(b2))[0].busy);
  await control(b2,'重启应用…');await wait(async()=>!!(await states(b2))[0].confirmation);
  assert((await states(b))[0].displayReady);assert((await states(b2))[1].displayReady);
  await control(b2,'取消');await control(b2,'重试连接');await ready(b2,2);
  assert.deepEqual(await Promise.all(owned.map(id=>api('/api/instances/'+id).then(x=>x.sessionGeneration))),generations);
  pass('custom presentation uses the same confirmed action model; cancel leaves both generations unchanged');

  await b.call('Page.bringToFront');
  await b.call('Network.enable');
  await b.call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});offline=true;
  await wait(async()=>(await states(b))[0].state==='recovering',30000);
  assert((await states(b2)).every(x=>x.displayReady));
  await b.call('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});offline=false;
  await ready(b,1);
  pass('one-tab HTTP/lease outage recovers without interrupting duplicate or unrelated App');

  // Actual browser keyboard events, not direct writes to a fixture file.
  await click(b,'#views canvas');
  for(const key of 'uat'){
    const keyCode=key.toUpperCase().charCodeAt(0);
    await b.call('Input.dispatchKeyEvent',{type:'keyDown',key,code:'Key'+key.toUpperCase(),windowsVirtualKeyCode:keyCode});
    await b.call('Input.dispatchKeyEvent',{type:'keyUp',key,code:'Key'+key.toUpperCase(),windowsVirtualKeyCode:keyCode});
  }
  await b.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Control',code:'ControlLeft',windowsVirtualKeyCode:17,modifiers:2});
  await b.call('Input.dispatchKeyEvent',{type:'keyDown',key:'s',code:'KeyS',windowsVirtualKeyCode:83,modifiers:2});
  await b.call('Input.dispatchKeyEvent',{type:'keyUp',key:'s',code:'KeyS',windowsVirtualKeyCode:83,modifiers:2});
  await b.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Control',code:'ControlLeft',windowsVirtualKeyCode:17});
  await wait(()=>remote(['cat',files[0]])==='uat');
  assert.equal(remote(['cat',files[1]]),'');
  pass('recovered default panel permits real keyboard input/save; unrelated document stays unchanged');
  await wait(()=>b.evaluate("document.querySelector('#views output').textContent.includes('FPS')"));
  for(const [name,p] of [['default',b],['custom',b2]]){
    const shot=await p.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
    writeFileSync(config.evidenceDirectory+'/recovery-ui-'+name+'.png',Buffer.from(shot.data,'base64'));
  }
  await control(b,'断开此 Viewer');await wait(async()=>(await states(b))[0].state==='attention');
  await b.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await delay(300);assert(await b.evaluate('document.documentElement.scrollWidth<=innerWidth'));
  const shot=await b.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
  writeFileSync(config.evidenceDirectory+'/recovery-ui-mobile.png',Buffer.from(shot.data,'base64'));
  pass('stats stay visible and attention controls fit a mobile viewport');
  await click(b,'#logout');await click(b2,'#logout');
  await wait(async()=>(await states(b)).length===0&&(await states(b2)).length===0);
  await b.evaluate('setupHost.dispose()');
  assert.equal((await api('/api/instances/'+owned[0])).sessionGeneration,generations[0]);
  assert.equal((await api('/api/instances/'+owned[1])).sessionGeneration,generations[1]);
  pass('releasing both pages removes all view DOM and keeps Apps intact');
  assert(pages.every(p=>!p.events.some(e=>e.method==='Runtime.exceptionThrown')));
}catch(e){failure=e.message;checks.push({name:'suite',result:'failed',error:failure});console.error(e.stack);}
finally{
  if(offline)await b.call('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  for(const p of pages)await p.close();
  for(const id of owned){const x=await api('/api/instances/'+id);if(x.state!=='stopped')await api('/api/instances/'+id+'/stop',{force:true,sessionGeneration:x.sessionGeneration});}
  writeFileSync(config.evidenceDirectory+'/recovery-ui.json',JSON.stringify({result:failure?'failed':'passed',checks},null,2));
}
if(failure)process.exitCode=1;
