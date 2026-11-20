// Explicit live faults against the project-owned disposable host fixture only.
// Usage: node browser-host-faults.mjs /absolute/fixture.json MODE
// MODE: manager-crash | short-outage | lease-outage
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
assert(['manager-crash', 'short-outage', 'lease-outage'].includes(mode));
const upstream = new URL(original.ingressURL);
assert.equal(upstream.hostname, '127.0.0.1');
let outage = false;
const sockets = new Set();
const options = r => ({hostname:upstream.hostname, port:upstream.port, path:r.url, method:r.method, headers:r.headers});
const server = http.createServer((req, res) => {
  if (outage) { res.writeHead(503); res.end(); return; }
  const q = http.request(options(req), r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
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
const {api, remote, open, wait, delay} = await import('./host-browser.mjs');
const b = await open('http://127.0.0.1:'+server.address().port+'/rx/sdk/host.html');
const file = '/home/rxhost/documents/fault-'+mode+'-'+Date.now()+'.txt';
const checks = [], startedAt = new Date().toISOString();
let owned, failure, before, services, offline = false, recoveryMs;
const user = args => remote(['runuser','-u','rxhost','--','env','XDG_RUNTIME_DIR=/run/user/1004',
  'DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1004/bus', ...args]);
const managerPID = () => user(['systemctl','--user','show','remotexapp-host.service','-p','MainPID','--value']).trim();
try {
  remote(['runuser','-u','rxhost','--','python3','-c',
    'from pathlib import Path;import sys;Path(sys.argv[1]).touch(exist_ok=False)', file]);
  await wait(() => b.evaluate("!!window.remoteXAppHostWorkbench && document.querySelector('#template')?.options.length>0"));
  await b.call('Network.enable');
  await b.evaluate(`(async()=>{
    const sdk=await import('./index.js');
    window.h=new sdk.RemoteXAppHost({baseURL:'/rx',scope:'fault-regression'});
    const d=document.createElement('div');d.style='position:fixed;inset:20px;z-index:300';document.body.append(d);
    window.s=await h.open({templateId:'mousepad',parameters:{filePath:${JSON.stringify(file)}},keepAlive:true});
    window.v=await s.attach(d);v.sendText('saved before faults 中文');v.sendKey('s',{modifiers:['Control']});
  })()`);
  owned = await b.evaluate('s.id');
  await wait(() => remote(['cat',file]) === 'saved before faults 中文');
  before = await api('/api/instances/'+owned);
  services = remote(['cat','/home/rxhost/state/instances/'+owned+'/session-services.json']);
  const epoch = await b.evaluate('v.getStats().connectionEpoch');
  let resumed = Date.now();
  if (mode === 'manager-crash') {
    const pid = managerPID(); assert.notEqual(pid, '0');
    assert.equal(user(['systemctl','--user','show','remotexapp-host.service','-p','Restart','--value']).trim(), 'on-failure');
    user(['systemctl','--user','kill','--kill-whom=main','--signal=KILL','remotexapp-host.service']);
    await wait(async () => { try { return managerPID() !== '0' && managerPID() !== pid && await api('/readyz'); } catch { return false; } }, 30000);
  } else if (mode === 'short-outage') {
    outage = true; for (const socket of sockets) socket.destroy();
    await wait(() => b.evaluate("v.getStats().state!=='ready'"), 10000);
    await delay(3000); outage = false; resumed = Date.now();
  } else {
    // Chrome can leave an existing WebSocket open while blocking HTTP. Waiting
    // across lease renewal exercises that separate failure path deliberately.
    await b.call('Network.emulateNetworkConditions', {offline:true,latency:0,downloadThroughput:0,uploadThroughput:0}); offline = true;
    await wait(() => b.evaluate("v.getStats().state!=='ready'"), 30000);
    await b.call('Network.emulateNetworkConditions', {offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1}); offline = false;
    resumed = Date.now();
  }
  await wait(() => b.evaluate(`v.getStats().state==='ready' && v.getStats().connectionEpoch>${epoch} && v.getStats().renderedFrames>0`), 30000);
  recoveryMs = Date.now() - resumed;
  assert.equal((await api('/api/instances/'+owned)).sessionGeneration, before.sessionGeneration);
  assert.equal(remote(['cat','/home/rxhost/state/instances/'+owned+'/session-services.json']), services);
  assert.equal(remote(['cat',file]), 'saved before faults 中文');
  await b.evaluate("v.sendKey('End');v.sendText(' after recovery');v.sendKey('s',{modifiers:['Control']})");
  await wait(() => remote(['cat',file]) === 'saved before faults 中文 after recovery');
  checks.push({name:'automatic recovery, unchanged generation/services, real paint and fresh saved input',result:'passed',recoveryMs});
} catch (e) {
  failure = e.message;
  checks.push({name:'automatic recovery',result:'failed',error:e.message,
    viewer:await b.evaluate('window.v?.getStats()').catch(() => null)});
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
  outage = false;
  if (offline) await b.call('Network.emulateNetworkConditions', {offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  owned ??= await b.evaluate('window.s?.id').catch(() => undefined);
  await b.evaluate('window.h?.dispose()').catch(() => {});
  await b.close(); await browser.close();
  for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve));
  if (owned) {
    const i = await api('/api/instances/'+owned);
    if (i.state !== 'stopped') await api('/api/instances/'+owned+'/stop', {force:true,sessionGeneration:i.sessionGeneration});
  }
  rmSync(temp, {recursive:true});
  writeFileSync(join(original.evidenceDirectory, 'fault-'+mode+'.json'), JSON.stringify({mode,startedAt,
    completedAt:new Date().toISOString(),result:failure?'failed':'passed',checks}, null, 2));
}
if (failure) process.exitCode = 1;
