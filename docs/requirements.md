# Product requirements

> Historical technical record. Dated status and validation statements describe
> their original scope; they do not identify a current deployment. See
> [current source versions](current-state.md). Host labels and runtime IDs in
> historical examples are anonymized.

## Core 0.14.2 — bounded managed session recovery

Requested 2026-10-02 after the standalone test host XFCE session leader exited
while VNC/gateway and helper processes remained. This is a new immutable patch
release; `v0.14.1` is not modified. Local `0.14.2-rc.1` UAT was accepted
2026-10-02; formal exact-artifact qualification is separate. See the
[recovery design and acceptance matrix](managed-session-recovery-release.md).

| ID | Requirement | Status | Verification required |
|---|---|---|---|
| RTM-019 | Detect loss of a session's readiness process without waiting for the entire cgroup to empty; serialize the terminal event by runtime ID and generation. Retain cgroup observation and managed safety reconciliation as independent fallbacks. | accepted for local UAT | Leader-loss fixture, real-host emptied-cgroup path, clean logout and Manager restart races |
| RTM-020 | For a managed user-home session, do not automatically stop a still-populated session component after its leader dies. Expose a durable failure requiring operator review, preserving unknown processes and HOME. | accepted for local UAT | Unsaved document/child-process fixture and no-stop assertion; surviving-child branch not reproduced on the real host |
| RTM-021 | If the old managed user-home session component is fully inactive and there are no attached clients, permit an on-attach session-only relaunch on the pinned runtime. Persist and limit attempts to three per ten-minute window; do not automatically force, replace the server, change App/Core pins, or renew on a failed attach. | accepted for local UAT | Real Viewer reconnection, generation/attempt persistence, exhaustion, rollback and concurrent attach |
| RTM-022 | Scope this patch to managed user-home session failure. Gateway/VNC/server repair and resource-runaway enforcement require a separate host policy and fault matrix; do not infer permission to kill live applications from a timeout or CPU spike. | deferred | Separate resource-policy design and pressure/kill tests |

## Accepted Core 0.14.0 — standalone/runit and selected-user deployment

Locked 2026-09-30 for the next Core release after 0.13.1. See the
[design and acceptance contract](standalone-runit-release.md). Implementation,
standalone test host exact-RC.6 E2E and human UAT were accepted 2026-10-01 for stable
0.14.0 publication. Formal `v0.14.0` was published 2026-10-01. No host reboot
was approved, so boot persistence remains unverified; publication is not a new
sandbox deployment.

| ID | Requirement | Status | Verification required |
|---|---|---|---|
| RUN-001 | Add an explicit `systemd` (default) or `standalone` lifecycle backend. Preserve existing systemd runtime ownership, API, SDK and App Package ABI. Reject unsupported/mismatched backend state; do not auto-detect from command availability. | locked | Both-backend unit/integration and Ubuntu 26.04 regression |
| RUN-002 | Standalone must start, supervise, stop and adopt pinned VNC, gateway, server Driver and session services without systemd, preserving generation, identity, graceful shutdown and bounded descendant cleanup. Stop and observed clean/failed session exit must reclaim each verified empty component cgroup before publishing terminal state, including old empty leaves found at Manager startup, so repeated Apps do not exhaust `cgroup.max.descendants`; populated or replaced leaves must not be removed. Normal App exit and stop-session must not be defeated by runit's default auto-restart. | locked | Real process fault/adoption/shutdown matrix, natural App exit with server retained, repeated launch/stop under bounded cgroup quota |
| RUN-003 | Make private runtime/socket roots and borrowed account D-Bus independent of systemd user-manager creation. Enforce non-root same-UID ownership, safe path/mode checks and generation-qualified stale socket/PID rejection. | locked | No-systemd host, foreign path/PID, bus fault, reboot tests |
| RUN-004 | Provide non-systemd preflight, immutable release staging, and an exact foreground Manager command contract for an installation-time selected existing UID. The standalone test host project owns its trusted host launcher, runit service, installation, activation and rollback playbook. Manager/Apps never switch UID from client/API requests or run as root; service activation is explicit. For systemd selected-user installation, preflight must reject a user manager carrying another UID's runtime, D-Bus or PulseAudio socket environment. | locked | `sandbox` UID on standalone test host, no-sudo, install/rollback, service-state preservation; Ubuntu 26.04 cross-user environment fixture |
| RUN-005 | Keep Manager restart adoption, boot-aware recovery, idle/lease, stop-session/stop-instance, refusal/enforcement and upgrade semantics coherent across backends. A required standalone component loss must immediately reconcile a managed registration after scoped teardown (or report failure if teardown fails); never report `running` with a stopped runtime until the safety sweep. Disable or separately implement the privileged Manager-service restart helper in standalone mode. | locked | Crash, VNC/gateway/server/session component failure, upgrade, reboot and rollback matrix |
| RUN-006 | Gate acceptance on every enabled App's actual Viewer/input/clipboard/control E2E on standalone test host plus clean Ubuntu 26.04 systemd regression, including cold first-start and retry of selected-user XFCE, selected-user installation and platform-service coexistence. | locked | Exact-artifact, real-host evidence and human UAT handoff |
| RUN-007 | Keep standalone test host host dependency installation, runit/account-bus provisioning and platform boot hook under the standalone test host project's ownership; RemoteXApp documents and validates prerequisites without modifying unrelated services. | locked | Host handoff, before/after inventory and reboot evidence |
| DEP-017 | Allow an administrator to configure the default `xfce-user-desktop` fixed X display, RFB port and gateway port for a host. Validate collisions and pin the chosen allocation; do not expose per-instance/client overrides or change geometry/resize policy. | locked | Occupied `:1` on standalone test host; nonconflicting fixed display, restart/upgrade/rollback |

## Runtime idle lease and SDK Coordinator — planned 2026-09-18

Additional scope approved 2026-09-18: **RTC-007**, Console/kiosk Coordinator
panel. Show coordination mode, local Tab identity, observed peer eligibility,
runtime/generation, local/remote interest counts, renewal leader, latest lease
receipt and local renewal schedule, plus bounded recent takeover/lease/error
events. Read-only inspection must not acquire interests, renew leases or alter
elections. Refresh while open, stop UI timers when closed. Use content-free
metadata, not App parameters, credentials or control descriptors. Status:
deployed locally as Core 0.13.0-rc.3 / SDK 0.29.1; human UAT accepted 2026-09-18.
RTC-005/006 remain deferred.

Locked on 2026-09-18 for Core 0.13.0-rc.2 / SDK 0.29.0 development, testing and
local loopback 1991/2992 UAT deployment in the [next release train](next-release-train.md).
Implementation and the eight-App lifecycle suite are complete; human UAT was
accepted for RC.3 on 2026-09-18; formal 0.13.0 publication is authorized. The table retains the acceptance obligations. See the
[design and acceptance plan](runtime-coordinator-release.md).
Verification: [candidate suite](private-history.md)
and [two-local-endpoint deployment](private-history.md).

| ID | Requirement | Status | Verification required |
|---|---|---|---|
| IDL-001 | Provide an authenticated, App-neutral runtime idle-lease renewal using the effective pinned idle timeout. Support managed and anonymous runtimes within their existing allowed policies; no Viewer, synthetic input, template edit or Driver hook is required. Return current identity/generation, policy and renewal/deadline outcome. | accepted | API/auth, all policy modes, all shipped Apps and no-RFB cases |
| IDL-002 | Separate lease from RFB heartbeat and attachment count. A valid renewal postpones vacancy only; never launch/revive an App, override explicit stop/desired state, cancel blocked shutdown or prevent natural exit/logout. Reject stale generations and incompatible lifecycle states. | accepted | Stop, exit/logout, blocked/force, restart/upgrade and delayed request matrix |
| IDL-003 | Serialize renewal and idle shutdown; invalidate old timer callbacks using timer identity/epoch and deadline checks. Never add another full timeout after a lease deadline. Retain existing Manager-adoption grace semantics without durable client claims; do not resurrect leases after runtime replacement. | accepted | Controlled callback races, expiry boundary, adoption and replacement tests |
| IDL-004 | Add SDK one-shot renewal and opt-in automatic renewal independent of Viewer connection. Expose errors/deadlines, bound requests and retries, stop on release/terminal identity change, and preserve default behavior when disabled. | accepted | Disconnect, reconnect exhaustion, cancellation, permission/network failure and cleanup |
| RTC-001 | Add optional RemoteXAppCoordinator for one server and multiple Viewers, sharing status monitoring and explicit keepalive interests. Merely tracking/listing a runtime must not keep it alive. Preserve standalone Manager/Client APIs. | accepted | Shared polling, observe-only, opt-in/off and existing SDK regression |
| RTC-002 | Coordinate same-origin, same-storage-partition Tabs within one login scope. Deduplicate interests, permit safe transient duplicate renewals, isolate releases, and bound stale records. Hidden or RFB-disconnected does not mean released; freeze/crash ambiguity and limits must be explicit. | accepted | Two-Tab use, close/crash, hidden/frozen leader, takeover, resume and repeated registration |
| RTC-003 | Namespace records by server identity including base path and login scope, runtime ID and generation. Discard stale responses and invalidate old-generation interests on lifecycle changes. Current host application integration remains single-server; Viewer input/clipboard remains independently owned under CLP-018. | accepted | Identity collision, logout, late response, restart/upgrade and Viewer-local clipboard regression |
| RTC-004 | Define and test ownership cleanup and migration: disconnect retains an explicit interest; release/destroy removes only owned interests; last release stops renewal without stopping the App. Provide single-server integration examples, rollback and honest browser-background guarantees. | accepted | Reference cleanup, no extra expiry grace, standalone/coordinated coexistence and real-browser acceptance |

RTC-004 provider handoff: [host application Coordinator migration](host-runtime-coordinator-migration.md)
defines staged adoption, per-window ownership, on-attach generation handling,
logout/upgrade cleanup and the downstream acceptance matrix. It documents
existing contracts; host application implementation/acceptance is not claimed complete.

Follow-up requirements are recorded in [release pending](release-pending.md),
outside this train:

| ID | Requirement | Status | Verification required on promotion |
|---|---|---|---|
| RTC-005 | Extend the same Coordinator to concurrent servers with independent authentication, state, renewal and failure handling. No current host application multi-server migration or switching UI. | pending | Two-server identity/auth isolation and partial failure |
| RTC-006 | Support a host application/native/background-service owner when runtime keepalive must survive suspension of every browser Tab; define bounded ownership and release rather than promising browser immortality. | pending | Browser termination, owner crash, logout and lease expiry |
| AUD-001 | Integrate server/user-scoped shared audio with one bidirectional playback/microphone connection per server per client coordination scope. Preserve independent audio/runtime lifecycles; explicit microphone target, no focus-driven rerouting or duplicate playback. | pending | Audio owner handoff, permissions, mic routing, reconnect and failure isolation |

## Boot-aware runtime recovery — locked 2026-09-14

**Published 2026-09-14:** BR-001–006 implementation is in formal `v0.12.2`
at `c1cecabe076e`; SDK/Apps unchanged. All eight final-archive E2E suites and
test-host-a production seven-App Manager/runtime checks passed. BR-006 is directly
observed: existing remote storage ENOTCONN is logged while Manager remains healthy.
**BR-005 target container reboot acceptance is still pending new approval.**
No reboot after the operator's restriction; remote storage functional tests are
skipped during maintenance. See [evidence](private-history.md).
Publication is not new human UAT or acceptance of the unexecuted target gates.

**Scope addition — BR-006, 2026-09-14:** operator approved the storage-startup
repair and a new release. An unavailable configured document directory reports
an error without terminating Manager startup. Retain the explicit allowlist;
retry availability on actual file requests so recovery needs no Manager restart.
Reject unavailable/outside files before Driver execution; do not fall back to
parent/default directories. Durable managed records validate parameter syntax
without requiring the document to be online. Invalid configuration remains fatal.
Test missing/disconnected/stalled storage with local fixtures; skip real
remote storage tests during maintenance. Include this in unpublished 0.12.2.

BR-001–005 / U26-06 are approved for implementation, new release and test-host-a
production restart/reboot testing. Preserve ordinary failure/stop/refusal
semantics; restore only proven eligible cross-boot runtimes, preserving pins,
profiles and post-cutover identity with newer generations and existing session
activation. Require durable intent, safe cleanup, local regression and actual
container reboot evidence. Completed/Viewer-cancelled shutdowns are not pending
refusals; all independent desired-state and failure guards still apply.
[Complete requirements and design](boot-recovery-release.md).
This supersedes U26-06's earlier deferral, not the other deferred U26 features.

## Ubuntu host compatibility — locked 2026-09-14

**Published and closed 2026-09-14:** formal GitHub Latest `v0.12.1`, commit
`0300acdfd003`, SDK `0.28.0`, Mousepad `4.0.1`. The accepted bounded scope is
released; seven exact-archive E2E suites and eight Mousepad checks passed.
Native clean 26.04/Qt6/Mousepad 0.7 and full-host reboot remain unverified,
not retrospectively accepted tests. No deployment or workaround retirement.
See [publication evidence](private-history.md).
The development table and authorization records below are historical;
U26-06/09 remain deferred.

2026-09-14 operator UAT **accepted**; formal stable `0.12.1` publication
authorized, with SDK `0.28.0` and Mousepad `4.0.1` unchanged. U26-01–05 and the
U26-07/08 documentation scope are accepted for release. Native clean 26.04,
Qt6 and whole-host reboot remain unverified qualifications; the historical
development status column below is not a claim of target-specific acceptance.
See [acceptance evidence](private-history.md).
U26-06/09 remain deferred. Publication does not authorize deployment.

Development/testing approved for Core `0.12.1-rc.1`, Mousepad `4.0.1`; SDK
`0.28.0` unchanged. Scope lock is not implementation/UAT acceptance. See
[design and verification gates](ubuntu-host-compatibility-release.md).
No deployment, live runtime replacement or publication is included.
Implementation and scoped local tests are complete; native clean-host and UAT
acceptance remain pending. [Recorded results/limits](private-history.md).

| ID | Locked disposition / requirement | Status | Verification |
|---|---|---|---|
| U26-01 | Use machine-readable IBus readiness without formatted language lookup; preserve real engine/protocol checks, 500ms probe limit, total startup deadline, cancellation and cleanup. | implemented; acceptance pending | Slow formatted-query, failure/cancellation fixtures and local seven-App launches passed; fresh 24.04/26.04 pending |
| U26-02 | Document Ubuntu toolkit-specific input dependencies and provide explicit check/package-list preparation; no APT from Core. GTK3/GTK4 and Qt are tested separately; ACK is not document delivery. | implemented; acceptance pending | Module-negative checks, actual local modules and Mousepad document readback passed; native 26.04/Qt6 pending |
| U26-03 | Mousepad 4.0.1 permits Mousepad and Org.xfce.mousepad under existing full-name normalization, without wildcard authorization; immutable upgrade from upstream and sandbox variant. | implemented; acceptance pending | Both class identities/readback, wrong focus, generations and version-selection upgrade fixtures passed; native/downstream archive gate pending |
| U26-04 | Check capabilities as the runtime user: account services where required, real Python imports, native/input libraries and pidfd operations against an owned child. Separate static checks from explicit live acceptance; add clean 24.04/26.04 matrix. | implemented; acceptance pending | 12 dependency tests, actual user checks and staging passed; fresh-host packaged E2E pending |
| U26-05 | Preserve a bounded safe startup stage in existing error responses; new structured error fields/allocated failure IDs and cleanup APIs remain deferred. | implemented; acceptance pending | Service/Driver stages, bounded cancellation, private-output/stale-generation rejection and paired status revisions passed |
| U26-06 | Review boot-aware restoration as a separate future change. This train preserves explicit recovery and no replay after offline App failure. | deferred | Manager-only restart and whole-host reboot must remain separate acceptance cases |
| U26-07 | Document Manager/transport/App health separately without changing health HTTP semantics; new counters/Console dashboard deferred. | documented | Operations guide and seven-App mixed-state API checks |
| U26-08 | Document optional explicit managed-desktop registration, stable caller-selected ID and safe repeated provisioning; no automatic desktop or fleet-specific naming in Core. | documented | Operations guide, existing managed-create tests and disposable XFCE registration/recovery |
| U26-09 | Managed rename/display-label feature remains outside this repair train; document stable IDs instead. | deferred | Future transactional rename design required |

## Core-owned session services — locked 2026-09-13

Repaired candidate `0.12.0-rc.2` passed automated tests and operator UAT on
local loopback 1991/2992. Formal stable `0.12.0` GitHub publication is authorized
on 2026-09-14; endpoint alignment is not included. bwrap and all
sandbox isolation work are explicitly outside scope. See
[requirements, design and test matrix](session-services-release.md).
Operator clarification: no compatibility with the old internal architecture.
Use a clean stopped-system cutover; preserve public API/SDK behavior and
persistent application data, not old runtime identity or live connections.

All automated gates and both local deployments passed; human UAT is accepted.
See [acceptance/promotion provenance](private-history.md).
See [current candidate evidence](private-history.md)
and [measured overhead](../tests/performance/core-session-services/README.md).

SVC-010 follow-up: the operator requested per-App restart/upgrade/service-fault
state transitions with API assertions. This expanded dynamic-state run has
finished with failures; previous common-fixture passes do not stand for every App/state
combination. See [matrix scope](../tests/session-services/README.md).
The original rc.1 run failed; [SVC-F01–09](session-services-dynamic-validation.md)
record the findings and repaired validation. These failed runs are historical;
the repaired rc.2 implementation is now human-accepted.

2026-09-14: rc.2 repairs passed all seven-App dynamic matrices (361 checkpoints,
2,235 HTTP assertions), final real-App/Viewer/API and cutover gates, P16 resource
limits, release-ci, 20 shuffled Go/Node repetitions and fuzzing. Both local
endpoints passed deployment and served-Viewer checks; the desktop was upgraded
gracefully to generation 3. Operator UAT acceptance completes the train's
behavioral acceptance; publication uses a separately verified clean stable artifact.

| ID | Requirement | Status | Verification |
|---|---|---|---|
| SVC-001 | Core supervisor owns private D-Bus/IBus/Unicode lifecycle inside the existing session unit; Driver owns application/WM behavior only. | accepted | No duplicate startup or Driver service cleanup |
| SVC-002 | Private services belong to session generation, survive Manager restart and stop with session; user-home account D-Bus is borrowed and never stopped. | accepted | runMode/lifetime, borrowed-bus and actual XFCE saved-session restore tests |
| SVC-003 | Finalize HOME/XDG/display/authority and bus environment, require bounded protocol readiness, and roll back only resources owned by a failed attempt. | accepted | Startup failure, environment and socket identity matrix |
| SVC-004 | Detect Driver/canonical App exit separately from infrastructure liveness; apply existing early idle action exactly once. | accepted | App exit/logout with surviving helpers |
| SVC-005 | Retain services during graceful/blocked shutdown; clean them after App exit, with bounded whole-session force cleanup and unchanged host policy. | accepted | Refusing hook, unsaved documents, blocked/forced stop |
| SVC-006 | Distinguish input and bus failures, report unavailability without silent bus replacement, text replay or unrequested destructive App restart. | accepted | Individual service failure and degraded operation |
| SVC-007 | Adopt new-architecture supervisor/App/services after Manager loss; use authoritative runtime state, preserve terminal failures, resume bounded startup and reject stale generations even before on-attach activation; retain coherent pins and restart versus upgrade semantics; no old-runtime adoption. | accepted | Repaired per-App crash/adoption/upgrade matrices, concurrent requests and deployed runtime upgrade |
| SVC-008 | Preserve getConnections, EXP-007 canonical App environment, control/actions and SDK contracts with separate validated application/service identities. | accepted | Actual protocol queries and environment/control readback |
| SVC-009 | Mandatory Core-owned launch for all seven packages; remove old Driver-owned paths and use a controlled stop-and-switch cutover preserving persistent data/configuration intent, with no legacy compatibility branch. | accepted | Clean cutover, old-contract rejection, interruption/recovery and seven-App tests |
| SVC-010 | Require clean-cutover/new-architecture fault tests, public API and real-App regression, measured overhead and UAT; exclude legacy compatibility and bwrap gates. | accepted | Repaired dynamic matrices, exact-package real Viewer/App and saved-XFCE-session suites, P16, release-ci/nightly, both local deployments and operator UAT accepted |

## Connection readiness mask — locked 2026-09-13

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| SDK-005 | Default-on per-Viewer connection mask; constructor boolean `connectionMask`, live `setConnectionMaskEnabled(boolean)` and declarative `no-connection-mask`. | accepted | [Formal alignment](private-history.md) |
| SDK-006 | Uncover only after connected transport, current-generation ready app and painted framebuffer. Handle reconnect, timeout, failure, cancel, stale callbacks and disposal; block remote UI input while visible, retain existing SDK connection semantics and never stop the app on mask cancel. | accepted | [Formal alignment](private-history.md) |
| CON-011 | Default-on independent mask toggle in each Console/kiosk Viewer, without reconnect or exposure-policy changes. | accepted | [Formal alignment](private-history.md) |

This file is the durable requirements register. Keep identifiers stable,
update status when behavior ships, and link material design or test evidence.
New requirements start as `proposed`; only accepted automated and human
evidence may move a deployment-sensitive requirement to `accepted`.

Status values are `proposed`, `implemented`, `accepted`, `deferred`, and
`superseded`. A superseded entry remains as history and links its replacement.

## Release train: LightView hibernation wakeup

### Follow-up: suspended Viewer recovery (LTV-013)

| ID | Requirement | Status | Verification |
|---|---|---|---|
| LTV-013 | A Viewer attaching to a live but hibernated LightView must see a usable page without an explicit `openUrl`. App Package ABI V1 may declare paired, bounded first-attach/last-detach hooks. The first hook verifies the same-UID socket and PID, saves the native idle interval, inhibits hibernation while viewers remain, and wakes from `last_committed_uri` (safe blank fallback) before admitting the Viewer. The last hook restores the saved interval; Manager restart treats all prior viewers as detached. Existing runtime generation and immutable package pinning remain authoritative. A failed wake fails attachment, not the whole runtime. No SDK-specific LightView branch or sandbox deployment is included. | accepted | `make check`, race tests, deterministic native-socket/Core tests, 19-scenario isolated real-browser E2E, and [both local deployed endpoints](private-history.md) passed 2026-10-02; human UAT accepted and formal publication authorized 2026-10-02. |

Added 2026-09-29 as App-only **LTV-012**. In Lightview 0.1.10 the WebKit engine
can hibernate after inactivity while the main PID, window and control socket
remain alive. test-host-k reproduced App 1.0.10 rejecting `openUrl` before native
`open` could wake it; an isolated experimental Driver completed the real Manager
action after waking. Target App Package `1.0.11`; deploy only to local loopback
1991/2992 for UAT. Core, SDK, host Lightview and sandbox environments are
outside this release scope.

| ID | Requirement | Status | Verification |
|---|---|---|---|
| LTV-012 | Let `openUrl` wake a verified hibernated LightView. Accept only `ready` or `suspended` before dispatch; preserve socket ownership, PID, URL and ready-field checks. Send native `open` once, wait through bounded recovery, then require ready status and completed navigation. Failed/untrusted states still fail closed. Do not wake read-only status, change memory policy or restart the runtime merely to navigate. | implemented | Deterministic state/identity tests, 18-scenario isolated exact-package real-browser E2E, and both local deployed Viewer/Manager wakeup checks passed. Formal [release](private-history.md) published; human UAT not separately claimed. See [local evidence](private-history.md) and [publication evidence](private-history.md). |

See the [train](lightview-app-package-release.md)
and [design](lightview-app-package-release.md#hibernation-wakeup-ltv-012).

## Release train: LightView optional memory protection

Added 2026-09-24 for [Issue #8](private-history.md).
Target LightView App Package `1.0.10`, with no Core/SDK change. Locked 2026-09-24
for implementation, testing and local 1991/2992 UAT as unpublished `1.0.10`.
Driver implementation and automated/local verification are complete. The operator
authorized formal promotion on 2026-09-24; the formal release is published and verified.
The operator confirmed memory protection is optional; its disabled
state is not a fault to investigate. LTV-011 supersedes the mandatory fixed
termination-threshold acceptance rule of LTV-009/010 when implemented, without
rewriting their accepted records or immutable artifacts.

| ID | Requirement | Status | Verification |
|---|---|---|---|
| LTV-011 | Decouple LightView control operations and readiness from optional memory protection. Disabled protection or a changed termination threshold must not block startup, navigation or graceful quit. Keep the template's low-memory launch default, socket/PID/protocol security, navigation readiness and URL/result checks; quit must not require a ready navigation engine. Do not override user choices, label intentional protection-off as degraded, or report a configured threshold as a live enforced value. Preserve lifecycle, host enforcement and immutable-package integrity. Deliver a new App Package without Core/SDK changes. | accepted | Formal lightview-v1.0.10 published and verified after operator promotion approval. Coverage: reproduced Issue #8 with deterministic socket states and captured native commands; tested a newly built/sealed candidate through real Manager actions without editing installed releases; covered on/off, alternate thresholds, toggles/recovery, startup, repeated openUrl, graceful stop, restart/upgrade, security/tamper rejection and two 17-scenario real-browser runs. Hosted Verify and public-download byte comparison passed. |

See [train scope](next-release-train.md) and
[design/test boundaries](lightview-app-package-release.md#optional-memory-protection-ltv-011).
Automated qualification and both local deployments passed:
[LTV-011 evidence](private-history.md).
The later formal publication request accepts promotion of this tested candidate;
no separate interactive human-UAT result is claimed.
See [formal publication evidence](private-history.md).

## Accepted release train: LightView capability-based compatibility

Added and locked 2026-09-18 by the operator's implementation and formal App
publication request. Target `lightview@1.0.9`; Core `0.13.0` and SDK `0.29.1`
unchanged. No endpoint deployment. LTV-010 supersedes only the exact host-version
policy in LTV-007/008/009; their immutable published artifacts remain unchanged.

| ID | Requirement | Status | Verification |
|---|---|---|---|
| LTV-010 | Remove Lightview executable version/banner gating. Determine launch compatibility from the existing flags, owned process/window/socket, bounded control protocol and required readiness fields. Preserve mandatory low-memory mode, 384 MiB pressure target, 3072 MiB per-worker threshold, ready engine state, positive worker generation, shared persistent profile, openUrl and six-hour vacancy policy. Reject missing/incompatible capabilities; do not infer that arbitrary future programs are certified, install upstream updates, loosen host trust or change Core/SDK. Publish a new immutable App Package, never overwrite an existing version. | accepted | [Candidate evidence](private-history.md): launcher fixtures, negative capability probes, 15 exact-package live scenarios on formal upstream 0.1.9 and source/race/coverage/vulnerability gates passed; [formal publication verified](private-history.md), no deployment or separate interactive UAT claim |

## Accepted release train: LightView host compatibility 0.1.8

Added and locked 2026-09-18. This is an App Package-only change; Core `0.12.2`
and SDK `0.28.0` remain unchanged. The operator directly authorized complete
validation and formal GitHub publication. No endpoint deployment is authorized;
sandbox deployment belongs to the sandbox project.

| ID | Requirement | Status | Verification |
|---|---|---|---|
| LTV-009 | Add immutable `lightview@1.0.8` and accept exactly formal Lightview 0.1.8, retaining fail-closed rejection of older and unknown versions. Preserve mandatory `--low-memory`, but validate the upstream 384 MiB pressure target, 3072 MiB last-resort WebKit-process threshold, ready engine state, and positive web-process generation. Prove that soft and hard WebKit reset preserve the LightView PID, GTK window, private socket identity, and profile data while replacing page-bound state. Keep recovery commands on the trusted same-UID socket: do not expose reset, mode, version, telemetry, or raw automation as new Manager actions. Preserve `openUrl`, connection metadata, Viewer behavior, and the six-hour lifecycle. | accepted | [Formal publication evidence](private-history.md) after exact upstream provenance, deterministic package, 15-scenario RemoteXApp E2E, nine upstream integrations with corrected completion wait, and source/race/coverage/vulnerability gates |

## Accepted release train: LightView host compatibility 0.1.7

Added 2026-09-17. This is an App Package-only change; Core `0.12.2` and SDK
`0.28.0` remain unchanged. Test-environment deployment, human UAT and GitHub
publication require their normal later gates. Sandbox deployment belongs to
the sandbox project.

| ID | Requirement | Status | Verification |
|---|---|---|---|
| LTV-008 | Add immutable `lightview@1.0.7` and accept exactly the formal Lightview 0.1.7 executable, retaining fail-closed rejection of 0.1.6 and unknown versions. Record and verify the annotated tag, public archive checksum and installed binary identity. Reconcile the upstream delta: normal images remain enabled under mandatory `--low-memory`; prompt-free downloads use the runtime user's standard Downloads directory, never overwrite an existing filename, and are not exposed as a new Manager action. Preserve the existing private socket, readiness, `openUrl`, profile and six-hour lifecycle contracts. | accepted | [Formal publication evidence](private-history.md) after exact upstream verification, deterministic package, 14-scenario RemoteXApp E2E, upstream seven-test integration, and source/race/vulnerability gates |

## Accepted release train: LightView shared browser App Package 1.0.0

Locked and accepted 2026-09-16 for App Package `1.0.0`; Core `0.12.2` and SDK
`0.28.0` remain unchanged. Local loopback package-only UAT passed and formal
independent App publication is authorized.
See [the release design](lightview-app-package-release.md).

| ID | Requirement | Status | Verification |
|---|---|---|---|
| LTV-001 | Add an independent App Package with exact ID `lightview` and a separately versioned immutable Driver. It uses the existing anonymous singleton-persistent pattern: `runMode: shared`, `profileRef: default`, session activation on first attach, complete `stop-instance` after six detached hours, and persistent WebKit website data across runtime recreation. | accepted | Package contract, multi-Viewer singleton, profile persistence and vacancy lifecycle E2E |
| LTV-002 | Use a dynamic 1280×720 framebuffer, depth 16, 5 FPS, client resize, Matchbox and Core-owned session services. Every launch includes mandatory LightView `--low-memory`; neither instances nor callers may disable it or override its memory target. Treat its 384 MiB WebKit per-process memory-pressure target as advisory, not a hard cap, and accept its documented media/WebRTC/WebGL/accelerated-canvas reductions. Accept a bounded `startUrl` limited to HTTP, HTTPS or exactly `about:blank`; do not expose private browsing as an override for the shared persistent template. Preserve RemoteXApp IME and clipboard behavior. | accepted | Manifest lock, native `status` low-memory fields, disabled-feature probes, visible-window, resize, raw/IME input and clipboard E2E |
| LTV-003 | Start LightView with an explicit Unix socket beneath the private runtime directory and publish `{protocol:"lightview-json-v1",transport:"unix",socketPath}` only as bounded private CONN-001 application metadata. `getConnections()` and the SDK return it only for the current ready generation. Do not allocate a TCP control port, proxy the socket, expose it in public instance/status APIs, or add a LightView-specific Manager/SDK branch. | accepted | Descriptor privacy/auth/generation/adoption tests plus real same-UID socket connection |
| LTV-004 | Ready requires the canonical LightView process, a visible `lightview` window, an owned Unix socket in the expected private runtime directory, and a successful native `status` exchange whose returned PID matches the launched process. Fail closed on stale, replaced, foreign-owned, unreachable or mismatched sockets; remove only the exact owned socket during shutdown/recovery. | accepted | Real launch, PID/window/socket identity, stale-crash recovery, substitution and cleanup matrix |
| LTV-005 | Provide a package-owned bounded `openUrl` action using LightView's native `open` command with HTTP/HTTPS validation and current-generation checks. Full socket commands, especially `eval`, remain available only to trusted local same-UID Agents through the returned descriptor; RemoteXApp never exposes a generic remote-eval action. Graceful shutdown uses native `quit`, followed by existing bounded host enforcement if it refuses or exits incompletely. | accepted | Action validation, navigation/readiness, local-agent control, unauthorized UID, shutdown and timeout tests |
| LTV-006 | Pin and document a supported LightView release and host dependencies separately from the RemoteXApp package. Acceptance requires package-only install/activate/rollback without rebuilding Core, package tests, clean release gates, real browser/Viewer/control tests, Manager restart adoption, ordinary restart versus upgrade-and-restart, failure recovery, six-hour vacancy simulation, persistent-profile continuity and human UAT before publication or deployment. | accepted | [Local UAT](private-history.md) and [publication](private-history.md) evidence |
| LTV-007 | At release-train lock, resolve the latest formal non-draft, non-prerelease `woodegg/lightview` GitHub release, review its complete behavioral/dependency/security delta, verify its public artifact and checksum, and pin that exact version in a newly versioned immutable LightView App Package. Never build or run against a moving `latest` reference or an open-ended compatibility range. The current resolved target is Lightview `v0.1.6` with `lightview@1.0.6`; reconcile low-memory media behavior and required WebKitGTK/GStreamer dependencies, then require complete local Viewer/control/profile/lifecycle/recovery plus sustained real-media E2E and human UAT before publication or deployment. | accepted | GitHub release provenance/checksum, package contract and deterministic archive, local 1991/2992 exact-artifact E2E, media playback duration and human UAT |

## Release distribution and downstream use

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| REL-001 | Source, release archives, and immutable system installations retain Apache-2.0 project notices plus bundled-dependency licenses and corresponding noVNC source. | implemented | Release metadata, package, installer, and installed preflight gates |
| REL-002 | Every release tag exactly matches `VERSION`, changelog target, SDK metadata, and vendored noVNC provenance. | implemented | `scripts/check-release.mjs` and tag workflow |
| REL-003 | A release produces a deterministic Linux archive and SHA-256 checksum from committed, module-locked inputs; the artifact never downloads runtime code. | implemented | `make package-release` |
| REL-004 | A merge to `main` cannot publish automatically; an exact immutable version tag repeats the release gate before GitHub publication. | implemented | `.github/workflows/release.yml` |
| REL-005 | Downstream browser projects use the stable same-origin `/sdk/index.js`; generated assets and the private npm package are not public API. | implemented | `docs/integration-guide.md` |
| REL-006 | `user-home` may leave preview only after dedicated-account deployment E2E and human UAT are recorded. | accepted | Automated deployment evidence and human UAT accepted 2026-08-27 |
| REL-007 | The release branch and host expose no obsolete transport/input PoC code, runtime data, or listeners; accepted regressions remain under `tests/` and removed source remains recoverable from Git history. | implemented | rc.13 repository and host cleanup |
| REL-008 | Tracked source, reachable Git history, and release archives are checked for credentials and private environment identifiers before publication. Current public documentation additionally rejects operational disclosures; historical copies require separate exposure assessment and are not erased by a source edit. | implemented | `scripts/check-sensitive-data.sh`, public documentation gate, package gate, and Gitleaks CI |
| REL-009 | Portable CI and release builds use exact Go `1.27.1`; source plus every packaged Go binary fail closed on reachable known vulnerabilities. | implemented; human UAT pending | [Go 1.27.1 qualification](go-toolchain-0.14.5-release.md); supersedes the prior exact Go 1.26.8 build pin |
| REL-010 | Fast verification enforces the measured Go and SDK coverage floors with Xvfb/xclip/Clipman dependencies present; scheduled reliability runs race, shuffled repeat, and bounded fuzz checks, while candidate acceptance retains synthetic and target-like real-App E2E. Missing integration dependencies must not silently redefine the coverage baseline. | accepted | Hosted Verify/Candidate runs, exact candidate E2E, and [`development-quality-0.5.2-stable-acceptance.json`](private-history.md) |
| REL-011 | A release archive is built once by the candidate workflow and identified by full commit plus SHA-256. Human UAT and target-like E2E use that candidate, and an exact tag may only publish the unchanged candidate bytes. | accepted | Candidate SHA-256 verification and [`development-quality-0.5.2-stable-acceptance.json`](private-history.md) |
| REL-012 | Every third-party GitHub Action is pinned to a full commit SHA. Release automation rejects lightweight tags, tag/version disagreement, absent same-commit candidates, and evidence that a tag previously ran at a different commit. | accepted | Workflow audit, immutable `v0.5.2-rc.1`, and release dependency regression |
| REL-013 | New candidate, integration, UAT, publication, alignment, security, and audit evidence uses the versioned v1 envelope; current source identities are generated from canonical metadata rather than manually copied. | accepted | `tests/evidence/`, `scripts/check-evidence.mjs`, generated `docs/current-state.md`, and stable acceptance evidence |
| REL-014 | Public readable guides use generic reproducible examples, preserve technical decisions and qualification limits, and contain no captured deployment identifiers, private workflow references or personal contact addresses. Repository-local links resolve; packaged guides retain local links when bundled and pin omitted source references to the full build commit. | implemented | `make public-docs-check`, focused disclosure/archive-link tests, and package documentation gate |

## Locked release train: App actions and browser open URL

Locked 2026-09-10; human UAT accepted and stable Core `0.9.0` publication
authorized, with SDK `0.26.0`, Firefox `2.2.0`, Edge `1.1.0` unchanged.
No additional deployment authorized. Optional App Package V1
extension; existing packages/pins remain valid. See [App Actions release train](app-actions-release.md).
Automated verification and both local deployments passed; human UAT accepted.
See [human acceptance](private-history.md).
Train closed with formal `0.9.0` publication; see
[publication evidence](private-history.md).
See [candidate and deployment evidence](private-history.md).

| ID | Requirement | Status | Verification |
|---|---|---|---|
| ACT-001 | Declare optional package-owned actions with bounded input/result schemas and validated pinned handlers. Discover instance capabilities from its pinned package; preserve no-action packages and fail clearly for unsupported Manager/package combinations. | accepted | Package/schema/path, capability/version compatibility and no-core-rebuild synthetic action tests |
| ACT-002 | Provide a generic Manager action API with normal auth/origin checks, strict parameter and expected-generation validation, bounded execution, and stable result/error envelopes. No browser-specific Manager code. | accepted | API authorization, validation, structured results/errors and bounds |
| ACT-003 | Add typed Manager and bound Client invokeAction calls with current identity, cancellation and base-path support; no automatic retries or stale-success delivery. | accepted | SDK contract, lifecycle/transport ambiguity and reverse-proxy tests |
| ACT-004 | Firefox/Edge Drivers implement openUrl through BiDi/CDP, accepting HTTP/HTTPS and defaulting to a new activated tab. Return tab ID and requested URL; preserve current pages/profile/runtime and existing startUrl semantics. | accepted | Real existing/new singleton, tabs, URL validation and shared-viewer E2E |
| ACT-005 | Require a ready session/application, serialize actions per runtime with bounded work, coordinate lifecycle changes, and reject stale or busy operations. Distinguish ambiguous timeout/cancellation outcomes without claiming rollback or exactly-once execution. | accepted | Concurrency, restart/upgrade, process cleanup, timeout and lost-response tests |
| ACT-006 | Execute only declared handlers under runtime UID with bounded JSON input/output, no shell interpolation or caller-selected endpoint. Keep raw controls loopback-only; verify runtime ownership, avoid leaking secrets, and never steal another BiDi controller's session. | accepted | Injection, endpoint ownership, control contention and auth-mode=none boundary tests |
| ACT-007 | Provide host application guidance for ensure/create, attach, wait-ready, then one action invocation, without a new CDP/BiDi backend service. Gate acceptance on generic-package, SDK and real-browser regression tests plus UAT. | accepted | No duplicate navigation, old-pin compatibility, exact-artifact E2E and downstream guide |
| ACT-008 | Add a generic Unified Console action panel for managed/standalone runtimes: discover pinned capabilities, enter schema-defined parameters, invoke explicitly through the public SDK, and safely display pending/results/errors. Prevent duplicate submission and stale cross-window responses; explain not-ready/unsupported/busy/unknown outcomes. Preserve Console-disable/auth policy, avoid implicit startup/retry/stop, and do not persist inputs/results. | accepted | Real Firefox/Edge openUrl UAT, multi-window target isolation, validation, lifecycle/timeout/cancel, hostile-result rendering, base-path and disabled-Console tests |

## Locked release train: Console connection information

Locked 2026-09-10 for Core `0.8.0-rc.1` / SDK `0.25.0`; implementation,
testing and local loopback 1991/2992 deployment are authorized. Preserve existing
runtime pins and access policy; no sandbox or publication is authorized.
See [the locked train](console-connections-release.md).

| ID | Requirement | Status | Verification |
|---|---|---|---|
| CONN-002 | Add a read-only Console Connection info panel for managed and anonymous runtimes, reusing SDK getConnections(). Show coherent runtime identity/generation/revision, current version, actual environment and generic template-owned application controls, plus explicit unavailable/error states. Support refresh and user-initiated field/JSON copy. Use ordinary Manager authentication and origin checks without a separate connection-read token (CONN-004). Invalidate stale descriptors and reject late responses across lifecycle/runtime/Manager changes. Do not add control execution, socket proxies, guessed IBus fields or App-specific Manager adapters. | accepted | Authorization/leak/lifecycle-race tests, actual managed/anonymous Console DOM, safe hostile-text rendering, copy and close/reopen checks passed; [local evidence](private-history.md); native permission UAT pending |
| CONN-004 | Remove the dedicated getConnections token requirement in Manager, SDK and Console. Retain normal Manager authentication, same-origin checks and all metadata/generation validations. auth-mode=none permits reachable callers to read descriptors; no per-runtime authorization is implied. Keep the legacy token-file setting ignored for service-start compatibility. | accepted | Local release-ci, exact-archive E2E, normal auth/origin denial, Console and both deployed six-App token-free checks passed; [rc.2 evidence](private-history.md); Human UAT accepted for 0.8.0 |
| CONN-003 | Extend protected getConnections() and SDK types/validation with the actual runtime IBus address and scope, recorded by the shared input startup layer and published through coherent private connection metadata. Verify socket and process ownership/liveness against the runtime generation; never substitute session D-Bus, guess a path or scan unrelated processes. Explicitly distinguish unavailable legacy/disabled/dead IBus from invalid or stale metadata, retaining fail-closed errors. Console renders the returned field/reason generically. Preserve old pins, existing consumers and current IBus lifecycle; no automatic restart or control proxy. | accepted | Seven-template actual IBus reads including disposable-UID XFCE, invalid/legacy/dead identity, adoption/restart/upgrade, original SDK 0.24.0 compatibility and both deployments passed; [local evidence](private-history.md); Human UAT accepted for 0.8.0 |
| CONN-005 | Console must import the immutable SDK asset from the same build, resolved relative to its bundle under root or reverse-proxy prefixes. A cached older /sdk/index.js must not affect the Console Manager. Keep the public SDK entry for external consumers; do not rewrite cached immutable assets or add a fallback to old SDKs. | accepted | Bundle/manifest contract test and live browser stale-module regression; rc.3 deployed; Human UAT accepted for 0.8.0 (deployment incident retained) |

## Locked release train: Runtime upgrade and restart

See [the locked train](runtime-upgrade-release.md). Locked 2026-09-10 for Core
`0.7.0-rc.1`, SDK `0.24.0`, Kate/KWrite `1.0.0` each. Implementation, full testing
and local loopback 1991/2992 deployment are authorized; no sandbox or publication.

| ID | Requirement | Status | Verification |
|---|---|---|---|
| UPG-001 | Add explicit upgrade-and-restart for managed and anonymous runtimes using current locally deployed core components and the enabled App version. Ordinary restart/adoption/recovery retain old pins. Preserve runtime identity, launch intent and persistent data; advance generation and refresh connection metadata. | accepted | Same-version restart versus explicit upgrade; core-only/App updates; all five templates and activation/resource policies |
| UPG-002 | Validate and freeze the target before stopping, reject stale/conflicting requests, honor normal shutdown/explicit force, and durably recover interrupted transitions without duplicate runtimes. After successful cleanup, release the old allocation before allocating the new target; fixed displays must not collide with their own stopped runtime. Other owners and live listeners remain conflicts. Restore lifecycle observation/policy for sessions surviving failed recovery. Surface blocked, cleanup and launch failures honestly; no implicit persistent-data rollback. | accepted | Preflight, concurrency, blocked/force, crash-at-each-phase, surviving-session observation, fixed-display real upgrade, durable allocation release and foreign-owner/live-listener failure matrix |
| UPG-003 | Enhance Manager and bound Client SDK with an explicit upgrade-and-restart operation, typed version/result/error contracts, generation/target guards, cancellation semantics and coordinated reconnect/descriptor refresh. Do not implement a client-side stop/start sequence or blindly retry destructive requests. | accepted | SDK unit/browser integration, lost response, cancellation, stale metadata and reconnect tests; downstream usage guide |
| UPG-004 | Console shows actual current runtime and locally available core/App versions, clearly distinguishes ordinary restart from upgrade-and-restart, confirms target/data-loss impact, and displays unavailable/blocked/failed/in-progress states. | accepted | Old pins versus new Manager, core-only update, unknown legacy identity, stopped managed instance and action-state UI tests |
| KTE-001 | Add independent `kate` App template with optional validated filePath, isolated non-singleton HOME, Matchbox, immediate dynamic 1280x720/16-bit/10 FPS display with resize, 60-second detached stop-instance and destructive no-save shutdown. Launch foreground/new anonymous session; discover and verify its PID-owned D-Bus descriptor and report via private CONN-001 metadata. | accepted | [Kate/KWrite control research](kate-kwrite-control-research.md): independent package/probe tests and real runtime control, no-save lifecycle and browser SDK checks |
| KWR-001 | Add independent `kwrite` App template with the same agreed optional-file/display/lifecycle policy, but its own executable, manifest, dependency, version and tests. Independently verify the KWrite service owner and shared Kate application interface; submit actual control metadata through CONN-001 without core-specific code. | accepted | [Kate/KWrite control research](kate-kwrite-control-research.md): independent package/probe tests and real runtime control, no-save lifecycle and browser SDK checks |

## Current UAT train: Optional document launch and Agent connection information

Scope locked 2026-09-10 for Core `0.6.0-rc.1` / SDK `0.23.0`;
implementation, testing and local loopback 1991/2992 deployment are authorized.
See [the locked train](mousepad-document-release.md). Human UAT, publication
and sandbox rollout are not implied by this approval.

| ID | Requirement | Status | Verification |
|---|---|---|---|
| MPD-001 | Make the Mousepad App Package closer to LibreOffice's document-launch model while keeping `filePath` optional: omitted opens a blank editor; supplied opens an authorized existing file; invalid input fails explicitly. Confirmed shutdown: Manager-initiated stop, including vacancy, forcibly exits without saving or waiting for confirmation; no Ctrl+S, unsaved edits are discarded, and required saves must be explicit beforehand. Locked immediate activation, 10 FPS and 60-second vacancy; no new same-document lease. Preserve isolated non-singleton operation and avoid new Manager/SDK coupling. | accepted | Optional-file matrix, real editor content, normal/forced/60-second idle stop, unchanged document bytes and explicit save, cross-instance safety and exact-candidate regression passed; Human UAT accepted for 0.8.0 |
| LOF-001 | Make LibreOffice `filePath` optional. Omission permits startup without an initial file; supplied files retain current validation, document ownership and requested-document readiness. Invalid supplied values fail explicitly. No-file startup uses Start Center plus working UNO readiness. Preserve dynamic UNO control metadata, display/lifecycle and destructive no-save stop; skip initial-file lock/lease operations when no file was supplied. | accepted | No-file UI/UNO readiness, valid/invalid file regression, blank/file-backed concurrency, restart/adoption, unsaved stop and scoped lock cleanup |
| CONN-001 | Provide a protected generic runtime connection descriptor and SDK `getConnections()` for trusted local Agents: runtime identity/generation/revision, resolved Display/Xauthority path, actual session D-Bus address/scope, and optional template-owned application control information. Reuse existing public control metadata without breaking consumers; add bounded private Driver metadata that cannot leak into Viewer/public status. Use ordinary Manager authorization (CONN-004) and coherent ready-generation validation. Agents perform protocol-specific control; no proxy, generic RPC or application-specific Manager/SDK adapters. | accepted | All five shipped templates' live connection checks passed, including newly started user-home XFCE/default bus/Xauthority; legacy availability, synthetic private D-Bus, authorization/leak, stale-generation/revision/restart/adoption and SDK contract passed; Human UAT accepted for 0.8.0 |

## Historical release train: Firefox interactive IME fix

Scope-locked 2026-09-07: [Firefox IME fix train](firefox-ime-fix-release.md).
FFX-007 targets `0.5.3-rc.1` / `firefox-esr@2.1.1`; implementation and testing
are authorized through local 1991 UAT readiness, not publication or fleet rollout.
The operator subsequently approved and locked RTM-017 as a gate-discovered
Manager correction in the same train.

## 0.2.0 stable release train

This stability-only train was scope-locked on 2026-09-01. It targets core
`0.2.0`, SDK `0.18.0`, App Package ABI `remotexapp/v1`, and the six exact App
versions frozen in the release-train specification. The complete ordered gate and exclusions are in
[`stable-0.2.0-release.md`](stable-0.2.0-release.md). Locking the train does
not authorize sandbox deployment, tagging, or GitHub publication.

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| STB-001 | The final release is the immutable core version `0.2.0` with SDK `0.18.0` and App Package ABI V1. The train adds no feature or contract change; only gate-discovered fixes are allowed without an explicit unlock. | accepted | Final metadata, frozen six-App identity, and candidate-to-release source audit, 2026-09-01 |
| STB-002 | Stable documentation defines the supported API, SDK, App, platform, deployment and trust boundaries; removes obsolete release-candidate positioning; and explicitly excludes experimental or deferred work from the stable compatibility promise. | accepted | README, security, commercial, handover, integration, operations, release-policy, open-Issue, and incomplete-requirement audit, 2026-09-01 |
| STB-003 | Human UAT accepts Firefox ESR/BiDi and LibreOffice/UNO/document launch, control, input, reconnect, save where explicitly requested, destructive stop, lock cleanup, and relaunch on the exact candidate. Unified Console UAT remains accepted evidence. | accepted | [`stable-0.2.0-test-host-a-human-uat.json`](private-history.md), 2026-09-01 |
| STB-004 | The exact candidate passes the abnormal restart and recovery scenarios from GitHub Issues #4 and #5. Both issues contain exact evidence and are closed, and no release-blocking issue remains open at tag time. | accepted | [Issue #4 fixed-display recovery](private-history.md), [Issue #5 managed recovery](private-history.md), and zero open issues, 2026-09-01 |
| STB-005 | The stable candidate preserves SDK `0.18.0` and App Package ABI V1 compatibility with the accepted host application integration contract. RemoteXApp publication does not require a host application rebuild or release; host application updates its exact lock when it independently adopts `0.2.0`. | accepted | rc.4 source/API comparison and isolated build-once install/update/adopt/disable/rollback evidence, 2026-09-01 |
| STB-006 | One clean final commit passes sensitive-data inspection, `make release-check`, and `make release-ci`, including generated-assets, provenance, unit, browser SDK, race, vet, packaging, archive-content, and checksum gates without leaving a working-tree diff. | accepted | The clean `v0.2.0` tag commit and its published `SHA256SUMS`; final candidate-to-tag diff contains the Verify dependency correction plus changelog, documentation, and acceptance evidence, 2026-09-01 |
| STB-007 | The immutable candidate passes local port-1991 upgrade from rc.10, retained-release rollback, runtime adoption/recovery, all shipped App, console, reverse-prefix, input, resize, reconnect, status, logout/exit, and graceful/forced shutdown acceptance. | accepted | [`stable-0.2.0-replacement-local-1991.json`](private-history.md), 2026-09-01 |
| STB-008 | A production-like test-host-a candidate passes approved upgrade, rollback, recovery, security, App, and human UAT gates. Train lock and local acceptance do not authorize any test-host-a change; staging and production each require separate explicit operator approval. Follower sandboxes are excluded. | accepted | Approved [staging](private-history.md), [production activation](private-history.md), and [Human UAT](private-history.md), 2026-09-01 |
| STB-009 | The accepted commit is pushed and tagged exactly once as annotated `v0.2.0`; the tag workflow publishes a normal latest GitHub release. The downloaded archive and checksums are verified, then the formal artifact is immutably aligned and rechecked locally and, with separate approval, on test-host-a. | accepted | [Publication and local formal alignment](private-history.md) and [approved test-host-a production alignment](private-history.md), 2026-09-01 |

## 0.3.0 template catalog simplification train

This train was scope-locked on 2026-09-02. It targets core `0.3.0`, SDK `0.18.0`, App Package
ABI V1, and the exact five-App catalog defined in
[`template-catalog-0.3.0-release.md`](template-catalog-0.3.0-release.md).
Implementation, complete automated and local port-1991 E2E validation, Human
UAT, formal `v0.3.0` tagging, and GitHub publication passed. Sandbox deployment
remains separately approved and is not authorized.

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| CAT-001 | The `0.3.0` release ships exactly `edge@1.0.0`, `firefox-esr@2.1.0`, `libreoffice@3.0.0`, `mousepad@2.0.0`, and `xfce-user-desktop@2.0.0`; SDK `0.18.0` and App Package ABI V1 remain unchanged. | accepted | Exact catalog, metadata, package, and local API gate in [`template-catalog-0.3.0-rc.1-local-1991.json`](private-history.md) |
| CAT-002 | `firefox-esr@2.1.0` supersedes only the depth-24 clause of FFX-001: new runtimes use depth 16. All other Firefox identity, display, profile, lifecycle, resize, input, and loopback BiDi behavior remains unchanged; existing 2.0.0 runtimes stay immutably pinned until stopped. | accepted | Catalog regression, full shipped E2E, real local Firefox VNC/BiDi/input/resize/reconnect, and Human UAT |
| CAT-003 | `xfce-desktop` is absent from source and release catalogs, shipped selectors, template APIs, active console choices, and current operational examples. Historical evidence and retained `0.2.0` releases remain intact. | accepted | Source/package/API/UI audits, exact local five-selector gate, and Human UAT |
| CAT-004 | Because the operator confirms that no external or downstream system uses `xfce-desktop`, removal provides no compatibility alias, deprecation period, automatic migration, or mapping to `xfce-user-desktop`. Internal test state must be explicitly removed only after a zero-client and zero-reference gate. | accepted | Approved zero-client cleanup, zero-reference activation, and Human UAT |
| CAT-005 | Upgrade logic removes only the explicitly retired shipped `xfce-desktop` selector, fails closed while any runtime or managed registration references it, and never prunes an independently installed App because its ID is absent from the core source tree. | accepted | Offline refusal, selector rollback, third-party preservation, and accepted local transition |
| CAT-006 | Upgrade and rollback between `0.2.0` and `0.3.0` preserve unrelated App selectors, profiles, and runtime records. Rollback restores the retained six-App `0.2.0` catalog but does not recreate deliberately deleted test state. | accepted | Real local 0.2.0→rc.1→0.2.0→rc.1 transition with exact managed child PID continuity and accepted UAT |
| CAT-007 | Catalog consumers and tests must discover the returned App set dynamically and must not assume that six templates exist. | accepted | Core, console, SDK, deployment, documentation catalog audits, and Human UAT |
| CAT-008 | One immutable candidate passes focused tests, `make release-check`, `make release-ci`, confidentiality checks, full local port-1991 E2E, and Firefox Human UAT. test-host-a staging, test-host-a production, follower deployment, tagging, and GitHub publication remain separately approved actions. | accepted | [`Automated/local evidence`](private-history.md), [`Human UAT`](private-history.md), and separately approved [`formal publication`](private-history.md), 2026-09-02 |

## Driver version and live deployment

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| RTM-017 | Restart/recovery preserves pinned App control endpoints and uses a reusable loopback bind check so reusable TIME_WAIT sockets do not prevent restart. Fresh allocations retain strict plain-bind safety. Live listeners, non-reusable sockets and other runtime ownership still block recovery; normal driver readiness remains required. No arbitrary port replacement, protocol-specific Manager logic or SO_REUSEPORT is introduced. | accepted | [Exact candidate and local 1991 input/restart evidence](private-history.md); automated acceptance passed; [Human UAT accepted](private-history.md), 2026-09-08 |
| RTM-018 | A terminal session-start failure is persisted with its generation and a fixed failure timestamp/deadline. Unattached anonymous `stop-instance` runtimes remain inspectable for two minutes by default, unaffected by reconnects or Manager adoption, then force-stop without running App graceful-shutdown hooks. Keep private 0600 non-sensitive tombstones after cleanup, at most 100; purge records older than seven days on the next failure write. Healthy-runtime vacancy and managed policy do not change. | implemented; release pending | Issue #9; fixed-deadline, persistence, adoption, cleanup and private-record regressions; focused race tests and isolated App E2E passed |

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| DRV-001 | Each template declares one semantic version for its server/session/helper bundle. | accepted | Catalog tests and production API evidence |
| DRV-002 | Production publishes root-owned, immutable, side-by-side application releases; changed content cannot reuse a release version. | accepted | Installer checks and production release paths |
| DRV-003 | New runtimes snapshot resolved template and component paths and do not change when `current` moves. | accepted | Unit tests and live old-release runtime |
| DRV-004 | A healthy managed runtime is adopted after manager restart without changing its runtime identity or unit PIDs. | accepted | Production lifecycle evidence |
| DRV-005 | Failure recovery recreates a managed runtime from its applied snapshot, never opportunistically upgrading it. | accepted | Gateway fault recovery evidence |
| DRV-006 | Driver adoption is explicit: a stopped-to-running transition uses the active manager's version. | accepted | Managed lifecycle tests and UAT |
| DRV-007 | The API and console report template/instance version and managed applied, available, and update state. | accepted | Go/SDK tests and production API evidence |
| DRV-008 | A managed registration suppresses anonymous auto-activation of the same template in both running and stopped desired states. | implemented | `TestStoppedManagedRegistrationReservesAutoTemplate` |
| DRV-009 | Running legacy records without complete snapshots fail closed during the first migration. | implemented | Registry load test |
| DRV-010 | Full deployment requires automated E2E followed by human application UAT. | accepted | Accepted production evidence, 2026-08-27 |
| DRV-011 | Rollback uses a retained immutable release and explicit instance transitions; published files are never overwritten. | implemented | Installer/runbook design |
| DRV-012 | Active, previous, and runtime-referenced releases are retained. | implemented | Manual operations procedure |
| DRV-013 | Release retirement automatically proves that no runtime references the target. | deferred | Reference-aware GC is not implemented |
| DRV-014 | Runtime state stores a content digest and exact RemoteXApp release ID in addition to driver version. | deferred | Current model stores canonical paths only |
| DRV-015 | The manager hot-reloads a newly activated catalog. | deferred | Manager restart is the accepted boundary |

DRV-004 remains the managed-runtime subset of the unified adoption contract in
RTM-007 through RTM-009 below.

## Unified runtime manifests

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| RTM-001 | Every active managed and anonymous runtime has one schema-versioned, mode-0600 manifest containing its launch intent, allocated resources, exact unit names, resolved template, and component snapshot. | implemented | Manifest round-trip, strict-schema, permission, and mixed live-runtime tests |
| RTM-002 | A creating manifest is durably renamed before the first runtime unit starts. Forced anonymous stop records stopped intent before any process teardown. Graceful stop durably records its request before invoking the application driver, then records stopped intent before server/VNC/gateway teardown or profile removal. Success removes the manifest, failed cleanup is completed rather than resurrected after restart, and blocked graceful stop retains running intent. | implemented | Lifecycle integration, write-failure ordering, and manifest desired-state/removal regressions |
| RTM-003 | Unified manifests are authoritative for managed and anonymous runtime state. During the first release only, managed records retain the former embedded runtime/applied fields as a non-authoritative projection so rc.15 rollback can read them. | implemented | Registry authority, migration, and exact rc.15 rollback tests |
| RTM-004 | Manager restart is a cold upgrade boundary: exact recorded units are stopped and each active manifest is recreated under the current catalog with the same runtime ID. Unit PIDs, application sessions, and browser connections are not preserved. | superseded | Replaced by RTM-007 through RTM-009 before release |
| RTM-005 | First restart migrates embedded managed runtime snapshots, cleans pre-manifest anonymous units and runtime directories, preserves profiles, and then runs normal template autostart. It never guesses missing legacy launch data. | implemented | Managed migration unit test and isolated fixed-autostart migration |
| RTM-006 | Manifest restoration and managed reconciliation finish before template autostart, preventing surviving or restored fixed-display runtimes from causing a manager crash loop. | implemented | Issue #4 reproduction and isolated restart regression |
| RTM-007 | Manager restart adopts a complete healthy managed or anonymous runtime from its locked manifest without changing runtime ID, unit PIDs, session generation, or running application. Attachment count resets to zero and browser clients reconnect through the SDK. | implemented | Unit adoption matrix and isolated real-systemd/Chrome restart E2E, 2026-08-28 |
| RTM-008 | A desired-running runtime that is incomplete or fails unit, X display, gateway, readiness-PID, Unicode-socket, dependency, or shutdown-state validation is stopped and recreated under the same ID from its locked template and component snapshot. Recovery never applies the current catalog opportunistically. A still-live application session is preserved for graceful host policy instead of being destroyed by recovery. | implemented | Structural/recovery-request and live-session preservation tests plus injected stopped-session gateway-failure E2E, 2026-08-28 |
| RTM-009 | Adoption restores managed and session observers, vacancy and blocked-shutdown policy timers, and durable terminal session state. Desired-stopped records finish cleanup and are not resurrected. | implemented | Observer/timer/clean-exit unit tests plus XFCE logout and forced-cleanup E2E, 2026-08-28 |
| RTM-016 | Closing the Linux cgroup observer explicitly wakes and joins its inotify reader before releasing descriptors, so repeated manager lifecycles neither leak readers nor lose subsequent managed/session events. | implemented | Close regression, 500-repeat same-process gate, 100-repeat race gate, and [`hosted-cgroup-observer-shutdown-gap.json`](private-history.md) |
| RTM-010 | In-process recovery of an unhealthy managed runtime retains its runtime ID, creation identity, locked template, components, parameters, profile, and single authoritative manifest. Cleanup failure prevents replacement; failed creation remains retryable under the same ID. Startup repairs duplicate records left by older managers without choosing by filename order: preserve a unique live application, otherwise use the durable managed pointer, a uniquely healthy runtime, or the newest recoverable record. Multiple live applications fail closed. | implemented | Issue #5 identity/retry, cleanup-failure, duplicate-selection, crash-point, restart-binding, race and release gates; local and test-host-a real-systemd fault acceptance; real test-host-h/test-host-k duplicate-loop repair; formal GitHub publication and five-sandbox checksum/binary/runtime alignment, 2026-08-31 |

See [`runtime-manifest-design.md`](runtime-manifest-design.md) for the record,
migration, restart, and failure contracts.

## Deployment identity and tenancy

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| DEP-001 | RemoteXApp processes never run as root and never switch Unix identity at runtime. | accepted | System and central-user units; deployment UAT |
| DEP-002 | Operators can use a locked dedicated account or one independent manager under an approved real Unix user. | accepted | `scripts/install-system.sh` and operations runbook |
| DEP-003 | Centrally installed code is shared and root-owned; state, HOME, sockets, and user services remain owned by the selected runtime UID. | accepted | Installed-system checks and production deployment |
| DEP-004 | Mutually untrusted tenants use separate UIDs or containers; template/profile isolation is not treated as an OS security boundary. | implemented | Service units and documented trust boundary |
| DEP-005 | Every manager on one host has unique listener and fixed display/port assignments, or uses dynamic displays. | implemented | Installer validation and operations runbook |
| DEP-006 | One required `runMode` selects the complete execution environment; templates cannot separately combine HOME, D-Bus, or Xauthority modes. | implemented | Catalog parsing and old-schema rejection tests |
| DEP-007 | `user-home` is available only to a fixed-display, persistent singleton managed instance; it resolves only the manager account and its HOME can never be purged by the API. | implemented | Policy, fixed-profile, and purge-preservation regressions |
| DEP-008 | `user-home` reuses but never owns `/run/user/<uid>/bus` and uses the current account's `~/.Xauthority`, modifying only its own display record. | implemented | User-bus cleanup and multi-display Xauthority regressions |
| DEP-009 | Server, session, and shutdown drivers receive the same resolved launch-parameter file and `runMode`; internal D-Bus behavior is derived rather than template-configured. | implemented | Driver environment contract and lifecycle tests |
| DEP-010 | Only the default `xfce-user-desktop` template must use a fixed 1280×720 framebuffer; this does not change other templates. For this template, instance overrides must not change the geometry or resize permission, client-requested desktop resizing must be disabled, and the browser must only scale the fixed framebuffer for display. | accepted | Catalog, override-policy, fixed-scaling browser E2E, and UAT accepted 2026-08-28 |
| DEP-011 | A same-origin reverse proxy may publish RemoteXApp below any path prefix while stripping that prefix upstream. The stable SDK loader, generated assets, API, viewer, health, RFB, and input URLs must share an automatically inferred prefix; root deployment remains compatible and explicit `baseURL` remains an override. | accepted | Base inference, nginx prefix browser E2E, and UAT accepted 2026-08-28 |
| DEP-012 | Administrator environment configuration can independently disable the built-in console surface (including `/`) and per-instance kiosk. Disabled pages return 404 and kiosk URLs are not advertised, while the stable SDK, API, RFB, input, cursor, and health surfaces remain available. Both surfaces remain enabled by default for upgrade compatibility. | accepted | Independent live exposure-policy matrix and UAT accepted 2026-08-28 |
| DEP-013 | Deployment preflight must reject a host missing a shipped single-application driver's required `matchbox-window-manager`, `jq`, LibreOffice, Python UNO executable/module, or `fuser`, and must identify the Ubuntu package that resolves the dependency. | implemented | Preflight, deployment architecture check, test-host-a Matchbox verification, and LibreOffice local E2E |
| DEP-014 | A coordinated system upgrade can publish an exact immutable core release and shipped App Packages without changing core/App selectors, configuration, units, or service state. Activation and rollback occur only through the stopped-consumer paired transition; changed bytes under an existing version fail closed. | implemented | Offline idempotence/mutation test, deployment architecture checks, and downstream integration task local paired transition |
| DEP-015 | Each new immutable system release records its required executable set in a strict release manifest. Selection validates every declared executable. Retained releases without that manifest use the legacy three-core-binary contract. Shared units must not pass newly introduced optional flags to retained binaries; current user-mode managers read service-restart policy from the environment, while dedicated mode removes it. | implemented | Stager/config regressions, deployment architecture check, and test-host-a/local rc.5 rollback discovery, 2026-09-01 |
| DEP-015 | Any core selection that starts a manager must verify its version and optional exact commit within a configurable, bounded 1–600 second health budget (120 seconds by default); failed activation restores and verifies the previous release. A breaking major downgrade restores the exact pre-upgrade root/Home state snapshot before selecting the older core, which is never started on forward-written incompatible state. Post-snapshot state is outside the downgrade guarantee. | implemented | Deployment architecture checks and downstream integration task old→new→old→new local transition |
| DEP-016 | All future local installations, upgrades, redeployments, rollbacks, and alignments bind Managers to `127.0.0.1`: production port 1991 and test port 2992 (latest operator instruction supersedes 2991). Historical local wildcard-listener approvals are superseded; any non-loopback exception requires new explicit operator approval. Sandbox policies remain independent. Verify effective configuration, actual listeners, and loopback readiness after deployment. | accepted | Operator policy and live local listener/readiness verification, 2026-09-09; [alignment process](release-alignment-process.md) |

See [`operations.md`](operations.md) for the supported deployment modes and
[`commercial-readiness.md`](commercial-readiness.md) for the trust boundary.

## Unified operator console release train

This train was scope-locked on 2026-08-31 and now targets `0.2.0-rc.10`. It consolidates the root page, SDK
console, minimal example, and instance kiosk onto one maintained web
application with explicit capability-limited modes. The detailed scope and
acceptance gate are in
[`unified-operator-console-release.md`](unified-operator-console-release.md).
Implementation, complete local verification, and deployment only to local port
1991 are authorized. No sandbox deployment is authorized.

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| CON-001 | One generated web application and component set serves the canonical operator console and the existing `/`, `/sdk/console.html`, `/sdk/minimal.html`, and per-instance kiosk compatibility entries. Each entry selects an explicit dashboard, launch, or viewer mode; code reuse must not expand that mode's authority, and reverse-proxy base paths continue to work. | implemented | rc.9 unified route, executable prefix matrix, and real Chrome modes |
| CON-002 | The existing console and kiosk exposure controls remain independent and authoritative. Kiosk/viewer mode exposes no catalog-wide, runtime-control, or service-control actions, while the backend authorizes every operation regardless of which controls the browser renders. | implemented | Exposure-policy, backend authorization, source guard, and real viewer DOM tests |
| CON-003 | The console reports health, core/SDK versions, capabilities, templates, managed registrations, runtimes, sessions, resources, bounded application status, readiness, client/generation state, lifecycle progress, and actionable errors with manual and bounded automatic refresh. | implemented | API projection and real operator-console status tests |
| CON-004 | Launch and management forms are generated only from generic App/template metadata. They support declared parameter types, required values, defaults, constraints, profiles, and allowed instance overrides; server validation remains authoritative and console code may not branch on an App or template ID. | implemented | Six-package source guard plus parameterized Edge launch from the real console |
| CON-005 | Authorized operators can launch an App; attach, reconnect, or disconnect a viewer; create, start, stop, or remove a managed registration; and request graceful or explicitly confirmed forced runtime stop. Long-running actions have observable progress and one terminal result. | implemented | Managed/anonymous API E2E and real Chrome launch/connect/reconnect/stop flows |
| CON-006 | Runtime restart is one generation-qualified server operation that transactionally reuses the durable launch intent, identity, parameters, profile, overrides, and locked component snapshot. It is not an App upgrade, respects graceful-shutdown host policy, and never depends on the browser reconstructing a launch request. | implemented | Stale, crash recovery, blocked/force, managed, anonymous, Edge UI, and version-pin E2E |
| CON-007 | Manager-service restart is optional, disabled by default, and implemented only through an independently supervised non-root operator helper with a fixed service allowlist. It requires authenticated operator authorization and request-forgery, replay/rate, and audit controls; it accepts no arbitrary unit or command and is unavailable on an unauthenticated public listener. | implemented | Authenticated real user-systemd operation/recovery and abuse matrix |
| CON-008 | The console treats application protocols as opaque and displays only generic resources and bounded status details. It never automatically retrieves, polls, logs, exports, persists, or places in URLs the secret-bearing EXP-007 environment; any later environment view requires a separate deliberate and backend-authorized operator action. | implemented | App-neutral source guard and zero environment requests across real browser modes |
| CON-009 | Release acceptance covers all compatibility routes, root and prefixed deployments, exposure modes, parameter forms, managed and anonymous lifecycles, runtime/service restart and connection-loss recovery, input/resize/status behavior, rejected unauthorized/stale operations, accessibility, real systemd/X11 E2E, and human UAT. | accepted | rc.9 core/lifecycle automation, rc.10 navigation automation, and Human UAT accepted 2026-09-01 |
| CON-010 | Operator navigation follows ownership rather than exposing managed registrations and their runtimes as peer entries. Each managed application appears once with its current runtime nested under technical details; the standalone runtime list contains only anonymous runtimes. The UI uses `Open standalone and connect` when it resolves or creates an anonymous runtime, `Create managed application and connect` when it creates a durable registration, `Start and connect` when it starts a stopped managed application, `Connect` only for an existing runtime, and `Reconnect` only for the current viewer connection. | accepted | Navigation unit/source tests, [`unified-console-rc10-navigation-local-1991.json`](private-history.md), and Human UAT accepted 2026-09-01 |

## App Package ABI v1 major release train

The architecture-major release train scope was accepted and locked by
[`app-package-major-release.md`](app-package-major-release.md). The current
release is `0.2.0-rc.4` with SDK `0.17.0`. The exact host application v2.0.91 pair passed
local and test-host-a paired activation/rollback/restore, production acceptance,
Human UAT, and ordered follower deployment. APP-008 remains deferred.

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| APP-001 | After the core binaries and SDK are built, an ordinary App can be added or upgraded by installing and activating only its runtime package and declared host dependencies. Package documentation and tests remain source-owned but need not be installed. No Go, SDK, global preflight, unrelated template change, or core rebuild is permitted. Manager restart is the accepted initial catalog-load boundary. | implemented | Build-once synthetic install/update/disable/rollback E2E |
| APP-002 | Every App is trusted, self-contained, semantic-versioned, distributed as a deterministic `.tar.gz` with SHA-256 checksum, installed into an immutable side-by-side directory, and activated through an atomic selector. Extraction applies canonical file and directory permissions independent of installer umask, so the same archive retains the same content seal and can be reactivated idempotently. Strict validation covers the core schema, digest, canonical package-local assets, ownership, permissions, dependencies, and version reuse. Runtime manifests pin App ID, version, digest, and canonical path; referenced packages cannot be removed. | implemented | Installer rejection, cross-umask idempotence, atomic selection, digest pinning, adoption and retention tests |
| APP-003 | Every package declares the single ABI field `apiVersion: remotexapp/v1`; V1 has no separate schema/driver-version negotiation. The manager strictly validates its generic fields and passes parameters, named ports, and an optional opaque `driver.config` through private JSON plus stable display, runtime, generation, status, input, and shutdown contracts. App launch, window detection, protocol probes, readiness meaning, exit, and cleanup remain in the driver; unsupported API versions fail before activation. | implemented | ABI, strict schema, private launch-file, opaque-config and incompatible-version tests |
| APP-004 | The V1 manager allocates only named loopback TCP ports and exposes them as generic resources. It does not implement an arbitrary resource registry, recognize CDP, WebDriver BiDi, UNO, Edge, Firefox, or LibreOffice, construct application-protocol URLs, or publicly proxy raw control endpoints. Runtime manifests pin allocated ports across adoption and recovery. Any later resource kind requires an explicit platform-capability requirement. | implemented | Neutral allocation, public projection, collision/TIME_WAIT and adoption tests |
| APP-005 | Driver status supports schema-declared bounded JSON details in addition to existing scalars. The helper enforces generation, encoded-size, nesting, and collection limits without interpreting application protocol meaning; undeclared or unbounded output fails closed. | implemented | Helper/manager stale, malformed, trailing, oversized, depth and item-limit matrix |
| APP-006 | The major API and SDK expose generic instance `resources` and JSON application-status details instead of protocol-specific top-level control fields. The host application keeps application adapters: Browser interprets Firefox BiDi or Edge CDP, File Editor interprets LibreOffice UNO, and Desktop remains generic. They may share control-envelope parsing, but protocol behavior is not falsely unified. Later Apps change host application only when it deliberately implements App-specific behavior. | implemented | SDK 0.17 tests and completed [host application migration](host-app-package-migration.md), downstream integration task paired gates, production acceptance, and UAT |
| APP-007 | Instance override permissions are explicitly allowed or locked by each manifest and enforced by one template-independent validator. No production policy path may branch on a template ID. | implemented | Catalog policy matrix and production-source guard |
| APP-008 | A future lifecycle train should evaluate separating registration durability, runtime activation, session activation, and vacancy action while retaining the coherent `isolated`, `shared`, and `user-home` execution environments. App Package ABI V1 keeps current managed/anonymous lifecycle behavior and may use the existing anonymous singleton-persistent pattern; lifecycle redesign is not a package prerequisite. | deferred | Separate lifecycle design and durable/anonymous restart matrix |
| APP-009 | A manifest declares bounded server/session readiness deadlines. Drivers publish readiness only after their App-specific visible-window and protocol probes pass; a current-generation driver error ends the generic wait promptly. Changing an ordinary App startup budget does not require manager code. | implemented | Slow/fast/error/stale-generation tests and real five-App readiness gate |
| APP-010 | Core and per-package dependencies are separate declarative inventories. V1 checks only required executable names and Python module names. Generic preflight evaluates the enabled catalog and reports the exact missing capability and package without a hard-coded application list; it does not solve distribution packages or install dependencies. Provisioning remains an operator/playbook action. | implemented | Six-package dependency inventory, generic catalog preflight and missing-capability tests |
| APP-011 | Core tests use neutral capability fixtures and never inspect application driver source text. Each App Package source owns manifest/driver contract tests and real application E2E; tests need not ship in the runtime artifact. CI proves that a post-build synthetic App can be installed, launched, updated, disabled, and rolled back without changing or rebuilding the core. | implemented | Neutral core-fixture guard, package-owned tests and build-once local E2E |
| APP-012 | Microsoft Edge is the reference migration using the current anonymous singleton-persistent lifecycle: shared run mode, persistent `default` profile, dynamic 1280x720 depth-16 display at 5 FPS with client resize, and complete runtime stop after six detached hours while preserving its profile. It uses a dynamically allocated `127.0.0.1` CDP port; ready requires a visible Edge window, valid `/json/version`, browser WebSocket handshake, and harmless CDP command. Its bounded status returns the complete generic control object. | implemented | Package contract plus real visible-window, CDP, resize, input, shutdown and profile-persistence E2E |
| APP-013 | Firefox ESR, LibreOffice, Mousepad, `xfce-desktop`, and `xfce-user-desktop` migrate to the same package boundary without losing their accepted behavior. Existing active runtimes remain pinned during manager restart, new runtimes select the active package, host application updates its exact RemoteXApp/SDK lock, and the release completes full local deployment, rollback, confidentiality, downstream E2E, and human UAT. | implemented | Exact rc.4/host application v2.0.91 local, test-host-a staging/rollback/production/UAT, and ordered test-host-c/03/07/10 acceptance |

APP-008 is deliberately deferred to a separate lifecycle train and must not
expand App Package ABI V1. APP-004 through APP-006 will supersede the current
protocol-specific LBO-003 and FFX-005 response shapes only when the major
migration ships. DRV-015 remains deferred: hot reload is not part of this
release train.

The APP-001 through APP-013 release scope is complete. APP-008 remains deferred
to a separate lifecycle train. Accepted decisions remain immutable history and
are superseded only by a later requirement with a dated design-log entry.

## Edge App Package identity release train

This independent App Package train was scope-locked on 2026-08-30 with target
`edge@1.0.0`. It preserves `remotexapp/v1` and requires no core or SDK change.
Implementation, complete local verification, and deployment to test-host-a,
test-host-c, test-host-d, test-host-h, and test-host-k are explicitly authorized;
every other sandbox remains outside the deployment scope. The detailed plan is
[`edge-app-package-release.md`](edge-app-package-release.md).

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| EDGE-001 | The Microsoft Edge App Package and public template ID are exactly `edge`; its public name is `Microsoft Edge`. It is an anonymous singleton with `runMode: shared`, persistent `profileRef: default`, on-demand server, on-attach session, dynamic 1280x720 depth-16 display at 5 FPS, client resize, and `stop-instance` after six detached hours while preserving the shared profile. | implemented | `apps/edge/manifest.json`; local real X11/RFB lifecycle E2E |
| EDGE-002 | Each active `edge` runtime receives one manager-allocated unprivileged `127.0.0.1` CDP port. Ready requires a visible Edge window, valid bounded `/json/version`, a browser WebSocket handshake, and successful harmless `Browser.getVersion`. `resources.control` returns the generic allocation; current-generation ready status returns bounded `details.control` containing `protocol`, `address`, `port`, `versionUrl`, discovered `browserWebSocketUrl`, product, and protocol version. The raw endpoint is never proxied. | implemented | Edge contract test plus real CDP probe and Firefox collision E2E |
| EDGE-003 | `edge` supersedes `edge-browser`; both selectors must not be active against the same persistent profile. Migration stops any old runtime, disables the old selector, atomically moves the inactive `edge-browser/default` profile to `edge/default`, activates `edge`, restarts only the manager, and verifies the old runtime and CDP port are gone. RemoteXApp core, gateway, status helper, and SDK must not change or be redeployed. The host application changes only its Edge adapter/template expectation when it adopts the new ID. | implemented | selectors on test-host-a/02/03/07/10 are exactly `edge@1.0.0`; no old runtime/default profile existed, so every fail-closed migration correctly made no move |
| EDGE-004 | Release acceptance requires package contract and deterministic-artifact checks plus real X11/RFB/CDP coverage for singleton reuse, dynamic-port collision safety, visible readiness, resize/input, manager adoption without runtime churn, detached lifecycle, complete shutdown/port cleanup, profile reuse, and old-ID rejection. Local release gates precede any separately approved sandbox deployment. | implemented | `make check`, `make test-race`, exact package E2E, and 3-second detached-policy equivalent passed 2026-08-30 |
| EDGE-005 | The Edge Driver safely recovers persistent-profile Chromium singleton residue before launch and after complete owned-process shutdown. It may atomically quarantine only `SingletonLock`, `SingletonSocket` and `SingletonCookie` after proving the recorded local PID is absent or identity-mismatched, the socket is absent or unreachable, and no process uses the exact `--user-data-dir`. A live matching process or reachable socket fails startup explicitly and leaves the profile untouched. Never delete profile data or unrelated files; mode-protect quarantine retention and keep only the newest four structurally validated Driver-owned records. Unknown quarantine content fails closed. No Core, SDK or Manager API change. | accepted | Package unit tests plus real clean/crash/restart/reboot-equivalent/foreign-host/partial-lock/PID-reuse/live-owner/socket/profile-preservation/CDP E2E |
| EDGE-006 | Edge Driver 2.0.3 reports a bounded, current-generation failure status distinguishing missing visible window from failed CDP readiness before Core's session startup deadline. Probe errors have no Python traceback and the allocated loopback CDP endpoint remains private; success still requires both window and `Browser.getVersion`. | implemented; release pending | Issue #9; App contract/probe failure and isolated real Edge startup/adoption/CDP E2E passed; real failed-launch E2E and Human UAT pending |

## Experimental application status commands

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| EXP-001 | RemoteXApp may expose the experimental application status-command route and SDK method only behind an explicit administrator feature flag that defaults disabled. The disabled route returns 404, capability/health evidence reports the same state, and the initial enabled scope is test-host-a only. | locked | [Experimental status-command request](experimental-status-command-requirement.md) |
| EXP-002 | An enabled client submits an absolute executable plus structured argv, expected session generation and bounded timeout. RemoteXApp invokes no implicit shell and executes with the exact active application's non-root UID, HOME, working directory, DISPLAY, XAUTHORITY, XDG runtime, D-Bus and audio environment. | locked | Required isolated real-session environment comparison |
| EXP-003 | Status-command execution is transient, noninteractive and generation-qualified: no stdin/TTY/streaming is exposed; stopped or stale sessions are rejected; timeout, cancellation and completion remove the complete descendant scope; one per-instance command, five-second maximum runtime and 128 KiB combined output prevent unbounded work. | locked | Required unit, race and real-systemd containment tests |
| EXP-004 | Command results include instance/generation, application state, exit code, bounded stdout/stderr, duration and truncation, but never change or persist the durable application-status snapshot. RemoteXApp and the SDK do not cache, diagnose or log argv or output; audit records retain only privacy-safe identity/timing/result metadata. | locked | Required API, status-file, journal and browser-storage regressions |
| EXP-005 | The initial host application experiment submits only `/usr/bin/env -0`, parses NUL-delimited output, retains only its explicit graphical-environment allowlist and immediately discards the complete result. No unrelated environment value may reach an Agent prompt, diagnostic, log or browser persistence. | locked | Required test-host-a host application integration E2E |
| EXP-006 | Free-form status execution is explicitly an experimental same-UID remote-execution capability, not a read-only status guarantee or stable product API. Broader deployment requires a separate security review and retained abuse-case evidence, followed by removal, operator-only isolation, or replacement with named schema-validated probes. | locked | Required human security checkpoint and experiment exit record |
| EXP-007 | Every template's declared `session.readinessPid` identifies its canonical application or session-owner process for environment lookup. The manager resolves the runtime-local PID file generically without template-ID branches, validates the live process against the current generation, exact session cgroup and non-root runtime UID, and uses `/proc/<pid>/environ` and `/proc/<pid>/cwd` as the initial exec environment and working-directory source. `POST /api/instances/{id}/status/environment` and `getApplicationEnvironment()` return the instance ID, generation, application state, complete unfiltered environment map and working directory; they return no PID or command result, never return a partial environment, execute no caller-selected program and persist no environment snapshot. Unauthenticated non-loopback listeners reject the operation unless the administrator explicitly enabled `allow-insecure-public`; that opt-in exposes the complete secret-bearing result to every client admitted by the surrounding network boundary and is limited to controlled sandbox deployments. Shipped manager units must retain the host procfs visibility needed for the same-UID cross-unit read. | implemented | Manager/SDK regressions, [`application-environment-rc23-local-1991.json`](private-history.md), and [`application-environment-rc24-public-test-host-a.json`](private-history.md) |

The complete request, threat boundary, API sketch, acceptance criteria and exit
conditions are in
[`experimental-status-command-requirement.md`](experimental-status-command-requirement.md).

## LibreOffice document template

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| LBO-001 | Template ID and public name are both exactly `libreoffice`. It is a non-singleton isolated temporary application with dynamic display allocation, 1280x720 geometry, depth 16, 10 FPS, client resize enabled, immediate session start during instance creation, and `stop-instance` after 60 seconds vacant. | accepted | Catalog policy regression plus formal local and sandbox live evidence |
| LBO-002 | Launch requires one `filePath`. The manager canonicalizes it, requires an existing readable regular file, and rejects relative paths, paths outside administrator-configured document roots, and symlink escapes before allocating a display. | accepted | File-parameter boundary and symlink regressions |
| LBO-003 | Each active LibreOffice runtime owns one collision-checked loopback UNO TCP port. The number is persisted in its runtime manifest and returned as both `instance.controlPort` and ready-status detail `controlPort`; the raw endpoint is never published as a RemoteXApp network route. | accepted | Allocation/persistence/API regressions plus local and rc.17 sandbox evidence |
| LBO-004 | Ready means the exact requested document has a visible LibreOffice window and is reachable through UNO. Deployment preflight verifies LibreOffice, Python UNO, Matchbox, and `jq`. | accepted | Driver/catalog tests plus formal local and sandbox browser/UNO evidence |
| LBO-005 | The session driver must repeat exact canonical-path regular-file, readability, and real open checks immediately before application launch without resolving to a new target. It rejects final-component symlink replacement, removes the exact `.~lock.<filename>#` lock, and reports an application error without starting LibreOffice when validation or lock cleanup fails. | accepted | Driver contract regression plus formal local symlink/unremovable-lock and sandbox missing/unreadable-file cases |
| LBO-006 | This temporary template's normal and forced stop are intentionally destructive: the dedicated shutdown driver sends `SIGKILL` to the pinned readiness PID, never invokes save or native-close UI, verifies exact lock removal, and fails if process or lock cleanup cannot complete. Unsaved document changes are discarded unless trusted control code saved them before stop. | accepted | Standalone shutdown regression plus formal local and sandbox unsaved-UNO byte-identity/residue checks |
| LBO-007 | An empty isolated profile is initialized from a versioned, sanitized seed containing no host paths or runtime state. Driver status distinguishes profile preparation, input startup, application startup, and document loading; seeding is not claimed to improve startup performance. | accepted | Seed portability/catalog regressions, formal local launch, and five-run sandbox timing record |
| LBO-008 | During immediate startup, a generation-matched driver `error` must end readiness waiting promptly and remain the public application error instead of being replaced by the manager's generic 20-second timeout. A stale-generation error must not terminate a new session startup. | accepted | Readiness unit regression plus formal local symlink/lock rejection validation |
| LBO-009 | Only one RemoteXApp session may own a canonical document path at a time. The driver acquires an atomic owner-PID lease before changing the LibreOffice lock, rejects a live lease or a file held by another local process, recovers a dead lease, and releases only its own lease and document lock. | accepted | Driver contract regression plus sandbox same-version, stale-lease, and cross-version contention validation |

Human document and application-control UAT was accepted on 2026-09-01; exact
evidence is
[`stable-0.2.0-test-host-a-human-uat.json`](private-history.md).

## Persistent Firefox ESR template

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| FFX-001 | Template ID and public name are exactly `firefox-esr`. The default is an unmanaged singleton using `profileRef: default`, `runMode: shared`, an on-demand dynamic 1280x720 depth-24 display at 5 FPS, client resize, and on-attach session start. | accepted | Catalog policy and isolated real-browser E2E |
| FFX-002 | `startUrl` defaults to `about:blank` and accepts only manager-validated HTTP, HTTPS, or exactly `about:blank`; the driver parses the mode-0600 parameter JSON without shell evaluation. | accepted | URL boundary regressions and isolated launch E2E |
| FFX-003 | The six-hour vacancy timer starts when the server is created or the last RFB client detaches. Expiry stops Firefox, session input, VNC, and gateway and removes runtime state while preserving the shared profile; a later anonymous create obtains a new runtime and reuses that profile. | accepted | Cleanup regression plus attached, detached, never-attached, and profile-reuse E2E |
| FFX-004 | Ready requires a PID-owned visible Firefox ESR window. Clean close and manager shutdown use application status plus the bounded graceful-close protocol; deployment preflight rejects a missing Firefox ESR executable. | accepted | Visible-window, Unicode, restart-adoption, API-stop, and Alt+F4 E2E |
| FFX-005 | Every newly created Firefox ESR runtime owns one collision-checked WebDriver BiDi port at `127.0.0.1`. The instance API and driver-reported application status return the address, port, and complete `ws://127.0.0.1:PORT/session` URL; the runtime manifest preserves the endpoint across manager adoption. | accepted | Control schema, catalog, manifest, API/status, isolated protocol E2E, and local port-1991 rc.20 evidence |
| FFX-006 | Firefox readiness requires both a PID-owned visible window and a successful WebSocket/BiDi `session.status` exchange. The unauthenticated BiDi listener must remain loopback-only and must never be exposed by the RemoteXApp HTTP gateway or reverse proxy. | accepted | Driver security regression plus isolated and local port-1991 loopback/direct-BiDi E2E |
| FFX-007 | Firefox driver-generated profile settings explicitly disable `focusmanager.testmode` so normal editable fields accept Unicode/IBus `sendText()` while loopback BiDi remains enabled. Cover new/reused profiles, restart/recreation, Viewer reconnect, native focus switching and BiDi control with actual application readback; preserve existing template policy and exclude password/direct-keyboard-only fields. Ship a new immutable App version, not an in-place change to pinned runtimes. | accepted | [Exact candidate and local 1991 input/restart evidence](private-history.md); automated acceptance passed; [Human UAT accepted](private-history.md), 2026-09-08 |

This template intentionally uses the anonymous runtime API. It does not add a
managed-instance exception for `idleAction=stop-instance`; Human browser UAT
was accepted on 2026-09-01 in
[`stable-0.2.0-test-host-a-human-uat.json`](private-history.md).

## Upstream noVNC dependency

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| WEB-001 | A repository commit pins reviewed noVNC release source, provenance, licenses, and generated assets; normal build and runtime do not fetch upstream code. | accepted | `make novnc-check` and noVNC 1.7 production evidence |
| WEB-002 | A scheduled workflow detects a newer stable upstream release and opens a draft PR or a deduplicated failure issue. | implemented | `.github/workflows/novnc-upstream.yml` |
| WEB-003 | An upstream update cannot auto-merge and must pass source/provenance, build, private-adapter, and full browser regression review. | accepted | noVNC 1.7 automated validation and human UAT |

See [`novnc-upstream.md`](novnc-upstream.md) for the import architecture and
merge process.

## Browser SDK reconnection

### RFB transport keepalive

| ID | Requirement | Status | Verification |
| --- | --- | --- | --- |
| RFB-001 | Both direct and compatibility RFB WebSocket relays send a protocol Ping every 30 seconds while connected; browser protocol Pong replies never enter the RFB data stream. Heartbeats use a five-second bounded control write, close both relay endpoints on write failure, and stop/join on normal relay termination. No new Pong/read timeout or SDK/App API change is introduced. | accepted | Focused heartbeat tests, repeated race tests, local human UAT and [0.9.1 fleet/runtime verification](private-history.md); Cloudflare-path acceptance remains separate |

### Reconnection policy

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| SDK-001 | Automatic reconnection must support both unlimited retries and a caller-selected maximum number of attempts. `maxReconnectAttempts` accepts `Infinity` or a non-negative integer; omission defaults to `Infinity` for compatibility. | accepted | Unlimited/finite browser E2E and UAT accepted 2026-08-28 |
| SDK-002 | The initial connection is not an automatic attempt. A successful connection resets the counter, and an explicit `connect()` or `reconnect()` starts a new retry budget. | accepted | Explicit reconnect-reset browser E2E and UAT accepted 2026-08-28 |
| SDK-003 | Exhausting a finite retry budget closes residual channels, stops reconnect timers, remains `disconnected`, and emits exactly one `reconnectexhausted` event. Intentional disconnect, destruction, and a clean terminal session continue to stop immediately regardless of the configured budget. | accepted | Finite exhaustion browser E2E and UAT accepted 2026-08-28 |

## Browser SDK remote resize

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| SDK-004 | Remote framebuffer resize scheduling must be caller-configurable through `resizeDebounce` and `resizeMaxWait`, with equivalent declarative viewer attributes. A zero debounce retains the current behavior; a positive debounce sends the final size after that quiet period, while finite `resizeMaxWait` also permits bounded periodic progress and `Infinity` waits for the quiet period only. `flushResize()` must immediately submit a pending final size when an embedding UI knows its resize gesture ended. Initial connect and reconnect size negotiation remain immediate. While a request is delayed, the viewer locally scales the existing framebuffer; fixed/scale-only policy sends no remote request. Disconnect, destruction, and connection replacement cancel stale scheduling, and a size change that occurs while another request is pending must still converge to the latest dimensions without duplicates. | accepted | SDK 0.15 deterministic, P15 isolated, and immutable rc.21 port-1991 tests passed compatibility, trailing, finite maximum-wait, flush, local-scale, reconnect, final convergence, adoption, and cleanup; interactive UAT accepted 2026-08-29 |

## Unicode engine implementation

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| IME-001 | The private Unicode engine remains a small replaceable production component behind the existing Unix-socket contract. | accepted | XFCE/Mousepad/Edge Unicode E2E |
| IME-002 | Reimplement the IBus engine in Go only when measured operational benefit justifies the development and long-term maintenance burden. | deferred | Assessment accepted; current Python engine retained |
| IME-003 | The browser routes reliably mapped physical printable ASCII and native control/shortcut keys through RFB, while IME composition, non-ASCII text, dead/unidentified-key fallback, soft-keyboard input, and paste use the Unicode/IBus channel without duplicate commits. Explicit `sendText()` always uses IBus, including ASCII; password fields and other direct-keyboard-only widgets are unsupported and require physical keyboard input or correctly paired RFB `sendKey()` events. Commit ACK does not guarantee application insertion; no automatic cross-channel fallback is implied. | accepted | SDK routing regressions, display `:2` Polkit production E2E, and human UAT accepted 2026-08-27; API scope clarified 2026-09-07 in [SDK input contract](browser-sdk.md#sendtext-is-not-keyboard-simulation) |
| IME-004 | Non-ASCII input into a focused remote widget without an IBus context must not be committed to a stale context owned by another application. | locked | Display `:2` Polkit focus retained Mousepad's prior IBus context; ASCII RFB is unaffected |
| IME-005 | Before a fresh valid remote caret is available, the viewer must anchor its native IME host at the most recent primary-button or equivalent touch/pen activation over the remote canvas, rather than the static initial corner. Right- and middle-button presses must not replace that fallback. The viewer must make the new geometry effective before composition begins, then prefer the fresh remote caret when it arrives; it must never blur, refocus, or otherwise interrupt active composition or queued/in-flight text. | accepted | SDK 0.15 tests cover mouse/touch/pen, button exclusion, 750 ms retained fallback, late caret authority, and composition/queued/in-flight safety; isolated and deployed rc.21 real-browser tests passed fallback, correction, right-click exclusion, composition-safe focus, and exact IBus input; native candidate-window UAT accepted 2026-08-29 |

## Bidirectional rich clipboard release train

This train was explicitly extended on 2026-09-02 for RemoteXApp `0.4.0`, SDK
`0.20.0`, and unchanged App Package ABI V1. The original lock authorized
implementation, complete automated and local real-X11/browser E2E, and
deployment only to local `0.0.0.0:1991` for Human UAT. Human UAT is now
accepted and annotated `v0.4.0-rc.3` is published as a checksum-verified
GitHub prerelease. The exact behavior is approved for stable `v0.4.0`
publication without functional changes. Annotated `v0.4.0` is now the normal
checksum-verified Latest GitHub Release; no sandbox change is authorized. The
complete specification is
[`rich-clipboard-requirement.md`](rich-clipboard-requirement.md).
The rc.1 links below preserve the original base-feature evidence; the
[`rc.2 evidence`](private-history.md)
recertifies the complete train and adds CLP-016. CLP-017 adds explicit browser
access inspection and read authorization; exact rc.3 real-browser validation
and Human UAT passed on 2026-09-02.

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| CLP-001 | RemoteXApp adds one manager-mediated bidirectional clipboard subsystem: `toRemote` moves browser/local content to the remote X11 clipboard and `toLocal` moves remote X11 content to a Viewer-local clipboard. It does not change accepted physical-key, IME, browser-paste, or `sendText()` behavior. Initial formats are plain UTF-8, HTML, RTF, and PNG; files, URI lists, directories, drag/drop, audio/video, and arbitrary MIME types are excluded. | accepted | [Local rc.1 evidence](private-history.md) and [rc.3 Human UAT](private-history.md) |
| CLP-002 | The authenticated Manager is the external control plane and validates instance identity, current positive session generation, active ready session, direction, action, media type, quotas, and authorization. The pinned per-runtime Go gateway is the X11 data plane and exchanges bodies with the Manager only through an owner-only Unix socket. No template-ID or App-protocol branch is permitted. | accepted | [Local rc.1 evidence](private-history.md) and [rc.3 Human UAT](private-history.md) |
| CLP-003 | The Manager exposes generation-qualified capability and offer APIs. `toRemote` content is uploaded through a multipart `POST`; `toLocal` acceptance returns multipart content and is non-consuming; list/status operations recover unexpired metadata after reconnect. Large or binary bodies never use JSON, base64, RFB clipboard, or WebSocket messages. | accepted | [Local rc.1 evidence](private-history.md) and [rc.3 Human UAT](private-history.md) |
| CLP-004 | One offer may contain alternative representations of one logical value. X11 `TARGETS` negotiation is limited to UTF-8 text targets, `text/html`, both accepted RTF aliases, and `image/png`; HTML requires plain fallback, RTF should carry it, and PNG may stand alone. RemoteXApp does not render, sanitize, transcode, or interpret application semantics. | accepted | [Local rc.1 evidence](private-history.md) and [rc.3 Human UAT](private-history.md) |
| CLP-005 | Symmetric limits apply to decoded logical content: plain text 4 MiB, HTML 4 MiB, RTF 16 MiB, PNG 64 MiB, and 80 MiB total per offer. They are fixed platform ceilings, not template or instance overrides. PNG also requires signature, IHDR, dimension, and pixel-bound validation. | accepted | [Local rc.1 evidence](private-history.md) and [rc.3 Human UAT](private-history.md) |
| CLP-006 | The gateway uses one asynchronous X11 clipboard event loop and implements normal Selection transfer plus `INCR`. For `toRemote`, `set` establishes bounded ownership and explicit `paste` also issues the validated paste gesture. States distinguish accepted, owned, requested, served, cancelled, expired, not-consumed, and failed; served never claims application insertion or save. | accepted | [Local rc.1 evidence](private-history.md) and [rc.3 Human UAT](private-history.md) |
| CLP-007 | Clipboard content is untrusted, transient, non-durable, owner-only, and runtime/generation scoped. Payloads, previews, filenames, hashes, and representations never enter logs, diagnostics, status, manifests, browser persistence, or crash evidence. Expiry, eviction, cancellation, generation change, session/runtime exit, and gateway failure remove content without replay. | partially superseded by CLP-016 | [RC.1 UAT exposed the expiry/replay conflict](../docs/rich-clipboard-requirement.md) |
| CLP-008 | Acceptance requires focused unit, race, malformed-input, authentication/origin, cross-user, resource-exhaustion, browser-permission, X11, multi-Viewer, reconnect, and lifecycle coverage plus real bidirectional E2E for every format and fallback. Human UAT and every sandbox or production deployment remain separately approved actions. | accepted | [Local rc.1/rc.2 evidence](private-history.md) and [rc.3 Human UAT](private-history.md) |
| CLP-009 | The runtime gateway uses a pure-Go X11/XFixes implementation to detect each authoritative remote `CLIPBOARD` owner change and snapshot the allowed representations once into a bounded, owner-only, expiring `toLocal` offer. Monitoring does not depend on a template, RFB clipboard, polling, or an App-specific adapter. | accepted | [Local rc.1 evidence](private-history.md) and [rc.3 Human UAT](private-history.md) |
| CLP-010 | Every remote clipboard change is broadcast as metadata to every Viewer attached to the current session generation, including view-only Viewers. The snapshot is stored once; acceptance is independent and non-consuming per Viewer. Events have a monotonic per-runtime sequence and reliable bounded queue; a gap or reconnect is reconciled through the pending-offer API. | accepted | [Local rc.1 evidence](private-history.md) and [rc.3 Human UAT](private-history.md) |
| CLP-011 | The SDK exposes one `client.clipboard` namespace with explicit-content send, local-to-remote sync, remote-to-local sync, list, dismiss, configuration, and events. Each direction independently supports `off`, `manual`, `prompt`, and explicitly opted-in `auto`; `prompt` automatically detects but moves nothing before Yes, while permission failure in `auto` visibly degrades to `prompt`. | accepted | [Local rc.1 evidence](private-history.md) and [rc.3 Human UAT](private-history.md) |
| CLP-012 | The optional built-in prompt controller renders clipboard changes as translucent full-width bars at the top of the remote canvas. Messages form a bounded stack with the newest first; each has Yes and X, progress/success/expired state, no payload preview, no remote-focus theft, and accessible keyboard/screen-reader behavior. Dismissal is local to one Viewer. | accepted | [Local rc.1 evidence](private-history.md) and [rc.3 Human UAT](private-history.md) |
| CLP-013 | In `prompt` or `auto`, the SDK checks for local clipboard changes on supported `clipboardchange` events and reconciles once when the top-level document regains system focus or becomes visible. It does not react to client/IME DOM refocus, deduplicates combined signals, and never raises a fresh browser permission prompt solely because focus changed; without permission it waits for explicit activation or paste. | accepted | [Local rc.1 evidence](private-history.md) and [rc.3 Human UAT](private-history.md) |
| CLP-014 | A `toRemote` change is still broadcast to all Viewers with an opaque `sourceViewerId`; the source Viewer suppresses only its redundant sync-back prompt while other Viewers handle it normally. Gateway transaction identity and non-persistent client fingerprints prevent feedback loops. One Viewer's acceptance or dismissal never changes another Viewer's pending state. | accepted | [Local rc.1 evidence](private-history.md) and [rc.3 Human UAT](private-history.md) |
| CLP-015 | The Unified Console is the built-in integration and UAT surface for clipboard sync. For the active Viewer it exposes independent `toRemote` and `toLocal` selectors for `off`, `manual`, `prompt`, and `auto`, manual sync actions, capability/permission state, pending offers, and bounded result/error status. Console choices are session-local, require explicit user action, never enter launch parameters, URLs, browser persistence, or server configuration, and exercise the same public SDK used by external consumers. | accepted | [Local rc.1 evidence](private-history.md) and [rc.3 Human UAT](private-history.md) |
| CLP-016 | The 60-second offer/API lifetime and current `toRemote` X11 selection lifetime are independent. Expiry or metadata eviction deletes offer bodies and history eligibility, while at most one bounded, memory-only gateway selection remains pasteable until another selection replaces it, an unexpired source offer is explicitly cancelled, the session generation ends, or the runtime exits. Clean clear keeps an empty X11 tombstone owner so a clipboard manager cannot replay stale content; a real application can replace it normally. This behavior is template-neutral and must pass with and without Clipman. | accepted | [Local rc.2 evidence](private-history.md) and [rc.3 Human UAT](private-history.md) |
| CLP-017 | SDK `client.clipboard.checkAccess()` reports secure-context, document-focus, user-activation, capability, and read/write permission state without reading or writing. A direct user gesture may call `requestReadAccess()` to perform and verify one real read while discarding content without decoding, returning, fingerprinting, uploading, or writing it back. No dummy or read-then-write write probe is allowed; only a real `syncToLocal()` verifies write access. Expected denial and context failures return structured state. The Unified Console exercises both public methods. | accepted | `make check`, all 68 SDK subtests, focused tests, exact rc.3 real-Chromium direct-click validation, and [Human UAT](private-history.md) |

## Client-active clipboard release train

This train was scope-locked on 2026-09-03 and now targets stable RemoteXApp `0.5.0` and SDK
`0.21.0`. It changes only the Browser SDK's local-to-remote detection timing,
the Unified Console, and downstream focus integration. Manager and gateway
protocol behavior, App Package ABI V1, templates, drivers, and the accepted
remote-to-local protocol remain unchanged. Implementation, complete automated
and local E2E, and local 1991/2991 UAT deployment are authorized; sandbox
deployment was initially excluded. Human UAT was accepted and annotated
`v0.5.0-rc.1` was published as an independently verified GitHub prerelease on
2026-09-03. The operator then authorized promotion of that exact behavior to
stable `v0.5.0` without functional changes. The normal Latest release passed
independent verification, and its exact formal archive is deployed to local
1991/2991, test-host-a 1991/2991, and test-host-c/03/07/10 production 1991. The
complete locked specification is
[`client-active-clipboard-release.md`](client-active-clipboard-release.md).

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| CLP-018 | Each `RemoteXAppClient` independently owns its clipboard configuration, input-active state, fingerprints, pending offers, prompt controller, timers, and cleanup. Clients must not share a clipboard coordinator, active-Viewer registry, fingerprint, or pending state. This prospectively supersedes only the Client/IME-refocus portion of CLP-013 after acceptance; stable 0.4.0 remains historical behavior. | accepted | [Local rc.1 evidence](private-history.md) and [Human UAT](private-history.md) |
| CLP-019 | `toRemote: "prompt"` remains configured while focus moves, but only an input-active Client may read, fingerprint, or prompt for local content. Transition to active immediately reconciles the current clipboard and starts a new offer's 60-second lifetime then; an inactive Client ignores clipboard-change, top-level focus/visibility, and captured-paste signals without updating its fingerprints. Combined signals remain debounced and focus alone never requests browser permission. | accepted | SDK focus/reconcile tests, real secure-browser rc.1 evidence, and Human UAT |
| CLP-020 | Real Viewer pointer or keyboard input and an embedding host's explicit `client.focus()` establish input activity; focus moving elsewhere, top-level blur/hiding, disconnect, and destruction pause or clear it as appropriate. Connection-completion or other background programmatic focus must not claim clipboard activity or trigger a read. Browser input focus is the authority, so no cross-Client clipboard coordinator is required. | accepted | Multi-Client focus, delayed work, background-connect, disconnect, browser tests, and Human UAT |
| CLP-021 | Loop suppression remains strictly per Client. After A accepts remote-to-local, A's successful `localWriteFingerprint` suppresses A's own local-to-remote rebound; inactive B neither reads nor records that write and may prompt for the same content after becoming active. `sourceViewerId` likewise suppresses only the originating Viewer after a local-to-remote send. No global content deduplication is permitted. | accepted | A-to-local, A-suppress, B-activate-and-offer real-browser rc.1 evidence and Human UAT |
| CLP-022 | Remote-to-local behavior remains independent of Viewer input focus: one authoritative runtime offer is broadcast to every attached Viewer, and each Viewer independently applies its configured mode, accepts, dismisses, expires, and recovers it. One Viewer's action does not consume or alter another's offer; existing lifetime, permission, format/limit, and generation rules remain unchanged. | accepted | Existing 0.4.0 fanout matrix, real rc.1 non-regression E2E, and Human UAT |
| CLP-023 | Acceptance requires SDK unit/race coverage and real secure-context multi-Client E2E for inactive suppression, activation-time checks, Firefox-to-Edge same-content transfer, A remote-to-local self-suppression followed by B local-to-remote prompting, top-level focus/visibility, paste, delayed-signal races, background connection, permissions, expiry, reconnect, and destruction. Unified Console and downstream integration must use only the public template-neutral SDK. Human UAT, deployment, and publication remain separate approvals. | accepted | Complete candidate gate, local 1991/2991 evidence, Human UAT, [stable publication](private-history.md), and [fleet deployment](private-history.md), 2026-09-03 |
| CLP-024 | The Unified Console operator and launch workspaces become a multi-window reference client: they can keep different runtimes and multiple Viewers of one runtime open concurrently, with one independent `RemoteXAppClient`, prompt controller, state, diagnostics, controls, and cleanup scope per Viewer window. Windows are independently focusable, bring-to-front, movable, resizable, minimizable, and keyboard-switchable; activation uses ordinary Client focus rather than a clipboard coordinator. Connect, reconnect, disconnect, close, runtime stop, and managed-state actions remain visibly distinct and target-scoped; closing one Viewer never implies runtime stop or disturbs another. Geometry and clipboard choices are non-persistent, the managed/runtime navigation hierarchy is retained, and kiosk routes remain single-Viewer without new authority. | accepted | Real three-Viewer same/different-runtime, target-scope, move/minimize/Ctrl+F6/close rc.1 E2E and Human UAT |

## Clipboard prompt reliability release train

CLP-025 through CLP-029 are accepted for RemoteXApp `0.5.1` and SDK
`0.21.1`. They harden only the optional Browser SDK prompt UI and its documented
embedding contract. Manager/gateway protocols, clipboard data semantics, App
Package ABI V1, templates, and drivers remain unchanged. Implementation,
complete automated/local E2E, and local 1991/2991 deployment passed;
Human UAT was accepted and annotated `v0.5.1-rc.1` was published as an
independently verified GitHub prerelease on 2026-09-03. Stable `v0.5.1`
publication and exact-artifact alignment then completed for the eight named
local and sandbox endpoints with no runtime identity or configuration drift.
The complete locked scope is in
[`clipboard-prompt-reliability-release.md`](clipboard-prompt-reliability-release.md).

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| CLP-025 | `RemoteXAppClipboardPrompts` explicitly owns a top-anchored, content-height, bounded prompt root. Ordinary non-`!important` host rules that size every direct Viewer child must not stretch a prompt across the framebuffer; stacking, approval, dismissal, expiry, focus restoration, accessibility, and clipboard semantics remain unchanged. | accepted | SDK geometry regression, [rendered local candidate evidence](private-history.md), and [Human UAT](private-history.md) |
| CLP-026 | The public integration contract permits a host to size and position the supplied Viewer container but requires SDK-created descendants to remain SDK-owned. The hardening prevents accidental CSS interference; it does not claim isolation from `!important`, hostile same-page JavaScript, DOM removal, or arbitrary mutation. Custom presentation continues to use public clipboard events instead of restyling the standard controller. | accepted | Browser SDK and downstream integration contract updated for 0.21.1; Human UAT accepted |
| CLP-027 | Acceptance requires focused SDK tests plus real-browser reproduction with a host `> * { width:100%; height:100% }` rule, proving top/content-height single and stacked prompts, bounded long text, clickable unobscured framebuffer, Yes/X accessibility, and unchanged Console/kiosk lifecycle behavior. Human UAT, deployment, and publication remain separately approved actions. | accepted | 78 SDK subtests, complete gate, isolated App catalog, post-deployment 1991/2991 real-browser evidence, Human UAT, [stable publication](private-history.md), and [alignment](private-history.md), 2026-09-03 |
| CLP-028 | Standard prompts distinguish direction through redundant high-contrast cues: local-to-remote uses an orange-red background, upward arrow, and explicit `Local → Remote` wording; remote-to-local uses blue, a downward arrow, and explicit `Remote → Local` wording. Success is briefly green, failure is dark red while retaining direction, and expiry is neutral gray. Yes/X controls, focus indication, text, contrast, and accessible names must remain clear without relying on color alone, and the more opaque bars must avoid unnecessary heavy framebuffer blur. | accepted | Unit state matrix, real Chrome two-direction rendered/hit-test evidence on local 1991/2991, and Human UAT |
| CLP-029 | After remote-to-local content is successfully written, the same Client suppresses its resulting local-to-remote rebound using a canonical account of what the browser actually committed rather than the complete remote offer. The mechanism must contain no MIME-, application-, template-, browser-, or platform-specific branch. Any allowed representation may be omitted, reduced to a successful fallback, reordered, or normalized without creating a false prompt; reconciliation is serialized with the write, authorized post-write readback is authoritative, and absence of read authority must not trigger permission solely for suppression. A genuinely different value introduced during or after the write must still prompt, and another Viewer retains its independent CLP-021 behavior. | accepted | Unit matrix, real two-Viewer Mousepad and LibreOffice rich-format E2E, post-deployment 1991/2991 E2E, and Human UAT |

## Application exit and graceful shutdown

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| EXIT-001 | A clean driver-reported application exit or desktop logout applies the existing idle action immediately. | accepted | Mousepad and XFCE live validation |
| EXIT-002 | A clean exit disconnects the viewer without automatic relaunch; a later attachment can start a new session generation. | accepted | SDK regression; XFCE generation-2 live validation |
| EXIT-003 | Manager-initiated cleanup invokes an immutable application-specific shutdown hook before terminating the session cgroup. | accepted | Mousepad/XFCE API stop and rc.6 `PrivateTmp` regression |
| EXIT-004 | Blocked, timed-out, or failed graceful shutdown preserves the session across manager restart and allows user reconnection. | accepted | Unsaved Mousepad block/reconnect/save validation, timeout regression, and managed manifest restart-adoption regression |
| EXIT-005 | Grace timeout, warning age, and optional force age are administrator-owned host policy and cannot be changed by templates or instance overrides. | accepted | Effective-policy API and live warning/force deadlines |
| EXIT-006 | Shutdown requests and delayed actions are qualified by session generation and request ID. | accepted | Restart persistence and timer guard validation |
| EXIT-007 | An explicit force, including a managed desired-stop repeated after the runtime entered `shutdown-blocked`, bypasses the hook, terminates the cgroup, and is visible in runtime status. | accepted | API/SDK contract, live Mousepad force, and blocked-to-force managed regression |
| EXIT-008 | Real applications prove native close, unsaved-document blocking, reconnect resolution, and force behavior before acceptance. | accepted | `graceful-shutdown-rc5.json` |
| EXIT-009 | A private session bus must use the per-runtime `/run/user/<uid>` socket directory so manager hooks work with `PrivateTmp=yes`. | accepted | `graceful-shutdown-rc6-private-tmp.json` |
| EXIT-010 | A status-enabled app reports ready only after its closeable window exists, and hook-internal waits finish before the manager deadline. | accepted | Driver regression and rc.7 production SDK E2E |
| EXIT-011 | A clean application exit emits one terminal SDK event, disconnects intentionally, and does not report reconnect errors or automatically relaunch. | accepted | SDK race regression and rc.7 production Alt+F4 E2E |

See [`graceful-shutdown.md`](graceful-shutdown.md) for the normative protocol.

The normative behavior, data model, lifecycle matrix, upgrade, and rollback
procedures are in
[`driver-version-lifecycle.md`](driver-version-lifecycle.md). Production proof
is in
[`driver-version-lifecycle-production.json`](private-history.md).

## Clipboard empty-content handling — closed release train

Accepted and formally published as Core `0.5.4` / SDK `0.22.0`. Local
1991/2992 retain the accepted rc.1 until separately approved alignment.
See the [release train](clipboard-empty-content-release.md) for the contract,
Human UAT and publication evidence.

| ID | Requirement | Status | Verification |
|---|---|---|---|
| CLP-030 | Omit zero-byte representations while preserving all valid supported formats and whitespace-only text. All-empty content is a no-op, never an implicit clear or successful sync. | accepted | SDK/backend matrix and [local acceptance](private-history.md) |
| CLP-031 | Nonempty HTML retains its nonempty plain-text fallback requirement. The locked missing/empty fallback policy is clear rejection without mutation, silent downgrade, implicit reread, or fabricated fallback. | accepted | HTML/plain combinations and preserved rich formats; [local acceptance](private-history.md) |
| CLP-032 | SDK, Manager and Gateway enforce consistent empty-content semantics, including direct API calls. Validate the full offer before destination mutation; real read/validation failures are not emptiness, and valid empty parts must not produce misleading EOF errors. | accepted | Direct API, late-invalid-part, truncated stream and atomicity tests; [local acceptance](private-history.md) |
| CLP-033 | Fingerprints and rebound suppression use actual normalized/written representations. Empty checks do not repeatedly prompt or emit sync success; later genuine changes and independent Viewers still work. Return `{skipped:true,reason:"empty-clipboard"}` for no-op manual calls. | accepted | Manual/prompt/auto, both directions, retry and multi-Viewer tests; [local acceptance](private-history.md) |
| CLP-034 | Acceptance covers zero-byte, whitespace, mixed formats, HTML fallback, read errors, limits, unchanged destination on failure/no-op, and genuine-change/rebound behavior through unit/API and real-browser Mousepad/LibreOffice paste/readback tests. | accepted | [Exact candidate and both local endpoints](private-history.md); [Human UAT accepted](private-history.md) |

## Clipboard prompt consistency — 0.10.0 accepted release

Current status: CLP-035–040 accepted in formal 0.10.0 / SDK 0.27.3; all eight
approved Managers are aligned. Historical candidate status entries below
are superseded by this completed release. Existing runtime pins were preserved.
See [publication](private-history.md) and
[alignment](private-history.md), including the
initial Firefox fault-injection timeout and subsequent successful repetitions.

2026-09-12 superseding acceptance: Human UAT accepted CLP-035–040 and
authorized formal Core 0.10.0 / SDK 0.27.3 publication and remaining-environment
deployment. Historical pending-UAT entries below retain the candidate timeline;
publication and alignment evidence will be recorded after those gates complete.

Status: implemented, tested and deployed as Core 0.10.0-rc.1 / SDK 0.27.0 on
local 127.0.0.1:1991/2992; Human UAT pending. See the
[locked train](clipboard-prompt-consistency-release.md). Controlled regressions
cover duplicate ownership, recovery and stale consent; the original operator
incident is not attributed to a confirmed specific event. Existing local XFCE
retains its 0.9.1 pin; use a new or explicitly upgraded runtime for UAT.

The operator retained three governing principles: follow genuine changes;
keep only the latest valid prompt per direction per Viewer (revalidate on Yes,
never silently substitute new content); and let the user choose when both sides
independently changed, including deferring auto mode in that conflict. See the
[agreed principles](clipboard-prompt-consistency-release.md#three-governing-principles--retained-by-operator-2026-09-12).

| ID | Requirement | Status | Verification |
|---|---|---|---|
| CLP-035 | Deduplicate by supported rich-content identity and event generation/revision/source; distinguish genuine changes, duplicate delivery, reconnect recovery and own-sync echoes without discarding formats or permanently suppressing legitimate later copies. | implemented | [Local candidate verification](private-history.md); Human UAT pending |
| CLP-036 | Revalidate offer applicability and relevant observed source/destination versions before Yes or auto-sync writes; do not silently overwrite independent new changes. Define stale/conflict handling and achievable browser race guarantees before implementation. | implemented | [Local candidate verification](private-history.md); Human UAT pending |
| CLP-037 | Keep only the latest valid prompt per direction per Viewer. After successful sync, clear only proven duplicate, synchronized or superseded prompts in that Viewer. Preserve independent opposite-direction changes and other Viewers; genuine two-sided changes require user choice, including in auto mode. Do not select direction by timestamps or blanket-clear the opposite direction. | implemented | [Local candidate verification](private-history.md); Human UAT pending |
| CLP-038 | Reproduce the report with payload-free event evidence and cover duplication, recovery, simultaneous copies, delayed Yes, MIME transformations, rich/empty/error cases and multi-Viewer behavior through unit/API and real-browser Console, Mousepad and LibreOffice tests. | implemented | [Local candidate verification](private-history.md); Human UAT pending |

## Clipboard sync receipt presentation — follow-up source change

CLP-039 duration amendment: successful notices default to three seconds
(`successDuration:3000`), with explicit SDK overrides preserved. This amendment
is deployed on local loopback 1991/2992 as `0.10.0-dev.20260912-clp039-3s`,
SDK `0.27.2`. Served-SDK browser timing measured 3014/3020 ms respectively;
117 SDK tests passed. Human UAT remains pending.

| ID | Requirement | Status | Verification |
|---|---|---|---|
| CLP-039 | Successful sync notices have no Yes/× buttons, retain direction and auto-dismiss, identify actual transferred formats (Plain text, Rich text HTML/RTF, PNG image), and show up to 80 Unicode code points of plain-text sample plus ellipsis. Browser fallback must describe only written formats. Render samples as text, never HTML; do not add samples to public offers, state events or diagnostics. Pending confirmations and retryable errors retain actions; empty skips must not claim success. | deployed locally; Human UAT pending | 117 SDK tests; both endpoints' two-Viewer Mousepad/LibreOffice checks, including actual successful notice assertions; [deployment](clipboard-prompt-consistency-release.md#clp-039-follow-up-local-deployment--2026-09-12) |

## Clipboard receipt content details

CLP-040 deployment: both local loopback 1991/2992 now run development build
`0.10.0-dev.20260912-clp040`, SDK `0.27.3`. All 118 SDK tests passed.
Served-SDK browser fixtures verified both directions, per-format/total bytes,
PNG dimensions and three-second removal. These fixtures stub transfer I/O;
no new application paste E2E is claimed. Human UAT remains pending.

| ID | Requirement | Status | Verification |
|---|---|---|---|
| CLP-040 | In both directions, success notices show each actually transferred representation's byte size (B/KiB/MiB), a total for multiple representations, and PNG width × height in pixels when available. Sizes mean encoded clipboard payload, not original document size or decoded image memory. Preserve the plain-text preview, three-second default and absence of action buttons. Browser fallback reports only written formats. Missing image metadata must not fail an otherwise successful sync. | deployed locally; Human UAT pending | SDK receipt/PNG/UTF-8/fallback and served-SDK browser fixture tests |

## Next release — clipboard prompt icon clarity and preview

CLP-041/042 UAT refinement: reduce the candidate's direction and action icons
by 30% (28→19.6 px and 22→15.4 px), retain button hit areas, and vertically
center the text and direction icon. Deployed locally as 0.10.1-rc.2 / SDK 0.27.5;
the linked rc.1 evidence below describes the preceding candidate. See the
release train for the rc.2 layout/deployment verification.

Status: CLP-041–043 and the sizing refinement are accepted and released in
formal Core 0.10.1 / SDK 0.27.5. All eight approved Managers are aligned;
existing runtimes retain their pins. See the
[formal verification](private-history.md).
The rc.1 evidence below records the earlier local candidate.
See [verification evidence](private-history.md).
See [next release train](next-release-train.md).

| ID | Requirement | Status | Verification |
|---|---|---|---|
| CLP-041 | Enlarge and thicken Local → Remote up-arrow and Remote → Local down-arrow icons; SVG is permitted/preferred. Retain direction labels/colors and ensure clear, unclipped presentation across narrow Viewers and browser zoom. | accepted; released 0.10.1 | Both directions, responsive layout and visual UAT |
| CLP-042 | Replace visible Yes text with a tick/check icon visually matched to dismiss X in size, weight, button geometry and alignment. Preserve approval/dismiss semantics, accessible labels/tooltips, keyboard focus/activation and in-flight states. Success receipts remain button-free with the existing three-second duration and content details. | accepted; released 0.10.1 | Shared SDK/Console/kiosk controls, accessibility and clipboard regression tests |
| CLP-043 | Both directions' pending confirmations show readable content types, encoded byte sizes and safe bounded previews: plain-text sample; PNG thumbnail/dimensions; rich text uses accompanying plain text, never rendered markup. Preview matches the offered source revision, remains Viewer-local/ephemeral, obeys permissions and resource limits, and never writes clipboard content or bypasses consent revalidation. Indicate unavailable previews, discard stale async results and release resources. | accepted; released 0.10.1 | Both directions, text/rich text/PNG/multiple formats, UTF-8 sizes, permission denial, empty/unavailable content, safe rendering, stale revisions, cleanup and real-browser pre-consent checks |

## Maintenance rule

Every feature pull request must update this register when it adds, changes,
accepts, or defers a requirement. Use a new stable ID; do not renumber old
entries. A behavior change must also update the design log and `CHANGELOG.md`.
