# Native integration self-recovery implementation and qualification

Selected by the owner on 2026-11-28 in
[Issue #119](https://github.com/woodegg/remotexapp/issues/119), including the
clipboard repair in [#117](https://github.com/woodegg/remotexapp/issues/117).
The objective is one complete UAT after systematic repair and production-quality
qualification, not separate acceptance of small implementation checkpoints.
PR #118 now carries this implementation, superseding its initial test-only scope.
This document is an implementation target and gate list, not a claim of passage.

Development checkpoint: SDK 0.38 / Worker 7 now connects the intent journal to
the audio owner/coordinator. Integrated module models cover rebind with a live
source, ended-source reacquisition, permission revoke/grant, late-result/off,
cross-document off/on, domain recovery with a healthy peer and access/identity
fences. Writer reservation precedes device acquisition; processor delivery ACK
precedes effective mic and PCM. These are model results, not real browser
qualification of the new state machine. Repeated silent Worker exits and the
remaining fault/resource gates are still open; do not start final qualification
on an unfinished state machine.

## Contract

The live client sets requested speaker/microphone/connection intent. SDK and
server reconcile effective state, fresh grants, transport, processors and capture.
The host displays requested, recovering, active, blocked and retired states; it
does not resend enable on every reconnect or maintain its own recovery loop.

Service/transport/Worker replacement must not permanently discard a still-valid
request. Separate capture-source lifetime from transport lifetime. Prefer
retaining a valid live track through an interruption, disabling delivery and,
where appropriate, the track while offline. Do not stop a valid source solely
because a connection epoch changed or a twelve-second timer expired. A real
capture end retires the old device/frames, not the user's request. Automatic
reacquisition is permitted only for a live, unreleased authorized owner whose
current request is still enabled, with current browser microphone permission
`granted` and fresh current-runtime route authorization. Recovery must not open
a permission prompt, take over another writer, switch accounts or send buffered
old PCM. Browser inability to prove permission is an honest blocked condition.

This supersedes the unconditional "recovery never calls getUserMedia" rule and
the requirement for another click after every ended capture in the
[0.17.5 recovery contract](integration-intent-recovery.md). It does not change
explicit off/logout/dispose, identity fencing or old-generation retirement.
Initial use still follows the browser's permission and playback policies.

The [Media Capture specification](https://www.w3.org/TR/mediacapture-streams/#permissions)
states that granted permission avoids a permission prompt but does not guarantee
device acquisition. Device and context failures therefore need bounded recovery
and cancellation, not permission assumptions or a blind repeated enable call.

## Ownership and ordering

- Keep the Worker as the shared audio route coordinator. One eligible capture
  feeds only explicitly selected targets. A domain failure does not reset other
  healthy routes, and display reconnection does not reset healthy audio.
- Give each live SDK audio owner an ephemeral identifier, including independent
  owners within one document. Shared intent metadata
  orders explicit on/off operations across documents and Worker incarnations;
  it never contains content, grants, device identifiers or persisted permission.
  A bounded origin-storage journal under Web Locks records per-runtime-generation
  switch epochs and participating live owner identifiers. Explicit off invalidates
  all older participation; an old page cannot resurrect a request after a later
  off/on from another page. The journal alone never authorizes media capture.
  Notify independent owners in the writing document as well as other documents:
  browser `storage` events exclude the whole writer document. Coalesce local
  notifications and detach retired owners; observer failures must not turn an
  already committed switch into a reported failed publication.
- Publish explicit intent with a monotonic revision. The Worker ignores stale
  commands and checks the revision again after each asynchronous context,
  capture and route operation. Synchronous local off fences current capture
  immediately; completion also joins shared intent publication.
- Reconcile permission, latest shared intent, current peer and fresh route before
  reacquiring a device. Recheck after the promise resolves; stop every late stream
  if permission, owner, intent or epoch changed. Source recovery must have at most
  one in-flight acquisition and one live capture for its coordination scope.
- Reuse a still-live source/processor across transport or Worker replacement
  only after rebinding the current capture token and a fresh delivery fence.
  Do not replay queued frames or retain an old peer's token in a callback. A
  new source is needed only when the old track/graph is genuinely unusable;
  explicit off/logout/permission or owner retirement still stops it immediately.
- Distinguish a requested route, server writer authorization and effective mic
  delivery. Automatic recovery must check fresh target/writer eligibility before
  opening a device and must not report actualMic until capture is ready and the
  new route/delivery fence is acknowledged. Writer contention must not trigger
  repeated device opens or silent takeover.
- A fresh document starts off. Missing/corrupt/unavailable shared metadata cannot
  authorize replay of an old on state. Bound journal entries/participants and
  remove retired participation. Capability fallback must be visible rather than
  silently weakening cross-document off protection.
- Use a new Worker protocol namespace when recovery commands change. Update
  SDK, Worker, worklet and ingress asset pins together. Existing runtime audio
  domains and server grant formats remain unchanged unless implementation proves
  a server-side change necessary. Do not add a required login-session header.

## Recovery mechanics

Use one cancellable reconciliation operation per owner, with bounded exponential
backoff and a capped delay. Wake it on network return, device/permission changes,
page resume and Worker messages. Ordinary hidden tabs retain healthy connections.
Freeze/OS suspension fences delivery, then resume reconciles current intent and
permission without requiring a new button click where the browser permits it.

Native cookie replacement is distinct from account replacement. Context returns
a stable Manager-scoped correlation of the existing ingress principal. Equal
observed principals permit fresh scope/service grants; changed or lost observed
principal/login bindings retire old interests. The correlation is not authority,
nor does it distinguish repeated logins of the same account. Older servers
without it retain conservative same-service scope-change handling. No extra
login header is required. Under scope pressure reclaim only inactive scopes with
no pending grants; never evict an active channel or reservation to hide a quota.

The transport-level implementation now retains a ready source beyond the old
twelve-second cutoff while owner heartbeats and requested mic routes remain.
It fences delivery and disables the live track during the interruption; a fresh
route and delivery nonce can resume it without another device request. Unit
controls include a simulated two-minute outage and temporary connection
contention. A [real headed Chrome/Kasm/Pulse control](../tests/native-audio/results-retained-source-20261128.json)
also passes over two minutes disconnected with fifty genuinely hidden samples,
the same live source/processor, no extra device request and fresh speaker/mic data
after reconnect. This uses an unchanged archived Core plus a development SDK,
without focus emulation or background timer overrides; it does not qualify new
backend scope correlation or long-duration allocation. This is partial
implementation: actual Worker/source replacement,
permission-driven reacquisition and full qualification are still outstanding.

Keep separate failure classes: retryable connection/service/device/domain loss;
blocked browser permission/playback/capability; terminal owner/identity/runtime
retirement; and explicit user cancellation. Initialization failure must not leave
a valid request permanently stranded after one retry. Nor may retries grow native
Worker clients, pending RPCs, timers, queues or stale callback maps without bound.
An actually unresponsive SharedWorker has no Window-side terminate API; bounded
replacement and an honest terminal resource/capability condition are required
instead of unlimited new worker names.

When possible, preserve a temporarily muted track and resume after unmute rather
than opening another device. Ended/unplugged tracks can be retried with granted
permission and device-change wakeup. Permissions revoked or changed to prompt stop
capture; automatic recovery must not ask for them again. Fresh granted permission
can permit recovery under the still-live intent. Playback recovery attempts to
resume/rebuild an already authorized graph, reporting an actual autoplay block
when the browser still requires an action.

The [capture specification's media lifecycle](https://www.w3.org/TR/mediacapture-streams/#life-cycle-and-media-flow)
permits releasing disabled devices and deferring reacquisition/unmute while a
document is out of view. Do not create an SDK deadlock by disabling a track merely
because the UA muted it and then requiring unmute before it can be enabled.
Fence PCM separately; preserve a valid source's enabled state through UA mute,
and allow permitted, in-view re-enablement only under current intent and writer
authorization. A module model covers this ordering; actual hardware/browser
behavior remains a separate qualification requirement.

## Fault disposition and required evidence

Each row in the [24-class fault inventory](native-audio-faults.md) needs its own
test or an explicit, justified terminal/blocked disposition. Grouping does not
substitute for that audit.

| Classes | Target |
| --- | --- |
| WSS, transient HTTP/renewal, ACK and long outage, service epoch | Reconcile fresh context/connection/routes; automatic speaker and permitted mic recovery; discard stale data. |
| Invalid/expired token | Fresh authorization under current access; never accept a stale runtime or capture fence. |
| Display-only reconnect | Preserve audio identity and capture. |
| Worker exit/unresponsive/init failure | Bounded rebind/replacement/retry; restore valid intent, no repeated native-client leak. |
| Background/freeze/resume | Keep healthy hidden audio; automatic permitted recovery after actual suspension. |
| Playback blocked | Try eligible recovery; expose genuine browser action requirement. |
| Device/permission/mic-owner loss | Stop/fence immediately; retry available devices with granted permission and a valid owner; no capture by an unrequested page. |
| Connection/writer contention | Preserve intent, retry after ownership release; no silent takeover. |
| Domain unavailable/replaced | Retry only affected route; retain other routes and reuse a valid capture where possible. |
| Runtime retired | Fence old interests; never restart an explicitly stopped App or replay mic to a replacement target. |
| Access/identity rejected | Stop old authority; current authorization/session rebind is required. |
| Bad configuration/capability/quota | Honest actionable state, bounded work and no retry storm. |
| Backpressure/scheduling | Bounded drop-oldest queues and fresh data; no healthy mux teardown for bursts. |
| Incomplete retirement | Join terminal cleanup, bound deadlines, report failure and fence every late callback. |
| Connected-silent / host intent | Trace actual PCM and requested/effective state; distinguish external mute/routing from a transport or SDK defect. |

## Clipboard

Remove permanent payload-based echo suppression. A remote A after B is a new
copy even if A was uploaded before. Compare the current actual local value and
normalization baseline: an actual matching echo is a no-op, a concurrent local
change is preserved, and a new remote offer replaces an older pending offer.
Keep format/size/receipt/focus/generation protections. Test delayed delivery,
concurrent changes and real browser/X11 old/new controls before qualification.
Investigate the separately observed unannounced-remote/concurrent-upload window;
do not declare it repaired merely because A-B-A now passes.

## Completion gates

1. Mandatory unit regressions, with no A-B-A TODOs; deterministic delayed callback,
   permission/off/logout, shared intent, multi-owner and old-frame controls.
2. Real Chrome/Kasm/Pulse/X11 fault matrix, including actual service and Worker
   replacement, long/combined cuts, background/resume, domain/device/permission
   failures, overlapping off and late acquisition, identity/runtime fences and
   shared owners. Check fresh sound, mic and clipboard data, not only counters.
3. An eight-hour natural multi-template/multi-document run, alternating visible
   and hidden states and active/silent integration phases. No planned fault or
   forced GC during this interval. Failed attempts remain separate.
4. At least ninety minutes of combined fault/interaction stress, at least one
   thousand integration operations, repeated Manager/Worker/route cuts and owner
   churn. Separate this from the natural interval. Recover after faults cease
   without host re-enabling; explicitly cancelled routes must remain off.
5. Sample verified owned browser/backend PSS, anonymous PSS, SwapPss, RSS, heap,
   DOM, listeners, FDs, queue/capture/connection counts and scoped shared resources.
   Review startup, steady state, peaks and tail, including swapped allocation.
   Then run separate native retirement/idle controls; do not infer release from
   falling RSS or hide growth with periodic GC.
6. Full check, race, coverage and security gates; agent review and required CI.
   Build and qualify the exact final merged source through existing release
   procedures. Prior candidate/old SDK evidence cannot qualify new behavior.
7. Update migration/adoption docs and the project-owned UAT workbench, including
   visible version, desired/effective/recovering/blocked state and final artifacts.
   Only then request one complete human UAT. Do not operate sandbox deployments
   or publish a formal release before its own acceptance gate.

The tracker and evidence must mark each gate's actual status. A green unit suite,
a short restart test or an implemented retry loop is not production qualification.
