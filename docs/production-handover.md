# Production handover: X11 RemoteXApp platform

## Purpose and current release state

**LightView 1.0.11 formally published — 2026-09-29:** annotated
[lightview-v1.0.11](private-history.md)
points to `752b4ca15de2`. Hosted Verify passed and the GitHub archive matches
the local UAT package byte-for-byte. Core `v0.13.0` remains Latest. Publication
did not deploy or restart any environment; sandbox rollout belongs to the
sandbox project. Human UAT was not separately claimed. See
[publication evidence](../tests/evidence/v1/lightview-1.0.11-publication.json).

**LightView 1.0.11 local UAT — 2026-09-29:** the unpublished App-only fix for
hibernation wakeup is installed on loopback 1991 and 2992 from one verified
archive. Both catalogs, health checks, installed seals, and real Viewer →
hibernation → Manager `openUrl` wakeup passed. The native Lightview PID survived
the wake on both endpoints. The 1991 UAT runtime is
`lightview-f0bd39223e52` (generation 1, App ready); the 2992 test runtime was
stopped after verification. Existing 1991 XFCE remains generation 11 and was
not restarted. Core 0.13.0, SDK 0.29.1 and host Lightview 0.1.10 are unchanged.
An isolated exact-package 18-scenario real-browser suite also passed.
At this local handoff, human UAT and GitHub publication were pending; formal
publication followed separately above. No sandbox deployment was made.
See [local UAT evidence](../tests/evidence/v1/lightview-1.0.11-local-uat.json).

**LightView 1.0.10 formally published — 2026-09-24:**
[lightview-v1.0.10](private-history.md)
fixes LTV-011 / Issue #8. Hosted Verify passed and fresh downloads match the
same archive already qualified on local 1991/2992. Core 0.13.0 / SDK 0.29.1
are unchanged; Core remains Latest. The operator's formal promotion request
supersedes the publication hold below, without a separate interactive UAT claim.
Publication performed no deployment or runtime restart. Sandbox rollout remains
owned by the sandbox project. See [publication evidence](../tests/evidence/v1/lightview-1.0.10-publication.json).

**LTV-011 deployed for local UAT — 2026-09-24:** unpublished immutable
LightView App Package `1.0.10` is selected on `127.0.0.1:1991` and
`127.0.0.1:2992`; Core `0.13.0` / SDK `0.29.1` and the host's Lightview
`0.1.10` executable are unchanged. Both Managers reloaded the catalog. The
explicitly approved 1991 runtime `lightview-1693a7110d9d` upgraded from App
1.0.9, generation 1, to App 1.0.10, generation 3, using normal shutdown
(`force:false`). Existing XFCE remains ready at generation 8; no sandbox changes.

Both deployed endpoints passed actual served-Viewer connection, resize/reconnect,
private control discovery, protection-off/alternate-threshold repeated `openUrl`
tests. The owned 2992 test runtime stopped gracefully with protection disabled;
1991 remains ready for UAT, with test policy restored to enabled/3072 MiB.
The Driver retains `--low-memory` launch defaults but does not enforce users'
runtime memory choices. Public status now exposes `launchLowMemory`, not stale
fixed live memory fields. Test in Lightview's settings: turn memory protection
off, wait until the page engine is ready, invoke `openUrl` from Console/SDK,
and verify navigation; then confirm normal stop/restart. Human UAT and formal
GitHub publication remain pending. Older immutable packages are retained.
See [local UAT evidence](../tests/evidence/v1/lightview-1.0.10-local-uat.json)
for exact archive identity, all gates and test-environment limitations.

**Local LightView runtimes relaunched — 2026-09-18:** after the separately
authorized restart/upgrade request, neither endpoint had a live LightView to
upgrade. Fresh singleton runtimes were therefore started on the selected
Core 0.13.0 / LightView App 1.0.9: `lightview-36018fe69a2c` on 1991 and
`lightview-deeb1eeb914b` on 2992. Both reached application-ready with native
Lightview 0.1.9; served Viewer connection/resize/reconnect and private native
control checks passed. Version inspection reports `already current` on both.
They were left running after the test Viewers detached and retain the normal
six-hour vacant timeout. XFCE generation 7 and all sandbox environments were
left unchanged. This supersedes only the stopped-LightView state below.

**LightView 1.0.9 deployed locally — 2026-09-18:** separately authorized
App-only deployment selects the verified formal GitHub archive on loopback
1991 and 2992, replacing each endpoint's LightView 1.0.6 selector. Both Managers
were restarted to reload the catalog; Core 0.13.0 / SDK 0.29.1 are unchanged.
Real served Viewers passed connection, resize/reconnect, private Unix control,
native Lightview 0.1.9 low-memory status, `openUrl` and graceful shutdown on
both endpoints. Test runtimes/browser processes were stopped. The existing
XFCE runtime remains ready at generation 7 and status revision 11; it was not
restarted. Existing local WebKit test-only sandbox/software-renderer overrides
were retained, not added to the package. No sandbox operations. See
[local deployment evidence](../tests/evidence/v1/lightview-1.0.9-local-deployment.json).

**LightView 1.0.9 formally published — 2026-09-18:**
[lightview-v1.0.9](private-history.md)
removes the executable version/banner gate. Existing process, window, private
socket, status and low-memory checks remain mandatory; compatible host builds
do not require an App update just for their version number. Fifteen isolated
exact-package scenarios passed on formal upstream Lightview 0.1.9, along with
source/race/coverage/vulnerability and hosted Verify gates. Fresh release
downloads match the tested archive. Core 0.13.0 / SDK 0.29.1 are unchanged and
Core remains Latest. No local or sandbox endpoint was deployed; existing pins
and selectors remain unchanged. Sandbox rollout belongs to the sandbox project.
See [publication evidence](../tests/evidence/v1/lightview-1.0.9-publication.json).

**Local XFCE runtime upgraded — 2026-09-18:** separately authorized upgrade
and restart replaced the local 1991 desktop's Core `0.12.0-rc.2` pin with
formal `0.13.0`. The generation/target-guarded API completed with normal
shutdown (`force:false`), preserving its ID, managed association and XFCE App
`3.0.0`. Server generation 6 became ready session generation 7 after RFB
attachment. A real served-kiosk browser connected at 1280×720; connection
descriptors, X11, D-Bus and IBus checks passed. Running gateway and supervisor
hashes match Core `0.13.0`; the managed desktop is running without error.
This supersedes the older-pin statement in the recovery record below. No
2992 runtime or sandbox change. See [upgrade evidence](../tests/evidence/v1/local-xfce-runtime-upgrade-0.13.0-20260918.json).

**Local XFCE recovered after approved restart — 2026-09-18:** the operator
approved restarting the existing local 1991 desktop. The initial force restart
encountered blocked old-gateway teardown; scoped gateway termination allowed
cleanup and managed recovery. The same runtime now has session generation 5,
App status `ready`, managed status `running` with no error, and responsive
display `:1` at 1280×720. A real browser connected to the served kiosk and
verified its canvas; X11, account D-Bus, connection descriptors and the private
IBus `remote-unicode` global engine passed checks. This supersedes the desktop
health exception below, not the entire two-endpoint UI acceptance record.
Core runtime pin `0.12.0-rc.2` and XFCE App `3.0.0` are unchanged: this was a
restart, not an upgrade. Managers remain `0.13.0` / SDK `0.29.1`; no sandbox
operations. See [recovery evidence](../tests/evidence/v1/local-xfce-runtime-recovery-20260918.json).

**0.13.0 deployed locally, qualified acceptance — 2026-09-18:** both
`127.0.0.1:1991` and `127.0.0.1:2992` now serve formal Core `0.13.0` / SDK
`0.29.1`. Running binaries and served assets match the public release;
configuration, App selectors and Console/kiosk policy are unchanged. Both
endpoints passed health/version and new disposable Mousepad API checks,
including connection descriptors and detached renewal beyond the 60-second
idle timeout. RC.3 remains available for rollback. No sandbox operation.

This is **not an all-green deployment acceptance**: existing display `:1`
failed X11 readiness under both stable and rollback RC.3. The desktop's
processes, generation 3 and older core pin were preserved; its managed record
reports explicit recovery required. The default 120-second activation and
rollback windows both expired. Re-selecting stable with a 600-second window
allowed Manager startup after about 135 seconds. No desktop restart was
authorized or performed. Browser UI smoke also timed out at CDP navigation;
API tests passed but do not replace a UI pass. Finally, staging encountered
an existing LightView 1.0.8 content-identity conflict; that App was not
overwritten. See [deployment evidence](../tests/evidence/v1/runtime-coordinator-0.13.0-local-deployment.json).

**0.13.0 formally published — 2026-09-18:** the accepted RC.3 Coordinator/
idle-lease behavior is released as Core `0.13.0` / SDK `0.29.1`, without
functional changes; App versions remain unchanged. The clean hosted candidate
passed source and exact-artifact live gates, and its fresh GitHub download is
byte-identical. See [release](private-history.md)
and [publication evidence](../tests/evidence/v1/runtime-coordinator-0.13.0-publication.json).
At publication, local 1991/2992 remained on RC.3; deployment followed separately above.
Sandbox deployment belongs to the sandbox project. WAOS's migration guide is
included in the package; its current main-branch copy adds the publication lock.
The dated candidate records below retain their original qualification context;
their pending-UAT/publication statements are superseded by this entry.

**Coordinator panel deployed locally — 2026-09-18:** Core `0.13.0-rc.3` /
SDK `0.29.1` supersedes RC.2 on loopback 1991 and 2992 for RTC-007 UAT.
Console/kiosk now has a read-only **Coordinator** panel: mode, observed peer
Tabs, runtime generation/interest counts, renewal leader, lease receipts and
bounded local event history. Opening the panel does not acquire keepalive.
Both Managers were restarted; existing runtime pins and XFCE generation 3
were preserved. App selectors, configuration and 2992's Console-disabled /
kiosk-enabled policy are unchanged. The old RC.2 directories are retained for
rollback. No sandbox deployment or GitHub publication was performed.
This remains an uncommitted candidate based on `41665eaee8ae`, not accepted UAT.

`make check`, build/package/sensitive-data checks and post-deployment browser
tests passed. Each actual kiosk showed passive/attached/detached/released panel
states, retained a disconnected Mousepad beyond 60 seconds, and closed cleanly.
Both running executables and served SDK/Console bundles match the candidate;
listeners/configuration hashes/App selectors were preserved, with no warning
journal entries or restart loop. See [RC.3 deployment evidence](../tests/evidence/v1/coordinator-panel-0.13.0-rc.3-local-deployment.json).

Open `http://127.0.0.1:1991/sdk/console.html` and click **Coordinator**.
In kiosk, use the same button in the Viewer toolbar. Reload existing pages to
load the new SDK/Console pair; already-open browser modules do not hot-upgrade.

**Previous RC.2 idle lease/Coordinator qualification — 2026-09-18:** locked IDL-001–004
and RTC-001–004 are implemented as Core `0.13.0-rc.2` / SDK `0.29.0`.
Both project-owned endpoints, `127.0.0.1:1991` and `127.0.0.1:2992`, run the
same verified candidate Manager/SDK bytes. This is an uncommitted local
candidate based on `41665eaee8ae`, not a clean/public release. Human UAT,
commit/push and GitHub publication remain pending; no sandbox operations.

The API renews the existing generation's pinned idle timeout without attaching
a Viewer or starting/reviving an App. The optional single-server Coordinator
shares lifecycle observation and explicit interests across Tabs, not IME or
clipboard ownership. Console/kiosk adds an opt-in **Keep running** checkbox.
Fresh Driver status, timer/runtime identity and generation guard renewal.
Explicit stop, desired-stop, exit/logout and shutdown enforcement win. Browser
freeze support is best effort, with six-second failover and five-minute silent
interest retention; every Tab suspended can still lose the App.

Source/race/coverage/vulnerability/staging gates and the eight-App/32-scenario
isolated suite passed. Real browser freeze/takeover, all-frozen expiry, XFCE
relogin/logout, restart/upgrade and blocked shutdown/adoption enforcement passed.
Both local endpoints passed served-SDK Unicode/clipboard, Manager restart and
helper-fault regression, then serial checkbox tests retaining a disconnected
Mousepad beyond its shipped 60-second timeout. Existing desktop generation 3
and its older component pin were preserved; no forced runtime upgrade occurred.
2992 retains its existing console-disabled/kiosk-enabled policy.

UAT entry: `http://127.0.0.1:1991/sdk/console.html`. Launch Mousepad, enable
Keep running, disconnect without closing the window, wait over 60 seconds,
then reconnect. Disable Keep running and disconnect again to test normal idle
shutdown after the last granted deadline. Multi-server, reliable external
background ownership and audio remain [pending](release-pending.md).

See [candidate qualification](../tests/evidence/v1/idle-lease-0.13.0-rc.2-candidate.json),
[local deployment evidence](../tests/evidence/v1/idle-lease-0.13.0-rc.2-local-deployment.json)
and [integration guidance](integration-guide.md). Concurrent Managers on this
host reproduced X-display allocation contention; live suites are serialized.
That allocator limitation is recorded, not fixed or hidden by this train.

**LightView 1.0.8 formally published — 2026-09-18:** annotated App tag
[`lightview-v1.0.8`](private-history.md)
peels to accepted source commit `9e92c5d66a63`. LTV-009 creates immutable
`lightview@1.0.8`, accepting exactly formal host Lightview
0.1.8. Upstream supervised recovery replaces failed or oversized WebKit workers
without changing the LightView main PID, GTK window, profile or private socket.
The Driver validates ready engine state, positive generation, the mandatory
384 MiB pressure target and 3072 MiB last-resort per-process threshold. Exact
upstream provenance, deterministic packaging, 15-scenario RemoteXApp E2E,
nine upstream integrations, source/race/coverage and vulnerability gates
passed. Fresh public assets match the candidate archive and checksum; the
release contains no other assets and is neither draft nor prerelease. Core
`v0.12.2` remains GitHub Latest. No endpoint was deployed; sandbox rollout
belongs to the sandbox project. See
[publication evidence](../tests/evidence/v1/lightview-1.0.8-publication.json).

**LightView 1.0.7 formally published — 2026-09-17:** annotated App tag
[`lightview-v1.0.7`](private-history.md)
peels to accepted source commit `ba0f5e53e617`. LTV-008 adds a new immutable
package that accepts exactly formal host Lightview 0.1.7.
Its verified upstream delta keeps normal images enabled in low-memory mode and
adds prompt-free, conflict-safe downloads to the runtime user's standard
Downloads directory. Source, race, vulnerability, deterministic-package,
complete 14-scenario RemoteXApp E2E and upstream seven-test image/download
integration gates passed. The operator explicitly authorized immediate formal
GitHub publication without a separate interactive UI-UAT claim. Fresh public
downloads match the deterministic archive and checksum; the release is formal
and contains only those two assets. Core and SDK are unchanged, and Core
`v0.12.2` remains GitHub Latest. No endpoint deployment occurred; sandbox
rollout belongs to the sandbox project. See
[publication evidence](../tests/evidence/v1/lightview-1.0.7-publication.json).

**Deployment ownership changed — 2026-09-17:** RemoteXApp now owns development,
project test-environment validation, GitHub publication, and release handoff.
The sandbox project owns deployment, runtime restart, rollback, and alignment
for every sandbox environment. A bare request to “align” or “对齐” must be
answered with a clarification of purpose, target, and owning project before
any action. Historical sandbox deployments below remain factual records, not
precedent for operating them from this repository. See the updated
[alignment process](release-alignment-process.md).

**Edge 2.0.2 / LightView 1.0.6 fleet alignment complete — 2026-09-17:**
the exact formal Edge archive is selected on local 1991/2992, sandbox00
1991/2991 and sandbox01/02/03/07/10 production. LightView remains deliberately
limited to its existing local and sandbox00/01 footprint, where every selector
and seal is 1.0.6; the rollout did not add it to other endpoints. Every changed
Manager passed two starts and durable adoption. The one existing old Edge
runtime on sandbox00 was upgraded and restarted without force, then passed a
real RFB attachment, ready CDP descriptor and `openUrl` action. Unrelated
XFCE, Firefox and LightView runtime identities and pins were preserved. Local
listeners remain loopback-only; sandbox policy is unchanged. No container was
rebooted, and CloudDrive functional checks were skipped during maintenance.
See [alignment evidence](../tests/evidence/v1/edge-2.0.2-lightview-1.0.6-alignment.json).

**Edge 2.0.2 and LightView 1.0.6 formally published — 2026-09-17:** the
App-only EDGE-005/LTV-007 train passed local 1991/2992 UAT, complete source
gates, race and vulnerability checks, deterministic packaging, and real
browser/control/lifecycle tests. Annotated tags
[`edge-v2.0.2`](private-history.md)
and [`lightview-v1.0.6`](private-history.md)
peel to source commit `360b3dfe0969`. Downloaded assets match the accepted
archives. Core `0.12.2` and SDK `0.28.0` are unchanged; `v0.12.2` remains
GitHub Latest. Publication did not deploy or upgrade any endpoint. See the
[Edge publication evidence](../tests/evidence/v1/edge-2.0.2-publication.json)
and [LightView publication evidence](../tests/evidence/v1/lightview-1.0.6-publication.json).

**LightView 1.0.0 formally deployed — 2026-09-16:** the new shared low-memory
WebKit App Package passed production gates, local 1991/2992 UAT and formal
deployment to local 1991/2992 plus sandbox00/01 production 1991. Annotated
[`lightview-v1.0.0`](private-history.md)
publishes only the byte-verified deterministic archive and checksum. Core
`0.12.2` and SDK `0.28.0` remain unchanged, and RemoteXApp Latest remains
`v0.12.2`. The official Lightview 0.1.0 host dependency is pinned on all four
endpoints. Real Viewer, native status, private connection metadata, `openUrl`,
cleanup and Manager-adoption checks passed; unrelated XFCE runtime identity,
generation and processes were preserved. Sandbox00 2991 was not in scope and
its selector remains absent; no sandbox00 reboot occurred. The local container
retains its explicit WebKit sandbox test override; sandbox targets use their
normal production environment. See [UAT](../tests/evidence/v1/lightview-1.0.0-local-uat.json),
[publication](../tests/evidence/v1/lightview-1.0.0-publication.json) and
[deployment](../tests/evidence/v1/lightview-1.0.0-local-sandbox00-sandbox01-alignment.json)
evidence.

**Stable 0.12.2 published; sandbox00 production restored — 2026-09-14:**
GitHub Latest [v0.12.2](private-history.md),
commit `c1cecabe076e`, SDK 0.28.0; App versions unchanged. Hosted/local gates,
eight exact-archive E2E suites and sandbox00 seven-App Manager/runtime checks
passed. Published assets match the candidate and installed binaries. Production
1991 runs normally despite the existing CloudDrive ENOTCONN; configuration is
unchanged. Two Manager restarts and owned XFCE D-Bus logout/stopped-session
restart passed. The host logout wrapper remains unchanged. See
[evidence and limitations](../tests/evidence/v1/boot-recovery-0.12.2-publication.json).

**Sandbox00 container reboot requires new explicit approval.** No reboot after
the latest restriction; final-candidate reboot acceptance remains pending.
CloudDrive functional tests were skipped during maintenance. Native 26.04/
physical power-loss acceptance and new human UAT are not claimed. Paired 2991
remains 0.11.0 with the same PID/configuration; local endpoints, other sandboxes
and production gateway were not upgraded. Earlier pending/outage notes are
historical, not the current production status.

**Boot recovery 0.12.2 locked for implementation and sandbox00 testing — 2026-09-14:**
operator requested the reboot fix, new release and full sandbox00 restart tests.
See [BR-001–005 / U26-06 scope](boot-recovery-release.md). Preserve same-boot
failure protection; add bounded, identity-checked cross-boot recovery. Test
locally first, then sandbox00 production 1991 using the exact candidate before
publication. Current sandbox00 is 0.11.0/Ubuntu 24.04 and requires the documented
stopped-system cutover; paired 2991 remains on its existing release. Reboot
interruption is approved; force-discard, other deployments and gateway changes
are not. Implementation/testing pending; no new human UAT is claimed.

**Stable 0.12.1 published; U26 train closed — 2026-09-14:** GitHub Latest
[`v0.12.1`](private-history.md), commit
`0300acdfd003`, SDK `0.28.0`, Mousepad `4.0.1`. This is a formal release, not
an RC/prerelease. Hosted and independent clean-clone release gates passed with
byte-identical archives; all seven exact-archive E2E suites and eight Mousepad
upgrade/class/input checks passed. Downloaded published assets match the tested
candidate. See [publication evidence](../tests/evidence/v1/ubuntu-host-compatibility-0.12.1-publication.json).
Native clean Ubuntu 26.04/Qt6/Mousepad 0.7 and whole-host reboot validation remain
explicitly unverified. No deployment, existing runtime restart/upgrade or
workaround retirement occurred. Earlier authorization/pending-UAT records below
are historical, not the current publication state.

**UAT accepted; formal stable 0.12.1 publication authorized — 2026-09-14:**
the operator requested a stable version, not an RC. Promote the accepted U26
repair without functional changes; SDK `0.28.0` and Mousepad `4.0.1` remain.
Prepare a clean hosted candidate and run exact-archive local E2E before tagging
and publishing identical bytes. See [acceptance](../tests/evidence/v1/ubuntu-host-compatibility-0.12.1-uat.json).
Native clean Ubuntu 26.04/Qt6/full-host validation remains unverified and must
be stated in release notes. No deployment, existing runtime restart/upgrade,
or downstream workaround retirement. Earlier pending-UAT entries are history.

**Ubuntu repair train locked for development — 2026-09-14:** operator approved
the reviewed U26 scope. Source target `0.12.1-rc.1`, Mousepad `4.0.1`, unchanged
SDK `0.28.0`; see [scope and pending gates](ubuntu-host-compatibility-release.md).
Existing deployments/runtime pins are unchanged. No live sandbox experiments,
deployment or publication is authorized. Incoming field feedback remains local;
approval covers only the narrow reviewed subset, not every proposal.
Implementation and scoped local tests now pass: 280 dynamic checkpoints,
1,960 HTTP assertions and eight Mousepad upgrade/input checks. Clean Ubuntu
26.04/full candidate acceptance and human UAT remain pending; see the linked
train for failed-attempt dispositions and evidence. No endpoint alignment.

**Incoming sandbox01 Ubuntu 26.04 field feedback - 2026-09-14, pending review:**
The sandbox operator deployed published 0.12.0 independently after publication
and reported IBus timeout, GTK dependency and Mousepad WM_CLASS issues.
Review the local-only nine-item handoff and evidence packet at
`release-tray/sandbox01-ubuntu2604-012-feedback-20260914/README.md`.
The raw packet is not tracked or distributed with this repository.
It includes downstream workarounds, reproduction/acceptance criteria and
separately classified reboot/health/installation UX proposals. Reboot failure
retention is documented existing policy, not an asserted regression; initial
managed-registration and harness mistakes belong to the sandbox deployment.
No upstream fix, requirement change, release or rollout is approved by this
incoming report. Existing sandbox-isolation work and audio review remain separate.

**Stable 0.12.0 published — 2026-09-14:** GitHub Latest
[`v0.12.0`](private-history.md), commit
`3037ca136f58`, SDK `0.28.0`, closes SVC-001–010 after operator UAT acceptance.
Hosted/local release gates, seven exact-archive E2E suites and the separate
0.11-to-0.12 stopped-cutover rehearsal passed. Published bytes were downloaded
and verified against the tested candidate. See
[publication evidence](../tests/evidence/v1/core-session-services-0.12.0-publication.json).
This publication does not deploy: local loopback 1991/2992 still select rc.2,
and no sandbox, gateway or existing runtime was upgraded. Moving old-architecture
environments to 0.12 requires the separately approved
[controlled cutover](session-services-release.md#clean-cutover-not-dual-stack-migration).
The earlier publication-in-progress and pending-UAT records below are history.

**Human UAT accepted; stable 0.12.0 publication requested — 2026-09-14:**
the operator accepted local rc.2 and authorized formal GitHub publication.
SVC-001–010 are accepted. Stable promotion changes release/build identity and
documentation only; SDK `0.28.0` and App versions remain unchanged. A clean
hosted candidate and exact-archive live gates are required before publication.
See [UAT provenance](../tests/evidence/v1/core-session-services-0.12.0-uat.json).
No endpoint alignment or runtime replacement was requested: local loopback
1991/2992 remain on rc.2; sandboxes and production gateways are untouched.
Earlier pending-UAT and deployment entries below remain historical evidence.

**Repaired rc.2 validated and deployed locally — 2026-09-14:** local loopback
1991/2992 now run the same verified `0.12.0-rc.2` working-tree archive, SDK
`0.28.0`. Nine lifecycle/cleanup findings are fixed. Seven-App dynamic matrices
passed 361 checkpoints / 2,235 HTTP assertions; final real Viewer/App/control,
document, cutover, performance, release-ci and nightly gates passed, including
20 shuffled Go/Node repetitions and three fuzz targets. See
[current evidence and limitations](../tests/evidence/v1/core-session-services-0.12.0-rc.2-local.json)
and [findings/repaired matrix](session-services-dynamic-validation.md).

Manager selection initially retained the desktop's old runtime pin and process
identities. A separate graceful upgrade applied rc.2 to the same
`xfce-user-desktop-8cdcaa0b5159`, generation 3, display :1. Old owned processes
are gone; HOME/default Xauthority and the pre-existing account bus remain.
IBus reuses the runtime socket path with a new generation/PID identity, not a
new pathname. Both deployed Viewers passed Manager restart, Unicode/clipboard
readback and raw input after faults injected only into disposable Mousepads.
Listeners, auth, shutdown policy and disabled 2992 Console are preserved.
No sandbox/GitHub change, commit/push or human UAT acceptance. Reload the local
Viewer for testing; formal promotion still needs acceptance and approval.

Completion audit subsequently closed the named XFCE saved-session gap:
actual saved command/document-window restoration, current input environment,
single IBus/Unicode ownership and real Viewer/Manager-adoption checks passed
in temporary accounts. The final repeated fault test observed fail-closed
409 followed by truthful IBus unavailability in 111 ms, without App replacement.
See [supplemental evidence](../tests/evidence/v1/core-session-services-0.12.0-rc.2-xfce-saved-session.json).
This changed tests/docs only; real desktop, binaries and deployments are unchanged.

The preparation, failed rc.1 gate and previous deployment notes below are history.

**Session-services stability repairs under final local validation — 2026-09-14:**
source candidate `0.12.0-rc.2` fixes the expanded lifecycle findings, plus
repeated-TERM cleanup and abnormal VNC endpoint recovery. The initial repaired
seven-App main matrix passed; managed XFCE/Edge transport and disposable-account
bus-outage retests passed. Final frozen-archive matrices and served-Viewer gates
are running. Local 1991/2992 still run the earlier rc.1 archive; no sandbox or
GitHub changes. Do not infer acceptance/deployment from source version alone.
See [repair evidence and remaining gates](session-services-dynamic-validation.md).

**Expanded session-services stability gate failed — 2026-09-13:** the operator
requested per-App dynamic-state/API tests after the initial local handoff.
They exposed failed-session resurrection, interrupted-upgrade replacement,
Kate/KWrite startup identity mismatch, on-attach duplicate restart handling,
shutdown hooks surviving Manager death, and managed transport recovery using
stale session state/generation (including an old-generation connections request
accepted for a replacement session).
See [findings and scope](session-services-dynamic-validation.md). Keep the
candidate unaccepted; previous suite passes are not exhaustive coverage.
This follow-up has not changed deployed binaries or existing local runtimes.

**Core-owned session services candidate deployed locally — 2026-09-13:**
local loopback 1991/2992 run Core `0.12.0-rc.1`, SDK `0.28.0`, based on dirty
working-tree commit `b7f4f98c7204`. SVC-001–010 are implemented and automated
gates passed; human UAT is pending. This is not a formal release or sandbox
alignment. See [requirements/design/UAT](session-services-release.md) and
[exact candidate/deployment evidence](../tests/evidence/v1/core-session-services-0.12.0-rc.1-local.json).

All seven App Packages now require Core-owned services. This deployment used
a clean stopped-system cutover, not old runtime adoption: the old desktop
exited gracefully, HOME/profile/configuration intent survived, and new managed
`ubuntu-desktop` is ready on display :1. Reopen Desktop from the 1991 Console;
old bound Viewer IDs are not redirected. Both listeners remain loopback.
2992 retains six enabled Apps and its disabled Console; kiosk/SDK remain enabled.
Retired registry directories are recoverable as recorded in the evidence.
New-architecture Manager restart/Viewer recovery, real text/clipboard readback,
fault handling and P16 overhead gates passed. The direct IBus/Unicode path is
healthy; an IBus portal activation warning remains documented for UAT.

The stable-release and prior-deployment statements below are historical.

**Stable 0.11.0 published and aligned — 2026-09-13:** GitHub Latest
[`v0.11.0`](private-history.md), commit
`73c8a6f75a2c`, SDK `0.28.0`, is deployed to local loopback 1991/2992,
sandbox00 1991/2991 and sandbox02/03/07/10 1991. App Packages are unchanged.
Hosted/local release gates, six exact-archive E2E suites (first attempt), and
formal local served-browser mask/clipboard tests passed. Both starts and exact
identity checks passed on every endpoint; configuration, selectors and pinned
runtime components were preserved at adoption. See
[evidence](../tests/evidence/v1/connection-mask-0.11.0-alignment.json).

Local client-continuity caveat: the two previously attached local Viewers did
not reattach after switching. LibreOffice was adopted, then stopped after its
configured 60-second vacancy period; XFCE remained running. The reason the
Viewers did not reattach is unconfirmed. Sandbox10 Edge's attachment was
preserved; other sandbox endpoints had none. No force runtime upgrade was
performed. Reload Viewer pages for SDK 0.28.0. Production gateway was untouched.

**0.11.0 stable promotion authorized — 2026-09-13:** Human UAT accepted
SDK-005/006 and CON-011. Operator approved GitHub formal publication and all
eight established endpoints. Preparing the clean formal candidate; existing
runtime pins and configuration must remain unchanged. See
[connection mask release](connection-mask-release.md) for scope and evidence.

**Connection mask candidate deployed locally — 2026-09-13:** local loopback
1991/2992 now run Core `0.11.0-rc.1`, SDK `0.28.0`, working-tree candidate
based on `1b76c63510e0` (not a clean formal release). SDK-005/006 and CON-011
are implemented; human UAT is pending. Existing runtime pins, configuration,
App selectors and disabled test Console are preserved. Sandboxes remain
unchanged. See [locked scope and verification](connection-mask-release.md).
The stable-release alignment statement below records the preceding deployment.

**Stable 0.10.1 published and eight-endpoint alignment complete —
2026-09-12:** [v0.10.1](private-history.md)
is the formal Latest release, commit `487b02116bb2`, SDK `0.27.5`; App Packages
unchanged. Local loopback 1991/2992, sandbox00 production 1991/test 2991 and
sandbox02/03/07/10 production 1991 all run the independently verified formal
archive. Hosted gates, clean local release-ci, byte-identical archives and all
six exact-archive E2E suites passed without rerun. Both local served-SDK UI
matrices passed. All targets passed two starts, exact binary/asset checks,
readiness, connections/actions, empty warning journals and preserved configuration,
App selectors, manifests, runtime pins and attached-client counts. Manager drift:
none. See [alignment/publication evidence](../tests/evidence/v1/clipboard-prompts-0.10.1-alignment.json).

Existing runtimes were not upgraded: local XFCE/Edge keep rc.1 pins; sandbox
desktops and sandbox10 Edge/Firefox keep 0.9.1. New runtimes select 0.10.1.
Reload Viewers for SDK 0.27.5. Private-IP probes timed out; LXD/container-loopback
checks passed. External access is not claimed; no gateway or firewall changed.

**0.10.1 formal promotion and alignment authorized — 2026-09-12:** operator
requested GitHub formal publication and alignment of all eight established
endpoints, accepting the local rc.2 / SDK 0.27.5 behavior. Preparing a clean
formal candidate and exact-archive gates before publishing. Local Managers
remain on rc.2; sandboxes have not yet changed. Preserve existing runtimes,
configuration and unrelated sandbox-design/audio work. See the
[release train](next-release-train.md).

**Prompt sizing refinement deployed locally — 2026-09-12:** loopback
1991/2992 now run `0.10.1-rc.2`, SDK `0.27.5`, dirty working-tree base
`c556f645ab5c`. Direction and tick/X icons are 30% smaller; prompt text is
vertically centered, button hit areas unchanged. `make check`, both endpoints'
two Manager starts, readiness, exact bytes and unchanged configs/App selectors/
runtime pins passed. Actual served-SDK layout checks measured zero text-block/
button vertical center offset in both directions. Reload Viewers for
`sdk-UNKJIKWI.js`. No runtime replacement, sandbox change or GitHub publication.
Human UAT pending. Raw verification: `/tmp/remotexapp-rc2.f3gexu/`.

**Clipboard prompt candidate deployed locally — 2026-09-12:** local loopback
1991 and 2992 run Core `0.10.1-rc.1`, SDK `0.27.4`, working-tree base
`c556f645ab5c` (dirty build; not a formal GitHub release). CLP-041–043 provide
larger SVG arrows, matched tick/X controls and pre-consent type/size/text/PNG
previews. Both endpoints passed exact binary/asset identity, two Manager starts,
readiness and unchanged configuration/App selectors/runtime pins. `make check`,
54 focused clipboard tests, served-browser UI and both endpoints' two-Viewer
Mousepad/LibreOffice suites passed. Actual Console preview/dismissal passed on
1991; test Console remains disabled. Human UAT pending. Reload Viewers for
`sdk-TQ3JAKN7.js`; existing runtime replacement and sandbox deployment were not
performed. See [train](next-release-train.md) and
[verification](../tests/evidence/v1/clipboard-prompts-0.10.1-rc.1-local.json).

**Stable 0.10.0 published and eight-endpoint Manager alignment complete —
2026-09-12:** [v0.10.0](private-history.md)
is the formal Latest release, commit `732a3cfd890c`, SDK `0.27.3`, unchanged
App Packages. Local loopback 1991/2992, sandbox00 production 1991/test 2991,
and sandbox02/03/07/10 production 1991 all run the verified formal bytes.
Stage-all-before-select, two Manager starts, binary/SDK/Console hashes,
readiness, connections/actions, unchanged configuration/App selectors/pins,
and empty warning journals passed. Manager drift: none.

Existing sessions were not replaced: six XFCE desktops and sandbox10 Edge/
Firefox retain 0.9.1; local Edge retains its accepted development pin. New
instances select 0.10.0. Old pins require separately approved upgrade/restart
for guarded clipboard prompt approvals. Do not report runtime alignment from
Manager alignment alone. Reload Viewer pages for SDK 0.27.3.

Hosted Verify/candidate and clean-clone release-ci passed; local and hosted
archives matched exactly. Six archive test areas passed with an action-suite
rerun: the first Firefox Manager-crash fault injection timed out waiting for
BiDi readiness. The unchanged rerun plus three consecutive crash/recovery
repetitions passed; the initial intermittent failure remains unexplained,
and no Firefox recovery fix is claimed. Direct private-IP probes timed out;
container-loopback checks passed. No gateway/firewall changes or external-path
acceptance claim. See [publication evidence](../tests/evidence/v1/clipboard-0.10.0-publication.json)
and [alignment evidence](../tests/evidence/v1/clipboard-0.10.0-alignment.json).

**0.10.0 formal candidate preparation — 2026-09-12:** Human UAT accepted
CLP-035–040 / SDK 0.27.3. The operator approved removal of the private hostname
from the unpublished evidence commit; the source/history sensitive-data scan
now passes. No remote history was rewritten. Preparing the hosted formal
candidate and exact-archive verification before publication and remaining
environment rollout. Local endpoints still run the accepted development build;
no claim of formal release or sandbox alignment is made yet. Existing runtime
replacement is outside this deployment authorization.

**Human UAT accepted; formal publication requested — 2026-09-12:** the
operator accepted the local CLP-035–040 candidate and requested formal GitHub
release plus rollout to remaining environments. Publication and further
deployment have not begun: the sensitive-data gate finds a private hostname
in the rc.1 evidence file and its unpublished commit `90721f2adf67`. GitHub
main remains `93a9e2dd345e`; the affected commit is not present remotely.
Cleaning only the current file cannot clear the history check. Approval is
required before rewriting that unpublished commit; do not weaken the gate
or push the offending history. Preserve unrelated sandbox-design changes and
the untracked audio integration review package. Local endpoints remain on
`0.10.0-dev.20260912-clp040` / SDK `0.27.3` while this gate is resolved.

**CLP-040 content details deployed locally — 2026-09-12:** both loopback
1991/2992 Managers run `0.10.0-dev.20260912-clp040`, SDK `0.27.3`, dirty
working-tree base `90721f2adf67`. Both passed two Manager starts, readiness,
binary/served-asset identity and unchanged configuration, App selectors and
runtime pins. No runtime upgrades or sandbox changes. All 118 SDK tests passed.
Isolated browser fixtures using the served SDK checked both directions,
PNG dimensions, per-format/total bytes, preview, no buttons and removal at
3026/3014 ms. Fixtures stub transfer I/O; application paste E2E was not rerun
for this display-only addition. Reload Viewers for `sdk-7XXBU4Y3.js`.
Evidence: `/tmp/remotexapp-clp040.NQ5Wyi/`. Human UAT pending; this is not a
formal release, and the pre-existing sensitive-data gate finding remains.

**Three-second notice follow-up — 2026-09-12:** both local loopback
1991/2992 Managers now run `0.10.0-dev.20260912-clp039-3s`, SDK `0.27.2`,
dirty working-tree base `90721f2adf67`. Existing runtime pins, Apps and
configuration were preserved; no sandbox changes. Both endpoints passed two
Manager starts, readiness and served-asset identity checks. Browser checks
using each endpoint's SDK measured success-notice removal at 3014/3020 ms,
with no action buttons and continued visibility at 1600 ms. All 117 SDK tests
passed. Reload Viewer pages for asset `sdk-NA5PI7GN.js`. Local evidence is in
`/tmp/remotexapp-clp039-3s.xdPMOp/`. This is not a formal release; the existing
sensitive-data gate finding is unchanged.

**CLP-039 local development deployment — 2026-09-12:** both loopback
1991/2992 Managers now run `0.10.0-dev.20260912-clp039`, SDK `0.27.1`.
This is a dirty working-tree build based on `90721f2adf67`, not an exact
commit or a formally published release. Successful clipboard notices remove
actions and display transferred formats plus a bounded plain-text sample.
Existing configuration, App selectors and runtime pins were preserved;
the earlier rc.1 installation remains available for rollback. No sandbox
deployment or runtime upgrade was performed. Reload browser pages to load
the new SDK asset `sdk-ZFNCDQCT.js`. The repository's pre-existing private
marker finding in rc.1 evidence/history still blocks the formal release gate.

**Clipboard consistency candidate ready locally — 2026-09-12:** Core
`0.10.0-rc.1`, commit `a8569d1e92de`, SDK `0.27.0`, unchanged Apps, is
deployed to `127.0.0.1:1991` and `127.0.0.1:2992` for Human UAT. Clean-clone
release-ci, exact-archive six-suite E2E and both deployed endpoints' two-Viewer
Mousepad/LibreOffice checks passed. Two Manager starts per endpoint, exact
binary/served-asset identity, preserved configuration/App selectors/pins,
readiness and clean Manager warning journals passed. No GitHub publication,
push or sandbox deployment was performed.

The existing production XFCE `xfce-user-desktop-44ea8c2186ee` remains running
at generation 7 on its **0.9.1 pin**, with its Viewer reconnected. No desktop
restart/upgrade was approved. New instances use the candidate; use these for
clipboard UAT, or explicitly approve an existing runtime upgrade/restart.
Local test 2992 retains Console disabled/kiosk enabled and has no live runtimes
after test cleanup. See the [UAT checklist](clipboard-prompt-consistency-release.md#human-uat-checklist)
and [verification/deployment evidence](../tests/evidence/v1/clipboard-consistency-0.10.0-rc.1-local.json).
Rejected intermediate builds and the bugs found during validation are recorded
there; none were deployed.

**Stable 0.9.1 published and fleet/runtime alignment complete — 2026-09-12:**
formal [v0.9.1](private-history.md),
commit `02f473632cb9`, SDK `0.26.0`, unchanged Apps, is installed on all eight
approved endpoints: local 127.0.0.1:1991/2992, sandbox00 1991/loopback 2991,
and sandbox02/03/07/10 1991. One independently downloaded formal archive was
staged everywhere before sequential selection; two Manager starts, identities,
configuration and App seals passed. The operator separately approved forced
runtime upgrades: all seven live runtimes (six XFCE desktops and sandbox10
Edge) now pin 0.9.1, report ready/no update, and run the verified gateway bytes.
Every runtime passed repeated 30-second Ping/Pong observation. Both test
endpoints have no live runtimes; stopped history was not relaunched.

Hosted gates and exact-archive functional E2E passed. The disposable user-home
cleanup needed a fresh-account retry; sandbox10's diagnostic client needed
desktop-resize support when sharing Edge with another viewer. Both reruns
passed; no additional production fix or repeat restart was needed. Direct
build-host private HTTP still times out on all sandboxes; container-loopback
verification passed. No firewall/gateway change or Cloudflare-path acceptance
is claimed. See [release and alignment evidence](../tests/evidence/v1/rfb-heartbeat-0.9.1-alignment.json).

**Local 1991 heartbeat UAT candidate — 2026-09-12:** the operator authorized
deployment to local 1991, then force-upgrade/restart of its existing runtimes.
Manager and `xfce-user-desktop-44ea8c2186ee` now select
`0.9.1-dev.20260912-ping30`, an uncommitted working-tree test build, not a formal
release. XFCE is running/ready at generation 5; gateway binary SHA-256 is
`98036799cadd19ca8a9ae21ce71d1634c1ad6b9cc760b48939881d86761cc7f9`.
Listening remains `127.0.0.1:1991`. Local 2992 remains stable `0.9.0` without
restart; no sandbox or Cloudflare changes. Retain stable `0.9.0` for rollback;
rolling back Manager alone does not replace the runtime's new component pin.
Human UAT and proxied-path validation remain pending.

Local post-deployment verification passed: a real headless Edge/noVNC viewer
and a separate minimal RFB client stayed connected for 140 seconds, with four
protocol Pings at intervals of 30002/29998/30000 ms and no unexpected closure.
The test clients were disconnected afterward; the desktop remains available.
Local diagnostic result: `/tmp/remotexapp-ping30-uat-result.json` (not durable
release evidence). This is not a claim of Cloudflare-path acceptance.

**Unreleased RFB idle keepalive — 2026-09-12:** direct and compatibility Go
RFB relays now send a WebSocket Ping every 30 seconds with a five-second control
write deadline. Browser Pong replies are protocol-only. No SDK/App change or
new missing-Pong timeout; existing reconnect policy is unchanged. RFB-001 tests
cover idle survival, data integrity and closure cleanup. Deployment status is
recorded above; existing pinned gateways need an explicitly approved core
upgrade/restart to adopt the fix. The sandbox10 incident showed approximately
125 seconds of RFB silence before a Tunnel-side close, not an application crash.

**Fleet aligned to stable 0.9.0 — 2026-09-10:** all eight approved endpoints
(local loopback 1991/2992, sandbox00 1991/loopback 2991, sandbox02/03/07/10
1991) now run commit `5969c1488d90`, SDK `0.26.0`, with selected Firefox
`2.2.0` and Edge `1.1.0`. Exact formal bytes were staged everywhere before
selection. Two Manager starts, binary/asset/catalog identity, preserved config
and pre-existing runtime pins, connection/action discovery and clean warning
journals passed. Local listeners remain loopback; sandbox policies unchanged.
Existing runtimes were not upgraded or stopped: old pins remain intentional.
New sandbox00 application activity observed after activation was left untouched.
Direct build-host private HTTP probes still time out on all five sandboxes;
container-loopback validation passed. External access is not certified; no
gateway/firewall changes. See [alignment evidence](../tests/evidence/v1/app-actions-0.9.0-alignment.json).

**Stable App Actions released — 2026-09-10:** formal Latest
[`v0.9.0`](private-history.md),
commit `5969c1488d90`, SDK `0.26.0`, Firefox `2.2.0`, Edge `1.1.0`.
Hosted Verify/candidate gates, full exact-archive E2E and sensitive-data checks
passed. Publication reused the candidate; independent download matched its
identity and bytes. [Publication evidence](../tests/evidence/v1/app-actions-0.9.0-publication.json).
No deployment performed: local 1991/2992 remain on rc.1; existing local
XFCE/Edge remain ready at generation 3. Sandbox release remains unchanged.

**App Actions UAT accepted — 2026-09-10:** operator approved formal GitHub
`0.9.0` publication with SDK `0.26.0`, Firefox `2.2.0` and Edge `1.1.0`.
Only stable metadata and acceptance documentation change from accepted rc.1.
Publish only after stable candidate gates and exact-archive E2E pass.
No additional environment deployment is authorized by this publication request.
Local XFCE and Edge were separately force-upgraded to rc.1: both running/ready,
generation 3, connection reads successful, and Edge openUrl capability ready.
Local 2992 has no active runtimes. Persistent profiles and IDs were retained.
See [acceptance](../tests/evidence/v1/app-actions-0.9.0-human-uat.json).

**App Actions candidate deployed locally — 2026-09-10:** Core `0.9.0-rc.1`,
commit `fc2d94e6b764`, SDK `0.26.0`, Firefox App `2.2.0` and Edge App `1.1.0`
are deployed to loopback `127.0.0.1:1991` and `127.0.0.1:2992` for UAT.
Hosted Verify/candidate gates and complete exact-archive E2E passed, including
BiDi contention, cancellation/Manager-crash cleanup and a generic new action
without rebuilding. Deployment reused those verified bytes, checked two Manager
starts, preserved configs/pins and passed real post-deployment SDK calls.

Production Console remains enabled; test Console remains disabled and kiosk
enabled. Existing production XFCE (Core `0.6.0-rc.1`, App `2.0.0`) and Edge
(Core `0.8.1`, App `1.0.0`) were not upgraded or stopped. The old Edge pin
has no actions: use explicit **Upgrade and restart** before testing openUrl
there. A newly launched Firefox uses the new package. Test-created runtimes
were stopped. Human UAT is pending; no GitHub Release/tag, sandbox rollout or
gateway changes were made. Stable GitHub/fleet release remains `0.8.1`.
See [train and UAT instructions](app-actions-release.md) and
[candidate/deployment evidence](../tests/evidence/v1/app-actions-0.9.0-rc.1-local.json).

The following records describe earlier states and are retained for audit.

**Sandbox runtime upgrades complete — 2026-09-10:** following explicit force
approval, sandbox00 XFCE/Firefox and sandbox07/10 XFCE were upgraded to 0.8.1
through the guarded API. Sandbox02/03 were already current and were not
restarted again. All six sandbox runtimes report current 0.8.1, no update,
completed upgrade, running session and ready application, with no shutdown
or error state. Actual RFB activation, IBus metadata and connection-descriptor
checks passed for the four newly upgraded runtimes. Persistent profiles and
runtime IDs are retained; forced termination can discard unsaved contents.
This supersedes the partial recovery status below. No local runtime upgrade,
host force-policy change, or gateway change was performed. See
[completion evidence](../tests/evidence/v1/upgrade-0.8.1-force-completion.json).

**Current release and deployment — 2026-09-10:** formal Latest `v0.8.1`,
commit `7c252209b250`, SDK `0.25.1`, is published and aligned on all eight
endpoints: local loopback 1991/2992, sandbox00 1991/loopback 2991, and
sandbox02/03/07/10 1991. Hosted Verify/candidate, complete exact-archive E2E,
publication and independently downloaded byte verification passed. Two Manager
start checks per endpoint preserved configs and existing pins before the
separately authorized runtime upgrade phase. All App versions are unchanged.

**Runtime recovery is partial:** sandbox02 and sandbox03 XFCE runtimes have
successfully upgraded to 0.8.1; actual desktop activation, RFB, IBus and
connection descriptors passed (generations 2 and 3). Their prior launch-failed
incident below is resolved. Sandbox00 XFCE graceful upgrade returned HTTP 409
`shutdown-blocked`; its old 0.5.3 runtime survives. The batch stopped there:
sandbox00 Firefox and sandbox07/10 XFCE remain on their previous pins. No force
was used and local runtime pins were not upgraded. Additional explicit force
approval is required to discard unsaved state on the blocked desktop. Direct
build-host private HTTP still times out; container-loopback verification passed.
No gateway/firewall changes. See [release, alignment and partial recovery evidence](../tests/evidence/v1/upgrade-0.8.1-alignment.json).

The following records describe earlier states and are retained for audit.

**Runtime upgrade incident — 2026-09-10 14:06 UTC:** the operator authorized
upgrading all sandbox runtimes after the Manager alignment below. Sandbox02
and sandbox03 XFCE upgrade POSTs stopped their servers but failed at fixed
display allocation (`launch-failed`, display :1 already in use). Both desktop
runtimes are failed/stopped, not available for connection; their Managers remain
healthy. Sandbox00/07/10 runtime upgrades have not been attempted. Sandbox00
test has no runtimes. Persistent user data was not deleted. Sandbox03's earlier
shutdown-blocked state was cleared by a separately authorized forced ordinary
restart before this upgrade attempt.

The local UPG-002 correction releases the stopped record's allocation before
launching the upgrade target; no fixed release has been deployed yet. Do not
describe the previous Manager alignment as successful runtime upgrades. Resume
the durable failed upgrade through its guarded API after deploying a verified
fix; do not edit pins/manifests manually or overwrite the published 0.8.0 bytes.

**Current fleet alignment — 2026-09-10 13:57 UTC:** formal `0.8.0`,
commit `c097bbcdb032`, SDK `0.25.1`, is active on all eight endpoints:
local loopback 1991/2992; sandbox00 production 1991 and loopback test 2991;
sandbox02/03/07/10 production 1991. Production sandbox wildcard listeners
and all existing auth, document-root and Console/kiosk settings are preserved.
Each endpoint passed two Manager start/adoption checks, exact running binary
and served SDK/Console hashes, catalog and configuration checks. Existing
runtime IDs, generations, session states and immutable pins are unchanged.
All five running sessions returned token-free connection descriptors.
Production catalogs contain seven Apps; test catalogs contain six (no XFCE).
Sandbox02's stopped session and sandbox03's shutdown-blocked session are
pre-existing and were preserved. No application was stopped or recreated.
Build-host direct private-IP HTTP probes timed out on all five sandboxes;
container-loopback health/readiness passed. External access is not certified;
no production gateway or firewall was changed. See
[alignment evidence](../tests/evidence/v1/connections-0.8.0-alignment.json).

The deployment and authorization statements below are historical records.

**Current stable release — 2026-09-10 11:48 UTC:** GitHub `v0.8.0` is published
as normal Latest (not draft/prerelease), commit `c097bbcdb032`, SDK `0.25.1`.
Hosted Verify/candidate and full exact-archive E2E passed, including the cached
SDK-entry root/subpath regression and disposable-user XFCE. The independently
downloaded release exactly matches the tested archive and passes identity and
sensitive-data verification. See [publication evidence](../tests/evidence/v1/connections-0.8.0-publication.json).
No deployment or Edge recovery was performed; local services remain on rc.3.

**Stable publication authorized — 2026-09-10:** the operator accepted rc.3 UAT
and requested GitHub stable `0.8.0`, with SDK `0.25.1` and unchanged App packages.
Only stable version metadata/documentation and the test-fixture correction
change from accepted runtime code. Hosted candidate and exact-archive tests
are required before publication. No new deployment or Edge recreation is
authorized. Prior failed deployment-preservation evidence remains unchanged.
See [UAT](../tests/evidence/v1/connection-trains-0.8.0-human-uat.json).

**Current local deployment — 2026-09-10 09:32 UTC:** Core `0.8.0-rc.3`,
SDK `0.25.1`, commit `3a3e63a2e7e9` is active and ready on loopback 1991/2992.
Console `console-H3AGT7HZ.js` binds its matching SDK hash directly. Candidate
release-ci and all E2E suites passed after isolating the cache regression from
the short-lived editor fixture. 2992 post-deployment checks passed.

**Deployment incident / acceptance incomplete:** Manager selection successfully
preserved both existing runtimes, but the subsequent 1991 smoke script reused
the existing Edge singleton and then stopped it during test cleanup at 09:32:17
UTC. `edge-721897a6883d` is stopped; its default persistent profile directory is
retained. No recovery/recreation has been performed; operator direction is needed.
XFCE `xfce-user-desktop-44ea8c2186ee` remains running at generation 1 and its old
core pin. Do not describe this rollout as full runtime-preservation acceptance.
No sandbox or Cloudflare configuration changed. See
[incident and evidence](../tests/evidence/v1/console-sdk-binding-0.8.0-rc.3-local.json).

**Current local deployment — 2026-09-10 08:55 UTC:** CONN-004, Core
`0.8.0-rc.2` / SDK `0.25.1`, commit `a96b7bd51435`, is deployed to both
`127.0.0.1:1991` and `127.0.0.1:2992`. Connection reads no longer require
a dedicated token; normal Manager authentication/origin checks remain. Existing
token-file configuration is ignored. With auth-mode=none, reachable callers
can read descriptors. Console remains enabled on 1991 and disabled on 2992.
Local clean-clone release-ci, exact-archive E2E and both endpoints' six-App
token-free IBus checks passed. Existing desktop ID/generation/core pin, App
selectors and configuration are unchanged. No sandbox deployment or formal
publication. Human UAT remains pending. See
[evidence](../tests/evidence/v1/tokenless-connections-0.8.0-rc.2-local.json).

The rc.1 token-entry instructions and deployment record below are historical.

**Current local UAT train:** CONN-002/003, Core `0.8.0-rc.1` / SDK `0.25.0`,
locked for development, testing and local loopback 1991/2992 deployment only.
Adds a trusted read-only Console inspector and validated private IBus connection
metadata. Existing runtimes and access policies must be preserved. See
[the locked train](console-connections-release.md).

**Current local deployment — 2026-09-10 08:17 UTC:** both `127.0.0.1:1991`
and `127.0.0.1:2992` run exact candidate commit `c64d1857da26`, Core `0.8.0-rc.1`
and SDK `0.25.0`. Hosted gates, exact-archive E2E, disposable-user XFCE checks
and both deployed endpoints' six-App IBus/old-SDK compatibility checks passed.
Console Connection info is available on 1991; 2992 retains Console disabled.
App selectors, auth, tokens, kiosk and loopback policy are unchanged. Existing
managed desktop `xfce-user-desktop-44ea8c2186ee`, generation 1, retains its
`0.6.0-rc.1` pin and reports IBus `metadata-missing` rather than guessing.
Its Console inspector was verified without runtime mutation. The temporary
test UID/home was removed after its user service exited. No sandbox deployment
or formal publication occurred; Human UAT remains pending. See
[evidence](../tests/evidence/v1/console-connections-0.8.0-rc.1-local.json) and
[UAT instructions](console-connections-release.md#local-deployment-and-uat).

**Locked implementation train:** Core `0.7.0-rc.1` / SDK `0.24.0`.
UPG-001–004 add explicit upgrade-and-restart, Client SDK
support and Console current/available version visibility. KTE-001 and KWR-001
add two separate Kate/KWrite templates with [verified control discovery](kate-kwrite-control-research.md). See
[the locked train](runtime-upgrade-release.md). Development, full verification
and local loopback 1991/2992 deployment are authorized. No sandbox, publication
or replacement of existing user runtimes is included. Implementation and exact-
candidate automated acceptance are complete; Human UAT remains pending.

**Previous local deployment — 2026-09-10 07:16 UTC:** Core `0.7.0-rc.1`,
commit `a3f4a2569d4f`, SDK `0.24.0`, Kate `1.0.0` and KWrite `1.0.0`
are deployed to `127.0.0.1:1991` and `127.0.0.1:2992`. Other App versions,
authentication, Agent token files and page policies are retained. Console is
enabled on 1991 and remains disabled on 2992; kiosk is enabled on both.
Exact-archive E2E and both endpoints' four-editor connection/no-save checks
passed, including KDE browser resize, IME readback and reconnect. Both Managers
are healthy with no restart loop. Existing desktop
`xfce-user-desktop-44ea8c2186ee` remains running at generation 1 on its
`0.6.0-rc.1` pins. Console correctly shows the old current and new available
version; no desktop upgrade was performed. See
[deployment evidence](../tests/evidence/v1/runtime-upgrade-0.7.0-rc.1-local.json)
and [UAT checklist](runtime-upgrade-release.md#local-deployment-and-uat).
No sandbox deployment or formal publication was performed.

**Previous local candidate:** MPD-001, LOF-001 and CONN-001 are implemented for
Core `0.6.0-rc.1`, SDK `0.23.0`, Mousepad `3.0.0` and LibreOffice `3.1.0`.
Only local loopback 1991/2992 deployment after exact-candidate acceptance is
authorized. No sandbox rollout or formal publication is included. See
[the train](mousepad-document-release.md) and [Agent connection API](agent-connections.md).
Existing runtime pins must be retained; the token-file capability must never
be copied into Viewer pages or App environments.

**Previous local deployment — 2026-09-10 05:14 UTC:** exact candidate
`0.6.0-rc.1`, commit `0e04b050470b`, SDK `0.23.0`, Mousepad `3.0.0` and
LibreOffice `3.1.0` is deployed to `127.0.0.1:1991` and `127.0.0.1:2992`.
Exact-archive ABI/four-App/document/connection E2E and both deployments' editor,
two-Viewer clipboard and actual paste/readback checks passed. Separate owner-only
Agent tokens are configured by user-service drop-ins; see the train's local UAT
checklist. Catalog membership and existing auth/Console/kiosk policies are retained.
No sandbox was touched and no GitHub Release was published. Human UAT is pending.
See [deployment evidence](../tests/evidence/v1/document-connections-0.6.0-rc.1-local.json).
After separate operator approval at 05:27 UTC, the local managed desktop was
normally stopped and started without force, retaining its HOME and managed
configuration. New runtime `xfce-user-desktop-44ea8c2186ee`, generation 1, uses
current `0.6.0-rc.1` component pins. Its connection descriptor has no unavailable
fields: actual default-user D-Bus, XFCE SessionManager and X11 connections passed,
as did Viewer connection/reconnect and fixed-framebuffer scaling. See
[XFCE follow-up evidence](../tests/evidence/v1/document-connections-xfce-0.6.0-rc.1-local.json).
This supersedes the prior desktop-preservation restriction for that approved
replacement only; other runtime pins must still be retained.

### Previous clipboard train deployment and publication

**Previous local deployment — 2026-09-10 UTC:** the CLP-030–034 candidate
`0.5.4-rc.1` / SDK `0.22.0`, commit `4f55e629cdef`, is deployed to
`127.0.0.1:1991` and `127.0.0.1:2992`. The operator explicitly changed the
local test port from 2991 to 2992; 2991 no longer listens. Exact-archive E2E
and both endpoints' two-Viewer Mousepad/LibreOffice clipboard and real paste
readback passed. Human UAT is accepted and stable `0.5.4` publication is
complete and independently verified as normal Latest; see
[publication evidence](../tests/evidence/v1/clipboard-empty-0.5.4-publication.json). No additional deployment is
authorized. See [candidate evidence](../tests/evidence/v1/clipboard-empty-0.5.4-rc.1-local.json)
and [UAT acceptance](../tests/evidence/v1/clipboard-empty-0.5.4-human-uat.json).

The existing desktop remains running at generation 4 with its `0.5.3` gateway
pin. Use newly created candidate runtimes to test all gateway-side fixes;
Manager replacement does not upgrade an existing pin. Test Console remains
disabled; kiosk and SDK remain available. All future local deployments preserve these
loopback-only bindings, including rollback and alignment. Historical wide-test
listener approvals below are superseded by DEP-016 in the
[alignment process](release-alignment-process.md). Sandbox policies are unchanged.

On 2026-09-08, separately approved formal `0.5.3` alignment completed for
all eight Managers: local 1991/2991, sandbox00 1991/2991, and sandbox02/03/07/10
1991. All report commit `1e4b32e54598`, SDK `0.21.1`, and Firefox App `2.1.1`;
configuration and listener policies are unchanged. See
[alignment evidence](../tests/evidence/v1/firefox-ime-0.5.3-alignment.json).

The subsequently requested old-runtime replacement is **complete**. After
explicit approval for unsaved-data loss, sandbox00/03/10 blocked desktops were
force-stopped through the managed API and recreated on `0.5.3`, retaining
profiles. Together with the earlier local desktop, sandbox02/07 desktop
servers, and sandbox00 Firefox replacements, all active runtime core pins
now use `0.5.3`. The three new desktops passed RFB, application readiness and
clipboard capability checks. See [completion evidence](../tests/evidence/v1/firefox-ime-0.5.3-runtime-completion.json).
Both 2991 endpoints have no active runtime. Container-loopback checks
passed; build-host direct private HTTP access timed out on all five sandboxes.
No firewall or production gateway was changed. Local journal validation is
limited by an existing corrupt historical journal file.

### Previous candidate and publication state

The scope-locked [FFX-007 / RTM-017 candidate train](firefox-ime-fix-release.md)
is deployed only to local 1991 as `0.5.3-rc.1` / Firefox App `2.1.1`, with SDK
`0.21.1` unchanged, commit `2c3c962b44e8`. It restores interactive Firefox
IME focus while retaining BiDi and corrects reusable pinned control-port
recovery. Exact-archive acceptance and deployed input/restart checks passed;
Human UAT is accepted and stable `0.5.3` is formally published and independently
verified; local 1991 remains the accepted rc.1 bytes until separate alignment.
See [publication evidence](../tests/evidence/v1/firefox-ime-0.5.3-publication.json).
Further deployments remain separately approved. The existing
XFCE runtime was preserved. Local 2991 and sandboxes remain on the prior
stable deployment. See [local evidence](../tests/evidence/v1/firefox-ime-0.5.3-rc.1-local-1991.json).

Historical transport and input PoCs were removed from the release branch in
rc.13 and remain available from Git history. Start at the top-level `README.md`,
then follow this handover and the commercial readiness document.

For the proposed multi-instance service built from this baseline, read the
[RemoteXApp Service design](remotexapp-service-design.md) after this handover.

The supported architecture is the noVNC/TigerVNC stack below:

```text
Browser noVNC
  -> Go RFB WebSocket relay + /input metadata
  -> loopback-only TigerVNC
  -> Matchbox + target X11 application
  -> private per-session IBus Unicode and clipboard sockets
```

The Go gateway is the only listener intended to be published. It carries both
RFB and the browser's committed-IME text messages. The browser text path is:

```text
browser committed text -> Go /input -> owner-only Unix socket
-> custom IBus engine -> focused target application
```

This supports Unicode without temporarily replacing the user's X11 clipboard.

The accepted stable target is `0.5.2` with SDK `0.21.1` and App Package ABI
V1. It promotes the exact `0.5.2-rc.1` runtime behavior after complete
automated/E2E validation, Human UAT, prerelease publication, and independent
artifact verification. It also pins Go `1.26.8`, adds measured
vulnerability/coverage/repeat/race/fuzz gates, and introduces build-once
candidate promotion. Publication did not authorize deployment; the operator
subsequently granted a separate, explicit eight-endpoint alignment approval.
Follow the
[development quality process](development-quality-process.md).

The explicitly bounded `0.5.2` rollout completed on 2026-09-04: local
1991/2991, sandbox00 1991/2991, and sandbox02/03/07/10 production 1991. Every
endpoint reports commit `815eae926ef7` and runs Manager bytes from formal
archive SHA-256
`0f8ce1756a89b6e32a855bc6b557722d21c9e4dfe52b385c8867827353210a83`.
Configuration, App selectors, runtime IDs, session generations, and manifest
cardinality were preserved; all attached-client counts and post-activation
warning counts were zero. Exact evidence is
[`development-quality-0.5.2-alignment.json`](../tests/evidence/v1/development-quality-0.5.2-alignment.json).
Use the
[对齐流程](release-alignment-process.md) for this and future approved
multi-endpoint rollouts. Alignment selects one independently verified formal
Manager/core artifact everywhere while preserving per-endpoint policy and
compatible runtime records; it does not replace components pinned to an
already-created runtime.

The accepted scope-locked candidate was RemoteXApp `0.5.0-rc.1` with SDK `0.21.0`.
CLP-018 through CLP-024 implement per-Client active clipboard detection and a
multi-window Unified Console without changing Manager/gateway protocols or App
Package ABI V1. `make release-ci` and real headed-Chrome multi-Viewer tests
passed. The exact candidate is deployed to local 1991 and the Console-disabled
local 2991 environment. Human UAT was accepted and annotated `v0.5.0-rc.1` was
published as an independently checksum-verified GitHub prerelease on
2026-09-03. The operator then approved stable `v0.5.0` publication and
deployment of the resulting exact formal bytes to local 1991/2991, sandbox00
1991/2991, and sandbox02/03/07/10 production 1991. That normal Latest release
and enumerated rollout completed on 2026-09-03. See the
[`client-active clipboard train`](client-active-clipboard-release.md) and its
[`local evidence`](../tests/go-live-validation/results/client-active-clipboard-0.5.0-rc.1-local.json)
[`UAT acceptance`](../tests/go-live-validation/results/client-active-clipboard-0.5.0-rc.1-human-uat.json),
[`rc.1 publication evidence`](../tests/go-live-validation/results/client-active-clipboard-0.5.0-rc.1-formal-publication.json),
[`stable publication evidence`](../tests/go-live-validation/results/client-active-clipboard-0.5.0-formal-publication.json),
and [`fleet deployment evidence`](../tests/go-live-validation/results/client-active-clipboard-0.5.0-fleet-deployment.json).

The stable fleet uses the independently downloaded archive at SHA-256
`7427ffcbbaa6ccceadf201806716ec1db1ae70b6bf71c05e145f0350915fce94`.
All eight endpoints report `0.5.0` commit `639e3d599ad5`; production exposes
five 16-bit Apps while both loopback 2991 environments expose four dynamic
Apps with Console disabled and the stable SDK retained. Production manager
restarts adopted every existing runtime with unchanged identity and matching
manifest cardinality. All post-activation warning journals were empty.

After rollout, sandbox00 exposed the expected limitation of preserving a
pre-clipboard runtime: its managed desktop remained pinned to the 0.2.0
gateway, so the 0.5.0 Manager correctly returned HTTP 409 because that gateway
had no `clipboard.sock`. A Manager restart and runtime restart cannot replace
pinned components. With explicit approval and zero attached desktop clients,
the blocked XFCE logout was forced and `sandbox-desktop` was fully recreated as
runtime `xfce-user-desktop-2e7b598b6a5a`, pinned to 0.5.0. Real Edge/RFB/X11
smoke passed capabilities plus four-format transfer in both directions. The
four follower desktops remain intentionally unchanged and clipboard-unavailable
until separately approved recreation. Exact evidence is
[`client-active-clipboard-0.5.0-sandbox00-runtime-remediation.json`](../tests/go-live-validation/results/client-active-clipboard-0.5.0-sandbox00-runtime-remediation.json).

CLP-025 through CLP-029 are accepted for the stable
[`clipboard prompt reliability release train`](clipboard-prompt-reliability-release.md).
RemoteXApp `0.5.1` / SDK `0.21.1` hardens the optional SDK prompt layout against ordinary wildcard
child-sizing CSS, document the SDK-owned-descendant contract, and add redundant
high-contrast color, arrow, and text cues for clipboard direction and state.
It also corrects same-Viewer rebound suppression when a browser omits or
reorders remote representations during a successful local clipboard write.
Implementation, complete validation, and local 1991/2991 deployment passed.
Human UAT was accepted and annotated `v0.5.1-rc.1` was published as an
independently checksum-verified GitHub prerelease on 2026-09-03. The exact
behavior was then approved for stable promotion and the enumerated formal-byte
alignment. Downstream applications must still correct overly broad host CSS.
Candidate commit `b6e6b2fb19e4` passed the complete release and isolated
real-browser/App gates and is deployed to both local environments. Post-deploy
two-Viewer rich clipboard, rebound, genuine-change, prompt-layout, permission,
reconnect, and cleanup checks passed on each. Exact machine evidence is
[`clipboard-prompt-reliability-0.5.1-rc.1-local.json`](../tests/go-live-validation/results/clipboard-prompt-reliability-0.5.1-rc.1-local.json),
and explicit acceptance is recorded in
[`clipboard-prompt-reliability-0.5.1-rc.1-human-uat.json`](../tests/go-live-validation/results/clipboard-prompt-reliability-0.5.1-rc.1-human-uat.json).
Publication evidence is
[`clipboard-prompt-reliability-0.5.1-rc.1-formal-publication.json`](../tests/go-live-validation/results/clipboard-prompt-reliability-0.5.1-rc.1-formal-publication.json).
Stable acceptance and rollout authorization are recorded in
[`clipboard-prompt-reliability-0.5.1-stable-acceptance.json`](../tests/go-live-validation/results/clipboard-prompt-reliability-0.5.1-stable-acceptance.json).
Stable publication and completed fleet evidence are
[`clipboard-prompt-reliability-0.5.1-formal-publication.json`](../tests/go-live-validation/results/clipboard-prompt-reliability-0.5.1-formal-publication.json)
and
[`clipboard-prompt-reliability-0.5.1-alignment.json`](../tests/go-live-validation/results/clipboard-prompt-reliability-0.5.1-alignment.json).

The preceding `0.4.0` post-publication rollout completed on 2026-09-02 using
the independently downloaded formal archive at SHA-256
`c12ccf4db75ee693ef27142786439086f22b6209ad63f8be0e21c5a7d114d871`.
Local ports 1991 and 2991, sandbox00 production 1991 and isolated test 2991,
and sandbox02/03/07/10 production 1991 all report `0.4.0` commit
`292a20ba5d7e`. Production endpoints expose the five 16-bit Apps; isolated
2991 endpoints expose the four dynamic Apps, disable console, retain kiosk,
and have no runtime. All installed and running manager bytes match the formal
artifact, every sandbox manager runs as user `sandbox`, and no warning was
recorded after activation. Sandbox07's always-on environment and durable
managed record were unchanged.

Production manager restarts adopted the existing desktop runtimes instead of
discarding session state. Their component paths therefore remain locked to
the release from which each runtime was created: local 1991 to `0.4.0-rc.2`,
sandbox00 to `0.2.0`, and the four followers to `0.2.0-rc.5`. This is the
documented live-upgrade invariant; those components move to `0.4.0` on the
runtime's next explicit stop/start. Exact rollout evidence is
[`rich-clipboard-0.4.0-fleet-deployment.json`](../tests/go-live-validation/results/rich-clipboard-0.4.0-fleet-deployment.json).
The prior local rc.2 evidence is
[`rich-clipboard-0.4.0-rc.2-local-1991.json`](../tests/go-live-validation/results/rich-clipboard-0.4.0-rc.2-local-1991.json).
Exact rc.3 acceptance and isolated real-browser evidence is
[`rich-clipboard-0.4.0-rc.3-human-uat.json`](../tests/go-live-validation/results/rich-clipboard-0.4.0-rc.3-human-uat.json).
Formal publication evidence is
[`rich-clipboard-0.4.0-rc.3-formal-publication.json`](../tests/go-live-validation/results/rich-clipboard-0.4.0-rc.3-formal-publication.json).
Stable promotion and formal publication evidence is
[`rich-clipboard-0.4.0-formal-publication.json`](../tests/go-live-validation/results/rich-clipboard-0.4.0-formal-publication.json).

The retained prior stable release is `v0.3.0` at `c719df9bb88c`, with SDK
`0.18.0` and App Package ABI V1. The exact rc.1 behavior passed automated, real
upgrade/rollback, full five-App E2E, local deployment, and Human UAT; the
formal downloaded archive and checksum also passed verification. New Firefox
ESR runtimes use 16-bit color and the
operator-confirmed unused `xfce-desktop` package is retired. It is now the
immediate stable manager rollback release. See the
[`0.3.0` template catalog release](template-catalog-0.3.0-release.md).

Published `v0.2.0` remains the retained rollback baseline. STB-001 through
STB-009 passed, and its historical candidate and rc identities below remain
material for audit. See [`stable-0.2.0-release.md`](stable-0.2.0-release.md).

## Deployment identity

Production artifacts are installed once as root under
`/usr/local/{libexec,share}/remotexapp`, but RemoteXApp itself never runs as
root and never calls `sudo` or `su`. The preferred deployment uses the locked
`remotexapp` account and `deploy/systemd/remotexapp-system.service`. A second
supported mode installs the same root-owned code and starts one
`deploy/systemd/remotexapp-central-user.service` instance in each approved
real user's systemd manager. That mode gives applications the user's actual
UID, HOME permissions and resource ownership without a privileged
cross-user manager.

Each real-user manager needs a unique loopback HTTP listen address. Managers
on the same host also need dynamic display classes or administrator-assigned
non-overlapping fixed displays and RFB/gateway ports. The shipped fixed `:2`
XFCE class is therefore suitable for one manager only unless an administrator
provides a root-owned per-user class catalog. Use a separate UID or container
for mutually untrusted tenants. The deployment procedure and migration rules
are in [`operations.md`](operations.md).

The accepted replacement candidate used central real-user mode and the
root-owned immutable `0.2.0` candidate with SDK 0.18. Exact code commit
`ca1d0b26bf8f` and archive SHA-256
`a6f3baae356bd45c5d45fcee3cf937d0295ec4ec3384bc6c1cd757536c901cfd`
passed release/race/preflight/package gates, rc.10 and legacy rc.5 rollback,
all six App paths, real Chrome/X11, reconnect, logout/relaunch, shutdown, and
Issue #4/#5 abnormal recovery. It is retained as the formal release's rollback
target; rc.10 and rc.5 remain historical rollback releases. The invalidated
`7430689f05cb` candidate is retained under its commit-qualified local directory
for evidence only.

The optional fixed-allowlist operator helper passed authenticated restart,
same-runtime adoption, origin/confirmation/arbitrary-unit rejection, and rate
limiting. It is installed but disabled and inactive in the final local state.
The local rc.1 manager has `NRestarts=0`. `ubuntu-desktop` is running and
server-ready; its four child PIDs survived the complete 0.2.0/0.3.0 rollback
cycle and final clean restart. It is the only active runtime, has zero clients,
and the final journal has no warning or test residue. Exact rc.1 evidence is
in
[`template-catalog-0.3.0-rc.1-local-1991.json`](../tests/go-live-validation/results/template-catalog-0.3.0-rc.1-local-1991.json).
Formal publication did not change this local deployment; activating downloaded
`v0.3.0` remains a separate deployment action.
Rc.9's
complete core/lifecycle evidence remains in
[`unified-console-rc9-local-1991.json`](../tests/go-live-validation/results/unified-console-rc9-local-1991.json),
and the rc.10 navigation correction is in
[`unified-console-rc10-navigation-local-1991.json`](../tests/go-live-validation/results/unified-console-rc10-navigation-local-1991.json).
Replacement stable candidate evidence is in
[`stable-0.2.0-replacement-local-1991.json`](../tests/go-live-validation/results/stable-0.2.0-replacement-local-1991.json).
The first approved sandbox00 staging attempt was restored completely to rc.5
after exposing DEP-015. A separately approved replacement staging pass then
completed the exact rc.5→candidate→rc.5 sequence, App control probes, EXP-007
policy, manager/runtime adoption, XFCE logout, gateway-fault recovery, and
generation-2 relaunch. A later, separately approved production activation now
selects the replacement with its shared unit; exact evidence is in
[`stable-0.2.0-replacement-sandbox00-staging.json`](../tests/go-live-validation/results/stable-0.2.0-replacement-sandbox00-staging.json)
and
[`stable-0.2.0-replacement-sandbox00-production.json`](../tests/go-live-validation/results/stable-0.2.0-replacement-sandbox00-production.json).
Unified Console Human UAT was accepted on 2026-09-01; Firefox and LibreOffice
Human UAT was explicitly accepted later the same day. Evidence is
[`stable-0.2.0-sandbox00-human-uat.json`](../tests/go-live-validation/results/stable-0.2.0-sandbox00-human-uat.json).
Exact stable evidence was then attached to GitHub Issues #4 and #5, both issues
were closed as completed, and the repository had no remaining open issue before
the final publication gate. The final diff contained only the GitHub Verify
dependency correction, changelog, documentation, and acceptance evidence, then
passed both `make release-check` and `make release-ci`.

Formal latest GitHub Release
[`v0.2.0`](private-history.md) now points
to commit `9ef470c01399`. Its downloaded linux/amd64 archive and
`SHA256SUMS` verified at
`7d8665d5e477542ecea79cc4c20dac23797fa8f3c82b78022408a4d55a3e0123`.
The formal asset used Go 1.22.12; the tag annotation's different hash is the
same-commit local Go 1.22.2 gate artifact, not the published asset. Exact
publication and local alignment evidence is
[`stable-0.2.0-formal-publication-local.json`](../tests/go-live-validation/results/stable-0.2.0-formal-publication-local.json).

Local port 1991 now selects the downloaded formal `releases/0.2.0` and retains
the candidate under `0.2.0-candidate-ca1d0b26bf8f`. Both original runtime IDs,
generations, states, and all seven active child PIDs survived formal manager
replacement and a second adoption restart. Six App selectors are unchanged,
the formal-component Mousepad smoke was completely cleaned, `NRestarts=0`, and
no warning followed activation.

Historically, at operator request the local service temporarily listened on
`0.0.0.0:1991` with authentication disabled for wider testing. This is not a
production-secure configuration; the local exception was revoked by DEP-016
on 2026-09-09. Console, kiosk, ordinary APIs and browser
channels are reachable. Rc.24 and later make the existing explicit
`allow-insecure-public` opt-in authoritative for EXP-007, so every client
admitted by this surrounding network boundary can retrieve the complete
secret-bearing environment. Do not log or retain that response.

Sandbox00 production now runs the formal GitHub `v0.2.0` artifact at commit
`9ef470c01399` and archive SHA-256
`7d8665d5e477542ecea79cc4c20dac23797fa8f3c82b78022408a4d55a3e0123`
for the `sandbox` user, with unchanged WAOS v2.0.91 source
`9aa43fbc07d4ba77d9d160653c7a989fa6a92608`. Both core selectors point to
`releases/0.2.0`; all six V1 App Package selectors remain unchanged. The
candidate is retained as `0.2.0-candidate-ca1d0b26bf8f`. The runtime catalog
contains only managed Desktop `xfce-user-desktop-c9c926c84d0f`, server-ready
with its on-attach session stopped and zero clients. Manager PID is `919476`,
`NRestarts=0`; VNC, server, and gateway are active while the session unit is
correctly inactive. Running manager/gateway and all installed binary hashes
match the formal artifact, and no warning followed activation.

Formal rc.5 remains a verified historical rollback release under
`releases/0.2.0-rc.5`; the invalidated candidate is retained under
`0.2.0-candidate-7430689f05cb`, and the rc.5 candidate remains under
`0.2.0-rc.5-candidate-8c03c485adc5`. Validation used direct container loopback
and never the production gateway. The build host's direct private HTTP path
remains blocked by the existing UFW allowlist; no firewall rule was changed.
Stable Human UAT was accepted on 2026-09-01. Exact formal production evidence
is
[`stable-0.2.0-formal-sandbox00-production.json`](../tests/go-live-validation/results/stable-0.2.0-formal-sandbox00-production.json).

The sandbox00 stopped-consumer rollback snapshots are
`webagenticos-v2.0.91-paired-20260830T190100Z-root` and
`webagenticos-v2.0.91-paired-20260830T190100Z-home`; they preserve the prior
rc.24/WAOS v1.0.88 pair and state. Because rc.24 cannot read forward-written
V1 state, downgrade must restore both snapshots before starting the old
provider. The operator accepted Human UAT on 2026-08-30 and then explicitly
approved ordered follower promotion.

Sandbox02, sandbox03, sandbox07, and sandbox10 now run the separately approved
post-train formal `v0.2.0` artifact at commit `9ef470c01399` and archive
SHA-256
`7d8665d5e477542ecea79cc4c20dac23797fa8f3c82b78022408a4d55a3e0123`.
Their existing WAOS deployment and six App Package selectors were unchanged.
Both core selectors point to `releases/0.2.0`; formal rc.5 remains the rollback
release. Each zero-client managed Desktop was adopted across two manager
restarts without changing its ID, creation identity, generation, state, or
child PIDs. Final server-ready Desktop IDs are sandbox02
`xfce-user-desktop-18e0063a4730`, sandbox03
`xfce-user-desktop-fe38ea6ea902`, sandbox07
`xfce-user-desktop-5f777640df67`, and sandbox10
`xfce-user-desktop-7f82a5db6646`.

Before activation sandbox07 and sandbox10 were in pre-rc.5 duplicate-manifest
manager restart loops. Rc.5 used each durable `sandbox-desktop` pointer to
reduce three and two Desktop manifests respectively to one before the explicit
runtime restart. All four followers now expose exactly one API runtime and one
manifest, zero clients, `NRestarts=0`, no warning since final activation, and
the required fixed 1280x720 user-home Desktop policy. Sandbox02/03/07 sessions
are stopped; sandbox10's running session and all four child PIDs were preserved.
Existing runtime manifests remain component-locked to rc.5 until those runtimes
are naturally recreated; this is the documented live-upgrade invariant, not a
partial core installation. Sandbox10's three manifestless stopped history
records were cleared by manager restart as expected.

Sandbox07's always-on configuration was not changed. Build-host access to all
four private HTTP listeners timed out against their existing per-sandbox UFW
allowlists; verification used direct container loopback without changing
UFW/LXD networking or using the production gateway. Sandbox00 was not changed
by this follower deployment. Exact evidence is
[`stable-0.2.0-formal-followers-production.json`](../tests/go-live-validation/results/stable-0.2.0-formal-followers-production.json).

The architecture-major App Package ABI v1 train is accepted, scope-locked,
and accepted on sandbox00 through Human UAT. Its invariant is that an ordinary
application can be installed or upgraded as one trusted immutable package
without rebuilding or editing the Go manager, gateway, status helper, browser
SDK, global preflight, or unrelated templates. The initial activation boundary
is a safe manager
restart, not hot catalog reload. V1 uses one `apiVersion`, checksummed immutable
artifacts pinned by runtime digest/path, named loopback TCP ports, bounded JSON
driver status, declarative override/readiness policy, simple executable/Python-
module dependency checks, and package-owned tests. Microsoft Edge CDP is the
reference migration, followed by all current templates and a coordinated WAOS
envelope migration; WAOS retains application-specific protocol adapters. The
full managed/anonymous lifecycle redesign is deferred and current coherent
`runMode` and lifecycle behavior remain. The required downstream procedure is
[`waos-app-package-migration.md`](waos-app-package-migration.md). Read
[`app-package-major-release.md`](app-package-major-release.md) before changing
the template schema, control endpoint API, managed/anonymous lifecycle, driver
helpers, dependency checks, or catalog tests. This locked train does not
change or reopen the accepted rc.24 artifact.

The rc.22 lifecycle correction makes a repeated managed desired-stop with
`force: true` override an already durable `shutdown-blocked` state. It also
preserves a live blocked managed session across manager restart while keeping
an already persisted forced-stop intent eligible for cleanup. Isolated real
Mousepad, Chrome/noVNC, durable-manifest, stable-unit-PID, and complete forced
cleanup evidence is in
`tests/go-live-validation/results/managed-blocked-force-rc22-local.json`.

SDK 0.12 derives an external same-origin base path from its own module URL, so
a reverse proxy may publish the complete browser surface below a prefix and
strip it upstream. The stable loader uses a relative generated-asset import,
and the built-in console and kiosk preserve the same prefix. Operators may
independently disable those built-in pages with
`REMOTEXAPP_DISABLE_CONSOLE=true` and `REMOTEXAPP_DISABLE_KIOSK=true`; this does
not disable the SDK, APIs, instance health, or RFB/input channels.

The rc.10 schema uses one required
`runMode` instead of separately configurable profile and D-Bus modes. `user-home`
selects that same account's passwd HOME, `/run/user/<uid>/bus`, and
`~/.Xauthority`, allowing a plain SSH login to launch onto the fixed display.
It remains persistent and singleton; temporary launch, cross-user access, and
HOME purge are rejected. Automated SDK reconnect and a clean-environment
Mousepad launch with only `DISPLAY=:1` passed; human UAT was accepted on
2026-08-27. See
`tests/go-live-validation/results/run-mode-user-home-rc9-local.json`.

## Class manager

`cmd/remotexappd` now loads every JSON class in
`configs/remotexapp-classes/`. The Go manager contains no XFCE, Matchbox, or
Mousepad class switch: declarative scheduling policy lives in JSON and
imperative application setup lives in the referenced server/session drivers.
Drivers are semantic-versioned immutable bundles. Production releases are
installed side by side. All active managed and anonymous runtimes now persist
one unified manifest. Process failure within one manager lifetime uses the
resolved snapshot; manager restart adopts a healthy runtime with its exact units
and application. An unhealthy runtime without a live application is recreated
under the same ID from that locked snapshot. The lifecycle and update procedure are in
[`driver-version-lifecycle.md`](driver-version-lifecycle.md).

The 0.3 candidate catalog contains five shipped Apps:

- `edge`: shared persistent Edge/CDP singleton.
- `mousepad`: non-singleton dynamic display; isolated HOME; Matchbox + Mousepad
  starts on RFB attach; vacancy stops the entire instance after 5 seconds. It
  also proves the generation-safe driver status contract implemented by
  `cmd/remotexapp-status` and documented in
  [`application-status.md`](application-status.md).
- `libreoffice`: non-singleton dynamic 1280x720 depth-16 display at 10 FPS;
  required manager-authorized `filePath`; immediate isolated LibreOffice
  session with staged readiness; generic loopback UNO resource; destructive
  no-save stop; vacancy stops the entire instance after 60 seconds.
- `firefox-esr`: unmanaged singleton with dynamic 1280x720 depth-16 display;
  first attachment starts Matchbox + Firefox, and six detached hours stop the
  complete runtime while preserving shared profile `default` for the next
  anonymous create. Each runtime returns a generic loopback allocation and
  package-owned WebDriver BiDi status metadata; never proxy this
  unauthenticated browser-control endpoint.
- `xfce-user-desktop`: managed-only fixed `:1`; fixed 1280×720 framebuffer
  with client resizing disabled; the manager account's real HOME and user
  D-Bus; one persistent singleton desktop with 48-hour vacancy.

The unused isolated `xfce-desktop` ID is retired in the 0.3 train. It has no
alias or automatic mapping to `xfce-user-desktop`.

LibreOffice driver 2.0.0 formal local evidence covers real systemd, Chrome/noVNC,
dynamic resize, SDK reconnect, UNO unsaved destructive stop, symlink replacement,
unremovable lock, prompt driver errors, and full isolated cleanup in
[`libreoffice-driver-v2-formal-local.json`](../tests/go-live-validation/results/libreoffice-driver-v2-formal-local.json).
Driver 2.0.1 adds canonical-document owner leases and external-process
contention detection. Sandbox validation covered same-driver contention,
dead-lease recovery, and protection of an active 2.0.0 session; evidence is in
[`libreoffice-driver-v2.0.1-sandbox.json`](../tests/go-live-validation/results/libreoffice-driver-v2.0.1-sandbox.json).
Human LibreOffice/UNO/document lifecycle UAT was accepted on 2026-09-01.

Unix sockets use a short per-instance directory below `/run/user/$UID` rather
than the state/profile path. This is required because long class and instance
names can exceed Linux's `AF_UNIX` path limit even when all ordinary filesystem
paths are valid.

The manager API exposes lifecycle, client count, class policy, input/caret
state, text latency, and live RFB counters. Host HOME/runtime/socket paths,
internal endpoints, and systemd unit names are redacted by default. An
authorized operator may temporarily enable `-expose-internals` for diagnosis.
All non-health routes require the configured authenticated proxy identity.

The current full-desktop milestone is package-configured by
[`apps/xfce-user-desktop/manifest.json`](../apps/xfce-user-desktop/manifest.json)
and managed by [`cmd/remotexappd`](../cmd/remotexappd). A desired-running
managed registration owns fixed display `:1`. The server remains available;
RFB attachment starts the account's user-home XFCE session, and 48 detached
hours stop only that session. Client resize is disabled. The session uses the
manager account's user D-Bus and owns its IBus, Unicode engine, and Clipman
processes. Historical P03/P03b evidence for the retired private-D-Bus display
`:2` template remains below and in Git history.

### Accepted performance work versus deployed state

| Experiment | Accepted result | Repository/deployment state |
|---|---|---|
| P01 lean IBus | Mousepad end-to-end input and caret push passed; server layer fell from about 101 MiB to about 62 MiB | Live in common and Full XFCE server drivers |
| P02 opt-in input tracing | Input regression passed; 27 text commits and zero `client event:` journal entries; about 98 trace bytes avoided per synthetic event | Live in SDK 0.8 with tracing off by default |
| P03 no Clipman | Disposable Mousepad input and in-app clipboard passed; steady server layer about 39.5 MiB | Live for disposable single-app classes |
| P03b XFCE session Clipman | Three generations passed exactly-one ownership, cleanup, input, clipboard and reconnect | Live on display 2 with adaptive panel/fallback ownership and exactly-one readiness |
| P04 display depth | Generic depth 16 used 4.52 MiB less memory; depth 24 required 71.5% more VNC CPU per scroll operation | Generic class default remains 16; WeChat remains 24 because depth 16 is visually incorrect for that app |
| P05 RFB relay queue | Capacity 8 cut measured slow-client heap growth from 16.18 MiB to 0.68 MiB; all interactive input/reconnect checks passed | Live; queue capacity 8 |
| P06 demand diagnostics | Hidden 5.2-second samples produced zero health requests, diagnostic events and DOM mutations; all input/toggle checks passed | Live; kiosk polls only while visible and console explicitly opts in |
| P07 bundled browser assets | Static requests fell 45 -> 3; cold transfer fell 551,233 -> 181,399 B; Unicode/readback and explicit reconnect passed | Live; matched post-live load was 3 requests/182,088 B |
| P08 direct Xtigervnc | Lean server layer fell 42,831,872 -> 32,141,312 B; failure propagation, wrapper fallback and interactive regression passed | Live with `direct`; `wrapper` remains explicit fallback |
| P09a managed persistence | Four healthy passes fell from four `fsync`/renames to zero; transitions, restart adoption, fault recovery and Unicode reconnect passed | Supported; the fresh local fixed XFCE uses the unified anonymous manifest path |
| P09b managed observation | 30-second `xdpyinfo`/health calls fell 6/6 -> 0/0; gateway/VNC recovery, restart adoption and interactive input passed | Live with cgroup events and 4-6 minute safety pass |
| P10 session observation | Per-session 30-second PID reads/`kill(0)` fell 60/60 -> 0/0; temp, managed/restart, fallback, Full XFCE and exact browser checks passed | Live with shared cgroup observer; `poll` remains fallback |
| P11 cursor fan-out | A 10 ms slow peer no longer delayed the publisher/fast peer by about 324 ms; newest snapshots coalesce at about 3.19 KiB per connected input peer | Live in current `novnc-input` |
| P12 text batching | Single ordinary timer latency fell 40.490 -> 16.278 ms and completed composition 40.307 ms -> 8.5 us; a five-event/10 ms burst remained one commit and native-IME regression passed | Live in SDK 0.8; `textBatchDelay:40` remains compatibility mode |
| P13 text logging | A 600-request run fell from 2,400 success lines/135,947 B to zero and removed 29.6% of gateway write syscalls; ACK latency was unchanged and native-IME regression passed | Live with default `errors` |
| P14 session-owned input stack | Live vacant server unit fell from 16,887,808 B/18 tasks to 212,992 B/1 task; isolated and production XFCE/Mousepad/Edge passed Unicode, clipboard, resize/reconnect and exact cleanup | Live for all repository classes; current hashes `188afc12…` / `304f77f9…` / `3ee10fb2…` |
| P15 remote resize scheduling | A 300 ms trailing run held `1000x613` through four viewport changes while scaling locally, then reached only `1100x740`; finite 400 ms max-wait advanced at 440.20 ms, flush and reconnect passed | Live in SDK 0.15; port-1991 E2E and human native-IME/resize UAT accepted 2026-08-29 |
| P16 Core-owned input services | Matched median launch/restart +530/+543 ms, memory +4.18 MiB, one extra supervisor, unchanged service counts and bounded cleanup | [Measured gates passed](../tests/performance/core-session-services/README.md); Core 0.12 candidate, human UAT separate |

The post-P14 lifecycle follow-up makes XFCE's orderly Logout a driver-reported
`exited` state and keeps crashes as `failed`. Isolated `1993/:31` and live
Display 2 both passed Logout with an attached RFB peer, generation-2 reattach,
and final vacancy cleanup. Read [`drivers/README.md`](../drivers/README.md)
before adding a class; it contains the shared helper contract and copyable
template.

The authoritative experiment evidence remains in
[`performance-experiments.md`](performance-experiments.md). Deployment and
matched system measurements are in
[`go-live-report-2026-08-27.md`](go-live-report-2026-08-27.md).
The formal product/unit/API/SDK naming cutover and its live Display 2
verification are recorded in
[`remotexapp-cutover-2026-08-27.md`](remotexapp-cutover-2026-08-27.md).

Completed experiments must also have a registered directory README and result
JSON under `tests/performance/`. The manifest and automated consistency gate
are `tests/performance/experiments.json` and `make performance-docs-check`.
Do not hand over a newly accepted/rejected experiment until that check passes
and every affected baseline/design/deployment document is synchronized.

## Required reading order

Read in this order. Do not skip the lessons document: it records real failures
that are easy to reintroduce with a seemingly simpler implementation.

1. [`docs/novnc-impress-lessons.md`](novnc-impress-lessons.md)

   This is the design record and source of truth for observed behaviour. Give
   special attention to:

   - **Text input design**: why clipboard, XTEST, and Unicode keysyms are not
     the generic answer; why the custom IBus commit engine is the candidate.
   - **IBus input-method switching**: reproduced browser key-event failures and
     the fix. Do not replace evidence-backed handling with a new hypothesis.
   - **Hybrid physical/text routing**: SDK 0.11 sends reliable physical ASCII
     through RFB and committed Unicode through IBus. Polkit validation proves
     ordinary ASCII passwords work. Non-ASCII secure-field input is not
     supported: a widget without an IBus context can leave the previous
     application's context active, so the commit may reach that application.
   - **Push caret positioning**: read
     [`docs/ime-caret-push.md`](ime-caret-push.md) before changing the private
     IBus socket, SDK input channel, or hidden browser textarea. Cursor
     freshness and safe refocus are part of input correctness.
     SDK 0.15 also makes a safe primary pointer the immediate pre-caret native
     anchor; right/middle/non-primary pointers are excluded, and composition or
     queued/in-flight text must never be blurred/refocused.
   - **WeChat**: colour requirements, Matchbox resize behaviour, Electron
     memory costs, and profile isolation.
   - **Reproducible `systemd-run` setup**: the exact known-working fresh-HOME
     deployment, verification, and stop procedure.

   For the full-XFCE service, then read
   [`apps/xfce-user-desktop/README.md`](../apps/xfce-user-desktop/README.md),
   its manifest, and `cmd/remotexappd/main.go`. The retired private-D-Bus
   template remains available only in Git history and historical evidence.

2. [`docs/performance-baseline.md`](performance-baseline.md)

   This records the measured idle cost, every current polling interval, known
   input/diagnostics and RFB hot paths, scale risks, and the required workload
   for comparing future optimizations. P05 accepted an eight-entry
   `/rfb-compat` queue and P06 made browser diagnostics demand-driven after
   deterministic and interactive testing. Read the baseline and experiment
   record before changing gateway queues,
   browser timers, logging, managed reconciliation, or per-instance process
   boundaries.

   P07's browser build and cache contract are reproduced in
   [`tests/performance/assets-bundle/README.md`](../tests/performance/assets-bundle/README.md).
   Normal applications import only `/sdk/index.js`; generated hashes are an
   internal manifest detail. noVNC is pinned as reviewed release source under
   `third_party/novnc/`, with version, peeled tag commit and archive checksum in
   `UPSTREAM.json`. Run `scripts/update-novnc.sh VERSION` for an upstream stable
   release and run `make web-assets` through the normal
   `backend-build`/`backend-test` targets rather than hand-editing vendored or
   generated files. The asset adapter intentionally contains private noVNC
   keyboard and resize boundaries; `make novnc-check` must fail before either
   interface can drift silently. The complete ownership and update process is in
   [`novnc-upstream.md`](novnc-upstream.md).

   P08's launcher topology, Xauthority handling, five-run measurements and
   crash injection are in
   [`tests/performance/direct-xtigervnc/README.md`](../tests/performance/direct-xtigervnc/README.md).
   New builds default to direct `Xtigervnc` supervision; use
   `-vnc-launcher=wrapper` only as a deliberate compatibility rollback.

   P09a's historical persistence and restart-adoption contract is reproduced in
   [`tests/performance/managed-persistence/README.md`](../tests/performance/managed-persistence/README.md).
   Healthy no-op reconciliation must not write the managed registry. Unified
   restart adoption is specified by RTM-007 through RTM-009; P09b's
   same-manager fault observation remains active.

   P09b's cgroup/inotify topology, resource cost and fault timings are in
   [`tests/performance/managed-observer/README.md`](../tests/performance/managed-observer/README.md).
   Keep the slow jittered safety pass: cgroup events prove process exit, not a
   live process's application-level responsiveness. `poll` is an explicit
   compatibility rollback, not the preferred steady-state mode.

   P10's session-unit extension, failure timings, Full XFCE check and explicit
   PID-poll fallback are in
   [`tests/performance/session-observer/README.md`](../tests/performance/session-observer/README.md).
   It shares P09b's one inotify FD/goroutine and adds one watch descriptor per
   running session. Do not add a second observer or restore per-session timers
   unless the host requires the documented fallback.

   P11's deterministic slow-peer harness, per-peer resource cost and real
   cursor-cache/Unicode/reconnect validation are in
   [`tests/performance/cursor-fanout/README.md`](../tests/performance/cursor-fanout/README.md).
   Cursor messages are replaceable snapshots; text acknowledgements and RFB
   chunks are not. Do not apply latest-value dropping to those reliable paths.

   P12's browser timer comparison, 8/0 ms rejected candidates, real SDK/noVNC/
   IBus measurements and native-IME acceptance are in
   [`tests/performance/text-batching/README.md`](../tests/performance/text-batching/README.md).
   The 16 ms default coalesces the tested burst; completed composition flushes
   immediately. Keep pending text scoped to one channel generation.

   P13's matched journald/syscall comparison, counter/error replacement,
   plaintext-redaction rule and native-IME acceptance are in
   [`tests/performance/text-logging/README.md`](../tests/performance/text-logging/README.md).
   Normal managers must retain `-gateway-text-log errors`; `content` is a
   sensitive, short-lived operator diagnostic mode, never a client parameter.
   This controls the Go gateway only. The private Python IBus engine still
   writes one content-free byte/character-count entry to `engine.log` per
   successful commit; P13 held that behavior constant and a future change
   needs a separate measurement.

   P14's deployed input-stack ownership, monotonic cursor sequence requirement,
   expected absent-socket behavior and two-generation cleanup evidence are in
   [`tests/performance/session-owned-ibus/README.md`](../tests/performance/session-owned-ibus/README.md).
   All repository production classes now use the common session helper. The
   parser's `server` default exists only for external backward compatibility.

   P15's public scheduler, guarded noVNC-private bridge, compatibility mode,
   trailing/max-wait measurements, local scaling, flush, reconnect, and IME
   regression are in
   [`tests/performance/resize-debounce/README.md`](../tests/performance/resize-debounce/README.md).
   Keep `resizeDebounce:0` compatible, keep fixed policy authoritative, and
   update `make novnc-check` whenever the bridge's private noVNC surface changes.

3. [`cmd/novnc-input/main.go`](../cmd/novnc-input/main.go)

   Read the process configuration and route map first. This contains the
   direct raw-RFB-to-WebSocket relay, the noVNC static/embedded pages, `/input`,
   the optional legacy A/B relay, the IBus socket configuration, and the active
   X11 `WM_CLASS` allow-list guard.

   Then read [`cmd/novnc-input/input.go`](../cmd/novnc-input/input.go). P11
   isolates pushed cursor snapshots with one capacity-one queue/writer per
   input peer. All writes for a peer still share one mutex to satisfy Gorilla
   WebSocket's single-writer contract. P13 keeps successful input off the
   journal by default and reports aggregate counters through `/healthz`; errors
   and ACK error semantics remain intact.

4. [`cmd/novnc-input/x11_native.go`](../cmd/novnc-input/x11_native.go)

   This is the native X11 boundary: pointer coordinate mapping, buttons,
   keyboard events, clipboard ownership, dynamic Unicode keysyms, active-window
   class lookup, and XTest synchronization. Treat it as security-sensitive
   control code.

5. Browser and transport tests:

   - [`cmd/novnc-input/web/kiosk.html`](../cmd/novnc-input/web/kiosk.html):
     noVNC connection, browser resize, and committed browser IME events.
   - [`cmd/novnc-input/rfb_proxy_test.go`](../cmd/novnc-input/rfb_proxy_test.go):
     required Go RFB relay compatibility behaviour.
   - [`tests/performance/rfb-queue/README.md`](../tests/performance/rfb-queue/README.md):
     build-tagged slow-client harness, raw-result location and the evidence for
     the accepted capacity of 8.
   - [`tests/performance/text-batching/README.md`](../tests/performance/text-batching/README.md):
     deterministic SDK timing and the required English/Chinese switch,
     first-character, reconnect, shortcut, pointer and resize regression.

6. Per-session Unicode runtime:

   - [`tests/ibus-remote-unicode/README.md`](../tests/ibus-remote-unicode/README.md)
   - [`components/remote-unicode-engine/engine.py`](../components/remote-unicode-engine/engine.py)
   - [`tests/ibus-remote-unicode/xstartup-wechat.sh`](../tests/ibus-remote-unicode/xstartup-wechat.sh)

   Together they define the IBus process, its private mode-0600 Unix socket,
   the inherited IM environment, software rendering workaround, Matchbox, and
   debounced WeChat resize watcher.

## Established constraints

- Each independent account gets its own X display, VNC server, IBus runtime
  directory/socket, and redirected HOME. Do not share an X display between
  tenants to save memory; it breaks focus, clipboard, IM context, and account
  isolation.
- Keep TigerVNC loopback-only. Publish only the Go HTTP/WebSocket listener
  through the intended authenticated access layer. An unauthenticated listener
  on `0.0.0.0:1984` is acceptable only for controlled internal testing.
- Keep `/rfb-compat` ordered and lossless. Its accepted channel capacity is 8,
  which bounds its server-to-browser 64-KiB target-read backlog to about 512
  KiB. Browser-to-RFB is also bounded to eight messages, but their byte sizes
  are client-controlled under the WebSocket read limit. Do not drop arbitrary
  chunks as if they were independent video frames; use TCP backpressure and
  repeat P05 before changing the capacity.
- For WeChat, use TigerVNC `-depth 24 -pixelformat rgb888` and launch with
  `LIBGL_ALWAYS_SOFTWARE=1`, `--disable-gpu`, and
  `--disable-gpu-compositing`. The 16-bit `rgb565` experiment produced visibly
  incorrect colours.
- Browser-driven resize needs both TigerVNC
  `-AcceptSetDesktopSize=1` and `?rfb=compat&resize=remote`. Matchbox does not
  automatically resize the WeChat window; the startup watcher does so only
  after two equal root-size samples and leaves a six-pixel edge gap to prevent
  feedback jitter.
- The WeChat/Electron process tree is the dominant memory cost (about 450 MB
  PSS in the measured test). TigerVNC itself was much smaller (about 58 MB PSS
  at 1280x720/24-bit). Prefer on-demand creation and idle shutdown.
- Redirecting `HOME` with `systemd-run --user` provides profile separation and
  cgroup lifecycle management, not a hard security boundary: processes under
  the same Linux UID can still read each other's accessible files. Use a
  distinct user or container for actual access control.
- A fresh redirected WeChat HOME used `.xwechat` and `xwechat_files`. A legacy
  profile used `Documents/xwechat_files`. Persist the entire per-account HOME,
  not only a guessed subdirectory.

## Historical evidence

The obsolete streaming and browser A/B implementations are available only
from Git history. The following retained test material is not the production
baseline:

| Location | What it is | How to use it |
|---|---|---|
| [`tests/novnc-matchbox/`](../tests/novnc-matchbox/) | LibreOffice/Impress kiosk experiments | Reuse its application/layout knowledge only where it fits the product. |
| Root `.pptx` files | Test assets | Not runtime or product implementation. |

## Recommended first implementation cycle

1. Reproduce the documented fresh-HOME `systemd-run` WeChat test unchanged.
2. Verify HTTP 200, RFB connection, mouse/keyboard operation, one committed
   Chinese IME input, resize stability, and that files appear only below the
   session HOME.
3. Convert the two transient commands into a managed per-session service
   lifecycle. Preserve the same process boundaries and environment variables.
4. Put the gateway behind the selected authenticated TLS reverse proxy. Keep
   VNC, D-Bus, IBus socket, and application control sockets private.
5. Add operational health checks, structured logs, session cleanup, resource
   limits, and observability before making multi-account use available.
6. Re-run the regression matrix after every transport or input change:
   English typing; committed Chinese typing; switching IME Chinese/English;
   clicking/focusing; browser resize; reconnect; a new application window;
   and application restart.

## Handover instruction for another agent

> Use `cmd/novnc-input`, `components/remote-unicode-engine`, and
> `docs/novnc-impress-lessons.md` as the only production-candidate baseline.
> First reproduce the documented systemd-run WeChat session, then productize
> per-session HOME/display/IBus lifecycle and authenticated gateway exposure.
> Do not default to old FFmpeg/WebRTC/fMP4 video experiments unless new
> measurements demonstrate that they fit the product better. Retain the IBus
> committed-text path; do not downgrade generic Unicode input to clipboard or
> pure XTEST injection without equivalent evidence and regression tests.

## Minimum verification commands

From this repository:

```bash
make backend-test
sh -n tests/ibus-remote-unicode/xstartup-wechat.sh
```

Transport-queue changes additionally require the isolated reproduction in
[`tests/performance/rfb-queue/README.md`](../tests/performance/rfb-queue/README.md).
Cursor fan-out changes additionally require the build-tagged slow-peer and
cleanup tests in
[`tests/performance/cursor-fanout/README.md`](../tests/performance/cursor-fanout/README.md).

For the live systemd-run session, follow the verification commands in the
[`systemd-run` setup section](novnc-impress-lessons.md#reproducible-setup-fresh-wechat-home-with-systemd-run)
of the lessons document. Live checks require the target host/container,
installed native dependencies, and the owning user's systemd session.
