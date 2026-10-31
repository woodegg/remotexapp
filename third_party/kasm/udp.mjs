// Bounded, unordered Kasm rectangle reassembly. UDP loss is expected; duplicate
// fragments must not complete a rectangle or increase retained memory.
export class UDPAssembler {
  #pending = new Map();
  #bytes = 0;
  clear() { this.#pending.clear(); this.#bytes = 0; }
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
