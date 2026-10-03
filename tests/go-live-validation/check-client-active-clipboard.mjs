import assert from 'node:assert/strict';

const cdpPort = Number(process.env.VALIDATION_CDP_PORT || 9241);
const timeoutMS = Number(process.env.VALIDATION_TIMEOUT_MS || 60000);
const consoleURL = process.env.VALIDATION_CONSOLE_URL || 'http://127.0.0.1:1991/sdk/console.html';
const token = `client-active-${Date.now().toString(36)}`;
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function websocketClient(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextID = 0;
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const operation = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) operation.reject(new Error(message.error.message));
    else operation.resolve(message.result);
  });
  return {
    socket,
    ready:new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once:true });
      socket.addEventListener('error', reject, { once:true });
    }),
    command(method, params = {}) {
      const id = ++nextID;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP command ${method} timed out`));
        }, timeoutMS);
        pending.set(id, {
          resolve:value => { clearTimeout(timer); resolve(value); },
          reject:error => { clearTimeout(timer); reject(error); },
        });
      });
    },
    close() { socket.close(); },
  };
}

let version;
let page;
const deadline = Date.now() + timeoutMS;
while (Date.now() < deadline && !version) {
  try {
    version = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then(response => response.json());
  } catch (_) {}
  if (!version) await sleep(50);
}
if (!version) throw new Error(`Chrome DevTools endpoint was not found on CDP ${cdpPort}`);

const browser = websocketClient(version.webSocketDebuggerUrl);
await browser.ready;
let targetRequested = false;
while (Date.now() < deadline && !page) {
  try {
    page = await fetch(`http://127.0.0.1:${cdpPort}/json`).then(response => response.json())
      .then(targets => targets.find(target => target.type === 'page' && new URL(target.url).pathname.endsWith('/sdk/console.html')));
    if (!page && !targetRequested) {
      await browser.command('Target.createTarget', { url:consoleURL });
      targetRequested = true;
    }
  } catch (_) {}
  if (!page) await sleep(50);
}
if (!page) throw new Error(`Unified Console target was not found on CDP ${cdpPort}`);
const target = websocketClient(page.webSocketDebuggerUrl);
await target.ready;

async function evaluate(expression) {
  const result = await target.command('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true });
  if (result.exceptionDetails) {
    const description = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
    throw new Error(description || 'browser evaluation failed');
  }
  return result.result.value;
}

async function waitFor(expression, message) {
  const until = Date.now() + timeoutMS;
  while (Date.now() < until) {
    try {
      if (await evaluate(expression)) return;
    } catch (_) {}
    await sleep(50);
  }
  throw new Error(message);
}

const origin = new URL(page.url).origin;
const checks = [];
let created = [];
try {
  await target.command('Page.bringToFront');
  await browser.command('Browser.grantPermissions', {
    origin,
    permissions:['clipboardReadWrite', 'clipboardSanitizedWrite'],
  });
  await waitFor('window.remoteXApp?.manager && typeof window.remoteXApp.openViewer === "function"', 'Unified Console did not initialize');

  created = await evaluate(`(async()=>{
    const first=await window.remoteXApp.manager.createInstance({templateId:'mousepad',profileRef:'default'});
    const second=await window.remoteXApp.manager.createInstance({templateId:'mousepad',profileRef:'default'});
    await window.remoteXApp.openViewer(first);
    await window.remoteXApp.openViewer(first);
    await window.remoteXApp.openViewer(second);
    return [first.id,second.id];
  })()`);
  await waitFor('window.remoteXApp.clients.length===3&&window.remoteXApp.clients.every(client=>client.state==="connected")', 'three Console Viewer windows did not connect');
  const topology = await evaluate(`({
    windows:window.remoteXApp.windows,
    viewerIds:window.remoteXApp.clients.map(client=>client.clipboard.viewerId),
    windowNodes:document.querySelectorAll('[data-viewer-window]').length,
    taskNodes:document.querySelectorAll('[data-viewer-task]').length,
  })`);
  assert.equal(topology.windows.filter(item => item.runtimeId === created[0]).length, 2);
  assert.equal(topology.windows.filter(item => item.runtimeId === created[1]).length, 1);
  assert.equal(new Set(topology.viewerIds).size, 3);
  assert.equal(topology.windowNodes, 3);
  assert.equal(topology.taskNodes, 3);
  checks.push('same-and-different-runtime-multi-window');

  const inactive = await evaluate(`(async()=>{
    const [a,b,c]=window.remoteXApp.clients;
    for (const client of [a,b,c]) {
      client.clipboard.configure({toRemote:'prompt',toLocal:'prompt',checkOnFocus:true});
      for (const offer of client.clipboard.snapshot().pending) client.clipboard.dismiss(offer.id);
      client.blur();
    }
    const before=[a,b,c].map(client=>({fingerprint:client.clipboard.localFingerprint,pending:client.clipboard.snapshot().pending.length}));
    await navigator.clipboard.writeText(${JSON.stringify(`${token}-local`)});
    await new Promise(resolve=>setTimeout(resolve,250));
    return {before,after:[a,b,c].map(client=>({fingerprint:client.clipboard.localFingerprint,...client.clipboard.snapshot()}))};
  })()`);
  assert(inactive.after.every(item => item.inputActive === false));
  assert(inactive.after.every((item, index) => item.fingerprint === inactive.before[index].fingerprint && item.pending.length === 0));
  checks.push('inactive-no-read-fingerprint-or-prompt');

  const focused = await evaluate(`(async()=>{
    const [a,b]=window.remoteXApp.clients;
    const firstActivated=Date.now();
    a.focus();
    await new Promise(resolve=>setTimeout(resolve,250));
    const first={activated:firstActivated,snapshot:a.clipboard.snapshot()};
    const secondActivated=Date.now();
    b.focus();
    await new Promise(resolve=>setTimeout(resolve,250));
    return {first,second:{activated:secondActivated,snapshot:b.clipboard.snapshot()},firstAfter:a.clipboard.snapshot()};
  })()`);
  const firstLocal = focused.first.snapshot.pending.find(offer => offer.direction === 'toRemote');
  const secondLocal = focused.second.snapshot.pending.find(offer => offer.direction === 'toRemote');
  assert(firstLocal && secondLocal);
  assert(Date.parse(firstLocal.expiresAt) >= focused.first.activated + 59000);
  assert(Date.parse(secondLocal.expiresAt) >= focused.second.activated + 59000);
  assert.equal(focused.firstAfter.inputActive, false);
  assert.equal(focused.second.snapshot.inputActive, true);
  checks.push('activation-time-independent-same-content-prompts');

  const background = await evaluate(`(async()=>{
    const active=window.remoteXApp.clients[1];
    const {RemoteXAppClient}=await import(new URL(window.remoteXApp.manager.url('/sdk/index.js'),location.href));
    const container=document.createElement('div');
    container.style.cssText='position:absolute;width:320px;height:200px;left:-10000px';
    document.body.append(container);
    const source=new RemoteXAppClient({manager:window.remoteXApp.manager,instanceId:${JSON.stringify(created[0])},container,resize:'scale'});
    window.__clientActiveSource=source;
    await source.connect();
    return {source:source.clipboard.snapshot(),active:active.clipboard.snapshot()};
  })()`);
  assert.equal(background.source.inputActive, false);
  assert.equal(background.active.inputActive, true);
  checks.push('background-connection-cannot-claim-active-client');

  const loop = await evaluate(`(async()=>{
    const [a,b]=window.remoteXApp.clients;
    const source=window.__clientActiveSource;
    for (const client of [a,b]) for (const offer of client.clipboard.snapshot().pending) client.clipboard.dismiss(offer.id);
    source.clipboard.configure({toRemote:'manual',toLocal:'off'});
    await source.clipboard.send([{type:'text/plain',data:${JSON.stringify(`${token}-remote`)}}]);
    const deadline=Date.now()+5000;
    while (Date.now()<deadline && [a,b].some(client=>!client.clipboard.snapshot().pending.some(offer=>offer.direction==='toLocal'))) {
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    const aOffer=a.clipboard.snapshot().pending.find(offer=>offer.direction==='toLocal');
    const bOffer=b.clipboard.snapshot().pending.find(offer=>offer.direction==='toLocal');
    if (!aOffer||!bOffer) throw new Error('remote offer was not broadcast to both Viewers');
    await a.clipboard.syncToLocal(aOffer.id);
    for (const offer of a.clipboard.snapshot().pending) a.clipboard.dismiss(offer.id);
    a.focus();
    await new Promise(resolve=>setTimeout(resolve,250));
    const aRebound=a.clipboard.snapshot().pending.filter(offer=>offer.direction==='toRemote');
    b.focus();
    await new Promise(resolve=>setTimeout(resolve,250));
    const bForward=b.clipboard.snapshot().pending.filter(offer=>offer.direction==='toRemote');
    return {sameOffer:aOffer.id===bOffer.id,sourcePending:source.clipboard.snapshot().pending.length,aRebound:aRebound.length,bForward:bForward.length};
  })()`);
  assert.equal(loop.sameOffer, true);
  assert.equal(loop.sourcePending, 0);
  assert.equal(loop.aRebound, 0);
  assert.equal(loop.bForward, 1);
  checks.push('remote-fanout-source-suppression-and-per-client-loop-control');

  const controls = await evaluate(`(async()=>{
    const [a,b]=window.remoteXApp.clients;
    const secondWindow=window.remoteXApp.windows[1];
    const differentWindow=window.remoteXApp.windows[2];
    b.disconnect();
    await new Promise(resolve=>setTimeout(resolve,100));
    const scopedDisconnect={a:a.state,b:b.state};
    await b.connect();
    const node=document.querySelector('[data-viewer-window="'+secondWindow.id+'"]');
    const beforeLeft=node.style.left;
    const title=node.querySelector('.viewer-title');
    title.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:50,clientY:50}));
    window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:90,clientY:80}));
    window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:90,clientY:80}));
    const moved=node.style.left!==beforeLeft;
    node.querySelector('button[aria-label^="Minimize"]').click();
    const minimized=node.classList.contains('minimized')&&!b.clipboard.snapshot().inputActive;
    document.querySelector('[data-viewer-task="'+secondWindow.id+'"]').click();
    await new Promise(resolve=>setTimeout(resolve,0));
    const restored=!node.classList.contains('minimized')&&b.clipboard.snapshot().inputActive;
    const beforeSwitch=window.remoteXApp.client.clipboard.viewerId;
    document.querySelector('#workspace').dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,ctrlKey:true,key:'F6'}));
    await new Promise(resolve=>setTimeout(resolve,0));
    const switched=window.remoteXApp.client.clipboard.viewerId!==beforeSwitch;
    document.querySelector('[data-viewer-window="'+differentWindow.id+'"] button[aria-label^="Close Viewer"]').click();
    await new Promise(resolve=>setTimeout(resolve,100));
    const differentRuntime=await window.remoteXApp.manager.getInstance(${JSON.stringify(created[1])});
    return {scopedDisconnect,moved,minimized,restored,switched,remaining:window.remoteXApp.clients.length,differentRuntimeState:differentRuntime.state};
  })()`);
  assert.deepEqual(controls.scopedDisconnect, { a:'connected', b:'disconnected' });
  assert.equal(controls.moved, true);
  assert.equal(controls.minimized, true);
  assert.equal(controls.restored, true);
  assert.equal(controls.switched, true);
  assert.equal(controls.remaining, 2);
  assert.match(controls.differentRuntimeState, /^(server-ready|ready)$/);
  checks.push('target-scoped-controls-move-minimize-keyboard-switch-and-close');
} finally {
  try {
    await evaluate(`(async()=>{
      window.__clientActiveSource?.destroy();
      delete window.__clientActiveSource;
      for (const item of window.remoteXApp?.windows||[]) {
        document.querySelector('[data-viewer-window="'+item.id+'"] button[aria-label^="Close Viewer"]')?.click();
      }
      for (const id of ${JSON.stringify(created)}) {
        try { await window.remoteXApp.manager.stopInstance(id,{force:true}); } catch (_) {}
      }
    })()`);
  } catch (_) {}
  browser.close();
  target.close();
}

process.stdout.write(`${JSON.stringify({ result:'passed', cdpPort, checks })}\n`);
