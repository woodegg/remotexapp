# Connection readiness mask — 0.11.0

> Historical technical record. Dated status and validation statements describe
> their original scope; they do not identify a current deployment. See
> [current source versions](current-state.md). Host labels and runtime IDs in
> historical examples are anonymized.

Scope locked 2026-09-13. Target: `0.11.0-rc.1`, SDK `0.28.0`.

## Stable promotion authorized

**Completed:** `v0.11.0` is published as GitHub Latest and all eight approved
endpoints are aligned. SDK `0.28.0`; App Packages unchanged. Hosted/local
gates and all six formal exact-archive suites passed first attempt, followed
by eight served live-App mask tests and the clipboard browser matrix.
See [formal evidence](private-history.md).
UAT requirements SDK-005/006 and CON-011 are accepted. Local Viewer continuity
was not fully preserved during Manager switching: see the evidence caveat;
runtime adoption success does not prove client reconnection success.

2026-09-13: Human UAT passed. Operator approved stable `0.11.0` GitHub
publication and alignment of local 1991/2992, test-host-a 1991/2991 and
test-host-c/03/07/10 1991. SDK `0.28.0` and accepted behavior remain unchanged.
Run exact formal-candidate gates before publishing; preserve existing runtime
pins and configuration. This approval supersedes the original local-only
authorization retained below. The first-run lifecycle-contention caveat remains
recorded and the formal candidate must be tested independently.

- SDK-005: default-on `connectionMask` boolean option and
  `setConnectionMaskEnabled(boolean)` per-Viewer switch. Declarative viewers
  support `no-connection-mask`. No Manager or App-specific branching.
- SDK-006: cover connecting/reconnecting until transport is connected,
  current-generation application status is ready and a frame is painted.
  No brightness heuristic or fake percentage. Bounded timeout and failures
  offer retry/cancel; cancel disconnects only the Viewer. Existing connection
  promises, reconnect budgets and session lifecycle retain their meaning.
- CON-011: independent default-on Console/kiosk Viewer switch. Switching off
  does not reconnect. `connectionMask=off` initializes kiosk off. Exposure policy
  remains unchanged, including disabled Console on local test port 2992.

## Design safeguards

Approved dark HTML concept: small app-neutral icon, restrained motion,
connection/application/picture phases and a brief fade on readiness. No secrets,
clipboard contents or screenshots in the mask. The mask blocks remote input
within its Viewer, not the whole page. Retry/cancel are keyboard accessible;
reduced-motion disables animation. Narrow windows remain usable.

The painted-frame adapter belongs in assets-src, not vendored noVNC. It observes
visible damage flips after RFB connection, restores its hook on disposal, and
has compatibility checks/tests. A black painted frame is valid; canvas dimensions
alone are not. Ready cannot guarantee completion of all app-internal async work.

Readiness polling is bounded to 45 seconds and scoped to a connection attempt.
Stale results cannot dismiss a replacement mask. Timeout affects presentation,
not application lifecycle. Disconnection/terminal exit stop loading immediately.
Keep mask readiness distinct from transport state and preserve user retry budgets.

## Required verification

Both readiness orderings, black frames, no frame, stale callbacks, status errors,
app exit, cancel, reconnect/exhaustion, timeout, on/off, disposal and multiple
Viewers. Run SDK/input/clipboard regression tests, `make check`, candidate gates,
real served-browser UI and disposable App checks on both local endpoints.
Verify listener/asset identity and preserve existing runtimes. Human UAT follows;
no formal release or sandbox deployment is authorized.

## Local candidate verification — 2026-09-13

Deployed Core `0.11.0-rc.1` / SDK `0.28.0` to `127.0.0.1:1991` and
`127.0.0.1:2992`. This is a working-tree candidate based on `1b76c63510e0`,
not a formal GitHub release. Archive SHA-256:
`ae1f647d042c755406c8827c20be82a660f36a4e17d068806b6556fcd2d54aec`.

Passed `make release-ci` (including 134 SDK tests, Go checks, coverage,
vulnerability scans, race tests and release staging); shipped-App local E2E;
document lifecycle E2E; browser mask fixtures and served clipboard UI regression.
The served mask test passed Mousepad, LibreOffice, Kate and KWrite on both
endpoints, checking ready/paint gating, default-on controls and toggled reconnect.
The real Console two-window check also passed: each starts enabled and disabling
the foreground Viewer's mask leaves the background Viewer's setting enabled.

Additional KDE/upgrade regression initially failed with the Manager's existing
`a lifecycle operation is already in progress` rejection during SDK upgrade.
This failure is retained in `/tmp/remotexapp-mask-upgrade.log`; it must not be
counted as a passing suite. Mask polling uses instance status reads, not the
Manager lifecycle mutex. A repeat is recorded separately; no Manager locking
semantics were changed in this presentation-only train.
The unchanged suite subsequently passed in full; see
`/tmp/remotexapp-mask-upgrade-repeat.log`. This is a pass on repeat, not a
first-run clean gate. The initial lifecycle-contention occurrence remains a
verification caveat for formal release review.

Deployment verified two Manager starts per endpoint, exact executable identity,
loopback listeners, readiness and unchanged configuration, App selectors and
existing runtime pins. No existing runtime was upgraded. Test Console stays
disabled; its per-instance kiosk remains enabled. Human UAT is pending.

Local diagnostic logs (not portable release evidence):
`/tmp/remotexapp-mask-final-ci.log`, `/tmp/remotexapp-mask-shipped-e2e.log`,
`/tmp/remotexapp-mask-document.log`, `/tmp/remotexapp-mask-live.log`,
`/tmp/remotexapp-mask-clipboard-ui.log`; deployment snapshots are under
`/tmp/remotexapp-mask-stage.A9lFjw/evidence`.
