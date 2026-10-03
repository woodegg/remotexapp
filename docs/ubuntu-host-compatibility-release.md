# Ubuntu host compatibility repair — 0.12.1

## Closed — formal stable release published

2026-09-14: [`v0.12.1`](private-history.md)
is GitHub Latest, not an RC/prerelease; commit `0300acdfd003`, SDK `0.28.0`,
Mousepad `4.0.1`. Hosted and independent clean-clone release gates produced
identical archives. Seven exact-archive local E2E suites and eight additional
Mousepad upgrade/class/input checks passed; downloaded release assets match
the tested candidate. [Publication evidence](../tests/evidence/v1/ubuntu-host-compatibility-0.12.1-publication.json)
retains failed attempts and test instrumentation limits.

The accepted repair scope is released, with native clean Ubuntu 26.04,
Qt6/Mousepad 0.7 and whole-host reboot tests still unexecuted. Publication does
not certify those platforms or authorize deployment, runtime replacement or
downstream workaround retirement. Earlier development/promotion states below
are historical; platform qualifications and deferred scope remain in effect.

## Stable promotion — UAT accepted 2026-09-14

Operator instruction: "uat accept do a formal release (formal version not rc version)".
Core target is now **0.12.1**, not an RC; SDK `0.28.0` and Mousepad `4.0.1`
are unchanged. Accepted behavior is frozen. Publication requires a clean
committed/hosted candidate and exact-archive local E2E; only then publish those
unchanged bytes. [Acceptance provenance](../tests/evidence/v1/ubuntu-host-compatibility-0.12.1-uat.json)
records the operator's acceptance, not an invented second human test.

The operator accepted publication after the pending native Ubuntu 26.04 gates
were disclosed. Those tests remain unexecuted: this release does not certify a
clean 26.04/Qt6 host or full-host reboot. Their absence remains an explicit
platform qualification, not a green test or broader rollout approval. No
deployment, runtime replacement, or downstream workaround removal is included.

The development authorization and results below are historical and superseded
only for UAT/publication authority, not for the recorded failed/skipped tests.

Release-gate follow-up: the first clean local `release-ci` race run exposed a
failure-attribution test using a 900ms whole-fixture deadline. On the loaded
host it expired at the healthy D-Bus stage before reaching its injected IBus
failure. The test now allows five seconds for subprocess startup; production
timeouts are unchanged and the separate bounded-probe/cancellation tests remain.
Repetition also exposed a one-second wait between the durable service record
and the separately published public error; that assertion now has a bounded
five-second wait with diagnostic output on failure, without relaxing its stage
or sensitive-data assertions.
The first hosted candidate passed, but is superseded by a fresh candidate
including this test-only correction and repeated race validation.

## Original development lock

Status: **locked for development/testing, 2026-09-14**. Core candidate
`0.12.1-rc.1`, Mousepad App `4.0.1`, SDK `0.28.0` unchanged. Operator instruction:
"approve, lock train and development". Deployment, existing runtime restarts,
UAT acceptance, commits/publication and workaround retirement are separate.

## Evidence and scope

Incoming sandbox01 Ubuntu 26.04 report identifies formatted IBus queries taking
565.7–617.1ms against a 500ms probe deadline, versus 64.2–116.7ms for name-only.
Its Mousepad input failed first from missing toolkit modules and then from
`Org.xfce.mousepad` missing in the App allowlist. These are downstream samples,
not independent pristine-Core acceptance. GTK3/GTK4 were installed together;
their individual necessity was not established by that experiment.

Sources: [IBus command implementation](https://github.com/ibus/ibus/blob/1.5.29/tools/main.vala),
[Ubuntu Mousepad GTK3 dependency](https://packages.ubuntu.com/resolute/mousepad),
[Ubuntu IBus toolkit packages](https://packages.ubuntu.com/en/source/resolute/ibus).
Original packet remains local in `release-tray/sandbox01-ubuntu2604-012-feedback-20260914/`;
do not import its installer, UID, exposure policy or fleet naming into Core.
Its absent checksum manifest and split/missing original test reports are known
provenance limitations, not grounds to reconstruct passing evidence.

## Locked implementation

- U26-01: call `ibus list-engine --name-only` from the pinned supervisor.
  Retain 500ms per process probe and the existing shared startup deadline;
  nonzero exit, cancellation, service death and engine/protocol failure remain
  failures. No formatted-query fallback or new D-Bus library.
- U26-02/04: explicit Ubuntu package-list/check workflow; no automatic APT,
  repository downloads or root orchestration in Manager. Distinguish Core,
  selected-App/toolkit and test-only needs. Check the runtime user's actual
  Python imports and native libraries, IBus integration modules, user manager
  and required borrowed bus. A safe owned-child pidfd check must exercise
  signaling and cleanup, not just syscall presence. Generic artifact validation
  is not a substitute for target-user or interactive validation.
- U26-03: only Mousepad manifest changes: version 4.0.1 and both known complete
  WM_CLASS names under existing case normalization. Keep wrong-focus and stale
  generation rejection, isolated HOME, optional file and no-save stop policy.
- U26-05: supervisor records a safe bounded stage in the existing public error
  field before cleanup. No raw command output, paths, bus payloads or arbitrary
  exception strings; no public response-field or SDK change.
- U26-07/08: document Manager versus App readiness and optional managed desktop
  registration with caller-selected stable ID. Preserve existing create/conflict
  semantics; do not automatically create or rename registrations.

U26-06 boot-aware replay, full U26-05 structured API, U26-07 dashboards and
U26-09 rename are deferred. No App schema changes, global dependency resolver,
audio, bwrap, removal of failure retention, or changes to Manager readiness.

## Verification gates

Portable: deterministic slow-format/fast-name-only probe, bounded cancellation,
service-stage failure, no sensitive error leakage, Mousepad allowlist and version
ordering, dependency positive/negative tests, all existing Go/SDK/App tests,
race/coverage/release checks. Never lower a floor to accommodate new checks.

Live: use disposable real-user Ubuntu 24.04 and 26.04 targets, without the IBus
shim or private Mousepad fork. Missing GTK3/GTK4/import/native capability cases
must fail usefully; test Qt separately. Run all seven Apps in a complete recorded
suite, real Unicode/multiline document readback (not ACK alone), all clipboard
formats, controls, wrong-focus and generation rejection, exit/logout, restart,
upgrade, Manager crash, cold/warm/load launches. Distinguish container reboot
from Manager-only restart and retain existing explicit failure recovery.
Record exact artifact/OS/application versions and failed attempts. Prior 24.04
developer-host passes do not certify clean 26.04 deployment.

Existing sandbox01/00/10 sessions and production gateways are not test targets.
Destructive reproduction requires disposable resources and verified paired
root/home checkpoints where applicable. No existing default user bus or desktop
may be killed by tests. Pending live infrastructure gates must be reported, not
silently skipped or marked accepted.

## Future rollout after separate approval

1. Verify the exact fixed archive and both normal App version upgrade paths:
   4.0.0 and 4.0.0-sandbox.ubuntu2604.1 to 4.0.1.
2. Stage/select the new Core and App without overwriting old immutable releases.
3. Explicitly upgrade affected runtimes after preserving documents/profile and
   checking graceful shutdown; Manager selection alone preserves old pins.
4. Validate input on the new pins, then remove scoped compatibility files only
   after no remaining old runtime depends on them. Keep required OS modules.
5. Return evidence/migration instructions to the sandbox owner; no automatic
   fleet rollout or new host reboot policy. An older pre-0.12 deployment still
   requires the separate stopped-system architecture cutover.

## Development status

2026-09-14: the locked implementation is present; local automated validation
passed. This is **not** clean Ubuntu 26.04 acceptance, UAT or a publishable
clean candidate. [Machine-readable development evidence](../tests/evidence/v1/ubuntu-host-compatibility-0.12.1-rc.1-development.json)
binds the tested binaries, source base plus dirty-worktree qualification,
host versions, actual outcomes and retained failed attempts.

| Gate | Result |
|---|---|
| `make check` | Passed: Go suite/vet, 158 JavaScript tests, asset/module/document/security consistency |
| Dependency checker | 12 positive/negative tests; actual local GTK3/GTK4, Qt5, UNO/GI, native libraries, pidfd and runtime-user bus checks passed |
| Go race / coverage / vulnerability scan | Passed; Go 62.3%, SDK lines 86.07%, branches 78.62%, functions 82.16%; no floor reduced |
| Seven-App main lifecycle matrix | 237 checkpoints, 1,890 recorded HTTP assertions passed |
| Seven-App input-fault / clipboard / exit interaction matrix | 43 checkpoints, 70 recorded HTTP assertions passed, including XFCE logout/relogin |
| Mousepad upgrade/input gate | 8 checks passed: both version-selection paths, both class names, Unicode/multiline actual document readback and wrong-class rejection |
| Offline installation staging / development archive | Passed, including immutable installed host checker and archive sensitive-data scan |
| Fresh 24.04/26.04, native Qt6/Mousepad 0.7, whole-host reboot, clean exact-archive full Viewer/input/clipboard/cold-load suite | Pending; not inferred from this provisioned 24.04 host or test fixtures |

The new diagnostics initially caused `getConnections()` to return 409 for all
seven Apps: public progress revisions advanced without their private partners.
Fixed by advancing both **before Driver launch**, with no late Core progress
write after Driver ownership. Added a paired-revision regression and reran all
seven Apps successfully. At a shared deadline the Manager uses the last safe
published stage if the final error has not arrived; the journal remains the
source for detailed diagnosis. Existing Driver errors are preserved.

Mousepad harness failures also remain recorded: selectors require explicit
Manager catalog refresh, and raw text acknowledgements omit an empty error
field (the SDK normalizes it). Neither was fixed by changing product semantics.
See [repeatable tests and instrumentation limits](../tests/host-dependencies/README.md).

Installed preflight runs from the selected release's readable helper path, so
an administrator extracting the archive under a private HOME does not require
exposing that HOME to the runtime account. Qt6 package ownership was checked
against Ubuntu's file list: `libqt6gui6`, not `qt6-qpa-plugins`, supplies IBus.

Next gate requires a separately approved disposable Ubuntu 26.04 VM/container
with systemd, required Apps and fault/reboot authority. This host has no local
LXD daemon; no existing sandbox was substituted. Existing local 1991/2992 and
sandbox deployments, runtime pins and downstream workarounds remain untouched.
