// Run as a disposable non-root account; never target an existing deployment.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, writeFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { RemoteXAppManager } from '../../cmd/remotexappd/web/sdk/remotexapp-manager.js';
const exec = promisify(execFile), sleep = ms => new Promise(r => setTimeout(r,ms));
const uid = process.getuid();
assert(uid > 0 && String(uid) === process.env.REMOTEXAPP_LEASE_TEST_UID, 'disposable UID opt-in required');
process.umask(0o077);
const root = resolve(process.env.REMOTEXAPP_LEASE_RELEASE_ROOT || '.');
const work = await mkdtemp('/tmp/remotexapp-lease-e2e-');
const env = { ...process.env, XDG_RUNTIME_DIR:`/run/user/${uid}`, DBUS_SESSION_BUS_ADDRESS:`unix:path=/run/user/${uid}/bus` };
const base = 'http://127.0.0.1:21997', api = new RemoteXAppManager({ baseURL:base });
const apps = join(work,'apps'), enabled = join(work,'enabled'), state = join(work,'state'), classes = join(work,'classes');
const created = [], checks = [], sockets = [], bootstrapTimers = [];
let manager, browser;
async function wait(fn, label, timeout=45000) {
  const end = Date.now()+timeout;
  while(Date.now()<end) { if(await fn()) return; await sleep(100); }
  throw Error(`timed out: ${label}`);
}
async function start() {
  manager = spawn(join(root,'bin/remotexappd'), ['-listen','127.0.0.1:21997','-auth-mode','none','-state-dir',state,
    '-class-config',classes,'-app-package-root',apps,'-apps-enabled',enabled,'-expose-internals=true',
    '-gateway-bin',join(root,'bin/novnc-input'),'-status-bin',join(root,'bin/remotexapp-status'),
    '-core-driver-dir',join(root,'drivers/common'),'-ibus-engine',join(root,'components/remote-unicode-engine/engine.py'),
    '-shutdown-grace-timeout','3s','-shutdown-force-after','5s'], {env,stdio:['ignore','ignore','pipe']});
  manager.stderr.on('data', b=>process.stderr.write(b));
  await wait(async()=>{if(manager.exitCode!==null)throw Error('Manager exited');try{return(await fetch(base+'/readyz')).ok}catch{return false}},'Manager');
}
async function terminate(child) {
  if(!child || child.exitCode!==null || child.signalCode!==null)return;
  const exited = new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await exited;
}
async function install(name, action, version='1.0.0-test') {
  const source=join(work,'sources',name);await cp(join(root,'apps',name),source,{recursive:true});
  const file=join(source,'manifest.json'), manifest=JSON.parse(await readFile(file,'utf8'));
  manifest.id=`lease-${name}`;manifest.driverVersion=version;
  manifest.session.vacantTimeout='12s';
  if(action) {manifest.session.vacantAction=action;manifest.runMode='shared';}
  if(name==='mousepad') {
    manifest.session.shutdownDriver='lease-shutdown.sh';
    await writeFile(join(source,'lease-shutdown.sh'),'#!/bin/sh\nset -eu\nif [ -f "$REMOTEXAPP_RUNTIME/lease-refuse" ]; then exit 10; fi\nexec "$(dirname "$0")/shutdown.sh"\n',{mode:0o755});
  }
  if(name==='xfce-user-desktop') {
    const ports=(await exec('ss',['-ltnH'])).stdout;
    let display;
    for(let n=90;n<100;n++) {
      try{await lstat('/tmp/.X11-unix/X'+n);continue}catch{}
      if(!ports.includes(':'+(5900+n)+' ')&&!ports.includes(':'+(39000+n)+' ')){display=n;break}
    }
    assert(display,'no free test display');
    Object.assign(manifest.server,{display,rfbPort:5900+display,gatewayPort:39000+display});
  }
  await writeFile(file,JSON.stringify(manifest));
  const archive=(await exec(join(root,'scripts/package-app.sh'),[source,join(work,'archives')],{env})).stdout.trim();
  const sha=createHash('sha256').update(await readFile(archive)).digest('hex');
  await exec(join(root,'scripts/install-app.sh'),['--archive',archive,'--sha256',sha,'--package-root',apps,'--enabled-root',enabled],{env});
}
async function cdpPage(url) {
  const target=await(await fetch(`http://127.0.0.1:9297/json/new?${encodeURIComponent(url)}`,{method:'PUT'})).json();
  const ws=new WebSocket(target.webSocketDebuggerUrl);sockets.push(ws);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
  let serial=0;const pending=new Map();
  ws.onmessage=e=>{const m=JSON.parse(e.data), p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}};
  const command=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;const timer=setTimeout(()=>{pending.delete(id);reject(Error(`CDP timeout ${method}`))},30000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))});
  const evaluate=async expression=>{const r=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
  await command('Page.enable');
  await wait(async()=>{try{return await evaluate('document.readyState === "complete"')}catch{return false}},'page');
  return {target,command,evaluate,close:async()=>{ws.close();await fetch(`http://127.0.0.1:9297/json/close/${target.id}`)}};
}
async function create(templateId) {
  const i=templateId==='lease-xfce-user-desktop'
    ? (await api.createManagedInstance({id:'lease-desktop',templateId})).runtime
    : await api.createInstance({templateId});
  assert(i,'runtime creation/reconciliation failed');created.push(i.id);return i;
}
async function renew(id, generation) {return api.renewIdleLease(id,{sessionGeneration:generation});}
async function stop(id) {try{
  const item=await api.getInstance(id);
  if(item.managedInstanceId)await api.setManagedInstanceState(item.managedInstanceId,'stopped',{force:true});
  else await api.stopInstance(id,{force:true});
}catch(e){if(e.status!==404)throw e}}

try {
  try {assert(!(await fetch(base+'/readyz')).ok,'test port occupied')}catch(e){if(e.code==='ERR_ASSERTION')throw e}
  for(const dir of [apps,enabled,state,classes])await mkdir(dir,{recursive:true});
  await exec('systemctl',['--user','set-environment','WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1','WEBKIT_DMABUF_RENDERER_FORCE_SHM=1','LIBGL_ALWAYS_SOFTWARE=1'],{env});
  for(const name of ['mousepad','libreoffice','kate','kwrite','edge','firefox-esr','lightview','xfce-user-desktop'])await install(name);
  await start();
  browser=spawn('google-chrome',['--headless=new','--no-sandbox','--disable-extensions','--disable-background-networking','--no-first-run',`--user-data-dir=${join(work,'chrome')}`,'--remote-debugging-port=9297','about:blank'],{env,stdio:'ignore'});
  await wait(async()=>{try{return(await fetch('http://127.0.0.1:9297/json/version')).ok}catch{return false}},'Chrome');

  if(!process.env.REMOTEXAPP_LEASE_MATRIX_ONLY) {
  for(const name of (process.env.REMOTEXAPP_LEASE_APPS || 'mousepad,libreoffice,kate,kwrite,edge,firefox-esr,lightview,xfce-user-desktop').split(',').filter(Boolean)) {
    let item=await create(`lease-${name}`);
    const bootTimer=setInterval(()=>renew(item.id,item.sessionGeneration).catch(()=>{}),2000);bootstrapTimers.push(bootTimer);
    if(item.sessionGeneration===0) {
      const receipt=await renew(item.id,0);assert.equal(receipt.outcome,'renewed');
      assert.equal((await api.getInstance(item.id)).sessionState,'stopped');
      checks.push(`${name}: renewal-does-not-start-on-attach`);
    }
    const viewer=await cdpPage(`${base}/remotexapps/${item.id}/kiosk.html`);
    await wait(async()=>await viewer.evaluate('window.remoteXApp?.client?.state === "connected"'),'Viewer');
    await wait(async()=> (await api.getInstance(item.id)).applicationStatus?.state==='ready','App');
    clearInterval(bootTimer);
    item=await api.getInstance(item.id);
    assert.equal((await renew(item.id,item.sessionGeneration)).outcome,'attached');
    await viewer.evaluate('window.remoteXApp.client.disconnect()');
    await wait(async()=>!(await api.getInstance(item.id)).attachedClients,'detach');
    // More than one whole template timeout passes with no RFB connection.
    for(let i=0;i<5;i++){await renew(item.id,item.sessionGeneration);await sleep(3000)}
    assert.equal((await api.getInstance(item.id)).sessionState,'running');
    checks.push(`${name}: no-Viewer-renewal-survives-timeout`);
    if(name==='mousepad') {
      await terminate(manager);await start();
      assert.equal((await api.getInstance(item.id)).sessionGeneration,item.sessionGeneration);
      await renew(item.id,item.sessionGeneration);
      checks.push('Manager-adoption-keeps-generation-and-renewal');
    }
    const last=await renew(item.id,item.sessionGeneration);
    const expected=name==='xfce-user-desktop'?'server-ready':'stopped';
    await wait(async()=>{const x=await api.getInstance(item.id);return x.state===expected&&x.sessionState==='stopped'},`${name} expiry`,25000);
    const late=Date.now()-Date.parse(last.expiresAt);assert(late<10000,'unexpected extra grace');
    await assert.rejects(renew(item.id,item.sessionGeneration),e=>e.status===409);
    checks.push(`${name}: expiry-${expected}-no-resurrection`);
    await viewer.close();
    if(name==='xfce-user-desktop') {
      const relogin=await cdpPage(`${base}/remotexapps/${item.id}/kiosk.html`);
      await wait(async()=>await relogin.evaluate('window.remoteXApp?.client?.state === "connected"'),'XFCE relogin');
      const active=await api.getInstance(item.id);assert(active.sessionGeneration>item.sessionGeneration);
      await assert.rejects(renew(item.id,item.sessionGeneration),e=>e.status===409);
      const desktopEnv=(await api.getApplicationEnvironment(item.id,{sessionGeneration:active.sessionGeneration})).environment;
      const heartbeat=setInterval(()=>renew(item.id,active.sessionGeneration).catch(()=>{}),500);bootstrapTimers.push(heartbeat);
      await exec('xfce4-session-logout',['--logout','--fast'],{env:{...env,...desktopEnv},timeout:5000});
      await wait(async()=> (await api.getInstance(item.id)).sessionState==='stopped','XFCE logout wins over lease',20000);
      clearInterval(heartbeat);
      await assert.rejects(renew(item.id,active.sessionGeneration),e=>e.status===409);
      assert.equal((await api.getInstance(item.id)).state,'server-ready');
      checks.push('XFCE-relogin-new-generation-and-logout-wins-over-lease');
      await relogin.close();
    }
    if(expected!=='stopped')await stop(item.id);
  }

  const item=await create('lease-mousepad');
  const pages=await Promise.all([cdpPage(base+'/api/version'),cdpPage(base+'/api/version')]);
  for(const page of pages)await page.evaluate(`(async()=>{
    const sdk=await import('/sdk/index.js');window.sdk=sdk;
    window.coordinator=new sdk.RemoteXAppCoordinator({scope:'lease-browser-test'});
    window.handle=coordinator.track(${JSON.stringify(item.id)},{sessionGeneration:${item.sessionGeneration},keepAlive:true});
    window.receipts=0;handle.addEventListener('leasechange',()=>receipts++);await handle.ready;return true;
  })()`);
  await wait(async()=> (await Promise.all(pages.map(p=>p.evaluate('receipts')))).every(n=>n>0),'browser renewals');
  const ids=await Promise.all(pages.map(p=>p.evaluate('coordinator.ownerId')));
  const leader=ids[0]<ids[1]?0:1, follower=1-leader;
  await pages[leader].command('Page.setWebLifecycleState',{state:'frozen'});
  await sleep(16000);
  assert.equal((await api.getInstance(item.id)).sessionState,'running');
  checks.push('real-browser-frozen-leader-awake-Tab-takeover');
  await pages[leader].command('Page.setWebLifecycleState',{state:'active'});
  await pages[leader].evaluate('handle.release()');
  await sleep(14000);assert.equal((await api.getInstance(item.id)).sessionState,'running');
  checks.push('release-one-Tab-other-Tab-keeps-App');
  await pages[follower].evaluate('handle.release()');
  await wait(async()=> (await api.getInstance(item.id)).state==='stopped','last release expiry',20000);
  checks.push('last-Tab-release-expires-App');
  for(const page of pages)await page.evaluate('coordinator.destroy()');

  const frozen=await create('lease-mousepad');
  for(const page of pages)await page.evaluate(`(async()=>{window.coordinator=new sdk.RemoteXAppCoordinator({scope:'all-frozen'});window.handle=coordinator.track(${JSON.stringify(frozen.id)},{sessionGeneration:1,keepAlive:true});await handle.ready;})()`);
  await sleep(1000);
  for(const page of pages)await page.command('Page.setWebLifecycleState',{state:'frozen'});
  await wait(async()=> (await api.getInstance(frozen.id)).state==='stopped','all frozen eventual expiry',22000);
  for(const page of pages){await page.command('Page.setWebLifecycleState',{state:'active'});await wait(async()=>await page.evaluate('handle.state === "invalidated"'),'resume invalidation');await page.evaluate('coordinator.destroy()');await page.close()}
  checks.push('all-Tabs-frozen-expiry-resume-does-not-revive');
  }

  let current=await create('lease-mousepad');
  await renew(current.id,current.sessionGeneration);
  const oldGeneration=current.sessionGeneration;
  await api.restartInstance(current.id,{sessionGeneration:oldGeneration,force:true});
  current=await api.getInstance(current.id);
  assert(current.sessionGeneration>oldGeneration);
  await assert.rejects(renew(current.id,oldGeneration),e=>e.status===409);
  await renew(current.id,current.sessionGeneration);
  checks.push('runtime-restart-invalidates-old-generation');
  await terminate(manager);await install('mousepad',undefined,'1.0.1-test');await start();
  current=await api.getInstance(current.id);assert(current.versions.updateAvailable);
  const beforeUpgrade=current.sessionGeneration;
  await api.upgradeAndRestartInstance(current.id,{sessionGeneration:beforeUpgrade,targetRevision:current.versions.targetRevision,force:true});
  current=await api.getInstance(current.id);assert.equal(current.driverVersion,'1.0.1-test');
  await assert.rejects(renew(current.id,beforeUpgrade),e=>e.status===409);
  await renew(current.id,current.sessionGeneration);
  checks.push('upgrade-new-pin-invalidates-old-generation');
  await stop(current.id);
  await assert.rejects(renew(current.id,current.sessionGeneration),e=>e.status===409);
  checks.push('explicit-force-stop-wins-over-granted-lease');

  current=await create('lease-mousepad');
  await renew(current.id,current.sessionGeneration);
  await writeFile(join(state,'instances',current.id,'lease-refuse'),'test-only shutdown refusal');
  await assert.rejects(api.stopInstance(current.id),e=>e.status===409);
  assert.equal((await api.getInstance(current.id)).sessionState,'shutdown-blocked');
  await assert.rejects(renew(current.id,current.sessionGeneration),e=>e.status===409);
  await terminate(manager);await start();
  await wait(async()=> (await api.getInstance(current.id)).state==='stopped','force deadline survives Manager restart',15000);
  checks.push('blocked-shutdown-rejects-lease-host-force-survives-adoption');

  current=await create('lease-mousepad');
  await wait(async()=> (await api.getInstance(current.id)).applicationStatus?.state==='ready','natural exit App readiness');
  const applicationEnv=(await api.getApplicationEnvironment(current.id,{sessionGeneration:current.sessionGeneration})).environment;
  const keep=setInterval(()=>renew(current.id,current.sessionGeneration).catch(()=>{}),500);bootstrapTimers.push(keep);
  await exec('xdotool',['key','--clearmodifiers','ctrl+q'],{env:{...env,...applicationEnv},timeout:5000});
  await wait(async()=> (await api.getInstance(current.id)).state==='stopped','App exit wins over repeated renewals',15000);
  clearInterval(keep);
  await assert.rejects(renew(current.id,current.sessionGeneration),e=>e.status===409);
  checks.push('natural-App-exit-wins-over-continuing-renewals');

  // A managed comparison uses the allowed stop-session policy, not stop-instance.
  await terminate(manager);await install('mousepad','stop-session','1.0.2-test');await start();
  current=(await api.createManagedInstance({id:'lease-managed',templateId:'lease-mousepad'})).runtime;
  assert(current);created.push(current.id);
  assert.equal((await renew(current.id,current.sessionGeneration)).idleAction,'stop-session');
  await api.setManagedInstanceState('lease-managed','stopped',{force:true});
  await assert.rejects(renew(current.id,current.sessionGeneration),e=>e.status===409);
  checks.push('managed-desired-stop-wins-over-granted-lease');

  await writeFile(join(work,'result.json'),JSON.stringify({result:'passed',checks,work,uid,version:await api.getVersion()},null,2));
  console.log(JSON.stringify({result:'passed',checks,work},null,2));
} finally {
  for(const timer of bootstrapTimers)clearInterval(timer);
  if(manager?.exitCode===null&&manager?.signalCode===null)for(const id of created)await stop(id).catch(()=>{});
  for(const ws of sockets)ws.close();
  await terminate(browser);await terminate(manager);
  for(const id of created)await exec('systemctl',['--user','stop',...['session','gateway','server','vnc'].map(layer=>`remotexapp-${id}-${layer}.service`)],{env}).catch(()=>{});
  console.error('Retained evidence:',work);
}
