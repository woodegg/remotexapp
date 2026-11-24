import {CLIPBOARD_FORMATS, clipboardPayload, textPayload, payloadText, sameClipboard} from '../../../../third_party/kasm/clipboard-payload.mjs';

export function richBrowserClipboard() {
  return !!(globalThis.navigator?.clipboard?.read && globalThis.navigator?.clipboard?.write &&
    typeof globalThis.ClipboardItem === 'function' && CLIPBOARD_FORMATS.every(type => !ClipboardItem.supports || ClipboardItem.supports(type)));
}

export function clipboardFormats(capabilities) {
  return capabilities.clipboard ? capabilities.clipboardRich && richBrowserClipboard() ? [...CLIPBOARD_FORMATS] : ['text/plain'] : [];
}

export function validateClipboard(value, capabilities) {
  return typeof value === 'string' ? textPayload(value, capabilities.clipboardMaxBytes)
    : clipboardPayload(value?.items, capabilities.clipboardMaxBytes, capabilities.clipboardRich ? CLIPBOARD_FORMATS : ['text/plain']);
}

// The browser may encode valid incoming data into a larger local item.
const MAX_LOCAL_COMPARISON_BYTES = 32 * 1024 * 1024;

export function sameLocalClipboard(a, b) {
  if (!a?.localOnly && !b?.localOnly) return sameClipboard(a, b);
  return !!(a?.localOnly && b?.localOnly && a.bytes === b.bytes &&
    a.localOnly.length === b.localOnly.length &&
    a.localOnly.every((part, index) => part === b.localOnly[index]));
}

export async function readClipboard(capabilities, {allowLocalOnly = false} = {}) {
  if (!capabilities.clipboardRich || !richBrowserClipboard()) return textPayload(await navigator.clipboard.readText(), capabilities.clipboardMaxBytes);
  const items = await navigator.clipboard.read();
  if (items.length === 0 || (items.length === 1 && items[0].types.length === 0)) return textPayload('');
  if (items.length !== 1 || items[0].types.length < 1 || items[0].types.length > 3 ||
      items[0].types.some(type => !CLIPBOARD_FORMATS.includes(type)) || new Set(items[0].types).size !== items[0].types.length)
    throw Object.assign(new Error('clipboard-format'), {code:'clipboard-format'});
  const budget = allowLocalOnly && globalThis.crypto?.subtle ? MAX_LOCAL_COMPARISON_BYTES : capabilities.clipboardMaxBytes;
  let bytes = 0;
  const blobs = [];
  for (const type of CLIPBOARD_FORMATS) {
    if (!items[0].types.includes(type)) continue;
    const blob = await items[0].getType(type);
    bytes += blob.size;
    if (bytes > budget) throw Object.assign(new Error('clipboard-size'), {code:'clipboard-size'});
    blobs.push({type,blob});
  }
  if (bytes > capabilities.clipboardMaxBytes) {
    const localOnly = [];
    for (const {type,blob} of blobs) {
      const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
      localOnly.push(type + ':' + blob.size + ':' + new Uint8Array(digest).join(','));
    }
    return {bytes,localOnly};
  }
  const payload = [];
  for (const {type,blob} of blobs) payload.push({type,data:new Uint8Array(await blob.arrayBuffer())});
  return validateClipboard({items:payload}, capabilities);
}

export function writeClipboard(payload, capabilities) {
  payload = validateClipboard(payload, capabilities);
  if (capabilities.clipboardRich && richBrowserClipboard()) {
    const values = Object.fromEntries(payload.items.map(({type,data}) => [type,new Blob([data], {type})]));
    return navigator.clipboard.write([new ClipboardItem(values)]);
  }
  if (payload.items.length !== 1 || payload.items[0].type !== 'text/plain')
    throw Object.assign(new Error('clipboard-format'), {code:'clipboard-format'});
  return navigator.clipboard.writeText(payloadText(payload));
}

export function sendClipboard(display, payload, capabilities) {
  payload = validateClipboard(payload, capabilities);
  if (capabilities.clipboardRich) display.sendClipboard(payload.items);
  else display.sendClipboardText(payloadText(payload));
}
