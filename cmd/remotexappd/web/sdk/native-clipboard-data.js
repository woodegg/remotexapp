import {CLIPBOARD_FORMATS, clipboardPayload, textPayload, payloadText} from '../../../../third_party/kasm/clipboard-payload.mjs';

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

export async function readClipboard(capabilities) {
  if (!capabilities.clipboardRich || !richBrowserClipboard()) return textPayload(await navigator.clipboard.readText(), capabilities.clipboardMaxBytes);
  const items = await navigator.clipboard.read();
  if (items.length === 0 || (items.length === 1 && items[0].types.length === 0)) return textPayload('');
  if (items.length !== 1 || items[0].types.length < 1 || items[0].types.length > 3 ||
      items[0].types.some(type => !CLIPBOARD_FORMATS.includes(type)) || new Set(items[0].types).size !== items[0].types.length)
    throw Object.assign(new Error('clipboard-format'), {code:'clipboard-format'});
  let bytes = 0;
  const payload = [];
  for (const type of items[0].types) {
    const blob = await items[0].getType(type);
    bytes += blob.size;
    if (bytes > capabilities.clipboardMaxBytes) throw Object.assign(new Error('clipboard-size'), {code:'clipboard-size'});
    payload.push({type,data:new Uint8Array(await blob.arrayBuffer())});
  }
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
