const cdpPort = Number(process.env.P15_CDP_PORT || 9245);
const instanceID = process.env.P15_INSTANCE_ID;
const mode = process.env.P15_MODE || 'trailing';
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

if (!instanceID) throw new Error('P15_INSTANCE_ID is required');
if (!['compat', 'trailing', 'max-wait'].includes(mode)) throw new Error(`unsupported P15_MODE: ${mode}`);

async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

async function findPage() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const pages = await fetchJSON(`http://127.0.0.1:${cdpPort}/json/list`);
      const page = pages.find(item => item.type === 'page' && item.url.includes(`/remotexapps/${instanceID}/`));
      if (page) return page;
    } catch (_) {}
    await sleep(100);
  }
  throw new Error('RemoteXApp P15 page not found');
}

const page = await findPage();
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once:true });
  socket.addEventListener('error', () => reject(new Error('CDP WebSocket failed')), { once:true });
});

let nextID = 0;
const pending = new Map();
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});

function command(method, params = {}) {
  const id = ++nextID;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const response = await command('Runtime.evaluate', {
    expression,
    awaitPromise:true,
    returnByValue:true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  }
  return response.result.value;
}

async function waitFor(expression, message, timeoutMS = 15000) {
  const deadline = Date.now() + timeoutMS;
  while (Date.now() < deadline) {
    try {
      const value = await evaluate(expression);
      if (value) return value;
    } catch (_) {}
    await sleep(20);
  }
  throw new Error(message);
}

async function framebuffer() {
  return evaluate(`window.remoteXApp.client.refreshDiagnostics().then(() =>
    window.remoteXApp.client.getDiagnostics().framebuffer)`);
}

async function waitForFramebuffer(target, message, timeoutMS = 10000) {
  return waitFor(`window.remoteXApp.client.refreshDiagnostics().then(() => {
    const value = window.remoteXApp.client.getDiagnostics().framebuffer;
    return value?.width === ${target.width} && value?.height === ${target.height} ? value : false;
  })`, message, timeoutMS);
}

async function setViewport(target) {
  await command('Emulation.setDeviceMetricsOverride', {
    width:target.width,
    height:target.height,
    deviceScaleFactor:1,
    mobile:false,
  });
}

await command('Page.enable');
await waitFor("window.remoteXApp?.client?.state === 'connected'", 'client did not connect');
await waitFor("window.remoteXApp?.client?.getDiagnostics().cursor?.focused === true", 'Mousepad did not obtain IBus focus');
const sdkVersion = await evaluate(`import('/sdk/index.js').then(module => module.SDK_VERSION)`);
const options = await evaluate(`(() => {
  const client = window.remoteXApp.client;
  return {
    resizeDebounce:client.resizeDebounce,
    resizeMaxWait:String(client.resizeMaxWait),
    scaleViewport:client.rfb.scaleViewport,
  };
})()`);

const initial = await framebuffer();
const output = { mode, sdkVersion, options, initial };

if (mode === 'compat') {
  if (options.resizeDebounce !== 0 || options.resizeMaxWait !== 'Infinity' || options.scaleViewport !== false) {
    throw new Error(`unexpected compatibility options: ${JSON.stringify(options)}`);
  }
  const target = initial.width === 930
    ? { width:1010, height:690 }
    : { width:930, height:650 };
  const started = performance.now();
  await setViewport(target);
  const final = await waitForFramebuffer(target, 'compatibility resize did not converge');
  const convergeMs = performance.now() - started;
  if (convergeMs >= 300) throw new Error(`compatibility resize was unexpectedly delayed: ${convergeMs} ms`);
  Object.assign(output, { compatibility:{ target, final, convergeMs } });
} else if (mode === 'trailing') {
  if (options.resizeDebounce !== 300 || options.resizeMaxWait !== 'Infinity' || options.scaleViewport !== true) {
    throw new Error(`unexpected trailing options: ${JSON.stringify(options)}`);
  }

  await evaluate(`(() => {
    const client = window.remoteXApp.client;
    window.p15 = { focus:0, blur:0, acks:[], pointerEvents:[] };
    client.ime.addEventListener('focus', () => window.p15.focus++);
    client.ime.addEventListener('blur', () => window.p15.blur++);
    client.addEventListener('textack', event => window.p15.acks.push(event.detail));
    client.container.addEventListener('pointerdown', event => window.p15.pointerEvents.push({
      button:event.button, isPrimary:event.isPrimary, pointerType:event.pointerType,
      clientX:event.clientX, clientY:event.clientY,
    }), true);
    client.focus();
    window.p15.focus = 0;
    window.p15.blur = 0;
  })()`);
  const primary = { x:Math.floor(initial.cssWidth * .67), y:Math.floor(initial.cssHeight * .56) };
  const primaryAnchor = await evaluate(`(() => {
    const client = window.remoteXApp.client;
    client.container.dispatchEvent(new PointerEvent('pointerdown', {
      button:0, isPrimary:true, pointerType:'mouse',
      clientX:${primary.x}, clientY:${primary.y}, bubbles:true,
    }));
    return {
      left:client.ime.style.left,
      top:client.ime.style.top,
      focus:window.p15.focus,
      blur:window.p15.blur,
      source:client.getDiagnostics().cursor?.positionSource,
      refocused:client.getDiagnostics().cursor?.refocused,
      pointerEvents:window.p15.pointerEvents,
    };
  })()`);
  if (primaryAnchor.left !== `${primary.x}px` || primaryAnchor.top !== `${primary.y}px` ||
      primaryAnchor.focus < 1 || primaryAnchor.blur < 1 || primaryAnchor.refocused !== true) {
    throw new Error(`primary pointer did not re-anchor native IME: ${JSON.stringify(primaryAnchor)}`);
  }
  await command('Input.dispatchMouseEvent', { type:'mouseMoved', ...primary, button:'none' });
  await command('Input.dispatchMouseEvent', { type:'mousePressed', ...primary, button:'left', clickCount:1 });
  await command('Input.dispatchMouseEvent', { type:'mouseReleased', ...primary, button:'left', clickCount:1 });
  await evaluate(`(() => {
    const client = window.remoteXApp.client;
    client.sendKey(0xff50, 'Home', true);
    client.sendKey(0xff50, 'Home', false);
  })()`);
  const remoteCaret = await waitFor(`(() => {
    const cursor = window.remoteXApp.client.getDiagnostics().cursor;
    return cursor?.freshForPointer && cursor.positionSource === 'remote-caret' ? cursor : false;
  })()`, 'fresh remote caret did not supersede the click fallback');

  const beforeRight = await evaluate(`(() => ({
    left:window.remoteXApp.client.ime.style.left,
    top:window.remoteXApp.client.ime.style.top,
    focus:window.p15.focus,
    blur:window.p15.blur,
  }))()`);
  const secondary = { x:Math.floor(initial.cssWidth * .25), y:Math.floor(initial.cssHeight * .25) };
  const afterRight = await evaluate(`(() => {
    const client = window.remoteXApp.client;
    client.container.dispatchEvent(new PointerEvent('pointerdown', {
      button:2, isPrimary:true, pointerType:'mouse',
      clientX:${secondary.x}, clientY:${secondary.y}, bubbles:true,
    }));
    return {
      left:client.ime.style.left,
      top:client.ime.style.top,
      focus:window.p15.focus,
      blur:window.p15.blur,
    };
  })()`);
  if (JSON.stringify(beforeRight) !== JSON.stringify(afterRight)) {
    throw new Error(`secondary pointer replaced IME anchor: ${JSON.stringify({ beforeRight, afterRight })}`);
  }

  const compositionSafe = await evaluate(`(() => {
    const client = window.remoteXApp.client;
    client.ime.dispatchEvent(new CompositionEvent('compositionstart', { data:'', bubbles:true }));
    const before = { focus:window.p15.focus, blur:window.p15.blur };
    client.container.dispatchEvent(new PointerEvent('pointerdown', {
      button:0, isPrimary:true, clientX:410, clientY:270, bubbles:true,
    }));
    const after = { focus:window.p15.focus, blur:window.p15.blur };
    client.ime.dispatchEvent(new CompositionEvent('compositionend', { data:'', bubbles:true }));
    return { before, after, left:client.ime.style.left, top:client.ime.style.top };
  })()`);
  if (JSON.stringify(compositionSafe.before) !== JSON.stringify(compositionSafe.after)) {
    throw new Error(`composition was interrupted by pointer anchor: ${JSON.stringify(compositionSafe)}`);
  }

  const burst = [
    { width:920, height:620 },
    { width:980, height:660 },
    { width:1040, height:700 },
    { width:1100, height:740 },
  ];
  const observedDuringBurst = [];
  for (const target of burst) {
    await setViewport(target);
    await sleep(50);
    observedDuringBurst.push(await framebuffer());
  }
  await sleep(80);
  const beforeQuiet = await framebuffer();
  const finalTarget = burst.at(-1);
  if ([...observedDuringBurst, beforeQuiet].some(value => value.width !== initial.width || value.height !== initial.height)) {
    throw new Error(`remote framebuffer changed before the quiet period: ${JSON.stringify({ initial, observedDuringBurst, beforeQuiet })}`);
  }
  const locallyScaled = beforeQuiet.cssWidth !== initial.cssWidth || beforeQuiet.cssHeight !== initial.cssHeight;
  if (!locallyScaled || beforeQuiet.cssWidth > finalTarget.width || beforeQuiet.cssHeight > finalTarget.height) {
    throw new Error(`old framebuffer was not locally scaled to the final viewport: ${JSON.stringify(beforeQuiet)}`);
  }
  const quietStarted = performance.now();
  const afterQuiet = await waitForFramebuffer(finalTarget, 'trailing remote resize did not converge');
  const quietConvergeMs = performance.now() - quietStarted;

  const flushTarget = { width:960, height:680 };
  await setViewport(flushTarget);
  await sleep(40);
  const flushStarted = performance.now();
  const flushScheduled = await evaluate('window.remoteXApp.client.flushResize()');
  const afterFlush = await waitForFramebuffer(flushTarget, 'explicit flush did not converge');
  const flushConvergeMs = performance.now() - flushStarted;
  if (!flushScheduled || flushConvergeMs >= options.resizeDebounce) {
    throw new Error(`explicit flush did not beat debounce: ${JSON.stringify({ flushScheduled, flushConvergeMs })}`);
  }

  const textAck = await evaluate(`(() => new Promise((resolve, reject) => {
    const client = window.remoteXApp.client;
    const timeout = setTimeout(() => reject(new Error('Unicode text acknowledgement timeout')), 3000);
    client.addEventListener('textack', event => {
      clearTimeout(timeout);
      resolve(event.detail);
    }, { once:true });
    client.ime.dispatchEvent(new CompositionEvent('compositionstart', { data:'', bubbles:true }));
    client.ime.dispatchEvent(new CompositionEvent('compositionend', { data:'P15中', bubbles:true }));
  }))()`);
  if (textAck.value !== 'P15中' || textAck.error) throw new Error(`Unicode commit failed: ${JSON.stringify(textAck)}`);

  const reconnectTarget = { width:1020, height:710 };
  await setViewport(reconnectTarget);
  const reconnectStarted = performance.now();
  await evaluate(`(() => {
    window.p15.reconnectError = '';
    window.remoteXApp.client.reconnect().catch(error => { window.p15.reconnectError = error.message; });
    return true;
  })()`);
  await waitFor(`window.remoteXApp.client.state === 'connected' || window.p15.reconnectError`, 'explicit reconnect did not finish');
  const reconnectError = await evaluate('window.p15.reconnectError');
  if (reconnectError) throw new Error(`explicit reconnect failed: ${reconnectError}`);
  const afterReconnect = await waitForFramebuffer(reconnectTarget, 'reconnect initial resize did not converge');
  const reconnectResizeMs = performance.now() - reconnectStarted;

  Object.assign(output, {
    ime:{ primary, primaryAnchor, remoteCaret, secondary, beforeRight, afterRight, compositionSafe },
    trailing:{ burst, observedDuringBurst, beforeQuiet, afterQuiet, quietConvergeMs },
    flush:{ target:flushTarget, flushScheduled, afterFlush, flushConvergeMs },
    textAck,
    reconnect:{ target:reconnectTarget, afterReconnect, reconnectResizeMs },
  });
} else {
  if (options.resizeDebounce !== 200 || options.resizeMaxWait !== '400' || options.scaleViewport !== true) {
    throw new Error(`unexpected max-wait options: ${JSON.stringify(options)}`);
  }
  const targets = [
    { width:900, height:620 },
    { width:940, height:640 },
    { width:980, height:660 },
    { width:1020, height:680 },
    { width:1060, height:700 },
    { width:1100, height:720 },
    { width:1140, height:740 },
  ];
  const started = performance.now();
  const samples = [];
  for (const target of targets) {
    await setViewport(target);
    await sleep(80);
    samples.push({ elapsedMs:performance.now() - started, framebuffer:await framebuffer() });
  }
  const progressed = samples.find(sample => sample.framebuffer.width !== initial.width || sample.framebuffer.height !== initial.height);
  if (!progressed || progressed.elapsedMs > 550) {
    throw new Error(`finite maximum wait made no bounded progress: ${JSON.stringify({ initial, samples })}`);
  }
  const finalTarget = targets.at(-1);
  const final = await waitForFramebuffer(finalTarget, 'max-wait final resize did not converge');
  Object.assign(output, { maxWait:{ targets, samples, firstProgressMs:progressed.elapsedMs, final } });
}

socket.close();
console.log(JSON.stringify(output, null, 2));
