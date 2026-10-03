# Graceful application shutdown

Status: deployed; automated regression, isolated live-application acceptance,
and production hardened-service validation passed. Human visual UAT remains
pending.
This contract covers user-driven application exit, desktop logout, idle cleanup,
API stop, managed desired-state stop, and forced termination.

## Lifecycle rule

A driver-confirmed clean exit is an early idle transition. The manager applies
the existing `idleAction` immediately instead of waiting for the final browser
disconnect and `idleTimeout`:

| `idleAction` | Clean exit result |
| --- | --- |
| `stop-instance` | Stop the whole runtime and remove ephemeral state |
| `stop-session` | Retain VNC, gateway, runtime identity, and profile |
| `keep` | Retain the server layer with the already-stopped session |

The SDK emits `sessionended`, deliberately disconnects, and does not reconnect
automatically. A later attachment launches a new session generation. An
unexpected empty session cgroup remains `failed` and never uses the clean-exit
path.

## Manager-initiated shutdown

When idle cleanup, the API, managed desired state, or managed fault recovery
initiates a stop, the manager first executes the version-pinned template
`session.shutdownDriver`.
The hook receives the session environment plus:

```text
REMOTEXAPP_SHUTDOWN_REASON
REMOTEXAPP_SHUTDOWN_SCOPE       # session or instance
REMOTEXAPP_SHUTDOWN_GRACE_SECONDS
REMOTEXAPP_SHUTDOWN_PID
```

Exit `0` means the template-specific shutdown contract completed. Exit `10`
means a user decision, normally an unsaved-document prompt, blocks shutdown. A
timeout or any other failure is also fail-safe: the application session stays
alive. The hook process is bounded independently and cannot block the manager.

Shipped Mousepad and Edge hooks send Alt+F4 to visible application windows and
wait for the application process. This follows the native close path without
destroying hidden toolkit windows. The XFCE hook requests a normal session
logout over its configured D-Bus (private or reused user bus).

The temporary LibreOffice template is an explicit exception: its dedicated
hook sends `SIGKILL` to the pinned application PID, verifies document-lock
cleanup, and returns success without showing save UI. Unsaved changes are
discarded unless a trusted UNO caller saved them before stop. It never claims
that the document was saved. This policy prevents an unattended temporary
document runtime from remaining blocked indefinitely.

## Blocked state and force

A blocked request sets `sessionState: shutdown-blocked` and publishes a
`shutdown` object containing request ID, generation, reason, scope, timestamps,
message, and force state. A new attachment cancels the pending cleanup and lets
the user resolve the application prompt. Late warning/force timers are
generation- and request-qualified. The unified runtime manifest records the
blocked state durably. Manager restart adopts a healthy blocked session,
reinstalls the session observer and host warning/force deadlines, and preserves
the application process. A later user attachment cancels the pending cleanup as
usual. If another adoption health check fails while the exact application PID
is still alive, the manager preserves the session for normal graceful host
policy. Only a runtime without a live application is automatically rebuilt from
its locked snapshot.

The host administrator owns policy:

```text
REMOTEXAPP_SHUTDOWN_GRACE_TIMEOUT=15s
REMOTEXAPP_SHUTDOWN_BLOCKED_WARNING_AFTER=1h
REMOTEXAPP_SHUTDOWN_FORCE_AFTER=0
```

Zero force-after means never destroy work automatically. Warning expiry writes
an operator journal message; monitoring must collect it. A nonzero force-after
is appropriate only on a host where its data-loss consequence is accepted.
Effective values are returned by `GET /api/version`.

An authenticated control-plane caller can explicitly force a temporary stop:

```http
POST /api/instances/{id}/stop
Content-Type: application/json

{"force":true}
```

For managed state:

```http
PATCH /api/managed-instances/{id}
Content-Type: application/json

{"desiredState":"stopped","force":true}
```

Normal blocked stops return `409 Conflict`. Force skips the application hook,
stops the complete systemd cgroup, and records `forced: true`. The current
authentication model has no separate operator role: every identity authorized
for control-plane mutation can request force. Never expose `auth-mode=none` on
a public or untrusted network.

For a managed runtime, the caller may first request a normal desired stop and
later repeat the same desired state with `force: true`. The second request must
override the durable `shutdown-blocked` state and converge the managed record
to `observedState: stopped`; it must not restart the graceful hook or wait for a
new state transition.

## Driver contract and compatibility

`shutdownDriver` is resolved to an immutable canonical path with the session
driver and is included in the applied template snapshot. Adding or changing it
requires a driver-version bump. Templates without a hook retain the former
best-effort systemd stop path for old-runtime compatibility; they must not be
described as application-aware graceful shutdown.

Verification must cover completed, blocked, timeout, cancellation by attach,
explicit force, host force deadline, blocked-session restart adoption, clean-exit early idle
action, unexpected crash classification, browser terminal behavior, and real
unsaved-document UAT.

The `0.1.0-rc.5` isolated gate covers this matrix in
[`graceful-shutdown-rc5.json`](../tests/go-live-validation/results/graceful-shutdown-rc5.json).
It also verifies that persistent/mounted document paths survive teardown;
ephemeral workspace HOME content is intentionally removed by `stop-instance`.

Production rc.5 validation exposed a deployment-only namespace issue: its
session bus used `/tmp`, which is not shared with a manager using
`PrivateTmp=yes`. Driver 1.2 in rc.6 places the private bus at
`REMOTEXAPP_SOCKET_RUNTIME/session-bus.sock`. The exact hardened-service
regression is recorded in
[`graceful-shutdown-rc6-private-tmp.json`](../tests/go-live-validation/results/graceful-shutdown-rc6-private-tmp.json).

As of rc.23 the manager intentionally shares the host mount namespace so it can
perform EXP-007's validated same-UID procfs read. Session IPC remains under the
per-runtime `/run/user/<uid>` directory; this placement is still required for
stable, private addresses and version-pinned shutdown hooks.
