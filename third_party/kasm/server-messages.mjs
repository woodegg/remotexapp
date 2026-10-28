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
