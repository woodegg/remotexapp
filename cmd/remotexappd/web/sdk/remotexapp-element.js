import { RemoteXAppManager } from './remotexapp-manager.js';
import { RemoteXAppClient } from './remotexapp-client.js';
import { RemoteXAppClipboardPrompts } from './remotexapp-clipboard.js';

const forwardedEvents = [
  'statechange', 'instancechange', 'reconnecting', 'reconnectexhausted', 'diagnostics',
  'textack', 'cursorchange', 'resize', 'inputevent', 'sessionended', 'error', 'viewerready',
  'clipboardoffer', 'clipboardstatechange', 'clipboardsync', 'clipboardpermissionrequired',
  'clipboardexpired', 'clipboarderror',
];

/** Optional declarative wrapper around RemoteXAppManager + RemoteXAppClient. */
export class RemoteXAppElement extends HTMLElement {
  static get observedAttributes() { return ['view-only', 'diagnostics', 'no-connection-mask']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        :host { position: relative; display: block; min-width: 160px; min-height: 120px; background: #101827; overflow: hidden; }
        #screen { position: absolute; inset: 0; }
        #status { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); padding: 7px 10px; border-radius: 6px; color: #dce8f7; background: #0b1220dd; font: 12px system-ui, sans-serif; pointer-events: none; }
        #status[hidden] { display: none; }
      </style>
      <div id="screen" part="screen"></div>
      <div id="status" part="status">Ready</div>`;
    this.screen = this.shadowRoot.querySelector('#screen');
    this.status = this.shadowRoot.querySelector('#status');
    this.manager = null;
    this.client = null;
    this.instance = null;
    this.connectPromise = null;
    this.clipboardPrompts = null;
  }

  connectedCallback() {
    if (this.hasAttribute('auto-connect') || this.hasAttribute('class-id') || this.hasAttribute('instance-id')) {
      this.connect().catch(error => this._showError(error));
    }
  }

  disconnectedCallback() {
    this.client?.destroy();
    this.clipboardPrompts?.destroy();
    this.clipboardPrompts = null;
    this.client = null;
    this.connectPromise = null;
  }

  attributeChangedCallback(name) {
    if (name === 'no-connection-mask' && this.client) this.client.setConnectionMaskEnabled(!this.hasAttribute('no-connection-mask'));
    if (name === 'view-only' && this.client) this.client.setViewOnly(this.hasAttribute('view-only')).catch(error => this._showError(error));
    if (name === 'diagnostics' && this.client) this.client.setDiagnosticsEnabled(this.hasAttribute('diagnostics')).catch(error => this._showError(error));
  }

  async connect() {
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this._connect();
    try { return await this.connectPromise; }
    catch (error) { this.connectPromise = null; throw error; }
  }

  async _connect() {
    this.status.hidden = false;
    this.status.textContent = 'Preparing remote application…';
    this.manager ||= new RemoteXAppManager({ baseURL: this.getAttribute('manager-url') || '' });
    const requestedInstanceID = this.getAttribute('instance-id');
    if (requestedInstanceID) {
      this.instance = await this.manager.getInstance(requestedInstanceID);
    } else {
      const classId = this.getAttribute('class-id');
      if (!classId) throw new TypeError('class-id or instance-id is required');
      this.instance = await this.manager.createInstance({
        classId,
        profileRef: this.getAttribute('profile-ref') || undefined,
      });
      this.setAttribute('instance-id', this.instance.id);
      this.dispatchEvent(new CustomEvent('instancelaunch', { detail: { instance: this.instance }, bubbles: true, composed: true }));
    }
    this.client = new RemoteXAppClient({
      manager: this.manager,
      container: this.screen,
      instance: this.instance,
      resize: this.getAttribute('resize') || 'class',
      viewOnly: this.hasAttribute('view-only'),
      connectionMask: !this.hasAttribute('no-connection-mask'),
      autoReconnect: !this.hasAttribute('no-reconnect'),
      maxReconnectAttempts: this.hasAttribute('max-reconnect-attempts') ? Number(this.getAttribute('max-reconnect-attempts')) : undefined,
      resizeDebounce: this.hasAttribute('resize-debounce') ? Number(this.getAttribute('resize-debounce')) : undefined,
      resizeMaxWait: this.hasAttribute('resize-max-wait') ? Number(this.getAttribute('resize-max-wait')) : undefined,
      diagnosticsEnabled: this.hasAttribute('diagnostics'),
      textBatchDelay: this.hasAttribute('text-batch-delay') ? Number(this.getAttribute('text-batch-delay')) : undefined,
    });
    for (const type of forwardedEvents) {
      this.client.addEventListener(type, event => {
        if (type === 'statechange') {
          this.status.textContent = event.detail.state;
          this.status.hidden = event.detail.state === 'connected';
        }
        this.dispatchEvent(new CustomEvent(type, { detail: event.detail, bubbles: true, composed: true }));
      });
    }
    this.clipboardPrompts = new RemoteXAppClipboardPrompts(this.client, { container:this.screen });
    await this.client.connect();
    this.status.hidden = true;
    return this.client;
  }

  reconnect() { return this.client?.reconnect(); }
  disconnect() { return this.client?.disconnect(); }
  focus() { return this.client?.focus(); }
  flushResize() { return this.client?.flushResize(); }
  getDiagnostics() { return this.client?.getDiagnostics() || null; }
  setDiagnosticsEnabled(value) { return this.client?.setDiagnosticsEnabled(value); }
  refreshDiagnostics() { return this.client?.refreshDiagnostics(); }
  stopInstance() { return this.client?.stopInstance(); }
  upgradeAndRestart(options) { return this.client?.upgradeAndRestart(options); }

  _showError(error) {
    this.status.hidden = false;
    this.status.textContent = error.message;
    this.dispatchEvent(new CustomEvent('error', { detail: { error }, bubbles: true, composed: true }));
  }
}

export function registerRemoteXAppElement(name = 'remote-x-app') {
  if (!customElements.get(name)) customElements.define(name, RemoteXAppElement);
  return customElements.get(name);
}

if (globalThis.customElements) registerRemoteXAppElement();
