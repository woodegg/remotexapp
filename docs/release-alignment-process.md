# Formal Release Alignment Process

This runbook defines the repeatable **对齐流程 (alignment process)** for
making an explicitly approved set of RemoteXApp endpoints run one formal
GitHub release. It supplements the publication and host-specific deployment
runbooks; it never expands deployment authorization.

## Ownership boundary

Effective 2026-09-17, this repository owns development, validation in the
RemoteXApp project test environment, immutable GitHub publication, and the
release handoff. The sandbox project owns every deployment, runtime restart,
rollback, and alignment in sandbox environments. Commands in this document
that operate deployment targets are retained as technical reference for the
sandbox project; they are not an instruction to run them while working in the
RemoteXApp repository.

“Align” or “对齐” by itself is intentionally incomplete. Before doing any
work, ask why alignment is needed and identify the intended outcome, target
set, owning project, release/tag, and runtime-restart policy. In this project,
the valid outcomes are test-environment verification, GitHub publication, or a
handoff package for the sandbox project—not direct sandbox deployment.

The normal cross-project flow is:

1. RemoteXApp develops and validates the candidate in its test environment.
2. After acceptance, RemoteXApp publishes the exact immutable release to
   GitHub and supplies tags, commits, hashes, compatibility notes, rollback
   identity, and required runtime-upgrade instructions.
3. The sandbox project independently verifies those bytes, chooses its target
   environments, deploys transactionally, restarts or upgrades affected
   runtimes, and records deployment evidence.
4. RemoteXApp consumes confirmed field results as feedback; it does not claim
   sandbox alignment from publication or handoff alone.

## 1. Fix the release and target set

**Local deployment policy (DEP-016, effective 2026-09-09):** every future
local installation, upgrade, redeployment, rollback, and alignment must keep
the production endpoint at `127.0.0.1:1991` and the test endpoint at
`127.0.0.1:2992` (the operator subsequently changed the local test port from
2991 to 2992 during the CLP-030–034 train). Other local Manager ports must also bind to `127.0.0.1`.
Do not restore historical wildcard (`0.0.0.0`, `::`, or `*`) listeners or copy
sandbox listener overrides into a local deployment. A non-loopback exception
requires new explicit operator approval. This policy does not change sandbox
deployment settings.

Before activation, verify the effective environment overrides or unit arguments;
after activation, use `ss -ltnp` to confirm the actual listener addresses and
check both loopback `/readyz` endpoints. A successful loopback HTTP request
alone does not prove the listener is loopback-only. Preserve existing auth,
Console/kiosk, state, and runtime policy unless separately instructed.

Record the immutable tag, tag commit, archive name and SHA-256, App Package
versions, SDK asset hash, endpoint list, expected listener/auth policy, and
rollback version. Capture each endpoint's service PID, selectors, version,
configuration checksum, App selectors, active runtime IDs, session generations,
attached-client counts, and durable manifest count before mutation.

## 2. Verify once, stage everywhere

Download the GitHub artifact into a fresh directory and verify `SHA256SUMS`.
Run the sensitive-data and artifact-content checks, confirm embedded version
and commit, then start an isolated manager and check `/healthz`, `/readyz`, the
SDK asset, and App catalog. Transfer those exact bytes to every approved host.
Use `scripts/stage-system-release.sh` to create immutable release directories;
staging must not change either core or App selectors.

## 3. Select transactionally

Activate one endpoint at a time with `scripts/select-system-release.sh`, an
expected commit, and its loopback health URL. Preserve its existing service
account and configuration. If selection or health fails, stop the rollout and
use the selector's automatic rollback before investigating. Paired consumers
must remain stopped until the Manager identity is verified.

A Manager restart adopts compatible durable runtime records. It does **not**
replace the immutable components pinned when an existing runtime was created.
Do not recreate or force-stop a runtime merely to align Manager versions;
runtime replacement requires its own authorization and user-impact plan.

Post-deployment smoke tests must never assume createInstance allocated a new
runtime. Singleton creation can return a pre-existing runtime even when a new
profileRef was requested. Record active IDs before testing, skip existing
singleton templates for mutating tests, and reject any returned pre-existing ID
before adding it to cleanup ownership. Existing instances receive read-only
checks only. Enforce this independently in cleanup; an ID returned by create
does not by itself prove test ownership.

## 4. Prove alignment

For every endpoint, verify twice after activation:

- `/api/version`, `/healthz`, and `/readyz` report the formal version/commit;
- installed and running binary hashes match the downloaded artifact;
- listener, authentication, document roots, Console/kiosk, and service UID are
  unchanged;
- enabled App identities and seals match the release catalog;
- pre-existing runtime IDs, session generations, attached clients, and
  manifest cardinality are preserved; and
- the post-activation journal contains no new warnings or restart loop.

Run the release smoke/E2E matrix required by its train. Record one machine-
readable evidence file with all endpoints and an explicit `drift: none` result.
Commit the evidence and handover update after the rollout; never move the tag.
