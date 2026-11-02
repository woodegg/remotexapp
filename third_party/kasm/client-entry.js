// RemoteXApp's sole adapter to pinned Kasm internals (MPL-2.0).
import RFB from './core/rfb.js';
import MouseButtonMapper, {XVNC_BUTTONS} from './core/mousebuttonmapper.js';
import {normalizePolicy} from './core/input/poc-input-policy.mjs';
import { clipboardBytes } from './core/remotexapp-server-messages.mjs';
import { LatencyProbe } from './core/remotexapp-latency.mjs';
import { ClipboardInputGate } from './core/remotexapp-clipboard-input.mjs';

export default class NativeDisplay extends EventTarget {
  static capabilities = Object.freeze({keyboardPolicy:true, clipboardText:true, clipboardAutomatic:true, clipboardMaxBytes:65536, statistics:true, latency:true, udpLoss:true, udp:typeof REMOTEXAPP_UDP !== 'undefined' && REMOTEXAPP_UDP});
  #rfb;
  #input;
  #renderedFrames = 0;
  #udpPaintBaseline = 0;
  #latency;
  #clipboardInput;
  constructor(container, url, { resize = false, keyboardPolicy, clipboard = false, udp = false, protocols = [], prepareClipboardPaste } = {}) {
    super();
    if (keyboardPolicy) normalizePolicy(keyboardPolicy);
    this.#input = document.createElement('textarea');
    this.#input.setAttribute('aria-label', 'Remote application keyboard input');
    this.#input.setAttribute('autocomplete', 'off');
    this.#input.setAttribute('autocapitalize', 'off');
    this.#input.spellcheck = false;
    this.#input.style.cssText = 'position:absolute;left:1px;top:1px;width:1px;height:1px;opacity:0;pointer-events:none';
    container.appendChild(this.#input);
    const rfb = this.#rfb = new RFB(container, this.#input, url, { shared:true, videoRenderingMode:'canvas2d', wsProtocols:protocols.length ? protocols : ['binary'] }, []);
    this.#latency = new LatencyProbe({
      connected:() => this.#rfb === rfb && rfb.isConnected,
      peer:() => rfb._udpPeer,
      udpActive:() => rfb._useUdp && rfb._transitConnectionState === rfb.TransitConnectionStates?.Udp,
      sendFence:payload => {
        if (!rfb._supportsFence) return false;
        RFB.messages.clientFence(rfb._sock, 0x80000000, payload);
        return true;
      },
    });
    this.#clipboardInput = new ClipboardInputGate({send:(...args) => rfb._handleKeyEvent(...args), prepare:prepareClipboardPaste});
    rfb._keyboard.onkeyevent = (...args) => this.#clipboardInput.key(...args);
    const cancelKeys = rfb._keyboard.onkeycancel;
    rfb._keyboard.onkeycancel = codes => {
      this.#clipboardInput.cancel();
      cancelKeys?.(codes);
    };
    this.#input.addEventListener('blur', () => this.#clipboardInput.cancel());
    rfb._remoteXAppFenceResponse = (payload, flags) => this.#latency.fence(payload, flags);
    rfb.addEventListener('disconnect', () => this.#latency.dispose(), {once:true});
    // Upstream initializes this in its full UI. The standalone adapter owns
    // the same required DOM-button -> X11-button mapping before input starts.
    rfb.mouseButtonMapper = new MouseButtonMapper();
    for (const [button, mapped] of [[0,XVNC_BUTTONS.LEFT_BUTTON], [1,XVNC_BUTTONS.MIDDLE_BUTTON],
      [2,XVNC_BUTTONS.RIGHT_BUTTON], [3,XVNC_BUTTONS.BACK_BUTTON], [4,XVNC_BUTTONS.FORWARD_BUTTON]]) {
      rfb.mouseButtonMapper.set(button, mapped);
    }
    rfb.enableWebRTC = !!udp && NativeDisplay.capabilities.udp;
    rfb.addEventListener('transportchange', () => {
      this.#udpPaintBaseline = this.#renderedFrames;
      this.dispatchEvent(new Event('transportchange'));
    });
    // Browser clipboard access belongs to the SDK consent/focus policy. The native
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
      rfb.addEventListener(event, () => {
        if (this.#rfb !== rfb) return;
        if (event === 'frame') this.#renderedFrames++;
        this.dispatchEvent(new Event(event));
      });
    }
  }

  getStats() {
    const rfb = this.#rfb;
    if (!rfb?.isConnected) return null;
    return {...rfb._sock.trafficStats, renderedFrames:this.#renderedFrames, latency:this.#latency.snapshot(),
      udpReceivedBytes:rfb._udpReceivedBytes || 0, udpPackets:rfb._udpPackets || 0,
      udpRectangles:rfb._udpRectangles || 0,
      udpLoss:rfb._useUdp && rfb._transitConnectionState === rfb.TransitConnectionStates.Udp
        ? rfb._udpBuffer?.lossStats() || {state:'waiting'} : {state:'inactive'},
      screenTransport:rfb._transitConnectionState === rfb.TransitConnectionStates.Udp && this.#renderedFrames > this.#udpPaintBaseline ? 'webrtc-udp' : 'wss',
      udpState:rfb._transitConnectionState.description, udpReason:rfb._udpUnavailableReason || null,
      width:rfb._display.width, height:rfb._display.height};
  }

  measureLatency() { return this.#latency.measure(); }

  configureTransport(preferUDP) {
    if (!NativeDisplay.capabilities.udp) throw new Error('UDP is unavailable');
    this.#rfb.enableWebRTC = !!preferUDP;
  }

  get keyboardPolicy() {
    const config = this.#rfb?._keyboard.inputPolicy.config;
    return config && {profile:config.profile, mode:config.mode, bindings:[...config.bindings]};
  }
  configureKeyboard(settings) { return this.#rfb._keyboard.inputPolicy.configure(settings); }
  focus() { this.#rfb?.focus(); }
  blur() { this.#rfb?.blur(); }
  cancelClipboardPaste() { this.#clipboardInput.cancel(); }
  sendClipboardText(text) {
    const data = clipboardBytes(text), rfb = this.#rfb;
    if (!rfb || rfb._rfbConnectionState !== 'connected' || !rfb.clipboardUp) throw new Error('Clipboard transport unavailable');
    // No asynchronous hash/browser API: retirement cannot send this to a new
    // generation after a pending clipboard read resolves. Native wire only.
    RFB.messages.sendBinaryClipboard(rfb._sock, [data], ['text/plain']);
  }
  disconnect() {
    this.#clipboardInput.cancel();
    this.#latency.dispose();
    this.#rfb?.disconnect();
    this.#rfb = null;
    this.#input?.remove();
    this.#input = null;
  }
}
