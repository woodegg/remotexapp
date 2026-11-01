// One coordinator per canonical Manager origin/base, browser storage partition
// and worker protocol. A server-issued cookie binds the current login epoch.
export class AudioCoordinator {
  constructor(env = globalThis) {
    this.env = env; this.ports = new Map(); this.routes = new Map(); this.pending = new Map(); this.serial = Promise.resolve(); this.client = env.crypto.randomUUID();
    this.connection = null; this.socket = null; this.capture = null; this.player = null; this.next = 0; this.epoch = 0; this.sequence = 0; this.received = 0; this.sent = 0; this.dropped = 0; this.reason = '';
    this.timer = env.setInterval(()=>this._tick(),1000);
  }
  add(port) {
    const peer = {port,id:this.env.crypto.randomUUID(),refs:new Map(),seen:Date.now(),ready:false,credits:8}; this.ports.set(port,peer);
    port.onmessage = ({data}) => this.receive(peer,data); port.onmessageerror = () => this._enqueue(()=>this._remove(peer)); port.start();
  }
  _send(peer,value,transfer) { if (!this.ports.has(peer.port)) return; try { peer.port.postMessage(value,transfer || []); } catch { this._enqueue(()=>this._remove(peer)); } }
  _enqueue(fn) { const result = this.serial.then(fn); this.serial = result.catch(()=>{}); return result; }
  receive(peer,data) {
    if (!this.ports.has(peer.port) || !data || typeof data.op !== 'string') return;
    peer.seen = Date.now();
    if (data.op === 'pong') return;
    if (data.op === 'playback-credit') { peer.credits = Math.min(8,peer.credits+1); return; }
    if (data.op === 'microphone-frame') { this._mic(peer,data); return; }
    if (data.op === 'capture-ready' || data.op === 'capture-failed') {
      const capture = this.capture;
      if (capture?.peer !== peer || (data.token && data.token !== capture.token)) return;
      if (data.op === 'capture-ready') { capture.ready = true; capture.resolve?.(); capture.resolve = capture.reject = null; }
      else { this._stopCapture(data.reason || 'microphone-ended'); this._enqueue(()=>this._sync()).catch(()=>{}); }
      return;
    }
    // Cancellation must not wait behind an outstanding browser permission prompt.
    if ((data.op === 'microphone' && !data.enabled || data.op === 'dispose') && this.capture?.peer === peer && !this.capture.ready) this._stopCapture('microphone-cancelled');
    this._enqueue(async()=>{
      let value;
      try { value = await this._command(peer,data); if (data.request) this._send(peer,{reply:data.request,value}); }
      catch (error) { if (data.request) this._send(peer,{reply:data.request,error:error.message || 'Audio operation failed'}); this.reason = error.message; this._broadcast(); }
    });
  }
  async _api(action,body = {}) {
    const response = await this.env.fetch(this.base+'/api/audio/'+action,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
    const data = await response.json(); if (!response.ok) { const error = Error(data.error || 'Audio API unavailable'); error.status = response.status; throw error; } return data;
  }
  async _context() {
    const context = await this._api('context');
    if (context.protocol !== 'pcm-s16le-48k-v1' || !/^[a-f0-9]{64}$/.test(context.scope || '') || !/^[a-f0-9]{64}$/.test(context.service || '')) throw Error('Unsupported audio contract');
    if (this.context && (context.scope !== this.context.scope || context.service !== this.context.service)) {
      this._retire('account-or-service-epoch-changed'); this.context = context; throw Error('Audio epoch changed; acquire current session interests again');
    }
    this.context = context; return context;
  }
  _body(extra = {}) { return {scope:this.context.scope,client:this.client,connection:this.connection,...extra}; }
  _retire(reason) {
    this._disconnect(reason); this._stopCapture(reason);
    this.routes.clear(); for (const peer of this.ports.values()) { peer.refs.clear(); this._send(peer,{type:'retired',reason}); }
    this.reason = reason; this._broadcast();
  }
  async _command(peer,data) {
    if (data.op === 'init') {
      const base = new URL(data.base);
      if (base.origin !== this.env.location.origin || base.search || base.hash || base.username || base.password) throw Error('Invalid audio service origin');
      if (this.base && this.base !== data.base) throw Error('Audio service scope differs');
      this.base = data.base; if (!this.context) await this._context(); this._broadcast(); return {protocol:this.context.protocol};
    }
    if (data.op === 'dispose') return this._remove(peer);
    if (!this.context) throw Error('Audio controller not initialized');
    if (data.op === 'logout') { const body = this._body(); this._retire('logout'); await this._api('logout',body); this.context = null; return; }
    if (data.op === 'playback-ready') { peer.ready = !!data.ready; this._selectPlayer(); this._broadcast(); return; }
    if (data.op === 'acquire') {
      if (!/^[a-zA-Z0-9_.-]{1,128}$/.test(data.runtime || '') || !Number.isSafeInteger(data.generation) || data.generation < 1 || typeof data.ref !== 'string' || data.ref.length > 64 || peer.refs.has(data.ref)) throw Error('Invalid audio interest');
      const key = data.runtime+':'+data.generation;
      let route = this.routes.get(key);
      if (!route) {
        const used = new Set([...this.routes.values()].map(r=>r.slot)); let slot = 1; while (used.has(slot)) slot++;
        if (slot > 8) throw Error('Audio session capacity reached');
        route = {key,runtime:data.runtime,generation:data.generation,slot,refs:new Set(),speaker:false,mic:false,actualSpeaker:false,actualMic:false,applied:'',reason:''}; this.routes.set(key,route);
      }
      const ref = {peer,id:data.ref,route}; peer.refs.set(data.ref,ref); route.refs.add(ref); this._broadcast(); return;
    }
    const ref = peer.refs.get(data.ref); if (!ref) throw Error('Audio interest is retired');
    const route = ref.route;
    if (data.op === 'release') { peer.refs.delete(data.ref); route.refs.delete(ref); if (!route.refs.size) { route.speaker = route.mic = false; await this._syncRoute(route); this.routes.delete(route.key); } await this._sync(); return; }
    if (data.op === 'speaker') {
      await this._context(); route.speaker = !!data.enabled; route.reason = ''; this._selectPlayer(); await this._sync(); return this._routeState(route);
    }
    if (data.op === 'microphone') {
      await this._context();
      if (data.enabled) {
        await this._ensureCapture(peer); route.mic = true; route.takeover = !!data.takeover; route.reason = '';
      } else route.mic = false;
      try { await this._sync(); } catch (error) { route.mic = false; this._releaseCaptureIfUnused(); throw error; }
      return this._routeState(route);
    }
    throw Error('Unknown audio operation');
  }
  _routeState(r) { return {runtime:r.runtime,generation:r.generation,slot:r.slot,speaker:r.speaker,mic:r.mic,actualSpeaker:r.actualSpeaker,actualMic:r.actualMic,reason:r.reason,refs:r.refs.size,domain:r.domain || null}; }
  _broadcast() {
    const routes = [...this.routes.values()].map(r=>this._routeState(r));
    for (const peer of this.ports.values()) this._send(peer,{type:'state',connection:this.socket?.readyState === 1 ? 'connected' : 'idle',protocol:this.connection?'WSS / PCM16 48 kHz':null,playbackBlocked:routes.some(r=>r.speaker)&&!this.player,connectionId:this.connection,speakerOwner:this.player===peer,micOwner:this.capture?.peer===peer,reason:this.reason,routes,receivedBytes:this.received,sentBytes:this.sent,droppedFrames:this.dropped});
  }
  _selectPlayer() {
    const wanted = [...this.routes.values()].some(r=>r.speaker);
    const next = wanted ? (this.player?.ready && this.ports.has(this.player.port) ? this.player : [...this.ports.values()].find(p=>p.ready)) : null;
    if (next !== this.player) { if (this.player) this._send(this.player,{type:'reset-playback'}); this.player = next || null; if (this.player) { this.player.credits = 8; this._send(this.player,{type:'reset-playback'}); } }
  }
  async _ensureCapture(peer) {
    if (this.capture?.ready) return;
    if (this.capture) throw Error('Microphone permission is already pending');
    const token = this.env.crypto.randomUUID();
    await new Promise((resolve,reject)=>{
      const timeout = this.env.setTimeout(()=>{if (this.capture?.token===token) this._stopCapture('microphone-permission-timeout');},15000);
      this.capture = {peer,token,ready:false,resolve:()=>{this.env.clearTimeout(timeout);resolve();},reject:error=>{this.env.clearTimeout(timeout);reject(error);}};
      this._send(peer,{type:'capture',token});
    });
  }
  _stopCapture(reason) {
    const capture = this.capture; this.capture = null;
    if (capture) { capture.reject?.(Error(reason)); this._send(capture.peer,{type:'stop-capture',reason}); }
    for (const route of this.routes.values()) { if (route.mic) route.reason = reason; route.mic = false; }
    this._broadcast();
  }
  _releaseCaptureIfUnused() { if (![...this.routes.values()].some(r=>r.mic)) this._stopCapture('all-microphones-disabled'); }
  async _connect() {
    if (this.connection && this.socket?.readyState===1) return;
    const grant = await this._api('grant',this._body());
    if (!/^[a-f0-9]{64}$/.test(grant.token || '')) throw Error('Invalid audio grant');
    const url = new URL(this.base+'/api/audio/ws'); url.protocol = url.protocol==='https:'?'wss:':'ws:';
    const epoch = ++this.epoch;
    await new Promise((resolve,reject)=>{
      const socket = this.socket = new this.env.WebSocket(url.href,['remotexapp-audio.'+grant.token]); socket.binaryType = 'arraybuffer';
      const timeout = this.env.setTimeout(()=>{socket.close();reject(Error('Audio connection timed out'));},5000);
      socket.onmessage = ({data})=>{
        if (epoch!==this.epoch) return;
        if (data instanceof ArrayBuffer) { this._speaker(data); return; }
        let message; try { message = JSON.parse(data); } catch { socket.close(); return; }
        if (message.type==='connected') { this.env.clearTimeout(timeout); this.connection = message.connection; this.lastRenew = Date.now(); this.reason = ''; resolve(); this._broadcast(); return; }
        this._serverMessage(message);
      };
      socket.onclose = ()=>{this.env.clearTimeout(timeout);reject(Error('Audio connection closed'));if (epoch===this.epoch) {this._disconnect('network-disconnected');this._stopCapture('network-disconnected');this.retryAfter = Date.now()+1000;this._broadcast();}};
      socket.onerror = ()=>{};
    });
  }
  _disconnect(reason) {
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
    if (route && message.type==='state') {
      route.actualSpeaker = !!message.speaker; route.actualMic = !!message.mic;
      if (message.domain) route.domain = message.domain;
      if (message.reason && message.reason!=='reconfigured' && message.reason!=='disabled') {
        route.reason = message.reason; route.applied = '';
        if (['domain-retired','generation-retired'].includes(message.reason)) { route.mic = false; if (message.reason==='generation-retired') route.speaker = false; }
        if (message.reason.startsWith('mic-')) route.mic = false;
        if (message.reason==='speaker-ended') route.speaker = false;
      }
      if (!route.actualSpeaker && this.player) this._send(this.player,{type:'remove-playback',slot:route.slot});
    }
    const pending = this.pending.get(message.request);
    if (pending) { this.pending.delete(message.request); this.env.clearTimeout(pending.timeout); message.type==='error' ? pending.reject(Error(message.reason)) : pending.resolve(message); }
    // Do not stop a just-approved capture while an in-flight reconfiguration
    // emits the old slot's disabled state ahead of the new acknowledgment.
    this._releaseCaptureIfUnused(); this._broadcast();
  }
  async _syncRoute(route) {
    if (!this.connection) { route.applied = ''; return; }
    if (!route.speaker && !route.mic) {
      if (route.applied) await this._control({op:'unsubscribe',slot:route.slot});
      route.applied = ''; route.actualSpeaker = route.actualMic = false; return;
    }
    const key = this.connection+':'+route.speaker+':'+route.mic;
    if (route.applied === key) return;
    const grant = await this._api('route',this._body({runtime:route.runtime,generation:route.generation}));
    const state = await this._control({op:'subscribe',slot:route.slot,token:grant.token,speaker:route.speaker,mic:route.mic,takeover:!!route.takeover});
    route.takeover = false; route.domain = grant.domain;
    route.applied = this.connection+':'+route.speaker+':'+route.mic;
    if (!state.speaker && route.speaker) { route.speaker = false; route.reason = state.reason || 'speaker-unavailable'; }
    if (!state.mic && route.mic) { route.mic = false; route.reason = state.reason || 'mic-unavailable'; }
  }
  async _sync() {
    const wanted = [...this.routes.values()].some(r=>r.speaker||r.mic);
    if (!wanted) { this._disconnect('all-audio-disabled'); this._releaseCaptureIfUnused(); this._selectPlayer(); this._broadcast(); return; }
    await this._connect();
    for (const route of this.routes.values()) await this._syncRoute(route);
    this._releaseCaptureIfUnused(); this._selectPlayer(); this._broadcast();
    if (![...this.routes.values()].some(r=>r.speaker||r.mic)) this._disconnect('no-authorized-audio-targets');
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
    this._send(peer,{type:'playback',slot,pcm},[pcm]);
  }
  _mic(peer,message) {
    const capture = this.capture;
    this._send(peer,{type:'microphone-credit'});
    if (capture?.peer!==peer || capture.token!==message.token || !capture.ready || !(message.pcm instanceof ArrayBuffer) || message.pcm.byteLength!==1920 || ![...this.routes.values()].some(r=>r.actualMic)) return;
    if (this.socket?.readyState!==1 || this.socket.bufferedAmount>3840) { this.dropped++; return; }
    const pcm = new Uint8Array(message.pcm); const silent = pcm.every(v=>v===0);
    const buffer = new ArrayBuffer(silent?8:1928); const view = new DataView(buffer);
    view.setUint8(0,1); view.setUint8(1,2); view.setUint8(3,silent?1:0); view.setUint32(4,++this.sequence,true); if (!silent) new Uint8Array(buffer,8).set(pcm);
    this.socket.send(buffer); this.sent += buffer.byteLength;
  }
  async _remove(peer) {
    if (!this.ports.has(peer.port)) return;
    if (this.capture?.peer===peer) this._stopCapture('microphone-owner-ended');
    for (const ref of peer.refs.values()) { ref.route.refs.delete(ref); if (!ref.route.refs.size) { ref.route.speaker = ref.route.mic = false; try { await this._syncRoute(ref.route); } catch {} this.routes.delete(ref.route.key); } }
    peer.refs.clear(); this.ports.delete(peer.port); peer.port.close(); this._selectPlayer(); await this._sync();
  }
  _tick() {
    if (!this.base || this.tickPending) return;
    this.tickPending = true;
    this._enqueue(async()=>{
      for (const peer of this.ports.values()) { if (Date.now()-peer.seen>75000) await this._remove(peer); else this._send(peer,{type:'ping'}); }
      if (this.connection && Date.now()-this.lastRenew>=10000) {
        await this._context(); await this._api('renew',this._body()); this.lastRenew = Date.now();
      }
      if (Date.now()>=(this.retryAfter || 0) && [...this.routes.values()].some(r=>r.speaker||r.mic)) await this._sync();
      this._broadcast();
    }).catch(error=>{
      this.reason = error.message; this._disconnect('audio-lease-or-route-failed'); this._stopCapture('audio-lease-or-route-failed');
      this.retryAfter = Date.now()+5000; this._broadcast();
    }).finally(()=>{this.tickPending = false;});
  }
}
