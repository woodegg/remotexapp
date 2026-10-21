# Core 0.15.0: managed desktop self-recovery

Scope selected 2026-10-21. Status: implementation in progress. Slices #9/#11 implement durable same-boot
empty-session recovery; attached-Viewer fencing, cross-boot recreation, operator
UI, candidate qualification, human UAT and publication remain pending.
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
record rather than an independent managed registration copy. Extended recovery
metadata will live in a schema-3 runtime manifest, not a second sidecar ledger.
The loader must strictly read both schema 2 and 3; migrate an eligible managed
record only when extended recovery is enabled and its initial intent is
committed. Other records remain schema 2. Schema 3 adds one root recovery record
bound to runtime ID/generation, containing phase, reason, attempts, updatedAt,
nextAttemptAt and healthySince. Legacy sessionRecovery counters are imported
conservatively and then serve only as a compatibility projection, never as a
second scheduler budget. Unknown fields/versions still fail closed.

Older Core versions cannot read schema 3. Rollback must stop affected runtimes
with the current Manager and recreate them from preserved intent/HOME on the
older release, or restore the pre-upgrade state snapshot. Do not rewrite a live
schema-3 record to look compatible. The first implementation slice keeps schema
2 and its existing counter format: it fixes admission classification and
persist-before-cleanup ordering without introducing the new scheduler format.
Missing/untrusted old boot evidence is not proof that replacing old resources
is safe.

## Scheduling and retry policy

Use one Manager-owned deadline scheduler alongside the existing event queues
and safety sweep. Do not create a permanent polling goroutine per runtime or
hold the managed registry lock across recursive lifecycle operations.
Session-exit, Viewer attach, boot restore and manual retry enter the same
serialized, generation-fenced helper; only one transition may win.

The retry defaults are delays of 5, 15 and 60 seconds, each measured from
completion of the preceding failed attempt (the first from failure detection).
After the third failed attempt, wait ten minutes and allow one probe. Every
failed cooldown probe waits another ten minutes; it does not open a new rapid
burst. Blocked eligibility checks consume no attempt. An admitted attempt is
charged when its intent is durably committed, before cleanup; cleanup failure
therefore counts and cannot create an unbounded cleanup loop.

Reset the budget only after ten minutes of continuous observed session health:
same-generation canonical readiness identity, App readiness, required session
services and retained display/gateway health. Any observed failure invalidates
healthySince; after a Manager restart, begin a new health-confirmation interval.
Keep the attempt budget across Manager restart and reboot. If wall time moves
backwards, persist one re-anchored delay/cooldown from current time without
resetting attempts; a large forward jump may release at most one due attempt,
not replay missed deadlines. On startup, conservatively clamp an implausible
future deadline to one full delay/cooldown from now and persist that correction
before action. Bounded positive jitter may delay, never advance, an attempt.

Provide a generation-guarded manual retry for re-evaluation without automatic
force or budget reset. Existing explicit restart remains the separate path
for confirmed teardown; a shutdown veto cannot inherit consent from a retry.
Surface the recovery phase, next attempt and blocked reason in the Console.
New fields must be additive for existing clients; an SDK version change, if
needed for a new public method, must be reviewed and recorded separately.

## Transaction, Viewer and lock boundaries

Admission snapshots runtime ID, session generation, desired state and operation
state under the lifecycle lock. Persist the charged recovery intent before
stopping components, deleting IPC or starting a new process. A write failure
must leave old resources untouched. Revalidate identity/generation and protected
process evidence before cleanup. Persist each subsequent phase before the
next resource mutation; a schema-3 restart resumes the recorded phase instead
of charging another attempt. Cleanup and launch are idempotent and generation
fenced. Never hide a failed cleanup by clearing the failure label.

For the first legacy-format slice, persist the existing attempt counter while
retaining failed state, then clean, then persist stopped state before normal
startup. A crash may consume an attempt but cannot authorize an unrecorded
cleanup or silently refund the budget. Session-only recovery preserves runtime
ID and Core/App pins. This limited transaction is not background recovery.

Before automatic replacement with attached Viewers is enabled, track connection
ownership by runtime ID and generation. Close old-generation RFB/input channels
and invalidate descriptors/offers before activating replacement input. A late
detach must not decrement the new generation's client count. The first slice
retains the current attached-client block until those fencing tests exist.

Keep lock order lifecycleMu, then short-lived managedMu/mu snapshots; release
registry locks before helper calls that can acquire them again or perform host
I/O. The scheduler never holds its queue lock while entering lifecycle work.
Preserve existing bounded host-operation timeouts and test stop/attach/recovery
interleavings. Do not add another global lock or recursive reconciliation path.

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
Design-only work keeps VERSION unchanged; runtime implementation uses the
separate 0.15.0-dev.1 development identity. No stable Core 0.15.0 publication or
renewed 0.14.5 acceptance is implied.

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

Schema-3 records require the explicit stop/recreate or state-snapshot rollback
procedure above; schema-2 first-slice records retain their existing format. Preserve immutable prior archives; never
claim that runtime replacement restores lost process memory or unsaved data.

This repository develops, tests on disposable/project-owned environments and
publishes releases. Target projects own deployment, incident recovery, restarts
and runtime replacement. No live-host operation is authorized by this design.
Historical [bounded recovery](managed-session-recovery-release.md), RTM-020–022
and BR-003 remain the implemented baseline until reviewed implementation lands;
new MSR requirements describe the selected replacement scope without rewriting
those accepted historical decisions.

## Incident reproduction dependency

The deployment-owning project must supply a redacted failure classification
from the affected environment: Manager version, runtime Core/App pins, desired
and session state, generation, structured failure evidence, session population,
and display/gateway health. No live incident has been diagnosed by this plan.
Add a deterministic regression for that observed class when evidence arrives;
generic matrix coverage must not be presented as proof of that incident's fix.

## First implementation slice: Issue #9

Typed admission and schema-2 attempt persistence now precede on-attach cleanup.
A failed intent write preserves old IPC and generation. Failed cleanup retains
the charged counter and failed state; a failed stopped-state write prevents
replacement startup and does not refund the attempt. Existing three-attempt /
ten-minute limits, process preservation and attached-client guard remain.
This slice introduces no scheduler, schema-3 migration, boot-policy change or
new public API. Contract tests cover the persistence/cleanup boundary with
local service doubles; they are not real-host recovery or UAT evidence.

## Second implementation slice: Issue #11

A single Manager deadline loop schedules failed managed user-home recovery
without requiring a Viewer. Only statically eligible failed/bound registrations
migrate from schema 2 to a root schema-3 recovery record. Other records remain
schema 2. The old sessionRecovery JSON is a capped compatibility projection;
only the schema-3 root controls attempts/deadlines. Attach cannot bypass it.

The controller checks trusted same-boot identity, recorded component ownership,
empty session, no attached Viewers, locked package/Core identity and retained
runtime health before cleanup. Uncertain processes, changed/untrusted boot,
unresolved operations and unhealthy resources block rather than force teardown.
Blocked checks use bounded probes without consuming attempts. A charged cleanup
blocked after a Manager interruption retains its phase/budget until safe resume.
An ambiguous launch is adopted if running, otherwise accounted as interrupted
and backed off; it is never blindly replayed. Storage errors have a bounded
in-memory retry floor and cannot authorize resource mutation.

Health confirmation checks same-generation readiness and required services at
bounded intervals. A Manager restart or observation gap invalidates continuity;
only ten minutes of observed health clears the budget. Positive deterministic
jitter never shortens 5/15/60-second delays or ten-minute cooldown probes.
Cross-boot reconstruction, generation-qualified Viewer fencing, public recovery
controls and exact-candidate/human UAT are separate gates. Rollback from schema 3
requires the explicitly documented stop/recreate or state-snapshot procedure.

Development validation on 2026-10-21 exercised the shipped XFCE driver with a
disposable locked UID and relocated display: an empty failed session recovered
without a Viewer, its counter survived Manager restart, and a second leader
loss recovered with the next charged attempt. Existing desktop services were
not operated. This used a dirty development build based on commit 3fcb0982e89f,
not an immutable candidate; it establishes neither cross-boot recovery nor UAT.

## Third implementation slice: Issue #13

Verified changed-boot failed managed user-home records enter the same deadline
controller. Source boot identity is retained in the private schema-3 authority
through interrupted cleanup, so removing a runtime directory cannot erase the
transaction proof. Deadlines and attempts survive another Manager/host restart.
Charge and persist a recreating phase before resource mutation; preserve the
charge across an interrupted phase and advance the generation for recreation.
Creation carries the recovery authority into every new manifest, including
failed creation. A healthy completed result is adopted instead of replayed.

Live/unknown session and server components, occupied listeners, unresolved
shutdown/upgrade, stop intent and unverified frozen content block recreation.
The existing ownership-checked X11 cleanup and pinned-allocation validation
remain in force. Successful on-attach recreation restores the server without
automatically launching the App. Anonymous boot policy is unchanged.
Simulated boot/crash tests are development evidence; actual reboot qualification
and both-backend candidate evidence remain separate release gates.
