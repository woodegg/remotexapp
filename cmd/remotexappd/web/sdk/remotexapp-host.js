import {RemoteXAppManager} from './remotexapp-manager.js';
import {RemoteXAppCoordinator} from './remotexapp-coordinator.js';
import {RemoteXAppNativeClient, RemoteXAppNativeError} from './remotexapp-native-client.js';
import {RemoteXAppAudio} from './remotexapp-audio.js';

const fail = (code, message = code) => new RemoteXAppNativeError(code, message);
const event = (target, name, detail) => target.dispatchEvent(new CustomEvent(name, {detail}));

/** One host login/server. Windows and tasks each own a separate session handle. */
export class RemoteXAppHost extends EventTarget {
  constructor({baseURL, scope, manager = new RemoteXAppManager({baseURL}), crossTabs = true} = {}) {
    super();
    this.manager = manager;
    this.coordinator = new RemoteXAppCoordinator({manager, scope, crossTabs});
    this.sessions = new Set();
    this.closed = false;
    this._abort = new AbortController();
    this._audio = null;
    this.coordinator.addEventListener('error', e => event(this,'error',{code:e.detail?.status || 'runtime-observation-failed'}));
  }
  _viewer(options) { return new RemoteXAppNativeClient(options); }
  _audioService() {
    if (this.closed) throw fail('disposed');
    if (!this._audio) {
      this._audio = new RemoteXAppAudio({baseURL:this.manager.url('/')});
      this._audio.addEventListener('statechange', e => event(this,'audiochange',e.detail));
    }
    return this._audio;
  }
  getAudioState() { return this._audio?.stats || {connection:'idle',speakerOwner:false,micOwner:false,routes:[]}; }
  _current() { if (this.closed) throw fail('disposed', 'Host has been disposed'); }
  templates(options) { this._current(); return this.manager.listTemplates(options); }

  /** Explicit user/task intent. Observing an existing stopped managed App never starts it. */
  async open({templateId, instanceId, managedId, parameters, profileRef, overrides, keepAlive = false, signal} = {}) {
    this._current();
    if ([templateId,instanceId,managedId].filter(Boolean).length !== 1) throw new TypeError('Choose exactly one templateId, instanceId or managedId');
    if (typeof keepAlive !== 'boolean') throw new TypeError('keepAlive must be boolean');
    const active = AbortSignal.any([this._abort.signal, ...(signal ? [signal] : [])]);
    const check = () => { active.throwIfAborted(); this._current(); };
    check();
    let instance, handle, session;
    try {
      if (managedId) {
        const managed = await this.manager.getManagedInstance(managedId, {signal:active});
        check();
        if (managed.id !== managedId || managed.desiredState !== 'running' || managed.observedState !== 'running' ||
            !managed.runtimeInstanceId || managed.runtime?.id !== managed.runtimeInstanceId)
          throw fail('managed-unavailable', 'Managed application is not running');
        instance = await this.manager.getInstance(managed.runtimeInstanceId, {signal:active});
        if (instance.managedInstanceId !== managedId) throw fail('invalid-descriptor');
      } else if (instanceId) instance = await this.manager.getInstance(instanceId, {signal:active});
      else instance = await this.manager.createInstance({templateId,parameters,profileRef,overrides,signal:active});
      check();
      if ((instanceId && instance.id !== instanceId) || (templateId && instance.templateId !== templateId) ||
          instance.displayProvider !== 'kasm' || !/^[a-f0-9]{64}$/.test(instance.displayComponentDigest || '') ||
          !Number.isSafeInteger(instance.sessionGeneration) || instance.sessionGeneration < 0 ||
          !['ready','server-ready'].includes(instance.state)) throw fail('invalid-descriptor', 'Native application is unavailable');
      const selected = instance;
      // Preparation is a public Manager operation, not an invisible Viewer or
      // an idle lease. Core owns any on-attach activation and vacancy cleanup.
      if (instance.sessionState !== 'running') {
        if (instance.sessionState !== 'stopped') throw fail('runtime-unavailable');
        try {
          instance = await this.manager.prepareNativeInstance(instance, {signal:active});
        } catch (error) {
          check();
          if (error.status !== 409) throw error;
          const fresh = await this.manager.getInstance(selected.id, {signal:active});
          check();
          if (fresh.id !== selected.id || fresh.sessionState !== 'running' ||
              fresh.sessionGeneration !== selected.sessionGeneration + 1 || fresh.displayComponentDigest !== selected.displayComponentDigest ||
              fresh.nativeClipboard !== selected.nativeClipboard || fresh.nativeAudio !== selected.nativeAudio ||
              fresh.versions?.current?.core?.sha256 !== selected.versions?.current?.core?.sha256)
            throw error;
          instance = fresh;
        }
      }
      check();
      if (instance.id !== selected.id || instance.displayProvider !== 'kasm' || instance.sessionState !== 'running' ||
          instance.displayComponentDigest !== selected.displayComponentDigest || !Number.isSafeInteger(instance.sessionGeneration) ||
          instance.sessionGeneration < 1 || instance.sessionGeneration < selected.sessionGeneration ||
          instance.sessionGeneration > selected.sessionGeneration + 1) throw fail('stale-generation');
      handle = this.coordinator.track(instance.id, {sessionGeneration:instance.sessionGeneration,keepAlive});
      const abort = () => handle.release();
      active.addEventListener('abort', abort, {once:true});
      try { await handle.ready; check(); }
      finally { active.removeEventListener('abort', abort); }
      if (handle.state !== 'tracking') throw fail('runtime-invalidated');
      session = new RemoteXAppSession(this, instance, handle);
      this.sessions.add(session);
      event(this,'sessionopen',{instanceId:instance.id,generation:instance.sessionGeneration});
      // A host event listener may synchronously dispose or release the result.
      check(); session._current();
      return session;
    } catch (error) {
      if (session) await session.release(); else handle?.release();
      throw error;
    }
  }
  diagnostics() { return this.coordinator.getDiagnostics(); }
  async logout() {
    if (this.closed) return;
    await this.dispose({logout:true});
  }
  async dispose({logout = false} = {}) {
    if (this.closed) return;
    this.closed = true; this._abort.abort(fail('disposed'));
    await Promise.allSettled([...this.sessions].map(session => session.release()));
    this.coordinator.destroy();
    try { if (logout) await this._audio?.logout(); }
    finally { this._audio?.dispose(); this._audio = null; }
    event(this,'closed',{logout});
  }
}

/** One window/task's generation-qualified ownership; release never means stop. */
export class RemoteXAppSession extends EventTarget {
  constructor(host, instance, handle) {
    super();
    this.host = host; this.manager = host.manager;
    this.instance = Object.freeze(structuredClone(instance));
    this.id = instance.id; this.generation = instance.sessionGeneration;
    this.handle = handle; this.state = 'active';
    this.viewers = new Set(); this.audioInterests = new Set();
    this._abort = new AbortController();
    this._invalidated = () => {
      if (this.state !== 'active') return;
      this.state = 'invalidated'; this._abort.abort(fail('runtime-invalidated'));
      for (const viewer of this.viewers) viewer.disconnect();
      for (const interest of this.audioInterests) Promise.resolve(interest.release()).catch(()=>{});
      this.audioInterests.clear();
      event(this,'invalidated',{instanceId:this.id,generation:this.generation});
    };
    handle.addEventListener('invalidated', this._invalidated);
  }
  _current() {
    if (this.state !== 'active' || this.host.closed || this.handle.state !== 'tracking') throw fail('runtime-invalidated');
  }
  _signal(signal) { this._current(); return AbortSignal.any([this._abort.signal,...(signal ? [signal] : [])]); }
  setKeepAlive(enabled) { this._current(); this.handle.setKeepAlive(enabled); }
  async attach(container, options = {}) {
    this._current();
    const viewer = this.host._viewer({...options,container,manager:this.manager,runtime:this.handle,reconnect:options.reconnect ?? true});
    this.viewers.add(viewer);
    const disposed = e => {
      if (e.detail.state !== 'disposed') return;
      this.viewers.delete(viewer); viewer.removeEventListener('statechange', disposed);
    };
    viewer.addEventListener('statechange', disposed);
    try { await viewer.connect(this.instance); this._current(); return viewer; }
    catch(error) { viewer.dispose(); throw error; }
  }
  async actions({signal} = {}) {
    const value = await this.manager.getActions(this.id, {signal:this._signal(signal)});
    this._current();
    if (value.instanceId !== this.id || value.sessionGeneration !== this.generation) throw fail('stale-generation');
    return value;
  }
  async invoke(action, parameters = {}, {signal} = {}) {
    const value = await this.manager.invokeAction(this.id, action, parameters, {sessionGeneration:this.generation,signal:this._signal(signal)});
    try { this._current(); } catch { throw fail('action-uncertain'); }
    if (value.instanceId !== this.id || value.sessionGeneration !== this.generation || value.action !== action) throw fail('action-uncertain');
    return value;
  }
  async connections({signal} = {}) {
    const value = await this.manager.getConnections(this.id, {sessionGeneration:this.generation,signal:this._signal(signal)});
    this._current();
    if (value.instanceId !== this.id || value.sessionGeneration !== this.generation) throw fail('stale-generation');
    return value;
  }
  async audio() {
    this._current();
    if (this._audioInterest && !this._audioInterest.released) return this._audioInterest;
    if (this._audioPending) return this._audioPending;
    const pending = this._acquireAudio();
    this._audioPending = pending;
    try { return await pending; } finally { if (this._audioPending === pending) this._audioPending = null; }
  }
  async _acquireAudio() {
    const service = this.host._audioService();
    await service.ready; this._current();
    const interest = await service.acquire({id:this.id,sessionGeneration:this.generation});
    try { this._current(); }
    catch(error) { await interest.release(); throw error; }
    for (const old of this.audioInterests) if (old.released) this.audioInterests.delete(old);
    this.audioInterests.add(interest); this._audioInterest = interest;
    return interest;
  }
  async stop({force = false, signal} = {}) {
    const active = this._signal(signal);
    if (this.instance.managedInstanceId) throw fail('managed-stop-required', 'Use the explicit managed desired-state operation');
    const actual = await this.manager.getInstance(this.id, {signal:active});
    this._current();
    if (actual.sessionGeneration !== this.generation) throw fail('stale-generation');
    return this.manager.stopInstance(this.id, {force,sessionGeneration:this.generation,signal:active});
  }
  async release() {
    if (this.state === 'released') return;
    this.state = 'released'; this._abort.abort(fail('runtime-invalidated'));
    this.handle.removeEventListener('invalidated', this._invalidated);
    for (const viewer of this.viewers) viewer.dispose();
    this.viewers.clear();
    await Promise.allSettled([...this.audioInterests].map(interest => interest.release()));
    this.audioInterests.clear();
    this.handle.release(); this.host.sessions.delete(this);
    event(this,'release',{instanceId:this.id,generation:this.generation});
  }
}
