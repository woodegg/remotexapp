// This module is part of the guarded noVNC-private adapter boundary. It keeps
// private RFB state out of the public SDK while allowing the SDK to schedule
// when noVNC performs its normal ExtendedDesktopSize request.
export function createRemoteResizeBridge(rfb, onRequest) {
  if (!rfb || typeof rfb._requestRemoteResize !== 'function' || typeof rfb._screenSize !== 'function') {
    throw new Error('Unsupported noVNC remote resize interface');
  }
  if (typeof onRequest !== 'function') throw new TypeError('onRequest must be a function');

  const hadOwnRequest = Object.hasOwn(rfb, '_requestRemoteResize');
  const originalRequest = rfb._requestRemoteResize;
  let bypass = false;
  let disposed = false;

  rfb._requestRemoteResize = function scheduledRemoteResizeRequest(...args) {
    if (disposed || bypass) return originalRequest.apply(this, args);
    return onRequest();
  };

  return {
    snapshot() {
      const size = rfb._screenSize();
      const width = Math.max(1, Math.floor(Number(size?.w) || 0));
      const height = Math.max(1, Math.floor(Number(size?.h) || 0));
      const framebufferWidth = Math.max(0, Math.floor(Number(rfb._fbWidth) || 0));
      const framebufferHeight = Math.max(0, Math.floor(Number(rfb._fbHeight) || 0));
      return {
        enabled: rfb.resizeSession === true && rfb.viewOnly !== true,
        supported: rfb._supportsSetDesktopSize === true,
        pending: rfb._pendingRemoteResize === true,
        width,
        height,
        framebufferWidth,
        framebufferHeight,
        needsResize: width !== framebufferWidth || height !== framebufferHeight,
        earliestAt: Math.max(0, (Number(rfb._lastResize) || 0) + 100),
      };
    },

    request() {
      if (disposed) return false;
      bypass = true;
      try {
        originalRequest.call(rfb);
      } finally {
        bypass = false;
      }
      return true;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      if (hadOwnRequest) rfb._requestRemoteResize = originalRequest;
      else delete rfb._requestRemoteResize;
    },
  };
}
