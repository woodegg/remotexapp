import { execFileSync } from 'node:child_process';

const managerURL = process.env.EXPERIMENT_MANAGER_URL || 'http://127.0.0.1:1992';
const instanceID = process.env.EXPERIMENT_INSTANCE_ID;
const cdpPort = Number(process.env.EXPERIMENT_CDP_PORT || 9246);
const sessionBus = process.env.EXPERIMENT_SESSION_DBUS_ADDRESS;
const ibusAddress = process.env.EXPERIMENT_IBUS_ADDRESS;
const switchText = process.env.EXPERIMENT_SWITCH_TEXT ?? '切换后首字不丢G7';
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

if (!instanceID) throw new Error('EXPERIMENT_INSTANCE_ID is required');
if (!sessionBus || !ibusAddress) throw new Error('session D-Bus and IBus addresses are required');

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

async function waitForCursor(observer, predicate, message, timeoutMS = 5000) {
  const deadline = Date.now() + timeoutMS;
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
await waitForCursor(first, () => true, 'initial cursor was not delivered');
await sleep(100);
const baselineSequence = Math.max(...first.cursors.map(cursor => cursor.sequence));

const ibusEnvironment = {
  ...process.env,
  DBUS_SESSION_BUS_ADDRESS:sessionBus,
  IBUS_ADDRESS:ibusAddress,
};
// Exercise a real input-method lifecycle transition. This reliably invokes
// disable/enable events and is also the user-visible Chinese/English switching
// case in which the first post-switch character must survive.
execFileSync('/usr/bin/ibus', ['engine', 'xkb:us::eng'], { env:ibusEnvironment });
await sleep(100);
execFileSync('/usr/bin/ibus', ['engine', 'remote-unicode'], { env:ibusEnvironment });

const pushed = await waitForCursor(first, cursor => cursor.sequence > baselineSequence,
  'real RFB click did not produce a cursor event in the new engine generation');
const second = await openInputObserver();
const cached = await waitForCursor(second, cursor => cursor.sequence >= pushed.sequence,
  'new observer did not receive the rebased cursor cache');
const switchAck = switchText
  ? await evaluate(`window.remoteXApp.client.sendText(${JSON.stringify(switchText)})`)
  : null;
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
  baselineSequence,
  pushedSequence:pushed.sequence,
  cachedSequence:cached.sequence,
  switchText,
  switchAck,
  selectedAndCopied:true,
  firstObserverEvents:first.cursors.length,
  secondObserverEvents:second.cursors.length,
}, null, 2));
