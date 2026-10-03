const cdpPort = Number(process.env.VALIDATION_CDP_PORT || 9239);
const instanceId = process.env.VALIDATION_INSTANCE_ID;
const action = process.env.VALIDATION_SDK_ACTION || 'inspect';
const textValue = process.env.VALIDATION_TEXT || '';
const managedId = process.env.VALIDATION_MANAGED_ID || '';
const timeoutMS = Number(process.env.VALIDATION_TIMEOUT_MS || 30000);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

if (!instanceId) throw new Error('VALIDATION_INSTANCE_ID is required');

let page;
for (let attempt = 0; attempt < 200; attempt++) {
  const pages = await fetch(`http://127.0.0.1:${cdpPort}/json`).then(response => response.json()).catch(() => []);
  page = pages.find(target => target.type === 'page' && target.url.includes(instanceId));
  if (page) break;
  await sleep(50);
}
if (!page) throw new Error(`viewer target for ${instanceId} was not found`);

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
  const { resolve, reject, timer } = pending.get(message.id);
  pending.delete(message.id);
  clearTimeout(timer);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});
function command(method, params = {}) {
  const id = ++nextID;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP ${method} timed out`));
    }, timeoutMS);
    pending.set(id, { resolve, reject, timer });
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'browser evaluation failed');
  return result.result.value;
}
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

await waitFor("window.remoteXApp?.client?.state === 'connected'", 'SDK client did not connect');
await evaluate(`(() => {
  window.__sdkLifecycle = { events:[] };
  for (const name of ['connect', 'disconnect', 'sessionended', 'statechange', 'error', 'reconnecting', 'reconnectexhausted']) {
    window.remoteXApp.client.addEventListener(name, event => {
      window.__sdkLifecycle.events.push({ name, detail:event.detail || null, at:Date.now() });
    });
  }
  return true;
})()`);

const result = {
  action,
  instanceId,
  initialState:await evaluate('window.remoteXApp.client.state'),
  initialDiagnostics:await evaluate('window.remoteXApp.client.getDiagnostics()'),
};

if (textValue) {
  result.textAck = await evaluate(`window.remoteXApp.client.sendText(${JSON.stringify(textValue)})`);
}

if (action === 'inspect') {
  await evaluate('window.remoteXApp.client.disconnect()');
  await waitFor("window.remoteXApp.client.state === 'disconnected'", 'SDK client did not disconnect');
  await evaluate('void window.remoteXApp.client.connect()');
  await waitFor("window.remoteXApp.client.state === 'connected'", 'SDK client did not reconnect');
} else if (action === 'upgrade') {
  result.upgrade = await evaluate(`(async () => {
    const client = window.remoteXApp.client;
    const current = await client.manager.getInstance(client.instanceId);
    if (!current.versions?.eligible) throw new Error(current.versions?.reason || 'upgrade unavailable');
    client.clipboard.configure({toRemote:'prompt',toLocal:'prompt'});
    const applied = await client.upgradeAndRestart({sessionGeneration:current.sessionGeneration,targetRevision:current.versions.targetRevision,force:true});
    if (applied.id !== current.id || applied.sessionGeneration <= current.sessionGeneration || applied.upgrade.phase !== 'completed') throw new Error('upgrade identity or generation mismatch');
    if (client.clipboard.config.toRemote !== 'prompt' || client.clipboard.config.toLocal !== 'prompt') throw new Error('clipboard policy lost');
    return {phase:applied.upgrade.phase,generation:applied.sessionGeneration,oldGeneration:current.sessionGeneration};
  })()`);
  await waitFor("window.remoteXApp.client.state === 'connected'", 'SDK did not reconnect after upgrade');
} else if (action === 'observe-reconnect') {
  await waitFor("window.__sdkLifecycle.events.some(event => event.name === 'statechange' && event.detail?.state === 'disconnected')", 'SDK did not observe a connection interruption');
  await waitFor("window.remoteXApp.client.state === 'connected'", 'SDK did not automatically reconnect');
  result.automaticReconnect = true;
} else if (action === 'user-close') {
  await evaluate(`(() => {
    const client = window.remoteXApp.client;
    client.sendKey(0xffe9, 'AltLeft', true);
    client.sendKey(0xffc1, 'F4', true);
    client.sendKey(0xffc1, 'F4', false);
    client.sendKey(0xffe9, 'AltLeft', false);
  })()`);
  await waitFor("window.__sdkLifecycle.events.some(event => event.name === 'sessionended')", 'SDK did not emit sessionended');
  await waitFor("window.remoteXApp.client.state === 'disconnected'", 'SDK did not disconnect after terminal exit');
  await sleep(1000);
  result.noAutomaticReconnect = await evaluate("window.remoteXApp.client.state === 'disconnected'");
} else if (action === 'observe-session-exit') {
  await waitFor("window.__sdkLifecycle.events.some(event => event.name === 'sessionended')", 'SDK did not emit sessionended');
  await waitFor("window.remoteXApp.client.state === 'disconnected'", 'SDK did not disconnect after the observed session exit');
  await sleep(1000);
  result.noAutomaticReconnect = await evaluate("window.remoteXApp.client.state === 'disconnected'");
} else if (['manager-stop', 'blocked-stop', 'force-stop'].includes(action)) {
  result.managerResult = await evaluate(`(async () => {
    const { RemoteXAppManager } = await import('/sdk/index.js');
    const manager = new RemoteXAppManager();
    try {
      const value = await manager.stopInstance(${JSON.stringify(instanceId)}, { force:${action === 'force-stop'} });
      return { ok:true, value };
    } catch (error) {
      return { ok:false, name:error.name, message:error.message, status:error.status, body:error.body };
    }
  })()`);
  if (action === 'blocked-stop') {
    if (result.managerResult.ok || result.managerResult.status !== 409) throw new Error('blocked stop did not surface SDK HTTP 409');
    result.sessionPreserved = await evaluate("window.remoteXApp.client.state === 'connected'");
  }
} else if (action === 'managed-stop') {
  if (!managedId) throw new Error('VALIDATION_MANAGED_ID is required for managed-stop');
  result.managerResult = await evaluate(`(async () => {
    const { RemoteXAppManager } = await import('/sdk/index.js');
    const manager = new RemoteXAppManager();
    const started = performance.now();
    try {
      const value = await manager.setManagedInstanceState(${JSON.stringify(managedId)}, 'stopped');
      return { ok:true, elapsedMs:performance.now() - started, value };
    } catch (error) {
      return { ok:false, elapsedMs:performance.now() - started, name:error.name, message:error.message, status:error.status, body:error.body };
    }
  })()`);
} else if (action === 'finite-reconnect-policy') {
  result.policy = await evaluate(`(async () => {
    const client = window.remoteXApp.client;
    const originalGetInstance = client.manager.getInstance.bind(client.manager);
    client.maxReconnectAttempts = 2;
    client.diagnostics.maxReconnectAttempts = 2;
    client.reconnectDelays = [0];
    let exhaustedEvents = 0;
    client.addEventListener('reconnectexhausted', () => exhaustedEvents++);
    client.manager.getInstance = async () => { throw new Error('injected live reconnect failure'); };
    client.input.close();
    const deadline = Date.now() + 5000;
    while (!client.reconnectExhausted && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    const exhausted = {
      state:client.state,
      attempts:client.reconnectAttempt,
      exhaustedEvents,
      reconnectExhausted:client.reconnectExhausted,
      reconnectTimerCleared:client.reconnectTimer === null,
      channelsCleared:client.input === null && client.rfb === null,
    };
    client.manager.getInstance = originalGetInstance;
    await client.reconnect();
    return {
      exhausted,
      afterManualReconnect:{
        state:client.state,
        attempts:client.reconnectAttempt,
        reconnectExhausted:client.reconnectExhausted,
      },
    };
  })()`);
} else if (action === 'unlimited-reconnect-policy') {
  result.policy = await evaluate(`(async () => {
    const client = window.remoteXApp.client;
    const originalGetInstance = client.manager.getInstance.bind(client.manager);
    client.maxReconnectAttempts = Infinity;
    client.diagnostics.maxReconnectAttempts = Infinity;
    client.reconnectDelays = [0];
    let reconnectingEvents = 0;
    let exhaustedEvents = 0;
    client.addEventListener('reconnecting', () => {
      reconnectingEvents++;
      if (reconnectingEvents === 5) client.disconnect();
    });
    client.addEventListener('reconnectexhausted', () => exhaustedEvents++);
    client.manager.getInstance = async () => { throw new Error('injected live reconnect failure'); };
    client.input.close();
    const deadline = Date.now() + 5000;
    while (reconnectingEvents < 5 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    const interrupted = {
      state:client.state,
      reconnectingEvents,
      exhaustedEvents,
      reconnectExhausted:client.reconnectExhausted,
      reconnectTimerCleared:client.reconnectTimer === null,
    };
    client.manager.getInstance = originalGetInstance;
    await client.reconnect();
    return {
      interrupted,
      afterManualReconnect:{
        state:client.state,
        attempts:client.reconnectAttempt,
        reconnectExhausted:client.reconnectExhausted,
      },
    };
  })()`);
}

result.finalState = await evaluate('window.remoteXApp.client.state');
result.finalDiagnostics = await evaluate('window.remoteXApp.client.getDiagnostics()');
result.events = await evaluate('window.__sdkLifecycle.events');
process.stdout.write(`${JSON.stringify(result)}\n`);
socket.close();
