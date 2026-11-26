// PCM v1: bounded queues, no microphone sidetone, no recording or persistence.
class RemoteXAppPlayback extends AudioWorkletProcessor {
  constructor() {
    super(); this.disposed = false; this.acknowledged = false; this.streams = new Map(); this.blocks = 0; this.underruns = 0; this.dropped = 0; this.peak = 0;
    this.port.onmessage = ({data}) => {
      if (this.disposed) return;
      if (data.op === 'dispose') { this.disposed = true; this.streams.clear(); this.peak = 0; return; }
      if (data.op === 'reset') { for (const stream of this.streams.values()) for (const _ of stream.queue) this.port.postMessage({type:'credit'}); this.streams.clear(); return; }
      if (data.op === 'remove') { const s = this.streams.get(data.slot); if (s) for (const _ of s.queue) this.port.postMessage({type:'credit'}); this.streams.delete(data.slot); return; }
      if (data.op !== 'frame' || !(data.pcm instanceof ArrayBuffer) || data.pcm.byteLength !== 3840 || data.slot < 1 || data.slot > 8) return;
      let stream = this.streams.get(data.slot);
      if (!stream) { stream = {queue:[], offset:0}; this.streams.set(data.slot,stream); }
      if (stream.queue.length >= 8) { stream.queue.shift(); stream.offset = 0; this.dropped++; this.port.postMessage({type:'credit'}); }
      stream.queue.push(new Int16Array(data.pcm));
    };
  }
  process(_inputs, outputs) {
    if (this.disposed) {
      for (const channel of outputs[0] || []) channel.fill(0);
      if (!this.acknowledged) { this.acknowledged = true; this.port.postMessage({type:'disposed'}); this.port.onmessage = null; }
      return false;
    }
    const out = outputs[0]; if (!out?.length) return true;
    for (const channel of out) channel.fill(0);
    for (const stream of this.streams.values()) {
      let missed = false;
      for (let i=0;i<out[0].length;i++) {
        const frame = stream.queue[0]; if (!frame) { missed = true; break; }
        out[0][i] += frame[stream.offset*2]/32768;
        if (out[1]) out[1][i] += frame[stream.offset*2+1]/32768;
        if (++stream.offset === 960) { stream.queue.shift(); stream.offset = 0; this.port.postMessage({type:'credit'}); }
      }
      if (missed) this.underruns++;
    }
    for (const channel of out) for (let i=0;i<channel.length;i++) { channel[i] = Math.max(-1,Math.min(1,channel[i])); this.peak = Math.max(this.peak,Math.abs(channel[i])); }
    if (++this.blocks >= 375) { this.blocks = 0; this.port.postMessage({type:'stats',underrunBlocks:this.underruns,droppedFrames:this.dropped,peak:this.peak,queuedFrames:[...this.streams.values()].reduce((n,s)=>n+s.queue.length,0)}); this.peak = 0; }
    return true;
  }
}
class RemoteXAppCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.disposed = false; this.acknowledged = false; this.frame = new Int16Array(960); this.offset = 0; this.credits = 8; this.frames = 0; this.dropped = 0; this.energy = 0;
    this.delivery = null;
    this.port.onmessage = ({data}) => {
      if (this.disposed) return;
      if (data.op === 'dispose') { this.disposed = true; this.delivery = this.frame = null; this.offset = this.energy = this.credits = 0; return; }
      if (data.op === 'credit') this.credits = Math.min(8,this.credits+1);
      if (data.op === 'delivery') {
        this.delivery = data.delivery;
        this.offset = this.energy = this.frames = 0;
        this.frame.fill(0);
      }
    };
  }
  process(inputs, outputs) {
    // The graph runs against a silent output. Captured microphone samples are
    // never copied into the local playback path.
    for (const channel of outputs[0] || []) channel.fill(0);
    if (this.disposed) {
      if (!this.acknowledged) { this.acknowledged = true; this.port.postMessage({type:'disposed'}); this.port.onmessage = null; }
      return false;
    }
    const channels = inputs[0]; if (!this.delivery || !channels?.length) return true;
    for (let i=0;i<channels[0].length;i++) {
      let value = 0; for (const channel of channels) value += channel[i] || 0;
      value = Math.max(-1,Math.min(1,value/channels.length)); this.energy += value*value;
      this.frame[this.offset++] = Math.round(value*(value < 0 ? 32768 : 32767));
      if (this.offset === 960) {
        if (this.credits > 0) { const pcm = this.frame.buffer; this.credits--; this.port.postMessage({type:'pcm',delivery:this.delivery,pcm},[pcm]); }
        else this.dropped++;
        this.frame = new Int16Array(960); this.offset = 0;
        if (++this.frames % 50 === 0) { this.port.postMessage({type:'stats',level:Math.sqrt(this.energy/48000),droppedFrames:this.dropped}); this.energy = 0; }
      }
    }
    return true;
  }
}
registerProcessor('remotexapp-playback-v1',RemoteXAppPlayback);
registerProcessor('remotexapp-capture-v1',RemoteXAppCapture);
