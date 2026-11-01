// Bounded, unordered Kasm rectangle reassembly. UDP loss is expected; duplicate
// fragments must not complete a rectangle or increase retained memory.
// Diagnostics count application blocks (one sender ID), never IP packets.
export class UDPLossTracker {
  #pending = new Map();
  #buckets = new Map();
  #lastId = null;
  #lastAt = null;
  #problemAt = -Infinity;
  clear() {
    this.#pending.clear(); this.#buckets.clear();
    this.#lastId = this.#lastAt = null; this.#problemAt = -Infinity;
  }
  get pendingBlocks() { return this.#pending.size; }
  #add(at, lost) {
    const key = Math.floor(at / 1000), b = this.#buckets.get(key) || {received:0,lost:0};
    b[lost ? 'lost' : 'received']++;
    this.#buckets.set(key,b);
  }
  observe(id, index, count, frame, now) {
    for (const [key,item] of this.#pending) if (now >= item.deadline) {
      this.#add(item.deadline,true); this.#pending.delete(key);
    }
    for (const key of this.#buckets.keys()) if (key < Math.floor(now / 1000) - 9) this.#buckets.delete(key);
    const distance = this.#lastId == null ? 1 : (id - this.#lastId) >>> 0;
    if (distance > 0 && distance < 0x80000000) {
      if (distance > 512 || this.#pending.size + distance > 512) {
        // An unbounded gap or tracking pressure cannot be called measured loss.
        this.#pending.clear(); this.#problemAt = now;
      } else if (this.#lastId != null) {
        for (let n=1; n<distance; n++) this.#pending.set((this.#lastId+n)>>>0,{deadline:now+2000});
      }
      this.#pending.set(id,{deadline:now+2000});
      this.#lastId = id;
    }
    const item = this.#pending.get(id);
    if (!item) return; // Duplicate, already finalized, or before the first observed ID.
    if (item.count == null) {
      item.count = count; item.frame = frame; item.received = 0;
      item.bits = new Uint8Array(Math.ceil(count / 8));
    } else if (item.count !== count || item.frame !== frame) {
      this.#problemAt = now; return;
    }
    const offset = index >>> 3, mask = 1 << (index & 7);
    if (item.bits[offset] & mask) return;
    item.bits[offset] |= mask; item.received++; this.#lastAt = now;
    if (item.received === count) {
      this.#add(now,false); this.#pending.delete(id);
    }
  }
  snapshot(now) {
    const base = {scope:'display-blocks',windowMs:10000,settleMs:2000};
    if (now - this.#problemAt < 10000) return {...base,state:'unavailable'};
    if (this.#lastAt == null) return {...base,state:'waiting'};
    const ageMs = Math.max(0,now-this.#lastAt);
    if (ageMs >= 10000) return {...base,state:'stale',ageMs};
    const first = Math.floor(now/1000)-9;
    let receivedBlocks = 0, lostBlocks = 0;
    for (const [key,b] of this.#buckets) if (key >= first) {
      receivedBlocks += b.received; lostBlocks += b.lost;
    }
    // Read-only projection: timeouts become visible even when packets stop.
    for (const item of this.#pending.values()) if (now >= item.deadline && Math.floor(item.deadline/1000) >= first) lostBlocks++;
    const expectedBlocks = receivedBlocks + lostBlocks;
    return expectedBlocks ? {...base,state:'ready',receivedBlocks,lostBlocks,expectedBlocks,
      ratio:lostBlocks/expectedBlocks,ageMs} : {...base,state:'waiting'};
  }
}

export class UDPAssembler {
  #pending = new Map();
  #bytes = 0;
  #loss = new UDPLossTracker();
  clear() { this.#pending.clear(); this.#bytes = 0; this.#loss.clear(); }
  lossStats(now = performance.now()) { return this.#loss.snapshot(now); }
  get retainedBytes() { return this.#bytes; }
  get size() { return this.#pending.size; }
  #remove(id) {
    const item = this.#pending.get(id);
    if (item) this.#bytes -= item.bytes;
    this.#pending.delete(id);
  }
  push(packet, now = performance.now()) {
    for (const [id, item] of this.#pending) if (now - item.at > 2000) this.#remove(id);
    if (!(packet instanceof Uint8Array) || packet.length < 21 || packet.length > 65536) return null;
    const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
    const id = view.getUint32(0, true), index = view.getUint32(4, true), count = view.getUint32(8, true);
    const frame = view.getUint32(16, true);
    if (count < 1 || count > 8192 || index >= count) return null;
    this.#loss.observe(id,index,count,frame,now);
    if (count === 1) return {data:packet.slice(20), frame};
    let item = this.#pending.get(id);
    if (item && (item.count !== count || item.frame !== frame)) { this.#remove(id); return null; }
    if (!item) {
      if (this.#pending.size >= 16) this.#remove(this.#pending.keys().next().value);
      item = {count, frame, at:now, parts:new Map(), bytes:0};
      this.#pending.set(id, item);
    }
    if (item.parts.has(index)) return null;
    const data = packet.slice(20);
    if (item.bytes + data.length > 4 * 1024 * 1024 || this.#bytes + data.length > 8 * 1024 * 1024) {
      this.#remove(id); return null;
    }
    item.parts.set(index, data); item.bytes += data.length; this.#bytes += data.length;
    if (item.parts.size !== count) return null;
    const merged = new Uint8Array(item.bytes);
    let offset = 0;
    for (let i = 0; i < count; i++) { const part = item.parts.get(i); merged.set(part, offset); offset += part.length; }
    this.#remove(id);
    return {data:merged, frame};
  }
}
