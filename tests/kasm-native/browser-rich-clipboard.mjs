// Opt-in destructive-to-synthetic-content test: dedicated browser + disposable Writer.
// Uses real X11 ownership, INCR and application copy/paste; never exports payloads.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {current,config,instance,ctrl,delay,remote,wait,ready} from './browser-fixture.mjs';
assert.equal(instance.classId,'alpine-writer');
const c=await current(),owned=[],cases=[];
const wssRoundtrip=process.argv.includes('--wss-roundtrip');let display;
const resultDirectory=config.evidenceDirectory;mkdirSync(resultDirectory,{recursive:true});
const clipboardOrigin=config.publicOrigin || config.ingressURL;
assert(!config.publicOrigin || (config.projectOwnedDisposable && new URL(config.publicOrigin).protocol==='https:'));
const gesture=async expression=>{const r=await c.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
const xargs=[...(config.remoteExec?['chpst','-u',config.user+':'+config.user]:['runuser','-u',config.user,'--']),'env','DISPLAY='+instance.display,'XAUTHORITY='+config.xauthority];
const xread=type=>Buffer.from(remote([...xargs,'python3','-c','import subprocess,base64,sys;print(base64.b64encode(subprocess.check_output(["xclip","-selection","clipboard","-o","-t",sys.argv[1]])).decode())',type]).trim(),'base64');
const remoteLength=()=>Number(remote([...xargs,'python3','-c','import subprocess;print(len(subprocess.check_output(["xclip","-selection","clipboard","-o","-t","UTF8_STRING"])))']).trim());
const local=()=>c.evaluate('navigator.clipboard.readText()');
const helper='/tmp/remotexapp-rich-selection-'+crypto.randomUUID()+'.py';
remote(['python3','-c','from pathlib import Path;import sys;Path(sys.argv[1]).write_text(sys.stdin.read())',helper],readFileSync(new URL('./rich-selection.py',import.meta.url),'utf8'));
async function owner(formats,options={}){
 const stem='/tmp/rich-'+crypto.randomUUID(),spec=stem+'.json',result=stem+'.result';
 remote(['python3','-c','from pathlib import Path;import sys;Path(sys.argv[1]).write_text(sys.stdin.read())',spec],JSON.stringify({purpose:'synthetic-remotexapp-rich-clipboard',formats:Object.fromEntries(Object.entries(formats).map(([k,v])=>[k,Buffer.from(v).toString('base64')])),seconds:40,...options}));
 const code=`import subprocess\nf=open(${JSON.stringify(stem+'.log')},'w')\np=subprocess.Popen(['python3',${JSON.stringify(helper)},'--spec',${JSON.stringify(spec)},'--result',${JSON.stringify(result)}],stdout=f,stderr=f,start_new_session=True)\nprint(p.pid)`;
 const pid=Number(remote([...xargs,'python3','-c',code]).trim());owned.push({pid,stem});
 await wait(()=>{try{return JSON.parse(remote(['cat',result])).ready;}catch{return false;}},5000);
}
function pass(name){cases.push({name,status:'passed'});console.log('PASS '+name);}
try{
 await ready(c);
 if(wssRoundtrip){await gesture(`(()=>{const e=document.querySelector('#prefer-udp');if(e.checked)e.click()})()`);await wait(async()=>(await c.evaluate('remoteXAppViewerStats()')).transport==='wss');}
 await c.call('Browser.grantPermissions',{origin:clipboardOrigin,permissions:['clipboardReadWrite','clipboardSanitizedWrite']});
 assert.deepEqual((await c.evaluate('remoteXAppViewerClipboard.state()')).formats,['text/plain','text/html','image/png']);
 await gesture("remoteXAppViewerClipboard.configure({toRemote:'manual',toLocal:'manual'})");await c.evaluate('remoteXAppViewerClipboard.focus()');
 const previousWindow=remote([...xargs,'xdotool','getactivewindow']).trim();await ctrl(c,'n','KeyN',78);await wait(()=>remote([...xargs,'xdotool','getactivewindow']).trim()!==previousWindow,20000);await delay(500);
 await c.evaluate(`window.richClipboardOfferCount=0;window.richClipboardOfferObserver=new MutationObserver(()=>richClipboardOfferCount++);richClipboardOfferObserver.observe(document.querySelector('#clipboard-status'),{childList:true,characterData:true,subtree:true})`);
 await gesture(`navigator.clipboard.write([new ClipboardItem({'text/plain':new Blob(['Native 中文 rich test'],{type:'text/plain'}),'text/html':new Blob(['<b>Native 中文 rich test</b>'],{type:'text/html'})})])`);
 assert.equal((await gesture('remoteXAppViewerClipboard.upload()')).status,'submitted');
 await wait(()=>{try{return xread('UTF8_STRING').toString()==='Native 中文 rich test';}catch{return false;}},20000);const initialHTML=xread('text/html').toString();assert.match(initialHTML,/<b>/);
 await ctrl(c,'a','KeyA',65);await ctrl(c,'v','KeyV',86);await delay(700);const htmlTick=await c.evaluate('richClipboardOfferCount');await ctrl(c,'a','KeyA',65);await ctrl(c,'c','KeyC',67);await wait(async()=>await c.evaluate('richClipboardOfferCount')>htmlTick,15000);assert.notEqual(xread('text/html').toString(),initialHTML);
 assert.equal((await gesture('remoteXAppViewerClipboard.download()')).status,'copied-to-local');
 const html=await c.evaluate("navigator.clipboard.read().then(async items=>({types:items[0].types,text:await (await items[0].getType('text/plain')).text(),html:await (await items[0].getType('text/html')).text()}))");
 assert.match(html.text,/Native 中文 rich test/);assert.match(html.html,/font-weight:\s*(bold|700)|<b[ >]/i);pass('real Writer HTML paste and copy preserve text and bold in both directions');
 await gesture(`(async()=>{const canvas=document.createElement('canvas');canvas.width=64;canvas.height=48;const ctx=canvas.getContext('2d');ctx.fillStyle='#ff0000';ctx.fillRect(0,0,64,48);ctx.fillStyle='#0000ff';ctx.fillRect(20,12,20,20);const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);})()`);
 assert.equal((await gesture('remoteXAppViewerClipboard.upload()')).status,'submitted');await wait(()=>{try{return xread('image/png').readUInt32BE(16)===64;}catch{return false;}},20000);const png=xread('image/png');assert.equal(png.readUInt32BE(16),64);assert.equal(png.readUInt32BE(20),48);
 await ctrl(c,'End','End',35);await ctrl(c,'v','KeyV',86);await delay(1000);const pngTick=await c.evaluate('richClipboardOfferCount');await ctrl(c,'c','KeyC',67);await wait(async()=>await c.evaluate('richClipboardOfferCount')>pngTick,15000);
 assert.equal((await gesture('remoteXAppViewerClipboard.download()')).status,'copied-to-local');
 const image=await c.evaluate(`(async()=>{const blob=await (await navigator.clipboard.read())[0].getType('image/png');const image=await createImageBitmap(blob);const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return {width:image.width,height:image.height,pixel:[...ctx.getImageData(0,0,1,1).data]};})()`);
 assert.equal(image.width,64);assert.equal(image.height,48);assert.deepEqual(image.pixel,[255,0,0,255]);pass('real Writer PNG paste and copy preserve dimensions and pixels in both directions');
 if(config.publicOrigin&&!wssRoundtrip){
  let active=false;const until=Date.now()+30000;
  while(Date.now()<until){await ctrl(c,'a','KeyA',65);await delay(200);for(const type of ['keyDown','keyUp'])await c.call('Input.dispatchKeyEvent',{type,key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});await delay(300);const s=await c.evaluate('remoteXAppViewerStats()');if(s.transport==='webrtc-udp'&&s.udpReceivedBytes>0&&s.renderedFrames>0){active=true;break;}}
  assert(active,'No observed UDP display frames during rich clipboard use');
 }
 display=await c.evaluate(`(()=>{const s=remoteXAppViewerStats();return {state:s.state,transport:s.transport,udpBytes:s.udpReceivedBytes,frames:s.renderedFrames}})()`);
 writeFileSync(join(resultDirectory,wssRoundtrip?'rich-writer-wss.png':'rich-writer.png'),Buffer.from((await c.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
 if(!wssRoundtrip){
 await gesture("navigator.clipboard.writeText('snapshot baseline')");await gesture("remoteXAppViewerClipboard.configure({toRemote:'off',toLocal:'auto'})");await c.evaluate('remoteXAppViewerClipboard.focus()');await wait(async()=>(await c.evaluate('remoteXAppViewerClipboard.state().phase'))==='watching');
 await owner({'text/plain':'three formats','text/html':'<b>three formats</b>','image/png':png});await wait(async()=>await local()==='three formats');assert.deepEqual((await c.evaluate('navigator.clipboard.read().then(x=>[...x[0].types].sort())')),['image/png','text/html','text/plain']);pass('one remote item retains all three representations');
 await gesture("navigator.clipboard.writeText('snapshot baseline')");await gesture("remoteXAppViewerClipboard.configure({toRemote:'off',toLocal:'auto'})");await c.evaluate('remoteXAppViewerClipboard.focus()');await delay(300);
 // Observe every browser write. Remote fixture RPC time can exceed the injected
 // delay over a WAN, so a fixed sleep after owner() is not a valid partial-state
 // assertion. No write may publish only the early text representation.
 await c.evaluate(`window.richObservedWrites=[];window.richOriginalWrite=navigator.clipboard.write;navigator.clipboard.write=function(items){richObservedWrites.push(items.map(item=>[...item.types].sort()));return richOriginalWrite.call(this,items)}`);
 await owner({'text/plain':'snapshot complete','text/html':'<b>snapshot complete</b>'},{delay:{'text/html':1}});await wait(async()=>await local()==='snapshot complete');assert.deepEqual(await c.evaluate('richObservedWrites'),[[['text/html','text/plain']]]);
 await c.evaluate('navigator.clipboard.write=richOriginalWrite;delete window.richOriginalWrite');pass('delayed representation commits atomically');
 // Browser normalization must not bounce the normalized HTML back into X11.
 await gesture("remoteXAppViewerClipboard.configure({toRemote:'auto',toLocal:'auto'})");await c.evaluate('remoteXAppViewerClipboard.focus()');await delay(300);
 await owner({'text/plain':'normalized','text/html':'<b>normalized</b>'});await wait(async()=>await local()==='normalized');await delay(700);assert.equal(xread('text/html').toString(),'<b>normalized</b>');pass('browser HTML normalization does not echo to X11');
 await gesture("remoteXAppViewerClipboard.configure({toRemote:'off',toLocal:'auto'})");
 const exact='x'.repeat(2097152);await owner({'text/plain':exact},{chunkBytes:16384});await wait(async()=>await c.evaluate('navigator.clipboard.readText().then(x=>x.length)')===2097152,10000);pass('remote exact 2 MiB INCR succeeds');
 await owner({'text/plain':'oversize must not leak','text/html':exact},{chunkBytes:16384});await delay(1500);assert.equal((await local()).length,2097152);pass('aggregate oversize preserves browser destination');
 await owner({'text/plain':'timeout must not leak','text/html':'<b>late</b>'},{delay:{'text/html':6}});await delay(6500);assert.equal((await local()).length,2097152);pass('timeout and late response preserve browser destination');
 await owner({'text/plain':'failed must not leak','text/html':'<b>failed</b>'},{failTarget:'text/html'});await delay(700);assert.equal((await local()).length,2097152);pass('failed later representation cannot publish partial text');
 await owner({'STRING':Buffer.from([65,0,66])});await delay(700);assert.equal((await local()).length,2097152);pass('embedded NUL in legacy STRING cannot truncate and publish text');
 await owner({'text/plain':'file selection','text/uri-list':'file:///synthetic-only.txt'});await delay(700);assert.equal((await local()).length,2097152);pass('file-manager URI selection is excluded');
 await owner({'text/plain':'stale owner','text/html':'<b>stale</b>'},{delay:{'text/html':1}});await delay(150);await owner({'text/plain':'new owner','text/html':'<b>new owner</b>'});await wait(async()=>await local()==='new owner');await delay(1300);assert.equal(await local(),'new owner');pass('replacement owner cannot mix or replay stale representations');
 await gesture("remoteXAppViewerClipboard.configure({toRemote:'manual',toLocal:'off'})");await gesture("navigator.clipboard.writeText('x'.repeat(2097152))");assert.equal((await gesture('remoteXAppViewerClipboard.upload()')).status,'submitted');await wait(()=>remoteLength()===2097152,20000);pass('browser exact 2 MiB succeeds');
 await gesture("navigator.clipboard.writeText('x'.repeat(2097153))");assert.equal(await gesture("remoteXAppViewerClipboard.upload().then(()=>'',e=>e.code)"),'clipboard-size');assert.equal(remoteLength(),2097152);pass('browser one-byte oversize preserves remote destination');
 await gesture("navigator.clipboard.writeText('')");assert.equal((await gesture('remoteXAppViewerClipboard.upload()')).status,'empty-noop');assert.equal(remoteLength(),2097152);pass('empty upload is a no-op');
 assert.equal((await gesture('remoteXAppViewerClipboard.clear()')).status,'submitted');await wait(()=>remoteLength()===0,20000);pass('explicit clear replaces owned remote selection');
 }
}catch(e){cases.push({name:'suite stopped',status:'failed',error:e.code||e.name});console.error(e.name+': '+String(e.message).split('\n')[0]);process.exitCode=1;}finally{
 await c.evaluate('if(window.richOriginalWrite){navigator.clipboard.write=richOriginalWrite;delete window.richOriginalWrite}window.richClipboardOfferObserver?.disconnect();remoteXAppViewerClipboard.reset()').catch(()=>{});c.close();
 for(const {pid,stem} of owned)remote(['python3','-c',`from pathlib import Path\nimport os,signal\np=Path('/proc/${pid}/cmdline')\nif p.exists() and ${JSON.stringify(helper)}.encode() in p.read_bytes():os.kill(${pid},signal.SIGTERM)\nfor suffix in ['.json','.result','.log']:\n p=Path(${JSON.stringify(stem)}+suffix)\n if p.exists():p.unlink()`]);
 remote(['python3','-c','from pathlib import Path;import sys;Path(sys.argv[1]).unlink(missing_ok=True)',helper]);
 writeFileSync(join(resultDirectory,wssRoundtrip?'rich-wss-results.json':'rich-clipboard-results.json'),JSON.stringify({schema:1,scope:'dedicated-browser-disposable-writer',status:process.exitCode?'failed':'passed',cases,display,physicalUAT:'not-run'},null,2)+'\n');
}
