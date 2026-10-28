// RemoteXApp's sole adapter to pinned Kasm internals (MPL-2.0).
import RFB from './core/rfb.js';
import {normalizePolicy} from './core/input/poc-input-policy.mjs';
import { clipboardBytes } from './core/remotexapp-server-messages.mjs';

export default class NativeDisplay extends EventTarget {
  static capabilities = Object.freeze({keyboardPolicy:true, clipboardText:true, clipboardMaxBytes:65536});
  #rfb;
  #input;
  constructor(container, url, { resize = false, keyboardPolicy, clipboard = false } = {}) {
    super();
    if (keyboardPolicy) normalizePolicy(keyboardPolicy);
    this.#input = document.createElement('textarea');
    this.#input.setAttribute('aria-label', 'Remote application keyboard input');
    this.#input.setAttribute('autocomplete', 'off');
    this.#input.setAttribute('autocapitalize', 'off');
    this.#input.spellcheck = false;
    this.#input.style.cssText = 'position:absolute;left:1px;top:1px;width:1px;height:1px;opacity:0;pointer-events:none';
    container.appendChild(this.#input);
    const rfb = this.#rfb = new RFB(container, this.#input, url, { shared:true, videoRenderingMode:'canvas2d' }, []);
    rfb.enableWebRTC = false;
    // Browser clipboard access belongs to explicit SDK user actions. The native
    // transport never reads/writes navigator.clipboard, on focus or otherwise.
    rfb.clipboardUp = rfb.clipboardDown = clipboard;
    rfb.clipboardSeamless = false;
    rfb.clipboardBinary = true;
    rfb.scaleViewport = true;
    rfb.resizeSession = resize;
    rfb._keyboard.enableIME = true;
    if (keyboardPolicy) this.configureKeyboard(keyboardPolicy);
    rfb._keyboard.onpolicychange = () => this.dispatchEvent(new Event('keyboardpolicychange'));
    rfb.addEventListener('clipboard', event => {
      if (this.#rfb !== rfb || !clipboard) return;
      this.dispatchEvent(new CustomEvent('clipboard', {detail:{text:event.detail.text}}));
    });
    for (const event of ['connect', 'frame', 'disconnect']) {
      rfb.addEventListener(event, () => this.dispatchEvent(new Event(event)));
    }
  }

  get keyboardPolicy() {
    const config = this.#rfb?._keyboard.inputPolicy.config;
    return config && {profile:config.profile, mode:config.mode, bindings:[...config.bindings]};
  }
  configureKeyboard(settings) { return this.#rfb._keyboard.inputPolicy.configure(settings); }
  focus() { this.#rfb?.focus(); }
  blur() { this.#rfb?.blur(); }
  sendClipboardText(text) {
    const data = clipboardBytes(text), rfb = this.#rfb;
    if (!rfb || rfb._rfbConnectionState !== 'connected' || !rfb.clipboardUp) throw new Error('Clipboard transport unavailable');
    // No asynchronous hash/browser API: retirement cannot send this to a new
    // generation after a pending clipboard read resolves. Native wire only.
    RFB.messages.sendBinaryClipboard(rfb._sock, [data], ['text/plain']);
  }
  disconnect() {
    this.#rfb?.disconnect();
    this.#rfb = null;
    this.#input?.remove();
    this.#input = null;
  }
}
