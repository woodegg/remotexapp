# Fault injection and recovery acceptance

The 2026-11-20 local run for [#65](https://github.com/woodegg/remotexapp/issues/65)
and [#66](https://github.com/woodegg/remotexapp/pull/66) distinguishes automatic
recovery from preserved/degraded operation and operator recovery. See the
[local qualification record](LOCAL-E2E-20261120.md) for artifact identity,
completed gates and limits. Passing a preservation test does not establish
automatic repair of the failed component.

The later [SDK 0.31.1 lease-recovery qualification](../kasm-native/LEASE-RECOVERY-20261120.md)
closes the demonstrated lease-renewal gap for reconnect-enabled host Viewers on
its separately identified artifact. It does not relabel the earlier failed run
or the remaining preservation/manual-repair cases as automatic recovery passes.

Every injection must target a recorded process identity, an owned fixture or
an explicitly disposable account. Recovery checks include real frames or
saved-file/input readback, process/generation identity, cleanup and protection
of a second runtime. A healthy HTTP endpoint alone is insufficient.

## Fault classes and required outcomes

| Fault injection | Expected recovery or protection | Evidence surface |
| --- | --- | --- |
| One failed session-unit query while the App is live | Preserve the original running generation; continue observing; Manager adoption retains the same desktop | Live TigerVNC and Kasm managed desktops, complete frames before/after query fault and Manager restart |
| Unit-query timeout, unreadable/malformed process observation, unavailable readiness marker | Treat uncertainty as uncertainty; do not retire a live or unverified App; recover observation when evidence returns | Focused Go tests; standalone readiness-marker experiment |
| PID reuse, wrong UID/cgroup, changed canonical identity, delayed exit event | Reject stale identity and recheck under the lifecycle lock; never adopt or signal a recycled/foreign PID | Focused Go liveness/event/restoration tests |
| Manager TERM/KILL during a healthy session | Deployment supervision restarts the Manager; compatible Apps keep their processes, pins and generation; Viewers reconnect | Seven-App matrix, native lifecycle, deployed-service checks and automatic systemd recovery probe |
| Browser network outage or broken control connection | Leave ready state, retry within the configured budget, reconnect on return and redraw; do not replay input/actions | SDK 0.31.0 lease-outage probe failed; the linked SDK 0.31.1 run passes network/503/timeout recovery and verifies terminal denials/cancellation/exhaustion |
| Retired/expired Viewer grant, authorization loss | Close the affected control/display channels and retire consent; authentication failure must not be bypassed by retry | Native grant/wire/SDK tests; generation replacement in live lifecycle suite |
| Empty failed managed desktop | Recreate in the background with the same identity/profile/pins and a new generation; old Viewer operations remain fenced | Live managed recovery after confirmed emptiness, with and without a Viewer |
| Failed desktop with a surviving editor or uncertain component ownership | Block destructive replacement; explain the reason; re-evaluate when the component becomes empty | Native lifecycle survivor injection and Go recovery ownership tests |
| Supervisor KILL in a user-home session, including while Manager is offline | `ExitType=cgroup` preserves the canonical desktop; adopt it without secretly replacing helpers; expose unavailable IBus truthfully; explicit stop cleans owned processes | Dedicated supervisor-preservation matrix, complete raw frames and API checks |
| Supervisor/private session-bus KILL in an isolated App | Observe actual App exit or degraded state; clean owned resources and retain failure history; never silently recreate an unmanaged failed App | Seven-App main/interaction matrices and session-service E2E |
| IBus/Unicode engine KILL | Preserve the App and unrelated runtime; reject unavailable Unicode operations; retain usable raw input/clipboard; explicit restart restores services | Main/interaction matrices and deployed legacy Viewer checks |
| Disposable account bus STOP/CONT | Never kill/replace the borrowed bus; retain generation; report private input-service loss; explicit restart restores the affected session | Borrowed-bus live matrix |
| Gateway KILL with a live App | Preserve App processes and generation during degraded transport; explicit restart restores the gateway and clipboard | Seven-App transport and managed transport matrices |
| VNC KILL | Retire stale connections and clean the exited session; obey managed intent and generation fencing; do not claim unsaved data survives display-server death | Transport matrices and native lifecycle/reboot checks |
| UDP disabled or endpoint pool exhausted | Other Viewers remain independent; use a working WebSocket path when UDP is unavailable; explicit unsupported capability is truthful | Local three-Viewer/two-App UDP experiment |
| Actual container reboot | Restore desired-running managed Apps with locked pins and saved HOME data; explicit stopped intent stays stopped; old generations are refused | Two native container reboots; legacy boot/storage gate |
| Manager crash during start/restart/upgrade, concurrent restart/upgrade requests | Resume the recorded transaction or original startup; one owner/generation transition; no duplicated processes or deadline reset | Seven-App main matrix and Go crash/concurrency tests |
| Shutdown hook refuses, hangs or fails; Manager crashes while blocked | Preserve Apps during grace; retain the original host-policy deadline; if force was configured, finish bounded forced teardown after the unchanged deadline | Shutdown-outcome matrix; separate live veto fixture with no implicit force |
| Missing/offline document root, non-directory root, symlink/parent escape | Keep unrelated HTTP/Apps available; fail document access closed; restored storage becomes usable without a Manager restart | Exact-archive boot/storage and native document-root rejection gates |
| Retry budget exhausted, explicit stop, stale generation, persisted historical failure | Preserve these guards across restart; no infinite retry storm, stop reversal, silent history clearing or unrequested replacement | Go recovery/SDK tests and live stop/reboot/stale-request checks |

## Automatic-repair gaps

The current contracts are **not universal self-healing**:

- In the earlier SDK 0.31.0 artifact, a network failure during native Viewer lease renewal closes the display with
  `grant-expired` and does not automatically reconnect when the network returns.
  The current catch handles transport failure the same way as authorization
  rejection, even before the 90-second grant expiry. This is a demonstrated
  automatic-recovery failure, not a passing authorization-boundary test.
  Tracked in [#68](https://github.com/woodegg/remotexapp/issues/68); the later
  [SDK 0.31.1 experiment](../kasm-native/LEASE-RECOVERY-20261120.md) demonstrates
  bounded fresh-grant recovery when the caller enables reconnect. Direct native
  clients still default to reconnect disabled. Other gaps below remain open.
- Input helper or borrowed-bus failures can require an explicit App restart.
  Rebuilding those services in place without losing the desktop needs a separate
  design and live verification of existing GTK/Qt input connections. A raw-key
  fallback or a surviving desktop is not proof that Unicode input recovered.
- A live App with a dead gateway is preserved, but automatic gateway replacement
  is not established by the current explicit-restart transport tests.
- A historical persisted failure is not silently relabeled healthy just because
  a later process observation is positive. Recovery still needs verified intent
  and ownership; the observation fix prevents new false terminal transitions.
- Authorization loss, retry exhaustion and an App veto are intentional recovery
  boundaries. Automatic recovery must not override them to obtain a green test.

Do not mark these rows automatically repaired unless an injection demonstrates
recovery without an operator restart/reconnect, and verifies fresh input and
unchanged saved data afterward.

## Additional qualification still needed

The local run does not certify every possible system fault. Live disk-full/
read-only-state-filesystem tests, constrained-cgroup OOM/CPU starvation, sustained
packet loss/reordering/MTU changes, WAN/NAT/TLS/Access failures, additional browser
and physical IME/device matrices, and a new long-duration soak remain separate
experiments. Portable negative tests or earlier PoC results must not be presented
as live qualification of this artifact for those cases.

For those experiments use bounded fixture storage/cgroups/network rules, retain
the failed attempts, remove only the injected restriction, and verify automatic
recovery before issuing any manual repair. Record detection time, recovery time,
retry count, old/new generation, process identity, frame/input/file readback,
cross-runtime isolation and cleanup. Keep raw network and process evidence private.
