const cdpPort = Number(process.env.P06_CDP_PORT || 9223);
const sampleMillis = Number(process.env.P06_SAMPLE_MS || 5200);

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function findPage() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
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
  const result = await command('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'browser evaluation failed');
  return result.result.value;
}

for (let attempt = 0; attempt < 200; attempt += 1) {
  if (await evaluate("window.remoteXApp?.client?.state === 'connected'")) break;
  if (attempt === 199) throw new Error('RemoteXAppClient did not connect');
  await sleep(100);
}

await evaluate(`(() => {
  window.__p06 = { events:0, mutations:0 };
  window.remoteXApp.client.addEventListener('diagnostics', () => { window.__p06.events += 1; });
  const node = document.querySelector('#diagnostics');
  new MutationObserver(records => { window.__p06.mutations += records.length; })
    .observe(node, { childList:true, characterData:true, subtree:true });
  return true;
})()`);

async function sample(label) {
  await evaluate(`(() => {
    performance.clearResourceTimings();
    window.__p06.events = 0;
    window.__p06.mutations = 0;
    return true;
  })()`);
  await sleep(sampleMillis);
  return evaluate(`(() => {
    const paths = performance.getEntriesByType('resource').map(item => new URL(item.name).pathname);
    const id = window.remoteXApp.instance.id;
    return {
      label:${JSON.stringify(label)},
      sampleMillis:${sampleMillis},
      healthRequests:paths.filter(path => path.endsWith('/healthz')).length,
      instanceRequests:paths.filter(path => path === '/api/instances/' + id).length,
      diagnosticEvents:window.__p06.events,
      diagnosticDOMMutations:window.__p06.mutations,
      diagnosticsEnabled:window.remoteXApp.client.diagnosticsEnabled,
      diagnosticsTimerActive:Boolean(window.remoteXApp.client.diagnosticsTimer),
      panelHidden:document.querySelector('#diagnostics').hidden,
    };
  })()`);
}

const hidden = await sample('hidden-demand-off');
await evaluate("document.querySelector('#toggleDiagnostics').click(); true");
for (let attempt = 0; attempt < 100; attempt += 1) {
  if (await evaluate("window.remoteXApp.client.diagnosticsEnabled && !document.querySelector('#diagnostics').hidden")) break;
  await sleep(20);
}
const visible = await sample('visible-demand-on');
await evaluate("document.querySelector('#toggleDiagnostics').click(); true");
for (let attempt = 0; attempt < 100; attempt += 1) {
  if (await evaluate("!window.remoteXApp.client.diagnosticsEnabled && document.querySelector('#diagnostics').hidden")) break;
  await sleep(20);
}
const hiddenAgain = await sample('hidden-again');

socket.close();
console.log(JSON.stringify({ hidden, visible, hiddenAgain }, null, 2));
