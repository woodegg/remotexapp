// RemoteXApp's adapter to the pinned Kasm client. Upstream internals stay here,
// inside the hashed component; the host SDK does not depend on private fields.
import RFB from './core/rfb.js';

export default class NativeDisplay extends EventTarget {
  #rfb;
  #input;
  constructor(container, url, { resize = false } = {}) {
    super();
    this.#input = document.createElement('textarea');
    this.#input.setAttribute('aria-label', 'Remote application keyboard input');
    this.#input.setAttribute('autocomplete', 'off');
    this.#input.setAttribute('autocapitalize', 'off');
    this.#input.spellcheck = false;
    this.#input.style.cssText = 'position:absolute;left:1px;top:1px;width:1px;height:1px;opacity:0;pointer-events:none';
    container.appendChild(this.#input);
    const rfb = this.#rfb = new RFB(container, this.#input, url, { shared:true, videoRenderingMode:'canvas2d' }, []);
    rfb.enableWebRTC = false;
    rfb.clipboardUp = rfb.clipboardDown = rfb.clipboardSeamless = false;
    rfb.scaleViewport = true;
    rfb.resizeSession = resize;
    rfb.frameRate = 30;
    rfb._keyboard.enableIME = true;
    for (const event of ['connect', 'frame', 'disconnect']) {
      rfb.addEventListener(event, () => this.dispatchEvent(new Event(event)));
    }
  }

  disconnect() {
    this.#rfb?.disconnect();
    this.#rfb = null;
    this.#input?.remove();
    this.#input = null;
  }
}
