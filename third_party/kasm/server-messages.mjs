// RemoteXApp integration with the MPL-2.0 Kasm client; see LICENSE.client.txt.
// The message type was consumed by RFB._normalMsg. Peek the entire variable
// payload before committing any bytes, so a split message can retry safely.
export function readVideoEncoders(sock) {
  const bytes = sock.rQslice(0);
  const need = size => sock.rQwait('VideoEncoders payload', size, 1);
  if (need(1)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const codecs = [], configurations = {};
  let offset = 1;
  for (let index = 0; index < bytes[0]; index++) {
    if (need(offset + 13)) return null;
    const codec = view.getUint32(offset), minQuality = view.getUint32(offset + 4);
    const maxQuality = view.getUint32(offset + 8), count = bytes[offset + 12];
    offset += 13;
    if (need(offset + count * 4)) return null;
    const presets = [];
    for (let preset = 0; preset < count; preset++, offset += 4) presets.push(view.getUint32(offset));
    codecs.push(codec);
    configurations[codec] = { minQuality, maxQuality, presets };
  }
  sock.rQskipBytes(offset);
  return { codecs, configurations };
}

export const MAX_CLIPBOARD_BYTES = 65536;

export function clipboardBytes(text) {
  if (typeof text !== 'string' || !text.isWellFormed() || text.includes('\0')) throw new TypeError('Invalid clipboard text');
  const data = new TextEncoder().encode(text);
  if (data.length > MAX_CLIPBOARD_BYTES) throw new RangeError('Clipboard exceeds byte limit');
  return data;
}

// A server message includes an operation ID before each MIME representation.
// Parse without consuming any payload until the complete bounded item exists.
export function readClipboardText(sock) {
  const need = size => sock.rQwait('Native clipboard', size, 1);
  if (need(1)) return null;
  const bytes = sock.rQslice(0);
  if (bytes[0] === 0) { sock.rQskipBytes(1); return {text:null}; }
  if (bytes[0] !== 1) throw new Error('Unsupported clipboard representations');
  if (need(6)) return null;
  if (bytes[5] !== 10) throw new Error('Unsupported clipboard MIME');
  if (need(20)) return null;
  const decoder = new TextDecoder('utf-8', {fatal:true});
  if (decoder.decode(bytes.subarray(6,16)) !== 'text/plain') throw new Error('Unsupported clipboard MIME');
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(16);
  if (size > MAX_CLIPBOARD_BYTES + 1) throw new RangeError('Clipboard exceeds byte limit');
  if (need(20 + size)) return null;
  let data = bytes.subarray(20,20 + size);
  if (data.length && data.at(-1) === 0) data = data.subarray(0,data.length - 1);
  if (data.length > MAX_CLIPBOARD_BYTES) throw new RangeError('Clipboard exceeds byte limit');
  const text = decoder.decode(data);
  if (text.includes('\0')) throw new TypeError('Invalid clipboard text');
  sock.rQskipBytes(20 + size);
  return {text};
}
