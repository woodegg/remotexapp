import { RemoteXAppManager } from './remotexapp-manager.js';

export class RemoteXAppNativeError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'RemoteXAppNativeError';
    this.code = code;
  }
}

function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once:true });
    Promise.resolve(promise).then(resolve,reject).finally(() => signal.removeEventListener('abort',abort));
  });
}

/** Minimal opt-in Kasm Viewer. Each object owns one display attachment only. */
export class RemoteXAppNativeClient extends EventTarget {
  constructor({ container, manager = new RemoteXAppManager(), timeout = 90000, keyboardPolicy } = {}) {
    super();
    if (!container?.replaceChildren) throw new TypeError('container is required');
    if (!Number.isFinite(timeout) || timeout < 1 || timeout > 120000) throw new RangeError('invalid connection timeout');
    this.container = container;
    this.manager = manager;
    this.timeout = timeout;
    this._keyboardPolicy = keyboardPolicy && structuredClone(keyboardPolicy);
    this._clipboardRevision = 0;
    this.clipboardEnabled = false;
    this.state = 'disconnected';
    this.capabilities = Object.freeze({ display:'kasm-wss-v1', pointer:true, keyboard:true,
      clipboard:false, keyboardPolicy:false, clipboardMaxBytes:0, programmaticText:false, audio:false, udp:false });
    this._epoch = 0;
    this._disposed = false;
  }

  _state(state, detail = {}) {
    this.state = state;
    this.dispatchEvent(new CustomEvent('statechange', { detail:{ state, ...detail } }));
  }

  _loadDisplay(url) { return import(url); }

  async connect(instance = this.instance?.id) {
    if (this._disposed) throw new RemoteXAppNativeError('disposed', 'Viewer has been disposed');
    if (!instance) throw new TypeError('instance is required');
    this.disconnect();
    const epoch = ++this._epoch;
    const controller = this._controller = new AbortController();
    const { signal } = controller;
    const current = () => {
      if (epoch !== this._epoch || signal.aborted) throw signal.reason || new DOMException('Connection replaced', 'AbortError');
    };
    const timer = setTimeout(() => controller.abort(new RemoteXAppNativeError('timeout', 'Native Viewer readiness timed out')), this.timeout);
    this._state('connecting');
    try {
      let selected = typeof instance === 'string' ? await this.manager.getInstance(instance, { signal }) : instance;
      current();
      if (selected.displayProvider !== 'kasm') throw new RemoteXAppNativeError('provider-mismatch', 'Native Viewer requires a Kasm runtime');
      if (!Number.isSafeInteger(selected.sessionGeneration) || selected.sessionGeneration < 0) throw new RemoteXAppNativeError('invalid-descriptor', 'Invalid session generation');
      if (!/^[a-f0-9]{64}$/.test(selected.displayComponentDigest || '')) throw new RemoteXAppNativeError('invalid-descriptor', 'Missing paired component identity');
      this.instance = selected;
      const base = `/remotexapps/${encodeURIComponent(selected.id)}/native`;
      const moduleURL = new URL(this.manager.url(`${base}/client.js`), globalThis.location.href);
      if (moduleURL.origin !== globalThis.location.origin) throw new RemoteXAppNativeError('origin', 'Native Viewer requires a same-origin Manager');
      const prepare = () => this.manager.request(`${base}/prepare`, { method:'POST', body:{ sessionGeneration:selected.sessionGeneration, componentDigest:selected.displayComponentDigest }, signal });
      let prepared;
      try { prepared = await prepare(); }
      catch (error) {
        current();
        // Two Viewers can select the same stopped on-attach session. Only an
        // ID-based initial connect may follow its one unchanged-pin activation.
        // Explicit descriptors, recovery/upgrade and repeated conflicts stay fenced.
        if (typeof instance !== 'string' || selected.sessionState !== 'stopped' || error.status !== 409) throw error;
        const fresh = await this.manager.getInstance(selected.id, {signal});
        current();
        if (fresh.id !== selected.id || fresh.displayProvider !== 'kasm' || fresh.sessionState !== 'running' ||
            fresh.sessionGeneration !== selected.sessionGeneration + 1 || fresh.displayComponentDigest !== selected.displayComponentDigest ||
            fresh.nativeClipboard !== selected.nativeClipboard || fresh.versions?.current?.core?.sha256 !== selected.versions?.current?.core?.sha256) throw error;
        selected = fresh;
        prepared = await prepare();
      }
      current();
      if (prepared.id !== selected.id || prepared.displayProvider !== 'kasm' || prepared.displayComponentDigest !== selected.displayComponentDigest || !Number.isSafeInteger(prepared.sessionGeneration) || prepared.sessionGeneration < 1) throw new RemoteXAppNativeError('invalid-descriptor', 'Invalid prepared session');
      this.instance = prepared;
      moduleURL.searchParams.set('componentDigest', prepared.displayComponentDigest);
      const { default:NativeDisplay } = await abortable(this._loadDisplay(moduleURL.href), signal);
      current();
      const socketURL = new URL(this.manager.url(`${base}/websockify`), globalThis.location.href);
      socketURL.protocol = socketURL.protocol === 'https:' ? 'wss:' : 'ws:';
      socketURL.searchParams.set('sessionGeneration', String(prepared.sessionGeneration));
      socketURL.searchParams.set('componentDigest', prepared.displayComponentDigest);
      const features = NativeDisplay.capabilities || {};
      const clipboard = prepared.nativeClipboard === 'text' && features.clipboardText === true;
      this.capabilities = Object.freeze({...this.capabilities, keyboardPolicy:features.keyboardPolicy === true,
        clipboard, clipboardMaxBytes:clipboard ? features.clipboardMaxBytes : 0});
      const display = this._display = new NativeDisplay(this.container, socketURL.href, {
        resize:prepared.effectivePolicy?.display?.allowClientResize === true, clipboard, keyboardPolicy:this._keyboardPolicy });
      display.addEventListener('clipboard', event => {
        if (epoch !== this._epoch || !this.clipboardEnabled || !clipboard) return;
        const text = event.detail?.text;
        if (typeof text !== 'string' || new TextEncoder().encode(text).length > this.capabilities.clipboardMaxBytes) return;
        this._clipboardText = text;
        this._clipboardChanged();
      });
      display.addEventListener('keyboardpolicychange', () => {
        if (epoch === this._epoch) this.dispatchEvent(new CustomEvent('keyboardpolicychange', {detail:this.keyboardPolicy}));
      });
      await new Promise((resolve, reject) => {
        let painted = false, connected = false, checking = false, poll;
        const cleanup = () => { clearTimeout(poll); signal.removeEventListener('abort', abort); display.removeEventListener('frame', frame); display.removeEventListener('connect', connect); display.removeEventListener('disconnect', disconnect); };
        const fail = error => { cleanup(); reject(error); };
        const abort = () => fail(signal.reason);
        const check = async () => {
          if (!painted || !connected || checking) return;
          checking = true;
          try {
            current();
            const actual = await this.manager.getInstance(prepared.id, { signal });
            current();
            if (actual.sessionGeneration !== prepared.sessionGeneration || actual.displayComponentDigest !== prepared.displayComponentDigest || actual.sessionState !== 'running') throw new RemoteXAppNativeError('stale-generation', 'Session changed during connection');
            const status = actual.applicationStatus;
            if (status?.generation === prepared.sessionGeneration && status.state === 'ready') {
              this.instance = actual;
              cleanup(); resolve(); return;
            }
            if (status?.state === 'error') throw new RemoteXAppNativeError('application-failed', 'Application is not ready');
            poll = setTimeout(check, 250);
          } catch (error) { fail(error); }
          finally { checking = false; }
        };
        const frame = () => { painted = true; check(); };
        const connect = () => { connected = true; check(); };
        const disconnect = () => fail(new RemoteXAppNativeError('display-disconnected', 'Display disconnected before readiness'));
        signal.addEventListener('abort', abort, { once:true });
        display.addEventListener('frame', frame);
        display.addEventListener('connect', connect);
        display.addEventListener('disconnect', disconnect);
        if (signal.aborted) abort();
      });
      current();
      display.addEventListener('disconnect', () => {
        if (epoch !== this._epoch) return;
        this.disconnect();
        this._state('disconnected', { code:'display-disconnected' });
      }, { once:true });
      this._state('ready', { generation:prepared.sessionGeneration, transport:socketURL.protocol === 'wss:' ? 'wss' : 'ws-loopback' });
      this.dispatchEvent(new CustomEvent('ready', { detail:{ instance:this.instance } }));
      return this.instance;
    } catch (cause) {
      if (epoch === this._epoch) {
        this.disconnect();
        const error = cause instanceof RemoteXAppNativeError ? cause : new RemoteXAppNativeError('connection-failed', 'Native Viewer connection failed', { cause });
        this._state('failed', { code:error.code });
        throw error;
      }
      throw cause;
    } finally { clearTimeout(timer); }
  }


  get keyboardPolicy() { return this._display?.keyboardPolicy || null; }
  configureKeyboard(settings) {
    if (this.state !== 'ready' || !this.capabilities.keyboardPolicy) throw new RemoteXAppNativeError('unsupported', 'Keyboard policy is unavailable');
    const applied = this._display.configureKeyboard(settings);
    this._keyboardPolicy = structuredClone(settings);
    return {applied};
  }
  focus() { if (this.state === 'ready') this._display?.focus?.(); }
  blur() { this._display?.blur?.(); }

  _clipboardChanged() {
    this.dispatchEvent(new CustomEvent('clipboardchange', {detail:{enabled:this.clipboardEnabled,
      available:this._clipboardText !== undefined, bytes:new TextEncoder().encode(this._clipboardText || '').length}}));
  }
  enableClipboard(enabled = true) {
    if (enabled && (this.state !== 'ready' || !this.capabilities.clipboard)) throw new RemoteXAppNativeError('unsupported', 'Native text clipboard is unavailable');
    ++this._clipboardRevision;
    this._clipboardBusy = false;
    this.clipboardEnabled = !!enabled;
    this._clipboardText = undefined;
    this._clipboardChanged();
  }
  _clipboardContext(epoch = this._epoch, grant = this._clipboardRevision) {
    if (epoch !== this._epoch || grant !== this._clipboardRevision || this.state !== 'ready' || !this.clipboardEnabled || !this.capabilities.clipboard)
      throw new RemoteXAppNativeError('clipboard-cancelled', 'Clipboard action no longer belongs to this Viewer');
    if (globalThis.document?.hidden || !globalThis.document?.hasFocus())
      throw new RemoteXAppNativeError('clipboard-focus', 'Focus this page before using clipboard');
    return this._display;
  }
  async _clipboardAction(direction) {
    const epoch = this._epoch, grant = this._clipboardRevision;
    this._clipboardContext(epoch, grant);
    if (!globalThis.navigator?.userActivation?.isActive) throw new RemoteXAppNativeError('clipboard-gesture', 'Use an explicit clipboard action');
    if (this._clipboardBusy) throw new RemoteXAppNativeError('clipboard-busy', 'Another clipboard action is pending');
    if (direction === 'download' && this._clipboardText === undefined) throw new RemoteXAppNativeError('clipboard-empty', 'Copy text inside the remote App first');
    this._clipboardBusy = true;
    let timer, startedWrite = false;
    const bounded = promise => Promise.race([promise, new Promise((_,reject) => {
      timer = setTimeout(() => reject(new RemoteXAppNativeError(startedWrite ? 'clipboard-uncertain' : 'clipboard-timeout', 'Clipboard action did not finish in time')), 5000);
    })]);
    try {
      if (direction === 'download') {
        startedWrite = true;
        await bounded(navigator.clipboard.writeText(this._clipboardText));
        try { this._clipboardContext(epoch, grant); }
        catch { throw new RemoteXAppNativeError('clipboard-uncertain', 'Local clipboard write may have completed after the Viewer changed'); }
        return {status:'copied-to-local'};
      }
      const text = direction === 'clear' ? '' : await bounded(navigator.clipboard.readText());
      const display = this._clipboardContext(epoch, grant);
      if (direction !== 'clear' && text === '') return {status:'empty-noop'};
      if (typeof text !== 'string' || !text.isWellFormed() || text.includes('\0')) throw new RemoteXAppNativeError('clipboard-format', 'Only valid plain text is supported');
      if (new TextEncoder().encode(text).length > this.capabilities.clipboardMaxBytes) throw new RemoteXAppNativeError('clipboard-size', 'Clipboard text exceeds the byte limit');
      display.sendClipboardText(text);
      return {status:'submitted'}; // Native clipboard has no application-readback ACK.
    } catch (error) {
      if (error instanceof RemoteXAppNativeError) throw error;
      throw new RemoteXAppNativeError(error?.name === 'NotAllowedError' ? 'clipboard-denied' : 'clipboard-unavailable', 'Browser clipboard action failed', {cause:error});
    } finally {
      clearTimeout(timer);
      if (epoch === this._epoch && grant === this._clipboardRevision) this._clipboardBusy = false;
    }
  }
  copyClipboardToRemote() { return this._clipboardAction('upload'); }
  copyClipboardToLocal() { return this._clipboardAction('download'); }
  clearRemoteClipboard() { return this._clipboardAction('clear'); }

  reconnect() { return this.connect(this.instance?.id); }

  disconnect() {
    ++this._epoch;
    ++this._clipboardRevision;
    this.clipboardEnabled = false;
    this._clipboardText = undefined;
    this._clipboardBusy = false;
    this._clipboardChanged();
    this._controller?.abort(new DOMException('Viewer disconnected', 'AbortError'));
    this._controller = null;
    const display = this._display;
    this._display = null;
    display?.disconnect();
    this.container.replaceChildren();
    if (!this._disposed) this._state('disconnected');
  }

  dispose() {
    if (this._disposed) return;
    this.disconnect();
    this._disposed = true;
    this._state('disposed');
  }
}
