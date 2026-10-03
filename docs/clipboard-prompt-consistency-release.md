# Locked release — Clipboard prompt consistency

## Current approval — 2026-09-12

Completed: formal [v0.10.0](private-history.md)
published and all eight approved Managers aligned. Human UAT is accepted.
See [publication verification and retained test failure](../tests/evidence/v1/clipboard-0.10.0-publication.json)
and [per-endpoint alignment](../tests/evidence/v1/clipboard-0.10.0-alignment.json).
Existing runtime pins are deliberately preserved; old gateways still need a
separately approved upgrade/restart for guarded clipboard approvals.

Human UAT accepted CLP-035–040, including content-aware three-second receipts.
Formal Core `0.10.0` / SDK `0.27.3` publication and remaining-environment
deployment are authorized. Apps remain unchanged. The original rc.1 approval
and subsequent local development records below are historical and superseded
by this approval. Publish only after the hosted candidate and exact-archive
tests pass. Preserve existing runtime pins; do not infer forced runtime
upgrade permission from Manager deployment approval.

The private build-host label in unpublished rc.1 evidence was sanitized, with
operator approval to amend its unpublished commit. The source/history scan
passes without changing the scan rules or remote history. Unrelated audio
review material and sandbox-design changes are excluded from this release.

## Original candidate scope and validation

Status: locked by the operator on 2026-09-12. Target Core 0.10.0-rc.1,
SDK 0.27.0; App Packages unchanged. CLP-035–038 development, comprehensive
testing and deployment to local 127.0.0.1:1991/2992 are authorized.
No GitHub publication or sandbox deployment is authorized.

Implementation and local deployment completed on 2026-09-12; Human UAT is
pending. Exact candidate commit `a8569d1e92de` passed clean-clone release-ci,
all six exact-archive E2E suites, and deployed two-Viewer Mousepad/LibreOffice
checks on both endpoints. Configurations, App selectors and existing runtime
pins were preserved. The existing local XFCE remains on 0.9.1, generation 7;
use a newly launched instance or an explicitly approved runtime upgrade for
candidate UAT. No sandbox deployment or GitHub push/publication occurred.
See [the retained evidence](../tests/evidence/v1/clipboard-consistency-0.10.0-rc.1-local.json),
including intermediate validation failures and their corrections.

## Three governing principles — retained by operator, 2026-09-12

1. **Follow genuine changes:** prompt from the side whose content genuinely
   changed. Duplicate notification, unchanged clipboard-owner takeover and this
   Viewer's own synchronization echo are not new changes. Compare all supported
   formats, not only text.
2. **Keep only the latest valid prompt per direction, per Viewer:** newer content
   supersedes that direction's old prompt; reconnect must not resurrect handled
   old prompts. Revalidate on Yes. If the source changed, refresh the prompt;
   neither send stale content nor silently substitute new content under old
   consent.
3. **Let the user resolve genuine two-sided changes:** preserve a choice of
   direction when both sides independently changed. Do not pick a winner by
   timestamp or erase a genuine opposite-direction change merely because a local
   change was detected. Auto mode must defer to user choice for this conflict.

These are the locked design constraints for CLP-035–038, not implementation
acceptance. Keep policy Viewer-local; no global coordinator or
cross-machine last-write-wins clock is required. First observation establishes
a baseline, not proof that a remote copy just happened; manual synchronization
remains available. Read failures and permission failures are not content changes.

## Report and evidence boundary

The operator reports that changing only the local clipboard can coincide with
both local-to-remote and remote-to-local prompts. This incident has not yet been
reproduced end-to-end or attributed to a confirmed root cause. Local SDK-only
simulation did reproduce three relevant code paths: local-new plus remote-old
recovery yields both directions; a dismissed offer reappears on replay; and an
older sequence can remain pending after a newer remote offer. These demonstrate
possible mechanisms, not the cause of the operator's specific incident.

Current code already records offer createdAt/expiry, remote sequence/generation
and sourceViewerId. Local change detection uses fingerprints. The directions
are independent; reconnect can restore unexpired remote offers. Offer creation
time is not the actual OS copy time, and client/server clocks do not establish
reliable cross-direction ordering.

## Locked scope

- **CLP-035 — Content and event deduplication:** distinguish genuine changes,
  duplicate deliveries, recovered offers and this Viewer's sync echoes through
  content identity, event generation/revision and source/operation identity.
  Compare all supported normalized formats, not plain text alone. Do not drop
  richer representations to obtain a match or suppress legitimate later copies
  forever just because the same content was seen previously.
- **CLP-036 — Revalidate on acceptance:** before Yes or auto-sync writes,
  establish whether the offer and relevant observed source/destination versions
  remain applicable. Stale/conflicting state must not silently overwrite an
  independent new change; show expiry/conflict and refresh the choice as needed.
  Define achievable race guarantees before implementation; browser clipboard
  access must not be presented as an atomic OS compare-and-swap operation.
- **CLP-037 — Precise Viewer-local cleanup:** clear only prompts proven
  duplicate, already synchronized or superseded by a successful operation.
  Never blanket-clear the opposite direction or other Viewers' pending state.
  Preserve genuine independent changes on both sides for user choice.
  Timestamps support age/expiry, not last-write-wins direction selection.
- **CLP-038 — Evidence and regressions:** reproduce before attributing the bug.
  Test duplicate/out-of-order notifications, reconnect recovery, delayed Yes,
  simultaneous copies, writes in flight, MIME conversion, richer content,
  empty/error cases and independent Viewers. Include real-browser Console and
  Mousepad/LibreOffice cases. Diagnostics record IDs/revisions/timing, not
  clipboard payloads or persistent clipboard history.

## Compatibility and next gate

Preserve active-Viewer local monitoring, independent direction settings,
remote-change broadcast and source-Viewer-only echo suppression. In particular,
A accepting remote-to-local must not prevent B prompting local-to-remote when
B becomes active. Preserve current permissions, expiry and empty/rich-format
contracts.

Implementation, automated validation and authorized local deployment are
complete. This record does not claim Human UAT acceptance or attribution of
the original incident.

## API, consent and compatibility contract

Gateway capabilities add `consistencyVersion:1`, `sequence` (the latest
observed remote revision) and `settled` (whether the native snapshot has been
confirmed). Owner changes without Viewers invalidate metadata without reading
payloads. Monitoring resumption captures the current owner, marking that offer
as `baseline`; first-time Viewers do not mistake it for a fresh copy. Guarded
transfers reject unconfirmed or failed captures until a valid snapshot arrives.
Uploads may supply
`X-RemoteXApp-Clipboard-Sequence`; the SDK Manager exposes it as optional
`expectedSequence`. A stale guarded write or superseded remote accept returns
HTTP 409. The upload guard is checked after body validation under the same
operation lock as observed remote changes and writes. Session changes also
invalidate pending native captures. Content dedup compares sorted MIME types
and every representation's bytes with SHA-256, never plain text alone.
An observed empty remote selection sends metadata-only `clipboard-invalidated`
with generation/sequence to remove superseded remote prompts, never an empty
offer or an implicit browser clear.

The SDK's prompt approvals require consistency-capable runtime gateways. Updating
Manager/SDK alone does not upgrade pinned runtimes. Old SDK direct uploads remain
compatible but do not acquire the new precondition protection. Apps/drivers are
unchanged. WAOS only needs the matching SDK and upgraded runtimes; it retains one
Client and optional prompt controller per Viewer, with no shared coordinator.

On first attachment the remote snapshot is a manual baseline, not a prompt.
Automatic recovery only considers the latest unseen revision. Explicit `list()`
can expose the current unexpired offer for manual transfer without re-prompting.
Remote copies remain broadcast to all Viewers, independently of input focus.
Auto mode requires readable, known local state; ambiguous or conflicting state
defers to explicit choice. Ordinary active-Viewer monitoring still never asks
for permissions merely on focus.

For explicit remote-to-local approval, a known local observation is re-read:
if it changed, stop and request a new choice. Write-only manual use remains
possible when no local baseline/read authority exists; that explicit Yes means
the user chooses to replace unknown local contents. A failed required read is
not emptiness and never authorizes a write. Local-to-remote prompt approval
always re-reads the source; no old payload or silently substituted payload is
sent. A successful choice removes only the opposite offer actually superseded
by that operation, not a newer offer arriving during it or another Viewer's state.

This is an **observed-state guard**, not an atomic OS clipboard transaction.
External X11 owner changes can still be in capture, and browser APIs have no
atomic compare-and-swap or cancellation after a write starts. Revalidation
narrows those windows but cannot eliminate them. Offer timestamps determine
expiry only, never which machine wins. Clipboard contents are not logged.

Canonical IDs: [requirements.md](requirements.md#clipboard-prompt-consistency--pending-release).

## Human UAT checklist

Use newly launched Mousepad and LibreOffice instances on the candidate, or an
explicitly upgraded runtime. An existing 0.9.1 pin does not acquire this behavior
by restarting Manager. Keep one Client/controller per Viewer, enable both
prompt directions and grant browser clipboard access.

1. Copy locally, approve, then change only the local clipboard. Expect one
   local-to-remote prompt and no revived remote prompt, including after 60 seconds.
2. Copy in LibreOffice and accept remote-to-local in Viewer A. A must not offer
   that browser write back. Activate Viewer B: B may independently offer it.
3. Leave a prompt open and copy something newer. Only the latest same-direction
   prompt remains. A delayed old Yes must not transfer stale or substituted data.
4. Change both sides independently. Both choices remain; auto mode must defer
   rather than choose by timestamp. Approving one direction clears only the
   prompts that operation actually superseded.
5. Dismiss a remote prompt, reconnect and verify it stays dismissed. First
   attachment exposes a manual baseline, not a fresh-copy prompt. A real remote
   change during disconnection is rechecked when monitoring resumes.
6. Include plain text, rich HTML/RTF, PNG, empty content, permission denial and
   a session restart while an offer is pending. Failures must not overwrite
   the destination or be presented as an empty clipboard.

Local deployment must retain loopback bindings and existing Console/kiosk
policies. In particular, local 2992 currently has Console disabled: create a
disposable instance through its API and open its kiosk route rather than
changing that deployment policy for UAT.

## CLP-039 follow-up local deployment — 2026-09-12

Operator requested content-aware, non-actionable successful-sync receipts and
then authorized local deployment. Both 127.0.0.1:1991/2992 now run development
build `0.10.0-dev.20260912-clp039`, SDK `0.27.1`, based on working-tree changes
over `90721f2adf67`. This does not replace the immutable rc.1 acceptance record
above and is not an exact-commit or formal-release artifact.

Existing App selectors, runtime pins, configuration and feature flags are
preserved. Both endpoints passed two Manager starts, readiness and exact
binary/SDK/Console asset checks. SDK asset `sdk-ZFNCDQCT.js` SHA-256:
`47a8aa09af2f86327cc78bcc0fa07e9de9773f2d023f484b89c5f15a048bf040`.
All 117 SDK tests passed. Live verification uses disposable Mousepad and
LibreOffice instances with two isolated headless browser profiles, including
the new successful-sync notice assertion in
`tests/go-live-validation/check-clipboard-client.mjs`.

All four live combinations passed, including real transfer, sample text and
zero success-notice buttons. Disposable instances were stopped afterward;
pre-existing runtimes remained unchanged. Manager warning journals were empty.
Local run records are `/tmp/remotexapp-clp039-{1991,2992}-{mousepad,libreoffice}.json`;
deployment snapshots are under `/tmp/remotexapp-clp039-deploy.gD5YLR/`.

Reload the Viewer page to load SDK 0.27.1. Confirm a real transfer shows its
formats and a short plain-text sample without Yes/×. Pending consent prompts
must still offer those controls. Human UAT is pending. No sandbox rollout,
existing-runtime upgrade, GitHub push or publication was authorized here.
The earlier evidence/history private-marker scan failure remains unresolved;
do not treat this local deployment as a successful formal release gate.
