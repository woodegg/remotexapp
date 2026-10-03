# Runtime upgrade API — SDK 0.24.0

Requires Core `0.7.0` (including its release candidate) or later.

Ordinary `restartInstance()` keeps the runtime's locked App and core components.
`upgradeAndRestartInstance()` applies the current Manager's locally selected
release. Neither operation downloads a release or edits an App selector.
An App-only or core-only change can be an update. Downgrades are rejected.

## Inspect, confirm, apply

```js
const current = await manager.getInstance(instanceId);
const { versions, upgrade } = await manager.getRuntimeVersions(instanceId);
// Display current core/App, available core/App and the shutdown warning.
if (!versions.eligible) throw new Error(versions.reason);
const applied = await manager.upgradeAndRestartInstance(instanceId, {
  sessionGeneration: current.sessionGeneration,
  targetRevision: versions.targetRevision,
  force: false, // true explicitly discards unsaved work
  signal: abortController.signal,
});
```

GET `/api/instances/{id}/upgrade-and-restart` returns `{versions, upgrade}`.
POST to the same path accepts the options above, except `signal`, and returns
the public instance. Public instance responses also include `versions` and the
latest `upgrade`. Version records contain `core: {version, commit, sha256}` and
`app: {id, version, sha256}`. Missing core identity is null/unknown, not current.
Available means selected locally, not newest on GitHub. The opaque targetRevision
binds the selected release and policy; never construct it from a version string.

POST preserves the ID, managed association, launch parameters and persistent
HOME. Ephemeral HOME and unsaved data are discarded. Generation increases and
connection descriptors become stale; control ports may change. The completion
boundary is server-ready. An on-attach application still needs a Viewer to start.

Core session-services stability update: ordinary `/restart` also reserves a
newer generation before on-attach activation. Generations may have gaps; use
the returned/current value, never calculate `old + 1`. Repeating a successful
request with its old generation returns 409 before any further teardown.

## Bound Viewer

```js
const { versions } = await client.manager.getRuntimeVersions(client.instanceId);
// After explicit user confirmation:
await client.upgradeAndRestart({ targetRevision: versions.targetRevision });
```

The bound Client uses its current instance generation by default, suspends
automatic reconnect, clears old input/clipboard offers, calls the Manager once,
and connects to the returned runtime. Successful completion restores its clipboard
configuration. Explicit disconnect/destroy while waiting prevents a late reconnect.
The `<remote-x-app>` element forwards `upgradeAndRestart(options)` to its Client.
Unbound Manager callers coordinate their own Viewers. Trusted local Agents refetch
protected `getConnections()` with the new generation; never expose their token
to the Viewer or put private D-Bus addresses into public state.

## Failure and recovery

- Malformed options: HTTP 400. Stale generation/target, unavailable or incompatible
  target, or concurrent lifecycle operation: HTTP 409, without stopping the app.
- Shutdown veto: HTTP 409, `code: "shutdown-blocked"`, upgrade phase `blocked`.
  A separately confirmed force request may reuse the guarded target/generation.
- Scoped cleanup or launch failure: HTTP 409, `cleanup-failed` or `launch-failed`;
  phase `failed`. Inspect the actual runtime and correct the cause before retry.
- Frozen package/component identity changed during recovery: `target-invalid`.
  Do not substitute another package or claim rollback of modified persistent data.
- Durable record write failure: HTTP 500, `record-failed`. The transition may
  already have acted; inspect status/storage health before deciding what to do.
  A stale request never inherits an earlier operation's shutdown-veto error code.

`upgrade` contains `{id, phase, targetRevision, errorCode?, message?, updatedAt}`.
Phases are `stopping`, `launching`, `completed`, `blocked`, `failed` and are durable
in the private runtime manifest. Interrupted pending transitions resume against
the frozen target; already launched targets are adopted without launching twice.
Blocked/failed transitions do not implicitly retry through managed reconciliation.
If the old session survives a failed startup transition, its exit observation
and host shutdown/vacancy policy are restored rather than leaving it unmanaged.

Abort or a network error cancels the caller's wait, not an accepted server
transition. Never blindly resubmit POST. Inspect GET/instance status first; the
SDK stays disconnected on ambiguous errors. The usual host shutdown enforcement
policy still applies. Ordinary restart cannot bypass an unresolved upgrade.

Rollback is an operator workflow, not a failed-upgrade fallback. Older Managers
may reject manifests containing the new upgrade/identity fields. Do not switch
to an older Manager while new-format runtime records remain; stop the affected
runtimes with the current Manager first, preserving any persistent data.

See [locked scope and acceptance](runtime-upgrade-release.md).
