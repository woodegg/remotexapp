// Keep private noVNC rendering access at the reviewed adapter boundary.
export function observePaintedFrame(rfb, onPaint) {
  const context = rfb?._display?._targetCtx;
  if (typeof context?.drawImage !== 'function') throw new Error('Unsupported noVNC painted-frame interface');
  const original = context.drawImage;
  let active = true;
  function drawImage(...args) {
    const result = original.apply(this, args);
    // The display's target canvas is the visible canvas, not its backbuffer.
    // Ignore allocation/viewport paints during ServerInit.
    if (active && rfb._rfbConnectionState === 'connected' && rfb._fbWidth > 0 && rfb._fbHeight > 0) onPaint();
    return result;
  }
  context.drawImage = drawImage;
  return () => { active = false; if (context.drawImage === drawImage) context.drawImage = original; };
}
