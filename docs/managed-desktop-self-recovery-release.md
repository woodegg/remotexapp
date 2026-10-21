# Core 0.15.0: managed desktop self-recovery

Scope selected 2026-10-21. Status: design and acceptance preparation; runtime
implementation, qualification, human UAT and publication are pending.
[Implementation Issue #2](https://github.com/woodegg/remotexapp/issues/2)
owns work progress; [release Issue #3](https://github.com/woodegg/remotexapp/issues/3)
owns candidate/UAT/publication gates under
[Milestone 0.15.0](https://github.com/woodegg/remotexapp/milestone/1).

## Problem and intended behavior

A desired-running managed user-home desktop can remain failed indefinitely.
Managed reconciliation currently returns early for a failed session. Existing
bounded recovery depends on Viewer attachment; reboot policy excludes sessions
already marked failed. Routine process loss therefore becomes operator work.

Recover verified inactive failed sessions in the background. Preserve runtime
ID, persistent HOME, parameters, locked App/Core versions and monotonic session
generations. Reboot must trigger a new safety assessment, rather than preserving
an otherwise recoverable failure forever. Keep unknown/live processes intact.
Only managed user-home desktops are in this train; anonymous Apps retain their
existing lifecycle. Normal logout/vacancy stop-session remains on-attach and
must not be turned into automatic background relaunch.

## Recovery classification and persisted state

Classify failure from typed lifecycle outcomes and verified resources, not
localized error-string matching. Expose an additive recovery projection with
phase, reason code, bounded message, attempts, next attempt and last success.
Keep the existing session lifecycle state authoritative while recovery waits.

| Classification | Action |
|---|---|
| Failed session; component confirmed empty; retained display/runtime healthy | Schedule session-only relaunch on locked resources. Viewer presence alone is not a permanent recovery veto; fence stale channels before replacing a generation. |
| Verified changed boot; desired-running failed managed desktop; no live application; trusted identity and frozen resources valid | Enter the existing durable pinned-runtime recreation transaction. Preserve ID/HOME; honor on-attach App activation after restoring the server. |
| Live/unknown session component, unreadable ownership or foreign display/port | Preserve resources, expose a blocked reason, and re-evaluate on relevant events and bounded probes. Never kill an unknown process to clear a label. |
| Explicit stopped intent, clean logout/vacancy, shutdown veto or unfinished upgrade | Preserve the existing operation and policy; background recovery cannot override it. |
| Invalid/tampered package, permission or storage failure | Expose the actionable error, back off and revalidate; do not bypass identity checks or substitute another version. |

Persist recovery intent before cleanup or launch. Bind attempts and scheduled
work to runtime identity and generation; maintain one authoritative recovery
record rather than an independent managed registration copy. Select the
compatible manifest/sidecar format during implementation, explicitly verify
strict decoding, migration and rollback, and never silently reset the budget on
Manager restart or reboot. Missing/untrusted old boot evidence is not proof
that replacing old resources is safe.

## Scheduling and retry policy

Use one Manager-owned deadline scheduler alongside the existing event queues
and safety sweep. Do not create a permanent polling goroutine per runtime or
hold the managed registry lock across recursive lifecycle operations.
Session-exit, Viewer attach, boot restore and manual retry enter the same
serialized, generation-fenced helper; only one transition may win.

The proposed initial policy is three rapid retries after 5, 15 and 60 seconds,
then a ten-minute cooldown and a bounded probe before another burst. Reset
failure history only after ten minutes of verified healthy session operation.
Persist the deadline and budget. Handle clock rollback/large forward jumps,
restart storms and simultaneous fleet wakeup with bounded scheduling/jitter.
A retry blocked by preserved processes must not count as a launch attempt.
Finalize numeric defaults with fault tests before implementation acceptance.

Provide a generation-guarded manual retry for re-evaluation without automatic
force or budget reset. Existing explicit restart remains the separate path
for confirmed teardown; a shutdown veto cannot inherit consent from a retry.
Surface the recovery phase, next attempt and blocked reason in the Console.
New fields must be additive for existing clients; an SDK version change, if
needed for a new public method, must be reviewed and recorded separately.

## Implementation slices

1. Add typed eligibility/classification and durable recovery records with
   compatibility/permission/atomic-write tests. Centralize existing attach
   eligibility without changing protected-process behavior.
2. Add background deadlines, lifecycle serialization, attempt persistence and
   health reset; connect session and managed events without depending on Viewer.
3. Extend trusted cross-boot recovery to eligible failed managed desktops and
   qualify both lifecycle backends with ownership and interrupted-operation guards.
4. Expose additive operator diagnostics and guarded retry, update SDK/types only
   if necessary, and qualify the real served Console/Viewer paths.
5. Run candidate gates and fault matrix, install the exact candidate for local
   UAT, then record immutable publication and downstream handoff separately.

Each slice uses a linked PR. A design-only PR references #2 without closing it.
Keep VERSION at its current source identity until release preparation; this
plan does not ship Core 0.15.0 or change the existing 0.14.5 qualification scope.

## Required acceptance matrix

| Scenario | Required outcome |
|---|---|
| Session leader exits and component is empty; no Viewer | Background restart produces one new session generation on retained healthy resources. |
| Same failure with stale/attached Viewers | Old channels are fenced; no duplicate launch, stale input or permanent attached-client deadlock. |
| Leader exits with surviving editor/helper | No automatic process termination or duplicate desktop; explicit blocked reason. Emptying the component later triggers safe re-evaluation. |
| Repeated launch failure and unstable health | Observable backoff/cooldown, bounded rate, no reset via reconnect or Manager restart; sustained health resets budget. |
| Interrupted persistence/cleanup/launch and concurrent triggers | Durable intent, monotonic generations, single ownership; rejected writes cannot launch an unrecorded attempt. |
| Verified cross-boot from failed session | Eligible desired-running desktop recreates pinned resources; existing identity/HOME persist. |
| Missing/malformed boot evidence, foreign resource or live application | Fail closed with useful diagnostics; no takeover or unsafe cleanup. |
| Explicit stopped intent, normal logout, vacancy, blocked shutdown and pending upgrade | Existing user intent and lifecycle boundaries remain in force. |
| Clock changes, Manager restart and repeated reboot | Bounded persisted scheduling; no duplicate runtime or rapid budget reset. |
| Systemd and standalone | Equivalent ownership, session-only recovery and generation safety; no borrowed account bus termination. |
| Served Viewer/Console | Launch, raw keys, IME, clipboard, resize/reconnect, recovery diagnostics and guarded retry work on the exact candidate. |
| Actual test-host reboot | Record real reboot separately from boot-marker simulations; unexecuted reboot cases cannot be claimed as accepted. |

## Compatibility, rollback and ownership

Before introducing durable fields, document whether the previous Core can read
new records. If it cannot, rollback requires the current Manager's scoped stop
and the pre-upgrade state snapshot. Preserve immutable prior archives; never
claim that runtime replacement restores lost process memory or unsaved data.

This repository develops, tests on disposable/project-owned environments and
publishes releases. Target projects own deployment, incident recovery, restarts
and runtime replacement. No live-host operation is authorized by this design.
Historical [bounded recovery](managed-session-recovery-release.md), RTM-020–022
and BR-003 remain the implemented baseline until reviewed implementation lands;
new MSR requirements describe the selected replacement scope without rewriting
those accepted historical decisions.
