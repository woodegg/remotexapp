const cdpPort = Number(process.env.P12_CDP_PORT || 9232);
const instanceID = process.env.P12_INSTANCE_ID;
const expectedDelay = Number(process.env.P12_EXPECTED_DELAY || 16);
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

if (!instanceID) throw new Error('P12_INSTANCE_ID is required');

async function findPage() {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      const pages = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then(response => response.json());
      const page = pages.find(item => item.type === 'page' && item.url.includes(`/remotexapps/${instanceID}/`));
      if (page) return page;
    } catch (_) {}
    await sleep(100);
  }
  throw new Error('remotexapp page not found');
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
  const response = await command('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  }
  return response.result.value;
}

async function waitFor(expression, message, timeoutMS = 10000) {
  const deadline = Date.now() + timeoutMS;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await sleep(10);
  }
  throw new Error(message);
}

await command('Page.enable');
await waitFor("window.remoteXApp?.client?.state === 'connected'", 'client did not connect');
await waitFor("window.remoteXApp?.client?.getDiagnostics().cursor?.focused === true", 'Mousepad did not obtain IBus focus');

await evaluate(`(() => {
  const client = window.remoteXApp.client;
  window.p12 = { acks:[] };
  client.addEventListener('textack', event => window.p12.acks.push({ ...event.detail, at:performance.now() }));
  const waitAck = async (before, started) => {
    const deadline = performance.now() + 3000;
    while (window.p12.acks.length === before && performance.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    if (window.p12.acks.length === before) throw new Error('text acknowledgement timeout');
    const ack = window.p12.acks.at(-1);
    return { ...ack, inputToAckMs:ack.at - started };
  };
  window.p12.input = async value => {
    const before = window.p12.acks.length;
    const started = performance.now();
    client.ime.value = value;
    client.ime.dispatchEvent(new InputEvent('input', { data:value, inputType:'insertText', bubbles:true }));
    return waitAck(before, started);
  };
  window.p12.composition = async value => {
    client.ime.dispatchEvent(new CompositionEvent('compositionstart', { data:'', bubbles:true }));
    const before = window.p12.acks.length;
    const started = performance.now();
    client.ime.dispatchEvent(new CompositionEvent('compositionend', { data:value, bubbles:true }));
    return waitAck(before, started);
  };
  window.p12.burst = async values => {
    const before = window.p12.acks.length;
    const started = performance.now();
    for (const value of values) {
      client.ime.value = value;
      client.ime.dispatchEvent(new InputEvent('input', { data:value, inputType:'insertText', bubbles:true }));
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const ack = await waitAck(before, started);
    return { ...ack, newAcks:window.p12.acks.length - before };
  };
})()`);

const sdkVersion = await evaluate(`import('/sdk/index.js').then(module => module.SDK_VERSION)`);
const diagnostics = await evaluate('window.remoteXApp.client.getDiagnostics()');
if (diagnostics.textBatchDelay !== expectedDelay) {
  throw new Error(`textBatchDelay=${diagnostics.textBatchDelay}, want ${expectedDelay}`);
}

const ordinaryA = await evaluate("window.p12.input('A')");
const chineseOne = await evaluate("window.p12.composition('你好')");
const firstEnglishOne = await evaluate("window.p12.input('i')");
const chineseTwo = await evaluate("window.p12.composition('世界')");
const firstEnglishTwo = await evaluate("window.p12.input('x')");
const burst = await evaluate("window.p12.burst(['a','b','c','d','e'])");
if (burst.value !== 'abcde' || burst.newAcks !== 1) {
  throw new Error(`burst was not coalesced: ${JSON.stringify(burst)}`);
}

const stale = await evaluate(`(async () => {
  const client = window.remoteXApp.client;
  const before = window.p12.acks.length;
  client.ime.value = 'DROP';
  client.ime.dispatchEvent(new InputEvent('input', { data:'DROP', inputType:'insertText', bubbles:true }));
  const started = performance.now();
  await client.reconnect();
  const reconnectMs = performance.now() - started;
  await new Promise(resolve => setTimeout(resolve, 50));
  return { reconnectMs, newAcks:window.p12.acks.length - before, pendingText:client.pendingText };
})()`);
if (stale.newAcks !== 0 || stale.pendingText !== '') {
  throw new Error(`stale batch crossed reconnect: ${JSON.stringify(stale)}`);
}
const afterReconnect = await evaluate("window.p12.input('R')");

const beforeFramebuffer = await evaluate('window.remoteXApp.client.getDiagnostics().framebuffer');
const targetViewport = beforeFramebuffer.width === 900 ? { width:1100, height:760 } : { width:900, height:640 };
await command('Emulation.setDeviceMetricsOverride', { ...targetViewport, deviceScaleFactor:1, mobile:false });
await waitFor(`window.remoteXApp.client.refreshDiagnostics().then(() => {
  const value = window.remoteXApp.client.getDiagnostics().framebuffer;
  return value && (value.width !== ${beforeFramebuffer.width} || value.height !== ${beforeFramebuffer.height});
})`, 'remote framebuffer did not resize');
const afterFramebuffer = await evaluate('window.remoteXApp.client.getDiagnostics().framebuffer');

const pointerTarget = await evaluate(`(() => {
  const bounds = document.querySelector('canvas').getBoundingClientRect();
  return { x:bounds.left + bounds.width * .6, y:bounds.top + bounds.height * .4 };
})()`);
await command('Input.dispatchMouseEvent', { type:'mouseMoved', x:pointerTarget.x, y:pointerTarget.y, button:'none' });
await command('Input.dispatchMouseEvent', { type:'mousePressed', x:pointerTarget.x, y:pointerTarget.y, button:'left', clickCount:1 });
await command('Input.dispatchMouseEvent', { type:'mouseReleased', x:pointerTarget.x, y:pointerTarget.y, button:'left', clickCount:1 });

await evaluate(`(() => {
  const client = window.remoteXApp.client;
  const chord = (keysym, code) => {
    client.sendKey(0xffe3, 'ControlLeft', true);
    client.sendKey(keysym, code, true);
    client.sendKey(keysym, code, false);
    client.sendKey(0xffe3, 'ControlLeft', false);
  };
  chord(0x61, 'KeyA');
  chord(0x63, 'KeyC');
  return true;
})()`);
await sleep(100);

const finalState = await evaluate(`({
  state:window.remoteXApp.client.state,
  rfbState:window.remoteXApp.client.getDiagnostics().rfbState,
  inputState:window.remoteXApp.client.getDiagnostics().inputState,
  textBatchDelay:window.remoteXApp.client.getDiagnostics().textBatchDelay,
  ackValues:window.p12.acks.map(item => item.value),
})`);

socket.close();
console.log(JSON.stringify({
  sdkVersion,
  ordinaryA,
  chineseOne,
  firstEnglishOne,
  chineseTwo,
  firstEnglishTwo,
  burst,
  staleReconnect:stale,
  afterReconnect,
	targetViewport,
  framebuffer:{ before:beforeFramebuffer, after:afterFramebuffer },
  pointerTarget,
  finalState,
}, null, 2));
