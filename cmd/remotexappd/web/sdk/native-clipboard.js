// Native clipboard policy. Payloads are bounded, ephemeral and never emitted.
const modes = new Set(['off', 'manual', 'auto']);
const coordinatorKey = Symbol.for('remotexapp.native-clipboard.owner.v1');
function coordinator() {
  let scope = globalThis;
  try { if (globalThis.top?.location && globalThis.top.location.origin === globalThis.location?.origin) scope = globalThis.top; } catch (_) {}
  return scope[coordinatorKey] ||= {owner:null};
}
const permissionNames = {read:'clipboard-read', write:'clipboard-write'};

export class NativeClipboard {
  constructor(client, error) {
    this.client = client;
    this.error = error;
    this.requested = {toRemote:'off', toLocal:'off'};
    this.permissions = {read:'unknown', write:'unknown'};
    this.active = false;
    this.revision = 0;
    this.consent = 0;
    this.observers = [];
    this.listeners = [];
    this.phase = 'off';
    const listen = (target, name, fn) => {
      target?.addEventListener?.(name, fn);
      this.listeners.push(() => target?.removeEventListener?.(name, fn));
    };
    listen(client.container, 'focusin', () => this.activate());
    // Kasm can focus its input before readiness; clicking it again does not
    // produce focusin. Select on this explicit pointer intent, never connect.
    listen(client.container, 'pointerdown', () => this.activate());
    listen(client.container, 'focusout', event => {
      if (!client.container.contains?.(event.relatedTarget)) this.deactivate();
    });
    listen(globalThis, 'blur', () => this.deactivate());
    listen(globalThis.document, 'visibilitychange', () => { if (document.hidden) this.deactivate(); });
    listen(globalThis, 'pagehide', () => this.deactivate());
  }
  fail(code) { return this.error(code); }
  valid(text) {
    if (typeof text !== 'string' || !text.isWellFormed() || text.includes('\0')) throw this.fail('clipboard-format');
    if (text.length > 65536 || new TextEncoder().encode(text).length > this.client.capabilities.clipboardMaxBytes) throw this.fail('clipboard-size');
    return text;
  }
  eligible() {
    return this.active && coordinator().owner === this && this.client.state === 'ready' &&
      !globalThis.document?.hidden && globalThis.document?.hasFocus() === true;
  }
  effective(direction) {
    const mode = this.requested[direction];
    if (!this.client.capabilities.clipboard || this.client.state !== 'ready') return 'off';
    if (mode !== 'auto') return mode;
    const supported = this.client.capabilities.clipboardAutomatic && globalThis.navigator?.locks?.request &&
      globalThis.navigator?.clipboard?.readText && globalThis.navigator?.clipboard?.writeText;
    return supported && this.permissions.read === 'granted' &&
      (direction !== 'toLocal' || this.permissions.write === 'granted') ? 'auto' : 'manual';
  }
  snapshot() {
    return {requested:{...this.requested}, effective:{toRemote:this.effective('toRemote'),toLocal:this.effective('toLocal')},
      permissions:{...this.permissions}, active:this.eligible(), phase:this.phase,
      formats:this.client.capabilities.clipboard ? ['text/plain'] : [], maxBytes:this.client.capabilities.clipboardMaxBytes,
      automaticSupported:!!(this.client.capabilities.clipboardAutomatic && globalThis.navigator?.locks?.request && globalThis.navigator?.permissions?.query)};
  }
  emit(phase = this.phase) {
    this.phase = phase;
    this.client.dispatchEvent(new CustomEvent('clipboardstatechange', {detail:this.snapshot()}));
  }
  retire() {
    ++this.revision;
    clearTimeout(this.timer);
    this.timer = null;
    this.baseline = undefined;
    this.remote = undefined;
    this.lastSent = undefined;
    this.conflict = false;
    // An already-started browser call owns busy until it actually settles.
    this.client._display?.cancelClipboardPaste?.();
  }
  deactivate() {
    this.active = false;
    if (coordinator().owner === this) coordinator().owner = null;
    this.retire();
    this.emit('inactive');
  }
  activate() {
    if (this.eligible()) return;
    if (this.client.state !== 'ready' || document.hidden || !document.hasFocus()) return;
    const previous = coordinator().owner;
    if (previous && previous !== this) previous.deactivate();
    coordinator().owner = this;
    this.active = true;
    this.retire();
    this.emit('baseline');
    this.schedule(0);
  }
  reset() {
    ++this.consent;
    this.deactivate();
    this.requested = {toRemote:'off',toLocal:'off'};
    for (const remove of this.observers) remove();
    this.observers = [];
    this.permissions = {read:'unknown',write:'unknown'};
    this.emit('off');
  }
  configure(options) {
    if (!options || !modes.has(options.toRemote) || !modes.has(options.toLocal)) throw new TypeError('Each clipboard direction must be off, manual or auto');
    if (Object.values(options).some(x => x !== 'off') && this.client.state !== 'ready') throw this.fail('clipboard-cancelled');
    if (Object.values(options).includes('auto') && !globalThis.navigator?.userActivation?.isActive) throw this.fail('clipboard-gesture');
    this.retire();
    this.requested = {toRemote:options.toRemote,toLocal:options.toLocal};
    const consent = ++this.consent;
    return this.observePermissions(consent).then(() => {
      if (consent === this.consent) { this.emit(this.eligible() ? 'baseline' : 'inactive'); this.schedule(0); }
      return this.snapshot();
    });
  }
  async observePermissions(consent = this.consent) {
    for (const remove of this.observers) remove();
    this.observers = [];
    await Promise.all(Object.entries(permissionNames).map(async ([key,name]) => {
      let status;
      try { status = await navigator.permissions.query({name}); } catch (_) {}
      if (consent !== this.consent) return;
      this.permissions[key] = ['granted','prompt','denied'].includes(status?.state) ? status.state : 'unsupported';
      if (!status?.addEventListener) return;
      const changed = () => {
        this.permissions[key] = status.state;
        this.retire();
        this.emit('permission-changed');
        this.schedule(0);
      };
      status.addEventListener('change', changed);
      this.observers.push(() => status.removeEventListener('change', changed));
    }));
  }
  async requestPermission() {
    if (!navigator.userActivation?.isActive || document.hidden || !document.hasFocus()) throw this.fail('clipboard-gesture');
    if (!Object.values(this.requested).includes('auto')) throw this.fail('clipboard-disabled');
    const consent = this.consent;
    // Explicit UI action only. Discard this payload; consent is not a transfer.
    try { await navigator.clipboard.readText(); }
    catch (_) { if (consent === this.consent) this.emit('permission-required'); }
    if (consent === this.consent) {
      await this.observePermissions(consent);
      this.emit('permission-updated');
      this.schedule(0);
    }
    return this.snapshot();
  }
  check(revision) {
    if (revision !== this.revision || !this.eligible()) throw this.fail('clipboard-cancelled');
  }
  offer(text) {
    try { this.valid(text); } catch (error) { this.emit(error.code); return; }
    if (!this.eligible() || this.effective('toLocal') !== 'auto' || text === '' || text === this.lastSent) return;
    // Do not replay an offer observed during baseline acquisition or a conflict.
    if (this.baseline === undefined || this.conflict) return;
    this.remote = text;
    this.schedule(0);
  }
  schedule(delay = 250) {
    clearTimeout(this.timer);
    if (!this.eligible() || this.conflict || this.client._clipboardBusy || !Object.keys(this.requested).some(d => this.effective(d) === 'auto')) return;
    this.timer = setTimeout(() => { this.timer = null; this.sync().catch(() => {}); }, delay);
  }
  async sync({paste = false} = {}) {
    if (paste && this.requested.toRemote !== 'auto') return null;
    if (paste && this.effective('toRemote') !== 'auto') throw this.fail('clipboard-permission-required');
    if (!paste && !Object.keys(this.requested).some(d => this.effective(d) === 'auto')) return;
    if (this.busy) {
      if (paste) throw this.fail('clipboard-busy');
      return;
    }
    const revision = this.revision;
    this.check(revision);
    if (this.conflict && !paste) return;
    let settled;
    const operation = {done:new Promise(resolve => { settled = resolve; })};
    this.busy = operation;
    let startedWrite = false, timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (revision === this.revision) {
        this.retire(); this.conflict = true;
        this.emit(startedWrite ? 'clipboard-uncertain' : 'clipboard-timeout');
      }
    }, 5000);
    try {
      // Same-origin tabs/frames serialize clipboard calls, including a write
      // completing after blur. No payload or fingerprint travels through a lock.
      return await navigator.locks.request('remotexapp-native-clipboard', {ifAvailable:true}, async lock => {
        this.check(revision);
        if (!lock) { if (paste) throw this.fail('clipboard-busy'); return; }
        const text = this.valid(await navigator.clipboard.readText());
        this.check(revision);
        const remote = this.remote;
        this.remote = undefined;
        if (paste) {
          // A paste is an explicit source choice, including after refocusing.
          if (text) { this.client._display.sendClipboardText(text); this.lastSent = text; }
          this.baseline = text; this.conflict = false;
          this.emit(text ? 'submitted' : 'empty-noop');
          return {revision, empty:!text};
        }
        if (this.baseline === undefined) { this.baseline = text; this.emit('watching'); return; }
        const changed = text !== this.baseline;
        if (remote !== undefined && remote !== text && changed) {
          this.conflict = true; this.emit('conflict'); return;
        }
        if (remote !== undefined && remote !== text && this.effective('toLocal') === 'auto') {
          this.check(revision);
          startedWrite = true;
          await navigator.clipboard.writeText(remote);
          if (revision !== this.revision || !this.eligible()) {
            this.emit('clipboard-uncertain'); return;
          }
          this.baseline = remote;
          this.emit('copied-to-local');
        } else {
          if (changed && text && this.effective('toRemote') === 'auto') {
            this.check(revision);
            this.client._display.sendClipboardText(text);
            this.lastSent = text;
            this.emit('submitted');
          }
          this.baseline = text;
        }
      });
    } catch (error) {
      if (revision === this.revision) {
        this.conflict = true;
        if (error.name === 'NotAllowedError') this.permissions[startedWrite ? 'write' : 'read'] = 'denied';
        this.emit(startedWrite ? 'clipboard-uncertain' : (typeof error.code === 'string' ? error.code : error.name === 'NotAllowedError' ? 'clipboard-denied' : 'clipboard-unavailable'));
      } else if (startedWrite) this.emit('clipboard-uncertain');
      if (paste) throw error;
    } finally {
      clearTimeout(timer);
      if (this.busy === operation) this.busy = null;
      settled();
      if (!timedOut) this.schedule();
    }
  }
  paste() {
    if (this.effective('toRemote') !== 'auto') return null;
    const revision = this.revision;
    const ready = this.busy ? this.busy.done : Promise.resolve();
    return ready.then(() => { this.check(revision); return this.sync({paste:true}); }).then(result => {
      this.check(result?.revision);
      // Empty-read is a no-op; never paste the previous remote value as if it
      // were the empty local clipboard. The gate suppresses this one paste.
      return !result.empty;
    });
  }
  manualCompleted() { this.retire(); this.emit('baseline'); this.schedule(0); }
  dispose() { this.reset(); for (const remove of this.listeners) remove(); this.listeners = []; }
}
