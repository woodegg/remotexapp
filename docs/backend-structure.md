# Backend structure

The RemoteXApp service has two Go process boundaries. They deliberately
remain separate because each application instance gets its own small gateway,
while one manager owns the class catalog and lifecycle state.

```text
browser SDK / noVNC
        |
        v
remotexappd (:1991)             one per host
  API + lifecycle manager
        |
        +-- TigerVNC            one per instance
        +-- session driver      XFCE or Matchbox + one app
        |       +-- optional loopback application-control socket
        +-- novnc-input         one per instance
                |
                +-- RFB/TCP proxy
                +-- native X11 input
                +-- private IBus socket
                +-- private X11/XFixes clipboard bridge
                +-- restricted UNO API (when configured)
```

## `cmd/remotexappd`

- `main.go`: flags, dependency checks, autostart and HTTP process bootstrap.
- `config.go`: class schema, strict JSON decoding, defaults and validation.
- `model.go`: API/runtime models and synchronized manager state.
- `policy.go`: safe per-instance overrides and effective runtime policy.
- `managed.go`: persistent managed-instance registry, API and reconciliation.
- `runtime_manifest.go`: unified managed/anonymous active-runtime records,
  first-restart migration, health-checked adoption, and locked recovery.
- `http.go`: health/readiness, REST handlers, SDK/static routing and
  per-instance reverse proxy.
- `clipboard.go`: generation-qualified public clipboard APIs, streaming
  multipart validation, and the verified owner-only gateway Unix transport.
- `security.go`: trusted-proxy identity, request IDs, exact-origin validation
  and browser security headers.
- `assets.go`: embedded build manifest, stable SDK entry point, content-hashed
  asset allow-list, ETags and cache policy.
- `lifecycle.go`: allocation, server/session start and stop, attachments,
  vacancy cleanup, and generic loopback application-control ports.
- `parameters.go`: typed launch-input validation, including canonical files
  constrained to administrator-owned document roots.
- `status.go`: application-status generations, atomic snapshots, schema
  validation and manager-owned lifecycle fallbacks.
- `runtime.go`: systemd invocation and OS readiness probes.

P08 added a manager-level `-vnc-launcher` selector. `wrapper` retains the
original combined `tigervncserver -xstartup` unit. The accepted `direct` default creates
a mode-0600 Xauthority cookie, runs `Xtigervnc` as the VNC unit MainPID, and
runs the class server driver in a separate `BindsTo` unit exposed as
`serverUnit`. Gateway and application-session units bind to that same VNC
unit. The wrapper remains an explicit rollback option; see
[`tests/performance/direct-xtigervnc/README.md`](../tests/performance/direct-xtigervnc/README.md).

`cmd/remotexapp-status` is a short-lived helper invoked by status-enabled
drivers. It validates typed public details and the current generation before
atomically replacing the instance snapshot; it is not a daemon or another
network listener.

`drivers/common/session-status.sh` is the common shell adapter for that helper.
The App Package skeleton and cleanup/readiness checklist are in
[`drivers/README.md`](../drivers/README.md) and
[`examples/app-package/`](../examples/app-package/). On every session start the manager
re-publishes the class's current status schema, so enabling status on an
already registered persistent runtime does not require rebuilding the runtime.

The manager is the only owner of instance state. `lifecycleMu` serializes
start/stop/attach transitions; `mu` protects snapshots and timers.
Driver-specific behavior stays in `apps/<app-id>/manifest.json` and its
package-local scripts. `configs/remotexapp-classes/` is an empty one-release
compatibility catalog.

An App Package may request named `loopback-tcp` resources. The manager fixes
the address to `127.0.0.1`, allocates and persists each port, and writes the
generic allocation to a mode-0600 `REMOTEXAPP_RESOURCES` JSON file. The public
API returns the same `resources` object but never interprets or reverse-proxies
an App protocol. Package-owned status carries protocol metadata and endpoints.

`input.lifecycle` controls which unit owns the D-Bus/IBus/Unicode engine
readiness contract. The parser default remains `server` for external
backward compatibility, but every repository production class explicitly uses
`session`. The persistent server unit is therefore a one-task readiness anchor;
the manager supplies socket/engine paths to the session driver, server
readiness does not wait for the Unicode socket, and session cleanup removes all
owned input PIDs and sockets. The default `private` mode owns a generation bus;
the trusted `user` mode reuses `/run/user/<uid>/bus` and owns only IBus and the
Unicode engine. P14 isolated and live regression cover the default topology.

P09a historically made managed persistence transition-only. The safety
reconciler still performs its X display and gateway probes, but an unchanged
healthy registration no longer creates a temporary JSON file, calls `fsync`,
or renames it. Unified manifests now own active runtime state for both managed
and anonymous instances. See
[`tests/performance/managed-persistence/README.md`](../tests/performance/managed-persistence/README.md).

P09b added `managed_observer_linux.go`. One host-wide inotify FD
observes `cgroup.events` for every managed runtime's VNC and gateway units;
empty/deleted cgroups enqueue runtime-ID-qualified reconciliation. This adds
two watch descriptors per runtime, not a process, FD or goroutine per runtime.
A five-minute +/-20% jittered full health pass covers alive-but-hung processes,
and `-managed-observer=poll` explicitly restores the old five-second fallback.
See [`tests/performance/managed-observer/README.md`](../tests/performance/managed-observer/README.md).

P10 extends that same observer to transient application-session units. A
running session adds one `cgroup.events` watch descriptor but no timer,
goroutine, process or FD; empty/deleted cgroups enqueue instance-ID and
generation-qualified session termination. `-session-observer=poll` restores
the former 500 ms readiness-PID loop. Manager restart adopts a healthy running
session and reinstalls its watch without replacing the session process. See
[`tests/performance/session-observer/README.md`](../tests/performance/session-observer/README.md).

The template/managed/runtime lifecycle contract is documented in
[template-managed-instance-design.md](template-managed-instance-design.md).
The active runtime record is shared by managed and anonymous instances; its
data model, adoption, and locked-recovery semantics are in
[runtime-manifest-design.md](runtime-manifest-design.md). Version and fault
semantics, release layout, rollout, and rollback rules are in
[driver-version-lifecycle.md](driver-version-lifecycle.md).
Application-aware stop is a two-phase driver/manager contract: the pinned
shutdown hook requests a native close, while host policy decides deadlines and
force. Clean user exit reuses `idleAction`; see
[graceful-shutdown.md](graceful-shutdown.md).

## Host service

The production installation is root-owned but the running service is not
root. `deploy/systemd/remotexapp-system.service` runs the manager as the locked
`remotexapp` account, while `deploy/systemd/remotexapp-central-user.service`
runs one manager in an approved real user's service manager. Both consume the
same immutable `/usr/local/{libexec,share}/remotexapp` installation and neither
can change Unix identity. The older `deploy/systemd/remotexapp.service` and
`~/.local` paths remain the source-checkout development installation. The
fixed display-2 desktop is managed registration `test-host-xfce`. Current
managed and anonymous runtimes both have durable active manifests. On restart,
complete healthy units are adopted before class autostart; an unhealthy runtime
without a live application is recreated from its locked manifest, not the
current catalog. A live session remains subject to graceful host policy. A managed
registration also reserves its template while desired state is
stopped, so the manager cannot create a duplicate anonymous launch.

The live topology, restart/fault evidence and rollback procedure are recorded
in [go-live-report-2026-08-27.md](go-live-report-2026-08-27.md). The subsequent
P14 input-lifecycle deployment, current hashes and its dedicated rollback
snapshot are in
[session-input-go-live-2026-08-27.md](session-input-go-live-2026-08-27.md).

## `cmd/novnc-input`

- `main.go`: flags, validation, native X11 initialization and process startup.
- `config.go`: gateway configuration.
- `model.go`: input/control protocol messages.
- `http.go`: production route registration, connection admission and health
  metrics. Historical A/B pages were removed and are not served.
- `rfb_proxy.go`: native and compatibility WebSocket-to-RFB transports.
- `input.go`: pointer, key, Unicode/IBus and focus policy.
- `uno.go`: the small allow-listed LibreOffice API, disabled unless an operator
  explicitly supplies a loopback UNO URL.
- `x11_native.go`: native Xlib/XTest input implementation.
- `clipboard.go`: bounded transient offers and the owner-only private HTTP
  service used by the Manager.
- `clipboard_x11.go`: pure-Go X11 Selection/XFixes monitoring, target
  negotiation, and normal plus `INCR` transfers.

The RFB and `/input` WebSockets intentionally share the instance gateway and
browser origin. Do not combine the manager and gateways into one global RFB
proxy: per-instance process isolation, HOME, Xauthority and IBus socket paths
are part of the security and cleanup boundary.

P13 makes text logging an operator policy. The manager's
`-gateway-text-log=errors|metadata|content` value is validated once and passed
to each gateway as `-text-log`; the default is `errors`. It is deliberately not exposed
as a template override or browser API. Normal successful requests update
atomic `textRequests`, `textErrors`, `textInputBytes` and
`textServerMicroseconds` health counters without journald writes. `metadata`
adds successful stages/timing without content, while `content` also logs typed
values and must be restricted to an authorized short diagnostic window. See
[`tests/performance/text-logging/README.md`](../tests/performance/text-logging/README.md).
This policy controls only the Go gateway journal. The Python private IBus
engine currently retains a separate content-free per-commit `engine.log`
append; do not attribute that file I/O to P13 or silently remove it without a
separate measurement.

The SDK uses the ordered `/rfb-compat` transport. Its accepted channel capacity
is 8. The RFB-to-browser side can retain at most eight copied 64-KiB target
reads (about 512 KiB); the browser-to-RFB side can retain eight WebSocket
messages whose byte sizes remain subject to the WebSocket read limit. A full
queue applies TCP/WebSocket backpressure.
RFB chunks are not independent video frames and must never be arbitrarily
dropped or replaced. The build-tagged slow-client harness, measurements and
reproduction command are in
[`tests/performance/rfb-queue/README.md`](../tests/performance/rfb-queue/README.md).

The IBus caret path uses one persistent private Unix subscription per gateway
and broadcasts ordered cursor snapshots through the existing `/input`
WebSockets. P11 keeps that subscription reader free of network I/O: every input
peer has one independent writer and a capacity-one latest-value cursor queue.
Reliable text acknowledgements/direct replies share the peer write mutex but
never enter the replaceable queue. The push protocol, browser mapping,
slow-peer measurements and fallback behavior are in
[`ime-caret-push.md`](ime-caret-push.md) and
[`tests/performance/cursor-fanout/README.md`](../tests/performance/cursor-fanout/README.md).

P14 requires the Go gateway, rather than the replaceable IBus engine process,
to own the public cursor sequence. Engine counters can restart after a session
recreation or an in-session engine switch. While a session-owned socket is
absent, the gateway retries with backoff and records one unavailable line per
outage; a successful connection resets that log gate.

RemoteXApp 0.4 adds one clipboard service per gateway. The Manager validates
the current session generation, action, media types, UTF-8, PNG bounds, body
limits, and public authorization before streaming multipart to
`clipboard.sock`. The socket must be a mode-0600 Unix socket owned by the
manager UID. Clipboard bodies never enter the RFB or `/input` WebSocket; only
ordered `clipboard-offer` metadata is broadcast there. Each peer has a bounded
reliable metadata queue and is disconnected on overflow so reconnect can
recover through `GET .../clipboard/offers`; cursor snapshots remain on their
independent lossy latest-value queue. Session generation change, session exit,
runtime stop, expiry, cancellation, or gateway loss clears transient content.
There are no App/template branches in this path.

The embedded kiosk is intentionally only an SDK host: it imports
`RemoteXAppManager` and `RemoteXAppClient` from `/sdk/index.js`. The SDK console
uses the same two public classes. Neither page creates an RFB or input
WebSocket directly; shared behavior must be added to the SDK rather than copied
into either page.

The normal SDK viewer path uses P07's bundled assets. `/sdk/index.js` is a tiny
stable loader served with `no-cache` and an ETag; it points to one hashed SDK
bundle, which lazily imports one hashed noVNC bundle. Hashed `/assets/` files
are embedded, manifest-allow-listed and served immutable for one year. The
source `/sdk/` remains for the console and integration examples. The obsolete
`/core/` and `/vendor/` filesystem routes were removed in 0.1.0-rc.1; runtime
does not require a system noVNC tree. The reviewed upstream release is vendored
under `third_party/novnc/`; only the build consumes it. `make web-assets` must
run before building/testing so the Go binary and generated URL module cannot
drift.

SDK 0.7 diagnostics are demand-driven. The kiosk enables one-second gateway
health sampling only while its diagnostics panel is visible; the console opts
in because its pane is always visible. `getDiagnostics()` is a local snapshot,
`refreshDiagnostics()` is one explicit health sample, and
`setDiagnosticsEnabled()` owns the periodic timer. Do not reintroduce a hidden
DOM renderer or an always-on health interval in an application wrapper.

SDK 0.8 owns all committed-text batching in `RemoteXAppClient`. Ordinary input
uses the configurable 16 ms default; completed composition flushes immediately
and 40 ms remains an explicit compatibility value. Pending values/timers are
cleared before channel replacement or disconnect so they cannot cross a
WebSocket generation. The kiosk and console inherit this path from the SDK;
they must not add another UI-layer debounce. Measurements and the native-IME
acceptance matrix are in
[`tests/performance/text-batching/README.md`](../tests/performance/text-batching/README.md).

SDK 0.15 owns remote-resize scheduling above noVNC. Public code exposes
`resizeDebounce`, `resizeMaxWait`, and `flushResize()`; the guarded
`assets-src/novnc-resize-bridge.mjs` adapter is the only resize path allowed to
inspect noVNC's private request, framebuffer, support, pending, and throttle
state. `make novnc-check` validates that complete private surface against the
pinned vendor source. A positive debounce keeps `scaleViewport` enabled so the
old framebuffer tracks local layout until the scheduled request completes.
Initial/reconnect negotiation bypasses the delay, and fixed template policy
never installs the bridge. P15's deterministic and real-stack evidence is in
[`tests/performance/resize-debounce/README.md`](../tests/performance/resize-debounce/README.md).

## Verification

Fast checks:

```bash
make backend-test
make backend-build
```

These commands require Node and `esbuild` at build time. `make novnc-check`
validates the vendored release metadata and RemoteXApp's private keyboard
compatibility surface before bundling. The resulting `remotexappd` binary
embeds the generated browser assets; it does not invoke a JavaScript build tool
at runtime. P07 reproduction
and exact cache/load measurements are in
[`tests/performance/assets-bundle/README.md`](../tests/performance/assets-bundle/README.md).

This builds `remotexappd`, the per-instance `novnc-input` gateway, and the
`remotexapp-status` helper used by status-enabled application drivers. The
status lifecycle and API contract are documented in
[`application-status.md`](application-status.md).

Concurrency-sensitive Go checks:

```bash
make backend-test-race
```

Live verification must additionally cover class discovery, multiple dynamic
Mousepad instances, an RFB connection, Unicode input, client resize, gateway
restart/reconnection, and five-second Mousepad vacancy cleanup. It requires the
user systemd bus, TigerVNC, X11, IBus and a browser; unit tests do not pretend to
replace those dependencies.

Session-observer changes must also cover normal and abnormal application exit,
late-generation suppression, managed/anonymous restart adoption and locked
recovery, Full XFCE
session exit and the explicit `-session-observer=poll` branch.

Direct-launcher changes must additionally verify Xauthority mode/access,
normal four-unit cleanup, scoped `Xtigervnc` failure propagation, and the
wrapper compatibility branch. The manager now observes managed VNC/gateway
process-tree exits and all running session-unit exits through cgroup events.
Unmanaged VNC/gateway crash-time API state can still remain stale until an
explicit lifecycle action; cgroup exit events also do not prove that a
still-populated process tree is responsive.

Changes to RFB queueing must also run the P05 slow-client harness in separate
processes and preserve pointer, English/Chinese switching, first post-switch
input, shortcuts, resize and reconnect behavior.

Changes to text capture or batching must run the P12 deterministic harness and
SDK tests, then verify a real browser/application with English -> Chinese ->
English and the reverse direction, each first post-switch character, rapid
ordinary input, IME commit/cancel, shortcuts, pointer, resize and reconnect.
Synthetic `CompositionEvent` coverage does not replace a native operating-
system IME check.

Changes to native IME anchoring must additionally cover primary mouse, touch,
and pen; right/middle/non-primary exclusion; a caret arriving after the 750 ms
fallback window; and no blur/refocus during composition or queued/in-flight
text. Changes to resize scheduling must cover zero compatibility, trailing
coalescing, finite maximum-wait progress, explicit flush, local scaling,
in-flight latest-size retention, fixed policy, reconnect, and disposal. Both
paths require a real browser/noVNC/TigerVNC application test; native candidate
placement still requires human UAT.

Changes to text observability must preserve ACK errors and failure logs, prove
that default/metadata modes do not include input content, validate health
counters under concurrent requests, and repeat the P13 journal/syscall plus
native-IME regression. Do not use `content` mode for a normal benchmark or
production session containing real user data.

The common X11 server driver waits for the private `ibus.sock` before starting
the custom Unicode engine. This gate is required when a short-lived display is
destroyed and immediately reused; process creation alone does not mean the new
IBus daemon is ready to accept its engine connection.
