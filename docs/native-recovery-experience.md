# Native recovery experience

Issue [#70](https://github.com/woodegg/remotexapp/issues/70) owns this design,
reference implementation and fault qualification. The owner requested a simpler
client contract and actual fault injection on 2026-11-20. This document defines
the implemented development contract; measured qualification is recorded in
[the fault matrix](../tests/kasm-native/RECOVERY-EXPERIENCE.md). It is not human
UAT or release acceptance.
The current low-level APIs remain supported. The liveness and lease corrections
in PRs #66/#69 are prerequisites, not proof that this new experience works.

## Client responsibilities

An embedding host supplies a container, an explicit App target and its existing
login/window lifecycle. The SDK owns the recovery presentation and action flow.
Ordinary hosts do not implement timers, inspect systemd units, combine several
recovery enums, reconstruct restart requests or decide whether processes are safe
to terminate. Custom styling consumes the same public model/actions as the
default panel; it must not introduce a second recovery state machine.

The high-level entry is `host.mount(container, target, options)`. It
owns one window's session and Viewer and returns a stable view binding even
when a connection attempt fails. Existing `host.open()` / `session.attach()`
retain their current contracts, including attach resolving only after readiness
and paint. A high-level view's existence is never a readiness receipt.
This entry is absent from SDK 0.31.0/0.31.1. SDK 0.32.0-dev.1 contains the
development implementation with its matching Core. Human UAT remains separate
from automated qualification. `view.settled` means the first attempt finished, possibly in attention;
only the state/readiness projection establishes a usable attachment.

```js
const host = new RemoteXAppHost({baseURL: '/rx', scope: loginScope});
const view = host.mount(container, {instanceId});
// Default panel handles recovery inside the supplied container.
view.addEventListener('change', () => updateWindowBadge(view.getState()));
// On actual window close; hiding a workspace retains the view.
await view.release();
```

`view` is a `RemoteXAppView`. Read `view.session` / `view.viewer` only when
present; an initial failure may have neither. Handle its `request` event for
`authenticate` and `help` using the host's existing login/operator routes.
Authentication changes dispose the old host and create a new login scope.
For custom presentation use `{panel: false}`, render `getState()`, and call
`run(action.id)`, `confirm(confirmation.id)` or `cancelConfirmation()`.
Do not persist action IDs across snapshots. `closed` and `release()` concern
this window; they do not stop the shared App.

The host still chooses templates/parameters, maps documents through its trusted
backend, explains normal App shutdown and owns authentication. Mounting cannot
make a local browser path a remote file or infer which managed desktop to use.
No recovery operation automatically repeats an uncertain create/openUrl/save.

### Launch response loss and transport retries

Fault injection found that a browser can resend a POST when the connection
closes before response headers, even though the SDK called `fetch` once.
Generation-qualified restart rejects those stale replays. A new launch has no
existing generation, so `host.open({templateId})` now generates one random
`launchIntent` per call and includes it in the create body. The matching Core
reserves a hash of the authenticated principal and intent on disk before launch.
A duplicate returns HTTP 409 `launch-uncertain`, without launching again or
returning an attachment. The view shows uncertainty and offers inspection.
This requires the matching development Core; an older strict API rejects the
new field instead of silently dropping protection. Low-level callers can supply
the same optional field; unkeyed legacy creates retain their existing behavior.

Full Viewer retirement also depends on the native component. Patch 0025 closes
its internal control/display BroadcastChannels and removes window listeners,
which otherwise retain detached
canvases and listeners after `release()`. Use a newly qualified component pin;
an SDK-only update cannot change the old component's cleanup. Existing runtime
pins remain unchanged until the deployment owner performs an explicit upgrade.

Reservations survive Manager restart, contain no request parameters or identity
text, expire after 24 hours and are capped at 8,192 per Manager. Cleanup of
expired reservations occurs on a new keyed request; capacity or storage failure
rejects launch before side effects. This bounds automatic transport replay
protection, not indefinite exactly-once execution. It is not a retry instruction,
result cache or automatic adoption of an uncertain launch. Do not delete this
state directory during an active request. A failed launch also consumes its
intent; a new explicit user launch receives a new intent.

## Ownership and authority

| Layer | Responsibility | Must not do |
| --- | --- | --- |
| Embedding host, including the embedding-host simulator | Window/container lifecycle, explicit launch target, existing login and operator-navigation hooks | Implement retries, guess a replacement target, restart a server to dismiss an error |
| SDK view/recovery controller | One state projection, optional default panel, fresh observations, bounded connection retry, scoped actions and confirmation | Signal processes, bypass server admission, silently restart/rebind across generations |
| Manager | Authorize and serialize lifecycle operations, verify generation/ownership/pins, preserve stop/veto/cooldown, report actual outcome | Treat a client button or advertised action as authorization |
| Operator/deployment owner | Inspect ambiguous ownership, account services and unsupported component repair | Claim Manager restart repairs every degraded helper |

The view owns its window's handle and Viewer; separate background tasks remain
independent. It releases only its own interests. Audio remains separately owned,
with no audio acquisition merely to display recovery. Authentication scope,
server/API path and runtime generation fence all asynchronous completions.

## One model, with truthful detail

`view.getState()` returns a detached, content-free snapshot and `change` publishes
the same projection. Five presentation states are sufficient:

| State | Meaning |
| --- | --- |
| `connecting` | Explicit initial attach is in progress; no usable-frame claim |
| `ready` | Current authorized Viewer has App readiness and a painted frame |
| `recovering` | A bounded connection or explicitly requested recovery operation is active |
| `attention` | User/operator action is needed, or readiness cannot be established |
| `closed` | This window owner was released; no retry or queued action may revive it |

Keep `displayReady`, a stable reason code, optional retry progress, service
warnings and available actions separate. A working picture with failed audio
or unavailable clipboard is not a completely failed App. Deliberately disabled
audio/clipboard and native `unsupported-provider` IBus are not faults. Unknown
or stale observations stay unknown; an old frame or HTTP 200 is not fresh paint.
Raw process IDs, paths, credentials, text and clipboard payloads are excluded.

Display retries continue using the existing reconnect controller; the view does
not add another retry timer. Reuse the host coordinator's runtime observation.
Additional detail reads are bounded and coalesced, triggered by a transition or
explicit action, not continuous per-window polling. They do not renew idle
leases. Losing the observation path does not authorize an App restart.

## Actions and impact

The default panel renders the controller's current actions. Custom UIs dispatch
the same action ID through `view.run(actionId)`; they do not call lower-level
repair APIs themselves. Action IDs are scoped to a snapshot revision and are
not credentials. A stale/duplicate action is rejected or coalesced, never
silently retargeted to the latest generation.

| Action | Scope and admission | Result and limits |
| --- | --- | --- |
| Retry connection | This Viewer; fresh authenticated same-ID/generation/component and running-state check | New grant and frame; no restart, activation or input replay |
| Refresh status | Read-only current runtime/managed projection | May update actions; never grants authority or starts an App |
| Recheck recovery | Eligible desired-running managed runtime; exact observed generation | Existing `retryRecovery` API; accepted scheduling is not successful repair; no budget reset/force |
| Reattach recovered App | Explicit user choice of a verified replacement generation | New handle/Viewer after identity/pin validation; old handles stay invalidated |
| Restart App | Existing restart API admits the target; current identity and explicit confirmation | May close every App window in that runtime and discard unsaved work; never force or upgrade implicitly |
| Sign in / operator help | Existing host callback or content-free diagnostic guidance | No embedded login implementation, arbitrary URL navigation or shell command |

Unavailable actions are omitted with an understandable reason. In particular,
the current restart API accepts `ready`/`server-ready` runtimes; it is not a
universal repair for `failed` or unresolved transitions. A populated/unknown
managed failure remains protected. Current recheck cannot bypass that protection.
An unfinished, blocked or failed upgrade prevents restart; a completed upgrade
history entry alone does not. Confirmation still rechecks current admission.
Component hot repair, borrowed-user-bus restart, and container/host reboot are
not ordinary client actions and are not added by this design.

### Confirmation and uncertain outcomes

Restart first prepares a confirmation bound to the exact instance/generation,
template, component pins and current impact. It describes that other Viewers
of this runtime are affected, saved files are retained and unsaved memory may
be lost. A shutdown hook is not assumed to save documents or veto data loss.
Confirmation is single-use and expires; execution revalidates the target and
uses the original generation. A newer target requires a fresh confirmation.

No generic `recover(force:true)` operation exists. Graceful refusal/409 remains
visible; the standard panel never escalates to force. Disconnect/release/logout
cancels local pending work. Cancellation after an accepted mutation cannot
undo a server operation: report an uncertain outcome, read current state and
never replay restart/create/action automatically. Two Tabs can propose an
operation, but the Manager remains the authoritative generation/lifecycle lock.

### Replacement and consent

Ordinary retry attaches only the same generation. A replacement requires either
the verified result of this view's explicitly confirmed restart or a separate
explicit reattach action. Recheck alone does not authorize replacement binding.
Verify stable instance creation identity, template/profile/managed identity and
component pins; never search for a similarly named App or relaunch a template
as an invisible fallback. Changed pins or ambiguous document identity require
host/operator review. Lower-level generation-bound Session objects do not
mutate into a new generation; the stable view owns the replacement handle.

Old input/action queues are discarded. Clipboard consent resets on connection
replacement. Display-only reconnect retains separately held audio according to
the existing audio contract; runtime replacement releases old-generation audio
and never silently reopens capture or transfers microphone ownership. A login
change retires the old host scope; reauthentication is not permission to carry
an old host into a different principal's session.

## Reference host and migration

The SDK and project-owned `/sdk/recovery.html` UAT simulation implement this
contract without editing or deploying a downstream host. Use the default panel in ordinary windows
and a custom-renderer example consuming exactly the same model/actions. Keep
transport/frame statistics visible and preserve focus/IME behavior. Recovery
controls are keyboard accessible, announce state changes without stealing
typing focus, and require a visible confirmation for disruptive operations.

The downstream host handoff consists of mount/release plus its existing authentication
and operator routes. Remove duplicated retry timers, native grant handling,
generation stitching and per-window repair dialogs once the new public entry
is qualified. Preserve file mapping, template selection, background-task policy,
normal close/stop semantics and permission UI. Capability-detect the new entry;
older SDKs keep their known lower-level integration, without advertising the
new recovery panel. UI permission flags do not create server authorization.

## Validation contract

Use the [fault injection matrix](../tests/kasm-native/RECOVERY-EXPERIENCE.md).
Each case reports one of automatic recovery, explicit recovery, protected stop,
degraded preservation, unsupported or not tested. A protected stop passes its
safety criterion but is not successful component repair. Record detection and
recovery timing, retries, actual new-frame/input/file readback, generation and
process identity, unrelated runtime effects, resources and cleanup.

Current #69 lease evidence and earlier broad fault matrices are baselines;
they do not qualify this new model or panel. Deterministic tests cover races and
admission; served-browser tests exercise the real default/custom UI and public
SDK; disposable system faults establish process behavior. Complete automation
before one consolidated human UAT. Record exact source/artifact/component
identity and retain failed attempts. No test runs against an active user
desktop, and no experiment may restart the protected original local display.
