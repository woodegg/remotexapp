// Shared switch ordering, never media authority. A live owner's local intent,
// browser permission and fresh runtime grants are still required for capture.
const VERSION = 1, MAX_ENTRIES = 128, MAX_PARTICIPANTS = 32, MAX_LENGTH = 262144, LOCK_WAIT_MS = 2000;
const documentRegistry = Symbol.for('remotexapp.audio-intent-observers.v1');
const kinds = new Set(['speaker','microphone']);
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,128}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const unavailable = () => ({available:false,enabled:false,participating:false,reason:'intent-state-unavailable'});
const entryKey = value => value.runtime + ':' + value.generation + ':' + value.kind;
function target(runtime,generation,kind) {
  if (!identifier(runtime) || !Number.isSafeInteger(generation) || generation < 1 || !kinds.has(kind)) throw TypeError('Invalid audio intent target');
  return {runtime,generation,kind};
}
function load(storage,key) {
  const raw = storage.getItem(key);
  if (raw === null) return {version:VERSION,revision:0,entries:[]};
  if (typeof raw !== 'string' || raw.length > MAX_LENGTH) throw Error('Invalid intent state');
  const value = JSON.parse(raw), keys = new Set();
  if (value?.version !== VERSION || !integer(value.revision) || !Array.isArray(value.entries) || value.entries.length > MAX_ENTRIES ||
      Object.keys(value).some(k=>!['version','revision','entries'].includes(k))) throw Error('Invalid intent state');
  for (const e of value.entries) {
    target(e?.runtime,e?.generation,e?.kind);
    if (keys.has(entryKey(e)) || typeof e.enabled !== 'boolean' || !integer(e.revision) || e.revision < 1 || e.revision > value.revision ||
        !integer(e.epoch) || e.epoch < 1 || e.epoch > e.revision || !Array.isArray(e.participants) || e.participants.length > MAX_PARTICIPANTS ||
        e.participants.some(p=>!identifier(p)) || new Set(e.participants).size !== e.participants.length ||
        (!e.enabled && e.participants.length) || Object.keys(e).some(k=>!['runtime','generation','kind','enabled','revision','epoch','participants'].includes(k))) throw Error('Invalid intent state');
    keys.add(entryKey(e));
  }
  return value;
}

export class AudioIntentJournal {
  constructor(env,base) {
    this.env = env;
    const url = new URL(base,env.location.href);
    if (url.origin !== env.location.origin || url.username || url.password) throw TypeError('Audio intent requires the same origin');
    url.search = ''; url.hash = '';
    this.key = 'remotexapp.audio-intents.v1:' + url.href.replace(/\/$/,'');
    this.owner = env.crypto.randomUUID(); this.closed = false;
    this.listeners = new Set();
    const scopes = env[documentRegistry] ||= new Map();
    this.documentScopes = scopes;
    this.peers = scopes.get(this.key);
    if (!this.peers) scopes.set(this.key,this.peers = new Set());
    this.peers.add(this);
    this.changed = event => { if (!this.closed && (event.key === this.key || event.key === null)) for (const fn of this.listeners) fn(); };
    env.addEventListener?.('storage',this.changed);
  }
  _notify() {
    // Native storage events exclude every owner in the writing document, not
    // only the writer. Wake same-document peers too, coalescing bursts.
    if (this.closed || this.notificationPending || !this.listeners.size) return;
    this.notificationPending = true;
    queueMicrotask(()=>{
      this.notificationPending = false;
      if (this.closed) return;
      for (const fn of this.listeners) {
        try { fn(); } catch (error) { this.env.reportError?.(error); }
      }
    });
  }
  _view(entry) {
    return {available:true,enabled:!!entry?.enabled,participating:!!entry?.enabled && entry.participants.includes(this.owner),
      revision:entry?.revision || 0,epoch:entry?.epoch || 0};
  }
  read(runtime,generation,kind) {
    const key = entryKey(target(runtime,generation,kind));
    if (this.closed) return unavailable();
    try {
      if (!this.env.navigator?.locks?.request) return unavailable();
      const state = load(this.env.localStorage,this.key);
      if (state.revision === Number.MAX_SAFE_INTEGER) return unavailable();
      return this._view(state.entries.find(e=>entryKey(e)===key));
    }
    catch { return unavailable(); }
  }
  subscribe(fn) {
    if (typeof fn !== 'function') throw TypeError('An intent listener is required');
    if (!this.closed) this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  async _update(fn) {
    let timer, expired = false;
    const schedule = this.env.setTimeout?.bind(this.env) || setTimeout;
    const cancel = this.env.clearTimeout?.bind(this.env) || clearTimeout;
    const controller = new AbortController();
    try {
      if (!this.env.navigator?.locks?.request || !this.env.localStorage) return unavailable();
      const deadline = new Promise(resolve=>{timer = schedule(()=>{
        expired = true; controller.abort(); resolve(unavailable());
      },LOCK_WAIT_MS);});
      const locked = this.env.navigator.locks.request(this.key,{mode:'exclusive',signal:controller.signal},()=>{
        if (expired) return unavailable();
        const state = load(this.env.localStorage,this.key);
        if (state.revision === Number.MAX_SAFE_INTEGER) return unavailable();
        const result = fn(state);
        if (!result) return unavailable();
        if (result.changed !== false) {
          const encoded = JSON.stringify(state);
          if (encoded.length > MAX_LENGTH) return unavailable();
          this.env.localStorage.setItem(this.key,encoded);
          for (const peer of this.env[documentRegistry]?.get(this.key) || []) peer._notify();
        }
        const {changed,...view} = result;
        return view;
      });
      return await Promise.race([locked,deadline]);
    } catch { return unavailable(); }
    finally { if (timer !== undefined) cancel(timer); }
  }
  publish(runtime,generation,kind,enabled) {
    const wanted = target(runtime,generation,kind), key = entryKey(wanted);
    if (typeof enabled !== 'boolean') throw TypeError('An audio intent switch must be boolean');
    if (this.closed) return Promise.resolve(unavailable());
    return this._update(state=>{
      if (this.closed) return null;
      const index = state.entries.findIndex(e=>entryKey(e)===key), previous = state.entries[index];
      const revision = ++state.revision;
      const continuing = enabled && previous?.enabled;
      const participants = continuing ? previous.participants.filter(p=>p!==this.owner) : [];
      if (enabled) participants.push(this.owner);
      const next = {...wanted,enabled,revision,epoch:continuing ? previous.epoch : revision,participants:participants.slice(-MAX_PARTICIPANTS)};
      if (index >= 0) state.entries.splice(index,1);
      state.entries.push(next);
      while (state.entries.length > MAX_ENTRIES) {
        const unused = state.entries.findIndex(e=>e.participants.length===0);
        state.entries.splice(unused < 0 ? 0 : unused,1);
      }
      return this._view(next);
    });
  }
  leave(runtime,generation) {
    target(runtime,generation,'speaker');
    if (this.closed) return Promise.resolve(unavailable());
    return this._update(state=>{
      if (this.closed) return null;
      const entries = state.entries.filter(e=>e.runtime===runtime && e.generation===generation && e.participants.includes(this.owner));
      if (!entries.length) return {available:true,enabled:false,participating:false,revision:state.revision,changed:false};
      const revision = ++state.revision;
      for (const e of entries) { e.participants = e.participants.filter(p=>p!==this.owner); e.revision = revision; }
      return {available:true,enabled:false,participating:false,revision};
    });
  }
  // Retiring an SDK owner does not turn off another live participant. Its old
  // identifier can no longer authorize automatic recovery, even after reconnect.
  dispose({logout=false} = {}) {
    if (this.retirement) return this.retirement;
    this.closed = true; this.listeners.clear(); this.env.removeEventListener?.('storage',this.changed);
    this.peers.delete(this);
    if (!this.peers.size) this.documentScopes.delete(this.key);
    if (!this.documentScopes.size && this.env[documentRegistry] === this.documentScopes) delete this.env[documentRegistry];
    return this.retirement = this._update(state=>{
      if (!state.entries.some(e=>logout ? e.enabled || e.participants.length : e.participants.includes(this.owner))) {
        return {available:true,enabled:false,participating:false,revision:state.revision,changed:false};
      }
      const revision = state.revision + 1;
      for (const e of state.entries) {
        if (logout) { e.enabled = false; e.participants = []; e.epoch = e.revision = revision; }
        else if (e.participants.includes(this.owner)) { e.participants = e.participants.filter(p=>p!==this.owner); e.revision = revision; }
      }
      state.revision = revision;
      return {available:true,enabled:false,participating:false,revision};
    });
  }
}
