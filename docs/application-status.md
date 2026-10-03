# Driver-reported application status

`remotexappd` separates runtime/session lifecycle from application-specific
readiness. A session PID proves that the supervisor and application process
exist; it does not prove that an application finished opening its document or
completed its own initialization.

The status contract gives reconnecting clients a durable snapshot:

```text
template status schema
        |
manager writes generation N / starting
        |
driver -> remotexapp-status -> atomic application-status.json
        |
GET /api/instances/{id} and GET /api/instances/{id}/status
```

This is snapshot-first. A client never depends on having received an event
while it was disconnected. An event stream may be added later as an
optimization, but reconnect must always fetch the current snapshot.

## Template contract

Status is opt-in per template. Mousepad, Edge, LibreOffice, Firefox ESR, and
both XFCE templates currently enable it:

```json
"status": {
  "mode": "driver",
  "details": {
    "application": {
      "type": "enum",
      "values": ["mousepad"]
    }
  }
}
```

`details` uses the same constrained types as launch parameters: `string`,
`boolean`, `integer`, `enum`, and `url`. A status detail cannot be required or
have a default. Undeclared fields, incorrect types, constraint violations, and
stale generations are rejected by the helper. Templates without `mode=driver`
have no application-status endpoint.

## Driver environment and reporting

For an enabled session, the manager supplies:

```text
REMOTEXAPP_SESSION_GENERATION
REMOTEXAPP_STATUS_PATH
REMOTEXAPP_STATUS_SCHEMA
REMOTEXAPP_STATUS_HELPER
```

The manager writes the current schema and initial `starting` snapshot before
every session generation. Rewriting the schema also upgrades a persistent
runtime created before status was enabled for its class. A legacy runtime that
is stopped and has no status file is exposed as `stopped`, not as a false
status-read error.

Status-enabled drivers source `drivers/common/session-status.sh` and report
without constructing or evaluating JSON themselves:

```sh
session_status_report \
  --state ready \
  --summary "Mousepad is ready" \
  --detail-string application=mousepad
```

Available typed flags are `--detail-string`, `--detail-bool`, and
`--detail-integer`. Enum and URL values use `--detail-string` and are checked
against their declared constraints.

The helper reads the current generation, increments `revision`, validates only
public declared details, records `updatedAt`/`lastReadyAt`, and replaces the
mode-0600 file atomically. It rejects a report from an earlier driver after a
new session generation has started.

While a session is starting, a generation-matched driver `error` ends the
manager's readiness wait promptly and remains the reported cause. Status from
an older generation cannot fail a new startup, and a live readiness PID takes
precedence over a racing error snapshot.

## Status envelope

```json
{
  "generation": 3,
  "revision": 4,
  "state": "ready",
  "updatedAt": "2026-08-26T22:40:15Z",
  "lastReadyAt": "2026-08-26T22:40:15Z",
  "summary": "Mousepad is ready",
  "details": {
    "application": "mousepad"
  }
}
```

States have the following meanings:

| State | Owner and meaning |
|---|---|
| `stopped` | Manager: the session has not started or was deliberately stopped |
| `starting` | Manager: a new session generation is being launched |
| `loading` | Driver: application-specific initialization is in progress |
| `ready` | Driver: its declared readiness condition is satisfied |
| `error` | Driver or manager: initialization/runtime failed |
| `exited` | Driver: application exited normally |

The configured readiness PID remains the startup gate. After readiness, P10's
default manager watches the transient session unit's cgroup and reacts when
its complete process tree exits; `-session-observer=poll` restores the former
500 ms readiness-PID monitor. If the unit empties without a driver-reported
`exited` or `error`, the manager records an unexpected-termination error.
Events carry the instance ID and session generation, so a late prior-session
event cannot change the new session. During deliberate cleanup, the manager
removes the watch, records `stopped`, and preserves previous public details and
`lastReadyAt` where the runtime continues to exist.

A driver-reported `exited` state also triggers the configured idle action
immediately. `stop-instance` removes the runtime; `stop-session` and `keep`
retain its server layer. The SDK emits `sessionended` and disconnects so the
user's deliberate close/logout is not immediately reversed. Manager-initiated
shutdown uses the separate application-aware protocol in
[`graceful-shutdown.md`](graceful-shutdown.md).

## API and reattachment

The normal instance response includes `sessionGeneration` and
`applicationStatus`. A smaller snapshot is also available at:

```http
GET /api/instances/{instanceId}/status
```

Browser SDK 0.4 provides:

```js
const instance = await manager.getInstance(instanceId);
console.log(instance.applicationStatus);

await client.connect(instance);

const status = await manager.waitForApplicationState(
  instanceId,
  ['ready', 'error'],
  {
    generation: instance.sessionGeneration +
      (instance.sessionState === 'stopped' ? 1 : 0),
    timeout: 30000,
  },
);
```

Connecting an on-attach template starts its stopped session. Waiting for the
new generation prevents a client from accepting a prior session's `ready`
snapshot. Managed-instance responses embed their current runtime, including
the same status fields.

## SDK console UI

The built-in console at `http://test-host:1991/sdk/console.html` exposes the
same snapshot in two places:

- Each instance card shows a compact line containing the session generation,
  application state, revision, and summary, for example
  `session generation 2 · app ready r9` followed by `Mousepad is ready`.
- After connecting an instance, the lower diagnostics panel contains the full
  `applicationStatus` object, including timestamps, public details, and errors.

The instance list refreshes approximately every three seconds. Connecting an
immediate Mousepad session therefore shows the progression from `starting` to
`loading` to `ready`; after detachment and idle cleanup it changes to
`stopped`. The console currently provides a snapshot UI, not a historical
timeline or event chart. Use `generation`, `revision`, and `updatedAt` to
interpret ordering.

## Current application semantics

Mousepad reports `loading` before private D-Bus/Matchbox/application startup,
`ready` after its PID file has been published, and `exited` or `error` when the
process finishes. Mousepad has no authoritative document model API, so `ready`
means the application process is available; it does not prove that a document
was fully parsed or saved.

LibreOffice starts immediately during instance creation and reports `loading`
summaries for profile preparation, input startup, application startup, and
document loading. It reports `ready` only after the exact canonical `filePath`
is the active UNO component and its process owns a visible window. When
`filePath` is omitted, a visible Start Center and callable UNO Desktop suffice.
The ready
details include `application: libreoffice` and the same loopback port inside
its generic control object as `instance.resources.control`. Raw UNO has no independent RemoteXApp authentication
and is intentionally not routed to browsers.

Firefox ESR reports `loading` before its shared profile, private input stack,
Matchbox, and browser are ready. It reports `ready` only after the launched PID
owns a visible Firefox window and its loopback WebDriver BiDi endpoint answers
a valid `session.status` command. Status details contain one bounded generic
control object whose address/port must match `instance.resources.control` and
whose endpoint map owns the WebSocket URL. It then reports
`exited` or `error` when that process finishes. Its normal vacancy action is
`stop-instance`, so clean close or six detached hours removes the runtime while
preserving the shared profile.

Mousepad now accepts optional `filePath` under MPD-001. Its process/window
readiness remains weaker than LibreOffice's authoritative UNO document check.

## Private connection metadata (CONN-001)

Current core helpers initialize `connection-schema.json` and
`connection-status.json` beside the public status. These are private mode-0600
runtime files, not API routes. `session_status_report` reports the actual
session D-Bus environment before the corresponding public report. The protected
connection reader requires matching ready generation/revision snapshots and a
live canonical process in the expected session cgroup.

Templates may declare `session.status.privateDetails.application` as bounded
`json` (same bounds syntax as public JSON details). Drivers supply it through
`session_status_report --connection-application '{"protocol":"dbus",...}'`.
A private application descriptor and public `details.control` cannot both be
declared. No application-specific branch is added to Manager or SDK.
Private metadata never enters the public status file. See
[Agent connections](agent-connections.md) for authentication, API and SDK use.

Full XFCE reports `loading` before its private input stack/desktop startup,
`ready` after the window manager and exactly one session Clipman pass their
readiness gates, `exited` when `startxfce4` returns zero after an orderly
Logout, and `error` for a non-zero exit. The cgroup observer therefore maps a
real Logout to `sessionState: stopped` without an instance error. The existing
RFB client stays attached to the persistent display; disconnect/reconnect
starts the next generation. Immediate auto-restart is intentionally avoided
because it would make Logout ineffective and could create a restart loop.

The reusable structure and copyable App Package skeleton are documented in
[`../drivers/README.md`](../drivers/README.md) and
[`../examples/app-package/`](../examples/app-package/).

## Deployment

Build all three backend binaries:

```sh
make backend-build
```

Start the manager with the helper path when it is not available at the default
`./remotexapp-status` location:

```sh
remotexappd \
  -status-bin /absolute/path/to/remotexapp-status \
  ...
```

Template configuration is loaded at manager startup. Template status changes
therefore require a restart.
