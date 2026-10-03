import { performance } from 'node:perf_hooks';

globalThis.Element = class Element {};
globalThis.CustomEvent = class CustomEvent extends Event {
  constructor(type, options = {}) {
    super(type);
    this.detail = options.detail;
  }
};
globalThis.WebSocket = { OPEN: 1 };
globalThis.document = { activeElement: null };

const { RemoteXAppClient } = await import('../../../cmd/remotexappd/web/sdk/remotexapp-client.js');

const iterations = Number(process.argv[2] || 50000);
const runs = Number(process.argv[3] || 7);

function makeClient(inputEventTracing) {
  const client = new RemoteXAppClient({
    container: new Element(),
    manager: {},
    inputEventTracing,
  });
  client.ime = {};
  document.activeElement = client.ime;
  const counters = { messages: 0, bytes: 0, diagnostics: 0 };
  client.input = {
    readyState: WebSocket.OPEN,
    send(payload) {
      counters.messages += 1;
      counters.bytes += Buffer.byteLength(payload);
    },
  };
  client.addEventListener('diagnostics', event => {
    JSON.stringify(event.detail.diagnostics);
    counters.diagnostics += 1;
  });
  return { client, counters };
}

function sample(inputEventTracing, count) {
  const { client, counters } = makeClient(inputEventTracing);
  const event = {
    type: 'keydown', key: 'a', code: 'KeyA', keyCode: 65,
    isComposing: false, ctrlKey: false, altKey: false, metaKey: false,
  };
  const started = performance.now();
  for (let index = 0; index < count; index += 1) client._trace('keydown', event);
  return { elapsedMs: performance.now() - started, ...counters };
}

sample(true, 1000);
sample(false, 1000);

function collect(enabled) {
  const samples = Array.from({ length: runs }, () => sample(enabled, iterations));
  const elapsed = samples.map(item => item.elapsedMs).sort((a, b) => a - b);
  return { mode: enabled ? 'trace-on' : 'trace-off', iterations, runs, medianMs: elapsed[Math.floor(elapsed.length / 2)], sample: samples.at(-1) };
}

const on = collect(true);
const off = collect(false);
if (on.sample.messages !== iterations || on.sample.diagnostics !== iterations) throw new Error('trace-on did not emit one message and diagnostic event per input event');
if (off.sample.messages !== 0 || off.sample.diagnostics !== 0 || off.sample.bytes !== 0) throw new Error('trace-off emitted tracing work');

console.log(JSON.stringify({ on, off, speedup: on.medianMs / Math.max(off.medianMs, 0.000001) }, null, 2));
