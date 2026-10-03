// FFX-007: actual remote application readback, not merely engine ACK.
// Requires a disposable Firefox runtime, connected Chrome viewer CDP and X11.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const managerURL = process.env.VALIDATION_MANAGER_URL || 'http://127.0.0.1:21991';
const id = process.env.VALIDATION_INSTANCE_ID;
const cdpPort = process.env.VALIDATION_CDP_PORT || '9242';
if (!id) throw new Error('VALIDATION_INSTANCE_ID is required');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function rpc(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    pending.get(message.id)?.(message);
  };
  return { ws, call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const request = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(request);
        reject(new Error(`${method}: timeout`));
      }, 15000);
      pending.set(request, message => {
        clearTimeout(timer);
        pending.delete(request);
        message.error ? reject(new Error(JSON.stringify(message))) : resolve(message.result);
      });
      ws.send(JSON.stringify({ id:request, method, params }));
    });
  } };
}
const instance = await fetch(`${managerURL}/api/instances/${id}`).then(r => r.json());
assert.equal(instance.driverVersion, process.env.VALIDATION_FIREFOX_VERSION || '2.2.0');
assert.equal(instance.resources.control.address, '127.0.0.1');
assert.equal(instance.applicationStatus.details.control.port, instance.resources.control.port);
// Deployed managers intentionally hide host paths. The local operator may
// supply the authority without changing the manager's expose-internals policy.
const authority = process.env.VALIDATION_XAUTHORITY || (instance.homePath && `${instance.homePath}/.Xauthority`);
assert.ok(authority, 'VALIDATION_XAUTHORITY is required when host paths are hidden');
const xenv = { ...process.env, DISPLAY:instance.display, XAUTHORITY:authority };
const pages = await fetch(`http://127.0.0.1:${cdpPort}/json`).then(r => r.json());
const cdp = await rpc(pages.find(p => p.type === 'page' && p.url.includes(id)).webSocketDebuggerUrl);
let bidi;
let session = false;
const observations = [];
try {
  async function local(expression) {
    const response = await cdp.call('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true });
    assert.ok(!response.exceptionDetails, JSON.stringify(response.exceptionDetails));
    return response.result.value;
  }
  for (let i = 0; i < 150 && await local('window.remoteXApp?.client?.state') !== 'connected'; i++) await sleep(100);
  assert.equal(await local('window.remoteXApp?.client?.state'), 'connected');
  bidi = await rpc(`ws://127.0.0.1:${instance.resources.control.port}/session`);
  const status = await bidi.call('session.status');
  assert.equal(status.ready, true);
  const capabilities = await bidi.call('session.new', { capabilities:{} });
  session = true;
  async function remote(context, expression) {
    const response = await bidi.call('script.evaluate', { expression:`JSON.stringify(${expression})`, target:{ context }, awaitPromise:true });
    assert.equal(response.type, 'success', JSON.stringify(response));
    return JSON.parse(response.result.value);
  }
  const html = '<title>FFX-007 synthetic IME test</title><input id="plain"><textarea id="area"></textarea><div id="edit" contenteditable="true"></div>';
  const contexts = [(await bidi.call('browsingContext.getTree')).contexts[0].context];
  for (const type of ['tab', 'window']) contexts.push((await bidi.call('browsingContext.create', { type })).context);
  for (const context of contexts) await bidi.call('browsingContext.navigate', { context, url:`data:text/html,${encodeURIComponent(html)}`, wait:'complete' });
  // Revisit earlier tabs/windows, then reconnect the viewer and repeat.
  for (const [round, context] of [...contexts, contexts[0], contexts[2], contexts[0]].entries()) {
    console.error(`firefox-ime: round ${round}, tab/window focus and actual readback`);
    if (round === 3) {
      await local('window.remoteXApp.client.reconnect().then(() => true)');
      for (let i = 0; i < 100 && await local('window.remoteXApp.client.state') !== 'connected'; i++) await sleep(100);
      assert.equal(await local('window.remoteXApp.client.state'), 'connected');
    }
    await bidi.call('browsingContext.activate', { context });
    await sleep(250);
    for (const field of ['plain', 'area', 'edit']) {
      const before = await remote(context, `(()=>{ const e=document.getElementById('${field}'); e.focus(); if ('value' in e) e.value=''; else e.textContent=''; const r=e.getBoundingClientRect(); return {x:mozInnerScreenX+r.x+Math.min(20,r.width/2),y:mozInnerScreenY+r.y+r.height/2}; })()`);
      execFileSync('xdotool', ['mousemove', String(Math.round(before.x)), String(Math.round(before.y)), 'click', '1'], { env:xenv });
      await sleep(300);
      await local("(()=>{const c=window.remoteXApp.client;c.sendKey(120,'KeyX',true);c.sendKey(120,'KeyX',false);return true})()");
      // Observe delivery, not an arbitrary 100 ms scheduling assumption. Send
      // the key once; never retry input or hide a focus/routing failure.
      let rawActual;
      const rawDeadline = Date.now() + 3000;
      do {
        rawActual = await remote(context, `document.getElementById('${field}').value ?? document.getElementById('${field}').textContent`);
        if (rawActual === 'x') break;
        await sleep(100);
      } while (Date.now() < rawDeadline);
      if (rawActual !== 'x') {
        console.error('firefox-ime raw-key diagnostic', JSON.stringify({round, field, click:before,
          remote:await remote(context, `({focused:document.hasFocus(),active:document.activeElement?.id,innerX:mozInnerScreenX,innerY:mozInnerScreenY,width:innerWidth,height:innerHeight})`),
          viewer:await local('({state:window.remoteXApp.client.state,rfb:window.remoteXApp.client.rfb?._rfbConnectionState,viewOnly:window.remoteXApp.client.viewOnly,mask:window.remoteXApp.client.connectionMask})'),
          xfocus:execFileSync('xdotool', ['getwindowfocus'], {env:xenv,encoding:'utf8'}).trim()}));
      }
      assert.equal(rawActual, 'x', `round=${round}, field=${field}`);
      let expected = 'x';
      for (const text of ['AsciiProbe', '中文测试']) {
        const ack = await local(`window.remoteXApp.client.sendText(${JSON.stringify(text)})`);
        assert.equal(ack.error, '');
        expected += text;
        let actual;
        for (let i = 0; i < 30; i++) {
          actual = await remote(context, `document.getElementById('${field}').value ?? document.getElementById('${field}').textContent`);
          if (actual === expected) break;
          await sleep(100);
        }
        assert.equal(actual, expected, `round=${round}, field=${field}`);
        observations.push({ round, field, text, actual, ack:true });
      }
    }
    // Native browser chrome steals focus, then Escape and a field click restore it.
    execFileSync('xdotool', ['key', 'ctrl+l'], { env:xenv });
    await sleep(100);
    execFileSync('xdotool', ['key', 'Escape'], { env:xenv });
  }
  for (const context of contexts.slice(1)) await bidi.call('browsingContext.close', { context });
  await bidi.call('session.end');
  session = false;
  // Firefox detaches this WebSocket from the ended session; probe readiness
  // through a fresh transport rather than sending to the detached connection.
  bidi.ws.close();
  bidi = await rpc(`ws://127.0.0.1:${instance.resources.control.port}/session`);
  assert.equal((await bidi.call('session.status')).ready, true);
  console.log(JSON.stringify({ result:'passed', instanceId:id, driverVersion:instance.driverVersion,
    browserVersion:capabilities.capabilities.browserVersion, control:instance.resources.control,
    checks:['actual-readback', 'ASCII', 'Unicode', 'RFB', 'tab-window-focus', 'native-chrome-focus-return', 'viewer-reconnect', 'BiDi-lifecycle'], observations }, null, 2));
} finally {
  if (session) await bidi.call('session.end').catch(() => {});
  bidi?.ws.close();
  cdp.ws.close();
}
