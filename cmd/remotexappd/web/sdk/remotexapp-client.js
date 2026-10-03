import { RemoteXAppManager, validateRuntimeUpgrade } from './remotexapp-manager.js';
import { RemoteXAppCoordinator } from './remotexapp-coordinator.js';
import { RemoteXAppClipboard } from './remotexapp-clipboard.js';
import { NOVNC_BUNDLE_URL } from './generated-asset-urls.js';
import { ConnectionMask } from './connection-mask.js';

const modifierCodes = new Set([
  'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight',
  'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
]);

const modifierKeysyms = [
  [0xffe1, 'ShiftLeft'], [0xffe2, 'ShiftRight'],
  [0xffe3, 'ControlLeft'], [0xffe4, 'ControlRight'],
  [0xffe9, 'AltLeft'], [0xffea, 'AltRight'],
  [0xffe7, 'MetaLeft'], [0xffe8, 'MetaRight'],
];

/** Browser-side RFB, Unicode input, lifecycle, reconnection and diagnostics client. */
export class RemoteXAppClient extends EventTarget {
  async invokeAction(action, parameters, { signal } = {}) {
    const id = this.instance?.id, generation = this.instance?.sessionGeneration, connection = this.generation;
    if (this.destroyed || this.viewOnly || !id || this.state !== 'connected') throw new Error('A writable connected runtime is required');
    const value = await this.manager.invokeAction(id, action, parameters, { sessionGeneration:generation, signal });
    if (this.destroyed || signal?.aborted || this.generation !== connection || this.instance?.id !== id || this.instance?.sessionGeneration !== generation || this.state !== 'connected') throw new Error('Runtime changed; action outcome unknown');
    return value;
  }
  constructor({
    runtime = null,
    manager = runtime?.manager || new RemoteXAppManager(),
    container,
    instance = null,
    instanceId = '',
    resize = 'class',
    resizeDebounce = 0,
    resizeMaxWait = Infinity,
    viewOnly = false,
    connectionMask = true,
    autoReconnect = true,
    reconnectDelays = [250, 500, 1000, 2000, 4000],
    maxReconnectAttempts = Infinity,
    qualityLevel = 7,
    compressionLevel = 2,
    inputEventTracing = false,
    diagnosticsEnabled = false,
    diagnosticsInterval = 1000,
    instancePollInterval = 2000,
    cursorPollInterval = 5000,
    textBatchDelay = 16,
  } = {}) {
    super();
    this.manager = manager;
    if (runtime && (runtime.manager !== manager || runtime.state !== 'tracking' || instanceId && instanceId !== runtime.instanceId || instance && instance.id !== runtime.instanceId)) throw new Error('Runtime handle does not match this Viewer');
    this.runtime = runtime;
    this.container = typeof container === 'string' ? document.querySelector(container) : container;
    if (!(this.container instanceof Element)) throw new TypeError('container must be an Element or selector');
    this.instance = instance;
    this.instanceId = instance?.id || runtime?.instanceId || instanceId;
    this.resize = resize;
    if (!Number.isFinite(resizeDebounce) || resizeDebounce < 0) {
      throw new RangeError('resizeDebounce must be a non-negative number of milliseconds');
    }
    if (resizeMaxWait !== Infinity && (!Number.isFinite(resizeMaxWait) || resizeMaxWait < resizeDebounce)) {
      throw new RangeError('resizeMaxWait must be Infinity or at least resizeDebounce milliseconds');
    }
    this.resizeDebounce = resizeDebounce;
    this.resizeMaxWait = resizeMaxWait;
    this.viewOnly = Boolean(viewOnly);
    if (typeof connectionMask !== 'boolean') throw new TypeError('connectionMask must be a boolean');
    this.connectionMask = connectionMask;
    this.autoReconnect = Boolean(autoReconnect);
    this.reconnectDelays = reconnectDelays;
    if (maxReconnectAttempts !== Infinity && (!Number.isInteger(maxReconnectAttempts) || maxReconnectAttempts < 0)) {
      throw new RangeError('maxReconnectAttempts must be Infinity or a non-negative integer');
    }
    this.maxReconnectAttempts = maxReconnectAttempts;
    this.qualityLevel = qualityLevel;
    this.compressionLevel = compressionLevel;
    this.inputEventTracing = Boolean(inputEventTracing);
    this.diagnosticsEnabled = Boolean(diagnosticsEnabled);
    this.diagnosticsInterval = diagnosticsInterval;
    this.instancePollInterval = instancePollInterval;
    this.cursorPollInterval = cursorPollInterval;
    if (!Number.isFinite(textBatchDelay) || textBatchDelay < 0 || textBatchDelay > 1000) {
      throw new RangeError('textBatchDelay must be between 0 and 1000 milliseconds');
    }
    this.textBatchDelay = textBatchDelay;

    this.state = 'idle';
    this.connectionCurtain = new ConnectionMask(this);
    this.classInfo = null;
    this.rfb = null;
    this.input = null;
    this.ime = null;
    this.KeyboardUtil = null;
    this.RFBClass = null;
    this.disableNoVNCKeyboardCapture = null;
    this.createRemoteResizeBridge = null;
    this.intentionalDisconnect = false;
    this.destroyed = false;
    this.generation = 0;
    this.reconnectCycle = 0;
    this.reconnectAttempt = 0;
    this.reconnectExhausted = false;
    this.reconnectTimer = null;
    this.stopInstanceWatcher = null;
    this.cursorTimer = null;
	this.lastCursorSequence = 0;
	this.lastCursorUpdatedMS = 0;
	this.pointerEpoch = 0;
	this.lastSessionEndedKey = '';
	this.pendingCaret = null;
	this.pointerCursorTimer = null;
	this.pointerFallbackTimer = null;
    this.diagnosticsTimer = null;
    this.resizeObserver = null;
    this.remoteResizeBridge = null;
    this.remoteResizeTimer = null;
    this.remoteResizeInitial = true;
    this.remoteResizeTarget = '';
    this.remoteResizeLastSubmitted = '';
    this.remoteResizeFirstPendingAt = 0;
    this.remoteResizeLastChangedAt = 0;
    this.remoteResizeForceFlush = false;
    this.windowListeners = [];
    this.clipboard = new RemoteXAppClipboard(this);
    this.inputOwner = false;

    this.composing = false;
    this.pendingText = '';
    this.textTimer = null;
    this.nextTextID = 0;
    this.textRequests = new Map();
    this.sentKeys = new Map();
    this.pendingModifiers = new Map();
    this.pendingModifierReleases = new Map();
    this.ignoredCodes = new Set();
    this.events = [];
    this.previousTraffic = null;
    this.diagnostics = {
      state: this.state,
      rfbState: 'idle', inputState: 'idle', reconnectAttempt: 0,
      maxReconnectAttempts: this.maxReconnectAttempts, reconnectExhausted: false,
      instance: null, class: null, cursor: null, text: null,
      framebuffer: null, viewport: null, traffic: null, events: [],
      inputEventTracing: this.inputEventTracing,
      diagnosticsEnabled: this.diagnosticsEnabled,
	  textBatchDelay: this.textBatchDelay,
      resizeDebounce: this.resizeDebounce,
      resizeMaxWait: this.resizeMaxWait,
    };
  }

  _emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  _setState(state, reason = '') {
    if (this.state === state && !reason) return;
    this.state = state;
    if (state === 'connected') this.connectionCurtain?.connected();
    if (state === 'disconnected' && !this.intentionalDisconnect && this.connectionCurtain?.phase !== 'idle') this.connectionCurtain?.fail();
    this.diagnostics.state = state;
    this.diagnostics.reason = reason;
    this._emit('statechange', { state, reason, instance: this.instance });
    this._emitDiagnostics();
    if (this.clipboard) this._updateClipboardActivity(`state-${state}`);
  }

  _absoluteURL(path) {
    return new URL(this.manager.url(path), window.location.href);
  }

  _webSocketURL(path) {
    const url = this._absoluteURL(path);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.href;
  }

  async _loadNoVNC() {
    if (this.RFBClass && this.KeyboardUtil && this.disableNoVNCKeyboardCapture && this.createRemoteResizeBridge) return;
    const module = await import(this._absoluteURL(NOVNC_BUNDLE_URL).href);
    this.RFBClass = module.RFB;
    this.KeyboardUtil = module.KeyboardUtil;
    this.disableNoVNCKeyboardCapture = module.disableKeyboardCapture;
    this.createRemoteResizeBridge = module.createRemoteResizeBridge;
    this.observePaintedFrame = module.observePaintedFrame;
  }

  _setupDOM() {
    if (this.ime) return;
    const style = getComputedStyle(this.container);
    if (style.position === 'static') this.container.style.position = 'relative';
    this.container.style.overflow = 'hidden';
    this.container.style.touchAction = 'none';
    this.ime = document.createElement('textarea');
    this.ime.setAttribute('aria-label', 'Remote application text input');
    this.ime.setAttribute('autocomplete', 'off');
    this.ime.setAttribute('autocapitalize', 'off');
    this.ime.setAttribute('spellcheck', 'false');
    Object.assign(this.ime.style, {
      position: 'fixed', left: '8px', top: '8px', width: '2px', height: '2px',
      minWidth: '0', minHeight: '0', padding: '0', border: '0', margin: '0',
      resize: 'none', opacity: '.01', color: 'transparent', background: 'transparent',
      caretColor: 'transparent', pointerEvents: 'none', zIndex: '2',
    });
    this.container.append(this.ime);
    this._bindInputEvents();
    this._listen(this.container, 'pointerdown', event => this._handlePointerDown(event), true);
    this._listen(document, 'pointerdown', event => {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      if (event.target !== this.container && !this.container.contains?.(event.target) && !path.includes(this.container)) {
        this._setInputOwner(false, 'outside-pointer');
      }
    }, true);
    this._listen(document, 'focusin', event => {
      if (event.target !== this.ime && event.target !== this.container && !this.container.contains?.(event.target)) {
        this._setInputOwner(false, 'focus-moved');
      }
    }, true);
    this._listen(window, 'focus', () => this._updateClipboardActivity('window-focus'));
    this._listen(window, 'blur', () => {
      this._trace('window-blur');
      this._releaseRemoteModifiers();
      this._updateClipboardActivity('window-blur');
    });
    this._listen(document, 'visibilitychange', () => {
      if (document.hidden) { this._trace('document-hidden'); this._releaseRemoteModifiers(); }
      this._updateClipboardActivity(document.hidden ? 'document-hidden' : 'document-visible');
    });
    this.resizeObserver = new ResizeObserver(() => this._updateDisplayDiagnostics());
    this.resizeObserver.observe(this.container);
  }

  _handlePointerDown(event) {
    if (this.connectionCurtain?.visible) return;
    if (event.isPrimary !== false) this._setInputOwner(true, 'viewer-pointer');
    if (this.viewOnly || event.button !== 0 || event.isPrimary === false) return;
    this._clearPendingCaret();
    const epoch = ++this.pointerEpoch;
    const clientPosition = this._placeIME(event.clientX, event.clientY);
    this.pendingCaret = {
      epoch, baselineUpdatedMS:this.lastCursorUpdatedMS, startedAt:performance.now(),
      keyboardActivity:false, fallbackActive:false,
    };
    const refocused = this._refreshIMEAnchor('ime-refocus-primary-pointer');
    this.diagnostics.cursor = {
      ...(this.diagnostics.cursor || {}), positionSource:'click-fallback',
      freshForPointer:false, clientPosition, refocused, latencyMs:0,
    };
    this._trace('pointer-focus');
    // Push is primary. These bounded requests recover from a missed event or
    // an IBus context that did not emit a location change for this click.
    this.pointerCursorTimer = setTimeout(() => {
      this.pointerCursorTimer = null;
      if (this.pendingCaret?.epoch === epoch) this._requestCursor();
    }, 250);
    this.pointerFallbackTimer = setTimeout(() => {
      this.pointerFallbackTimer = null;
      if (this.pendingCaret?.epoch !== epoch) return;
      this.pendingCaret.fallbackActive = true;
      this.diagnostics.cursor = {
        ...(this.diagnostics.cursor || {}), positionSource:'click-fallback',
        freshForPointer:false, latencyMs:performance.now()-this.pendingCaret.startedAt,
      };
      this._emitDiagnostics();
    }, 750);
  }

  _refreshIMEAnchor(traceKind, { keyboardActivity = false } = {}) {
    if (!this.ime || this.composing || keyboardActivity || this.pendingText || this.textRequests.size > 0) return false;
    this.ime.getBoundingClientRect();
    if (document.activeElement === this.ime) this.ime.blur();
    this.ime.focus({ preventScroll:true });
    this._trace(traceKind);
    return true;
  }

  _clearPendingCaret() {
    clearTimeout(this.pointerCursorTimer);
    clearTimeout(this.pointerFallbackTimer);
    this.pointerCursorTimer = null;
    this.pointerFallbackTimer = null;
    this.pendingCaret = null;
  }

  _listen(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    this.windowListeners.push(() => target.removeEventListener(type, listener, options));
  }

  _documentAcceptsInput() {
    const focused = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
    return focused && !document.hidden;
  }

  _setInputOwner(value, reason = 'client-focus') {
    const owner = Boolean(value) && !this.viewOnly;
    if (owner === this.inputOwner) {
      this._updateClipboardActivity(reason);
      return;
    }
    this.inputOwner = owner;
    this._updateClipboardActivity(reason);
  }

  _updateClipboardActivity(reason = 'client-focus') {
    const active = this.inputOwner && this.state === 'connected' && this._documentAcceptsInput();
    this.clipboard._setInputActive(active, { reason });
  }

  _focusInput({ activateClipboard = false, onlyIfUnfocused = false } = {}) {
    if (this.connectionCurtain?.visible) return;
    if (this.viewOnly || !this.ime) return;
    if (onlyIfUnfocused && document.activeElement && document.activeElement !== document.body && document.activeElement !== this.ime) return;
    this.ime.focus({ preventScroll:true });
    if (activateClipboard) this._setInputOwner(true, 'client-focus');
  }

  async connect(instance = this.instance || this.instanceId) {
    if (this.destroyed) throw new Error('RemoteXAppClient has been destroyed');
    if (this.runtime && this.runtime.state !== 'tracking') throw new Error('Runtime handle is no longer tracking; acquire a new handle and Viewer');
    if (!instance) throw new TypeError('instance or instanceId is required');
    const request = this.connectionRequest = (this.connectionRequest || 0) + 1;
    const current = () => {
      if (request !== this.connectionRequest || this.intentionalDisconnect || this.destroyed) throw new DOMException('Connection cancelled or replaced', 'AbortError');
    };
    this.intentionalDisconnect = false;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this._resetReconnectBudget();
    this._setState('connecting');
    this.connectionCurtain.begin();
    try {
      const selected = typeof instance === 'string' ? await this.manager.getInstance(instance) : instance;
      current();
      this.instance = selected;
      this.instanceId = selected.id;
      if (selected.state !== 'server-ready' && selected.state !== 'ready') {
        throw new Error(`Instance ${this.instanceId} is not ready (${selected.state})`);
      }
      const classInfo = await this.manager.getClass(selected.classId);
      current(); this.classInfo = classInfo;
      await this._loadNoVNC();
      current(); this._setupDOM();
      this.diagnostics.instance = structuredClone(this.instance);
      this.diagnostics.class = structuredClone(this.classInfo);
      this._startInstanceWatcher();
      return await this._connectChannels();
    } catch (error) {
      if (request === this.connectionRequest && !this.intentionalDisconnect && !this.destroyed) this.connectionCurtain.fail('The connection could not be established. Try again.');
      throw error;
    }
  }

  /** Create an instance and connect it immediately as one race-free operation. */
  async launch({ templateId, classId, profileRef, parameters, overrides } = {}) {
    const instance = await this.manager.createInstance({ templateId, classId, profileRef, parameters, overrides });
    this._emit('instancelaunch', { instance });
    return this.connect(instance);
  }

  /** Stop the old runtime, create a new instance of the same class/profile, and connect. */
  async relaunch({ templateId, classId = this.instance?.classId, profileRef = this.instance?.profileRef, parameters = this.instance?.parameters, overrides } = {}) {
    if (!templateId && !classId) throw new TypeError('templateId or classId is required');
    if (this.instance && this.instance.state !== 'stopped' && this.instance.state !== 'failed') await this.stopInstance();
    return this.launch({ templateId, classId, profileRef, parameters, overrides });
  }

  async _connectChannels() {
    if (this.runtime && this.runtime.state !== 'tracking') throw new Error('Runtime handle is no longer tracking; acquire a new handle and Viewer');
    const generation = ++this.generation;
	this._clearPendingText();
    this._rejectTextRequests(new Error('Connection replaced'));
    this._closeChannels();
    this.connectionCurtain.begin(this.reconnectAttempt > 0 || this.state !== 'connecting');
    // Cursor sequence numbers belong to one input-gateway connection. A
    // restarted gateway/IBus engine begins again at sequence 1, so retaining
    // the previous connection's high-water mark would discard every new push.
    this.lastCursorSequence = 0;
    this.lastCursorUpdatedMS = 0;
    this._clearPendingCaret();
    this.pointerEpoch++;
    const base = `/remotexapps/${encodeURIComponent(this.instanceId)}`;
    const resolvedResize = this.instance?.effectivePolicy?.display?.allowClientResize;
    const resizeAllowed = resolvedResize ?? this.classInfo?.display.allowClientResize;
    const remoteResize = resizeAllowed !== false && (this.resize === 'remote' || (this.resize === 'class' && resizeAllowed));
    const scheduledRemoteResize = remoteResize && this.resizeDebounce > 0;
    this.diagnostics.rfbState = 'connecting';
    this.diagnostics.inputState = 'connecting';
    this._emitDiagnostics();

    const rfbReady = new Promise((resolve, reject) => {
      const rfb = new this.RFBClass(this.container, this._webSocketURL(`${base}/rfb-compat`), { credentials: {} });
      this.rfb = rfb;
      if (this.observePaintedFrame) this.stopFrameObserver = this.observePaintedFrame(rfb, () => {
        if (generation === this.generation && this.rfb === rfb) this.connectionCurtain.frame();
      });
      rfb.viewOnly = this.viewOnly;
      rfb.focusOnClick = false;
      if (scheduledRemoteResize) {
        let bridge;
        bridge = this.createRemoteResizeBridge(rfb, () => this._remoteResizeRequested(generation, rfb, bridge));
        this.remoteResizeBridge = bridge;
        this.remoteResizeInitial = true;
      }
      rfb.scaleViewport = !remoteResize || scheduledRemoteResize;
      rfb.resizeSession = remoteResize;
      rfb.qualityLevel = this.qualityLevel;
      rfb.compressionLevel = this.compressionLevel;
      rfb.addEventListener('connect', () => {
        if (generation !== this.generation) return;
        // noVNC must not consume composing keyboard events before the IME host.
        this.disableNoVNCKeyboardCapture(rfb);
        this._releaseRemoteModifiers();
        this._focusInput({ onlyIfUnfocused:true });
        this.diagnostics.rfbState = 'connected';
        this._trace('rfb-connect');
        this._updateDisplayDiagnostics();
        resolve(this);
      }, { once: true });
      rfb.addEventListener('disconnect', event => {
        if (generation !== this.generation) return;
        this.diagnostics.rfbState = event.detail.clean ? 'disconnected' : 'connection lost';
        if (this.state === 'connecting') reject(new Error('RFB disconnected before connection completed'));
        this._channelFailed(event.detail.clean ? 'RFB disconnected' : 'RFB connection lost');
      });
      rfb.addEventListener('credentialsrequired', () => {
        const error = new Error('Unexpected RFB credentials request');
        this._emit('error', { error });
        reject(error);
      });
      rfb.addEventListener('securityfailure', event => {
        const error = new Error(event.detail.reason || 'RFB security failure');
        this._emit('error', { error });
        reject(error);
      });
    });

    const inputReady = new Promise((resolve, reject) => {
      const inputURL = new URL(this._webSocketURL(`${base}/input`));
      inputURL.searchParams.set('viewerId', this.clipboard.viewerId);
      const input = new WebSocket(inputURL.href);
      this.input = input;
      input.addEventListener('open', () => {
        if (generation !== this.generation) return;
        this.diagnostics.inputState = 'connected';
        if (!this.viewOnly) this._requestCursor();
        this._emitDiagnostics();
        resolve();
      }, { once: true });
      input.addEventListener('message', event => this._handleInputMessage(event));
      input.addEventListener('error', () => {
        const error = new Error('Input WebSocket failed');
        this._emit('error', { error });
        if (this.state === 'connecting') reject(error);
      });
      input.addEventListener('close', () => {
        if (generation !== this.generation) return;
        this.diagnostics.inputState = 'disconnected';
        this._channelFailed('Input channel disconnected');
      });
    });
    this._startTimers();
    await Promise.all([rfbReady, inputReady]);
    if (generation === this.generation) {
      if (typeof this.manager.getInstance === 'function') {
        const latest = await this.manager.getInstance(this.instanceId);
        if (generation !== this.generation || this.intentionalDisconnect || this.destroyed) return this;
        this.instance = latest;
        this.diagnostics.instance = structuredClone(this.instance);
      }
      if (this.instance?.sessionGeneration > 0 && typeof this.manager.getClipboardCapabilities === 'function') {
        await this.clipboard._connected();
      }
      if (generation !== this.generation || this.intentionalDisconnect || this.destroyed) return this;
      this._resetReconnectBudget();
      this._setState('connected');
    }
    return this;
  }

  _remoteResizeKey(state) {
    return `${state.width}x${state.height}`;
  }

  _remoteResizeRequested(generation, rfb, bridge) {
    if (generation !== this.generation || rfb !== this.rfb || bridge !== this.remoteResizeBridge) return;
    const state = bridge.snapshot();
    if (!state.enabled || !state.supported) {
      bridge.request();
      return;
    }
    if (this.remoteResizeInitial) {
      this.remoteResizeInitial = false;
      if (state.needsResize) this.remoteResizeLastSubmitted = this._remoteResizeKey(state);
      bridge.request();
      return;
    }
    this._captureRemoteResize(state);
  }

  _captureRemoteResize(state, { force = false } = {}) {
    if (!state.enabled || !state.supported || !state.needsResize) {
      this._clearRemoteResizePending();
      return false;
    }
    const key = this._remoteResizeKey(state);
    if (state.pending && key === this.remoteResizeLastSubmitted && !this.remoteResizeTarget) return false;
    const now = Date.now();
    if (key !== this.remoteResizeTarget) {
      this.remoteResizeTarget = key;
      if (!this.remoteResizeFirstPendingAt) this.remoteResizeFirstPendingAt = now;
      this.remoteResizeLastChangedAt = now;
    } else if (!this.remoteResizeFirstPendingAt) {
      this.remoteResizeFirstPendingAt = now;
      this.remoteResizeLastChangedAt = now;
    }
    if (force) this.remoteResizeForceFlush = true;
    this._armRemoteResize(state);
    return true;
  }

  _remoteResizeDueAt() {
    if (this.remoteResizeForceFlush) return Date.now();
    const quietAt = this.remoteResizeLastChangedAt + this.resizeDebounce;
    const maximumAt = this.resizeMaxWait === Infinity
      ? Infinity
      : this.remoteResizeFirstPendingAt + this.resizeMaxWait;
    return Math.min(quietAt, maximumAt);
  }

  _armRemoteResize(state = this.remoteResizeBridge?.snapshot()) {
    clearTimeout(this.remoteResizeTimer);
    this.remoteResizeTimer = null;
    if (!state || state.pending || !this.remoteResizeTarget) return;
    const dueAt = Math.max(this._remoteResizeDueAt(), state.earliestAt);
    this.remoteResizeTimer = setTimeout(() => {
      this.remoteResizeTimer = null;
      this._flushRemoteResize();
    }, Math.max(0, dueAt - Date.now()));
  }

  _flushRemoteResize() {
    const bridge = this.remoteResizeBridge;
    if (!bridge) return false;
    const state = bridge.snapshot();
    if (!state.enabled || !state.supported || !state.needsResize) {
      this._clearRemoteResizePending();
      return false;
    }
    const key = this._remoteResizeKey(state);
    if (key !== this.remoteResizeTarget) {
      const force = this.remoteResizeForceFlush;
      this._captureRemoteResize(state, { force });
      return false;
    }
    if (state.pending) return false;
    const dueAt = Math.max(this._remoteResizeDueAt(), state.earliestAt);
    if (Date.now() < dueAt) {
      this._armRemoteResize(state);
      return false;
    }
    bridge.request();
    this.remoteResizeLastSubmitted = key;
    this._clearRemoteResizePending();
    return true;
  }

  flushResize() {
    const bridge = this.remoteResizeBridge;
    if (!bridge) return false;
    return this._captureRemoteResize(bridge.snapshot(), { force:true });
  }

  _clearRemoteResizePending() {
    clearTimeout(this.remoteResizeTimer);
    this.remoteResizeTimer = null;
    this.remoteResizeTarget = '';
    this.remoteResizeFirstPendingAt = 0;
    this.remoteResizeLastChangedAt = 0;
    this.remoteResizeForceFlush = false;
  }

  _disposeRemoteResizeScheduling() {
    this._clearRemoteResizePending();
    this.remoteResizeBridge?.dispose();
    this.remoteResizeBridge = null;
    this.remoteResizeInitial = true;
    this.remoteResizeLastSubmitted = '';
  }

  _channelFailed(reason) {
    this._clearPendingText();
    this._emitDiagnostics();
    if (this.intentionalDisconnect || this.destroyed) return;
    this._setState('disconnected', reason);
    if (!this.autoReconnect || this.reconnectTimer || this.reconnectExhausted) return;
    if (this.reconnectAttempt >= this.maxReconnectAttempts) {
      this._exhaustReconnect(reason);
      return;
    }
    const delay = this.reconnectDelays[Math.min(this.reconnectAttempt, this.reconnectDelays.length - 1)] ?? 1000;
    this.reconnectAttempt++;
    this.diagnostics.reconnectAttempt = this.reconnectAttempt;
    const reconnectCycle = this.reconnectCycle;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        this.instance = await this.manager.getInstance(this.instanceId);
        if (reconnectCycle !== this.reconnectCycle || this.intentionalDisconnect || this.destroyed) return;
        if (this._handleTerminalInstance(this.instance)) return;
        if (this.instance.state !== 'server-ready' && this.instance.state !== 'ready') {
          throw new Error(`Instance is ${this.instance.state}`);
        }
        await this._connectChannels();
      } catch (error) {
        if (reconnectCycle !== this.reconnectCycle || this.intentionalDisconnect || this.destroyed) return;
        this._emit('error', { error });
        this._channelFailed(error.message);
      }
    }, delay);
    this._emit('reconnecting', { attempt: this.reconnectAttempt, delay, reason });
  }

  _resetReconnectBudget() {
    this.reconnectCycle++;
    this.reconnectAttempt = 0;
    this.reconnectExhausted = false;
    this.diagnostics.reconnectAttempt = 0;
    this.diagnostics.reconnectExhausted = false;
  }

  _exhaustReconnect(reason) {
    if (this.reconnectExhausted) return;
    this.reconnectExhausted = true;
    this.diagnostics.reconnectExhausted = true;
    this.reconnectCycle++;
    this.generation++;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this._closeChannels();
    this._stopTimers();
    this._clearPendingText();
    this._rejectTextRequests(new Error('Automatic reconnect attempts exhausted'));
    this._emit('reconnectexhausted', {
      attempts: this.reconnectAttempt,
      maxReconnectAttempts: this.maxReconnectAttempts,
      reason,
    });
    this._emitDiagnostics();
  }

  async reconnect() {
    if (this.runtime && this.runtime.state !== 'tracking') throw new Error('Runtime handle is no longer tracking; acquire a new handle and Viewer');
    this.intentionalDisconnect = false;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this._resetReconnectBudget();
    this._setState('connecting', 'manual reconnect');
    return this._connectChannels();
  }

  disconnect() {
    this.intentionalDisconnect = true;
    this.connectionRequest = (this.connectionRequest || 0) + 1;
    this.connectionCurtain?.disconnect();
    this.reconnectCycle++;
    this.generation++;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this._releaseRemoteModifiers();
    this._closeChannels();
    this._stopTimers();
	this._clearPendingText();
    this._rejectTextRequests(new Error('Client disconnected'));
    this._setInputOwner(false, 'client-disconnect');
    this.clipboard._disconnected({ reset:true });
    this._setState('disconnected', 'client disconnect');
  }

  _closeChannels() {
    this.stopFrameObserver?.();
    this.stopFrameObserver = null;
    this._clearPendingCaret();
    this._disposeRemoteResizeScheduling();
    if (this.input) {
      const input = this.input;
      this.input = null;
      try { input.close(); } catch (_) {}
    }
    if (this.rfb) {
      const rfb = this.rfb;
      this.rfb = null;
      try { rfb.disconnect(); } catch (_) {}
    }
  }

  focus() {
    if (this.connectionCurtain?.visible) return;
    this._focusInput({ activateClipboard:true });
  }

  setConnectionMaskEnabled(enabled) {
    this.connectionCurtain.setEnabled(enabled);
    this.connectionMask = enabled;
  }

  blur() {
    if (this.ime && document.activeElement === this.ime) this.ime.blur();
    this._setInputOwner(false, 'client-blur');
  }

  setViewOnly(value) {
    const changed = this.viewOnly !== Boolean(value);
    this.viewOnly = Boolean(value);
    if (this.viewOnly) this._setInputOwner(false, 'view-only');
    this.clipboard.configure(this.clipboard.config);
    if (this.rfb) this.rfb.viewOnly = this.viewOnly;
    this._emitDiagnostics();
    return changed && this.state === 'connected' ? this.reconnect() : Promise.resolve(this);
  }

  sendKey(keysym, code = '', down = true) {
    if (this.viewOnly || !this.rfb) return false;
    this.rfb.sendKey(keysym, code, down);
    return true;
  }

  /**
   * Submit text through the Unicode/IBus channel, not physical keystrokes.
   * Not supported for password fields or other widgets requiring direct
   * keyboard input. Use physical keyboard input or sendKey() over RFB there;
   * callers must map supported keys and send both key-down and key-up events.
   * A resolved request acknowledges the engine commit, not application insertion.
   * Do not automatically retry through another input path: text may be duplicated
   * or delivered to the wrong field when the remote input context is stale.
   */
  sendText(value) {
    if (this.viewOnly || !value) return Promise.reject(new Error('Text input is unavailable'));
    const id = ++this.nextTextID;
    const promise = new Promise((resolve, reject) => this.textRequests.set(id, { value, sentAt: performance.now(), resolve, reject }));
    if (!this._sendInput({ type: 'text', id, value })) {
      this.textRequests.delete(id);
      return Promise.reject(new Error('Input WebSocket is not open'));
    }
    return promise;
  }

  async upgradeAndRestart({ sessionGeneration = this.instance?.sessionGeneration, targetRevision, force = false, signal } = {}) {
    if (this.destroyed || this.viewOnly || !this.instanceId) throw new Error('Runtime upgrade is unavailable');
    if (this.upgradePending) throw new Error('Runtime upgrade is already pending');
    if (signal?.aborted) throw signal.reason || new Error('Runtime upgrade cancelled');
    validateRuntimeUpgrade(sessionGeneration, targetRevision);
    this.upgradePending = true;
    const id = this.instanceId;
    const clipboardConfig = { ...this.clipboard.config };
    this.disconnect();
    const generation = this.generation;
    try {
      const instance = await this.manager.upgradeAndRestartInstance(id, { sessionGeneration, targetRevision, force, signal });
      // A later disconnect/destroy/connect supersedes this pending operation.
      if (this.destroyed || signal?.aborted || this.generation !== generation || this.instanceId !== id) return instance;
      this.instance = instance;
      this.manager.classCache = null;
      this.diagnostics.instance = structuredClone(instance);
      this._emit('instancechange', { instance });
      await this.connect(instance);
      if (!this.destroyed && !this.intentionalDisconnect) this.clipboard.configure(clipboardConfig);
      return instance;
    } finally {
      // On failure stay disconnected. Inspect getRuntimeVersions()/getInstance()
      // before deciding whether to connect; never resubmit the upgrade implicitly.
      this.upgradePending = false;
    }
  }

  async stopInstance() {
    if (!this.instanceId) return null;
    this.intentionalDisconnect = true;
    let result;
    try {
      result = await this.manager.stopInstance(this.instanceId);
    } catch (error) {
      this.intentionalDisconnect = false;
      throw error;
    }
    this.disconnect();
    this.instance = result;
    this.diagnostics.instance = structuredClone(result);
    this._emit('instancechange', { instance: result });
    return result;
  }

  renewIdleLease({ signal } = {}) {
    if (this.destroyed || !this.instanceId || !Number.isSafeInteger(this.instance?.sessionGeneration)) return Promise.reject(new Error('Runtime identity is unavailable'));
    return this.manager.renewIdleLease(this.instanceId, { sessionGeneration:this.instance.sessionGeneration, signal });
  }

  startIdleLease() {
    if (this.destroyed || !this.instanceId || !Number.isSafeInteger(this.instance?.sessionGeneration)) return Promise.reject(new Error('Runtime identity is unavailable'));
    if (this.idleLeaseHandle?.state === 'tracking') return this.idleLeaseHandle.ready;
    this.stopIdleLease();
    const owner = this.runtime?.owner || (this.idleLeaseCoordinator = new RemoteXAppCoordinator({ manager:this.manager, scope:'viewer-owned', crossTabs:false }));
    this.idleLeaseHandle = owner.track(this.instanceId, { sessionGeneration:this.instance.sessionGeneration, keepAlive:true });
    return this.idleLeaseHandle.ready;
  }

  stopIdleLease() {
    this.idleLeaseHandle?.release();
    this.idleLeaseHandle = null;
    this.idleLeaseCoordinator?.destroy();
    this.idleLeaseCoordinator = null;
  }

  getDiagnostics() {
    return structuredClone(this.diagnostics);
  }

  async setDiagnosticsEnabled(value) {
    const enabled = Boolean(value);
    if (this.diagnosticsEnabled === enabled) return this.getDiagnostics();
    this.diagnosticsEnabled = enabled;
    this.diagnostics.diagnosticsEnabled = enabled;
    clearInterval(this.diagnosticsTimer);
    this.diagnosticsTimer = null;
    this.previousTraffic = null;
    if (!enabled) return this.getDiagnostics();
    if (this.instanceId) {
      this._startDiagnosticsTimer();
      return this.refreshDiagnostics();
    }
    this._emitDiagnostics();
    return this.getDiagnostics();
  }

  async refreshDiagnostics() {
    await this._pollDiagnostics({ emit: this.diagnosticsEnabled });
    return this.getDiagnostics();
  }

  destroy() {
    if (this.destroyed) return;
    this.stopIdleLease();
    this.disconnect();
    this.destroyed = true;
    this.stopInstanceWatcher?.();
    this.stopInstanceWatcher = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    for (const remove of this.windowListeners.splice(0)) remove();
    this.ime?.remove();
    this.ime = null;
    this.clipboard.destroy();
    this.connectionCurtain.destroy();
    this.container.replaceChildren();
    this._setState('destroyed');
  }

  _bindInputEvents() {
    this._listen(this.ime, 'compositionstart', event => {
      this._setInputOwner(true, 'composition-input');
      this.composing = true;
	  if (this.pendingCaret) this.pendingCaret.keyboardActivity = true;
      this._releaseRemoteModifiers();
      this._trace('compositionstart', event);
      this._updateIME('composing');
    });
    this._listen(this.ime, 'compositionend', event => {
      this.composing = false;
      this._trace('compositionend', event);
      const committed = event.data || this.ime.value;
      this.ime.value = '';
	  // A compositionend value is already a complete IME transaction. Append
	  // it after any older ordinary input and flush both immediately.
	  if (committed) this._queueText(committed, { immediate:true });
      this._updateIME(committed ? `committed ${committed.length} characters` : 'idle');
    });
    this._listen(this.ime, 'input', event => {
      this._setInputOwner(true, 'text-input');
      this._trace('input', event);
      if (event.isComposing || this.composing) return;
      const value = this.ime.value;
      this.ime.value = '';
      if (value) this._queueText(value);
    });
    this._listen(this.ime, 'keydown', event => this._keyDown(event));
    this._listen(this.ime, 'keyup', event => this._keyUp(event));
    this._listen(this.ime, 'beforeinput', event => this._trace('beforeinput', event));
    this._listen(this.ime, 'focus', event => this._trace('ime-focus', event));
    this._listen(this.ime, 'blur', event => this._trace('ime-blur', event));
  }

  _keyDown(event) {
    if (this.connectionCurtain?.visible) return;
    this._setInputOwner(true, 'keyboard-input');
	if (this.pendingCaret) this.pendingCaret.keyboardActivity = true;
    this._trace('keydown', event);
    const code = this.KeyboardUtil.getKeycode(event);
    this._reconcileRemoteModifiers(event);
    if (this.composing || event.isComposing || event.key === 'Process' || event.key === 'Dead' || event.keyCode === 229) {
      this.ignoredCodes.add(code);
      return;
    }
	// Preserve native keyboard semantics for physical ASCII keys. Preventing
	// the keydown default is essential: otherwise the hidden textarea would
	// emit the same character through input and duplicate it over IBus.
	// Non-ASCII characters remain browser text and are committed over IBus.
	const characters = [...event.key];
	const plainTextKey = characters.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey;
	const codePoint = plainTextKey ? characters[0].codePointAt(0) : -1;
	const rfbASCII = codePoint >= 0x20 && codePoint <= 0x7e;
	if (plainTextKey && !rfbASCII) return;
    const keysym = this.KeyboardUtil.getKeysym(event);
    if (!keysym || code === 'Unidentified') return;
    this.sentKeys.set(code, keysym);
    this._sendNativeKey(keysym, code, true);
    event.preventDefault();
  }

  _keyUp(event) {
    if (this.connectionCurtain?.visible) return;
    this._trace('keyup', event);
    const code = this.KeyboardUtil.getKeycode(event);
    if (this.ignoredCodes.delete(code)) return;
    const keysym = this.sentKeys.get(code);
    if (!keysym) return;
    this.sentKeys.delete(code);
    this._sendNativeKey(keysym, code, false);
    event.preventDefault();
  }

  _sendRFBKey(keysym, code, down) {
    if (keysym && this.rfb && !this.viewOnly) this.rfb.sendKey(keysym, code, down);
  }

  _sendNativeKey(keysym, code, down) {
    if (modifierCodes.has(code)) {
      if (down) this.pendingModifiers.set(code, keysym);
      else if (this.pendingModifiers.delete(code)) return;
      else if ([...this.sentKeys.keys()].some(item => !modifierCodes.has(item))) this.pendingModifierReleases.set(code, keysym);
      else this._sendRFBKey(keysym, code, false);
      return;
    }
    if (down) {
      for (const [modifierCode, modifierKeysym] of this.pendingModifiers) this._sendRFBKey(modifierKeysym, modifierCode, true);
      this.pendingModifiers.clear();
    }
    this._sendRFBKey(keysym, code, down);
    if (!down && ![...this.sentKeys.keys()].some(item => !modifierCodes.has(item))) {
      for (const [modifierCode, modifierKeysym] of this.pendingModifierReleases) this._sendRFBKey(modifierKeysym, modifierCode, false);
      this.pendingModifierReleases.clear();
    }
  }

  _releaseRemoteModifiers() {
    this.pendingModifiers.clear();
    this.pendingModifierReleases.clear();
    for (const [keysym, code] of modifierKeysyms) {
      this.sentKeys.delete(code);
      this._sendRFBKey(keysym, code, false);
    }
  }

  _reconcileRemoteModifiers(event) {
    const groups = [
      [event.shiftKey, modifierKeysyms.slice(0, 2)], [event.ctrlKey, modifierKeysyms.slice(2, 4)],
      [event.altKey, modifierKeysyms.slice(4, 6)], [event.metaKey, modifierKeysyms.slice(6, 8)],
    ];
    for (const [active, modifiers] of groups) {
      if (active) continue;
      for (const [fallbackKeysym, code] of modifiers) {
        const wasPending = this.pendingModifiers.delete(code);
        this.pendingModifierReleases.delete(code);
        const tracked = this.sentKeys.get(code);
        this.sentKeys.delete(code);
        if (tracked && !wasPending) this._sendRFBKey(tracked || fallbackKeysym, code, false);
      }
    }
  }

  _queueText(value, { immediate = false } = {}) {
    if (this.connectionCurtain?.visible) return;
    this.pendingText += value;
    clearTimeout(this.textTimer);
	this.textTimer = null;
	if (immediate || this.textBatchDelay === 0) {
	  this._flushText();
	  return;
	}
    this.textTimer = setTimeout(() => {
	  this.textTimer = null;
	  this._flushText();
	}, this.textBatchDelay);
  }

  _flushText() {
	clearTimeout(this.textTimer);
	this.textTimer = null;
	const text = this.pendingText;
	this.pendingText = '';
	if (text) this.sendText(text).catch(error => this._emit('error', { error }));
  }

  _clearPendingText() {
	clearTimeout(this.textTimer);
	this.textTimer = null;
	this.pendingText = '';
  }

  _sendInput(message) {
    if (!this.input || this.input.readyState !== WebSocket.OPEN) return false;
    this.input.send(JSON.stringify(message));
    return true;
  }

  _requestCursor() {
    if (!this.viewOnly) this._sendInput({ type: 'cursor' });
  }

  _handleInputMessage(event) {
    let message;
    try { message = JSON.parse(event.data); } catch (_) { return; }
    if (this.clipboard._handleMessage(message)) return;
    if (message.type === 'cursor-position') {
	  const sequence = Number(message.sequence) || 0;
	  const updatedMS = Number(message.updatedMs) || 0;
	  if (sequence && sequence < this.lastCursorSequence) return;
	  this.lastCursorSequence = Math.max(this.lastCursorSequence, sequence);
	  this.lastCursorUpdatedMS = Math.max(this.lastCursorUpdatedMS, updatedMS);
	  const pending = this.pendingCaret;
	  const freshForPointer = Boolean(pending && updatedMS > pending.baselineUpdatedMS);
	  let positionSource = 'remote-caret';
	  let clientPosition = null;
	  let refocused = false;
	  if (message.focused && message.enabled && message.cursor && (!pending || freshForPointer)) {
		clientPosition = this._placeIMEAtRemoteCursor(message.cursor);
		if (freshForPointer) {
		  refocused = this._refreshIMEAnchor('ime-refocus-remote-caret', {
			keyboardActivity:pending.keyboardActivity,
		  });
		  this._clearPendingCaret();
		}
	  } else if (pending) {
		positionSource = pending.fallbackActive ? 'click-fallback' : 'awaiting-fresh-remote-caret';
	  } else if (!message.cursor) {
		positionSource = 'remote-caret-unavailable';
	  }
	  const diagnostic = {
		...message, freshForPointer, positionSource, clientPosition, refocused,
		latencyMs:freshForPointer ? performance.now()-pending.startedAt : null,
	  };
	  this.diagnostics.cursor = diagnostic;
	  this._emit('cursorchange', { cursor: diagnostic });
      this._emitDiagnostics();
      return;
    }
    if (message.type !== 'text-ack') return;
    const request = this.textRequests.get(message.id);
    if (!request) return;
    this.textRequests.delete(message.id);
    const roundTripMs = performance.now() - request.sentAt;
    const detail = { id: message.id, value: request.value, serverMs: message.serverMs, roundTripMs, error: message.error || '' };
    this.diagnostics.text = detail;
    this._emit('textack', detail);
    this._emitDiagnostics();
    if (message.error) request.reject(new Error(message.error));
    else request.resolve(detail);
  }

  _rejectTextRequests(error) {
    for (const request of this.textRequests.values()) request.reject(error);
    this.textRequests.clear();
  }

  _placeIME(left, top, height = 2) {
	if (!this.ime) return null;
	const position = {
	  left:Math.max(2, Math.min(window.innerWidth - 4, left)),
	  top:Math.max(2, Math.min(window.innerHeight - 4, top)),
	  height:Math.max(2, height),
	};
	this.ime.style.left = `${position.left}px`;
	this.ime.style.top = `${position.top}px`;
	this.ime.style.height = `${position.height}px`;
	return position;
  }

  _placeIMEAtRemoteCursor(cursor) {
    const canvas = this.container.querySelector('canvas');
	if (!canvas || canvas.width < 1 || canvas.height < 1) return null;
    const bounds = canvas.getBoundingClientRect();
	return this._placeIME(bounds.left + cursor.x * bounds.width / canvas.width, bounds.top + cursor.y * bounds.height / canvas.height, cursor.height * bounds.height / canvas.height);
  }

  _updateIME(state) {
    this.diagnostics.imeState = state;
    this._emitDiagnostics();
  }

  _trace(kind, event = null) {
    if (!this.inputEventTracing) return;
    const fields = [kind, `active=${document.activeElement === this.ime ? 'ime' : document.activeElement?.tagName || 'none'}`, `composing=${this.composing}`];
    if (event?.type?.startsWith('key')) fields.push(`key=${JSON.stringify(event.key)}`, `code=${event.code}`, `229=${event.keyCode === 229}`);
    if (event?.type === 'beforeinput' || event?.type === 'input') fields.push(`type=${event.inputType}`, `data=${JSON.stringify(event.data)}`, `isComp=${event.isComposing}`);
    if (event?.type?.startsWith('composition')) fields.push(`data=${JSON.stringify(event.data)}`);
    const line = fields.join(' ');
    this.events.push({ at: new Date().toISOString(), line });
    if (this.events.length > 20) this.events.shift();
    this.diagnostics.events = this.events.slice();
    this._sendInput({ type: 'client-event', value: line });
    this._emit('inputevent', { kind, event: line });
    this._emitDiagnostics();
  }

  _updateDisplayDiagnostics({ emitDiagnostics = true } = {}) {
    const canvas = this.container.querySelector('canvas');
    const bounds = canvas?.getBoundingClientRect();
    this.diagnostics.viewport = { width: this.container.clientWidth, height: this.container.clientHeight, devicePixelRatio: window.devicePixelRatio };
    this.diagnostics.framebuffer = canvas ? { width: canvas.width, height: canvas.height, cssWidth: bounds.width, cssHeight: bounds.height } : null;
    this._emit('resize', { viewport: this.diagnostics.viewport, framebuffer: this.diagnostics.framebuffer });
    if (emitDiagnostics) this._emitDiagnostics();
  }

	_startInstanceWatcher() {
    this.stopInstanceWatcher?.();
    if (this.runtime) {
      if (this.runtime.instanceId !== this.instanceId) throw new Error('Create a new Viewer to bind a different runtime handle');
      const runtime = this.runtime;
      const update = () => {
        const value = this.runtime.instance;
        if (!value || this.destroyed) return;
        const instance = { ...this.instance, ...value };
        if (this._handleTerminalInstance(instance)) return;
        this.instance = instance;
        this.diagnostics.instance = structuredClone(instance);
        this._emit('instancechange', { instance });
        this._emitDiagnostics();
      };
      const invalidated = () => {
        update();
        this.disconnect();
        this._emit('runtimeinvalidated', { instanceId:runtime.instanceId, sessionGeneration:runtime.sessionGeneration });
      };
      const released = () => {
        this.stopInstanceWatcher?.();
        this.runtime = null;
        if (!this.destroyed) this._startInstanceWatcher();
      };
      runtime.addEventListener('statechange', update);
      runtime.addEventListener('invalidated', invalidated);
      runtime.addEventListener('release', released);
      this.stopInstanceWatcher = () => {
        runtime.removeEventListener('statechange', update);
        runtime.removeEventListener('invalidated', invalidated);
        runtime.removeEventListener('release', released);
      };
      update();
      if (runtime.state !== 'tracking') invalidated();
      return;
    }
    this.stopInstanceWatcher = this.manager.watchInstance(this.instanceId, {
      interval: this.instancePollInterval,
      onChange: instance => {
		if (this._handleTerminalInstance(instance)) return;
		this.instance = instance;
        this.diagnostics.instance = structuredClone(instance);
        this._emit('instancechange', { instance });
        this._emitDiagnostics();
      },
    });
  }

  _handleTerminalInstance(instance) {
    const endedKey = `${instance.id}:${Number(instance.sessionGeneration) || 0}`;
    if (instance.sessionState !== 'stopped' ||
        instance.applicationStatus?.state !== 'exited' ||
        this.lastSessionEndedKey === endedKey) return false;
    this.lastSessionEndedKey = endedKey;
    this.instance = instance;
    this.diagnostics.instance = structuredClone(instance);
    this._emit('instancechange', { instance });
    this._emit('sessionended', { instance, reason:'application-exited' });
    this.disconnect();
    this._emitDiagnostics();
    return true;
  }

  _startTimers() {
    this._stopTimers();
    if (!this.viewOnly) this.cursorTimer = setInterval(() => this._requestCursor(), this.cursorPollInterval);
    if (this.diagnosticsEnabled) {
      this._startDiagnosticsTimer();
      this.refreshDiagnostics();
    }
  }

  _startDiagnosticsTimer() {
    clearInterval(this.diagnosticsTimer);
    this.diagnosticsTimer = setInterval(() => this.refreshDiagnostics(), this.diagnosticsInterval);
  }

  _stopTimers() {
    clearInterval(this.cursorTimer);
    clearInterval(this.diagnosticsTimer);
    this.cursorTimer = null;
    this.diagnosticsTimer = null;
  }

  async _pollDiagnostics({ emit = this.diagnosticsEnabled } = {}) {
    if (!this.instanceId) return;
    // noVNC changes the canvas backing dimensions after an ExtendedDesktopSize
    // response without resizing our container. Refresh here as well as from the
    // container ResizeObserver so diagnostics report the negotiated framebuffer.
    this._updateDisplayDiagnostics({ emitDiagnostics: false });
    try {
      const metrics = await this.manager.request(`/remotexapps/${encodeURIComponent(this.instanceId)}/healthz`);
      const now = performance.now();
      let downBytesPerSecond = 0;
      let upBytesPerSecond = 0;
      if (this.previousTraffic) {
        const seconds = Math.max(.001, (now - this.previousTraffic.now) / 1000);
        downBytesPerSecond = Math.max(0, metrics.rfbToBrowserBytes - this.previousTraffic.down) / seconds;
        upBytesPerSecond = Math.max(0, metrics.browserToRfbBytes - this.previousTraffic.up) / seconds;
      }
      this.previousTraffic = { now, down: metrics.rfbToBrowserBytes, up: metrics.browserToRfbBytes };
      this.diagnostics.traffic = { ...metrics, downBytesPerSecond, upBytesPerSecond };
      if (emit) this._emitDiagnostics();
    } catch (error) {
      this.diagnostics.traffic = { status: 'unavailable', error: error.message };
      if (emit) this._emitDiagnostics();
    }
  }

  _emitDiagnostics() {
    if (!this.diagnosticsEnabled) return;
    this._emit('diagnostics', { diagnostics: this.getDiagnostics() });
  }
}
