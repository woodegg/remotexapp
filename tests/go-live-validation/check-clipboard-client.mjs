import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ports = String(process.env.VALIDATION_CDP_PORTS || process.env.VALIDATION_CDP_PORT || '')
  .split(',').filter(Boolean).map(Number);
const mode = process.env.VALIDATION_CLIPBOARD_MODE || 'smoke';
const display = process.env.VALIDATION_DISPLAY;
const xauthority = process.env.VALIDATION_XAUTHORITY;
const timeoutMS = Number(process.env.VALIDATION_TIMEOUT_MS || 45000);
const token = `clp-${Date.now().toString(36)}`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const xEnvironment = { ...process.env, DISPLAY:display, XAUTHORITY:xauthority };

if (!ports.length || ports.some(port => !Number.isInteger(port) || port < 1)) throw new Error('VALIDATION_CDP_PORTS is required');
if (!display || !xauthority) throw new Error('VALIDATION_DISPLAY and VALIDATION_XAUTHORITY are required');
if (mode === 'full' && ports.length < 2) throw new Error('full clipboard validation requires two Viewer CDP ports');

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

async function connectViewer(port) {
  let page;
  let version;
  const deadline = Date.now() + timeoutMS;
  while (Date.now() < deadline && !page) {
    try {
      [version, page] = await Promise.all([
        fetch(`http://127.0.0.1:${port}/json/version`).then(response => response.json()),
        fetch(`http://127.0.0.1:${port}/json`).then(response => response.json())
          .then(targets => targets.find(target => target.type === 'page' && target.url.includes('/remotexapps/'))),
      ]);
    } catch (_) {}
    if (!page) await sleep(50);
  }
  if (!page) throw new Error(`Viewer target was not found on CDP ${port}`);
  const browser = websocketClient(version.webSocketDebuggerUrl);
  const target = websocketClient(page.webSocketDebuggerUrl);
  await Promise.all([browser.ready, target.ready]);
  async function evaluate(expression) {
    const result = await target.command('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true });
    if (result.exceptionDetails) {
      const description = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
      throw new Error(description || 'browser evaluation failed');
    }
    return result.result.value;
  }
  const viewer = { port, browser, target, evaluate, origin:new URL(page.url).origin };
  await waitFor(viewer, "window.remoteXApp?.client?.state === 'connected'", 'Viewer did not connect');
  return viewer;
}

async function waitFor(viewer, expression, message) {
  const deadline = Date.now() + timeoutMS;
  while (Date.now() < deadline) {
    try {
      if (await viewer.evaluate(expression)) return;
    } catch (_) {}
    await sleep(50);
  }
  throw new Error(message);
}

async function grantClipboard(viewer) {
  // Each headless browser is a distinct synthetic local device. Keep its
  // document focused for Clipboard API operations; native OS focus arbitration
  // is covered by the headed active-client harness and human UAT separately.
  await viewer.target.command('Emulation.setFocusEmulationEnabled', { enabled:true });
  await viewer.browser.command('Browser.grantPermissions', {
    origin:viewer.origin,
    permissions:['clipboardReadWrite', 'clipboardSanitizedWrite'],
  });
}

async function resetClipboardPermission(viewer) {
  await viewer.browser.command('Browser.resetPermissions');
}

async function readXTarget(target) {
  const { stdout } = await execFileAsync('xclip', ['-selection', 'clipboard', '-target', target, '-out'], {
    env:xEnvironment, encoding:null, timeout:5000, maxBuffer:70 << 20,
  });
  return Buffer.from(stdout);
}

function assertOnePixelPNG(value) {
  assert.equal(value.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(value.subarray(12, 16).toString(), 'IHDR');
  assert.equal(value.readUInt32BE(16), 1);
  assert.equal(value.readUInt32BE(20), 1);
}

async function ownRemotePlain(value) {
  const owner = spawn('xclip', ['-selection', 'clipboard', '-target', 'UTF8_STRING', '-quiet', '-in'], {
    env:xEnvironment, stdio:['pipe', 'ignore', 'ignore'],
  });
  const started = new Promise((resolve, reject) => {
    owner.once('spawn', resolve);
    owner.once('error', reject);
  });
  owner.stdin.end(value);
  await started;
  await sleep(150);
  return () => {
    if (owner.exitCode === null) owner.kill('SIGTERM');
  };
}

function explicitSendExpression(action = 'set', suffix = '') {
  const plain = `${token}${suffix} plain`;
  const html = `<b>${token}${suffix} html</b>`;
  const rtf = `{\\rtf1 ${token}${suffix} rtf}`;
  return {
    plain, html, rtf,
    expression:`window.remoteXApp.client.clipboard.send([
      {type:'text/plain',data:${JSON.stringify(plain)}},
      {type:'text/html',data:${JSON.stringify(html)}},
      {type:'text/rtf',data:${JSON.stringify(rtf)}},
      {type:'image/png',data:new Uint8Array(${JSON.stringify([...png])})}
    ],{action:${JSON.stringify(action)}})`,
  };
}

const viewers = await Promise.all(ports.map(connectViewer));
const first = viewers[0];
const second = viewers[1];
const result = { mode, viewers:ports.length, checks:[] };

try {
  process.stderr.write('clipboard-e2e: configure and capabilities\n');
  for (const viewer of viewers) {
    await grantClipboard(viewer);
    await viewer.evaluate("window.remoteXApp.client.clipboard.configure({toRemote:'manual',toLocal:'manual'})");
    await viewer.evaluate('window.remoteXApp.client.clipboard.checkAccess()');
  }
  const initial = await first.evaluate('window.remoteXApp.client.clipboard.snapshot()');
  assert.equal(initial.capabilities.server.protocolVersion, 1);
  assert.equal(initial.config.toRemote, 'manual');
  result.checks.push('capabilities-and-explicit-modes');

  process.stderr.write('clipboard-e2e: empty normalization and atomic rejection\n');
  const emptyChecks = await first.evaluate(`(async()=>{
    const c=window.remoteXApp.client;
    let successes=0; const onSync=()=>successes++;
    c.clipboard.addEventListener('sync',onSync);
    try {
      await c.clipboard.send([{type:'text/plain',data:'empty-test-original'}]);
      const empty=await c.clipboard.syncToRemote({items:[{type:'text/plain',data:''},{type:'image/png',data:new Blob([])}]});
      const direct=await c.manager.sendClipboardOffer(c.instanceId,{sessionGeneration:c.instance.sessionGeneration,viewerId:c.clipboard.viewerId,items:[{type:'text/plain',data:''}]});
      let invalid=false;
      try { await c.manager.sendClipboardOffer(c.instanceId,{sessionGeneration:c.instance.sessionGeneration,viewerId:c.clipboard.viewerId,items:[{type:'text/plain',data:'must-not-commit'},{type:'image/png',data:'invalid'}]}); } catch(e) {invalid=true;}
      let htmlRejected=false;
      try { await c.clipboard.send([{type:'text/plain',data:''},{type:'text/html',data:'<b>must-not-commit</b>'}]); } catch(e) {htmlRejected=true;}
      return {empty,direct,invalid,htmlRejected,successes};
    } finally {c.clipboard.removeEventListener('sync',onSync);}
  })()`);
  assert.deepEqual(emptyChecks.empty,{skipped:true,reason:'empty-clipboard'});
  assert.deepEqual(emptyChecks.direct,{skipped:true,reason:'empty-clipboard'});
  assert.equal(emptyChecks.invalid,true); assert.equal(emptyChecks.htmlRejected,true);
  assert.equal(emptyChecks.successes,0);
  assert.equal((await readXTarget('UTF8_STRING')).toString(),'empty-test-original');
  await first.evaluate(`window.remoteXApp.client.clipboard.syncToRemote({items:[{type:'text/plain',data:''},{type:'image/png',data:new Uint8Array(${JSON.stringify([...png])})}]})`);
  assert.deepEqual(await readXTarget('image/png'),png);
  await first.evaluate(`(async()=>{
    await navigator.clipboard.write([new ClipboardItem({
      'text/plain':new Blob([],{type:'text/plain'}),
      'image/png':new Blob([new Uint8Array(${JSON.stringify([...png])})],{type:'image/png'})
    })]);
    return window.remoteXApp.client.clipboard.syncToRemote();
  })()`);
  assertOnePixelPNG(await readXTarget('image/png'));
  await first.evaluate(`window.remoteXApp.client.clipboard.syncToRemote({items:[{type:'text/plain',data:' \\t\\n'},{type:'text/html',data:''}]})`);
  assert.equal((await readXTarget('UTF8_STRING')).toString(),' \t\n');
  for (const viewer of viewers) await viewer.evaluate("(()=>{const c=window.remoteXApp.client.clipboard;for(const offer of c.snapshot().pending)c.dismiss(offer.id)})()");
  result.checks.push('empty-noop-mixed-png-whitespace-and-atomic-rejection');

  const explicit = explicitSendExpression('set');
  process.stderr.write('clipboard-e2e: explicit four-format transfer\n');
  await first.evaluate(explicit.expression);
  assert.equal((await readXTarget('UTF8_STRING')).toString(), explicit.plain);
  assert.equal((await readXTarget('text/html')).toString(), explicit.html);
  assert.equal((await readXTarget('text/rtf')).toString(), explicit.rtf);
  assert.deepEqual(await readXTarget('image/png'), png);
  result.checks.push('all-formats-browser-to-x11');

  if (mode === 'full') {
    process.stderr.write('clipboard-e2e: multi-Viewer acceptance\n');
    await waitFor(second, `window.remoteXApp.client.clipboard.snapshot().pending.some(offer => offer.types.includes('text/rtf'))`, 'second Viewer did not receive source broadcast');
    assert.equal((await first.evaluate('window.remoteXApp.client.clipboard.snapshot().pending.length')), 0);
    await second.evaluate(`(async()=>{
      const {RemoteXAppClipboardPrompts}=await import('/sdk/index.js');
      const client=window.remoteXApp.client;
      window.previewValidation=new RemoteXAppClipboardPrompts(client);
      window.previewValidation.add(client.clipboard.snapshot().pending.find(item=>item.types.includes('text/rtf')));
    })()`);
    await waitFor(second, "[...window.previewValidation.nodes.values()].some(bar=>bar.querySelector('img')?.naturalWidth===1)", 'remote pre-consent PNG preview missing');
    const remotePreview = await second.evaluate("[...window.previewValidation.nodes.values()][0].textContent");
    assert(remotePreview.includes(explicit.plain));
    assert.match(remotePreview, /Plain text.*B.*Rich text \(HTML\).*Rich text \(RTF\).*PNG image.*1 × 1 px/);
    assert.equal((await readXTarget('UTF8_STRING')).toString(), explicit.plain);
    await second.evaluate('window.previewValidation.destroy()');
    result.checks.push('remote-pre-consent-real-offer-text-size-and-png-preview');
    const accepted = await second.evaluate(`(async()=>{
      const client=window.remoteXApp.client;
      const offer=client.clipboard.snapshot().pending.find(item=>item.types.includes('text/rtf'));
      const value=await client.manager.acceptClipboardOffer(client.instanceId,offer.id,{sessionGeneration:client.instance.sessionGeneration});
      return {id:offer.id,types:value.items.map(item=>item.type).sort(),text:Object.fromEntries(await Promise.all(value.items.filter(item=>item.type.startsWith('text/')).map(async item=>[item.type,new TextDecoder().decode(item.data)])))};
    })()`);
    assert.deepEqual(accepted.types, ['image/png', 'text/html', 'text/plain', 'text/rtf']);
    assert.equal(accepted.text['text/plain'], explicit.plain);
    assert.equal(accepted.text['text/html'], explicit.html);
    assert.equal(accepted.text['text/rtf'], explicit.rtf);
    await second.evaluate("window.remoteXApp.client.clipboard.configure({toRemote:'prompt',toLocal:'manual'}); window.remoteXApp.client.focus(); true");
    const synchronized = await second.evaluate(`window.remoteXApp.client.clipboard.syncToLocal(${JSON.stringify(accepted.id)})`);
    assert(synchronized.types.includes('text/plain'));
    assert(!synchronized.types.includes('text/rtf'));
    await sleep(350);
    assert.equal(await second.evaluate("window.remoteXApp.client.clipboard.snapshot().pending.filter(offer=>offer.direction==='toRemote').length"), 0);
    const changed = `${token} genuine local change`;
    await second.evaluate(`(async()=>{
      await navigator.clipboard.writeText(${JSON.stringify(changed)});
      await window.remoteXApp.client.clipboard._reconcileLocal('e2e-genuine-change');
      return true;
    })()`);
    assert.equal(await second.evaluate("window.remoteXApp.client.clipboard.snapshot().pending.filter(offer=>offer.direction==='toRemote').length"), 1);
    await second.evaluate("(()=>{const clipboard=window.remoteXApp.client.clipboard;for(const offer of clipboard.snapshot().pending)clipboard.dismiss(offer.id)})()");
    result.checks.push('rich-browser-write-rebound-suppression-and-genuine-change');

    const localPlain = `${token} browser local`;
    const localHTML = `<i>${token} browser local</i>`;
    process.stderr.write('clipboard-e2e: browser Clipboard API read\n');
    await first.evaluate(`(async()=>{
      const png=Uint8Array.from(${JSON.stringify([...png])});
      await navigator.clipboard.write([new ClipboardItem({
        'text/plain':new Blob([${JSON.stringify(localPlain)}],{type:'text/plain'}),
        'text/html':new Blob([${JSON.stringify(localHTML)}],{type:'text/html'}),
        'image/png':new Blob([png],{type:'image/png'})
      })]);
      return window.remoteXApp.client.clipboard.syncToRemote({action:'set'});
    })()`);
    assert.equal((await readXTarget('UTF8_STRING')).toString(), localPlain);
    assert((await readXTarget('text/html')).toString().includes(token));
    assertOnePixelPNG(await readXTarget('image/png'));
    for (const viewer of viewers) {
      await viewer.evaluate(`(() => {
        const clipboard=window.remoteXApp.client.clipboard;
        for (const offer of clipboard.snapshot().pending) clipboard.dismiss(offer.id);
      })()`);
    }
    result.checks.push('browser-clipboard-read-to-remote');
  }

  const remotePlain = `${token} remote owner`;
  process.stderr.write('clipboard-e2e: remote XFixes owner to browser\n');
  const releaseOwner = await ownRemotePlain(remotePlain);
  try {
    for (const viewer of viewers) {
      await waitFor(viewer, `window.remoteXApp.client.clipboard.snapshot().pending.some(offer => offer.direction==='toLocal')`, 'Viewer did not receive XFixes remote offer');
    }
    if (second) {
      const offerID = await second.evaluate("window.remoteXApp.client.clipboard.snapshot().pending.find(offer=>offer.direction==='toLocal').id");
      const firstID = await first.evaluate("window.remoteXApp.client.clipboard.snapshot().pending.find(offer=>offer.direction==='toLocal').id");
      assert.equal(firstID, offerID);
      await first.evaluate(`window.remoteXApp.client.clipboard.dismiss(${JSON.stringify(firstID)})`);
      assert(await second.evaluate(`window.remoteXApp.client.clipboard.snapshot().pending.some(offer=>offer.id===${JSON.stringify(offerID)})`));
      await second.evaluate(`window.remoteXApp.client.clipboard.syncToLocal(${JSON.stringify(offerID)})`);
      assert.equal(await second.evaluate('navigator.clipboard.readText()'), remotePlain);
    } else {
      const offerID = await first.evaluate("window.remoteXApp.client.clipboard.snapshot().pending.find(offer=>offer.direction==='toLocal').id");
      await first.evaluate(`window.remoteXApp.client.clipboard.syncToLocal(${JSON.stringify(offerID)})`);
      assert.equal(await first.evaluate('navigator.clipboard.readText()'), remotePlain);
    }
    result.checks.push('xfixes-to-browser-and-independent-dismiss');
  } finally {
    releaseOwner();
  }

  if (mode === 'full') {
    process.stderr.write('clipboard-e2e: view-only Viewer\n');
    await second.evaluate('window.remoteXApp.client.setViewOnly(true).then(()=>true)');
    await waitFor(second, "window.remoteXApp.client.state==='connected'", 'view-only Viewer did not reconnect');
    await second.evaluate("window.remoteXApp.client.clipboard.configure({toRemote:'manual',toLocal:'manual'})");
    const viewOnlyError = await second.evaluate(`window.remoteXApp.client.clipboard.send([{type:'text/plain',data:'blocked'}]).then(()=>'',error=>error.message)`);
    assert.match(viewOnlyError, /view-only/);
    const viewOnlyOffer = explicitSendExpression('set', '-view-only');
    await first.evaluate(viewOnlyOffer.expression);
    await waitFor(second, "window.remoteXApp.client.clipboard.snapshot().pending.some(offer=>offer.direction==='toLocal')", 'view-only Viewer did not receive broadcast');
    result.checks.push('view-only-receive-and-send-block');

    process.stderr.write('clipboard-e2e: reconnect recovery\n');
    await second.evaluate(`(() => {
      const client=window.remoteXApp.client;
      client.reconnectDelays=[1000];
      client.clipboard.configure({toRemote:'manual',toLocal:'manual'});
      client.input.close();
      return true;
    })()`);
    await waitFor(second, "window.remoteXApp.client.state==='disconnected'&&window.remoteXApp.client.reconnectTimer!==null", 'Viewer did not schedule automatic reconnect');
    const recovery = explicitSendExpression('set', '-recovery');
    await first.evaluate(recovery.expression);
    const recoveryID = await first.evaluate(`(async()=>{
      const client=window.remoteXApp.client;
      const offers=await client.manager.listClipboardOffers(client.instanceId,{sessionGeneration:client.instance.sessionGeneration});
      return offers.filter(offer=>offer.direction==='toLocal'&&offer.sourceViewerId===client.clipboard.viewerId).sort((a,b)=>b.sequence-a.sequence)[0].id;
    })()`);
    await waitFor(second, "window.remoteXApp.client.state==='connected'", 'Viewer did not reconnect');
    await waitFor(second, `window.remoteXApp.client.clipboard.snapshot().pending.some(offer=>offer.id===${JSON.stringify(recoveryID)}&&offer.recovered)`, 'reconnected Viewer did not recover pending offers');
    result.checks.push('reconnect-list-recovery');

    process.stderr.write('clipboard-e2e: permission degradation\n');
    await second.evaluate('window.remoteXApp.client.setViewOnly(false).then(()=>true)');
    await waitFor(second, "window.remoteXApp.client.state==='connected'", 'Viewer did not leave view-only mode');
    await resetClipboardPermission(second);
    await second.evaluate("window.remoteXApp.client.clipboard.configure({toRemote:'auto',toLocal:'auto'})");
    const degraded = await second.evaluate('window.remoteXApp.client.clipboard.refreshCapabilities()');
    assert.equal(degraded.config.toRemote, 'prompt');
    if (degraded.permissions.write !== 'granted') assert.equal(degraded.config.toLocal, 'prompt');
    result.checks.push('permission-dependent-auto-degradation');

    process.stderr.write('clipboard-e2e: standard Console prompt\n');
    await grantClipboard(second);
    await second.evaluate("window.remoteXApp.client.clipboard.configure({toRemote:'off',toLocal:'prompt'})");
    const promptOffer = explicitSendExpression('set', '-prompt');
    await first.evaluate(promptOffer.expression);
    await waitFor(second, "document.querySelectorAll('.remotexapp-clipboard-prompts [data-offer-id]').length>0", 'standard prompt did not appear');
    const promptLayout = await second.evaluate(`(async()=>{
      const clipboard=window.remoteXApp.client.clipboard;
      const root=document.querySelector('.remotexapp-clipboard-prompts');
      root.parentElement.classList.add('clipboard-regression-host');
      const style=document.createElement('style');
      style.textContent='.clipboard-regression-host > * { width:100%; height:100%; }';
      document.head.append(style);
      clipboard.configure({toRemote:'prompt',toLocal:'prompt'});
      window.remoteXApp.client.focus();
      await clipboard._offerLocal([{type:'text/plain',data:new TextEncoder().encode(${JSON.stringify(`${token} layout local`)})}],'layout-regression');
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const bars=[...root.querySelectorAll('[data-offer-id]')];
      const parentRect=root.parentElement.getBoundingClientRect();
      const rootRect=root.getBoundingClientRect();
      const barRects=bars.map(bar=>bar.getBoundingClientRect());
      const belowY=Math.min(parentRect.bottom-4,Math.max(...barRects.map(rect=>rect.bottom))+12);
      const hit=document.elementFromPoint(parentRect.left+Math.min(80,parentRect.width/2),belowY);
      return {
        rootHeight:rootRect.height,parentHeight:parentRect.height,bars:bars.map(bar=>({
          direction:bar.dataset.direction,state:bar.dataset.state,text:bar.querySelector('span').textContent,
          background:getComputedStyle(bar).backgroundColor,height:bar.getBoundingClientRect().height,
          yesLabel:bar.querySelector('button').getAttribute('aria-label'),
          dismissLabel:bar.querySelectorAll('button')[1].getAttribute('aria-label'),
        })),belowOutsidePrompt:!root.contains(hit),rootStyle:{height:root.style.height,maxHeight:root.style.maxHeight,alignContent:root.style.alignContent},
      };
    })()`);
    assert(promptLayout.rootHeight < promptLayout.parentHeight);
    assert(promptLayout.bars.every(bar => bar.height < promptLayout.parentHeight));
    assert.equal(promptLayout.belowOutsidePrompt, true);
    assert.deepEqual(promptLayout.rootStyle, { height:'fit-content', maxHeight:'100%', alignContent:'start' });
    assert(promptLayout.bars.some(bar => bar.direction === 'toRemote' && /Local → Remote/.test(bar.text) && bar.background === 'rgb(180, 35, 24)'));
    assert(promptLayout.bars.some(bar => bar.direction === 'toLocal' && /Remote → Local/.test(bar.text) && bar.background === 'rgb(7, 89, 133)'));
    assert(promptLayout.bars.every(bar => /clipboard/i.test(bar.yesLabel) && /clipboard/i.test(bar.dismissLabel)));
    await second.evaluate("(()=>{for(const button of document.querySelectorAll('.remotexapp-clipboard-prompts button[aria-label^=\"Dismiss\"]'))button.click()})()");
    result.checks.push('host-wildcard-css-prompt-layout-direction-and-hit-testing');

    process.stderr.write('clipboard-e2e: consistency, stale consent and unchanged owner takeover\n');
    await grantClipboard(first);
    await first.evaluate(`(() => {
      const client=window.remoteXApp.client, c=client.clipboard;
      c.configure({toRemote:'prompt',toLocal:'prompt',checkOnFocus:false});
      for(const offer of c.snapshot().pending)c.dismiss(offer.id);
      client.focus();
    })()`);
    const unchanged = `${token} unchanged remote`;
    const firstOwner = await ownRemotePlain(unchanged);
    let secondOwner;
    try {
      await waitFor(first, "window.remoteXApp.client.clipboard.snapshot().pending.some(o=>o.direction==='toLocal')", 'initial consistency offer missing');
      const revision = await first.evaluate(`(async()=>{
        const c=window.remoteXApp.client;
        return (await c.manager.getClipboardCapabilities(c.instanceId,{sessionGeneration:c.instance.sessionGeneration})).sequence;
      })()`);
      await first.evaluate("(()=>{const c=window.remoteXApp.client.clipboard;for(const o of c.snapshot().pending)c.dismiss(o.id)})()");
      secondOwner = await ownRemotePlain(unchanged);
      await sleep(400);
      assert.equal(await first.evaluate(`(async()=>{
        const c=window.remoteXApp.client;
        return (await c.manager.getClipboardCapabilities(c.instanceId,{sessionGeneration:c.instance.sessionGeneration})).sequence;
      })()`), revision, 'unchanged X11 takeover changed the content revision');
      await first.evaluate(`(async()=>{
        await navigator.clipboard.writeText(${JSON.stringify(`${token} local one`)});
        await window.remoteXApp.client.clipboard._reconcileLocal('consistency-e2e');
        await window.remoteXApp.client.clipboard.list({recovery:true});
      })()`);
      const directions = await first.evaluate('window.remoteXApp.client.clipboard.snapshot().pending.map(o=>o.direction)');
      assert.deepEqual(directions, ['toRemote'], 'local-only change resurrected a remote prompt');
      const oldID = await first.evaluate("window.remoteXApp.client.clipboard.snapshot().pending[0].id");
      const staleError = await first.evaluate(`(async()=>{
        await navigator.clipboard.writeText(${JSON.stringify(`${token} local two`)});
        return window.remoteXApp.client.clipboard.approve(${JSON.stringify(oldID)}).then(()=>'',e=>e.message);
      })()`);
      assert.match(staleError, /Local clipboard changed|expired or was superseded/);
      assert.equal((await readXTarget('UTF8_STRING')).toString(), unchanged, 'stale Yes modified remote clipboard');
      await waitFor(first, `([...document.querySelectorAll('.remotexapp-clipboard-prompts [data-direction="toRemote"]')].some(bar=>bar.textContent.includes(${JSON.stringify(`${token} local two`)}) && !bar.textContent.includes('Loading preview')))`, 'local pre-consent preview missing');
      assert.equal((await readXTarget('UTF8_STRING')).toString(), unchanged, 'preview wrote the remote clipboard before approval');
      result.checks.push('local-pre-consent-real-clipboard-preview-without-write');
      const successNotice = await first.evaluate(`(async()=>{
        const c=window.remoteXApp.client.clipboard;
        await c._reconcileLocal('consistency-e2e');
        const offer=c.snapshot().pending.find(o=>o.direction==='toRemote');
        if(!offer)throw new Error('latest local offer missing');
        const bar=[...document.querySelectorAll('.remotexapp-clipboard-prompts [data-offer-id]')].find(node=>node.dataset.offerId===offer.id);
        if(!bar)throw new Error('latest local prompt missing');
        await bar.querySelector('button').onclick();
        return {state:bar.dataset.state,buttons:bar.querySelectorAll('button').length,text:bar.textContent};
      })()`);
      assert.equal(successNotice.state, 'success');
      assert.equal(successNotice.buttons, 0);
      assert.match(successNotice.text, /Local → Remote.*Plain text/);
      assert(successNotice.text.includes(`${token} local two`));
      result.checks.push('successful-sync-notice-content-preview-without-action-buttons');
      assert.equal((await readXTarget('UTF8_STRING')).toString(), `${token} local two`);
      await sleep(150);
      assert.equal(await first.evaluate("window.remoteXApp.client.clipboard.snapshot().pending.filter(o=>o.direction==='toLocal').length"), 0);
      result.checks.push('unchanged-native-owner-no-prompt-local-only-recovery-and-stale-yes');
    } finally {
      secondOwner?.(); firstOwner();
    }

    process.stderr.write('clipboard-e2e: reload reset\n');
    await second.evaluate("window.remoteXApp.client.clipboard.configure({toRemote:'prompt',toLocal:'prompt'})");
    await second.target.command('Page.reload', { ignoreCache:true });
    await waitFor(second, "window.remoteXApp?.client?.state==='connected'", 'Viewer did not reconnect after reload');
    const reset = await second.evaluate('window.remoteXApp.client.clipboard.snapshot().config');
    assert.deepEqual(reset, { toRemote:'off', toLocal:'off', checkOnFocus:true });
    result.checks.push('reload-resets-policy');
  }
} finally {
  for (const viewer of viewers) viewer.browser.close();
  for (const viewer of viewers) viewer.target.close();
}

process.stdout.write(`${JSON.stringify({ ...result, result:'passed' })}\n`);
