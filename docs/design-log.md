# Design decision log

## 2026-10-02 — Bound recovery of a failed managed desktop session

Core 0.14.2 observes both the pinned readiness-process identity and the
session cgroup. A lost XFCE leader is reported promptly even when surviving
helpers keep the cgroup populated. Generation-fenced events are handled under
the lifecycle lock. If the old component may contain user processes, Core
preserves it and reports failure for operator review; an automatic cleanup
must not discard unsaved documents. Only a confirmed inactive component can
be cleaned and relaunched on a later Viewer attach, with at most three
persisted attempts in ten minutes. Server/VNC/gateway remain pinned. This is
not a resource-runaway kill policy or evidence of the original leader's cause.
See [the recovery train](managed-session-recovery-release.md).

## 2026-10-02 — Accept LTV-013 UAT and promote stable 0.14.1

The operator accepted local RC.1 UAT on 1991/2992 and authorized a formal
GitHub release. Stable 0.14.1 changes release identity and acceptance metadata
only; SDK remains 0.29.1. The source commit must
pass the hosted same-commit candidate and exact-archive host E2E before the
annotated stable tag is pushed. App 1.0.13 is independently published from
the accepted source and requires Core 0.14.1 or newer. Publication does not
authorize sandbox deployment.

The first hosted candidate exposed two release-integrity defects: the local
1.0.12 UAT archive included ignored Python bytecode, so clean CI would build
different bytes under the same immutable App version; and a deployment-evidence
field contained an internal host marker prohibited by the confidentiality gate.
Exclude Python bytecode from App/Core archives, reserve 1.0.12 as local-only,
and use 1.0.13 for formal publication. Remove the marker from the latest
pushed commit's history before rerunning the candidate. Do not weaken the
confidentiality scan or reuse a changed immutable version.

## 2026-10-02 — Recover a hibernated LightView on Viewer attach

Sandbox10 evidence showed that LightView's process, visible window and private
socket survived while its WebKit engine became `suspended`. Manager's previous
`applicationStatus.ready` is a last-reported Driver state, not a live native
engine probe; changing `openUrl` alone cannot make a newly attached Viewer
usable. Add optional paired App Package V1 Viewer transition hooks. Core calls
them only for zero-to-one and one-to-zero Viewer transitions; adoption performs
the detach reconciliation because all old websockets are gone. Hooks are
bounded, run under the pinned package and session generation, and cannot expose
native diagnostics or page URLs to the browser.

LightView 1.0.12 saves its current native idle interval in a private,
generation-scoped runtime file. On attach it temporarily sets the interval to
zero and, only if suspended, opens `last_committed_uri` or `about:blank`, then
waits for a ready, completed navigation. A ready engine is not reloaded.
Detach restores the saved interval unless a local Agent has changed it while
attached. The private state survives Manager restart but not a stopped runtime.
`applicationStatus` retains its historical reporting semantics; current engine
state requires the trusted local native `status` command. WebKit hibernation
still loses DOM/JS/form state, so restored navigation is not a browser-session
checkpoint. RFB websocket flapping is a separate diagnosis.

## 2026-10-01 — Promote the accepted standalone train as stable 0.14.0

The operator accepted human UAT on RC.6 and requested a formal release.
The stable version changes only Core release identity and publication metadata;
SDK 0.29.1, App Package ABI and the eight shipped App versions are unchanged.
The stable source commit must pass a new same-commit hosted candidate gate
before its annotated tag is pushed. RC.6 host E2E and Ubuntu 26.04 regression
are evidence for unchanged behavior, not a claim of byte-identical stable
binaries. No host reboot was approved, so boot persistence is not certified.
Publishing does not authorize grok-bot service restart or sandbox alignment.

## 2026-10-01 — Canonicalize App Package extraction across installer umasks

Grok-bot's RC.3 version-switch gate installed the same checksum-verified QA
archive under umask 077 and later 022. File bytes were identical, but extracted
permissions differed (`600/700` versus `644/755`), so the permission-inclusive
content seals differed and an idempotent reinstall was rejected as changed
content. The archive extractor already maps entries to canonical regular and
executable modes, but `OpenFile` and implicit `MkdirAll` creation had allowed
the process umask to filter those modes. RC.4 explicitly normalizes every
extracted file and implicit directory before computing its seal. Changed
archive content under the same App version remains forbidden. RC.3 was not
published; grok-bot rolled back activation and retained the fault evidence.

## 2026-10-01 — Reclaim standalone component cgroups after stop

Grok-bot's exact RC.2 host E2E found that stopped Apps had no surviving
processes, but their empty component cgroup directories remained. Thirty-two
empty leaves accumulated after eight App tests; the host's delegated subtree
allows only 128 descendants. This is a bounded-resource leak and rejects RC.2
for production, despite its clean process tree. RC.3 removes each exact owned
leaf only after `cgroup.events` reports unpopulated, rechecking UID and inode;
the operation is non-recursive and refuses populated or replaced cgroups.
Manager startup also reclaims empty leaves retained by older builds before
runtime adoption, without touching live component cgroups. The grok-bot
project owns the host rollback and the repeated-launch quota regression.

## 2026-09-30 — Bound XFCE cold first-start without a false failure

The exact 0.14.0-rc.1 package on an isolated Ubuntu 26.04 QA clone created a
new selected user and fixed display `:3`. Its first XFCE attach failed with
`XFCE window manager did not become ready`: the 100-probe loop ended after
about 15 seconds while xfwm4 was starting. A subsequent restart/attach on the
same display reached `ready`, confirming a cold-start timing gap rather than a
missing dependency. XFCE App 3.0.1 extends the bounded EWMH window-manager
probe to 300 attempts and its Manager session readiness cap to 75 seconds.
It still requires a live self-identifying window-manager window and session
Clipman; it does not report ready merely because XFCE processes exist. The
qualified Core candidate advances to 0.14.0-rc.2; RC.1 was not published.

## 2026-09-30 — Make Edge startup timing independent of date formatting

The Ubuntu 26.04 QA clone uses uutils `date 0.8.0`: `date +%s%3N` returned a
19-digit value, whereas GNU date on the local host returned the expected
13-digit epoch milliseconds. Edge 2.0.3 compared that value with Core's
13-digit deadline and declared readiness failure before the browser could
become visible or expose CDP. Direct headed Edge on the same QA display and
profile reached a visible window and CDP, isolating the defect to the Driver
clock conversion. Edge 2.0.4 converts `time.time_ns()` to milliseconds
explicitly; Python is already a declared App dependency. Test both GNU and
uutils hosts before qualifying the new App version.

## 2026-09-30 — Reject cross-user systemd manager environment

An isolated Ubuntu 26.04 QA clone inherited `/etc/environment` values for
UID 1001. Installing for UID 1002 passed the former preflight, but its user
manager exposed UID 1001's XDG runtime, D-Bus and PulseAudio paths and XFCE
session startup failed. The central-user and user-install preflights now
inspect the actual user-manager environment, not merely whether the correct
bus can be contacted. They reject foreign paths with an actionable error.
After correcting the QA clone's user-manager environment, the same selected-
user XFCE App started on its configured `:3`. The clone is test-only; the
original `sandbox-qa` service and selector were not changed.

## 2026-09-30 — Persist standalone launch intent before atomic spawn

Standalone component launch now durably records the delegated cgroup inode,
boot ID, UID and unit before starting a process inside that cgroup. The final
record adds the main PID and start time. If Manager dies between these writes,
the next Manager retires the exact owned cgroup before manifest adoption; it
does not guess or adopt an unrecorded process. A failed spawn cleans only its
own intent, never a pre-existing component that caused a unit collision.
This closes the launch-to-identity crash window identified during local
qualification. Fault injection on a real delegated cgroup remains a release
gate; the unit fixture alone does not prove host behavior.
Canonical process checks for X11 ownership, environment and connection
metadata additionally require the exact delegated component cgroup path in
standalone mode; a matching unit basename in another subtree is insufficient.

## 2026-09-30 — Delegate grok-bot runit installation to its host project

The operator assigned grok-bot installation, runit service activation, runtime
restart, rollback and host-side E2E to the grok-bot project so it can preserve
an auditable reusable deployment playbook. This supersedes the train's earlier
assumption that RemoteXApp would write the host-specific runit installer.
RemoteXApp retains the immutable artifact/staging, explicit selected-UID and
standalone flags, generic non-systemd preflight and qualification matrix.
The host launcher must be root-owned and fixed to a reviewed executable,
arguments, UID and cgroup; it is not an HTTP-exposed privileged API. No
Manager deployment starts until the candidate passes local gates.

## 2026-09-29 — Bound anonymous failed starts without changing healthy vacancy

Issue #9 exposed a Core lifecycle gap, not an established Edge crash cause:
failed on-attach startup was not durably recorded, and the generic six-hour
vacancy timer could be renewed by another attach. Record a generation-scoped
failure and original expiry in the runtime manifest. Only unattached anonymous
`stop-instance` instances use the default two-minute failed-start grace;
Manager adoption and repeat attaches reuse the same deadline. Cleanup uses
forced stop because a Driver that never became ready cannot be trusted to
complete its normal graceful hook. Remove the active manifest and runtime
resources, then retain only a private, bounded, non-sensitive tombstone; do
not retain raw Driver logs in the tombstone. Managed instances and healthy
six-hour Edge sessions keep their former policy. Edge 2.0.3 reports a
window/CDP-specific Driver error before the Core deadline so the original
failure can be diagnosed if it recurs. The sandbox00 incident's removed logs
do not justify attributing it to memory pressure. No sandbox deployment is
part of this implementation decision.

## 2026-09-29 — Close formal LightView 1.0.11 release

Annotated `lightview-v1.0.11` peels to accepted source commit
`752b4ca15de2cf26fd459b4a0fd57c0f4c46f6f8`. Hosted Verify passed, and
the freshly downloaded archive is byte-identical to the one qualified on
local 1991/2992. It is a formal App-only release, not Core Latest. No
additional runtime or sandbox operation was performed. See
[publication evidence](../tests/evidence/v1/lightview-1.0.11-publication.json).

## 2026-09-29 — Authorize formal LightView 1.0.11 publication

The operator requested a formal GitHub release after the two local endpoints
and isolated exact-package regression passed. Publish an annotated App-only
`lightview-v1.0.11` tag and the same archive/checksum used for local UAT.
This supersedes LTV-012's initial publication hold; no separate interactive
UAT acceptance is claimed. Core, SDK, local runtimes and sandbox deployments
are outside the publication action.

## 2026-09-29 — Wake Lightview through the App action (LTV-012)

On sandbox10, App 1.0.10 blocked `openUrl` before sending native `open` because
Lightview 0.1.10 reported `engine_state:suspended`. The main PID and private
socket remained available. An experimental sealed App version verified the
same Manager action could wake WebKit and complete navigation; the first test
also exposed a transient `recovering` state after `open`. App 1.0.11 therefore
checks control identity separately from page readiness, dispatches `open` from
`suspended`, and waits for a complete ready page. It preserves the pre-existing
ready-state checks and fail-closed behavior for other states. This changes only
the App Driver and keeps read-only status nonwaking. The operator requested
local 1991/2992 deployment for UAT; formal publication is not included.

## 2026-09-24 — Close formal LightView 1.0.10 release

Annotated `lightview-v1.0.10` peels to `51c1d46b6a73a59267d8f2233cc71e73cfdd2037`.
Hosted Verify passed. Public downloads match the exact locally qualified App
archive; Core 0.13.0 remains Latest. LTV-011 is accepted and the App-only train
is closed. No deployment or runtime restart occurred during publication.
See [publication evidence](../tests/evidence/v1/lightview-1.0.10-publication.json)
for clean-source checks, archive identity and acceptance limitations.

## 2026-09-24 — Authorize formal LightView 1.0.10 publication

After the local handoff, the operator requested a formal GitHub release.
Promote the exact qualified App-only bytes as `lightview-v1.0.10`; keep Core
0.13.0 / SDK 0.29.1 and GitHub Core Latest unchanged. This authorization
supersedes the earlier publication hold, not the sandbox deployment boundary.
No new deployment or runtime interruption is included. Record the operator's
promotion decision without inventing a separate interactive human-UAT result.

## 2026-09-24 — Lock and implement LTV-011 for local UAT

The operator authorized development and local 1991/2992 deployment, then
explicitly approved upgrading/restarting local LightView `lightview-1693a7110d9d`.
Do not restart XFCE or operate sandboxes. Use unpublished immutable App 1.0.10
under the repository's stable-format shipped-App version convention; no Core/SDK
release or GitHub publication. Split target identity from navigation readiness;
quit no longer requires a ready page. Memory policy remains user-controlled.
Replace fixed public memory-state claims with `launchLowMemory:true`, which
describes launch configuration only. Live memory state stays on Lightview's
native status interface, not a new Manager polling or policy-enforcement layer.

Verification adds deterministic native command capture, actual HTTP Manager
execution of freshly installed/sealed scripts, real session/shutdown Drivers,
and unchanged action/catalog tamper rejection. Test-only corrections separate
process-startup allowance from the dedicated 50 ms shutdown timeout assertion,
and wait for a committed local-storage SQLite marker before destructive WebKit
reset. Runtime downgrade rejection is retained; selector rollback affects new
launches, not an existing runtime's immutable pin. No production Core logic changes.

## 2026-09-24 — Strengthen LTV-011 acceptance after Issue #8 follow-up

The [reporter's reversible experiment](private-history.md)
hit correct content-seal enforcement after an installed Driver edit. Once the
original package was restored and native protection enabled, navigation passed.
This corroborates state-dependent failure, not a successful candidate A/B or an
upstream defect. Keep the selected behavior: protection-off is legitimate and
navigation remains available once the engine is ready; do not adopt the comment's
alternative degraded-health/blocking policy for an intentional user setting.
Add deterministic owned-socket states, native-dispatch assertions, sealed-candidate
Manager HTTP tests and real-browser confirmation. Preserve tamper rejection and
prevent bytecode pollution; no in-place production edits or new signing system.
Transient recovery and settled disabled policy are distinct acceptance cases.
LTV-011 remains proposed and App-only; no implementation, sandbox operation or
GitHub issue mutation was performed by this documentation update.

## 2026-09-24 — Record optional LightView memory protection fix (LTV-011)

Issue #8 exposes a shared validator that applies startup memory policy before
both navigation and quit. The operator confirmed disabling memory protection
is a legitimate user choice, not a Lightview defect to investigate. Record a
proposed App-only 1.0.10 train separating identity/protocol, navigation readiness
and startup defaults. Protection being disabled or its threshold changing must
not alone fail readiness, block navigation, or prevent safe native shutdown.
Keep the low-memory launch default and do not change user choices. Navigation
needs a ready engine; quit needs a verified control target, not page readiness.
Status must not misrepresent a configured default as a live enforced policy.
This supersedes only the mandatory termination-threshold acceptance decision in
LTV-009/010 on implementation, preserving those historical release records.
No generic action-error ABI redesign, Manager polling, WAOS change or upstream
upgrade requirement is added. This turn records scope only; no code, deployment,
publication or issue-state change is authorized by adding the requirement.

## 2026-09-18 — Publish LightView App Package 1.0.9

Annotated tag `lightview-v1.0.9` peels to qualified source
`b85984431c6d28c32b1aa1deeb7e12d282ff1a37`. Hosted Verify passed. The formal
release publishes only the deterministic App archive and checksum; fresh
downloads match the isolated-test bytes. Core `v0.13.0` remains Latest.
LTV-010 is accepted and closed under the operator's direct implementation and
publication request; no separate interactive UAT or deployment is claimed.
The version-lock removal does not change package immutability or existing
runtime pins. Sandbox deployment remains owned by the sandbox repository.

## 2026-09-18 — LightView capabilities replace executable version gating (LTV-010)

The operator requested removal of the LightView executable lock and a new
formal App Package. `lightview@1.0.9` removes the `--version` launch gate,
superseding the exact-host-version decisions in LTV-007/008/009 without changing
their released artifacts. Do not substitute a permissive version range: a
version banner is no longer a runtime acceptance criterion. Existing launch
flags, same-process visible window, owned private socket, bounded status schema
and low-memory/recovery policy remain mandatory. This allows compatible builds
without promising that all newer (or older) builds work. Operators still select
and verify host executables; no automatic installation or update is added.
Core, SDK, App protocol and deployment ownership remain unchanged. The previous
App's real baseline was 0.1.8. Qualify this archive against separately provisioned
formal 0.1.9 plus launcher and incompatible-capability fixtures; do not claim
future-binary certification.

Qualification completed: all 15 isolated exact-package scenarios passed with
formal 0.1.9 and unchanged Core 0.13.0. Source, race, coverage and vulnerability
gates passed. The new real-launcher fixture fails on the old Driver for four
non-0.1.8 banners and passes all five banners with the new Driver; missing
required status fields still fail. The container requires a test-only WebKit
sandbox override and headed Chrome under Xvfb; neither changes the App artifact.
No existing local runtime or sandbox deployment was changed.

## 2026-09-18 — Accept Coordinator UAT and promote 0.13.0

The operator accepted local RC.3 UAT and requested a formal GitHub release.
Promote to 0.13.0 with SDK 0.29.1 and unchanged App versions/functional code.
Commit the reviewed source, build a clean hosted candidate once, verify the
exact artifact, then promote the annotated stable tag. Record the local RC.3
acceptance separately from exact clean-artifact validation; do not claim the
dirty RC.3 artifact was the hosted artifact. Publication does not authorize
endpoint deployment or runtime replacement.

## 2026-09-18 — Deploy RTC-007 as a new local candidate

Core 0.13.0-rc.3 / SDK 0.29.1 identifies the Coordinator diagnostics panel;
do not overwrite the previously staged RC.2 artifacts. Local 1991 and 2992
select the same Manager/web bytes while preserving App selectors, runtime
pins and Console/kiosk policy. Manager restart is sufficient for this UI/SDK
change; no forced App upgrade is needed. Existing browser pages require a
reload. Human UAT and publication remain separate approvals.

## 2026-09-18 — Read-only Coordinator diagnostics (RTC-007)

Expose a cloned `getDiagnostics()` snapshot rather than coupling Console to
SDK job/peer internals. It performs no network request or interest acquisition.
Console and kiosk share one non-modal panel, refreshing once per second only
while open. Render all dynamic values as text. Retain at most 100 in-memory
events per Coordinator; no persistence, arbitrary server error messages or
application/control payloads. Diagnostics describe this page's observations,
not a global census. Silent peers are not labelled crashed. Lease expiry is
labelled server time, and only the local leader has a next-renewal estimate.
This adds visibility without changing election, lifecycle or renewal policy.

## 2026-09-18 — Qualify RC.2 against fresh Driver state

Core 0.13.0-rc.2 supersedes the unpublished local RC.1 candidate; SDK 0.29.0
and App versions are unchanged. Renewal checks the refreshed Driver status
file so a cached ready value cannot hide an exited/error report. Focused tests
write real terminal status files against a stale ready cache and require 409
without a new timer. Do not overwrite the already staged RC.1 directories.

The exact RC.2 runtime bytes passed the eight-App/32-scenario disposable-account
suite, including XFCE relogin/logout, freeze/takeover, all-Tabs-frozen expiry,
restart/upgrade, managed desired-stop and blocked shutdown enforcement across
Manager restart. Local Manager selection preserves the existing desktop's
generation and component pins. This is local UAT preparation, not acceptance
or GitHub publication, and does not authorize sandbox operations.

Concurrent test Managers sharing the host X namespace reproduced a display
allocation conflict (TigerVNC: server already active for display 17). Serialize
these live suites; no cross-Manager allocator change is included in this train.
Retain this limitation and the fixture-failure dispositions in test evidence.

## 2026-09-18 — Lock runtime lease and single-server Coordinator

IDL-001–004 and RTC-001–004 target Core 0.13.0-rc.1 / SDK 0.29.0 for local
1991/2992 UAT only. App packages are unchanged. Renewal is a generation-fenced,
Manager-authenticated POST using the pinned timeout; RFB attachment, explicit
stop, desired-stop, App exit and shutdown enforcement retain priority. Timer
identity, runtime identity, generation and deadline fence already-fired vacancy
callbacks. Manager adoption retains its existing fresh grace, not durable leases.

An optional single-server Coordinator shares content-free lifecycle snapshots
and keepalive interests across Tabs. Heartbeat is two seconds, leader eligibility
six seconds, and stale-interest retention five minutes. Renew at timeout/3,
capped at five minutes; requests are bounded and stale responses ignored.
Browser suspension can expire a lease; no claim of indefinite background
survival. Viewers retain independent IME/clipboard ownership. Explicit host
handles survive Viewer destruction; Viewer-owned handles do not. Console adds
an opt-in Keep running control. Multi-server/native ownership/audio remain
pending. See [the locked design](runtime-coordinator-release.md) and
[migration guidance](integration-guide.md).

## 2026-09-14 — Publish 0.12.2 and retain a separate reboot approval gate

Publish the exact `c1cecabe076e` candidate after hosted/local release gates,
eight exact-archive suites and sandbox00 seven-App Manager/runtime-only tests.
Verify downloaded assets match the candidate and deployed binaries; SDK 0.28.0
and Apps remain unchanged. The observed CloudDrive ENOTCONN now logs an error
without blocking production 1991. Configuration and paired 2991 remain unchanged.

The operator's latest instruction supersedes earlier inferred permission for
sandbox00 whole-container reboot: require new explicit human approval. No reboot
after this restriction; final-byte container acceptance stays open. Historical
candidate reboots and local boot simulations do not close it. CloudDrive file
tests are skipped during maintenance, and native 26.04/physical power loss is
unverified. No new human UAT, other deployment or gateway mutation is implied.
Retain failed-attempt dispositions and the host logout-wrapper qualification in
[publication evidence](../tests/evidence/v1/boot-recovery-0.12.2-publication.json).

## 2026-09-14 — Decouple document-storage availability from Manager startup

BR-006 supersedes startup-time canonicalization of all document roots. Parse
the configured absolute-path allowlist without filesystem I/O, then report
one asynchronous availability diagnostic per root with a one-second reporting
deadline. A stalled OS lookup may retain one worker per configured root, but
does not block HTTP startup or spawn repeated probe workers. This is not a
new storage monitoring service or a hard deadline on every file operation.

Resolve the requested file and configured roots when opening a document;
require an available directory, canonical containment, a readable regular file
and existing Driver checks. Prefer matching paths before unrelated roots.
Configured root aliases are trusted operator policy and are re-resolved on use;
document symlinks cannot escape the then-current canonical root. Never substitute
an unavailable root with its parent/default or silently remove it from policy.
This is a path allowlist, not filesystem isolation or mount-health detection.

Loading private managed intent validates schema/parameter syntax without live
document access. Registration, launch and upgrade retain full file checks;
an unavailable file affects that App operation, not registry loading. Local
fixtures cover outages/recovery and security boundaries. Real CloudDrive tests
are excluded during maintenance; production mount/configuration changes are not
part of this fix. Include the change in the still-unpublished 0.12.2 candidate.

## 2026-09-14 — Clarify terminal shutdown state in boot eligibility

Final review found that an accepted new Viewer can cancel a blocked shutdown
while retaining its historical `cancelled` status. BR-002's "no pending
shutdown" rule therefore permits completed and cancelled shutdowns, not only
completed ones; requested, timed-out and unknown states remain ineligible.
This refines the boot decision below without bypassing desired-stop, failed
session or live-process protection. Add explicit terminal/pending matrix tests
and repeat candidate qualification before publication.

## 2026-09-14 — Separate cross-boot recovery from same-boot session failure

The sandbox01 report and retained postboot records confirm that a healthy
pre-reboot XFCE is classified as an offline App failure and then blocked by
both managed reconciliation and Viewer attach. Implement the narrowly scoped
[boot-aware recovery design](boot-recovery-release.md): private runtime boot
identity, durable restarting intent, preserved pins and increasing generations.
No automatic revival of pre-existing failures/refusals, no public API/manifest
schema change and no claim to recover lost process memory. This supersedes
the blanket offline-exit rule only for eligible proven boot transitions.
User authorized new release and sandbox00 production reboot tests; sandbox00
requires the existing 0.11-to-0.12 stopped cutover first. No force-discard or
other environment deployment is inferred.
## 2026-09-14 — Publish stable U26 repair without changing deployment state

Published formal GitHub Latest `v0.12.1` at `0300acdfd003`, SDK 0.28.0 and
Mousepad 4.0.1. Hosted and independent ordinary clean-clone archives are
byte-identical; all seven exact-archive E2E suites and eight Mousepad checks
passed. Published assets were downloaded and verified. Test-only stage-fixture
timing corrections do not change production deadlines or accepted behavior.
Retain native clean 26.04/Qt6/full-host tests as explicit unverified platform
qualifications. No deployment, existing runtime restart/upgrade or downstream
workaround retirement. The immutable tag is not moved for this docs-only
closure record. See [publication evidence](../tests/evidence/v1/ubuntu-host-compatibility-0.12.1-publication.json).

## 2026-09-14 — Accept U26 and promote to stable 0.12.1 without deployment

Operator accepted UAT and requested a formal version, not an RC. Promote the
accepted repair behavior to Core 0.12.1 with SDK 0.28.0 and Mousepad 4.0.1.
Use a clean hosted candidate, exact-byte local E2E and immutable annotated-tag
publication. Acceptance carries over only for this metadata-only promotion;
no new human test or native Ubuntu 26.04 certification is claimed. Keep the
unexecuted platform gates explicit. Existing environments/runtime pins and
downstream workarounds remain outside publication authority. Unrelated sandbox
TODO edits and the local release-tray are excluded from the commit.
See [UAT record](../tests/evidence/v1/ubuntu-host-compatibility-0.12.1-uat.json).

## 2026-09-14 — Preserve paired status revisions during Core startup diagnostics

Local seven-App testing of U26-05 exposed a development regression: changing
only public progress breaks the existing private/public revision match required
by getConnections. The supervisor now advances both records before starting
the Driver, then yields publication ownership. It never writes late progress
over a Driver's ready/error status. No connection schema or endpoint semantics
changed. Full main/interaction reruns and a direct paired-revision regression
passed; failed attempts remain in the [development evidence](../tests/evidence/v1/ubuntu-host-compatibility-0.12.1-rc.1-development.json).

## 2026-09-14 — Lock bounded Ubuntu host compatibility repairs

Operator approved the reviewed U26 proposal for development/testing. Core
`0.12.1-rc.1` and Mousepad `4.0.1` retain SDK `0.28.0`, Core-owned services,
immutable runtime pins, shutdown refusal and fail-closed offline recovery.
Machine-readable readiness removes unnecessary work without replacing actual
protocol checks. Toolkit/distro preparation belongs in deployment checks, not
App-name branches or package installation inside Manager. Startup diagnostics
use bounded safe stages in the existing error contract, not raw process output.
New boot policy, structured-error API, health dashboard, rename, audio and
bwrap are deferred. No deployment or existing runtime restart was approved.
See [locked scope and gates](ubuntu-host-compatibility-release.md).

## 2026-09-14 — Close the accepted session-services train without deployment

Stable `v0.12.0` publishes the exact clean candidate from commit `3037ca136f58`.
Hosted and independent local builds are byte-identical; seven exact-archive
E2E suites and the old-stack stopped-cutover rehearsal passed before tagging.
The release workflow did not rebuild, and downloaded publication bytes match.
See [publication evidence](../tests/evidence/v1/core-session-services-0.12.0-publication.json).
The earlier rc.2 UAT/matrix evidence retains its original artifact identity;
stable acceptance follows the metadata-only promotion decision below.
No deployment alignment or runtime upgrade is implied by closing the train.
Existing local loopback endpoints remain rc.2; sandboxes/gateways are untouched.

## 2026-09-14 — Accept session services and authorize stable promotion

Operator accepted local `0.12.0-rc.2` UAT and requested formal GitHub publication.
SVC-001–010 are accepted; stable version is `0.12.0`, SDK `0.28.0`, with unchanged
App Package versions and runtime behavior. Record the accepted dirty local
archive separately from the clean stable build: they are not byte-identical.
Promotion is limited to release/build identity, documentation and evidence
sanitization. Re-run exact-archive live gates on the clean hosted candidate,
then tag its exact commit and publish those unchanged bytes. This carries the
operator's behavior acceptance through metadata-only promotion; it is not a
claim of a second human test on the stable archive. Any functional change
requires renewed testing/UAT. No deployment or runtime upgrade is implied.
See [acceptance evidence](../tests/evidence/v1/core-session-services-0.12.0-uat.json).

## 2026-09-14 — Close the saved-session evidence gap without changing policy

The completion audit found that XFCE fast logout did not prove the design's
explicit saved-session behavior. A fresh-UID test now requires actual XSMP
command/window/document restoration, current-generation environment, single
owned input services and real Viewer readback across Manager adoption. No
restore policy, activation environment, API or product binary changes. See
[evidence, repeats and retained preparation failures](../tests/evidence/v1/core-session-services-0.12.0-rc.2-xfce-saved-session.json).

Identity validation may fail closed with 409 while an injected IBus process
is exiting. The test records that transition and requires bounded stable
unavailability plus unchanged App/generation; it does not weaken process
identity checks or accept permanent failure. Final repeated runs pass, while
the earlier fast-logout evidence remains valid only for its narrower scope.
Native-IME human UAT remains the explicit acceptance gate.

## 2026-09-14 — Repaired service ownership gate and local handoff

SVC-F01–09 repairs passed the per-App dynamic matrices, exact-package live
Viewer/API/document/control suites, stopped cutover, P16, release-ci and nightly
gates. The final matrix has 361 checkpoints and 2,235 recorded HTTP assertions;
20 shuffled Go/Node runs and three fuzz targets passed. These are bounded
executed invariants, not proof of every possible interleaving or human UAT.
See [current evidence](../tests/evidence/v1/core-session-services-0.12.0-rc.2-local.json).

Both local loopback Managers select rc.2 while initially adopting the old pinned
desktop unchanged. Explicit graceful upgrade then moves the same runtime ID
to rc.2/generation 3. It does not purge HOME or replace the borrowed account
bus. A runtime's IBus pathname may remain identical across session generations;
generation plus PID/start/cgroup identities, not pathname inequality, establish
replacement. An incorrect deployment-test assertion was corrected without
repeating the upgrade or changing this contract.

Four App patch increments preserve immutable installed package bytes after an
earlier formatting-only manifest cleanup. The instrumented matrix's normalized
fixtures and Core binaries match the final installable package set; provenance
distinguishes those instrumented tests from exact-package gates. No immutable
old package was overwritten. Native-IME UAT, formal publication and sandbox
deployment remain separate; bwrap/audio are not part of this work.

## 2026-09-14 — Repair lifecycle authority and interrupted hook ownership

SVC-F01–07 supersede the permissive recovery behavior identified in the
[expanded matrix](session-services-dynamic-validation.md). Managed registration
snapshots are configuration/history, never authority for live generation or
shutdown decisions. Transport loss cannot authorize closing a surviving App.
Observed session failure survives Manager loss; explicit recovery remains
distinct from replaying an interrupted runtime replacement. Restart reserves a
new generation before the next on-attach activation (gaps are valid); queued
requests carrying the old generation must fail before teardown.

App readiness PID may identify a Driver child. Validate App and Driver in the
locked session cgroup independently, excluding Core service identities.
Upgrade target startup resumes its original bounded owner/deadline instead of
launching a replacement merely because it is not ready yet.

A temporary Manager subprocess uses a private parent-liveness pipe and Linux
subreaper ownership for one shutdown hook. It reaps only that hook's descendants,
including setsid/double-fork children, on completion/cancellation/Manager death.
It does not own the application, session supervisor or account bus. No fifth
binary, daemon, package dependency or public API is introduced. Existing refusal
and host-force policy remain authoritative. Tests and local-only verification
are in progress; prior failed evidence is retained, not reclassified.

Follow-up SVC-F08/F09: keep signal handling installed throughout supervisor
cleanup, including repeated TERM. Record private X endpoint inode/device and
VNC PID/start ownership after server startup. Whole-runtime cleanup may remove
only those verified dead endpoints, never arbitrary stale-looking X sockets.
Without proof, leave them for explicit operator diagnosis. VNC/session event
ordering must record application failure before managed server recovery; a
display fault is not consent to launch a new App. No public API/model field is
added by the X ownership record.

## 2026-09-13 — Expand per-App state coverage; withhold stability acceptance

The operator requires restart/upgrade/fault combinations and state-aware API
assertions per real template. Earlier generic fixtures do not establish that
matrix. A new disposable-UID harness preserves failed outcomes, while testing
other Apps independently. It has exposed SVC-F01–07; see
[analysis](session-services-dynamic-validation.md). No product fix, policy
change or redeployment is implied by this test-only follow-up. The earlier
local UAT handoff remains deployment history, not current stability acceptance.

## 2026-09-13 — Verify Core-owned services and complete local clean cutover

SVC-001–010 automated gates passed and the frozen working-tree candidate was
deployed only to local loopback 1991/2992. Old runtime schema/pins are not
migrated online. Retire old registry records after graceful stop, preserve
managed configuration intent and persistent HOME, then start the complete new
Core/App catalog. The real desktop did not require force. New runtime IDs
require reopening the Viewer; within the new architecture, actual attached
Viewer/Manager restart tests preserve supervisor, Driver, service identities
and generation. Raw SDK/RFB input survives private IBus/engine loss while
Unicode requests fail explicitly; fault injection used disposable Apps only.

P16 accepts measured bounded overhead, not a speed improvement: +4.18 MiB,
one process, +530/+543 ms median fresh/warm launch. All locked thresholds pass.
Live suites must run serially because distinct HTTP ports do not prevent
dynamic X display collisions. Preserve failed-attempt dispositions; do not
infer that an early Firefox 100 ms readback failure was a product fix.
Human UAT is still pending, including native IME and desktop usability.
See [candidate evidence](../tests/evidence/v1/core-session-services-0.12.0-rc.1-local.json).

## 2026-09-13 — Lock Core-owned services and one stopped-system cutover

Operator locked SVC-001–010 and authorized development, comprehensive tests and
deployment to local loopback 1991/2992 for UAT only. No sandbox or publication.
This supersedes the proposed status of the two entries below. Core candidate
is 0.12.0-rc.1, SDK 0.28.0 unchanged; all seven App versions change together.

Use `session.services: core-v1`, session-lifetime input and runtime schema 2.
Reuse the pinned status binary as the same-unit supervisor; remove the shell
input-owner helper and Driver-owned startup/cleanup. Keep independent private
service observations, preserving the App/connection revision contract and the
existing canonical environment process (never substitute the supervisor).
Durably record startup generation before launching; after Manager loss resume
the original deadline/generation rather than relaunching a still-starting App.
The Manager commits running only after both App and supervisor readiness.

Shutdown hooks retain refusal/enforcement authority. Mixed systemd killing and
PID/start-time/cgroup-checked pidfd signals bound cleanup without broad kills.
Borrow the account bus; never kill or replace it. Real fault injection showed
that a GTK App can exit itself after private D-Bus loss: retain the service
cause and report failure, not a user exit. IBus/Unicode-only failures preserve
the live App and raw input; no transparent service replacement is promised.

The test matrix, fixed measurement thresholds and clean-cutover procedure are
in [the release design](session-services-release.md). UAT remains pending.

## 2026-09-13 — Replace legacy service compatibility with a clean cutover

Status: proposed, not locked or implemented. Operator clarified that the
session-services train must not maintain the old internal architecture. This
supersedes the legacy/Core launch branch and old pinned-runtime support in
the earlier proposal below; it does not change accepted historical releases.

Revise SVC-007/009/010 to use one mandatory Core-owned launch path across all
seven packages. Stop the old system, preserve persistent App data and managed
configuration intent, retire old runtime state only after its processes exit,
and switch the complete Core/package set before launching new runtimes.
Do not promise old runtime IDs, sessions or Viewer connections survive this
architecture transition. No force stop or actual deployment is authorized by
this clarification. Within the new architecture, Manager restart/adoption and
version pins remain required; public API/SDK behavior remains the regression
baseline. Bwrap remains entirely excluded. See
[revised design and cutover](session-services-release.md#clean-cutover-not-dual-stack-migration).

## 2026-09-13 — Propose Core-owned session services without bwrap

Status: proposed, not locked or implemented. Operator requested requirements
and design, explicitly excluding bwrap. SVC-001–010 transfer input-service
ownership from Driver calls to a pinned Core supervisor inside the existing
session unit. This is independent of the broader sandbox TODO: no namespace,
mount, network isolation, relay, permission system or associated gate belongs
to this train. It does not claim a new security boundary.

Retain runMode and borrowed user-home D-Bus, canonical application identity,
App control/SDK contracts, graceful/blocked shutdown and Manager-independent
runtime pins. Observe App exit separately from service liveness. Input failure
must not silently restart an app or weaken adoption identity checks. Introduce
an explicit legacy/Core launch contract and keep old pinned runtime support;
do not change a live service topology through a mutable current helper path.
Separate service health from application state and retain existing host stop
policies. Exact compatibility fields and measured thresholds require review
before lock. See [requirements and design](session-services-release.md).

## 2026-09-13 — Viewer readiness presentation is separate from transport

SDK-005/006 and CON-011 add a default-on, per-Viewer connection curtain. Existing
`connected`/connect promises retain their transport semantics; current-generation
App readiness and an actual noVNC target-canvas paint additionally gate the mask.
Use a reviewed adapter outside upstream source, scoped callbacks, a bounded wait
and no pixel-content heuristics. Opt-out does not reconnect; cancel disconnects
only the Viewer. See [locked design](connection-mask-release.md).

This log records durable architectural choices and their rationale. Append a
dated entry when implementation changes an invariant, trust boundary, data
model, deployment topology, or lifecycle. Do not rewrite an accepted decision;
mark it superseded and link the replacement.

## 2026-08-28 — Canonical document ownership precedes LibreOffice lock cleanup

Status: implemented in driver 2.0.1; sandbox live validation complete.

Treat LibreOffice's `.~lock.<filename>#` as application state, not as the
cross-runtime ownership primitive. Before inspecting or removing that lock, a
session atomically creates a private lease directory keyed by the canonical
document path and records its driver PID. A live owner rejects a second
RemoteXApp launch; a dead owner permits bounded stale-lease recovery. `fuser`
also rejects a document held by an older driver or an external local process.

Cleanup removes a lease only when its recorded PID is the current driver and
removes a document lock only after this session acquired ownership. This avoids
the previous race where two starts could each remove the other's lock and where
a new driver could disturb an already-running pre-lease session. The readiness
loop retains a margin below the manager's deadline so these preflight errors
remain precise API failures. See LBO-009.

## 2026-08-28 — Temporary LibreOffice starts immediately and stops destructively

Status: implemented in driver 2.0.0; sandbox and formal isolated local live
validation complete, with human UAT pending.

Start the LibreOffice session as part of instance creation instead of waiting
for the first RFB attachment. The driver publishes distinct profile, input,
application, and document loading stages; creation completes only after the
exact document owns a visible window and responds through UNO. This keeps the
normal browser connection after the X11/Matchbox/application startup sequence.
It also makes create latency include application readiness (about nine seconds
in the five-run sandbox sample). Dynamic resize remains enabled.

Initialize a new ephemeral profile from a repository-versioned seed, but keep
only portable setup-complete and locale settings. Do not commit the complete
generated sandbox profile because it contains host-specific Java selection,
build markers, and bundled sample data. The measured full seed did not improve
startup time, so the seed is a deterministic first-run configuration rather
than a performance optimization.

Repeat exact-path file validation at session launch to cover changes between
allocation and execution, but never resolve the manager-authorized canonical
path to a new target. Reject final-component symlink replacement and open with
`O_NOFOLLOW`, then remove the exact LibreOffice lock or fail before starting the
application. Normal stop intentionally sends `SIGKILL` to the
pinned readiness PID and verifies lock removal. It never sends Ctrl+S or opens
a save prompt; callers must save through UNO before stop if changes matter.
This LibreOffice-specific decision supersedes only the native Alt+F4 shutdown
sentence in **Authorized file launch and loopback application control** below.
The common host-level blocked-shutdown policy remains unchanged for other
templates. The sandbox candidate used provisional version 1.1.0; the repository
uses 2.0.0 because destructive normal stop is an incompatible lifecycle
contract. Existing runtimes remain pinned until explicit stop/start. See
LBO-001 and LBO-004 through LBO-008.

An immediate driver can reject input before publishing its readiness PID. The
manager therefore treats only a driver `error` carrying the current session
generation as a terminal readiness result, preserves the driver's cause, and
stops the failed runtime without waiting for the outer 20-second deadline.
Readiness PID success takes precedence, and stale-generation status cannot end
a later startup.

## 2026-08-28 — Firefox automation uses native loopback WebDriver BiDi

Status: implemented in rc.20; automated local release validation complete.

Declare `webdriver-bidi` as a distinct application-control protocol rather
than disguising browser automation as generic TCP. The manager allocates one
collision-checked port, fixes its address to `127.0.0.1` and its path to
`/session`, persists the resolved endpoint with the runtime, and returns the
address, port, and complete WebSocket URL in both the instance and validated
driver status. Session and shutdown drivers receive the same control
environment as the rest of the locked launch contract.

Firefox starts with only `--remote-debugging-port`; do not add host, origin, or
system-access relaxation flags. Ready requires a visible PID-owned browser
window plus an actual WebSocket handshake and successful BiDi
`session.status` response. WebDriver BiDi has browser-level authority and no
independent authentication, so it remains a same-host interface and is never a
manager route or reverse-proxy target. See FFX-005 and FFX-006.

## 2026-08-28 — Long-vacant persistent Firefox uses an unmanaged singleton

Status: isolated local E2E passed in rc.18; pending human Firefox UAT.

Do not weaken the managed-instance invariant that a durable registration owns
a restartable server and therefore cannot select `stop-instance` as its idle
action. The shared Firefox requirement needs the opposite outcome: after six
detached hours, both server and application must end, while browser state must
survive. Model it as an anonymous singleton `firefox-esr` runtime with
`runMode: shared` and default profile `default`. The manager's existing durable
runtime manifest preserves restart adoption while active; vacancy removes the
manifest and complete runtime, and the next create receives a new runtime ID
that resolves to the same profile directory.

Singleton prevents two Firefox processes in this manager from concurrently
opening the profile. It does not create a tenant boundary: attached clients
share cookies and browser state and must trust one another. The template uses a
dynamic display, on-attach session, Matchbox, private session D-Bus/IBus, a
visible-window readiness gate, and the common bounded graceful-close protocol.
It sets Firefox's supported `MOZ_APP_REMOTINGNAME` runtime override so Ubuntu
packages cannot make the input allow-list depend on an ESR train suffix.
Complete instance stop always removes its runtime directory, regardless of
workspace mode, but removes HOME only for an ephemeral workspace. See FFX-001
through FFX-004.

## 2026-08-28 — Stable LibreOffice template identity

Status: implemented and deployed to the sandbox real-user service in rc.17;
pending human LibreOffice UAT.

Expose both the template ID and public template name as exactly `libreoffice`.
Downstream launch requests continue to use the ID, while catalogs and operator
interfaces may display `name`; keeping both stable prevents an integration from
depending on the former descriptive label. This refines LBO-001 without changing
the template's driver, display, lifecycle, file authorization, or UNO contract.

## 2026-08-28 — Authorized file launch and loopback application control

Status: implemented and deployed locally in rc.16; pending human LibreOffice
UAT.

Add a first-class `file` template parameter rather than treating a host path as
an unrestricted string. The manager resolves symlinks before allocating any
runtime resource, accepts only readable regular files below an
administrator-owned document-root allow-list, and persists the canonical path
with the launch snapshot. The default allow-list contains only
`STATE_DIR/documents`; `REMOTEXAPP_DOCUMENT_ROOTS` can select existing absolute
roots for an intentional deployment.

For templates declaring generic `control.protocol: loopback-tcp`, allocate and
persist one port per active runtime. Return the number in the instance and
validated application-status response so trusted same-host control code can
connect, but do not reverse-proxy or authenticate the application protocol.
The LibreOffice driver uses that generic resource for UNO. UNO permits powerful
application operations, so loopback and the manager's Unix-identity boundary
remain mandatory. Readiness proves both a visible window and that the exact
requested document is the active UNO component. A graceful Alt+F4 may preserve
an unsaved document indefinitely under host policy; after an explicit force,
the driver bounds TERM and kills only its own residual LibreOffice processes.
See LBO-001 through LBO-004.

## 2026-08-28 — Health-checked adoption from locked runtime manifests

Status: accepted; supersedes the cold-restart portion of the unified-manifest
decision immediately below.

Treat a runtime manifest as durable ownership of both the process identity and
its immutable launch snapshot. On manager restart, validate the exact recorded
units, X display, gateway health, readiness PIDs, Unicode socket, dependencies,
session state, and blocked-shutdown metadata. Adopt a complete healthy managed
or anonymous runtime without replacing its units or application session, reset
only transient client count, and reinstall lifecycle observers and timers.

If validation fails and no recorded application is alive, stop the exact units
and recreate the same runtime ID from the manifest's locked template and
components. Preserve a still-live session for graceful host policy. Do not use
the new manager catalog for recovery: a driver update still requires an
explicit stop/start transition. This preserves live applications across routine manager
and binary upgrades without adding a separate takeover database or weakening
the immutable driver boundary. Browser sockets still disconnect with the HTTP
manager and recover through the SDK reconnect policy. See RTM-007 through
RTM-009 and [`runtime-manifest-design.md`](runtime-manifest-design.md).

## 2026-08-28 — Unified active-runtime manifests and cold restart

Status: superseded by the health-checked adoption decision above. The unified
manifest, first-migration, durability, and cleanup decisions remain active;
only unconditional cold recreation is superseded.

Store every active managed and anonymous runtime in one schema-versioned,
mode-0600 JSON manifest directory. Keep managed registrations as desired state
and link them to the runtime by ID. Keep the former embedded managed snapshot
as a non-authoritative, one-release rollback projection for rc.15; new code
uses the manifest. Write the manifest durably before starting the first unit
and remove it only after successful explicit teardown.

Treat manager restart as the driver upgrade boundary. Stop the exact units from
each manifest and recreate the runtime with the same ID from the current
catalog; do not implement live process, session, or WebSocket adoption. On the
first restart, convert trustworthy embedded managed snapshots, stop and clear
pre-manifest anonymous runtime directories, preserve profiles, and let normal
autostart recreate configured services. This is the smallest deterministic fix
for issue #4 and avoids maintaining two persistence and recovery models. See
[`runtime-manifest-design.md`](runtime-manifest-design.md).

## 2026-08-27 — Keep obsolete PoCs in Git history only

Status: implemented.

Remove the frozen WebRTC, FFmpeg, go2rtc, raw WebSocket, browser input A/B, and
legacy deployment prototypes from the release branch once the noVNC product
path and regressions are accepted. Preserve measured tests and production
evidence under `tests/` and `docs/`; Git history remains sufficient for future
transport research without presenting obsolete code as a supported component.

## 2026-08-27 — Release as a self-contained Apache-2.0 artifact

Status: implemented; publication pending.

License the project under Apache-2.0 and retain complete notices and license
texts for code copied into the release. Both the archive and installed
immutable share release retain complete corresponding noVNC source. Publish a deterministic Linux archive
and checksum only from an exact `v<VERSION>` tag after metadata, build, test,
race, provenance, E2E, and human-UAT gates. Merging `main` does not publish.

The public browser dependency is the manager-served, same-origin
`/sdk/index.js`, not an npm package, copied SDK source, or generated hashed
asset. This keeps the SDK and its privately adapted noVNC graph matched to the
manager version. A reusable Go library is not part of the 0.1 contract; the Go
module path is canonical so source and future tooling identify the repository
unambiguously.

## 2026-08-27 — Split physical ASCII from committed Unicode in the browser

Status: accepted.

Route a reliably identified physical printable ASCII key through RFB and
prevent its browser default so the hidden IME textarea cannot submit a
duplicate. Keep native controls and shortcuts on RFB. Keep composition commits,
direct non-ASCII text, dead or unidentified key fallback, soft-keyboard input,
and paste on the existing Unicode/IBus channel. The browser owns this decision
because only it can distinguish physical keyboard events from committed text.
This restores input in secure widgets such as Polkit without asking the server
to infer event origin from characters. ASCII paste remains an explicit IBus
fallback because clipboard text has no reliable physical keycode or layout.

## 2026-08-27 — Non-root, single-identity managers

Status: accepted.

Root may install shared immutable files, but the manager and every application
run as one fixed non-root UID. Support either a locked `remotexapp` account or
an independent manager in an approved real user's systemd service manager.
Reject a privileged orchestrator that accepts a target user and calls `sudo` or
`su`: it would enlarge the trust boundary and complicate state, socket, and
process ownership. Separate mutually untrusted tenants by UID or container.

## 2026-08-27 — Reviewed noVNC vendoring with update PRs

Status: accepted.

Vendor the complete required source graph and provenance for a stable upstream
release instead of using a submodule, moving branch, or runtime download. One
RemoteXApp commit therefore determines the browser code exactly. A scheduled
workflow may open a draft update PR, but maintainers retain the compatibility,
license, regression, and UAT gate; updates never auto-merge. The detailed
boundary is in [`novnc-upstream.md`](novnc-upstream.md).

## 2026-08-27 — Defer the Go IBus rewrite

Status: accepted deferral.

Keep the current Python private IBus engine behind its narrow owner-only Unix
socket. A Go implementation appears feasible, but duplicating the IBus engine
integration would add substantial code, native binding, packaging, and
long-term regression burden without changing the external contract. Revisit
only with measured reliability, deployment, or resource evidence that exceeds
that cost.

## 2026-08-27 — One semantic version per driver bundle

Status: accepted.

Version the server driver, session driver, and shared helpers as one unit. This
keeps compatibility understandable and avoids a dependency solver for a small
driver surface. Driver version and RemoteXApp release version remain separate
because a release can change the manager without changing driver behavior.

## 2026-08-27 — Immutable side-by-side releases

Status: accepted.

Publish exact artifacts under `releases/<VERSION>` and activate them through
paired `current` symlinks. Reject changed content under an existing release
name. This gives operators deterministic staging and rollback without copying
over live files. The installer activates selectors but does not implicitly
restart the manager.

## 2026-08-27 — Snapshot at the runtime boundary

Status: accepted.

Resolve symlinks when the manager loads its catalog and components, then store
the full resolved template and component paths on each runtime. Merely storing
`driverVersion` would identify intent but could not reproduce exact behavior
after catalog changes. A digest was deferred because immutable release paths
already solve the immediate consistency problem with less machinery.

## 2026-08-27 — Explicit update, pinned recovery

Status: accepted; extended on 2026-08-28 to both managed and anonymous unified
runtime manifests by the health-checked adoption decision above.

A healthy runtime is adopted using its saved snapshot, and a failed runtime is
recreated using that same snapshot. Neither path upgrades automatically. A
managed stop/start is the update boundary and uses the current manager's
catalog. This prioritizes user-session continuity and makes rollout drainable,
observable, and reversible.

## 2026-08-27 — Persist private snapshots, expose version state

Status: superseded on 2026-08-28 by unified runtime manifests.

This decision originally made the managed registry authoritative for
`appliedSpec` and `appliedComponents`. The unified design moves authority to the
common active-runtime manifest. A non-authoritative copy remains for one
release so rc.15 rollback can read its former schema. Semantic
applied/available reporting and private host paths remain unchanged.

## 2026-08-27 — Fail closed for running legacy records

Status: superseded on 2026-08-28 by restart migration.

Do not guess missing anonymous launch data. The unified migrator converts
complete embedded managed snapshots, stops pre-manifest anonymous units, and
preserves profiles; a manager restart is sufficient.

## 2026-08-27 — Managed registration reserves autostart

Status: accepted.

Any managed registration, not only one with desired state `running`, suppresses
anonymous `server.activation=auto` for its template. The registration owns the
stable identity and display allocation; starting an anonymous runtime while it
is stopped would violate operator intent and can collide with fixed resources.

## 2026-08-27 — Manual retention before automated garbage collection

Status: accepted interim decision.

Keep the active release, previous release, and all runtime-referenced releases.
Deletion remains an audited operator task until the system can enumerate and
validate every reference. Automatic garbage collection without that proof
would risk breaking failure recovery.

## 2026-08-27 — Clean exit is an early idle transition

Status: accepted.

Do not add a second template action for user close/logout. A driver-confirmed
clean exit immediately reuses `idleAction`: `stop-instance` removes the runtime,
while `stop-session` and `keep` retain its server layer. This avoids conflicting
policy combinations and preserves the existing meaning of runtime retention.

## 2026-08-27 — Driver mechanism, host-owned shutdown policy

Status: accepted.

The versioned driver owns the application-native close mechanism because only
it understands save prompts and application APIs. The administrator owns grace,
warning, and optional force deadlines because these are resource-retention and
data-loss decisions. Templates and instance overrides cannot weaken them.
Blocked shutdown preserves the session and permits reconnection; force remains
explicit and observable. See
[`graceful-shutdown.md`](graceful-shutdown.md).

## 2026-08-27 — Native X11 close and deterministic managed force convergence

Status: accepted.

Application shutdown targets only visible windows and sends Alt+F4. Sending
`_NET_CLOSE_WINDOW` through `xdotool windowclose` destroyed Mousepad's hidden
GTK window under Matchbox and converted a normal exit into an X11 error.
Host-deadline force also completes managed desired-state reconciliation in the
same lifecycle critical section; cgroup events remain wakeups and are not the
sole correctness mechanism for durable convergence.

## 2026-08-27 — Session IPC belongs in the per-runtime user directory

Status: accepted.

Private D-Bus, IBus, and Unicode sockets use
`/run/user/<uid>/remotexappd/<runtime>/`. A session bus in `/tmp` is invisible
to a production manager with `PrivateTmp=yes`, even though its address can be
persisted. Keeping all session IPC in the existing runtime socket directory
preserves systemd hardening and makes version-pinned shutdown hooks reliable.

## 2026-08-27 — Readiness and hook deadlines include observable margins

Status: accepted.

Single-application drivers do not publish `ready` until `xdotool` observes a
visible PID-owned window. Shutdown hooks reserve one second inside the
manager-owned deadline so they can publish a precise blocked result instead of
racing the outer context timer. These margins are part of driver behavior and
therefore require a driver-version bump.

## 2026-08-27 — Terminal SDK state wins over reconnect

Status: accepted.

When a channel closes, the SDK checks the manager's instance state before
attempting another transport connection. A driver-confirmed terminal exit
emits one `sessionended` event and disconnects intentionally. The terminal
condition is keyed by instance and session generation so a normal exit cannot
be misreported as repeated reconnect errors, while a later generation remains
eligible for its own terminal event.

## 2026-08-27 — Trusted real-user environment is a template mode

Status: implemented; live UAT pending.

Use one `runMode` rather than independently configurable profile, D-Bus, and
Xauthority modes. `shared` and `isolated` preserve the profile-backed HOME,
private session bus, and profile Xauthority behavior. `user-home` atomically
selects the manager account's passwd HOME, `/run/user/<uid>/bus`, and
`~/.Xauthority`; the API cannot supply paths or select another identity. It
requires a fixed-display, persistent singleton managed instance, and active
ownership is unique within the manager.

The session reuses but never owns the user D-Bus. It still owns its IBus daemon
and Unicode engine, so generation cleanup cannot terminate unrelated user
services. `xauth add` updates only the fixed display record and preserves SSH
forwarding and other display cookies, allowing `DISPLAY=:1 app` from an SSH
login. Deleting the registration preserves both the Unix HOME and Xauthority;
`purge=true` is rejected before state changes. This provides a dedicated
real-account desktop without root orchestration or cross-user switching.

## 2026-08-27 — Trusted real-user environment accepted after UAT

Status: accepted.

Automated dedicated-account deployment, SDK/RFB/input reconnect, default user
D-Bus, and `~/.Xauthority` behavior passed, followed by human UAT acceptance.
The `user-home` mode and `xfce-user-desktop` template therefore satisfy the
release gate without changing their single-identity trust boundary.

## 2026-08-27 — Release confidentiality is a publication invariant

Status: accepted.

Release source and archives must contain neither credentials nor private
deployment identifiers, document names, or user content. Fast repository-
specific checks run locally and against the packaged archive; GitHub CI also
uses a dedicated scanner over full history. Recorded performance values remain
tracked, but hostnames and HOME paths are anonymized. A detected private value
blocks tagging, and an already-committed value must be removed from reachable
history before publication.

## 2026-08-27 — User-home desktop display policy is template-owned

Status: accepted after isolated browser validation and human UAT.

Only the default `xfce-user-desktop` template fixes its framebuffer at
1280×720 and disables TigerVNC desktop-size requests. The manager rejects
`geometry` and `allowClientResize` overrides for that template, while other
templates retain their existing override behavior. The SDK treats a resolved
server policy that disables resizing as authoritative even when a caller asks
for `resize: 'remote'`, so viewport changes scale rather than resize the fixed
framebuffer.

## 2026-08-27 — Automatic reconnect has an explicit per-cycle budget

Status: accepted after isolated browser E2E and human UAT.

SDK 0.12 adds `maxReconnectAttempts`, which is `Infinity` by default and
otherwise accepts a non-negative integer. Only scheduled automatic attempts
consume the budget; the initial connection does not. Success and explicit `connect()` or
`reconnect()` calls reset the cycle. Exhaustion is terminal for that cycle: the
SDK closes residual channels, stops timers, remains disconnected, and emits
one `reconnectexhausted` event. Intentional disconnect, destruction, and a
driver-confirmed clean session exit continue to bypass automatic retry.

## 2026-08-27 — Browser deployment prefix is inferred, not server-owned

Status: accepted after isolated nginx/browser E2E and human UAT.

The external reverse proxy may mount RemoteXApp below any same-origin path and
strips that prefix before forwarding to the manager's unchanged root routes.
SDK 0.12 infers the prefix from `import.meta.url`; the stable loader imports its
hashed bundle relatively, and API, assets, viewer, health, RFB, and input URLs
all use the inferred manager base. Built-in pages derive or preserve the same
browser-visible prefix. Explicit `baseURL` remains an override, and root
deployment remains the empty-prefix case. No forwarded-prefix header or CORS
policy is introduced.

## 2026-08-27 — Built-in web pages are optional exposure surfaces

Status: accepted after isolated deployment validation and human UAT.

Global administrator environment policy independently disables the built-in
console surface (`/`, console, and minimal example) and instance kiosk. Disabled
pages return 404, attach does not advertise a dead kiosk, and public instance
records omit `viewerUrl`. Stable SDK/type assets, control APIs, instance health,
and RFB/input/cursor channels remain available for downstream-owned viewers.
Both controls default to enabled behavior for upgrade compatibility.

## 2026-08-28 — rc.15 requirement-bundle automated gate passed

Status: accepted.

The full release and race gates passed, and the Linux artifact was packaged.
An isolated real XFCE/TigerVNC/noVNC browser held its framebuffer at 1280×720
while the viewport changed. Finite reconnect exhausted exactly once at its
configured limit and recovered after an explicit reconnect; unlimited retry
continued until intentional disconnect. A real nginx prefix mount carried the
SDK, assets, API, health, RFB, and input channels without an explicit base URL.
Separate live manager processes verified both web-surface switches together
and independently, including kiosk URL redaction while SDK/API/health remained
available. Machine-readable evidence is
`tests/go-live-validation/results/requirement-bundle-rc15-local.json`.

Human visual and interactive UAT was accepted by user confirmation on
2026-08-28. DEP-010 through DEP-012 and SDK-001 through SDK-003 therefore meet
the rc.15 publication gate.

## 2026-08-28 — Shipped driver executables are deployment prerequisites

Status: implemented; deployment verification passed.

The Mousepad and Edge session drivers execute `matchbox-window-manager`, so a
host without that binary cannot run every shipped template even when the
manager itself starts successfully. Deployment preflight now requires the
binary and names the Ubuntu `matchbox-window-manager` package as remediation.
The sandbox00 user deployment installed and verified version
`1.2.2+git20200512-1build1` without changing its default XFCE window manager.

## 2026-08-28 — Primary-pointer position is the pre-caret IME fallback

Status: accepted in SDK 0.15; deterministic, isolated-stack, and port-1991
automated validation passed, with native candidate-window UAT accepted on
2026-08-29.

The hidden textarea starts and first receives focus at the browser's upper-left
corner. Although the current pointer path moves its DOM rectangle to every
click, focusing an already-focused element does not reliably refresh the native
IME candidate anchor. The guarded remote-caret path forces layout and renews
focus, which explains why the candidate UI can remain in the corner until that
caret arrives.

Before a fresh valid remote caret is available, use the most recent primary
mouse or equivalent touch/pen activation over the remote canvas as the native
IME anchor. Right and middle buttons do not imply a new insertion caret and
must not replace it. A fresh remote caret remains authoritative. Geometry is
renewed only when composition and queued/in-flight text permit a safe focus
transition; active composition must never be blurred or refocused merely to
improve popup placement.

The implementation forces layout and renews hidden-textarea focus immediately
for a safe primary pointer. Its fallback remains correlated beyond the 750 ms
recovery window, so a later fresh caret can still supersede it. SDK tests cover
mouse, touch, pen, excluded buttons, late caret, and unsafe text states. P15's
real Chrome/Mousepad/IBus path made the click anchor effective immediately and
replaced it with a fresh caret in 33.8 ms without changing focus during a
synthetic composition. Native candidate-window placement remains a human gate.

## 2026-08-28 — Remote resize is caller-scheduled and locally scaled

Status: accepted in SDK 0.15; P15 and port-1991 automated E2E passed, with
interactive resize-appearance UAT accepted on 2026-08-29.

noVNC 1.7 currently limits remote resize requests to one in flight and no more
than one every 100 ms. That is a fixed throttle, not a trailing debounce, so a
long window-resize gesture can repeatedly resize the remote X desktop and make
applications reflow, flash, or render transiently corrupted frames.

The stable SDK should add millisecond `resizeDebounce` and `resizeMaxWait`
options plus `flushResize()`. Zero debounce preserves compatibility. A positive
debounce submits after a quiet period; finite maximum wait permits periodic
progress during a long gesture, while `Infinity` sends only the trailing final
size. An embedding UI that observes gesture completion can flush immediately.
Initial connection and reconnection still negotiate the current size without a
delay.

The old framebuffer is locally scaled while a remote request is pending. The
scheduler must coalesce equal sizes, retain the newest size across an in-flight
request, and cancel stale timers at a connection-generation boundary. Fixed or
scale-only policy remains authoritative. Keep this integration outside the
vendored noVNC tree: the public contract belongs to `RemoteXAppClient` and the
declarative element, while any required private noVNC adaptation remains in the
guarded `assets-src/novnc-entry.js` boundary.

The implementation uses `assets-src/novnc-resize-bridge.mjs` as that guarded
boundary. `make novnc-check` validates every private field/method it consumes
against the pinned noVNC release, and application SDK code does not access
those fields directly. P15 proved default compatibility in 63.54 ms, held the
remote framebuffer unchanged through a four-step burst while scaling it
locally, made finite 400 ms maximum-wait progress at 440.20 ms, flushed before
the configured debounce, and performed immediate reconnect negotiation. Timer
ownership, in-flight convergence, fixed policy, and duplicate suppression are
covered deterministically.

## 2026-08-29 — Explicit managed force overrides a blocked shutdown

Status: implemented; automated regression and isolated live E2E passed.

A normal managed desired-stop preserves a `shutdown-blocked` session so the
user can reconnect and resolve unsaved work. Repeating that desired state with
`force: true` is an operator override, not a no-op merely because the durable
desired state is already `stopped`. The reconciler therefore preserves a
blocked runtime only for non-forced requests. A forced request follows the
existing durable stop-intent path, bypasses the application hook, tears down
the complete runtime, removes its manifest, and converges the managed record to
`observedState: stopped`.

On manager restart, a managed desired-stop with a blocked session remains
adoptable while its runtime manifest still says `desiredState: running`; that
combination means graceful shutdown blocked before destructive intent was
authorized. If the runtime manifest already says `desiredState: stopped`, a
force was durably committed and restart must finish cleanup instead.

## 2026-08-29 — Proposed sandbox00-only experimental status commands

Status GET remains a durable, side-effect-free snapshot. A proposed, separately
flagged POST under the status namespace would accept structured argv and execute
it with the exact active application session environment, returning one bounded
transient result without changing the durable status revision. The initial WAOS
consumer would run only `/usr/bin/env -0` to discover graphical environment
values before composing an Agent task.

This is intentionally characterized as same-UID remote execution. Direct argv
avoids implicit shell parsing but does not prevent a caller from choosing a
mutating executable. The experiment therefore defaults off, is limited to
sandbox00, binds every execution to a live session generation, caps time and
output, kills the complete transient scope, and forbids command/output logging
or persistence. Broader deployment requires a new security checkpoint and a
decision to remove it, isolate it as operator tooling, or replace it with named
schema-validated probes. See EXP-001 through EXP-006 and
[`experimental-status-command-requirement.md`](experimental-status-command-requirement.md).

## 2026-08-29 — Accepted generic canonical environment process

Environment lookup must not reconstruct a session from manager fields or add
template-specific Go branches. Every template's existing
`session.readinessPid` now also identifies its canonical application or
session-owner process. The manager resolves that runtime-local file uniformly,
validates its live PID against the current generation, exact session cgroup and
non-root runtime UID, then treats `/proc/<pid>/environ` and `/proc/<pid>/cwd` as
the process's initial exec environment and working directory.

This keeps the template responsibility small: a driver publishes the stable
real application or session-owner PID, not an expendable launcher. It also
avoids persisting a secret-bearing environment snapshot. The contract does not
claim that Linux exposes environment mutations made inside a process after
exec. EXP-007 is required in the 0.1.0-rc.23 release train; the broader
free-form execution proposal in EXP-001 through EXP-006 is not included by
that scope decision. See EXP-007.

## 2026-08-29 — Accepted EXP-007 response contract

The rc.23 public surface for EXP-007 is the named read-only
`POST /api/instances/{id}/status/environment` operation and the SDK's
`getApplicationEnvironment()` method. A successful result contains the exact
instance ID, session generation, application state, complete environment map
and canonical process working directory. It contains no process ID, stdout,
stderr or exit code and does not execute `/usr/bin/env` or another program.

The environment is sensitive and atomic: success returns every initial exec
variable without filtering or truncation; an unreadable, unrepresentable or
oversized environment fails as a whole. Neither the manager nor SDK may log,
cache, diagnose or persist it. It is available only through authenticated
`trusted-header` mode or a loopback manager listener; unauthenticated public
development listeners reject it even when explicitly enabled. This named
response completes EXP-007 without
bringing the free-form execution proposed by EXP-001 through EXP-006 into the
rc.23 release train.

## 2026-08-29 — Manager shares the host mount namespace for EXP-007

Local rc.23 deployment showed that systemd filesystem isolation such as
`PrivateTmp`, `ProtectKernel*`, `ProtectHome` and `ProtectSystem` creates a
mount namespace from which Linux denies reads of a same-UID sibling session's
`/proc/<pid>/environ`. The shell could read the same process, while the hardened
manager reproducibly received `EACCES`.

The shipped manager units therefore no longer use mount-namespace hardening.
They remain non-root and retain `NoNewPrivileges=yes`, restricted address
families, `RestrictSUIDSGID`, `RestrictRealtime` and `LockPersonality`; the
system service also retains an empty capability set. This narrowly supersedes the
2026-08-27 assumption that manager `PrivateTmp` remains enabled; the earlier
decision to keep session IPC under `/run/user/<uid>/remotexappd` remains valid.
Deployment checks reject reintroducing a manager filesystem namespace because
it would silently break EXP-007.

## 2026-08-29 — Shipped templates use the stable session owner for EXP-007

Six-template live validation found that Microsoft Edge overwrites its initial
environment memory with a process title. Its browser PID consequently exposed
one non-environment procfs entry and correctly caused the atomic EXP-007 lookup
to return `422`.

All shipped session drivers now publish their own stable shell PID through the
existing configured `session.readinessPid`; this process receives the exact
manager-provided template environment and remains alive while supervising the
application. Application PIDs move to private `*-process.pid` files used only
by readiness and application-specific shutdown drivers. The manager remains
fully generic and never knows these private filenames. Driver versions are
bumped because the readiness/shutdown bundle contract changed.

## 2026-08-29 — Explicit insecure-public opt-in applies to EXP-007

The rc.23 sandbox00 deployment exposed a configuration contradiction:
`auth-mode=none` on `0.0.0.0:1991` already required the administrator to set
`allow-insecure-public`, but EXP-007 ignored that explicit opt-in and always
returned `403`. The manager and SDK versions were correct and the route was
present, so the sandbox's real gateway path could not use the release's named
environment operation.

Rc.24 makes the existing opt-in authoritative for EXP-007. The default remains
closed: a non-loopback unauthenticated configuration without the flag is
rejected at startup and the environment operation also rejects such a manager
in direct tests. With the flag enabled, the operation is available like the
rest of the unauthenticated API. This does not authenticate a caller or make
the topology production-secure; the surrounding sandbox firewall and gateway
become the access boundary for the complete secret-bearing response. This
narrowly supersedes the rc.23 decision that EXP-007 ignores
`allow-insecure-public`; all PID, UID, cgroup, generation, atomic-response and
no-persistence checks remain unchanged.

## 2026-08-29 — Lock the narrowed independent App Package major train

Status: accepted and scope-locked; version not assigned. This
decision refines the initial proposal after primary-source extension-system
research and a direct review of WAOS Browser, File Editor, Desktop, and its
RemoteXApp release lock.

The original template/driver goal is stronger than keeping application names
out of one Go switch: an ordinary App must be installable after the core is
built, without recompiling or editing the manager, gateway, status helper,
browser SDK, global preflight, or unrelated templates. Current protocol-
specific control handling, scalar-only status, the `xfce-user-desktop` policy
branch, fixed readiness deadline, global dependency list, and application-aware
manager tests violate that boundary. Current managed lifecycle restrictions
make the locked Edge policy awkward, but do not prevent independent package
installation and therefore do not belong in this train.

The next major train therefore introduces a trusted immutable App Package with
one `apiVersion: remotexapp/v1` boundary. Packages are deterministic `.tar.gz`
artifacts verified by SHA-256; runtime manifests pin their ID, version, digest,
and canonical installed path. The manager validates a small strict core schema
but passes optional `driver.config` JSON without interpreting it. This follows
the useful parts of CNI-style versioned JSON/executable contracts and OCI-style
content identity without adopting a new plugin process or registry.

V1 allocates only named loopback TCP ports, not arbitrary generic resources.
Drivers own application launch, window/protocol readiness, control metadata,
exit, and cleanup. Bounded JSON status carries opaque CDP, BiDi, or UNO
information. Override permissions and readiness budgets become declarative;
dependencies are limited to executable and Python-module capability checks.
RemoteXApp never solves or installs operating-system packages.

The original proposal coupled this package boundary to a full managed/
anonymous lifecycle redesign. That work is now deferred as APP-008. V1 retains
the existing lifecycle meanings and coherent `isolated`, `shared`, and
`user-home` environments; Edge may use the existing anonymous singleton-
persistent pattern. RPC/gRPC plugins, OCI registries, mandatory signatures,
arbitrary resource registries, hot reload, and a full JSON Schema engine are
also outside V1.

Manager restart remains the catalog activation boundary. Microsoft Edge is the
reference package and must prove dynamic loopback CDP plus visible-window/
protocol readiness without a core protocol branch. Firefox, LibreOffice,
Mousepad, and both XFCE templates then migrate. WAOS receives one coordinated
breaking envelope migration but keeps its application-specific BiDi, CDP, and
UNO adapters; Desktop remains generic. Future packages affect WAOS only when it
intentionally adds application-specific behavior. The build-once synthetic-
package test is the defining release acceptance criterion. See APP-001 through
APP-013 and
[`app-package-major-release.md`](app-package-major-release.md).

The user accepted and locked APP-001 through APP-013 on 2026-08-29. APP-008
remains explicitly deferred. The WAOS migration guide is a required APP-006 and
APP-013 deliverable, not a new duplicate requirement. Any material scope change
requires explicit unlock approval and a new dated decision.

## 2026-08-29 — Implement App Package ABI v1 as an immutable local extension boundary

Status: implementation candidate for `0.2.0-rc.1`; final local deployment,
coordinated WAOS acceptance, and human UAT remain pending.

The implementation keeps one in-process catalog but moves all six shipped Apps
under `apps/<id>`. Installation verifies the deterministic archive checksum,
strict `remotexapp/v1` manifest, canonical package-local paths, immutable
version directory, owner/mode boundary, declared dependencies, and a content
seal before atomically changing an enabled selector. Runtime manifests pin the
exact package ID, version, path, archive/content digests, resolved policy,
allocated resources, and immutable core-helper directory. Manager restart may
therefore adopt an old healthy runtime without consulting the new selector.

Only named `loopback-tcp` resources are allocated in V1. Public instances
always expose a generic `resources` object, while driver-owned bounded JSON is
returned through current-generation application status. Protocol-specific
public control fields are removed. The manager neither synthesizes URLs nor
recognizes BiDi, CDP, or UNO. Compatibility code may read the generic shape of
an already persisted rc.24 runtime, but the new public projection never returns
its legacy fields and no new package uses the legacy control schema.

The override validator now reads only each manifest's allowlist. Readiness
budgets and executable/Python-module dependencies are package policy. Shared
input/status/window/server helpers form the immutable core ABI and are passed
through a pinned private path. The user installer now mirrors system releases
with immutable side-by-side core selectors; App selectors remain independent.

Two lifecycle defects surfaced in build-once acceptance and were fixed at the
generic boundary: dynamic port selection uses a real loopback bind so a
`TIME_WAIT` socket is not selected, and a previously blocked shutdown converges
when its application exits before host enforcement. These are core corrections,
not application exceptions. Official V1 tooling deliberately provides no
package-removal operation; disabling a selector affects only new instances,
and every version referenced by a runtime manifest must be retained.

## 2026-08-29 — Preserve core selector rollback across the V1 unit transition

Status: implementation candidate for `0.2.0-rc.1`; exact local rollback
verification is required before UAT.

The V1 catalog root, enabled-selector root, and immutable core-helper path are
systemd environment defaults rather than new `ExecStart` arguments. The V1
manager accepts the same values as explicit flags for development and tooling,
but installed services keep the pre-V1 command-line surface. A retained pre-V1
binary therefore ignores the new environment variables and can start after
both central `current` selectors are repointed. This closes the major-upgrade
rollback gap without a version-aware launcher or mutable release directory.

## 2026-08-29 — Separate gateway liveness from package-port bindability

Status: implemented for `0.2.0-rc.1` after local deployment exposed an
immediate-restart failure.

Core-owned RFB and gateway listeners support immediate rebinding, so their
collision check asks whether a listener is currently reachable. A connection
left in TCP `TIME_WAIT` is not a live listener and cannot block a fixed-display
restart. In contrast, an ordinary App Package resource may use a driver that
does not enable address reuse; named resource allocation therefore retains its
stricter plain-bind test and skips `TIME_WAIT` ports.

## 2026-08-30 — Manage RemoteXApp and WAOS as a frozen provider/consumer pair

Status: accepted for the App Package ABI V1 release train.

RemoteXApp owns the generic ABI, SDK, immutable provider artifact, fixtures,
and the complete handoff tuple. WAOS owns protocol adapters, user-facing
behavior, its integration branch, and the exact consumer lock. Ordinary App
Package changes that preserve V1 and add no WAOS-specific behavior remain
independently deployable; new specialized protocols require a coordinated
adapter task, while breaking ABI/SDK changes require a paired-major release.

The provider tuple is frozen before downstream evidence begins and includes
all source, artifact, SDK graph, API, template, protocol, and fixture
identities. Any tuple drift invalidates affected WAOS evidence even if the
version label is unchanged. Floating branches, `latest` artifacts, runtime
downloads, and copied provider source are prohibited dependency mechanisms.

For a breaking pair, both artifacts are installed side by side first. WAOS is
stopped or quiesced while RemoteXApp is selected and verified, then WAOS is
selected and started. Rollback uses the same stopped-consumer boundary,
restores both old selectors, and starts RemoteXApp before WAOS. Local
acceptance must prove rollback and restoration in both directions before any
explicitly approved sandbox00 action. This prevents a public mixed-ABI window
without adding a permanent compatibility layer or a third coordination
repository. WAOS classifies this breaking dependency transition as
`staging-required`, allocates its immutable managed tag before the first live
activation, and treats sandbox00 staging and production as separately approved
checkpoints.

## 2026-08-30 — Separate system release staging from paired activation

Status: accepted for `0.2.0-rc.4`; supersedes only the activation behavior in
the 2026-08-27 immutable-release decision.

Publishing candidate bytes must not move `current` while an old manager is
running: later session creation could otherwise load new shared files before
the paired consumer is stopped. A dedicated system stager now publishes and
validates immutable core trees and shipped App Packages without changing core
or App selectors, administrator configuration, units, or service state.
Existing package versions must match their recorded archive digest and pass a
content/dependency validation through a disposable selector directory.

The first-install workflow may still activate a reviewed release because no
old pair exists. Every upgrade of a paired deployment instead stages both
candidates first, stops the consumer, and uses the fail-closed core selector
inside the cross-repository transition. Rollback uses the same boundary. This
keeps normal installation simple while preventing a mixed-ABI window.

## 2026-08-30 — Use sealed content as the idempotent App Package identity

Status: accepted for `0.2.0-rc.4`; supersedes the archive-digest equality
detail in the system-staging decision above.

An App Package archive previously inherited the latest repository commit time,
so an unrelated core-only commit changed its transport digest despite identical
App content. Packages now use a canonical zero timestamp unless a reproducible
build supplies `SOURCE_DATE_EPOCH`. The sealed content digest—not tar metadata—
decides whether an existing `id@driverVersion` is the same immutable package.

Restaging identical sealed content is idempotent and retains the originally
installed archive digest for runtime provenance. Reusing a driver version with
different content remains forbidden. This supports one-time adoption from
pre-canonical archives while making future unchanged package artifacts stable
across unrelated core releases.

## 2026-08-30 — Make the pre-upgrade state snapshot the major downgrade boundary

Status: accepted for the App Package ABI V1 paired release.

A real rc.24 rollback rehearsal showed that its strict decoders correctly
reject V1 runtime fields. Immutable selectors can restore code, but cannot make
an older manager interpret state written by an incompatible newer schema. A
breaking paired downgrade therefore stops the consumer and manager, restores
the exact pre-upgrade root/Home state snapshot, and only then selects and
verifies the old provider before starting the old consumer. State accepted
after the snapshot is explicitly outside the downgrade guarantee.

The core selector now requires a health URL whenever selection starts the
manager. It verifies the exact target and verifies the previous version after
automatic restoration, preventing systemd's asynchronous restart behavior from
being reported as a successful activation. This decision does not change
same-version runtime adoption or compatible driver rollback semantics.

The first paired local transition then showed that recovery of stopped locked
Firefox and XFCE runtimes can legitimately exceed the former fixed ten-second
health loop. Selection now defaults to a bounded 120-second health budget and
accepts an explicit 1–600 second operator value. Timeout still fails closed and
uses the same budget to verify restoration.

## 2026-08-30 — Supersede the Edge template identity without changing core

Status: EDGE-001 through EDGE-004 scope-locked as `edge@1.0.0` on 2026-08-30;
implementation, local verification, and sandbox00 production are authorized,
while every other sandbox remains excluded.

The public Microsoft Edge App Package and template identity will be exactly
`edge`. The existing `edge-browser` package already proves the required shared
singleton, persistent `default` profile, six-hour detached stop, dynamic
loopback CDP allocation, visible-window readiness, and bounded control status.
The next train therefore migrates that proven behavior into the new package ID
instead of adding Edge branches to the manager or SDK.

The old and new IDs must never be enabled concurrently because their drivers
use the same persistent Edge profile. Migration stops and disables the old
runtime before activating `edge`, preserves the profile, restarts only the
manager, and proves old runtime/port cleanup. Since the core derives the
profile root from the template ID, the stopped profile directory is atomically
renamed from `edge-browser/default` to `edge/default`; the migration fails
closed when both exist instead of merging mutable browser state. WAOS owns the
small consumer-side adapter-key migration if it adopts the new ID. This is
coordinated application delivery, not a breaking RemoteXApp ABI pair.

## 2026-08-30 — Deploy Edge identity independently on sandbox00

Status: EDGE-001 through EDGE-004 implemented; sandbox00 production automated
acceptance passed. No other sandbox was changed.

The deployment installed the checksummed package without activating it, proved
zero Edge runtimes and clients, stopped only the production manager, replaced
the single selector, and restarted the manager. The old and new persistent
profile paths were both absent, so the fail-closed migration performed no move
and deliberately retained the unrelated historical `temporary` profile. Both
pre-existing runtimes were adopted with unchanged unit PIDs. Real viewer/CDP
acceptance and a second manager restart left no active or durable Edge test
runtime. This validates independent App delivery: the core remained rc.4 and
no core, gateway, status-helper, SDK, WAOS, staging, or other sandbox artifact
was replaced.

## 2026-08-30 — Separate release-runner inventory from dependency contracts

Status: implemented after the first unpublished rc.4 tag workflow failed before
artifact publication.

Repository source-package tests and offline immutable-staging tests validate
manifest contracts and package mechanics, so they now provide hermetic
fixtures only for executable and Python dependencies explicitly declared by
the tested manifests. The Python fixture recognizes only the manager's exact
isolated-module probe and delegates every other interpreter invocation. This
does not weaken runtime enforcement: installed catalog loading and live
preflight still resolve every executable and Python module on the real host.
The GitHub workflow installs `ripgrep`, and the sensitive-data script now fails
closed if `rg` is unavailable instead of allowing shell fallback behavior to
mask an incomplete scan.

## 2026-08-30 — Publish core and independently versioned Edge from one commit

Status: released as `v0.2.0-rc.4` and `edge-v1.0.0`.

The core release and independent Edge App Package tag resolve to the same
accepted source commit, but retain distinct artifacts and version namespaces.
The core prerelease publishes the complete Linux distribution and checksum;
the stable Edge release publishes only its deterministic App archive and
checksum. The full distribution embeds the exact Edge archive rather than
repackaging different bytes. Future independent App releases use annotated
`<app-id>-v<driverVersion>` tags and declare their compatible App Package ABI
and core version; they do not require a core rebuild when that ABI remains
compatible.

The final GitHub workflow passed only after repository and offline-staging
tests stopped treating a generic release runner as a desktop application host.
Hermetic fixtures remain confined to tests, while live catalog loading and
preflight keep strict dependency enforcement. The failed rc.4 tag attempts
never published a Release or assets; only the final tag is immutable.

## 2026-08-30 — Promote the formal core and Edge release to follower sandboxes

Status: accepted on sandbox02, sandbox03, sandbox07, and sandbox10 after
explicit operator authorization; sandbox00 was not changed.

Each follower had the same `0.2.0-rc.4` version directory from the earlier
unpublished candidate, so immutable publication could not overwrite it. With
zero clients, deployment stopped every active runtime, retained both candidate
core trees under a commit-qualified name, installed the published core
artifact, replaced `edge-browser` with the byte-identical `edge@1.0.0` release,
and recreated the managed Desktop. Existing WAOS deployments, user files, and
persistent profiles were not replaced. Sandbox10's detached Firefox runtime
was stopped through the API and its persistent profile retained for later
on-demand creation.

Every host then passed a real Edge viewer/noVNC/RFB run, dynamic resize,
reconnect, visible/CDP readiness, cleanup, closed-port verification, and final
manager-restart adoption. Fleet audit found the exact formal commit and App
seals, six expected templates, one active Desktop, zero clients, zero active
Edge runtimes/control ports, and zero warning-level manager journal entries.
The build host could not route to these remote LXD private addresses; direct
container loopback was used, without production-gateway or network-policy
changes.

## 2026-08-31 — Keep managed recovery on one durable runtime identity

Status: RTM-010 scope-locked and implemented for `0.2.0-rc.5`; local and
sandbox00 automated production acceptance passed. Human UAT and formal GitHub
publication remain pending. Supersedes the runtime-ID-change allowance in the
2026-08-27 driver lifecycle decision without changing explicit stopped-to-
running update behavior.

Issue #5 proved that in-process managed reconciliation stopped an unhealthy
runtime, removed only its in-memory entry, and created a new ID while the old
manifest remained authoritative on disk. The running process used the new
record, but the next startup rejected both manifests before opening its HTTP
listener and systemd retried indefinitely.

Managed recovery now keeps the old runtime ID and locked snapshot across
teardown and recreation. Cleanup errors prevent creation, and creation errors
remain bound to that identity for deterministic retry. This makes every normal
crash window converge through the existing restart-recovery path and avoids a
cross-file replacement transaction.

Startup additionally repairs legacy duplicates deterministically. A unique
live application has priority over all metadata; otherwise the managed foreign
key, unique full-health result, and newest recoverable record are used in that
order. Ambiguous multiple live applications and pointerless multiple healthy
runtimes fail closed. Stale exact-name units and runtime directories must be
cleaned before their manifest is removed, while persistent profiles are
preserved.

## 2026-08-31 — Promote rc.5 to the four authorized follower sandboxes

Status: automated deployment and runtime-restart acceptance passed on
sandbox02, sandbox03, sandbox07, and sandbox10. Human UAT and formal GitHub
publication remain pending.

The operator separately authorized the exact rc.5 artifact and restart of all
RemoteXApp application runtimes on the four followers. Sandbox02 and sandbox03
were healthy controls. Sandbox07 and sandbox10 were real pre-rc.5 failure
cases: their managers had entered restart loops with three and two Desktop
manifests respectively. Activation was allowed to run RTM-010 repair without
manual manifest deletion; each durable managed pointer won, stale exact state
was retired, and sandbox10's anonymous Firefox and Edge records survived.

Every runtime was then intentionally recreated so its locked core components
use rc.5 while its template, profile, parameters, and overrides remain. A
second manager restart adopted the new records. Acceptance requires one
manifest per API runtime, all runtimes server-ready with stopped sessions and
zero clients, `NRestarts=0`, no warning after the final restart, and unchanged
App selectors and network policy. Sandbox07 remains always-on and its LXD
container was not restarted. The unavailable build-host private-IP path is an
external network dependency, not a reason to broaden UFW or use the production
gateway for batch validation.

## 2026-08-31 — Publish rc.5 and align the five sandboxes to formal bytes

Status: GitHub prerelease `v0.2.0-rc.5` published and checksum-verified formal
alignment accepted automatically on sandbox00, sandbox02, sandbox03,
sandbox07, and sandbox10. Human UAT remains pending. This supersedes only the
pending-publication status of the two preceding rc.5 entries.

The tag points to accepted source commit `8c03c485adc5`. GitHub's clean
go1.22.12 workflow passed the history secret scan and full portable release
gate, then published archive SHA-256
`f31ef87b9a845c9cc88e1fe86a64f3ab69f959eefc8462fa1d637e0ded622ccb`.
The earlier same-commit candidate used go1.22.2 and also contained untracked
empty driver directories, so immutable same-version replacement was required;
overwriting an existing release remained forbidden.

Each host stopped zero-client runtimes, retained both old core trees as
`0.2.0-rc.5-candidate-8c03c485adc5`, installed the downloaded formal archive,
and recreated launch intent before a final adoption restart. Sandbox00's XFCE
session exercised the host policy: graceful logout returned
`shutdown-blocked`, then the explicitly authorized deployment enforced that
Desktop stop; both browser runtimes stopped normally. Fleet acceptance matched
all three formal binary hashes, six App selectors, profiles, parameters,
configuration, and fixed Desktop policy. Every runtime has one manifest, all
sessions are stopped with zero clients, every manager reports `NRestarts=0`,
and no warning followed the final restart. The production gateway was not
used.

## 2026-08-31 — Align local port 1991 to the formal rc.5 release

Status: accepted automatically after the five-sandbox formal alignment; Human
UAT remains pending.

The operator extended formal deployment to local port 1991. One client was
attached to the user-home Desktop, so alignment used the normal graceful
protocol and proceeded only after it completed without force. The candidate
trees were retained, both managed and anonymous XFCE launch intents were
recreated against the formal core, and a second manager restart adopted them
with one manifest each.

Local catalog audit also found the superseded `edge-browser@2.0.0` selector.
With no Edge runtime or clients, the manager was stopped and the supported App
management interface activated `edge@1.0.0`; rollback protection retained the
old selector until the new catalog passed. The local formal acceptance now
matches all three binary hashes and all six App selectors used by the five
sandboxes, while preserving the local listener and trust-boundary settings.

## 2026-08-31 — Propose one unified console with a separate service-control boundary

Status: proposed; target version unassigned; scope not locked.

The root page, SDK console, minimal example, and per-instance kiosk currently
duplicate browser-page responsibilities. The proposed CON-001 through CON-009
train replaces them with one generated application and shared components. The
existing URLs remain compatibility entries into explicit dashboard, launch,
or viewer modes. DEP-011 base-path behavior and DEP-012's independent console
and kiosk exposure controls remain invariants; a shared implementation does
not grant shared authority.

The console will consume generic template metadata, resources, and bounded
application status rather than adding App-specific branches. Runtime restart
is a new server-side, generation-qualified lifecycle operation over durable
launch intent and the locked snapshot; it is not an upgrade and is not rebuilt
from browser form state.

Manager-service restart is a different trust boundary. It is disabled by
default and requires an independently supervised, non-root helper that accepts
only the exact RemoteXApp user-service action. Neither the manager nor browser
may select an arbitrary unit or command, and the operation is unavailable on
an unauthenticated public listener. This preserves the no-root-orchestration
decision while letting an authenticated operator request restart and observe
health, version, adoption, and recovery afterward. EXP-007 environment data is
never part of automatic console polling or persistence.

The complete proposed scope, exclusions, and acceptance matrix are recorded in
[`unified-operator-console-release.md`](unified-operator-console-release.md).
No implementation or sandbox deployment is authorized until the train is
explicitly scope-locked.

## 2026-08-31 — Lock the unified console train to rc.6 and local-only deployment

Status: CON-001 through CON-009 scope-locked for `0.2.0-rc.6` with SDK
`0.18.0`. Implementation, complete local release validation, and deployment to
local port 1991 are authorized; no sandbox deployment is authorized.

One hashed console bundle now owns operator, launch, and viewer behavior. The
root, former SDK console, former minimal example, and per-instance kiosk paths
remain stable entry routes, but no longer carry independent application logic.
Kiosk mode has no lifecycle or service controls, and DEP-012 exposure flags
remain independent server-side policy.

Runtime restart is one generation-qualified manager transaction over the
durable manifest. It records running restart intent before application
shutdown, retains the runtime ID, creation time, parameters, profile,
overrides, locked App/core snapshot, allocated display and loopback ports, and
monotonic session generation, and leaves a retryable running manifest if
recreation fails. It is explicitly not an App upgrade.

Manager-service restart uses the independently supervised
`remotexapp-operator-helper`. The owner-only Unix protocol exposes only ping,
fixed-manager restart, and opaque operation status; same-UID peer credentials,
idempotent IDs, rate limiting, trusted operator identity, origin protection,
and a required confirmation header fail closed. It accepts no unit or command.
The feature defaults disabled, is rejected with `auth-mode=none`, and is not
offered for the dedicated system service because non-root code cannot safely
restart that system unit. Local 1991 finishes in its requested unauthenticated
wide-test mode, so the helper capability remains disabled there after its
separate authenticated real-systemd acceptance test.

## 2026-08-31 — Reject rc.6 locally and supersede it with rc.7

Status: rc.6 candidate rejected by local runtime-restart E2E; locked console
scope unchanged and retargeted to `0.2.0-rc.7`.

The generation-qualified restart correctly recorded running intent, stopped
all runtime units, and retained the exact locked manifest. Re-creation then
mistook the same singleton's `restarting` in-memory record for a conflicting
runtime and returned it without starting server units. A normal manager
restart proved the crash contract by recovering that manifest under the same
runtime ID, generation, display, ports, profile, and App/core snapshot.

Recovery and API restart now ignore only the existing record whose ID exactly
matches the durable `RuntimeID` being replaced. Every other singleton,
user-home owner, display, and port remains a conflict. Because rc.6 was already
staged into the immutable local release store, its bytes are not replaced;
rc.7 carries the fix and repeats the complete release and local acceptance
gate. No sandbox deployment is authorized.

## 2026-08-31 — Reject rc.7 browser loader and supersede it with rc.8

Status: rc.7 candidate rejected by real Chrome E2E; locked scope unchanged and
retargeted to `0.2.0-rc.8`.

The common shell correctly recognized root-mounted `/sdk/` and
`/remotexapps/` routes, but represented their valid base prefix as an empty
string. A later fallback confused that value with “no compatibility marker was
matched” and constructed a nested loader URL. Static route tests proved only
that each path returned the same shell and therefore did not detect execution
failure.

The shell now tracks marker presence separately from the prefix value. Its
inline resolver is executed by the test suite against root, SDK, kiosk, and
reverse-prefixed variants. rc.7 remains unchanged in the immutable local
release store; rc.8 repeats browser, runtime, service-restart, and release
acceptance before becoming the final local 1991 candidate. No sandbox is in
scope.

## 2026-08-31 — Reject rc.8 helper framing and supersede it with rc.9

Status: rc.8 candidate rejected by authenticated real user-systemd E2E;
locked scope unchanged and retargeted to `0.2.0-rc.9`.

The helper's strict decoder reads through EOF to prove that the request
contains exactly one JSON object. The manager wrote that object and immediately
waited for the response without terminating its write stream, while the helper
waited for EOF before replying. Startup correctly failed closed when its helper
probe timed out, and the test restore trap returned local 1991 to
`auth-mode=none` with the helper inactive.

The manager now half-closes only the Unix socket write side after encoding its
request, leaving the read side available for the response. A real Unix-socket
test requires request EOF before emitting the fixture response. rc.8 remains
unchanged in the immutable local release store; rc.9 repeats the full helper
abuse matrix and recovery test. No sandbox is in scope.

## 2026-08-31 — Complete rc.9 automated local acceptance

Status: CON-001 through CON-009 implemented; automated local release gate
passed; Human UAT pending.

The exact `0.2.0-rc.9` artifact at commit `1d0fddb31692` passed repository,
race, deterministic package, real Chrome/X11, and real user-systemd gates. One
console bundle executed in operator, launch, and viewer modes. A real operator
page launched parameterized Edge and restarted its runtime; managed user-home,
anonymous singleton, unsaved Mousepad blocked/force, crash-window recovery,
input, resize, status, named resources, and browser reconnect all passed. The
independent helper restarted only the manager while retaining all runtime
PIDs, and rejected missing confirmation, cross-origin, arbitrary-unit, and
rate-limit cases.

The final local deployment remains the explicitly requested
`0.0.0.0:1991`, `auth-mode=none` test configuration. Consequently service
restart is not advertised, and its helper is disabled and inactive. The two
pre-existing XFCE runtimes are server-ready with stopped sessions and zero
clients; all test runtimes were removed. No sandbox was changed. Evidence is
[`unified-console-rc9-local-1991.json`](../tests/go-live-validation/results/unified-console-rc9-local-1991.json).

## 2026-09-01 — Reject rc.9 flat navigation and lock CON-010

Status: Human UAT correction accepted; rc.9 superseded by rc.10; SDK remains
0.18.0; local port 1991 only.

The rc.9 operator sidebar exposed managed registrations and the same managed
runtimes as peer cards because it independently rendered the two stable API
collections. Its launch form also hid anonymous runtime creation and durable
managed registration creation behind one `Launch type` selector. Although the
backend ownership model was correct, the browser presentation made one managed
application look like two applications and obscured the difference between
creation and viewer attachment.

CON-010 makes ownership the navigation invariant. One managed application owns
one optional current runtime, which is shown only as nested technical detail.
The standalone runtime list contains only anonymous runtimes. UI actions name
their transitions explicitly: open an anonymous runtime, create a managed
application, start a stopped managed application, connect to an existing
runtime, or reconnect the current viewer. No manager API, persistence model,
SDK contract, App Package, or sandbox deployment changes.

## 2026-09-01 — Complete rc.10 navigation acceptance on local 1991

Status: CON-010 implemented; automated and real-browser local gates passed;
Human UAT pending.

The exact rc.10 artifact at commit `7edefeec6ba5` preserves SDK 0.18.0 and
changes only the unified console, generated asset, release metadata, tests,
and design records. Unit classification proves that every runtime carrying a
`managedInstanceId` is absent from standalone navigation. Source guards prove
the old flat headings and launch-type selector are gone and that App-specific
coupling has not returned.

Real Chrome rendered one `ubuntu-desktop` managed card with its current runtime
only under `Runtime details`, plus one unrelated standalone runtime. Their
runtime IDs did not overlap. A stopped managed fixture exposed `Start and
connect`; the running managed application exposed `Connect`; real RFB attach,
disconnect, and `Reconnect` succeeded. The fixture and Chrome profile were
removed. Final health reports two active runtimes, zero clients, no warning
journal entries, and no service restarts. The helper remains disabled under
the requested unauthenticated listener, and no sandbox changed. Evidence is
[`unified-console-rc10-navigation-local-1991.json`](../tests/go-live-validation/results/unified-console-rc10-navigation-local-1991.json).

## 2026-09-01 — Accept Unified Console Human UAT

Status: CON-001 through CON-010 complete and accepted.

The operator accepted the rc.10 ownership hierarchy and action vocabulary
after direct Human UAT. This closes the Unified Operator Console train without
authorizing a sandbox deployment or changing the separately pending Firefox,
LibreOffice, or stable `0.2.0` release gates.

## 2026-09-01 — Lock the 0.2.0 stable release train

Status: STB-001 through STB-009 scope-locked; target core `0.2.0`, SDK
`0.18.0`, and App Package ABI `remotexapp/v1`.

The first stable 0.2 train is a maturity transition, not a feature train. It
freezes the existing API, SDK, ABI, templates, drivers, and App Package
identities. Only defects discovered while satisfying the locked acceptance
gates may change implementation. Experimental and deferred requirements do
not become stable merely because their code or documentation is present.

Stable publication requires explicit Firefox and LibreOffice Human UAT,
candidate recovery evidence and closure for GitHub Issues #4 and #5, accurate
stable support/trust-boundary documents, WAOS contract compatibility without a
forced downstream release, clean release and confidentiality gates, immutable
local upgrade/rollback acceptance, and separately approved production-like
sandbox00 acceptance. Tagging and publication follow only afterward, and the
downloaded formal artifact must be verified and aligned as a new immutable
release. Follower sandboxes and new functionality are outside this train.

The scope lock authorizes preparation and testing only. It does not authorize
sandbox00 staging or production mutation, a Git tag, GitHub publication, or
formal deployment. Those steps retain their explicit approvals and ordering.
The full contract is
[`stable-0.2.0-release.md`](stable-0.2.0-release.md).

## 2026-09-01 — Complete the stable positioning and incomplete-work audit

Status: STB-002 implemented; no deployment or publication authorized.

The stable target is now stated consistently as RemoteXApp core `0.2.0`, SDK
`0.18.0`, App Package ABI V1, and the six frozen App identities on Linux amd64
with Ubuntu/systemd/X11 deployment tooling. A source `VERSION` or stable wording
does not constitute a release: only the immutable tag, successful publication
workflow, downloaded checksum verification, and formal alignment do so.

The repository distinguishes stable software support from an operator's
production readiness. TLS and identity termination, one UID/container per
mutually untrusted tenant, backup, monitoring, capacity, privacy, legal, and
incident-response controls remain external deployment decisions. Historical rc
identifiers remain intact where they prove an artifact, deployment, test, or
rollback fact.

The 2026-09-01 GitHub audit found only Issues #4 and #5 open. Both correspond to
implemented runtime recovery requirements but remain release blockers until
the exact stable candidate repeats their abnormal paths and the issues are
closed with evidence. Deferred DRV-013 through DRV-015, APP-008, and IME-002;
proposed EXP-001 through EXP-006 and IME-004; and implemented but experimental
EXP-007 remain outside the stable compatibility promise. Firefox and
LibreOffice remain implemented but await explicit Human UAT.

## 2026-09-01 — Accept provider compatibility without a WAOS release

Status: STB-005 implemented; WAOS remains independently releasable.

The accepted downstream baseline is RemoteXApp `v0.2.0-rc.4`, SDK `0.17.0`,
App Package ABI `remotexapp/v1`, and WAOS v2.0.91. Comparison to the stable
source found no App Package parser/test change and no source change in any of
the six frozen Apps. SDK 0.18 preserves SDK 0.17 exports and the viewer/input
client bytes while adding manager-only version, health, runtime-restart, and
restricted service-restart operations.

The isolated port-21991 build-once E2E installed and launched a neutral V1 App,
adopted it across manager restart, activated a new App version without changing
core binaries, retained the old runtime pin, selected the new version for a new
runtime, then disabled and rolled back the App. This is sufficient provider
evidence because neither the V1 envelope nor an existing WAOS-consumed method
changed. It deliberately did not build, modify, or release WAOS. WAOS updates
its exact provider lock and reruns affected flows only when it independently
chooses to adopt `0.2.0`.

## 2026-09-01 — Freeze the automated stable candidate

Status: initial STB-006 automation passed at `7430689f05cb`; final repeat still
required after evidence-only commits.

The clean stable target passed both the host-aware `make release-check` and
portable `make release-ci` on Ubuntu 24.04 linux/amd64. This covered metadata,
confidentiality, noVNC provenance, generated assets, performance records,
Go/SDK/App tests, vet, race, deployment architecture, immutable staging,
preflight, archive contents, and checksums. Repackaging produced the identical
archive digest
`8c6574c0abab565f3b08bbcd305522ed15d0fa64924c4cec689e3d65a589238c`,
and all six embedded App archives verified independently.

This digest identifies the candidate used for local upgrade, rollback, and
application acceptance. Subsequent commits may record evidence only; any
runtime, generated web asset, App, dependency, or build-input change invalidates
the candidate and restarts the gate. Because documentation changes still alter
the formal source commit and embedded build identity, the final clean evidence
commit must repeat `make release-ci` before an annotated tag is allowed.

## 2026-09-01 — Accept the stable candidate locally

Status: STB-007 implemented; Issues #4/#5 locally verified but not closed;
Firefox and LibreOffice Human UAT pending.

The exact `0.2.0` candidate at `7430689f05cb` was staged immutably and selected
on local port 1991. The rc.10→candidate→rc.10→candidate sequence verified both
version and commit on every start. Two existing runtime identities, session
generations, states, and all seven child unit PIDs remained unchanged across
each manager replacement.

Real and isolated browser tests covered every shipped App, fixed scaling,
dynamic resize, input, generic status, Edge CDP, Firefox BiDi, LibreOffice UNO,
finite/unlimited/manual/automatic reconnect, manager adoption, XFCE Logout and
generation-2 relaunch, blocked and forced shutdown, vacancy, profile
persistence, and cleanup. The console and reverse-prefix gates executed over
the same accepted rc.10 web bytes.

The Issue #4 test removed an anonymous fixed-display manifest while exact units
survived on isolated display `:13`; startup stopped the old units, removed stale
runtime state, preserved the profile, and created one healthy replacement
without looping. The Issue #5 test stopped the gateway of the logged-out
managed Desktop; in-process recovery retained runtime ID and creation time,
kept one manifest and the same manager PID, and left `NRestarts=0`.

Final local state remains the requested unauthenticated wide-test listener with
two expected runtimes, zero clients, zero warnings, and no test residue. This
configuration is not a production-security claim. Sandbox00 was not changed,
and its separate approval gate remains authoritative.

## 2026-09-01 — Make release content requirements version-aware

Status: DEP-015 implemented; replacement stable candidate required.

The first approved sandbox00 stable staging attempt exposed a rollback defect:
the new selector required `remotexapp-operator-helper` in every target release,
but retained rc.5 correctly predates that optional binary. The selector failed
before changing rc.5 selectors; the already-running candidate was restored to
rc.5 by an explicit stopped-service, atomic two-selector transition. Runtime
identity, creation time, session generation, and all four child-unit PIDs were
preserved.

Newly staged releases now contain a strict `release-manifest.json` naming the
exact required executables. The selector validates that schema and every named
binary. A retained release without the manifest is deliberately classified as
legacy and validated against the historical three-core-binary contract. This
keeps new release integrity fail-closed without making a newly introduced
optional component retroactively mandatory for rollback.

A focused local rc.5 selection then exposed the matching launch-contract issue:
the new shared unit passed `-enable-service-restart`, which rc.5 does not know.
Current user-mode managers now read that optional policy from their existing
environment; the CLI remains available, but shared units do not pass it.
Dedicated mode uses `UnsetEnvironment=REMOTEXAPP_ENABLE_SERVICE_RESTART` to
retain its hard prohibition. Because the stager, manager, units, and release
archive changed, the earlier `7430689f05cb` candidate and its local acceptance
are historical evidence only; all automated, local, and sandbox candidate gates
must restart.

## 2026-09-01 — Accept the replacement candidate locally

Status: STB-007 implemented again; sandbox00 replacement staging not approved.

Clean commit `ca1d0b26bf8f` passed both release gates and produced reproducible
archive SHA-256
`a6f3baae356bd45c5d45fcee3cf937d0295ec4ec3384bc6c1cd757536c901cfd`.
The actual local shared unit then started rc.10, the replacement, legacy rc.5,
and the replacement in order. Runtime identities, creation/generation state,
eight unit records, and all seven active child PIDs were unchanged.

The replacement also passed the four disposable/persistent App browser paths,
authenticated environment-owned service-restart policy, malformed-policy
rejection, fixed framebuffer, finite/unlimited/automatic reconnect, and the
Issue #4/#5 abnormal recovery paths. Final port 1991 state is healthy with two
runtimes, zero clients, zero warning entries, and no temporary listener, unit,
or browser residue. The old sandbox00 staging tree remains inactive and rc.5
remains selected; a new explicit staging approval is required.

## 2026-09-01 — Publish stable 0.2.0 and align the local formal artifact

Status: GitHub publication and local formal alignment accepted; sandbox00
formal alignment remains pending separate approval.

Annotated tag `v0.2.0` points to `9ef470c01399`. Both the main Verify workflow
and tag Release workflow passed after the Verify job gained its missing
`ripgrep` dependency. GitHub published a normal Latest release whose downloaded
archive and `SHA256SUMS` verify at
`7d8665d5e477542ecea79cc4c20dac23797fa8f3c82b78022408a4d55a3e0123`.
The asset embeds the exact tag commit and passed sensitive-data inspection.

Artifact identity is environment-specific until the Go patch toolchain is
pinned identically: GitHub used Go 1.22.12, while the separately reproducible
local gate used Go 1.22.2 and produced
`bb392e0a089da0216afb6b6211dddf33870eed45fc0eaf315305931e344208d2`.
The GitHub Release notes distinguish these hashes, and the attached formal
`SHA256SUMS` is authoritative for deployment. The tag was not moved or reused.

Local port 1991 retained the candidate as
`0.2.0-candidate-ca1d0b26bf8f`, staged the downloaded artifact as a new
canonical immutable `0.2.0`, and restarted only the manager. Runtime identity,
generation, state, and every child PID remained exact; Apps and listener policy
were unchanged. A disposable Mousepad proved the new formal component paths
and complete cleanup. A final adoption restart removed its in-memory stopped
record, retained the original runtimes without PID churn, and left no warning.
This gate does not authorize or perform sandbox00 formal alignment.

## 2026-09-01 — Complete stable 0.2.0 on sandbox00 formal production bytes

Status: STB-009 accepted; stable 0.2.0 release train complete.

Under a separate explicit production approval, sandbox00 retained candidate
`ca1d0b26bf8f` under a commit-qualified immutable directory and selected the
checksum-verified GitHub `v0.2.0` artifact at `9ef470c01399`. Because the
candidate and formal artifact share version `0.2.0`, the documented collision
procedure required a zero-client stop and recreation of `sandbox-desktop`; it
did not overwrite either immutable tree. The final runtime is server-ready,
has one durable manifest, and survives manager restart under the same identity.

The initial attempt restored the candidate automatically when its validation
incorrectly expected REST attach to start an on-attach session. REST attach is
not an RFB client attachment: a zero-client Desktop is healthy at server-ready,
and its application session starts only after a viewer establishes RFB. The
corrected gate verified this invariant plus exact running and installed formal
hashes, App selectors, fixed display policy, routes, configuration, child-unit
states, `NRestarts=0`, and an empty warning journal.

Validation stayed on container loopback. The build host remains outside
sandbox00's existing UFW allowlist, so direct private HTTP timed out; the
firewall and production gateway were deliberately unchanged. Exact evidence is
[`stable-0.2.0-formal-sandbox00-production.json`](../tests/go-live-validation/results/stable-0.2.0-formal-sandbox00-production.json).

## 2026-09-01 — Align follower sandboxes after the stable train

Status: separately approved post-train production rollout accepted.

The stable train explicitly excluded follower deployment. After it completed,
the operator separately authorized sandbox02, sandbox03, sandbox07, and
sandbox10 to select the same checksum-verified `v0.2.0` GitHub artifact. This
did not reopen STB-001 through STB-009 or change release scope.

Each target started from formal rc.5 with zero attached clients and no stable
version directory. The complete artifact passed its attached checksum and
central-user preflight before selection. Two manager restarts adopted the one
managed Desktop without changing runtime identity, creation time, generation,
state, or any child PID. The final running manager bytes and four installed
binary hashes match the formal asset; App selectors and sandbox policy did not
change. Rc.5 remains an immutable rollback target, and adopted runtime
components deliberately remain rc.5-pinned until natural recreation.

All four targets ended with one runtime and manifest, zero clients,
`NRestarts=0`, and no warning. Sandbox10 retained its running Desktop session
while its manifestless stopped history was cleared normally. Sandbox07's
always-on configuration was untouched. Existing UFW allowlists still block
build-host private HTTP; no firewall or production-gateway action was taken.
Exact evidence is
[`stable-0.2.0-formal-followers-production.json`](../tests/go-live-validation/results/stable-0.2.0-formal-followers-production.json).

## 2026-09-02 — Propose a breaking catalog simplification as 0.3.0

Status: accepted and scope-locked for implementation, complete automated and
local E2E validation, and local port-1991 UAT deployment. Sandbox deployment,
tagging, and publication remain separately approved actions.

Firefox ESR is the only shipped App still using a 24-bit framebuffer. The next
train proposes `firefox-esr@2.1.0` with depth 16 while preserving every other
accepted Firefox behavior. It also retires `xfce-desktop`; the operator
confirmed that no external or downstream system uses that template, so an
alias, deprecation interval, and migration to `xfce-user-desktop` would add
complexity without preserving a real consumer.

Template removal still needs an explicit safe-retirement rule because a prior
shipped selector can survive an upgrade. The installer may remove only the
named retired shipped selector, must fail closed on runtime or managed-instance
references, and must not derive deletions from the absence of an App directory.
This preserves independently installed packages. Historical documents and the
retained `0.2.0` release remain audit and rollback evidence. Because a public
template ID disappears, the core target is `0.3.0`; SDK 0.18.0 and App Package
ABI V1 do not change. See
[`template-catalog-0.3.0-release.md`](template-catalog-0.3.0-release.md).

The paired transition normally stops the manager before changing any selector.
Therefore `select-system-release.sh --start` now treats the requested final
running state, rather than only the entry state, as the rollback obligation: a
failed target start or health check restores, starts, and verifies the prior
release even when the operator had already stopped the manager.

## 2026-09-02 — Complete the 0.3.0-rc.1 local UAT gate

Status: CAT-001 through CAT-007 implemented; CAT-008 implemented with Human UAT
pending.

The exact code candidate `cfddd717e14d` passed both release gates and the full
five-App real-X11/browser suite. The local paired transition then exercised
formal `0.2.0` → rc.1 → `0.2.0` → rc.1. Retirement occurred only after the
old anonymous `xfce-desktop` runtime was confirmed detached and explicitly
stopped. No selector or durable record references the retired ID afterward.

The existing managed user-home Desktop retained its runtime identity and four
child PIDs through normal selection, rollback, final upgrade, an injected
commit-health failure, and the final clean manager restart. This confirms that
the catalog transition changes new-runtime selection without disrupting an
already locked compatible runtime. Firefox on final port 1991 proved an actual
depth-16 VNC process, live BiDi, resize, reconnect, Unicode input
acknowledgement, and cleanup. Human UAT is now the sole remaining local
acceptance action; sandboxes, tagging, and publication remain unauthorized.
Exact evidence is
[`template-catalog-0.3.0-rc.1-local-1991.json`](../tests/go-live-validation/results/template-catalog-0.3.0-rc.1-local-1991.json).

## 2026-09-02 — Accept 0.3.0 Human UAT and authorize formal publication

Status: CAT-001 through CAT-008 accepted; formal `v0.3.0` publication
authorized; sandbox deployment remains unauthorized.

The operator explicitly accepted Human UAT on the exact local rc.1 behavior.
The final stable commit may change only version metadata, acceptance evidence,
and current support documentation; any runtime, web, App, dependency, or build
input change would invalidate this acceptance and require the candidate gate
again. The formal tag must pass the complete portable release workflow and its
downloaded archive/checksum must be independently verified. Exact Human UAT
evidence is
[`template-catalog-0.3.0-rc.1-human-uat.json`](../tests/go-live-validation/results/template-catalog-0.3.0-rc.1-human-uat.json).

## 2026-09-02 — Publish stable RemoteXApp 0.3.0

Status: formal release complete; sandbox deployment remains unauthorized.

Final commit `c719df9bb88c` changed only version metadata, acceptance evidence,
and current support documentation from the accepted runtime candidate. Local
release gates, GitHub main Verify, and the tag-triggered Release workflow all
passed. Annotated `v0.3.0` is the normal Latest release, and the downloaded
formal archive passed its attached checksum, sensitive-data scan, embedded
commit check, and exact five-App catalog audit.

The formal Go 1.22.12 archive differs from the same-source local Go 1.22.2
artifact, so the attached GitHub `SHA256SUMS` is authoritative. Publication
does not imply deployment: local port 1991 remains on the accepted rc.1 bytes,
and no sandbox was changed. Exact evidence is
[`template-catalog-0.3.0-formal-publication.json`](../tests/go-live-validation/results/template-catalog-0.3.0-formal-publication.json).

## 2026-09-02 — Propose one bidirectional rich clipboard train

Status: CLP-001 through CLP-015 proposed; target version unassigned and scope
not locked.

The earlier injection-only draft is expanded into one clipboard subsystem with
explicit `toRemote` and `toLocal` directions. The Manager remains the
authenticated, generation-qualified external control plane; the existing
per-runtime gateway becomes the X11 data plane through a private Unix control
socket. Streamed multipart carries bounded content, while the existing
per-Viewer WebSocket carries only ordered metadata. The candidate X11
implementation is the pure-Go `github.com/jezek/xgb` protocol and XFixes
extension, without moving template or App-protocol logic into core.

Remote X11 clipboard changes are authoritative session events and must be
broadcast to every Viewer on the current generation, including view-only
Viewers. One transient snapshot backs a non-consuming offer that each Viewer
accepts or dismisses independently. A Viewer-originated remote selection is
also broadcast; an opaque source Viewer ID suppresses only the source's
sync-back prompt, and non-persistent fingerprints prevent local feedback
loops. Sequence gaps and reconnects reconcile through the pending-offer API.

The SDK owns manual, prompt, and explicitly enabled automatic policy behind one
`client.clipboard` namespace. The required prompt UI is optional SDK
presentation: translucent full-width messages stack from the top with newest
first, Yes/X actions, no content preview, and no remote-focus theft. Local
clipboard checks use supported change events plus debounced top-level
focus/visibility reconciliation; internal Viewer or IME focus is never a
clipboard trigger, and focus alone never raises a new browser permission
prompt.

The Unified Console is the reference integration and UAT surface, not a second
clipboard implementation. It must configure the public `client.clipboard`
surface, show both direction/mode selectors and manual actions, render the
standard prompt stack, and expose only bounded capability, permission, offer,
and result metadata. Enabling monitoring is an explicit per-client action and
is deliberately absent from URLs, browser persistence, launch parameters,
runtime state, and Manager configuration so a test choice cannot silently
become production policy.

The train retains the four-times limits already selected for plain text, HTML,
RTF, PNG, and aggregate content, and continues to exclude files and URI lists.
The new public Manager/SDK surface should receive a minor release when the
operator later locks scope. This proposal itself authorizes no implementation,
release, or deployment. The normative draft is
[`rich-clipboard-requirement.md`](rich-clipboard-requirement.md).

## 2026-09-02 — Lock the bidirectional rich clipboard train

Status: CLP-001 through CLP-015 scope-locked for RemoteXApp `0.4.0-rc.1`
and SDK `0.19.0`; App Package ABI V1 and all App/template contracts remain
unchanged.

The lock authorizes implementation, complete automated and local real
X11/browser E2E, and deployment only to local `0.0.0.0:1991` for Human UAT.
It does not authorize any sandbox change, GitHub tag, or GitHub Release. A
material API, format, quota, trust-boundary, Viewer-broadcast, persistence, or
browser-permission change requires explicit unlock approval and a superseding
dated decision.

## 2026-09-02 — Implement and locally validate the rich clipboard train

Status: CLP-001 through CLP-015 implemented; Human UAT pending.

The Manager now owns authenticated, generation-qualified multipart offer APIs,
while each pinned Go gateway owns one private X11/XFixes data plane over a
mode-0600 Unix socket. The implementation supports bounded plain text, HTML,
RTF, and PNG alternatives, normal Selection transfers and `INCR`, reliable
metadata fanout, non-consuming multi-Viewer acceptance, terminal offer state,
and generation-scoped cleanup without App-specific core branches.

SDK `0.19.0` exposes independent manual, prompt, and permission-dependent auto
policy in both directions. The Unified Console and declarative element use the
same public SDK, including source-Viewer suppression, reconnect reconciliation,
permission degradation, newest-first prompts, and expiry events. App Package
ABI V1 and all five App contracts remain unchanged.

Candidate `17d559ebe813906a1055445e7d543d667a7c10917b4ff46c96d8832c2bef6b1b`
passed release-ci, 59 SDK tests, Go race/vet, uncached Xvfb normal and `INCR`
transfers, isolated browser tests for Edge, Firefox ESR, LibreOffice and
Mousepad, and full two-Viewer XFCE testing on local `0.0.0.0:1991`. The local
generation transition rejected stale requests and replayed no offers; the
owner-only socket, installed licenses, zero payload-pattern journal matches,
and test cleanup were verified. Exact payload-free evidence is
[`rich-clipboard-0.4.0-rc.1-local-1991.json`](../tests/go-live-validation/results/rich-clipboard-0.4.0-rc.1-local-1991.json).
No sandbox, tag, or GitHub Release was created.

## 2026-09-02 — Supersede clipboard expiry ownership for rc.2

Status: CLP-016 implemented for RemoteXApp `0.4.0-rc.2`; complete local
validation and renewed Human UAT pending.

Human UAT rejected rc.1 after a local text selection was followed by a PNG:
roughly one offer lifetime later the PNG disappeared and XFCE Clipman restored
the older text. Isolated Xvfb reproduction proved that Clipman had requested
the PNG, but the gateway's expiry path released X11 ownership to `WindowNone`;
the same path also made repeat paste fail in templates without Clipman.

CLP-016 supersedes only CLP-007's rule that offer expiry or metadata eviction
must destroy the active X11 selection. API offer bodies still expire after 60
seconds and never become durable, but the bridge retains at most one bounded,
memory-only current selection until replacement or lifecycle cleanup. A clean
cancel or generation cleanup wipes its data while retaining an empty owner;
this prevents stale clipboard-manager replay without blocking a real
application from taking ownership. The behavior is core-owned and identical
for XFCE, Mousepad, LibreOffice, and browser Apps. SDK `0.19.0`, public APIs,
App Package ABI V1, quotas, and sandbox authorization are unchanged.

## 2026-09-02 — Validate and locally deploy clipboard rc.2

Status: CLP-001 through CLP-016 automated/local validation passed; renewed
Human UAT pending.

Candidate `5ebef8a7a7c1977c2a3986417fd809ccf2c77fa3c8e593c02893986a062fefb4`
passed release-ci, all 59 SDK tests, Go race/vet, immutable staging, all four
isolated application E2E paths, X11 normal/`INCR`, no-Clipman repeat paste and
generation cleanup, and three consecutive real Clipman stale-replay runs. The
Clipman regression also closes the gateway after tombstone clear and proves
that old text is not restored. It exposed and then verified the correction of
an immediate X11-request/offer-response data race.

Local `0.0.0.0:1991` now selects rc.2 and reports the exact candidate identity.
The managed Desktop was cleanly recreated so its runtime pins rc.2. Two real
Chrome Viewers passed the complete clipboard matrix; after a real wait past the
60-second TTL, the offer API was empty while the current PNG remained exact and
pasteable and the old text target remained absent. Explicit cancellation left
only the empty tombstone, test Viewers were removed, the Manager had zero
restarts and warnings, and clipboard payload patterns were absent from its
journal. Existing rc.1 evidence remains as the rejected-candidate audit record.
Exact payload-free evidence is
[`rich-clipboard-0.4.0-rc.2-local-1991.json`](../tests/go-live-validation/results/rich-clipboard-0.4.0-rc.2-local-1991.json).
No sandbox, tag, or GitHub Release was created.

## 2026-09-02 — Extend the clipboard train with explicit browser authorization

Status: CLP-017 implemented for RemoteXApp `0.4.0-rc.3` and SDK `0.20.0`;
repository validation passed; real-browser authorization UAT and deployment
pending.

The operator explicitly approved reopening the browser-permission surface after
rc.2 UAT. SDK consumers can now call side-effect-free `checkAccess()` to inspect
the secure context, document focus, current user activation, capability, and
browser-reported read/write permission. A direct click or tap may call
`requestReadAccess()`, which starts one actual read before its first asynchronous
wait and then discards the returned handle/content without decoding, exposing,
fingerprinting, uploading, or persisting it.

RemoteXApp deliberately provides no dummy write or read-then-write probe. Such
a probe can lose unsupported representations, race and overwrite a newer user
copy, mutate clipboard history, and generate feedback. A write is verified only
when `syncToLocal()` has real, user-approved remote content. Expected permission,
focus, activation, capability, and secure-context failures are structured SDK
state rather than hidden retries. The Unified Console uses only these public
methods. App Package ABI, Manager/gateway protocols, X11 selection ownership,
formats, quotas, lifecycle, and sandbox authorization are unchanged.

`make check` passed with sensitive-data and deterministic asset checks, all 68
SDK subtests, all Go and App tests, `go vet`, and deployment architecture
validation. Focused tests prove inspection performs no read/write, the explicit
read starts before any permission query, returned ClipboardItem data is not
decoded, no Manager transfer occurs, successful real writes are marked
verified, and secure-context, focus, activation, unsupported, and denial
failures remain structured. The local service still runs rc.2.

## 2026-09-02 — Accept clipboard rc.3 UAT and authorize GitHub publication

Status: CLP-001 through CLP-017 accepted; formal `v0.4.0-rc.3` GitHub
publication authorized; no deployment authorized.

The operator explicitly accepted Human UAT and ordered formal GitHub release.
Before tagging, the exact `d6373f083257` rc.3 build passed `make release-check`,
`make release-ci`, and an isolated real-Chromium check at loopback port 21991.
The browser test preserved an exact clipboard marker across both
`checkAccess()` and a real button-click `requestReadAccess()` call; the latter
reported read state `granted` with `verified=true`. The temporary manager and
its systemd-owned XFCE/VNC runtime were stopped and removed afterward.

This acceptance uses the existing complete rc.1/rc.2 X11, application,
multi-Viewer, expiry, Clipman, and port-1991 evidence for the unchanged data
plane and the exact rc.3 browser check for CLP-017. It does not claim that rc.3
was installed on port 1991: that service remains rc.2. The publication approval
does not authorize local replacement or any sandbox deployment. Evidence is
[`rich-clipboard-0.4.0-rc.3-human-uat.json`](../tests/go-live-validation/results/rich-clipboard-0.4.0-rc.3-human-uat.json).

## 2026-09-02 — Publish RemoteXApp 0.4.0-rc.3

Status: formal GitHub prerelease published and independently verified; no
deployment performed.

The clean accepted commit `e66a7273aa87` passed the local release gates and the
hosted Verify workflow. Annotated tag `v0.4.0-rc.3` (`b74ec647ad95`) points
exactly to that commit, and the tag-triggered Release workflow published the
candidate as a prerelease. The independently downloaded linux/amd64 archive
matched its attached `SHA256SUMS` at
`fa99973cb0fc25011ddd2a8f61f9a98544e7b762216932bd94942a4ac5cea454`.
Its sensitive-data scan, embedded Git revision, SDK `0.20.0` assets, and all
five App Package checksums passed. The formal Go 1.22.12 archive differs from
the same-source local Go 1.22.2 gate archive, so the attached formal checksum
is authoritative.

Publication did not install or activate the release. Local port 1991 remains
on rc.2 and no sandbox changed. Exact evidence is
[`rich-clipboard-0.4.0-rc.3-formal-publication.json`](../tests/go-live-validation/results/rich-clipboard-0.4.0-rc.3-formal-publication.json).

## 2026-09-02 — Promote accepted clipboard rc.3 to stable 0.4.0

Status: stable `v0.4.0` publication authorized; no deployment authorized.

The operator approved promoting the accepted and published rc.3 behavior to a
normal stable GitHub Release. The immutable rc.3 tag and prerelease remain as
the candidate audit record. Stable promotion uses a new `v0.4.0` annotated tag
and may change only RemoteXApp version metadata, stable acceptance evidence,
and current support/release documentation. SDK `0.20.0`, App Package ABI V1,
the five App Package versions, generated web assets, source code, dependencies,
and behavior must remain exact. Any other change invalidates the promotion and
requires renewed validation and UAT.

The stable commit must repeat local and hosted release gates; the downloaded
GitHub archive and checksum must be independently verified. Promotion itself
does not authorize local port-1991 replacement or any sandbox deployment.
Acceptance evidence is
[`rich-clipboard-0.4.0-stable-acceptance.json`](../tests/go-live-validation/results/rich-clipboard-0.4.0-stable-acceptance.json).

## 2026-09-02 — Publish stable RemoteXApp 0.4.0

Status: stable GitHub Release published and independently verified; no
deployment performed.

Stable commit `292a20ba5d7e` changes no runtime, SDK, App, generated asset,
dependency, deployment script, or build input from the accepted rc.3 behavior.
It passed local `make release-check`, `make release-ci`, and hosted Verify.
Annotated tag `v0.4.0` (`7d0b50e60e8d`) points exactly to that commit; its
tag-triggered Release workflow published a normal, non-prerelease Latest
release.

The independently downloaded linux/amd64 archive matched its attached
`SHA256SUMS` at
`c12ccf4db75ee693ef27142786439086f22b6209ad63f8be0e21c5a7d114d871`.
Its sensitive-data scan, embedded Git revision, SDK `0.20.0` assets, and all
five App Package checksums passed. The formal Go 1.22.12 archive differs from
the same-source local Go 1.22.2 gate archive, so the attached formal checksum
is authoritative. Local port 1991 remains on rc.2 and no sandbox changed.
Exact evidence is
[`rich-clipboard-0.4.0-formal-publication.json`](../tests/go-live-validation/results/rich-clipboard-0.4.0-formal-publication.json).

## 2026-09-02 — Deploy stable RemoteXApp 0.4.0 to the approved fleet

Status: complete; eight endpoints aligned to the formal stable manager and
catalog without restarting existing production runtimes.

The operator authorized the post-publication rollout to local ports 1991 and
2991, sandbox00 production 1991 and isolated test 2991, then sandbox02,
sandbox03, sandbox07, and sandbox10 production 1991. Every target used the
independently downloaded GitHub archive whose SHA-256 is
`c12ccf4db75ee693ef27142786439086f22b6209ad63f8be0e21c5a7d114d871`.
All endpoints report stable `0.4.0` commit `292a20ba5d7e`; installed and running
manager bytes match the formal asset, the expected four- or five-App catalog
is entirely 16-bit, and post-activation warning journals are empty.

The isolated 2991 managers are loopback-only, disable console, retain kiosk,
and contain no runtime. Production sandbox configuration remains public
no-auth only under the existing controlled boundary, with document roots
`/home/sandbox`, `/mnt/CloudDrive`, and `/mnt/MyDrive`. Sandbox07's always-on
configuration and durable managed registration were checksum-identical before
and after activation.

No production runtime was restarted. Each healthy runtime was adopted with
the same identity and remains component-locked to its creation release until
its next explicit stop/start. This preserves the accepted live-upgrade
contract and means manager/catalog activation must not be interpreted as an
implicit runtime component replacement. Exact evidence is
[`rich-clipboard-0.4.0-fleet-deployment.json`](../tests/go-live-validation/results/rich-clipboard-0.4.0-fleet-deployment.json).

## Related specifications

See [`driver-version-lifecycle.md`](driver-version-lifecycle.md),
[`graceful-shutdown.md`](graceful-shutdown.md), and
[`requirements.md`](requirements.md).

## 2026-09-03 — Propose Client-owned active clipboard detection

Status: CLP-018 through CLP-024 proposed for an unlocked future release train;
no implementation, version, deployment, UAT, or publication authorized.

Review of the stable 0.4.0 SDK showed that every configured local-to-remote
clipboard controller listens to top-level focus and clipboard signals even
when its embedded Viewer is not the user's input target. In a multi-window
consumer this can create prompts in inactive Firefox and Edge Viewers before
the user opens them, allowing the 60-second offer to expire unseen.

The proposed replacement makes real per-Client input focus authoritative.
Each `RemoteXAppClient` keeps its prompt configuration but reads and
fingerprints local content only while its own input host is active. Activation
performs one immediate reconciliation; inactive signals do not mutate that
Client's fingerprints. Browser focus provides mutual exclusion, so a second
WAOS-level clipboard coordinator or shared active-Viewer registry is rejected.
An embedding window manager only performs its normal focus handoff through
`client.focus()` when activation happens outside the remote canvas. The SDK
must prevent automatic RFB connection focus from claiming clipboard activity.

Loop suppression remains per Client, not per page. When A accepts a
remote-to-local offer, A suppresses the browser write it performed, but B may
detect and offer the same content after B becomes active. Existing
`sourceViewerId` suppression remains source-only. The accepted remote-to-local
gateway snapshot, all-Viewer runtime broadcast, independent acceptance,
60-second lifetime, reconnect, and security behavior are explicitly unchanged.
The Unified Console is added as the reference multi-Client surface: its
operator and launch workspaces retain multiple independently focusable Viewer
windows, each with one Client and prompt controller, while preserving the
existing lifecycle hierarchy and single-Viewer kiosk boundary. Console window
activation is normal Client focus handoff, not clipboard coordination; close
and runtime stop remain separate operations.
The complete proposed scope and acceptance matrix are in
[`client-active-clipboard-release.md`](client-active-clipboard-release.md).

## 2026-09-03 — Lock the Client-active clipboard release train

Status: CLP-018 through CLP-024 scope-locked for RemoteXApp `0.5.0-rc.1` and
SDK `0.21.0`.

The operator authorized implementation, complete automated and local
real-browser/runtime validation, and deployment to both local environments on
ports 1991 and 2991 for Human UAT. The lock does not authorize a sandbox
change, GitHub tag, Release, or final acceptance. Manager and gateway protocol
behavior, App Package ABI V1, App packages, templates, and drivers remain
outside the change.

## 2026-09-03 — Implement and locally validate per-Client clipboard activity

Status: implemented in RemoteXApp `0.5.0-rc.1` / SDK `0.21.0`; Human UAT
pending.

`RemoteXAppClient` now distinguishes real input ownership from its internal
connection-completion focus. Viewer pointer/keyboard input and public
`focus()` activate that Client, while focus elsewhere, top-level suspension,
`blur()`, disconnect, view-only transition, and destruction stop its local
clipboard monitor. Activation schedules one debounced reconciliation without
requesting permission. The clipboard object cancels delayed work when it loses
activity and exposes the result as `snapshot().inputActive`. No coordinator or
cross-Client fingerprint was introduced, and remote-to-local delivery was not
gated on focus.

The Unified Console replaced its single global Client/screen with an ephemeral
map of independent Viewer windows. Same/different-runtime windows each own
their Client, prompt stack, controls, state and diagnostics; task selection and
`Ctrl+F6` use normal Client focus. Viewer close destroys only that Client, while
runtime stop remains a separate confirmed operation. A real three-Viewer
Chrome test proved focus isolation, delayed inactivity, background-connect
safety, A-only rebound suppression followed by B forwarding, remote fanout,
move/minimize/switch, scoped disconnect, and Viewer-only close. Both local
environments run the candidate and passed their configured Console/kiosk
boundaries. Exact evidence is
[`client-active-clipboard-0.5.0-rc.1-local.json`](../tests/go-live-validation/results/client-active-clipboard-0.5.0-rc.1-local.json).

## 2026-09-03 — Accept client-active clipboard UAT and authorize publication

Status: CLP-018 through CLP-024 accepted; formal `v0.5.0-rc.1` GitHub
prerelease publication authorized.

The operator explicitly accepted Human UAT after testing the exact locally
deployed candidate and ordered formal GitHub publication. The release tag must
remain immutable, the hosted workflow must repeat the release gate, and the
downloaded archive must be checked against the published checksum and its
embedded release, SDK, App Package, and source identities. This approval does
not authorize any sandbox deployment. Exact acceptance evidence is
[`client-active-clipboard-0.5.0-rc.1-human-uat.json`](../tests/go-live-validation/results/client-active-clipboard-0.5.0-rc.1-human-uat.json).

## 2026-09-03 — Publish and independently verify 0.5.0-rc.1

Status: annotated `v0.5.0-rc.1` published as a GitHub prerelease; both hosted
workflows and independent artifact verification passed.

The immutable tag points to accepted commit `b3d4018a68d1`. The hosted release
workflow repeated the complete portable gate and published the linux/amd64
archive plus `SHA256SUMS`. A fresh GitHub download matched the published
checksum, passed the sensitive-data scan, reported the tagged release and
commit through a temporary loopback Manager, exposed SDK `0.21.0` and the
expected generated assets, and validated all five embedded App Package
archives, seals, ABI identities, and 16-bit templates. Stable `v0.4.0` remains
Latest. No local formal-artifact deployment or sandbox change was made. Exact
evidence is
[`client-active-clipboard-0.5.0-rc.1-formal-publication.json`](../tests/go-live-validation/results/client-active-clipboard-0.5.0-rc.1-formal-publication.json).

## 2026-09-03 — Promote the accepted rc.1 behavior to stable 0.5.0

Status: stable `v0.5.0` publication and the enumerated formal-artifact rollout
authorized; no functional change allowed.

The operator clarified that the final release must be a normal stable release,
not a prerelease, and approved promoting the accepted `v0.5.0-rc.1` behavior to
`v0.5.0`. Only core version metadata, stable acceptance evidence, and current
support/release documentation may change; SDK `0.21.0`, App Package ABI V1,
all five App versions, generated assets, and runtime behavior remain exact.
After hosted publication and independent download verification, the same
formal bytes are authorized for local 1991/2991, sandbox00 1991/2991, and
sandbox02/03/07/10 production 1991. No other host is in scope. Evidence is
[`client-active-clipboard-0.5.0-stable-acceptance.json`](../tests/go-live-validation/results/client-active-clipboard-0.5.0-stable-acceptance.json).

## 2026-09-03 — Publish and deploy stable RemoteXApp 0.5.0

Status: normal Latest `v0.5.0` published, independently verified, and deployed
to all eight explicitly authorized endpoints.

The annotated tag points to `639e3d599ad5`. Both hosted workflows passed, and
a fresh download matched SHA-256
`7427ffcbbaa6ccceadf201806716ec1db1ae70b6bf71c05e145f0350915fce94`,
the embedded source identity, SDK `0.21.0`, five App archives, seals, and
16-bit catalog. The release is neither draft nor prerelease and is GitHub
Latest. Exact publication evidence is
[`client-active-clipboard-0.5.0-formal-publication.json`](../tests/go-live-validation/results/client-active-clipboard-0.5.0-formal-publication.json).

The same formal bytes now run on local 1991/2991, sandbox00 1991/2991, and
sandbox02/03/07/10 production 1991. Production managers passed two restart and
adoption checks without replacing active runtimes; runtime IDs and creation
times remained stable, active manifest counts matched, and sandbox07's
environment and durable managed record checksums were unchanged. Both 2991
managers remain loopback-only with Console disabled, SDK enabled, four Apps,
and zero runtime. All warning journals were empty. Build-host HTTP to the LXD
private addresses remained blocked by the existing network boundary, so no
firewall or production gateway change was made. Exact rollout evidence is
[`client-active-clipboard-0.5.0-fleet-deployment.json`](../tests/go-live-validation/results/client-active-clipboard-0.5.0-fleet-deployment.json).

## 2026-09-03 — Recreate the legacy sandbox00 desktop for clipboard support

Status: sandbox00 remediation complete; follower runtime replacement remains
outside the approval scope.

Post-deployment use proved that manager/catalog alignment does not imply a
live adopted runtime has newly introduced gateway capabilities. The existing
`sandbox-desktop` was correctly pinned to the 0.2.0 gateway and had no rich
clipboard socket. Its capabilities endpoint therefore returned HTTP 409.
Restarting that runtime preserved the pin by design and could not repair it.

The operator approved ending the zero-client XFCE session and recreating only
sandbox00's managed desktop. Graceful logout was attempted first and reported
`shutdown-blocked`; the already disclosed session-loss boundary was then
enforced with scoped `force:true`. The old manifest and socket directory were
removed before desired state returned to running. New runtime
`xfce-user-desktop-2e7b598b6a5a` pins all core components to 0.5.0 and exposes
the clipboard socket. A temporary loopback Edge Viewer passed SDK capabilities,
plain/HTML/RTF/PNG browser-to-X11 transfer, and XFixes remote-to-browser
delivery, then detached cleanly. No other runtime lifecycle API was called.
The remaining follower desktops still pin pre-clipboard gateways and require
separate destructive-recreation approval. Exact evidence is
[`client-active-clipboard-0.5.0-sandbox00-runtime-remediation.json`](../tests/go-live-validation/results/client-active-clipboard-0.5.0-sandbox00-runtime-remediation.json).

## 2026-09-03 — Propose clipboard prompt host-safety hardening

Status: CLP-025 through CLP-029 proposed for an unlocked future release train;
no implementation, version, deployment, UAT, or publication authorized.

A downstream LibreOffice Viewer exposed an integration failure in which a
wildcard direct-child height rule stretched the optional SDK prompt root over
the complete framebuffer. The downstream rule remains defective and must be
narrowed, but a reusable standard prompt should also explicitly own its normal
top/content-height geometry so an ordinary host sizing rule cannot turn one
bar into a full-screen input-blocking overlay.

The proposed train therefore adds bounded geometry resilience and a documented
contract that embedding applications size the supplied Viewer container while
treating SDK-created descendants as SDK-owned. This is protection from
accidental CSS, not isolation from hostile same-page code: `!important`, DOM
removal, arbitrary JavaScript mutation, MutationObserver repair, Shadow DOM
migration, and Viewer subtree redesign are excluded. Clipboard protocol,
payload, focus, lifetime, Manager/gateway, App Package, template, and driver
behavior remain unchanged. Acceptance requires the exact wildcard-CSS
regression in a rendered real browser plus unobscured framebuffer hit testing,
stacking, long-text, accessibility, Console/kiosk, cleanup, and generated-asset
checks. The complete proposal is
[`clipboard-prompt-reliability-release.md`](clipboard-prompt-reliability-release.md).

The operator then accepted a direction-specific prompt treatment as CLP-028.
Local-to-remote uses high-contrast orange-red, an upward arrow, and explicit
`Local → Remote` text; remote-to-local uses blue, a downward arrow, and explicit
`Remote → Local` text. Success becomes briefly green, failure becomes dark red
without losing direction, and expiry becomes gray. Because color alone is not
an accessible identifier, the arrows and text are mandatory, as are WCAG AA
contrast, visible focus, accessible control names, and keyboard operation. The
more opaque bars should avoid heavy framebuffer blur.

The operator also accepted CLP-029 after a same-Viewer rebound was observed in
LibreOffice. The stable SDK fingerprints every representation in the remote
offer before writing, but Chromium does not support `text/rtf`; its successful
write and subsequent read therefore contain only plain text and HTML. The
different fingerprint creates one false local-to-remote prompt. That prompt's
creation records the actual local fingerprint, explaining why approving it
does not continue looping. A deterministic SDK-path reproduction confirmed
this exact three-format-to-two-format sequence, and real Chrome confirmed plain
text, HTML, and PNG support while RTF is unsupported.

The proposed correction is explicitly generic rather than an RTF or
LibreOffice exception. It records the successful write path, serializes
reconciliation with the browser write, and uses a canonical post-write readback
when read authority already exists. It must not request new clipboard-read
permission solely for suppression; a bounded successful-write receipt covers a
later authorized comparison. MIME ordering is irrelevant, and any allowed
representation may be omitted, reduced to fallback, reordered, or normalized.
Tests must prove the correction across every allowed format, multiple browser
capability shapes, read/write timing, missing read authority, reconnect, and a
genuine local change during or after the write. CLP-021 remains unchanged:
suppression belongs only to the writing Client, and another Viewer may prompt
after becoming active.

## 2026-09-03 — Lock and implement clipboard prompt reliability candidate

Status: CLP-025 through CLP-029 scope-locked for RemoteXApp `0.5.1-rc.1` and
SDK `0.21.1`; implementation and local 1991/2991 validation/deployment
authorized, with Human UAT, sandbox rollout, tags, and publication excluded.

The SDK now owns explicit content-height prompt geometry and uses redundant
direction text, arrows, and high-contrast state colors. The browser write path
returns a generic receipt containing only successfully submitted
representations. Reconciliation waits for an in-flight write, fingerprints are
MIME-order independent, and the Client retains bounded subset fingerprints for
browser omission or fallback. When read authority already exists, an immediate
plausible post-write readback adds the actual browser representation set; this
does not request new permission. A genuinely different clipboard clears the
receipt, while the existing per-Client boundary continues to allow another
Viewer to detect the same value.

The acceptance path extends the existing real-browser App Package E2E rather
than adding a separate application-specific implementation. Its full mode now
checks a rich plain/HTML/RTF/PNG write on a browser without RTF support, absence
of same-Viewer rebound, a subsequent genuine local change, and rendered prompt
geometry under the exact wildcard-child CSS regression. LibreOffice runs that
full two-Viewer path in addition to Mousepad. No Manager protocol, App Package
ABI, template, driver, or server process behavior changes.

Candidate commit `b6e6b2fb19e4` subsequently passed `make release-ci`, the
isolated four-App real-browser harness, and the full two-Viewer clipboard path
inside both Mousepad and LibreOffice. Both local managers were then activated
on the exact candidate. Port 1991 retained `0.0.0.0:1991`, Console and kiosk;
its existing `xfce-user-desktop-2c5cf858536f` remained generation 1. Port 2991
retained loopback-only, Console-disabled, kiosk-enabled policy. Each deployed
environment independently passed rich transfer, omitted-RTF no-rebound,
genuine-change prompting, XFixes fanout, view-only, reconnect, permission,
wildcard-CSS geometry/hit testing, and reload cleanup. Temporary runtimes and
browsers were removed and warning journals were empty. The candidate is ready
for Human UAT; sandbox deployment, tagging, and publication remain excluded.

## 2026-09-03 — Accept clipboard prompt reliability UAT and authorize publication

Status: CLP-025 through CLP-029 accepted; formal `v0.5.1-rc.1` GitHub
prerelease publication authorized.

The operator explicitly accepted Human UAT on the exact locally deployed
candidate and then ordered GitHub publication. The annotated tag must remain
immutable, the hosted workflows must repeat the release gate, and the
downloaded archive must be verified against its attached checksum plus its
embedded release, SDK, App Package, generated-asset, and source identities.
This approval does not authorize any sandbox deployment. Exact acceptance is
recorded in
[`clipboard-prompt-reliability-0.5.1-rc.1-human-uat.json`](../tests/go-live-validation/results/clipboard-prompt-reliability-0.5.1-rc.1-human-uat.json).

## 2026-09-03 — Publish RemoteXApp 0.5.1-rc.1 prerelease

Status: annotated `v0.5.1-rc.1` published and independently verified; no
sandbox deployment authorized or performed.

Acceptance commit `d1d1fab8fc75` passed the clean local `make release-ci` gate,
the hosted Verify workflow, and the tag-triggered Release workflow. The
independently downloaded linux/amd64 archive matched its attached checksum at
`cd75801f468cc1b3a71e62b90a87330b560dbe086423d54b5a4f039b833078c2`,
reported the exact tag commit and SDK `0.21.1`, passed the archive
sensitive-data scan, validated all five App Package checksums and seals, and
started with five expected templates plus healthy `/healthz` and `/readyz`.
The served SDK and Console assets matched the committed generated bytes. Exact
evidence is
[`clipboard-prompt-reliability-0.5.1-rc.1-formal-publication.json`](../tests/go-live-validation/results/clipboard-prompt-reliability-0.5.1-rc.1-formal-publication.json).

## 2026-09-03 — Promote 0.5.1 and define the formal alignment process

Status: stable `v0.5.1` publication and the enumerated eight-endpoint rollout
authorized; no functional change permitted.

The operator accepted the published `v0.5.1-rc.1` behavior as the stable
release and authorized local 1991/2991, sandbox00 1991/2991, and
sandbox02/03/07/10 production 1991 only. SDK `0.21.1`, App Package ABI V1,
package versions, dependencies, templates, drivers, and generated assets must
remain identical to the accepted candidate. Exact acceptance is
[`clipboard-prompt-reliability-0.5.1-stable-acceptance.json`](../tests/go-live-validation/results/clipboard-prompt-reliability-0.5.1-stable-acceptance.json).

This rollout and future explicitly approved fleet rollouts use the documented
[对齐流程](release-alignment-process.md): independently verify one GitHub
artifact, stage without selection, activate transactionally one endpoint at a
time, preserve endpoint policy, and prove exact version/commit/hash plus
runtime adoption and no drift. Manager alignment does not rewrite the
immutable components pinned to an existing runtime; runtime recreation remains
a separate, user-impacting action requiring its own authorization.

## 2026-09-03 — Publish and align stable RemoteXApp 0.5.1

Status: stable release and eight-endpoint alignment complete; drift none.

Annotated `v0.5.1` at commit `48b9da84a351` passed the hosted Verify and
Release workflows and became the normal Latest release. The independently
downloaded linux/amd64 archive matched its attached checksum at
`1dbfa4dd3747572bb8970c5c88d5df26cd9c289a8207845790efbd7b22c60eb5`,
passed the sensitive-data and isolated startup checks, and retained the exact
accepted SDK `0.21.1` plus five App Package identities and seals. Exact
publication evidence is
[`clipboard-prompt-reliability-0.5.1-formal-publication.json`](../tests/go-live-validation/results/clipboard-prompt-reliability-0.5.1-formal-publication.json).

The same formal bytes now run on local 1991/2991, sandbox00 1991/2991, and
sandbox02/03/07/10 production 1991. Production Managers adopted all existing
runtimes with unchanged ID, creation time, and session generation; runtime
components stayed locked to their creation releases. All endpoints passed
repeat health/readiness, exact running-binary, SDK, catalog, route, listener,
policy, service-UID, and warning-log checks. The two isolated environments
also passed a temporary on-attach kiosk smoke and were cleaned afterward.
Existing LXD network policy continued to block build-host private HTTP, so
container loopback was used; no firewall or production-gateway state changed.
Exact evidence is
[`clipboard-prompt-reliability-0.5.1-alignment.json`](../tests/go-live-validation/results/clipboard-prompt-reliability-0.5.1-alignment.json).

## 2026-09-04 — Adopt measured test tiers and build-once release promotion

Status: implemented in unreleased RemoteXApp `0.5.2-rc.1`; repository and
local verification changes only, with no deployment, UAT, tag, or publication
authorized.

The development audit found that the ordinary check was already fast (5.28
seconds), while the real four-App E2E took about 73 seconds. Twenty repeat runs
were stable, but Go unit coverage was 56.8%, no fuzz targets existed, only 10
of 57 tracked shell scripts received syntax checks, and historic GitHub runs
showed 20 failures in 64 Verify runs. Evidence records also used many unrelated
top-level shapes. These results favor layered gates over making every edit run
the complete deployment matrix.

The more serious release finding was identity drift. Published `0.5.1`
binaries were built with Go 1.22.12; the exact source call graph reported 35
reachable standard-library vulnerability findings. Go 1.26.8 produced zero
binary findings and passed the complete shipped-App E2E. Historic workflow
data also showed the same `v0.2.0-rc.4` tag running at four different commits.

Consequently, Go `1.26.8` is an exact source/build invariant, source and all
four binary vulnerability scans fail closed, and Actions are full-SHA pinned.
Fast CI adds baseline coverage floors. Scheduled CI owns race, shuffled repeat,
and bounded fuzz checks. Candidate acceptance retains the synthetic ABI and
target-like real-App E2E, including user-home only in a dedicated disposable
account.

Publication changes from rebuild-at-tag to build once and promote. A manual
candidate workflow creates one archive, checksum, and v1 evidence bound to the
full commit. Target-like E2E and Human UAT must use that archive. An annotated
tag on the same commit may publish only those unchanged bytes after verifying
the hash, evidence, exact Go version, embedded VCS revision, clean-build bit,
tag/version match, and absence of historic same-tag runs at another commit.
The tag workflow never recompiles.

New evidence uses `remotexapp/evidence/v1`; accepted historic evidence is not
rewritten. A generated current-state page reads canonical version, SDK, App,
ABI, toolchain, and noVNC metadata but never guesses live deployment state.
The repository's private GitHub Free plan cannot enable branch protection or
rulesets, so required reviewed PRs remain an explicitly documented external
administrative gap rather than a control the code claims to enforce. The full
process and measurements are in
[`development-quality-process.md`](development-quality-process.md).

## 2026-09-04 — Keep the X11 integration suite inside the coverage baseline

Status: implemented after the first hosted Verify run for `0.5.2-rc.1` exposed
an environment mismatch; no runtime, deployment, or release behavior changed.

The initial workflow run at `bcb57ad99cea` passed `make check` but reported
53.2% Go coverage instead of the locally measured 56.9%. The detailed report
showed every X11 clipboard bridge function at zero. This was not platform
rounding: the hosted dependency step omitted Xvfb, xclip, D-Bus, and Clipman,
so the existing integration tests correctly skipped. Lowering the threshold
would have institutionalized less testing in CI.

Verify, candidate, and nightly jobs now install those explicit dependencies
and retain the measured 56.8% floor. The failed run is preserved as v1 audit
evidence in `tests/evidence/v1/hosted-coverage-dependency-gap.json`; the
replacement workflow must prove that the integration tests execute and the
original floor passes before any candidate run is dispatched.

The replacement run then exposed further fixture defects around Clipman. The
test did not use the production `--sm-client-disable` argument, allowed only
five seconds for the first GTK/Xfconf startup on a fresh runner, and killed the
`dbus-run-session` wrapper without killing its private D-Bus and Clipman
children. A second hosted run proved that the production argument alone was
insufficient: Clipman remained alive but had not acquired `CLIPBOARD_MANAGER`
within the old deadline. The fixture now uses the production launch mode, a
bounded 20-second cold-start allowance, and an isolated process group that is
fully reaped. These are test-environment corrections, not product behavior
changes.

## 2026-09-04 — Keep scanner output outside the candidate source identity

Status: implemented after candidate run `33893261401`; no runtime behavior
changed.

The first hosted candidate passed `make release-ci`, source and binary
vulnerability scans, race tests, staging tests, packaging, and generated-source
cleanliness. Final verification nevertheless rejected every binary as
`vcs.modified=true`. An exact clean-clone reproduction of the same commit
produced `vcs.modified=false`. The remaining hosted-only input was Gitleaks'
fixed `results.sarif` file in the repository root: although it is a scan output,
Go correctly treats an untracked file as a modified VCS worktree.

`/results.sarif` is now an explicit ignored scanner artifact. The verifier
continues to require the exact full commit and `vcs.modified=false`; no bypass
or post-build rewriting is allowed.

The next candidate completed successfully and thereby exposed a separate
runner annotation: the pinned `actions/upload-artifact@v4.6.2` still declared
Node 20 and GitHub had to force it onto Node 24. Before selecting a UAT
candidate, the workflow moved to the current official `v7.0.1` commit, whose
action metadata declares Node 24. This preserves full-SHA pinning and removes a
known platform-compatibility fallback from the publication path.

The first v7 candidate attempt exposed a separate race-stage defect. Three X11
integration tests chose a display by scanning Unix socket paths before starting
Xvfb. The third test selected `:118`, but Xvfb then reported that the server was
already running. The fixture now uses Xvfb's `-displayfd` protocol, which
atomically selects, binds, and reports the display. This removes the
scan-then-bind race while retaining real X11 integration coverage.

## 2026-09-04 — Accept the development-quality candidate and promote 0.5.2

Status: Human UAT accepted for exact `v0.5.2-rc.1`; stable `v0.5.2`
publication authorized, with deployment separately controlled.

Candidate commit `2e0dbbd87629` and archive SHA-256
`41ec9cbd58a09b0306c2bdca7d911a08fff8bc08b0803c6a4f5eb6ef8b04ae35`
passed hosted Verify and Candidate workflows, independent identity and
sensitive-data verification, synthetic App Package ABI E2E, and the Edge,
Firefox ESR, LibreOffice, and Mousepad shipped-App E2E. The operator accepted
that exact behavior and authorized stable promotion. The promotion changes
version/release records and release automation only; Manager, gateway, SDK,
App Package ABI, Apps, templates, drivers, and generated browser assets remain
unchanged. Exact UAT and promotion authorization is recorded in
[`development-quality-0.5.2-stable-acceptance.json`](../tests/evidence/v1/development-quality-0.5.2-stable-acceptance.json).

## 2026-09-04 — Make the release verifier's native dependency explicit

Status: gate-discovered release-automation correction included before stable
publication; no product or deployment behavior changed.

The `v0.5.2-rc.1` Release run verified the candidate evidence, checksum,
embedded commit, Go version, and clean-build bit, then failed before
publication because `scripts/check-sensitive-data.sh` correctly requires
`ripgrep` but the minimal Release job did not install it. Candidate and Verify
jobs already installed the dependency. The accepted candidate was published
unchanged only after the same fail-closed check passed locally and the
published assets were downloaded and reverified. The failure is preserved in
[`release-ripgrep-dependency-gap.json`](../tests/evidence/v1/release-ripgrep-dependency-gap.json)
and the recovery publication in
[`development-quality-0.5.2-rc.1-publication.json`](../tests/evidence/v1/development-quality-0.5.2-rc.1-publication.json).

Stable release automation now installs `ripgrep` explicitly, and the workflow
source test prevents its accidental removal. The release metadata gate accepts
the current version in either the active `Unreleased` target or its finalized
version section, so a stable candidate need not falsely claim released content
is still unreleased. The immutable prerelease tag is not moved or reused;
stable `v0.5.2` receives its own candidate and annotated tag.

## 2026-09-04 — Join the cgroup observer reader during shutdown

Status: gate-discovered stable-candidate correction; no API, SDK, App Package,
template, driver, or deployment contract changed.

Hosted Verify run `33899661776` passed `make check` and then lost a cgroup
session event during the coverage run. This was not a hosted-only timeout:
200 repetitions in one local Go process reproduced four failures, three
separate 50-repeat batches all failed, while 30 fresh-process runs had zero
failures. The process-lifetime correlation showed that `Close()` returned
after closing the inotify descriptor without reliably waking and joining its
blocked reader goroutine.

The observer now polls its nonblocking inotify descriptor together with a
private wake pipe. `Close()` marks the observer closed, signals the pipe,
joins the reader, and only then closes all descriptors. This corrects a real
manager resource-lifecycle defect rather than increasing the test deadline.
The replacement passed 500 same-process repetitions and 100 race-enabled
repetitions without a lost event.
Exact failure and reproduction evidence is
[`hosted-cgroup-observer-shutdown-gap.json`](../tests/evidence/v1/hosted-cgroup-observer-shutdown-gap.json).

## 2026-09-04 — Align the approved eight-endpoint fleet to 0.5.2

Status: completed from the exact formal GitHub artifact after separate operator
deployment approval.

The deployment used archive SHA-256
`0f8ce1756a89b6e32a855bc6b557722d21c9e4dfe52b385c8867827353210a83`
and commit `815eae926ef7`. Local 1991/2991, sandbox00 1991/2991, and
sandbox02/03/07/10 production 1991 were selected transactionally, one endpoint
at a time. Every endpoint passed two version, health, and readiness checks;
running Manager hashes, SDK assets, App catalogs, selectors, routes, and
per-endpoint policy matched their expected values.

Existing singleton runtime IDs and session generations were preserved and no
runtime-pinned component was replaced. All endpoints had zero attached clients
at activation, all production manifest counts remained one, and the
post-activation RemoteXApp warning count was zero. The deployment used direct
LXD private connectivity only; `zerotrust-gw` was not exercised. Exact evidence
is
[`development-quality-0.5.2-alignment.json`](../tests/evidence/v1/development-quality-0.5.2-alignment.json).

## 2026-09-07 — Plan Firefox interactive focus compatibility with BiDi

Status: proposed, FFX-007 added to the next draft release train; not implemented.

The local same-profile false/true/false experiment ties normal editable-field
IBus failures to Firefox's automation `focusmanager.testmode` preference.
Explicitly disabling that one preference restored all six ASCII/Chinese
submissions in both positive rounds while BiDi navigation/evaluation remained
functional. See the [experiment](../tests/experiments/firefox-sendtext-2026-09-07/README.md).

Place the proposed correction in the Firefox App driver-generated profile,
not Manager/SDK routing or the generic IBus engine. Retain BiDi and other
recommended preferences, require actual application readback in regression
tests, and preserve password/direct-keyboard-only rejection as the existing
`sendText()` contract. Ship an immutable App patch and explicitly recreate
pinned runtimes only under later approval. The
[draft train](firefox-ime-fix-release.md) records required lifecycle/focus/BiDi
tests and separates scope lock, implementation, UAT, publication and deployment.

## 2026-09-07 — Lock and implement FFX-007 for local 1991 UAT

Status: scope-locked and implemented; packaged-candidate validation and UAT pending.

The operator authorized `0.5.3-rc.1` with Firefox App `2.1.1`, through local
1991 deployment only. The driver explicitly restores native focus mode on
each launch, including reused profiles. SDK runtime behavior and ABI remain
unchanged; existing `sendText()` restrictions are documented. Driver tests
execute the preference-generation block against fresh/stale fixtures. Real
Firefox tests assert DOM insertion across fields, tabs/windows, native chrome
focus return and Viewer reconnect, with profile recreation/runtime restart
coverage in the shipped-App harness. Separate approval remains necessary for
UAT acceptance, any other deployment and publication.

## 2026-09-07 — Approve RTM-017 pinned control-port recovery

Status: operator approved expanding the FFX-007 train; implemented, validation
pending. This supersedes only that train's original Manager-change exclusion.

Fresh App allocations continue to require a plain bind. Pinned recovery uses
the same immutable driver and endpoint and probes with `SO_REUSEADDR`, never
`SO_REUSEPORT`. Linux requires the prior socket to have enabled address reuse
as well; this distinguishes reusable TIME_WAIT from non-reusable sockets while
still rejecting live listeners. See [socket(7)](https://man7.org/linux/man-pages/man7/socket.7.html).
Ownership checks still exclude every runtime except the one being recovered.
The probe is not a reservation or proof of App readiness: normal driver
readiness remains mandatory and fails closed on races or launch errors.
No Firefox/CDP/BiDi recognition or manifest capability expansion is needed.

The gate keeps tests for immediate Firefox restart, same control endpoint,
profile continuity and actual text insertion; it does not wait out TIME_WAIT
or silently allocate a different port. Tests also cover non-reusable sockets,
live listeners and other runtime ownership. Approval remains limited to local
1991 UAT deployment, not publication or any other environment.

## 2026-09-07 — Complete local 1991 candidate acceptance for FFX-007 / RTM-017

Status: automated acceptance and local deployment completed; Human UAT pending.

The exact clean-clone candidate at `2c3c962b44e8` passed portable, kernel/race,
synthetic ABI and real four-App gates. Local 1991 now runs those same archive
bytes. The prior desktop identity/generation/profile and configuration remain
unchanged; only the dedicated Firefox UAT runtime was created and restarted.
The restart retained its control endpoint and incremented generation, with
actual input readback in both sessions. Neither local 2991 nor any sandbox
was deployed. See [acceptance evidence](../tests/evidence/v1/firefox-ime-0.5.3-rc.1-local-1991.json).

Candidate provenance verification rejected the linked-worktree build because
this Go toolchain recognizes a `.git` directory, not that worktree's `.git`
file. A normal clean local clone of the same commit produced all required VCS
stamps; no verifier was weakened. The post-deployment test harness accepts an
explicit local Xauthority path so verification does not require exposing host
paths through the deployed Manager. This changes test tooling only.

## 2026-09-08 — Accept Firefox IME UAT and authorize stable 0.5.3

The operator accepted local 1991 UAT for FFX-007 and RTM-017 and requested
formal publication. Promote the accepted runtime behavior using stable version
metadata only; retain SDK 0.21.1 and Firefox App 2.1.1. A hosted stable candidate
must pass exact-artifact acceptance and then be published without rebuilding.
This authorization does not align local or sandbox deployments. See
[Human UAT](../tests/evidence/v1/firefox-ime-0.5.3-human-uat.json).

## 2026-09-08 — Publish immutable stable 0.5.3

Status: published, normal Latest release; no deployment performed.

Annotated `v0.5.3` identifies `1e4b32e54598`. Hosted candidate 34183500632
passed portable validation and exact downloaded-archive local E2E. Release
34183810815 uploaded that archive unchanged; independent download, embedded
VCS and checksum validation passed. Runtime source is unchanged from accepted
rc.1, Firefox App 2.1.1 bytes match UAT, and SDK remains 0.21.1. Local 1991
stays on rc.1; other environments were not accessed. See
[publication evidence](../tests/evidence/v1/firefox-ime-0.5.3-publication.json).

## 2026-09-09 — Local deployments remain IPv4 loopback-only

Status: accepted operational policy, DEP-016.

The operator revoked the historical local wide-testing listener exception.
Local production and test now bind to `127.0.0.1:1991` and `127.0.0.1:2991`.
All future local deployments, upgrades, rollbacks, and alignments preserve
these bindings; any other local Manager port also uses `127.0.0.1`. Sandbox
listener settings must not be copied into local configuration. A future
non-loopback exception requires new explicit approval.

Actual socket inspection and both readiness endpoints passed on stable 0.5.3;
the production Manager restart preserved desktop identity and generation.
No SDK, App Package, authentication, or sandbox configuration changes are part
of this decision. The [alignment process](release-alignment-process.md)
requires actual listener inspection, not only a successful loopback request.

## 2026-09-09 — Proposed clipboard empty-content normalization

Status: proposed, CLP-030 through CLP-034; not locked or implemented.

A valid zero-byte text/plain multipart part reproduces the reported Manager
EOF error. Empty representations must be distinguished from read failures,
whitespace, and explicit clearing. The proposed train normalizes valid offers
before deduplication and mutation, treats all-empty content as a no-op, and
preserves atomic destination updates. It does not silently discard nonempty
formats to rescue a failing offer. Existing HTML/plain fallback requirements
remain; clear rejection for missing nonempty fallback is proposed for approval
before lock, along with exact public no-op outcomes. See
[the train](clipboard-empty-content-release.md) for scope and acceptance tests.

## 2026-09-09 — Lock empty clipboard semantics and atomic capture

Status: implementation in progress for CLP-030 through CLP-034, superseding
the proposed decision above. Candidate Core `0.5.4-rc.1` / SDK `0.22.0`.

The operator locked implementation and local 1991/2991 deployment. Supported
zero-byte formats normalize away, whitespace survives, and all-empty transfers
return `{skipped:true,reason:"empty-clipboard"}` without destination mutation
or sync-success events. Nonempty HTML without nonempty plain fallback rejects
the whole offer. Duplicate/unsupported formats and read failures remain errors.
Core streaming validation and gateway full-offer validation must finish before
X11 ownership changes; no partial commit is permitted.

X11 capture previously omitted invalid representations or removed HTML without
fallback. It now aborts those captures, retaining zero-byte omission only, and
reports content-free `clipboard-error` events bound to the capture's session
generation. SDK forwards current-generation enabled-direction errors via its
existing clipboarderror surface. No new MIME type or clear API is included.

## 2026-09-10 — Candidate local acceptance and explicit test-port change

The operator's latest instruction selects local 1991 and 2992, superseding
the earlier local test port 2991 in DEP-016; loopback-only binding remains.
The exact hosted `0.5.4-rc.1` artifact passed four-App E2E and was selected
at both local endpoints. New Mousepad/LibreOffice runtimes passed two-Viewer
clipboard and actual application paste/readback. The live desktop retains
its generation and old gateway pin; no forced logout or sandbox change occurred.
See [evidence](../tests/evidence/v1/clipboard-empty-0.5.4-rc.1-local.json).

Short-vacancy tests now prewarm the same-origin browser renderer and SDK
before allocating the runtime. A listening CDP port alone proved insufficient;
this changes test preparation, not App vacancy policy. Human UAT is pending.

## 2026-09-10 — Empty clipboard train accepted for stable publication

The operator explicitly accepted Human UAT and closed CLP-030 through CLP-034.
Stable `0.5.4` publication is authorized without functional changes; SDK stays
`0.22.0` and App Package identities are unchanged. Stable version metadata
requires a same-commit hosted candidate and exact-archive acceptance before
tagging. Publication does not authorize further deployment or runtime recreation.

Stable `v0.5.4` was subsequently published from the exact tested same-commit
candidate. Independent download matched its checksum and bytes, embedded
identity verified, and the archive passed the sensitive-data gate. It is the
normal Latest release. See [publication evidence](../tests/evidence/v1/clipboard-empty-0.5.4-publication.json).

## 2026-09-10 — Proposed Mousepad document-launch train

MPD-001 records optional `filePath` and a proposed alignment of Mousepad's
activation, FPS and vacancy with LibreOffice. This is not a locked decision:
shutdown data-loss policy and same-document concurrency are explicitly listed
for confirmation. Reuse generic App Package file parameters; no new control
protocol or Manager application branch is proposed. Do not copy LibreOffice
lock-file cleanup into another application. See
[the proposed train](mousepad-document-release.md). No runtime code changed.

## 2026-09-10 — Mousepad destructive stop requirement confirmed

The operator selected forced exit without saving, superseding the preceding
graceful-close recommendation for MPD-001. Manager-initiated and idle stops
must not send Ctrl+S or wait for save confirmation; unsaved changes are lost.
Manual saving remains available before stop. Tests must prove original-file
preservation and instance-scoped termination. This records a confirmed scope
decision, not implementation acceptance or authorization to deploy; the overall
train remains proposed and unlocked.

## 2026-09-10 — LibreOffice optional document requirement added

LOF-001 joins MPD-001 in the next proposed train. The operator requests an
optional LibreOffice `filePath`. Recommend Start Center with usable UNO and a
visible application window when omitted, rather than assuming a document type;
confirm that default at lock. File-backed validation/readiness and destructive
shutdown remain. No-file startup must skip initial-document lock/lease work,
and invalid supplied paths must not become blank startup. This is documentation
only; no implementation, deployment or publication is authorized.

## 2026-09-10 — Unified Agent connection information joins the proposed train

CONN-001 records the agreed boundary: RemoteXApp and its SDK describe runtime
connections; trusted local Agents execute protocol-specific control. Reuse
existing App control metadata and add protected environment/private Driver
descriptions rather than duplicating controls or adding a universal proxy.
User-home XFCE reports a user-shared bus, not runtime ownership of every service.
Explicit read authorization, generation/revision validity and private-metadata
non-disclosure are required. This supersedes the earlier claim that the entire
next train needs no Manager/SDK changes: document-launch requirements remain
package-focused, while CONN-001 is an additive platform/SDK change. The train
remains proposed, not locked; implementation and deployment are not authorized.
## 2026-09-10 — Lock optional documents and Agent connection information

The operator locked MPD-001, LOF-001 and CONN-001 and authorized development,
full tests and local 127.0.0.1:1991/2992 deployment only. Target Core 0.6.0-rc.1,
SDK 0.23.0, Mousepad 3.0.0 and LibreOffice 3.1.0. Mousepad uses immediate
activation, 10 FPS, 60-second vacancy and destructive no-save stop, without a
new document lease. LibreOffice no-file startup selects Start Center.

The new read capability is a separate owner-only 64-hex-character token file,
disabled by default and checked in addition to Manager authentication.
SDK credentials are per-call, not stored. Driver private metadata uses separate
bounded mode-0600 schema/status files and cannot appear in public status.
Ready public/private generations and revisions must agree, and canonical
process/cgroup identity and snapshots are rechecked. Descriptor revision is an
opaque content hash stable across Manager adoption; it is not a control lease.
See [the API](agent-connections.md). No control proxy or new Kate/KWrite package
is added. Existing runtime pins and unrelated working-tree changes are preserved.

## 2026-09-10 — Propose explicit runtime upgrade separately from restart

The local XFCE connection test demonstrated why ordinary restart cannot apply
new helper metadata: `restartRuntime` passes the existing resolved template and
component snapshot into recovery. Preserve that predictable recovery contract.
The operator requested a new train for explicit upgrade-and-restart with SDK
support, then added Console current/available runtime version visibility.

UPG-001–004 propose one server-owned transition using the locally deployed core
and enabled App selection, not automatic GitHub updates or a client-side
stop/start pair. Preflight and freeze the target, retain identity/persistent
launch data, advance generation, honor shutdown policy and recover durable
transition phases. Version UI must distinguish Manager identity from actual
runtime pins. No automatic rollback of App-mutated persistent data is promised.
See [the proposed train](runtime-upgrade-release.md). This does not unlock the
current `0.6.0-rc.1` UAT train or authorize implementation/deployment/publication.

## 2026-09-10 — Separate Kate and KWrite packages with discovered D-Bus control

The operator requested two templates, `kate` and `kwrite`, and verification of
how their control information is obtained and reported. Local 23.08.5 tests
proved distinct PID-owned service prefixes but the same
`org.kde.Kate.Application` interface. Kate requires `--block --startanon` to
avoid daemonized PID capture/reuse; KWrite runs foreground without those flags.
Four simultaneous test processes passed real file/text readback and existing
private status-helper submission. This supports CONN-001 integration without
App-specific Manager/SDK code. Do not advertise UNO-equivalent document editing
or assume dynamic Qt action paths are stable control APIs. See
[research](kate-kwrite-control-research.md); KTE-001/KWR-001 remain proposed,
with real App Package and lifecycle acceptance still pending.

## 2026-09-10 — Lock runtime upgrade and KDE editor train

The operator locked UPG-001–004, KTE-001 and KWR-001 for Core `0.7.0-rc.1`
and SDK `0.24.0`, with local 1991/2992 deployment after verification. This
supersedes the proposal-only state above, not the invariant that ordinary
restart retains pins. No sandbox or publication is authorized.

One private per-runtime manifest stores frozen target Package/component identity
and stopping/launching/completed/blocked/failed phase. A generation plus target
revision guards POST; no second database or client-side stop/start transaction.
Recovery reconciles intent before ordinary runtime adoption. Failed transitions
do not automatically fall back to older packages or retry managed creation.
Cancellation stops waiting, not an accepted server transition. Clients reconcile
after ambiguous errors instead of resubmitting destructive requests. The public
version projection contains identity hashes, not private component paths.

Both KDE packages verify the launched process's bus owner, control signatures and
visible window before publishing private descriptors. Their no-save policy also
applies to the session EXIT/TERM trap because a forced Manager stop bypasses the
graceful driver. Local real-App testing exposed KDE retaining modified documents
after SIGTERM; the trap must terminate its own editor with SIGKILL, not wait for
systemd's default 90-second stop timeout. This does not change other App policies.

The new semantic-version dependency uses `golang.org/x/mod v0.40.0`, not the
previous indirect v0.39.0. The source scanner did not find reachable vulnerable
calls, but the stripped-binary gate rejected v0.39.0. Both Go advisories identify
v0.40.0 as fixed: [GO-2026-6179](https://pkg.go.dev/vuln/GO-2026-6179) and
[GO-2026-6180](https://pkg.go.dev/vuln/GO-2026-6180). Keep both gates and ship
the dependency's BSD license in archive, system and user installations.

Final recovery review found that a pending startup upgrade could fail before
stopping the old session without registering its observer. Restore session exit
observation and existing host policy timers for a verified surviving session,
as already done when loading a previously failed/blocked record. Regression
tests cover target validation, shutdown veto and cleanup failure survivors.

## 2026-09-10 — Runtime upgrade candidate deployed locally

Exact hosted candidate `a3f4a2569d4f` (`0.7.0-rc.1`, SDK `0.24.0`) passed
the portable release gates and the full exact-archive acceptance suite, then
was deployed to local 2992 followed by 1991. Both endpoints passed actual
editor, private connection, browser resize/IME/reconnect and no-save checks.
Existing selectors were retained and independent Kate/KWrite selectors added.
Console DOM verification confirmed old desktop/current versus new available
identity without invoking either destructive action. Existing desktop pins,
loopback-only listeners, page policy and token files remain unchanged.
Live XFCE upgrade and native browser UX are not claimed as tested; Human UAT
is pending. No sandbox deployment or publication occurred. See
[evidence](../tests/evidence/v1/runtime-upgrade-0.7.0-rc.1-local.json).

## 2026-09-10 — Proposed trusted Console connection inspector

CONN-002 records the approved direction for a read-only Connection info panel
using CONN-001, not a second API or protocol-control proxy. This proposal extends
the trusted consumer set to an explicitly authorized operator Console; ordinary
Viewers remain excluded. The Manager-wide capability is manually supplied and
kept only in panel memory, never automatically exposed by the server. The page
and same-origin scripts must be trusted. Lifecycle changes invalidate displayed
snapshots and late responses. Only existing descriptor fields are promised;
IBus connection discovery is not currently part of CONN-001. See the
[proposed next train](console-connections-release.md). Implementation and
deployment are not locked; existing candidate bytes and evidence remain unchanged.

## 2026-09-10 — Add IBus discovery to the proposed connection train

The operator approved CONN-003 alongside CONN-002. This supersedes the proposed
inspector's existing-fields-only scope for IBus, not its prohibition on guessing
addresses or executing controls. Source inspection confirms the shared input
helper starts a per-runtime IBus even with user-home's shared user D-Bus.
Record actual launch metadata and validate daemon/socket identity before adding
the optional private descriptor field and SDK support. Legacy missing metadata
remains unavailable; malformed/stale metadata fails closed. No lifecycle-layer
split, automatic runtime replacement, public exposure or new control service
is authorized by this requirement. See the [updated proposed train](console-connections-release.md).

## 2026-09-10 — Lock Console and IBus connection train

The operator locked CONN-002/003 for development, tests and local 1991/2992
deployment. Target Core `0.8.0-rc.1` / SDK `0.25.0`, unchanged App versions.
This supersedes the proposal-only authorization above. Existing runtimes and
page/token/listener policies remain intact; no sandbox or publication approval.
The private IBus launch record carries generation, PID and process start time;
the Manager checks session cgroup, socket ownership and Unix peer credentials.
The Console uses a separate read-only inspection model, not Viewer credentials
or diagnostics; close and lifecycle invalidation discard sensitive snapshots.

## 2026-09-10 — Console and IBus candidate deployed locally

Candidate `c64d1857da26` passed hosted gates and the full exact-archive suite,
including IBus protocol reads, browser Console checks and a disposable-UID
XFCE session. The latter used unchanged shipped drivers with only fixed display/
ports relocated to avoid the occupied desktop. Its cleanup initially exposed
an asynchronous user-service stop; the harness now waits for that service and
its processes before removing its unique account/home. Browser tests also found
and fixed the queued close-event/rapid-reopen race. Required hostile-text
assertions and managed legacy inspection were additionally verified against the
unchanged deployed candidate; those follow-ups change tests, not shipped code.

Local 2992 then 1991 were deployed without changing selectors, access policy,
token files or existing runtime pins. Both endpoints passed six real App IBus
queries and original SDK 0.24.0 compatibility. The existing desktop correctly
reports legacy IBus metadata absence; inspection does not retrofit or restart it.
No sandbox or publication occurred. Native permission UX and Human UAT remain
pending. See [evidence](../tests/evidence/v1/console-connections-0.8.0-rc.1-local.json).

## 2026-09-10 — CONN-004 uses Manager authentication for connection reads

Supersedes the separate connection-read capability requirement in CONN-001/002.
At operator request, API, SDK and Console no longer require a dedicated token.
Normal Manager authentication and same-origin enforcement remain; metadata,
generation, process and socket validation are unchanged. No per-runtime access
is introduced: auth-mode=none makes descriptors readable to reachable callers.
The legacy token-file option is accepted but ignored to keep existing service
units startable; it no longer protects reads. No deployment is part of this edit.

## 2026-09-10 — Deploy token-free connection reads locally

The operator subsequently authorized both local deployments. New immutable
Core 0.8.0-rc.2 / SDK 0.25.1 candidate a96b7bd51435 passed clean-clone local
release-ci and full exact-archive acceptance. A stale token variable in a test
assertion was corrected and the entire E2E suite rerun against unchanged bytes.
2992 then 1991 passed six-App no-token reads, real IBus protocol queries and
SDK compatibility. Console DOM passed on the candidate and deployed 1991.
Existing desktop ID/generation/pins and service/App configuration were retained.
Legacy token configuration remains on disk but is ignored. No sandbox or GitHub
publication; Human UAT pending. See
[evidence](../tests/evidence/v1/tokenless-connections-0.8.0-rc.2-local.json).

## 2026-09-10 — CONN-005 binds Console to its build-matched SDK

The operator's failing Console produced no connections request and its default
SDK import was 0.24.0, while a cache-busted import loaded 0.25.1 and successfully
read the same instance. This proves a mismatched client graph, not a failing
Edge connection descriptor; it does not identify which cache served the old entry.
Inject the SDK bundle filename after its build and before Console bundling.
Resolve that immutable sibling relative to import.meta.url, preserving proxy
prefixes. Console content/hash now changes whenever its SDK filename changes.
Keep /sdk/index.js for external consumers; no fallback to a mismatched version.
This does not force already-open pages to reload or cure a cached Console entry.

Regression: check the manifest/bundle binding in make check. The live browser
test tests/app-package/check-console-sdk-cache.mjs primes an obsolete module
entry in the same document before loading the actual built Console, tests both
root and nested paths, and asserts a matching SDK fetch plus successful reads.
It requires Chrome and a local ready fixture runtime; only GETs reach its Manager.

## 2026-09-10 — rc.3 local deployment and singleton smoke-test incident

Both Managers now serve the rc.3 artifact and matched Console/SDK. Full candidate
suite coverage passed across runs after moving the cache test off a 60-second
editor fixture onto an independent six-hour browser fixture; shipped code did
not change. Manager deployment preserved both existing runtime IDs/generations.

The subsequent 1991 smoke script incorrectly treated a singleton create response
as a new test-owned runtime. It stopped existing edge-721897a6883d at 09:32:17 UTC.
The operator was notified immediately after identifying this. The persistent
default profile directory remains, but no runtime recreation is authorized or
performed yet; unsaved browser state is not guaranteed recoverable. XFCE remains
running unchanged. Runtime-preservation acceptance is failed, not passed.
Future smoke tests must skip pre-existing singleton templates and independently
exclude every pre-existing ID from cleanup ownership. See the alignment runbook
and [failed alignment evidence](../tests/evidence/v1/console-sdk-binding-0.8.0-rc.3-local.json).

## 2026-09-10 — Accept UAT and authorize stable 0.8.0 publication

The operator accepted rc.3 UAT and requested a formal GitHub release. Promote
the current combined document, upgrade/KDE and connection train to stable 0.8.0;
SDK remains 0.25.1 and App versions remain unchanged. Runtime source and built
browser assets must match the accepted candidate; stable version metadata and
the isolated cache-test fixture correction are not new product behavior.
Publish the exact successful hosted candidate after local archive acceptance,
without rebuilding it for tagging. No additional deployment, gateway change or
Edge recreation is authorized. The singleton-test incident and failed runtime
preservation evidence remain recorded, independently of Human UAT acceptance.

## 2026-09-10 — Publish stable 0.8.0 unchanged from its hosted candidate

Annotated v0.8.0 identifies c097bbcdb032. Hosted Verify 34472005167 and candidate
34472004424 passed. The downloaded candidate passed all exact-archive suites,
including isolated cached SDK root/subpath tests and disposable-user XFCE.
Release 34473201571 uploaded that same artifact without rebuilding. Independent
download, checksum/VCS/secret checks and byte comparison passed. GitHub reports
Latest, non-draft, non-prerelease. No local/sandbox deployment, gateway change or
Edge recovery occurred. See [publication evidence](../tests/evidence/v1/connections-0.8.0-publication.json).

## 2026-09-10 — Align eight endpoints to formal 0.8.0

The operator subsequently authorized deployment to all environments. Local
1991/2992, sandbox00 1991/2991 and sandbox02/03/07/10 1991 now use the published
0.8.0 artifact and SDK 0.25.1. Two Manager starts per endpoint preserved all
active runtime identities, generations, session states and component/App pins.
Only Managers and enabled catalogs changed; no application was recreated.
Stopped in-memory history entries disappear normally on Manager restart;
they are not active runtime losses. Existing sandbox02 stopped and sandbox03
shutdown-blocked sessions remain unchanged. Read-only running-session
connection checks succeeded. Direct private HTTP access remains blocked from
the build host; container-loopback checks passed. No gateway/firewall mutation.
See [alignment evidence](../tests/evidence/v1/connections-0.8.0-alignment.json).

## 2026-09-10 — Release stopped allocations during explicit upgrade (UPG-002)

The authorized sandbox runtime upgrade exposed a self-collision on fixed
display :1. PreserveRuntime leaves the record restarting after process cleanup;
ordinary restart excludes its own record via pinned allocation, but upgrade
allocates the new template without that exclusion. The old restarting record
therefore falsely reserves the display. Sandbox02/03 stopped successfully but
failed to relaunch; the remaining sandbox upgrades were paused.

After successful cleanup only, mark the old runtime stopped and durably record
that state with the launching upgrade phase. Desired running intent and the
frozen target remain recoverable. Do not hide records, bypass real socket checks,
force shutdown, or change ordinary restart pins. Regression tests exercise the
actual allocator, durable state, foreign owners and live listeners; the local
managed-editor E2E now uses a fixed display and verifies application readiness
and connection metadata after upgrade.

## 2026-09-10 — Authorize 0.8.1 hotfix publication and fleet recovery

The operator explicitly requested packaging, formal GitHub release, deployment
to all eight existing endpoints, then recovery and completion of sandbox runtime
upgrades. Scope is the UPG-002 fixed-allocation correction; SDK 0.25.1 and all
App Packages remain unchanged. This is direct hotfix publication authorization,
not a claim of new human UAT. Hosted candidate and exact-archive local E2E must
pass before publication. Preserve all deployment policies, stage immutable
0.8.1 directories, then resume failed upgrades through the generation/revision
guarded API. Do not force blocked sessions without additional authorization.

## 2026-09-10 — Publish/deploy 0.8.1 and recover failed fixed-display upgrades

Hosted Verify 34488317932, candidate 34488317268 and Release 34489759398
passed for 7c252209b250. Complete exact-archive local E2E passed, including
fixed-display managed upgrades and disposable-user XFCE. Published Latest
v0.8.1 was independently verified byte-identical to that candidate. All eight
Managers were aligned without configuration changes. The guarded upgrade API
then recovered sandbox02/03 to 0.8.1; real desktop/RFB/IBus/connection checks
passed. Sandbox00 XFCE refused graceful shutdown, so the remaining runtime
batch was paused without force. This is a shutdown-policy blocker, not another
allocation failure. See [evidence](../tests/evidence/v1/upgrade-0.8.1-alignment.json).

## 2026-09-10 — Complete sandbox runtime upgrade with explicit force approval

The operator authorized force after sandbox00's graceful shutdown blocked.
Guarded upgrade requests with force=true upgraded sandbox00 XFCE/Firefox and
sandbox07/10 XFCE to 0.8.1. Already-current sandbox02/03 were skipped. All six
runtimes are running/ready with completed upgrades and no remaining errors;
the four restarted applications passed actual RFB/IBus/connection verification.
Profiles and IDs remain unchanged. Host forceAfter policy and local runtimes
were not changed. See [completion evidence](../tests/evidence/v1/upgrade-0.8.1-force-completion.json).

## 2026-09-10 — Propose package-owned actions and browser openUrl

The operator requested adding the agreed direction to the next release train;
this records requirements only, not implementation or a locked release. Add a
generic Manager/SDK invocation contract while App handlers own Firefox BiDi
and Edge CDP operations. This extends the earlier Agent-only control design
for declared bounded actions; CONN-001/getConnections remains read-only and
raw socket proxying remains excluded. Existing singleton create/startUrl
behavior is unchanged. Default new-tab navigation requires an already-ready
session, generation validation, lifecycle coordination, bounded execution and
explicit external BiDi ownership handling. No automatic retries, forceful
controller takeover, generic shell API or new Driver HTTP service. Core/SDK/App
versions and ABI compatibility are not yet locked. See
[ACT-001–007 and proposed train](app-actions-release.md).

## 2026-09-10 — Add Console action testing to the proposed train

The operator added ACT-008: a template-neutral Console panel discovers pinned
actions, collects parameters and invokes the public SDK with explicit user
intent. Show safe structured results/errors, pending and ambiguous outcomes;
guard against duplicate clicks and stale multi-window/lifecycle responses.
This supersedes the initial train's exclusion of a Console action input UI,
but does not authorize package editing, arbitrary commands or kiosk controls.
Console-disable and Manager auth policies remain unchanged. The train is still
proposed, not locked or implemented. See [updated train](app-actions-release.md).

## 2026-09-10 — Lock and implement generic package actions

The operator locked ACT-001–008 for local 1991/2992 UAT only. Core 0.9.0-rc.1,
SDK 0.26.0, Firefox 2.2.0 and Edge 1.1.0 implement optional App Package V1
actions. This supersedes the proposed status above, not accepted earlier
lifecycle decisions. Old packages remain valid; old Managers reject new fields.

Capability discovery uses the runtime pin. Execution validates sealed content,
generation and the canonical connection descriptor; declared handlers receive
bounded JSON directly, with a small graphical environment and no shell or
caller-supplied endpoint. Shared actions affect every viewer. Same-UID trusted
package code remains outside a hostile-code sandbox. Process-group cancellation
and join precede lifecycle replacement; ambiguous outcomes never auto-retry.
Firefox owns and releases only the BiDi session it created. The Console uses
the public SDK and clears transient input/results on close or target change.

Real repeated Edge calls exposed Python's imported-helper bytecode cache
altering the sealed package after the first call. Disable bytecode creation in
the action environment and browser handlers; keep content verification strict.
See [contract and verification](app-actions-release.md). Existing user runtime
pins and sandbox services are outside this deployment authorization.

## 2026-09-10 — Bound input reads and allow owned protocol cleanup

ACT-005 review found that reading a request body under the lifecycle lock
would allow a slow upload to block unrelated operations. Read the bounded body
with a five-second HTTP deadline before taking that lock; a blocked-reader
regression proves other action discovery remains responsive.

A real Firefox experiment confirmed WebSocket disconnection does not itself
end a BiDi session. Cancellation therefore sends SIGTERM with a four-second
cleanup allowance before force kill. Firefox's handler ends only the session
associated with its own WebSocket, including interrupted session.new replies;
it never cleans a foreign controller. Parent death also signals the handler.
Real injected-delay tests cover cancellation, Manager crash and successful
subsequent action; a TERM-ignoring process group tests forced enforcement.
Cleanup is bounded best effort if the browser itself is unresponsive, not an
authorization to steal sessions or restart the application automatically.

## 2026-09-10 — Accept App Actions and authorize stable publication

The operator accepted local rc.1 UAT after separately authorizing forced
XFCE/Edge runtime upgrades, then requested formal `0.9.0` publication.
Promote without functional changes: SDK `0.26.0`, Firefox `2.2.0`, Edge `1.1.0`.
Stable metadata requires a new exact candidate and archive E2E before tagging;
publish those same verified bytes. Acceptance does not authorize deployment
or sandbox/runtime changes. The earlier pin-preservation evidence remains
historical, not a claim that the later approved upgrades preserved old pins.
See [human acceptance](../tests/evidence/v1/app-actions-0.9.0-human-uat.json).

## 2026-09-12 — Keep idle RFB transport alive independently of input

Sandbox10 observations measured two RFB WebSocket closures after approximately
125 seconds without RFB data while the separate input connection remained
active. A later passive capture showed cloudflared closing its nginx connection
before nginx closed the origin connection. Cloudflare's internal terminating
component remains unconfirmed; its HTTP proxy timeout setting alone is not
proof of the WebSocket policy.

Implement RFB-001 in both Go RFB relays: send protocol Ping every 30 seconds,
with a five-second WriteControl deadline. Gorilla permits control writes
concurrently with the data writer; browsers answer Pong without SDK code.
Control frames do not enter the RFB stream or application byte counters. Join
the heartbeat worker on relay exit and close both endpoints on a failed Ping.
Do not introduce read/Pong deadlines: the relay's bounded queues can backpressure
the reader, so delayed Pong processing is not sufficient evidence of failure.
This is idle keepalive, not a new peer-liveness enforcement policy.

Preserve queue capacity, ordered lossless data, lifecycle policy and SDK retry
semantics. No application-specific activity or fake mouse input is used.
Local automated tests use an accelerated cadence and an idle read deadline,
covering repeated Ping/Pong, unchanged data and both endpoint shutdown paths.
Real Cloudflare validation requires a separately approved deployment; no
production services or gateway configuration were changed for this fix.

## 2026-09-16 — Propose LightView as a shared App Package

Status: LTV-001–006 proposed; target versions unassigned; train not locked or
implemented. The requested template follows Edge/Firefox's shared singleton,
persistent `default` profile, on-attach and six-hour vacancy policy, while using
LightView's native Unix JSON control socket rather than a generic TCP resource.

Keep the package boundary intact. The Driver chooses a private runtime-local
socket, verifies the visible window and a PID-matching native `status` response,
and publishes `{protocol,transport,socketPath}` through existing bounded private
CONN-001 application metadata. `getConnections()` already projects this opaque
descriptor for a current ready generation, so Core and SDK must not gain a
LightView-specific branch or socket proxy. A bounded `openUrl` action is public;
raw `eval` remains direct same-UID local-Agent control because it can access
signed-in page state.

The review used LightView 0.1.0 source documentation and ran its six real
Xvfb/WebKit integration tests successfully. This supports feasibility, not
RemoteXApp acceptance. Package, lifecycle, recovery, security, exact-candidate
and human-UAT gates remain required. See
[the proposed release design](lightview-app-package-release.md).

Operator follow-up locks low-memory behavior within the proposed template:
every Driver launch includes `--low-memory`, with no caller/instance override.
The current 384 MiB WebKit per-process pressure target is not a whole-runtime
hard cap; its image/media/WebRTC/WebGL/canvas feature reductions are accepted
and must be verified explicitly. This refines LTV-002 without authorizing the
train or changing the existing LightView installation.

The operator then locked LTV-001–006 for development and production-quality
local UAT. The train is App-only: `lightview@1.0.0`; Core `0.12.2` and SDK
`0.28.0` remain unchanged. Authorization covers package-only deployment to the
two loopback local environments after all gates pass, but not publication,
sandbox deployment or replacement of unrelated runtimes.

Implementation and local deployment completed the same day. Package-only
installation produced one immutable archive and activated identical bytes on
loopback 2992, then 1991 after the isolated smoke passed. The complete release
gate, 20-run shuffled soak, fuzz targets and LightView's 14-scenario real E2E
passed. Deployed checks proved Viewer/RFB/input, Unicode text, resize, private
connection metadata and bounded `openUrl`. The existing XFCE runtime was adopted
without changing its ID, generation, component processes or manifest digest.
Both local services retain their pre-existing Core `0.12.0-rc.2`; this proves
App ABI compatibility but is not a Core alignment. Human UAT is pending.

The local container blocks WebKitGTK's bubblewrap sandbox. For local UAT only,
the user manager supplies WebKit's explicit unsafe sandbox override plus
software rendering. This is an environment qualification, not App policy: no
override is present in the package, and production deployment requires a host
where the normal WebKit sandbox works. Publication and sandbox deployment remain
unauthorized. See [the durable evidence](../tests/evidence/v1/lightview-1.0.0-local-uat.json).

The operator accepted UAT and authorized formal release. Follow the existing
independent-App path: annotated `lightview-v1.0.0` on the accepted source commit,
with only the deterministic App archive and checksum as assets. The App tag must
not move the existing Core `v0.12.2` tag, replace the RemoteXApp Latest release,
or imply sandbox deployment. Verify downloaded bytes and manifest identity
before recording publication complete.

Formal publication completed through annotated tag `lightview-v1.0.0`, peeled
to accepted source commit `422cb0a2c12d`. GitHub serves only the deterministic
archive and checksum; independent download, checksum, byte comparison and
manifest identity checks passed. The App Release is neither draft nor
prerelease, and the repository's Latest Core release remains `v0.12.2`. No
sandbox deployment occurred. See
[publication evidence](../tests/evidence/v1/lightview-1.0.0-publication.json).

## 2026-09-12 — Accept heartbeat UAT and align every live runtime

The operator accepted local heartbeat UAT and explicitly authorized formal
0.9.1 publication, all eight established endpoints, and forced upgrades of
every live runtime including Edge. Publish the unchanged hosted artifact after
exact-archive tests; preserve SDK 0.26.0 and App Package identities. Manager
alignment remains distinct from runtime pin replacement. All seven live
runtimes were subsequently force-upgraded, attached and verified ready with
formal gateway bytes and periodic Ping/Pong; no stopped history was relaunched.
The two test endpoints had no live runtime. Existing network restrictions were
preserved. See [evidence](../tests/evidence/v1/rfb-heartbeat-0.9.1-alignment.json)
for the temporary-account cleanup retry and resize-aware verifier correction.

## 2026-09-12 — Lock Viewer-local clipboard consistency (CLP-035–038)

Core 0.10.0-rc.1 / SDK 0.27.0 follows three rules: genuinely changed content,
one latest valid prompt per direction with revalidated consent, and explicit
choice for independent two-sided changes. This supersedes replaying every
unexpired offer on recovery; first observation is a manual baseline, while
unseen newer revisions can recover after reconnect. Apps remain unchanged.

Use SHA-256 identities across all supported representations and a session-bound
observed remote sequence, not cross-machine timestamps or a shared coordinator.
The additive upload sequence precondition and stale-accept check reject HTTP
409 before transferring outdated offers. Asynchronous native captures are
scoped to their session/owner epoch. New guarded SDK approvals require upgraded
runtime gateways; Manager selection alone cannot change an old runtime pin.

These are observed-state checks, not atomic OS compare-and-swap. Explicit
write-only manual transfer can replace an unknown local clipboard; automatic
transfer cannot infer authority from unreadable or unknown state. Required
read failures preserve the clipboard. See the [locked contract](clipboard-prompt-consistency-release.md)
for consent, race bounds and WAOS compatibility. Only local loopback 1991/2992
deployment is authorized; development/verification are in progress, with no
GitHub publication or sandbox rollout.

## 2026-09-12 — Validate and deploy clipboard consistency locally

Exact candidate `a8569d1e92de` passed clean-clone release-ci, all six
exact-archive E2E suites and post-deployment two-Viewer Mousepad/LibreOffice
checks on both loopback endpoints. The earlier worktree build lacked VCS
metadata and was rejected. E2E exposed explicit supplied uploads overwriting
the browser observation baseline; a further unit repro exposed old consent
surviving a generation update before socket closure. Both were corrected and
the final archive reran all gates before selection.

Stage both endpoints before selecting; verify two Manager starts, exact bytes
and unchanged config/App selectors/runtime pins. Existing XFCE generation 7
remains on 0.9.1 because restart/upgrade approval was not granted. Test-created
runtimes were stopped; new instances use 0.10.0-rc.1. Human UAT remains pending,
with no GitHub push/publication or sandbox mutation. See
[evidence](../tests/evidence/v1/clipboard-consistency-0.10.0-rc.1-local.json).

## 2026-09-12 — Clipboard success receipts (CLP-039)

Successful notices are non-actionable, auto-dismissed receipts, not a second
consent prompt. Keep existing direction, expiry and retry semantics. SDK
`approve()` and `syncToLocal()` add an ephemeral `summary:{types,preview}`
to successful results, derived from uploaded items or actual browser write
receipts (including fallback), not advertised offer types. Bound plain-text
samples to 80 Unicode code points plus ellipsis, collapse whitespace/control
characters and render with textContent. Never interpret HTML/RTF as a sample
or add clipboard previews to offer events, snapshots or diagnostics. This is
a source follow-up; the already-tested/deployed rc.1 artifact is unchanged.

## 2026-09-12 — Clipboard receipt size and PNG dimensions (CLP-040)

Extend the ephemeral SDK transfer summary with `totalBytes` and
`representations:[{type,bytes,width?,height?}]`, derived from actual upload or
browser-write receipts. Sizes count encoded payload bytes per format, including
UTF-8 bytes rather than character counts. Read only PNG signature/IHDR metadata
(33 bytes), never decode a full image for a notice. Omit unavailable dimensions;
metadata is descriptive, not a substitute for existing image validation.
No payload or preview is added to offer broadcasts, snapshots or diagnostics.
Existing direction, consent and three-second notice duration remain unchanged.

## 2026-09-12 — Pre-consent clipboard previews (CLP-043, locked design)

Extend the locked clipboard icon train with preview-before-approval in both
directions. Unlike CLP-039/040 success receipts, previews describe offered content,
not a completed transfer. Keep samples and image data Viewer-local and ephemeral;
do not extend payload-free broadcasts or diagnostics. Existing permissions,
payload limits and source/destination consent revalidation remain mandatory.
Bind preview retrieval to the offer revision, discard stale results, bound text
and image resources, release object URLs, and never render HTML/RTF markup.
Unavailable previews must be explicit, not inferred from unrelated content.
Implementation and local 1991/2992 deployment are pending; no sandbox change or
publication is authorized by this amendment.

Implementation follow-up: reuse the existing repeatable, generation/revision-
guarded `/clipboard/offers/{id}/accept` payload retrieval for remote previews.
Despite the historical name, that endpoint does not write a browser clipboard
or consume the offer; keep actual writes in the existing consent path. Local
previews use the already captured offer payload, not another browser read.
PNG thumbnail decoding is capped at 16 MiB encoded / 4,194,304 pixels. Keep
metadata for larger images without decoding them. Permit blob images in the
shipped CSP for ephemeral object URLs; do not add blob script permission.
Embedding hosts must allow data/blob image sources to use the standard UI.

## 2026-09-16 — Formally align LightView 1.0.0 on local and sandbox00/01

Deploy the immutable public `lightview@1.0.0` App archive to local loopback
1991/2992 and sandbox00/01 production 1991. The initially installed Lightview
0.1.1 dependency was rejected before selector activation because it changes
the locked `--low-memory` media policy. Install the formal Lightview 0.1.0 host
release instead; do not weaken the Driver's version gate or silently broaden
LTV-002.

Stage the App without activation, switch each production selector under a
Manager-only restart and retain rollback state. Real Viewer startup, visible
ready status, same-UID Unix control, `openUrl`, cleanup and final Manager
adoption passed on every endpoint. Existing XFCE runtime identity, generation
and process IDs survived. Local listeners remain loopback-only. Sandbox00 2991
was not authorized, its selector remains absent, and the container was not
rebooted. See the [deployment evidence](../tests/evidence/v1/lightview-1.0.0-local-sandbox00-sandbox01-alignment.json).

## 2026-09-16 — Supersede the LightView host dependency pin with 0.1.1

Lightview 0.1.1 corrects the low-memory policy after real YouTube Music use
showed that disabling media APIs could crash WebKitGTK. LightView App Package
1.0.1 replaces the 1.0.0 driver pin with an exact 0.1.1 pin. Keep media,
MediaSource, encrypted media and WebAudio enabled; retain disabled automatic
images, WebRTC, WebGL and accelerated 2D canvas. This supersedes the earlier
0.1.0 dependency decision while preserving the exact-version fail-closed gate.

## 2026-09-16 — Advance the LightView host dependency pin to 0.1.2

Real pointer acceptance exposed a separate WebKitGTK 2.52 native fault when a
YouTube Guide entry performs user-gesture navigation. Lightview 0.1.2 routes
trusted YouTube link clicks through programmatic navigation. App Package 1.0.2
replaces the exact 0.1.1 pin with 0.1.2; all other lifecycle, control-socket and
low-memory requirements remain unchanged.

## 2026-09-16 — Align restricted-container sandbox state for LightView 0.1.3

Longer real-pointer acceptance after YouTube Guide navigation exposed a delayed
WebKitGTK native fault. The local container requires WebKit's sandbox override
because it cannot create the user namespace used by bubblewrap, while Lightview
still explicitly enabled sandboxing on its WebKit context. Lightview 0.1.3 makes
the context state follow that process override. App Package 1.0.3 advances the
exact host dependency gate from 0.1.2 to 0.1.3; browser policy, lifecycle and
the private control contract remain unchanged.

## 2026-09-16 — Move YouTube navigation into Lightview's UI process in 0.1.4

Extended acceptance showed that the 0.1.3 page-side redirect could still hit a
delayed WebKitGTK fault after several successful Guide navigations. Lightview
0.1.4 passes trusted YouTube link targets over a native script-message channel
and starts the replacement load from the GTK UI process. App Package 1.0.4 pins
that exact host version. Three real-pointer Guide → Music → Home cycles and a
45-second idle period passed with the existing persistent desktop profile.

## 2026-09-16 — Select shared-memory WebKit rendering for Lightview 0.1.5

Matched WebKitGTK debug symbols identified the video crash as a null dereference
in `AcceleratedBackingStore::update()`. The local environment used
`WEBKIT_DISABLE_DMABUF_RENDERER=1`, which leaves WebKitGTK 2.52 without a buffer
transport when YouTube creates its first composited video layer. Replace it with
`WEBKIT_DMABUF_RENDERER_FORCE_SHM=1`. Lightview 0.1.5 also translates the legacy
setting internally, and App Package 1.0.5 pins that exact host version. Real
pointer playback advanced beyond 60 seconds at ready state 4 without error.

## 2026-09-16 — Make shared-memory rendering and web codecs deployment defaults

Sandbox acceptance found that clean sessions inherited no renderer override, so
Lightview 0.1.5 could still choose the unusable container DMABUF path. Lightview
0.1.6 defaults to `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` while preserving an
explicit operator value. A second live check showed that the sandbox player
stayed alive but rejected a stream because only the GStreamer base/good plugins
were installed. App Package 1.0.6 pins Lightview 0.1.6 and adds
`gstreamer1.0-plugins-bad` plus `gstreamer1.0-libav` to the Ubuntu host package
list. Acceptance requires video time to advance, not only successful page load.

## 2026-09-16 — Propose fail-closed Edge stale-profile-lock recovery

One sandbox could not start Edge because its persistent profile retained
Chromium singleton links naming a different sandbox host, a stale PID and a
missing `/tmp` socket. The affected sandbox had no such PID, socket, profile
user or Edge CDP listener.
Moving only those three links to a private quarantine restored a real Viewer,
visible Edge readiness, CDP 1.3, connection metadata and `openUrl`; cookies and
the remaining profile were untouched. This establishes the incident cause but
is not yet a product implementation.

Add proposed EDGE-005 to the next release train. Cleanup belongs in the Edge
Driver because Chromium profile-lock semantics are App-specific. Require three
independent stale signals—invalid owner identity, unavailable socket and no
exact profile user—before quarantine. Never treat age, hostname difference or
PID absence alone as sufficient. A proven live owner fails closed. Core and SDK
remain generic, and implementation, release and deployment stay separately
gated.

## 2026-09-16 — Add reviewed latest-release catch-up for Lightview

Add proposed LTV-007 to the next train. “Latest” is resolved only when the train
is locked, then converted into an immutable exact tag and checksum; production
never follows a moving release pointer or accepts arbitrary higher versions.
GitHub currently resolves to formal Lightview v0.1.6, whose public notes cover
shared-memory WebKitGTK rendering for restricted containers while retaining the
native navigation and sandbox-state fixes. The RemoteXApp target is therefore
`lightview@1.0.6` pinned to host Lightview 0.1.6, subject to full review and
acceptance rather than automatic compatibility.

Existing local commits already contain a 1.0.6 candidate and dependency notes,
but they are ahead of remote main and are not a formal RemoteXApp App release.
The train must independently verify the public upstream artifact, reconcile the
changed low-memory media contract, prove required codecs and sustained playback,
rerun the complete package lifecycle matrix and obtain human UAT before any
publication or deployment.

## 2026-09-16 — Lock EDGE-005 and LTV-007 for local UAT

The operator locked the App-only train for implementation, production-quality
testing and deployment to local loopback 1991/2992. Targets are `edge@2.0.2`
and `lightview@1.0.6` pinned to formal Lightview 0.1.6. Core and SDK remain
unchanged. EDGE-005 uses serialized, mode-0700 quarantine, retains the newest
four validated Driver-owned records, and fails closed for live or ambiguous
owners or unknown quarantine content. LTV-007 verifies exact upstream
release provenance plus the full existing browser/control/lifecycle contract
and sustained media playback. Human UAT is the terminal goal; publication and
all sandbox deployment remain unauthorized.

## 2026-09-16 — Qualify the local EDGE-005 and LTV-007 UAT candidate

The App-only candidate is installed on both loopback environments with exact
selectors `edge@2.0.2` and `lightview@1.0.6`; no Core or SDK bytes changed.
Deterministic packaging, the complete source regression suite, real browser
actions and the full LightView lifecycle matrix passed. Both deployed Apps
returned ready connection descriptors and completed `openUrl`.

A deployed Edge test seeded a foreign-host singleton trio while three retained
records already existed. Pre-launch recovery quarantined the residue, CDP
became ready, and post-exit cleanup rotated the oldest structurally validated
record while retaining exactly four. This exposed and corrected an earlier
fail-after-four design before UAT. The pre-existing desktop runtime survived
the Manager restart without a runtime restart. The candidate is ready for
human UAT; publication and sandbox deployment remain separately gated.

## 2026-09-17 — Accept EDGE-005 and LTV-007 for formal publication

The operator accepted the local UAT candidate and authorized formal GitHub
publication. Publish Edge 2.0.2 and LightView 1.0.6 as separate immutable App
Package releases from one accepted source commit, using annotated App tags and
the exact locally qualified archive bytes. Core 0.12.2 and SDK 0.28.0 remain
unchanged, so no Core tag or Latest change is part of this train. Publication
does not authorize sandbox deployment.

## 2026-09-17 — Publish Edge 2.0.2 and LightView 1.0.6

Formal independent App releases `edge-v2.0.2` and `lightview-v1.0.6` were
published from the shared accepted source commit. Each annotated tag publishes
only its deterministic App archive and checksum. Fresh GitHub downloads match
the UAT bytes and manifests, neither release is a draft or prerelease, and the
Core Latest marker remains on `v0.12.2`. Publication makes no deployment or
runtime-upgrade claim.

## 2026-09-17 — Align the formal Edge and LightView App releases

The operator authorized fleet alignment and required affected RemoteXApp
runtimes to restart after upgrade. The exact formal Edge 2.0.2 archive was
staged and transactionally selected on both local endpoints, sandbox00
production/test and sandbox01/02/03/07/10 production. LightView 1.0.6 was
verified only on its existing local and sandbox00/01 footprint; no new
LightView footprint was created.

Every changed Manager passed two starts and durable adoption. Selector
activation alone does not replace a retained singleton pin, so the sole old
Edge runtime was explicitly upgraded and restarted without force. Its real
RFB attachment reached ready state and returned valid CDP metadata; `openUrl`
also passed. Unrelated runtimes were not restarted. Local listeners stayed on
loopback, sandbox policy stayed unchanged, no container reboot occurred and
CloudDrive functional tests remained skipped during maintenance. See the
[alignment evidence](../tests/evidence/v1/edge-2.0.2-lightview-1.0.6-alignment.json).

## 2026-09-17 — Transfer sandbox deployment ownership

The operator superseded the repository's previous deployment workflow. The
RemoteXApp project now ends at project-owned test validation, immutable GitHub
publication, and a complete release handoff. The sandbox project exclusively
owns sandbox deployment, runtime restart/upgrade, rollback, alignment, and its
deployment evidence.

Accordingly, “align” or “对齐” is no longer an executable instruction in this
repository. It requires a clarifying question about why alignment is needed,
the intended result, target set, release identity, and owning project. This
prevents publication approval from being mistaken for infrastructure-change
approval and keeps product release evidence separate from sandbox operations.

## 2026-09-17 — Add exact Lightview 0.1.7 compatibility

The operator requested Lightview 0.1.7 support. Because `lightview@1.0.6` is an
already-published immutable App Package and its version gate intentionally
fails closed, the replacement is `lightview@1.0.7`, not an in-place edit or an
open-ended range. It accepts exactly host Lightview 0.1.7.

The reviewed one-commit upstream delta keeps images enabled under
`--low-memory` and adds prompt-free, conflict-safe downloads to the runtime
user's standard Downloads directory. This behavior does not add a RemoteXApp
Manager action or expose the private control socket. The formal upstream
archive and installed local binary match their recorded SHA-256 identities.
Core and SDK are unchanged. Local test-environment UAT, publication, and the
sandbox project's deployment remain separate later gates.

## 2026-09-17 — Accept LightView 1.0.7 for formal publication

The exact upstream archive, tag and installed binary identities were verified.
The deterministic App archive, complete source suite, Go race and vulnerability
checks, 14-scenario isolated RemoteXApp Viewer/control/lifecycle E2E and all
seven upstream integration tests passed. The first upstream integration attempt
correctly exposed this build container's known bubblewrap restriction; the
documented local-only WebKit sandbox override then passed every test, including
images under low-memory mode and conflict-safe automatic downloads. The App
Package contains no such override.

The operator explicitly authorized immediate formal GitHub publication without
a separate interactive UI-UAT claim. Publish annotated `lightview-v1.0.7` with
only the deterministic archive and checksum. Core, SDK and endpoints remain
unchanged; sandbox deployment belongs to the sandbox project.

## 2026-09-17 — Publish LightView App Package 1.0.7

Annotated tag `lightview-v1.0.7` peels to accepted source commit
`ba0f5e53e617`. The formal GitHub release contains only the deterministic App
archive and checksum. An independent fresh download passed its checksum, was
byte-identical to the tested archive, and reported `lightview@1.0.7` with App
Package ABI V1. The release is neither draft nor prerelease; Core `v0.12.2`
remains GitHub Latest. Publication did not deploy or upgrade any endpoint. See
the [publication evidence](../tests/evidence/v1/lightview-1.0.7-publication.json).

## 2026-09-18 — Lock exact Lightview 0.1.8 compatibility

The operator requested alignment with the newest formal Lightview release and
immediate formal publication after validation. Create immutable
`lightview@1.0.8`; do not broaden or rewrite 1.0.7. The Driver accepts exactly
host 0.1.8 and makes its new WebKit recovery state part of readiness: engine
state must be ready, generation positive, low-memory pressure target 384 MiB,
and last-resort WebKit-process threshold 3072 MiB.

Keep the RemoteXApp boundary deliberately narrow. Upstream soft/hard reset,
mode switching, detailed telemetry, version dialog and raw automation remain
same-UID Unix-socket capabilities. `openUrl` remains the only Manager action,
and Core, SDK, descriptor schema, template identity, persistent profile and
six-hour detached lifecycle remain unchanged. Acceptance must prove reset
preserves the LightView main PID, socket inode and profile while page state is
discarded. GitHub publication is authorized after the exact-artifact and full
release gates; endpoint deployment remains with the sandbox project.

## 2026-09-18 — Accept LightView App Package 1.0.8 for publication

The exact upstream annotated tag peels to `8810098d2f68`; its public archive,
checksum, LightView binary and reported WebKitGTK identity match the reviewed
candidate. Contract and deterministic-package tests, all repository source,
race, coverage and vulnerability gates, and 15 isolated real Viewer/control/
lifecycle scenarios passed. Soft and hard reset preserved the LightView PID,
socket inode and persistent profile while incrementing WebKit generation.

The upstream download test was intentionally audited rather than waived. Its
file-exists-only assertion intermittently read the destination between file
creation and write completion. The race reproduced independently; two focused
runs passed and one failed at zero bytes. In a temporary uncommitted test copy,
waiting for the browser's own `downloads_active=0` signal made the complete
nine-test integration suite pass with exact content verification. This changes
no shipped source. The evidence supports product acceptance while retaining the
test-race limitation in release records. Formal App-only GitHub publication is
authorized; no endpoint deployment follows from it.

## 2026-09-18 — Publish LightView App Package 1.0.8

Annotated tag `lightview-v1.0.8` peels to accepted source commit
`9e92c5d66a63`. The formal GitHub release contains only
`lightview-1.0.8.tar.gz` and its checksum and is neither draft nor prerelease.
A fresh download is byte-identical to the accepted candidate, verifies SHA-256
`8af626a664bf335481ad8b7094b0d3f98e18dd6acfa948b17abcc89f5aedbcb7`,
and reports App content seal
`deb929ce4ed3a2c333827dba268543aa2c3863e27c0b55f3ddb5fad0d02f42e2`.
Core `v0.12.2` was restored as repository Latest after GitHub's automatic
selection considered the newer App release. Publication made no endpoint or
sandbox change.

## 2026-09-18 — Plan runtime idle lease and single-server Coordinator

The operator requested recording the discussed design in the next train, with
later features in release pending. IDL-001–004 and RTC-001–004 are planned,
not locked or implemented. An explicit runtime lease extends the effective
vacancy deadline without RFB attachment, synthetic activity or a Driver hook.
Existing stop/exit/managed-state/upgrade authority remains intact. Renewal must
fence timer callbacks and generation changes; it must not append a second
timeout after expiration or revive a stopped App.

RemoteXAppCoordinator is an optional SDK owner of runtime observation and
keepalive interests for one server and multiple Viewers/same-origin Tabs.
Observation does not imply keepalive; RFB disconnect does not release an
explicit interest. Release/destroy affects owned interests only. Keep current
Manager/Client standalone behavior and CLP-018 Viewer-local clipboard logic.
Namespace records by server/base-path/login identity for future growth.

WAOS currently needs one server. Multiple concurrent servers (RTC-005), reliable
external background ownership (RTC-006) and server/user-scoped shared audio
(AUD-001) remain pending. Audio eventually shares one bidirectional connection
per server/client scope rather than following runtime generation. Do not
implement audio routing or microphone ownership in this train.

Cross-Tab leadership and short claim TTLs alone cannot guarantee survival of
browser freezing. Finalize bounded stale-interest retention, capability
fallback and cadence before lock; document the crash/freeze tradeoff and test
actual suspension. No guarantee of indefinite browser-background keepalive is
made. See [train design](runtime-coordinator-release.md) and
[release pending](release-pending.md). This records planning only and changes
no version, deployment, runtime or publication state.

## 2026-09-30 — Lock standalone/runit selected-user release train

The operator authorized the next Core train for an explicit standalone/runit
backend, deployment as an existing non-root selected UID, and host-controlled
default-XFCE fixed display/RFB/gateway allocation. This does not change the
current 0.13.1 publication train. Existing `install-system.sh --user` already
selects a real account, but depends on its systemd user manager; Core lifecycle
and manifest adoption still encode systemd units and `/run/user/<uid>` paths.
The new backend cannot be a runit service wrapper alone. Runit normally
restarts an exited `run` process, whereas RemoteXApp must distinguish natural
App exit, stop-session and crash. Preserve Manager-crash adoption, process
identity, shutdown refusal/enforcement and pinned upgrade semantics behind a
backend interface; keep systemd as the default and API/SDK unchanged.

On grok-bot, `sandbox` (UID 1001) is non-sudo, and the runit-supervised account
D-Bus answered a same-UID protocol request on 2026-09-30. The platform's X
display `:1` is occupied; do not stop it or remove its lock. A fixed alternate
allocation must be controlled by the administrator, not the instance caller.
The grok-bot project owns packages, account-bus/platform supervision and host
preparation; this repository owns the release and exact-artifact qualification.
See [locked design](standalone-runit-release.md). No implementation, package
installation, service change or deployment is claimed by this entry.

## 2026-10-01 — Retire session leaf before terminal state

Grok-bot RC.4 qualification showed that a natural Mousepad exit published
`sessionState=stopped` and App status `exited`, but left an empty standalone
session cgroup for more than 20 seconds. It held a descendant-quota slot until
the whole runtime was forced to stop. RC.4 was rejected and host activation
rolled back. Explicit stop already removed the leaf; the observed-exit path
skipped that cleanup. The replacement path now stops the exact session
component and removes its stale runtime/IPC files before publishing clean or
failed terminal state. It preserves the Driver's `exited` status for clean
exit and does not stop the server for a `stop-session` policy. If cleanup
fails, it records a failed session rather than falsely reporting a completed
clean exit. Blocked shutdown continues through its existing completion path.
This supersedes only the observed-exit cleanup behavior in the 2026-09-30
standalone decision; API, App ABI and systemd defaults remain unchanged.

## 2026-10-01 — Reconcile managed state after standalone server loss

RC.5 grok-bot fault injection killed the exact owned server-Driver cgroup.
The standalone component monitor stopped the runtime and removed every
component leaf within about 2.4 seconds, but the managed registration kept
`observedState=running` and exposed a stopped runtime for over 25 seconds.
Its cgroup observer watches VNC/gateway, not the server Driver; the remaining
five-minute safety sweep was the only reconciliation trigger. RC.5 was
rejected and host activation rolled back. After scoped teardown, the
standalone monitor now reconciles the associated managed registration while
holding the existing lifecycle lock. A desired-running registration can
recover its pinned runtime promptly; failed teardown durably reports a failed
managed state instead of false health. Anonymous runtime behavior is
unchanged. This extends RUN-005 without changing the public API or App ABI.
