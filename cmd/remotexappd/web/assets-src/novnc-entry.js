// This is the only boundary allowed to depend on noVNC-private interfaces.
// scripts/check-novnc-vendor.mjs guards them before an upstream update merges.
export { default as RFB } from 'novnc-core/rfb.js';
export * as KeyboardUtil from 'novnc-core/input/util.js';
export { createRemoteResizeBridge } from './novnc-resize-bridge.mjs';
export { observePaintedFrame } from './novnc-frame-bridge.mjs';

export function disableKeyboardCapture(rfb) {
  if (!rfb?._keyboard || typeof rfb._keyboard.ungrab !== 'function') {
    throw new Error('Unsupported noVNC keyboard interface');
  }
  rfb._keyboard.ungrab();
}
