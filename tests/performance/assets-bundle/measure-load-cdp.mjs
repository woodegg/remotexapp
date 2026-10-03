const cdpPort = Number(process.env.P07_CDP_PORT || 9225);
const includePaths = process.env.P07_INCLUDE_PATHS === '1';
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
  const result = await command('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'browser evaluation failed');
  return result.result.value;
}

async function waitUntilConnected() {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    try {
      if (await evaluate("window.remoteXApp?.client?.state === 'connected'")) return;
    } catch (_) {}
    await sleep(20);
  }
  throw new Error('RemoteXAppClient did not connect');
}

async function snapshot(label) {
  return evaluate(`(() => {
    const navigation = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource').map(item => {
      const url = new URL(item.name);
      return {
        path:url.pathname,
        transferBytes:item.transferSize,
        encodedBytes:item.encodedBodySize,
        decodedBytes:item.decodedBodySize,
        durationMs:item.duration,
      };
    });
    const staticResources = resources.filter(item => /^\\/(sdk|core|vendor|assets)\\//.test(item.path));
    const sum = (items, field) => items.reduce((total, item) => total + item[field], 0);
    const countPrefix = prefix => staticResources.filter(item => item.path.startsWith(prefix)).length;
    return {
      label:${JSON.stringify(label)},
      connectedAtMs:performance.now(),
      navigation:{
        transferBytes:navigation.transferSize,
        encodedBytes:navigation.encodedBodySize,
        decodedBytes:navigation.decodedBodySize,
        responseEndMs:navigation.responseEnd,
        domContentLoadedMs:navigation.domContentLoadedEventEnd,
      },
      totalResourceRequests:resources.length,
      staticRequests:staticResources.length,
      staticTransferBytes:sum(staticResources, 'transferBytes'),
      staticEncodedBytes:sum(staticResources, 'encodedBytes'),
      staticDecodedBytes:sum(staticResources, 'decodedBytes'),
      staticDurationSumMs:sum(staticResources, 'durationMs'),
      cachedStaticRequests:staticResources.filter(item => item.transferBytes === 0).length,
      staticRequestGroups:{
        sdk:countPrefix('/sdk/'), core:countPrefix('/core/'),
        vendor:countPrefix('/vendor/'), assets:countPrefix('/assets/'),
      },
      staticPaths:${includePaths ? "staticResources.map(item => item.path).sort()" : "undefined"},
    };
  })()`);
}

await command('Page.enable');
await waitUntilConnected();
const cold = await snapshot('cold-profile');
await evaluate("window.__p07BeforeReload = true");
await command('Page.reload', { ignoreCache:false });
for (let attempt = 0; attempt < 500; attempt += 1) {
  try {
    const ready = await evaluate("window.__p07BeforeReload !== true && window.remoteXApp?.client?.state === 'connected'");
    if (ready) break;
  } catch (_) {}
  if (attempt === 499) throw new Error('RemoteXAppClient did not reconnect after reload');
  await sleep(20);
}
const warm = await snapshot('warm-reload');

socket.close();
console.log(JSON.stringify({ cold, warm }, null, 2));
