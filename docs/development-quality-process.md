# Development and Test Quality Process

This process keeps the ordinary feedback loop short while reserving expensive
checks for the risk level they address. The measured 2026-09-04 baseline is
stored in `tests/evidence/v1/development-process-baseline.json`.

## Evidence Behind the Change

At baseline, `make check` took 5.28 seconds and the portable release gate took
19.56 seconds. Twenty repeat runs of the Go and JavaScript suites all passed.
Unit coverage was 56.8% for Go and 83.60% lines / 69.87% branches / 77.04%
functions for the SDK when the Xvfb/xclip integration dependencies were
available. Hosted jobs install those dependencies explicitly so the same tests
cannot silently skip and lower Go coverage. The synthetic App ABI E2E took 3.94 seconds; the real
four-App E2E took 73.18 seconds on Go 1.26.8. These measurements support fast
checks per change, repeat/fuzz work on a schedule, and real-App E2E once per
candidate rather than on every edit.

The published 0.5.1 binaries used Go 1.22.12. A source call-graph scan found 35
reachable standard-library vulnerability findings, while rebuilt Go 1.26.8
binaries had none and passed the full shipped-App E2E. Therefore the exact Go
toolchain and both source and binary vulnerability checks are release gates.
Go supports only its two newest major releases; review
<https://go.dev/doc/devel/release> when updating the pin.

## Test Tiers

1. During editing, run the narrowest affected Go package, Node test file, or
   App driver test.
2. Before review, run `make check`. It covers generated assets, all unit and
   contract tests, `go vet`, every tracked shell script's syntax, evidence, and
   current-state freshness.
3. Pull-request CI also runs `make coverage-check` and `make vuln-check`.
   Its Xvfb, xclip, D-Bus, and Clipman packages are part of the coverage
   environment, not optional conveniences.
   Coverage floors begin at the measured baseline and may increase with proven
   tests; lowering one requires a dated design decision and evidence.
4. Nightly CI runs `make nightly-portable`: race detection, shuffled repeat
   runs, and bounded fuzzing in addition to the fast gates.
5. A release candidate runs `make release-ci`. On a target-like disposable
   Ubuntu/X11 host, also run `make live-e2e`; include user-home mode only in a
   dedicated disposable account. Record Human UAT after automated gates pass.

## Build Once and Promote

Dispatch the `Release candidate` workflow for the reviewed commit. It produces
one archive, `SHA256SUMS`, and v1 candidate evidence. Download that exact
artifact for target-like E2E, deployment rehearsal, and UAT. Do not rebuild.
On the dedicated Ubuntu/X11 test host, run
`scripts/test-release-candidate.sh ARCHIVE SHA256SUMS EVIDENCE FULL_COMMIT`;
the harness extracts and exercises the binaries, drivers, and Apps from the
archive rather than the source-tree `bin/` or App catalog.

Core 0.12 adds `tests/session-services/run-local-e2e.mjs` to the exact-candidate
harness: private-service faults, App exit, blocked/enforced stop, startup crash
and Manager adoption. The user-home gate also exercises real XFCE logout and
relogin, Xfconf persistence and Thunar activation in a disposable UID. Run live
Manager suites serially: their default dynamic-display ranges overlap, even
when their HTTP ports differ. Do not benchmark while other test suites run.
The one-time architecture cutover separately requires
`tests/session-services/run-cutover-e2e.mjs OLD_RELEASE_ROOT CANDIDATE_ROOT`;
the old archive is a test baseline, never a production fallback launch path.

After acceptance, create one annotated `v<VERSION>` tag on the same commit.
The `Release` workflow requires the same-commit successful candidate, verifies
archive checksum, evidence, Go version, embedded VCS identity, and clean build,
then publishes those unchanged bytes. Candidate artifacts expire after 30
days; rerun the candidate workflow and acceptance if needed. Never move or
reuse a tag.

The hosted Release job installs `ripgrep` explicitly because the final
sensitive-data check requires it. Workflow consistency tests preserve this
dependency so a runner image change cannot turn a verified candidate into an
unpublishable tag.

## Evidence and Review

New evidence uses `remotexapp/evidence/v1` and includes a full commit, UTC
timestamps, toolchain, environment, scenario results, and artifact hash when
applicable. Run `make evidence-check`. `docs/current-state.md` is generated
from canonical source metadata and deliberately says nothing about a live
fleet.

Pull requests must identify the requirement, risk, affected tier, commands and
results, compatibility/deployment impact, and any skipped live dependency.
Keep feature changes separate from acceptance and rollout records where
practical.

## Repository administration

Workflow checks verify a candidate when they run. Configure branch protection
or repository rulesets separately to require the relevant checks and review
before merging. Audit those settings after changing repository visibility,
ownership or plan; a successful workflow does not establish that direct pushes
are restricted.
