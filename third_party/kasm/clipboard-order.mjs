// Content-free per-connection ordering on the reliable RFB channel.
import {clipboardTransferTimeout} from './clipboard-payload.mjs';
const prefix = 'rx-clip:1:';
const zero = '0000000000000000';
export const clipboardRevision = value => typeof value === 'string' && /^[0-9a-f]{16}$/.test(value) && value !== zero;
const failure = code => Object.assign(Error(code), {code});
const encode = (op, id, revision = zero) => `${prefix}${op}:${id.toString(16).padStart(8, '0')}:${revision}`;

export class ClipboardOrder {
  constructor({sendFence, send, changed = () => {}, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id)}) {
    Object.assign(this, {sendFence, send, changed, setTimer, clearTimer});
    this.sequence = 0; this.state = 'waiting'; this.revision = null;
  }
  get ready() { return !this.closed && this.state === 'ready' && clipboardRevision(this.revision); }
  _next() {
    if (this.sequence === 0xffffffff) throw failure('clipboard-ordering-exhausted');
    return ++this.sequence;
  }
  _expire(pending) {
    if (this.pending !== pending) return;
    this._settle(failure(pending.kind === 'H' ? 'clipboard-ordering-unavailable' : 'clipboard-uncertain'));
    if (pending.kind === 'H') { this.state = 'unavailable'; this.changed(); }
    else { try { this.sendFence(encode('C', pending.id)); } catch { /* Outcome is already uncertain. */ } }
  }
  _begin(kind, id, revision, timeout = 4000) {
    const pending = {kind, id, revision, expires:Date.now() + timeout};
    pending.promise = new Promise((resolve, reject) => { pending.resolve = resolve; pending.reject = reject; });
    pending.promise.catch(() => {});
    this.pending = pending;
    pending.timer = this.setTimer(() => this._expire(pending), timeout);
    return pending.promise;
  }
  _settle(error, result) {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null; this.clearTimer(pending.timer);
    if (error) pending.reject(error); else pending.resolve(result);
  }
  start() {
    if (this.closed) return Promise.reject(failure('clipboard-cancelled'));
    if (this.ready) return Promise.resolve({revision:this.revision});
    if (this.started) return this.started;
    const id = this.helloId = this._next();
    const promise = this.started = this._begin('H', id, zero);
    try { if (!this.sendFence(encode('H', id))) throw failure('clipboard-ordering-unavailable'); }
    catch (error) { this.state = 'unavailable'; this._settle(error); this.changed(); }
    return promise;
  }
  submit(items, expectedRevision, bytes = 0) {
    if (!this.ready) return Promise.reject(failure('clipboard-ordering-unavailable'));
    if (this.pending) return Promise.reject(failure('clipboard-busy'));
    if (expectedRevision !== null && !clipboardRevision(expectedRevision)) return Promise.reject(failure('clipboard-ordering-unavailable'));
    const timeout = clipboardTransferTimeout(bytes), id = this._next(), kind = expectedRevision === null ? 'U' : 'A';
    const promise = this._begin(kind, id, expectedRevision ?? this.revision, timeout);
    try {
      if (!this.sendFence(encode(kind, id, expectedRevision ?? zero))) throw failure('clipboard-uncertain');
      this.send(items);
    } catch {
      this._settle(failure('clipboard-uncertain'));
      try { this.sendFence(encode('C', id)); } catch { /* Never replay a possibly submitted body. */ }
    }
    return promise;
  }
  fence(payload, flags) {
    if (!payload.startsWith(prefix)) return false;
    // Old servers echo H unchanged. Consuming that echo is not negotiation.
    const match = /^rx-clip:1:([HIVAOCUSEFK]):([0-9a-f]{8}):([0-9a-f]{16})$/.exec(payload);
    if (flags !== 0 || !match) {
      if (!this.closed) { this.state = 'unavailable'; this._settle(failure('clipboard-ordering-unavailable')); this.changed(); }
      return true;
    }
    if (this.closed) return true;
    if (this.pending && Date.now() >= this.pending.expires) this._expire(this.pending);
    const [, op, encoded, revision] = match, id = parseInt(encoded, 16), pending = this.pending;
    if (op === 'H' || op === 'A' || op === 'U' || op === 'C' || op === 'K') return true;
    if (op === 'I' && !this.negotiated && this.helloId === id && clipboardRevision(revision)) {
      this.negotiated = true; this.revision = revision; this.state = 'ready';
      if (pending?.kind === 'H') this._settle(null, {revision});
      this.changed();
    } else if (op === 'V' && !id && this.ready) {
      if (!clipboardRevision(revision) || revision < this.revision) {
        this.state = 'unavailable'; this._settle(failure('clipboard-ordering-unavailable'));
      } else this.revision = revision;
      try { this.sendFence(encode('K', this.helloId, revision)); } catch { /* Reconnect owns a failed transport. */ }
      this.changed();
    } else if (op === 'O' && !id && this.ready) {
      // Keep the snapshot's revision, never relabel it with the latest event.
      this.offerRevision = clipboardRevision(revision) ? revision : null;
      if (this.offerRevision > this.revision) { this.revision = this.offerRevision; this.changed(); }
    } else if (pending?.id === id && ['S', 'F', 'E'].includes(op)) {
      if (op === 'S' && pending.kind !== 'H' && clipboardRevision(revision) && revision > pending.revision) {
        if (revision > this.revision) this.revision = revision;
        this._settle(null, {revision});
      } else {
        if (pending.kind === 'H') this.state = 'unavailable';
        this._settle(failure(op === 'F' ? 'clipboard-conflict' : pending.kind === 'H' ? 'clipboard-ordering-unavailable' : 'clipboard-uncertain'));
      }
      this.changed();
    }
    return true;
  }
  takeOfferRevision() { const revision = this.offerRevision; this.offerRevision = null; return revision ?? null; }
  cancelSubmission() {
    if (!this.pending || this.pending.kind === 'H') return;
    const id = this.pending.id;
    this._settle(failure('clipboard-uncertain'));
    try { this.sendFence(encode('C', id)); } catch { /* Never replay a potentially committed transfer. */ }
  }
  dispose() {
    if (this.closed) return;
    this.closed = true; this.revision = this.offerRevision = null;
    this._settle(failure('clipboard-cancelled'));
    this.started = null;
    this.sendFence = this.send = this.changed = () => {};
  }
}
