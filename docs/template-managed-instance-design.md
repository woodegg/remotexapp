# Remote app templates and managed instances

Driver code and component paths are versioned and snapshotted at runtime
creation. Managed and anonymous runtimes share the persistence,
restart-adoption, and locked-recovery contract in
[`runtime-manifest-design.md`](runtime-manifest-design.md). Driver
upgrade and rollback are in
[`driver-version-lifecycle.md`](driver-version-lifecycle.md); requirements and
decisions are tracked in [`requirements.md`](requirements.md) and
[`design-log.md`](design-log.md).

This phase intentionally uses a small control-plane model:

```text
operator-owned template JSON
          |
          +-- POST /api/instances ----------> temporary runtime
          |
          +-- managed-instance registration -> reconciled runtime
```

## Remote app templates

Templates are defined by trusted versioned App Package manifests under
`apps/<app-id>/manifest.json` and loaded through installed enabled selectors.
`configs/remotexapp-classes/` is an empty compatibility catalog. Packages define
drivers, input focus policy, readiness checks and default runtime policy. **Template** is the preferred API terminology; the class-oriented
fields remain part of the current template schema.

Templates are loaded at manager startup. There is deliberately no remote API
for installing a template or changing a driver. Both endpoints below currently
return the same catalog:

```text
GET /api/templates       preferred
GET /api/classes         compatibility alias
```

### Template launch parameters

A template may publish a narrow `parameters` schema. This is application input,
kept separate from generic lifecycle `overrides`. Supported types are `string`,
`boolean`, `integer`, `enum`, `url`, and `file`; definitions may include
defaults, required fields, size/range constraints, enum values, and allowed URL
schemes. Unknown parameters and mismatched types are rejected before a display
starts.

For example, `edge` declares `startUrl` and `incognito`:

```json
{
  "templateId": "edge",
  "parameters": {
    "startUrl": "https://example.com",
    "incognito": true
  },
  "overrides": {
    "idleTimeout": "10m"
  }
}
```

The manager resolves defaults, returns the effective non-secret values as
`instance.parameters`, and writes `launch-parameters.json` mode 0600 in the
runtime directory. Server, session, and shutdown drivers all receive only that
pathname as `REMOTEXAPP_PARAMETERS`, plus `REMOTEXAPP_RUN_MODE`. Drivers parse
JSON without `eval`. Templates cannot declare secrets in this
phase; a future secret facility must use opaque references rather than expose
values in instance responses or registry files.

The `file` type is a server-side path, not a browser upload. The manager
canonicalizes symlinks and accepts only existing readable regular files below
`REMOTEXAPP_DOCUMENT_ROOTS`, a colon-separated administrator allow-list. With
no explicit list, only `STATE_DIR/documents` is allowed. This check happens
before display or port allocation. The `libreoffice` template uses it for its
required `filePath`; prefer an opaque document ID plus a trusted upload or
resolution service when a downstream product should not reveal host paths.
Its session driver repeats exact-path open checks just before launch to detect
file removal or replacement, but rejects symlinks and never resolves the
manager-authorized canonical path to a different target.

The same template declares a generic `loopback-tcp` control endpoint. The
manager allocates a collision-checked port, persists it in the active runtime
manifest, and returns it as `instance.resources.control`. The driver binds
LibreOffice UNO to loopback on that port. Raw UNO is not a public RemoteXApp
route and must never be exposed through the reverse proxy. See
[`apps/libreoffice/README.md`](../apps/libreoffice/README.md).

The Firefox template uses the same allocation and persistence mechanism with
protocol `webdriver-bidi`, exact address `127.0.0.1`, and fixed path
`/session`. Generic allocation is returned in `resources.control`; validated
driver status owns the protocol and WebSocket metadata after a real BiDi probe
succeeds. This endpoint is host-local privileged automation, not a
browser-facing RemoteXApp route.

Application outcome is separate from launch intent. Templates may opt into the
implemented driver-reported snapshot contract, including generation/revision
handling and a validated public detail schema. See
[`application-status.md`](application-status.md).

### Trusted Unix-user environment

One required `runMode` selects the whole execution environment. `shared` and
`isolated` keep HOME under `STATE_DIR`, use the profile's `.Xauthority`, and
create one private D-Bus per session generation. `user-home`, as used by
`xfce-user-desktop`, resolves the manager account's passwd HOME, reuses
`/run/user/<uid>/bus`, and uses `~/.Xauthority`. The three resources cannot be
configured independently and are never request parameters.

This mode is intentionally narrow: only a persistent singleton managed
instance can use it; the fixed `profileRef` cannot be changed; temporary
instances and ephemeral workspaces are rejected; only one active owner of the
HOME or user bus is allowed; and `DELETE ...?purge=true` is rejected. `xauth`
adds or replaces only the fixed display record in `~/.Xauthority`, preserving
other displays and SSH-forwarding cookies. The session owns and cleans up its
IBus and Unicode processes, but does not launch, signal, or remove the shared
user D-Bus socket.

```json
{
  "id": "primary-desktop",
  "templateId": "xfce-user-desktop",
  "desiredState": "running"
}
```

Run the manager as the same dedicated real account whose HOME and desktop bus
the application needs. This feature does not grant access to another user's
HOME and does not introduce `sudo`, `su`, or UID switching.

## Temporary runtime instances

`POST /api/instances` creates an unregistered runtime. `templateId` is the
preferred request field; `classId` remains accepted for existing clients.

Example disposable Mousepad application:

```json
{
  "templateId": "mousepad",
  "profileRef": "scratch",
  "overrides": {
    "geometry": "1440x900",
    "frameRate": 10,
    "allowClientResize": true
  }
}
```

Its display and ports are allocated dynamically. Its isolated HOME and runtime
directory are deleted after the instance stops. The template-owned vacancy
timer starts when the server first becomes ready and restarts after the last
RFB client disconnects.

The accepted overrides are intentionally limited to display allocation/number,
geometry, frame rate, resize permission, workspace mode, session activation,
idle timeout/action and singleton behavior. The API cannot override drivers,
commands, arbitrary paths, environment variables or X11 input policy.
The default `xfce-user-desktop` template is the display-policy exception:
its fixed 1280×720 geometry and disabled resize permission cannot be changed by
instance overrides.

## Managed-instance registry

A managed instance is a persistent desired-state registration. Its stable ID is
different from the generated ID of its current runtime generation.

Managed registrations accept the same `parameters` object. Resolved values are
stored with the registration, so a restarted or replaced runtime keeps the same
launch behavior. Parameters are immutable in this first API version; replace
the registration to change them.

```text
GET    /api/managed-instances
POST   /api/managed-instances
GET    /api/managed-instances/{id}
PATCH  /api/managed-instances/{id}
DELETE /api/managed-instances/{id}
```

Example resident Mousepad:

```json
{
  "id": "resident-mousepad",
  "templateId": "mousepad",
  "desiredState": "running",
  "profileRef": "resident-mousepad",
  "overrides": {
    "displayMode": "fixed",
    "display": 12,
    "workspaceMode": "persistent",
    "sessionActivation": "immediate",
    "idleAction": "keep",
    "singleton": true
  }
}
```

The response reports both identities and both states:

```json
{
  "id": "resident-mousepad",
  "templateId": "mousepad",
  "desiredState": "running",
  "observedState": "running",
  "runtimeInstanceId": "mousepad-EXAMPLE",
  "runtime": {
    "id": "mousepad-EXAMPLE",
    "managedInstanceId": "resident-mousepad"
  }
}
```

Change desired state without removing the registration:

```http
PATCH /api/managed-instances/resident-mousepad
Content-Type: application/json

{"desiredState":"stopped"}
```

The manager stores desired-state registrations as mode-0600 JSON files under
`STATE_DIR/managed-instances/`. All active managed and anonymous runtimes use
the same versioned records under `STATE_DIR/runtime-manifests/`. The runtime
record privately owns the resolved template and component paths while the
managed record links by runtime ID. During the first release it also retains a
non-authoritative copy of the former fields solely for rc.15 rollback.
Accepted P09b observes VNC/gateway cgroup process exits immediately and
uses a jittered 4-6 minute full health pass for alive-but-hung processes;
`-managed-observer=poll` restores the five-second compatibility loop. Healthy
no-op passes do not rewrite the registry; only desired/observed/runtime/error
transitions use file `fsync`, atomic rename, and directory `fsync`. On manager
restart, complete healthy runtimes keep their exact units, locked snapshots,
session generations, and applications. Transient client counts reset and SDK
clients reconnect. An unhealthy runtime is recreated under the same ID from
its locked manifest rather than the current catalog unless its exact
application session is still alive and requires graceful host policy.

Accepted P10 uses the same cgroup/inotify reader for transient session units.
Each running session adds one watch descriptor; a populated-to-empty event is
qualified by runtime ID and session generation before it updates
`sessionState`/application status. This replaces the former per-session 500 ms
PID-file loop. Restart adoption reinstalls a watch for each recorded running or
blocked session; `-session-observer=poll` is the explicit compatibility fallback.

Status-enabled drivers must report `exited` before an orderly application or
desktop shutdown makes the cgroup empty. The observer maps that state to
`sessionState: stopped`; otherwise an unreported empty cgroup remains a
failure. The manager writes the current status schema before every new session
generation. A terminal observer update is persisted so a subsequent manager
does not adopt a dead session as running.

Stopping `/api/instances/{runtimeId}/stop` is rejected for a managed runtime;
the caller must change the managed registration's desired state. This prevents
the reconciler and caller from fighting each other.

Clean application exit is treated as an immediate idle transition. Managed
instances cannot use `idleAction=stop-instance`, so user close/logout retains
the server runtime and profile; a later attachment starts a new session
generation. Manager-initiated stop first runs the pinned graceful-shutdown
driver and may remain `shutdown-blocked` when user data needs attention. See
[`graceful-shutdown.md`](graceful-shutdown.md).

`DELETE` stops the runtime and removes the registration but preserves its HOME.
`DELETE ...?purge=true` also removes an ordinary persistent profile; it is
always rejected for `user-home`. Managed instances
must use persistent workspaces and may use `idleAction=keep` or
`idleAction=stop-session`; `stop-instance` is reserved for unmanaged runtimes.

### Persistent Firefox without a managed registration

The `firefox-esr` template deliberately uses that unmanaged reservation. Its
defaults are singleton, `runMode: shared`, `profileRef: default`, session
`on-attach`, and `stop-instance` after six vacant hours. While active, its
unified runtime manifest gives the same healthy manager-restart adoption as a
managed runtime. Once vacancy deliberately stops it, no durable registration
remains to restart the server. A later anonymous create receives a new runtime
ID but maps to the same persistent profile.

This keeps the managed lifecycle rules coherent and uses existing primitives;
it does not add a special desired state or an automatic registration delete.
Every attached client sees the same browser state, so use the singleton only
within one trust domain.

## Lifecycle separation

```text
template:       loaded ------------------------------> removed by operator
registration:   registered <-> running/stopped ------> unregistered
runtime:        starting -> server-ready -> stopped/failed
session:        stopped  <-> starting/running
attachment:     detached <-> attached
```

A runtime generation changes after explicit transition or locked fault
recovery, but not after healthy manager-restart adoption. The managed ID and
profile remain stable. A temporary runtime has no registration lifecycle.

This internal PoC remains unauthenticated. Anyone able to reach the manager can
currently create, change, connect to and delete instances, so an external
deployment still requires its existing access gateway.

## Fixed desktop deployment

The historical port-1991 fixed desktop used managed ID `example-managed-desktop`, template
`xfce-desktop`, desired state `running` and profile `xfce-driver-test`. This is
deliberate even though the template retains `server.activation=auto`: managed
reconciliation runs before template autostart, and any managed registration
for the template suppresses the anonymous launch, including while stopped. The
durable identity prevents duplicate autostart. Current restart behavior adopts
the healthy display-2 units and locked driver without changing unit PIDs;
browser channels reconnect to the new manager.

An older unregistered fixed-display autostart exposed issue #4: its transient
units survived manager exit while no durable runtime record existed. Unified
anonymous manifests and the first-restart cleanup now remove that collision.
