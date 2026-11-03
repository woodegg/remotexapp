// Bounded native clipboard data; no browser access, persistence or diagnostics.
export const CLIPBOARD_FORMATS = Object.freeze(['text/plain', 'text/html', 'image/png']);
export const MAX_RICH_CLIPBOARD_BYTES = 2 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal:true});
const failure = code => Object.assign(new Error(code), {code});

export function clipboardPayload(items, maxBytes = MAX_RICH_CLIPBOARD_BYTES, formats = CLIPBOARD_FORMATS) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 3) throw failure('clipboard-format');
  const found = new Map();
  let bytes = 0;
  for (const item of items) {
    if (!item || !formats.includes(item.type) || found.has(item.type) || !(item.data instanceof Uint8Array)) throw failure('clipboard-format');
    bytes += item.data.byteLength;
    if (bytes > maxBytes) throw failure('clipboard-size');
    if (item.type.startsWith('text/')) {
      let text;
      try { text = decoder.decode(item.data); } catch (_) { throw failure('clipboard-format'); }
      if (text.includes('\0')) throw failure('clipboard-format');
    }
    found.set(item.type, item.data);
  }
  return {items:CLIPBOARD_FORMATS.filter(type => found.has(type)).map(type => ({type,data:found.get(type)})), bytes};
}

export function textPayload(text, maxBytes = MAX_RICH_CLIPBOARD_BYTES) {
  if (typeof text !== 'string' || !text.isWellFormed() || text.includes('\0')) throw failure('clipboard-format');
  // Reject before encoding a potentially enormous JS string.
  if (text.length > maxBytes) throw failure('clipboard-size');
  return clipboardPayload([{type:'text/plain',data:encoder.encode(text)}], maxBytes);
}

export function payloadText(payload) {
  const item = payload.items.find(item => item.type === 'text/plain');
  return item ? decoder.decode(item.data) : undefined;
}

export function sameClipboard(a, b) {
  if (a === b) return true;
  if (!a || !b || a.bytes !== b.bytes || a.items.length !== b.items.length) return false;
  return a.items.every((item, index) => {
    const other = b.items[index];
    if (item.type !== other.type || item.data.length !== other.data.length) return false;
    for (let i = 0; i < item.data.length; i++) if (item.data[i] !== other.data[i]) return false;
    return true;
  });
}
