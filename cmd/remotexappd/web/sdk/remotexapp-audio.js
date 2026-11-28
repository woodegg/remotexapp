import {connectAudioWorker} from './audio-worker-hub.js';
import {AudioIntentJournal} from './audio-intent-journal.js';

const boundPort = Symbol();
const resumeSpeaker = Symbol();
const resumeMicrophone = Symbol();

/** Independent audio interests: no Viewer attachment, App start or keepalive. */
export class RemoteXAppAudio extends EventTarget {
  constructor({baseURL = '', environment = globalThis, microphoneProcessing = {echoCancellation:true,noiseSuppression:true,autoGainControl:true}} = {}) {
    super(); this.env = environment; this.microphoneProcessing = {};
    for (const key of ['echoCancellation','noiseSuppression','autoGainControl']) { if (typeof microphoneProcessing[key] !== 'boolean') throw TypeError('Microphone processing flags must be booleans'); this.microphoneProcessing[key] = microphoneProcessing[key]; }
    const base = new URL(baseURL || './',environment.location.href); base.search = ''; base.hash = ''; base.pathname = base.pathname.replace(/\/$/,'');
    if (base.origin !== environment.location.origin) throw Error('Audio requires a same-origin Manager');
    if (!environment.isSecureContext || !environment.SharedWorker || !environment.MessageChannel || !environment.AudioContext || !environment.AudioWorkletNode) throw Error('Secure context, SharedWorker, MessageChannel and AudioWorklet are required');
    this.base = base.href.replace(/\/$/,''); this.requests = new Map(); this.interests = new Map(); this.next = 0; this.captureEpoch = 0; this.activating = 0; this.closed = false;
    this.workerKey = "remotexapp-audio-v7:"+this.base;
    this.stats = {connection:'idle',speakerOwner:false,micOwner:false,routes:[]};
    this.retirements = new Set(); this.retirementErrors = [];
    this.journal = new AudioIntentJournal(environment,this.base);
    this.journal.subscribe(()=>this._journalChanged());
    this._openWorker();
    this.watchdog = environment.setInterval(()=>{
      const now = Date.now(), suspended = now-this.lastWatchdogTick>5000; this.lastWatchdogTick = now;
      if (suspended) { this.lastWorkerMessage = now; this._fenceCapture(); this._wake(); return; }
      if (this.port && now-this.lastWorkerMessage>10000) this._fail('audio-worker-unresponsive');
      this._journalChanged();
      if (!this.port && this.interests.size && now >= (this.workerRetryAfter || 0) && !this.workerExhausted) this._recoverWorker();
    },1000);
    this._pagehide = event => { if (event.persisted) this._suspend(); else void this.dispose().catch(()=>{}); };
    this._suspend = () => { this._fenceCapture(); this._post({op:'suspend'}); };
    this._wake = () => {
      if (this.port) { this._post({op:'wake'}); this._post({op:'capture-eligible'}); this._journalChanged(); }
      else if (this.interests.size) this._recoverWorker();
    };
    environment.addEventListener('pagehide',this._pagehide);
    environment.addEventListener('pageshow',this._wake);
    environment.addEventListener('online',this._wake);
    environment.document?.addEventListener('visibilitychange',this._wake);
    environment.document?.addEventListener('freeze',this._suspend);
    environment.document?.addEventListener('resume',this._wake);
    environment.navigator?.mediaDevices?.addEventListener?.('devicechange',this._wake);
  }
  _workerGeneration() {
    try {
      const generation = Number(this.env.localStorage?.getItem(this.workerKey));
      return Number.isSafeInteger(generation) && generation >= 0 ? generation : 0;
    } catch { return 0; }
  }
  _openWorker(generation = this._workerGeneration()) {
    let worker;
    try { worker = this.worker = connectAudioWorker(this.env, this.base+'/sdk/audio-worker.js', this.workerKey+':'+generation); }
    catch(error){if(error.message==='audio-worker-capacity')this.workerExhausted=true;throw error;}
    const port = this.port = worker.port;
    port.onmessage = event => { if (this.port === port) this._message(event.data); };
    port.start();
    worker.onerror = () => { if (this.worker === worker) this._fail('audio-worker-ended'); };
    this.lastWorkerMessage = this.lastWatchdogTick = Date.now();
    const previous = this.binding;
    this.ready = this._request('init',{base:this.base,binding:previous || null,workerProtocol:7}).then(async contract => {
      if(contract.protocol!=='pcm-s16le-48k-v1' || contract.workerProtocol!==7) {
        this.workerExhausted=true;throw Object.assign(Error('Incompatible audio Worker assets'),{code:'audio-worker-contract'});
      }
      const current = contract.binding;
      const samePrincipal = previous?.principal && previous.principal === current?.principal;
      const principalChanged = previous?.principal && previous.principal !== current?.principal;
      const scopeChanged = previous?.service === current?.service && previous?.scope !== current?.scope && !samePrincipal;
      const loginChanged = previous?.login && previous.login !== current?.login;
      if (current && (scopeChanged || loginChanged || principalChanged)) {
        this._retireInterests();
      }
      if (current) this.binding = current;
      for (const interest of this.interests.values()) {
        await this._request('acquire',{ref:interest.ref,runtime:interest.runtime,generation:interest.generation});
        if (interest.released) await this._request('release',{ref:interest.ref});
        else interest[boundPort] = port;
      }
      this._post({op:'playback-ready',ready:this.context?.state==='running' && !!this.playback});
      for (const interest of this.interests.values()) await this._replayInterest(interest);
      return {protocol:contract.protocol};
    });
    this.ready.catch(error=>{ if (this.port === port) this._fail(error.code || 'audio-worker-init-failed'); });
  }
  async _ensureWorker() {
    if (this.closed) throw Error('Audio controller disposed');
    if (this.workerExhausted) throw Error('audio-worker-capacity');
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
      if (current >= 1 && current === generation) { this.workerExhausted = true; throw Error('audio-worker-capacity'); }
      if (current !== generation) return current;
      this.env.localStorage.setItem(this.workerKey,String(generation+1));
      return generation+1;
    });
    if (this.closed) throw Error('Audio controller disposed');
    this._openWorker(selected);
    return this.ready;
  }
  _recoverWorker() {
    if (this.closed || this.rebind || this.workerExhausted) return;
    void this._ensureWorker().then(()=>{this.workerBackoff = 0;}).catch(()=>{
      if (this.closed) return;
      this.workerBackoff = Math.min(30000,Math.max(1000,(this.workerBackoff || 500)*2));
      this.workerRetryAfter = Date.now()+this.workerBackoff;
      this.stats = {...this.stats,connection:this.workerExhausted?'blocked':'recovering'}; this._emit();
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
    const same = [...this.interests.values()].find(i=>i.runtime===instance.id && i.generation===instance.sessionGeneration);
    const interest = {runtime:instance.id,generation:instance.sessionGeneration,ref,released:false,[boundPort]:this.port,
      [resumeSpeaker]:!!same?.[resumeSpeaker],[resumeMicrophone]:!!same?.[resumeMicrophone],
      stamps:{...same?.stamps},applied:{},operations:{},pending:{},
      setSpeaker: enabled=>this._changeIntent(interest,'speaker',enabled),
      setMicrophone:(enabled,{takeover=false}={})=>this._changeIntent(interest,'microphone',enabled,takeover),
      release:()=>{
        if (interest.released) return Promise.resolve();
        interest.released = true; this.interests.delete(ref);
        const last = ![...this.interests.values()].some(i=>i.runtime===interest.runtime && i.generation===interest.generation);
        const leaving = last ? this.journal.leave(interest.runtime,interest.generation) : Promise.resolve();
        if (![...this.interests.values()].some(i=>i[resumeMicrophone])) this._captureFailed('microphone-owner-disabled');
        return Promise.all([leaving,this.port === interest[boundPort] ? this._request('release',{ref}) : Promise.resolve()]).then(()=>{});
      }
    };
    this.interests.set(ref,interest);await this._replayInterest(interest);return interest;
  }
  _locals(interest) { return [...this.interests.values()].filter(i=>i.runtime===interest.runtime && i.generation===interest.generation && !i.released); }
  _wanted(interest,kind) { return !!interest[kind==='speaker'?resumeSpeaker:resumeMicrophone]; }
  async _changeIntent(interest,kind,enabled,takeover=false) {
    if (interest.released) throw Error('Audio interest released');
    if (typeof enabled !== 'boolean') throw TypeError('Audio intent must be boolean');
    const marker = kind==='speaker'?resumeSpeaker:resumeMicrophone, revision = ++this.next;
    for (const i of this._locals(interest)) { i[marker]=enabled; i.operations[kind]=revision; i.pending[kind]=true; }
    if (kind==='microphone') interest.promptCapture = enabled;
    if (!enabled) {
      for(const i of this._locals(interest))this._post({op:'forget-intent',ref:i.ref,kind});
      if (kind==='microphone' && ![...this.interests.values()].some(i=>i[resumeMicrophone])) this._captureFailed('microphone-owner-disabled');
    }
    this.activating++;
    const preparing = enabled ? (kind==='speaker'?this._preparePlayback():this._context()) : Promise.resolve();
    preparing.catch(()=>{});
    try {
      const state = await this.journal.publish(interest.runtime,interest.generation,kind,enabled);
      if(interest.released || this.closed)throw Error('Audio context retired');
      if (interest.operations[kind]!==revision) return this._inactive(interest);
      if (!state.available) {
        this.stats = {...this.stats,reason:'intent-state-unavailable'};this._emit();
        if (enabled) throw Error('intent-state-unavailable');
        return this._inactive(interest);
      }
      for (const i of this._locals(interest)) i.stamps[kind]=state;
      await Promise.all([preparing,this._ensureWorker()]);
      if(interest.released || this.closed)throw Error('Audio context retired');
      if (interest.operations[kind]!==revision) return this._inactive(interest);
      const current = this.journal.read(interest.runtime,interest.generation,kind);
      if (!current.available || current.enabled!==enabled || current.epoch!==state.epoch || (enabled && !current.participating)) return this._inactive(interest);
      const value = await this._set(interest,kind,{enabled,intent:current,takeover:!!takeover});
      interest.applied[kind]={port:this.port,epoch:current.epoch,enabled};return value;
    } finally {
      for (const i of this._locals(interest)) if (i.operations[kind]===revision) i.pending[kind]=false;
      if (kind==='microphone') interest.promptCapture=false;
      this.activating--;
    }
  }
  async _replayInterest(interest) {
    if (interest.released || interest[boundPort]!==this.port) return;
    for (const kind of ['speaker','microphone']) {
      if (!this._wanted(interest,kind) || interest.pending[kind]) continue;
      const state=this.journal.read(interest.runtime,interest.generation,kind), stamp=interest.stamps[kind];
      if (!state.available || !state.participating || !stamp || state.epoch!==stamp.epoch) continue;
      if (interest.applied[kind]?.port===this.port && interest.applied[kind].epoch===state.epoch) continue;
      await this._set(interest,kind,{enabled:true,intent:state,automatic:true});
      interest.applied[kind]={port:this.port,epoch:state.epoch,enabled:true};
    }
  }
  _journalChanged() {
    if (this.closed || this.revoking) return;
    for (const interest of this.interests.values()) for (const kind of ['speaker','microphone']) {
      if (!this._wanted(interest,kind) || interest.pending[kind]) continue;
      const state=this.journal.read(interest.runtime,interest.generation,kind), stamp=interest.stamps[kind];
      if (!state.available || !state.revision) {
        interest.intentBlocked=true;
        delete interest.applied[kind];
        if(kind==='microphone') {
          const token=this.captureToken || this.pendingCaptureToken;
          if(token)this._post({op:'capture-failed',token,reason:'intent-state-unavailable'});
          this._fenceCapture();
        }
        continue;
      }
      if(interest.intentBlocked){interest.intentBlocked=false;this._post({op:'capture-eligible'});}
      if (!state.participating || (stamp && state.epoch!==stamp.epoch)) {
        interest[kind==='speaker'?resumeSpeaker:resumeMicrophone]=false;
        this._post({op:'forget-intent',ref:interest.ref,kind,intent:state});
      }
    }
    if (this.stream && ![...this.interests.values()].some(i=>i[resumeMicrophone])) this._captureFailed('microphone-intent-retired');
    if(this.port && !this.intentReplay && Date.now()>=(this.intentRetryAfter || 0) &&
       [...this.interests.values()].some(i=>['speaker','microphone'].some(kind=>this._wanted(i,kind) && !i.pending[kind] &&
         (i.applied[kind]?.port!==this.port || i.applied[kind]?.epoch!==i.stamps[kind]?.epoch)))) {
      this.intentReplay=(async()=>{for(const interest of this.interests.values())await this._replayInterest(interest);})();
      this.intentReplay.catch(()=>{
        this.intentBackoff=Math.min(30000,Math.max(1000,(this.intentBackoff || 500)*2));this.intentRetryAfter=Date.now()+this.intentBackoff;
      }).finally(()=>{this.intentReplay=null;});
    }
  }
  _inactive(interest) {
    return {runtime:interest.runtime,generation:interest.generation,slot:0,refs:1,domain:null,
      speaker:!!interest[resumeSpeaker],mic:false,requested:{speaker:!!interest[resumeSpeaker],microphone:!!interest[resumeMicrophone]},
      microphoneActionRequired:!!interest[resumeMicrophone],microphonePending:false,actualSpeaker:false,actualMic:false,reason:this.stats.reason || ''};
  }
  _set(interest,op,options) {
    if (interest.released) throw Error('Audio interest released');
    return this._request(op,{ref:interest.ref,...options});
  }
  _pauseCapture() {
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
  _micInterest(request) {
    return [...this.interests.values()].find(i=>!i.released && i[resumeMicrophone] &&
      i.runtime===request.runtime && i.generation===request.generation && (()=>{
        const current=this.journal.read(i.runtime,i.generation,'microphone');
        return current.available && current.participating && current.epoch===i.stamps.microphone?.epoch;
      })());
  }
  _liveSource() { return !!this.stream?.getAudioTracks?.().some(track=>track.readyState==='live'); }
  async _permission() {
    try {
      if (!this.permission) {
        const status=await this.env.navigator.permissions.query({name:'microphone'});
        if (this.closed) return null;
        this.permission=status;
        this.permissionChanged=()=>{
          if(status.state!=='granted') this._captureFailed('microphone-permission-required');
          this._wake();
        };
        status.addEventListener?.('change',this.permissionChanged);
      }
      return this.permission.state;
    } catch { return null; }
  }
  _wireCapture(token,epoch) {
    this.captureToken=token;
    this.capture.port.onmessage=({data})=>{
      if(epoch!==this.captureEpoch || this.closed) return;
      if(data.type==='pcm')this._post({op:'microphone-frame',token,delivery:data.delivery,pcm:data.pcm},[data.pcm]);
      if(data.type==='delivery-ready')this._post({op:'capture-delivery-ready',token,delivery:data.delivery});
      if(data.type==='stats'){this.captureStats=data;this._emit();}
    };
    this.capture.port.postMessage({op:'rebind'});
  }
  async _startCapture(token,request={}) {
    const interest=this._micInterest(request);
    if (!interest) {this._post({op:'capture-failed',token,reason:'microphone-intent-retired'});return;}
    if (this.captureRequest) {this._post({op:'capture-failed',token,reason:'microphone-acquisition-pending'});return;}
    const epoch=++this.captureEpoch;this.pendingCaptureToken=token;
    const canPrompt=!request.automatic && this._locals(interest).some(i=>i.promptCapture);
    if (canPrompt)for(const i of this._locals(interest))i.promptCapture=false;
    let stream;
    const acquire=(async()=>{
      try {
        const permission=await this._permission();
        if (!this._micInterest(request) || epoch!==this.captureEpoch || this.closed) return;
        const reusable=this._liveSource() && !!this.capture;
        if(permission==='denied' || (permission==='prompt' && !canPrompt)) {
          this._stopCapture();this._post({op:'capture-failed',token,reason:'microphone-permission-required'});return;
        }
        if(reusable && this.stream.getAudioTracks().some(track=>track.muted)) {
          if(permission==='granted' && this.env.document?.visibilityState!=='hidden') {
            for(const track of this.stream.getAudioTracks())if(track.readyState==='live')track.enabled=true;
          }
          this._post({op:'capture-failed',token,reason:'microphone-device-muted'});return;
        }
        if (!reusable && !canPrompt && permission!=='granted') {
          this._post({op:'capture-failed',token,reason:'microphone-permission-required'});return;
        }
        const context=await this._context();
        if (!this._micInterest(request) || epoch!==this.captureEpoch || this.closed) return;
        if (!reusable) {
          stream=await this.env.navigator.mediaDevices.getUserMedia({audio:{sampleRate:48000,channelCount:1,...this.microphoneProcessing},video:false});
          const currentPermission=await this._permission();
          if (epoch!==this.captureEpoch || this.closed || !this._micInterest(request) || currentPermission==='denied' || (!canPrompt && currentPermission!=='granted')) {
            for(const track of stream.getTracks())track.stop();return;
          }
          this.stream=stream;
          this.capture=new this.env.AudioWorkletNode(context,'remotexapp-capture-v1',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});
          this.captureSource=context.createMediaStreamSource(stream);this.captureSource.connect(this.capture);this.capture.connect(context.destination);
          for(const track of stream.getTracks()){
            track.enabled=false;track.onended=()=>this._captureFailed('microphone-device-ended');
            track.onmute=()=>{const old=this.captureToken;this._fenceCapture({disableTrack:false});if(old)this._post({op:'capture-failed',token:old,reason:'microphone-device-muted'});};
            track.onunmute=()=>this._wake();
          }
        }
        this._wireCapture(token,epoch);this._post({op:'capture-ready',token});
      } catch(error) {
        if(stream && stream!==this.stream)for(const track of stream.getTracks())track.stop();
        if(epoch===this.captureEpoch){this._stopCapture();this._post({op:'capture-failed',token,reason:error.name==='NotAllowedError'?'microphone-permission-denied':'microphone-unavailable'});}
      }
    })();
    this.captureRequest=acquire;
    try {await acquire;} finally {if(this.captureRequest===acquire)this.captureRequest=null;if(this.pendingCaptureToken===token)this.pendingCaptureToken=null;}
  }
  _fenceCapture({disableTrack=true} = {}) {
    ++this.captureEpoch;
    this.captureToken=null;this.pendingCaptureToken=null;
    if(disableTrack && this.stream)for(const track of this.stream.getTracks())track.enabled=false;
    this.capture?.port.postMessage({op:'delivery',delivery:null});
  }
  _captureFailed(reason) { const token = this.captureToken || this.pendingCaptureToken; this._stopCapture(); if(token)this._post({op:'capture-failed',token,reason}); }
  _stopCapture() {
    ++this.captureEpoch;
    if (this.stream) for (const track of this.stream.getTracks()) { track.onended = track.onmute = track.onunmute = null; track.stop(); }
    this.captureSource?.disconnect();
    // Leave only the silent processor connected until its terminal render ACK.
    // A suspended context drains at the next explicit resume, or final disposal.
    if (this.capture) this._retireProcessor(this.capture);
    this.stream = this.capture = this.captureSource = null; this.captureToken = this.pendingCaptureToken = null;
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
    if (message.type === 'capture') { void this._startCapture(message.token,message); return; }
    if (message.type === 'stop-capture') { if (!message.token || message.token===this.captureToken || message.token===this.pendingCaptureToken) this._stopCapture(); return; }
    if (message.type === 'capture-delivery') {
      if (this.captureToken !== message.token || !this.capture) return;
      if(message.delivery && this.stream.getAudioTracks().some(track=>track.muted)) {
        const token=this.captureToken;this._fenceCapture({disableTrack:false});this._post({op:'capture-failed',token,reason:'microphone-device-muted'});return;
      }
      if (message.delivery && (![...this.interests.values()].some(i=>i[resumeMicrophone] && this._micInterest({runtime:i.runtime,generation:i.generation})) || this.stream.getAudioTracks().some(track=>track.readyState!=='live'))) {
        this._captureFailed('microphone-device-unavailable');
        return;
      }
      for (const track of this.stream.getAudioTracks()) track.enabled = !!message.delivery;
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
    const replay=[...this.interests.values()].some(i=>i[resumeSpeaker]||i[resumeMicrophone]);
    for(const interest of this.interests.values())interest.applied={};
    if(replay)this._fenceCapture();else this._pauseCapture();
    this.playback?.port.postMessage({op:'reset'});
    this._closeWorker(reason);
    const replacing = replay && !this.workerExhausted;
    let lastDisconnect = this.stats.lastDisconnect;
    if (!lastDisconnect || lastDisconnect.recoveredAt != null) lastDisconnect = {at:Date.now(),code:reason,httpStatus:null};
    this.stats = {...this.stats,connection:this.workerExhausted?'blocked':replacing?'recovering':'failed',connectionId:null,protocol:null,
      playbackBlocked:false,reason,micOwner:false,speakerOwner:false,routes:this.stats.routes.map(r=>({...r,actualSpeaker:false,actualMic:false})),lastDisconnect};
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
    this.journalRetirement=this.journal.dispose({logout:true});
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
    this.closed = true;
    this.journalRetirement ||= this.journal.dispose();
    this.permission?.removeEventListener?.('change',this.permissionChanged);
    this.env.navigator?.mediaDevices?.removeEventListener?.('devicechange',this._wake);
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
      try { await Promise.all([this.journalRetirement,...[...this.retirements].map(record=>record.done)]); }
      finally {
        try { if (context) { context.onstatechange = null; if (context.state !== 'closed') await context.close(); } }
        finally { output?.disconnect(); }
      }
      if (this.retirementErrors.length) throw new AggregateError(this.retirementErrors,'Audio retirement incomplete');
    })().then(resolve,reject);
    return this.disposal;
  }
}
