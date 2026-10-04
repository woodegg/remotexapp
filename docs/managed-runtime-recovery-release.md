# Managed runtime recovery release train

> Historical technical record. Dated status and validation statements describe
> their original scope; they do not identify a current deployment. See
> [current source versions](current-state.md). Host labels and runtime IDs in
> historical examples are anonymized.

Status: Issue #5 and RTM-010 were accepted and scope-locked on 2026-08-31 for
core release `0.2.0-rc.5`. Implementation, full local release validation, and
test-host-a automated production acceptance passed at commit `8c03c485adc5`.
The operator then separately approved deployment and all-runtime restart on
test-host-c, test-host-d, test-host-h, and test-host-k; automated follower acceptance
passed. The operator subsequently ordered formal publication and five-sandbox
alignment. GitHub prerelease `v0.2.0-rc.5` and the checksum-verified formal
fleet deployment are complete; Human UAT remains pending.

## Outcome

An unhealthy managed runtime is rebuilt under its existing runtime ID and
locked snapshot. There is always one active manifest for the managed ID, so a
manager crash or host restart can resume cleanup and recovery without creating
a second identity or entering the duplicate-manifest restart loop reported in
Issue #5.

This is a manager lifecycle correction only. It does not change the HTTP API,
SDK, App Package ABI, templates, drivers, profiles, host application, or network policy.

## Recovery contract

Within one manager lifetime, reconciliation must:

1. preserve graceful shutdown and host enforcement policy;
2. retain the old runtime ID, creation time, profile, parameters, overrides,
   resolved template, App Package, and component snapshot;
3. stop every exact recorded unit and remove the per-runtime working directory
   before recreation;
4. stop without creating a replacement when cleanup fails; and
5. retain a failed creation under the same manifest so a later reconciliation
   or restart can retry deterministically.

Startup also repairs duplicate records written by pre-rc.5 managers. It first
preserves a unique live application. Otherwise it selects the durable managed
pointer, a uniquely healthy runtime, or the newest recoverable record by
`createdAt` and runtime ID. It cleans exact stale units and runtime directories
before deleting their manifests. Multiple live applications, or multiple
healthy runtimes without a durable pointer, remain a fail-closed ambiguity.
Persistent profiles are never deleted by this repair.

## Locked acceptance matrix

- normal unhealthy replacement retains one ID and one manifest;
- failed creation retries successfully with the same identity;
- unit or directory cleanup failure never starts a replacement;
- restart recovers after teardown, creating-manifest publication, failed
  creation, and managed-pointer publication crash windows;
- legacy duplicate startup covers managed-pointer, live-application,
  health-based, and deterministic all-unhealthy selection;
- ambiguous live state and stale cleanup failure fail closed without deleting
  either record;
- Go unit, race, vet, repository, release, package, and sensitive-data gates
  pass; and
- test-host-a upgrades from rc.4 with its real managed desktop, starts without a
  restart loop, retains exactly one active manifest, and passes an injected
  unhealthy-runtime recovery plus a second manager restart; and
- each authorized follower runs the exact artifact, converges to one manifest
  per runtime, recreates every runtime under its original launch intent, and
  remains healthy after a final manager restart. test-host-h and test-host-k must
  recover their real pre-rc.5 duplicate-manifest restart loops automatically.

The validated pre-publication candidate has SHA-256
`a011a513c36ce6f3b0bf7cf491bcdeee91f0da1fdd33d1058685306cd63af7ad`.
Local and test-host-a each recovered a real stopped-session gateway fault with
the same ID, creation time, and one manifest; a following manager restart
adopted the recovered runtime without unit churn. Candidate evidence is
[`managed-runtime-recovery-rc5.json`](private-history.md).
Follower evidence is
[`managed-runtime-recovery-rc5-followers.json`](private-history.md).

The formal GitHub archive has SHA-256
`f31ef87b9a845c9cc88e1fe86a64f3ab69f959eefc8462fa1d637e0ded622ccb`.
It was produced from the same commit by the clean GitHub go1.22.12 workflow,
downloaded, verified against `SHA256SUMS`, and installed on local port 1991 and
all five sandboxes.
Each prior candidate tree is retained under
`0.2.0-rc.5-candidate-8c03c485adc5`. Formal publication evidence is
[`managed-runtime-recovery-rc5-formal.json`](private-history.md).
Human UAT remains pending.
