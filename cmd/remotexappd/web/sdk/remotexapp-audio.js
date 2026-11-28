import {connectAudioWorker} from './audio-worker-hub.js';
import {AudioIntentJournal} from './audio-intent-journal.js';
import {AudioContextOperations} from './audio-context-operations.js';
import {AudioGraphRealm} from './audio-graph-realm.js';

const boundPort = Symbol();
const resumeSpeaker = Symbol();
const resumeMicrophone = Symbol();
// DOMException.code is a legacy number, not an SDK diagnostic string.
const contextCode = error => typeof error?.code==='string' && error.code.startsWith('audio-context-') ? error.code : null;

/** Independent audio interests: no Viewer attachment, App start or keepalive. */
export class RemoteXAppAudio extends EventTarget {
  constructor({baseURL = '', environment = globalThis, microphoneProcessing = {echoCancellation:true,noiseSuppression:true,autoGainControl:true}} = {}) {
    super(); this.env = environment; this.microphoneProcessing = {};
    for (const key of ['echoCancellation','noiseSuppression','autoGainControl']) { if (typeof microphoneProcessing[key] !== 'boolean') throw TypeError('Microphone processing flags must be booleans'); this.microphoneProcessing[key] = microphoneProcessing[key]; }
    const base = new URL(baseURL || './',environment.location.href); base.search = ''; base.hash = ''; base.pathname = base.pathname.replace(/\/$/,'');
    if (base.origin !== environment.location.origin) throw Error('Audio requires a same-origin Manager');
    if (!environment.isSecureContext || !environment.SharedWorker || !environment.MessageChannel || !environment.AudioContext || !environment.AudioWorkletNode) throw Error('Secure context, SharedWorker, MessageChannel and AudioWorklet are required');
    this.base = base.href.replace(/\/$/,''); this.requests = new Map(); this.interests = new Map(); this.next = 0; this.captureEpoch = 0; this.activating = 0; this.closed = false;
    this.workerKey = "remotexapp-audio-v8:"+this.base;
    this.stats = {connection:'idle',speakerOwner:false,micOwner:false,routes:[]};
    this.retirements = new Set(); this.retirementErrors = [];
    this.contextOps=new AudioContextOperations(environment,(_context,_kind,late)=>{
      if(late && this.graphReason && !this.closed){this.graphWake=true;this.graphRetryAfter=0;this._recoverGraph();}
    },3000,this.base);
    this.journal = new AudioIntentJournal(environment,this.base);
    this.journal.subscribe(()=>this._journalChanged());
    this._openWorker();
    this.watchdog = environment.setInterval(()=>{
      const now = Date.now(), suspended = now-this.lastWatchdogTick>5000; this.lastWatchdogTick = now;
      if (suspended) { this.lastWorkerMessage = now; this._fenceCapture(); this._wake(); return; }
      if(this.port && this.workerGeneration!==this._workerGeneration())this._fail('audio-worker-superseded');
      if (this.port && now-this.lastWorkerMessage>10000) this._fail('audio-worker-unresponsive');
      this._journalChanged();
      this._observeGraph();
      this._recoverGraph();
      if (!this.port && this.interests.size && now >= (this.workerRetryAfter || 0) && !this.workerExhausted) this._recoverWorker();
    },1000);
    this._pagehide = event => { if (event.persisted) this._suspend(); else void this.dispose().catch(()=>{}); };
    this._suspend = () => { this._fenceCapture(); this._post({op:'suspend'}); };
    this._wake = () => {
      this._observeGraph();
      this._recoverGraph();
      if(this.port && this.workerGeneration!==this._workerGeneration())this._fail('audio-worker-superseded');
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
      return Number.isSafeInteger(generation) && generation >= 0 && generation<=1 ? generation : 0;
    } catch { return 0; }
  }
  _openWorker(generation = this._workerGeneration(),options = {}) {
    let worker;
    try { worker = this.worker = connectAudioWorker(this.env, this.base+'/sdk/audio-worker.js', this.workerKey+':'+generation,options); }
    catch(error){if(error.message==='audio-worker-capacity')this.workerExhausted=true;throw error;}
    const port = this.port = worker.port;
    this.workerGeneration=generation;
    const currentPort=()=>{if(this.closed || this.port!==port)throw Object.assign(Error('audio-worker-superseded'),{code:'audio-worker-superseded'});};
    port.onmessage = event => { if (this.port === port) this._message(event.data); };
    port.start();
    worker.onerror = () => { if (this.worker === worker) this._fail('audio-worker-ended'); };
    this.lastWorkerMessage = this.lastWatchdogTick = Date.now();
    const previous = this.binding;
    this.ready = this._request('init',{base:this.base,binding:previous || null,workerProtocol:8,sourceLive:this._liveSource()}).then(async contract => {
      currentPort();
      if(contract.protocol!=='pcm-s16le-48k-v1' || contract.workerProtocol!==8) {
        this.workerExhausted=true;throw Object.assign(Error('Incompatible audio Worker assets'),{code:'audio-worker-contract'});
      }
      try{worker.confirm(contract.workerId);}catch(error){if(error.code==='audio-worker-contract')this.workerExhausted=true;throw error;}
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
        currentPort();
        await this._request('acquire',{ref:interest.ref,runtime:interest.runtime,generation:interest.generation});
        currentPort();
        if (interest.released) await this._request('release',{ref:interest.ref});
        else interest[boundPort] = port;
      }
      currentPort();
      this._post({op:'playback-ready',ready:this.context?.state==='running' && !!this.playback});
      for (const interest of this.interests.values()) await this._replayInterest(interest);
      currentPort();
      return {protocol:contract.protocol};
    });
    this.ready.catch(error=>{ if (this.port === port) this._fail(error.code || 'audio-worker-init-failed'); });
    return worker;
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
    for(let slot=generation;slot<=1;){
      let attempt,error;
      try {attempt=this._openWorker(slot);return await this.ready;}catch(e){error=e;}
      if(error.code==='audio-worker-init-timeout' && !this.closed) {
        try {this._openWorker(slot,{probeOf:attempt});return await this.ready;}catch(e){error=e;}
      }
      if(!['audio-worker-init-timeout','audio-worker-probe-exhausted'].includes(error.code) || this.closed)throw error;
      const selected=await this.env.navigator.locks.request(this.workerKey,()=>{
        const current=this._workerGeneration();
        if(current!==slot)return current;
        if(slot>=1){this.workerExhausted=true;throw Error('audio-worker-capacity');}
        this.env.localStorage.setItem(this.workerKey,'1');return 1;
      });
      if(this.closed)throw Error('Audio controller disposed');
      slot=selected;
    }
    this.workerExhausted=true;throw Error('audio-worker-capacity');
  }
  _recoverWorker() {
    if (this.closed || this.rebind || this.workerExhausted) return;
    void this._ensureWorker().then(()=>{this.workerBackoff = 0;}).catch(error=>{
      if (this.closed) return;
      this.workerBackoff = Math.min(30000,Math.max(1000,(this.workerBackoff || 500)*2));
      this.workerRetryAfter = Date.now()+this.workerBackoff;
      this.stats = {...this.stats,connection:this.workerExhausted?'blocked':'recovering',reason:error.message}; this._emit();
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
    const gesture=this.env.navigator?.userActivation?.isActive===true;
    const allowed=()=>!interest.released && !this.closed && this._wanted(interest,kind) && interest.operations[kind]===revision;
    const preparing = enabled ? (kind==='speaker'?this._preparePlayback({gesture,allowed}):this._context({gesture})) : Promise.resolve();
    preparing.catch(error=>{if(allowed() && !this.graphReason)this._graphFault(contextCode(error) || 'audio-context-unavailable');});
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
      // Off is already fenced locally and committed for the other owners. A
      // dead/rebinding Worker must not turn that cancellation into a failure or
      // require another Worker merely to cancel an integration.
      if(!enabled && (!this.port || this.rebind))return this._inactive(interest);
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
  _graphIntent(kind) {
    return [...this.interests.values()].some(i=>!i.released && this._wanted(i,kind) && (()=>{
      const state=this.journal.read(i.runtime,i.generation,kind);
      return state.available && state.participating && state.epoch===i.stamps[kind]?.epoch;
    })());
  }
  _graphFault(reason,{retire=false} = {}) {
    if(this.closed)return;
    this.graphReason=reason;if(retire)this.graphInvalid=true;
    const token=this.captureToken || this.pendingCaptureToken;
    this._fenceCapture();
    this.playback?.port.postMessage({op:'reset'});
    this._post({op:'playback-ready',ready:false});
    if(token)this._post({op:'capture-failed',token,reason,retainedSource:this._liveSource()});
  }
  _observeGraph() {
    if(this.closed || !this.context || this.graphInvalid)return;
    if(this.graphRealm && !this.graphRealm.live || this.context.state==='closed')this._graphFault('audio-context-realm-lost',{retire:true});
    else if(this.context.state!=='running' && !this.graphReason && (this._graphIntent('speaker') || this._graphIntent('microphone')))this._graphFault('audio-context-'+this.context.state);
  }
  _processorError(kind,node,context) {
    if(this.closed || this[kind]!==node || this.context!==context)return;
    const reason='audio-'+kind+'-processor-failed';
    if(kind==='capture'){
      const token=this.captureToken || this.pendingCaptureToken;
      this._fenceCapture();this.captureSource?.disconnect();this.captureSource=null;
      if(token)this._post({op:'capture-failed',token,reason,retainedSource:this._liveSource()});
    }else this._post({op:'playback-ready',ready:false});
    this[kind]=null;
    node.onprocessorerror=null;node.port.onmessage=null;node.disconnect();node.port.close();
    // The native processorerror already stopped this processor. Replacing the
    // whole Context would unnecessarily terminate its healthy sibling graph.
    if(!this.graphInvalid)this.graphReason=reason;
    this._recoverGraph();
  }
  _recoverGraph() {
    if(this.closed || this.revoking || this.activating || this.graphRecovery ||
       Date.now()<(this.graphRetryAfter || 0))return;
    const speaker=this._graphIntent('speaker'),mic=this._graphIntent('microphone');
    if(!this.graphInvalid && (!this.graphReason || !speaker && !mic))return;
    this.graphWake=false;
    this.graphRecovery=Promise.resolve().then(async()=>{
      if(this.graphInvalid)await this._discardGraph();
      if(this.closed || this.revoking)return;
      if(this._graphIntent('speaker'))await this._preparePlayback();
      else if(this._graphIntent('microphone'))await this._context();
      else return;
      this.graphReason=null;this.graphBackoff=0;this._post({op:'capture-eligible'});
    });
    this.graphRecovery.catch(error=>{
      if(this.closed)return;
      this.graphReason=contextCode(error) || error.message;
      this.graphBackoff=Math.min(30000,Math.max(1000,(this.graphBackoff || 500)*2));
      this.graphRetryAfter=Date.now()+this.graphBackoff;this._emit();
    }).finally(()=>{
      this.graphRecovery=null;
      if(this.graphWake){this.graphWake=false;this.graphRetryAfter=0;this._recoverGraph();}
    });
  }
  _discardGraph() {
    if(this.graphDisposal)return this.graphDisposal;
    const context=this.context;
    const realm=this.graphRealm;
    if(!context){realm?.retire();this.graphRealm=null;this.graphInvalid=false;return Promise.resolve();}
    const graph={context,realm,output:this.output,source:this.captureSource,nodes:[this.playback,this.capture].filter(Boolean)};
    this.playback=this.capture=this.captureSource=null;
    const disposal=this.graphDisposal=(async()=>{
      const pending=await this._releaseGraph(graph);
      if(this.context===context){this.context=this.output=this.module=this.graphRealm=null;}
      if(pending && !this.closed)this.graphQuarantine=context;
      this.graphInvalid=false;
    })();
    // Observe the finally branch as well: no detached rejected cleanup Promise.
    disposal.finally(()=>{if(this.graphDisposal===disposal)this.graphDisposal=null;}).catch(()=>{});
    return disposal;
  }
  async _releaseGraph({context,realm,output,source,nodes=[]}) {
    if(!context){realm?.retire();return false;}
    this.contextOps.retire(context);context.onstatechange=null;
    if(output)output.gain.value=0;
    source?.disconnect();
    const records=new Set([...this.retirements].filter(r=>r.context===context));
    for(const node of new Set(nodes))records.add(this._retireProcessor(node,{context,realm}));
    let failure;
    try {
      if(context.state!=='closed'){
        for(const record of records)record.arm();
        if(context.state==='suspended' && records.size)this.contextOps.run(context,'resume',()=>context.resume()).catch(()=>{});
        await Promise.all([...records].map(record=>record.done));
        await this.contextOps.run(context,'close',()=>context.close());
      }
    }catch(error){failure=error;}
    finally {
      if(realm){
        // closed is not native retirement proof. Destroy the owned execution
        // environment even when its Worklet can no longer execute a render ACK.
        realm.retire();this.contextOps.releaseRealm(context,realm);
        for(const record of records)record.finish('realm-retired');
        this.retirementErrors=this.retirementErrors.filter(error=>error.realm!==realm);
        if(failure || [...records].some(r=>r.proof!==true))this.graphRetirementFallbacks=(this.graphRetirementFallbacks || 0)+1;
      }
      output?.disconnect();
    }
    if(!realm){
      if(failure)throw failure;
      if(context.state!=='closed')throw Error('audio-context-close-incomplete');
      if(!this.contextOps.forget(context))return true;
    }
    return false;
  }
  async _context({gesture=false} = {}) {
    if (this.closed || this.revoking) throw Error('Audio controller disposed');
    if(this.graphInvalid || this.context?.state==='closed' || this.retirements.size>=2) {
      this._graphFault('audio-context-replaced',{retire:true});await this._discardGraph();
    }
    if(this.graphQuarantine){
      if(!this.contextOps.forget(this.graphQuarantine))throw Object.assign(Error('audio-context-operation-pending'),{code:'audio-context-operation-pending'});
      this.graphQuarantine=null;
    }
    if(this.closed || this.revoking)throw Error('Audio context retired');
    if (!this.context) {
      if(!this.contextOps.canCreate()){
        this.graphReason='audio-context-resource-blocked';
        throw Object.assign(Error(this.graphReason),{code:this.graphReason});
      }
      let context;
      try {
        this.graphRealm=new AudioGraphRealm(this.env);
        context=this.context=this.graphRealm.context({sampleRate:48000,latencyHint:'interactive'});
      }catch(error){this.graphRealm?.retire();this.graphRealm=null;throw error;}
      if (context.sampleRate !== 48000) {this.graphInvalid=true;await this._discardGraph();throw Error('48 kHz audio context unavailable');}
      this.module=this.contextOps.run(context,'module',()=>context.audioWorklet.addModule(this.base+'/sdk/audio-worklet.js')).catch(error=>{
        const code=contextCode(error) || 'audio-context-module-failed';
        throw Object.assign(Error(code),{code,cause:error});
      });
      this.module.catch(()=>{});
      this.output = context.createGain(); this.output.connect(context.destination);
      context.onstatechange = () => {
        if(this.closed || this.context!==context)return;
        if(context.state==='running'){
          this._post({op:'playback-ready',ready:!!this.playback && !this.graphInvalid});
          if(this.graphReason)this._recoverGraph();
        }else {
          this._post({op:'playback-ready',ready:false});
          if(this.stream || this._graphIntent('speaker') || this._graphIntent('microphone'))this._graphFault('audio-context-'+context.state,{retire:context.state==='closed'});
        }
      };
    }
    const context = this.context;
    const recovering=!!this.graphReason;
    // resume() is called synchronously from the original speaker/mic gesture.
    const resumed=context.state==='running'?Promise.resolve():this.contextOps.run(context,'resume',()=>context.resume(),{gesture});
    try {await Promise.all([this.module,resumed]);}
    catch(error){
      if(!this.closed && this.context===context){
        const code=contextCode(error),retire=context.state==='closed' || code?.startsWith('audio-context-module');
        this._graphFault(code || 'audio-context-resume-failed',{retire});
        if(retire)await this._discardGraph();
      }
      throw error;
    }
    if (this.closed || this.context !== context || this.graphInvalid) throw Error('Audio context retired');
    if (context.state !== 'running') throw Error('Audio playback requires a user gesture');
    this.graphReason=null;
    if(recovering)this._post({op:'capture-eligible'});
    return context;
  }
  async _preparePlayback({gesture=false,allowed=()=>this._graphIntent('speaker')} = {}) {
    const context = await this._context({gesture});
    if(this.context!==context || context.state!=='running' || this.graphInvalid || !allowed())return;
    try {if (!this.playback) {
      this.playback = this.graphRealm.node(context,'remotexapp-playback-v1',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2]});
      const node=this.playback;
      node.onprocessorerror=()=>this._processorError('playback',node,context);
      this.playback.port.onmessage = ({data}) => {
        if (data.type === 'credit') this._post({op:'playback-credit'});
        if (data.type === 'stats') { this.playbackStats = data; this._emit(); }
      };
      this.playback.connect(this.output);
    }}catch(error){
      this._graphFault('audio-playback-graph-failed',{retire:true});
      throw Object.assign(Error('audio-playback-graph-failed'),{code:'audio-playback-graph-failed',cause:error});
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
  _wireSourceEvents(stream) {
    // Parent-owned track handlers must not share the capture-construction
    // scope, which contains a child Context and processor that can retire.
    for(const track of stream.getTracks()){
      track.enabled=false;track.onended=()=>this._captureFailed('microphone-device-ended');
      track.onmute=()=>{const old=this.captureToken;this._fenceCapture({disableTrack:false});if(old)this._post({op:'capture-failed',token:old,reason:'microphone-device-muted',retainedSource:true});};
      track.onunmute=()=>this._wake();
    }
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
        const reusable=this._liveSource();
        if(permission==='denied' || (permission==='prompt' && !canPrompt)) {
          this._stopCapture();this._post({op:'capture-failed',token,reason:'microphone-permission-required'});return;
        }
        if(reusable && this.stream.getAudioTracks().some(track=>track.muted)) {
          if(permission==='granted' && this.env.document?.visibilityState!=='hidden') {
            for(const track of this.stream.getAudioTracks())if(track.readyState==='live')track.enabled=true;
          }
          this._post({op:'capture-failed',token,reason:'microphone-device-muted',retainedSource:true});return;
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
          this._wireSourceEvents(stream);
        }
        if(!this.capture) {
          this.capture=this.graphRealm.node(context,'remotexapp-capture-v1',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});
          const node=this.capture;
          node.onprocessorerror=()=>this._processorError('capture',node,context);
          this.captureSource=context.createMediaStreamSource(this.stream);this.captureSource.connect(this.capture);this.capture.connect(context.destination);
        }
        this._wireCapture(token,epoch);this._post({op:'capture-ready',token});
      } catch(error) {
        if(stream && stream!==this.stream)for(const track of stream.getTracks())track.stop();
        if(epoch===this.captureEpoch){
          if(contextCode(error))this._graphFault(contextCode(error));
          else if(this._liveSource() && error.name!=='NotAllowedError')this._graphFault('audio-capture-graph-failed',{retire:true});
          else {this._stopCapture();this._post({op:'capture-failed',token,reason:error.name==='NotAllowedError'?'microphone-permission-denied':'microphone-unavailable'});}
        }
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
  _retireProcessor(node,{context=this.context,realm=this.graphRealm} = {}) {
    for(const record of this.retirements)if(record.node===node)return record;
    let resolve, timer;
    const record = {context,realm,node,done:new Promise(r=>{resolve=r;}), arm:()=>{
      timer ??= this.env.setTimeout(()=>finish(false),1000);
    }};
    const changed = () => {
      if (context?.state === 'running') record.arm();
      else if (context?.state === 'closed') {if(!realm)finish(false);else record.arm();}
      else if (!this.closed) { this.env.clearTimeout(timer); timer = undefined; }
    };
    const finish = acknowledged => {
      if (!this.retirements.delete(record)) return;
      this.env.clearTimeout(timer);
      context?.removeEventListener?.('statechange',changed);
      record.proof=acknowledged;
      node.onprocessorerror=null;node.port.onmessage = null; node.disconnect(); node.port.close();
      if (!acknowledged) {
        this.retirementErrors.push(Object.assign(Error('Audio processor retirement timed out'),{realm}));
        if(this.retirementErrors.length>8)this.retirementErrors.shift();
        this.retirementErrorCount=(this.retirementErrorCount || 0)+1;
        if(!this.closed){this._graphFault('audio-processor-retirement-timeout',{retire:true});this._recoverGraph();}
      }
      resolve(acknowledged);
    };
    record.finish=finish;
    this.retirements.add(record);
    node.port.onmessage = ({data}) => { if (data.type === 'disposed') finish(true); };
    context?.addEventListener?.('statechange',changed);
    node.port.postMessage({op:'dispose'});
    if(context?.state==='closed' && !realm)finish(false);
    else if (this.closed || context?.state === 'running') record.arm();
    return record;
  }
  _message(message) {
    this.lastWorkerMessage = Date.now();
    if (message.reply) { const pending = this.requests.get(message.reply); if (!pending) return; this.requests.delete(message.reply); this.env.clearTimeout(pending.timeout); message.error ? pending.reject(Error(message.error)) : pending.resolve(message.value); return; }
    if (message.type === 'ping') { this._post({op:'pong'}); return; }
    if (message.type === 'capture') { void this._startCapture(message.token,message); return; }
    if (message.type === 'stop-capture') { if (!message.token || message.token===this.captureToken || message.token===this.pendingCaptureToken) this._stopCapture(); return; }
    if (message.type === 'capture-delivery') {
      if (this.captureToken !== message.token || !this.capture) return;
      if(message.delivery && (this.context?.state!=='running' || this.graphInvalid)){
        this._graphFault('audio-context-unavailable',{retire:this.context?.state==='closed'});return;
      }
      if(message.delivery && this.stream.getAudioTracks().some(track=>track.muted)) {
        const token=this.captureToken;this._fenceCapture({disableTrack:false});this._post({op:'capture-failed',token,reason:'microphone-device-muted',retainedSource:true});return;
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
      if(message.captureReady && !message.micOwner && this.stream && !this.captureToken && !this.captureRequest)this._stopCapture();
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
      if (!this.activating && !this.rebind && !this.requests.size && !this._graphIntent('speaker') && !this._graphIntent('microphone') && message.routes.every(r=>!r.speaker&&!r.mic) && !this.stream && this.context?.state === 'running') { this.playback?.port.postMessage({op:'reset'}); void this.context.suspend().catch(()=>{}); }
      this._emit();
    }
  }
  _retireInterests() {
    for (const interest of this.interests.values()) interest.released = true;
    this.interests.clear();
    this._pauseCapture();
    this.playback?.port.postMessage({op:'reset'});
  }
  _emit() {
    this.stats={...this.stats,contextState:this.context?.state || 'none',contextReason:this.graphReason || ''};
    this.dispatchEvent(new CustomEvent('statechange',{detail:{...this.stats,playback:this.playbackStats,microphone:this.captureStats}}));
  }
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
    const graph={context:this.context,realm:this.graphRealm,output:this.output,source:this.captureSource,nodes:[this.capture,this.playback].filter(Boolean)};
    if (this.output) this.output.gain.value = 0;
    this._pauseCapture(); this._closeWorker('Audio controller disposed'); this.env.clearInterval(this.watchdog);
    const quarantine=this.graphQuarantine;
    this.graphQuarantine=null;
    this.context = this.output = this.playback = this.module = this.graphRealm = null;
    this.env.removeEventListener('pagehide',this._pagehide);
    this.env.removeEventListener('pageshow',this._wake);
    this.env.removeEventListener('online',this._wake);
    this.env.document?.removeEventListener('visibilitychange',this._wake);
    this.env.document?.removeEventListener('freeze',this._suspend);
    this.env.document?.removeEventListener('resume',this._wake);
    for (const interest of this.interests.values()) interest.released = true; this.interests.clear();
    void (async()=>{
      let pending;
      try {await Promise.all([this.journalRetirement,this._releaseGraph(graph).then(value=>{pending=value;})]);}
      finally {
        this.contextOps.detach();
      }
      if(pending || quarantine && !this.contextOps.forget(quarantine))throw Error('Audio native operation retirement incomplete');
      if (this.retirementErrors.length) throw new AggregateError(this.retirementErrors,'Audio retirement incomplete');
    })().then(resolve,reject);
    return this.disposal;
  }
}
