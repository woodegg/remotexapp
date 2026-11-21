// Exercise the default and explicit display providers in the real operator Console.
import assert from 'node:assert/strict';
import {execFileSync, spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {chrome, page, until} from '../native-audio/browser-cdp.mjs';
import {RemoteXAppManager} from '../../cmd/remotexappd/web/sdk/remotexapp-manager.js';

const root = resolve(process.env.REMOTEXAPP_SHIPPED_E2E_RELEASE_ROOT || '.');
const bundle = process.env.REMOTEXAPP_KASM_BUNDLE;
assert(bundle?.startsWith('/'), 'Set REMOTEXAPP_KASM_BUNDLE to the verified component directory');
assert(process.getuid() !== 0, 'Use a non-root account in a disposable test host');
const origin = 'http://127.0.0.1:21998';
assert.equal(await fetch(origin+'/healthz').then(r => r.ok, () => false), false, 'Test listener is occupied');

const work = await mkdtemp('/tmp/remotexapp-default-provider-');
const paths = Object.fromEntries(['apps','enabled','classes','state'].map(name => [name,join(work,name)]));
for (const path of Object.values(paths)) await mkdir(path);
const managerPath = join(root,'bin/remotexappd');
for (const app of ['mousepad', 'lightview']) {
  const manifest = JSON.parse(await readFile(join(root,'apps',app,'manifest.json'),'utf8'));
  const archive = join(root,'app-packages',app+'-'+manifest.driverVersion+'.tar.gz');
  const sha = createHash('sha256').update(await readFile(archive)).digest('hex');
  execFileSync(join(root,'scripts/install-app.sh'),
    ['--archive', archive, '--sha256', sha, '--package-root', paths.apps, '--enabled-root', paths.enabled]);
}

const environment = {...process.env};
delete environment.REMOTEXAPP_DISPLAY_PROVIDER;
delete environment.REMOTEXAPP_KASM_BUNDLE;
const args = [
  '-listen','127.0.0.1:21998','-auth-mode','none','-expose-internals=true',
  '-state-dir',paths.state,'-class-config',paths.classes,'-app-package-root',paths.apps,
  '-apps-enabled',paths.enabled,'-status-bin',join(root,'bin/remotexapp-status'),
  '-core-driver-dir',join(root,'drivers/common'),'-gateway-bin',join(root,'bin/novnc-input'),
  '-ibus-engine',join(root,'components/remote-unicode-engine/engine.py'),
];
const misconfigured = spawnSync(managerPath,args,{env:environment,encoding:'utf8',timeout:10000});
assert.equal(misconfigured.status,1);
assert.match(misconfigured.stderr,/KasmVNC requires .*REMOTEXAPP_KASM_BUNDLE/);

const manager = new RemoteXAppManager({baseURL:origin});
let service, browser, consolePage;
async function start(flags, env) {
  service = spawn(managerPath,[...args,...flags],{env,stdio:['ignore','ignore','inherit']});
  await until(async () => {
    if (service.exitCode !== null) throw Error('Manager exited '+service.exitCode);
    return await fetch(origin+'/readyz').then(r => r.ok, () => false);
  }, 30000);
}
async function stop() {
  if (service?.exitCode !== null) return;
  const exited = new Promise(resolve => service.once('exit',resolve));
  service.kill('SIGTERM');
  await exited;
}
async function consoleReady() {
  const viewer = await page(browser,origin+'/sdk/console.html');
  await until(() => viewer.evaluate("Boolean(window.remoteXApp && document.querySelector('#template option'))"));
  return viewer;
}
async function launch(template, readiness) {
  await consolePage.evaluate(`(() => {
    const input=document.querySelector('#template');
    input.value=${JSON.stringify(template)};
    input.dispatchEvent(new Event('change'));
    document.querySelector('#open').click();
  })()`);
  await until(() => consolePage.evaluate(readiness), 60000);
  return await consolePage.evaluate('remoteXApp.windows.at(-1).runtimeId');
}

try {
  browser = await chrome('');
  await start(['-display-provider','tigervnc'],{...environment,REMOTEXAPP_DISPLAY_PROVIDER:'invalid-test-default'});
  consolePage = await consoleReady();
  const oldId = await launch('mousepad',"remoteXApp.client?.state === 'connected'");
  const old = await manager.getInstance(oldId);
  assert.equal(old.displayProvider,'tigervnc');
  assert.equal(old.sessionState,'running');
  await consolePage.close();
  consolePage = null;
  await until(async () => (await manager.getInstance(oldId)).attachedClients === 0);
  await stop();

  await start([],{...environment,REMOTEXAPP_KASM_BUNDLE:bundle});
  const adopted = await manager.getInstance(oldId);
  assert.equal(adopted.displayProvider,'tigervnc');
  assert.equal(adopted.sessionGeneration,old.sessionGeneration);
  assert.equal(adopted.sessionState,'running');
  consolePage = await consoleReady();
  await consolePage.evaluate(`(async () => {
    const instance=await remoteXApp.manager.getInstance(${JSON.stringify(oldId)});
    await remoteXApp.openViewer(instance);
  })()`);
  await until(() => consolePage.evaluate("remoteXApp.client?.state === 'connected'"));

  const newId = await launch('lightview',"remoteXApp.client?.getStats?.().renderedFrames > 0");
  const fresh = await manager.getInstance(newId);
  assert.equal(fresh.displayProvider,'kasm');
  assert.equal(fresh.applicationStatus?.state,'ready');
  assert(fresh.displayComponentDigest);
  await consolePage.evaluate(`[...document.querySelectorAll('[data-viewer-window]')].at(-1)
    .querySelector('button[aria-expanded]').click()`);
  await until(() => consolePage.evaluate(`(() => {
    const stats=[...document.querySelectorAll('[data-viewer-window]')].at(-1).querySelector('.diagnostics');
    return !stats.hidden && JSON.parse(stats.textContent).renderedFrames > 0;
  })()`));
  await consolePage.evaluate(`[...document.querySelectorAll('[data-viewer-window]')].at(-1)
    .querySelector('button[aria-label^="Close Viewer"]').click()`);
  await until(async () => (await manager.getInstance(newId)).attachedClients === 0);
  assert.equal((await manager.getInstance(oldId)).attachedClients,1);

  console.log(JSON.stringify({passed:true, checks:[
    'missing bundle gives actionable error',
    'explicit TigerVNC flag overrides service environment',
    'old TigerVNC generation is adopted and reconnects',
    'omitted provider selects Kasm',
    'Console native LightView renders with live statistics',
    'closing native window preserves legacy Viewer',
  ], component:fresh.displayComponentDigest}));
} finally {
  try {
    if (consolePage) await consolePage.close();
    if (service?.exitCode === null) {
      for (const item of await manager.listInstances()) {
        if (item.state !== 'stopped') await manager.stopInstance(item.id,{force:true,sessionGeneration:item.sessionGeneration});
      }
    }
  } finally {
    try { if (browser) await browser.close(); }
    finally { await stop(); }
  }
}
