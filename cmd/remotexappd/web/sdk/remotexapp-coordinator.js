import { RemoteXAppManager } from './remotexapp-manager.js';

const HEARTBEAT = 2000, LEADER_TTL = 6000, INTEREST_TTL = 300000;
const MAX_HANDLES = 128, MAX_PEERS = 64;
const keyOf = (id, generation) => JSON.stringify([id, generation]);
const generationOK = value => Number.isSafeInteger(value) && value >= 0;
const idOK = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,127}$/.test(value);
const emit = (target, name, detail) => target.dispatchEvent(new CustomEvent(name, { detail:structuredClone(detail) }));

// Only lifecycle metadata crosses Tabs. In particular no parameters, host paths,
// application details, clipboard values, credentials or control descriptors.
function snapshot(value) {
  if (!value || !idOK(value.id) || !generationOK(value.sessionGeneration) ||
      !['starting','server-ready','ready','restarting','stopping','stopped','failed'].includes(value.state) ||
      !['starting','running','stopping','stopped','failed','shutdown-blocked'].includes(value.sessionState)) return null;
  const result = { id:value.id, sessionGeneration:value.sessionGeneration, state:value.state, sessionState:value.sessionState };
  if (Number.isSafeInteger(value.attachedClients) && value.attachedClients >= 0) result.attachedClients = value.attachedClients;
  if (value.applicationStatus && ['starting','loading','ready','exited','error','stopped'].includes(value.applicationStatus.state)) {
    result.applicationStatus = { state:value.applicationStatus.state, generation:value.sessionGeneration };
  }
  return result;
}

function terminal(value) {
  return ['stopped','failed','stopping','restarting'].includes(value.state) ||
    ['failed','shutdown-blocked','stopping'].includes(value.sessionState) ||
    (value.sessionState === 'stopped' && value.sessionGeneration > 0) ||
    ['exited','error'].includes(value.applicationStatus?.state);
}

class RuntimeHandle extends EventTarget {
  constructor(owner, id, generation, keepAlive) {
    super();
    this.owner = owner;
    this.instanceId = id;
    this.sessionGeneration = generation;
    this.keepAlive = keepAlive;
    this.state = 'tracking';
    this._instance = null;
    this._lease = null;
    this.ready = new Promise((resolve, reject) => { this._resolve = resolve; this._reject = reject; });
    // A host may use events rather than await ready; do not create unhandled rejections.
    this.ready.catch(() => {});
  }
  get manager() { return this.owner.manager; }
  get instance() { return structuredClone(this._instance); }
  get lease() { return structuredClone(this._lease); }
  release() { this.owner._release(this); }
  setKeepAlive(enabled) {
    if (typeof enabled !== 'boolean') throw new TypeError('keepAlive must be boolean');
    if (this.state !== 'tracking') throw new Error('Runtime handle is no longer tracking');
    this.keepAlive = enabled;
    this.owner._changed();
  }
  renewIdleLease(options = {}) {
    if (this.state !== 'tracking' || this.sessionGeneration === null) return Promise.reject(new Error('Runtime handle is not ready'));
    return this.manager.renewIdleLease(this.instanceId, { ...options, sessionGeneration:this.sessionGeneration });
  }
}

/** One server per coordinator. scope must identify the application login, not a secret.
 * Across same-origin Tabs, quiet owners are retained for five minutes; browser
 * suspension beyond that is best effort. destroy on logout. No audio ownership.
 */
export class RemoteXAppCoordinator extends EventTarget {
  constructor({ manager = new RemoteXAppManager(), scope, crossTabs = true } = {}) {
    super();
    if (typeof scope !== 'string' || !scope || scope.length > 128) throw new TypeError('A non-secret login scope (1..128 characters) is required');
    const base = new URL(manager.url('/'), globalThis.location?.href || 'http://localhost/');
    if (!['http:','https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new TypeError('Manager requires an HTTP(S) base URL without credentials/query/fragment');
    this.manager = manager;
    this.scope = scope;
    this.serverKey = base.href.replace(/\/$/, '');
    this.ownerId = globalThis.crypto.randomUUID();
    this.handles = new Set();
    this.peers = new Map();
    this.jobs = new Map();
    this.history = [];
    this.destroyed = false;
    this.sequence = 0;
    this.timer = null;
    this.lastPulse = -Infinity;
    this.channel = null;
    if (crossTabs && typeof BroadcastChannel === 'function') {
      try {
        this.channel = new BroadcastChannel(`remotexapp-coordinator-v1:${JSON.stringify([this.serverKey, scope])}`);
        this.channel.onmessage = event => this._receive(event.data);
      } catch (_) { /* explicit local fallback in mode */ }
    }
    this.mode = this.channel ? 'cross-tab' : 'local';
    this._resume = () => { this.lastPulse = -Infinity; for (const job of this.jobs.values()) job.pollAt = job.renewAt = 0; this._wake(); };
    globalThis.addEventListener?.('pageshow', this._resume);
    globalThis.document?.addEventListener?.('visibilitychange', this._resume);
    globalThis.document?.addEventListener?.('resume', this._resume);
  }

  track(instanceId, { sessionGeneration = null, keepAlive = false } = {}) {
    if (this.destroyed) throw new Error('Coordinator is destroyed');
    if (!idOK(instanceId)) throw new TypeError('Invalid runtime ID');
    if (sessionGeneration !== null && !generationOK(sessionGeneration)) throw new RangeError('Invalid sessionGeneration');
    if (typeof keepAlive !== 'boolean') throw new TypeError('keepAlive must be boolean');
    if (this.handles.size >= MAX_HANDLES) throw new RangeError('At most 128 local runtime handles');
    const handle = new RuntimeHandle(this, instanceId, sessionGeneration, keepAlive);
    this.handles.add(handle);
    this._record('tracked', { instanceId, sessionGeneration });
    this._changed();
    return handle;
  }

  _release(handle, reason = 'released') {
    if (!this.handles.delete(handle)) return;
    handle.state = reason;
    handle.keepAlive = false;
    this._record(reason, { instanceId:handle.instanceId, sessionGeneration:handle.sessionGeneration });
    handle._reject(new Error(`Runtime handle ${reason}`));
    emit(handle, reason === 'released' ? 'release' : 'invalidated', { instance:handle.instance, reason });
    this._changed();
  }

  _interests() {
    return [...this.handles].map(handle => ({ id:handle.instanceId, generation:handle.sessionGeneration, keepAlive:handle.keepAlive }));
  }

  // Observation only: no requests, interest acquisition or election changes.
  getDiagnostics() {
    const now = performance.now();
    return structuredClone({
      mode:this.mode, serverKey:this.serverKey, scope:this.scope, ownerId:this.ownerId, destroyed:this.destroyed,
      policy:{ heartbeatMs:HEARTBEAT, leaderTimeoutMs:LEADER_TTL, interestRetentionMs:INTEREST_TTL },
      localHandles:this.handles.size,
      peers:[...this.peers].map(([ownerId, peer]) => ({ ownerId, ageMs:Math.max(0, now-peer.seen),
        eligible:now-peer.seen < LEADER_TTL, retained:now-peer.seen < INTEREST_TTL,
        interests:peer.interests.length })),
      runtimes:[...this.jobs.values()].map(job => {
        const matches = interest => interest.id === job.id && interest.generation === job.generation;
        return { instanceId:job.id, sessionGeneration:job.generation, leaderId:job.leader || null,
          isLeader:job.leader === this.ownerId, keepAlive:job.keepAlive,
          localHandles:this._interests().filter(matches).length,
          remoteInterests:[...this.peers.values()].filter(peer => now-peer.seen < INTEREST_TTL)
            .reduce((count, peer) => count + peer.interests.filter(matches).length, 0),
          inFlight:job.leader === this.ownerId && job.busy,
          instance:job.instance || null, lease:job.lease || null,
          nextRenewalInMs:job.leader === this.ownerId && job.keepAlive ? Math.max(0, job.renewAt-now) : null };
      }),
      events:this.history,
    });
  }

  _record(type, details = {}) {
    this.history.push({ time:new Date().toISOString(), type, ...details });
    if (this.history.length > 100) this.history.shift();
  }

  _post(message) {
    if (!this.destroyed) this.channel?.postMessage({ ...message, owner:this.ownerId, sequence:++this.sequence });
  }

  _changed() {
    if (this.destroyed) return;
    this._post({ type:'interests', interests:this._interests() });
    this.lastPulse = performance.now();
    this._wake();
  }

  _receive(message) {
    if (this.destroyed || !message || typeof message.owner !== 'string' || message.owner.length > 64 ||
        message.owner === this.ownerId || !Number.isSafeInteger(message.sequence) || message.sequence < 1) return;
    const now = performance.now();
    let peer = this.peers.get(message.owner);
    if (peer && message.sequence <= peer.sequence) return;
    if (message.type === 'interests') {
      if (!Array.isArray(message.interests) || message.interests.length > MAX_HANDLES ||
          message.interests.some(i => !i || !idOK(i.id) || (i.generation !== null && !generationOK(i.generation)) || typeof i.keepAlive !== 'boolean')) return;
      if (!peer && this.peers.size >= MAX_PEERS) return;
      peer = { sequence:message.sequence, seen:now, interests:message.interests };
      this.peers.set(message.owner, peer);
    } else {
      if (!peer) return;
      peer.sequence = message.sequence;
      if (message.type === 'state') {
        const state = snapshot(message.instance);
        if (!state || message.id !== state.id || (message.generation !== null && !generationOK(message.generation))) return;
        const job = this.jobs.get(keyOf(message.id, message.generation));
        if (job?.leader !== message.owner) return;
        job.instance = state;
        this._apply(state, message.generation);
      } else if (message.type === 'lease') {
        const job = this.jobs.get(keyOf(message.id, message.generation));
        if (job?.leader !== message.owner || message.lease?.instanceId !== message.id || message.lease?.sessionGeneration !== message.generation) return;
        this._lease(message.id, message.generation, message.lease);
      } else if (message.type === 'invalidated') {
        const job = this.jobs.get(keyOf(message.id, message.generation));
        if (job?.leader === message.owner) this._invalidate(message.id, message.generation);
      }
    }
    this._wake();
  }

  _wake() {
    if (this.destroyed || this.timer !== null) return;
    this.timer = setTimeout(() => { this.timer = null; this._tick(); }, 0);
  }

  _tick() {
    if (this.destroyed) return;
    const now = performance.now();
    if (now - this.lastPulse >= HEARTBEAT && this.handles.size) {
      this._post({ type:'interests', interests:this._interests() });
      this.lastPulse = now;
    }
    for (const [id, peer] of this.peers) if (now - peer.seen >= INTEREST_TTL) this.peers.delete(id);
    const desired = new Map();
    const add = (owner, interests, active) => {
      for (const interest of interests) {
        const key = keyOf(interest.id, interest.generation);
        let entry = desired.get(key);
        if (!entry) {
          if (desired.size >= MAX_HANDLES) continue;
          entry = { id:interest.id, generation:interest.generation, keepAlive:false, candidates:[] };
          desired.set(key, entry);
        }
        entry.keepAlive ||= interest.keepAlive;
        if (active) entry.candidates.push(owner);
      }
    };
    add(this.ownerId, this._interests(), true);
    for (const [owner, peer] of this.peers) add(owner, peer.interests, now - peer.seen < LEADER_TTL);
    for (const [key, job] of this.jobs) if (!desired.has(key)) { job.abort?.abort(); this.jobs.delete(key); }
    for (const [key, entry] of desired) {
      // An awake coordinator with any local interest can cover retained frozen
      // peers, but an empty page cannot keep abandoned remote interests alive.
      if (!entry.candidates.length && this.handles.size) entry.candidates.push(this.ownerId);
      const leader = entry.candidates.sort()[0];
      let job = this.jobs.get(key);
      if (!job) { job = { pollAt:0, renewAt:0, busy:false }; this.jobs.set(key, job); }
      if (job.leader !== leader || job.keepAlive !== entry.keepAlive) {
        job.abort?.abort(); job.pollAt = job.renewAt = 0;
      }
      if (job.leader !== leader) this._record('leader-changed', {
        instanceId:entry.id, sessionGeneration:entry.generation,
        previousLeaderId:job.leader || null, leaderId:leader || null,
      });
      Object.assign(job, entry, { leader });
      if (leader === this.ownerId && !job.busy && (now >= job.pollAt || job.keepAlive && now >= job.renewAt)) this._run(key, job);
    }
    if (this.handles.size || this.peers.size) this.timer = setTimeout(() => { this.timer = null; this._tick(); }, 100);
  }

  async _run(key, job) {
    job.busy = true;
    const abort = job.abort = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; abort.abort(); }, 5000);
    const current = () => !this.destroyed && !abort.signal.aborted && this.jobs.get(key) === job && job.leader === this.ownerId;
    try {
      if (performance.now() >= job.pollAt || !job.instance) {
        const value = snapshot(await this.manager.getInstance(job.id, { signal:abort.signal }));
        if (!current()) return;
        if (!value || value.id !== job.id) throw new Error('Invalid runtime status');
        job.instance = value;
        job.pollAt = performance.now() + 2000;
        this._apply(value, job.generation);
        this._post({ type:'state', id:job.id, generation:job.generation, instance:value });
        if (terminal(value) || job.generation !== null && value.sessionGeneration !== job.generation) {
          this._invalidate(job.id, job.generation);
          this._post({ type:'invalidated', id:job.id, generation:job.generation });
          return;
        }
        if (job.generation === null) return;
      }
      if (job.generation === null || terminal(job.instance) || job.instance.sessionGeneration !== job.generation) return;
      if (job.keepAlive && performance.now() >= job.renewAt) {
        const started = performance.now();
        const value = await this.manager.renewIdleLease(job.id, { sessionGeneration:job.generation, signal:abort.signal });
        if (!current()) return;
        job.renewAt = performance.now() + Math.max(100, Math.min(value.idleTimeoutMs / 3, 300000) - (performance.now() - started));
        this._lease(job.id, job.generation, value);
        this._post({ type:'lease', id:job.id, generation:job.generation, lease:value });
      }
    } catch (error) {
      if (!current() && !(timedOut && !this.destroyed && this.jobs.get(key) === job && job.leader === this.ownerId)) return;
      // Deliberately exclude arbitrary server messages, paths and response bodies.
      this._record('request-error', { instanceId:job.id, sessionGeneration:job.generation,
        status:Number.isInteger(error.status) ? error.status : 0, timedOut });
      if ([401,403,404].includes(error.status) || error.status === 409 && error.body?.code !== 'busy') {
        this._invalidate(job.id, job.generation);
        this._post({ type:'invalidated', id:job.id, generation:job.generation });
      }
      emit(this, 'error', { instanceId:job.id, sessionGeneration:job.generation, status:error.status || 0, message:timedOut ? 'Runtime request timed out' : error.message });
      job.pollAt = performance.now() + 2000;
      job.renewAt = performance.now() + 1000;
    } finally {
      clearTimeout(timer);
      if (job.abort === abort) { job.abort = null; job.busy = false; }
    }
  }

  _apply(instance, expected) {
    for (const handle of [...this.handles]) {
      if (handle.instanceId !== instance.id || handle.sessionGeneration !== expected) continue;
      const changed = JSON.stringify(handle._instance) !== JSON.stringify(instance);
      handle._instance = instance;
      if (expected !== null && expected !== instance.sessionGeneration || terminal(instance)) {
        this._release(handle, 'invalidated');
        continue;
      }
      const initial = handle.sessionGeneration === null;
      handle.sessionGeneration = instance.sessionGeneration;
      handle._resolve(handle);
      if (changed) emit(handle, 'statechange', { instance });
      if (initial) this._changed();
    }
    emit(this, 'statechange', { instance });
  }

  _lease(id, generation, value) {
    // Lease values are content-free; project rather than forwarding unknown keys.
    const lease = { instanceId:id, sessionGeneration:generation, outcome:value.outcome,
      idleAction:value.idleAction, idleTimeoutMs:value.idleTimeoutMs, serverTime:value.serverTime, expiresAt:value.expiresAt };
    const job = this.jobs.get(keyOf(id, generation));
    if (job) job.lease = lease;
    this._record('lease-received', { instanceId:id, sessionGeneration:generation, outcome:lease.outcome });
    for (const handle of this.handles) if (handle.instanceId === id && handle.sessionGeneration === generation) {
      handle._lease = lease; emit(handle, 'leasechange', { lease });
    }
    emit(this, 'leasechange', { lease });
  }

  _invalidate(id, generation) {
    for (const handle of [...this.handles]) if (handle.instanceId === id && handle.sessionGeneration === generation) this._release(handle, 'invalidated');
    // Also retire remote interests for this exact generation, until their owner
    // explicitly acquires again. Never renew a new generation on its behalf.
    for (const peer of this.peers.values()) peer.interests = peer.interests.filter(i => i.id !== id || i.generation !== generation);
  }

  destroy() {
    if (this.destroyed) return;
    for (const handle of [...this.handles]) this._release(handle);
    this._post({ type:'interests', interests:[] });
    this.destroyed = true;
    clearTimeout(this.timer); this.timer = null;
    for (const job of this.jobs.values()) job.abort?.abort();
    this.jobs.clear(); this.peers.clear();
    this.channel?.close();
    globalThis.removeEventListener?.('pageshow', this._resume);
    globalThis.document?.removeEventListener?.('visibilitychange', this._resume);
    globalThis.document?.removeEventListener?.('resume', this._resume);
  }
}
