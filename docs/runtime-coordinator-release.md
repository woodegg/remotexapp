# Runtime idle lease and SDK Coordinator

Status: human UAT accepted 2026-09-18 for Core **0.13.0-rc.3 / SDK 0.29.1**;
formal **0.13.0 / SDK 0.29.1** published, with no functional
changes. Local 1991/2992 subsequently selected stable; see the separate
[deployment evidence and exceptions](../tests/evidence/v1/runtime-coordinator-0.13.0-local-deployment.json).
App versions unchanged. RC.3 added the panel without overwriting RC.2.
RC.2 supersedes the local RC.1 candidate with fresh Driver-status validation;
already staged RC.1 artifacts are not overwritten.
Publication verification passed; the train is closed. See
[publication evidence](../tests/evidence/v1/runtime-coordinator-0.13.0-publication.json).
Requirements: IDL-001–004,
RTC-001–004 and RTC-007 in
[the register](requirements.md#runtime-idle-lease-and-sdk-coordinator--planned-2026-09-18).
Future work: [release pending](release-pending.md).
Downstream handoff: [WAOS migration guide](waos-runtime-coordinator-migration.md).

## Purpose and scope

### Coordinator inspection panel (RTC-007 follow-up)

The operator approved this additional scope on 2026-09-18. Console and kiosk
provide a **Coordinator** button opening a non-modal, read-only panel. It shows
mode/server/scope/current Tab, observed peers, runtime generation, local/remote
handle counts, leader, lifecycle state, latest lease receipt and local renewal
schedule. The newest 100 events include tracking/release/invalidation, leader
changes, lease receipts and local request errors (status only, no raw payload).

`coordinator.getDiagnostics()` returns a cloned snapshot without making a
request or acquiring ownership. Opening the panel never starts keepalive.
UI refresh is one second while open, stops on close/pagehide and resumes on
pageshow if still open. Observations and history are local to this page; this
is not a global inventory, durable audit trail or cross-Tab error aggregator.
Receipt expiry is server time, not a browser-clock guarantee. Silent peer
eligibility and retention are distinct; all Tabs suspended remains best effort.

To test: enable **Keep running while disconnected** for one Viewer, open the
panel, then open that runtime in a second same-origin Tab and enable keepalive
there. Compare leader and interest counts; disconnect a Viewer and observe a
renewed deadline. Release one interest and verify the other remains. Close
the leader Tab and observe takeover. Disable the last interest and verify
renewals stop without an explicit App stop. Opening the panel alone must show
no local handles. This follow-up is deployed as RC.3; RC.2 remains retained
for rollback without the panel.

Keep an existing runtime/App running when its Viewer disconnects or moves to a
background Tab but a caller still explicitly needs it. Add an optional
RemoteXAppCoordinator to share status monitoring and idle-lease renewal across
multiple Viewers and same-origin Tabs. Current WAOS scope is one server.

Keep the existing RemoteXAppManager as the HTTP client and RemoteXAppClient as
the individual Viewer. Coordinator owns runtime observation and keepalive
interests; it does not centralize RFB, IME, clipboard prompts or fingerprints.
CLP-018 remains authoritative. Existing standalone SDK callers retain their
current behavior; automatic keepalive defaults off.

## Existing behavior and implementation boundary

In `cmd/remotexappd/lifecycle.go`, RFB attach cancels vacancy cleanup and last
detach starts the effective timeout. Newly ready stop-instance runtimes also
start a timer before their first Viewer. A WebSocket Ping only keeps transport
active; status GETs do not renew vacancy. Managed runtimes allow keep or
stop-session, not stop-instance. Preserve those distinctions.

Before this train, `scheduleVacancyLocked` replaced timers whose callbacks only
carried an instance ID. An already-fired callback could survive replacement.
The new implementation guards callbacks with timer/runtime identity, generation
and the current deadline under lifecycle synchronization. A deterministic
queued-callback test reproduces this risk; no prior production outage is claimed.

## Idle lease semantics

- Add an ordinary Manager-authenticated POST renewal operation at
  `/api/instances/{id}/idle-lease`, with required matching nonnegative
  `sessionGeneration`. Generation zero is valid for a never-started on-attach
  session, but renewal must never start it.
- Use the runtime's effective pinned `idleTimeout`; accept no client-selected
  TTL, template replacement or implicit override.
- While no Viewer is attached, successful renewal moves the idle deadline to
  server acceptance time plus the effective timeout. Expiration runs the
  existing idle action directly, without adding a second grace period.
- An attached Viewer still prevents vacancy. Renewal while attached reports
  that outcome without manufacturing a client count or promising a shutdown
  deadline; last detach grants the existing full timeout. Keep policy is an
  explicit no-op outcome. Return server time, identity, policy and a nullable
  idle deadline so callers do not mistake attachment for a timed lease.
- Missing runtime returns not-found; stale generation, stopped/failed App
  (except never-started on-attach), shutdown-blocked or an incompatible
  stop/restart/upgrade transition rejects renewal. Do not automatically fetch a
  new generation and resume old interest after such a conflict.
- Explicit stop, managed desiredState, natural App exit/logout and existing
  host shutdown enforcement retain priority. Keepalive is not recovery and
  cannot cancel an already-started shutdown.
- Renewal and timeout handling have one serialized decision point. A request
  not acknowledged before shutdown wins no guarantee; never revive afterward.
  Late old callbacks must not close a renewed or replaced runtime.
- Ordinary status reads, clipboard activity and future shared audio do not
  implicitly extend idle deadlines.
- Preserve current same-boot Manager adoption: clear attachment counts and
  grant its existing fresh vacancy timeout. Client claims are not durable
  runtime manifest state. A Manager outage cannot guarantee an exact expiry;
  runtime restart/upgrade invalidates old generation claims.

## SDK and ownership

Provide one-shot renewal through Manager and a bound Client convenience method.
Coordinator adds opt-in automatic renewal and shared observation. A caller
tracks a runtime with an explicit keepAlive setting and receives an owned
handle. Observe-only handles never extend runtime life.

Multiple handles may refer to one runtime. Any valid keepalive interest allows
renewal; releasing a handle removes only that interest. Last release stops
future renewals, leaves the already-granted deadline intact and does not call
stopInstance. Viewer disconnect or exhausted reconnect attempts do not release
an independently held interest. Viewer destruction releases Viewer-owned
interests only; an explicit host-owned handle survives until its owner releases
it. Coordinator destruction releases only its local ownership, never another
Tab's interests. Cancel timers and ignore late responses after release.

Renewal cadence follows server timeout metadata with margin before expiry;
do not hard-code 30 seconds for templates that allow a one-second timeout.
Bound concurrent requests/backoff and expose failures and current expiry.
Resume/pageshow can trigger immediate revalidation, but cannot revive an
expired App. Renew at timeout/3, capped at five minutes; subtract measured
request latency and floor the next scheduling delay at 100 ms. Poll status
every two seconds, with one in-flight request per runtime/generation and a
five-second request deadline. Transient renewal errors retry after one second;
401/403/404 and non-busy 409 invalidate the interest. Very short timeouts cannot
guarantee survival of network delays or cross-Tab failover.

## Cross-Tab coordination

Use a logical coordination scope for the same application login, origin and
storage partition. Key every record by server identity (including full base
path and login scope), runtime ID and generation even though only one server
is implemented in this train. Logout clears that scope. Do not put credentials,
clipboard content, private descriptors or audio packets on the shared channel.

Prefer shared status/renewal work but allow transient duplicate safe requests
during handoff. A frozen leader must not prevent an awake eligible Tab from
renewing. Never treat a distributed reference count alone as authority: use
unique owner/interest identities, idempotent release and bounded stale records.
Do not depend on unload delivery or infer release merely from hidden state or
RFB failure. Browser capability fallback must be explicit and tested.

A crashed Tab and an indefinitely frozen Tab cannot be reliably distinguished
by a missed heartbeat. Retain peer interests for five minutes after the last
presence snapshot; heartbeat every two seconds and cease considering an owner
for leadership after six seconds. An awake participating Tab may renew retained
interests. After five minutes, forget them; the last granted server deadline
still stands. Expiry may end frozen-Tab protection, while retaining stale
interests forever leaks runtime resources. BroadcastChannel absence/failure
is exposed as local mode. Limit each coordinator to 128 local handles, 128
scheduled runtime/generation jobs and 64 peers. This release promises best-effort
browser keepalive, not survival of indefinite suspension. Reliable external
ownership is RTC-006 pending work. No silent escalation to permanent keep.

Browser references:
[page freezing](https://developer.chrome.com/docs/web-platform/page-lifecycle-api),
[BroadcastChannel scope](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API).

## Future boundary

The same Coordinator can later contain multiple server entries. Each server
owns its runtime registry and optional shared audio controller. Audio belongs
to the server/user environment, not a runtime or generation. This train adds
no audio connection, permission flow, worker, microphone selection or
multi-server orchestration. The proposed audio source tray remains separate
and unapproved for implementation; AUD-001 records its future coordination
requirements without importing that source or changing its status.

## Acceptance and migration plan

Required before acceptance, with results recorded against exact artifacts:

1. API/unit/race: auth, generation zero/stale/terminal, keep/stop-session/
   stop-instance, effective overrides, attached/detached state, response loss,
   queued old callback, concurrent renewal/expiry/stop/restart/upgrade.
2. SDK: opt-in/off, observation without keepalive, independent RFB lifecycle,
   bounded retry, release/destroy, stale response, old SDK standalone behavior,
   coordinated/standalone coexistence and login/base-path isolation.
3. Real browser: two Tabs using one runtime, one closes/crashes/freezes, leader
   suspension/takeover, last release, all Tabs frozen, wake after expiry,
   repeated registration and cleanup. Record observed guarantees and limits.
4. App lifecycle: cover every shipped template using shortened test policy
   where needed; prove no-viewer renewals preserve a live App, expiry applies
   its policy, on-attach stays unstarted until attach, exit/logout wins and
   managed state/shutdown-blocked behavior remains intact.
5. Recovery: Manager restart adoption, App restart and upgrade with generation
   change, service failure, existing Viewer input/IME/clipboard behavior and
   bounded timer/claim/request resource use.
6. Document single-server WAOS integration and rollback to existing SDK use.
   Removing Coordinator stops renewal without changing profiles or explicitly
   stopping Apps. WAOS repository changes are a separate integration task.

Run normal repository and exact-release gates after implementation. Any local
UAT deployment uses loopback; sandbox deployment belongs to the sandbox
project. The operator authorized local development/deployment, not publication.

## Locked public SDK and wire contract

`RemoteXAppManager.renewIdleLease(id, {sessionGeneration, signal})` returns
`{instanceId, sessionGeneration, outcome, idleAction, idleTimeoutMs, serverTime,
expiresAt}`. Outcome is renewed, attached or kept; only renewed has an expiry.
Errors include machine-readable code: invalid-request, instance-not-found,
busy, stale-generation or not-renewable. `/api/version` advertises idleLease.

`new RemoteXAppCoordinator({manager, scope, crossTabs:true})` accepts one server
and a required non-secret login scope. Its `mode` reports cross-tab or local.
`track(id, {sessionGeneration, keepAlive:false})` returns a handle with `ready`,
content-free `instance`, `lease`, `state`, `setKeepAlive()`, `renewIdleLease()`
and idempotent `release()`. Omitted generation binds once to the initial GET;
later generation changes invalidate the handle. Handle events are statechange,
leasechange, invalidated and release; coordinator additionally emits error.

`new RemoteXAppClient({runtime:handle, container})` uses the handle's Manager
and shared status subscription. The host retains ownership of this handle and
releases it explicitly. Existing standalone clients can call renewIdleLease(),
startIdleLease() and stopIdleLease(). startIdleLease owns a local automatic
interest; disconnect keeps it, destroy releases it. No constructor auto-enable
or permanent keep policy is introduced.

Invalidating a bound handle disconnects its Viewer and emits runtimeinvalidated;
it cannot reconnect against that old handle. Releasing a valid handle instead
returns its surviving Viewer to standalone status monitoring, without stopping
the App. Neither path changes another owner's interest.

Console/kiosk provides an opt-in Keep running checkbox as the built-in UAT
surface. It uses the same shared Coordinator API, reports the lease outcome,
retains interest after Disconnect and releases that window's interest on close.
