const cdpPort = Number(process.env.VALIDATION_CDP_PORT || 9239);
const expectResize = process.env.VALIDATION_EXPECT_RESIZE !== '0';
const timeoutMS = Number(process.env.VALIDATION_TIMEOUT_MS || 30000);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(expression, message) {
  const deadline = Date.now() + timeoutMS;
  for (;;) {
    try {
      if (await evaluate(expression)) return;
    } catch (_) {}
    if (Date.now() >= deadline) throw new Error(message);
    await sleep(50);
  }
}

let page;
for (let attempt = 0; attempt < 200; attempt++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json();
    page = targets.find(target => target.type === 'page' && target.url.includes('/remotexapps/'));
    if (page) break;
  } catch (_) {}
  await sleep(50);
}
if (!page) throw new Error('CDP viewer target was not found');

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once:true });
  socket.addEventListener('error', reject, { once:true });
});
let nextID = 0;
const pending = new Map();
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});
function command(method, params = {}) {
  const id = ++nextID;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'browser evaluation failed');
  return result.result.value;
}

await waitFor("window.remoteXApp?.client?.state === 'connected'", 'client did not connect');
const before = await evaluate('window.remoteXApp.client.getDiagnostics().framebuffer');
const target = before.width === 900 && before.height === 640
  ? { width:1100, height:760 }
  : { width:900, height:640 };
await command('Emulation.setDeviceMetricsOverride', {
  ...target, deviceScaleFactor:1, mobile:false,
});
if (expectResize) {
  const deadline = Date.now() + timeoutMS;
  for (;;) {
    await evaluate('window.remoteXApp.client.refreshDiagnostics()');
    const framebuffer = await evaluate('window.remoteXApp.client.getDiagnostics().framebuffer');
    if (framebuffer?.width === target.width && framebuffer?.height === target.height) break;
    if (Date.now() >= deadline) throw new Error(`remote framebuffer did not resize to ${target.width}x${target.height}`);
    await sleep(50);
  }
} else {
  await sleep(2000);
  await evaluate('window.remoteXApp.client.refreshDiagnostics()');
}
const after = await evaluate('window.remoteXApp.client.getDiagnostics().framebuffer');
if (!expectResize && (after.width !== before.width || after.height !== before.height)) {
  throw new Error(`fixed framebuffer changed from ${before.width}x${before.height} to ${after.width}x${after.height}`);
}

const reconnectStarted = performance.now();
await evaluate('window.remoteXApp.client.disconnect()');
await waitFor("window.remoteXApp.client.state === 'disconnected'", 'client did not disconnect');
await evaluate('void window.remoteXApp.client.connect()');
await waitFor("window.remoteXApp.client.state === 'connected'", 'client did not reconnect');
const reconnectMS = performance.now() - reconnectStarted;
const diagnostics = await evaluate('window.remoteXApp.client.getDiagnostics()');

process.stdout.write(`${JSON.stringify({
  connected:true,
  pageURL:await evaluate('location.href'),
  managerBaseURL:await evaluate('window.remoteXApp.manager.baseURL'),
  resourceURLs:await evaluate("performance.getEntriesByType('resource').map(entry => entry.name).filter(name => /\\/(api|sdk|assets|remotexapps)\\//.test(name))"),
  sdkVersion:await evaluate("document.querySelector('meta[name=remotexapp-sdk-version]')?.content || 'unknown'"),
  expectResize,
  target,
  framebufferBefore:before,
  framebufferAfter:after,
  reconnectMS,
  finalState:diagnostics.state,
  rfbState:diagnostics.rfbState,
  inputState:diagnostics.inputState,
})}\n`);
socket.close();
