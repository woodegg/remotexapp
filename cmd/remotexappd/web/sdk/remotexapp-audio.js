import {connectAudioWorker} from './audio-worker-hub.js';

const boundPort = Symbol();
const resumeSpeaker = Symbol();
const pendingSpeakerOff = Symbol();
const resumeMicrophone = Symbol();
const pendingMicrophoneOff = Symbol();

/** Independent audio interests: no Viewer attachment, App start or keepalive. */
export class RemoteXAppAudio extends EventTarget {
  constructor({baseURL = '', environment = globalThis, microphoneProcessing = {echoCancellation:true,noiseSuppression:true,autoGainControl:true}} = {}) {
    super(); this.env = environment; this.microphoneProcessing = {};
    for (const key of ['echoCancellation','noiseSuppression','autoGainControl']) { if (typeof microphoneProcessing[key] !== 'boolean') throw TypeError('Microphone processing flags must be booleans'); this.microphoneProcessing[key] = microphoneProcessing[key]; }
    const base = new URL(baseURL || './',environment.location.href); base.search = ''; base.hash = ''; base.pathname = base.pathname.replace(/\/$/,'');
    if (base.origin !== environment.location.origin) throw Error('Audio requires a same-origin Manager');
    if (!environment.isSecureContext || !environment.SharedWorker || !environment.MessageChannel || !environment.AudioContext || !environment.AudioWorkletNode) throw Error('Secure context, SharedWorker, MessageChannel and AudioWorklet are required');
    this.base = base.href.replace(/\/$/,''); this.requests = new Map(); this.interests = new Map(); this.next = 0; this.captureEpoch = 0; this.activating = 0; this.closed = false;
    this.workerKey = "remotexapp-audio-v6:"+this.base;
    this.stats = {connection:'idle',speakerOwner:false,micOwner:false,routes:[]};
    this.retirements = new Set(); this.retirementErrors = [];
    this._openWorker();
    this.watchdog = environment.setInterval(()=>{
      const now = Date.now(), suspended = now-this.lastWatchdogTick>5000; this.lastWatchdogTick = now;
      if (suspended) { this.lastWorkerMessage = now; this._pauseCapture(); this._wake(); return; }
      if (this.port && now-this.lastWorkerMessage>10000) this._fail('audio-worker-unresponsive');
    },1000);
    this._pagehide = event => { if (event.persisted) this._suspend(); else void this.dispose().catch(()=>{}); };
    this._suspend = () => { this._pauseCapture(); this._post({op:'suspend'}); };
    this._wake = () => {
      if (this.env.document?.visibilityState === 'hidden') return;
      if (this.port) this._post({op:'wake'});
      else if (this.interests.size) this._recoverWorker();
    };
    environment.addEventListener('pagehide',this._pagehide);
    environment.addEventListener('pageshow',this._wake);
    environment.addEventListener('online',this._wake);
    environment.document?.addEventListener('visibilitychange',this._wake);
    environment.document?.addEventListener('freeze',this._suspend);
    environment.document?.addEventListener('resume',this._wake);
  }
  _workerGeneration() {
    try {
      const generation = Number(this.env.localStorage?.getItem(this.workerKey));
      return Number.isSafeInteger(generation) && generation >= 0 ? generation : 0;
    } catch { return 0; }
  }
  _openWorker(generation = this._workerGeneration()) {
    const worker = this.worker = connectAudioWorker(this.env, this.base+'/sdk/audio-worker.js', this.workerKey+':'+generation);
    const port = this.port = worker.port;
    port.onmessage = event => { if (this.port === port) this._message(event.data); };
    port.start();
    worker.onerror = () => { if (this.worker === worker) this._fail('audio-worker-ended'); };
    this.lastWorkerMessage = this.lastWatchdogTick = Date.now();
    const previous = this.binding;
    this.ready = this._request('init',{base:this.base}).then(async contract => {
      const current = contract.binding;
      const samePrincipal = previous?.principal && previous.principal === current?.principal;
      const principalChanged = previous?.principal && previous.principal !== current?.principal;
      const scopeChanged = previous?.service === current?.service && previous?.scope !== current?.scope && !samePrincipal;
      const loginChanged = previous?.login && previous.login !== current?.login;
      if (scopeChanged || loginChanged || principalChanged) {
        this._retireInterests();
      }
      this.binding = current;
      for (const interest of this.interests.values()) {
        await this._request('acquire',{ref:interest.ref,runtime:interest.runtime,generation:interest.generation});
        if (interest.released) await this._request('release',{ref:interest.ref});
        else interest[boundPort] = port;
      }
      this._post({op:'playback-ready',ready:this.context?.state==='running' && !!this.playback});
      if (previous && !scopeChanged && !loginChanged && !principalChanged) {
        for (const interest of this.interests.values()) {
          if (!(interest[resumeSpeaker] || interest[resumeMicrophone]) || interest[pendingSpeakerOff]) continue;
          const enabled = !!interest[resumeSpeaker];
          interest[resumeSpeaker] = false;
          void this._set(interest,'restore-speaker',{enabled, login:current.login, microphoneRequested:!!interest[resumeMicrophone]}).catch(()=>{});
        }
      }
      return {protocol:contract.protocol};
    });
    this.ready.catch(()=>{ if (this.port === port) this._fail('audio-worker-init-failed'); });
  }
  async _ensureWorker() {
    if (this.closed) throw Error('Audio controller disposed');
    if (this.rebind) return this.rebind;
    if (this.port) return this.ready;
    const generation = this._workerGeneration();
    const next = this.rebind = this._replaceWorker(generation);
    try { return await next; } finally { if (this.rebind === next) this.rebind = null; }
  }
  async _replaceWorker(generation) {
    // A terminated worker can be recreated under its original name by any
    // page. Only an unanswered init warrants moving away from a live name.
    this._openWorker(generation);
    try { return await this.ready; } catch (error) {
      if (error.code !== 'audio-worker-init-timeout' || !this.env.navigator?.locks || this.closed) throw error;
    }
    const selected = await this.env.navigator.locks.request(this.workerKey, () => {
      const current = this._workerGeneration();
      if (current !== generation) return current;
      this.env.localStorage.setItem(this.workerKey,String(generation+1));
      return generation+1;
    });
    if (this.closed) throw Error('Audio controller disposed');
    this._openWorker(selected);
    return this.ready;
  }
  _recoverWorker() {
    void this._ensureWorker().catch(()=>{
      if (this.closed || this.port || this.stats.connection !== 'recovering') return;
      this.stats = {...this.stats,connection:'failed'};
      this._emit();
    });
  }
  _post(message,transfer) { this.port?.postMessage(message,transfer || []); }
  _request(op, values = {}) {
    if (!this.port) return Promise.reject(Error('Audio worker unavailable'));
    const request = String(++this.next);
    return new Promise((resolve,reject) => {
      const timeout = this.env.setTimeout(()=>{
        this.requests.delete(request);
        const error = Error('Audio operation timed out');
        if (op==='init') error.code = 'audio-worker-init-timeout';
        reject(error);
      },op==='init'?7000:20000);
      this.requests.set(request,{resolve,reject,timeout}); this._post({op,request,...values});
    });
  }
  async acquire(instance) {
    if (this.revoking) throw Error('Audio controller logging out');
    if (!instance?.id || !Number.isSafeInteger(instance.sessionGeneration) || instance.sessionGeneration < 1) throw TypeError('An active runtime generation is required');
    await this._ensureWorker();
    if (this.closed || this.revoking) throw Error('Audio controller disposed');
    const ref = this.env.crypto.randomUUID();
    await this._request('acquire',{ref,runtime:instance.id,generation:instance.sessionGeneration});
    if (this.closed || this.revoking) throw Error('Audio controller disposed');
    let speakerRevision = 0, micRevision = 0;
    const interest = {
      runtime:instance.id,generation:instance.sessionGeneration,ref,released:false,[boundPort]:this.port,
      setSpeaker: enabled => {
        if (interest.released) return Promise.reject(Error('Audio interest released'));
        const revision = ++speakerRevision;
        interest[resumeSpeaker] = false;
        interest[pendingSpeakerOff] = !enabled;
        if (!enabled) return this._disable(interest,'speaker').then(state=>{
          if (revision === speakerRevision && !state?.speaker) interest[pendingSpeakerOff] = false;
          return state;
        });
        this.activating++;
        const preparing = this._preparePlayback();
        return Promise.all([preparing,this._ensureWorker()]).then(()=>{return revision === speakerRevision ? this._set(interest,'speaker',{enabled:true}) : this._inactive(interest);}).finally(()=>{this.activating--;});
      },
      setMicrophone: (enabled,{takeover=false}={}) => {
        if (interest.released) return Promise.reject(Error('Audio interest released'));
        const revision = ++micRevision;
        interest[resumeMicrophone] = !!enabled;
        if (!enabled) {
          this.captureAllowed = false;
          interest[pendingMicrophoneOff] = true;
          return this._disable(interest,'microphone').then(state => {
            if (revision === micRevision) interest[pendingMicrophoneOff] = false;
            return state;
          });
        }
        interest[pendingMicrophoneOff] = false;
        this.activating++; this.captureAllowed = true;
        return Promise.all([this._context(),this._ensureWorker()]).then(()=>{return revision === micRevision && this.captureAllowed ? this._set(interest,'microphone',{enabled:true,takeover:!!takeover}) : this._inactive(interest);}).finally(()=>{if (revision === micRevision) this.captureAllowed = false; this.activating--;});
      },
      release: () => {
        if (interest.released) return Promise.resolve();
        interest.released = true; this.interests.delete(ref);
        return this.port && this.port === interest[boundPort] ? this._request('release',{ref}) : Promise.resolve();
      }
    };
    this.interests.set(ref,interest); return interest;
  }
  async _disable(interest,op) {
    if (this.port && this.port === interest[boundPort]) return this._set(interest,op,{enabled:false});
    if (op==='speaker') {
      await this._ensureWorker();
      if (!interest.released) return this._set(interest,op,{enabled:false});
    }
    return this._inactive(interest);
  }
  _inactive(interest) {
    return {runtime:interest.runtime,generation:interest.generation,slot:0,refs:1,domain:null,
      speaker:false,mic:false,requested:{speaker:false,microphone:!!interest[resumeMicrophone]},
      microphoneActionRequired:!!interest[resumeMicrophone],
      actualSpeaker:false,actualMic:false,reason:this.stats.reason || ''};
  }
  _set(interest,op,options) {
    if (interest.released) throw Error('Audio interest released');
    return this._request(op,{ref:interest.ref,...options});
  }
  _pauseCapture() {
    this.captureAllowed = false;
    if (this.stream) this._captureFailed('microphone-owner-suspended');
    else this._stopCapture();
  }
  async _context() {
    if (this.closed || this.revoking) throw Error('Audio controller disposed');
    if (!this.context) {
      const context = this.context = new this.env.AudioContext({sampleRate:48000,latencyHint:'interactive'});
      if (context.sampleRate !== 48000) { await context.close(); this.context = null; throw Error('48 kHz audio context unavailable'); }
      this.module = context.audioWorklet.addModule(this.base+'/sdk/audio-worklet.js');
      this.output = context.createGain(); this.output.connect(context.destination);
      context.onstatechange = () => { if (this.closed || this.context !== context) return; this._post({op:'playback-ready',ready:context.state==='running' && !!this.playback}); if (this.stream && context.state !== 'running') this._captureFailed('audio-context-suspended'); };
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
      this.playback.connect(this.output);
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
        if (data.type === 'pcm') this._post({op:'microphone-frame',token,delivery:data.delivery,pcm:data.pcm},[data.pcm]);
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
    this.captureSource?.disconnect();
    // Leave only the silent processor connected until its terminal render ACK.
    // A suspended context drains at the next explicit resume, or final disposal.
    if (this.capture) this._retireProcessor(this.capture);
    this.stream = this.capture = this.captureSource = null; this.captureToken = null;
  }
  _retireProcessor(node) {
    const context = this.context;
    let resolve, timer;
    const record = {done:new Promise(r=>{resolve=r;}), arm:()=>{
      timer ??= this.env.setTimeout(()=>finish(false),1000);
    }};
    const changed = () => {
      if (context?.state === 'running') record.arm();
      else if (context?.state === 'closed') finish(false);
      else if (!this.closed) { this.env.clearTimeout(timer); timer = undefined; }
    };
    const finish = acknowledged => {
      if (!this.retirements.delete(record)) return;
      this.env.clearTimeout(timer);
      context?.removeEventListener?.('statechange',changed);
      node.port.onmessage = null; node.disconnect(); node.port.close();
      if (!acknowledged) this.retirementErrors.push(Error('Audio processor retirement timed out'));
      resolve();
    };
    this.retirements.add(record);
    node.port.onmessage = ({data}) => { if (data.type === 'disposed') finish(true); };
    context?.addEventListener?.('statechange',changed);
    node.port.postMessage({op:'dispose'});
    if (this.closed || context?.state === 'running') record.arm();
    return record.done;
  }
  _message(message) {
    this.lastWorkerMessage = Date.now();
    if (message.reply) { const pending = this.requests.get(message.reply); if (!pending) return; this.requests.delete(message.reply); this.env.clearTimeout(pending.timeout); message.error ? pending.reject(Error(message.error)) : pending.resolve(message.value); return; }
    if (message.type === 'ping') { this._post({op:'pong'}); return; }
    if (message.type === 'capture') { void this._startCapture(message.token); return; }
    if (message.type === 'stop-capture') { this._stopCapture(); return; }
    if (message.type === 'capture-delivery') {
      if (this.captureToken !== message.token || !this.capture) return;
      if (message.delivery && this.stream.getAudioTracks().some(track=>track.readyState!=='live' || track.muted)) {
        this._captureFailed('microphone-device-unavailable');
        return;
      }
      this.capture.port.postMessage({op:'delivery',delivery:message.delivery});
      return;
    }
    if (message.type === 'microphone-credit') { this.capture?.port.postMessage({op:'credit'}); return; }
    if (message.type === 'playback') {
      if (this.playback && this.context?.state === 'running') this.playback.port.postMessage({op:'frame',slot:message.slot,pcm:message.pcm},[message.pcm]);
      else this._post({op:'playback-credit'});
      return;
    }
    if (message.type === 'remove-playback') { this.playback?.port.postMessage({op:'remove',slot:message.slot}); return; }
    if (message.type === 'reset-playback') { this.playback?.port.postMessage({op:'reset'}); return; }
    if (message.type === 'binding') { this.binding = message.binding; return; }
    if (message.type === 'retired') this._retireInterests();
    if (message.type === 'state') {
      let lastDisconnect = message.lastDisconnect;
      if (this.stats.lastDisconnect && (!lastDisconnect || this.stats.lastDisconnect.at > lastDisconnect.at ||
          (this.stats.lastDisconnect.at === lastDisconnect.at && this.stats.lastDisconnect.recoveredAt != null))) {
        lastDisconnect = this.stats.lastDisconnect;
      }
      if (lastDisconnect && lastDisconnect.recoveredAt == null && message.routes.some(r=>r.actualSpeaker||r.actualMic)) {
        const recoveredAt = Date.now();
        lastDisconnect = {...lastDisconnect,recoveredAt,durationMs:Math.max(0,recoveredAt-lastDisconnect.at)};
      }
      this.stats = {...message,...(lastDisconnect ? {lastDisconnect} : {})};
      if (!this.activating && !this.rebind && !this.requests.size && message.routes.every(r=>!r.speaker&&!r.mic) && !this.stream && this.context?.state === 'running') { this.playback?.port.postMessage({op:'reset'}); void this.context.suspend(); }
      this._emit();
    }
  }
  _retireInterests() {
    for (const interest of this.interests.values()) interest.released = true;
    this.interests.clear();
    this._pauseCapture();
    this.playback?.port.postMessage({op:'reset'});
  }
  _emit() { this.dispatchEvent(new CustomEvent('statechange',{detail:{...this.stats,playback:this.playbackStats,microphone:this.captureStats}})); }
  _fail(reason) {
    if (!this.port) return;
    let replay = false;
    for (const interest of this.interests.values()) {
      const route = this.stats.routes.find(r=>r.runtime===interest.runtime && r.generation===interest.generation);
      if (route?.speaker && !interest[pendingSpeakerOff]) interest[resumeSpeaker] = true;
      if (route) interest[resumeMicrophone] = !interest[pendingMicrophoneOff] &&
        !!(route.requested?.microphone ?? route.mic);
      replay ||= !!interest[resumeSpeaker] || !!interest[resumeMicrophone];
    }
    this._pauseCapture();
    this.playback?.port.postMessage({op:'reset'});
    this._closeWorker(reason);
    const replacing = replay && reason !== 'audio-worker-init-failed';
    let lastDisconnect = this.stats.lastDisconnect;
    if (!lastDisconnect || lastDisconnect.recoveredAt != null) lastDisconnect = {at:Date.now(),code:reason,httpStatus:null};
    this.stats = {...this.stats,connection:replacing?'recovering':'failed',connectionId:null,protocol:null,
      playbackBlocked:false,reason,micOwner:false,speakerOwner:false,routes:[],lastDisconnect};
    this._emit();
    if (replacing) this._recoverWorker();
  }
  _closeWorker(reason) {
    this._post({op:'dispose'});
    if (this.port) { this.port.onmessage = null; this.port.close(); }
    if (this.worker) this.worker.release();
    this.worker = this.port = null;
    for (const pending of this.requests.values()) { this.env.clearTimeout(pending.timeout); pending.reject(Error(reason)); }
    this.requests.clear();
  }
  logout() {
    if (this.closed) return this.disposal;
    if (this.revoking) return this.revoking;
    this._retireInterests();
    if (this.output) this.output.gain.value = 0;
    this.revoking = (async()=>{
      try { await this._ensureWorker(); await this._request('logout'); }
      finally { await this.dispose(); }
    })();
    this.revoking.catch(()=>{});
    return this.revoking;
  }
  dispose() {
    if (this.disposal) return this.disposal;
    let resolve, reject;
    this.disposal = new Promise((done,failed)=>{resolve=done;reject=failed;});
    // Unload callers cannot await. Explicit callers still receive the rejection.
    this.disposal.catch(()=>{});
    this.closed = true; this.captureAllowed = false;
    if (this.output) this.output.gain.value = 0;
    this._pauseCapture(); this._closeWorker('Audio controller disposed'); this.env.clearInterval(this.watchdog);
    if (this.playback) this._retireProcessor(this.playback);
    const context = this.context, output = this.output;
    this.context = this.output = this.playback = this.module = null;
    this.env.removeEventListener('pagehide',this._pagehide);
    this.env.removeEventListener('pageshow',this._wake);
    this.env.removeEventListener('online',this._wake);
    this.env.document?.removeEventListener('visibilitychange',this._wake);
    this.env.document?.removeEventListener('freeze',this._suspend);
    this.env.document?.removeEventListener('resume',this._wake);
    for (const interest of this.interests.values()) interest.released = true; this.interests.clear();
    // A suspended graph cannot execute process(false). Drain only the existing
    // muted graph, after capture revocation; never ask for a device or gesture.
    // resume may remain pending under autoplay policy, so it is not awaited.
    for (const retirement of this.retirements) retirement.arm();
    if (context?.state === 'suspended' && this.retirements.size) void context.resume().catch(()=>{});
    void (async()=>{
      try { await Promise.all([...this.retirements].map(record=>record.done)); }
      finally {
        try { if (context) { context.onstatechange = null; if (context.state !== 'closed') await context.close(); } }
        finally { output?.disconnect(); }
      }
      if (this.retirementErrors.length) throw new AggregateError(this.retirementErrors,'Audio retirement incomplete');
    })().then(resolve,reject);
    return this.disposal;
  }
}
