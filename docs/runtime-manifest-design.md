# Unified runtime manifest design

## Scope

RemoteXApp stores every active managed and anonymous runtime in the same
versioned manifest database. The database is a directory of independent JSON
records, not SQLite:

```text
STATE_DIR/
  managed-instances/<managed-id>.json
  runtime-manifests/<runtime-id>.json
  instances/<runtime-id>/
  profiles/...
```

The managed registry is desired state. A runtime manifest is authoritative
active execution state, linked by `managedInstanceId`. During the first
manifest release only, a managed record also carries the former embedded
runtime fields as a non-authoritative rollback projection readable by rc.15.
This keeps anonymous and managed server/session launch data on one current
lifecycle path without making a temporary runtime into a managed registration.

## Record and durability contract

Each mode-0600 runtime record contains schema version 1, the runtime identity,
template/profile/parameters/overrides, allocated display and RFB/gateway/
application-control ports, exact unit names, anonymous runtime desired state,
the resolved template snapshot, and canonical component paths. The
manager uses strict JSON decoding and rejects inconsistent filenames, runtime
paths, template IDs, or unit names.

Creation resolves and allocates the runtime, writes a `starting` manifest with
file `fsync`, atomic rename, and directory `fsync`, and only then starts the
first systemd unit. A forced anonymous stop first persists
`desiredState=stopped` and aborts without process teardown if that write fails.
A graceful stop first durably records its application request, invokes the
driver, and only after a completed session shutdown persists stopped intent
before server/VNC/gateway teardown or profile removal. Failed cleanup retains
stopped intent so restart finishes teardown instead of resurrecting the
runtime, including ephemeral HOME removal. A blocked graceful stop keeps
desired state `running`. Client counts are recorded for diagnostics but
never trusted during recovery: manager restart disconnects its WebSockets, so
adoption resets the count to zero before new clients attach.

## Restart and version boundary

Manager restart is a health-checked adoption boundary, not a driver-upgrade
boundary. Startup loads the manifest and verifies that a desired-running
runtime is complete: recorded units must be active, the X display and gateway
must be healthy, readiness PIDs, required Unicode sockets, and any declared
loopback application-control listener must exist, locked dependencies must
still be available, and recorded session/shutdown state must be internally
consistent.

The manifest stores the resolved control protocol, exact loopback address,
allocated port, and any fixed WebSocket path/URL. Older generic-control records
that contain only a port deterministically normalize to `127.0.0.1`; no public
or caller-selected bind address is accepted during adoption.

A complete healthy runtime is inserted into the new manager unchanged. Its
runtime ID, unit PIDs, session generation, application processes, resolved
template, and component paths remain locked. The manager restores managed and
session cgroup watches, vacancy timers, and blocked-shutdown policy timers.
HTTP and WebSocket connections still terminate with the old manager; clients
reattach through normal SDK automatic reconnection.

An incomplete or unhealthy desired-running runtime is stopped by its exact
recorded unit names, its per-generation runtime directory is cleared, and the
same runtime ID is recreated from the manifest's resolved template and
component snapshot. Recovery never substitutes the catalog loaded by the new
manager. To apply the new driver, an operator explicitly stops and starts the
runtime; this is the auditable version transition.

The same identity rule applies when managed reconciliation detects an
unhealthy runtime while the manager is still running. The managed pointer and
single manifest remain bound to the old runtime ID through graceful session
shutdown, exact-unit cleanup, directory cleanup, creation, and final managed
record publication. A cleanup or creation failure therefore retries the same
record rather than allocating another identity.

One safety exception protects user data: if full adoption health fails but the
exact session unit and its recorded application PID are still alive, startup
preserves that locked session and exposes the degraded health instead of
killing it. Managed reconciliation or the next idle/operator stop then uses the
normal graceful-shutdown and host-force policy. Automatic locked recreation is
reserved for runtimes with no live application to protect.

Managed registrations with `desiredState=stopped` are not recreated. An
anonymous manifest remains active until its instance is explicitly stopped.
Template autostart runs only after manifest restart and managed reconciliation,
so it cannot create a duplicate fixed-display runtime.

Pre-rc.5 managers could leave two manifests for one managed ID after replacing
an unhealthy runtime. Startup repairs that legacy state before restoration. A
unique live application wins regardless of an older managed pointer. With no
live application, the exact managed pointer wins, followed by a uniquely
healthy record; if all records are unhealthy, the newest `createdAt` wins with
runtime ID as a deterministic tie-breaker. Multiple live applications, or
multiple healthy records without an authoritative pointer, fail closed rather
than destroying an arbitrary session. Exact stale units and runtime directories
must be cleaned successfully before their manifests are removed.

## First migration

The first startup converts an embedded managed runtime snapshot into a unified
manifest before normalizing its managed record. Old anonymous runtime
directories do not contain enough trusted launch data to reconstruct a request.
The migrator therefore stops only the exact unit names derived from each safe
runtime-directory ID, removes that runtime directory, and preserves all profile
directories. Current `activation=auto` templates are then recreated normally.
No manual drain or backup is required; restarting the manager performs the
migration.

For the first release, normalized managed writes retain a compatibility copy of
the runtime and applied snapshots. A rollback to rc.15 can therefore adopt a
healthy managed runtime after switching the immutable release selector. Current
code never treats this copy as authoritative when a unified manifest exists.
Remove the projection only after the supported rollback window no longer
includes a pre-manifest release.

## Failure handling

- A corrupt or internally inconsistent manifest fails startup closed.
- A partial prior creation is safe because its manifest predates its units.
- Unit cleanup failure retains a `failed` manifest and prevents reuse of its
  resources.
- A structurally complete but unhealthy runtime follows locked recovery.
  Recovery failure remains visible through `/api/instances`; a later restart
  retries it, and an explicit stop removes it.
- A terminal session observer update is persisted immediately, so a following
  restart never adopts a dead session as running.
- One lifecycle mutex serializes create, stop, managed reconciliation, and
  restart restoration, while per-record atomic writes avoid a database-wide
  transaction or lock.
- Every managed recovery crash point retains at most one current-generation
  manifest. Startup can bind its foreign key, clean partial exact-name units,
  and recreate the same identity from the locked snapshot.

The runtime state directory is private to one Unix UID. Another process with
the same UID is already inside the product trust boundary; mutually untrusted
deployments must continue to use separate UIDs or containers.
