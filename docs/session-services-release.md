# Core-owned Session Services — Requirements and Design

> Historical technical record. Dated status and validation statements describe
> their original scope; they do not identify a current deployment. See
> [current source versions](current-state.md). Host labels and runtime IDs in
> historical examples are anonymized.

Status: **Closed — stable 0.12.0 published as GitHub Latest** (2026-09-14).
Tag `v0.12.0` points to `3037ca136f58914e6b51262cc377c346ccd259dd`;
SDK `0.28.0` and the accepted seven App Packages are unchanged. Hosted and
independent local builds match byte-for-byte. All seven exact-archive E2E
suites and the separate stopped-cutover rehearsal passed; downloaded published
bytes match the tested candidate. See
[publication evidence](private-history.md).
Human acceptance was on local `0.12.0-rc.2`; release/build identity and docs-only
promotion does not imply a second human test of stable bytes. See
[UAT provenance](private-history.md).
No local endpoint, sandbox or existing runtime was redeployed for publication.
Persistent data/configuration must survive any separately approved cutover;
a blocked graceful stop still requires separate force approval.

The repaired rc.2 dynamic, exact-package/live Viewer, release-ci/nightly,
cutover and P16 gates passed on 2026-09-14. Both loopback endpoints run the same
frozen installable working-tree archive, not a formal GitHub release. The
desktop's same runtime ID was upgraded gracefully to generation 3; user HOME,
default Xauthority and borrowed account bus remain. See
[current verification/deployment evidence](private-history.md).
The original failed rc.1 expanded gate remains documented below and in the
[repaired validation report](session-services-dynamic-validation.md).

Operator clarification, 2026-09-13: **one clean internal cutover, not backward
compatibility with the Driver-owned service architecture**. This supersedes
the initial proposal's legacy launch branch and old-runtime adoption matrix.
Existing public API/SDK usage and App behavior remain the regression baseline.

## Objective and explicit exclusions

Move control of session D-Bus, IBus and the Unicode engine from App Drivers to
a trusted Core session supervisor. The previous common implementation lived in
`drivers/common/session-input.sh`; this is an ownership/lifecycle refactor,
not a new input method or a rewrite of the Python Unicode engine.

**Bubblewrap/bwrap is completely excluded from this train.** There is no sandbox
implementation, namespace/cgroup isolation redesign, permission-grant system,
mount policy, network isolation or control-port relay. None is a prerequisite
or acceptance gate. The separate [sandbox TODO](app-driver-sandbox-todo.md)
remains independent and is not incorporated by reference into this scope.

Also excluded: Docker integration, audio implementation, a global service
daemon, splitting every helper into its own systemd unit, automatic in-place
service replacement, changing D-Bus activation policy, changing runMode,
changing clipboard/keyboard routing, and repairing unrelated Viewer reconnect
behavior. Apps remain trusted same-UID code; service ownership is not a new
security boundary. Retain current deployment authentication and exposure policy.

## Requirements

| ID | Requirement |
|---|---|
| SVC-001 | Core owns startup, health observation and cleanup of private D-Bus, IBus and Unicode services. Drivers own only application/WM behavior and App-specific readiness/control/shutdown. Retain the existing session unit in phase one. |
| SVC-002 | Bind private services to runtime plus session generation, not Manager lifetime. Preserve VNC on stop-session; never own, kill or replace the account D-Bus used by user-home. |
| SVC-003 | Establish HOME/XDG, display/authority and selected bus before launch; verify usable D-Bus, IBus and Unicode endpoints before starting the Driver. Bound startup and roll back only resources created by that attempt. |
| SVC-004 | Observe Driver/canonical application exit independently of supervisor/service liveness. Apply the existing early idle action exactly once; helpers must not keep an exited app logically running. |
| SVC-005 | Keep services available throughout graceful shutdown and shutdown-blocked. After application termination, stop owned services in order. Forced stop is bounded and reaps the complete owned session process tree. |
| SVC-006 | Distinguish D-Bus, IBus and Unicode failures. Report unavailable capabilities truthfully; do not silently replace a bus, replay text, restart an application or discard documents to recover input. Preserve existing explicitly configured stop/enforcement policies. |
| SVC-007 | Within the new architecture, Manager restart adopts surviving supervisor/app/services without replacement. Pin their coherent identities; retain ordinary restart versus explicit upgrade semantics and reject stale generation/PID/socket identities. Old-architecture runtime adoption is excluded. |
| SVC-008 | Preserve getConnections, EXP-007 environment, App control/action and SDK contracts. Separate application identity from service identities; never return supervisor environment as application environment or weaken identity checks to UID-only. |
| SVC-009 | Make Core-owned startup mandatory for all seven shipped Apps and remove Driver-owned launch/cleanup paths. Perform a controlled stop-and-switch cutover, preserve durable application data/configuration intent, and reject old contracts without a compatibility branch. No application-name branches in Core. |
| SVC-010 | Gate completion on clean-cutover and interruption tests, new-architecture lifecycle/adoption/upgrade, real seven-App E2E, public API/input/clipboard/control regression, measured overhead and human UAT. Legacy compatibility and sandbox/bwrap testing are out of scope. |

All requirements are scope-locked; implementation and UAT status are tracked in
the durable register, [requirements.md](requirements.md).

### Locked implementation contracts

- Mandatory `session.services: "core-v1"` with session-lifetime input; absent,
  old or server-lifetime contracts are rejected. Public App API remains v1.
- The pinned `remotexapp-status --supervise-session` executable is the session
  unit entrypoint. This reuses the existing Core binary pin, without a fifth
  binary or a new package dependency. Driver invocation is its final argument.
- Runtime manifest schema becomes 2. A separate generation-qualified private
  `session-services.json` holds supervisor/Driver/service PID start identities
  and bounded service health. Only the supervisor writes it, independently of
  application/connection status revisions. App PID/status semantics stay intact.
- Unit `KillMode=mixed` and bounded stop timeout let the supervisor clean App
  descendants before Unicode, IBus and owned D-Bus. Manager shutdown hooks
  remain the only graceful refusal/enforcement decision point.
- Acceptance thresholds: no extra D-Bus/IBus/engine per session, at most one
  additional steady supervisor process; matched median launch overhead <= 1 s
  or 20% (whichever is larger), steady cgroup memory increase <= 16 MiB,
  idle CPU increase <= 0.5 percentage points, and owned cleanup <= 10 s.
  Record raw matched measurements; a failure needs investigation, not a relaxed
  threshold after the fact. These are test gates, not measured claims.

## Phase-one ownership model

The existing per-runtime systemd session unit starts a **pinned Core supervisor**
instead of directly starting the migrated Driver. Supervisor, owned input
services and Driver remain in that unit's existing cgroup. VNC/server lifetime
is unchanged. The supervisor is independent of the Manager process and must not
be stopped by a dependency on `remotexapp.service`.

| Resource | Lifecycle owner | Lifetime |
|---|---|---|
| VNC/server and gateway | Existing runtime management | Runtime/server policy, unchanged |
| Private session D-Bus in isolated/shared modes | Core supervisor | Session generation |
| Account D-Bus in user-home mode | Operating system/account | Borrowed; never stopped by Core |
| Private IBus and Unicode engine in all migrated modes | Core supervisor | Session generation |
| Application and window manager | Driver, observed by supervisor | Existing App policy |
| Durable runtime manifest and pin selection | Manager | Existing durable runtime record |

"Shared" profile does not mean sharing a private input service across runtimes.
All seven shipped manifests currently use session-lifetime input. The new
contract supports that lifetime only; remove the old Driver-owned and legacy
server-lifetime input branches rather than maintaining parallel launch paths.

## Startup transaction and readiness

1. Manager durably selects the session generation and pinned launch contract.
   Establish HOME/profile, XDG paths, display and Xauthority first.
2. Start the supervisor with immutable, validated launch inputs. It starts a
   private D-Bus for isolated/shared or checks the selected user-home account
   bus. Do not import per-runtime environments into shared user systemd/D-Bus.
3. Start the private IBus and existing Unicode engine with explicit addresses.
   Require process identity plus bounded protocol checks; a socket pathname or
   active systemd unit alone is insufficient. Prove Unicode engine registration
   and protocol availability without injecting text into another application.
4. Pass the finalized environment to the Driver, including the selected bus,
   IBUS_ADDRESS and IM variables. Driver publishes its existing canonical App
   PID, readiness and App control details; supervisor readiness is separate.
5. Only a successful required-service handshake plus existing App readiness
   completes startup. On failure stop owned children, retain a bounded error,
   and remove only endpoints proven to belong to this attempt. Never unlink
   an active endpoint merely because it occupies the expected path.

Allocate one bounded end-to-end startup budget across these stages. Do not
silently stack new unbounded waits onto App/SDK readiness deadlines.

## Exit and shutdown transaction

Supervisor must wait for the Driver and honor the existing canonical App/Driver
contract, not infer application exit from "any process in the unit exists".
The current cgroup observer remains a whole-unit cleanup/failure signal.
Driver exit and the final unit-empty event must be generation-qualified and
idempotent so they cannot apply idle actions twice.

For requested graceful stop, use the existing App shutdown hook while display,
D-Bus and input services remain available. If it refuses/times out, preserve
the application and services in shutdown-blocked and retain the host policy's
warning/enforcement deadlines. Do not let supervisor timeout add an implicit
force policy. After application termination, stop Unicode, IBus and owned
D-Bus; use the existing bounded cgroup kill fallback for remaining descendants.
Systemd signal/stop configuration must support this sequence, rather than
simultaneously killing the bus and a still-saving application.

The Manager continues to own requested lifecycle policy and the durable
shutdown record; supervisor owns local process ordering and reports its
outcome. Manager loss cannot make the supervisor assume a new stop request.
Manager adoption restores pending host-policy evaluation from the existing
record. Natural App exit follows the current early idle action. stop-session
keeps the VNC server; stop-instance also uses the existing server teardown.

## Failure and recovery policy

0.12.2 exception (BR-001–005): the
[boot-aware recovery train](boot-recovery-release.md) supersedes the following
offline-exit rule only when trusted runtime boot evidence proves a boot change
and the durable desired/observed states are eligible. Same-boot failures,
pre-existing failures/refusals and missing evidence retain explicit recovery.

Stability clarification (2026-09-14): managed decisions always refresh the
authoritative runtime, not its registration snapshot. Transport loss preserves
a live App. A failed session remains failed across Manager loss and Viewer
reconnect; explicit runtime restart/upgrade is required to replace it. If the
App exits while Manager is offline, restoration applies the same terminal
event/early-idle policy as live observation. Ordinary restart reserves a newer
generation before on-attach activation; generations are monotonic, not gapless.

Shutdown hooks have a temporary subprocess owner, a parent-liveness pipe and
a per-runtime exclusive lock held through descendant reaping. Manager death
cannot leave a hook overlapping a new Manager's invocation. This owner is not
a persistent service and does not own the App or its session services. Repeated
TERM signals cannot interrupt the session supervisor's ordered cleanup.

Core records private `x11-ownership.json` after X startup, tying the global
display lock/socket inode identities to the runtime and VNC PID/start identity.
Whole-runtime stop can retire those exact dead remnants after abnormal VNC
exit; unknown ownership, replaced files or live listeners block cleanup.
The record is not App-provided metadata or a public API field. It does not
authorize removing another user's or another live server's X resources.

| Event | Phase-one response |
|---|---|
| Required service fails during startup | Fail the attempt, clean its owned resources, do not launch the App |
| IBus or Unicode dies after readiness | Mark affected input unavailable, reject new Unicode requests, keep App and raw keyboard available where functional; no text replay or automatic App restart |
| Owned private D-Bus dies after readiness | Record infrastructure failure; do not claim transparent recovery or recreate it under live applications. Preserve surviving App processes for the existing explicit shutdown/restart workflow |
| Borrowed user D-Bus disappears | Report unavailable; never restart/replace the account bus or create a fallback bus behind XFCE |
| Supervisor dies | Record session failure; use bounded unit cleanup for its remaining children. Do not launch a replacement into the old generation |
| Manager dies/restarts | Supervisor/app/services continue. Adopt their identities and observed health; input degradation alone must not trigger destructive stale-runtime cleanup |

Existing vacancy and administrator-approved force policies continue to apply;
this train does not disable them or treat infrastructure failure as user consent
to destructive restart. Recovery requiring replacement uses an explicit session
restart/new generation, with existing graceful/force semantics.

Use existing error/unavailable API surfaces for affected capabilities, without
changing public session-state enums. A visible live App can remain running while
its input is unavailable. Failures must be observable without exposing payloads
or secret-bearing environment values in logs.

Private child exit is event-driven. Borrowed account-bus liveness is checked
with a bounded protocol request every 30 seconds; this is not instant failure
detection or an OS bus-recovery service. GTK/XFCE may independently exit when
their bus disappears. Core cannot promise the application survives that loss.

Service health is recorded privately in `session-services.json`. Existing
connection descriptors omit an unavailable session bus or IBus capability;
Unicode socket loss causes existing text-channel errors. Raw RFB keyboard and
unrelated clipboard/control paths remain available when the App survives.
Do not conflate a reachable IBus daemon with a functioning Unicode engine.

## Identity, persistence and public API continuity

- Keep the canonical application PID distinct from supervisor and service PIDs.
  EXP-007 continues reading the real canonical App environment/cwd. App control
  data remains App-owned; infrastructure metadata is Core-owned.
- Retain strict PID start-time, unit/cgroup, generation and socket-peer checks.
  Phase one keeps IBus in the existing SessionUnit, preserving that boundary.
  Same UID or a familiar socket path is not sufficient proof of identity.
- Use the existing runtime manifest and bounded status-record mechanisms,
  not a second database or a general service-discovery API. Manager alone
  writes desired state/pins; generation-scoped supervisor observations must
  not independently overwrite that durable authority. Runtime schema 2 and
  private service record schema 1 are locked above; schema 1 runtime records
  are rejected, not converted during startup.
- Pin the supervisor executable, remaining Core helpers, Unicode engine and
  selected launch contract with existing Core components. Do not use a mutable
  `current` path for a surviving new-architecture runtime. OS-provided D-Bus/IBus packages
  retain their current dependency-management model; this is not OS package pinning.
- Core-owned startup is mandatory. Define an explicit new launch/schema
  contract; absent or old contracts fail validation, never fall back to the
  Driver-owned path. No App-name or socket-presence detection. The marker is
  `session.services: "core-v1"`; status mode is `driver` and input lifecycle is
  `session`. Public App API stays v1, but all existing packages must migrate.
- Migrated Drivers remove startup and cleanup ownership, including socket/PID
  deletion, from their code. All seven require new package versions: Mousepad,
  LibreOffice, Kate, KWrite, Firefox ESR, Edge and xfce-user-desktop. Existing
  application policies, parameters and control protocols remain unchanged.
- After cutover, an upgrade is a coherent new-architecture Core/package
  transaction, not helper replacement underneath a running generation.
  Manager adoption and restart continue to work within the new architecture;
  they do not promise a live transition from the old architecture.

Public API continuity means retaining paths, parameters, response structure,
authentication, SDK methods and user-visible App policies, not retaining old
internal ownership or persistence code. Coordinate public/private status
publication so generation/revision remain consistent. Preserve the existing
IBus scope/reason values understood by SDK 0.28.0; internal infrastructure
health must not indiscriminately mark an otherwise functioning App failed or
block unrelated App actions/clipboard. Keep canonical App environment reporting
separate from supervisor identity. Verify these with the current SDK unchanged.

## Clean cutover, not dual-stack migration

This is a planned restart boundary with an observable service interruption,
not zero-downtime migration. Execute only after separate deployment approval.

1. Inventory the exact endpoint, managed configuration, persistent profile/HOME,
   document paths, running instances and clients. Stage the complete matching
   new Core and all seven App Packages without activating them.
2. Quiesce new launches and automatic relaunch. Use the old system to stop its
   runtimes according to their existing shutdown policy, then stop the old
   Manager. Verify all owned VNC/gateway/Driver/private input processes have
   exited. A blocked stop blocks cutover unless force is separately authorized;
   never stop the borrowed account D-Bus or unrelated user services.
3. Preserve persistent HOME/profiles, documents, configuration and managed
   intent. Retire only identified old runtime records/sockets/PID state after
   their processes are gone. Do not pass old resolved runtime/pin records to
   the new Manager. If persistent configuration embeds old internal snapshots,
   convert/recreate the configuration in a one-time deployment step; keep that
   conversion out of the new runtime launch/adoption path. No broad state-dir
   deletion and no implicit purging of application data.
4. Select the new Core and complete new package catalog as one stopped-system
   transition. Validate the new contract/configuration before starting services.
   Recreate managed runtimes under their preserved policies; standalone
   sessions require a new launch. No continuity of old runtime IDs, generations
   or Viewer connections is promised. Clients must resolve/create the new
   instance and reconnect using existing APIs; an old bound Viewer is not
   silently redirected to a different runtime.
5. Verify application launch, input, clipboard, controls and a subsequent
   new-architecture Manager restart/adoption. Interrupted cutover must remain
   diagnosable and resumable without a mixed active stack. Define a controlled
   stopped-system recovery plan before deployment; never point an old Manager
   at new manifests as an automatic rollback. No compatibility mode is added.

Development may migrate packages sequentially in disposable fixtures, but the
delivered system has one launch path and all seven packages use it. Remove
legacy fallback code and legacy-compatibility tests; retain public-behavior
tests, updating fixture setup to the new launch contract. Historical source
remains in Git, not as a production fallback implementation.

## XFCE compatibility

Retain user-home's default account bus, real HOME and Xauthority behavior.
Start the runtime-private IBus before XFCE, supply explicit IM addresses and
verify no competing IBus/autostart takeover. `ibus-daemon --single` is not a
singleton lock. Do not use broad process-killing or fallback bus creation.

Test Xfconf, Thunar, activation services, logout and saved-session behavior.
The [2026-09-14 saved-session gate](private-history.md)
now proves actual XSMP command/window restoration, document content, current
input environment, no duplicate IBus/Unicode, borrowed-bus continuity and
served-Viewer input across subsequent Manager adoption. Fast logout alone was
not sufficient evidence. Application-specific unsaved-state recovery and native
IME human UAT are separate; no activation or restore policy was changed.
Do not redesign activation allowlists or promise isolation: both private-bus
Apps and user-home remain trusted in this phase. Detect regressions affecting
an unrelated same-UID desktop or user service; do not alter its environment to
make a migrated runtime pass.

## Locked implementation sequence

1. Finalize the mandatory new launch/record contracts, shutdown integration,
   clean-cutover procedure and public error mapping with fixtures. Capture
   current startup/resource baselines.
2. Implement the same-unit supervisor and migrate Mousepad as the reference.
3. Prove exits, blocked shutdown, service faults and Manager crash/adoption,
   including a Manager restart with an actually attached Viewer.
4. Migrate LibreOffice, Kate/KWrite, Firefox/Edge, then user-home XFCE. Preserve
   App-specific control and force/no-save policies throughout.
5. Remove the old startup/cleanup path, run adapted exact-artifact gates, then
   authorized local UAT deployment through the clean cutover. A clean restart
   is authorized; refusal by the old desktop requires separate force approval.
   No sandbox deployment or GitHub publication is authorized.
   Future local ports stay loopback 1991/2992.

## Acceptance matrix

| Requirement | Required evidence before acceptance |
|---|---|
| SVC-001–003 | No double startup; inherited environment and usable bus/engine checks; bounded timeout, failed partial launch, occupied/stale socket and two-runtime separation tests |
| SVC-004–005 | Mousepad exit, XFCE logout, app/Driver death while services remain alive, exactly-once early idle action; controlled refusing hook and unsaved document; graceful/blocked/forced stop and complete descendant cleanup |
| SVC-006 | Independently kill private D-Bus, IBus, engine and supervisor in disposable fixtures; truthful errors, raw-input survival where applicable, no replay/unrequested restart and no borrowed-bus mutation |
| SVC-007 | New-architecture Manager SIGTERM/SIGKILL during startup, running, degraded input, blocked shutdown and cleanup; preserve healthy processes/pins, attached-viewer recovery, stale identity rejection, normal restart versus explicit upgrade; no old-runtime adoption gate |
| SVC-008 | Actual IBus query, getConnections and EXP-007 environment comparison; control metadata, BiDi/CDP/UNO/KDE actions, SDK sendText/raw keys and password expectations unchanged |
| SVC-009 | Reject old launch contracts; clean stop-and-switch with all seven Apps; preserve documents/profile/configuration intent; blocked stop, stale records, interrupted selection and controlled recovery without mixed activation; user-home account services untouched |
| SVC-010 | Focused tests then make check, race/coverage/vulnerability gates, adapted exact candidate E2E preserving public-behavior coverage, real IME/clipboard/resize/reconnect and human UAT |

Record cold/warm launch latency, steady-state CPU/memory, process counts and
cleanup time against the accepted baseline under the same host conditions.
Use the precommitted thresholds above; do not invent a performance win.
Tests require local systemd, X11, D-Bus/IBus, shipped applications and browsers.
Use disposable fixtures/UIDs; never kill the real user bus or existing Apps for
fault injection. Do not count a healthy Manager as proof of Viewer continuity.

## Driver migration checklist

1. Add `session.services: "core-v1"`; retain `input.backend: "ibus"`,
   `input.lifecycle: "session"` and `session.status.mode: "driver"`.
2. Remove `session-input.sh`, its start/stop calls and input socket/PID cleanup.
   Require the `REMOTEXAPP_SESSION_SERVICES=core-v1` environment marker.
3. Inherit finalized HOME/XDG, DISPLAY/XAUTHORITY, DBUS_SESSION_BUS_ADDRESS,
   IBUS_ADDRESS, GTK_IM_MODULE/QT_IM_MODULE and XMODIFIERS. Do not start a
   replacement bus/IBus or import this environment into user systemd.
4. Keep the existing canonical Driver PID/status contract, app-specific
   children, window-manager readiness, controls/actions and shutdown hook.
   EXP-007 returns that Driver's launch environment, not supervisor environment
   or arbitrary browser renderer environment (see its canonical-PID design).
5. Bump the App major version. Core 0.12 and all selected packages must switch
   while the old stack is stopped. Ordinary `/restart` is not this migration.

The supervisor requires Linux pidfd support, already present on the target
Ubuntu hosts. Core preflight requires dbus-daemon/dbus-send, ibus/ibus-daemon,
Python GI/IBus and the existing engine dependencies. The Python engine has not
been rewritten. No SDK rebuild or downstream host application code change is required;
old bound instance IDs must be resolved anew after the one-time clean cutover.

## Verification and local UAT handoff — 2026-09-13

Follow-up clarification, 2026-09-13: seven real Apps passed the suites below,
but common fault/upgrade-interruption fixtures were not a full per-App ×
state × API matrix. The operator requested broader dynamic-state testing.
That additional run finished with failures, using
[the disposable-UID matrix](../tests/session-services/README.md). Prior pass
records remain historical evidence, not proof that the expanded gate is done.
It has exposed lifecycle blockers; see
[dynamic-state findings](session-services-dynamic-validation.md). The expanded
stability gate is not passing; do not promote this candidate yet.

- Portable checks, Go race/coverage, source and four-binary vulnerability scans,
  immutable staging/tamper tests and package checks passed. The staging test's
  stale hardcoded Mousepad version was corrected; no gate was weakened.
- Frozen archive: `remotexapp-0.12.0-rc.1-linux-amd64.tar.gz`, SHA-256
  `57a9dc17b2740361936ab2eb8d32c475ab2cd7284b768b9ad7a341ae81be4f36`.
  It passed synthetic plugin, shipped-browser/input/clipboard, documents,
  KDE/upgrade, App actions, disposable-UID XFCE and service-fault suites.
  The stopped-system cutover rehearsal also passed. Earlier failures and
  their dispositions are retained in the linked evidence, not hidden by reruns.
- [P16 measurements](../tests/performance/core-session-services/README.md)
  passed the locked overhead gates: one extra process, +4.18 MiB, median
  fresh/warm launch +530/+543 ms. This is overhead, not a speed improvement.
- Both local deployments retain loopback listeners, Manager authentication,
  configuration hashes and enabled catalog membership. Production has seven
  Apps; test retains six and its disabled Console. Profiles/documents were
  not purged. The old desktop stopped gracefully; no real App was force-stopped.
- Post-deployment tests used actual served SDK/Viewers on both ports. Chinese
  text and clipboard readback succeeded before/after Manager restart, with
  identical supervisor/Driver/service identities and generation. Separate
  faults in disposable Apps rejected Unicode while **SDK raw RFB input and
  Viewer connectivity survived**. No fault was injected into the user's desktop.
- The archive remains frozen. Source-only cleanup removed blank whitespace
  from four App manifests after freezing; parsed JSON equality and identical
  runtime scripts/binaries were verified. Documentation/test updates continue
  outside the deployed artifact. Formal publication still requires a clean
  committed candidate and the normal acceptance gates.

Local production `ubuntu-desktop` now resolves to a new runtime on display :1,
with Core 0.12.0-rc.1 and App 3.0.0. Its account bus is borrowed, IBus/Unicode
are private and ready, and ordinary Manager restart adopted them unchanged.
The IBus log has a portal activation warning; the private bus protocol and
selected engine work, and portal/Flatpak mode is not selected. This warning
is not claimed fixed. Native-IME and desktop usability remain human UAT.

Use the production Console at `http://127.0.0.1:1991/sdk/console.html` and
reopen Desktop; old bound Viewer IDs are not redirected. Test Manager/SDK
remain at `http://127.0.0.1:2992`, with Console disabled as before. For UAT,
check native Chinese/Japanese composition, ASCII/password typing, clipboard
both ways, browser/app controls, desktop logout/reconnect and normal exit.
Do not force-close valuable unsaved documents to perform UAT.

## Code and protocol references

- [Core session supervisor](../cmd/remotexapp-status/supervisor.go)
- [Session start/stop and observer](../cmd/remotexappd/lifecycle.go)
- [Shutdown policy](../cmd/remotexappd/shutdown.go)
- [Runtime adoption](../cmd/remotexappd/runtime_manifest.go)
- [IBus identity validation](../cmd/remotexappd/connections_ibus.go)
- [Canonical App environment](../cmd/remotexappd/environment.go)
- [systemd dependency semantics](https://raw.githubusercontent.com/systemd/systemd/main/man/systemd.unit.xml)
- [D-Bus activation environment](https://dbus.freedesktop.org/doc/dbus-update-activation-environment.1.html)
- [IBus daemon options](https://raw.githubusercontent.com/ibus/ibus/main/bus/ibus-daemon.1.in)
