// RemoteXApp's sole adapter to pinned Kasm internals (MPL-2.0).
import RFB from './core/rfb.js';
import MouseButtonMapper, {XVNC_BUTTONS} from './core/mousebuttonmapper.js';
import {normalizePolicy} from './core/input/poc-input-policy.mjs';
import {clipboardPayload, textPayload, MAX_RICH_CLIPBOARD_BYTES} from './core/clipboard-payload.mjs';
import { LatencyProbe } from './core/remotexapp-latency.mjs';
import { ClipboardInputGate } from './core/remotexapp-clipboard-input.mjs';
import { ClipboardOrder } from './core/remotexapp-clipboard-order.mjs';
import { NativeInput } from './core/remotexapp-native-input.mjs';
import keysyms from './core/input/keysymdef.js';

export default class NativeDisplay extends EventTarget {
  static capabilities = Object.freeze({programmaticInput:true, displayControls:true, readOnly:true, keyboardPolicy:true, clipboardText:true, clipboardAutomatic:true, clipboardConditional:true, clipboardRich:true, clipboardMaxBytes:MAX_RICH_CLIPBOARD_BYTES, statistics:true, latency:true, udpLoss:true, turn:typeof REMOTEXAPP_UDP !== 'undefined' && REMOTEXAPP_UDP, udp:typeof REMOTEXAPP_UDP !== 'undefined' && REMOTEXAPP_UDP});
  #rfb;
  #input;
  #inputBlur;
  #renderedFrames = 0;
  #udpPaintBaseline = 0;
  #latency;
  #clipboardInput;
  #clipboardOrder;
  #nativeInput;
  #allowResize;
  #firstFrameTimer;
  constructor(container, url, { resize = false, scale = true, readOnly = false, keyboardPolicy, clipboard = false, udp = false, turnServers = null, protocols = [], prepareClipboardPaste } = {}) {
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
    this.#clipboardOrder = new ClipboardOrder({
      sendFence:payload => {
        if (this.#rfb !== rfb || !rfb.isConnected || !clipboard) return false;
        RFB.messages.clientFence(rfb._sock, 0x80000000, payload); return true;
      },
      send:items => this.#sendClipboard(items),
      changed:() => this.dispatchEvent(new Event('clipboardrevision')),
    });
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
    this.#nativeInput = new NativeInput({current:() => this.#rfb, lookup:point => keysyms.lookup(point),
      busy:() => !!this.#clipboardInput.queue});
    this.#allowResize = resize && !readOnly;
    rfb.viewOnly = readOnly;
    rfb._keyboard.onkeyevent = (...args) => this.#clipboardInput.key(...args);
    const cancelKeys = rfb._keyboard.onkeycancel;
    rfb._keyboard.onkeycancel = codes => {
      this.#clipboardInput.cancel();
      cancelKeys?.(codes);
    };
    this.#inputBlur = () => this.#clipboardInput.cancel();
    this.#input.addEventListener('blur', this.#inputBlur);
    rfb._remoteXAppFenceResponse = (payload, flags) => this.#clipboardOrder.fence(payload, flags) || this.#latency.fence(payload, flags);
    rfb.addEventListener('disconnect', () => { this.#latency.dispose(); this.#clipboardOrder.dispose(); }, {once:true});
    // Upstream initializes this in its full UI. The standalone adapter owns
    // the same required DOM-button -> X11-button mapping before input starts.
    rfb.mouseButtonMapper = new MouseButtonMapper();
    for (const [button, mapped] of [[0,XVNC_BUTTONS.LEFT_BUTTON], [1,XVNC_BUTTONS.MIDDLE_BUTTON],
      [2,XVNC_BUTTONS.RIGHT_BUTTON], [3,XVNC_BUTTONS.BACK_BUTTON], [4,XVNC_BUTTONS.FORWARD_BUTTON]]) {
      rfb.mouseButtonMapper.set(button, mapped);
    }
    rfb._remoteXAppTurn = turnServers;
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
    rfb.scaleViewport = scale;
    rfb.resizeSession = this.#allowResize;
    rfb._keyboard.enableIME = true;
    if (keyboardPolicy) this.configureKeyboard(keyboardPolicy);
    rfb._keyboard.onpolicychange = () => this.dispatchEvent(new Event('keyboardpolicychange'));
    rfb.addEventListener('clipboard', event => {
      if (this.#rfb !== rfb || !clipboard) return;
      this.dispatchEvent(new CustomEvent('clipboard', {detail:{...event.detail,revision:this.#clipboardOrder.takeOfferRevision()}}));
    });
    for (const event of ['connect', 'frame', 'disconnect']) {
      rfb.addEventListener(event, () => {
        if (this.#rfb !== rfb) return;
        if (event === 'connect') {
          this.#scheduleInitialRefresh(rfb, 3);
          if (clipboard) this.#clipboardOrder.start().catch(() => {});
        }
        else {
          if (event === 'frame') this.#renderedFrames++;
          clearTimeout(this.#firstFrameTimer);
        }
        this.dispatchEvent(new Event(event));
      });
    }
  }

  #scheduleInitialRefresh(rfb, attempts) {
    if (this.#renderedFrames) return;
    // An idle shared display can complete RFB setup without drawing its
    // first rectangle. Request a bounded refresh while this Viewer owns it.
    this.#firstFrameTimer = setTimeout(() => {
      if (this.#rfb !== rfb || !rfb.isConnected || this.#renderedFrames) return;
      rfb._requestFullRefresh();
      if (attempts > 1) this.#scheduleInitialRefresh(rfb, attempts - 1);
    }, 1000);
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

  sendText(text) { return this.#nativeInput.text(text); }
  sendKey(key, options) { return this.#nativeInput.key(key, options); }
  configureDisplay({scale = true, resize = false} = {}) {
    if (typeof scale !== 'boolean' || typeof resize !== 'boolean') throw new TypeError('Invalid display settings');
    if (resize && !this.#allowResize) throw new Error('Remote resize is unavailable');
    this.#rfb.scaleViewport = scale;
    this.#rfb.resizeSession = resize;
    return {scale,resize};
  }
  flushResize() {
    if (!this.#allowResize || !this.#rfb?.resizeSession || !this.#rfb.isConnected) return false;
    this.#rfb._requestRemoteResize();
    return true;
  }

  configureTurnServers(servers) {
    if (this.#rfb?._remoteXAppTurn) this.#rfb._remoteXAppTurn = servers;
  }

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
  cancelClipboardPaste() { this.#clipboardInput.cancel(); this.#clipboardOrder.cancelSubmission(); }
  get clipboardRevision() { return this.#clipboardOrder.ready ? this.#clipboardOrder.revision : null; }
  get clipboardOrderingState() { return this.#clipboardOrder.closed ? 'unavailable' : this.#clipboardOrder.state; }
  submitClipboard(items, expectedRevision) {
    const payload = clipboardPayload(items);
    return this.#clipboardOrder.submit(payload.items, expectedRevision, payload.bytes);
  }
  sendClipboardText(text) { this.sendClipboard(textPayload(text).items); }
  sendClipboard(items) {
    if (this.#clipboardOrder.pending && this.#clipboardOrder.pending.kind !== 'H') throw new Error('Clipboard transfer pending');
    this.#sendClipboard(items);
  }
  #sendClipboard(items) {
    const payload = clipboardPayload(items), rfb = this.#rfb;
    if (!rfb || rfb._rfbConnectionState !== 'connected' || !rfb.clipboardUp) throw new Error('Clipboard transport unavailable');
    // Synchronous native submission preserves the SDK generation/consent fence.
    RFB.messages.sendBinaryClipboard(rfb._sock, payload.items.map(item => item.data), payload.items.map(item => item.type));
  }
  disconnect() {
    clearTimeout(this.#firstFrameTimer);
    this.#clipboardInput.cancel();
    this.#clipboardOrder.dispose();
    this.#latency.dispose();
    // A browser can retain a detached input as a pending animation-event
    // target. Release our listener before removing it: the constructor's
    // shared lexical context otherwise keeps the retired RFB buffers alive.
    this.#input?.removeEventListener('blur', this.#inputBlur);
    this.#inputBlur = null;
    this.#rfb?.disconnect();
    this.#rfb = null;
    this.#input?.remove();
    this.#input = null;
  }
}
