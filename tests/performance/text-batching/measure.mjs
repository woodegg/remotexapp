import { performance } from 'node:perf_hooks';

globalThis.Element = class Element {
  constructor() { this.clientWidth = 1280; this.clientHeight = 720; this.style = {}; }
  querySelector() { return null; }
};
globalThis.CustomEvent = class CustomEvent extends Event {
  constructor(type, options = {}) { super(type); this.detail = options.detail; }
};
globalThis.window = { devicePixelRatio:1 };
globalThis.document = { querySelector:() => null };

const { RemoteXAppClient } = await import('../../../cmd/remotexappd/web/sdk/remotexapp-client.js');
const requestedDelay = Number(process.env.P12_TEXT_BATCH_DELAY ?? 16);
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function clientWithRecorder() {
  const client = new RemoteXAppClient({
    container:new Element(), viewOnly:false, textBatchDelay:requestedDelay,
  });
  const sent = [];
  client.sendText = value => {
    sent.push({ value, at:performance.now() });
    return Promise.resolve({ value });
  };
  return { client, sent };
}

async function waitForSend(sent) {
  const deadline = performance.now() + 500;
  while (!sent.length && performance.now() < deadline) await sleep(0);
  if (!sent.length) throw new Error('text batch did not flush');
}

async function single() {
  const { client, sent } = clientWithRecorder();
  const started = performance.now();
  client._queueText('a');
  await waitForSend(sent);
  return { latencyMs:sent[0].at - started, sends:sent.length, value:sent[0].value };
}

async function burst() {
  const { client, sent } = clientWithRecorder();
  const started = performance.now();
  let lastQueuedAt = started;
  for (const value of ['a', 'b', 'c', 'd', 'e']) {
    lastQueuedAt = performance.now();
    client._queueText(value);
    await sleep(10);
  }
	await sleep(Math.max(requestedDelay + 20, 30));
	await waitForSend(sent);
	const last = sent[sent.length - 1];
  return {
    firstToSendMs:sent[0].at - started,
	lastToSendMs:last.at - lastQueuedAt,
    sends:sent.length,
    value:sent.map(item => item.value).join('|'),
  };
}

async function committedComposition() {
  const { client, sent } = clientWithRecorder();
  const started = performance.now();
  client._queueText('你好', { immediate:true });
  await waitForSend(sent);
  return { latencyMs:sent[0].at - started, sends:sent.length, value:sent[0].value };
}

console.log(JSON.stringify({
  requestedDelay,
  single:await single(),
  burst:await burst(),
  composition:await committedComposition(),
}));
