// Real Pulse domains and product SDK/SharedWorker/AudioWorklet, synthetic mic.
// No physical device quality or product App/Manager adoption is inferred.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {chrome,page,until,delay} from './browser-cdp.mjs';
const [fixtureFile,wav,output]=process.argv.slice(2);
if (![fixtureFile,wav,output].every(isAbsolute)) throw Error('Supply absolute fixture, synthetic WAV and private output paths');
await mkdir(output,{recursive:true,mode:0o700});
const fixture=JSON.parse(await readFile(fixtureFile,'utf8'));const origin=fixture.url;
const checks=[],browsers=[],pages=[];let failure;
const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log(name);};
async function hook(name,runtime='session-a',route='mic',frequency=880){const r=await fetch(origin+'/fixture/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runtime,route,frequency})});if(!r.ok)throw Error('fixture '+name+' failed');return r.json();}
async function makePage(browser) {
 const p=await page(browser,origin);pages.push(p);
 await p.call('Browser.setPermission',{permission:{name:'microphone'},setting:'granted',origin});
 await p.evaluate(`window.audioEvents=[];window.streams=[];window.contexts=[];
 const ActualContext=AudioContext;window.AudioContext=class extends ActualContext{constructor(...args){super(...args);contexts.push(this);}};
 const actualCapture=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async c=>{const stream=await actualCapture(c);streams.push(stream);return stream;};
 const {RemoteXAppAudio}=await import('/sdk/remotexapp-audio.js');window.audio=new RemoteXAppAudio({baseURL:location.origin,microphoneProcessing:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});audio.addEventListener('statechange',e=>{audioEvents.push(e.detail);if(audioEvents.length>100)audioEvents.shift();});await audio.ready;`);
 return p;
}
const state=p=>p.evaluate('audio.stats');
async function acquire(p,id,name){await p.evaluate(`window.${name}=await audio.acquire({id:${JSON.stringify(id)},sessionGeneration:1})`);}
async function speaker(p,name,enabled){return p.evaluate(`await ${name}.setSpeaker(${enabled})`,true);}
async function mic(p,name,enabled,takeover=false){return p.evaluate(`await ${name}.setMicrophone(${enabled},{takeover:${takeover}})`,true);}
async function amplitude(p,frequency){return p.evaluate(`(()=>{if(!window.analyser){analyser=audio.context.createAnalyser();analyser.fftSize=16384;audio.playback.connect(analyser);}const values=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(values);let re=0,im=0,weights=0;for(let i=0;i<values.length;i++){const w=.5-.5*Math.cos(2*Math.PI*i/(values.length-1));const phase=2*Math.PI*${frequency}*i/48000;re+=values[i]*w*Math.cos(phase);im+=values[i]*w*Math.sin(phase);weights+=w;}return 2*Math.hypot(re,im)/weights;})()`);}
try {
 const b=await chrome(wav);browsers.push(b);const a=await makePage(b),same=await makePage(b),other=await makePage(b);
 await acquire(a,'session-a','appA');await acquire(same,'session-a','sameA');await acquire(other,'session-b','appB');
 check('acquiring three interests opens no audio channel',(await hook('state')).connections===0);
 check('no audio device before explicit action',await a.evaluate('contexts.length===0&&streams.length===0'));
 await speaker(a,'appA',true);
 await until(async()=> (await hook('state')).connections===1);
 check('first speaker creates one WSS',(await hook('state')).readers===1);
 await speaker(same,'sameA',true);await speaker(other,'appB',true);
 const topology=await hook('state');console.log('topology',topology);check('two sessions and three tabs reuse one WSS',topology.connections===1&&topology.readers===2);
 const states=await Promise.all([a,same,other].map(state));check('exactly one playback owner',states.filter(s=>s.speakerOwner).length===1);
 const tone=hook('tone','session-a','speaker',440);await delay(500);let observed=0;for(let i=0;i<8;i++){observed=Math.max(observed,await amplitude(a,440));await delay(100);}await tone;
 check('remote 440 Hz reaches actual browser playback graph',observed>.08);
 const toneB=hook('tone','session-b','speaker',660);await delay(500);observed=0;for(let i=0;i<8;i++){observed=Math.max(observed,await amplitude(a,660));await delay(100);}await toneB;
 check('second session 660 Hz reaches shared playback graph',observed>.08);
 await speaker(same,'sameA',false);await until(async()=> (await hook('state')).readers===1);
 check('same-session off is shared across tabs',(await state(a)).routes.find(r=>r.runtime==='session-a').speaker===false);
 check('turning off A preserves B and shared channel',(await hook('state')).connections===1);
 await mic(a,'appA',true);await delay(500);
 const readA=await hook('readback','session-a');const readB=await hook('readback','session-b');
 check('880 Hz synthetic browser mic is read back in selected remote session',readA.amplitude>1000);
 check('unselected session mic stays silent',readB.amplitude<10);
 await mic(other,'appB',true);check('multi-target mic uses exactly one capture',(await Promise.all([a,same,other].map(p=>p.evaluate('streams.filter(s=>s.getTracks().some(t=>t.readyState==="live")).length')))).reduce((a,b)=>a+b,0)===1);
 const multiReadback=await hook('readback','session-b');console.log('synthetic multi-target readback',multiReadback);check('multi-target remote readback works',multiReadback.amplitude>1000);
 await mic(a,'appA',false);check('disabling A mic preserves B mic',(await hook('readback','session-a')).amplitude<10&&(await hook('readback','session-b')).amplitude>1000);
 const b2=await chrome(wav);browsers.push(b2);const contender=await makePage(b2);await acquire(contender,'session-b','targetB');
 const conflict=await mic(contender,'targetB',true);check('other browser profile sees explicit writer conflict',conflict.reason==='mic-conflict'&&!conflict.actualMic);
 await until(()=>contender.evaluate('streams.every(s=>s.getTracks().every(t=>t.readyState==="ended"))'));
 check('rejected writer releases its capture',await contender.evaluate('streams.every(s=>s.getTracks().every(t=>t.readyState==="ended"))'));
 await mic(contender,'targetB',true,true);await until(async()=>!(await state(other)).routes.find(r=>r.runtime==='session-b').mic);
 check('explicit takeover revokes previous target writer',(await hook('readback','session-b')).amplitude>1000);
 await until(()=>a.evaluate('streams.every(s=>s.getTracks().every(t=>t.readyState==="ended"))'));
 check('last lost mic target releases previous capture',await a.evaluate('streams.every(s=>s.getTracks().every(t=>t.readyState==="ended"))'));
 await contender.close();pages.splice(pages.indexOf(contender),1);await until(async()=> (await hook('state')).writers===0);
 check('capture owner tab closure releases remote writer',(await hook('state')).writers===0);
 await speaker(other,'appB',false);await until(async()=> (await hook('state')).connections===0);
 check('all audio off releases WSS/readers/writers',JSON.stringify(await hook('state'))===JSON.stringify({connections:0,readers:0,writers:0}));

 await speaker(a,'appA',true);await mic(a,'appA',true);
 await a.call('Browser.setPermission',{permission:{name:'microphone'},setting:'denied',origin});
 await until(async()=>!(await state(a)).routes.find(r=>r.runtime==='session-a').actualMic && (await hook('state')).writers===0);
 check('revoking active microphone permission retires writer and preserves speaker',(await hook('state')).readers===1&&(await hook('state')).connections===1);
 const capturesBeforeRestore=await a.evaluate('streams.length');
 await a.call('Browser.setPermission',{permission:{name:'microphone'},setting:'granted',origin});await delay(500);
 check('restoring permission does not silently reopen microphone',await a.evaluate('streams.length === '+capturesBeforeRestore+' && streams.every(s=>s.getTracks().every(t=>t.readyState==="ended"))'));
 await speaker(a,'appA',false);await until(async()=>(await hook('state')).connections===0);
 await a.call('Browser.setPermission',{permission:{name:'microphone'},setting:'denied',origin});
 let denied=false;try{await mic(a,'appA',true);}catch{denied=true;}
 check('permission denial is explicit and opens no audio WSS',denied&&(await hook('state')).connections===0);
 await a.call('Browser.setPermission',{permission:{name:'microphone'},setting:'granted',origin});
 await a.evaluate(`window.realCapture=navigator.mediaDevices.getUserMedia;navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>window.releasePermission=resolve);window.pendingMic=appA.setMicrophone(true).then(()=>"enabled",()=>"cancelled");`,true);
 await until(()=>a.evaluate('typeof releasePermission === "function"'));
 await mic(a,'appA',false);
 await a.evaluate('window.lateStream=await realCapture({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});releasePermission(lateStream);navigator.mediaDevices.getUserMedia=realCapture;');
 await until(()=>a.evaluate('lateStream.getTracks().every(t=>t.readyState==="ended")'));
 check('late permission after cancellation releases tracks',await a.evaluate('await pendingMic === "cancelled" && lateStream.getTracks().every(t=>t.readyState==="ended")'));
 await speaker(a,'appA',true);await mic(a,'appA',true);
 const beforeDomain=(await state(a)).routes.find(r=>r.runtime==='session-a').domain;
 await hook('restart-domain','session-a');
 await until(async()=>{const r=(await state(a)).routes.find(r=>r.runtime==='session-a');return r.domain!==beforeDomain&&r.actualSpeaker&&!r.mic;},20000);
 check('audio domain replacement fences old mic and restores speaker without recapture',await a.evaluate('streams.every(s=>s.getTracks().every(t=>t.readyState==="ended"))'));
 const newTone=hook('tone','session-a','speaker',440);const recovered=[];for(let i=0;i<18;i++){await delay(100);recovered.push(await amplitude(a,440));}await newTone;console.log('replacement playback windows',recovered);check('replacement domain produces real playback',recovered.filter(x=>x>.08).length>=2);
 await speaker(same,'sameA',true);
 await a.close();pages.splice(pages.indexOf(a),1);
 await until(async()=>(await state(same)).speakerOwner);
 await amplitude(same,440);const handoffTone=hook('tone','session-a','speaker',440);const handedOff=[];for(let i=0;i<18;i++){await delay(100);handedOff.push(await amplitude(same,440));}await handoffTone;check('closing playback owner hands off once to an unlocked tab',handedOff.filter(x=>x>.08).length>=2);
 await same.evaluate('await sameA.release()');await until(async()=>(await hook('state')).connections===0);
 check('last session reference releases its speaker and channel',(await hook('state')).readers===0);
 await other.call('Browser.setPermission',{permission:{name:'microphone'},setting:'granted',origin});
 await speaker(other,'appB',true);await mic(other,'appB',true);
 const workers=await fetch(b.base+'/json/list').then(r=>r.json());
 const worker=workers.find(t=>t.type==='shared_worker'&&t.url===origin+'/sdk/audio-worker.js');
 assert.ok(worker,'owned audio SharedWorker target exists');
 const debugWorker=new WebSocket(worker.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{debugWorker.onopen=resolve;debugWorker.onerror=reject;});
 debugWorker.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:'self.close()'}}));await delay(100);debugWorker.close();
 await until(()=>other.evaluate('audio.closed && streams.every(s=>s.getTracks().every(t=>t.readyState==="ended"))'),15000);
 await until(async()=>JSON.stringify(await hook('state'))===JSON.stringify({connections:0,readers:0,writers:0}));
 check('silent SharedWorker exit ends capture, playback and remote relays',(await state(other)).connection==='failed');
 await other.evaluate(`const {RemoteXAppAudio}=await import('/sdk/remotexapp-audio.js');window.audio=new RemoteXAppAudio({baseURL:location.origin,microphoneProcessing:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});await audio.ready;window.recoveredB=await audio.acquire({id:'session-b',sessionGeneration:1});`);
 check('new controller after worker failure starts with audio off',(await hook('state')).connections===0);
 await speaker(other,'recoveredB',true);await mic(other,'recoveredB',true);
 check('explicit controller recreation restores real microphone readback',(await hook('readback','session-b')).amplitude>1000);
 await hook('retire-generation','session-b');
 await until(async()=>JSON.stringify(await hook('state'))===JSON.stringify({connections:0,readers:0,writers:0}));
 check('server retirement of final App closes shared channel and microphone',await other.evaluate('audio.stats.connection==="idle" && streams.every(s=>s.getTracks().every(t=>t.readyState==="ended"))'));
 await other.evaluate('await recoveredB.release()');
 check('browser exceptions absent',pages.every(p=>p.errors.length===0));
} catch(error) {failure=error.stack;console.error(failure);for(let i=0;i<pages.length;i++){try{console.error('page',i,await state(pages[i]),pages[i].errors);}catch{}}}
finally {
 for(const p of pages){try{await p.evaluate('audio?.dispose()');await p.close();}catch{}}
 for(const b of browsers)await b.close();
 await delay(400);
 const cleanup=await hook('state');await writeFile(join(output,'results.json'),JSON.stringify({schema:1,scope:'real-pulse-product-sdk-synthetic-chrome',passed:!failure,checks,failure,cleanup,notQualified:['physical devices','WAN','full Manager App lifecycle','long soak']},null,2)+'\n');
}
if(failure)process.exitCode=1;
