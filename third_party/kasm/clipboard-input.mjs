// Order a native paste after the SDK's fresh clipboard submission. Bounded
// pending input, no payloads, no browser APIs, no replay after retirement.
import {MAX_CLIPBOARD_TRANSFER_TIMEOUT_MS} from './clipboard-payload.mjs';
export class ClipboardInputGate {
  constructor({send, prepare}) {
    this.send = send;
    this.prepare = prepare;
    this.down = new Map();
    this.epoch = 0;
    this.queue = null;
  }
  deliver(keysym, code, down) {
    if (down) this.down.set(code, keysym); else this.down.delete(code);
    this.send(keysym, code, down);
  }
  key(keysym, code, down) {
    if (this.queue) {
      if (this.queue.length >= 128) { this.cancel(); return; }
      this.queue.push([keysym,code,down]); return;
    }
    const paste = down && ((code === 'KeyV' && (this.down.has('ControlLeft') || this.down.has('ControlRight'))) ||
      (code === 'Insert' && (this.down.has('ShiftLeft') || this.down.has('ShiftRight'))));
    let pending;
    if (paste) {
      try { pending = this.prepare?.(); } catch (_) { this.cancel(); return; }
    }
    if (!pending) { this.deliver(keysym,code,down); return; }
    const epoch = this.epoch;
    const expires = Date.now() + 2 * (MAX_CLIPBOARD_TRANSFER_TIMEOUT_MS + 10000);
    this.queue = [[keysym,code,down]];
    this.timer = setTimeout(() => { if (epoch === this.epoch) this.cancel(); }, expires - Date.now());
    Promise.resolve(pending).then(allowed => {
      if (epoch !== this.epoch) return;
      if (Date.now() >= expires) { this.cancel(); return; }
      if (!allowed) { this.cancel(); return; }
      clearTimeout(this.timer);
      const events = this.queue; this.queue = null;
      for (const event of events) this.deliver(...event);
    }, () => { if (epoch === this.epoch) this.cancel(); });
  }
  cancel() {
    ++this.epoch;
    clearTimeout(this.timer);
    this.queue = null;
    for (const [code,keysym] of this.down) this.send(keysym,code,false);
    this.down.clear();
  }
}
