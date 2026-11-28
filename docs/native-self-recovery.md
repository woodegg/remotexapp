# Native integration self-recovery implementation and qualification

Selected by the owner on 2026-11-28 in
[Issue #119](https://github.com/woodegg/remotexapp/issues/119), including the
clipboard repair in [#117](https://github.com/woodegg/remotexapp/issues/117).
The objective is one complete UAT after systematic repair and production-quality
qualification, not separate acceptance of small implementation checkpoints.
PR #118 now carries this implementation, superseding its initial test-only scope.
This document is an implementation target and gate list, not a claim of passage.

Development checkpoint: SDK 0.38 / Worker 8 now connects the intent journal to
the audio owner/coordinator. Integrated module models cover rebind with a live
source, ended-source reacquisition, permission revoke/grant, late-result/off,
cross-document off/on, domain recovery with a healthy peer and access/identity
fences. Writer reservation precedes device acquisition; processor delivery ACK
precedes effective mic and PCM. These models are supplemented by scoped real
controls below; they do not qualify the complete state machine. Repeated silent
exit recovery is repaired in development, while full multi-document/Worker-hang,
clipboard destination ordering and remaining fault/resource gates stay open.
Do not start final qualification on an unfinished state machine.

A [real Chrome silent-exit control](../tests/native-audio/results-worker-silent-exit-20261128.json)
now confirms one Worker replacement reuses the same source and processor with
fresh speaker/mic data, but the next actual exit reaches the fixed replacement
limit while no Worker remains alive. Worker 8 adds an incarnation-qualified same-name bootstrap probe to repair
that bound. A [new headed Chrome control](../tests/native-audio/results-worker8-silent-exit-20261128.json)
passes twenty actual exits, retaining one source/processor and a single device
request with fresh speaker/mic data after every recovery. This single-document
development control does not qualify the whole fault class, new backend or
release. The failed Worker 7 control remains unchanged.

## New Manager recovery control (development)

The [ten-case new-Manager control](../tests/native-audio/results-new-manager-recovery-20261128.json)
uses the committed development Manager/SDK with unchanged pinned gateway,
drivers and Kasm component. Headed sandboxed Chrome, real Pulse and a synthetic
mic verify native-cookie deletion, two actual Manager restarts and a greater
than sixteen-second outage with the same parent source and fresh data. Temporary
controlled HTTP 401 stops capture; restored current access and already granted
permission allow an automatic new capture. No optional login-session header is
used. A changed observed ingress principal instead retires the old interests,
stops capture and causes no further capture during twelve seconds of observation.

An actual App stop retires its interests while another target retains the source.
After the [earlier failed attempt](../tests/native-audio/results-runtime-terminal-failure-20261128.json)
and backend classification repair, acquiring the old target receives HTTP 410 and
immediately releases that interest. A subsequent actual Worker exit replays only
the healthy target. Final awaited cleanup returns all nine sampled native audio
classes to zero in the same live page. Owned test resources are cleaned.

This audio-only Host-session control qualifies neither a complete display/24-class
matrix nor multiple real documents, physical hardware, OS sleep, long-duration
allocation, new native clipboard component, production build matrix or immutable
release. The final diagnostic GC is separate from the fault interval.

## Worker bootstrap recovery (development Worker 8)

A silent exit need not emit `SharedWorker.onerror`. A new logical MessageChannel
sent over its cached dead native bootstrap cannot recreate the Worker. After a
bounded init timeout, construct one fresh native bootstrap under the **same**
name. The Worker returns an ephemeral random `workerId` in its init contract;
only a different confirmed incarnation resets that name's probe budget. The ID
is correlation, never capture, login or server authority. Unknown or unchanged
incarnations consume at most one extra native bootstrap per name. An error event
alone cannot reset the budget because an uncaught error may leave the Worker
alive. Coalesce concurrent document probes onto the newest bootstrap and reject
stale init completions.

Use at most two recovery names and at most four native bootstrap clients when
both names are nonresponsive. A genuine repeated Worker termination must reuse
the same name and recover repeatedly without exhausting it. A permanently hung
pair remains honestly blocked rather than accumulating unlimited native clients.
Existing owner watchdog/wake reconciliation follows a changed preferred name;
source availability is only a candidate preference, not permission. A responsive
owner releases an unselected retained source after another capture is ready.
Explicit off fences locally and commits the shared switch even when the Worker
cannot respond; it does not require a new Worker to cancel intent. Returned
inactive state does not claim remote delivery or completed peer processing.

Model tests exercise twenty silent exits, one hundred incarnation-qualified
hub replacements, same-incarnation/error probe bounds, concurrent probes and
cancellation during rebind. Real browser/native-resource and multi-document
fault qualification remain separate requirements. P20 also verifies fifty
actual same-name exits with bounded native clients in a separate minimal
no-audio control. The headed audio run observed anonymous PSS increase from
about 205 to 268 MiB across its short sampled interval, with no forced GC and
zero SwapPss. This is an unresolved resource observation, not long-duration
allocation acceptance; inspect retirement/GC and native roots before qualification.

The [graph baseline](../tests/native-audio/results-graph-baseline-20261128.json)
preserves the pre-repair reproduction of three SDK defects using controlled
browser API models: rejected Worklet loading remains cached, a closed Context is reused on
later attempts, and temporary Context suspension stops the held capture source.
Worker replacement alone does not repair these graph failures. The new graph
implementation resumes/rebuilds under valid intent and passes model regressions;
real browser/native retirement and complete qualification remain required.

## Audio graph recovery (development)

A source and its processing graph have separate lifetimes. Suspend fences PCM and
attempts to resume an already authorized Context; it does not stop a valid track.
A failed module retires the unusable graph before replacement and preserves
valid intent. A processor error replaces only that failed node; its healthy
sibling and Context remain usable. Whole-Context replacement uses the
[owned graph boundary](#owned-graph-execution-environment-sdk-038-development)
described below; the earlier Context-only implementation failed native retirement.
Rebuild
capture only after current intent, permission and writer checks, and require a
fresh processor delivery ACK. An old processor's delayed error cannot invalidate
a newer graph. Playback-node construction failure also enters this reconciliation.

A native `addModule`, `resume` or `close` Promise may remain pending after the
SDK's three-second observation deadline. Join that native flight rather than
creating another for every retry. One additional resume is permitted for a real
user gesture that can unblock an earlier automatic autoplay attempt. A graph with unresolved native operations cannot justify unlimited parallel
operations. Owned realm retirement detaches its obsolete operation observations;
without that ownership proof unresolved work stays quarantined. Existing healthy
graphs continue; late completion of an observation in a live realm can wake it. Late settlement wakes recovery, including when the wake
arrives during another reconciliation. Close/retirement failure is reported,
not treated as successful native cleanup. Pending operation records detach owner
callbacks on disposal and release closed Contexts when late native work settles.
Native-resource behavior still needs real browser qualification.

Explicit off/logout/retirement must prevent late construction or device opening.
Automatic graph recovery checks current participation and never prompts. Bound
retirement error history to eight records plus a total counter. A Context
reported closed is **not** terminal render evidence. Healthy processors must
terminate before SDK-owned Context close; an already-closed graph instead needs its
owned execution environment retired, with native release measured in browser
qualification. A missing ACK without positively retired ownership is incomplete;
record a recovered realm fallback separately from an acknowledged render.

`actualSpeaker` now requires both an acknowledged server route and an eligible
ready playback owner. It cannot prove the user's physical output is audible.
`playbackBlocked` and local `contextState`/`contextReason` distinguish graph and
browser-policy conditions from mux transport. `actualMic` retains its source
and delivery-ACK requirement. A permanent native close/module/resume hang remains
an honest bounded recovery/cleanup condition; final fault audit and long-duration
native/allocation tests are not replaced by model passage.

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

## Owned graph execution environment (SDK 0.38 development)

The [earlier whole-Context control](../tests/native-audio/results-graph-retirement-failure-20261128.json)
retains twelve native Contexts, fourteen WorkletNodes and twelve MessagingProxies
while sound recovers. That failed implementation remains recorded. A matched
[mechanism control](../tests/native-audio/results-closed-context-frame-20261128.json)
then shows that retiring an owned same-origin graph execution environment removes
those native roots; direct Context close alone does not. Current implementation
uses that ownership boundary rather than treating `closed` as retirement proof.

The parent audio controller owns the journal, requested state, Worker connection,
permission observations and MediaStream. It synchronously creates an inert,
hidden same-origin iframe with an initial inherited about:blank document; Context
and WorkletNode constructors belong to that child realm. No navigation, new
credential, endpoint, permission request or host recovery loop is introduced.
The graph's document identity and connection are observed so removal/navigation
can be detected even when the destroyed child cannot deliver state events.

Normal teardown mutes output, disconnects the source graph, posts processor
termination, joins render acknowledgements and closes the Context. An already
closed graph cannot run that acknowledgement; a stuck graph may exceed a bounded
wait. In those cases retire the **owned graph realm**, clear parent callbacks,
ports and node/document references, and finish retirement using that ownership
boundary. This does not reload or retire the embedding application. A still-valid
parent microphone source can feed a replacement graph only after current intent,
permission/writer checks and a fresh delivery acknowledgement.

A browser-native Promise is not declared fulfilled by a JavaScript timeout.
After owned realm destruction the SDK detaches the obsolete observation, rejects
its owner wait and releases Context/controller references from the native
callback scope. Late native completion cannot wake, overwrite or retire a newer
graph. Per-live-graph native operations remain bounded; an unavailable/blocked
realm fails honestly rather than falling back to an unowned parent Context.
Only a positively retired owned realm permits this alternative termination
proof. Missing acknowledgement without such a boundary remains incomplete.

A scoped headed Chrome/Kasm/Pulse control now covers real module rejection and
retry, suspension, ten complete Context replacements and ten actual processor
throws. The microphone remains parent-owned, has one device request, and produces
fresh remote readback after each recovery. Active Context/node/proxy counts match
1/2/1; after awaited owner disposal all sampled audio classes return to zero and
no SDK audio realm remains. This development control is not the new-backend,
full policy/fault/resource, natural-soak, combined-stress or final artifact gate.
The failed controls are retained. The separate
[policy and late-operation control](../tests/native-audio/results-owned-realm-recovery-20261128.json)
also covers same-origin script/frame CSP, a genuinely delayed module fetch,
an unresolved close wrapper, late completion, cancellation and ignored processor
termination. Its immediate sample retains one stopped Stream/Track, matching a
no-SDK control; all nine audio classes reach zero after eighty seconds of live
idle. Neither diagnostic-GC lane replaces complete policy/fault/long-duration
qualification or the new backend/candidate gates.

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
implementation: actual repeated Worker/source and permission-fault qualification
and the full acceptance gates are still outstanding.

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

Runtime retirement is terminal for that exact runtime/generation. An HTTP 410
or server generation-retired state fences the Worker route and its ref intents,
then notifies only its participating document owners. Each owner synchronously
releases matching handles and local replay flags, leaves that target's journal
participation and rejects late device/enable results. Repeated stale commands or
ACKs cannot re-enable the retired route. Other runtime interests keep their
intent and any still-usable shared capture. A Worker replacement must not
reacquire a retired local interest. The
[development model regressions](../tests/native-audio/results-runtime-intent-retirement-20261128.json) are separate
from real runtime-stop and final-artifact qualification.

The backend must also classify retained stopped/stopping runtime or session
records as terminal HTTP 410, even before their generation counter advances.
The [failed real new-Manager control](../tests/native-audio/results-runtime-terminal-failure-20261128.json)
found that these records returned recoverable 409;
the existing push fence worked but a later old-target acquire was misclassified.
Temporary domain/service failure remains recoverable and does not become terminal
merely because its audio endpoint is currently unavailable.

## Clipboard

Remove permanent payload-based echo suppression. A remote A after B is a new
copy even if A was uploaded before. Compare the current actual local value and
normalization baseline: an actual matching echo is a no-op, a concurrent local
change is preserved, and a new remote offer replaces an older pending offer.
Keep format/size/receipt/focus/generation protections. Test delayed delivery,
concurrent changes and real browser/X11 old/new controls before qualification.
The separate unannounced-remote/concurrent-upload window now has a
[development native admission implementation](native-clipboard-ordering.md).
The SDK captures the baseline destination revision before browser reads and
commits it only after native admission or a matching remote snapshot. Old pins
expose passive upload as manual; explicit source choice and supported automatic
download remain. Complete native X11/INCR/multi-owner and final qualification are
still required; do not declare it repaired merely because A-B-A or models pass.
The [current eighteen-case native control](../tests/kasm-native/results-native-clipboard-current-pair-20261128.json)
adds actual scoped concurrency, rich-format/size, slow-payload, existing native
permission switches and real background-return proof. It does not close the
shared-document/audio/whole-fault/natural/stress/resource/candidate gates.

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
