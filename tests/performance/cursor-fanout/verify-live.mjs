const managerURL = process.env.P11_MANAGER_URL || 'http://127.0.0.1:1992';
const instanceID = process.env.P11_INSTANCE_ID;
const cdpPort = Number(process.env.P11_CDP_PORT || 9232);
const text = process.env.P11_TEXT || 'P11 cursor observer';
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

if (!instanceID) throw new Error('P11_INSTANCE_ID is required');

async function openInputObserver() {
  const url = new URL(`/remotexapps/${instanceID}/input`, managerURL);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url);
  const cursors = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.type === 'cursor-position') cursors.push(message);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once:true });
    socket.addEventListener('error', () => reject(new Error('input observer failed')), { once:true });
  });
  return { socket, cursors };
}

async function waitForCursor(observer, predicate, message) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const match = observer.cursors.find(predicate);
    if (match) return match;
    await sleep(10);
  }
  throw new Error(`${message}; received=${JSON.stringify(observer.cursors)}`);
}

const targets = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then(response => response.json());
const page = targets.find(item => item.type === 'page' && item.url.includes(`/remotexapps/${instanceID}/`));
if (!page) throw new Error('remotexapp page not found');
const cdp = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  cdp.addEventListener('open', resolve, { once:true });
  cdp.addEventListener('error', () => reject(new Error('CDP connection failed')), { once:true });
});
let nextID = 0;
const pending = new Map();
cdp.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});
function command(method, params = {}) {
  const id = ++nextID;
  cdp.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(expression) {
  const response = await command('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
}

const first = await openInputObserver();
first.socket.send(JSON.stringify({ type:'cursor' }));
const initial = await waitForCursor(first, () => true, 'initial cursor was not delivered');
const ack = await evaluate(`window.remoteXApp.client.sendText(${JSON.stringify(text)})`);
const pushed = await waitForCursor(first, cursor => cursor.sequence > initial.sequence, 'new cursor was not pushed');

const second = await openInputObserver();
const cached = await waitForCursor(second, cursor => cursor.sequence >= pushed.sequence, 'cached cursor was not delivered on reconnect');

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

first.socket.close();
second.socket.close();
cdp.close();
console.log(JSON.stringify({
  initialSequence:initial.sequence,
  pushedSequence:pushed.sequence,
  cachedSequence:cached.sequence,
  firstObserverEvents:first.cursors.length,
  secondObserverEvents:second.cursors.length,
	selectedAndCopied:true,
  ack,
}, null, 2));
