import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const managerURL = process.env.BENCH_MANAGER_URL || 'http://127.0.0.1:1991';
const instanceID = process.env.BENCH_INSTANCE_ID;
const cdpPort = Number(process.env.BENCH_CDP_PORT || 9235);
const managerPID = Number(process.env.BENCH_MANAGER_PID || 0);
const appPID = Number(process.env.BENCH_APP_PID || 0);
const cgroups = {
  vnc: process.env.BENCH_VNC_CGROUP || '',
  server: process.env.BENCH_SERVER_CGROUP || '',
  gateway: process.env.BENCH_GATEWAY_CGROUP || '',
  session: process.env.BENCH_SESSION_CGROUP || '',
};
const staticSeconds = Number(process.env.BENCH_STATIC_SECONDS || 30);
const inputRequests = Number(process.env.BENCH_INPUT_REQUESTS || 600);
const inputIntervalMS = Number(process.env.BENCH_INPUT_INTERVAL_MS || 50);
const scrollSeconds = Number(process.env.BENCH_SCROLL_SECONDS || 30);
const expectResize = process.env.BENCH_EXPECT_RESIZE === '1';
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

if (!instanceID) throw new Error('BENCH_INSTANCE_ID is required');
if (!Number.isInteger(cdpPort) || cdpPort < 1) throw new Error('invalid BENCH_CDP_PORT');

async function readText(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (_) {
    return '';
  }
}

function parseKV(value) {
  const result = {};
  for (const line of value.trim().split('\n')) {
    const [key, raw] = line.trim().split(/\s+/, 2);
    if (key && raw !== undefined && /^-?\d+$/.test(raw)) result[key] = Number(raw);
  }
  return result;
}

async function processMetrics(pid) {
  if (!pid) return null;
  const [stat, status, io, smaps] = await Promise.all([
    readText(`/proc/${pid}/stat`),
    readText(`/proc/${pid}/status`),
    readText(`/proc/${pid}/io`),
    readText(`/proc/${pid}/smaps_rollup`),
  ]);
  if (!stat) return null;
  const close = stat.lastIndexOf(')');
  const fields = stat.slice(close + 2).trim().split(/\s+/);
  const statusKV = parseKV(status.replace(/:\s*/g, ' '));
  const ioKV = parseKV(io.replace(/:\s*/g, ' '));
  const smapsKV = parseKV(smaps.replace(/:\s*/g, ' '));
  return {
    pid,
    cpuTicks: Number(fields[11]) + Number(fields[12]),
    rssKiB: statusKV.VmRSS || 0,
    pssKiB: smapsKV.Pss || 0,
    privateKiB: (smapsKV.Private_Clean || 0) + (smapsKV.Private_Dirty || 0),
    readSyscalls: ioKV.syscr || 0,
    writeSyscalls: ioKV.syscw || 0,
    readBytes: ioKV.rchar || 0,
    writeBytes: ioKV.wchar || 0,
  };
}

async function cgroupMetrics(path) {
  if (!path) return null;
  const [cpu, memory, peak, tasks, procs] = await Promise.all([
    readText(`${path}/cpu.stat`),
    readText(`${path}/memory.current`),
    readText(`${path}/memory.peak`),
    readText(`${path}/pids.current`),
    readText(`${path}/cgroup.procs`),
  ]);
  if (!cpu && !memory) return null;
  const pids = procs.trim().split(/\s+/).filter(Boolean).map(Number);
  const members = (await Promise.all(pids.map(processMetrics))).filter(Boolean);
  const sum = key => members.reduce((total, item) => total + item[key], 0);
  return {
    path,
    cpuUsec: parseKV(cpu).usage_usec || 0,
    memoryCurrentBytes: Number(memory.trim()) || 0,
    memoryPeakBytes: Number(peak.trim()) || 0,
    tasks: Number(tasks.trim()) || 0,
    processCount: members.length,
    pssKiB: sum('pssKiB'),
    privateKiB: sum('privateKiB'),
    cpuTicks: sum('cpuTicks'),
    readSyscalls: sum('readSyscalls'),
    writeSyscalls: sum('writeSyscalls'),
    readBytes: sum('readBytes'),
    writeBytes: sum('writeBytes'),
    pids,
  };
}

async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

async function snapshot(label) {
  const [health, instance, manager, app, vnc, server, gateway, session, loadavg, meminfo] = await Promise.all([
    fetchJSON(`${managerURL}/remotexapps/${instanceID}/healthz`),
    fetchJSON(`${managerURL}/api/instances/${instanceID}`),
    processMetrics(managerPID),
    processMetrics(appPID),
    cgroupMetrics(cgroups.vnc),
    cgroupMetrics(cgroups.server),
    cgroupMetrics(cgroups.gateway),
    cgroupMetrics(cgroups.session),
    readText('/proc/loadavg'),
    readText('/proc/meminfo'),
  ]);
  const memory = parseKV(meminfo.replace(/:\s*/g, ' '));
  return {
    label,
    epochMs: Date.now(),
    health,
    instance: {
      state: instance.state,
      sessionState: instance.sessionState,
      sessionGeneration: instance.sessionGeneration,
      attachedClients: instance.attachedClients,
      display: instance.display,
    },
    manager,
    app,
    cgroups: { vnc, server, gateway, session },
    host: {
      loadavg: loadavg.trim(),
      memAvailableKiB: memory.MemAvailable || 0,
    },
  };
}

function numericDelta(before, after, key) {
  return Number(after?.[key] || 0) - Number(before?.[key] || 0);
}

function phaseDelta(before, after) {
  const cgroupDelta = name => ({
    cpuUsec: numericDelta(before.cgroups[name], after.cgroups[name], 'cpuUsec'),
    cpuTicks: numericDelta(before.cgroups[name], after.cgroups[name], 'cpuTicks'),
    readSyscalls: numericDelta(before.cgroups[name], after.cgroups[name], 'readSyscalls'),
    writeSyscalls: numericDelta(before.cgroups[name], after.cgroups[name], 'writeSyscalls'),
    readBytes: numericDelta(before.cgroups[name], after.cgroups[name], 'readBytes'),
    writeBytes: numericDelta(before.cgroups[name], after.cgroups[name], 'writeBytes'),
  });
  return {
    durationMs: after.epochMs - before.epochMs,
    rfbToBrowserBytes: numericDelta(before.health, after.health, 'rfbToBrowserBytes'),
    browserToRfbBytes: numericDelta(before.health, after.health, 'browserToRfbBytes'),
    textRequests: numericDelta(before.health, after.health, 'textRequests'),
    textErrors: numericDelta(before.health, after.health, 'textErrors'),
    textInputBytes: numericDelta(before.health, after.health, 'textInputBytes'),
    textServerMicroseconds: numericDelta(before.health, after.health, 'textServerMicroseconds'),
    manager: {
      cpuTicks: numericDelta(before.manager, after.manager, 'cpuTicks'),
      readSyscalls: numericDelta(before.manager, after.manager, 'readSyscalls'),
      writeSyscalls: numericDelta(before.manager, after.manager, 'writeSyscalls'),
    },
    app: {
      cpuTicks: numericDelta(before.app, after.app, 'cpuTicks'),
      readSyscalls: numericDelta(before.app, after.app, 'readSyscalls'),
      writeSyscalls: numericDelta(before.app, after.app, 'writeSyscalls'),
      readBytes: numericDelta(before.app, after.app, 'readBytes'),
      writeBytes: numericDelta(before.app, after.app, 'writeBytes'),
    },
    cgroups: {
      vnc: cgroupDelta('vnc'),
      server: cgroupDelta('server'),
      gateway: cgroupDelta('gateway'),
      session: cgroupDelta('session'),
    },
  };
}

async function findPage() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const pages = await fetchJSON(`http://127.0.0.1:${cdpPort}/json/list`);
      const page = pages.find(item => item.type === 'page' && item.url.includes(`/remotexapps/${instanceID}/`));
      if (page) return page;
    } catch (_) {}
    await sleep(100);
  }
  throw new Error('remotexapp benchmark page not found');
}

const page = await findPage();
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', () => reject(new Error('CDP WebSocket failed')), { once: true });
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
  const response = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  }
  return response.result.value;
}

async function waitFor(expression, message, timeoutMS = 20000) {
  const deadline = Date.now() + timeoutMS;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(expression)) return;
    } catch (_) {}
    await sleep(20);
  }
  throw new Error(message);
}

async function clickCanvas() {
  const point = await evaluate(`(() => {
    const bounds = document.querySelector('canvas').getBoundingClientRect();
    return { x:bounds.left + bounds.width * .5, y:bounds.top + bounds.height * .5 };
  })()`);
  await command('Input.dispatchMouseEvent', { type:'mouseMoved', x:point.x, y:point.y, button:'none' });
  await command('Input.dispatchMouseEvent', { type:'mousePressed', x:point.x, y:point.y, button:'left', clickCount:1 });
  await command('Input.dispatchMouseEvent', { type:'mouseReleased', x:point.x, y:point.y, button:'left', clickCount:1 });
  await sleep(200);
  return point;
}

await command('Page.enable');
await waitFor("window.remoteXApp?.client?.state === 'connected'", 'client did not connect');
await waitFor("window.remoteXApp?.client?.getDiagnostics().cursor?.focused === true", 'application did not obtain IBus focus');

const browserLoad = await evaluate(`(() => {
  const navigation = performance.getEntriesByType('navigation')[0];
  const resources = performance.getEntriesByType('resource').map(item => ({
    path:new URL(item.name).pathname,
    transferBytes:item.transferSize,
    encodedBytes:item.encodedBodySize,
    decodedBytes:item.decodedBodySize,
    durationMs:item.duration,
  }));
  const staticResources = resources.filter(item => /^\\/(sdk|core|vendor|assets)\\//.test(item.path));
  const sum = (items, field) => items.reduce((total, item) => total + item[field], 0);
  return {
    observedConnectedMs:performance.now(),
    navigationResponseEndMs:navigation?.responseEnd || 0,
    domContentLoadedMs:navigation?.domContentLoadedEventEnd || 0,
    totalResourceRequests:resources.length,
    staticRequests:staticResources.length,
    staticTransferBytes:sum(staticResources, 'transferBytes'),
    staticEncodedBytes:sum(staticResources, 'encodedBytes'),
    staticDecodedBytes:sum(staticResources, 'decodedBytes'),
    staticDurationSumMs:sum(staticResources, 'durationMs'),
    cachedStaticRequests:staticResources.filter(item => item.transferBytes === 0).length,
    staticPaths:staticResources.map(item => item.path).sort(),
  };
})()`);
const sdkVersion = await evaluate("import('/sdk/index.js').then(module => module.SDK_VERSION)");

await sleep(2000);
const attached = await snapshot('attached');
const staticStart = await snapshot('static-start');
await sleep(staticSeconds * 1000);
const staticEnd = await snapshot('static-end');

await clickCanvas();
await evaluate(`(() => {
  const client = window.remoteXApp.client;
  client.sendKey(0xffe3, 'ControlLeft', true);
  client.sendKey(0x61, 'KeyA', true);
  client.sendKey(0x61, 'KeyA', false);
  client.sendKey(0xffe3, 'ControlLeft', false);
  client.sendKey(0xff08, 'Backspace', true);
  client.sendKey(0xff08, 'Backspace', false);
})()`);
await sleep(100);

const expectedValues = Array.from({ length: inputRequests }, (_, index) => index % 10 === 9 ? '你\n' : 'a');
const expectedText = expectedValues.join('');
const inputStart = await snapshot('input-start');
const inputResult = await evaluate(`(async () => {
  const values = ${JSON.stringify(expectedValues)};
  const interval = ${inputIntervalMS};
  const samples = [];
  const started = performance.now();
  for (let index = 0; index < values.length; index += 1) {
    const target = started + index * interval;
    const remaining = target - performance.now();
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
    const requestStarted = performance.now();
    const ack = await window.remoteXApp.client.sendText(values[index]);
    samples.push({ roundTripMs:performance.now() - requestStarted, serverMs:Number(ack.serverMs || 0) });
  }
  const sorted = (key) => samples.map(item => item[key]).sort((a, b) => a - b);
  const summarize = key => {
    const values = sorted(key);
    const percentile = value => values[Math.min(values.length - 1, Math.floor(values.length * value))];
    return {
      min:values[0], p50:percentile(.5), p95:percentile(.95), max:values.at(-1),
      mean:values.reduce((sum, value) => sum + value, 0) / values.length,
    };
  };
  return { requests:samples.length, durationMs:performance.now() - started,
    roundTripMs:summarize('roundTripMs'), serverMs:summarize('serverMs') };
})()`);
const inputEnd = await snapshot('input-end');

// Capture application readback while the same focused editor that accepted
// the commits is still active. Reconnect is tested later as a channel/lifecycle
// operation and must not become an accidental prerequisite for clipboard
// correctness on a full desktop with several focusable windows.
await clickCanvas();
await evaluate(`(() => {
  const client = window.remoteXApp.client;
  client.sendKey(0xffe3, 'ControlLeft', true);
  client.sendKey(0x61, 'KeyA', true);
  client.sendKey(0x61, 'KeyA', false);
  client.sendKey(0xffe3, 'ControlLeft', false);
  client.sendKey(0xffe3, 'ControlLeft', true);
  client.sendKey(0x63, 'KeyC', true);
  client.sendKey(0x63, 'KeyC', false);
  client.sendKey(0xffe3, 'ControlLeft', false);
})()`);
await sleep(250);

const canvasPoint = await evaluate(`(() => {
  const bounds = document.querySelector('canvas').getBoundingClientRect();
  return { x:bounds.left + bounds.width * .5, y:bounds.top + bounds.height * .5 };
})()`);
const scrollStart = await snapshot('scroll-start');
const scrollDeadline = Date.now() + scrollSeconds * 1000;
let scrollEvents = 0;
while (Date.now() < scrollDeadline) {
  const direction = scrollEvents % 100 < 50 ? 480 : -480;
  await command('Input.dispatchMouseEvent', {
    type: 'mouseWheel', x: canvasPoint.x, y: canvasPoint.y,
    deltaX: 0, deltaY: direction,
  });
  scrollEvents += 1;
  await sleep(100);
}
const scrollEnd = await snapshot('scroll-end');

const framebufferBefore = await evaluate('window.remoteXApp.client.getDiagnostics().framebuffer');
const targetViewport = framebufferBefore.width === 900 ? { width:1100, height:760 } : { width:900, height:640 };
await command('Emulation.setDeviceMetricsOverride', { ...targetViewport, deviceScaleFactor:1, mobile:false });
let resizeObserved = false;
let resizeCorrect = false;
let framebufferAfter = framebufferBefore;
const readFramebuffer = () => evaluate(`(() => {
    const client = window.remoteXApp.client;
    const refresh = typeof client.refreshDiagnostics === 'function'
      ? client.refreshDiagnostics()
      : Promise.resolve();
    return refresh.then(() => client.getDiagnostics().framebuffer);
  })()`);
if (expectResize) {
  const resizeDeadline = Date.now() + 5000;
  while (Date.now() < resizeDeadline) {
    framebufferAfter = await readFramebuffer();
    resizeObserved = framebufferAfter.width !== framebufferBefore.width || framebufferAfter.height !== framebufferBefore.height;
    resizeCorrect = framebufferAfter.width === targetViewport.width && framebufferAfter.height === targetViewport.height;
    if (resizeCorrect) break;
    await sleep(50);
  }
} else {
  await sleep(2000);
  framebufferAfter = await readFramebuffer();
  resizeObserved = framebufferAfter.width !== framebufferBefore.width || framebufferAfter.height !== framebufferBefore.height;
  resizeCorrect = !resizeObserved;
}

await evaluate('window.remoteXApp.client.disconnect()');
await waitFor("window.remoteXApp.client.state === 'disconnected'", 'client did not disconnect');
const reconnectStarted = Date.now();
await evaluate('void window.remoteXApp.client.connect()');
await waitFor("window.remoteXApp.client.state === 'connected'", 'client did not reconnect');
const reconnectMs = Date.now() - reconnectStarted;
await waitFor("window.remoteXApp.client.getDiagnostics().cursor?.focused === true", 'application did not refocus after reconnect');
await clickCanvas();

const final = await snapshot('final');
const finalClient = await evaluate(`({
  state:window.remoteXApp.client.state,
  rfbState:window.remoteXApp.client.getDiagnostics().rfbState,
  inputState:window.remoteXApp.client.getDiagnostics().inputState,
  framebuffer:window.remoteXApp.client.getDiagnostics().framebuffer,
})`);

socket.close();
console.log(JSON.stringify({
  schemaVersion: 1,
  managerURL,
  instanceID,
  sdkVersion,
  workload: { staticSeconds, inputRequests, inputIntervalMS, scrollSeconds, scrollEvents },
  expected: {
    characters: [...expectedText].length,
    utf8Bytes: Buffer.byteLength(expectedText),
    sha256: createHash('sha256').update(expectedText).digest('hex'),
  },
  browserLoad,
  memoryAtAttached: {
    managerPssKiB: attached.manager?.pssKiB || 0,
    vncPssKiB: attached.cgroups.vnc?.pssKiB || 0,
    serverPssKiB: attached.cgroups.server?.pssKiB || 0,
    gatewayPssKiB: attached.cgroups.gateway?.pssKiB || 0,
    sessionPssKiB: attached.cgroups.session?.pssKiB || 0,
    benchmarkAppPssKiB: attached.app?.pssKiB || 0,
    vncMemoryCurrentBytes: attached.cgroups.vnc?.memoryCurrentBytes || 0,
    serverMemoryCurrentBytes: attached.cgroups.server?.memoryCurrentBytes || 0,
    gatewayMemoryCurrentBytes: attached.cgroups.gateway?.memoryCurrentBytes || 0,
    sessionMemoryCurrentBytes: attached.cgroups.session?.memoryCurrentBytes || 0,
    vncTasks: attached.cgroups.vnc?.tasks || 0,
    serverTasks: attached.cgroups.server?.tasks || 0,
    gatewayTasks: attached.cgroups.gateway?.tasks || 0,
    sessionTasks: attached.cgroups.session?.tasks || 0,
    benchmarkAppPID: attached.app?.pid || 0,
  },
  phases: {
    static: phaseDelta(staticStart, staticEnd),
    input: phaseDelta(inputStart, inputEnd),
    scroll: phaseDelta(scrollStart, scrollEnd),
  },
  input: inputResult,
  resize: { expected:expectResize, observed:resizeObserved, correct:resizeCorrect, before:framebufferBefore, after:framebufferAfter, targetViewport },
  reconnectMs,
  finalClient,
  snapshots: { attached, staticStart, staticEnd, inputStart, inputEnd, scrollStart, scrollEnd, final },
}, null, 2));
