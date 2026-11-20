import {RemoteXAppNativeError} from './remotexapp-native-client.js';
import {recoveryPanel} from './native-recovery-panel.js';

const fail = code => new RemoteXAppNativeError(code, code);
const containers = new WeakMap();
const emit = (target, name, detail) => target.dispatchEvent(new CustomEvent(name, {detail:structuredClone(detail)}));
const running = x => x?.sessionState === 'running' && ['ready','server-ready'].includes(x.state) &&
  !['error','exited','stopped'].includes(x.applicationStatus?.state) && (!x.shutdown || x.shutdown.state === 'cancelled');
const identity = x => JSON.stringify([x.id,x.createdAt,x.templateId,x.profileRef,x.managedInstanceId,
  x.displayProvider,x.displayComponentDigest,x.versions?.current]);
const unfinishedUpgrade = x => !!x?.upgrade && x.upgrade.phase !== 'completed';
const codeOf = e => (e?.status || e?.cause?.status) === 401 ? 'authentication-required' : (e?.status || e?.cause?.status) === 403 ? 'permission-denied' :
  (e?.status || e?.cause?.status) === 404 ? 'target-unavailable' :
  (e?.status || e?.cause?.status) === 409 ? 'operation-refused' : /^[a-z][a-z0-9-]{0,63}$/.test(e?.code || '') ? e.code : 'connection-unavailable';

/** One window owner. Low-level Session and Viewer objects remain generation-bound. */
export class RemoteXAppView extends EventTarget {
  constructor(host, container, target, {panel = true, ...viewerOptions} = {}) {
    super();
    if (!container?.ownerDocument?.createElement || typeof panel !== 'boolean') throw new TypeError('A DOM container and boolean panel are required');
    if (containers.has(container)) throw fail('container-in-use');
    if (!target || [target.templateId,target.instanceId,target.managedId].filter(Boolean).length !== 1) throw new TypeError('Choose one explicit App target');
    this.host = host; this.manager = host.manager;
    this.target = structuredClone({...target,signal:undefined}); this.options = {...viewerOptions};
    this.session = null; this.viewer = null; this.closed = false;
    this._abort = new AbortController(); this._phase = 'connecting'; this._reason = null;
    this._revision = 0; this._epoch = 0; this._listeners = []; this._confirmation = null;
    this._ui = recoveryPanel(container, this, panel); this._container = container; containers.set(container,this); this._publish();
    this._audioChange = () => this._publish(); this.host.addEventListener?.('audiochange',this._audioChange);
    if (target.signal) {
      this._externalAbort = () => { this.release(); };
      target.signal.addEventListener('abort', this._externalAbort, {once:true});
      this._externalSignal = target.signal;
      if (target.signal.aborted) this.release();
    }
    this.settled = Promise.resolve().then(() => this._perform('open', signal => this._open(signal)))
      .then(() => this.getState(), () => this.getState());
  }
  getState() { return structuredClone(this._snapshot); }
  _listen(target, name, fn) {
    target.addEventListener(name, fn); this._listeners.push(() => target.removeEventListener(name, fn));
  }
  _eligible(x = this._observed) {
    return !!x && !!this._anchor && identity(x) === identity(this._anchor) && x.displayProvider === 'kasm';
  }
  _actions() {
    if (this.closed || this._busy || this._confirmation || this._phase !== 'attention') return [];
    const a = ['refresh'];
    if (this._reason === 'authentication-required') return ['authenticate','help'];
    if (this._reason === 'permission-denied' || this._reason === 'target-changed') return ['refresh','help'];
    const x = this._observed;
    if (!this._anchor) {
      if (!this.target.templateId) a.push('retry');
      return [...a,'help'];
    }
    if (this._eligible() && running(x) && (!this._managed || this._managed.desiredState === 'running')) {
      if (x.sessionGeneration === this.session?.generation && this.session.state === 'active') a.push('retry');
      else if (this._anchor.createdAt && x.sessionGeneration >= this.session?.generation) a.push('reattach');
      if (this._capabilities?.runtimeRestart && this._anchor.createdAt && !unfinishedUpgrade(x)) a.push('restart');
    }
    if (this._eligible() && x.recovery && this._managed?.desiredState === 'running') a.push('recheck');
    return [...a,'help'];
  }
  _publish() {
    const kinds = this._actions();
    const clipboard = this.viewer?.getClipboardState?.(), audio = this.host.getAudioState?.();
    const value = {state:this.closed ? 'closed' : this._phase, reason:this._reason,
      displayReady:!this.closed && this.viewer?.state === 'ready' && this.session?.state === 'active' && running(this._observed),
      busy:!!this._busy, instanceId:this._anchor?.id || null, generation:this.session?.generation || null,
      recovery:this._observed?.recovery ? {phase:this._observed.recovery.phase,reason:this._observed.recovery.reason} : null,
      features:{clipboard:clipboard ? {phase:clipboard.phase,active:clipboard.active,
        effective:clipboard.effective,permissions:clipboard.permissions} : {phase:'unavailable',active:false},
        audio:{connection:audio?.connection || 'idle'},input:{provider:'kasm-native'}},
      confirmation:this._confirmation ? {id:this._confirmation.id,expiresAt:this._confirmation.expiresAt,
        kind:'restart',scope:'runtime',mayDiscardUnsavedWork:true} : null,
      actions:kinds.map(kind => ({kind,scope:['restart','recheck','reattach'].includes(kind)?'runtime':kind==='authenticate'?'login':kind==='help'?'operator':'viewer'}))};
    const signature = JSON.stringify(value);
    if (signature === this._signature) return;
    this._signature = signature; const revision = ++this._revision;
    this._snapshot = {...value,revision,actions:value.actions.map(a=>({...a,id:`${revision}:${a.kind}`}))};
    this._ui.render(this._snapshot); emit(this,'change',this._snapshot);
  }
  _current(epoch) { if (this.closed || epoch !== this._epoch) throw fail('view-closed'); }
  async _perform(kind, operation) {
    if (this.closed) throw fail('view-closed');
    if (this._busy) throw fail('recovery-busy');
    const epoch = ++this._epoch;
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(fail('operation-timeout')),kind === 'restart' ? 120000 : 100000);
    const signal = AbortSignal.any([this._abort.signal,deadline.signal]);
    this._busy = kind;
    if (kind !== 'refresh') this._phase = kind === 'open' ? 'connecting' : 'recovering';
    this._publish();
    try { await operation(signal); this._current(epoch); return this.getState(); }
    catch (error) {
      if (!this.closed) {
        this._phase = 'attention'; this._reason = codeOf(error);
        if (['authentication-required','permission-denied','target-unavailable'].includes(this._reason)) this._observed = null;
      }
      throw error;
    } finally { clearTimeout(timer); if (epoch === this._epoch) { this._busy = null; this._publish(); } }
  }
  async _open(signal) {
    if (this.closed) throw fail('view-closed');
    let session;
    try { session = await this.host.open({...this.target,signal}); }
    catch (error) {
      // A timed-out create may already exist. Never replay its launch intent.
      if (this.target.templateId && (!error.status || error.body?.code === 'launch-uncertain')) throw fail('launch-uncertain');
      throw error;
    }
    await this._adopt(session, signal);
  }
  async _adopt(session, signal) {
    if (signal.aborted || this.closed) { await session.release(); throw fail('view-closed'); }
    if (this._anchor && identity(session.instance) !== identity(this._anchor)) { await session.release(); throw fail('target-changed'); }
    const previous = this.session;
    for (const remove of this._listeners.splice(0)) remove();
    this.viewer = null; this.session = session; this._anchor ||= session.instance; this._observed = session.instance;
    if (previous && previous !== session) await previous.release();
    // release() can run while the old generation is retiring. Do not recreate
    // listeners or an attachment on a window which has already relinquished it.
    if (signal.aborted || this.closed) { await session.release(); throw fail('view-closed'); }
    this._listen(session,'invalidated',() => {
      this._observed = null; this._confirmation = null; this._phase = 'attention'; this._reason = 'runtime-invalidated'; this._publish();
    });
    this._listen(session.handle,'statechange',() => this._publish());
    try {
      const viewer = await session.attach(this._ui.display,{...this.options,signal});
      if (this.closed || signal.aborted) { viewer.dispose(); throw fail('view-closed'); }
      this.viewer = viewer;
      this._listen(viewer,'statechange',e => {
        const state = e.detail.state;
        if (this.closed) return;
        if (!this._busy || this._busy === 'retry') {
          this._phase = state === 'ready' ? 'ready' : ['connecting','reconnecting'].includes(state) ? 'recovering' : 'attention';
          this._reason = state === 'ready' ? null : codeOf({code:e.detail.code,status:e.detail.httpStatus});
        }
        this._confirmation = null; this._publish();
      });
      this._listen(viewer,'clipboardstatechange',() => this._publish());
      this._phase = 'ready'; this._reason = null; emit(this,'attached',{instanceId:session.id,generation:session.generation});
    } catch (error) { this._phase = 'attention'; throw error; }
  }
  async _fresh(signal) {
    const options = {signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])};
    if (!this._anchor) return null;
    const actual = await this.manager.getInstance(this._anchor.id,options);
    if (this.closed || signal.aborted) throw fail('view-closed');
    if (!this._eligible(actual)) throw fail('target-changed');
    this._observed = actual; this._managed = null;
    if (actual.managedInstanceId) {
      const managed = await this.manager.getManagedInstance(actual.managedInstanceId,options);
      if (managed.id !== actual.managedInstanceId || managed.runtimeInstanceId !== actual.id) throw fail('target-changed');
      this._managed = managed;
    }
    if (this.closed || signal.aborted) throw fail('view-closed');
    this._capabilities = (await this.manager.getVersion(options)).capabilities;
    if (this.closed || signal.aborted) throw fail('view-closed');
    return actual;
  }
  async run(actionId) {
    const action = this._snapshot.actions.find(a => a.id === actionId);
    if (!action || this.closed) throw fail('stale-recovery-action');
    if (['authenticate','help'].includes(action.kind)) {
      emit(this,'request',{kind:action.kind,reason:this._reason});return this.getState();
    }
    await this._perform(action.kind, async signal => {
      if (action.kind === 'retry' && !this._anchor) return this._open(signal);
      const actual = await this._fresh(signal);
      if (action.kind === 'refresh') {
        this._phase = this.viewer?.state === 'ready' && this.session?.state === 'active' && running(actual) ? 'ready' : 'attention';
        if (actual && this._reason === 'permission-denied') this._reason = 'connection-unavailable';
        return;
      }
      if (!actual) throw fail('operator-required');
      if (action.kind === 'recheck') {
        if (!actual.recovery || this._managed?.desiredState !== 'running') throw fail('recovery-unavailable');
        await this.manager.retryRecovery(actual.id,{sessionGeneration:actual.sessionGeneration,signal});
        this._phase = 'attention'; this._reason = 'recheck-submitted'; return;
      }
      if (!running(actual) || this._managed && this._managed.desiredState !== 'running') throw fail('runtime-unavailable');
      if (action.kind === 'restart') {
        if (!this._capabilities?.runtimeRestart || unfinishedUpgrade(actual) || !this._anchor.createdAt) throw fail('restart-unavailable');
        this._confirmation = {id:crypto.randomUUID(),expiresAt:Date.now()+60000,generation:actual.sessionGeneration};
        this._phase = 'attention'; this._reason = 'restart-confirmation'; return;
      }
      if (action.kind === 'retry') {
        if (actual.sessionGeneration !== this.session.generation || this.session.state !== 'active') throw fail('stale-generation');
        if (this.viewer) await this.viewer.connect(actual); else await this._adopt(this.session,signal);
      } else if (action.kind === 'reattach') await this._replace(actual,signal);
      this._phase = 'ready'; this._reason = null;
    });
    return this.getState();
  }
  async _replace(actual, signal) {
    if (!this._anchor.createdAt || !this._eligible(actual) || !running(actual)) throw fail('target-changed');
    const session = await this.host.open({instanceId:actual.id,keepAlive:this.target.keepAlive ?? false,signal});
    if (session.generation !== actual.sessionGeneration || identity(session.instance) !== identity(actual)) {
      await session.release(); throw fail('stale-generation');
    }
    await this._adopt(session,signal);
  }
  cancelConfirmation() { this._confirmation = null; if (!this.closed) { this._reason = 'restart-cancelled'; this._publish(); } }
  async confirm(confirmationId) {
    const confirmation = this._confirmation;
    this._confirmation = null;
    if (!confirmation || confirmation.id !== confirmationId || confirmation.expiresAt < Date.now() || this.closed) {
      this._publish(); throw fail('stale-confirmation');
    }
    await this._perform('restart',async signal => {
      const actual = await this._fresh(signal);
      if (!actual || actual.sessionGeneration !== confirmation.generation || !running(actual) || unfinishedUpgrade(actual) ||
          !this._capabilities?.runtimeRestart || this._managed && this._managed.desiredState !== 'running') throw fail('stale-confirmation');
      this.viewer?.disconnect();
      let result;
      try { result = await this.manager.restartInstance(actual.id,{sessionGeneration:confirmation.generation,signal}); }
      catch(error) { if (!error.status || error.status >= 500) throw fail('operation-uncertain'); throw error; }
      if (this.closed || signal.aborted) throw fail('operation-uncertain');
      if (result.sessionGeneration <= actual.sessionGeneration) throw fail('operation-uncertain');
      await this._replace(result,signal);
      this._phase = 'ready'; this._reason = null;
    });
    return this.getState();
  }
  async release() {
    if (this.closed) return;
    this.closed = true; ++this._epoch; this._abort.abort(); this._busy = null; this._confirmation = null;
    this._externalSignal?.removeEventListener('abort',this._externalAbort);
    this.host.removeEventListener?.('audiochange',this._audioChange);
    for (const remove of this._listeners.splice(0)) remove();
    this.viewer?.dispose(); await this.session?.release();
    this.host.views?.delete(this); containers.delete(this._container); this._publish(); this._ui.dispose();
  }
}
