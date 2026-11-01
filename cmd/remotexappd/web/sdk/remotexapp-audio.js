/** Independent audio interests: no Viewer attachment, App start or keepalive. */
export class RemoteXAppAudio extends EventTarget {
  constructor({baseURL = '', environment = globalThis, microphoneProcessing = {echoCancellation:true,noiseSuppression:true,autoGainControl:true}} = {}) {
    super(); this.env = environment; this.microphoneProcessing = {};
    for (const key of ['echoCancellation','noiseSuppression','autoGainControl']) { if (typeof microphoneProcessing[key] !== 'boolean') throw TypeError('Microphone processing flags must be booleans'); this.microphoneProcessing[key] = microphoneProcessing[key]; }
    const base = new URL(baseURL || './',environment.location.href); base.search = ''; base.hash = ''; base.pathname = base.pathname.replace(/\/$/,'');
    if (base.origin !== environment.location.origin) throw Error('Audio requires a same-origin Manager');
    if (!environment.isSecureContext || !environment.SharedWorker || !environment.AudioContext || !environment.AudioWorkletNode) throw Error('Secure context, SharedWorker and AudioWorklet are required');
    this.base = base.href.replace(/\/$/,''); this.requests = new Map(); this.interests = new Map(); this.next = 0; this.captureEpoch = 0; this.activating = 0; this.closed = false;
    this.worker = new environment.SharedWorker(this.base+'/sdk/audio-worker.js',{type:'module',name:'remotexapp-audio-v1:'+this.base});
    this.port = this.worker.port; this.port.onmessage = event => this._message(event.data); this.port.start();
    this.worker.onerror = () => this._fail('audio-worker-ended');
    this._pagehide = () => this.dispose(); environment.addEventListener('pagehide',this._pagehide);
    this.ready = this._request('init',{base:this.base});
    this.stats = {connection:'idle',speakerOwner:false,micOwner:false,routes:[]};
  }
  _post(message,transfer) { if (!this.closed) this.port.postMessage(message,transfer || []); }
  _request(op, values = {}) {
    if (this.closed) return Promise.reject(Error('Audio controller disposed'));
    const request = String(++this.next);
    return new Promise((resolve,reject) => {
      const timeout = this.env.setTimeout(()=>{this.requests.delete(request);reject(Error('Audio operation timed out'));},20000);
      this.requests.set(request,{resolve,reject,timeout}); this._post({op,request,...values});
    });
  }
  async acquire(instance) {
    if (!instance?.id || !Number.isSafeInteger(instance.sessionGeneration) || instance.sessionGeneration < 1) throw TypeError('An active runtime generation is required');
    await this.ready;
    const ref = this.env.crypto.randomUUID();
    await this._request('acquire',{ref,runtime:instance.id,generation:instance.sessionGeneration});
    const interest = {
      runtime:instance.id,generation:instance.sessionGeneration,ref,released:false,
      setSpeaker: enabled => { if (interest.released) return Promise.reject(Error('Audio interest released')); this.activating++; const preparing = enabled ? this._preparePlayback() : Promise.resolve(); return preparing.then(()=>this._request('speaker',{ref,enabled:!!enabled})).finally(()=>{this.activating--;}); },
      setMicrophone: (enabled,{takeover=false}={}) => { if (interest.released) return Promise.reject(Error('Audio interest released')); this.activating++; this.captureAllowed = !!enabled; const preparing = enabled ? this._context() : Promise.resolve(); return preparing.then(()=>this._request('microphone',{ref,enabled:!!enabled,takeover:!!takeover})).finally(()=>{this.captureAllowed = false;this.activating--;}); },
      release: () => { if (interest.released) return Promise.resolve(); interest.released = true; this.interests.delete(ref); return this._request('release',{ref}); }
    };
    this.interests.set(ref,interest); return interest;
  }
  async _context() {
    if (!this.context) {
      const context = this.context = new this.env.AudioContext({sampleRate:48000,latencyHint:'interactive'});
      if (context.sampleRate !== 48000) { await context.close(); this.context = null; throw Error('48 kHz audio context unavailable'); }
      this.module = context.audioWorklet.addModule(this.base+'/sdk/audio-worklet.js');
      context.onstatechange = () => { this._post({op:'playback-ready',ready:context.state==='running' && !!this.playback}); if (this.stream && context.state !== 'running') this._captureFailed('audio-context-suspended'); };
    }
    const context = this.context;
    // resume() is called synchronously from the original speaker/mic gesture.
    const resumed = context.resume(); await this.module; await resumed;
    if (this.closed || this.context !== context) throw Error('Audio context retired');
    if (context.state !== 'running') throw Error('Audio playback requires a user gesture');
    return context;
  }
  async _preparePlayback() {
    const context = await this._context();
    if (!this.playback) {
      this.playback = new this.env.AudioWorkletNode(context,'remotexapp-playback-v1',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2]});
      this.playback.port.onmessage = ({data}) => {
        if (data.type === 'credit') this._post({op:'playback-credit'});
        if (data.type === 'stats') { this.playbackStats = data; this._emit(); }
      };
      this.playback.connect(context.destination);
    }
    this._post({op:'playback-ready',ready:true});
  }
  async _startCapture(token) {
    if (!this.captureAllowed) { this._post({op:'capture-failed',token,reason:'explicit-microphone-action-required'}); return; }
    const epoch = ++this.captureEpoch;
    let stream;
    try {
      const contextPromise = this._context();
      contextPromise.catch(()=>{});
      // Only this explicit user action can request permission; recovery never does.
      stream = await this.env.navigator.mediaDevices.getUserMedia({audio:{sampleRate:48000,channelCount:1,...this.microphoneProcessing},video:false});
      const context = await contextPromise;
      if (epoch !== this.captureEpoch || this.closed || !this.captureAllowed) { for (const track of stream.getTracks()) track.stop(); return; }
      this.stream = stream; this.captureToken = token;
      this.capture = new this.env.AudioWorkletNode(context,'remotexapp-capture-v1',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});
      this.capture.port.onmessage = ({data}) => {
        if (epoch !== this.captureEpoch) return;
        if (data.type === 'pcm') this._post({op:'microphone-frame',token,pcm:data.pcm},[data.pcm]);
        if (data.type === 'stats') { this.captureStats = data; this._emit(); }
      };
      for (const track of stream.getTracks()) { track.onended = () => this._captureFailed('microphone-device-ended'); track.onmute = () => this._captureFailed('microphone-device-muted'); }
      this.captureSource = context.createMediaStreamSource(stream); this.captureSource.connect(this.capture); this.capture.connect(context.destination);
      this._post({op:'capture-ready',token});
    } catch (error) {
      if (stream) for (const track of stream.getTracks()) track.stop();
      if (epoch === this.captureEpoch) { this._stopCapture(); this._post({op:'capture-failed',token,reason:error.name==='NotAllowedError'?'microphone-permission-denied':'microphone-unavailable'}); }
    }
  }
  _captureFailed(reason) { const token = this.captureToken; this._stopCapture(); this._post({op:'capture-failed',token,reason}); }
  _stopCapture() {
    ++this.captureEpoch;
    if (this.stream) for (const track of this.stream.getTracks()) { track.onended = track.onmute = null; track.stop(); }
    this.captureSource?.disconnect(); this.capture?.disconnect();
    if (this.capture) this.capture.port.onmessage = null;
    this.stream = this.capture = this.captureSource = null; this.captureToken = null;
  }
  _message(message) {
    if (message.reply) { const pending = this.requests.get(message.reply); if (!pending) return; this.requests.delete(message.reply); this.env.clearTimeout(pending.timeout); message.error ? pending.reject(Error(message.error)) : pending.resolve(message.value); return; }
    if (message.type === 'ping') { this._post({op:'pong'}); return; }
    if (message.type === 'capture') { void this._startCapture(message.token); return; }
    if (message.type === 'stop-capture') { this._stopCapture(); return; }
    if (message.type === 'microphone-credit') { this.capture?.port.postMessage({op:'credit'}); return; }
    if (message.type === 'playback') {
      if (this.playback && this.context?.state === 'running') this.playback.port.postMessage({op:'frame',slot:message.slot,pcm:message.pcm},[message.pcm]);
      else this._post({op:'playback-credit'});
      return;
    }
    if (message.type === 'remove-playback') { this.playback?.port.postMessage({op:'remove',slot:message.slot}); return; }
    if (message.type === 'reset-playback') { this.playback?.port.postMessage({op:'reset'}); return; }
    if (message.type === 'retired') { for (const interest of this.interests.values()) interest.released = true; this.interests.clear(); this._stopCapture(); this.playback?.port.postMessage({op:'reset'}); }
    if (message.type === 'state') { this.stats = message; if (!this.activating && !this.requests.size && message.routes.every(r=>!r.speaker&&!r.mic) && !this.stream && this.context?.state === 'running') { this.playback?.port.postMessage({op:'reset'}); void this.context.suspend(); } this._emit(); }
  }
  _emit() { this.dispatchEvent(new CustomEvent('statechange',{detail:{...this.stats,playback:this.playbackStats,microphone:this.captureStats}})); }
  _fail(reason) { this._stopCapture(); this.playback?.port.postMessage({op:'reset'}); this.stats = {...this.stats,connection:'failed',reason,micOwner:false,speakerOwner:false}; this._emit(); }
  async logout() { await this.ready; return this._request('logout'); }
  dispose() {
    if (this.closed) return;
    this._post({op:'dispose'}); this._stopCapture(); this.closed = true;
    this.playback?.disconnect(); if (this.context) void this.context.close();
    this.context = null; this.port.close(); this.env.removeEventListener('pagehide',this._pagehide);
    for (const pending of this.requests.values()) { this.env.clearTimeout(pending.timeout); pending.reject(Error('Audio controller disposed')); }
    this.requests.clear(); for (const interest of this.interests.values()) interest.released = true; this.interests.clear();
  }
}
