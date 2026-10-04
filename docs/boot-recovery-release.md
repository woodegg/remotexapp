# Boot-aware runtime recovery — 0.12.2

> Historical technical record. Dated status and validation statements describe
> their original scope; they do not identify a current deployment. See
> [current source versions](current-state.md). Host labels and runtime IDs in
> historical examples are anonymized.

## Published — 2026-09-14

Formal GitHub Latest [v0.12.2](private-history.md)
publishes `c1cecabe076e`, SDK 0.28.0 and unchanged Apps. Hosted and independent
local release gates produced byte-identical archives; all eight exact-archive
E2E suites passed. Downloaded publication assets match the tested candidate.
See [publication and target evidence](private-history.md).

test-host-a production 1991 is restored on the final bytes. Its unavailable
remote storage root reports an error without stopping Manager; configuration is
unchanged. Seven-App real Viewer/X11/IBus/clipboard/control checks and two
Manager restarts passed, as did ownership-verified XFCE normal D-Bus logout
followed by stopped-session API restart. Its existing logout wrapper is unchanged.
Only three persistent runtimes remain active; owned test Apps were stopped,
The host application restored, and boot ID plus paired 2991 PID/version/configuration preserved.

**Pending approval:** final-candidate test-host-a container reboot acceptance.
No container reboot occurred after the operator's latest restriction. Earlier
candidate reboots are historical, not final-byte acceptance. remote storage file
tests remain skipped; native Ubuntu 26.04/Qt6 and physical power loss remain
unverified. Publication does not close those gates or imply new human UAT.
No other environment or production gateway was upgraded. Earlier pending and
maintenance-hold entries below are retained as chronology, not current outage.

## Locked scope and authority

**Latest operator restriction, 2026-09-14:** test-host-a must not be rebooted
without new explicit human approval. This supersedes the earlier inferred
reboot authorization below. Final-candidate container reboot acceptance is
pending approval and must not be claimed as passed or run automatically.
Continue the requested fix/publication and non-container-reboot validation;
record the unexecuted target reboot qualification separately. remote storage tests
remain skipped during maintenance. The paired 2991 unit was subsequently
verified to use only `/home/appuser` as its document root; do not change it.

2026-09-14: operator requested "fix it and create a new release and fully test
it on test-host-a for restart". Implement U26-06, validate locally, then validate
the exact candidate on test-host-a production 1991 with real container reboot
before publishing stable 0.12.2. SDK 0.28.0 and App versions stay unchanged.
This authorizes test-host-a deployment and reboot interruption, not forced loss
of unsaved user work, other sandbox rollout, gateway changes or 2991 upgrade.
test-host-a currently uses Ubuntu 24.04/Core 0.11.0: a controlled stopped-system
Core-services cutover is required before testing. Preserve HOME, profiles,
documents and managed intent; old-architecture runtime IDs cannot be retained.

## Requirements

- BR-001: distinguish a Manager restart within one boot from a changed kernel
  boot identity. Retain same-boot healthy process adoption and terminal failure
  protection. No client, App-specific heuristic or fixed reboot delay.
- BR-002: after a proven boot change, restore desired-running runtimes whose
  last durable state was server-ready with running or stopped session, and no
  pending shutdown/upgrade. Preserve runtime ID, configuration, profiles, App
  and Core pins. Reserve a newer generation; honor immediate versus on-attach
  activation. Rebuilding a session does not restore lost process memory.
- BR-003: do not revive explicitly stopped, failed, starting or shutdown-blocked
  sessions merely because boot changed. Missing/untrusted boot evidence does
  not authorize replay. A live application, foreign display/port owner, failed
  cleanup or failed recovery must not be bypassed or retried indefinitely.
- BR-004: persist recovery intent before cleanup/recreation, so a second Manager
  interruption cannot duplicate runtimes or reuse generations. Preserve the
  existing interrupted explicit restart/upgrade contracts.
- BR-005: automate same-boot/cross-boot policy and ownership negative cases;
  run exact-archive local E2E, then actual test-host-a Manager restart and repeated
  container reboot with active XFCE. Verify same post-cutover ID, monotonic
  generations, on-attach relaunch, X11/IBus/clipboard/connections and unrelated
  services. Record failed/skipped cases honestly, not just /healthz success.
- BR-006 (operator addition, 2026-09-14): unavailable document roots log an error
  but do not terminate Manager startup. Preserve configured roots and validate
  files on demand; restoration must work without restarting Manager. Keep
  syntax errors fatal, enforce canonical containment, and reject unavailable
  file operations before executing a Driver. Loading managed intent must not
  depend on document availability. Use local outage fixtures, not remote storage.

## Design

Read the kernel boot ID once at Manager startup. Store a bounded, owner-only
`runtime-boot.json` in each persistent runtime directory, binding the runtime
ID to its boot. Create it before launching resources; safely backfill it only
after successful adoption of a healthy legacy runtime. Use private atomic
publication plus directory sync. The existing manifest schema and public API
do not change; older Managers ignore this sidecar on rollback.

Before applying offline-session-exit classification, detect eligible cross-boot
recovery and durably enter the existing restarting transaction. Use existing
identity-checked cleanup and pinned recreation, never global PID/socket removal.
Do not overwrite evidence on failed/unhealthy adoption. Ordinary failures and
Viewer reconnect remain fail-closed. Boot ID proves a different boot, not
whether shutdown was planned; this train does not claim to distinguish reboot
from power loss or introduce a general crash restart policy.

A shutdown cancelled by a subsequent Viewer attachment is terminal, not a
pending refusal. An otherwise eligible running/stopped session with a completed
or cancelled shutdown may recover; requested, timed-out and unknown shutdown
states remain ineligible. The desired-state and failed-session guards still
apply independently.

The former blanket offline-exit rule in
[session-services design](session-services-release.md#failure-and-recovery-policy)
is superseded only for this narrowly proven cross-boot case. U26-06 was deferred
in 0.12.1 and is now explicitly included; other deferred U26 items remain out.

## Deployment and evidence

### Storage repair authorized — 2026-09-14

Operator approved BR-006 and requested a new release after the maintenance
block below. The previous `de10484bcbb8` candidate is superseded; repeat final
clean gates against the replacement before publication. No new release or
successful target activation is claimed by this scope addition. Keep remote storage
functional tests skipped. The old 2991 binary still has the startup dependency;
do not imply fixing production also upgrades the paired test installation.

Development verification: focused storage/security/registry tests passed five
race repetitions; `make check` passed. The disposable real-X11 fixture passed
seven checkpoints, including root outage/recovery/local-file launch and all
previous boot-recovery cases. Evidence: `/tmp/remotexapp-boot-e2e-UB2OFu/result.json`.
Initial test expectations were corrected for the existing HTTP 409 file-launch
contract, and control-character configuration rejection was added. No public
HTTP status changed. Clean final candidate gates remain required.

### Maintenance hold — 2026-09-14

The operator excluded all remote storage tests during maintenance. Test documents
use local HOME only. Final source `de10484bcbb8` passed hosted Verify/candidate,
independent clean-clone `release-ci` with byte-identical artifacts, and all eight
exact-archive local E2E suites. The final archive SHA-256 is
`e9837111d31e248105f1c3c8eb5fb1d43367f79fcf74f16405ccc0c110144035`.

An earlier unpublished candidate passed seven-App checks through two Manager
restarts and two actual test-host-a container reboots. It was superseded by the
cancelled-shutdown eligibility fix; those runs are not final-byte acceptance.
Paired root/HOME snapshots and recoverable retired state were retained during
the approved stopped-system cutover. No HOME/profile/document purge occurred.

Final bytes are staged on test-host-a production, but startup is blocked by the
existing configured `/srv/example-documents` root returning `transport endpoint is not
connected`. Root resolution happens during Manager startup, so skipping file
tests alone cannot bypass it. The failed-start retry was stopped; production
1991 is inactive. The host application web entry was restored; existing 2991 remains running
0.11.0 with unchanged configuration. No new tag/release exists. Final-byte
sandbox tests and publication remain pending, not passed. Resume requires
maintenance completion or operator approval for a temporary document-root
configuration change; do not reboot the paired environment while this startup
dependency is unresolved. Gateway and other environments are unchanged.

test-host-a also has an existing `xfce4-session-logout` wrapper that no-ops
`--logout`. Normal Driver shutdown correctly blocks. The wrapper was not
changed; ownership-verified normal XFCE D-Bus logout allowed graceful cutover.
The planned explicit runtime restart test must qualify that host policy and
exercise restart after normal session logout, not claim the wrapper works.

Private raw evidence and resumable deployment scripts are retained under
`/tmp/remotexapp-0122-release.Zw0goq`; target checkpoints are under
`<PRIVATE_ACCEPTANCE_DIRECTORY>`. Hosted final candidate run: `34852585781`;
Verify: `34852587023`. The earlier development/pending records below are history.

Before mutation, capture endpoint/runtime identities and paired root/home
snapshots, and use normal App shutdown. Do not erase old evidence or user data.
Use LXD direct administration; if private-IP routing is unavailable, a temporary
build-host loopback-to-container-loopback LXD transport may carry the test
Viewer. Never use the production gateway for regression or reboot polling.
Keep test-host-a 2991 version/configuration unchanged; its interruption during a
whole-container reboot is unavoidable and must be reported separately.

Development status: implementation, `make check`, five repeated focused race
runs and the disposable real-X11 boot simulation passed. Its five checks cover
same-boot service identity, two cross-boot recreations, pre-existing failure
retention and desired-stop retention. Initial fixture attempts correctly failed
for an invalid socket path, unsupported App idle policy and ephemeral managed
workspace; the fixtures were corrected without relaxing production validation.
The first check also required regenerating the source identity after VERSION
changed. Exact clean-candidate gates and real test-host-a reboot remain pending.
A new release authorization is not a claim of human UAT or native Ubuntu
26.04 acceptance.
