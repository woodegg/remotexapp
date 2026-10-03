# P15 caller-scheduled remote resize

P15 adds caller-controlled scheduling around noVNC's existing remote desktop
resize request. It does not change TigerVNC, RFB framing, the application, or
the noVNC 1.7 vendor tree. `resizeDebounce:0` preserves noVNC behavior. A
positive value enables trailing scheduling, optional bounded progress through
`resizeMaxWait`, local scaling of the old framebuffer, and `flushResize()`.

## Isolated real-browser test

The accepted candidate used the repository Mousepad template with an isolated
manager on `127.0.0.1:2098`, dynamic display `:10`, and a separate temporary
state directory. Port 1991 remained the running rc.20 service and HTTP 200; it
was not rebuilt or restarted.

Three fresh headless Chrome profiles ran `verify-cdp.mjs` against the real SDK
0.15 bundle, noVNC, WebSockets, TigerVNC, Matchbox, Mousepad, private IBus, and
the Unicode engine:

```bash
P15_CDP_PORT=9245 P15_INSTANCE_ID=INSTANCE P15_MODE=compat \
  node tests/performance/resize-debounce/verify-cdp.mjs
P15_CDP_PORT=9245 P15_INSTANCE_ID=INSTANCE P15_MODE=trailing \
  node tests/performance/resize-debounce/verify-cdp.mjs
P15_CDP_PORT=9245 P15_INSTANCE_ID=INSTANCE P15_MODE=max-wait \
  node tests/performance/resize-debounce/verify-cdp.mjs
```

Compatibility mode resized `1000x613` to `930x650` in 63.54 ms and retained
`scaleViewport:false`. With a 300 ms debounce and infinite maximum wait, four
50 ms-spaced viewport changes left the framebuffer at `1000x613`; its CSS
bounds changed on every sample, proving local scaling. After quiet it converged
directly to `1100x740`. `flushResize()` converged to `960x680` in 84.83 ms,
before the 300 ms debounce. Reconnect negotiated `1020x710` in 121.14 ms.

With `resizeDebounce:200` and `resizeMaxWait:400`, continuous 80 ms changes
first advanced the framebuffer at 440.20 ms and finally converged to
`1140x740`. Deterministic SDK tests separately prove one trailing request,
equal-size coalescing, newest-size retention across an in-flight request, and
timer cancellation on channel disposal.

## Input correctness and cleanup

The same live run verified primary-pointer focus renewal, exclusion of right
click, composition-safe focus counts, fresh IBus caret correction in 33.8 ms,
an exact `P15中` acknowledgement, zero text errors, and exact Mousepad
clipboard readback. Synthetic pointer/composition events exercise the browser
contract but do not replace native-IME candidate-window UAT.

Machine-readable evidence is in
[`results-2026-08-28.json`](results-2026-08-28.json). The isolated browser,
instance, units, display, ports, and temporary state are removed after the
release-candidate test. The later immutable rc.21 deployment repeated the
compatibility, trailing, maximum-wait, flush, reconnect, input, adoption, and
cleanup gates on port 1991; that separate evidence is in
[`ime-resize-rc21-local-1991.json`](../../go-live-validation/results/ime-resize-rc21-local-1991.json).
Native candidate-window and resize-appearance UAT was accepted on 2026-08-29.
