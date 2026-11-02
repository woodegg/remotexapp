// Real served workbench + native Apps in an owned disposable fixture.
import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import {config,open,click,ctrl,key,text,delay,wait,remote,api} from './browser-fixture.mjs';
const out=config.evidenceDirectory+'/workbench';mkdirSync(out,{recursive:true});
const results=[];const check=async(name,fn)=>{await fn();results.push({name,status:'pass'});console.log('PASS '+name);};
const c=await open('about:blank');let owned,completed=false;
const frame=slot=>`document.querySelector('#slot-${slot} iframe').contentWindow`;
const clipboard=slot=>frame(slot)+'.remoteXAppViewerClipboard';
const state=slot=>c.evaluate(clipboard(slot)+'.state()');
const gesture=async expression=>{const r=await c.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;};
const focus=async slot=>{
 await click(c,'[data-layout="'+slot+'"]');
 const point=await c.evaluate(`(()=>{const f=document.querySelector('#slot-${slot} iframe'),r=f.getBoundingClientRect(),v=f.contentDocument.querySelector('canvas').getBoundingClientRect();if(!r.width||!r.height)throw Error('Viewer is hidden');return {x:r.x+v.x+Math.min(150,v.width/2),y:r.y+v.y+Math.min(180,v.height/2)}})()`);
 await c.call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await c.call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});await wait(async()=>(await state(slot)).active);
};
const save=async()=>{await ctrl(c,'s','KeyS',83);await delay(300);return remote(['cat',config.documentFile]);};
const write=value=>gesture(`navigator.clipboard.writeText(${JSON.stringify(value)})`);
const read=()=>gesture('navigator.clipboard.readText()');
const configure=async(slot,mode='auto')=>{await c.evaluate(`document.querySelector('#clipboard-panel-${slot}').open=true`);for(const direction of ['toRemote','toLocal'])await gesture(`(()=>{const e=document.querySelector('#clipboard-panel-${slot} [data-direction="${direction}"]');e.value=${JSON.stringify(mode)};e.dispatchEvent(new Event('change'))})()`);await wait(async()=>(await state(slot)).requested.toLocal===mode);await focus(slot);await wait(async()=>(await state(slot)).phase==='watching');};
const paste=async(slot,value)=>{await write(value);await focus(slot);await ctrl(c,'a','KeyA',65);await ctrl(c,'v','KeyV',86);try{await wait(async()=>await save()===value);}catch(e){writeFileSync(out+'/failure.png',Buffer.from((await c.call('Page.captureScreenshot')).data,'base64'));const actual=await save();console.log('PASTE_STATE',JSON.stringify({a:await state('a'),b:await state('b'),actualLength:actual.length,expectedLength:value.length,contains:actual.includes(value)}));throw e;}};
try {
 await c.call('Browser.setPermission',{permission:{name:'clipboard-read',allowWithoutSanitization:true},setting:'granted',origin:config.ingressURL});
 await c.call('Browser.setPermission',{permission:{name:'microphone'},setting:'granted',origin:config.ingressURL});
 const fixture=await fetch(config.ingressURL+'/fixture-config').then(r=>r.json());fixture.documentFile=config.documentFile;
 // Fixture configuration only; SDK, workbench, native component and API remain served unchanged.
 await c.call('Fetch.enable',{patterns:[{urlPattern:'*/fixture-config',requestStage:'Request'}]});
 let fixtureServed=false;const eventPoll=setInterval(()=>{for(const e of c.events.splice(0)){if(e.method==='Fetch.requestPaused')c.call('Fetch.fulfillRequest',{requestId:e.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(fixture)).toString('base64')}).then(()=>{fixtureServed=true;}).catch(()=>{});}},20);
 try{await c.call('Page.navigate',{url:config.ingressURL+'/'});await wait(()=>fixtureServed);await wait(()=>c.evaluate('!!document.querySelector("#launch-mousepad")&&!document.querySelector("#launch-mousepad").disabled'));}finally{clearInterval(eventPoll);await c.call('Fetch.disable');}
 await c.call('Page.bringToFront');const before=new Set((await api('/api/instances')).map(x=>x.id));
 await click(c,'#launch-mousepad');await wait(()=>c.evaluate('document.querySelector("#connection-summary").textContent.includes("2 / 2")'));
 const current=await api('/api/instances');owned=current.find(x=>!before.has(x.id)&&x.classId==='alpine-mousepad');assert.ok(owned);assert.equal(owned.parameters.filePath,config.documentFile);writeFileSync(out+'/owned-app-private.json',JSON.stringify(owned));
 await check('served embedded viewers start with independent clipboard consent off',async()=>{assert.deepEqual((await state('a')).requested,{toRemote:'off',toLocal:'off'});assert.equal((await state('b')).active,false);});
 await check('workbench direction controls enable real native paste/readback',async()=>{await configure('a');await paste('a','嵌入窗口剪贴板 😀\n第二行');assert.equal((await state('b')).requested.toRemote,'off');});
 await check('real remote copy reaches local clipboard from embedded Viewer',async()=>{await focus('a');await ctrl(c,'a','KeyA',65);await text(c,'嵌入窗口反向复制');await wait(async()=>await save()==='嵌入窗口反向复制');await ctrl(c,'a','KeyA',65);await ctrl(c,'c','KeyC',67);await wait(async()=>await read()==='嵌入窗口反向复制');});
 await check('two same-page Viewers select one automatic clipboard target',async()=>{await configure('b');assert.equal((await state('a')).active,false);assert.equal((await state('b')).active,true);await paste('b','Viewer B 独立授权');});
 await check('hiding a Viewer retires activity and does not copy in the background',async()=>{await click(c,'#toggle-b');assert.equal((await state('b')).active,false);await write('hidden local sentinel');await delay(500);await click(c,'#toggle-b');await focus('b');await delay(350);assert.equal(await save(),'Viewer B 独立授权');});
 await check('speaker and microphone controls do not select a clipboard target',async()=>{await focus('a');await wait(()=>c.evaluate('!document.querySelector("#speaker-a").disabled'));await click(c,'#speaker-a');await wait(()=>c.evaluate('document.querySelector("#speaker-a").getAttribute("aria-pressed")==="true"'));assert.equal((await state('b')).active,false);await click(c,'#microphone-a');await wait(()=>c.evaluate('document.querySelector("#microphone-a").getAttribute("aria-pressed")==="true"'));assert.equal((await state('b')).active,false);await paste('a','音频同时启用的剪贴板');assert.ok(await c.evaluate('document.querySelector("#audio-link-summary").textContent.includes("1 条共享 WSS")'));});
 await check('all audio off leaves clipboard and display usable',async()=>{await click(c,'#release-audio-a');await click(c,'#release-audio-b');await wait(()=>c.evaluate('document.querySelector("#audio-link-summary").textContent.includes("未连接")'));await paste('a','音频关闭后仍可粘贴');assert.equal(await c.evaluate(frame('a')+'.remoteXAppViewerStats().state'),'ready');});
 await check('stats and clipboard controls remain alongside the tested window',async()=>{await c.call('Emulation.setDeviceMetricsOverride',{width:1500,height:1100,deviceScaleFactor:1,mobile:false});await c.evaluate('window.scrollTo(0,0)');const geometry=await c.evaluate(`(()=>{const f=document.querySelector('#slot-a').getBoundingClientRect(),s=document.querySelector('#connection-a').getBoundingClientRect();return {frame:f.bottom>0&&f.top<innerHeight,stats:s.bottom>0&&s.top<innerHeight,horizontal:document.documentElement.scrollWidth<=innerWidth}})()`);assert.ok(geometry.frame&&geometry.stats&&geometry.horizontal);writeFileSync(out+'/workbench.png',Buffer.from((await c.call('Page.captureScreenshot')).data,'base64'));});
 await check('manual UAT records stay unexecuted; no automated acceptance is fabricated',async()=>{assert.equal(await c.evaluate('[...document.querySelectorAll("#clipboard-matrix select")].every(e=>e.value==="not-run")'),true);});
 completed=true;
} finally {
 writeFileSync(out+'/results.json',JSON.stringify({scope:'served embedded workbench and real native editor; synthetic microphone',status:completed&&results.length===9?'pass':'fail',cases:results},null,2));
 try{await c.call('Target.closeTarget',{targetId:c.page.id});}catch{}c.close();
 if(owned)await api('/api/instances/'+owned.id+'/stop',{method:'POST',body:'{}'});
}
