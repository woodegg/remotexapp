// Public host SDK, real Manager/native display/Pulse/X11; synthetic content only.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {config,api,remote,open,wait,delay} from './host-browser.mjs';
import {chrome} from '../native-audio/browser-cdp.mjs';

const checks=[],views=[],owned=[],selectionOwners=[],wave=config.evidenceDirectory+'/synthetic-mic.wav';
execFileSync('python3',['-c',"import wave,math,struct,sys\nwith wave.open(sys.argv[1],'wb') as w:\n w.setparams((1,2,48000,0,'NONE','not compressed'));w.writeframes(b''.join(struct.pack('<h',int(10000*math.sin(2*math.pi*880*i/48000))) for i in range(48000*10)))",wave]);
remote(['python3','-c','from pathlib import Path;import sys;Path("/tmp/host-audio-probe.py").write_text(sys.stdin.read())'],readFileSync(new URL('./host-audio-probe.py',import.meta.url),'utf8'));
remote(['python3','-c','from pathlib import Path;import sys;Path("/tmp/host-rich-selection.py").write_text(sys.stdin.read())'],readFileSync(new URL('./rich-selection.py',import.meta.url),'utf8'));
const browser=await chrome(wave);config.cdpURL=browser.base;
const origin=new URL(config.ingressURL).origin;
const pass=name=>{checks.push({name,status:'passed'});console.log(name);};
async function page(options){
  const p=await open(config.ingressURL+'/rx/sdk/host.html');views.push(p);
  await wait(()=>p.evaluate("document.querySelector('#template')?.options.length===8"));
  await p.call('Browser.grantPermissions',{origin,permissions:['clipboardReadWrite','clipboardSanitizedWrite','audioCapture']});
  await p.evaluate(`(async()=>{
    window.streams=[];window.analysers=[];const Capture=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async c=>{const s=await Capture(c);streams.push(s);return s};
    const Worklet=AudioWorkletNode;window.AudioWorkletNode=class extends Worklet{constructor(c,n,o){super(c,n,o);if(n==='remotexapp-playback-v1'){const a=c.createAnalyser();a.fftSize=16384;this.connect(a);analysers.push(a);}}};
    const sdk=await import('./index.js');window.qHost=new sdk.RemoteXAppHost({baseURL:'/rx',scope:'host-channel-qualification'});
    window.qDisplay=document.createElement('div');qDisplay.style='position:fixed;inset:20px;z-index:100';document.body.append(qDisplay);
    window.qSession=await qHost.open(${JSON.stringify(options)});window.qViewer=await qSession.attach(qDisplay);window.qAudio=await qSession.audio();
  })()`);
  return p;
}
const audio=p=>p.evaluate('qHost.getAudioState()');
const probe=(id,op,...args)=>JSON.parse(remote(['runuser','-u',config.user,'--','python3','/tmp/host-audio-probe.py',id,op,...args.map(String)]));
const amplitude=(p,hz)=>p.evaluate(`(()=>{let peak=0;for(const a of analysers){const v=new Float32Array(a.fftSize);a.getFloatTimeDomainData(v);let r=0,j=0,w=0;for(let i=0;i<v.length;i++){const t=.5-.5*Math.cos(2*Math.PI*i/(v.length-1)),f=2*Math.PI*${hz}*i/48000;r+=v[i]*t*Math.cos(f);j+=v[i]*t*Math.sin(f);w+=t;}peak=Math.max(peak,2*Math.hypot(r,j)/w);}return peak;})()`);
async function xread(p,type){const descriptor=await p.evaluate('qSession.connections()');return Buffer.from(remote(['runuser','-u',config.user,'--','env','DISPLAY='+descriptor.environment.display,'XAUTHORITY='+descriptor.environment.xauthorityPath,'python3','-c','import subprocess,base64,sys;p=subprocess.run(["xclip","-selection","clipboard","-o","-t",sys.argv[1]],capture_output=True,timeout=3);print(base64.b64encode(p.stdout).decode())',type]).trim(),'base64');}
let failure;
try{
  const a=await page({templateId:'mousepad',keepAlive:true});const id=await a.evaluate('qSession.id');owned.push(id);
  const same=await page({instanceId:id}),other=await page({templateId:'mousepad',keepAlive:true});const otherId=await other.evaluate('qSession.id');owned.push(otherId);
  assert((await Promise.all(views.map(audio))).every(s=>s.connection==='idle'));
  assert((await Promise.all(views.map(p=>p.evaluate('streams.length+analysers.length')))).every(n=>n===0));
  pass('three host interests create no audio transport or device before explicit enable');
  await a.evaluate('qAudio.setSpeaker(true)',true);await same.evaluate('qAudio.setSpeaker(true)',true);await other.evaluate('qAudio.setSpeaker(true)',true);
  await wait(async()=>{const states=await Promise.all(views.map(audio));return states.every(s=>s.routes.filter(r=>r.actualSpeaker).length===2) && new Set(states.map(s=>s.connectionId)).size===1;});
  const states=await Promise.all(views.map(audio));assert.equal(states.filter(s=>s.speakerOwner).length,1);const playback=views[states.findIndex(s=>s.speakerOwner)];
  probe(id,'tone',440);await wait(async()=>await amplitude(playback,440)>.08,8000);
  probe(otherId,'tone',660);await wait(async()=>await amplitude(playback,660)>.08,8000);
  pass('two real session speakers and three tabs share one channel and one measured playback graph');
  const connection=(await audio(a)).connectionId;
  await same.evaluate('qAudio.setSpeaker(false)',true);await wait(async()=>!(await audio(a)).routes.find(r=>r.runtime===id).speaker);
  assert.equal((await audio(other)).connectionId,connection);assert((await audio(other)).routes.find(r=>r.runtime===otherId).actualSpeaker);
  pass('same-session speaker switch is shared while the other session remains connected');
  await a.evaluate('qAudio.setMicrophone(true)',true);await delay(500);
  assert(probe(id,'readback').tone880>500);assert(probe(otherId,'readback').tone880<20);
  await other.evaluate('qAudio.setMicrophone(true)',true);await delay(300);
  assert(probe(otherId,'readback').tone880>500);
  assert.equal((await Promise.all(views.map(p=>p.evaluate('streams.filter(s=>s.getTracks().some(t=>t.readyState==="live")).length')))).reduce((n,v)=>n+v,0),1);
  pass('one synthetic microphone capture reaches only explicitly selected remote sessions');
  await a.call('Page.bringToFront');await a.evaluate('qViewer.dispose();qViewer=null');assert.equal((await audio(a)).connectionId,connection);assert(probe(id,'readback').tone880>500);
  await a.evaluate('(async()=>{qViewer=await qSession.attach(qDisplay)})()');assert.equal((await audio(a)).connectionId,connection);
  pass('display unload and restore preserve separately owned audio without reconnect');
  await a.evaluate('qAudio.setMicrophone(false)',true);assert(probe(id,'readback').tone880<20);assert(probe(otherId,'readback').tone880>500);
  await other.evaluate('qAudio.setMicrophone(false)',true);await other.evaluate('qAudio.setSpeaker(false)',true);
  await wait(async()=>(await audio(a)).connection==='idle');
  assert((await Promise.all(views.map(p=>p.evaluate('streams.every(s=>s.getTracks().every(t=>t.readyState==="ended"))')))).every(Boolean));
  pass('last audio switch off releases the channel and every microphone track');

  await a.call('Page.bringToFront');await a.evaluate("qViewer.focus();qViewer.configureClipboard({toRemote:'manual',toLocal:'manual'})",true);
  assert.deepEqual(await a.evaluate('qViewer.getClipboardState().formats'),['text/plain','text/html','image/png']);
  await a.evaluate(`(async()=>{const c=document.createElement('canvas');c.width=64;c.height=48;const x=c.getContext('2d');x.fillStyle='#ff0000';x.fillRect(0,0,64,48);const png=await new Promise(r=>c.toBlob(r,'image/png'));await navigator.clipboard.write([new ClipboardItem({'text/plain':new Blob(['Host 中文 rich'],{type:'text/plain'}),'text/html':new Blob(['<b>Host 中文 rich</b>'],{type:'text/html'}),'image/png':png})]);})()`,true);
  assert.equal((await a.evaluate('qViewer.copyClipboardToRemote()',true)).status,'submitted');
  await wait(async()=>(await xread(a,'UTF8_STRING')).toString()==='Host 中文 rich');
  assert.match((await xread(a,'text/html')).toString(),/<b>/);const png=await xread(a,'image/png');assert.equal(png.readUInt32BE(16),64);assert.equal(png.readUInt32BE(20),48);
  pass('public host Viewer sends text HTML and PNG together to real X11 selection');
  const descriptor=await a.evaluate('qSession.connections()');
  const selection='/tmp/host-channel-selection-'+Date.now();
  remote(['python3','-c','from pathlib import Path;import sys;Path(sys.argv[1]).write_text(sys.stdin.read())',selection+'.json'],JSON.stringify({purpose:'synthetic-remotexapp-rich-clipboard',seconds:60,formats:{'text/plain':Buffer.from('Host remote 中文 rich').toString('base64'),'text/html':Buffer.from('<b>Host remote 中文 rich</b>').toString('base64'),'image/png':png.toString('base64')}}));
  const owner=Number(remote(['runuser','-u',config.user,'--','env','DISPLAY='+descriptor.environment.display,'XAUTHORITY='+descriptor.environment.xauthorityPath,'python3','-c',`import subprocess;p=subprocess.Popen(['python3','/tmp/host-rich-selection.py','--spec',${JSON.stringify(selection+'.json')},'--result',${JSON.stringify(selection+'.result')}],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True);print(p.pid)`]).trim());selectionOwners.push(owner);
  await wait(async()=>(await xread(a,'text/plain')).toString()==='Host remote 中文 rich');await delay(500);
  await a.evaluate("navigator.clipboard.writeText('replacement browser baseline')",true);
  assert.equal((await a.evaluate('qViewer.copyClipboardToLocal()',true)).status,'copied-to-local');
  assert.equal(await a.evaluate('navigator.clipboard.readText()'),'Host remote 中文 rich');
  assert.deepEqual(await a.evaluate('navigator.clipboard.read().then(x=>x[0].types.slice().sort())'),['image/png','text/html','text/plain']);
  pass('public host Viewer reads all remote representations back into browser clipboard');
  await a.evaluate("navigator.clipboard.writeText('x'.repeat(2097152))",true);await a.evaluate('qViewer.copyClipboardToRemote()',true);
  await wait(async()=>(await xread(a,'UTF8_STRING')).length===2097152);
  await a.evaluate("navigator.clipboard.writeText('x'.repeat(2097153))",true);
  assert.equal(await a.evaluate("qViewer.copyClipboardToRemote().then(()=>'',e=>e.code)",true),'clipboard-size');
  assert.equal((await xread(a,'UTF8_STRING')).length,2097152);
  pass('exact 2 MiB succeeds and one-byte excess preserves remote selection');
  await a.evaluate("navigator.clipboard.writeText('automatic baseline')",true);
  await a.evaluate("qViewer.configureClipboard({toRemote:'auto',toLocal:'auto'});qViewer.focus()",true);await wait(()=>a.evaluate('qViewer.getClipboardState().phase==="watching"'));
  await same.call('Page.bringToFront');await same.evaluate("qViewer.configureClipboard({toRemote:'auto',toLocal:'auto'});qViewer.focus()",true);await wait(()=>same.evaluate('qViewer.getClipboardState().phase==="watching"'));
  await same.evaluate("navigator.clipboard.writeText('same-session automatic')",true);await wait(async()=>(await xread(same,'UTF8_STRING')).toString()==='same-session automatic');
  assert.equal(await a.evaluate('qViewer.getClipboardState().active'),false);
  await other.call('Page.bringToFront');await other.evaluate("qViewer.configureClipboard({toRemote:'auto',toLocal:'auto'});qViewer.focus()",true);await wait(()=>other.evaluate('qViewer.getClipboardState().phase==="watching"'));
  await other.evaluate("navigator.clipboard.writeText('different-session automatic')",true);await wait(async()=>(await xread(other,'UTF8_STRING')).toString()==='different-session automatic');
  assert.equal((await xread(a,'UTF8_STRING')).toString(),'same-session automatic');
  pass('focused tab owns automatic clipboard and another session receives no fan-out');
  for(const p of views)await p.evaluate('qHost.dispose()');
  await wait(async()=>(await Promise.all(owned.map(id=>api('/api/instances/'+id)))).every(i=>i.attachedClients===0));
  assert(views.every(p=>!p.events.some(e=>e.method==='Runtime.exceptionThrown')));
  pass('disposing all hosts releases display and audio interests without browser exceptions');
}catch(error){failure=error.stack;console.error(failure);checks.push({name:'suite',status:'failed',error:error.name});}
finally{
  for(const p of views){await p.evaluate('qHost?.dispose()').catch(()=>{});await p.close().catch(()=>{});}
  await browser.close();
  for(const pid of selectionOwners)remote(['python3','-c',`from pathlib import Path;import os,signal;p=Path('/proc/${pid}/cmdline');p.exists() and b'/tmp/host-rich-selection.py' in p.read_bytes() and os.kill(${pid},signal.SIGTERM)`]);
  for(const id of owned){const i=await api('/api/instances/'+id);if(i.state!=='stopped')await api('/api/instances/'+id+'/stop',{force:true,sessionGeneration:i.sessionGeneration});}
  writeFileSync(config.evidenceDirectory+'/host-channels.json',JSON.stringify({schemaVersion:1,checks,status:failure?'failed':'passed',physicalDevices:'not-tested',humanAcceptance:'not-evaluated'},null,2));
}
if(failure)process.exitCode=1;
