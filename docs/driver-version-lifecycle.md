# Driver version and immutable release design

Status: implemented; restart behavior revised on 2026-08-28 by
[`runtime-manifest-design.md`](runtime-manifest-design.md). This is the
authoritative design for selecting, pinning, upgrading, recovering, and
retiring RemoteXApp driver code. Requirements are tracked in
[`requirements.md`](requirements.md), and the decisions behind this design are
recorded in [`design-log.md`](design-log.md).

## Goals and boundaries

The design lets operators publish immutable code before activation, prevents a
running manager from mixing files from different releases, and preserves
healthy locked runtimes across manager restart. Both restart-time and
same-manager fault recovery remain pinned to each runtime's resolved snapshot;
driver adoption is an explicit runtime stop/start transition.

It does not provide hot catalog reload, an API for choosing arbitrary driver
versions, automatic release garbage collection, profile-schema migration, or
cross-host scheduling.

## Terminology

| Term | Meaning |
| --- | --- |
| RemoteXApp release | Exact application build identified by root `VERSION`, for example `0.1.0-rc.4` |
| Driver version | Semantic version of one App Package manifest and its executable assets, for example `2.0.0` |
| Runtime snapshot | Verified App Package identity/content plus resolved policy and canonical core-helper paths applied to one runtime |
| Active release | The release selected by both production `current` symlinks for the next manager start |

Release and App Package driver versions are independent. Publish changed bits
under a new `driverVersion`; a manager-only release may keep package versions
unchanged. Use `MAJOR.MINOR.PATCH`: patch for compatible fixes, minor for
compatible features, and major for incompatible driver or persistent-profile
contracts.

## Safety invariants

1. Published release directories are immutable and root-owned without group or
   other write permission.
2. The libexec and share selectors always identify the same release.
3. A runtime receives one complete snapshot at creation and never consults the
   mutable catalog afterward.
4. Unhealthy-runtime recovery within one manager lifetime uses the applied
   snapshot, not mutable selectors.
5. Moving `current` affects only a subsequently started manager and new runtime
   generations. Restarting the manager adopts healthy existing runtimes on
   their locked snapshots; it does not upgrade their child processes.
6. Any managed registration reserves its auto-activated template, including a
   stopped registration, so no anonymous duplicate is created.
7. A release referenced by a live runtime is retained.

## Release publication and activation

The production installer stages and publishes side-by-side trees:

```text
/usr/local/libexec/remotexapp/
  current -> releases/0.1.0-rc.4
  releases/0.1.0-rc.4/{remotexappd,novnc-input,remotexapp-status,VERSION}
/usr/local/share/remotexapp/
  current -> releases/0.1.0-rc.4
  releases/0.1.0-rc.4/{drivers/common,components,VERSION}
/usr/local/share/remotexapp/apps/<app-id>/<driver-version>/
/etc/remotexapp/apps-enabled/<app-id> -> installed version
```

`scripts/stage-system-release.sh` creates temporary directories below each
`releases/` directory, copies verified build outputs, and publishes them with a
rename. It also validates and publishes shipped App Packages without changing
their enabled selectors. Repeating identical content is idempotent; using an
existing release or App version with different content is rejected. The stager
does not change either `current` link, configuration, units, or service state.
This is the required preinstallation boundary for a coordinated upgrade.

`scripts/install-system.sh` remains the first-install workflow: it calls the
same stager, activates both core and shipped-App selectors, installs the unit
and administrator configuration, and starts only when `--start` is requested.
For an existing paired deployment, activate or roll back only with
`scripts/select-system-release.sh` while the consumer is stopped. Systemd units
and the administrator environment point through `current`.

The manager resolves its gateway, status helper, Unicode engine, and core
helper directory once at startup. Catalog loading validates the enabled App
Package selectors and resolves package-local executable paths. This establishes
the pinning boundary:

```text
stage release -> stop consumer -> select current -> restart manager
                                               -> load canonical paths
                                               -> adopt healthy locked runtimes
                                               -> snapshot only new runtimes
```

`make install-user` uses equivalent immutable core release and App Package
trees below `~/.local`, but remains a development/operator-local workflow.

## Configuration and runtime model

Every App Package declares one bundle version and ABI:

```json
{
  "apiVersion": "remotexapp/v1",
  "id": "mousepad",
  "driverVersion": "2.0.0"
}
```

The runtime manifest pins the package ID, version, content digest, archive
digest, and canonical installed path, plus all resolved server, session, input,
status, parameter, resource, and policy fields. The component snapshot contains
the exact canonical paths for core binaries and helpers. An instance returns
`driverVersion` through the API but keeps host paths and digests private.

A managed registration returns:

```json
{
  "appliedDriverVersion": "1.0.0",
  "availableDriverVersion": "1.1.0",
  "updateStatus": "update-available"
}
```

`availableDriverVersion` comes from the catalog loaded by the current manager.
`updateStatus` is `current` or `update-available` and compares driver versions,
not RemoteXApp release identifiers. `/api/templates` and the `/api/classes`
compatibility alias expose each template's `driverVersion`; instance and
managed-instance endpoints expose their corresponding public fields. The
operator console shows applied, available, and update status.

## Persistence and confidentiality

Managed registrations are mode-0600 desired-state JSON files under
`STATE_DIR/managed-instances/`. Every active managed or anonymous runtime uses
the same mode-0600 record under `STATE_DIR/runtime-manifests/`; that record owns
the complete resolved snapshot and component paths. Both stores use a temporary
file, file `fsync`, atomic rename, and directory `fsync`. Host paths are not
serialized by the normal HTTP API unless the operator deliberately enables
`-expose-internals`.

During the first unified-manifest release, managed records retain their former
embedded runtime and applied-snapshot fields as a rollback projection. Current
code uses the unified manifest as authority; the projection exists only so an
exact rc.15 manager can read the state after selectors are rolled back.

## Lifecycle behavior

| Situation | Required behavior |
| --- | --- |
| New temporary runtime | Snapshot the active manager's catalog and component paths |
| Existing runtime while its manager remains running | Continue on its locked snapshot until it explicitly stops |
| Healthy active manifest after manager restart | Adopt the same runtime ID, units, PIDs, session generation, application, template, and components; clients reconnect to the new manager |
| Incomplete or unhealthy active manifest after manager restart | If no recorded application PID is alive, stop exact units and recreate the same runtime ID from its locked manifest snapshot, never from the current catalog; otherwise preserve the live session for graceful host policy |
| Unhealthy running managed runtime | Gracefully close a surviving session, then recreate from its applied snapshot; a blocked close delays recovery until cancellation or force |
| Stopped managed registration | Keep registration/history but no runtime; next start uses the current catalog |
| Newly registered managed runtime | Use the current catalog and component snapshot |
| Catalog entry removed before restart | Continue to adopt or recover the manifest from its locked snapshot; no catalog entry is required |
| `current` moves while manager runs | No effect on that manager or its runtimes |

Before recovering an unhealthy runtime within one manager lifetime,
reconciliation requests graceful session shutdown, captures its resolved
specification and components, and passes the same runtime ID plus those pinned
creation inputs into locked recovery. An unsaved-data block is preserved under
host shutdown policy rather than silently destroyed. Cleanup or creation
failure retains that identity for the next reconciliation or manager restart;
recovery never creates a second active manifest for the managed ID.

Setting desired state to `stopped` tears down the runtime and clears its live
runtime pointer. Starting it again therefore selects the catalog and components
owned by the current manager. This stop/start transition is the intentional
driver update boundary. Stopping a managed runtime through the temporary
instance endpoint remains forbidden.

## Upgrade, rollback, and retirement

To publish and apply an update:

1. Bump root `VERSION` for a changed core. Independently package each changed
   App under a new `driverVersion`; never reuse a version for changed bits.
2. Run `make release-check`, install without `--start`, and inspect both
   `current` selectors.
3. Restart the manager. Healthy active runtimes keep their existing driver
   processes and applications; confirm stable unit PIDs, health, SDK reconnect,
   release version, and applied/available driver fields.
4. Notify or drain users only for each driver transition. Stop and start the
   selected runtime, then confirm that its applied version changes to the new
   catalog version. Do not rely on manager restart to apply it.
5. Validate attach, input, resize, reconnect, application behavior, and cleanup
   before continuing the rollout; obtain human UAT after full deployment.

For a compatible rollback, stop the affected service, repoint both `current`
symlinks to the same retained older release, and restart. Compatible healthy
runtimes remain on their already locked releases. Explicitly stop/start only
the runtimes that must move to the rollback catalog.

For an incompatible major-schema downgrade, stop the paired consumer and
manager, restore the exact pre-upgrade root/Home state snapshot, then select
and verify the older core before the older consumer. Never start an older
manager on forward-written state or copy files over a published directory.
State created after the rollback snapshot is intentionally outside the
rollback guarantee.

Retain the active release, the previous release, and every release referenced
by a runtime. Reference-aware garbage collection is not implemented, so
retirement is a manual, audited operation.

## First migration and failure policy

The first unified-manifest restart converts complete embedded managed snapshots
before normalizing their registrations. It stops and removes pre-manifest
anonymous runtime state while preserving profiles, because those old runtime
directories cannot prove their launch request. Normal autostart then recreates
configured anonymous services. No manual migration drain is required.

## Verification and evidence

Automated tests cover version parsing, catalog reporting, unified snapshot
persistence/reload, registry normalization, strict manifest validation,
healthy adoption, locked recovery inputs, lifecycle-observer restoration,
legacy managed migration, removal, and stopped-registration autostart
suppression.
Release validation is:

```bash
make check
make release-check
```

The accepted production evidence is
[`tests/go-live-validation/results/driver-version-lifecycle-production.json`](private-history.md).
That file is historical managed-runtime evidence. The current unified
managed/anonymous adoption and locked-recovery evidence is recorded in
[`tests/go-live-validation/results/runtime-manifest-adoption.json`](private-history.md)
and RTM-007 through RTM-009; production deployment and UAT remain separate.

## Known limitations

- Catalog activation requires a manager restart; there is no hot reload.
- The API cannot select a particular release or driver version directly.
- No content digest or release ID is stored on each instance. Evidence records
  hashes, but the runtime model relies on immutable canonical release paths.
- The installer enforces immutability for a release directory, but CI does not
  yet prove that the same `driverVersion` has identical content across two
  different RemoteXApp releases.
- Update status compares only the driver semantic version.
- Release retention and reference checking are manual.
- Persistent profile schemas have no separate version or automatic migration.
