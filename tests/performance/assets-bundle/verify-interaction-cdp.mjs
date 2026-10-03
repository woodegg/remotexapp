const cdpPort = Number(process.env.P07_CDP_PORT || 9225);
const firstText = process.env.P07_FIRST_TEXT || 'P07 中文 input';
const secondText = process.env.P07_SECOND_TEXT || ' reconnect OK';
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
  if (!message.id) return;
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
  const result = await command('Runtime.evaluate', {
    expression,
    awaitPromise:true,
    returnByValue:true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'browser evaluation failed');
  }
  return result.result.value;
}

async function waitForState(state, timeoutMS = 10000) {
  const deadline = Date.now() + timeoutMS;
  while (Date.now() < deadline) {
    if (await evaluate(`window.remoteXApp?.client?.state === ${JSON.stringify(state)}`)) return;
    await sleep(20);
  }
  throw new Error(`RemoteXAppClient did not reach ${state}`);
}

async function waitForTextFocus(timeoutMS = 10000) {
  const deadline = Date.now() + timeoutMS;
  while (Date.now() < deadline) {
    if (await evaluate(`(() => {
      const cursor = window.remoteXApp?.client?.getDiagnostics().cursor;
      return cursor?.focused === true && cursor?.enabled === true;
    })()`)) return;
    await sleep(20);
  }
  throw new Error('Remote application did not publish focused text input');
}

await waitForState('connected');
await waitForTextFocus();
const firstAck = await evaluate(`window.remoteXApp.client.sendText(${JSON.stringify(firstText)})`);
await evaluate(`window.remoteXApp.client.disconnect()`);
await waitForState('disconnected');
const reconnectStarted = performance.now();
// Start reconnect without asking CDP to hold a Runtime.evaluate response open
// for the whole browser-side WebSocket handshake. The Node WebSocket client
// does not itself keep the event loop alive while that response is pending;
// waitForState's timer gives the harness an explicit, bounded liveness source.
await evaluate(`void window.remoteXApp.client.connect()`);
await waitForState('connected');
await waitForTextFocus();
const reconnectMS = performance.now() - reconnectStarted;
const secondAck = await evaluate(`window.remoteXApp.client.sendText(${JSON.stringify(secondText)})`);
await sleep(100);
const state = await evaluate(`({
  state:window.remoteXApp.client.state,
  rfbState:window.remoteXApp.client.getDiagnostics().rfbState,
  inputState:window.remoteXApp.client.getDiagnostics().inputState,
})`);

socket.close();
console.log(JSON.stringify({ firstText, secondText, firstAck, secondAck, reconnectMS, state }));
