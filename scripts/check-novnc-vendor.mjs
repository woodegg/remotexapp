import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendorRoot = process.env.NOVNC_VENDOR_ROOT
  ? path.resolve(process.env.NOVNC_VENDOR_ROOT)
  : path.join(projectRoot, 'third_party/novnc');
const upstream = JSON.parse(readFileSync(path.join(vendorRoot, 'UPSTREAM.json'), 'utf8'));
const packageData = JSON.parse(readFileSync(path.join(vendorRoot, 'package.json'), 'utf8'));

assert.equal(upstream.schemaVersion, 1);
assert.equal(upstream.project, 'novnc/noVNC');
assert.match(upstream.release, /^v\d+\.\d+\.\d+$/);
assert.equal(upstream.release, `v${upstream.version}`);
assert.equal(packageData.version, upstream.version);
assert.match(upstream.commit, /^[0-9a-f]{40}$/);
assert.match(upstream.archiveSha256, /^[0-9a-f]{64}$/);
assert.equal(upstream.archiveUrl,
  `https://github.com/novnc/noVNC/archive/${upstream.commit}.tar.gz`);

for (const relativePath of [
  'AUTHORS',
  'LICENSE.txt',
  'docs/LICENSE.MPL-2.0',
  'vendor/pako/LICENSE',
  'core/rfb.js',
  'core/input/keyboard.js',
  'core/input/util.js',
]) {
  readFileSync(path.join(vendorRoot, relativePath));
}

const rfbSource = readFileSync(path.join(vendorRoot, 'core/rfb.js'), 'utf8');
const keyboardSource = readFileSync(path.join(vendorRoot, 'core/input/keyboard.js'), 'utf8');
const keyboardUtilSource = readFileSync(path.join(vendorRoot, 'core/input/util.js'), 'utf8');
const adapterSource = readFileSync(path.join(projectRoot,
  'cmd/remotexappd/web/assets-src/novnc-entry.js'), 'utf8');
const resizeBridgeSource = readFileSync(path.join(projectRoot,
  'cmd/remotexappd/web/assets-src/novnc-resize-bridge.mjs'), 'utf8');
const clientSource = readFileSync(path.join(projectRoot,
  'cmd/remotexappd/web/sdk/remotexapp-client.js'), 'utf8');
const displaySource = readFileSync(path.join(vendorRoot, 'core/display.js'), 'utf8');
assert.match(displaySource, /this\._targetCtx\.drawImage\(this\._backbuffer/,
  'noVNC visible paint boundary changed; review connection mask adapter');
assert.match(rfbSource, /this\._display\s*=\s*new Display/);
assert.match(rfbSource, /this\._rfbConnectionState/);
assert.match(adapterSource, /observePaintedFrame/);

assert.match(rfbSource, /this\._keyboard\s*=\s*new Keyboard\(/,
  'noVNC private keyboard object changed; review the RemoteXApp adapter');
assert.match(rfbSource, /_requestRemoteResize\(\)\s*{/,
  'noVNC private resize request changed; review the RemoteXApp adapter');
assert.match(rfbSource, /_screenSize\(\)\s*{/,
  'noVNC private screen-size helper changed; review the RemoteXApp adapter');
for (const field of ['_supportsSetDesktopSize', '_pendingRemoteResize', '_lastResize', '_fbWidth', '_fbHeight']) {
  assert.match(rfbSource, new RegExp(`this\\.${field}\\b`),
    `noVNC private resize field ${field} changed; review the RemoteXApp adapter`);
}
assert.match(keyboardSource, /\bungrab\(\)\s*{/,
  'noVNC keyboard ungrab contract changed; review IME capture behavior');
assert.match(keyboardUtilSource, /export function getKeycode\(/);
assert.match(keyboardUtilSource, /export function getKeysym\(/);
assert.match(adapterSource, /rfb\?\._keyboard/,
  'the documented private keyboard boundary is missing from the noVNC adapter');
assert.match(adapterSource, /createRemoteResizeBridge/,
  'the documented private resize boundary is missing from the noVNC adapter');
for (const field of ['_requestRemoteResize', '_screenSize', '_supportsSetDesktopSize', '_pendingRemoteResize', '_lastResize', '_fbWidth', '_fbHeight']) {
  assert.match(resizeBridgeSource, new RegExp(`\\.${field}\\b`),
    `the noVNC resize adapter no longer guards private field ${field}`);
}
assert.doesNotMatch(clientSource, /\._keyboard/,
  'application SDK code must not access noVNC private keyboard state directly');
for (const field of ['_requestRemoteResize', '_screenSize', '_supportsSetDesktopSize', '_pendingRemoteResize']) {
  assert.doesNotMatch(clientSource, new RegExp(`\\.${field}\\b`),
    `application SDK code must not access noVNC private resize state ${field} directly`);
}

console.log(`vendored noVNC ${upstream.release} (${upstream.commit.slice(0, 12)}) passed compatibility checks`);
