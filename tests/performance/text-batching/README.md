# P12 low-latency browser text batching

P12 reduces the SDK's fixed 40 ms ordinary-text debounce without changing the
server, IBus engine, RFB transport or application stack. Committed IME
compositions are complete transactions and now flush immediately. Ordinary
`input` events use a configurable debounce whose accepted default is 16 ms.

The compatibility value remains available as `textBatchDelay:40`; `0` sends
each event immediately. Values outside 0 through 1000 ms are rejected.

## Deterministic comparison

`measure.mjs` imports the production `RemoteXAppClient`, replaces only
`sendText()` with a timestamp recorder, and measures:

- one ordinary character;
- five ordinary input events spaced 10 ms apart; and
- one completed Chinese composition.

Each setting was run five times. The pre-change baseline was measured before
editing the fixed 40 ms implementation. Candidate/compatibility modes use the
same final source.

```bash
for delay in 40 16 8 0; do
  for run in 1 2 3 4 5; do
    P12_TEXT_BATCH_DELAY="$delay" \
      node tests/performance/text-batching/measure.mjs
  done
done
```

Median results:

| Mode | Single input | Five-event first-to-send | Sends for five events | Composition |
|---|---:|---:|---:|---:|
| Old fixed 40 ms | 40.490 ms | 81.298 ms | 1 | 40.307 ms |
| Final source, compatibility 40 ms | 40.066 ms | 81.560 ms | 1 | 0.0086 ms |
| **P12 default 16 ms** | **16.278 ms** | **57.246 ms** | **1** | **0.0085 ms** |
| 8 ms | 8.246 ms | 8.349 ms | 5 | 0.0081 ms |
| 0 ms | 0.083 ms | 0.079 ms | 5 | 0.0078 ms |

The 16 ms default removes 24.212 ms, or 59.8%, from a single ordinary event's
deliberate browser delay. It also removes 24.052 ms from the first-to-send
latency of the tested burst while still sending one request. Eight and zero
milliseconds were rejected as defaults because a realistic 10 ms-spaced burst
became five WebSocket/IBus commits. This is a latency/coalescing choice, not a
claim that 16 ms is universally one display frame.

## Correctness and reconnect ownership

`cmd/remotexappd/web/sdk/remotexapp-client.test.mjs` covers:

- the default, compatibility, immediate and invalid delay values;
- ordered ordinary batching;
- immediate `compositionend` after any older pending ordinary text;
- the first English character after Chinese and the reverse switch;
- IME-consumed modifier chords and exact normal `Ctrl+A` ordering; and
- discarding pending text when channels are replaced or disconnected.

The last rule fixes a latent ownership bug in the old timer: a callback from a
previous connection could otherwise send its pending value through the newly
connected `/input` WebSocket. Pending text is deliberately discarded during a
disconnect because the client cannot prove whether the old connection already
delivered it. Application code may retry at a higher semantic layer.

## Real browser and application verification

The final SDK 0.8 bundle was tested with the P03 no-Clipman Mousepad class on
isolated manager port 1992, display `:11`, RFB port 5911 and gateway port
39011. `verify-cdp.mjs` drives the real embedded SDK, noVNC, WebSockets, private
IBus engine and Mousepad. It verifies exact text acknowledgement values,
clipboard readback, pointer delivery, client resize, shortcuts and explicit
SDK reconnect.

Default-16 results:

| Operation | Browser input-to-ack |
|---|---:|
| ordinary `A` | 18.5 ms |
| composition `你好` | 3.8 ms |
| first English `i` | 21.7 ms |
| composition `世界` | 3.2 ms |
| first English `x` | 20.6 ms |
| five-event `abcde` burst | 62.2 ms, one acknowledgement |
| ordinary `R` after reconnect | 18.1 ms |

The exact Mousepad clipboard value was `A你好i世界xabcdeR`. A queued `DROP`
value was followed immediately by explicit reconnect: reconnect completed in
27.1 ms, produced no text acknowledgement, left `pendingText` empty, and did
not enter the application. The framebuffer resized 1100x673 to 900x640 and the
requested/observed pointer position matched exactly at 540,256.

The same real-stack harness with `?textBatchDelay=40` preserved one request for
the burst. Ordinary acknowledgements took about 45--47 ms, completed
compositions about 2 ms, exact clipboard readback was unchanged, reconnect did
not leak the queued value, resize passed, and pointer target/actual matched at
660,304.

Finally, the user exercised the default-16 instance with a real operating
system IME and reported that English/Chinese switching, first characters,
typing, shortcuts, pointer, resize and reconnect worked. Its gateway journal
contained 59 completed text requests, zero text errors/rejections and zero
`client event:` trace entries. Synthetic browser composition events do not
replace this native-IME acceptance gate.

## Deployment and cleanup

P12 is implemented in SDK 0.8 source, generated bundle `sdk-S4KCHU5P.js`, and
the rebuilt `bin/remotexappd` (`67470aeb…`). Port 1991 was HTTP 200 throughout
and was not rebuilt or restarted, so it continues to serve its previously
compiled SDK until a deliberate deployment.

The isolated instance, Chrome processes, manager, display and ports were
stopped after acceptance, and the temporary directory was moved to Trash.
Machine-readable evidence is in
[`results-2026-08-27.json`](results-2026-08-27.json).
