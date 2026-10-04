# Host application integration: runtime Coordinator and idle leases

This guide covers IDL-001–004, RTC-001–004 and RTC-007. The optional
Coordinator is shipped in SDK 0.29.1; use the release-matched SDK from your
Manager and check its capabilities. No particular host application's
implementation, acceptance or deployment is implied.

## 1. Target architecture: shared coordination, independent Viewers

**One Manager and one Coordinator per host application login/server in each browser Tab.
One owned runtime handle per window or background task. One Client per Viewer.**

Tabs have separate JavaScript objects. Their Coordinators cooperate through
BroadcastChannel; they do not share one literal object. Multiple handles may
refer to the same runtime/generation. Releasing one never releases the others.

| Component | Responsibility | Must not own |
| --- | --- | --- |
| host application integration service, per Tab/login | Manager, Coordinator, owned window/task handles, cleanup, user policy | New global clipboard/focus state |
| `RemoteXAppManager` | Authenticated HTTP operations, create/start/stop/upgrade, control descriptors/actions | RFB Viewer or implicit keepalive |
| `RemoteXAppCoordinator` | Shared lifecycle polling, generation-bound interests, optional idle renewal, diagnostics | Launching/reviving Apps, RFB/input, clipboard, audio |
| Window/task handle | One owner's observation and explicit keepalive intention | Exclusive ownership of a shared App |
| `RemoteXAppClient` | One Viewer's RFB, reconnect, IME, clipboard, resize and connection mask | Other windows' interests |

Current scope is **one RemoteXApp server**. Multi-server orchestration, reliable
external/background ownership and shared audio are pending RTC-005/006 and
AUD-001; do not implement placeholders that claim those guarantees.

## 2. Compatibility and dependency lock

- Retain the existing same-origin authenticated proxy and base path. Import
  the stable SDK entry from that prefix, not copied source or hard-coded asset
  filenames. All classes in one integration must come from the same SDK module.
- The host application owns its exact provider/SDK lock. Record version, commit, archive SHA-256,
  SDK asset graph/hash and required capabilities using the existing lock process.
  Use the formal tuple below and [publication evidence](private-history.md).
  Local RC.3 pairing remains described by the [candidate deployment evidence](private-history.md);
  its base commit alone does **not** identify the uncommitted candidate bytes.
- Check `/api/version` advertises `capabilities.idleLease === true` and the SDK
  exports `RemoteXAppCoordinator`. `getDiagnostics()` is available in SDK 0.29.1.
  If unavailable, keep the existing standalone path and visibly disable the new
  keepalive option. Do not pretend that polling or WebSocket Ping is a lease.
- No App Package/driver changes are required. Keep each App's effective pinned
  idle policy and existing launch parameters/control descriptors.
- Reload the host application document after an SDK lock update. Already-imported modules
  do not update when the Manager is redeployed.

Record your selected Core version, SDK version, full source commit, archive
SHA-256 and SDK asset identity in the host application's dependency lock.
Verify them from the downloaded release and `/api/version`; do not substitute
a historical example tuple for the artifact you actually deploy.

Example initialization (replace `/remotexapp` with the configured proxy prefix):

```js
const sdk = await import('/remotexapp/sdk/index.js');
const manager = new sdk.RemoteXAppManager({ baseURL: '/remotexapp' });
const version = await manager.getVersion();
if (!version.capabilities?.idleLease || !sdk.RemoteXAppCoordinator) {
  throw new Error('Runtime keepalive is unavailable; use the standalone adapter');
}
const coordinator = new sdk.RemoteXAppCoordinator({
  manager,
  scope: loginEpoch, // Non-secret; identical across Tabs of this login.
});
```

`loginEpoch` is supplied by the host application, stable for the current login and different
after logout/account change. Do not create a different random value per Tab,
use one global value for all accounts, or use a bearer token/cookie as the scope.
The namespace also includes the normalized Manager URL **including base path**.
Scope is coordination isolation, **not authorization**; Manager authentication
and logout credential revocation still apply.

## 3. Recommended incremental migration

### Phase A — add host-owned interests without replacing existing Viewers

Put Coordinator behind a host application feature flag. Keep current App allocation,
Viewer creation and input/clipboard behavior. After the App session is running,
fetch fresh status and acquire a separate handle for the window:

```js
// Run inside the window's existing cancellable startup flow.
// windowLifetime is an AbortController aborted by close/logout.
const current = await manager.getInstance(client.instanceId, {
  signal: windowLifetime.signal,
});
windowLifetime.signal.throwIfAborted();
if (current.sessionState !== 'running' || current.sessionGeneration < 1) {
  throw new Error('Wait for the current App session to start before tracking');
}
const handle = coordinator.track(current.id, {
  sessionGeneration: current.sessionGeneration,
  keepAlive: keepRunningWhileDisconnected, // Explicit user/product choice; default false.
});
const release = () => handle.release();
windowLifetime.signal.addEventListener('abort', release, { once: true });
try {
  await handle.ready;
  windowLifetime.signal.throwIfAborted();
  if (handle.state !== 'tracking') throw new Error('Runtime interest ended');
} catch (error) {
  windowLifetime.signal.removeEventListener('abort', release);
  handle.release();
  throw error;
}
// Store this handle with the window. Close/logout must abort windowLifetime.
// On a keepalive toggle: handle.setKeepAlive(enabled), only while tracking.
```

Attach `statechange`, `leasechange`, and `invalidated` listeners to the handle
as part of that window's setup; remove them during teardown. Listen to
Coordinator `error` once per Tab, not once per render. Register listeners before
awaiting `ready`, and read `handle.state`, `instance` and `lease` afterward to
cover events that occurred during startup.

`ready` confirms the initial valid status, **not a successful lease renewal or
painted Viewer frame**. Show “requesting keepalive” until `leasechange` confirms
the grant. Creation/launch still uses the existing App-readiness flow.

In Phase A the existing Client continues its own instance polling. Coordinator
deduplicates its own work, but this phase does **not** remove all Viewer polls.
Do not additionally call `client.startIdleLease()` or run custom renewal timers:
that would create a second owner. On an unbound Client, `startIdleLease()` uses
a local-only Coordinator and is not the recommended cross-Tab host application adapter.

### Phase B — bind new Viewers to handles for shared lifecycle monitoring

For an **already-running** generation, construct the replacement/new Viewer
with the owned handle and the same Manager:

```js
const viewer = new sdk.RemoteXAppClient({
  runtime: handle,
  container: remoteContainer,
  resize: 'class',
  autoReconnect: true,
  connectionMask: true,
});
await viewer.connect();
// Reapply the existing per-Viewer clipboard, resize and reconnect options.
// When the window closes: viewer.destroy(); handle.release();
```

Do not mutate `client.runtime`, `coordinator.jobs`, or other internal fields.
There is no public in-place bind/rebind API. If replacing a Client, dispose its
existing prompt controller/listeners, destroy it before reusing the container,
and restore that window's settings. Account for a brief display disconnect.
Alternatively keep the safe Phase A integration for existing windows.

Bound Clients use shared lifecycle monitoring; their display/input, cursor,
clipboard and optional diagnostics traffic remains per Viewer.

### Important: on-attach XFCE and generation changes

A dormant XFCE runtime can have generation **0**, or a stopped previous
session. A lease never launches it. Let the existing standalone Viewer attach
and activate the session; wait for fresh status showing the new running
generation, then track it. `connect()` indicates transport connection, not
completion of session startup. Use the existing readiness flow before the GET.

Binding a Viewer to generation 0 before activation can invalidate its handle
as soon as activation increments the generation. Omitting `sessionGeneration`
does not fix this: it binds once to the first observed generation. Do not
silently transfer a stopped/restarted generation's interest to its replacement.

## 4. Window and task lifecycle rules

| host application event | Required behavior |
| --- | --- |
| Minimize, switch windows, hide browser Tab | Retain its explicit handle; focus is not ownership |
| RFB disconnect / reconnect exhausted | Retain keepalive if the window/task still wants it; no guaranteed recovery |
| Disable “Keep running” | `handle.setKeepAlive(false)`; observation remains; other owners can still renew |
| Close a window | Destroy its Viewer/prompt controller, abort startup, release only its handle |
| Close one of two windows on the same runtime | Other handle stays valid; no implicit `stopInstance()` |
| Agent task continues after window closes | Task acquires its **own** handle; release on task completion/cancellation |
| Explicit “Stop App” | Use existing authorized Manager stop action; it affects all viewers and overrides leases |
| Natural exit, logout from remote desktop, generation change | Mark interest ended; bound Client disconnects; no automatic relaunch |
| Explicit restart / upgrade | Retire old handles/Viewers, perform the existing Manager operation, await new running generation, explicitly reacquire |
| host application logout / account switch | Cancel pending startups, destroy Viewers and Coordinator in every participating Tab; revoke normal auth and rotate scope |

For a bound Client, do not rely on `client.upgradeAndRestart()` automatically
rebinding its old handle. Use the Manager-level restart/upgrade flow and create
a new handle/Viewer for the resulting generation. A failed mutation may have
already changed state: read status before retrying, never blindly repeat it.

`viewer.destroy()` does **not** release a host-supplied `runtime:handle`.
Conversely, releasing a still-valid handle while its bound Viewer survives
returns that Viewer to standalone monitoring; it does not disconnect it. On
actual close, destroy the Viewer **and** release its handle. Keep independent
handles even when two windows share the same runtime ID.

Keepalive defaults off. Suggested initial policy: opt-in for shared Desktop,
Firefox, Edge and LightView windows; off for disposable document editors unless
the user or a specific workflow requests it. Closing an editor with an existing
“stop instance immediately” policy remains a separate explicit stop action;
releasing a handle is **not** a replacement for that policy. Do not promise six
hours universally: use each runtime's effective `idleTimeout` and `idleAction`.

## 5. Lease outcomes, failures and browser limits

- `renewed`: no Viewer attached; `expiresAt` is the current server deadline.
- `attached`: an attached Viewer prevents idle cleanup; no timed lease deadline.
- `kept`: the App's keep policy requires no idle deadline.
- Last release stops future renewal, but leaves the last grant in effect.
  Expiry applies the pinned idle action; it does not add a second grace period.
- 401/403/404 and non-busy 409 invalidate ownership. Transient failures and busy
  conflicts retry with bounded scheduling; show uncertainty, not “guaranteed alive”.
- Server stop/exit/shutdown policy wins over any lease. Generation 0 renewal is
  legal for dormant on-attach sessions but does not start or revive anything.
- Across matching Tabs, heartbeat is 2 seconds, leader eligibility ends after
  6 seconds without presence, and silent interests are retained for 5 minutes.
  An awake participating Tab can take over. A diagnostics-only empty Tab is
  not a substitute for an owner. Short idle timeouts may expire before takeover.
- If **all** Tabs freeze/close, or network/auth fails, the App may expire. A
  crashed Tab is indistinguishable from a frozen Tab until retention expires.
  Surviving Tabs may therefore temporarily retain a crashed Tab's interest.
- `mode === 'local'` means cross-Tab sharing is unavailable. Do not label it
  “cross-Tab protected”. Unload/pagehide delivery is not reliable, and pagehide
  may mean bfcache: do not equate visibility/pagehide with permanent release.

Cross-Tab logout signalling is the host application's responsibility; Coordinator is not an
authentication/logout bus. A new scope isolates new claims but cannot stop an
old Tab that retains valid credentials. Do not broadcast secrets, App control
descriptors or clipboard payloads to implement ownership.

## 6. Diagnostics and unchanged integration contracts

Use `coordinator.getDiagnostics()` for an optional host application debug panel: mode,
current owner/server/scope, observed peers, runtime/generation, local/remote
interest counts, leader, latest lease and next **local** renewal, last 100 events.
It is read-only, page-local and not a durable/global inventory. Label expiry as
server time; do not compare clocks to infer precise remaining lifetime. Refresh
the debug panel only while visible and remove its UI timer when closed.

The RemoteXApp Console/kiosk **Coordinator** panel is a provider reference, not
a public embeddable panel export. The host application should consume the public SDK snapshot.

Do not change Viewer-local IME, focus, clipboard prompts/fingerprints or
echo-suppression. Existing `getConnections()`, `invokeAction('openUrl', ...)`,
BiDi/CDP/UNO and trusted-local-agent control remain separate Manager/App flows.
Coordinator lifecycle snapshots deliberately omit full App details, paths and
control descriptors; retrieve those through their existing explicit APIs.

## 7. Host application delivery and acceptance checklist

1. Create an independent host application task/branch, update its exact dependency lock and
   feature flag; record candidate pairing without claiming formal publication.
2. Add one Tab/login-scoped integration service and window/task-owned handles.
   Audit close/logout/cancellation, React/Vue remounts and failed startup for leaks.
3. Implement Phase A first; migrate new/already-running Viewer construction in
   Phase B only after lifecycle acceptance. Test cold on-attach XFCE separately.
4. Verify the following in the rendered host application, not just the provider Console:

| Scenario | Required evidence |
| --- | --- |
| Default off, observe-only handle | No lease renewal; previous idle behavior preserved |
| One disconnected Viewer with keepalive | Survives beyond actual template timeout; panel shows receipts |
| Disable last keepalive | No new renewal; previously granted expiry still applies |
| Two windows / two Tabs sharing one runtime | Independent release; one normal polling/renewal leader; brief handoff duplicates allowed |
| Leader close/freeze, all Tabs frozen, later resume | Takeover where possible; honest expiry when impossible; no resurrection |
| Cold XFCE attach; natural exit/logoff | Correct running-generation acquisition; exit invalidates ownership |
| Manager restart, runtime restart/upgrade | Adoption preserves a live generation; replacement invalidates old handles; explicit reacquisition |
| Auth loss, missing runtime, stale generation, network failure | Correct invalidation/retry UI without hidden relaunch |
| Close/logout during startup or renewal, repeated mount/unmount | No late new handle, duplicate controller, leaked timer or retry loop |
| Desktop/browser/editor workflows | No regression in IME, password raw keys, clipboard focus/echo suppression, openUrl/control info |
| Old provider, wrong SDK, local-mode fallback | Disabled/clear fallback, never an unsupported keepalive promise |

Provider evidence and repeatable commands: [idle-lease tests](../tests/idle-lease/README.md),
[RC.2 lifecycle qualification](private-history.md),
[RC.3 deployed panel checks](private-history.md).
These do not substitute for host application acceptance. RemoteXApp owns provider tests and
GitHub publication; host application owns its adapter and lock; the sandbox project owns
sandbox deployment. This handoff authorizes no sandbox operations.

## 8. Rollback

Disable the host application integration feature flag, cancel pending acquisitions and
release host-owned handles/destroy Coordinators in all participating Tabs.
Retain or recreate ordinary standalone Clients as appropriate. Outstanding
grants expire under the existing App policy; do not stop Apps or delete profiles
as a migration rollback. Revert the host application lock/code together if reverting the
provider, reload browser documents, and retest standalone launch/input/clipboard.
No server state-schema or App Package migration is introduced by Coordinator.
