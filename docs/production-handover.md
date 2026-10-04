# Production handover

This guide describes the current architecture and the checks needed to change
it safely. Source versions come from [current-state.md](current-state.md).
Historical measurements below are scoped experiments, not the identity or
health of a live installation. Private deployment diaries remain outside this
public guide.

## Architecture and ownership

RemoteXApp manages Linux X11 applications through four boundaries:

1. `remotexappd` validates the App catalog, allocates displays and ports, exposes
   authenticated APIs, and persists generation-qualified runtime state.
2. TigerVNC supplies the X11 display and RFB transport; `novnc-input` supplies
   the browser WebSocket gateway and native input/clipboard bridge.
3. The pinned Core session supervisor owns generation-local D-Bus/IBus/Unicode
   services. A user-home session borrows the account bus and never stops it.
4. Versioned App Packages own application launch, readiness, actions and
   shutdown; the served SDK embeds one Viewer per client and optionally
   coordinates runtime observation and keepalive interests.

Read [backend structure](backend-structure.md), [runtime manifests](runtime-manifest-design.md)
and [session services](session-services-release.md) before changing lifecycle.
Read [SDK behavior](browser-sdk.md) and [noVNC ownership](novnc-upstream.md)
before changing browser input or transport.

## Invariants

- Run the Manager and all owned Apps as one selected non-root UID. Use separate
  UIDs or containers for mutually untrusted tenants; HOME/profile separation
  alone does not isolate processes or files.
- Keep VNC and application-control endpoints host-local. Expose the Manager
  through authenticated TLS and validate trusted-proxy identity and origins.
- A Manager restart adopts compatible pinned runtimes. It is not an App or
  runtime upgrade. Explicit upgrades fence the current generation, preserve
  launch intent and apply shutdown policy before replacing components.
- Ordinary ASCII keys and shortcuts use RFB. IME composition and committed
  non-ASCII text use IBus. Text injection does not change the clipboard and is
  not a substitute for raw keys in controls without an input context.
- Session-owned input services are created and cleaned with the session, not
  the persistent display. Never terminate a borrowed account bus.
- RFB bytes and text acknowledgements are ordered, reliable traffic. Cursor
  snapshots may coalesce to the newest value; do not apply that policy to RFB.
- Keep normal text logging at `errors`. Content logging requires a short,
  explicitly authorized diagnostic window and private evidence handling.
- A dead session leader does not prove its surviving children are disposable.
  Preserve populated components for review; bounded on-attach recovery applies
  only to a confirmed inactive component.
- Publisher and deployment owner have separate responsibilities. This project
  develops, tests and publishes immutable artifacts; the target's owner
  installs, activates, restarts and records its own deployment evidence.

## Deployment and change verification

Use [dependencies](dependencies.md) and [operations](operations.md) for host
preparation. Systemd is the default backend. [Standalone/runit](standalone-runit-release.md)
requires explicit selection and a verified delegated cgroup v2 subtree for the
selected UID. Preflight is not proof that host reboot persistence was tested.

Before a change, read its requirement, accepted design and applicable measured
experiment. Add focused regression coverage, update the change records and run
`make check`. For a release, follow the [build-once process](release-process.md)
and exercise the downloaded candidate on a disposable target-like host.

Functional acceptance requires a real served Viewer: visible App readiness,
ASCII/raw shortcuts, committed Unicode and native IME switching, pointer,
clipboard readback, resize policy, reconnect, normal exit/logout, vacancy,
Manager adoption and applicable upgrade/rollback. `/healthz` alone is not App
acceptance. Fault injection owns only disposable accounts and runtimes.

See [validation harnesses](../tests/go-live-validation/README.md),
[session fault matrix](../tests/session-services/README.md) and
[test tiers](development-quality-process.md). Live checks depend on the
provisioned host, account services, real Apps and a browser. Record skipped
checks and separate automated evidence from human UAT.

## Measured engineering decisions

The following dated results retain their original experiment scope. “Live” in
an older result describes its historical acceptance, not a current deployment.
The authoritative register, result files and reproduction instructions are in
[performance experiments](performance-experiments.md) and the linked READMEs.

| Experiment | Measured result | Historical acceptance |
|---|---|---|
| P01 lean IBus | Mousepad end-to-end input and caret push passed; server layer fell from about 101 MiB to about 62 MiB | Live in common and Full XFCE server drivers |
| P02 opt-in input tracing | Input regression passed; 27 text commits and zero `client event:` journal entries; about 98 trace bytes avoided per synthetic event | Live in SDK 0.8 with tracing off by default |
| P03 no Clipman | Disposable Mousepad input and in-app clipboard passed; steady server layer about 39.5 MiB | Live for disposable single-app classes |
| P03b XFCE session Clipman | Three generations passed exactly-one ownership, cleanup, input, clipboard and reconnect | Accepted with adaptive panel/fallback ownership and exactly-one readiness |
| P04 display depth | Generic depth 16 used 4.52 MiB less memory; depth 24 required 71.5% more VNC CPU per scroll operation | Generic class default remains 16; WeChat remains 24 because depth 16 is visually incorrect for that app |
| P05 RFB relay queue | Capacity 8 cut measured slow-client heap growth from 16.18 MiB to 0.68 MiB; all interactive input/reconnect checks passed | Live; queue capacity 8 |
| P06 demand diagnostics | Hidden 5.2-second samples produced zero health requests, diagnostic events and DOM mutations; all input/toggle checks passed | Live; kiosk polls only while visible and console explicitly opts in |
| P07 bundled browser assets | Static requests fell 45 -> 3; cold transfer fell 551,233 -> 181,399 B; Unicode/readback and explicit reconnect passed | Live; matched post-live load was 3 requests/182,088 B |
| P08 direct Xtigervnc | Lean server layer fell 42,831,872 -> 32,141,312 B; failure propagation, wrapper fallback and interactive regression passed | Live with `direct`; `wrapper` remains explicit fallback |
| P09a managed persistence | Four healthy passes fell from four `fsync`/renames to zero; transitions, restart adoption, fault recovery and Unicode reconnect passed | Supported; the fixed XFCE uses the unified anonymous manifest path |
| P09b managed observation | 30-second `xdpyinfo`/health calls fell 6/6 -> 0/0; gateway/VNC recovery, restart adoption and interactive input passed | Live with cgroup events and 4-6 minute safety pass |
| P10 session observation | Per-session 30-second PID reads/`kill(0)` fell 60/60 -> 0/0; temp, managed/restart, fallback, Full XFCE and exact browser checks passed | Live with shared cgroup observer; `poll` remains fallback |
| P11 cursor fan-out | A 10 ms slow peer no longer delayed the publisher/fast peer by about 324 ms; newest snapshots coalesce at about 3.19 KiB per connected input peer | Live in current `novnc-input` |
| P12 text batching | Single ordinary timer latency fell 40.490 -> 16.278 ms and completed composition 40.307 ms -> 8.5 us; a five-event/10 ms burst remained one commit and native-IME regression passed | Live in SDK 0.8; `textBatchDelay:40` remains compatibility mode |
| P13 text logging | A 600-request run fell from 2,400 success lines/135,947 B to zero and removed 29.6% of gateway write syscalls; ACK latency was unchanged and native-IME regression passed | Live with default `errors` |
| P14 session-owned input stack | Live vacant server unit fell from 16,887,808 B/18 tasks to 212,992 B/1 task; isolated and production XFCE/Mousepad/Edge passed Unicode, clipboard, resize/reconnect and exact cleanup | Live for all repository classes; see the dated result |
| P15 remote resize scheduling | A 300 ms trailing run held `1000x613` through four viewport changes while scaling locally, then reached only `1100x740`; finite 400 ms max-wait advanced at 440.20 ms, flush and reconnect passed | Live in SDK 0.15; isolated E2E and human native-IME/resize UAT accepted 2026-08-29 |
| P16 Core-owned input services | Matched median launch/restart +530/+543 ms, memory +4.18 MiB, one extra supervisor, unchanged service counts and bounded cleanup | [Measured gates passed](../tests/performance/core-session-services/README.md); Core 0.12 candidate, human UAT separate |

For RFB queue changes repeat [P05](../tests/performance/rfb-queue/README.md).
For cursor fan-out changes repeat [P11](../tests/performance/cursor-fanout/README.md).
For batching/input changes repeat [P12](../tests/performance/text-batching/README.md)
and the real native-IME matrix. For performance changes update the experiment
README, result JSON and register, then run `make performance-docs-check`.
