# Runtime Upgrade and KDE Editors — Locked Release Train

Status: locked by the operator on 2026-09-10. Target Core `0.7.0-rc.1`, SDK
`0.24.0`, Kate `1.0.0` and KWrite `1.0.0`; other App versions remain unchanged.
UPG-001–004, KTE-001 and KWR-001 are authorized for implementation, full tests
and deployment to local `127.0.0.1:1991` and `127.0.0.1:2992` only. This is a
separate train from the `0.6.0-rc.1` UAT candidate. No sandbox deployment,
publication, or forced termination of existing user runtimes is authorized.

Locked transition contract: one per-runtime durable upgrade record embedded in
the existing private manifest tracks the frozen target and stopping/launching/
completed/blocked/failed phase. Upgrade POST requires expected sessionGeneration
and targetRevision; GET version/status inspection is non-mutating. Server-ready
is the POST completion boundary, not a promise of application readiness for an
on-attach template. SDK/Console report that distinction. Interrupted transitions
are reconciled before normal recovery; failed/blocked upgrades do not silently
fall back to another target or retry through ordinary managed reconciliation.

## UPG-001 — Explicit upgrade-and-restart operation

Keep ordinary `/restart` unchanged: rebuild the runtime from its locked App
and component snapshot. Manager restart/adoption and automatic recovery must
also never opportunistically upgrade running applications.

Add a separate operation for managed and anonymous runtimes that restarts using
the current Manager's deployed component bundle and currently enabled version
of the same App template. “Available” means locally installed and selected,
not the latest GitHub release. Do not download, install or enable packages as
part of this operation. Same App version with newer core components still
counts as an update. A selected older version must be labelled as a downgrade,
not silently described as an upgrade; initially reject that case and leave
rollback to the separate operator workflow.

Preserve runtime ID, managed association, original parameters, profile reference,
explicit overrides and persistent HOME/data. Increment session generation
monotonically; invalidate old connection metadata. Ephemeral state and unsaved
documents are not promised to survive. Revalidate launch inputs and overrides
against the target template rather than silently dropping incompatible values.
Reallocate resources under the target policy; control ports may change, so
consumers must refetch descriptors. Respect normal activation/readiness policy:
server-ready is not application-ready for an on-attach template.

## UPG-002 — Safe transition and observable failure

Before stopping, validate target availability, immutable identity, dependencies,
parameters, profile compatibility and policy. Check runtime ID, expected session
generation and expected target revision; reject stale or conflicting requests.
Freeze the selected target for the transition. Serialize against restart, stop,
managed reconciliation and duplicate upgrade requests.

Use existing application shutdown and host enforcement policy. Do not silently
escalate to force; expose explicit force only with the usual authorization and
data-loss warning. A blocked normal shutdown must leave the old runtime intact
and must not launch a second instance. Treat missing-target/preflight failure,
blocked shutdown, cleanup failure and new-launch failure as distinct outcomes.

Durably record transition intent and phase so a Manager crash at any boundary
can resume or finish scoped cleanup without duplicate displays, document owners
or runtimes. Return honest pending/failed states and actual applied versions;
do not claim success before the documented completion boundary. Do not promise
automatic rollback of persistent data after a new App has touched it. The exact
transition record, retry rules and HTTP schema are fixed by the contract above.

## UPG-003 — Client SDK support

API: `POST /api/instances/{id}/upgrade-and-restart`, separate from
`/restart`. SDK entry points:

- `manager.upgradeAndRestartInstance(id, options)` for controllers/local Agents.
- `client.upgradeAndRestart(options)` for a bound Viewer, delegating to the
  Manager operation rather than implementing a client-side stop/start pair.

The exact HTTP fields, SDK examples, phases and failure handling are documented
in the [upgrade integration guide](runtime-upgrade-api.md).

Provide typed current/available version information, expected generation/target
revision, explicit force, cancellation and structured error/result handling.
Cancellation stops waiting; it does not undo an already accepted server-side
transition. Do not automatically resubmit a destructive request after a lost
response: reconcile operation/runtime status first.

The bound client must coordinate its existing reconnect policy, discard stale
generation/connection/clipboard state, and reconnect to the resulting runtime
without duplicate launch requests. Trusted Agents explicitly refetch protected
`getConnections()` data; never copy their capability token into a Viewer.
Unchanged restart APIs and consumers remain compatible. Document usage and
errors for downstream integrations such as WAOS; no WAOS code changes belong
to this train.

## UPG-004 — Console version visibility and distinct actions

Display both **Current runtime version** and **Available version** on runtime
details/cards, including the core component bundle version/build identity and
App/driver version. Do not substitute the Manager's version for an old runtime's
actual pins. Legacy incomplete identity is “unknown,” not “current.” A stopped
managed instance has no current runtime; show that explicitly.

Show update availability only from authoritative server metadata. Keep
**Restart (current version)** and **Upgrade and restart** distinct, with the
source/target versions and shutdown/data-loss warning before confirmation.
Disable the upgrade action when no update is available, the target is invalid,
or a conflicting operation is in progress. Show blocked/failed outcomes and
refresh actual versions after completion. Avoid exposing internal paths,
credentials or connection capabilities in version metadata.

## Required acceptance before release

### KTE-001 / KWR-001 — Two additional App templates

Add independent `kate` and `kwrite` App Packages, each with its own manifest,
entry point, dependency declaration, version and tests. Both follow the agreed
LibreOffice-like optional-file, isolated/Matchbox/display/vacancy/no-save policy.
Use their independently verified D-Bus descriptors through CONN-001 private
metadata, not a hardcoded generic Kate service or an application-specific core
adapter. See [control research and acceptance](kate-kwrite-control-research.md).
Kate needs `--block --startanon`; KWrite must not receive those unsupported flags.
Their interface name is shared, but their service prefixes and identities are not.
The four-process local experiment and helper submission passed. Independent
packages and fail-closed probe tests are implemented. Real runtime checks cover
optional files, three control calls and GUI readback, explicit save, normal/force
no-save stop, clean application exit, 60-second vacancy, browser resize/IME and
bound SDK upgrade/reconnect. Human UAT remains required.

### Upgrade acceptance matrix

Cover all seven shipped templates' policy, managed and anonymous ownership, persistent
and ephemeral HOME, fixed/dynamic displays, changed control ports, and
on-attach/immediate activation. Prove ordinary restart retains old pins while
explicit upgrade selects the frozen current target, including core-only updates.

Test incompatible/removed parameters, disabled or missing packages, unavailable
dependencies, stale generation/target revision, concurrent requests, blocked
shutdown, explicit force, cleanup/launch failure, and Manager crash/recovery at
each durable phase. Prove single ownership and correct retained parameters/data.
Test SDK cancellation, lost responses, reconnect limits, refreshed connections,
Console source/target labels, disabled actions and failure messages. Require
exact-candidate E2E, documented evidence and Human UAT; deployment targets and
publication require separate authorization.

## Verification commands and remaining acceptance boundaries

- `go test ./cmd/remotexappd -run TestUpgrade -count=1`: durable transitions,
  generation/revision guards, veto/force/failure, managed ownership and
  shared/isolated/user-home policy matrix, including invalid combinations.
- `node --test cmd/remotexappd/web/sdk/runtime-upgrade.test.mjs`: SDK mutation,
  cancellation/lost response, configuration preservation and Console labels.
- `node --test apps/kate/tests/*.mjs apps/kwrite/tests/*.mjs`: independent package
  contracts and wrong PID/signature/window/bus-owner/blank-initialization failures.
- `node tests/app-package/run-upgrade-kde-local-e2e.mjs`: disposable loopback
  21993; six real non-user-home Apps, persistent/ephemeral data checks, browser
  SDK/IME and injected durable phases followed by actual Manager SIGKILL/recovery.
  A synthetic managed editor additionally exercises App-version and core upgrade.
- `make release-ci`: unchanged portable release, race, coverage, vulnerability,
  license/installer and packaging gates. `scripts/test-release-candidate.sh`
  then runs synthetic, shipped-App, document/connection and upgrade/KDE E2E
  against the exact hosted candidate archive.

Live tests need systemd user services, X11/TigerVNC, IBus, the six Apps,
Matchbox, headless Chrome, gdbus, xdotool and xclip (test readback only).
No test replaces the existing user-home XFCE desktop. Its policy has unit
coverage and its old runtime is retained for deployment health checks; a live
XFCE upgrade is not claimed. Native focus/permission UX still needs Human UAT.

## Local deployment and UAT

Automated acceptance and deployment completed on 2026-09-10 at 07:16 UTC.
Both loopback endpoints run exact hosted candidate commit `a3f4a2569d4f`,
Core `0.7.0-rc.1` / SDK `0.24.0`. Hosted Verify and Release candidate gates,
exact-archive E2E, and post-deployment editor/connection/browser checks passed.
See [machine-readable evidence](../tests/evidence/v1/runtime-upgrade-0.7.0-rc.1-local.json).

The 1991 catalog has seven templates; 2992 has six (its existing catalog did
not include XFCE). Kate and KWrite are separate new selectors, both `1.0.0`.
All other App selectors and auth/page/token configuration are unchanged.
The existing user desktop was adopted without changing its ID, generation or
old core pin. No sandbox was touched and no GitHub Release was published.

Human UAT remains pending:

1. On the deployment host, open `http://127.0.0.1:1991/sdk/console.html`.
   Launch `kate` and `kwrite` separately, with and without an allowed `filePath`.
   Verify typing/IME, resize, opening the intended file and manual save.
2. Use disposable documents to verify that stop discards unsaved changes.
   Check that one editor's shutdown does not terminate another editor.
3. Inspect the existing desktop's Current runtime / Available version labels
   and separate restart/upgrade actions. It remains on `0.6.0-rc.1` intentionally;
   do not upgrade it without accepting the shutdown/data-loss implications.
4. Exercise SDK `getRuntimeVersions()` and the guarded upgrade flow described
   in [the integration guide](runtime-upgrade-api.md). Already-current new
   runtimes must reject an unnecessary upgrade without restarting.
5. Test native browser focus and clipboard permission UX manually. The 2992
   endpoint remains available through API/SDK/kiosk; its Console stays disabled.

UAT acceptance, stable publication and any further deployment require separate
operator direction. Older release rollback must respect the new-manifest
compatibility warning in the upgrade API guide.
