const cdpPort = Number(process.env.P10_CDP_PORT || 9232);
const text = process.env.P10_TEXT || 'P10 中文 input reconnect OK';
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function findPage() {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      const targets = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then(response => response.json());
      const page = targets.find(item => item.type === 'page' && item.url.includes('/remotexapps/'));
      if (page) return page;
    } catch (_) {}
    await sleep(100);
  }
  throw new Error(`no remotexapp page found on CDP port ${cdpPort}`);
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
  const result = await command('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(expression, message, timeoutMS = 10000) {
  const deadline = Date.now() + timeoutMS;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await sleep(20);
  }
  throw new Error(message);
}

await command('Page.enable');
await waitFor("window.remoteXApp?.client?.state === 'connected'", 'client did not connect');
await waitFor("window.remoteXApp?.client?.getDiagnostics().cursor?.focused === true", 'text input did not focus');

const before = await evaluate('window.remoteXApp.client.getDiagnostics().framebuffer');
let ack;
for (let attempt = 0; attempt < 100; attempt += 1) {
  const result = await evaluate(`window.remoteXApp.client.sendText(${JSON.stringify(text)})
    .then(value => ({ ok:true, value }))
    .catch(error => ({ ok:false, error:error.message }))`);
  if (result.ok) {
    ack = result.value;
    break;
  }
  if (result.error !== 'no focused X11 application class') throw new Error(result.error);
  await sleep(20);
}
if (!ack) throw new Error('text input did not become ready');

const canvas = await evaluate(`(() => {
  const bounds = document.querySelector('canvas').getBoundingClientRect();
  return { x:bounds.left + bounds.width * .5, y:bounds.top + bounds.height * .5 };
})()`);
await command('Input.dispatchMouseEvent', { type:'mouseMoved', x:canvas.x, y:canvas.y, button:'none' });
await command('Input.dispatchMouseEvent', { type:'mousePressed', x:canvas.x, y:canvas.y, button:'left', clickCount:1 });
await command('Input.dispatchMouseEvent', { type:'mouseReleased', x:canvas.x, y:canvas.y, button:'left', clickCount:1 });

const targetViewport = before.width === 1100 ? { width:900, height:640 } : { width:1100, height:760 };
await command('Emulation.setDeviceMetricsOverride', { ...targetViewport, deviceScaleFactor:1, mobile:false });
await waitFor(`window.remoteXApp.client.refreshDiagnostics().then(() => {
  const value = window.remoteXApp.client.getDiagnostics().framebuffer;
  return value && (value.width !== ${before.width} || value.height !== ${before.height});
})`, 'remote framebuffer did not resize');
const after = await evaluate('window.remoteXApp.client.getDiagnostics().framebuffer');

await evaluate('window.remoteXApp.client.disconnect()');
await waitFor("window.remoteXApp.client.state === 'disconnected'", 'client did not disconnect');
const reconnectStarted = performance.now();
await evaluate('void window.remoteXApp.client.connect()');
await waitFor("window.remoteXApp.client.state === 'connected'", 'client did not reconnect');
const reconnectMS = performance.now() - reconnectStarted;
const state = await evaluate(`({
  state:window.remoteXApp.client.state,
  rfbState:window.remoteXApp.client.getDiagnostics().rfbState,
  inputState:window.remoteXApp.client.getDiagnostics().inputState,
})`);

socket.close();
console.log(JSON.stringify({ text, ack, framebuffer:{ before, after }, targetViewport, pointerTarget:canvas, reconnectMS, state }, null, 2));
