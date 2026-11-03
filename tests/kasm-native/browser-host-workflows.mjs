import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {config,api,remote,open,wait,click,delay} from './host-browser.mjs';

const results=[],owned=new Set(),b=await open(config.ingressURL+'/rx/sdk/host.html');
const pass=name=>{results.push({name,status:'passed'});console.log(name);};
const state=()=>b.evaluate('remoteXAppHostWorkbench.snapshot()');
const active=".window-layout:not([hidden])";
async function control(text){
  await b.evaluate(`(()=>{const buttons=[...document.querySelectorAll(${JSON.stringify(active)}+' button')];const target=buttons.find(e=>e.textContent===${JSON.stringify(text)});if(!target)throw Error('control missing');target.closest('details')?.setAttribute('open','');target.dataset.testClick='target';})()`);
  await click(b,'[data-test-click=target]');await b.evaluate("document.querySelector('[data-test-click=target]')?.removeAttribute('data-test-click')");
}
async function ready(count){await wait(async()=>{const s=await state();return s.windows.length===count && s.windows.every(w=>w.stats?.state==='ready');},110000);}
const path='/home/rxhost/documents/host-'+Date.now()+'.txt';
remote(['runuser','-u',config.user,'--','python3','-c','from pathlib import Path;import sys;Path(sys.argv[1]).write_text("")',path]);
try {
  await wait(()=>b.evaluate("document.querySelector('#template')?.options.length===8"));
  assert.deepEqual((await api('/api/templates')).map(t=>t.id).sort(),['edge','firefox-esr','kate','kwrite','libreoffice','lightview','mousepad','xfce-user-desktop']);
  await b.evaluate(`document.querySelector('#template').value='mousepad';document.querySelector('#template').dispatchEvent(new Event('change'));document.querySelector('[data-parameter=filePath]').value=${JSON.stringify(path)}`);
  await click(b,'#launch-button');await ready(1);
  let s=await state();const id=s.windows[0].instanceId;owned.add(id);
  assert.equal(s.audio.connection,'idle');assert.equal(s.diagnostics.localHandles,1);
  pass('metadata-driven formal Mousepad launch, App readiness and actual paint');
  const text='Native host 中文 😀\nsecond line\tend';
  await b.evaluate(`document.querySelector(${JSON.stringify(active)}+' .inspector textarea').value=${JSON.stringify(text)}`);
  await control('发送文字');await control('发送 Ctrl+S');
  await wait(()=>remote(['cat',path])===text,15000);
  pass('public native text/shortcut submission with Unicode file readback');
  await control('再开一个窗口');await ready(2);s=await state();
  assert.equal(new Set(s.windows.map(w=>w.instanceId)).size,1);assert.equal(s.diagnostics.localHandles,2);
  const epochs=s.windows.map(w=>w.stats.connectionEpoch);
  await control('移到另一工作区');await click(b,'[data-workspace="2"]');await delay(350);
  s=await state();assert.deepEqual(s.windows.map(w=>w.stats.connectionEpoch),epochs);
  pass('duplicate Viewer and workspace switch retain independent display attachments');
  await control('卸载 / 恢复画面');await wait(async()=>!(await state()).windows[1].stats);
  assert.equal((await state()).diagnostics.localHandles,2);
  await control('卸载 / 恢复画面');await ready(2);
  assert.equal((await api('/api/instances/'+id)).sessionGeneration,s.windows[0].generation);
  pass('unload/restore display retains runtime ownership and generation');
  await control('持有后台任务');await wait(async()=>(await state()).diagnostics.localHandles===3);
  await control('关闭窗口');await wait(async()=>(await state()).windows.length===1);
  await click(b,'[data-workspace="1"]');await control('关闭窗口');
  await wait(async()=>(await state()).windows.length===0 && (await state()).diagnostics.localHandles===1);
  assert.equal((await api('/api/instances/'+id)).sessionState,'running');
  pass('background task independently retains App after both windows close');
  await click(b,'#tasks button');await wait(async()=>(await state()).diagnostics.localHandles===0);
  await b.evaluate(`document.querySelector('#launch-readonly').checked=true;document.querySelector('[data-parameter=filePath]').value=${JSON.stringify(path)}`);
  await click(b,'#launch-button');await ready(1);s=await state();owned.add(s.windows[0].instanceId);
  await b.evaluate(`document.querySelector(${JSON.stringify(active)}+' .inspector textarea').value='forbidden-write'`);
  await control('发送文字');await wait(()=>b.evaluate("document.querySelector('#notice').textContent.includes('input-unavailable')"));
  assert.equal(remote(['cat',path]),text);
  pass('server-granted read-only Viewer paints and refuses programmatic input');
  await b.call('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
  await delay(500);let shot=await b.call('Page.captureScreenshot',{format:'png'});writeFileSync(config.evidenceDirectory+'/host-desktop.png',Buffer.from(shot.data,'base64'));
  await b.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(400);
  assert(await b.evaluate('document.documentElement.scrollWidth<=innerWidth'));
  shot=await b.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync(config.evidenceDirectory+'/host-mobile.png',Buffer.from(shot.data,'base64'));
  pass('desktop/mobile workbench viewport and visible stats layout');
  await click(b,'#logout');await wait(async()=>(await state()).diagnostics.destroyed);
  assert.equal((await state()).audio.connection,'idle');
  pass('logout releases host ownership without treating it as App stop');
  assert.equal(b.events.filter(e=>e.method==='Runtime.exceptionThrown').length,0);
} catch(error) {results.push({name:'suite',status:'failed',error:error.message});throw error;}
finally {
  await b.close();
  for(const id of owned){try{const current=await api('/api/instances/'+id);if(current.state!=='stopped')await api('/api/instances/'+id+'/stop',{force:true,sessionGeneration:current.sessionGeneration});}catch(error){results.push({name:'cleanup',status:'failed',error:error.message});}}
  writeFileSync(config.evidenceDirectory+'/host-workflows.json',JSON.stringify({schemaVersion:1,results,humanAcceptance:'not-evaluated'},null,2));
}
