// One coordinator per canonical Manager origin/base, browser storage partition
// and worker protocol. A server-issued cookie binds the current login epoch.
export class AudioCoordinator {
  constructor(env = globalThis) {
    this.env = env; this.ports = new Map(); this.routes = new Map(); this.pending = new Map(); this.serial = Promise.resolve(); this.client = env.crypto.randomUUID();
    this.workerId=env.crypto.randomUUID();
    this.connection = null; this.socket = null; this.capture = null; this.player = null; this.next = 0; this.epoch = 0; this.sequence = 0; this.received = 0; this.sent = 0; this.dropped = 0; this.reason = ''; this.lastTick = Date.now();
    this.timer = env.setInterval(()=>this._tick(),1000);
  }
  add(port) {
    const peer = {port,id:this.env.crypto.randomUUID(),refs:new Map(),seen:Date.now(),ready:false,credits:8,creditLimit:8}; this.ports.set(port,peer);
    port.onmessage = ({data}) => this.receive(peer,data); port.onmessageerror = () => this._enqueue(()=>this._remove(peer)); port.start();
  }
  _send(peer,value,transfer) { if (!this.ports.has(peer.port)) return; try { peer.port.postMessage(value,transfer || []); } catch { this._enqueue(()=>this._remove(peer)); } }
  _enqueue(fn) { const result = this.serial.then(fn); this.serial = result.catch(()=>{}); return result; }
  receive(peer,data) {
    if (!this.ports.has(peer.port) || !data || typeof data.op !== 'string') return;
    if (this.capture?.peer === peer && Date.now()-peer.seen > 5000) {
      this._stopCapture('microphone-owner-suspended');
    }
    peer.seen = Date.now();
    if (data.op === 'playback-media') { this._bindPlaybackMedia(peer,data); return; }
    if (data.op === 'release-playback-media') {
      if(peer.playbackMedia?.binding===data.binding){this._closePlaybackMedia(peer);peer.ready=false;this._selectPlayer();this._broadcast();}
      return;
    }
    if (data.op === 'pong') return;
    if (data.op === 'capture-eligible') {
      peer.captureRetryAfter = 0;
      for (const ref of peer.refs.values()) ref.captureBlocked = false;
      this.retryAfter = 0; this._tick(); return;
    }
    if (data.op === 'wake') { this._tick(); return; }
    if (data.op === 'suspend' && this.capture?.peer === peer) this._stopCapture('microphone-owner-suspended');
    const ref = peer.refs.get(data.ref);
    if (ref?.route.retired && ['speaker','microphone','restore-speaker'].includes(data.op)) {
      if(data.request)this._send(peer,{reply:data.request,value:this._routeState(ref.route)});
      return;
    }
    if (ref && data.intent && ['speaker','microphone','forget-intent'].includes(data.op)) {
      const kind = data.op==='forget-intent'?data.kind:data.op, state=data.intent;
      const previous=ref.route[kind+'Stamp'];
      const valid=['speaker','microphone'].includes(kind) && state.available===true &&
        Number.isSafeInteger(state.revision) && state.revision>0 && Number.isSafeInteger(state.epoch) && state.epoch>0 && state.epoch<=state.revision &&
        typeof state.enabled==='boolean' && typeof state.participating==='boolean' &&
        (data.op==='forget-intent' || (state.enabled===!!data.enabled && (!data.enabled || state.participating)));
      if (!valid) {if(data.request)this._send(peer,{reply:data.request,error:'Invalid audio intent stamp'});return;}
      if (previous && (state.revision<previous.revision || (state.revision===previous.revision && (state.epoch!==previous.epoch || state.enabled!==previous.enabled)))) {
        if(data.request)this._send(peer,{reply:data.request,value:this._routeState(ref.route)});return;
      }
      if (!previous || previous.epoch!==state.epoch || !state.enabled) {
        for(const other of ref.route.refs)other[kind==='microphone'?'micIntent':'speakerIntent']=false;
        if(kind==='microphone'){ref.route.micRequested=ref.route.mic=false;this._captureDelivery(false);}
        else {ref.route.speakerRevision=(ref.route.speakerRevision || 0)+1;this._muteSpeaker(ref.route);}
      }
      ref.route[kind+'Stamp']={revision:state.revision,epoch:state.epoch,enabled:state.enabled};
    }
    if (ref && data.op === 'microphone') {
      data.revision = ref.route.micRevision = (ref.route.micRevision || 0)+1;
      ref.route.micRequested = !!data.enabled;
      if (data.enabled) ref.micIntent = true;
      else for (const other of ref.route.refs) other.micIntent = false;
      if (!data.enabled) ref.route.mic = false;
    }
    if ((ref?.route.mic || ref?.route.actualMic) && ((data.op === 'microphone' && !data.enabled) || data.op === 'release')) this._captureDelivery(false);
    if (ref && data.op === 'release' && ref.route.refs.size === 1) {
      ref.route.speakerRevision = (ref.route.speakerRevision || 0)+1;
      this._muteSpeaker(ref.route);
    }
    if (ref && data.op === 'speaker') {
      data.revision = ref.route.speakerRevision = (ref.route.speakerRevision || 0)+1;
      if(data.enabled)ref.speakerIntent=true;else for(const other of ref.route.refs)other.speakerIntent=false;
      if(data.enabled)ref.route.speaker=true;
      if (!data.enabled) { this._muteSpeaker(ref.route); this._broadcast(); }
    }
    if (ref && data.op === 'forget-intent') {
      if (data.kind === 'microphone') {
        ref.micIntent = false;
        ref.route.micRequested = [...ref.route.refs].some(r=>r.micIntent);
        if (!ref.route.micRequested) { ref.route.mic = false; this._captureDelivery(false); }
      }
      if (data.kind === 'speaker') {
        ref.speakerIntent=false;
        if (![...ref.route.refs].some(r=>r.speakerIntent)) this._muteSpeaker(ref.route);
      }
      if (this.capture?.peer === peer && ![...peer.refs.values()].some(r=>r.micIntent)) this._stopCapture('microphone-owner-disabled');
    }
    if (data.op === 'playback-credit') { if(!peer.playbackMedia)peer.credits = Math.min(peer.creditLimit,peer.credits+1); return; }
    if (data.op === 'microphone-frame') { this._mic(peer,data); return; }
    if (data.op === 'capture-delivery-ready') {
      const capture = this.capture;
      if (capture?.peer === peer && capture.ready && capture.token === data.token &&
          capture.delivery && capture.delivery === data.delivery) {
        this.env.clearTimeout(capture.deliveryTimer); capture.deliveryTimer = null;
        capture.delivering = true; this._broadcast();
      }
      return;
    }
    if (data.op === 'capture-ready' || data.op === 'capture-failed') {
      const capture = this.capture;
      if (capture?.peer !== peer || data.token !== capture.token) return;
      if (data.op === 'capture-ready') { peer.holdsSource=true;capture.ready = true; capture.resolve?.(); capture.resolve = capture.reject = null; }
      else {
        const reason = data.reason || 'microphone-ended';
        peer.holdsSource=!!data.retainedSource;
        const blocked = ['microphone-permission-required','microphone-permission-denied','microphone-device-muted','intent-state-unavailable','microphone-intent-retired'].includes(reason);
        if (capture.ref) capture.ref.captureBlocked = blocked;
        peer.captureBackoff = Math.min(30000,Math.max(1000,(peer.captureBackoff || 500)*2));
        peer.captureRetryAfter = Date.now()+peer.captureBackoff;
        this._stopCapture(reason); this._enqueue(()=>this._sync()).catch(()=>{});
      }
      return;
    }
    // Cancellation must not wait behind an outstanding browser permission prompt.
    if ((data.op === 'microphone' && !data.enabled || data.op === 'dispose') && this.capture?.peer === peer && !this.capture.ready) this._stopCapture('microphone-cancelled');
    this._enqueue(async()=>{
      let value;
      try { value = await this._command(peer,data); if (data.request) this._send(peer,{reply:data.request,value}); }
      catch (error) {
        this.reason = error.message;
        const ref=peer.refs.get(data.ref),transient=error instanceof TypeError || error.name==='TimeoutError' || error.transport || error.status>=500;
        if (data.request) this._send(peer,ref && transient && ['speaker','microphone'].includes(data.op)
          ? {reply:data.request,value:this._routeState(ref.route)} : {reply:data.request,error:error.message || 'Audio operation failed'});
        this._broadcast();
      }
    });
  }
  async _api(action,body = {}) {
    const response = await this.env.fetch(this.base+'/api/audio/'+action,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
    if (!response.ok) {
      const data = await response.json().catch(()=>({}));
      throw Object.assign(Error(data.error || 'Audio API unavailable'),{status:response.status});
    }
    return response.json();
  }
  async _context() {
    let context;
    try { context = await this._api('context'); }
    catch (error) {
      if (error.status === 401 || error.status === 403) { this.accessBlocked=true;this._interrupt('audio-login-required',false); }
      throw error;
    }
    if (context.protocol !== 'pcm-s16le-48k-v1' || !/^[a-f0-9]{64}$/.test(context.scope || '') || !/^[a-f0-9]{64}$/.test(context.service || '') || (context.login && !/^[a-f0-9]{64}$/.test(context.login)) || (context.principal !== undefined && !/^[a-f0-9]{64}$/.test(context.principal))) throw Error('Unsupported audio contract');
    const previous = this.context;
    this.accessBlocked=false;
    this.context = context;
    for (const peer of this.ports.values()) {
      const binding=peer.binding;
      if (binding && ((binding.principal && binding.principal!==context.principal) || (binding.login && binding.login!==context.login) ||
          (binding.service===context.service && binding.scope!==context.scope && !(binding.principal && binding.principal===context.principal)))) {
        this._retire('audio-login-changed');throw Error('Audio login epoch changed; acquire current session interests again');
      }
    }
    if (!previous || previous.scope !== context.scope || previous.service !== context.service) {
      for (const peer of this.ports.values()) {peer.binding=this._binding();this._send(peer,{type:'binding',binding:peer.binding});}
    }
    if (previous) {
      const changed = context.scope !== previous.scope || context.service !== previous.service;
      const principalChanged = previous.principal && previous.principal !== context.principal;
      const loginChanged = previous.login && previous.login !== context.login;
      const samePrincipal = previous.principal && previous.principal === context.principal;
      if (principalChanged || loginChanged || (changed && context.service === previous.service && !samePrincipal)) {
        this._retire('audio-login-changed');
        throw Error('Audio login epoch changed; acquire current session interests again');
      }
      if (changed) this._interrupt(context.service === previous.service ? 'audio-scope-refreshed' : 'audio-service-restarted',true);
    }
    return context;
  }
  _binding() {
    if(!this.context)return null;
    const {scope,service,login,principal} = this.context;
    return {scope,service,login,...(principal ? {principal} : {})};
  }
  _closePlaybackMedia(peer) {
    const media=peer.playbackMedia;peer.playbackMedia=null;
    if(media){media.port.onmessage=media.port.onmessageerror=null;media.port.close();}
  }
  _failPlaybackMedia(peer) {
    const binding=peer.playbackMedia?.binding;
    this._closePlaybackMedia(peer);peer.ready=false;this._selectPlayer();
    this._send(peer,{type:'playback-media-failed',binding});this._broadcast();
  }
  _bindPlaybackMedia(peer,{binding,port}) {
    if(typeof binding!=='string' || !binding || binding.length>64 || ['postMessage','close','start'].some(key=>typeof port?.[key]!=='function')){if(typeof port?.close==='function')port.close();return;}
    this._closePlaybackMedia(peer);
    const media=peer.playbackMedia={binding,port};
    port.onmessage=({data})=>{
      if(peer.playbackMedia!==media || this.player!==peer || !this.ports.has(peer.port))return;
      if(data?.type==='credit' && data.binding===binding && data.epoch===peer.playbackEpoch)
        peer.credits=Math.min(peer.creditLimit,peer.credits+1);
    };
    port.onmessageerror=()=>{
      if(peer.playbackMedia!==media)return;
      this._failPlaybackMedia(peer);
    };
    port.start();this._resetPlayback(peer);
  }
  _resetPlayback(peer) {
    peer.playbackEpoch=this.env.crypto.randomUUID();peer.credits=peer.creditLimit;
    this._playback(peer,{type:'reset-playback'});
  }
  _playback(peer,message,transfer) {
    const media=peer.playbackMedia;
    if(!media){this._send(peer,message,transfer);return;}
    const op=message.type==='playback'?'frame':message.type==='remove-playback'?'remove':'reset';
    try {media.port.postMessage({op,epoch:peer.playbackEpoch,slot:message.slot,pcm:message.pcm},transfer || []);}
    catch {this._failPlaybackMedia(peer);}
  }
  _muteSpeaker(route,reason = '') {
    route.speaker = false;
    route.reason = reason;
    if (this.player) this._playback(this.player,{type:'remove-playback',slot:route.slot});
  }
  _interrupt(reason,allowCaptureRecovery = false) {
    if (this.connection || !this.lastDisconnect) this.lastDisconnect = {at:Date.now(),code:reason,httpStatus:null};
    this._disconnect(reason);
    const capture = this.capture;
    const retainSource = allowCaptureRecovery && capture?.ready &&
        this.ports.has(capture.peer.port) && Date.now()-capture.peer.seen <= 5000 &&
        [...this.routes.values()].some(route=>route.mic);
    // A transport lease is not the lifetime of an already-authorized source.
    // _disconnect fenced delivery; retain only while its live owner and
    // requested routes survive. Owner loss/off still stops it.
    if (!retainSource) this._stopCapture(reason);
    this.reason = reason;
    this._broadcast();
  }
  _body(extra = {}) { return {scope:this.context.scope,client:this.client,connection:this.connection,...extra}; }
  _retire(reason) {
    this._disconnect(reason); this._stopCapture(reason);
    this.routes.clear(); for (const peer of this.ports.values()) { peer.refs.clear(); peer.binding=this._binding();this._send(peer,{type:'retired',reason}); }
    this.reason = reason; this._broadcast();
  }
  async _command(peer,data) {
    if (data.op === 'init') {
      const base = new URL(data.base);
      if (base.origin !== this.env.location.origin || base.search || base.hash || base.username || base.password) throw Error('Invalid audio service origin');
      if (this.base && this.base !== data.base) throw Error('Audio service scope differs');
      if(data.workerProtocol!==9)throw Error('Unsupported audio Worker contract');
      peer.binding=data.binding || null;
      peer.holdsSource=!!data.sourceLive;
      this.base = data.base; this._broadcast(); return {protocol:'pcm-s16le-48k-v1',workerProtocol:9,workerId:this.workerId,binding:this._binding()};
    }
    if (data.op === 'dispose') return this._remove(peer);
    if (data.op === 'suspend') { if (this.connection) await this._sync(); return; }
    if (data.op === 'logout') {
      const body=this.context?this._body():null;this.accessBlocked=false;this._retire('logout');this.context=null;
      if(body)await this._api('logout',body);return;
    }
    if (data.op === 'playback-ready') { peer.ready = !!data.ready; this._selectPlayer(); this._broadcast(); return; }
    if (data.op === 'acquire') {
      if (!/^[a-zA-Z0-9_.-]{1,128}$/.test(data.runtime || '') || !Number.isSafeInteger(data.generation) || data.generation < 1 || typeof data.ref !== 'string' || data.ref.length > 64 || peer.refs.has(data.ref)) throw Error('Invalid audio interest');
      const key = data.runtime+':'+data.generation;
      let route = this.routes.get(key);
      if(route?.retired){
        this._send(peer,{type:'runtime-retired',runtime:route.runtime,generation:route.generation});
        throw Error('Audio runtime generation retired');
      }
      if (!route) {
        const used = new Set([...this.routes.values()].map(r=>r.slot)); let slot = 1; while (used.has(slot)) slot++;
        if (slot > 8) throw Error('Audio session capacity reached');
        route = {key,runtime:data.runtime,generation:data.generation,slot,refs:new Set(),speaker:false,mic:false,micRequested:false,actualSpeaker:false,actualMic:false,applied:'',reason:''}; this.routes.set(key,route);
      }
      const ref = {peer,id:data.ref,route,micIntent:false,speakerIntent:false,captureBlocked:false}; peer.refs.set(data.ref,ref); route.refs.add(ref); this._broadcast(); return;
    }
    const ref = peer.refs.get(data.ref); if (!ref) throw Error('Audio interest is retired');
    const route = ref.route;
    if (data.op === 'forget-intent') { await this._sync(); return this._routeState(route); }
    if (data.op === 'release') { peer.refs.delete(data.ref); route.refs.delete(ref); if (!route.refs.size) { route.speaker = route.mic = false; await this._syncRoute(route); this.routes.delete(route.key); } await this._sync(); return; }
    if (route.retired) return this._routeState(route);
    if (data.op === 'restore-speaker') {
      if (route.speakerRevision || route.speaker) return this._routeState(route);
      const context = await this._context();
      if ((data.login && context.login !== data.login) || route.speakerRevision || !peer.refs.has(ref.id)) return this._routeState(route);
      route.micRequested = !!data.microphoneRequested;
      if (route.micRequested) route.reason = 'explicit-microphone-action-required';
      route.speaker = data.enabled !== false; this._selectPlayer();
      await this._sync(); return this._routeState(route);
    }
    if (data.op === 'speaker') {
      if (data.enabled) {
        await this._context();
        if (data.revision !== route.speakerRevision || !peer.refs.has(ref.id) || !ref.speakerIntent) return this._routeState(route);
        route.speaker = true; route.reason = ''; this._selectPlayer();
      }
      try { await this._sync(); }
      catch (error) { if (data.enabled) throw error; }
      this._broadcast(); return this._routeState(route);
    }
    if (data.op === 'microphone') {
      if (data.revision !== route.micRevision) return this._routeState(route);
      if (data.enabled) {
        await this._context();
        if (data.revision !== route.micRevision || !peer.refs.has(ref.id) || !ref.micIntent) return this._routeState(route);
        route.mic = true; route.takeover = !!data.takeover; route.reason = '';
        if (!data.automatic) { ref.captureBlocked = false; peer.captureRetryAfter = peer.captureBackoff = 0; }
      } else route.mic = false;
      try {
        // Reserve the current target writer before asking a browser for a
        // device. A conflict/unavailable domain must not churn local capture.
        await this._sync();
        if (data.enabled && route.actualMic && route.mic && data.revision === route.micRevision && peer.refs.has(ref.id)) {
          const source=data.automatic ? this._captureCandidate() || ref : ref;
          const capture = await this._ensureCapture(source.peer,source,!!data.automatic);
          if (!capture || this.capture !== capture || !capture.ready) throw Error('microphone-ended-before-routing');
          if (data.revision !== route.micRevision || !peer.refs.has(ref.id)) this._releaseCaptureIfUnused();
          await this._sync();
        }
      }
      catch (error) {
        route.mic = false; this._releaseCaptureIfUnused();
        if (this.connection) { try { await this._sync(); } catch {} }
        if (data.enabled) throw error;
      }
      this._broadcast();
      return this._routeState(route);
    }
    throw Error('Unknown audio operation');
  }
  _routeState(r) {
    const actualMic = !!(r.actualMic && r.mic && this.capture?.ready && this.capture.delivering);
    const actionRequired=!!(r.micRequested && ![...r.refs].some(ref=>ref.micIntent && !ref.captureBlocked));
    return {runtime:r.runtime,generation:r.generation,slot:r.slot,speaker:r.speaker,mic:r.mic,
    requested:{speaker:r.speaker,microphone:r.micRequested}, microphoneActionRequired:actionRequired,
    microphonePending:!!(r.micRequested && !actionRequired && !actualMic),
    actualSpeaker:!!(r.actualSpeaker && r.speaker && this.player?.ready),actualMic,reason:r.reason,refs:r.refs.size,domain:r.domain || null}; }
  _broadcast() {
    const settled = state => (!state.requested.speaker || state.actualSpeaker) &&
      (!state.requested.microphone || state.actualMic);
    const routes = [...this.routes.values()].map(route=>{
      const state=this._routeState(route);
      // Capture readiness alone is not recovery: require current delivery ACK
      // and every requested effect. Keep other pending/retired route reasons.
      if(!route.retired && settled(state))route.reason=state.reason='';
      return state;
    });
    if(this.connection && routes.every(state=>!state.reason && settled(state)))this.reason='';
    const wanted=routes.some(r=>r.requested.speaker||r.requested.microphone);
    const connection=this.connection?'connected':wanted?(this.accessBlocked?'blocked':'recovering'):'idle';
    for (const peer of this.ports.values()) this._send(peer,{type:'state',connection,protocol:this.connection?'WSS / PCM16 48 kHz':null,playbackBlocked:routes.some(r=>r.speaker)&&!this.player,connectionId:this.connection,speakerOwner:this.player===peer,micOwner:this.capture?.peer===peer,captureReady:!!(this.capture?.ready && this.capture.delivering),reason:this.reason,lastDisconnect:this.lastDisconnect,routes,receivedBytes:this.received,sentBytes:this.sent,droppedFrames:this.dropped});
  }
  _selectPlayer() {
    const count = [...this.routes.values()].filter(r=>r.speaker).length;
    const wanted = count>0, budget = Math.max(1,count)*8;
    const next = wanted ? (this.player?.ready && this.ports.has(this.player.port) ? this.player : [...this.ports.values()].find(p=>p.ready)) : null;
    if (next !== this.player) { if (this.player) this._resetPlayback(this.player); this.player = next || null; if (this.player) { this.player.creditLimit = budget; this._resetPlayback(this.player); } }
    else if (this.player) {
      // Each speaker already has its own eight-frame worklet queue. Sharing a
      // fixed eight credits starves ordinary bursts when several routes play.
      const peer = this.player; peer.credits = Math.max(0,Math.min(budget,peer.credits+budget-peer.creditLimit)); peer.creditLimit = budget;
    }
  }
  async _ensureCapture(peer,ref,automatic = false) {
    if (this.capture?.ready) return this.capture;
    if (this.capture) throw Error('Microphone permission is already pending');
    const token = this.env.crypto.randomUUID();
    await new Promise((resolve,reject)=>{
      const timeout = this.env.setTimeout(()=>{if (this.capture?.token===token) this._stopCapture('microphone-permission-timeout');},15000);
      this.capture = {peer,ref,token,ready:false,resolve:()=>{this.env.clearTimeout(timeout);resolve();},reject:error=>{this.env.clearTimeout(timeout);reject(error);}};
      this._send(peer,{type:'capture',token,runtime:ref?.route.runtime,generation:ref?.route.generation,automatic});
    });
    return this.capture;
  }
  _stopCapture(reason) {
    const capture = this.capture; this.capture = null;
    if (capture) {
      this.env.clearTimeout(capture.deliveryTimer);
      capture.reject?.(Error(reason));
      this._send(capture.peer,{type:'stop-capture',token:capture.token,reason});
    }
    for (const route of this.routes.values()) { if (route.mic) route.reason = reason; route.mic = false; if(capture)route.applied = ''; }
    this._broadcast();
  }
  _captureDelivery(enabled) {
    const capture = this.capture;
    if (!capture?.ready) return;
    const delivery = enabled ? capture.delivery || this.env.crypto.randomUUID() : null;
    if (delivery === (capture.delivery || null)) return;
    capture.delivery = delivery;
    capture.delivering = false;
    this.env.clearTimeout(capture.deliveryTimer); capture.deliveryTimer = null;
    if (delivery) capture.deliveryTimer = this.env.setTimeout(()=>{
      if (this.capture === capture && capture.delivery === delivery && !capture.delivering) {
        this._stopCapture('microphone-delivery-timeout');
        this._enqueue(()=>this._sync()).catch(()=>{});
      }
    },2000);
    this._send(capture.peer,{type:'capture-delivery',token:capture.token,delivery});
  }
  _releaseCaptureIfUnused() { if (![...this.routes.values()].some(r=>r.micRequested)) this._stopCapture('all-microphones-disabled'); }
  async _connect() {
    if (this.connection && this.socket?.readyState===1) return;
    await this._context();
    if (![...this.routes.values()].some(r=>r.speaker||r.mic)) return;
    let grant;
    try { grant = await this._api('grant',this._body()); } catch (error) {
      if (error.status!==409) throw error;
      const now = Date.now();
      this.busySince ??= now;
      this.retryAfter = now+1000;
      this.reason = 'audio-connection-owned';
      this._broadcast();
      return;
    }
    this.busySince = null;
    if (!/^[a-f0-9]{64}$/.test(grant.token || '')) throw Error('Invalid audio grant');
    const url = new URL(this.base+'/api/audio/ws'); url.protocol = url.protocol==='https:'?'wss:':'ws:';
    const epoch = ++this.epoch;
    await new Promise((resolve,reject)=>{
      const socket = this.socket = new this.env.WebSocket(url.href,['remotexapp-audio.'+grant.token]); socket.binaryType = 'arraybuffer';
      const timeout = this.env.setTimeout(()=>{socket.close();reject(Object.assign(Error('Audio connection timed out'),{transport:true}));},5000);
      socket.onmessage = ({data})=>{
        if (epoch!==this.epoch) return;
        if (data instanceof ArrayBuffer) { this._speaker(data); return; }
        let message; try { message = JSON.parse(data); } catch { socket.close(); return; }
        if (message.type==='connected') { this.env.clearTimeout(timeout); this.connection = message.connection; this.lastRenew = Date.now(); this.reason = ''; resolve(); this._broadcast(); return; }
        this._serverMessage(message);
      };
      socket.onclose = ()=>{this.env.clearTimeout(timeout);reject(Object.assign(Error('Audio connection closed'),{transport:true}));if (epoch===this.epoch) {this._interrupt('network-disconnected',true);this.retryAfter = Date.now()+1000;}};
      socket.onerror = ()=>{};
    });
  }
  _disconnect(reason) {
    this._captureDelivery(false);
    ++this.epoch; const socket = this.socket; this.socket = null; this.connection = null;
    if (socket) { socket.onmessage = socket.onclose = socket.onerror = null; socket.close(); }
    for (const pending of this.pending.values()) { this.env.clearTimeout(pending.timeout); pending.reject(Error(reason)); } this.pending.clear();
    for (const route of this.routes.values()) { route.applied = ''; route.actualSpeaker = route.actualMic = false; }
    for (const peer of this.ports.values()) this._send(peer,{type:'reset-playback'});
  }
  _control(message) {
    const request = String(++this.next);
    return new Promise((resolve,reject)=>{
      const timeout = this.env.setTimeout(()=>{this.pending.delete(request);reject(Error('Audio route acknowledgment timed out'));},5000);
      this.pending.set(request,{resolve,reject,timeout});
      this.socket.send(JSON.stringify({...message,request}));
    });
  }
  _serverMessage(message) {
    const route = [...this.routes.values()].find(r=>r.slot===message.slot);
    if (route && !route.retired && message.type==='state') {
      route.actualSpeaker = !!message.speaker && route.speaker; route.actualMic = !!message.mic;
      if (message.domain) route.domain = message.domain;
      if (message.reason && message.reason!=='reconfigured' && message.reason!=='disabled') {
        route.reason = message.reason; route.applied = '';
        if (message.reason==='domain-retired') route.mic = false;
        if (message.reason==='generation-retired') this._retireRoute(route);
        if (message.reason.startsWith('mic-')) {route.mic = false;route.micRetryAfter=Date.now()+5000;}
      }
      if (!route.actualSpeaker && this.player) this._send(this.player,{type:'remove-playback',slot:route.slot});
    }
    const pending = this.pending.get(message.request);
    if (pending) { this.pending.delete(message.request); this.env.clearTimeout(pending.timeout); message.type==='error' ? pending.reject(Error(message.reason)) : pending.resolve(message); }
    // Do not stop a just-approved capture while an in-flight reconfiguration
    // emits the old slot's disabled state ahead of the new acknowledgment.
    this._releaseCaptureIfUnused(); this._broadcast();
  }
  _retireRoute(route) {
    if(route.retired)return;
    this._muteSpeaker(route,'generation-retired');
    route.retired=true;route.mic=route.micRequested=route.actualMic=false;route.applied='';
    for(const ref of route.refs)ref.speakerIntent=ref.micIntent=false;
    for(const peer of new Set([...route.refs].map(ref=>ref.peer))) {
      this._send(peer,{type:'runtime-retired',runtime:route.runtime,generation:route.generation});
    }
  }
  async _syncRoute(route) {
    if (!this.connection) { route.applied = ''; return; }
    if (!route.speaker && !route.mic) {
      if (route.applied && route.actualMic) this._captureDelivery(false);
      if (route.applied) await this._control({op:'unsubscribe',slot:route.slot});
      route.applied = ''; route.actualSpeaker = route.actualMic = false; return;
    }
    const key = this.connection+':'+route.speaker+':'+route.mic;
    if (route.applied === key) return;
    if (route.actualMic && !route.mic) this._captureDelivery(false);
    let grant;
    try { grant = await this._api('route',this._body({runtime:route.runtime,generation:route.generation})); }
    catch (error) {
      if (error.status === 410) {
        this._retireRoute(route);
        this._releaseCaptureIfUnused(); return;
      }
      if (error.status!==409) throw error;
      // An unavailable App domain is local to this route. Authentication and
      // shared-transport failures still propagate to the connection fence.
      route.mic = false; route.actualSpeaker = route.actualMic = false; route.reason = 'session-audio-unavailable';
      route.micRetryAfter = Date.now()+5000;
      if (route.applied) await this._control({op:'unsubscribe',slot:route.slot});
      route.applied = ''; this._releaseCaptureIfUnused(); return;
    }
    if (!route.speaker && !route.mic) return this._syncRoute(route);
    const state = await this._control({op:'subscribe',slot:route.slot,token:grant.token,speaker:route.speaker,mic:route.mic,takeover:!!route.takeover});
    route.takeover = false; route.domain = grant.domain;
    if (route.reason==='session-audio-unavailable') route.reason = '';
    // A device/permission event can change desired state while this ACK waits.
    // Remember the server's actual configuration so the next sync retires any
    // in-flight mic grant instead of treating it as already disabled.
    route.applied = this.connection+':'+!!state.speaker+':'+!!state.mic;
    if (!state.speaker && route.speaker) route.reason = state.reason || 'speaker-unavailable';
    if (!state.mic && route.mic) { route.mic = false; route.reason = state.reason || 'mic-unavailable'; }
  }
  async _sync({recoverCapture = false} = {}) {
    if (recoverCapture) for (const route of this.routes.values()) {
      if (!route.retired && route.micRequested && Date.now()>=(route.micRetryAfter || 0)) {
        route.mic = [...route.refs].some(ref=>ref.micIntent && !ref.captureBlocked &&
          Date.now()>=(ref.peer.captureRetryAfter || 0) && Date.now()-ref.peer.seen<=5000);
      }
    }
    const wanted = [...this.routes.values()].some(r=>r.speaker||r.mic);
    if (!wanted) { this.busySince = null; this._disconnect('all-audio-disabled'); this._releaseCaptureIfUnused(); this._selectPlayer(); this._broadcast(); return; }
    await this._connect();
    if (!this.connection) return;
    for (const route of this.routes.values()) await this._syncRoute(route);
    if (recoverCapture && !this.capture) {
      const ref = this._captureCandidate();
      if (ref) {
        try { await this._ensureCapture(ref.peer,ref,true); }
        catch { /* Capture failure retains intent; per-owner backoff controls retry. */ }
      }
    }
    if (this.lastDisconnect && this.lastDisconnect.recoveredAt == null &&
        [...this.routes.values()].some(r=>r.actualSpeaker||r.actualMic)) {
      const recoveredAt = Date.now();
      this.lastDisconnect = {...this.lastDisconnect,recoveredAt,durationMs:Math.max(0,recoveredAt-this.lastDisconnect.at)};
    }
    this._releaseCaptureIfUnused();
    this._captureDelivery([...this.routes.values()].some(r=>r.mic && r.actualMic));
    this._selectPlayer(); this._broadcast();
    if (![...this.routes.values()].some(r=>r.speaker||r.mic)) this._disconnect('no-authorized-audio-targets');
  }
  _captureCandidate() {
    return [...this.routes.values()].filter(r=>r.mic && r.actualMic && !r.retired)
      .flatMap(r=>[...r.refs]).filter(ref=>ref.micIntent && !ref.captureBlocked &&
        Date.now()>=(ref.peer.captureRetryAfter || 0) && Date.now()-ref.peer.seen<=5000)
      .sort((a,b)=>Number(!!b.peer.holdsSource)-Number(!!a.peer.holdsSource))[0];
  }
  _speaker(data) {
    if (data.byteLength<8) return;
    const head = new DataView(data); const slot = head.getUint8(2), silent = head.getUint8(3);
    if (head.getUint8(0)!==1 || head.getUint8(1)!==1 || silent>1 || data.byteLength!==(silent?8:3848)) return;
    this.received += data.byteLength;
    const route = [...this.routes.values()].find(r=>r.slot===slot);
    const peer = this.player;
    if (!route?.speaker || !route.actualSpeaker || !peer || peer.credits<1) { this.dropped++; return; }
    peer.credits--; const pcm = silent ? new ArrayBuffer(3840) : data.slice(8);
    this._playback(peer,{type:'playback',slot,pcm},[pcm]);
  }
  _mic(peer,message) {
    const capture = this.capture;
    this._send(peer,{type:'microphone-credit'});
    if (capture?.peer!==peer || !capture.delivering || capture.token!==message.token || !capture.delivery || capture.delivery!==message.delivery ||
        !(message.pcm instanceof ArrayBuffer) || message.pcm.byteLength!==1920 || ![...this.routes.values()].some(r=>r.mic && r.actualMic)) return;
    if (this.socket?.readyState!==1 || this.socket.bufferedAmount>3840) { this.dropped++; return; }
    const pcm = new Uint8Array(message.pcm); const silent = pcm.every(v=>v===0);
    const buffer = new ArrayBuffer(silent?8:1928); const view = new DataView(buffer);
    view.setUint8(0,1); view.setUint8(1,2); view.setUint8(3,silent?1:0); view.setUint32(4,++this.sequence,true); if (!silent) new Uint8Array(buffer,8).set(pcm);
    this.socket.send(buffer); this.sent += buffer.byteLength;
  }
  async _remove(peer) {
    if (!this.ports.has(peer.port)) return;
    this._closePlaybackMedia(peer);
    peer.ready=false;this._selectPlayer();
    if (this.capture?.peer===peer) this._stopCapture('microphone-owner-ended');
    for (const ref of peer.refs.values()) { ref.route.refs.delete(ref); if (!ref.route.refs.size) { ref.route.speaker = ref.route.mic = false; try { await this._syncRoute(ref.route); } catch {} this.routes.delete(ref.route.key); } }
    peer.refs.clear(); this.ports.delete(peer.port); peer.port.close(); this._selectPlayer(); await this._sync();
  }
  _tick() {
    if (!this.base) return;
    const now = Date.now();
    if (now-this.lastTick > 5000) {
      this.pruneAfter = now+5000;
      if (this.capture) this._stopCapture('microphone-owner-suspended');
    }
    this.lastTick = now;
    // Heartbeats must not wait behind permission prompts or network requests.
    for (const peer of this.ports.values()) this._send(peer,{type:'ping'});
    if (this.tickPending) return;
    this.tickPending = true;
    this._enqueue(async()=>{
      for (const peer of this.ports.values()) {
        if (this.capture?.peer === peer && Date.now()-peer.seen > 5000) this._stopCapture('microphone-owner-suspended');
        if (Date.now() >= (this.pruneAfter || 0) && Date.now()-peer.seen>75000) await this._remove(peer);
      }
      if (this.connection && Date.now()-this.lastRenew>=10000) {
        await this._context();
        if (this.connection) { await this._api('renew',this._body()); this.lastRenew = Date.now(); }
      }
      // Server-side retirement can clear the last desired route without a UI command.
      // Reconcile an existing connection too, so an empty channel is released.
      if (Date.now()>=(this.retryAfter || 0) && (this.connection || [...this.routes.values()].some(r=>r.speaker||r.mic||r.micRequested))) await this._sync({recoverCapture:true});
      this._broadcast();
    }).catch(error=>{
      const transient = error.transport === true || error.name === 'TimeoutError' ||
        error instanceof TypeError || (error.status || 0) >= 500;
      this._interrupt(error.message || 'audio-lease-or-route-failed',transient);
      this.retryAfter = Date.now()+5000; this._broadcast();
    }).finally(()=>{this.tickPending = false;});
  }
}
