// Live, synthetic-text qualification in an owned disposable browser/runtime.
// No real user profile or clipboard. Run with the browser-fixture JSON argument.
import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import {config,instance,open,ready,focus,ctrl,key,text,save,delay,wait,api,remote,click} from './browser-fixture.mjs';
const results=[],pages=[],created=[];
const out=config.evidenceDirectory;mkdirSync(out,{recursive:true});
const check=async(name,fn)=>{try{await fn();results.push({name,status:'pass'});console.log('PASS '+name);}catch(e){results.push({name,status:'fail',errorType:e.name});throw e;}};
const gesture=async(c,expression)=>{const r=await c.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw Error('Browser action failed: '+r.exceptionDetails.text);return r.result.value;};
const permission=(c,setting)=>c.call('Browser.setPermission',{permission:{name:'clipboard-read',allowWithoutSanitization:true},setting,origin:config.ingressURL});
async function viewer(app=instance){const c=await open(config.ingressURL+config.basePath+app.viewerUrl);pages.push(c);await ready(c);await permission(c,'granted');await c.evaluate(`window.clipboardProbe={read:navigator.clipboard.readText.bind(navigator.clipboard),write:navigator.clipboard.writeText.bind(navigator.clipboard),reads:0,writes:0};navigator.clipboard.readText=(...args)=>{clipboardProbe.reads++;return clipboardProbe.read(...args)};navigator.clipboard.writeText=(...args)=>{clipboardProbe.writes++;return clipboardProbe.write(...args)}`);return c;}
const state=c=>c.evaluate('remoteXAppViewerClipboard.state()');
const localWrite=(c,value)=>gesture(c,`clipboardProbe.write(${JSON.stringify(value)})`);
const localRead=c=>c.evaluate('clipboardProbe.read()');
async function modes(c,toRemote='auto',toLocal='auto') {await gesture(c,`remoteXAppViewerClipboard.configure(${JSON.stringify({toRemote,toLocal})})`);await focus(c);await wait(async()=>{const s=await state(c);return s.active&&(s.phase==='watching'||!Object.values(s.effective).includes('auto'));});}
const x=(app,args,input='')=>remote(['runuser','-u',config.user,'--','env','DISPLAY='+app.display,'XAUTHORITY='+`/home/${config.user}/state/profiles/alpine-mousepad/default/${app.id}/.Xauthority`,...args],input);
const remoteRead=(app=instance)=>x(app,['xclip','-selection','clipboard','-o']);
async function enter(c,value) {await focus(c);await ctrl(c,'a','KeyA',65);const lines=value.split('\n');for(let i=0;i<lines.length;i++){if(i)await key(c,'Enter','Enter',13);await text(c,lines[i]);}await wait(async()=>await save(c)===value);}
async function paste(c,value) {await localWrite(c,value);await focus(c);await ctrl(c,'a','KeyA',65);await ctrl(c,'v','KeyV',86);await wait(async()=>await save(c)===value);}
let a,b,d,completed=false;
try {
 a=await viewer();
 await check('default off performs no automatic browser clipboard access',async()=>{await focus(a);await delay(600);assert.deepEqual((await state(a)).requested,{toRemote:'off',toLocal:'off'});assert.deepEqual(await a.evaluate('({reads:clipboardProbe.reads,writes:clipboardProbe.writes})'),{reads:0,writes:0});});
 await check('opted-in local Chinese multiline emoji reaches native clipboard and real editor save',async()=>{await modes(a);const value='自动剪贴板\n第二行 😀 café';await paste(a,value);assert.equal(remoteRead(),value);});
 await check('copy outside then return and paste synchronizes before native paste keys',async()=>{
  await a.evaluate(`if(!document.querySelector('#outside')){const t=document.createElement('textarea');t.id='outside';document.body.prepend(t)}document.querySelector('#outside').focus()`);
  assert.equal((await state(a)).active,false);const reads=await a.evaluate('clipboardProbe.reads');await localWrite(a,'外部复制后返回 😀');await delay(350);assert.equal(await a.evaluate('clipboardProbe.reads'),reads);
  await focus(a);await ctrl(a,'a','KeyA',65);await ctrl(a,'v','KeyV',86);await wait(async()=>await save(a)==='外部复制后返回 😀');
 });
 await check('real remote editor copy automatically writes local text without a transfer click',async()=>{
  await enter(a,'远程编辑器复制\n😀');await ctrl(a,'a','KeyA',65);await ctrl(a,'c','KeyC',67);await wait(async()=>await localRead(a)==='远程编辑器复制\n😀');
 });
 await check('same-runtime second tab writes once; inactive tab does not echo or overwrite',async()=>{
  b=await viewer();await modes(b);const before=await a.evaluate('clipboardProbe.writes');
  await enter(b,'第二个 Viewer 拷贝');const writes=await b.evaluate('clipboardProbe.writes');await ctrl(b,'a','KeyA',65);await ctrl(b,'c','KeyC',67);
  await wait(async()=>await localRead(b)==='第二个 Viewer 拷贝');await delay(500);
  assert.equal(await a.evaluate('clipboardProbe.writes'),before);assert.equal(await b.evaluate('clipboardProbe.writes'),writes+1);assert.equal((await state(a)).active,false);
 });
 await check('two different runtimes have independent consent and no background fan-out',async()=>{
  const path=`/home/${config.user}/documents/clipboard-other.txt`;remote(['su','-l',config.user,'-s','/bin/sh','-c','touch '+path]);
  const app=await api('/api/instances',{method:'POST',body:JSON.stringify({templateId:'alpine-mousepad',parameters:{filePath:path}})});created.push(app);writeFileSync(out+'/owned-apps-private.json',JSON.stringify(created));
  d=await viewer(app);await modes(d);const before=remoteRead();await localWrite(d,'不同 App 独立目标');await wait(()=>remoteRead(app)==='不同 App 独立目标');assert.equal(remoteRead(),before);
  await focus(a);await delay(400);assert.equal(remoteRead(),before);assert.equal((await state(d)).active,false);
 });
 await check('one-direction modes and empty local paste preserve the other clipboard',async()=>{
  await modes(a,'off','auto');const before=remoteRead();await localWrite(a,'local-only');await delay(400);assert.equal(remoteRead(),before);
  await modes(a,'auto','off');await enter(a,'远程仅供内部复制');const local=await localRead(a);await ctrl(a,'a','KeyA',65);await ctrl(a,'c','KeyC',67);await delay(400);assert.equal(await localRead(a),local);
  await localWrite(a,'');await ctrl(a,'v','KeyV',86);await delay(350);assert.equal(await save(a),'远程仅供内部复制');assert.equal(remoteRead(),'远程仅供内部复制');
 });
 await check('64 KiB UTF-8 roundtrip is exact; one byte oversize leaves remote unchanged',async()=>{
  await modes(a);const value='界'.repeat(21845)+'A';await paste(a,value);assert.equal(remoteRead(),value);
  await localWrite(a,value+'B');await ctrl(a,'v','KeyV',86);await delay(500);assert.equal(remoteRead(),value);assert.equal((await state(a)).phase,'clipboard-size');
  await localWrite(a,'boundary sentinel');await modes(a,'off','auto');await delay(350);await ctrl(a,'a','KeyA',65);await ctrl(a,'c','KeyC',67);await wait(async()=>await localRead(a)===value);
 });
 await check('permission revocation gives visible manual fallback without automatic read prompts',async()=>{
  await modes(a);await permission(a,'denied');await wait(async()=>(await state(a)).effective.toRemote==='manual');const reads=await a.evaluate('clipboardProbe.reads');await focus(a);await delay(600);assert.equal(await a.evaluate('clipboardProbe.reads'),reads);assert.equal((await state(a)).permissions.read,'denied');
  await permission(a,'granted');await modes(a);
 });
 await check('delayed read is retired by scope reset and cannot submit later',async()=>{
  await paste(a,'read retirement sentinel');const before=remoteRead();
  await a.evaluate(`window.heldRead=null;window.resumeRead=null;const read=navigator.clipboard.readText;navigator.clipboard.readText=()=>{navigator.clipboard.readText=read;heldRead=true;return new Promise(resolve=>resumeRead=()=>resolve('retired read'))}`);
  await wait(()=>a.evaluate('heldRead'));await a.evaluate('remoteXAppViewerClipboard.reset();resumeRead()');await delay(400);assert.equal(remoteRead(),before);assert.deepEqual((await state(a)).requested,{toRemote:'off',toLocal:'off'});
 });
 await check('disconnect and reconnect require new consent',async()=>{
  await modes(a);await click(a,'#disconnect');assert.deepEqual((await state(a)).requested,{toRemote:'off',toLocal:'off'});await click(a,'#reconnect');await ready(a);assert.deepEqual((await state(a)).requested,{toRemote:'off',toLocal:'off'});
 });
 await check('manual compatibility and explicit clear work after automatic reset',async()=>{
  await modes(a,'manual','manual');await localWrite(a,'manual compatibility');await gesture(a,'remoteXAppViewerClipboard.upload()');assert.equal(remoteRead(),'manual compatibility');await gesture(a,'remoteXAppViewerClipboard.clear()');await focus(a);await ctrl(a,'a','KeyA',65);await text(a,'clear sentinel');await ctrl(a,'v','KeyV',86);assert.equal(await save(a),'clear sentinel');
 });
 await check('no browser exceptions and no payloads in public clipboard snapshots',async()=>{
  for(const p of pages){assert.equal(p.events.filter(e=>e.method==='Runtime.exceptionThrown').length,0);const keys=Object.keys(await state(p));assert.equal(keys.some(k=>/text|preview|hash|fingerprint|payload/i.test(k)),false);}
 });
 completed=true;
 writeFileSync(out+'/standalone.png',Buffer.from((await a.call('Page.captureScreenshot')).data,'base64'));
} finally {
 writeFileSync(out+'/results.json',JSON.stringify({scope:'owned standalone browser/native text',status:completed&&results.length===13&&!results.some(r=>r.status==='fail')?'pass':'fail',cases:results},null,2));
 for(const p of pages){try{await p.evaluate('remoteXAppViewerClipboard.reset();window.resumeRead?.()');await p.call('Target.closeTarget',{targetId:p.page.id});}catch{}p.close();}
}
