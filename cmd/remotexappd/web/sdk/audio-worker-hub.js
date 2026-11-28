// One native SharedWorker client per document and Manager/worker generation.
// Logical audio owners use disposable MessageChannels. Closing a SharedWorker
// port alone can retain its browser-native client for the worker's lifetime.
const registry = Symbol.for('remotexapp.audio-worker-hubs.v8');
const clientHubs = new WeakMap();
const failure = code => Object.assign(Error(code),{code});

// Keep the native error callback in its own scope: sharing its lexical context
// with a disposable client can itself retain the first logical MessagePort.
function createHub(env, url, name, hubs, key, lineage = {workerId:null,probes:0}) {
  const worker = new env.SharedWorker(url, {type:'module', name});
  const hub = {worker,url,clients:new Set(),lineage,failed:false};
  hubs.set(key, hub);
  worker.port.start();
  worker.onerror = () => {
    hub.failed = true;
    worker.onerror = null;
    worker.port.close();
    // Snapshot first: each callback can synchronously release or rebind.
    const clients = [...hub.clients];
    hub.clients.clear();
    for (const client of clients) client.onerror?.();
  };
  return hub;
}

export function connectAudioWorker(env, url, name, {probeOf} = {}) {
  const hubs = env[registry] ||= new Map();
  const key = url + '\n' + name;
  // A fresh native bootstrap is needed after a silent Worker exit. Bound probes
  // within a still-live/unknown incarnation; only a different confirmed ID can
  // reset that budget. A logical rebind normally reuses the current bootstrap.
  let hub = hubs.get(key);
  const expected = probeOf && clientHubs.get(probeOf);
  if (probeOf && !expected) throw TypeError('Invalid audio bootstrap probe');
  if (hub && (hub.failed || (probeOf && expected===hub))) {
    if (hub.lineage.probes>=1) throw failure('audio-worker-probe-exhausted');
    hub.lineage.probes++;
    const old=hub;
    hub=createHub(env,url,name,hubs,key,old.lineage);
    old.worker.port.close();
    if(!old.clients.size)old.worker.onerror=null;
  }
  if (!hub) {
    if ([...hubs.values()].filter(h=>h.url===url).length>=2) throw failure('audio-worker-capacity');
    hub=createHub(env,url,name,hubs,key);
  }
  const channel = new env.MessageChannel();
  const client = {port:channel.port1, onerror:null, confirm(workerId) {
    if(typeof workerId!=='string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(workerId)) throw failure('audio-worker-contract');
    if(hubs.get(key)!==hub)throw failure('audio-worker-superseded');
    if(hub.workerId && hub.workerId!==workerId)throw failure('audio-worker-contract');
    const previous=hub.lineage.workerId;
    if(previous && previous!==workerId)hub.lineage.probes=0;
    hub.lineage.workerId=workerId;
    hub.workerId=workerId;
  }, release() {
    hub.clients.delete(client);
    client.onerror = null;
    if(!hub.clients.size && hubs.get(key)!==hub)hub.worker.onerror=null;
  }};
  clientHubs.set(client,hub);
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
