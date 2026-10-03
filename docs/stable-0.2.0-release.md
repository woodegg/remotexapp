# RemoteXApp 0.2.0 stable release train

Status: complete. Formal `v0.2.0` was published, locally aligned, and then
aligned on sandbox00 production under separate approval on 2026-09-01. The release is
core `0.2.0`, browser SDK `0.18.0`, and App Package ABI `remotexapp/v1`. The
frozen App identities are
`edge@1.0.0`, `firefox-esr@2.0.0`, `libreoffice@3.0.0`, `mousepad@2.0.0`,
`xfce-desktop@2.0.0`, and `xfce-user-desktop@2.0.0`. This lock authorizes
release preparation and verification; it does not authorize a sandbox
deployment, Git tag, or GitHub Release.

## Stable promise

This train converts the accepted 0.2 release-candidate work into the first
stable 0.2 release. It adds no feature, API, SDK, App Package, template, or
driver behavior. Only defects found while satisfying the locked gates may be
fixed. A material scope change requires explicit operator approval, a new
requirement or superseding decision, and a dated design-log entry.

The stable public surface is the documented manager API, the same-origin
`/sdk/index.js` SDK, App Package ABI V1, shipped templates, and supported
deployment procedures. Internal state layout, generated assets, host paths,
private sockets, systemd unit names, and App-specific loopback control
protocols remain internal. EXP-001 through EXP-007 remain experimental and do
not gain a stable compatibility promise from this release.

## Locked acceptance gates

Complete these gates in order. Runtime-affecting source freezes before the
immutable candidate is built; later acceptance records may change documents
only and require the complete publication gate to be repeated:

1. Update README, handover, release policy, commercial-readiness, integration,
   and operations text from release-candidate positioning to the exact stable
   support and trust boundaries. Audit every open issue and deferred or
   experimental requirement. Seal the changelog only at publication.
2. Prove that SDK `0.18.0` and App Package ABI V1 remain compatible with the
   accepted WAOS integration contract. RemoteXApp stable publication does not
   require rebuilding or releasing WAOS; WAOS updates its exact dependency
   lock when that project independently adopts `0.2.0`.
3. From a clean tree, pass sensitive-data checks, `make release-check`, and
   `make release-ci`. Verify reproducible generated assets, race tests,
   provenance, archive contents, checksums, and an unchanged working tree.
4. Install that immutable candidate locally on port 1991. Exercise upgrade from
   rc.10, retained-release rollback, manager/runtime restart and recovery,
   all shipped Apps, input, resize, reconnect, status, logout/exit, graceful
   and forced shutdown, console modes, and reverse-prefix behavior. Reproduce
   the abnormal restart conditions from GitHub Issues #4 and #5.
5. With separate explicit approval, repeat the production-like upgrade,
   rollback, recovery, security, application, and human UAT gate on sandbox00.
   Neither this train lock nor a local pass authorizes sandbox00 staging or
   production changes. Human UAT must explicitly accept Firefox ESR/BiDi and
   LibreOffice/UNO/document lifecycle; automated evidence is not acceptance.
   Unified Console UAT was accepted on 2026-09-01. Followers are outside this
   train.
6. Attach exact candidate evidence to Issues #4 and #5 and close them. Record
   UAT and accept the completed requirements. No release-blocking issue may
   remain. Any post-candidate commit is evidence-only; a runtime, web asset,
   App, or dependency change invalidates the candidate and restarts the gate.
7. Repeat sensitive-data inspection and `make release-ci` on the final clean
   evidence commit. Verify the candidate-to-final diff is documentation-only
   and record the final archive identity. Push it and wait for CI.
8. Create the immutable annotated
   `v0.2.0` tag, and verify the GitHub release is a normal latest release, not
   a prerelease. Download and verify its archive and `SHA256SUMS` before use.
9. Install the downloaded formal artifact as a new immutable release and
   repeat health, version, commit, checksum, runtime-adoption, and smoke checks
   locally and, with another explicit approval, on sandbox00. Never replace a
   candidate directory or move/reuse the tag.

## Explicitly outside the train

New features; APP-008 lifecycle redesign; automatic driver release garbage
collection; catalog hot reload; a Go IBus rewrite; root orchestration;
same-UID hostile multi-tenancy; arbitrary status commands; a public npm or Go
library; follower-sandbox rollout; and production-gateway stress testing are
excluded. Organization-specific TLS/identity, tenant placement, backup,
monitoring, capacity, legal, privacy, support, and incident-response controls
remain deployment prerequisites rather than repository release features.

## Gate 1 audit — 2026-09-01

Current positioning in README, security policy, release policy, commercial
readiness, handover, integration, browser SDK, and operations now describes the
0.2 stable target and explicitly distinguishes it from a published release.
Historical rc versions remain where they identify real artifacts, deployments,
evidence, or rollback targets.

GitHub has exactly two open repository issues: #4, anonymous fixed-display
autostart restart loops, and #5, duplicate managed manifests after replacement.
Their fixes are represented by RTM-006 through RTM-009 and RTM-010,
respectively, but both remain stable blockers until the exact candidate repeats
their abnormal recovery scenarios, records evidence, and closes the issues.

DRV-013 through DRV-015, APP-008, and IME-002 remain explicitly deferred.
EXP-001 through EXP-006 and IME-004 remain proposed and are not release
requirements. Implemented EXP-007 remains an experimental, secret-bearing
surface without a stable compatibility promise. No other open Issue or
unclassified incomplete requirement was found. LibreOffice LBO-001 through
LBO-009 and Firefox FFX-001 through FFX-006 were later accepted by the explicit
stable Human UAT recorded below.

## Gate 2 provider compatibility — 2026-09-01

The accepted App Package ABI V1 baseline is tag `v0.2.0-rc.4` at commit
`e19125384bda`. The stable source has no change under the six App directories or
in the App Package V1 parser and its tests. SDK 0.18 retains SDK 0.17's exports
and leaves the existing viewer/input client byte-identical; it adds only
manager version/health, runtime restart, restricted service restart, and
optional request-header support.

The isolated build-once E2E on manager port 21991 passed install, launch,
bounded status/control, manager adoption, package update without a core
rebuild, old-runtime pinning, new-version selection, stop, disable, and
rollback. This proves the provider contract without building or changing WAOS.
The accepted WAOS release keeps its rc.4 lock until that repository
independently adopts `0.2.0`. Exact hashes and checks are in
[`stable-0.2.0-provider-compatibility.json`](../tests/app-package/stable-0.2.0-provider-compatibility.json).

## Gate 3 candidate release automation — 2026-09-01 (invalidated)

Clean commit `7430689f05cb` passed `make release-check` and `make release-ci` on
Ubuntu 24.04 linux/amd64, including metadata, confidentiality, provenance,
generated assets, Go/SDK/App tests, vet, race, deployment architecture,
immutable staging, host preflight, and packaging. A second package run produced
the same archive SHA-256
`8c6574c0abab565f3b08bbcd305522ed15d0fa64924c4cec689e3d65a589238c`;
the outer checksum and all six embedded App Package checksums passed.

This is the immutable local-test candidate, not the final publication gate.
Evidence-only commits after it may not change runtime source, generated assets,
Apps, dependencies, or build inputs. STB-006 remains incomplete until
`make release-ci` is repeated on the final clean evidence commit. Exact results
are in
[`stable-0.2.0-candidate-release-gate.json`](../tests/go-live-validation/results/stable-0.2.0-candidate-release-gate.json).

The first sandbox00 staging attempt later found that the selector could not
explicitly choose retained rc.5 because it retroactively required the new
optional operator helper. DEP-015 changes the release archive, so this candidate
and digest are retained only as historical evidence. Gate 3 must be repeated.

## Gate 4 local candidate acceptance — 2026-09-01 (invalidated)

The immutable candidate passed rc.10→0.2.0 upgrade, verified rc.10 rollback,
and final 0.2.0 activation on local port 1991. Both existing runtime IDs,
session generations, states, and all seven child unit PIDs survived each
manager replacement. Real browsers then passed fixed framebuffer scaling,
explicit and automatic reconnect, finite and unlimited reconnect budgets, and
generation-2 user-home relaunch after a real XFCE Logout.

An isolated shipped-App pass covered Mousepad, Edge/CDP, Firefox/BiDi, and
LibreOffice/UNO input, resize, status, control probes, shutdown, adoption,
profile persistence, and cleanup. The two existing XFCE Apps completed the
fixed/user-home paths on 1991. Candidate release tests cover all unified-console
modes and reverse-prefix routing over web assets byte-identical to the accepted
rc.10 bundle.

The exact Issue #4 fault was repeated on isolated display `:13`: removing the
manifest while its fixed-display units survived caused one bounded cleanup,
profile preservation, and healthy autostart replacement without a manager
loop. For Issue #5, a stopped managed gateway after XFCE Logout recovered under
the same runtime ID and creation time, with one manifest, unchanged manager
PID, and `NRestarts=0`. The issues remain open until sandbox acceptance and
their final evidence comments.

Final local state is healthy `0.2.0 (7430689f05cb)` on the requested temporary
`0.0.0.0:1991`, `auth-mode=none` configuration: six templates, two runtimes,
zero clients, no warning entries, and no test units, listeners, or browsers.
Firefox and LibreOffice Human UAT were still pending at this invalidated gate
and were accepted later under Gate 5. Exact evidence is
[`stable-0.2.0-local-1991.json`](../tests/go-live-validation/results/stable-0.2.0-local-1991.json).

DEP-015 invalidated the tested archive after this pass. Gate 4 must be repeated
with the replacement artifact before sandbox staging resumes.

## Gate 5 sandbox00 staging attempt — 2026-09-01

The operator separately approved staging only. The exact old candidate was
uploaded and checksum-verified, staged without moving either selector, and
temporarily selected with zero attached clients. Version, health, runtime
adoption, and child PID preservation passed. Explicit rollback then stopped at
preflight because retained rc.5 has no `remotexapp-operator-helper`; an explicit
stopped-service atomic selector transition immediately restored rc.5. The
restored version/commit, runtime identity, creation time, generation, and all
four child PIDs matched the baseline, with `NRestarts=0`.

This attempt is defect-discovery evidence, not STB-008 acceptance. Production
was never approved, candidate selectors were not retained, and sandbox testing
is paused until the replacement artifact repeats Gates 3 and 4 and receives a
new staging approval.

## Replacement Gates 3 and 4 — 2026-09-01

Commit `ca1d0b26bf8f` is the replacement immutable candidate. It adds only the
DEP-015 rollback correction and its tests/documentation; Apps, web assets,
noVNC, dependencies, and the SDK are unchanged from the invalidated candidate.
`make release-check` and `make release-ci` passed from a clean tree. Repackaging
reproduced archive SHA-256
`a6f3baae356bd45c5d45fcee3cf937d0295ec4ec3384bc6c1cd757536c901cfd`.

Local port 1991 then passed the actual
rc.10→candidate→rc.5→candidate sequence under the replacement shared unit.
Both runtime identities and eight recorded unit slots remained stable; all
seven active child PIDs were byte-for-byte identical, the stopped-session slot
remained zero, and manager `NRestarts` remained zero. The strict new manifest
was present, while rc.5 correctly used the legacy three-binary contract.

An isolated authenticated manager proved that the environment enables the
optional service-restart capability and rejects malformed booleans. The four
application E2E covered Edge/CDP, Firefox/BiDi, LibreOffice/UNO, Mousepad,
input, resize, lifecycle, adoption, persistence, and cleanup. A real browser on
the managed user-home Desktop passed fixed 1280x720 scaling, explicit reconnect,
finite and unlimited retry policies, and automatic reconnect across manager
restart. Issue #4 and #5 abnormal recovery were repeated, and final hygiene
found no temporary listeners, units, or browsers. STB-007 is implemented again;
exact evidence is
[`stable-0.2.0-replacement-local-1991.json`](../tests/go-live-validation/results/stable-0.2.0-replacement-local-1991.json).

## Replacement Gate 5 automated sandbox00 staging — 2026-09-01

The operator separately approved replacement staging, but not production. The
checksum-verified archive was published into a new immutable `0.2.0` tree
without moving the rc.5 selectors. The replacement shared unit was installed
temporarily, then the exact rc.5→candidate→rc.5 sequence passed. Initial
candidate adoption and an explicit manager restart preserved the managed
runtime identity, creation time, generation, and all four child PIDs with
`NRestarts=0`.

Health, readiness, six-template catalog, root/minimal/kiosk routes, disabled
service-restart capability, and public EXP-007 policy passed. The environment
response contained 47 variables; no values were retained. Sandbox-native App
tests passed Mousepad readiness, Edge CDP `Browser.getVersion`, Firefox BiDi
`session.status`, LibreOffice UNO document selection, destructive no-save
shutdown, lock removal, and complete process/unit/port cleanup. The host has no
Chrome or Chromium, so the exact artifact's complete local Chrome/SDK pass was
not redundantly repeated in this staging environment.

The Issue #5 fault used a real XFCE D-Bus Logout followed by stopping the exact
managed gateway unit. Recovery kept one manifest and the same runtime ID,
creation time, manager PID, and zero manager restarts; RFB reattachment advanced
generation 1→2 and returned the Desktop to ready. Rollback used the replacement
selector to start retained rc.5, preserved every post-recovery child PID, and
restored the original unit checksum. Final state is healthy rc.5 with one active
managed Desktop, zero clients, and no temporary listeners, App units, or App
processes. The replacement candidate remains staged but inactive. Exact evidence
is
[`stable-0.2.0-replacement-sandbox00-staging.json`](../tests/go-live-validation/results/stable-0.2.0-replacement-sandbox00-staging.json).

This completed only STB-008's automated staging portion and did not itself
authorize production. At that point STB-008 remained proposed pending separate
production approval and Human UAT. No follower or production-gateway testing
occurred.

## Replacement Gate 5 production activation — 2026-09-01

The operator then separately approved sandbox00 production activation. Before
selection, the staged release manifest and all four binary digests matched the
accepted archive, the runtime-affecting source remained identical to commit
`ca1d0b26bf8f`, and the manager had zero clients. The artifact's shared unit
and selector activated immutable release `0.2.0`; retained rc.5 automatic
restore was armed but not needed.

Production adoption preserved Desktop runtime
`xfce-user-desktop-b21da838f33e`, its creation time, generation 2, and all four
child PIDs. Final manager PID is `873991` with `NRestarts=0`. Health/readiness,
six templates, root/minimal/kiosk routes, disabled service restart, EXP-007,
and all six App selectors passed smoke checks. Configuration remains the
operator-requested `0.0.0.0:1991`, `auth-mode=none`, explicit insecure-public
opt-in; this trusts the surrounding sandbox network and is not a generally
secure Internet-facing mode. No temporary App process, unit, listener, or
deployment directory remains. Exact evidence is
[`stable-0.2.0-replacement-sandbox00-production.json`](../tests/go-live-validation/results/stable-0.2.0-replacement-sandbox00-production.json).

Production activation alone was not Human UAT acceptance. At this point STB-008
remained proposed until the operator explicitly accepted Firefox ESR/BiDi and
LibreOffice/UNO/document lifecycle on the active candidate. Followers, GitHub
publication, and the formal-artifact alignment gate remained untouched.

## Gate 5 Human UAT — 2026-09-01

The operator explicitly accepted Firefox ESR launch, visible-window behavior,
WebDriver BiDi control, input, reconnect, destructive stop, and relaunch, plus
LibreOffice document launch, visible-window behavior, UNO control, input,
explicit-save boundary, destructive no-save stop, lock cleanup, and relaunch
on the active sandbox00 candidate. Unified Console UAT remains accepted from
its earlier gate.

STB-003 and STB-008 are accepted. LBO-001 through LBO-009 and FFX-001 through
FFX-006 move from implemented to accepted without a source or artifact change.
The same confirmation authorizes formal release work; it does not authorize
follower deployment or the separately gated post-release sandbox00 artifact
alignment. Exact evidence is
[`stable-0.2.0-sandbox00-human-uat.json`](../tests/go-live-validation/results/stable-0.2.0-sandbox00-human-uat.json).

## Gate 6 issue closure — 2026-09-01

The exact candidate evidence was attached separately to
[Issue #4](private-history.md)
and
[Issue #5](private-history.md).
Issue #4 records the live missing-manifest fixed-display recovery; Issue #5
records local and sandbox00 one-manifest managed recovery. Both were closed as
completed after UAT, and GitHub reported zero remaining open issues. STB-004 is
accepted.

## Gate 7 final publication automation — 2026-09-01

The final candidate-to-tag audit contains only the GitHub Verify dependency
correction, changelog, documentation, and acceptance evidence; runtime source,
generated web assets, Apps, release-workflow dependencies, and artifact build
inputs remain identical to replacement candidate `ca1d0b26bf8f`. The Verify
workflow now installs the `ripgrep` dependency required by the sensitive-data
gate. The clean commit containing this record passed both
`make release-check` and `make release-ci` immediately before tagging,
including sensitive-data inspection, generated-asset and noVNC provenance,
Go/SDK/App tests, race, vet, host preflight, immutable staging, archive-content,
and checksum gates. STB-006 is accepted. The annotated tag and published
`SHA256SUMS` are the authoritative final commit and archive identities.

## Gate 8 formal publication — 2026-09-01

Annotated tag `v0.2.0` points exactly to
`9ef470c0139902c8b88f7354f6f0d68b7f8ee5a0`. GitHub Verify and Release passed,
and the resulting Release is normal, non-draft, non-prerelease, and Latest.
The downloaded linux/amd64 archive and attached `SHA256SUMS` verified at
SHA-256
`7d8665d5e477542ecea79cc4c20dac23797fa8f3c82b78022408a4d55a3e0123`.
Its manager embeds the exact tag commit, and the archive passed the sensitive
data and structure checks.

GitHub built the formal asset with Go 1.22.12. The tag annotation's
`bb392e0a089da0216afb6b6211dddf33870eed45fc0eaf315305931e344208d2`
instead identifies the separately verified local Go 1.22.2 gate artifact from
the same source commit. The published `SHA256SUMS`, also stated in the Release
notes, is authoritative for formal deployment.

## Gate 9 formal alignment — 2026-09-01

The downloaded formal artifact was staged into a new canonical immutable
`0.2.0` tree after retaining the accepted candidate as
`0.2.0-candidate-ca1d0b26bf8f`. Both selectors remain
`releases/0.2.0`. Two zero-client runtimes were adopted with identical IDs,
creation times, generations, states, and all seven active child PIDs. The six
App selectors did not change, manager `NRestarts` remained zero, root/console/
minimal/kiosk routes returned 200, and the journal contains no warning.

A temporary Mousepad runtime reached server-ready using only formal `0.2.0`
component paths, then force cleanup removed its units, directory, and durable
manifest. A final manager restart removed its expected in-memory stopped
record and re-adopted the original two runtimes without PID churn. Exact
evidence is
[`stable-0.2.0-formal-publication-local.json`](../tests/go-live-validation/results/stable-0.2.0-formal-publication-local.json).
The operator then separately approved sandbox00 production alignment. With no
attached client, the same-version immutable-tree procedure stopped and
recreated only `sandbox-desktop`, retained the candidate as
`0.2.0-candidate-ca1d0b26bf8f`, and selected the downloaded formal bytes. The
new runtime `xfce-user-desktop-c9c926c84d0f` is server-ready with one manifest;
its on-attach session correctly remains stopped until a viewer establishes an
RFB connection. A second manager restart recovered the same runtime and
creation identity. The running manager and gateway hashes, all four installed
binary hashes, six App selectors, fixed Desktop policy, routes, configuration,
child units, and zero-warning journal passed. Exact evidence is
[`stable-0.2.0-formal-sandbox00-production.json`](../tests/go-live-validation/results/stable-0.2.0-formal-sandbox00-production.json).

Validation used container loopback. The build host's direct private HTTP path
remains blocked by sandbox00's existing UFW allowlist; no firewall rule was
changed and the production gateway was not used. STB-009 is accepted.

## Completion

The train completed on 2026-09-01: STB-001 through STB-009 are accepted, the
formal artifact is independently verified and aligned locally and on the
approved sandbox00 production target, and the handover records the exact
commit, tag, archive digest, deployment selectors, rollback target, and human
approvals.

## Post-train follower alignment — 2026-09-01

This was not a stable-train gate. Under a later separate production approval,
sandbox02, sandbox03, sandbox07, and sandbox10 moved from formal rc.5 to the
checksum-verified `v0.2.0` artifact. Every zero-client managed Desktop retained
its runtime ID, creation identity, generation, state, and child PIDs across two
manager restarts. All four ended with formal running manager bytes, stable
selectors, one runtime and manifest, six unchanged App selectors,
`NRestarts=0`, and no warning. Rc.5 remains available for rollback, while
adopted runtime components remain pinned to rc.5 until normal recreation.
Exact evidence is
[`stable-0.2.0-formal-followers-production.json`](../tests/go-live-validation/results/stable-0.2.0-formal-followers-production.json).
