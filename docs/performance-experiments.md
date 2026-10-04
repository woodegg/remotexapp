# Performance experiments

## Rules

Performance hypotheses are tested one at a time. An experiment must:

- use a separate class catalog, manager port and state directory;
- allocate a display/ports independently of the current `:2`/port 1991 stack;
- never edit or restart the production-candidate class or driver to obtain a
  result;
- change one primary variable relative to the baseline;
- verify input correctness as well as CPU, memory and latency;
- record failures, not silently incorporate another change; and
- stop its instance and manager after interactive verification unless the user
  explicitly asks to keep the experiment available.

An experiment is not complete—even if its code and interactive test work—until
all of the following documentation gates pass:

1. Update the register in this file to `Accepted` or `Rejected` and finish its
   detailed section, including controlled variable, measurements, correctness,
   deployment state and cleanup state.
2. Add/update `tests/performance/<experiment>/README.md` with reproduction and
   interpretation, plus a valid result JSON containing `experiment`, canonical
   `outcome`, descriptive `status` and measured evidence.
3. Update `performance-baseline.md`, `production-handover.md`,
   `backend-structure.md`, the service/design/lessons documents and top-level
   README wherever the experiment changes their stated baseline, defaults,
   lifecycle, risks or deployment state. A rejected result must also be
   documented because it constrains future changes.
4. Record whether port 1991 was rebuilt/restarted, and remove isolated services
   after acceptance unless explicitly retained.
5. Register the artifact in `tests/performance/experiments.json` and run
   `make performance-docs-check`. `make backend-test` runs this gate as well.

The current production-candidate URLs remain:

- `http://test-host:1991/`
- `http://test-host:1991/sdk/console.html`

## Experiment register

| ID | Hypothesis | Primary variable | Status |
|---|---|---|---|
| P01 | IBus single mode removes the extension/XIM process tree while preserving remote Unicode and caret push | IBus daemon flags only | **Accepted:** automated and interactive checks passed |
| P02 | Production-disabled input tracing reduces browser/journald work without changing input behavior | SDK input-event tracing mode | **Accepted:** automated, interactive and journal checks passed |
| P03 | A disposable single-app server can omit persistent Clipman and avoid the helpers it activates | Clipman launch only, relative to accepted P01 | **Accepted:** automated, interactive and clipboard checks passed |
| P03b | Full XFCE can own Clipman only while its on-demand session is running | Move Clipman from server to session layer | **Accepted:** lifecycle, input, clipboard and reconnect checks passed |
| P04 | Depth 24 is faster than depth 16 with noVNC's negotiated 32-bpp Tight path | TigerVNC display depth | **Rejected:** retain depth 16 for the generic stack |
| P05 | A small relay queue bounds slow-client memory and stale-update latency | `/rfb-compat` queue capacity | **Accepted:** queue 8 passed automated and interactive checks |
| P06 | Demand-driven diagnostics remove continuous client HTTP/DOM work | Diagnostics scheduling | **Accepted:** automated browser and interactive checks passed |
| P07 | Bundled immutable noVNC/SDK assets improve cold viewer load | Static asset delivery | **Accepted:** five-profile load and input/reconnect checks passed |
| P08 | Direct `Xtigervnc` supervision removes the persistent Perl wrapper safely | VNC launcher | **Accepted:** automated, failure-injection and interactive checks passed |
| P09a | Transition-only managed persistence removes healthy no-op durable writes | Registry persistence policy | **Accepted:** I/O, lifecycle, fault recovery and reconnect checks passed |
| P09b | Event-driven managed observation removes repeated health subprocesses | Managed-runtime health observation | **Accepted:** automated, fault-injection and interactive checks passed |
| P10 | Event-driven session observation removes per-session 500 ms PID polling | Session exit observation | **Accepted:** steady-state, fault, restart, fallback, Full XFCE and browser checks passed |
| P11 | Per-peer latest-value queues prevent a slow input client from delaying cursor push to every browser | Cursor snapshot fan-out only | **Accepted:** deterministic slow-peer, race and real browser checks passed |
| P12 | A 16 ms ordinary-text debounce plus immediate composition commit reduces input latency without losing IME-switch correctness or burst coalescing | SDK text batching policy only | **Accepted:** deterministic, real-browser and native-IME checks passed |
| P13 | Default error-only gateway logging removes per-request journal I/O and plaintext committed text while preserving counters and failures | Successful text-request log policy only | **Accepted:** matched stress, error, full regression and native-IME checks passed |
| P14 | Moving private D-Bus, IBus and the Unicode engine into the on-demand session removes their vacant server-layer cost without breaking input lifecycle | Input-stack lifecycle ownership only | **Accepted:** isolated plus live XFCE/Mousepad/Edge regression passed; deployed to all production classes |
| P15 | Caller-scheduled trailing remote resize reduces repeated desktop/application reflow while retaining bounded progress and final-size correctness | SDK remote-resize scheduling only | **Accepted:** compatibility, trailing, max-wait, flush, reconnect and real-stack input checks passed |
| P16 | Core-owned session input supervision stays within bounded startup and resource overhead | Service ownership with unchanged Mousepad policies | **Accepted:** matched fresh/warm launches, cgroup resources and cleanup pass locked gates; human UAT is separate |

P01 through P16 are complete. Start the next experiment only after defining a
new isolated primary variable.

## P16: Core-owned session services

Stable 0.11 versus repaired candidate 0.12.0-rc.2, repeated 2026-09-14:
five alternating fresh Mousepad
runtime/profile launches and same-runtime warm restarts per version, on one
local host after other test suites finished. Median startup/restart increased
390/405 ms, memory increased 4.04 MiB, and process count increased by exactly
one supervisor. No additional session D-Bus/IBus/engine was observed. Idle CPU
was 0.0451% versus 0.0458%; median cleanup about 122 ms for both. All precommitted
gates passed. Host binary caches were warm; no power-on/cache-drop claim.
See [method and raw evidence](../tests/performance/core-session-services/README.md).
This accepts the measured overhead, not human UAT or a fleet deployment.

## P01: lean private IBus

### Isolation

- Catalog: `tests/performance/lean-ibus/class.json`
- Server driver: `tests/performance/lean-ibus/x11-server.sh`
- Manager: port 1992
- State: `.runtime/performance-lean-ibus`
- Display: manager-allocated free dynamic display
- Existing port 1991 manager and its drivers/configuration: unchanged

### Controlled change

Baseline:

```text
ibus-daemon --panel=disable --address=... -rx
```

Experiment:

```text
ibus-daemon --single --panel=disable --emoji-extension=disable
            --config=disable --cache=none --address=... --replace
```

The TigerVNC wrapper, geometry, depth, frame-rate, custom Python engine,
Matchbox, Mousepad, SDK, gateway and lifecycle remain the same.

### Required checks

1. Manager, VNC, gateway and private IBus sockets become ready.
2. Only the intended lean IBus processes exist in the server cgroup.
3. Mousepad launches and paints.
4. English input works before and after Chinese input.
5. Chinese committed text reaches Mousepad.
6. Repeated English/Chinese switching does not lose the first key.
7. `cursor-position` is pushed after caret movement and maps correctly in the
   SDK.
8. Mouse, modifiers, resize, reconnect and session cleanup still work.
9. Record server/session/gateway MemoryCurrent, tasks and per-process PSS.
10. Record creation-to-server-ready and attach-to-application-ready timing.

### Automated result, 2026-08-27

The isolated manager started on port 1992 and allocated display `:11`, RFB
`127.0.0.1:5911` and gateway `127.0.0.1:39011`. Port 1991 and the original
manager remained reachable throughout the test.

Creation completed in 578 ms. The experiment session unit started at
00:16:31.903 and driver status became ready at 00:16:31.937, approximately 34
ms later.

Lean mode removed `ibus-extension-gtk3`, `ibus-x11` and `ibus-dconf`. The
custom engine registered, the gateway established its persistent cursor
subscription, and a committed `P01你好abc` request completed in 1.292 ms. The
engine recorded all 12 UTF-8 bytes/eight characters. Selecting all and copying
from Mousepad returned the exact string, verifying that the commit reached the
application rather than stopping at the engine acknowledgement.

The pushed caret moved from display x=3 to x=87 and advanced from sequence 5 to
6 after the commit. This verifies the lean engine -> Unix subscription -> Go
gateway -> `/input` push path.

One deliberately early commit, sent as soon as a cached `focused=true` engine
snapshot arrived but before Mousepad owned X focus, was correctly rejected in
0.21 ms with `no focused X11 application class`. This exposes a general
readiness distinction: a session PID/status can be ready before the first
focused application caret exists. Production clients should not infer text
readiness from process readiness alone.

Steady measurements after session launch and RFB detach were:

| Layer | Baseline | P01 | Change |
|---|---:|---:|---:|
| Server layer MemoryCurrent | about 101 MiB | about 62 MiB | about -39 MiB |
| Session layer MemoryCurrent | about 41 MiB | about 38 MiB | about -3 MiB |
| Gateway MemoryCurrent | about 3-4 MiB | about 2-3 MiB | within normal variation |
| Active-instance total | about 145-150 MiB | about 102-105 MiB | about 28-32% lower |
| Server-layer tasks | 58 | 48 | -10 |

The first process sample, taken within 60 seconds of server startup, observed
the unchanged Clipman process at about 22.5 MiB PSS and server MemoryCurrent
around 75 MiB. A later steady-state sample found that Clipman had exited, as it
also does in the baseline Mousepad stack; steady server MemoryCurrent was about
62 MiB. There is therefore no evidence that Clipman remained running.

P01 did not initially trace D-Bus activation ownership. P03 later inspected the
retained P01 journals and proved that lean IBus requested GVFS and IBus Portal,
while Clipman requested the a11y bus, Xfconf and Desktop Portal chain. This
later attribution does not change P01's controlled variable or result.

Conclusion: the lean flags produce a material memory reduction and preserve
automated Unicode commit and caret push. On 2026-08-27, the user completed the
interactive check through the isolated kiosk and reported that everything was
working correctly. This accepts P01 for the tested Mousepad stack. Applying the
flags to common or XFCE drivers remains a separate integration change and is
not part of this experiment.

The interactive verification URLs were:

- `http://test-host:1992/remotexapps/mousepad-lean-ibus-994390fa1917/kiosk.html`
- `http://test-host:1992/sdk/console.html`

The interactive instance used a one-hour vacancy timeout and was stopped after
acceptance, together with the isolated port-1992 manager. The measured instance
`mousepad-lean-ibus-6795a6a69fca` was also stopped after its results were
captured. These URLs are retained only as experiment provenance and are not
expected to stay available.

## P02: opt-in input-event tracing

### Isolation and controlled change

- Catalog: `tests/performance/input-tracing/class.json`
- Manager: port 1992 with a separately built experiment binary
- State: `.runtime/performance-input-tracing`
- Server/session stack: the original common X11 server driver and Mousepad
  session driver, not P01's lean-IBus driver
- Primary variable: `RemoteXAppClient.inputEventTracing`

SDK 0.6 defaults `inputEventTracing` to `false`. Input processing remains
unchanged, but `_trace()` returns before constructing diagnostic strings,
copying the event ring, sending a `client-event`, dispatching `inputevent`, or
emitting a diagnostic snapshot. The kiosk enables it only with `?trace=on`.
Periodic health, instance and cursor-watchdog work is unchanged and belongs to
later experiments.

### Required checks

1. The isolated microbenchmark must emit exactly one client-event and one
   diagnostic event per traced input event in trace-on mode, and zero in
   trace-off mode.
2. The trace-off kiosk must preserve English, Chinese IME switching, the first
   key after a switch, modifiers, mouse, resize and reconnect.
3. The gateway journal must show no `client event:` lines during trace-off
   interaction, while `?trace=on` must still provide the diagnostic path.
4. Record benchmark time and avoided WebSocket message bytes; do not interpret
   a synthetic ratio as end-to-end application latency.

### Automated result, 2026-08-27

The Node isolation benchmark ran seven 50,000-event samples. Trace-on had a
median of 1662.35 ms, emitted 50,000 WebSocket messages totaling 4,900,000
bytes, and emitted 50,000 diagnostic events. Trace-off had a median of 0.88 ms
and emitted zero messages, bytes and diagnostic events. This is approximately
98 bytes and 33 microseconds of synthetic browser-side work avoided per traced
keydown on this host. The ratio is deliberately not reported as user-visible
latency: real browsers, DOM rendering, networking and journald have different
costs, and a physical character can produce multiple browser events.

The isolated manager serves SDK 0.6 on port 1992 while the unchanged port-1991
manager continues serving SDK 0.5. The interactive instance uses display `:11`
and a one-hour vacancy timeout:

- trace off: `http://test-host:1992/remotexapps/mousepad-trace-off-855975317aea/kiosk.html`
- trace on comparison: `http://test-host:1992/remotexapps/mousepad-trace-off-855975317aea/kiosk.html?trace=on`
- experiment console: `http://test-host:1992/sdk/console.html`

The user completed the trace-off interactive check on 2026-08-27 and confirmed
that English/Chinese input switching, the first post-switch character,
shortcuts, pointer input, resize and reconnect all worked correctly. The
gateway journal recorded 27 successful text commits and zero `client event:`
entries during that session. Together with the trace-on/off microbenchmark,
this accepts P02.

The gateway still logs text-commit payload values. That was pre-existing and is
outside P02's single variable, but it must be removed before production for
privacy as well as logging cost. The isolated instance and port-1992 manager
were stopped after acceptance; the URLs above are retained as provenance and
are no longer expected to be available.

## P03: disposable single-app server without Clipman

The original P03 wording attributed Portal/GVFS/AT-SPI to the session layer.
Process cgroup and environment inspection disproved that attribution: the
helpers were in the instance's VNC server unit and appeared before the
Mousepad session started. P03 therefore tests the smallest defensible variable
before applying environment-wide suppression flags.

### Isolation and controlled change

- Catalog: `tests/performance/no-clipman/class.json`
- Server driver: `tests/performance/no-clipman/x11-server.sh`
- Manager: port 1992 and state `.runtime/performance-no-clipman`
- Accepted cumulative base: P01 lean IBus and P02 trace-off SDK
- Primary variable relative to P01: do not launch `xfce4-clipman`; server
  readiness checks only `server.pid`

This optimization is intentionally scoped to disposable single-app instances.
A fixed server layer that must preserve clipboard content across session-layer
shutdown still needs a clipboard owner or another persistence mechanism.

### Required checks

1. Capture server-unit process membership and MemoryCurrent before the first
   application attach and after at least 60 seconds.
2. Determine whether Portal, GVFS and AT-SPI helpers are absent rather than
   inferring causality from PID timing.
3. Verify English/Chinese input, IME switching, caret push, pointer, modifiers,
   resize and reconnect.
4. Verify copy/paste within Mousepad while it is running.
5. Confirm lifecycle cleanup and document that clipboard persistence across a
   stopped session is not provided by this class.

### Automated result, 2026-08-27

Before the first application attach, the no-Clipman server used 41,463,808
bytes MemoryCurrent (about 39.5 MiB) and 23 tasks. After more than 60 seconds it
used 41,381,888 bytes (about 39.5 MiB) and 20 tasks. Its process set contained
TigerVNC and its wrapper, the server shell, private D-Bus, lean IBus, the Python
remote-Unicode engine, `gvfsd` and `ibus-portal`. It did not contain Clipman,
AT-SPI, Xfconf, XDG Desktop Portal, document portal, permission store or the GTK
portal backend.

The D-Bus journal provides direct attribution rather than a timing inference:

- lean `ibus-daemon` requested `org.gtk.vfs.Daemon` and
  `org.freedesktop.portal.IBus` in both P01 and P03;
- P01 Clipman requested `org.a11y.Bus`, `org.xfce.Xfconf` and
  `org.freedesktop.portal.Desktop`; and
- the Desktop Portal request started the document, permission-store and GTK
  backend chain.

Compared with P01's approximately 62 MiB steady server layer, omitting Clipman
and the services it activates saves about 22.5 MiB (roughly 36%). On
2026-08-27, the user confirmed normal input and in-application clipboard
behavior. The gateway recorded four successful text commits and zero
`client event:` entries. P03 is accepted for disposable single-app instances.

The verification URL was:

- `http://test-host:1992/remotexapps/mousepad-no-clipman-bdd168363f2d/kiosk.html`

The instance and isolated port-1992 manager were stopped after acceptance; the
URL is retained only as experiment provenance.

## P03b: move Full XFCE Clipman into its session layer

P03 does not by itself authorize changing the fixed Full XFCE class. That class
previously required clipboard ownership to survive its on-demand XFCE session.
If cross-session clipboard persistence is no longer required, an isolated
integration experiment can instead start Clipman on the session's private
D-Bus and let the session cgroup remove Clipman and its AT-SPI/Xfconf/Portal
helpers on vacancy.

The server readiness list must drop `clipman.pid`; the session must verify
exactly one Clipman process, clipboard copy/paste, session stop cleanup, and a
clean second session generation. This host's freedesktop autostart entry is
`Hidden=true`, but the default XFCE panel profile contains the Clipman panel
plugin. Session ownership therefore comes from the panel, not autostart.

Baseline inspection adds an important limit to the expected result. The
current display-2 `clipman.pid` points to a process that has already exited, so
the claimed persistent server clipboard keeper is not actually alive. Its
server layer is about 130 MiB/58 tasks. D-Bus requester logs show that the
non-lean `ibus-x11` and `ibus-extension-gtk3`, not Clipman, already activate
AT-SPI and the Desktop Portal chain. Moving Clipman alone therefore tests
correct ownership and cleanup; it is not expected to reproduce P03's 22.5 MiB
saving until P01 lean IBus is integrated in a separate controlled step.

P03b uses `tests/performance/xfce-session-clipman`, fixed isolated display
`:11`, port 1992 and the original non-lean Full XFCE IBus mode. The server keeps
the autostart mask, while the session writes its readiness PID only after
XFCE's window manager and exactly one private-D-Bus Clipman are both alive.

The first automated generation exposed an incorrect assumption: explicitly
starting Clipman in `session.sh` produced two processes because the XFCE panel
also started its plugin. Both were correctly contained in the session cgroup
and cleaned after detachment. The corrected generation relies on the
panel-owned process and makes an exactly-one check part of readiness. Removing
the plugin from this Full XFCE profile intentionally makes session readiness
fail instead of silently providing a desktop without its required clipboard
manager.

### Automated result, 2026-08-27

The isolated server started on fixed display `:11`, RFB 5911 and gateway 39011.
Before application attach it contained no Clipman. As expected, the unchanged
non-lean IBus still activated its extension, XIM, AT-SPI and Portal process
tree; moving Clipman is not sufficient to remove those services.

Generation 1 started an explicit Clipman and exposed a second panel-owned
Clipman. Both processes were in the session cgroup and both disappeared after
the 10-second vacancy cleanup. The session script was corrected to adopt the
panel-owned process instead of launching another.

Generation 2 then verified:

- exactly one `xfce4-clipman` process;
- its `DBUS_SESSION_BUS_ADDRESS` matched the generation's private session bus;
- the VNC server cgroup contained zero Clipman processes;
- session readiness was published only after the window manager and Clipman
  were both alive; and
- 10 seconds after detachment, `sessionState` returned to `stopped`, the
  session cgroup was removed and display `:11` had zero Clipman processes.

During the connected sample the full XFCE session used about 234 MiB
MemoryCurrent and 176 tasks. This is workload context, not a claimed saving:
P03b changes ownership/lifecycle, and the original non-lean IBus remains in the
server.

Generation 3 was a real noVNC session. The user confirmed that Full XFCE input,
clipboard behavior and reconnect all worked. During that session the gateway
recorded 33 successful text commits and zero `client event:` entries; the
session cgroup contained exactly one panel-owned Clipman and the server cgroup
contained none. This accepts P03b. It remains an isolated implementation and
has not yet changed the live display-2 class.

The verification URL was:

- `http://test-host:1992/remotexapps/xfce-session-clipman-b97f6ae2a776/kiosk.html`

The isolated instance and port-1992 manager were stopped after acceptance; the
URL is retained only as experiment provenance.

Later go-live validation deliberately used a clean XFCE profile and exposed an
additional portability constraint: not every profile contains the Clipman
panel plugin. Waiting only for a panel-owned process made that session time out
even though its window manager was ready. The production driver now gives an
existing panel plugin a bounded chance to start and adopts it when present;
otherwise it starts exactly one fallback Clipman on the same private session
D-Bus. Both paths remain in the session cgroup and retain the exactly-one
readiness check. Clean-profile and configured-profile paths are both go-live
regressions.

The first clean-profile full benchmark also measured a 20.182-second attach.
Journal timing isolated the delay to the initial shell implementation of the
exactly-one check: each 100 ms pass spawned `cat` for every `/proc` entry, so
20 passes on this roughly 4,000-process host performed about 80,000 probes.
The corrected check uses one `pgrep` and inspects only matching Clipman
environments. The 20.182-second artifact is retained as rejected performance
evidence; only the rerun after this correction is eligible for go-live.

That first correction reduced the same clean-profile attach to 10.615 seconds
but did not remove the scaling term: each native `pgrep` still traversed the
roughly 4,000-process host, and the 100 ms loop invoked it 20 times. The final
driver makes the two-second panel grace probe-free, performs one discovery,
and only polls briefly after it has explicitly started a fallback. This final
shape must pass on a second never-started profile before deployment.

## P04: depth 16 versus depth 24

P04 uses two configs under `tests/performance/depth-ab` and runs them
sequentially, never concurrently. Both inherit the accepted lean-IBus,
no-Clipman Mousepad server, trace-off SDK, 1280x720 geometry, 15 fps, identical
Tight quality/compression and the same headless Chrome/noVNC client. Display
depth is the only class variable.

For each depth, record server MemoryCurrent/tasks, TigerVNC cgroup CPU and
gateway byte deltas for a static interval and the same 30-second
`x11perf -scroll500` workload. TigerVNC logs must confirm the client's requested
pixel format and Tight encoding. The result must separate framebuffer memory,
X11 workload throughput, encoder CPU and wire bytes; no single metric decides
the default.

### Automated result, 2026-08-27

The isolated manager ran on port 1992 and allocated display `:11` sequentially
to the two instances. Port 1991 remained reachable throughout. Both runs had
23 server-layer tasks. The 10-second static sample was effectively identical:
both delivered 892 bytes to the browser and received 300 bytes. Depth 16 used
6.3 ms of VNC CPU and depth 24 used 5.5 ms, which is too small a difference to
interpret.

The active-scroll results were:

| Metric | Depth 16 | Depth 24 | Depth-24 change |
|---|---:|---:|---:|
| Server MemoryCurrent | 44.94 MiB | 49.46 MiB | +4.52 MiB |
| `x11perf` throughput | 22,100 ops/s | 13,100 ops/s | -40.7% |
| VNC CPU per operation | 39.90 us | 68.42 us | +71.5% |
| RFB-to-browser bytes per operation | 0.03301 | 0.03035 | -8.1% |
| Approximate VNC one-core utilization | 88.3% | 89.7% | +1.4 points |

`x11perf -time 30` completes a whole calibrated repetition count, so it ran
600,000 depth-16 operations in approximately 27.12 seconds and 500,000
depth-24 operations in approximately 38.15 seconds. Raw total bytes would
therefore compare different amounts of work and are misleading. CPU and wire
bytes above are normalized per completed operation; one-core utilization is
provided only as workload context.

TigerVNC reported that noVNC requested depth 24 in a 32-bpp little-endian BGR
pixel format. The depth-24 server log confirmed the same client format and
Tight rectangles. The retained baseline TigerVNC log had already confirmed
that the depth-16 server receives this same 32-bpp client request, so depth 16
requires conversion but does not disable Tight in the installed stack.

The hypothesis is rejected. Depth 24 made the X operation itself slower, used
4.52 MiB more server memory and required 71.5% more VNC CPU per completed
scroll operation, while saving only 8.1% of encoded bytes per operation. Keep
depth 16 as the generic Mousepad/single-app default. This does not override
application-specific correctness: WeChat must remain depth 24 because its
rendering was visibly incorrect at depth 16.

The raw and normalized values are retained in
`tests/performance/depth-ab/results-2026-08-27.json`. Both experiment instances
and the isolated port-1992 manager were stopped after measurement.

## P05: bound the compatibility relay queue

The active SDK uses `/rfb-compat`. Before P05, that relay copied up to 64 KiB
per target read into independent channels of capacity 256. A stalled browser
could therefore retain approximately 16 MiB of Go payloads in the
server-to-browser channel alone. Arbitrary RFB chunks cannot be dropped or
replaced because the protocol is an ordered byte stream.

P05 first refactored the relay so a build-tagged experiment can supply a queue
capacity and observe depth. The ordinary handler retained its original value
until the deterministic comparison completed. Ordinary unit tests also run the
full bidirectional relay with a capacity-one queue, so partial scheduling does
not hide a correctness failure.

### Deterministic slow-client result, 2026-08-27

Each capacity ran in five independent Go test processes. A TCP source sent 512
64-KiB frames (32 MiB total); the WebSocket client stopped reading for one
second, then delayed two milliseconds after every received message. A forced
GC during the stall measured the live heap rather than cumulative allocation.

| Median metric | Queue 256 | Queue 8 | Queue 1 |
|---|---:|---:|---:|
| Observed maximum queue depth | 256 | 8 | 1 |
| HeapAlloc increase during stall | 16.18 MiB | 0.68 MiB | 0.24 MiB |
| Average source-frame age | 1564 ms | 1051 ms | 1124 ms |
| Maximum source-frame age | 2127 ms | 1593 ms | 1648 ms |
| Final-frame age | 1156 ms | 976 ms | 989 ms |
| Upstream send duration | 1008 ms | 1234 ms | 1207 ms |
| Client drain duration | 1181 ms | 1224 ms | 1195 ms |

Relative to 256, queue 8 reduced the stall-time heap increase by 95.8%, average
data age by 32.8%, maximum data age by 25.1%, and final-frame age by 15.6%.
Earlier TCP backpressure increased the median upstream send duration, which is
the intended tradeoff. The queue does not own all buffering, so latency did not
fall in proportion to the 32-fold channel reduction. Queue 1 saved only about
0.44 MiB more heap and had no stable latency advantage over queue 8; queue 8 is
the candidate.

The source default is now 8. The already running port-1991 binary remains
unchanged until a deliberate deployment/restart. On the isolated port-1992
real stack, queue 8 passed noVNC attach, Mousepad readiness, a
12-byte/eight-character `P05你好abc` IBus commit in 2.301 ms, exact clipboard
readback, detach and a second noVNC reconnect.

The user then confirmed pointer, continuous English input, Chinese/English IME
switching, the first post-switch character, shortcuts, resize and repeated
refresh/reconnect behavior. The final gateway counters showed five RFB and six
input connections. Its journal contained 94 successful text commits and zero
`client event:` records. This accepts P05. The instance and isolated port-1992
manager were stopped after the evidence was captured.

Reproduction code is in `tests/performance/rfb-queue/run.sh` and the build-tagged
test `cmd/novnc-input/rfb_queue_experiment_test.go`. Median values are retained
in `tests/performance/rfb-queue/results-2026-08-27.json`.

## P06: demand-driven browser diagnostics

Before P06, every connected `RemoteXAppClient` requested gateway `/healthz`
once per second and emitted diagnostic snapshots even when the kiosk diagnostic
panel was hidden. The kiosk listener serialized each snapshot and assigned its
JSON to a hidden `<pre>`. Instance watching every two seconds and the five-second
IBus caret watchdog are lifecycle/input correctness mechanisms and remain
unchanged controls in this experiment.

SDK 0.7 defaults `diagnosticsEnabled` to false. It exposes
`setDiagnosticsEnabled()` for an observation UI and `refreshDiagnostics()` for
one explicit snapshot. The built-in kiosk enables periodic diagnostics only
while its panel is visible. The SDK console opts in because its diagnostic pane
is always visible. State, cursor and text details continue updating internally,
and `getDiagnostics()` remains available without starting a timer.

### Automated result, 2026-08-27

A real headless Chrome/noVNC session used the isolated port-1992 manager,
display `:11`, the accepted P01/P03 server stack and P05 queue capacity 8. A
CDP harness measured resource requests, SDK diagnostic events and MutationObserver
records for three consecutive 5.2-second phases:

| Phase | `/healthz` | Instance requests | Diagnostic events | Diagnostic DOM mutations |
|---|---:|---:|---:|---:|
| Panel hidden / demand off | 0 | 3 | 0 | 0 |
| Panel visible / demand on | 5 | 2 | 6 | 6 |
| Panel hidden again | 0 | 3 | 0 | 0 |

The diagnostics interval existed only during the visible phase. The unchanged
two-second instance watcher remained observable in every phase, demonstrating
that the test did not obtain zero work by disabling lifecycle observation. The
cursor watchdog also remains active on `/input`; it is not an HTTP request.

The same real session committed `P06你好abc` through IBus in 1.028 ms, copied
the exact value back from Mousepad, detached and reconnected successfully. The
user then confirmed pointer, continuous English input, Chinese/English
switching, first post-switch input, shortcuts, resize, refresh/reconnect and
repeated diagnostic-panel toggling. Final counters showed six RFB and seven
input connections; the journal contained 51 successful text commits and zero
`client event:` records. This accepts P06.

The CDP reproduction script is
`tests/performance/diagnostics-demand/measure-cdp.mjs`; machine-readable results
are in `tests/performance/diagnostics-demand/results-2026-08-27.json`. The
isolated instance and port-1992 manager were stopped after acceptance.

## P07: bundled immutable browser assets

Before P07, a normal viewer loaded four SDK modules, 31 noVNC core modules and
ten noVNC vendor modules. The manager served them without explicit validators
or cache policy. P07 changes only static asset construction and delivery: the
SDK becomes one minified bundle, noVNC becomes one lazily loaded bundle, and a
41-byte stable `/sdk/index.js` loader points to the content-hashed SDK asset.

`remotexappd` embeds a build manifest and serves only its two allow-listed
hashed files under `/assets/`. Hashed files use a one-year immutable cache and
ETags. The stable loader uses `no-cache` plus an ETag so a deployment can change
its hash target without making applications change their import URL. Source
`/sdk/`, `/core/` and `/vendor/` routes remain available for debugging but are
not part of the normal viewer graph. Node, esbuild and noVNC source are
build-time inputs; the compiled Go manager serves the resulting assets without
a runtime bundler. The original P07 measurement used the installed Debian
noVNC `1:1.3.0-2` source. Current builds instead use the reviewed stable release
recorded under `third_party/novnc/`, without changing the runtime delivery
topology.

### Automated result, 2026-08-27

The baseline and candidate managers ran sequentially on isolated port 1992
with separate state, binaries and Chrome profiles. Both used the same warmed
Mousepad on display `:11`, accepted lean/no-Clipman server, capacity-8 RFB
gateway, P06 SDK behavior, 1280x720 depth-16 display and 15-fps cap. The first
attachment that cold-started the application was excluded. Each measured run
used a fresh Chrome profile and then one same-profile reload over local HTTP.

| Median metric (five profiles) | Source graph | Bundled candidate | Change |
|---|---:|---:|---:|
| Fresh-profile connection | 537.6 ms | 387.5 ms | -27.9% |
| Same-profile reload connection | 129.7 ms | 78.2 ms | -39.7% |
| Static resource requests | 45 | 3 | -93.3% |
| Fresh-profile static transfer | 551,233 B | 181,399 B | -67.1% |
| Reload static transfer | 45,181 B | 300 B | -99.3% |

The connection metric ends only after both noVNC RFB and the input WebSocket
are connected; it is not merely DOMContentLoaded. Transfer sizes include the
browser's reported local HTTP response overhead. Because the test origin did
not compress responses, do not reuse the byte ratio as an estimate for a CDN
that applies Brotli or gzip.

The candidate then committed `P07 中文 input`, explicitly disconnected the
SDK client, restored both channels in 40.8 ms and committed ` reconnect OK`.
Selecting all in Mousepad and reading its X11 clipboard returned the exact
combined string. Server acknowledgements were 7.876 ms and 2.461 ms. This
accepts P07 in repository source. The already running port-1991 binary was not
rebuilt or restarted and therefore still serves its older embedded assets.

Reproduction and cache-policy details are in
`tests/performance/assets-bundle/README.md`; raw samples are retained in
`tests/performance/assets-bundle/results-2026-08-27.json`.

## P08: direct Xtigervnc supervision

The wrapper baseline leaves a Perl `tigervncserver` child resident between the
X server and the class server driver. P08 adds a manager-level
`-vnc-launcher=direct` candidate: systemd owns `Xtigervnc` as the VNC unit's
MainPID, while a separate `BindsTo` server unit owns the class driver. Gateway
and application-session units also bind to the VNC unit. Explicit
`-vnc-launcher=wrapper` remains available as a compatibility fallback.

Five independent server-ready samples per mode gave these medians:

| Median | Wrapper | Direct | Change |
|---|---:|---:|---:|
| Create to server-ready | 596 ms | 538 ms | -9.7% |
| Server-layer MemoryCurrent | 42,831,872 B | 32,141,312 B | -25.0% |
| Server-layer total PSS | 48,305 KiB | 37,438 KiB | -22.5% |
| Tasks | 24 | 22 | -8.3% |
| Resident Perl-wrapper PSS | 5,280 KiB | 0 | removed |

The direct total sums its VNC and server-driver cgroups; the wrapper total uses
its one combined cgroup. Exact Unicode application readback, SDK reconnect,
resize, Xauthority, normal stop and wrapper compatibility all passed. Killing
the isolated direct `Xtigervnc` MainPID deactivated the bound gateway, session
and server units; API stop then removed all ephemeral paths. The manager's
instance snapshot remained stale until explicit stop because it does not yet
subscribe to systemd unit events. That observation is recorded, not hidden or
folded into P08.

The user then completed the isolated manual keyboard, IME switching,
first-character, shortcut, pointer, resize and refresh/reconnect matrix and
reported that it worked. Final gateway counters showed seven RFB and seven
input connections. The journal contained 46 completed text requests, zero text
errors and zero `client event:` trace records. This accepts P08 and makes
`direct` the repository default. The live port-1991 manager was not restarted
and continues using its older compiled wrapper path.

The full topology, raw samples and interactive evidence are in
`tests/performance/direct-xtigervnc/README.md`.

## P09a: transition-only managed-registry persistence

P09a kept the five-second reconciliation interval, `xdpyinfo`, gateway health
request, P08 direct VNC launcher and accepted lean Mousepad stack unchanged.
The only performance variable was whether a healthy, unchanged registration
is written durably.

Four complete passes in matched 20-second windows produced:

| Operation | Baseline | P09a |
|---|---:|---:|
| `xdpyinfo` executions | 4 | 4 |
| gateway health connects | 4 | 4 |
| registry `fsync` | 4 | 0 |
| registry atomic rename | 4 | 0 |

The baseline changed the registry inode and mtime despite identical content.
P09a kept inode, mtime and SHA-256 unchanged. Real desired-state transitions
still persisted. A manager restart adopted the same runtime without a write,
and killing the isolated gateway rebuilt it in 2.956 seconds.

The restart/reconnect test also exposed an older reconciliation bug: the
durable runtime snapshot was copied over newer live session/client state on
every healthy pass. Adoption now inserts that snapshot only when no live
instance exists. After a real manager restart, exact Unicode commit,
44.0-millisecond SDK reconnect, second commit and exact Mousepad clipboard
readback all passed. This correctness fix is part of the same managed-state
ownership boundary, not a second performance optimization.

P09a is accepted. P09b will separately replace subprocess-heavy observation;
P09a intentionally leaves the four `xdpyinfo` and four HTTP checks in the
sample. Reproduction and machine-readable results are in
`tests/performance/managed-persistence/`.

## P09b: cgroup/inotify managed-runtime observation

P09b replaces the healthy five-second `xdpyinfo` and gateway `/healthz` poll
with one host-wide inotify FD/goroutine watching each managed runtime's VNC and
gateway cgroup-v2 `cgroup.events`. It retains a five-minute +/-20% jittered
full check for alive-but-hung processes and provides explicit
`-managed-observer=poll` compatibility mode.

Matched 30-second steady windows produced:

| Operation | P09a poll | P09b event observer |
|---|---:|---:|
| `xdpyinfo` executions | 6 | 0 |
| gateway health connects | 6 | 0 |
| registry `fsync`/rename | 0/0 | 0/0 |

The observer added one manager goroutine, one FD and approximately 456 KiB PSS
in the simultaneous sample; watch descriptors add no process/goroutine per
runtime. Coarse 20-second CPU was 0.05% for the polling manager and 0.00% for
the candidate. Gateway and Xtigervnc fault recovery completed in 1.596 seconds
and 642 ms respectively. Manager restart kept the runtime and registry inode,
performed one startup validation, restored both watches, and a subsequent
gateway fault recovered in 631 ms. Poll fallback recovered in 2.840 seconds.

Automated exact Unicode/reconnect/clipboard and client-resize checks passed.
The user then completed the isolated keyboard/IME/pointer/reconnect check and
reported that it worked. The final gateway journal contained 50 completed text
requests, zero text errors and zero client trace events. This accepts P09b;
the isolated runtime and port-1992 manager were removed. Full measurements are
in `tests/performance/managed-observer/`.

## P10: cgroup/inotify session exit observation

P10 replaces each running session's 500 ms readiness-PID loop with one watch
on its transient systemd session unit's cgroup-v2 `cgroup.events`. It extends
the accepted P09b observer rather than creating another reader: the manager
still owns one host-wide inotify FD/goroutine, while each active session adds
one watch descriptor. `-session-observer=poll` retains the old implementation
as an explicit compatibility fallback.

Matched 30-second Mousepad/noVNC windows produced:

| Operation per running session | P09b baseline | P10 |
|---|---:|---:|
| readiness PID-file open/parse | 60 | 0 |
| `kill(pid, 0)` | 60 | 0 |
| recurring monitor goroutine | 1 | 0 |
| one-time cgroup watch descriptor | 0 | 1 |

The candidate added its watch only at session start and performed no watch
registration in the steady window. Clean simultaneous managers each consumed
one CPU tick in 20 seconds and used eight OS threads. Five PSS snapshots
averaged 9,925.2 KiB for the baseline and 9,336.4 KiB for the candidate; this
small negative result is treated as Go heap/process variance, not a memory
saving claim. P10 adds no host-wide FD/goroutine beyond P09b.

Normal temporary Mousepad exit was observed in 112 ms; `SIGKILL` was reported
as failed with exit code 137 in 62 ms. A manager restart adopted the same
managed runtime without changing the registry inode, restored VNC, gateway
and session watches, and observed the session exit in 118 ms. The explicit
poll fallback detected exit in 219 ms. A dynamic Full XFCE class using the
production XFCE server/session drivers reached running and reported terminated
`xfce4-session` as failed in 206 ms. A generation guard unit test rejects late
events from an earlier session.

The real browser path committed and read back exactly
`P10 中文 input reconnect OK`, reconnected both SDK channels in 39.8 ms,
resized 1100x760 -> 900x640 and delivered pointer position 550,380 exactly.
An earlier P03b experimental-driver attempt missed its existing Clipman
readiness deadline before any P10 watch was registered and is explicitly
excluded, rather than attributed to the observer.

P10 is accepted. All isolated port-1992/1993 managers and instances were
stopped; port 1991 remained HTTP 200 and was not rebuilt or restarted during
the experiment. Reproduction, the Full XFCE class, browser harness and
machine-readable evidence are in `tests/performance/session-observer/`.

## P11: isolate cursor snapshot writers per input peer

Before P11, the persistent IBus subscription reader called `writeJSON`
synchronously for each connected `/input` peer. Each write had a 500 ms
deadline, so one stalled WebSocket delayed the publisher and every peer later
in the iteration. Cursor positions are replaceable state snapshots, unlike RFB
bytes and text acknowledgements.

P11 gives each peer an independent writer and a capacity-one cursor queue. A
new position replaces an older queued position while an in-flight write
finishes. The publisher only updates the cache and offers the newest snapshot;
it never performs network I/O. Reliable text acknowledgements and one-shot
cursor replies still call the peer's direct writer, while the shared per-peer
mutex preserves Gorilla WebSocket's single-writer rule. A write failure closes
and unregisters only that peer.

A build-tagged deterministic harness ran the production `publishCursor` path
five times before and after the change. It emitted 32 snapshots to one peer
with a fixed 10 ms write delay and one fast peer:

| Median metric | Serial baseline | P11 |
|---|---:|---:|
| Publisher duration | 324.437 ms | 13.211 us |
| Fast peer receives sequence 32 | 324.436 ms | 23.242 us |
| Slow peer snapshots written | 32 | 1 |
| Slow peer receives sequence 32 | 324.433 ms | 10.791 ms |

The controlled publisher speedup was approximately 24,558x. The slow peer
still converged to the newest sequence, but obsolete queued positions were not
serialized. A separate five-run, 1,000-peer normal-build measurement added a
median 1,031,256 bytes of live heap plus 2,162,688 bytes stack-in-use, about
3.19 KiB per active input peer. It added one goroutine per peer, and all 1,000
writers exited after removal. Normal and race-enabled unit tests cover
coalescing, isolation, cached snapshots, stale sequences, serialization and
write-failure cleanup.

The isolated real stack used the P03 no-Clipman Mousepad class at manager port
1992, display `:11`, RFB 5911 and gateway 39011. A second raw input observer
saw cursor sequence 6, then pushed 7 after a text commit; a newly connected
observer immediately received cached sequence 7. The repeat produced 7 -> 8
-> cached 8. Exact application clipboard readback was
`P11 中文 input reconnect OK P11 cursor cache P11 clipboard exact`.
The first text request took 0.852 ms server-side/2.0 ms round-trip, explicit
SDK reconnect took 36.0 ms, both channels returned to `connected`, pointer
dispatch completed and the framebuffer resized from 1280x720 to 1100x673.

A contextual old/new real-gateway sample with one RFB and one input connection
recorded one/zero CPU ticks over 30 seconds. A unique old-binary inode avoided
shared-text PSS distortion; average RSS was 9,498.4/9,966.4 KiB and PSS was
7,080.4/7,447.4 KiB. Because that deployed baseline binary also predates other
accepted source changes, these whole-process values are not treated as P11's
causal memory cost; the controlled 1,000-peer result is authoritative for the
new queue/writer overhead.

P11 is accepted. All isolated port-1992/1993 managers, instances, displays and
Chrome processes were stopped and the temporary directory was moved to trash.
Port 1991 remained HTTP 200 and was not rebuilt or restarted. Reproduction and
machine-readable evidence are in `tests/performance/cursor-fanout/`.

## P12: reduce browser text batching latency

Before P12, every ordinary browser `input` and completed `compositionend`
waited for a hard-coded 40 ms debounce. P12 changes only this SDK policy:
ordinary text defaults to a configurable 16 ms debounce, while a completed
composition is appended after any older pending ordinary text and flushed
immediately. Explicit `textBatchDelay:40` preserves compatibility and `0`
selects immediate ordinary sends.

A five-run deterministic harness measured the production client with one
ordinary value, five values spaced 10 ms apart, and one completed composition:

| Median metric | Old fixed 40 ms | P12 default 16 ms |
|---|---:|---:|
| Single ordinary input to send | 40.490 ms | 16.278 ms |
| Five-event burst, first input to send | 81.298 ms | 57.246 ms |
| Requests for that burst | 1 | 1 |
| Completed composition to send | 40.307 ms | 0.0085 ms |

The deliberate single-input delay fell by 24.212 ms, or 59.8%. Candidates at
8 and 0 ms reduced one-event latency further but sent five requests for the
same 10 ms-spaced burst, so they were rejected as defaults. The final source's
40 ms compatibility mode retained one burst request while also gaining
immediate composition flush.

P12 also fixes timer ownership during reconnect. Channel replacement,
disconnect and failure clear the pending value/timer before opening another
input WebSocket, so a callback created for an old channel cannot send through
the replacement. Unit tests cover ordering, both IME-switch directions, the
first post-switch English character, IME-consumed modifiers, normal shortcuts,
delay validation and stale-batch discard.

The isolated SDK 0.8 real stack used manager port 1992, display `:11`, RFB
5911, gateway 39011 and the P03 no-Clipman Mousepad class. Default-16 browser
input-to-ack was 18.5 ms for `A`, 3.8/3.2 ms for `你好`/`世界`, 21.7/20.6 ms
for the first following English characters, and 62.2 ms for one coalesced
`abcde` request. Explicit reconnect took 27.1 ms and discarded a deliberately
queued `DROP`; subsequent text, exact clipboard readback
`A你好i世界xabcdeR`, pointer, shortcuts and resize passed. The real 40 ms
compatibility run produced about 45--47 ms ordinary acknowledgements, about
2 ms composition acknowledgements and the same exact correctness result.

The user then exercised the default with a native operating-system IME and
reported that the complete English/Chinese switch, first-character, fast
typing, shortcut, pointer, resize and reconnect matrix worked. The accepted
gateway journal contained 59 completed text requests, zero text
errors/rejections and zero `client event:` trace records.

P12 is accepted in SDK 0.8 source, generated bundle `sdk-S4KCHU5P.js`, and the
rebuilt repository `bin/remotexappd` (`67470aeb…`). All isolated browser
processes, services, display and ports were stopped, and the temporary
directory was moved to Trash. Port 1991 remained HTTP 200 and was not rebuilt
or restarted, so deployment there remains a separate deliberate action.
Reproduction and machine-readable evidence are in
`tests/performance/text-batching/`.

## P13: replace successful text logs with counters

Before P13, one successful IBus text request wrote four gateway journal lines:
received content, backend start, IBus completion and request completion. This
made journald part of every commit and disclosed the actual typed value by
default. P13 changes only successful text observability. Errors remain logged;
normal success updates atomic health counters.

The accepted `novnc-input -text-log errors` default writes no success/content
lines. `metadata` explicitly restores stages and timing without content;
`content` is a short-lived diagnostic mode that also includes typed values.
The host manager validates `-gateway-text-log` and passes it to each gateway.
This is operator policy rather than a client or template parameter.

The private Python IBus engine's separate `engine.log` was not changed: each
successful commit still opens, appends and closes one content-free
`committed bytes=… characters=…` record. That behavior was identical in both
runs and is outside the gateway journal/syscall measurements below. Removing
or batching it requires its own experiment and application-level regression.

A matched real-stack A/B sent 600 requests over 30 seconds at 20 requests per
second, including 60 Chinese characters. Both Mousepad clipboard values exactly
matched the generated 600-character/720-byte value.

| Metric | P12 baseline | P13 `errors` |
|---|---:|---:|
| Successful text journal lines | 2,400 | 0 |
| Content-bearing lines | 600 | 0 |
| Successful text journal bytes | 135,947 | 0 |
| Gateway write syscalls | 8,433 | 5,938 |
| Gateway `wchar` | 1,069,867 B | 929,993 B |
| Gateway CPU ticks | 65 | 62 |
| Browser ACK p50/p95 | 1.2/3.6 ms | 1.2/3.7 ms |
| Server p50/p95 | 0.611/1.493 ms | 0.580/1.583 ms |

This removed 2,495 write calls (29.6%) and 139,874 `wchar` bytes (13.1%)
from the gateway sample. CPU and latency were effectively unchanged, so P13
does not claim a speedup. Its accepted outcomes are lower write I/O and removal
of plaintext input from default logs.

`/healthz` reported exactly 600 requests, zero errors, 720 input bytes and
453,113 cumulative server microseconds after the final-hash run. A deliberately
invalid request returned an ACK error, incremented `textErrors`, and produced
one rejection log without content. Unit tests cover level validation,
redaction/default behavior, manager policy and health fields.

The final candidate also passed P12's exact composition/switch/first-character,
burst, stale reconnect, shortcut, pointer and resize regression. The user then
used a native operating-system IME and reported that it worked. That session
showed one RFB/input client, five successful requests, zero errors and zero
success/content/client-event journal lines.

P13 was accepted with repository binaries matching that experiment's tested
candidate: `bin/remotexappd` was `4c63e032…`, `bin/novnc-input` was
`35538390…`, and `bin/remotexapp-status` was `3cf0bc00…`. The isolated browser,
instance, display and manager were stopped and their temporary directory moved
to Trash. Port 1991 remained HTTP 200 and was not rebuilt or restarted.
Reproduction and machine-readable evidence are in
`tests/performance/text-logging/`.

## P14: move private D-Bus and IBus into the session layer

P14 adds an opt-in `input.lifecycle: "session"` class policy. The existing
`server` default is unchanged. The isolated class used manager port 1992,
display `:31`, RFB 5931, gateway 39031 and a separate state/catalog. Its
server driver contains no D-Bus, IBus, Unicode engine or clipboard process;
the session driver creates and cleans the complete input stack together with
XFCE.

In server-only state, the candidate server unit was one `sleep` process:
204,800 B `MemoryCurrent` and one task. The contemporaneous production Full
XFCE server unit was 16,887,808 B and 18 tasks, a direct server-unit difference
of 16,683,008 B and 17 tasks. VNC and gateway snapshots are not interpreted as
a marginal saving because their live workloads and Go heap ages differed.

Two session generations had 4,798 ms and 3,747 ms cold attach-to-ready times.
Chinese/English switching, the first post-switch character, shortcuts,
pointer, input/RFB reconnect, clipboard and exact application readback passed.
Server text processing was 0.532–1.883 ms; observed browser/server round trips
were 1.0–4.8 ms. After detach, every session D-Bus/IBus/engine PID file and
socket disappeared while the persistent display/gateway returned to
`server-ready`.

This experiment exposed two lifecycle details. First, the gateway must own the
public cursor sequence: the engine counter restarts after both a whole session
restart and an in-session input-method switch. Second, the gateway's expected
missing-socket retry now logs once per outage, reconnecting silently until the
session returns rather than writing once per second.

During the isolated phase, production remained PID 2881468, HTTP 200 and on
its original three binary hashes. After user acceptance, the experiment was
stopped and the common lifecycle was applied to XFCE, Mousepad and Edge.

The live managed runtime changed from `xfce-desktop-EXAMPLE` to
`xfce-desktop-EXAMPLE` while retaining managed ID `example-managed-desktop`,
profile `xfce-driver-test`, HOME and display `:2`. Live server-only state was
212,992 B/1 task with no D-Bus/IBus/engine process or socket, versus the
pre-deploy 16,887,808 B/18-task snapshot: 16,674,816 B (98.74%) lower.

Post-live XFCE attached in 4,188 ms, passed 20 mixed Unicode requests with
exact clipboard readback, preserved fixed resolution and reconnected in 34
ms. Mousepad attached in 1,013 ms, passed exact input/readback, remote resize
and 34 ms reconnect. Edge copied exact `LiveEdge你好Z9` from its address bar;
its D-Bus/IBus/engine were in the session cgroup and cleanup left zero input
artifacts. Port 1992 is stopped. Reproduction, rollback and machine-readable
evidence are in `tests/performance/session-owned-ibus/` and
`docs/session-input-go-live-2026-08-27.md`.

## P15: caller-scheduled remote resize

P15 changes only when SDK 0.15 permits noVNC to issue its normal
ExtendedDesktopSize request. The pinned noVNC 1.7 implementation already
allows one request in flight and limits starts to one per 100 ms, but it does
not provide a trailing debounce or caller-owned maximum wait. The vendor tree,
TigerVNC, RFB transport, Mousepad, Matchbox, and IBus stack were held constant.

The isolated real-browser stack used manager `127.0.0.1:2098`, dynamic display
`:10`, a separate temporary state directory, and fresh Chrome profiles. With
the compatibility default (`resizeDebounce:0`), `scaleViewport` stayed false
and `1000x613` changed to `930x650` in 63.54 ms. With a 300 ms debounce and
infinite maximum wait, four 50 ms-spaced viewport changes left the remote
framebuffer at `1000x613`; CSS canvas bounds changed at every sample, proving
that the old framebuffer continued to scale locally. After quiet, the remote
framebuffer converged directly to the final `1100x740` size.

An explicit flush converged to `960x680` in 84.83 ms, before the 300 ms quiet
period. Explicit reconnect negotiated `1020x710` in 121.14 ms rather than
waiting for debounce. A second profile with `resizeDebounce:200` and
`resizeMaxWait:400` changed viewport every 80 ms: the framebuffer first
advanced at 440.20 ms and finally converged to `1140x740`.

Deterministic tests prove exact trailing coalescing, equal-size suppression,
newest-target retention across an in-flight request, fixed-policy scaling, and
timer disposal. The live regression also verified primary-pointer IME anchor
renewal, right-button exclusion, composition-safe focus counts, a fresh IBus
caret in 33.8 ms, exact `P15中` application readback, zero text errors, and
reconnect. Native candidate-window placement and interactive resize UAT were
accepted on 2026-08-29.

Port 1991 remained the running rc.20 service during the controlled experiment.
After validation, the isolated browser, manager, application and bound units,
display, ports, and temporary state were removed. The later rc.21 deployment
repeated the automated gate on port 1991. Reproduction and machine-readable
evidence are in `tests/performance/resize-debounce/` and
`tests/go-live-validation/results/ime-resize-rc21-local-1991.json`.

## Integrated go-live, 2026-08-27

P01/P03/P03b drivers and the compiled P02/P05-P14 candidates were validated on
isolated port-1992 managers, then deployed to port 1991. Build, race, SDK,
documentation, Mousepad, Edge, clean/configured XFCE, lifecycle, managed
gateway/VNC/session fault and manager-restart tests all passed. Fixed XFCE was
migrated to managed ID `example-managed-desktop` after testing proved that an
anonymous fixed-display autostart cannot be adopted across manager restart.

The actual live binaries are `188afc12…`, `304f77f9…` and `3ee10fb2…`; the
manager is enabled as `remotexapp.service`. The identical pre/post
90-second P01-P13 system workloads passed on port 1991. P14 then passed the
isolated and live three-driver matrix and reduced the vacant XFCE server unit
to 212,992 B/one task. Full results, including
server-only PSS -48.3%, MemoryCurrent -76.3%, Mousepad attached PSS -26.6%,
Full XFCE attached PSS -9.4% and the XFCE cold-attach regression, are in
[`go-live-report-2026-08-27.md`](go-live-report-2026-08-27.md) and
[`session-input-go-live-2026-08-27.md`](session-input-go-live-2026-08-27.md).

A non-performance lifecycle follow-up then made XFCE report orderly Logout as
`exited` before its session cgroup empties. Isolated `1993/:31` and production
`:2` both reached `stopped/exited` with the RFB peer still attached, restarted
as generation 2 on reconnect, and cleaned all session input artifacts after
final detach. It does not alter P14's resource comparison.
