# P13 privacy-safe text observability

P13 removes successful committed-text logging from the normal gateway hot
path. Before this change, every successful IBus request wrote four journal
lines, including the actual input value. The accepted default is now
`-text-log errors`: failures remain logged, but successful requests update
atomic counters instead of journald.

The explicit levels are:

| Gateway value | Successful request logs | Input content |
|---|---|---|
| `errors` (default) | none | never |
| `metadata` | received bytes, backend stages, completion and latency | never |
| `content` | the metadata above | included in the received line |

`remotexappd` validates `-gateway-text-log` and passes it to every gateway as
`-text-log`. This is an operator-wide diagnostic policy, not a client/template
parameter. Content mode must be short-lived and authorized because it records
typed text. Browser `inputEventTracing` remains a separate, opt-in diagnostic
path and can also contain text.

P13 is intentionally scoped to the Go gateway. The private Python IBus engine
still appends one content-free `committed bytes=… characters=…` record to its
per-instance `engine.log` for every successful commit; its current helper
opens, appends and closes the file each time. That write was present and held
constant in both A/B runs, is not included in the gateway journal/syscall
claim, and should be measured as a separate experiment before it is changed.

## Matched 30-second A/B

`measure-cdp.mjs` drove the real embedded SDK, noVNC, `/input`, private IBus
engine and Mousepad on isolated manager port 1992/display `:11`. Each run sent
600 sequential requests at 50 ms intervals: 540 ASCII characters and 60
Chinese characters, 600 characters/720 UTF-8 bytes in total. The application
clipboard matched the generated value exactly in both runs.

The only primary behavior change was the successful text log policy. Display
1280x720, depth 16, 15 fps, P03 no-Clipman class, browser profile shape,
request sequence and application were held constant.

| 30-second metric | P12 baseline | P13 `errors` |
|---|---:|---:|
| Successful text journal lines | 2,400 | 0 |
| Lines containing the input value | 600 | 0 |
| Successful text journal payload | 135,947 B | 0 B |
| Gateway write syscalls | 8,433 | 5,938 |
| Gateway `wchar` | 1,069,867 B | 929,993 B |
| Gateway CPU ticks | 65 | 62 |
| Browser ACK p50 | 1.2 ms | 1.2 ms |
| Browser ACK p95 | 3.6 ms | 3.7 ms |
| Server p50 | 0.611 ms | 0.580 ms |
| Server p95 | 1.493 ms | 1.583 ms |

The change removed 100% of successful text journal output, 2,495 write
syscalls (29.6%) and 139,874 `wchar` bytes (13.1%) from the measured gateway.
CPU changed by only three ticks and latency distributions were effectively
unchanged in this single matched run; P13 does not claim a CPU or latency
speedup. The accepted benefits are bounded I/O and removal of default plaintext
input disclosure.

Memory snapshots are not interpreted: the two Go processes were sampled at
different heap ages and the before/after PSS values were not a controlled
marginal-allocation measurement.

## Counter and error replacement

`/healthz` now reports non-content counters:

```json
{
  "textLogLevel": "errors",
  "textRequests": 600,
  "textErrors": 0,
  "textInputBytes": 720,
  "textServerMicroseconds": 453113
}
```

The final-hash stress run produced those exact counters. A separate invalid
empty-text request returned a `text-ack` with `error:"invalid text input"`,
incremented `textErrors`, and wrote one rejection line without text content.
Thus disabling success logs does not remove failure visibility or client error
semantics.

Unit tests validate all three levels, the safe zero/default behavior, content
redaction in metadata mode, manager validation and the health fields.

## Full regression and native IME acceptance

The final candidate then ran P12's complete real-browser regression. Exact ACK
order was `A`, `你好`, `i`, `世界`, `x`, `abcde`, `R`; composition, both
first English characters, one-request burst, stale-batch reconnect, shortcuts,
pointer and resize passed. Explicit reconnect took 21.5 ms and the input/RFB
channels returned to connected. The candidate journal still contained zero
successful text lines.

The user subsequently attached through a normal browser and reported that the
native operating-system IME path worked. Evidence showed one active RFB/input
connection, five successful text requests/five input bytes, zero text errors,
zero success/content/client-event log lines, and a ready Mousepad session.
Those zero-line results refer to the gateway journal; the content-free Python
engine metadata record described above remains outside P13's scope.

## Deployment and reproduction

The accepted source defaults both `novnc-input -text-log` and
`remotexappd -gateway-text-log` to `errors`. Reproduce the stress path with:

The final repository binaries are the exact candidate used for the accepted
stress and regression runs:

| Binary | SHA-256 |
|---|---|
| `bin/remotexappd` | `4c63e0327e4a91c2ce602acaea379b0dc00709a0774b0bc971329fc01a226460` |
| `bin/novnc-input` | `3553839051eab9b79f8a7ec8257260bcfa6a3491131701180c8f0d14a9480ab0` |
| `bin/remotexapp-status` | `3cf0bc00fa90ce2ab91b06945d8408e1259436ada3cddb0306d95cc890d4013b` |

```bash
P13_CDP_PORT=9233 \
P13_INSTANCE_ID=INSTANCE_ID \
P13_REQUESTS=600 \
P13_INTERVAL_MS=50 \
node tests/performance/text-logging/measure-cdp.mjs
```

Use `verify-error.mjs` against the instance's direct loopback gateway only in a
local test environment. Machine-readable evidence is in
[`results-2026-08-27.json`](results-2026-08-27.json).

Port 1991 remained HTTP 200 and was not rebuilt or restarted during the
experiment. The isolated browser, instance, display and manager were stopped
after native-IME acceptance; the temporary directory was moved to Trash after
the final repository build and verification.
