const cdpPort = Number(process.env.P13_CDP_PORT || 9233);
const instanceID = process.env.P13_INSTANCE_ID;
const count = Number(process.env.P13_REQUESTS || 600);
const intervalMS = Number(process.env.P13_INTERVAL_MS || 50);
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

if (!instanceID) throw new Error('P13_INSTANCE_ID is required');
if (!Number.isInteger(count) || count < 1) throw new Error('P13_REQUESTS must be a positive integer');
if (!Number.isFinite(intervalMS) || intervalMS < 0) throw new Error('P13_INTERVAL_MS must be non-negative');

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
    await sleep(20);
  }
  throw new Error(message);
}

await command('Page.enable');
await waitFor("window.remoteXApp?.client?.state === 'connected'", 'client did not connect');
await waitFor("window.remoteXApp?.client?.getDiagnostics().cursor?.focused === true", 'application did not obtain IBus focus');

const result = await evaluate(`(async () => {
  const client = window.remoteXApp.client;
  const count = ${count};
  const interval = ${intervalMS};
  const chord = (keysym, code) => {
    client.sendKey(0xffe3, 'ControlLeft', true);
    client.sendKey(keysym, code, true);
    client.sendKey(keysym, code, false);
    client.sendKey(0xffe3, 'ControlLeft', false);
  };
  chord(0x61, 'KeyA');
  client.sendKey(0xff08, 'Backspace', true);
  client.sendKey(0xff08, 'Backspace', false);
  await new Promise(resolve => setTimeout(resolve, 100));
  const values = Array.from({ length:count }, (_, index) => index % 10 === 0 ? '你' : 'a');
  const expected = values.join('');
  const server = [];
  const roundTrip = [];
  const started = performance.now();
  for (let index = 0; index < values.length; index += 1) {
    const target = started + index * interval;
    const remaining = target - performance.now();
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
    const sentAt = performance.now();
    const ack = await client.sendText(values[index]);
    server.push(ack.serverMs);
    roundTrip.push(performance.now() - sentAt);
  }
  const finished = performance.now();
  const summarize = values => {
    const ordered = [...values].sort((a, b) => a - b);
    const percentile = fraction => ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))];
    return {
      min:ordered[0], p50:percentile(.5), p95:percentile(.95), max:ordered.at(-1),
      mean:values.reduce((sum, value) => sum + value, 0) / values.length,
    };
  };
  chord(0x61, 'KeyA');
  chord(0x63, 'KeyC');
  await new Promise(resolve => setTimeout(resolve, 150));
  return {
    requests:count,
    intervalMs:interval,
    durationMs:finished - started,
    expectedCharacters:expected.length,
    expectedUtf8Bytes:new TextEncoder().encode(expected).length,
    serverMs:summarize(server),
    roundTripMs:summarize(roundTrip),
    state:client.state,
    rfbState:client.getDiagnostics().rfbState,
    inputState:client.getDiagnostics().inputState,
  };
})()`);

socket.close();
console.log(JSON.stringify(result, null, 2));
