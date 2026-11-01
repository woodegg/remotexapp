// Per-connection diagnostics. Snapshot reads never send traffic.
export class LatencyProbe {
  constructor({connected, udpActive, peer, sendFence, now = () => performance.now(),
    token = crypto.randomUUID(), setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = id => clearTimeout(id)}) {
    Object.assign(this, {connected, udpActive, peer, sendFence, now, setTimer, clearTimer});
    this.prefix = `rx-rtt:${token}:`;
    this.sequence = 0;
    this.lastRequest = -Infinity;
    this.wss = {state:'waiting'};
    this.udp = {state:'waiting'};
  }

  measure() {
    if (this.closed || !this.connected() || this.now() - this.lastRequest < 5000) return false;
    this.lastRequest = this.now();
    if (!this.pending) {
      const payload = this.prefix + (++this.sequence);
      this.pending = {payload, start:this.now()};
      this.wss = {state:'pending'};
      this.pending.timer = this.setTimer(() => {
        this.pending = null;
        this.wss = {state:'timeout'};
      }, 5000);
      let sent = false;
      try { sent = this.sendFence(payload); } catch { /* Socket may retire before send. */ }
      if (!sent) {
        this.clearTimer(this.pending.timer);
        this.pending = null;
        this.wss = {state:'unavailable'};
      }
    }
    this.sampleUDP();
    return true;
  }

  fence(payload, flags) {
    if (flags !== 0 || !payload.startsWith(this.prefix)) return false;
    const number = payload.slice(this.prefix.length);
    if (!/^[1-9][0-9]*$/.test(number) || Number(number) > this.sequence) return false;
    // Late replies to our own retired samples must not resurrect a result or
    // disconnect an otherwise healthy display. Other Fence responses stay strict.
    if (!this.closed && this.connected() && this.pending?.payload === payload) {
      this.clearTimer(this.pending.timer);
      this.wss = {state:'ready', rttMs:Math.max(0, this.now() - this.pending.start), at:this.now()};
      this.pending = null;
    }
    return true;
  }

  sampleUDP() {
    const peer = this.peer();
    if (!this.udpActive() || !peer || peer.connectionState !== 'connected') return;
    if (this.udpRequest) return;
    if (this.udpPeer !== peer) {
      this.udpPeer = peer;
      this.udp = {state:'waiting'};
      this.responseCount = undefined;
      this.pairId = undefined;
    }
    const request = this.udpRequest = {};
    const finish = () => {
      if (this.udpRequest !== request) return false;
      this.clearTimer(request.timer);
      this.udpRequest = null;
      return !this.closed && this.connected() && this.udpActive() && this.peer() === peer;
    };
    request.timer = this.setTimer(() => {
      if (finish()) this.udp = {state:'timeout'};
    }, 5000);
    Promise.resolve().then(() => peer.getStats()).then(report => {
      if (!finish()) return;
      const ids = new Set([...report.values()].filter(s => s.type === 'transport' &&
        s.selectedCandidatePairId).map(s => s.selectedCandidatePairId));
      const pair = ids.size === 1 ? report.get([...ids][0]) : null;
      if (pair?.type !== 'candidate-pair' || pair.state !== 'succeeded' ||
          !Number.isFinite(pair.currentRoundTripTime) || pair.currentRoundTripTime < 0 ||
          !Number.isSafeInteger(pair.responsesReceived) || pair.responsesReceived < 1) {
        this.udp = {state:'unavailable'};
        return;
      }
      // Reading cached RTCStats is not a new ping. Age advances until an actual
      // STUN response arrives; do not expose candidates, addresses or raw stats.
      if (pair.id !== this.pairId || pair.responsesReceived !== this.responseCount) {
        this.pairId = pair.id;
        this.responseCount = pair.responsesReceived;
        this.udp = {state:'ready', rttMs:pair.currentRoundTripTime * 1000, at:this.now()};
      }
    }, () => { if (finish()) this.udp = {state:'unavailable'}; });
  }

  snapshot() {
    if (this.closed || !this.connected()) return {wss:{state:'inactive'}, udp:{state:'inactive'}};
    const value = sample => {
      if (sample.state !== 'ready') return {state:sample.state};
      const ageMs = Math.max(0, this.now() - sample.at);
      return ageMs > 10000 ? {state:'stale', ageMs} : {state:'ready', rttMs:sample.rttMs, ageMs};
    };
    const peer = this.peer();
    return {wss:value(this.wss), udp:!this.udpActive() || !peer || peer.connectionState !== 'connected'
      ? {state:'inactive'} : peer !== this.udpPeer ? {state:'waiting'} : value(this.udp)};
  }

  dispose() {
    this.closed = true;
    this.clearTimer(this.pending?.timer);
    this.clearTimer(this.udpRequest?.timer);
    this.pending = this.udpRequest = this.udpPeer = null;
    this.wss = this.udp = {state:'inactive'};
  }
}
