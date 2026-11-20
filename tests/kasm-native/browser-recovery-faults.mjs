// Recovery facade and visible SDK panel qualification on an owned disposable fixture.
// Usage: node browser-recovery-faults.mjs /absolute/fixture.json MODE
// MODE: manager-crash | short-outage | lease-outage | lease-503 | lease-timeout
//       lease-401 | lease-403 | lease-409 | lease-exhausted | lease-cancelled
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFileSync, writeFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chrome} from '../native-audio/browser-cdp.mjs';

const original = JSON.parse(readFileSync(process.argv[2], 'utf8'));
assert.equal(original.purpose, 'remotexapp-native-host-disposable');
assert.equal(original.projectOwnedDisposable, true);
assert.match(original.container, /^remotexapp-host-[a-z0-9-]+$/);
assert.equal(original.user, 'rxhost');
assert(original.evidenceDirectory.startsWith('/tmp/remotexapp-host-'));
const mode = process.argv[3];
assert(['manager-crash','short-outage','lease-outage','lease-429','lease-500','lease-502','lease-503','lease-504','lease-timeout',
  'lease-401','lease-403','lease-409','lease-exhausted','lease-cancelled',
  'restart','restart-cancel','restart-refused','restart-response-loss','replacement','release-backoff','cycles','chained','initial-create-response-loss','initial-create-manager-crash'].includes(mode));
const upstream = new URL(original.ingressURL);
assert.equal(upstream.hostname, '127.0.0.1');
let outage = false, injectLease = false, leaseFaultSeenAt, restartFault = false, initialFault = false, createdId, creations = 0;
const createdIds=new Set(),mutationResponses=[];
const requests = {lease:0,grant:0,prepare:0,restart:0}, heldResponses = new Set();
const sockets = new Set();
const options = r => ({hostname:upstream.hostname, port:upstream.port, path:r.url, method:r.method, headers:r.headers});
const server = http.createServer((req, res) => {
  const action = req.url.split('?')[0].split('/').at(-1);
  const create=req.method==='POST' && action==='instances';if(create)creations++;
  if (Object.hasOwn(requests, action)) requests[action]++;
  if (injectLease && action === 'lease') {
    injectLease = false; leaseFaultSeenAt = Date.now(); req.resume();
    if (mode === 'lease-timeout') {
      heldResponses.add(res); res.on('close', () => heldResponses.delete(res)); return;
    }
    res.writeHead(Number(mode.slice('lease-'.length)), {'Content-Type':'application/json'});
    res.end(JSON.stringify({error:'test-only lease failure'})); return;
  }
  if (restartFault && action === 'restart' && mode === 'restart-refused') {
    req.resume(); res.writeHead(409, {'Content-Type':'application/json'});
    res.end(JSON.stringify({error:'test-only restart refusal'})); return;
  }
  if (outage) { res.writeHead(503); res.end(); return; }
  const q = http.request(options(req), r => {
    if(create || action==='restart')mutationResponses.push({action,status:r.statusCode});
    if(initialFault && create && r.statusCode===201) {
      const chunks=[];r.on('data',c=>chunks.push(c));r.on('end',async()=>{createdId=JSON.parse(Buffer.concat(chunks).toString()).id;if(createdId)createdIds.add(createdId);if(mode==='initial-create-manager-crash'){const pid=managerPID();user(['systemctl','--user','kill','--kill-whom=main','--signal=KILL','remotexapp-host.service']);await wait(async()=>{try{return managerPID()!=='0'&&managerPID()!==pid&&await api('/readyz');}catch{return false;}},30000);}res.destroy();});return;
    }
    if (restartFault && action === 'restart' && mode === 'restart-response-loss') {
      r.resume(); r.on('end',()=>res.destroy()); return;
    }
    res.writeHead(r.statusCode, r.headers); r.pipe(res);
  });
  q.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(q);
});
server.on('connection', socket => {
  sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
});
server.on('upgrade', (req, socket, head) => {
  if (outage) { socket.end('HTTP/1.1 503 Outage\r\n\r\n'); return; }
  const q = http.request(options(req));
  q.on('upgrade', (res, remote, remoteHead) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\n' + Object.entries(res.headers).map(([k,v]) => k+': '+v+'\r\n').join('')+'\r\n');
    if (head.length) remote.write(head); if (remoteHead.length) socket.write(remoteHead);
    remote.pipe(socket); socket.pipe(remote);
    socket.on('error', () => remote.destroy()); remote.on('error', () => socket.destroy());
    socket.on('close', () => remote.destroy()); remote.on('close', () => socket.destroy());
  });
  q.on('response', r => { socket.end('HTTP/1.1 '+r.statusCode+' Rejected\r\n\r\n'); r.resume(); });
  q.on('error', () => socket.destroy()); q.end();
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chrome(''), temp = mkdtempSync(join(tmpdir(), 'rxa-host-fault-'));
process.argv[2] = join(temp, 'fixture.json');
writeFileSync(process.argv[2], JSON.stringify({...original, cdpURL:browser.base,
  ingressURL:'http://127.0.0.1:'+server.address().port}));
const {api, remote, open, wait, delay, click} = await import('./host-browser.mjs');
const b = await open('http://127.0.0.1:'+server.address().port+'/rx/sdk/host.html');
const file = '/home/rxhost/documents/fault-'+mode+'-'+Date.now()+'.txt';
const checks = [], startedAt = new Date().toISOString();
let owned, failure, before, services, observedSDKVersion, offline = false, recoveryMs, protectedStop = false, replaced = false;
const user = args => remote(['runuser','-u','rxhost','--','env','XDG_RUNTIME_DIR=/run/user/1004',
  'DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1004/bus', ...args]);
const managerPID = () => user(['systemctl','--user','show','remotexapp-host.service','-p','MainPID','--value']).trim();
const state = () => b.evaluate('w.getState()');
const action = async kind => {
  await wait(async()=>{const x=await state();return !x.busy && x.actions.some(a=>a.kind===kind);});
  await click(b,`[data-recovery-action="${kind}"]`);
  await wait(async()=>!(await state()).busy);
};
const pass = name => checks.push({name,result:'passed'});
try {
  if(original.expectedCoreCommit)assert.equal((await api('/api/version')).commit,original.expectedCoreCommit);
  remote(['runuser','-u','rxhost','--','python3','-c',
    'from pathlib import Path;import sys;Path(sys.argv[1]).touch(exist_ok=False)', file]);
  await wait(() => b.evaluate("!!window.remoteXAppHostWorkbench && document.querySelector('#template')?.options.length>0"));
  observedSDKVersion = await b.evaluate("import('./index.js').then(s=>s.SDK_VERSION)");
  if (original.expectedSDKVersion) assert.equal(observedSDKVersion, original.expectedSDKVersion);
  await b.call('Network.enable');
  initialFault=mode.startsWith('initial-create-');
  await b.evaluate(`(async()=>{
    const sdk=await import('./index.js');
    window.sdkMutationCalls=[];const manager=new sdk.RemoteXAppManager({baseURL:'/rx',fetchImpl:(url,options)=>{if(options.method==='POST')sdkMutationCalls.push(url.split('/').at(-1));return fetch(url,options);}});
    window.h=new sdk.RemoteXAppHost({manager,scope:'fault-regression'});
    const d=document.createElement('div');d.style='position:fixed;inset:20px;z-index:300';document.body.append(d);
    window.w=h.mount(d,{templateId:'mousepad',parameters:{filePath:${JSON.stringify(file)}},keepAlive:true});
    Object.defineProperty(window,'s',{get:()=>w.session});Object.defineProperty(window,'v',{get:()=>w.viewer});
    await w.settled;if(${initialFault})return;if(!w.getState().displayReady)throw Error('mount did not become ready: '+JSON.stringify(w.getState()));
    v.sendText('saved before faults 中文');v.sendKey('s',{modifiers:['Control']});
  })()`);
  if(initialFault){
    owned=createdId;assert(owned);assert.equal((await state()).reason,'launch-uncertain');
    assert.equal((await state()).displayReady,false);assert.equal(createdIds.size,1);assert.equal(mutationResponses.filter(x=>x.action==='instances'&&x.status===201).length,1);assert.equal(await b.evaluate("sdkMutationCalls.filter(x=>x==='instances').length"),1);const createCount=creations;
    await action('refresh');await delay(2000);assert.equal(creations,createCount);
    assert(!(await state()).actions.some(a=>['retry','restart','reattach'].includes(a.kind)));
    pass('lost create response leaves uncertain launch without duplicate create or guessed attachment');
  }else{
  owned = await b.evaluate('s.id');
  await wait(() => remote(['cat',file]) === 'saved before faults 中文');
  before = await api('/api/instances/'+owned);
  services = remote(['cat','/home/rxhost/state/instances/'+owned+'/session-services.json']);
  const epoch = await b.evaluate('v.getStats().connectionEpoch');
  let resumed = Date.now();
  if (['restart','restart-cancel','restart-refused','restart-response-loss'].includes(mode)) {
    await b.evaluate('v.disconnect()'); await action('refresh');
    await action('restart');
    assert((await state()).confirmation); assert.equal(requests.restart,0);
    const shot=await b.call('Page.captureScreenshot',{format:'png'});
    writeFileSync(join(original.evidenceDirectory,'recovery-'+mode+'.png'),Buffer.from(shot.data,'base64'));
    pass('visible runtime-scoped confirmation does not itself restart');
    if(mode==='restart-cancel') {
      await click(b,'[data-recovery-action="cancel"]'); assert(!(await state()).confirmation);
      assert.equal(requests.restart,0); await action('retry');
      pass('cancel preserves original generation and Retry reconnects only its Viewer');
    } else {
      restartFault=true;
      await click(b,'[data-recovery-action="confirm"]');
      await wait(async()=>!(await state()).busy,120000);
      assert.equal(await b.evaluate("sdkMutationCalls.filter(x=>x==='restart').length"),1);
      if(mode!=='restart-response-loss')assert.equal(requests.restart,1);
      if(mode==='restart-refused') {
        assert.equal((await state()).reason,'operation-refused');
        assert.equal((await api('/api/instances/'+owned)).sessionGeneration,before.sessionGeneration);
        restartFault=false; await action('retry');
        pass('HTTP 409 is shown without force or another restart');
      } else if(mode==='restart-response-loss') {
        assert.equal((await state()).reason,'operation-uncertain');
        assert((await api('/api/instances/'+owned)).sessionGeneration>before.sessionGeneration);assert.equal(mutationResponses.filter(x=>x.action==='restart'&&x.status===200).length,1);
        const count=requests.restart;await delay(2500);assert.equal(requests.restart,count);assert.equal(await b.evaluate("sdkMutationCalls.filter(x=>x==='restart').length"),1);restartFault=false;
        await action('refresh');await action('reattach');replaced=true;
        pass('one SDK restart survives lost response; generation fence rejects transport retries, explicit reattach recovers');
      } else {
        replaced=true;pass('confirmed restart binds exactly the newly verified generation');
      }
    }
  } else if(mode==='replacement') {
    await api('/api/instances/'+owned+'/restart',{sessionGeneration:before.sessionGeneration});
    await wait(()=>b.evaluate("s.state==='invalidated'"));
    const grants=requests.grant;await delay(2000);assert.equal(requests.grant,grants);
    assert.equal((await state()).displayReady,false);
    await action('refresh');await action('reattach');replaced=true;
    pass('external generation replacement requires explicit reattachment');
  } else if(mode==='release-backoff') {
    outage=true;for(const socket of sockets)socket.destroy();
    await wait(async()=>(await state()).state==='recovering');
    await b.evaluate('w.release()');const grants=requests.grant;outage=false;
    await delay(6000);assert.equal(requests.grant,grants);
    assert.equal((await state()).state,'closed');
    assert.equal(await b.evaluate('document.querySelectorAll("[data-recovery-panel]").length'),0);
    pass('release during reconnect cancels requests and removes the panel without revival');protectedStop=true;
  } else if(mode==='chained') {
    outage=true;for(const socket of sockets)socket.destroy();
    await wait(async()=>(await state()).state==='recovering');
    const pid=managerPID();user(['systemctl','--user','kill','--kill-whom=main','--signal=KILL','remotexapp-host.service']);
    await wait(async()=>{try{return managerPID()!=='0'&&managerPID()!==pid&&await api('/readyz');}catch{return false;}},30000);
    outage=false;resumed=Date.now();
    pass('Manager failure injected while display reconnection is already pending');
  } else if(mode==='cycles') {
    for(let n=0;n<5;n++) {
      const old=await b.evaluate('v.getStats().connectionEpoch');
      outage=true;for(const socket of sockets)socket.destroy();
      await wait(async()=>(await state()).state==='recovering');await delay(1000);outage=false;
      await wait(()=>b.evaluate(`w.getState().displayReady && v.getStats().connectionEpoch>${old}`));
      assert.equal(await b.evaluate('h.views.size'),1);assert.equal(await b.evaluate('document.querySelectorAll("[data-recovery-panel]").length'),1);
    }
    pass('five fault/reconnect cycles retain one View and one recovery panel');
  } else if (mode === 'manager-crash') {
    const pid = managerPID(); assert.notEqual(pid, '0');
    assert.equal(user(['systemctl','--user','show','remotexapp-host.service','-p','Restart','--value']).trim(), 'on-failure');
    user(['systemctl','--user','kill','--kill-whom=main','--signal=KILL','remotexapp-host.service']);
    await wait(async () => { try { return managerPID() !== '0' && managerPID() !== pid && await api('/readyz'); } catch { return false; } }, 30000);
  } else if (mode === 'short-outage') {
    outage = true; for (const socket of sockets) socket.destroy();
    await wait(() => b.evaluate("v.getStats().state!=='ready'"), 10000);
    await delay(3000); outage = false; resumed = Date.now();
  } else if (['lease-429','lease-500','lease-502','lease-503','lease-504','lease-timeout','lease-401','lease-403','lease-409'].includes(mode)) {
    injectLease = true;
    await wait(() => leaseFaultSeenAt, 30000);
    resumed = leaseFaultSeenAt;
    if (['lease-401','lease-403','lease-409'].includes(mode)) {
      await wait(() => b.evaluate("v.getStats().state==='failed' && v.getStats().code==='grant-expired'"), 10000);
      const grants = requests.grant;
      await delay(3000);
      assert.equal(requests.grant, grants); assert.equal(grants, 1);
      assert.equal(await b.evaluate("v.getStats().state"), 'failed');
      checks.push({name:'explicit lease rejection stops retry without a new grant',result:'passed',status:Number(mode.slice(6))});
      // Only an explicit test action may reconnect after the terminal rejection.
      if(mode==='lease-401') {
        assert.equal((await state()).reason,'authentication-required');
        assert.deepEqual((await state()).actions.map(a=>a.kind),['authenticate','help']);
        await b.evaluate("window.requestsToHost=[];w.addEventListener('request',e=>requestsToHost.push(e.detail))");
        await action('authenticate');assert.equal(await b.evaluate('requestsToHost[0].kind'),'authenticate');
        assert.equal(requests.grant,grants);protectedStop=true;
        pass('authentication action delegates login to embedding host without retrying old credentials');
      } else {await action('refresh');await action('retry');}
    }
  } else {
    // Chrome can leave an existing WebSocket open while blocking HTTP. Waiting
    // across lease renewal exercises that separate failure path deliberately.
    await b.call('Network.emulateNetworkConditions', {offline:true,latency:0,downloadThroughput:0,uploadThroughput:0}); offline = true;
    await wait(() => b.evaluate("v.getStats().state!=='ready'"), 30000);
    if (mode === 'lease-exhausted') {
      await wait(() => b.evaluate("v.getStats().code==='reconnect-exhausted'"), 45000);
      checks.push({name:'continued outage exhausts the finite reconnect budget',result:'passed'});
    }
    if (mode === 'lease-cancelled') await b.evaluate('v.disconnect()');
    await b.call('Network.emulateNetworkConditions', {offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1}); offline = false;
    resumed = Date.now();
    if (['lease-exhausted','lease-cancelled'].includes(mode)) {
      const grants = requests.grant;
      await delay(3000);
      assert.equal(await b.evaluate('v.getStats().state'), 'disconnected');
      assert.equal(requests.grant, grants);
      checks.push({name:'network restoration does not override exhaustion or explicit disconnect',result:'passed'});
      await action('retry');
    }
  }
  if (!protectedStop) {
  await wait(() => b.evaluate(`w.getState().state==='ready' && w.getState().displayReady && v.getStats().state==='ready' && (${replaced} || v.getStats().connectionEpoch>${epoch}) && v.getStats().renderedFrames>0`), 30000);
  recoveryMs = Date.now() - resumed;
  const after=await api('/api/instances/'+owned);
  if(replaced)assert(after.sessionGeneration>before.sessionGeneration);
  else {assert.equal(after.sessionGeneration,before.sessionGeneration);assert.equal(remote(['cat','/home/rxhost/state/instances/'+owned+'/session-services.json']), services);}
  assert.equal(remote(['cat',file]), 'saved before faults 中文');
  await b.evaluate("v.sendKey('End');v.sendText(' after recovery');v.sendKey('s',{modifiers:['Control']})");
  await wait(() => remote(['cat',file]) === 'saved before faults 中文 after recovery');
  const manual = ['lease-401','lease-403','lease-409','lease-exhausted','lease-cancelled',
  'restart','restart-cancel','restart-refused','restart-response-loss','replacement','release-backoff','cycles','chained','initial-create-response-loss','initial-create-manager-crash'].includes(mode);
  assert(requests.grant >= 2, 'recovery requires a fresh authenticated grant');
  if (mode === 'lease-timeout') {
    assert(recoveryMs >= 9000 && recoveryMs < 20000, 'lease deadline must bound a hanging request');
    assert.equal(heldResponses.size, 0, 'timed-out renewal request was not released');
  }
  checks.push({name:(manual ? 'explicit recovery after protected stop' : replaced ? 'verified replacement' : 'connection recovery')+', unchanged generation/services, real paint and fresh saved input',result:'passed',recoveryMs});
  }
  }
} catch (e) {
  failure = e.message;
  checks.push({name:'automatic recovery',result:'failed',error:e.message,
    viewer:await b.evaluate('window.v?.getStats()').catch(() => null),view:await state().catch(()=>null)});
  if (mode === 'lease-outage' && owned && !offline) {
    // Diagnostic only: never turn a failed automatic-recovery assertion green.
    const after = await api('/api/instances/'+owned);
    const browserHTTPStatus = await b.evaluate(`fetch('/rx/api/instances/'+s.id).then(r=>r.status)`);
    checks.push({name:'authenticated API after network restoration',result:browserHTTPStatus === 200 ? 'passed' : 'failed',
      browserHTTPStatus,
      generationUnchanged:after.sessionGeneration === before?.sessionGeneration,
      servicesUnchanged:remote(['cat','/home/rxhost/state/instances/'+owned+'/session-services.json']) === services});
  }
  console.error(e.stack);
} finally {
  outage = false; injectLease = false;
  for (const response of heldResponses) response.destroy();
  if (offline) await b.call('Network.emulateNetworkConditions', {offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  owned ??= await b.evaluate('window.s?.id').catch(() => undefined);
  await b.evaluate('window.h?.dispose()').catch(() => {});
  await b.close(); await browser.close();
  for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve));
  if(owned)createdIds.add(owned);
  for(const id of createdIds){const i=await api('/api/instances/'+id).catch(e=>{if(e.status===404)return null;throw e;});if(i&&i.state!=='stopped')await api('/api/instances/'+id+'/stop',{force:true,sessionGeneration:i.sessionGeneration});}
  rmSync(temp, {recursive:true});
  writeFileSync(join(original.evidenceDirectory, 'recovery-'+mode+'.json'), JSON.stringify({mode,startedAt,
    completedAt:new Date().toISOString(),result:failure?'failed':'passed',sdkVersion:observedSDKVersion,requests,creations,mutationResponses,checks}, null, 2));
}
if (failure) process.exitCode = 1;
