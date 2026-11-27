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
// An ephemeral browser-local receipt ties normalized readback to this write.
// It is never forwarded to X11, exposed in state, or counted as user content.
const receiptType = 'web application/x-remotexapp-clipboard-receipt';
const receiptKey = Symbol();
const receiptSupported = () => richBrowserClipboard() &&
  globalThis.crypto?.randomUUID && ClipboardItem.supports?.(receiptType) === true;


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
  if (items.length !== 1) throw Object.assign(new Error('clipboard-format'), {code:'clipboard-format'});
  const types = items[0].types.filter(type => type !== receiptType);
  if (types.length < 1 || types.length > 3 ||
      types.some(type => !CLIPBOARD_FORMATS.includes(type)) || new Set(items[0].types).size !== items[0].types.length)
    throw Object.assign(new Error('clipboard-format'), {code:'clipboard-format'});
  let receipt;
  if (items[0].types.includes(receiptType)) {
    const blob = await items[0].getType(receiptType);
    if (blob.size > 64) throw Object.assign(new Error('clipboard-format'), {code:'clipboard-format'});
    const value = await blob.text();
    if (/^[0-9a-f-]{36}$/.test(value)) receipt = value;
  }
  const received = payload => {
    if (receipt) Object.defineProperty(payload, receiptKey, {value:receipt});
    return payload;
  };
  const budget = allowLocalOnly && globalThis.crypto?.subtle ? MAX_LOCAL_COMPARISON_BYTES : capabilities.clipboardMaxBytes;
  let bytes = 0;
  const blobs = [];
  for (const type of CLIPBOARD_FORMATS) {
    if (!types.includes(type)) continue;
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
    return received({bytes,localOnly});
  }
  const payload = [];
  for (const {type,blob} of blobs) payload.push({type,data:new Uint8Array(await blob.arrayBuffer())});
  return received(validateClipboard({items:payload}, capabilities));
}

export function writeClipboard(payload, capabilities, {receipt} = {}) {
  payload = validateClipboard(payload, capabilities);
  if (capabilities.clipboardRich && richBrowserClipboard()) {
    const values = Object.fromEntries(payload.items.map(({type,data}) => [type,new Blob([data], {type})]));
    if (receipt) values[receiptType] = new Blob([receipt], {type:receiptType.slice(4)});
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

// A resolved write is only browser admission. Never absorb an unrelated local
// copy as our normalized baseline or replay a write whose outcome is uncertain.
export async function writeAndVerifyClipboard(payload, capabilities, {check = () => {}} = {}) {
  payload = validateClipboard(payload, capabilities);
  const receipt = capabilities.clipboardRich && receiptSupported() ? crypto.randomUUID() : null;
  check();
  try { await writeClipboard(payload, capabilities, {receipt}); }
  catch (error) { error.clipboardStage = 'write'; throw error; }
  check();
  let local;
  try { local = await readClipboard(capabilities, {allowLocalOnly:true}); }
  catch (error) { error.clipboardStage = 'read'; throw error; }
  check();
  if (sameClipboard(payload, local)) return local;
  if (receipt && local[receiptKey] === receipt && local.bytes > 0) {
    const formats = local.items?.map(item => item.type) || local.localOnly?.map(item => item.split(':')[0]) || [];
    let preserved = payload.items.every(item => formats.includes(item.type));
    const plain = payload.items.find(item => item.type === 'text/plain');
    if (plain) {
      if (local.items) preserved &&= payloadText(local)?.replace(/\r\n/g,'\n') === payloadText(payload).replace(/\r\n/g,'\n');
      else {
        const digest = await crypto.subtle.digest('SHA-256', plain.data);
        check();
        preserved &&= local.localOnly.includes('text/plain:'+plain.data.length+':'+new Uint8Array(digest).join(','));
      }
    }
    if (preserved) return local;
  }
  throw Object.assign(new Error('Clipboard write could not be verified'), {code:'clipboard-uncertain'});
}
