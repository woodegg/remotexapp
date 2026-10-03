# RemoteXApp 0.3.0 template catalog simplification train

Status: complete on 2026-09-02. Candidate `0.3.0-rc.1` at `cfddd717e14d`
completed implementation, automated gates, real upgrade and rollback, full
local E2E, deployment to local `0.0.0.0:1991`, and Human UAT. Annotated
[`v0.3.0`](private-history.md) at
`c719df9bb88c` is published as the normal Latest GitHub release. Sandbox
deployment remains a separate approval and is not authorized.

The accepted Human UAT candidate is core `0.3.0-rc.1`; final `0.3.0` changes
only release metadata, acceptance evidence, and current support documentation.

This train makes two catalog changes: Firefox ESR uses a 16-bit framebuffer,
and the unused `xfce-desktop` App Package is retired. Removing a public
template ID is a breaking catalog change, so the core target is `0.3.0` rather
than a `0.2.x` patch. SDK `0.18.0` and App Package ABI
`remotexapp/v1` remain unchanged.

## Locked scope

The candidate catalog contains exactly these shipped Apps:

- `edge@1.0.0`
- `firefox-esr@2.1.0`
- `libreoffice@3.0.0`
- `mousepad@2.0.0`
- `xfce-user-desktop@2.0.0`

`firefox-esr@2.1.0` changes only `server.depth` from 24 to 16. Its identity,
shared default profile, dynamic 1280x720 display, 5 FPS, client resize,
six-hour detached lifetime, and loopback WebDriver BiDi contract stay fixed.
Existing `firefox-esr@2.0.0` runtimes remain pinned to their immutable package
until stopped.

The operator confirms that no external or downstream system uses
`xfce-desktop`. It is removed without an alias, deprecation period, automatic
migration, or mapping to `xfce-user-desktop`. Historical release documents and
Git history remain unchanged as audit evidence.

## Retirement and upgrade rules

Source, release archives, the active shipped selector set, the template API,
and current console choices must omit `xfce-desktop`. Upgrade code may remove
only an explicitly retired shipped selector. It must never infer retirement
from a missing directory or remove an independently installed App Package.

Before activation, the deployment gate must prove zero active clients and zero
runtime or managed-instance references to `xfce-desktop`; otherwise it fails
closed. Internal test runtimes or stopped registrations are cleanup targets,
not compatibility consumers. Cleanup requires a separate execution approval
and is not authorized by this proposal.

## Acceptance gate

Before this train can be accepted:

1. Catalog and installer tests prove the exact five-App set, safe stale-selector
   retirement, third-party App preservation, and refusal while references
   remain.
2. Real Firefox tests prove 16-bit rendering, BiDi readiness/status, input,
   resize, reconnect, persistent profile behavior, and six-hour lifecycle
   semantics.
3. Upgrade and rollback tests cover `0.2.0` to `0.3.0` and back while
   preserving unrelated Apps, profiles, and runtime records. A failed
   pre-stopped selection requested with `--start` must restart and verify the
   restored release.
4. `make release-check`, `make release-ci`, confidentiality checks, and the
   complete local port-1991 E2E gate pass on one immutable candidate.
5. Human UAT, sandbox deployment, version tagging, and GitHub publication each
   require later explicit approval. Sandbox00 staging and production remain
   separate approval gates.

Items 1 through 4 passed on `0.3.0-rc.1`. The real local transition exercised
`0.2.0` → rc.1 → `0.2.0` → rc.1, preserved all four managed Desktop child
PIDs, and proved automatic recovery from an injected target-commit health
failure. Final Firefox validation proved the actual depth-16 VNC command,
BiDi, input, dynamic resize, reconnect, and cleanup; the retained user-home
Desktop proved fixed-size browser scaling and reconnect. Exact evidence is
[`template-catalog-0.3.0-rc.1-local-1991.json`](../tests/go-live-validation/results/template-catalog-0.3.0-rc.1-local-1991.json).
Human UAT was accepted on 2026-09-02. Exact acceptance is recorded in
[`template-catalog-0.3.0-rc.1-human-uat.json`](../tests/go-live-validation/results/template-catalog-0.3.0-rc.1-human-uat.json).
All acceptance items and formal publication are complete.

Formal publication passed. The downloaded linux/amd64 archive and its attached
`SHA256SUMS` verified at
`3b4c49afc8fec2aec6121822d573170f022a09bd0667de0ed93fd58001c3de69`.
The embedded commit, sensitive-data scan, and exact five-App catalog also
passed. Exact evidence is
[`template-catalog-0.3.0-formal-publication.json`](../tests/go-live-validation/results/template-catalog-0.3.0-formal-publication.json).

## Exclusions

This train does not change the SDK, App Package ABI, browser control schema,
managed/anonymous lifecycle model, or `xfce-user-desktop`. It does not delete
retained `0.2.0` packages or rewrite historical evidence.
