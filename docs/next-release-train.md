# Next release train

## In development — Core 0.14.2 managed session recovery

RTM-019–021 target safe, bounded recovery of managed user-home sessions after
the session leader exits while VNC/gateway stay up. A populated old session
component is preserved and reported as blocked; an empty old component may
relaunch only on a later Viewer attach, with durable generation and attempt
fences. SDK and App Packages are unchanged. This release does not add
resource-runaway kill policy or sandbox deployment authority. Qualification
requires source/race checks, disposable-UID real XFCE fault injection, exact
candidate E2E and local UAT before any formal GitHub release. See
[requirements](requirements.md#core-0142--bounded-managed-session-recovery) and
[design](managed-session-recovery-release.md).

Local qualification on 2026-10-02 passed `make release-ci` and the exact
`0.14.2` archive's disposable-UID XFCE systemd test, including Manager restart,
natural logout, external session stop, dead leader, Viewer relaunch, and
durable recovery counter. The real unit emptied on leader death; the
populated-cgroup preservation path was validated with a controlled Go fixture.
Human UAT and an immutable source commit/tag are still pending. No sandbox
deployment is included.

The same archive is deployed to the project-owned local Managers on loopback
1991 and 2992 for UAT. Both report 0.14.2 and healthy services; 1991's
generation-11 XFCE runtime was preserved on its old pin. Its IBus service was
already degraded before deployment, so IME UAT on that runtime is not claimed.
The existing inactive Edge 2.0.4 package has stale bytecode/seal content;
immutable App restaging refused it and no App selector was changed. See the
[local deployment evidence](../tests/evidence/v1/managed-session-recovery-0.14.2-local-deployment.json).

## Accepted — LightView Viewer-attach wakeup (LTV-013)

Stable-target Core `0.14.1` adds optional paired App Package V1 Viewer transition hooks; LightView
1.0.13 uses them to wake a hibernated engine before admitting the first Viewer
and restore the original native idle policy after the last Viewer leaves or
Manager adopts the runtime after restart. This requires a new Core release as
well as the new App Package; installing 1.0.13 on Core 0.14.0 will fail strict
manifest validation. SDK/WAOS changes are not needed. `make check`, race tests,
and the isolated 19-scenario real-browser E2E passed 2026-10-02. The exact
candidates are now deployed on local loopback 1991 and 2992; both passed real
Viewer, hibernation, resize, reconnect and idle-policy-restoration tests.
Existing 1991 XFCE stayed on generation 11 with unchanged component PIDs. See
the [local deployment evidence](../tests/evidence/v1/lightview-1.0.12-local-deployment.json).
Human UAT of the deployed RC.1 / LightView 1.0.12 was accepted on 2026-10-02,
and the operator authorized formal GitHub publication. The formal App version
is 1.0.13 because the earlier local package contained ignored Python bytecode;
the Driver behavior is unchanged. Promote stable `0.14.1` and App 1.0.13 only
after their same-commit candidate and exact-artifact gates pass. Sandbox
deployment belongs to the sandbox project.

## Closed — standalone/runit and selected-user Core train (2026-10-01)

RC.1–RC.6 were qualification builds and were not published. RC.6 passed the
target-host and Ubuntu 26.04 regression gates; the operator accepted UAT and
authorized formal stable `0.14.0` GitHub publication on 2026-10-01. Host reboot
remains unverified because it was not approved. No sandbox alignment or host
service restart is included in this publication authorization.
Annotated [v0.14.0](private-history.md)
is now the normal Latest release. The hosted same-commit candidate, local
exact-archive E2E and unchanged downloaded release asset were verified.

The operator locked **RUN-001–RUN-007 and DEP-017** after 0.13.1. The original
lock did not authorize publication; the later UAT acceptance and formal-release
request above supersede that hold. Sandbox-project deployments and grok-bot
platform X11 display/services remain outside this publication scope.

The existing Ubuntu/systemd user and central selected-user deployments remain
the default and must pass regression. The new standalone mode uses an explicit
backend choice and an installation-time selected existing Unix account, never a
client-supplied UID or root Manager. On grok-bot, the account bus is already
supervised by runit and reachable as `sandbox` at `/run/user/1001/bus`; its
reboot persistence has not been proved. The current `xfce-user-desktop` App
reserves `:1`, 5901 and 39001, conflicting with grok-bot's platform display.
The train adds administrator-controlled fixed display/RFB/gateway allocation,
without re-enabling instance/client display overrides.

Scope, lifecycle design, failure matrix, host responsibility, release gates and
rollback are [documented here](standalone-runit-release.md). Grok-bot host
preparation, deployment, runtime restart, rollback and E2E are owned by its
project. RC.6 passed exact-archive host tests, delegated-cgroup fault tests,
all eight shipped Apps and rollback rehearsal. The isolated Ubuntu 26.04
systemd QA clone passed the regression after correcting its foreign user-bus
environment and extending cold XFCE readiness. No App Package ABI or SDK API
change is intended. Boot persistence remains outside verified coverage.

## Publication in progress — Core 0.13.1 / Edge 2.0.3 (Issue #9)

RTM-018 / EDGE-006: terminal session-start failure must be durable and
generation-scoped. An unattached anonymous `stop-instance` runtime remains
inspectable for two minutes from failure, regardless of repeated Viewer
attempts or Manager restarts; then Core force-cleans it. A private, mode-0600
summary store is capped at 100 entries; records older than seven days are
pruned on the next failure write. Healthy Edge keeps its existing six-hour
detached policy; managed runtimes retain their existing
recovery/stop rules. Edge Driver 2.0.3 reports visible-window versus CDP
readiness failure before Core's deadline. The original sandbox00 trigger is
unknown because its logs were removed; this train does not assert an OOM cause.
Implementation and local verification were authorized 2026-09-29. The operator
approved formal publication and a sandbox00 **2991 test-only** handoff on
2026-09-29. Production 1991 is outside this authorization. The sandbox project
owns any sandbox installation, selector change, or runtime restart.
`make check`, repeated focused race tests, and the isolated shipped-App E2E
passed. The E2E covered actual Edge visible/CDP readiness, adoption, profile
reuse and cleanup. Failed Edge Driver window/CDP paths were controlled in
isolated tests; full Manager cleanup after failed launch was fault-injected in
Go, not yet exercised through a real failed Edge launch. The operator reported
UAT passed on 2026-09-29; this records acceptance of the local candidate, not
a claim that 1991/2992 were deployed. Publication must still pass the exact
candidate gates.
See [requirements](requirements.md) and [design decision](design-log.md).

## Closed — LightView App Package 1.0.11 hibernation wakeup

Formal [lightview-v1.0.11](private-history.md)
was published 2026-09-29 from annotated tag at `752b4ca15de2`. Hosted
Verify passed, and fresh GitHub assets match the locally qualified archive
byte-for-byte. This App-only train is closed; Core `v0.13.0` remains Latest.
Publication did not deploy or restart any environment. See
[publication evidence](../tests/evidence/v1/lightview-1.0.11-publication.json).

Formal GitHub App-only publication authorized 2026-09-29 by the operator. This
supersedes the earlier publication hold below. Publish only the byte-identical
locally qualified archive; do not claim a separate interactive UAT result.
No sandbox deployment or additional runtime restart is authorized.

Added 2026-09-29 as **LTV-012**. Lightview 0.1.10 may hibernate its WebKit
engine while retaining the main PID, window and private socket. App 1.0.10
rejects `openUrl` when native status is `suspended`, before native `open` can
wake the engine. The operator authorized the App-only fix and deployment to
local 1991/2992 for UAT. Formal GitHub publication and sandbox rollout are
separate decisions.

Implemented and deployed to both local endpoints 2026-09-29. The same clean
App archive passed 18 isolated real-browser scenarios, including native
hibernation and HTTP action wakeup, plus served-Viewer wakeup checks on 1991
and 2992. The 1991 runtime is ready for human UAT; the 2992 test runtime was
stopped. No formal GitHub release or sandbox rollout has been performed. See
[local UAT evidence](../tests/evidence/v1/lightview-1.0.11-local-uat.json).

Allow `ready` and `suspended` as pre-dispatch states after validating the same
owned socket and PID. Keep full ready-field checks for the already-ready path.
After native `open`, tolerate the bounded `suspended`/`recovering` transition,
then require a valid ready status, completed load and the existing URL/result
contract. Reject failed states, invalid status, unsafe URLs and identity changes.
Do not wake on read-only status checks. Preserve the App's profile, six-hour
vacancy policy, low-memory launch and user-selected memory protection. Qualify
the exact immutable App archive with real browser hibernation and Manager HTTP
actions before handing it to UAT. See [requirement](requirements.md#release-train-lightview-hibernation-wakeup)
and [design](lightview-app-package-release.md#hibernation-wakeup-ltv-012).

## Closed — LightView App Package 1.0.10 published

Formal [lightview-v1.0.10](private-history.md)
was published 2026-09-24 from `51c1d46b6a73`. Hosted Verify and clean-source
checks passed; downloaded assets match the exact locally qualified archive.
LTV-011 is accepted and this train is closed. Core 0.13.0 / SDK 0.29.1 stay
unchanged, and Core retains GitHub Latest. No additional deployment or runtime
restart occurred. See [publication evidence](../tests/evidence/v1/lightview-1.0.10-publication.json).

### Publication authorization history

2026-09-24: the operator requested formal GitHub publication after the local
handoff. Publish the qualified App archive unchanged under `lightview-v1.0.10`,
not a prerelease; keep Core `v0.13.0` as Latest. This supersedes the earlier
publication restriction below. No additional deployment or runtime restart is
authorized. Record acceptance as authorization to promote the tested candidate,
not a separate claim of interactive human UAT. Hosted Verify and public-download
identity verification are required before closing this train.

### Locked implementation and local qualification history

Added 2026-09-24: **LTV-011**, fixing
[Issue #8](private-history.md). The operator confirmed
that disabling Lightview memory protection is a supported user choice, not an
upstream fault to investigate or automatically correct. Target a new immutable
`lightview@1.0.10`; Core and SDK remain unchanged. Locked 2026-09-24 by the
operator for implementation, comprehensive verification and local loopback
1991/2992 UAT deployment. Use immutable candidate `1.0.10`; formal GitHub
publication and sandbox deployment are not authorized. Preserve existing active
runtime pins unless their interruption is separately approved.

- Separate control identity/protocol checks, navigation readiness and startup
  defaults. Disabled memory protection or a user-selected termination threshold
  must not block startup/readiness, `openUrl`, or native `quit`.
- Keep `--low-memory` as the template launch default. Do not silently re-enable
  protection or reset a user's threshold. Preserve owned private sockets, PID
  identity, bounded protocol, URL validation and action-result validation.
- Navigation requires a ready engine; graceful quit must not require navigation
  readiness. Retain host shutdown deadlines/enforcement. Memory protection being
  disabled alone must not cause `shutdown-blocked`.
- Review manifest/status fields so a fixed `3072` value is not presented as a
  live enforced threshold after the user changes or disables it. Distinguish
  launch defaults from observed state; do not add a Manager polling subsystem.
- Cover protection on/off, alternate thresholds, toggling after ready, startup,
  repeated `openUrl`, stop/restart/upgrade, and unchanged socket/PID/URL security
  failures. Reproduce the original pre-dispatch rejection first; prove it is
  absent after the fix. Validate the exact package locally before publication.

Follow-up evidence from the [2026-09-24 issue comment](private-history.md)
strengthens the acceptance plan, not the selected behavior:

- The reporter restored the original seal-valid package and obtained HTTP 200
  after protection became enabled. This corroborates the runtime-state trigger;
  it does not demonstrate that a modified Driver works or that WAOS needs changes.
- Build/install a fresh versioned candidate through the normal archive/checksum/
  content-seal workflow. Never patch or re-seal an installed release in place.
  Preserve rejection of tampered packages (`409 invalid-package`) and invalid
  enabled packages at Manager startup; exclude inspection-generated `__pycache__`.
- Add a deterministic owned-socket state double. With the same valid PID,
  protocol, ready engine and URL, exercise protection off (configured 3072,
  effective 0), on (3072), and alternate thresholds. Record native commands:
  the old package rejects before `open`; the candidate dispatches successfully
  in each legal state. Run through the real Manager action path as well as
  focused Driver tests, then confirm behavior with real Lightview.
- Test switching off/on while ready and distinguish the resulting transient
  engine recovery from the settled disabled state. Do not label an intentional
  protection-off state as degraded, force-enable it, or require an upstream fix.

Do not require a Lightview executable upgrade as the workaround, restore version
pinning, change WAOS, or redesign the generic Manager action-error ABI in this
App-only train. Genuine transport/action failures retain their existing contract;
this fix removes the invalid memory-policy rejection rather than claiming all
`outcome-unknown` cases are resolved. Sandbox deployment belongs to its project.
See [requirements](requirements.md#release-train-lightview-optional-memory-protection)
and [design](lightview-app-package-release.md#optional-memory-protection-ltv-011).

Implemented and deployed locally 2026-09-24 using unpublished App `1.0.10`.
Both catalogs and real Viewer/control/memory-policy smoke checks passed. The
operator separately approved upgrade/restart of the existing 1991 LightView;
it is ready at generation 3. XFCE generation 8, Core and SDK are unchanged.
At that handoff, human UAT and formal publication were pending; the subsequent
publication authorization above supersedes that gate.
Two complete 17-scenario real-browser runs, Driver/security tests, sealed-package
HTTP action tests, full check/race/coverage/vulnerability gates and both deployed
endpoints passed. See [candidate and local evidence](../tests/evidence/v1/lightview-1.0.10-local-uat.json),
including test-harness corrections and the local WebKit sandbox limitation.

## Closed — LightView App Package 1.0.9 version-independent launch

LTV-010 was authorized and locked 2026-09-18 for implementation, testing and
formal GitHub App-only publication. Remove the executable `--version` gate;
retain every existing protocol, identity, readiness and low-memory check.
Core `0.13.0`, SDK `0.29.1`, other Apps and deployments are out of scope.
Regression must prove compatible version banners do not block the launcher,
missing capabilities still fail, and the exact App archive passes isolated
real-LightView Viewer/control/profile/lifecycle/recovery acceptance. Publish
`lightview-v1.0.9` with archive and checksum, leaving Core v0.13.0 as Latest.
The existing baseline is 0.1.8; qualify the new archive with the separately
installed formal 0.1.9 and record its exact identity. Do not claim universal
future compatibility. No production/sandbox deployment is authorized.

Qualification complete: formal upstream 0.1.9 passed all 15 isolated
exact-package scenarios; source/race/coverage/vulnerability gates passed.
See [candidate evidence](../tests/evidence/v1/lightview-1.0.9-candidate.json).
Formal [lightview-v1.0.9](private-history.md)
is published; hosted Verify passed, downloaded assets match the tested archive,
and Core v0.13.0 remains Latest. See
[publication evidence](../tests/evidence/v1/lightview-1.0.9-publication.json).
This App-only train is closed; no endpoint deployment was performed.

## Closed — 0.13.0 runtime idle lease and SDK Coordinator

Human UAT accepted 2026-09-18; formal **0.13.0 / SDK 0.29.1** is
[published](private-history.md).
RC.3 behavior was promoted without functional changes. Hosted gates and every
exact-artifact live gate passed; fresh public download matches the candidate.
See [publication evidence](../tests/evidence/v1/runtime-coordinator-0.13.0-publication.json).
Publication itself did not deploy endpoints. A subsequent local-only deployment
selected stable on 1991/2992 with [acceptance exceptions](../tests/evidence/v1/runtime-coordinator-0.13.0-local-deployment.json).
This train is closed.
The following dated candidate records are historical, not pending release gates.

Follow-up scope approved 2026-09-18: **RTC-007** adds the read-only
Console/kiosk Coordinator panel and SDK `getDiagnostics()` API. Implemented
and deployed as Core 0.13.0-rc.3 / SDK 0.29.1 to local 1991/2992 for UAT.
The RC.2 evidence below covers the original
candidate, not this panel. RC.3 uses a new immutable identity; the RC.2
artifact and rollback directories were not overwritten.
Both served-kiosk panel/keepalive gates passed; see
[RC.3 deployment evidence](../tests/evidence/v1/coordinator-panel-0.13.0-rc.3-local-deployment.json).
Human UAT and formal publication verification are complete.

RTC-004 downstream documentation is in the [WAOS migration guide](waos-runtime-coordinator-migration.md).
This is a provider handoff; WAOS implementation and rendered acceptance are
separate downstream work, not completed by provider testing or local deployment.

Added 2026-09-18. Requirements **IDL-001–004 and RTC-001–004** are selected
for Core **0.13.0-rc.2 / SDK 0.29.0**. Locked 2026-09-18 by operator request
for implementation, testing and local loopback 1991/2992 UAT deployment.
App versions are unchanged; human UAT and GitHub publication remain pending.
RC.2 replaces the unpublished local RC.1 candidate after fresh Driver-status
validation was added to renewal. The locked feature scope is unchanged.

Implemented and deployed to both local endpoints for UAT on 2026-09-18.
All source gates, the eight-App/32-scenario isolated suite and serial local
Viewer/IME/clipboard/lease acceptance passed. Existing desktop pins/generation
were preserved. See [candidate evidence](../tests/evidence/v1/idle-lease-0.13.0-rc.2-candidate.json)
and [local deployment evidence](../tests/evidence/v1/idle-lease-0.13.0-rc.2-local-deployment.json).
Human UAT has not been claimed; no GitHub publication or sandbox deployment.

Add an explicit runtime idle-lease API and optional
`RemoteXAppCoordinator` for one server, multiple Viewers and same-origin Tabs.
Coordinate runtime status, generation and opt-in keepalive independently of
RFB attachment. Hidden/disconnected Viewers may retain an explicit keepalive
interest; releasing one interest must not affect another. Preserve existing
standalone SDK use and Viewer-local IME/clipboard ownership. No template or
Driver-specific keepalive implementation is required.

WAOS uses one server in this train. Internally namespace runtime records by
server identity and login scope, but defer actual multi-server orchestration,
audio integration and reliable background-host ownership to
[release pending](release-pending.md). Audio will be server/user scoped, not
runtime scoped.

The locked policy retains silent Tab interests for five minutes, with two-second
presence messages and six-second leader eligibility. Unsupported cross-Tab
messaging falls back explicitly to local mode. Renew at timeout/3, capped at
five minutes, accounting for response latency. The HTTP/SDK contract is in the
linked design. Acceptance must cover timer races,
managed/anonymous policy, restart/upgrade/generation changes, shared Tab
ownership, real background freeze/resume, standalone SDK regression and every
shipped App's applicable lifecycle. See the
[requirements, design and test plan](runtime-coordinator-release.md) and
[stable requirement register](requirements.md#runtime-idle-lease-and-sdk-coordinator--planned-2026-09-18).

## Closed — LightView App Package 1.0.8 published

Added and locked 2026-09-18 as **LTV-009**. Create a new immutable
`lightview@1.0.8`, accepting exactly formal
[Lightview v0.1.8](https://github.com/woodegg/lightview/releases/tag/v0.1.8).
Do not modify the published 1.0.7 package or accept a moving version range.
Core `0.12.2`, SDK `0.28.0`, App Package ABI V1, template identity and public
Manager API remain unchanged.

Upstream 0.1.8 supervises replaceable WebKit workers behind a stable LightView
main process, GTK window, profile and Unix socket. Mandatory `--low-memory`
keeps its 384 MiB pressure target and adds a 3072 MiB last-resort threshold per
WebKit process. Recovery discards page-bound state, opens `about:blank`, retains
the last committed URI for an agent decision, and never automatically replays
state-changing automation. Version, reset, mode and telemetry commands remain
trusted same-UID socket capabilities; `openUrl` stays the only public Manager
action.

Acceptance requires exact upstream provenance and artifact identity,
fail-closed Driver policy, deterministic packaging, real soft/hard reset with
stable PID/socket/profile, the complete Viewer/input/clipboard/control/
lifecycle suite, upstream integration tests, source/race/vulnerability gates,
and fresh-download verification. The operator authorized formal GitHub
publication after those gates. Publication does not authorize test or sandbox
deployment; sandbox rollout belongs to the sandbox project.

Accepted 2026-09-18 for immediate formal GitHub publication. The formal
upstream archive SHA-256 is
`6f0e1914857e6ce71dbf82ba0da33bd1cb04352a0c9be72b1d10fbc2f5619bae`;
its LightView binary SHA-256 is
`0923e2b920e5e239166b35bb237377c98895278c039bd544581bb58d722d8461`,
and it reports Lightview 0.1.8 with WebKitGTK 2.52.6. The deterministic App
archive, contract checks, 15-scenario isolated RemoteXApp E2E, Go/SDK source,
race, coverage and vulnerability gates passed. All nine upstream integrations
passed after the download assertion waited for upstream's own
`downloads_active=0`; the released test's file-exists-only assertion was
independently reproduced as a timing race and was not treated as product
failure. Publish only `lightview-1.0.8.tar.gz` and its checksum under annotated
tag `lightview-v1.0.8`. No endpoint deployment is authorized.

Formal publication completed on 2026-09-18. Annotated tag
[`lightview-v1.0.8`](private-history.md)
peels to accepted source commit `9e92c5d66a63`. The release is neither draft
nor prerelease and contains only the deterministic archive and checksum. A
fresh download is byte-identical to the tested candidate, passes its checksum,
and reports App Package ABI V1 with `lightview@1.0.8`. Core `v0.12.2` remains
GitHub Latest. Publication did not deploy or upgrade an endpoint.

## Closed — LightView App Package 1.0.7 published

Added 2026-09-17 as **LTV-008**. Create a new immutable
`lightview@1.0.7`; do not modify or broaden the published 1.0.6 package. The
Driver accepts exactly formal
[Lightview v0.1.7](https://github.com/woodegg/lightview/releases/tag/v0.1.7)
and rejects 0.1.6 and unknown versions.

Upstream 0.1.7 keeps ordinary website images enabled in mandatory low-memory
mode and adds automatic, prompt-free downloads to the runtime user's standard
Downloads directory. Existing files receive a numeric suffix. This does not
create a generic download Manager action or expand the private socket trust
boundary. Core and SDK remain unchanged.

Acceptance requires exact upstream tag/archive/binary verification, package
contract and deterministic packaging, the complete isolated real
Viewer/control/profile/restart/crash/vacancy suite, and focused image/download
checks. Deployment is limited to the RemoteXApp test environment for human
UAT; GitHub publication is a later approval. All sandbox deployment and
runtime upgrade work belongs to the sandbox project.

Accepted 2026-09-17 for immediate formal GitHub publication. The exact upstream
0.1.7 archive and installed test binary match their recorded hashes; complete
source, race, vulnerability, deterministic-package, 14-scenario RemoteXApp E2E
and upstream seven-test integration gates passed. The operator explicitly
authorized publication without a separate interactive UI-UAT claim. Publish
only `lightview-1.0.7.tar.gz` and its checksum under annotated tag
`lightview-v1.0.7`. No endpoint deployment is authorized here.

Formal publication completed on 2026-09-17. Annotated tag
[`lightview-v1.0.7`](private-history.md)
peels to accepted source commit `ba0f5e53e617`. Freshly downloaded archive and
checksum match the tested deterministic bytes, and the release contains no
other assets. It is neither draft nor prerelease. Core `v0.12.2` remains
GitHub Latest. No endpoint was deployed or upgraded.

## Closed — Edge 2.0.2 and LightView 1.0.6 published

Added 2026-09-16. Scope is **EDGE-005** and **LTV-007**. Both changes are App
Package-only; Core, SDK and Manager APIs do not change.

Locked 2026-09-16 for implementation, complete local validation and deployment
to loopback 1991/2992 for human UAT. Targets are `edge@2.0.2` and
`lightview@1.0.6` with host Lightview 0.1.6. Publication and every sandbox
deployment remain outside this authorization.

Human UAT was accepted on 2026-09-17 and formal GitHub publication of the two
independent App Packages was authorized. Publish annotated tags
`edge-v2.0.2` and `lightview-v1.0.6` with only their exact accepted archive and
checksum assets. This approval does not authorize a Core release or any
endpoint deployment.

Publication completed on 2026-09-17. Annotated tags `edge-v2.0.2` and
`lightview-v1.0.6` both peel to accepted source commit `360b3dfe0969`.
Downloaded archives are byte-identical to the local UAT candidates and their
published checksum files pass. Both releases are formal, while Core `v0.12.2`
remains GitHub Latest. No endpoint deployment was performed by publication.

Local candidate status (2026-09-16): deployed to loopback 1991 and 2992 for
human UAT. The deterministic archives are Edge 2.0.2
`aa0e33cb60db69c211582a52b702b50dbcad4397a274ff969996a713895e84f7`
and LightView 1.0.6
`bc424aabdf8484734e4f35c75ff00345268343c237eb9f093724bd79e5d3f381`.
Both environments returned ready descriptors and completed package-owned
`openUrl`. The Edge candidate additionally recovered a deliberately seeded
foreign-host singleton trio with a full four-record quarantine, rotated only
the oldest validated record, reached CDP readiness, and shut down cleanly.
Existing unrelated runtimes were preserved across the Manager restart.

### EDGE-005 — persistent-profile stale-lock recovery

Enhance the
Edge Driver so a persistent shared profile can recover after an abnormal exit,
container migration, snapshot restore or copied HOME leaves Chromium
`SingletonLock`, `SingletonSocket` and `SingletonCookie` links behind. Core,
SDK, Manager APIs and the six-hour detached lifecycle do not change.

The Driver must fail closed unless it can prove the lock is stale. Before
launch it inspects the recorded hostname/PID, socket target and processes using
the exact `--user-data-dir`. A live matching local process or reachable socket
means the profile is in use and startup must return an explicit error. Only
when the PID is absent or identity-mismatched, the socket is absent or
unreachable, and no process uses the profile may the Driver atomically move the
three singleton entries into a private bounded quarantine. It must never delete
the profile or unrelated files. Normal shutdown first closes Edge, then applies
the existing bounded enforcement; only after the complete owned process tree is
gone may it quarantine session-owned stale singleton entries. Retention keeps
the newest four records by removing only the oldest structurally validated
Driver-owned record; unknown or tampered quarantine content fails closed.

Acceptance requires package contract tests and real Edge E2E for clean launch,
normal shutdown, crash residue, Manager restart, container reboot-equivalent,
foreign-host locks, missing/partial links, PID reuse with mismatched command,
live local ownership and a reachable socket. Recovery must preserve cookies,
profile data and CDP readiness, while unsafe cases must leave every lock and
profile byte unchanged. The sandbox00 incident is diagnostic evidence only;
the permanent Driver fix must pass local acceptance before human UAT.

### LTV-007 — catch up to the latest formal Lightview release

At train lock, query `woodegg/lightview` for its latest non-draft,
non-prerelease GitHub release, review the complete change set and pin that exact
tag and verified public artifact. The current resolved target is
[Lightview v0.1.6](https://github.com/woodegg/lightview/releases/tag/v0.1.6),
published 2026-09-17. Do not use a moving `latest` URL at build or runtime and
do not accept an open-ended version range: a newer release becomes a separate
reviewed catch-up.

Advance the independent RemoteXApp package to `lightview@1.0.6`, reconcile its
locked low-memory behavior with upstream media support, pin Lightview 0.1.6,
and provision the WebKitGTK/GStreamer runtime required for real playback. Verify
the public Lightview checksum and provenance, deterministic App archive, clean
launch, Viewer/input/clipboard, native status and `openUrl`, persistent profile,
Manager adoption, crash/restart cleanup, six-hour vacancy equivalent, normal
web navigation and sustained media playback. Test local 1991/2992 first. Human
UAT, formal App publication and every sandbox deployment remain separately
gated.

## Closed — LightView App Package 1.0.0 published

Added 2026-09-16. Scope is **LTV-001–006**: add `lightview` as an independent
App Package modeled on the accepted Edge/Firefox shared-browser policy. It is a
singleton with persistent profile `default`, starts its session on first attach,
and stops the complete runtime after six detached hours. Its dynamic Viewer is
1280×720, depth 16, 5 FPS, with client resize enabled. Every launch must include
LightView's `--low-memory` mode; it is not an instance override.

LightView is controlled through its native private Unix stream socket, not CDP,
WebDriver BiDi or a Manager-allocated TCP port. The Driver selects a socket below
the private runtime directory, proves a visible `lightview` window and a successful
`status` exchange whose PID matches the launched browser, then publishes a
bounded private application descriptor through the existing CONN-001 contract:

```json
{
  "protocol": "lightview-json-v1",
  "transport": "unix",
  "socketPath": "/run/user/1000/remotexappd/<runtime>/lightview/control.sock"
}
```

`getConnections()` and the existing SDK return that descriptor only for the
current ready generation. RemoteXApp does not proxy the socket or add a
LightView-specific Manager/SDK branch. A trusted local same-UID Agent connects
directly; the socket stays in a mode-0700 directory and LightView enforces Unix
peer UID. The package exposes only a bounded `openUrl` action through the public
Manager action API; raw `eval`, page DOM and signed-in browser control remain a
trusted-local-Agent capability obtained from the connection descriptor.

Locked 2026-09-16 for implementation, production-quality validation and
package-only deployment to local loopback 1991 and 2992 for human UAT. Core
stays `0.12.2`, SDK stays `0.28.0`, and the new App version is `1.0.0`.
Publication, sandbox deployment and unrelated runtime replacement remain out of
scope. See the [requirements, design and acceptance plan](lightview-app-package-release.md).

Implementation and production gates passed on 2026-09-16. The same immutable
App archive is active on loopback 1991 and 2992; real deployed Viewer, resize,
Unicode input, private connection metadata and `openUrl` checks passed. Existing
1991 XFCE runtime identity, generation, processes and manifest were preserved.
Human UAT passed on 2026-09-16 and the operator authorized formal independent
App publication. Publish annotated `lightview-v1.0.0` with only the accepted
deterministic archive and checksum; do not move `v0.12.2`, replace RemoteXApp
Latest, deploy a sandbox, or change Core/SDK. See the
[local evidence](../tests/evidence/v1/lightview-1.0.0-local-uat.json) and its
explicit local WebKit sandbox qualification.

Formal [LightView App Package 1.0.0](private-history.md)
is published from annotated tag `lightview-v1.0.0` at `422cb0a2c12d`. The two
public assets were downloaded and verified; the archive is byte-identical to
the UAT candidate with SHA-256 `ee38e81d…d0d07`. RemoteXApp Latest remains
Core `v0.12.2`. This train is closed. The formal package and its exact supported
Lightview 0.1.0 dependency were subsequently deployed to local 1991/2992 and
sandbox00/01 production 1991. Cross-target Viewer, native control, action,
cleanup and adoption checks passed. Sandbox00 2991 remained unchanged and no
sandbox00 reboot occurred. See the
[publication](../tests/evidence/v1/lightview-1.0.0-publication.json) and
[deployment](../tests/evidence/v1/lightview-1.0.0-local-sandbox00-sandbox01-alignment.json)
evidence.

## Published — stable 0.12.2; target reboot acceptance pending

2026-09-14: formal GitHub Latest [v0.12.2](private-history.md)
at `c1cecabe076e`, SDK 0.28.0, includes BR-001–006. Hosted/local gates,
byte-identical archives, all eight exact-archive E2E suites and sandbox00
seven-App Manager/runtime-only checks passed. Production 1991 is restored;
CloudDrive errors no longer prevent startup. Published assets were downloaded
and verified. See [evidence and qualifications](../tests/evidence/v1/boot-recovery-0.12.2-publication.json).

BR-005 final-container-reboot acceptance remains open pending new explicit
approval. No reboot after that restriction; no CloudDrive functional tests,
new human UAT or native 26.04 certification is claimed. 2991 remains 0.11.0;
other endpoints and gateway are unchanged. Earlier locked/outage entries below
are historical. Publication is complete; the separately gated reboot test is not.

## Locked — 0.12.2

Latest operator restriction: no sandbox00 container reboot without new explicit
human approval. Final-byte reboot acceptance remains pending; local fixtures
and Manager-only checks do not substitute for it. The requested storage fix
and publication continue with that limitation explicitly recorded.

Operator added BR-006 and requested publication: repair nonfatal document-root
availability and deferred managed-document validation. The earlier candidate
below is superseded; new focused, clean-candidate and exact-archive gates are
required. Real CloudDrive testing remains excluded during maintenance.

Current status, 2026-09-14: final clean hosted/local gates and eight exact-archive
local E2E suites passed. Final sandbox00 activation/reboot tests are on hold:
CloudDrive maintenance prevents configured document-root validation at startup.
Production 1991 is inactive after stopping failed-start retries; 2991 remains
on 0.11.0, WAOS is restored, configuration is unchanged. No 0.12.2 publication.
See [maintenance hold and recovery prerequisites](boot-recovery-release.md#maintenance-hold--2026-09-14).

2026-09-14: operator authorized the reboot recovery fix, new release and full
sandbox00 restart testing. BR-001–005 implement previously deferred U26-06;
SDK/App versions are unchanged. See [scope, design and gates](boot-recovery-release.md).
Run local checks and exact-archive E2E, then sandbox00 production 1991 cutover
and real reboot validation before formal publication. No other deployment,
2991 upgrade or force-discard authority is implied. Prior trains below are history.

## Closed — stable 0.12.1 published

2026-09-14: operator UAT accepted; formal GitHub Latest
[`v0.12.1`](private-history.md) is published
at `0300acdfd003`, SDK `0.28.0`, Mousepad `4.0.1`. Hosted and independent local
archives are byte-identical; seven exact-archive E2E suites and eight Mousepad
checks passed. Published bytes were downloaded and independently verified.
See [publication evidence and failed-attempt dispositions](../tests/evidence/v1/ubuntu-host-compatibility-0.12.1-publication.json).
The bounded U26 repair scope is closed with explicit native 26.04/Qt6/full-host
qualifications. Those unexecuted platform tests remain follow-up work; U26-06/09
are deferred. No endpoint deployment, runtime replacement or workaround removal.
The publication-in-progress and pending-UAT sections below are historical.

## UAT accepted — stable 0.12.1 publication in progress

2026-09-14: operator accepted the candidate and explicitly requested a formal
version, not an RC. Promote the accepted U26 repair to Core `0.12.1`, SDK
`0.28.0`, Mousepad `4.0.1`, with no functional change. Commit only this train;
run the clean hosted candidate and exact-archive local E2E before an annotated
`v0.12.1` tag publishes those same bytes. See
[operator acceptance and remaining platform limits](../tests/evidence/v1/ubuntu-host-compatibility-0.12.1-uat.json).
The unexecuted clean 26.04/Qt6/full-host gates remain documented, not retroactively
passed. No deployment, existing runtime restart or workaround removal.
Earlier locked/pending-UAT entries below are historical.

## Locked — 0.12.1-rc.1 development, 2026-09-14

Operator approved the reviewed Ubuntu 26.04 repair proposal and locked this
train for development and testing. Target Core `0.12.1-rc.1`, Mousepad App
`4.0.1`, SDK `0.28.0` unchanged. See
[scope, design and gates](ubuntu-host-compatibility-release.md) and the
[durable U26 register](requirements.md#ubuntu-host-compatibility--locked-2026-09-14).

Include U26-01–04, bounded stage diagnostics from U26-05, and documentation-only
clarifications from U26-07/08. Preserve U26-06 failure/reboot policy; defer new
recovery behavior, structured error APIs, health dashboards and U26-09 rename.
No deployment, existing runtime restart/upgrade, commit/push, publication or
workaround retirement is authorized. Test only disposable resources; no live
sandbox01/00 or production-gateway experiments. Human UAT remains pending.
The incoming tray and unrelated sandbox/audio drafts are review inputs, not
automatically included in the release.

2026-09-14 development update: implementation and local gates passed, including
280 seven-App dynamic checkpoints / 1,960 HTTP assertions and eight Mousepad
upgrade/class/input checks. The initial status-revision regression was repaired
and its failed run retained. Fresh 24.04/26.04 and broader clean exact-archive
acceptance remain pending; this train is **not closed or UAT-accepted**.
See [evidence and limitations](../tests/evidence/v1/ubuntu-host-compatibility-0.12.1-rc.1-development.json).

## Previous train: Core-owned session services

## Closed — stable 0.12.0 published

2026-09-14: GitHub Latest is stable
[`v0.12.0`](private-history.md), commit
`3037ca136f58`, SDK `0.28.0`. Hosted and independent local builds are
byte-identical; all seven exact-archive E2E suites and the separate stopped
cutover rehearsal passed. Downloaded release bytes match that tested candidate.
SVC-001–010 are accepted and this train is closed. See
[publication evidence](../tests/evidence/v1/core-session-services-0.12.0-publication.json).
No deployment alignment: local loopback 1991/2992 remain on accepted rc.2;
sandboxes and gateways are unchanged.

### Stable promotion authorization

2026-09-14: operator accepted the local `0.12.0-rc.2` candidate and requested a
formal GitHub release. Promote to stable `0.12.0`, retaining SDK `0.28.0` and all
App versions; no functional change. Prepare a clean committed/hosted candidate,
run its exact-archive E2E and publish those unchanged bytes with an annotated
tag. See [acceptance/provenance](../tests/evidence/v1/core-session-services-0.12.0-uat.json).
No deployment alignment is included; both local endpoints remain on rc.2 and
sandboxes stay unchanged. The prior handoff/failed-gate records below are history.

### Previous local rc.2 handoff

2026-09-14: SVC-F01–09 repairs passed 361 dynamic checkpoints and 2,235 recorded
HTTP assertions, real seven-App/Viewer and control/document E2E, cutover/P16,
release-ci and nightly gates (20 shuffled Go/Node runs plus three fuzz targets).
Both `127.0.0.1:1991` and `127.0.0.1:2992` now run the verified installable
`0.12.0-rc.2` working-tree archive; SDK stays `0.28.0`. Manager updates preserved
the desktop's pin first; a separate graceful upgrade applied rc.2 to its same
runtime ID, generation 3. Configuration, HOME/account bus and test Console's
disabled policy remain. Both served-Viewer post-deployment gates passed.
See [current evidence](../tests/evidence/v1/core-session-services-0.12.0-rc.2-local.json).
No human UAT acceptance, sandbox deployment, commit/push or publication.

Completion audit also closed the explicit XFCE saved-session test gap: actual
saved command/window/document restoration, current-generation single input
services and served-Viewer input across Manager restart passed. See
[repeatability and failure dispositions](../tests/evidence/v1/core-session-services-0.12.0-rc.2-xfce-saved-session.json).
No additional production code or deployment change; human UAT remains pending.

Additional verification requested 2026-09-13: expand from shared fault fixtures
to per-App dynamic-state/API coverage, including restart/upgrade concurrency
and service-loss recovery. This expanded run has finished with failures; do not infer
exhaustive per-template state coverage from the earlier seven-App suite passes.
See [test scope and boundaries](../tests/session-services/README.md).
The original rc.1 expanded gate **failed** with reproduced lifecycle findings; see
[SVC-F01–09 and repaired gates](session-services-dynamic-validation.md).
The rc.2 repair supersedes that failed implementation, not its historical evidence.
Formal promotion still requires human UAT and separate publication approval.

Initial SVC-001–010 implementation and verification reached local deployment;
the expanded gate required the rc.2 fixes above. At that initial handoff both
`127.0.0.1:1991` and `127.0.0.1:2992` ran the same `0.12.0-rc.1` working-tree
UAT archive; SDK remains `0.28.0`. The real desktop stopped gracefully and was
recreated on the new architecture. Persistent HOME/configuration intent and
the test Console's disabled policy are preserved. No sandbox deployment or
GitHub publication. See [evidence](../tests/evidence/v1/core-session-services-0.12.0-rc.1-local.json)
and [UAT handoff](session-services-release.md#verification-and-local-uat-handoff--2026-09-13).

2026-09-13: operator locked SVC-001–010 for Core ownership of session D-Bus,
IBus and Unicode lifecycle. Core candidate `0.12.0-rc.1`; SDK `0.28.0` remains
unchanged. All seven App Packages migrate together. See
[requirements and design](session-services-release.md).

Retain one existing session unit with a pinned Core supervisor. Preserve
runMode, application environment/control, graceful/forced shutdown, Manager
adoption and pins within the new architecture. All seven Drivers use one
mandatory Core-owned launch contract. Public SDK/transport behavior is not
redesigned. Operator explicitly removed legacy internal compatibility from
scope: stop old runtimes, preserve data/configuration intent, switch the complete
Core/package set, and launch new runtimes. No dual launch path, old-runtime
adoption, or zero-interruption promise. See the design's clean-cutover procedure.

**bwrap is explicitly excluded**, including sandbox/namespace/permission/network
isolation work and associated prerequisites/tests. Audio, Docker, per-helper
systemd units and automatic service hot replacement are also excluded.
Development, comprehensive local tests and clean-cutover deployment to
`127.0.0.1:1991` and `127.0.0.1:2992` are authorized. Preserve profiles,
documents, configuration and borrowed account services. A blocked graceful
stop requires separate force approval. No sandbox deployment or publication.
Human UAT is pending; see the design for the locked private contracts and gates.

## Previous train: 0.11.0 connection readiness mask

## Closed — stable 0.11.0 published and aligned

Stable `v0.11.0`, commit `73c8a6f75a2c`, SDK `0.28.0`, is GitHub Latest.
All eight approved endpoints run its verified formal archive. Hosted and
independent local gates passed; all six exact-archive E2E suites passed on the
first run, followed by formal served-browser mask and clipboard tests.
See [alignment evidence](../tests/evidence/v1/connection-mask-0.11.0-alignment.json).
Configuration, App selectors and runtime pins were retained at adoption.
Client continuity was not complete locally: two local Viewers did not reattach,
and LibreOffice subsequently stopped under its existing 60-second vacancy
policy. The reason for non-reattachment was not established. Sandbox10 Edge's
attached count was preserved. This is not a zero-interruption deployment claim.

The following records the authorization and earlier preparation history.

2026-09-13: operator accepted the connection mask and approved stable `0.11.0`
publication plus local 1991/2992, sandbox00 1991/2991 and sandbox02/03/07/10
1991 alignment. SDK `0.28.0` and App Packages retain their accepted behavior.
Preserve existing runtime pins and exposure policies. Publication and alignment
evidence will be appended after completion; no unverified success is implied.

2026-09-13. Target: Core `0.11.0-rc.1`, SDK `0.28.0`, unchanged App Packages.
Scope: SDK-005/006 and CON-011. Implement and verify, then deploy only to local
loopback 1991/2992. Preserve runtime pins, policies and disabled test Console.
No sandbox deployment or formal publication. Clipboard recheck, audio and sandbox
isolation are outside this train. See [design](connection-mask-release.md).

## Previous train: 0.10.1 clipboard prompt clarity and preview

## Closed — formal release and alignment complete

Operator accepted the rc.2 behavior for formal promotion. Stable `v0.10.1`,
commit `487b02116bb2`, SDK `0.27.5`, is published as Latest. All eight approved
endpoints are aligned to the same verified formal archive; Manager drift is
none. Seven App archives and existing runtime pins are unchanged. Hosted/local
gates, six exact-archive suites (without rerun), and the formal local browser UI
matrix passed. See [publication/alignment evidence](../tests/evidence/v1/clipboard-prompts-0.10.1-alignment.json).
Direct private-IP access remains unverified due to timeouts; container-loopback
validation passed without modifying the production gateway or firewall.

The remaining sections retain the preparation and local UAT history.

Created: 2026-09-12. Status: local candidate behavior accepted for formal
promotion by the operator's publication request. Target: Core `0.10.1`, SDK
`0.27.5`; App Packages unchanged. CLP-041–043 are scope-locked, including the
30% icon reduction and vertical-alignment refinement. Formal candidate gates,
publication and eight-endpoint alignment are now authorized and in progress.
Targets: local loopback 1991/2992, sandbox00 production 1991/test 2991, and
sandbox02/03/07/10 production 1991. Preserve existing policies and runtime pins;
no runtime replacement or production-gateway mutation is authorized.
The accepted 0.10.0 train remains closed. The history below records local UAT
iterations; it is not proof of formal publication or formal-byte deployment.

## Clipboard prompt icon clarity

UAT refinement: reduce all direction/action icon dimensions by 30%, keeping
button hit areas unchanged. Center the text vertically with the direction
icon and action buttons. Deployed to local 1991/2992 as `0.10.1-rc.2`, SDK
`0.27.5`, dirty working-tree base `c556f645ab5c`. Both endpoints passed two
Manager starts, readiness, exact executable/served-asset identity and unchanged
configuration/App selectors/runtime pins. `make check` passed. Served-SDK
single-line layout checks measured zero vertical center offset in both
directions; icons are 19.6 px / 15.4 px, with unchanged 40 × 34 px buttons.
Raw follow-up evidence: `/tmp/remotexapp-rc2.f3gexu/`. Human UAT pending;
the rc.1 transfer evidence below remains historical, not a new rc.2 transfer run.

- **CLP-041 — Prominent direction icons:** make the Local → Remote upward
  arrow and Remote → Local downward arrow larger and thicker than the current
  inline glyphs. SVG icons are permitted and preferred for consistent rendering.
  Keep the direction labels and existing direction colors; direction must not
  depend on color alone. Icons must remain clearly visible in narrow Viewer
  windows and at browser zoom levels without clipping or overlapping content.
- **CLP-042 — Matching confirmation controls:** replace the visible Yes text
  with a tick/check icon. Match the existing dismiss X in visual size, stroke
  weight, button dimensions and alignment. Tick means approve synchronization;
  X means dismiss. Preserve keyboard activation, visible focus, disabled/in-flight
  states, and explicit accessible names/tooltips for both actions.

## Clipboard confirmation content preview

- **CLP-043 — Preview before approval:** both directions' pending confirmations
  show readable content types, encoded byte sizes per representation and a total
  for multiple formats. Show a plain-text sample bounded to 80 Unicode code points
  plus ellipsis; PNG images show a bounded thumbnail and dimensions when available.
  Identify HTML/RTF as rich text and use accompanying plain text for the sample;
  never execute/render clipboard markup. If no safe preview is available, show
  type/size where known and an explicit unavailable indication.
- Preview must describe the offered source revision. Discard asynchronous results
  after replacement, expiry or destruction. Previewing never writes either
  clipboard or counts as consent; approval still revalidates source/destination.
- Obey existing permissions and payload limits when retrieving remote content.
  Keep preview data ephemeral and Viewer-local, never in broadcasts, diagnostics
  or persistent state. Bound image decoding/display resources and release object
  URLs on removal. Permission denial must not be bypassed.

## Unchanged behavior

Changes cover presentation and preview retrieval only. Do not change clipboard routing,
consent revalidation, expiry, retry, deduplication or Viewer-local suppression.
Successful-sync receipts remain button-free, show content details and use the
three-second default duration. Do not add tick/X buttons to success receipts.

## Acceptance checks before release

- Both directions show correctly oriented, larger, thicker icons.
- Tick/X are visually matched and retain their distinct actions.
- Verify narrow/wide Viewer windows, browser zoom, keyboard navigation and
  accessible names in the shared SDK prompt UI and shipped Console/kiosk.
- Preserve content details, button-free three-second success notices and
  failure/retry/in-flight behavior; run clipboard regressions.
- Test pre-consent previews in both directions: text/rich text/PNG/multiple
  formats, UTF-8 byte sizes, empty/unavailable content, permission denial,
  malicious markup, stale asynchronous results, resource cleanup and unchanged
  approval revalidation. Include real-browser checks before approval, not only
  success receipts.

Requirement register: [docs/requirements.md](requirements.md).
Deployment/test evidence: [local candidate verification](../tests/evidence/v1/clipboard-prompts-0.10.1-rc.1-local.json).

## Verification and local UAT

`make check` and 54 focused clipboard tests passed. Both endpoints passed the
served-SDK browser matrix (both directions, wide/narrow, 100%/200% CSS zoom,
keyboard controls, PNG loading, expiry, failure and cleanup). Real two-Viewer
Mousepad and LibreOffice suites passed on each endpoint, including pre-consent
remote PNG/text previews and local previews without writes. Actual Console
preview/dismissal passed on 1991; Console remains intentionally disabled on 2992.

Repeat the UI matrix with an installed Playwright module:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
  RUN_CONSOLE_PREVIEW=1 node tests/go-live-validation/check-clipboard-prompts.mjs
```

This requires live local Managers, Chrome and (for the optional Console case)
Mousepad/X11. The Console case creates and stops only its own disposable runtime.
The matrix stubs transfer I/O; pair it with `check-clipboard-client.mjs` for
real X11/browser transfers. Optional `PROMPT_EVIDENCE_DIR` saves fixture screenshots.
Reload existing Viewer pages for SDK 0.27.4. No runtime upgrade is needed for
this presentation change; existing pins and local loopback settings are preserved.

The audio review bundle remains a separate unapproved proposal; this request
does not add audio integration to the train.
