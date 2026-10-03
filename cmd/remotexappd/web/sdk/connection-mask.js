const css = `
:host{position:absolute;inset:0;z-index:5;display:block;contain:layout style;font:12px system-ui,sans-serif;color:#e8edf3}
:host([hidden]){display:none!important}*{box-sizing:border-box}button{font:inherit;cursor:pointer}button:focus-visible{outline:2px solid #a6ecd4;outline-offset:4px}
.curtain{height:100%;display:grid;place-items:center;overflow:auto;padding:16px;background:radial-gradient(ellipse at 50% 35%,#213638,#17232d 42%,#111b25 85%);opacity:1;transition:opacity .3s ease}
.card{text-align:center;width:100%;max-width:350px}.icon{margin:0 auto 20px;width:62px;height:62px;position:relative;display:grid;place-items:center;color:#cee8e3}.ring{position:absolute;inset:0;border:1px solid #66838644;border-top-color:#a6ecd4;border-radius:50%;animation:orbit 2.7s linear infinite}.icon svg{width:27px;height:27px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
h2{font-size:20px;font-weight:500;letter-spacing:-.035em;margin:0 0 10px}p{font-size:12px;line-height:1.6;margin:0;color:#9bafbd}.steps{display:flex;justify-content:center;gap:6px;margin:23px 0 14px}.steps i{height:3px;width:44px;border-radius:4px;background:#40516088}.steps i.on{background:#83d9bd}.foot{font-size:10px;color:#8b9da9}.actions{display:flex;justify-content:center;gap:10px;margin-top:19px}button{border:1px solid #536571;border-radius:7px;background:transparent;color:#c8d7e0;padding:8px 12px}button.retry{background:#b3f4df;color:#112921;border-color:#b3f4df}button[hidden]{display:none}.failed .ring{animation:none;border-color:#cda783}.failed .icon{color:#f2ceaa}.ready{opacity:0;pointer-events:none}@keyframes orbit{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.ring{animation:none}.curtain{transition:none}}@media(max-height:240px){.icon{width:34px;height:34px;margin-bottom:8px}.icon svg{width:18px;height:18px}.steps{margin:10px 0}.actions{margin-top:10px}h2{font-size:16px}.foot{display:none}}
`;

// Presentation is separate from transport state and never stops an application.
export class ConnectionMask {
  constructor(client) {
    this.client = client;
    this.enabled = client.connectionMask;
    this.epoch = 0;
    this.visible = false;
    this.phase = 'idle';
    this.painted = false;
  }

  mount() {
    if (this.host) return;
    const host = document.createElement('div');
    host.dataset.remotexappConnectionMask = '';
    host.hidden = true;
    Object.assign(host.style, { position:'absolute', inset:'0', zIndex:'5' });
    const root = host.attachShadow({ mode:'open' });
    root.innerHTML = `<style>${css}</style><section class="curtain"><div class="card"><div class="icon" aria-hidden="true"><div class="ring"></div><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="3"/><path d="M8 21h8m-4-4v4M7 9l3 2-3 2m6 0h4"/></svg></div><div role="status" aria-live="polite" aria-atomic="true"><h2></h2><p></p></div><div class="steps" aria-hidden="true"><i></i><i></i><i></i></div><div class="foot">Your workspace will appear when the picture is ready.</div><div class="actions"><button class="retry" hidden>Try again</button><button class="cancel">Cancel connection</button></div></div></section>`;
    this.host = host; this.root = root;
    root.querySelector('.cancel').onclick = () => this.client.disconnect();
    root.querySelector('.retry').onclick = () => {
      this.client.disconnect();
      this.client.connect().catch(() => {}); // connect reports failure to this mask.
    };
    const container = this.client.container;
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    container.append(host);
  }

  begin(reconnecting = false) {
    this.stop();
    this.phase = 'loading'; this.reconnecting = reconnecting; this.painted = false;
    this.readyInstance = null; this.expectedGeneration = null;
    if (!this.enabled) return;
    this.mount(); this.show('Establishing the connection…', 0);
    this.watch();
  }

  watch() {
    const epoch = this.epoch;
    const abort = new AbortController();
    this.abort = abort;
    this.timeout = setTimeout(() => {
      if (epoch === this.epoch) this.fail('The application or its picture did not become ready. Try again.');
    }, 45000);
    const poll = async () => {
      if (epoch !== this.epoch || this.phase !== 'loading') return;
      try {
        const id = this.client.instanceId;
        if (id) {
          const instance = await this.client.manager.getInstance(id, { signal:abort.signal });
          if (epoch !== this.epoch || id !== this.client.instanceId || this.phase !== 'loading') return;
          const status = instance.applicationStatus;
          const currentStatus = this.expectedGeneration > 0 && instance.sessionGeneration === this.expectedGeneration && status?.generation === this.expectedGeneration;
          if (['stopped','failed'].includes(instance.state) || (currentStatus && ['error','exited'].includes(status?.state))) {
            this.fail('The remote application is unavailable. Try again or disconnect.'); return;
          }
          this.readyInstance = instance;
        }
      } catch (_) { /* transient read failures remain covered until bounded timeout */ }
      if (epoch !== this.epoch || this.phase !== 'loading') return;
      this.check();
      if (this.phase === 'loading') this.pollTimer = setTimeout(poll, 500);
    };
    poll();
  }

  frame() { this.painted = true; this.check(); }

  connected() {
    this.expectedGeneration = this.client.instance?.sessionGeneration;
    this.readyInstance = this.client.instance;
    this.check();
  }

  check() {
    if (!this.enabled || this.phase !== 'loading') return;
    const connected = this.client.state === 'connected';
    const instance = this.readyInstance;
    const generation = this.expectedGeneration;
    const ready = connected && generation > 0 && instance?.id === this.client.instanceId &&
      instance.sessionGeneration === generation && instance.applicationStatus?.generation === generation &&
      instance.applicationStatus.state === 'ready' && instance.sessionState === 'running';
    if (ready && this.painted) {
      this.stop(); this.phase = 'ready'; this.visible = false;
      if (this.host) {
        this.root.querySelector('.curtain').classList.add('ready');
        this.host.style.pointerEvents = 'none';
        this.host.inert = true;
        this.fadeTimer = setTimeout(() => { if (this.phase === 'ready') this.host.hidden = true; }, 300);
      }
      this.client._emit('viewerready', { instance:this.client.instance });
    } else this.show(!connected ? 'Establishing the connection…' : !ready ? 'Starting your application…' : 'Preparing your picture…', !connected ? 0 : !ready ? 1 : 2);
  }

  show(message, step, failed = false) {
    if (!this.enabled) return;
    this.mount(); this.visible = true;
    this.host.hidden = false; this.host.inert = false; this.host.style.pointerEvents = '';
    this.root.querySelector('.curtain').className = `curtain${failed ? ' failed' : ''}`;
    this.root.querySelector('h2').textContent = failed ? 'Couldn’t connect this time' : this.reconnecting ? 'Reconnecting to your app' : 'Connecting to your app';
    this.root.querySelector('p').textContent = message;
    this.root.querySelector('.retry').hidden = !failed;
    this.root.querySelector('.cancel').textContent = failed ? 'Disconnect viewer' : 'Cancel connection';
    this.root.querySelectorAll('.steps i').forEach((el, i) => el.classList.toggle('on', !failed && i <= step));
    if (this.client.ime && document.activeElement === this.client.ime) this.client.ime.blur();
  }

  fail(message = 'The connection was interrupted. Try again.') {
    this.stop(); this.phase = 'error'; this.show(message, 0, true);
  }

  setEnabled(value) {
    if (typeof value !== 'boolean') throw new TypeError('connectionMask must be a boolean');
    if (value === this.enabled) return;
    this.enabled = value;
    if (!value) { this.stop(); this.hide(); }
    else if (this.phase === 'loading') { this.mount(); this.show('Checking your application…', 1); this.watch(); this.check(); }
    else if (this.phase === 'error') this.fail();
  }

  hide() { this.visible = false; if (this.host) { this.host.hidden = true; this.host.inert = true; } }
  stop() { this.epoch++; this.abort?.abort(); this.abort = null; clearTimeout(this.timeout); clearTimeout(this.pollTimer); clearTimeout(this.fadeTimer); }
  disconnect() { this.stop(); this.phase = 'idle'; this.hide(); }
  destroy() { this.disconnect(); this.host?.remove(); this.host = null; }
}
