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
  constructor({ container, manager = new RemoteXAppManager(), timeout = 90000 } = {}) {
    super();
    if (!container?.replaceChildren) throw new TypeError('container is required');
    if (!Number.isFinite(timeout) || timeout < 1 || timeout > 120000) throw new RangeError('invalid connection timeout');
    this.container = container;
    this.manager = manager;
    this.timeout = timeout;
    this.state = 'disconnected';
    this.capabilities = Object.freeze({ display:'kasm-wss-v1', pointer:true, keyboard:true,
      clipboard:false, programmaticText:false, audio:false, udp:false });
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
      const selected = typeof instance === 'string' ? await this.manager.getInstance(instance, { signal }) : instance;
      current();
      if (selected.displayProvider !== 'kasm') throw new RemoteXAppNativeError('provider-mismatch', 'Native Viewer requires a Kasm runtime');
      if (!Number.isSafeInteger(selected.sessionGeneration) || selected.sessionGeneration < 0) throw new RemoteXAppNativeError('invalid-descriptor', 'Invalid session generation');
      if (!/^[a-f0-9]{64}$/.test(selected.displayComponentDigest || '')) throw new RemoteXAppNativeError('invalid-descriptor', 'Missing paired component identity');
      this.instance = selected;
      const base = `/remotexapps/${encodeURIComponent(selected.id)}/native`;
      const moduleURL = new URL(this.manager.url(`${base}/client.js`), globalThis.location.href);
      if (moduleURL.origin !== globalThis.location.origin) throw new RemoteXAppNativeError('origin', 'Native Viewer requires a same-origin Manager');
      const prepared = await this.manager.request(`${base}/prepare`, { method:'POST', body:{ sessionGeneration:selected.sessionGeneration, componentDigest:selected.displayComponentDigest }, signal });
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
      const display = this._display = new NativeDisplay(this.container, socketURL.href, { resize:prepared.effectivePolicy?.display?.allowClientResize === true });
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

  reconnect() { return this.connect(this.instance?.id); }

  disconnect() {
    ++this._epoch;
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
