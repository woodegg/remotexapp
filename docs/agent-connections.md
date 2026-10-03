# Trusted Local Agent Connection Information

CONN-001, Core 0.6.0-rc.1 / SDK 0.23.0; optional CONN-003 IBus fields require
Core 0.8.0-rc.1 / SDK 0.25.0. This interface describes connections;
it never invokes application commands or proxies a socket.

## Operator configuration

Connection reads use ordinary Manager authentication and same-origin checks.
No dedicated connection token is required. With auth-mode=none, any caller
able to access the Manager can read these sensitive descriptors. Restrict
network access or use an authenticated gateway for shared deployments.
This is Manager-wide access, not per-runtime authorization.

The legacy `-connections-token-file` flag and
`REMOTEXAPP_CONNECTIONS_TOKEN_FILE` are deprecated and ignored so existing
service configurations still start. They no longer provide access protection.
No token files are read; operators may remove obsolete configuration separately.

## API and SDK

`GET /api/instances/{id}/connections?sessionGeneration=N` accepts an optional
expected positive generation. No special request header is needed.
All responses are `Cache-Control: no-store`. Errors: 401 missing Manager identity; 403 rejected origin; 400 invalid generation; 404 unknown
runtime; 409 not ready, stale generation, invalid/unavailable metadata or
canonical-process failure. Normal auth and same-origin checks also apply.

```js
// Uses the same Manager authentication as other SDK calls.
const info = await manager.getConnections(instanceId, {
  sessionGeneration: instance.sessionGeneration,
  signal: abortController.signal,
});
```

SDK validates the envelope, reports API errors, supports cancellation and
does not retain credentials or descriptors. The response contains
`schemaVersion:1`, `instanceId`, `sessionGeneration`, opaque string `revision`,
`state:"ready"`, `environment`, optional `application`, and optional
`unavailable` field names.
The optional `unavailableReasons` map includes IBus reason codes below.

`environment` holds `display`, `xauthorityPath` (never cookie contents), and
optional `sessionBus:{address,scope}`. Scope is `runtime` for a private bus
or `user` for the shared user-home bus. XFCE's user bus may contain services
outside this runtime. Only local filesystem Unix D-Bus sockets are supported.

`environment.ibus:{address,scope:"runtime"}` is optional and distinct from
session D-Bus, including in user-home mode. The shared input helper records
actual launch generation/PID/start time; the Manager validates socket path/UID,
session cgroup and Unix peer credentials before returning only address/scope.
Missing IBus is represented by `unavailable:["ibus"]` (possibly with other
fields) and `unavailableReasons:{ibus:"metadata-missing"|"not-enabled"|"not-running"}`.
Legacy missing launch records mean metadata-missing, not absence of a live daemon.
Malformed/foreign/stale supplied records reject the descriptor with HTTP 409.
Inspection never launches or repairs IBus and availability does not prove text
delivery or permit sendText in password fields.

`application` projects the existing bounded public `details.control` for
CDP, BiDi and UNO, or a template-declared private descriptor for other protocols.
No application object is returned for Mousepad/XFCE. Existing public APIs and
control fields remain unchanged; this interface does not make previously
public control endpoints private.

## Lifecycle and compatibility

The reader checks ready state, canonical process identity/cgroup, current
generation and matching public/private status revisions. It rereads snapshots
before returning. Opaque revision changes with descriptor contents and survives
Manager adoption. It is not an incrementing counter or a lock on the process.
The Agent must re-fetch after session restart or endpoint/connection failure;
the target can exit immediately after a valid response.

Existing runtimes retain pinned helpers. Missing legacy private metadata is
reported via `unavailable:["sessionBus"]`, rather than guessing an address.
A declared but missing private application may also be unavailable on a legacy
runtime. A present malformed/stale private report rejects the descriptor.
New runtimes use the current helper; do not rewrite live pins to upgrade.

Use protocol-specific adapters in the local Agent. Raw sockets/CDP/BiDi/UNO
are powerful host-local interfaces and must not be reverse-proxied. No Kate or
KWrite App Package is introduced by CONN-001.

## Trusted Console inspection

Core 0.8.0-rc.1 adds **Connection info** on managed and standalone runtime cards.
No-runtime cards do not launch anything. On a trusted loopback or authenticated
HTTPS Console, select Refresh without supplying a separate token. Close, reload
or page teardown clears the descriptor. Only use a trusted page and scripts.
Copy JSON copies the returned descriptor only; copy requires
explicit confirmation and may be denied by the browser. Runtime transitions
invalidate displayed results and disable stale copying. The panel does not
execute protocol commands or proxy sockets. Console-disabled policy is unchanged.
See [scope and acceptance](console-connections-release.md).

## Token-free access amendment — 2026-09-10

This amendment supersedes the original token-entry Console design.
Open Connection info and click Refresh; no password input is shown. Closing
still clears descriptors and cancels pending requests. No control operation is
performed. Local 1991/2992 now run 0.8.0-rc.2 / SDK 0.25.1 without this token.
Other deployments running older binaries still require it.
