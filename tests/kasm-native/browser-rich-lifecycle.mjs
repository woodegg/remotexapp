// Synthetic rich payloads across real same-runtime and different-runtime tabs.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {config,instance,current,open,ready,api,delay,wait,remote} from './browser-fixture.mjs';
const a=await current(),views=[a],results=[];let other;
const origin=config.publicOrigin||config.ingressURL;
assert(!config.publicOrigin||(config.projectOwnedDisposable&&new URL(origin).protocol==='https:'));
const runtimeAPI=(path,options={})=>config.publicOrigin?a.evaluate(`fetch(${JSON.stringify(config.basePath+path)},${JSON.stringify({...options,headers:{'Content-Type':'application/json'}})}).then(async r=>{if(!r.ok)throw Error('Fixture API '+r.status);return r.json()})`):api(path,options);
const gesture=async(c,expression)=>{const r=await c.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
const state=c=>c.evaluate('remoteXAppViewerClipboard.state()');
const modes=async(c)=>{await c.call('Page.bringToFront');await gesture(c,"remoteXAppViewerClipboard.configure({toRemote:'auto',toLocal:'auto'})");await c.evaluate('remoteXAppViewerClipboard.focus()');await wait(async()=>(await state(c)).phase==='watching');};
const rich=(c,text)=>gesture(c,`navigator.clipboard.write([new ClipboardItem({'text/plain':new Blob([${JSON.stringify(text)}],{type:'text/plain'}),'text/html':new Blob(['<b>'+${JSON.stringify(text)}+'</b>'],{type:'text/html'})})])`);
function read(app,type='UTF8_STRING') {const auth=config.xauthority.split('/profiles/')[0]+'/profiles/'+app.classId+'/default/'+app.id+'/.Xauthority';return JSON.parse(remote([...(config.remoteExec?['chpst','-u',config.user+':'+config.user]:['runuser','-u',config.user,'--']),'env','DISPLAY='+app.display,'XAUTHORITY='+auth,'python3','-c','import subprocess,json,sys;p=subprocess.run(["xclip","-selection","clipboard","-o","-t",sys.argv[1]],capture_output=True,text=True,timeout=3);print(json.dumps(p.stdout if p.returncode==0 else None))',type]));}
const pass=name=>{results.push({name,status:'pass'});console.log('PASS '+name);};
try{
 await ready(a);await a.call('Browser.grantPermissions',{origin,permissions:['clipboardReadWrite','clipboardSanitizedWrite']});await gesture(a,"navigator.clipboard.writeText('lifecycle baseline')");await modes(a);await rich(a,'first rich');await wait(()=>read(instance)==='first rich');assert.match(read(instance,'text/html'),/<b>/);pass('automatic rich submission reaches native selection');
 const b=await open(origin+config.basePath+instance.viewerUrl);views.push(b);await ready(b);await modes(b);assert.equal((await state(a)).active,false);await rich(b,'second rich');await wait(()=>read(instance)==='second rich');assert.match(read(instance,'text/html'),/second rich/);pass('same-runtime second tab owns rich synchronization without background fan-out');
 other=await runtimeAPI('/api/instances',{method:'POST',body:JSON.stringify({templateId:'alpine-writer'})});writeFileSync(config.evidenceDirectory+'/rich-lifecycle-owned-private.json',JSON.stringify({id:other.id}));const d=await open(origin+config.basePath+other.viewerUrl);views.push(d);await ready(d);await modes(d);await rich(d,'different rich');await wait(()=>read(other)==='different rich');assert.equal(read(instance),'second rich');assert.equal((await state(b)).active,false);pass('different runtime gets only its focused rich transaction');
 await a.call('Page.bringToFront');await a.evaluate('remoteXAppViewerClipboard.focus()');await wait(async()=>(await state(a)).phase==='watching');await delay(400);assert.equal(read(instance),'second rich');assert.equal(read(other),'different rich');pass('returning focus establishes baseline without replaying another runtime payload');
 await a.evaluate('remoteXAppViewerClipboard.blur()');await rich(a,'outside rich');await delay(400);assert.equal(read(instance),'second rich');pass('outside Viewer focus does not automatically change remote rich selection');
 await a.evaluate('remoteXAppViewerClipboard.focus()');await delay(400);assert.equal(read(instance),'second rich');await gesture(a,'remoteXAppViewerClipboard.upload()');await wait(()=>read(instance)==='outside rich');pass('explicit paste choice after return transfers current rich item');
 await a.evaluate('remoteXAppViewerClipboard.reset()');assert.deepEqual((await state(a)).requested,{toRemote:'off',toLocal:'off'});await rich(a,'reset rich');await delay(400);assert.equal(read(instance),'outside rich');pass('reset revokes both rich directions');
}catch(e){results.push({name:'suite stopped',status:'fail',error:e.name});console.error(e.message,JSON.stringify(await state(a)));process.exitCode=1;}finally{
 if(other)await runtimeAPI('/api/instances/'+other.id+'/stop',{method:'POST',body:'{}'});
 for(const v of views){await v.evaluate('remoteXAppViewerClipboard.reset()').catch(()=>{});v.close();if(v!==a)await fetch(config.cdpURL+'/json/close/'+v.page.id).catch(()=>{});}
 writeFileSync(config.evidenceDirectory+'/rich-lifecycle-results.json',JSON.stringify({status:process.exitCode?'fail':'pass',results},null,2));
}
