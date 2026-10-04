# Changelog

> Historical technical record. Dated status and validation statements describe
> their original scope; they do not identify a current deployment. See
> [current source versions](docs/current-state.md). Host labels and runtime IDs in
> historical examples are anonymized.

All notable user-visible, operator-visible, and compatibility changes are
recorded here. Add changes under `Unreleased` in the same pull request as the
implementation; move them to a version section when publishing a release.

## Unreleased

## 0.14.4 — 2026-10-04

Target: `0.14.4`. Public documentation and release-packaging checks. SDK
`0.29.1`, App Package versions, APIs and runtime behavior are unchanged.

- Make public documentation independent of private deployment histories:
  replace operational diaries with current guidance, anonymize historical
  examples, and generalize host-application integration guides.
- Clarify Citrix-style Linux app delivery and SDK embedding in the README;
  correct App README versions and historical repository-status wording.
- Add a public-documentation disclosure/link gate to `make check`. Release
  packaging checks bundled guides and links omitted source material to the
  exact source commit, without copying operational diaries into the archive.


## 0.14.3 — 2026-10-03

Target: `0.14.3`. First release from the reviewed public source repository.
SDK `0.29.1`, App Package versions, APIs, and runtime behavior are unchanged
from `0.14.2`.

- Correct the supported-version security guidance and Go dependency notices;
  include the `x/sys` license in packaged and installed releases.
- Redact a historical test result's private address and reject private IPv4
  addresses in newly tracked files and release packages.

## 0.14.2 — 2026-10-02

Target: `0.14.2`. SDK `0.29.1` and App Packages unchanged. Local UAT of
`0.14.2-rc.1` was accepted; the exact formal artifact remains subject to the
release candidate verification gate.

- Detect a dead session readiness process even when its cgroup remains
  populated by desktop helpers. A managed user-home session with surviving
  processes is marked failed and preserved for operator review rather than
  killing potentially unsaved applications.
- A failed managed user-home session whose component is fully gone may relaunch
  on the next Viewer attach using the existing pinned runtime/display. Bound
  this on-attach recovery to three attempts per ten-minute durable window;
  an exhausted or still-populated session needs an explicit runtime restart.
- Update `golang.org/x/sys` to `v0.48.0` and `golang.org/x/mod` to `v0.41.0`.
  The public API, SDK and App Package versions do not change.

## 0.14.1 — 2026-10-02

Target: `0.14.1`. SDK `0.29.1` unchanged. Local RC.1 UAT was accepted.

- Optional App Package Viewer transition hooks run on first attach, last detach,
  and Manager adoption. LightView 1.0.13 uses them to wake a suspended engine
  before connecting and temporarily inhibit native idle hibernation while a
  Viewer is attached, restoring the user's prior interval afterward.
- App and Core archives exclude local Python bytecode caches, keeping their
  immutable identities independent of ignored working-tree files. LightView
  1.0.12 was a local UAT package; 1.0.13 is the clean formal target.

## 0.14.0 — 2026-10-01

Target: `0.14.0`. SDK `0.29.1` unchanged. RC.1–RC.6 were qualification
builds only; none was published. Human UAT of RC.6 was accepted.

- RUN-001–007 / DEP-017: explicit standalone/runit lifecycle and
  installation-time selected-user deployment, plus administrator-configurable
  fixed display/RFB/gateway allocation for the default XFCE App. Existing
  systemd deployments remain the default. Host reboot persistence remains
  unverified because no reboot was approved.
- Central-user systemd preflight now rejects a user manager whose runtime,
  D-Bus or PulseAudio environment points at another UID. This prevents an
  install from appearing healthy while GUI sessions inherit foreign sockets.
- Edge App Package `2.0.4` measures readiness deadlines with explicit epoch
  milliseconds, fixing premature startup failure with Ubuntu 26.04's uutils
  `date` implementation.
- XFCE user-home App Package `3.0.1` gives a cold Ubuntu 26.04 user profile
  enough bounded time to start xfwm4 before declaring the desktop failed.
- Standalone component stop now removes its verified empty cgroup leaf, and
  Manager startup reclaims empty leaves retained by older builds. This avoids
  exhausting a delegated host's `cgroup.max.descendants` quota after repeated
  App launches; populated or replaced cgroups are not removed.
- App Package extraction now fixes canonical file and directory permissions
  regardless of the installing process's umask. Reinstalling the same archive
  under a different umask keeps the same content seal and remains idempotent.
- Natural clean or failed session exit now retires the session component and
  stale IPC files before publishing its terminal state. Standalone therefore
  reclaims the empty session cgroup leaf without requiring a full runtime stop.
- A managed standalone runtime whose server Driver exits now reconciles its
  durable managed state immediately after dependent-component cleanup, instead
  of reporting `running` with a stopped runtime until the safety sweep.

## 0.13.1 — 2026-09-29

Target: `0.13.1`. SDK `0.29.1` unchanged; Edge App Package `2.0.3`.

- RTM-018 / EDGE-006 (Issue #9): persist terminal session-start failure and
  retain an unattached anonymous runtime for a fixed two-minute diagnostic
  window. Repeated Viewer attempts and Manager adoption do not renew that
  deadline. Expiry force-cleans failed App resources and retains a private,
  bounded failure tombstone. Edge 2.0.3 reports whether its visible window or
  CDP probe failed before Core's readiness deadline. Healthy six-hour vacancy
  and managed-runtime policy are unchanged.

## LightView App Package 1.0.11 — 2026-09-29

- LTV-012: LightView App Package `1.0.11` lets `openUrl` wake a hibernated
  WebKit engine. It verifies the unchanged main process and private control
  socket, sends native `open`, and waits through recovery for a ready, loaded
  page. Core, SDK and the host Lightview binary are unchanged.

## LightView App Package 1.0.10 — 2026-09-24

- LTV-011 / Issue #8: LightView App Package `1.0.10` separates control
  identity from navigation readiness. Optional memory protection and thresholds
  no longer block startup, `openUrl` or graceful quit, including quit during
  engine recovery. Preserve socket/PID/protocol checks and low-memory launch
  defaults; replace stale fixed memory-status claims with `launchLowMemory`.
  Core/SDK are unchanged. This independent App release does not upgrade the
  host Lightview executable. Existing runtimes need an explicit App upgrade.

## LightView App Package 1.0.9 — 2026-09-18

- LTV-010: LightView App Package `1.0.9` removes the exact executable-version
  gate. Launch/readiness still requires the existing private control protocol,
  process/window identity and low-memory policy. Core and SDK are unchanged;
  host binaries remain separately provisioned and deployment is separate.

## 0.13.0 — 2026-09-18

Target: `0.13.0`. SDK `0.29.1`; App Packages unchanged. Human UAT accepted
for local RC.3; formal publication authorized without functional changes.

- Add the host application Coordinator migration handoff: per-Tab service/per-window
  ownership, incremental integration, on-attach generation handling,
  restart/upgrade/logout cleanup, diagnostics, acceptance and rollback.

- Add a read-only Console/kiosk Coordinator panel and SDK `getDiagnostics()`:
  observed peers, runtime/generation ownership, leader, latest lease receipt,
  local renewal schedule and a bounded 100-event history. Opening the panel
  does not acquire interests or keep Apps alive. This follow-up ships in RC.3;
  the previously deployed RC.2 artifacts remain unchanged.

- Add App-neutral idle-lease renewal, generation/state guards and stale vacancy
  timer callback fencing. Explicit stop/exit/upgrade retain priority. Check the
  latest Driver status, not a cached ready status, before granting renewal.
- Add an optional single-server SDK Coordinator for shared lifecycle status
  and opt-in keepalive across same-origin Tabs, plus Console/kiosk Keep running
  controls. Frozen-owner retention is bounded to five minutes; indefinite
  browser suspension is not guaranteed. Multi-server and audio remain pending.

- Document single-server integration and explicit handle ownership. Invalidated
  bound Viewers stop reconnecting; released valid handles return Viewers to
  standalone monitoring. External reliable background ownership remains pending.

## LightView App Package 1.0.8 — 2026-09-18

- Add exact compatibility with formal Lightview 0.1.8. The immutable App
  Package retains mandatory low-memory mode while validating the new 3072 MiB
  last-resort WebKit-process threshold and ready engine generation. Upstream
  can recover a failed or oversized WebKit worker without replacing the GTK
  window, LightView process, persistent profile, or private control socket.
  Core, SDK, public actions, and lifecycle policy are unchanged.

## LightView App Package 1.0.7 — 2026-09-17

- Prepare immutable LightView App Package 1.0.7, accepting exactly the formal
  Lightview 0.1.7 host binary. Low-memory mode now retains normal website
  images, while upstream prompt-free downloads write conflict-free files to
  the runtime user's standard Downloads directory. Core and SDK are unchanged.

## Edge App Package 2.0.2 — 2026-09-17

- Add Edge App Package 2.0.2 with fail-closed recovery for proven-stale
  Chromium singleton profile links. Live profile owners and reachable sockets
  are preserved and reject startup; safe recovery moves only the three known
  links into a private quarantine that safely rotates its four validated
  Driver-owned records.

## LightView App Package 1.0.6 — 2026-09-17

- Add LightView App Package 1.0.6, pinned to Lightview 0.1.6. Lightview now
  selects WebKitGTK's shared-memory buffer transport even when the host has no
  renderer override, preventing the null accelerated-backing-store crash in
  containers. The Ubuntu dependency list now includes GStreamer bad and libav
  plugins required for common YouTube media streams.

## LightView App Package 1.0.0 — 2026-09-16

Core `0.12.2` and SDK `0.28.0` remain unchanged. This App Package is released
independently as `lightview-v1.0.0`.

- Add the shared singleton `lightview` App Package with persistent profile,
  six-hour detached lifetime, dynamic 1280×720 depth-16/5 FPS display, Matchbox,
  Core-owned session services and mandatory non-overridable `--low-memory`.
- Report the private same-UID Unix control socket through generic CONN-001
  metadata and expose only a bounded HTTP(S) `openUrl` Manager action. Readiness
  validates the visible window, exact process, private socket, native status and
  the 384 MiB WebKit memory-pressure policy; raw JavaScript evaluation remains
  local trusted-Agent functionality.

## 0.12.2 — 2026-09-14

Target: `0.12.2`. Boot-aware recovery (BR-001–005 / U26-06). Distinguish a changed
system boot from same-boot Manager loss, preserve explicit failure protection,
and restore eligible runtimes through pinned, generation-fenced recreation.
Completed or Viewer-cancelled shutdowns do not count as pending refusals;
timed-out, unknown and genuinely blocked shutdowns remain protected.
SDK `0.28.0` and App versions are unchanged. Published as formal GitHub Latest
`v0.12.2` at `c1cecabe076e`; see `docs/boot-recovery-release.md`.

- BR-006: configured document-storage failures report errors without aborting
  Manager startup. Keep the allowlist and revalidate canonical roots/files on
  access, allowing storage recovery without a restart. Loading managed intent
  no longer requires its document to be online. Invalid configuration, unreadable
  files and path escapes remain rejected; no Driver runs for a rejected launch.

Hosted/local release gates produced identical bytes; all eight final-archive
E2E suites passed. test-host-a production 1991 runs those bytes and passed seven-App
Viewer/input/control checks across two Manager restarts plus an explicit XFCE
logout/stopped-session restart. remote storage still reports a storage error without
blocking Manager; its functional tests were skipped during maintenance.
Final-candidate container reboot acceptance remains pending new human approval:
no container reboot occurred after that restriction. Paired 2991 remains 0.11.0;
local endpoints, other sandboxes and the production gateway are unchanged.
See `tests/evidence/v1/boot-recovery-0.12.2-publication.json` for evidence and
the existing sandbox XFCE logout-wrapper qualification. No new human UAT or
native Ubuntu 26.04/physical power-loss acceptance is claimed.

## 0.12.1 — 2026-09-14

Released as formal GitHub Latest `v0.12.1` after operator UAT acceptance,
commit `0300acdfd003`. SDK `0.28.0` unchanged; Mousepad App `4.0.1` included.
Promotion changes release/build identity, documentation and test-only fixture
timing, not accepted product behavior.

- Probe IBus with `list-engine --name-only`, retaining the 500ms probe limit,
  shared startup deadline, actual engine readiness and failure cleanup.
- Allow both verified Mousepad WM_CLASS names, `Mousepad` and
  `Org.xfce.mousepad`, without wildcard input authorization.
- Check actual Python imports, native/input libraries, toolkit integration,
  user services and owned-child pidfd signaling; add explicit Ubuntu package
  lists without installing packages from Core.
- Report bounded startup stages without private output. Preserve the paired
  public/private status revisions required by `getConnections()` and keep
  Driver-specific errors intact.
- Clarify Manager versus App readiness and optional managed-desktop registration.

Seven-App lifecycle/interaction tests passed 280 checkpoints and 1,960 HTTP
assertions; Mousepad's version/input fixtures passed eight additional checks.
Seven final clean exact-archive E2E suites and eight Mousepad checks passed;
published bytes match the tested hosted candidate and independent local build.
Native clean Ubuntu 26.04,
Qt6/Mousepad 0.7 and full-host reboot acceptance remain unverified; release
acceptance is not a claim that those target-specific tests passed.
No reboot-recovery policy, public JSON contract or SDK behavior change.
Deployment, runtime replacement and downstream workaround retirement remain
separate operator decisions; none is authorized by this publication.
See `docs/ubuntu-host-compatibility-release.md`.

## 0.12.0 — 2026-09-14

Target: `0.12.0`. SDK `0.28.0` unchanged. SVC-001–010 accepted after
comprehensive automated tests and human UAT of local `0.12.0-rc.2`.
Operator authorized formal GitHub publication on 2026-09-14. Stable promotion
changes release/build identity and documentation only; the clean hosted
candidate passed all seven exact-archive E2E suites and a stopped-cutover
rehearsal. Stable `v0.12.0` is published as GitHub Latest; its downloaded bytes
match both the hosted candidate and the independent local build. See
`tests/evidence/v1/core-session-services-0.12.0-publication.json`.
Core owns session D-Bus/IBus/Unicode through its pinned supervisor; seven App
Packages remove service ownership and require `session.services: core-v1`.
Runtime manifest schema 2 requires a clean stop-and-switch transition preserving
profiles, documents and configuration, not old runtime identity. No dual launch
path or legacy adoption. bwrap/sandbox isolation and audio are excluded.
Implemented and deployed as rc.2 to both local loopback environments for human
UAT. The initial old-stack cutover created a new desktop identity; the rc.2
repair instead gracefully upgrades that same new-architecture runtime to
generation 3, without purging HOME/configuration intent.
All seven App majors migrate: Edge/Kate/KWrite 2, Firefox/XFCE 3,
Mousepad/LibreOffice 4. See `docs/session-services-release.md` and the linked
evidence for exact candidate identity, test limitations and UAT instructions.
Local deployments remain on the accepted rc.2 until separately aligned.
No sandbox deployment or runtime upgrade is authorized by this publication.

Follow-up per-App dynamic-state/API validation found lifecycle blockers in
failed-session recovery, interrupted upgrade, KDE startup identity and duplicate
on-attach restart handling, plus orphan shutdown hooks after Manager death.
Managed transport recovery also uses stale session state/generation, allowing
a replacement session to reuse a generation and accept an old connections query.
These findings are fixed in rc.2. The repaired matrix passes 361 checkpoints
and 2,235 HTTP assertions. See `docs/session-services-dynamic-validation.md`.

Stability fixes: managed lifecycle decisions now read authoritative
runtime state; transport loss preserves live Apps. Failed sessions retain their
generation/error across Manager restart. Startup adoption validates canonical
App and Driver identities separately; interrupted upgrade resumes the bounded
target startup. Ordinary restart reserves a newer generation even before an
on-attach session starts. A short-lived hook owner cancels/reaps shutdown-hook
descendants on timeout or Manager death, serializing hooks across Manager
generations and bounding diagnostic output.

Repeated TERM no longer interrupts supervisor child cleanup. Managed VNC loss
records session failure before reconciliation; exact private X lock/socket
ownership allows safe cleanup and reuse after abnormal server exit. Shutdown
timeout/failed-hook outcomes retain their original host-force deadlines on
adoption. Unknown or replaced global X resources are never guessed or removed.

Edge/Kate/KWrite packages are `2.0.1`, Firefox ESR `3.0.1`: patch versions
preserve immutable installed rc.1 package directories after manifest formatting
cleanup. Driver behavior is unchanged by these patch bumps; existing package
versions are not overwritten. Other three App versions remain unchanged.

Final real-App/Viewer, document/control, service-fault, clean-cutover and P16
gates pass, as do release-ci and nightly checks: 20 shuffled Go/Node iterations,
race detection and three fuzz targets. The real XFCE Viewer additionally proves
fixed framebuffer, Unicode/clipboard readback and Manager-restart continuity.
Both deployed Viewers pass Unicode/clipboard and degraded raw-input checks.
Median added fresh/warm latency is 390/405 ms and memory 4.04 MiB versus 0.11;
all locked limits pass. Human UAT is accepted; formal publication is complete.

Completion audit adds real XFCE saved-session restoration: original document
window/content, current-generation input environment, no duplicate IBus/Unicode,
borrowed-bus continuity and served-Viewer input after Manager adoption. Three
full runs passed (final identical harness repeated twice); bounded IBus teardown
probes record fail-closed 409 before stable unavailability. Earlier test-setup
failures remain documented. This follow-up changes tests/docs only, not deployed
Core/App binaries or real-user configuration.

## 0.11.0 — 2026-09-13

Target: `0.11.0`. SDK `0.28.0`; App Packages unchanged.
SDK-005/006 and CON-011: default-enabled connection readiness mask with a
per-Viewer SDK/Console switch, bounded failure handling and scoped input blocking.
Human UAT accepted; formal GitHub publication and eight-endpoint alignment
authorized. Promotion changes release metadata only; runtime pins are preserved.
Stable `v0.11.0` is published and aligned on all eight approved endpoints.
See `tests/evidence/v1/connection-mask-0.11.0-alignment.json`, including the
local Viewer non-reattachment/vacancy-stop caveat. Reload Viewers for SDK 0.28.0.

Documentation: distinguish installed desktop/input dependencies from pre-running
services. Explain that disabled standalone VNC services are compatible with
RemoteXApp-owned displays, while user systemd/D-Bus prerequisites remain.
No installation or runtime behavior changes.

Documentation: add teleport, app-delivery and human/agent ASCII artwork to the
README, retaining the explicit audio WIP label.

Documentation: highlight plugin-style App Packages, compatible live Manager
upgrades with runtime preservation, local IME composition and Cloudflare-friendly
WebSocket transport. Clarify catalog reloads, brief connection interruptions,
explicit runtime upgrades and proxy limitations; no behavior changes.

Documentation: distinguish runtime must-haves, per-App prerequisites, optional
operational tools and build/test-only dependencies. Clarify bundled noVNC,
full-catalog validation, lack of automatic OS package installation and the
limits of dependency/version checks. No runtime or deployment changes.

Documentation: refresh the developer introduction and ASCII logo; explain
desktop/single-App deployment on Linux VPS, containers and physical hosts,
IME/clipboard integration and the AI-agent sandbox building-block role. Add
official-source positioning research, mark audio as WIP, and remove stale
opening release claims. Highlight opt-in automatic clipboard detection and
in-view confirmation instead of panel-based text transfer, retaining browser
permission/focus limitations. No SDK, runtime or deployment behavior changes.

## 0.10.1 — 2026-09-12

Target: `0.10.1`. SDK `0.27.5`; App Packages unchanged.

Formal Latest `v0.10.1` is published; all eight approved endpoints are aligned
to its exact archive. Hosted/local gates and all six exact-archive suites passed.
See `tests/evidence/v1/clipboard-prompts-0.10.1-alignment.json`.
Existing runtimes are preserved; reload Viewer pages for the updated SDK.

- CLP-041/042: clear SVG direction arrows and matching tick/X controls,
  refined after UAT to 19.6 px / 15.4 px, vertically centered text and unchanged
  accessible button hit areas.
- CLP-043: both pending confirmations show content types, encoded byte sizes,
  safe text previews and bounded PNG thumbnails/dimensions before consent.
  Preview reads do not synchronize content; existing approval revalidation,
  Viewer-local suppression and three-second success receipts remain intact.
- Embedding hosts using the standard UI must allow `data:` / `blob:` image
  sources in CSP. Shipped Console/kiosk policies include them; script policy
  is unchanged. No Manager API or App Package contract changes.

The following entries retain local candidate verification history.

UAT refinement deployed to local 1991/2992 as rc.2 / SDK 0.27.5: shrink clipboard direction and
tick/X icons by 30%, retain button hit areas and vertically center prompt text.

Implemented and deployed locally for UAT: CLP-041/042 add larger, thicker clipboard
direction icons and replace Yes with a tick matching the dismiss X. CLP-043 adds
content type, size and safe previews to both directions' pending confirmations.
Core 0.10.1-rc.1 / SDK 0.27.4. See `docs/next-release-train.md` and
`tests/evidence/v1/clipboard-prompts-0.10.1-rc.1-local.json`.
Only local 1991/2992 were deployed; no formal publication or sandbox changes.

## 0.10.0 — 2026-09-12

Target: `0.10.0`. SDK `0.27.3`; App Packages unchanged.
Published as the formal Latest release; all eight approved Managers aligned.
See `tests/evidence/v1/clipboard-0.10.0-publication.json` and
`tests/evidence/v1/clipboard-0.10.0-alignment.json` for verification, the retained
intermittent Firefox fault-injection failure and intentional old runtime pins.
Human UAT accepted for CLP-035–040. Formal GitHub publication and remaining
environment deployment authorized. Existing runtime replacement requires
separate approval; guarded clipboard approvals need a consistency-capable pin.

- CLP-040: success receipts now show actual representation sizes and total
  payload bytes, plus PNG pixel dimensions when available. Text retains its
  bounded preview. Deployed to local loopback 1991/2992 as development build
  `0.10.0-dev.20260912-clp040`, SDK `0.27.3`; not a formal release.

- CLP-039 follow-up: successful clipboard notices now default to three seconds
  (`successDuration:3000`); explicit overrides remain supported. Deployed to
  both local endpoints as `0.10.0-dev.20260912-clp039-3s`, SDK `0.27.2`.

The following entries retain the local candidate validation history.

- Follow-up local development build (not part of the original rc.1): successful clipboard
  notices remove Yes/× and report actual transferred formats plus a bounded
  plain-text sample. Confirmation prompts remain actionable (CLP-039).
  Deployed locally as `0.10.0-dev.20260912-clp039`; not a formal release.

- Deduplicate unchanged rich clipboard snapshots and superseded native reads.
  Viewer recovery no longer re-prompts handled history; keep one latest prompt
  per direction and revalidate consent before transfer. Independent two-sided
  changes defer automatic synchronization to explicit user choice (CLP-035–038).
- Clipboard capabilities add `consistencyVersion:1` and `sequence`; guarded
  uploads accept `X-RemoteXApp-Clipboard-Sequence`. Stale accepts/writes return
  HTTP 409. New guarded SDK approvals require an upgraded runtime, not merely
  a new Manager. No App/host application-specific branch or shared Viewer coordinator.
- Clean-clone release-ci, exact-archive six-suite E2E and deployed two-Viewer
  Mousepad/LibreOffice checks passed on local 127.0.0.1:1991/2992. Human UAT
  is pending; existing XFCE retains its 0.9.1 pin. No formal publication or
  sandbox rollout.

## 0.9.1 — 2026-09-12

Target: `0.9.1`. SDK `0.26.0`; App Packages unchanged.
Heartbeat behavior passed local 1991 human UAT. Formal publication and fleet
alignment, including forced runtime upgrades, authorized by the operator.

- Keep idle RFB WebSockets alive with a server Ping every 30 seconds on both
  direct and compatibility relays. Browsers answer with protocol-level Pong;
  heartbeat write failures close the relay and normal disconnects stop the
  heartbeat. No SDK or App Package changes are required. Existing pinned
  gateways require an approved upgrade/restart to adopt the change.

## 0.9.0 — 2026-09-10

Target: `0.9.0`. SDK `0.26.0`; human UAT accepted.

Verified candidate `fc2d94e6b764` is deployed to local loopback 1991/2992;
subsequently authorized XFCE/Edge force upgrades passed readiness and connection
checks. [Validation record](docs/private-history.md).

- Add optional App Package actions with generic pinned capability discovery,
  strict input/result schemas, session-generation guards, bounded execution,
  per-runtime serialization and lifecycle cancellation. No automatic retry or
  implicit start/upgrade; normal Manager authentication applies.
- Firefox ESR `2.2.0` and Edge `1.1.0` implement `openUrl` for a new activated
  HTTP/HTTPS tab using package-owned BiDi/CDP handlers; existing tabs survive.
  Firefox never takes over another controller's active BiDi session.
- Add SDK `getActions()` / `invokeAction()` and a generic Console Actions panel
  for schema-defined input, explicit invocation and transient results/errors.
  See [locked App Actions train](docs/app-actions-release.md).

## 0.8.1 — 2026-09-10

Target: `0.8.1`. SDK `0.25.1` and all App Packages unchanged.

- Fix upgrade-and-restart falsely reporting its own fixed display as occupied
  after successful shutdown. Release the old allocation only after cleanup;
  preserve collision checks for other runtimes and live listeners.

## 0.8.0 — 2026-09-10

Target: `0.8.0`.

SDK: `0.25.1`. Human UAT accepted.

- Add generic runtime connection information through Manager/SDK
  `getConnections()`: generation/revision, Display, Xauthority path, actual
  D-Bus/IBus endpoints and template-owned application controls. Runtime identity,
  socket/process ownership and generation are validated; no control proxy is added.
- Connection reads use normal Manager authentication and origin checks.
  The separate connection token is no longer required; legacy token-file settings
  are ignored. With `auth-mode=none`, reachable callers can read descriptors.
- Add read-only Console Connection info, refresh and confirmed field/JSON copy.
  Bind Console to its build-matched hashed SDK to prevent old cached SDK entry
  reuse, including reverse-proxy subpaths.
- Add explicit upgrade-and-restart with frozen durable targets, generation/revision
  guards, SDK methods and Console current/available version visibility. Ordinary
  restart retains runtime pins; surviving sessions keep lifecycle observation.
- Add independent Kate and KWrite `1.0.0` packages with optional file paths,
  isolated HOME, verified D-Bus controls and destructive no-save shutdown.
- Mousepad `3.0.0`: optional file path, immediate activation, 10 FPS,
  60-second detached stop-instance and destructive no-save shutdown.
- LibreOffice `3.1.0`: optional file path and Start Center with working UNO
  when omitted. Explicit in-application saving remains available.
- Update `golang.org/x/mod` to `v0.40.0` with its BSD notice and retain source
  and binary vulnerability checks.
- Require test ownership checks before cleaning up singleton instances. A local
  rc.3 post-deployment test stopped an existing Edge singleton; the failed
  preservation evidence is retained and is not reclassified by UAT acceptance.

## 0.5.4 — 2026-09-10

Target: `0.5.4`.

- Implement zero-byte clipboard representation normalization and observable
  skipped/no-op results in Core and SDK `0.22.0`, preserving nonempty formats,
  whitespace, destination contents on rejection, and explicit HTML fallback.

- Lock the clipboard empty-content fix train (CLP-030–CLP-034):
  zero-byte normalization, no-op semantics, explicit HTML fallback policy,
  atomic validation, and rebound-safe fingerprints. Candidate implementation
  and automated acceptance passed; Human UAT is accepted and the train closed.

- Document DEP-016: all future local deployments retain IPv4 loopback-only
  Manager listeners (production `127.0.0.1:1991`, test `127.0.0.1:2992`),
  superseding historical wide-test overrides without changing sandbox policy.

## 0.5.3 — 2026-09-08

Target: `0.5.3`.

### Fixed

- RTM-017: pinned runtime restart/recovery now checks reusable loopback binding
  for the existing App control port, avoiding false rejection of reusable
  TIME_WAIT sockets. Fresh allocation and cross-runtime ownership checks remain
  strict; live listeners and non-reusable sockets remain blocked.

- FFX-007: restore interactive Firefox IME input while retaining BiDi by
  explicitly disabling automation focus test mode in the Firefox profile.
  Shipped as `firefox-esr@2.1.1`; existing runtimes remain pinned until
  explicitly recreated. See the [release train](docs/firefox-ime-fix-release.md).

### Documentation

- Clarify in SDK source and design documentation that `sendText()` is an
  IBus text commit, not keyboard simulation: password fields and other
  direct-keyboard-only widgets require the RFB keyboard path. Runtime behavior
  is unchanged; a successful commit ACK does not guarantee application insertion.

## 0.5.2 — 2026-09-04

Target: `0.5.2`.

### Fixed

- The Release workflow now installs the `ripgrep` dependency required by its
  fail-closed release-archive sensitive-data check. This closes the only
  automation gap observed while publishing the accepted prerelease.
- The release metadata gate now accepts the current version in its finalized
  changelog section, allowing `Unreleased` to return to an honest empty state
  before an immutable stable tag is created.
- The Linux cgroup observer now wakes and joins its reader during shutdown,
  preventing leaked readers and intermittent missed-event regressions across
  repeated manager/test lifecycles.

### Validation

- Promoted the Human-UAT-accepted `v0.5.2-rc.1` runtime behavior without
  gateway, SDK, App Package, template, driver, or generated-asset changes. A
  gate-discovered Manager observer-shutdown resource leak is corrected and
  covered by repeated lifecycle tests. Stable publication is authorized;
  deployment remains a separate approval.

## 0.5.2-rc.1 — 2026-09-04

Target: `0.5.2-rc.1`.

### Security

- Production builds now require Go `1.26.8`; source and all four packaged
  binaries must pass the pinned `govulncheck` gate, and module checksums plus
  tidy state must be exact. GitHub Actions are pinned by full commit SHA.

### Changed

- Pull-request verification now enforces non-regressing Go/SDK coverage, while
  a nightly reliability workflow runs race, shuffled repeat, and bounded fuzz
  gates.
- Hosted test jobs install the Xvfb, X clipboard, D-Bus, and Clipman
  dependencies needed to run the existing X11 integration suite instead of
  silently lowering coverage when those tests skip.
- The Clipman integration test now uses the same session-manager-disabled
  launch mode as the production XFCE App, allows a bounded hosted cold start,
  and cleans up its complete private D-Bus process group.
- X11 integration tests ask Xvfb to allocate displays atomically instead of
  racing on a scan-then-bind display number during repeated and race gates.
- A candidate workflow builds and validates the release archive once. The tag
  workflow publishes only those unchanged, checksum- and commit-verified bytes
  and rejects lightweight, mismatched, or historically moved tags.
- The fixed-name SARIF report produced by the hosted Gitleaks action is ignored
  so it cannot falsely mark otherwise clean candidate binaries as modified.
- Candidate uploads use the full-SHA-pinned Node 24 generation of GitHub's
  artifact action, eliminating its hosted Node 20 deprecation fallback.
- Production builds require embedded VCS metadata instead of silently omitting
  it when repository discovery fails.
- Deployment shell syntax checking now covers every tracked shell script.

### Added

- Added a versioned evidence envelope, a generated current-source identity
  page, three boundary fuzz targets, and a candidate artifact verifier.

### Validation

- Exact commit `2e0dbbd87629fa034148a83d71f0ccf71fb13aca` passed hosted Verify
  and Candidate workflows, independent archive identity and sensitive-data
  checks, synthetic App Package ABI E2E, and the Edge, Firefox ESR,
  LibreOffice, and Mousepad real-App E2E. Human UAT was accepted on
  2026-09-04.
- Annotated `v0.5.2-rc.1` was published as a GitHub prerelease using the
  accepted archive with SHA-256
  `41ec9cbd58a09b0306c2bdca7d911a08fff8bc08b0803c6a4f5eb6ef8b04ae35`.
  The automated Release job verified candidate identity but lacked `ripgrep`;
  the unchanged artifact was published only after the same archive passed the
  local fail-closed sensitive-data check and post-publication download
  verification.

## 0.5.1 — 2026-09-03

Target: `0.5.1`.

### Fixed

- SDK `0.21.1` prevents a successful rich remote-to-local browser write from
  rebounding once as a false local-to-remote prompt when the browser omits,
  falls back, reorders, or normalizes representations.
- The optional prompt stack remains top-aligned and content-height under
  ordinary host wildcard child-sizing CSS instead of obscuring the Viewer.

### Changed

- Clipboard prompts use high-contrast direction cues: orange-red/up for
  local-to-remote and blue/down for remote-to-local, with explicit text and
  accessible state styling.

### Validation

- Promoted the Human-UAT-accepted `v0.5.1-rc.1` behavior without functional,
  SDK, App Package, template, driver, dependency, or generated-asset changes.
  Stable `v0.5.1` passed both hosted workflows and independent artifact
  verification. Its exact formal bytes were aligned to local 1991/2991,
  test-host-a 1991/2991, and test-host-c/03/07/10 production 1991 with unchanged
  policy, App selectors, and runtime identities and with clear warning logs.

## 0.5.1-rc.1 — 2026-09-03

Target: `0.5.1-rc.1`.

### Fixed

- SDK `0.21.1` prevents a successful rich remote-to-local browser write from
  rebounding once as a false local-to-remote prompt when the browser omits,
  falls back, reorders, or normalizes representations. Reconciliation is
  serialized with the write, and suppression remains local to one Client.
- The optional standard prompt stack retains content height when ordinary host
  CSS sizes every direct Viewer child, so it no longer becomes a full-screen
  input-blocking overlay.

### Changed

- Clipboard prompts now identify local-to-remote with orange-red/up cues and
  remote-to-local with blue/down cues. Success, failure, and expiry retain
  explicit direction text and use accessible distinct state colors.

### Documentation

- Scope-locked CLP-025 through CLP-029 for RemoteXApp `0.5.1-rc.1` / SDK
  `0.21.1`, including complete automated/local E2E validation and deployment to
  local 1991/2991. Human UAT was accepted on 2026-09-03 and formal GitHub
  prerelease publication authorized; sandbox rollout remains separately
  controlled.

### Validation

- Passed `make release-ci`, including 78 SDK subtests, Go/App tests, race, vet,
  sensitive-data, immutable staging, rollback, and packaging. The isolated
  real-browser App catalog passed two-Viewer Mousepad and LibreOffice rich
  clipboard rebound and wildcard-CSS prompt checks. Exact commit `b6e6b2fb19e4`
  was deployed to local 1991 and 2991; both passed the same post-deployment
  two-Viewer matrix with matching SDK asset hashes and clear warning logs.
  Human UAT was accepted on 2026-09-03.
- Published annotated `v0.5.1-rc.1` as a GitHub prerelease after both hosted
  workflows passed. The independently downloaded archive matched its attached
  checksum, embedded release commit and SDK/assets, passed the sensitive-data
  scan, and validated all five App Package checksums and seals. No sandbox was
  changed.

## 0.5.0 — 2026-09-03

Target: `0.5.0`.

### Added

- Added a multi-window Unified Console with independent Client, clipboard,
  diagnostics, connection and cleanup state in every Viewer window. It supports
  concurrent same- and different-runtime Viewers, move, resize, minimize,
  `Ctrl+F6` switching, and target-scoped controls; closing a Viewer does not
  stop its runtime.

### Changed

- SDK `0.21.0` gates local-to-remote clipboard detection on each Client's own
  real input focus. Inactive Clients keep their configured mode but do not
  read, fingerprint, or prompt. Activation reconciles once, background RFB
  connection cannot claim activity, and loop suppression remains local to the
  Client. Remote-to-local all-Viewer fanout is unchanged.

### Validation

- Passed `make release-ci`, including all 74 SDK subtests, Go/App tests, race,
  vet, sensitive-data, packaging, preflight, and offline upgrade/rollback
  gates. A real headed Chrome three-Viewer test passed inactive suppression,
  focus handoff, background connection, per-Client loop control, remote fanout,
  multi-window controls and Viewer-only close on local 1991. Local 2991 passed
  real Firefox RFB/input, dynamic resize, and reconnect with its Console-disabled
  kiosk policy. Both local managers run the exact candidate, and Human UAT was
  accepted on 2026-09-03 with formal GitHub prerelease publication authorized.
- Published annotated `v0.5.0-rc.1` after both hosted workflows passed. The
  independently downloaded archive matched its attached checksum, embedded
  commit and SDK/assets, passed the sensitive-data scan, and validated all five
  App Package checksums and seals.
- Accepted rc.1 without functional changes as the stable `0.5.0` release
  candidate. SDK `0.21.0`, App Package ABI V1, the five-App catalog, and all
  generated assets remain unchanged; deployment follows formal publication.
- Published `v0.5.0` as the normal Latest GitHub release after both hosted
  workflows and independent artifact verification passed. The exact formal
  archive was deployed to local 1991/2991, test-host-a 1991/2991, and
  test-host-c/03/07/10 production 1991; all eight endpoints passed version,
  binary, catalog, policy, runtime-adoption, and warning-log checks.

## 0.4.0 — 2026-09-02

Target: `0.4.0`.

### Added

- Added generation-qualified streamed clipboard APIs and an owner-only
  per-runtime Go X11/XFixes bridge for bounded plain-text, HTML, RTF, and PNG
  transfers in both directions. Remote changes are announced to every Viewer
  through reliable metadata events; bodies remain outside WebSocket and RFB.
- Added SDK `0.20.0` `client.clipboard` manual, prompt, and permission-dependent
  automatic policy, explicit-item sends, reconnect recovery, source-Viewer
  loop suppression, and the optional newest-first Yes/X prompt stack. The
  Unified Console exposes the same public API for UAT.
- Added side-effect-free `client.clipboard.checkAccess()` and explicit
  user-activated `requestReadAccess()` SDK methods. Read authorization discards
  content without decoding, returning, uploading, or writing it back; write
  access remains verified only by a real `syncToLocal()` operation.

### Security

- Clipboard content is transient, generation-scoped, size/type validated, and
  excluded from logs, status, manifests, diagnostics, and browser storage.
  Public unauthenticated listeners require the existing explicit insecure
  testing opt-in; normal deployments require same-origin authenticated HTTPS.

### Fixed

- Decoupled the 60-second offer/API lifetime from the active remote X11
  selection. The current bounded in-memory selection remains pasteable until
  replacement or session cleanup, and clean cancellation now holds an empty
  selection owner instead of allowing XFCE Clipman to replay stale text over a
  newer PNG image.
- Serialized offer response snapshots with asynchronous X11 request-state
  updates, eliminating a race exposed when Clipman requests newly owned
  content immediately.

### Validation

- Passed `make check`, including sensitive-data and generated-asset checks,
  all 68 SDK subtests, all Go/App tests, `go vet`, and deployment architecture
  validation. Focused permission tests prove that inspection performs no
  clipboard operation and authorization starts the read before any permission
  query, never decodes or writes content, and returns structured failure state.
  An exact rc.3 isolated loopback build also passed real-Chromium permission
  inspection and direct-click read authorization without changing the clipboard.
- Passed the complete release gate, 59 SDK tests, Go race/vet, uncached Xvfb
  normal and `INCR` transfers, isolated real-browser coverage for all four
  application Apps, and full two-Viewer XFCE validation on local port 1991.
  Human UAT was accepted on 2026-09-02 and formal GitHub publication was
  explicitly authorized. The subsequent operator-authorized rollout aligned
  local 1991/2991, both test-host-a environments, and test-host-c/03/07/10.
- Passed dedicated no-Clipman repeat-paste and generation cleanup tests, three
  consecutive real Clipman stale-replay tests including gateway exit, and a
  live XFCE/Clipman check past the complete 60-second offer lifetime. The
  expired offer list was empty while the current PNG remained exact and
  pasteable, with no old text target.
- Published annotated `v0.4.0-rc.3` as a GitHub prerelease after both hosted
  workflows passed. The independently downloaded archive, checksum, embedded
  commit and SDK, App Package checksums, and sensitive-data scan were verified.
- Accepted rc.3 without functional changes as the stable `0.4.0` release
  candidate. The stable tag retains SDK `0.20.0`, App Package ABI V1, and the
  exact five-App catalog; no deployment is included in the promotion.
- Published annotated `v0.4.0` as the normal Latest GitHub Release. Both hosted
  workflows passed, and the independently downloaded archive, checksum,
  embedded revision/SDK, App Package checksums, and sensitive-data scan were
  verified.

### Documentation

- Scope-locked CLP-001 through CLP-017 as the `0.4.0-rc.3` / SDK `0.20.0`
  bidirectional rich clipboard release train. The train defines streamed Manager offer APIs, a
  pure-Go per-runtime X11/XFixes bridge, remote-change broadcast to every
  Viewer, independent manual/prompt/automatic SDK policy, focus reconciliation,
  a newest-first prompt stack, feedback-loop suppression, and a non-persistent
  Unified Console validation surface for both directions and every mode.
  Implementation, complete automated and local E2E validation, and local port
  1991 UAT deployment were authorized. Human UAT, formal GitHub rc.3 and stable
  `v0.4.0` publication, and the operator-authorized stable fleet rollout are
  complete.

## 0.3.0 — 2026-09-02

Target: `0.3.0`.

### Changed

- Firefox ESR App Package `2.1.0` uses a 16-bit framebuffer. Its dynamic
  1280x720 display, 5 FPS, client resize, shared profile, six-hour detached
  lifetime, and loopback WebDriver BiDi contract are unchanged.

### Fixed

- A failed core selection requested with `--start` now restarts and verifies the
  restored release even when the operator deliberately stopped the service
  before beginning the paired core/App transition.

### Removed

- Retired the unused `xfce-desktop` App Package and public template ID. Upgrade
  tooling removes only this explicitly retired shipped selector, refuses while
  durable runtime or managed-instance references remain, and preserves
  independently installed Apps. The supported `xfce-user-desktop` template is
  unchanged.

### Documentation

- Scope-locked CAT-001 through CAT-008 for implementation, complete automated
  and local port-1991 E2E validation, and deployment to local port 1991 for
  Human UAT. No sandbox deployment, tag, or GitHub publication is authorized.
- Recorded the exact rc.1 release gates, full five-App E2E, real
  0.2.0/0.3.0 upgrade and rollback, failure recovery, and final local Firefox
  and user-home Desktop validation. Human UAT was accepted on 2026-09-02 and
  formal GitHub publication was explicitly authorized.
- Published annotated `v0.3.0` as the normal Latest GitHub release after the
  hosted release gate passed; the downloaded archive, checksum, embedded
  commit, sensitive-data scan, and exact five-App catalog were verified.

## 0.2.0 — 2026-09-01

Target: `0.2.0`.

### Fixed

- Installed the `ripgrep` dependency in the GitHub Verify workflow so the
  mandatory sensitive-data gate can run on clean hosted runners.
- Fixed system-release rollback to accept retained legacy releases that predate
  the optional operator helper and its manager flag. New releases carry a
  strict executable manifest and still fail closed when any declared binary is
  missing; service-restart policy now reaches current user-mode managers through
  their environment without making the shared systemd unit incompatible with
  rc.5.

### Added

- Added one unified operator console bundle behind the existing root, SDK
  console, minimal-launcher, and per-instance kiosk entry routes. Its generic
  template forms support declared parameters, profiles, and allowed overrides;
  its dashboard exposes managed registrations, runtimes, resources, bounded
  application status, viewer diagnostics, graceful/forced stop, and restart.
- Added generation-qualified runtime restart to the manager API and SDK 0.18.
  The server preserves runtime identity, parameters, profile, overrides,
  monotonic session generation, locked App/core snapshot, and allocated ports;
  a durable running manifest covers restart crash and creation-failure windows.
- Fixed same-ID singleton and user-home conflict detection found by the rc.6
  local E2E. Recovery now ignores only the in-memory record it is replacing,
  while retaining every cross-runtime ownership and allocation conflict.
- Fixed the empty-root prefix case found by rc.7 browser E2E so the root, SDK,
  kiosk, and reverse-prefixed compatibility entries all resolve the one console
  loader instead of constructing a nested URL.
- Fixed the Unix helper request framing found by rc.8 real-systemd E2E. The
  manager now half-closes its request stream after the single JSON object so
  the strict helper can prove EOF and return its operation response.
- Added the optional `remotexapp-operator-helper` for authenticated user-service
  restart. It uses an owner-only Unix socket, same-UID peer verification, one
  fixed `remotexapp.service` allowlist entry, idempotent operation IDs, rate
  limiting, bounded errors, and observable asynchronous status.

### Changed

- Reworked operator navigation around ownership rather than raw API resources.
  A managed application now appears once with its runtime nested under runtime
  details; only standalone temporary runtimes remain in the separate runtime
  list. Explicit `Open standalone and connect`, `Create managed application and
  connect`, `Start and connect`, `Connect`, and `Reconnect` labels distinguish
  creation, desired-state transitions, and viewer attachment.

### Security

- Service restart is disabled by default, unavailable in `auth-mode=none`, and
  excluded from dedicated system-service mode. The mutating endpoint requires
  trusted proxy identity, same-origin enforcement, and an explicit console
  confirmation header; neither the browser nor manager supplies a unit or
  command. Kiosk mode contains no lifecycle or operator actions.
- The unified console remains App-neutral and never automatically retrieves,
  stores, logs, exports, or places the EXP-007 environment in a URL.

### Documentation

- Scope-locked CON-001 through CON-010, now targeting `0.2.0-rc.10`, with implementation,
  complete local release validation, and deployment only to local port 1991.
  No sandbox deployment is authorized. Human UAT was accepted on 2026-09-01.
- Scope-locked the stability-only `0.2.0` train with SDK `0.18.0` and App
  Package ABI V1 unchanged. Its remaining UAT, issue-closure, documentation,
  compatibility, release, local, separately approved test-host-a, publication,
  and formal-artifact gates are explicit; no sandbox deployment or publication
  is authorized by the lock itself.
- Completed the stable-positioning audit across README, security, commercial,
  handover, integration, browser SDK, operations, and release policy. Historical
  rc identifiers remain only where they identify real artifacts, evidence,
  deployments, or rollback targets. GitHub Issues #4 and #5 were the only open
  blockers and were closed after exact stable-candidate evidence was attached;
  all experimental and deferred requirements remain outside the stable
  compatibility promise.
- Confirmed provider-side host application compatibility: App Package ABI V1, its parser,
  and all six App sources are unchanged from accepted rc.4; SDK 0.18 is an
  additive manager API over the unchanged viewer/input client. The isolated
  build-once package install, update, adoption, disable, and rollback gate
  passed without a host application build or core rebuild.
- Passed the first clean stable candidate gate on Ubuntu 24.04 linux/amd64:
  `make release-check`, `make release-ci`, race, preflight, immutable staging,
  archive inspection, and all six embedded App checksums. Repeated packaging
  produced the same candidate SHA-256; the final evidence commit must repeat
  the publication gate before tagging.
- Activated the immutable stable candidate locally through an rc.10
  upgrade/rollback/upgrade cycle and passed all six App, browser SDK, fixed
  scaling, reconnect, logout/relaunch, graceful/forced shutdown, and cleanup
  paths. Exact Issue #4 and #5 abnormal recovery retained their required
  profile or runtime identity without a restart loop; no sandbox was changed.
- Completed the separately approved replacement test-host-a automated staging
  gate: rc.5 upgrade/rollback, runtime adoption, EXP-007 policy, four App
  control/lifecycle probes, and managed logout/gateway recovery passed. The
  original rc.5 selectors and unit were restored before the separately
  approved production activation.
- Activated the same checksum-verified candidate on test-host-a after separate
  production approval. The managed Desktop identity, generation, and child
  processes were adopted without restart; health and production surface smoke
  checks passed.
- Recorded explicit Human UAT acceptance for Firefox ESR/WebDriver BiDi and
  LibreOffice/UNO/document launch, control, input, reconnect or relaunch,
  explicit-save boundary, destructive stop, and lock cleanup. Formal stable
  publication was separately authorized.

## 0.2.0-rc.5 — 2026-08-31

Target: `0.2.0-rc.5`.

### Fixed

- Managed reconciliation now recreates an unhealthy runtime with its existing
  runtime ID and locked snapshot. Unit cleanup failures stop replacement, and
  a failed creation remains bound to the same manifest for deterministic retry
  instead of leaving a second active record.
- Startup repairs duplicate managed runtime manifests left by pre-rc.5
  replacement. It preserves a unique live application, otherwise selects the
  managed pointer, a uniquely healthy runtime, or the newest recoverable
  snapshot, then retires only verified stale runtime state. Ambiguous multiple
  live applications continue to fail closed.

### Documentation

- Scope-locked the Issue #5 recovery train to RTM-010, core manager lifecycle
  behavior, abnormal-restart regression coverage, and test-host-a production
  validation before separately approved follower promotion. It does not change
  the SDK, App Package ABI, templates, drivers, host application, or network policy.
- Recorded exact local and test-host-a production evidence: real cgroup gateway
  failure recovered under one ID/manifest with no manager restart, followed by
  successful restart adoption.
- Recorded the separately approved follower deployment and all-runtime
  restart. Rc.5 repaired real duplicate-manifest restart loops on test-host-h
  and test-host-k, all four followers converged to one manifest per runtime, and
  final services reported zero restarts and warning-level entries.
- Published `v0.2.0-rc.5` as a GitHub prerelease and aligned test-host-a,
  test-host-c, test-host-d, test-host-h, and test-host-k to the checksum-verified formal
  archive. The prior same-commit candidate trees remain available for audit;
  Human UAT remains pending.
- Aligned local port 1991 to the same formal archive, gracefully recreated its
  managed user-home and isolated XFCE runtimes, and replaced the remaining
  `edge-browser@2.0.0` selector with the formal `edge@1.0.0` App Package.

## 0.2.0-rc.4 — 2026-08-30

Target: `0.2.0-rc.4`.

### Added

- Added App Package ABI v1: strict `remotexapp/v1` manifests, deterministic
  checksummed archives, immutable side-by-side installation, atomic activation,
  dependency checks, bounded readiness/status policy, and package-pinned runtime
  adoption. An ordinary trusted App can now be installed or upgraded after the
  three core binaries and SDK have already been built.
- Added generic named loopback TCP resources and bounded JSON status details.
  Microsoft Edge owns the reference CDP implementation; Firefox ESR owns BiDi,
  LibreOffice owns UNO, Mousepad proves no-control operation, and both XFCE Apps
  retain their fixed-display and `user-home` contracts.
- Added package/install/manage commands plus the build-once synthetic-package
  E2E gate and independent tests under each shipped `apps/<id>/tests/` tree.
- Added a fail-closed system core-release selector for dedicated and central
  real-user deployments. It stops the manager before switching both immutable
  core selectors and restores the previous pair and service state if startup
  or exact health verification fails.
- Added selector-free system release staging for coordinated upgrades. It
  publishes and validates immutable core and shipped App Package bytes without
  changing configuration, units, service state, core selectors, or enabled App
  selectors; exact restaging is idempotent and version-content drift fails.
- Added verified core selection: every selection that starts a manager requires
  a health endpoint, validates the target, and validates the previous version
  after an automatic restore.
- Added the independently deployable `edge@1.0.0` shared singleton with a
  persistent `default` profile, six-hour detached instance cleanup, dynamic
  loopback CDP allocation, and visible-window plus live-CDP readiness. It
  supersedes the `edge-browser` selector without changing RemoteXApp core or
  SDK artifacts.

### Changed

- Keep installed service commands compatible with retained pre-App-Package
  binaries by supplying V1 catalog/helper paths through environment defaults,
  so a core rollback can atomically repoint the existing `current` selectors.
- Fixed immediate fixed-display restart after browser disconnect by treating a
  gateway port in TCP `TIME_WAIT` as closed while retaining conservative
  bindability checks for arbitrary package-owned control ports.

- SDK 0.17 and the major HTTP projection replace protocol-specific top-level
  control fields with `instance.resources` and opaque
  `applicationStatus.details` JSON. There is no legacy public-field fallback;
  downstream protocol adapters must validate current generation, loopback
  allocation, status agreement, and their own endpoints.
- System and user installations now publish core releases immutably under
  versioned `releases/` directories. App Packages remain independently
  versioned and activated outside the core release selector.
- Override policy, readiness budgets, and executable/Python dependencies are
  manifest-owned and enforced through template-independent core paths.

### Fixed

- Release CI source-package and offline-staging tests now provide hermetic
  fixtures only for declared App executable and Python dependencies, while
  live catalog loading and preflight retain real dependency enforcement. The
  sensitive-data gate now requires `rg` and fails closed when it is unavailable.
- App Package archives now use a canonical default timestamp, so unrelated
  core commits do not change unchanged package bytes. Reinstalling the same
  version and content is idempotent even for a pre-canonical archive, while
  different content under an existing driver version still fails closed.
- Dynamic port allocation no longer treats a TCP `TIME_WAIT` socket as free.
- A blocked graceful shutdown now converges when the application exits before
  host enforcement runs.
- Core selection now allows the manager's locked runtime recovery to complete
  within a configurable 1–600 second health budget (120 seconds by default)
  instead of falsely failing every cold recovery that exceeds ten seconds.

### Documentation

- Scope-locked EDGE-001 through EDGE-004 as the `edge@1.0.0` App Package
  release train. It fixes the Microsoft Edge template ID as
  `edge`, preserves the existing shared singleton/profile/six-hour/CDP
  behavior, supersedes `edge-browser` without concurrent selectors, and keeps
  the implementation outside RemoteXApp core and SDK. Implementation, local
  verification, and deployment on test-host-a/02/03/07/10 are authorized; other
  sandboxes are excluded.
- Recorded test-host-a production activation of the exact `edge@1.0.0` archive,
  including independent selector migration, unchanged core/runtime identity,
  real viewer/CDP acceptance, cleanup, and the exclusion of every other
  sandbox.
- Published GitHub prerelease `v0.2.0-rc.4` and the independent stable App
  Package release `edge-v1.0.0` from the same accepted commit. The core archive
  embeds the exact independently checksummed Edge archive.
- Promoted the formal core archive and embedded Edge release to test-host-c,
  test-host-d, test-host-h, and test-host-k. All four passed real viewer/CDP,
  resize/reconnect, cleanup, restart-adoption, selector/seal, and fleet hygiene
  checks without changing test-host-a, host application, existing user profiles, or network
  policy.

- Scope, ABI ownership, downstream host application migration, release gates, and the
  explicitly deferred lifecycle redesign are recorded in the App Package major
  release design. APP-008 remains deferred.
- The downstream integration task cross-repository plan now assigns RemoteXApp provider and host application
  consumer ownership, classifies independent versus paired changes, freezes a
  checksummed handoff tuple, invalidates downstream evidence on tuple drift,
  and requires stopped-consumer activation plus two-direction paired rollback
  so no mixed ABI pair is served. The host application classifies the breaking migration as
  `staging-required`, tags its immutable candidate before its first live
  activation, and keeps test-host-a staging and production separately
  approval-gated.
- Breaking-major rollback now restores the pre-upgrade root/Home state snapshot
  before selecting the old pair. Older managers are never started on
  forward-written incompatible state, and post-snapshot changes are explicitly
  outside the downgrade guarantee.
- After separate operator approval, the exact `0.2.0-rc.4` artifact from
  `b21524c08d6e` (release SHA-256
  `9466197d170b9aa9c75a39711c6b5847e3764a5a6c0bc39c375071d3d8234a99`)
  was activated on test-host-a production with host application v2.0.91. All six V1 App
  Package selectors/templates, exact version/commit and SDK graph, managed
  Desktop adoption, service health, and read-only direct access checks pass.
  The stopped-consumer rollback pair is
  `webagenticos-v2.0.91-paired-20260830T190100Z-{root,home}` and preserves the
  prior rc.24/host application v1.0.88 pair. The operator accepted Human UAT on
  2026-08-30 and then explicitly approved ordered follower deployment. The
  byte-identical rc.4/host application v2.0.91 pair was activated on test-host-c,
  test-host-d, test-host-h, and test-host-k, in that order, after matched root/Home
  snapshots with base `webagenticos-v2.0.91-preprod-20260830T191230Z`. Their
  managed Desktop runtimes were intentionally stopped and recreated at the
  package-major boundary; all are server-ready on driver 2.0.0. Exact core/SDK
  provenance, all six package selectors, service health, configured roots,
  hygiene, and unchanged host application session identities pass. test-host-k's first
  remote storage root read transiently returned 503 while the mount reported
  `reading`; it recovered without service or mount changes and the complete
  repeated gate passed. No production-gateway or mutating application E2E was
  run.

## 0.1.0-rc.24 — 2026-08-29

Target: `0.1.0-rc.24`.

### Fixed

- EXP-007 environment lookup now honors the administrator's explicit
  `allow-insecure-public` opt-in. A non-loopback `auth-mode=none` manager still
  refuses to start without that opt-in, and direct unit construction without
  it still returns `403`; when enabled, the named environment operation is
  available through the same deliberately insecure sandbox API surface.

## 0.1.0-rc.23 — 2026-08-29

Target: `0.1.0-rc.23`.

### Added

- Added the generation-qualified
  `POST /api/instances/{id}/status/environment` operation and SDK 0.16
  `getApplicationEnvironment()` method. They return the validated canonical
  session owner's complete environment and working directory without executing
  a caller-selected command or exposing a PID.

### Documentation

- Proposed EXP-001 through EXP-006 and documented a test-host-a-only,
  default-disabled experimental status-command request for host application environment
  discovery. The design explicitly treats structured custom argv as same-UID
  remote execution, binds it to an active session generation, bounds and
  contains execution, prohibits command/output persistence and requires a
  security checkpoint before removal, operator isolation or replacement with
  named probes. No implementation or deployment is included.
- Accepted EXP-007: every template's existing `session.readinessPid` is the
  generic canonical environment-process contract. Environment lookup must use
  the validated live process and `/proc` rather than manager reconstruction,
  persisted snapshots or template-specific branches. This is a required
  implementation and six-template validation gate for the rc.23 release train;
  both gates now pass locally on port 1991.
  Its named manager endpoint and SDK method return instance/generation/state,
  the complete environment map and working directory, without exposing a PID
  or executing a caller-selected command. Because the complete result can
  contain secrets, unauthenticated non-loopback listeners reject the operation.

### Changed

- All six shipped templates now publish their stable session-owner process as
  the canonical environment source. Application PIDs remain private to each
  versioned shutdown bundle; this keeps the manager generic and handles apps
  such as Edge that overwrite their own procfs environment memory.

### Fixed

- Shipped manager units no longer create a filesystem mount namespace, which
  prevented the non-root manager from reading the validated same-UID canonical
  session process environment required by EXP-007. Non-mount service hardening,
  including `NoNewPrivileges` and the system service's empty capability set,
  remains enabled.

## 0.1.0-rc.22 — 2026-08-29

Target: `0.1.0-rc.22`.

### Fixed

- A managed instance already in `shutdown-blocked` now honors a later
  `force:true` desired-stop request, bypasses the graceful hook, and converges
  durably to `stopped` instead of preserving the blocked runtime indefinitely.
- Manager restart now adopts a managed runtime whose normal desired-stop is
  blocked, preserving the live application for reconnect or an explicit force;
  a runtime with an already durable forced-stop intent still finishes cleanup.

## 0.1.0-rc.21 — 2026-08-29

Target: `0.1.0-rc.21`.

### Added

- SDK 0.15 adds caller-controlled remote-resize scheduling through
  `resizeDebounce`, `resizeMaxWait`, and `flushResize()`. Declarative viewers
  expose matching attributes; initial negotiation stays immediate while a
  delayed resize locally scales the previous framebuffer.
- The `firefox-esr` template now enables Firefox's native WebDriver BiDi
  endpoint on one allocated loopback port. Instance and driver-status responses
  return `controlAddress`, `controlPort`, and `controlWebSocketUrl` for trusted
  same-host automation.
- SDK 0.14 declares the generic `webdriver-bidi` control contract and the new
  per-instance endpoint fields.
- Added the `firefox-esr` unmanaged singleton template. It starts Firefox on
  first attachment, reuses the persistent `default` shared profile, and stops
  the complete dynamic runtime after six hours without a client.
- Added the `libreoffice` temporary template: an isolated dynamic 1280x720
  depth-16 display at 10 FPS, client resize support, and whole-instance cleanup
  after 60 seconds vacant.
- SDK 0.13 adds manager-validated `file` launch parameters constrained to
  administrator-owned document roots, plus a persisted per-instance
  loopback-only LibreOffice UNO port returned as `controlPort`.

### Fixed

- Primary mouse, touch, and pen activation now makes its click position an
  effective native IME anchor before a fresh remote caret is available. Right
  and middle buttons no longer replace the fallback, and neither click nor
  caret correction interrupts composition or queued/in-flight text.
- LibreOffice driver 2.0.1 serializes launches of the same canonical document
  with an owner-PID lease, rejects files held by another local process, recovers
  dead leases, and removes only locks owned by its session. Concurrent launch
  failures now retain the precise driver error instead of risking another
  session's document lock.
- Complete instance shutdown now removes the per-runtime directory for both
  persistent and ephemeral workspaces while preserving a persistent profile,
  preventing stale runtime data from accumulating across Firefox recreations.
- Deployment preflight now requires the `firefox-esr` executable and identifies
  the package without assuming that every Ubuntu installation enables the same
  package source.
- LibreOffice now repeats file readability/open validation immediately before
  launch, removes the exact stale document lock, and fails before starting the
  application when the file or lock cannot be used.
- Current-generation driver errors now end session-readiness waiting promptly
  and retain the driver's cause instead of waiting 20 seconds and replacing it
  with a generic timeout. Stale-generation errors cannot end a new startup.
- LibreOffice now uses a dedicated destructive shutdown driver. Normal stop
  kills the readiness process without opening a save prompt and removes the
  document lock, so an unsaved application cannot retain the temporary runtime.
- Deployment preflight now requires `matchbox-window-manager`, `jq`,
  LibreOffice, and Python UNO bindings used by shipped single-application
  drivers, and reports the corresponding Ubuntu packages when one is missing.
- Manager restart no longer enters a fixed-display collision loop when an
  anonymous autostart runtime has surviving transient units. Healthy recorded
  runtimes are adopted before template autostart.
- Forced anonymous stop now aborts before process teardown when stopped intent
  cannot be written durably. Graceful stop durably records its application
  request before invoking the driver, then records stopped intent before server
  teardown, preventing unsafe crash-time resurrection or data loss.

### Changed

- The LibreOffice template's public `name` is now exactly `libreoffice`, matching
  its stable template ID and deployment-facing contract.
- LibreOffice driver 2.0.0 starts its session during instance creation, reports
  profile/input/application/document loading stages, initializes a minimal
  portable profile seed, and returns only after the requested document reaches
  visible-window and UNO readiness. Its dynamic 1280x720, depth-16, 10 FPS,
  client-resizable display contract is unchanged. The major driver bump marks
  the incompatible normal-stop data-loss policy; existing runtimes remain
  pinned to their previous driver until an explicit stop/start transition.

- Managed and anonymous active runtimes now share a versioned, private JSON
  manifest database. Managed registrations retain only desired state and a
  runtime reference.
- Manager restart now health-checks and adopts both managed and anonymous
  active runtimes from their locked manifests. Runtime IDs, unit PIDs, session
  generations, and running applications remain intact; browser connections
  use normal SDK reconnection.
- An incomplete or unhealthy recorded runtime without a live application is
  stopped and recreated with the same ID from its locked template and component
  snapshot, never from the newly loaded catalog. A live application is
  preserved for graceful host policy. Applying a new driver remains an explicit
  runtime stop/start transition.
- Restart adoption restores managed/session cgroup observation, blocked
  shutdown policy, clean-exit persistence, and vacancy timers while resetting
  transient attachment counts.
- The first restart automatically converts embedded managed runtime snapshots
  and removes pre-manifest anonymous runtime state while preserving profiles.
- For one rollback window, managed records retain a non-authoritative copy of
  their former runtime fields so the exact rc.15 manager can safely read and
  adopt a healthy managed runtime; unified manifests remain current authority.

### Security

- Application control configuration now accepts only the exact loopback
  address `127.0.0.1`. Firefox BiDi uses its fixed `/session` path, is never
  routed by the RemoteXApp gateway, and readiness requires a real WebSocket
  handshake plus a successful BiDi `session.status` command.
- Firefox automation guidance now requires `session.end` before closing the
  WebSocket. If an automation process dies while owning Firefox's single BiDi
  session, normal instance stop/recreate clears it while preserving the shared
  browser profile.

### Validation

- The LibreOffice 2.0.1 sandbox candidate passed normal startup, same-document
  RemoteXApp contention, dead-lease and stale-lock recovery, and contention
  with a live 2.0.0 session. Both conflicts returned their driver error in less
  than one second, the existing application remained ready, and every candidate
  runtime, profile, port, lock, and lease was removed after force stop.
- The sandbox LibreOffice 1.1.0 candidate passed stale and unremovable lock
  cases, file removal/readability races, unsaved UNO modification with a
  byte-identical source after normal stop, exact process/port cleanup, and five
  immediate create-to-ready runs averaging 9.020 seconds. Profile seeding made
  no measurable speed improvement and is not presented as one.
- The formal LibreOffice 2.0.0 repository build passed isolated real-systemd,
  Chrome/noVNC, dynamic resize, SDK reconnect, UNO exact-document readiness,
  unsaved destructive stop, symlink replacement, unremovable lock, and complete
  resource-cleanup checks on local port 2099. Human application UAT remains.
- The rc.19 isolated Firefox ESR candidate used a real Chrome/noVNC client to
  start the on-attach session, verified that BiDi listened only on
  `127.0.0.1`, completed `session.new`, context discovery, script evaluation,
  and `session.end`, preserved the Firefox PID and control port across manager
  restart, and released the listener on graceful stop.
- The rc.18 isolated Firefox ESR candidate used a real Chrome/noVNC client to
  verify visible-window readiness, stable version-independent WM_CLASS,
  mixed ASCII/Chinese input, resize, SDK reconnect, manager restart adoption,
  graceful API stop, user Alt+F4, singleton reuse, persistent-profile reuse,
  and both detached and never-attached whole-instance idle cleanup.
- The rc.17 sandbox central real-user deployment exposes port 1991 on all
  interfaces with intentional no-auth test policy. It adopted the running
  `primary-desktop` user-home runtime across manager restarts, and real
  Edge/noVNC sessions connected to both XFCE and `libreoffice`. The LibreOffice
  test reached exact-document UNO readiness and released its dynamic control
  port after graceful stop.
- The rc.16 local port-1991 deployment adopted the existing XFCE runtime
  without changing its VNC/server/gateway PIDs. A real Chrome/noVNC session
  opened the approved PPTX in Matchbox + LibreOffice Impress, verified the
  returned loopback UNO port, and completed clean resource removal.

## 0.1.0-rc.15 — 2026-08-28

Target: `0.1.0-rc.15`.

### Added

- SDK 0.12 configurable automatic-reconnect budgets through
  `maxReconnectAttempts`, including unlimited retries, finite limits, and a
  terminal `reconnectexhausted` event.
- Automatic same-origin base-path discovery for SDK assets, API calls, viewer
  URLs, health requests, and RFB/input WebSockets behind a strip-prefix proxy.
- Independent `REMOTEXAPP_DISABLE_CONSOLE` and
  `REMOTEXAPP_DISABLE_KIOSK` deployment controls that retain SDK and transport
  integration surfaces.
- Apache-2.0 project licensing, third-party attribution, downstream
  integration guidance, and explicit release/version policy.
- Deterministic Linux release archives with SHA-256 checksums, metadata gates,
  and tag-driven GitHub prerelease/publication automation.
- Monthly dependency update proposals for Go modules and GitHub Actions.
- GitHub workflows use the Node 24-based v7 checkout and toolchain setup
  actions, avoiding the runner's deprecated Node 20 compatibility path.
- Immutable system installations retain the project license/notices, Gorilla
  license, and complete corresponding noVNC source alongside runtime files.
- Release and CI gates reject high-confidence credential signatures, private
  deployment markers, suspicious credential filenames, and contaminated
  release archives; full Git history is also scanned by Gitleaks.

### Changed

- The default `xfce-user-desktop` template now uses a fixed 1280×720
  framebuffer. Its geometry and resize policy cannot be overridden, TigerVNC
  rejects desktop-size requests, and browsers scale the fixed display.
- SDK 0.11 routes reliably mapped physical printable ASCII keys through RFB
  and keeps IME composition, non-ASCII text, soft-keyboard fallback, and paste
  on the Unicode/IBus channel. Preventing the ASCII keydown default avoids a
  duplicate browser `input` commit.
- Build timestamps now derive from the source commit (or
  `SOURCE_DATE_EPOCH`), and the Go module uses its canonical GitHub path.
- The supported browser SDK topology is explicitly same-origin. Type
  declarations now reflect that internal driver paths are omitted unless the
  manager enables internal-field exposure.
- Removed obsolete WebRTC, FFmpeg, go2rtc, raw WebSocket, browser A/B, and
  legacy deployment PoCs from the release branch. Git history remains the
  recovery source; production tests and accepted evidence remain tracked.
- Anonymized environment-specific hostnames and HOME paths in documentation
  and test evidence, removed a private test-document default, and made the
  Unicode experiment launchers resolve the repository path dynamically.

### Validation

- Added routing regressions for ASCII, shifted punctuation, repeats,
  composition, direct non-ASCII, dead keys, unidentified keys, paste, and
  modifier cleanup. Live display `:2` validation uses a Polkit password field
  that accepts RFB keys but rejects IBus commits. Human interactive UAT was
  accepted on 2026-08-27; no alternative routing experiment remains planned.
- The complete DEP-010 through DEP-012 and SDK-001 through SDK-003 package
  passed the release/race gate, real fixed-framebuffer browser validation,
  finite and unlimited reconnect scenarios, nginx prefix deployment, and web
  exposure-policy tests. Human visual and interactive UAT was accepted on
  2026-08-28.

## 0.1.0-rc.9 — 2026-08-27

### Added

- A single trusted `runMode` selector. `user-home` resolves the manager Unix
  account's passwd HOME, reuses `/run/user/<uid>/bus`, and uses
  `~/.Xauthority`; `shared` and `isolated` retain the private-session model.
- The managed `xfce-user-desktop` template for a real Unix-user desktop.

### Changed

- Removed the split `profileMode` and template `dbusMode` schema. Server,
  session, and graceful-shutdown drivers receive the resolved launch-parameter
  path and run mode. Existing production driver bundles advance to `1.5.0`,
  the user-desktop bundle to `1.1.0`, and the SDK to `0.10.0`.

### Security

- `user-home` is limited to a fixed-display, persistent singleton managed
  instance. It changes only the display's entry in `~/.Xauthority`, refuses
  HOME purge, never owns the user bus, and cannot select another identity.

### Validation

- Added policy, strict old-schema rejection, multi-display Xauthority
  preservation, D-Bus ownership/cleanup, and user-HOME purge regressions. Live
  local testing passed SDK/RFB/input reconnect and a clean-environment
  `DISPLAY=:1` Mousepad launch without `XAUTHORITY`; human UAT remains pending.

## 0.1.0-rc.7 — 2026-08-27

### Fixed

- Mousepad and Edge publish `ready` only after a visible application window
  exists, preventing an immediate graceful stop from racing application map.
- X11 and XFCE shutdown hooks reserve one second inside the manager deadline,
  so an unsaved document reports `blocked` instead of an outer `timeout` at
  the production 15-second grace.
- A normal application exit discovered during channel reconnect now emits one
  terminal SDK event without reporting transient reconnect errors.

### Validation

- Added a real-browser SDK lifecycle harness covering text acknowledgements,
  diagnostics, disconnect/reconnect, terminal `sessionended`, manager stop,
  blocked error propagation, and force.

## 0.1.0-rc.6 — 2026-08-27

### Fixed

- Private session D-Bus sockets now live in each runtime's `/run/user/<uid>`
  socket directory. Graceful XFCE logout therefore remains reachable from a
  hardened manager using `PrivateTmp=yes`; rc.5 used an inaccessible `/tmp`
  socket on that deployment path.

## 0.1.0-rc.5 — 2026-08-27

### Added

- Contributor-facing requirements and design-decision registers.
- Version-pinned application shutdown hooks with host-owned grace, blocked
  warning, and optional force deadlines.
- Structured per-session shutdown state and explicit force support for
  temporary and managed lifecycle APIs.

### Changed

- Driver-confirmed application exit or desktop logout now applies the existing
  idle action immediately. The SDK ends the viewer session without automatic
  relaunch, while a later attachment can start a new generation.
- Shipped XFCE, Mousepad, and Edge driver bundles are version `1.1.0`; Edge now
  reports clean and failed application exits through the driver-status contract.
- Managed fault recovery now honors graceful application shutdown and pauses
  instead of discarding a session that reports unsaved-data blockage.
- X11 application shutdown uses a native Alt+F4 request against visible
  windows, preserving save prompts without destroying GTK internal windows.
- A managed runtime forced at the host deadline now synchronously converges its
  durable desired/observed state instead of depending on a cgroup wakeup race.

### Validation

- Isolated real-application testing passed Mousepad clean exit, unsaved-save
  blocking, reconnect/save, explicit and timed force, restart persistence,
  crash classification, Edge API close, and XFCE logout/relaunch/API stop. See
  `tests/go-live-validation/results/graceful-shutdown-rc5.json`.

## 0.1.0-rc.4 — 2026-08-27

### Added

- Semantic `driverVersion` metadata in template, runtime, SDK, and console
  responses.
- Managed applied/available driver reporting and explicit update status.
- Private persisted template/component snapshots for deterministic restart
  adoption and failure recovery.
- Immutable side-by-side system releases selected through paired `current`
  symlinks.
- Central non-root deployment for a dedicated service account or one manager
  per approved Unix user.

### Changed

- A managed driver update now occurs only on an explicit stopped-to-running
  transition; healthy adoption and failure recovery stay on the applied bundle.
- Any managed registration suppresses anonymous autostart for its template.
- Production noVNC is vendored from reviewed upstream release source, with a
  scheduled workflow that proposes stable updates for regression review.

### Security

- Production artifacts are root-owned while all application processes remain
  non-root. Applied internal paths stay in mode-0600 registry files and are not
  exposed by default through the API.

### Validation

- Automated driver-lifecycle deployment tests and full XFCE, Mousepad, Edge,
  Unicode, resize, reconnect, cleanup, and human UAT were accepted.
