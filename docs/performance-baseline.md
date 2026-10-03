# Performance baseline

## Purpose and scope

This document records the performance state of the local remotexapp PoC before
production optimization. It is a comparison baseline, not a claim about
production capacity. Update it with the measurement date, workload and raw
results whenever a performance-sensitive path changes.

- Baseline date: **2026-08-26**
- Host: **test-host**
- Workload: one connected Mousepad instance on `:10`, 1280x720, depth 16,
  TigerVNC maximum frame rate 15, mostly static screen
- Browser path: SDK 0.5 -> manager reverse proxy -> `/rfb-compat` and `/input`
- Sampling: `pidstat -u -r` at one-second intervals for eight seconds

The deeper process/cgroup decomposition and isolated lean-IBus probe were
recorded on **2026-08-27**. Individual experiments and their isolation rules
are tracked in [`performance-experiments.md`](performance-experiments.md).

Only the manager and gateways were included in the CPU sample. Other historical
test displays were present on the host, so host-wide CPU and memory totals are
not useful baseline values. RSS values below are process RSS and must not be
summed as if all shared pages were private memory.

## Observed idle/mostly-static cost

| Process | Average CPU | RSS | Notes |
|---|---:|---:|---|
| `remotexappd` | 0.38% | 12.4 MiB | One host manager |
| Mousepad `novnc-input` | 0.25% | 10.1 MiB | One active RFB and one active input connection |
| XFCE `novnc-input` | 0.00% | 9.1 MiB | Server-ready and idle |
| Mousepad `Xtigervnc :10` | approximately 0% snapshot | 76.3 MiB | Static framebuffer |
| Per-instance Python IBus engine | approximately 0% snapshot | 23.7 MiB | Persistent caret subscription active |
| Mousepad | approximately 0% snapshot | 51.3 MiB | Application session running |
| Matchbox | approximately 0% snapshot | 17.5 MiB | Application session running |

The Go processes are inexpensive at rest. The dominant per-instance footprint
is the X/application/session stack, especially TigerVNC, the application and
the private IBus process. CPU measurements under typing, scrolling, animation,
network throttling and multiple clients remain to be recorded separately.

At the sampled gateway there was one RFB connection and one `/input`
connection. Its cumulative counters shortly after startup were 42,855 bytes
RFB-to-browser and 6,734 bytes browser-to-RFB. These are startup/cumulative
counters, not a bandwidth measurement.

## Deeper cgroup and PSS decomposition

With the Mousepad session connected, systemd reported approximately:

| Instance layer | MemoryCurrent | Tasks |
|---|---:|---:|
| TigerVNC + private D-Bus/IBus server layer | 101 MiB | 58 |
| Matchbox + Mousepad session layer | 41 MiB | 36 |
| Per-instance Go gateway | 3-4 MiB | 8 |
| Total excluding the host manager | 145-150 MiB | about 102 |

After the viewer disconnected and the session layer stopped, the warm server
layer still used approximately 101 MiB. The per-instance Go gateway is not the
dominant cost and should not be merged into the manager merely to save a few
MiB before larger process-tree costs are addressed.

The server layer was not just TigerVNC and the custom engine. Its normal IBus
startup activated `ibus-extension-gtk3`, `ibus-x11`, `ibus-dconf`,
`ibus-portal`, GVFS, AT-SPI and XDG portal processes. Selected PSS values were:

| Process | PSS |
|---|---:|
| `Xtigervnc` | 30.4 MiB |
| `ibus-extension-gtk3` | 28.1 MiB |
| `ibus-x11` | 19.8 MiB |
| `xdg-desktop-portal-gtk` | 11.3 MiB |
| Python remote-Unicode engine | 10.4 MiB |
| persistent `tigervncserver` Perl wrapper | 8.7 MiB |
| `ibus-daemon` | 4.9 MiB |

The full server cgroup was CPU-idle during a five-second disconnected sample;
the extra processes are primarily a resident-memory/task-count problem rather
than an idle CPU problem.

Short-lived startup samples must not be treated as steady-state residency. In
P01, Clipman was visible in a sample taken within 60 seconds of startup but had
exited by the later steady sample. Performance comparisons use the later
steady MemoryCurrent unless a row is explicitly labelled as startup or peak.

The original process snapshots alone did not prove D-Bus activation ownership.
P03 subsequently inspected the retained P01 journals and obtained direct
requester evidence: lean `ibus-daemon` activated `org.gtk.vfs.Daemon` and
`org.freedesktop.portal.IBus`; `xfce4-clipman` activated `org.a11y.Bus`,
`org.xfce.Xfconf` and `org.freedesktop.portal.Desktop`. The Desktop Portal then
activated its document, permission-store and GTK backend chain. This explains
why Clipman's transient process lifetime can still create persistent helpers.

### Isolated lean-IBus probe

An isolated private D-Bus and Unix socket were used to start:

```text
ibus-daemon --single --panel=disable --emoji-extension=disable
            --config=disable --cache=none
```

The existing Python engine registered successfully, its socket became ready,
and `ibus engine` selected `remote-unicode`. The isolated process set was:

| Process | PSS |
|---|---:|
| lean `ibus-daemon` | 3.5 MiB |
| existing Python engine | 10.1 MiB |
| private `dbus-daemon` | 0.5 MiB |
| Total | 14.1 MiB |

This proves registration, not application compatibility. It does not yet prove
GTK focus, Unicode commit, IME switching or caret push. Experiment 1 must test
those end to end on a separate display before the production-candidate driver
changes. If successful, a reasonable warm-server target is 50-60 MiB rather
than the current 101 MiB.

### Session-side desktop service activation

The Mousepad session also activated XDG portal, portal GTK, permission-store,
GVFS, GVFS metadata and dconf services. Matchbox itself used only about 5.2 MiB
PSS. A lean single-app driver may be able to avoid 10-20 MiB of service cost,
but this must be a separate experiment: full desktops and applications with
portal file choosers or persistent settings cannot inherit those restrictions
blindly.

### Measured startup timing

For the sampled dynamic Mousepad instance:

- instance creation to gateway plus IBus subscription ready: about 502 ms;
- Mousepad session unit start to driver-reported ready: about 22 ms.

The readiness status is driver-level and does not independently prove the first
window has painted, but the result shows that a cold disposable single-app
instance is already sub-second on this host. Keeping every temporary display
warm is therefore a poor memory trade unless later first-paint measurements
show otherwise.

### Negotiated pixel format and Tight result

Although the X display was depth 16, the installed noVNC client requested depth
24 in a 32-bpp BGR pixel format. The installed noVNC implementation enables
Tight and its other full encodings only at client framebuffer depth 24. Thus
the present 16-bit setting saves some X framebuffer memory but does not produce
a 16-bit noVNC wire format and requires server-side conversion.

During a 423-second mostly-static connection, TigerVNC reported 184 framebuffer
updates, 192 rectangles, 2.66 Mpixels of content and about 24.6 KiB of Tight
payload, a reported compression ratio of approximately 423:1. This strongly
supports retaining TigerVNC/Tight for desktop workloads. A controlled depth-16
versus depth-24 experiment is required before changing the class default; do
not patch noVNC to 16-bit if that disables Tight and falls back to Raw.

### Browser cold-load and buffer floor

The installed noVNC core contains 31 JavaScript modules totaling about 313 KiB
uncompressed. `rfb.js` directly imports 24 modules. The manager currently
serves its repository-source fallback paths for debugging, but P07 changed the
normal viewer graph to a stable SDK loader plus two content-hashed immutable
bundles. Five fresh-profile samples reduced median static requests from 45 to
3, local HTTP transfer from 551,233 B to 181,399 B, and connection time from
537.6 ms to 387.5 ms. Same-profile reload transfer fell from 45,181 B to 300 B.
See `tests/performance/assets-bundle/README.md` before changing the build or
cache contract. A manager already running from an older binary retains its
compiled source graph until deliberate deployment.

Each noVNC connection starts with a 4 MiB receive queue that can grow to 40 MiB,
plus an approximately 3.5 MiB framebuffer and 3.5 MiB canvas at 1280x720. This
is at least about 11 MiB of raw client-side buffers before decoder and browser
overhead. P05 bounded the compatibility relay's server-to-browser Go payload
queue to about 512 KiB, but it does not remove these browser and TCP buffers.

## Periodic work in the current implementation

A connected kiosk currently performs:

| Work | Default interval | Location |
|---|---:|---|
| Gateway `/healthz` diagnostics | Baseline: 1 second; P06 source: only while explicitly enabled | Browser SDK |
| Instance snapshot watcher | 2 seconds | Browser SDK |
| IBus caret watchdog | 5 seconds | Browser SDK |
| Managed-instance observation | Baseline: 5 seconds; accepted P09b: cgroup events + 4-6 minute safety pass | Host manager |
| Session exit observation | Accepted P10: cgroup event; `poll` fallback: 500 milliseconds | Host manager |

The caret watchdog is a fallback. Normal caret movement is pushed immediately
from IBus through the persistent Unix subscription and `/input` WebSocket.
Mouse clicks additionally cause one bounded cursor recovery request after 250
milliseconds and retain the click position after 750 milliseconds if no fresh
remote caret arrives.

P06 retained the instance watcher and caret watchdog but made diagnostics
demand-driven. In the built-in kiosk, a hidden diagnostics panel now has no
health timer, health requests, diagnostic events or hidden DOM mutations. The
console explicitly enables diagnostics because its pane remains visible.

The SDK console also lists managed instances and runtime instances every three
seconds. When it is connected to a runtime, its own SDK timers run in addition
to the console list refresh.

## Confirmed optimization candidates

### P0: development input tracing is on the hot path

Every key, input, `beforeinput`, composition, focus and blur trace currently:

1. builds a diagnostic string;
2. sends a `client-event` through `/input`;
3. writes a gateway log entry;
4. clones the diagnostics object;
5. dispatches a browser diagnostics event; and
6. causes kiosk or console JSON formatting and DOM replacement.

This describes the original baseline. P02 subsequently made browser event
tracing opt-in, P06 removed hidden diagnostics work, and P13 removed successful
text logs/content from the default gateway path.

Production direction:

- **Complete (P02):** make verbose tracing explicitly opt-in and off by default;
- **Complete (P13):** never log committed text content in production;
- **Complete (P06):** rate-limit/disable unobserved diagnostic snapshots and
  do no hidden-panel formatting; and
- retain a small local ring buffer, uploading it only during an authorized
  diagnostic session.

### P1: `/rfb-compat` copies and queues framebuffer data

The baseline viewer used `/rfb-compat` with channel capacity 256 in both
directions. Server-to-browser reads are up to 64 KiB, so one slow client could
queue approximately 16 MiB in that direction before WebSocket and TCP
buffering were counted. P05 later accepted a capacity of 8: its isolated
slow-client test reduced the observed stall-time Go heap increase from 16.18
MiB to 0.68 MiB and average data age from 1564 ms to 1051 ms. The source now
uses 8, while a previously started gateway process continues using the value
compiled into its binary until deliberately restarted.

Production direction:

- benchmark the simpler `/rfb` relay against the compatibility relay;
- retain the accepted capacity-8 compatibility queues so TCP backpressure
  occurs early;
- reuse fixed buffers where ownership is clear; and
- expose queue depth, queued bytes and write duration in metrics.

Do not drop arbitrary RFB chunks as though they were independent video frames;
later protocol messages can depend on earlier framebuffer updates.

### P1: browser polling and diagnostics scale with clients

One kiosk currently makes approximately 1.7 periodic HTTP requests per second:
one health request per second, one instance request per two seconds and one
caret watchdog request per five seconds. The console adds two list requests
every three seconds. This is small locally, but it multiplies by browser tabs
and crosses Cloudflare Tunnel when deployed remotely.

The one-second diagnostics pass also queries canvas geometry, clones the
diagnostics object and dispatches UI work regardless of whether diagnostics are
visible. Async `setInterval` users do not have an in-flight guard, so slow or
failed requests can overlap.

Production direction:

- collect health/traffic only while diagnostics are observed, or at a much
  lower interval;
- pause optional work while the page is hidden;
- push instance lifecycle changes over the existing control connection or an
  event stream;
- prevent overlapping async polls; and
- retain the five-second caret request only as a watchdog.

### P1: managed reconciliation performs process and durable-I/O work

Before P09b, every running managed instance's five-second reconciliation
started `xdpyinfo` and performed an HTTP health request. Before P09a it also
serialized the registry and executed a temporary-file write, `fsync` and
rename even when no meaningful state changed. P09a now persists only state
transitions.

At 100 managed instances, the old synchronized five-second cycle implies an
average of about 20 `xdpyinfo` launches and 20 health requests per second.
P09a removed the corresponding no-op durable writes. Accepted P09b
removes these operations from healthy steady state, using cgroup events for
process exits and a 4-6 minute safety pass for alive-but-hung processes.

Production direction:

- **Complete (P09a):** persist only state transitions;
- **Complete (P09b):** use cgroup-v2/inotify unit process events;
- replace repeated `xdpyinfo` execution with a lightweight readiness signal;
- use slower, jittered reconciliation as a safety net rather than the primary
  event mechanism.

### Complete (P10): session exit detection is event-driven

Before P10, every running session had a goroutine that read and parsed its PID
file and called `kill(pid, 0)` every 500 milliseconds. A 30-second attached
Mousepad window measured exactly 60 file reads and 60 probes. P10 extends the
existing host-wide P09b cgroup-v2/inotify observer with one watch descriptor
per running session unit, reducing both counts and the recurring per-session
goroutine to zero. It preserves generation-qualified state changes, manager
restart adoption and `-session-observer=poll` as the compatibility rollback.

The event detects process-tree exit, not a living but hung application.
Application readiness/status remains driver-owned, while the session unit and
driver cleanup contract ensure the cgroup becomes empty after the supervised
application or desktop ends.

### Complete (P12): printable text uses a 16 ms configurable debounce

P12 replaced the hard-coded 40 ms delay. Ordinary browser `input` now defaults
to a configurable 16 ms debounce, and completed `compositionend` text flushes
immediately after any older queued ordinary text. `textBatchDelay:40` keeps the
old ordinary-input timing for compatibility; `0` selects immediate sends.

A five-run deterministic comparison reduced median single-input timer latency
from 40.490 to 16.278 ms and completed-composition latency from 40.307 ms to
8.5 us. Five values spaced 10 ms apart still formed one request. Eight and zero
millisecond candidates created five requests for that burst, so they were not
selected as the default.

Channel replacement, failure and disconnect now discard their pending timer
and text so an old callback cannot send through a new `/input` connection.
Automated real-browser tests passed exact Chinese/English switch ordering,
first post-switch characters, shortcuts, pointer, resize, reconnect, stale
batch discard and exact Mousepad clipboard readback. The user then passed the
same matrix with a native operating-system IME. See
`tests/performance/text-batching/README.md`.

### Complete (P13): successful text logging is error-only by default

P13 replaces four successful journal writes per committed text request with
atomic `/healthz` counters. A matched 600-request/30-second IBus run reduced
successful text output from 2,400 lines/135,947 bytes to zero and gateway write
syscalls from 8,433 to 5,938 (29.6%). Actual input content no longer appears in
default logs. CPU ticks were 65/62 and ACK p50/p95 1.2/3.6 versus 1.2/3.7 ms,
so no CPU or latency improvement is claimed.

The default `errors` policy preserves rejection logs and text ACK errors.
`metadata` explicitly restores successful stages/timing without text;
`content` is an operator-enabled sensitive diagnostic mode. Health exposes
`textRequests`, `textErrors`, `textInputBytes` and
`textServerMicroseconds`. Automated full input regression and native-IME
acceptance passed. See `tests/performance/text-logging/README.md`.

P13 does not remove the private Python IBus engine's per-commit, content-free
`engine.log` append. Its helper currently opens and closes that file for each
successful request. This was held constant in the matched comparison and is a
candidate for a separate experiment, not part of P13's gateway results.

### Complete (P15): remote resize is caller-scheduled

SDK 0.15 retains noVNC behavior at `resizeDebounce:0`. A positive debounce
coalesces local viewport changes, keeps the prior framebuffer locally scaled,
and sends the newest remote size after quiet. `resizeMaxWait:Infinity` is pure
trailing behavior; a finite value permits bounded progress. `flushResize()`
lets an embedding UI identify gesture completion.

In the isolated real stack, zero compatibility resized in 63.54 ms. A 300 ms
trailing run kept `1000x613` through four 50 ms-spaced changes while CSS bounds
tracked each viewport, then converged to `1100x740`. Explicit flush completed
in 84.83 ms and reconnect negotiated its new size in 121.14 ms. With a 200 ms
debounce and 400 ms maximum wait, continuous changes first advanced at 440.20
ms and ultimately reached the final `1140x740`. Exact request coalescing,
in-flight retention, fixed policy, and cancellation are deterministic tests;
real Chrome/noVNC/TigerVNC/Mousepad input and readback also passed. See
`tests/performance/resize-debounce/README.md`.

### Complete (P11): cursor fan-out is isolated per client

Before P11, the gateway serially wrote every pushed cursor event to every
`/input` peer, with a 500 ms write deadline per peer. A deterministic 10 ms
slow writer made a 32-event publish and the fast peer both wait about 324.4 ms.

P11 moves network writes off the IBus subscription reader. Each input peer has
one independent writer and a capacity-one latest-value cursor queue; a newer
snapshot replaces an older queued snapshot. Reliable text acknowledgements
and direct cursor replies remain serialized through the same peer write mutex.
The same controlled publisher completed in a median 13.211 us and the fast
peer received the newest sequence in 23.242 us. A 1,000-peer measurement found
about 3.19 KiB of combined live heap/stack per peer and confirmed all writer
goroutines exit on disconnect. See
`tests/performance/cursor-fanout/README.md`.

## Lower-priority observations

### Go-live system comparison baseline

Before integrating P01/P03/P03b or deploying P02/P05-P13 to port 1991, a
reusable system harness captured 30 seconds static, 600 Unicode commits over 30
seconds, and 30 seconds scrolling for disposable Mousepad and fixed Full XFCE.
Both valid runs passed exact application clipboard readback, resize policy,
reconnect and lifecycle cleanup. Attached total PSS was 169,585 KiB for
Mousepad and 433,741 KiB for Full XFCE plus its separately tracked benchmark
Mousepad. The old SDK loaded 45 static resources/549,477 bytes in both cold
profiles. Full measurements, the frozen workload and one explicitly excluded
recovery-dialog run are in `tests/system-performance/README.md`; the identical
harness must be rerun after go-live for the final comparison.

The post-live rerun completed on 2026-08-27 against the actual port-1991
systemd deployment. Mousepad attached PSS fell 169,585 -> 124,410 KiB and Full
XFCE plus benchmark editor fell 433,741 -> 393,179 KiB. Detached Full XFCE
server-only PSS fell 156,537 -> 80,903 KiB and MemoryCurrent fell 142,700,544
-> 33,792,000 bytes. Both 600-request workloads had zero errors, exact
780-byte UTF-8 readback, correct resize and reconnect. Full tables, the XFCE
cold-attach regression and raw artifact paths are in
[`go-live-report-2026-08-27.md`](go-live-report-2026-08-27.md).

- A text commit opens a new private Unix connection and the input reader waits
  synchronously for its response. Current measured server commit time is small;
  P02, P12 and P13 completed the higher-priority tracing, browser batching and
  success-log work.
- The private Python IBus engine still opens/appends/closes `engine.log` once
  per successful commit for byte/character counts without text content. Its
  marginal cost and diagnostic value need an isolated measurement before any
  default change.
- Cursor-to-canvas mapping calls `getBoundingClientRect()`. The deliberate
  layout flush and blur/refocus occur only for a safe primary-pointer anchor or
  its fresh remote-caret correction, so they are correctness work rather than
  a periodic hot path.
- The manager reverse proxy adds another local HTTP/WebSocket hop, but present
  measurements do not identify it as a meaningful CPU or latency source.
- TigerVNC maximum frame rate is a cap, not a guarantee of constant traffic;
  static applications remain inexpensive, while scrolling and animation need
  a separate workload measurement.

## Required comparison procedure

Before accepting an optimization, compare the old and new builds using the
same display geometry, depth, frame rate, application content and client
network. Record at least:

1. 30 seconds with a static screen;
2. 30 seconds of continuous typing, including IME switching;
3. 30 seconds of scrolling or application animation;
4. a throttled/slow client to reveal RFB queue growth;
5. server CPU and RSS by process;
6. browser main-thread work and memory;
7. RFB bytes per second, queue depth and input acknowledgement latency; and
8. correctness results for pointer, modifiers, clipboard and Unicode input.

Use process RSS and proportional-set-size measurements carefully: separate
process RSS values include shared libraries and cannot be treated as exact
incremental host memory. Report the number of active instances and clients with
every result.

## Optimization order

The current measured order and completion state is:

1. **Complete:** P08 directly supervises Xtigervnc and moves the class server
   driver into a bound unit, cutting the measured lean server layer from
   42,831,872 B to 32,141,312 B. The wrapper remains an explicit fallback.
2. **Complete:** P07 bundles the normal SDK/noVNC path into two immutable
   hashed assets behind a stable revalidated loader. Source routes remain for
   diagnostics.
3. **Complete:** P02 disabled per-event tracing, P06 removed hidden diagnostic
   rendering/polling, and P13 replaced default successful committed-text logs
   with non-content counters while retaining errors.
4. **Complete:** P05 bounded the RFB compatibility relay at capacity 8;
   production health metrics still do not expose live queue depth/bytes.
5. **Complete for diagnostics:** P06 made gateway health observation
   demand-driven. Lifecycle instance polling remains and should be addressed
   separately rather than conflated with diagnostics.
6. **Complete (P09a):** unchanged healthy managed registrations no longer
   write, `fsync` or rename their JSON file. Live runtime state also remains
   authoritative after restart adoption.
7. **Complete (P09b):** cgroup-v2/inotify removes the healthy five-second
   process/HTTP loop and retains a slower jittered safety check; automated,
   fault-injection and interactive checks passed.
8. **Complete (P10):** the shared cgroup/inotify reader removes per-session
   500 ms PID-file polling; the explicit `poll` fallback remains available.
9. **Complete (P11):** per-peer latest-value queues remove serial cursor
   WebSocket writes from the IBus subscription reader while preserving the
   newest snapshot and reliable replies.
10. **Complete (P12):** the SDK uses a 16 ms ordinary-text debounce and
    immediate completed-composition flush, with 40 ms compatibility mode and
    reconnect-safe pending-text ownership.
11. **Complete (P13):** gateways default to error-only text logs; metadata and
    content are explicit operator modes, while health counters preserve
    non-content observability.
12. **Complete and live (P14):** production classes set
    `input.lifecycle: session` so vacant server units do not retain D-Bus,
    IBus or the Unicode engine. Live Full XFCE server-only state fell from
    16,887,808 B/18 tasks to 212,992 B/1 task. Post-live XFCE attached in
    4,188 ms, completed exact mixed-Unicode readback and reconnected in 34 ms;
    Mousepad and Edge passed the same final driver/helper boundary.
13. **Complete (P15):** SDK 0.15 adds compatibility-zero, trailing and bounded
    remote-resize scheduling plus explicit flush. Real browser tests proved
    local scaling during a burst, final-size convergence, immediate reconnect,
    input correctness, and cleanup. Port-1991 deployment E2E also passed;
    native-IME and resize-appearance UAT were accepted on 2026-08-29.
