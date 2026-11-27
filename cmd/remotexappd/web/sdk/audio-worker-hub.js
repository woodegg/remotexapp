// One native SharedWorker client per document and Manager/worker generation.
// Logical audio owners use disposable MessageChannels. Closing a SharedWorker
// port alone can retain its browser-native client for the worker's lifetime.
const registry = Symbol.for('remotexapp.audio-worker-hubs.v6');

// Keep the native error callback in its own scope: sharing its lexical context
// with a disposable client can itself retain the first logical MessagePort.
function createHub(env, url, name, hubs, key) {
  const worker = new env.SharedWorker(url, {type:'module', name});
  const hub = {worker, url, clients:new Set()};
  hubs.set(key, hub);
  worker.port.start();
  worker.onerror = () => {
    if (hubs.get(key) === hub) hubs.delete(key);
    worker.onerror = null;
    worker.port.close();
    // Snapshot first: each callback can synchronously release or rebind.
    const clients = [...hub.clients];
    hub.clients.clear();
    for (const client of clients) client.onerror?.();
  };
  return hub;
}

export function connectAudioWorker(env, url, name) {
  const hubs = env[registry] ||= new Map();
  const key = url + '\n' + name;
  // Recovery generations must not become an ever-growing JS cache. Existing
  // logical owners keep their hub; only unused superseded handles are dropped.
  for (const [oldKey, old] of hubs) {
    if (oldKey !== key && old.url === url && old.clients.size === 0) {
      hubs.delete(oldKey);
      old.worker.onerror = null;
      old.worker.port.close();
    }
  }
  const hub = hubs.get(key) || createHub(env, url, name, hubs, key);
  const channel = new env.MessageChannel();
  const client = {port:channel.port1, onerror:null, release() {
    hub.clients.delete(client);
    client.onerror = null;
  }};
  hub.clients.add(client);
  try {
    hub.worker.port.postMessage({op:'attach', port:channel.port2}, [channel.port2]);
  } catch (error) {
    client.release();
    channel.port1.close(); channel.port2.close();
    throw error;
  }
  return client;
}
