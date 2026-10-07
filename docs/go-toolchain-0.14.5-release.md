# Core 0.14.5: Go 1.27.1 release train

Locked 2026-10-07 for development, testing and project-owned local UAT.
Status: implemented; hosted candidate and exact-artifact automated qualification
passed. The candidate is installed in the project-owned local UAT environment.
Human UAT and formal publication are pending. The released baseline is Core `0.14.4`, SDK
`0.29.1`, built with Go `1.26.8`.

## Problem and ownership

Move Core builds to the selected exact Go `1.27.1` toolchain and deliver newly
qualified binaries in an immutable Core patch release. The Core repository
owns source changes, qualification and GitHub publication. Each deployment
owner separately controls installation and runtime upgrades.

Target Core `0.14.5`. Preserve SDK `0.29.1`, App Package versions, the
`remotexapp/v1` ABI and existing API/lifecycle contracts. Review the official
[Go release notes](https://go.dev/doc/devel/release) and security fixes during
implementation; record any compatibility changes before accepting the train.

## Toolchain compatibility review

Reviewed the official [Go 1.27 notes](https://go.dev/doc/go1.27) and
[Go 1.27.1 history](https://go.dev/doc/devel/release#go1.27.1). Go 1.27
maintains the Go 1 compatibility promise; its new language features are not
required by this train. Review points include default `stdversion` vet checks,
removed legacy asynchronous timer-channel support, runtime/compiler changes,
and HTTP/JSON library fixes. Source inspection found no legacy timer-channel
or goroutine-leak experiment overrides. Qualification exercises input,
transport and lifecycle behavior rather than assuming compiler compatibility.
No new performance or security guarantee is claimed without measured evidence.

## Implementation scope

- Synchronize the exact toolchain in `go.mod`, the Makefile, all four GitHub
  workflows, workflow checks and candidate/archive evidence validators.
- Retain the `go 1.26.0` language/minimum directive unless a reviewed dependency
  or compatibility requirement requires raising it. Verify this assumption
  with the selected toolchain.
- Update current toolchain guidance, REL-009 in [requirements](requirements.md),
  the `Unreleased` [changelog](../CHANGELOG.md) and generated
  [current state](current-state.md) as implementation lands. Append a dated
  [design decision](design-log.md) superseding the prior exact build pin;
  preserve historical qualification records and their original versions.
- Set `VERSION` and release metadata to `0.14.5` when preparing the candidate.
  Keep dependency changes limited to those justified by the upgrade.

## Acceptance matrix

| Gate | Required result |
|---|---|
| Source and metadata | Consistent exact Go `1.27.1` pins; clean module metadata; public-documentation, workflow, release and evidence checks pass. |
| Portable qualification | `make check`, `make coverage-check`, `make test-race` and the hosted `make release-ci` pass. Source and all four packaged binaries pass the vulnerability gates. |
| Artifact identity | All four packaged binaries report Go `1.27.1`, the reviewed full source commit and clean VCS state. Archive checksum and candidate evidence agree. |
| Target-like integration | Run `scripts/test-release-candidate.sh` against that exact hosted archive, checksum and evidence. Exercise the existing synthetic, shipped-App, document, actions, user-home, service and recovery suites. |
| Human acceptance | Record scoped human UAT of the exact candidate, including Viewer input/IME, clipboard and Manager adoption/runtime replacement. Record unexecuted scenarios explicitly. |
| Publication | Publish the unchanged accepted candidate under annotated `v0.14.5`; verify fresh downloads and record publication evidence. |

Local integration requires systemd/user services, X11, TigerVNC, IBus and the
tested Apps/browser dependencies. Hosted qualification and publication require
GitHub access. Missing dependencies or failed gates leave qualification pending.
Follow the [release process](release-process.md) and
[release policy](release-policy.md).

## Rollback and downstream handoff

Preserve the existing `v0.14.4` tag and release bytes. Before implementation is
accepted, retain the prior toolchain pin if compatibility or security gates
fail. After publication, deployment owners may select the verified prior
release with their pre-upgrade state snapshot; confirm state compatibility
before downgrading.

An installed runtime retains its component pins after a compatible Manager
upgrade. Applying newly built runtime components requires the owner's explicit
[runtime upgrade and restart](runtime-upgrade-api.md). Runtime hosts consume
compiled binaries and do not need the Go toolchain installed.

## Deferred scope

SDK features, App upgrades, new lifecycle behavior, performance claims and
deployment/restarts are outside this train. Expand scope only through a
reviewed requirement and revised acceptance matrix.

## 2026-10-07 qualification and local UAT preparation

Candidate source: `b5599d71cbcb33cfd9d62f5b92414921ed4a51d4`. Hosted
[candidate run](https://github.com/woodegg/remotexapp/actions/runs/37664663178)
passed `make release-ci`. Artifact: `remotexapp-0.14.5-linux-amd64.tar.gz`;
SHA-256: `a7cb2f6e3730a2be4eefc11a12a3a72448728a3d11a9c404949c6a79a20f7d63`.
All four binaries embed the exact commit, clean VCS state and Go `1.27.1`.

Local `make check`, coverage, race and source vulnerability gates passed.
Go statement coverage is 63.2%; SDK line/branch/function coverage is
87.99% / 79.84% / 83.78%. All eight exact-candidate integration suites passed;
all eight App archives match verified Core `0.14.4` bytes. The archive
contains 48 readable documents, all passing the disclosure/link gate.

The exact candidate is active on the loopback local test endpoint
`127.0.0.1:2992`, with its existing service configuration retained. Binary
hashes, readiness, listener and a served Firefox Viewer connection/resize/
reconnect were verified. A fresh isolated Firefox instance is available for
human UAT; the operator receives its runtime-specific Viewer URL privately.
The previous test release and a private state snapshot are retained for
rollback. Console remains disabled and kiosk enabled, matching the existing
test configuration.

The separate [Verify workflow](https://github.com/woodegg/remotexapp/actions/runs/37664664140)
timed out during Ubuntu dependency installation before tests; its retry was
still installing dependencies when this record was written. The full hosted
release candidate gate passed. This infrastructure result remains explicit.
Human acceptance, actual host reboot and formal publication are pending.
See [qualification evidence](../tests/evidence/v1/go-toolchain-0.14.5-local-uat-preparation.json).
