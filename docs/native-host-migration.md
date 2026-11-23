# Embedding-host migration to RemoteXApp 0.17

Use this guide to move a host application from the Core 0.15 legacy SDK or a
Core 0.16 native integration to the **Core 0.17 series**. For the
Core 0.17.3 / SDK 0.34.0 appearance update, see
[adopt the native panel appearance](#adopt-the-native-panel-appearance).
The host retains file routing, template selection, window and workspace state,
and user consent. The native SDK handles Viewer attachment and recovery.
The [host requirements](native-host-integration.md) define the integration
scope. Verify the workflows in the reference workbench and then in your own
application.

Core 0.17 defaults newly created runtimes to KasmVNC. Provision a verified
server/client bundle before switching the Manager. To continue using TigerVNC
for new runtimes, select it explicitly. Existing runtimes keep their provider
and component pins. See the
[provider rollout instructions](operations.md#choose-the-display-provider).

## Choose the exact migration target

Load the SDK served by the matching Manager's authenticated `/sdk/index.js`,
under its proxy prefix if one is configured. Record the
Core commit and archive SHA-256, served SDK version, native component digest
and enabled App Package versions. See the
[0.17.0 qualification record](https://github.com/woodegg/remotexapp/issues/75)
for the release artifact and its verification.

| Target | Integration entry | Recovery and qualification boundary |
| --- | --- | --- |
| Core 0.15 legacy provider | Release-matched `RemoteXAppManager`, optional Coordinator and `RemoteXAppClient` | Existing TigerVNC/noVNC integration; native features require an explicit migration |
| Published Core 0.16.0 / SDK 0.31.0 | `RemoteXAppHost.open()` → `session.attach()` | Native host baseline; November 3 reference-host UAT is scoped to this baseline; `host.mount()` is absent |
| Core 0.16.1 / SDK 0.32.0 | `host.mount()` → SDK-owned panel/model → `view.release()` | Includes the 0.31.1 lease-renewal fix and the #70 recovery extension |
| Core 0.17.0 / SDK 0.33.0 | Same native entry points and recovery model | KasmVNC default for new runtimes. Optional direct and TURN screen acceleration. `webRTCPath` reports the route after UDP paint |
| Core 0.17.2 / SDK 0.33.0 | Same native entry points and recovery model | The [0.17.2 KasmVNC component](https://github.com/woodegg/remotexapp/releases/tag/v0.17.2) includes independent mouse capture and local viewport fitting. Runtime component pins determine which client is served. |
| Core 0.17.3 / SDK 0.34.0 | `host.mount()` with optional `panelLocale` and scoped CSS properties | Localizes and themes the SDK overlay. The 0.17.2 KasmVNC component is reused by the qualified pair. [Candidate and component identity](https://github.com/woodegg/remotexapp/issues/91) |

For the 0.16.1 recovery target, record the **Core commit/archive hash,
SDK version and asset hashes, native component manifest hash and App pins**.
The [November 20 qualification](../tests/kasm-native/RECOVERY-EXPERIENCE-20261120.md)
identifies Core source `89697ec597435330b02880770fc4c4f8252b7f4d` and component
manifest `12fd950b5b31c3c710471f61006ac90ce085d657fbc3b04824fcdda584646804`.
That record covers SDK 0.32.0-dev.1 on the development Core. Verify the formal
archive checksum and see [0.16.1 release qualification](https://github.com/woodegg/remotexapp/issues/72)
for the exact release candidate and acceptance evidence.

**The recovery target requires all three changes together:**

1. Adopt the SDK-owned window recovery flow instead of adding client retry
   timers and lifecycle decision logic.
2. Pair the SDK with its matching Core. Native template launches include a
   `launchIntent`; older strict APIs reject that field. The Core persists a
   principal-scoped reservation before launch to suppress browser transport
   replay. Uncertain outcomes require inspection, never automatic relaunch.
3. Select a new immutable native component containing patch 0025. It fixes
   retained channels and global listeners after Viewer retirement. An SDK/Core
   update alone cannot repair an existing runtime's old component pin.

See the [recovery contract](native-recovery-experience.md) and
[launch reservation limits](native-recovery-experience.md#launch-response-loss-and-transport-retries).
Keep the launch-intent ledger in the Manager's durable state; do not erase it
as routine reconnect or upgrade cleanup.

## Ownership and initialization

Create one `RemoteXAppHost` per authenticated login/server **in each Tab**.
Its `scope` is a non-secret cross-Tab coordination namespace. Authorization remains with the
Manager; a scope is never a credential. Cooperating Tabs use the same login
scope but own separate JavaScript objects. A normal window uses `mount()` in the
recovery target; the returned View owns its Session and Viewer. A background
task still calls `open()` for a separate Session/keepalive interest. A Session
owns a runtime handle, attached Viewers and explicitly acquired audio interests.

The recommended recovery-target window adapter is:

```js
import {RemoteXAppHost} from '/rx/sdk/index.js';

if (typeof RemoteXAppHost.prototype.mount !== 'function') {
  throw new Error('This adapter requires the qualified recovery SDK/Core pair');
}
const host = new RemoteXAppHost({baseURL:'/rx', scope:loginScope});
const view = host.mount(document.querySelector('#display'), {
  templateId:'edge', parameters:{startUrl:'https://example.com'},
});
view.addEventListener('change', () => updateWindowBadge(view.getState()));
view.addEventListener('request', ({detail}) => {
  if (detail.kind === 'authenticate') showHostLogin();
  if (detail.kind === 'help') showOperatorHelp(detail.reason);
});
await view.settled; // First attempt finished; failure may leave an attention panel.
if (view.getState().displayReady) enableWindowTools();
// Bind this callback to actual window close, not workspace hiding.
async function closeWindow() {
  await view.release();
}
```

`loginScope` and the UI functions above belong to the embedding host. Update
tool availability from later `change` events too. Login/account changes retire
the old Host and create a fresh login scope. Use `view.session` / `view.viewer`
only when available, and read them again after `attached`; a replacement can
create new generation-bound objects. Do not call `open()`/`attach()` again for
the same window or cache a retired Session for input/audio actions.

For the published SDK 0.31.0 baseline or deliberately lower-level integration,
the existing entry remains supported:

```js
import {RemoteXAppHost} from '/rx/sdk/index.js';

const host = new RemoteXAppHost({baseURL:'/rx', scope:'workspace-login'});
const catalog = await host.templates();
const session = await host.open({
  templateId:'edge', parameters:{startUrl:'https://example.com'}, keepAlive:false,
});
const viewer = await session.attach(document.querySelector('#display'));
// attach resolves only after current App readiness AND a painted frame.
```

`open()` performs explicit on-attach preparation when necessary and binds the
resulting generation. It does not acquire an audio channel or attach a hidden
Viewer. A lifecycle observer never starts a stopped application. Managed
attachment requires an explicitly running managed target; use the existing
Manager managed-state API for a separate start/stop decision.
The workbench resolves a selected `user-home` template using the current managed
catalog, then calls `host.open({managedId})` for its unique running registration.
The recovery adapter supplies the same explicit `{managedId}` target to `mount()`.
Missing or multiple registrations require explicit selection/configuration;
stopped targets require the separate Start action. `host.open({templateId})`
remains the ordinary App creation API and cannot create user-home desktops.

## Workflow changes for the recovery target

SDK 0.33.0 keeps the `host.mount()` window API introduced in SDK 0.32.0.
Hosts upgrading from the 0.31.0 baseline can qualify that API alongside their
existing `open()`/`attach()` adapter. Use the served SDK and the selected
instance's actual provider when dispatching an attachment.

| Existing host responsibility | Native integration | Retained contract / host change |
| --- | --- | --- |
| SDK loader and capability/version checks | Load the served `index.js`; require `RemoteXAppHost` and the needed Viewer capabilities | Adapt exports and event handling; fail visibly when capability is unavailable |
| Browser window and shared profile | `host.mount(container, {templateId, parameters})`; use the current `view.session` for `actions()` / `invoke('openUrl', {url})` | Keep template singleton/profile semantics. Never replay an uncertain action |
| File-editor window | Map the selected host file on the host backend, then `mount(container, {templateId, parameters:{filePath}})` | Preserve canonical root mapping and editor classification. Manager independently enforces document roots |
| Restoring an editor | Validate saved template/path identity before `mount(container, {instanceId})` | An instance ID alone is insufficient proof that it represents the selected document |
| Managed desktop | Resolve the intended registration, then `mount(container, {managedId})` | Respect desired/observed state, HOME and explicit stop. Never create a user-home desktop through an ordinary template launch |
| Connection mask and recovery dialogs | Default View panel, `change` and `getState()` | Five states and SDK-owned actions replace client recovery orchestration; `settled` alone is not readiness |
| Hidden workspace/window | Retain the View and DOM Viewer; blur inactive input | Hidden is not closed. Deliberate unloading needs separately retained interests and fresh attachment/consent; keep the existing lower-level path if the host needs that control |
| Background agent/task | A separate `host.open({instanceId, keepAlive:true})` handle | Closing a window cannot release the task's interest. Generation invalidation ends its authority |
| Close window | `view.release()` | Releases this window's owned Session/Viewer/audio interests; does not stop a shared App or release a separate background task |
| Close-and-stop editor | Explicit stop through the current `view.session`, then `view.release()` | Keep the separate user decision and pinned shutdown policy. A stale generation cannot stop its replacement. Do not force automatically |
| Text/shortcut injection | `viewer.sendText(text)` / `viewer.sendKey(key, {modifiers})` | Native key path, no clipboard fallback; validate receipt target and perform App readback when required |
| Clipboard prompts | `configureClipboard`, `requestClipboardPermission`, manual directional actions | Replace legacy prompt/offer UI. Explain auto/manual/off, focus ownership, permissions and reset on reconnect |
| Speaker/microphone | Prepare `session.audio()` when the current Session is ready. Call `setSpeaker()` or `setMicrophone()` from the user's click | The host can initialize in the background and expose a single click for either direction |
| Agent control endpoints | `session.connections()` and a trusted local executor | CDP, BiDi, UNO and D-Bus stay distinct, loopback-only protocols. Revalidate generation before control |
| Logout | `await host.logout()` | Release this host's windows/tasks and retire the authenticated audio login epoch |

The old input socket, IBus/Unicode injection ACK interpretation, remote-caret
positioning and old clipboard offer negotiation are removed from the Kasm
Viewer integration. They remain in the legacy provider. Do not retain two
clipboard or IME controllers for the same native Viewer.

Closing a window only releases its references. Explicit App stop follows the
pinned package shutdown contract: several shipped editor packages deliberately
terminate the process without saving. The host must tell the user to save first;
it cannot infer an unsaved-document veto from an editor name. A package that
reports a veto remains blocked unless an independently authorized force is used.

## Native input and display

`sendText()` accepts non-empty UTF-8 text up to 4096 bytes per submission;
newlines become Return and tabs become Tab. Unsupported control characters and
unpaired surrogates are rejected before any write. `sendKey()` accepts a single
printable Unicode character or Enter, Tab, Escape, Backspace, Delete, Insert,
Home, End, PageUp, PageDown, Arrow keys, Space and F1–F12. Modifiers are Control,
Shift, Alt and Meta. Chords release only their own modifiers in reverse order.

Input rejects a disconnected/read-only Viewer, stale ownership, an aborted
signal, held human keys, active IME composition, pending native paste/keyboard
events or excessive queued socket traffic. A returned `submitted` receipt names
the instance, generation and connection epoch; it is **not an application ACK**.
Transport failure during submission is uncertain. Reconnect never replays input.

`configureDisplay({scale:true, resize:true})` requests native resize only when
the template permits it. `flushResize()` asks the component to apply its current
container size; actual dimensions remain observable in `getStats()`. Two
resizing Viewers share one remote framebuffer, so a host should select one
resize owner and use scale-only secondary windows.

`session.attach(container, {readOnly:true})` requires paired component and Core
support. Its immutable one-use grant selects a server filter that rejects keys,
pointer events, clipboard writes and desktop resize. Display negotiation,
per-client codec limits, statistics and optional UDP remain permitted. This is
an attachment restriction, not a new account/tenant role: an authenticated user
with existing write authority can deliberately create another writable Viewer.
It does not confer read-only access to separate Manager or audio APIs.
The high-level equivalent passes `{readOnly:true}` as the third argument to
`host.mount(container, target, options)`; it uses the same enforced Viewer policy.

All new Core native connections use generation/component-qualified, renewable
grants, including WSS-only components. Old Core builds lacking this capability
cannot promise server-enforced read-only attachment. There is no silent downgrade.

## Connection recovery

The recovery development pair incorporates the SDK 0.31.1 fix, applying the
configured bounded native reconnect policy to transient
lease-renewal failures as well as display disconnects. A renewal HTTP request
has a ten-second deadline. Each retry obtains a fresh authenticated descriptor
and grant for the same running App generation/component; it never reuses an
expired token, restarts the App or replays input/actions. The server retains its
20-second renewal schedule and 90-second grant lifetime.

Explicit authorization/generation rejection stays terminal. Disconnect,
dispose, logout or runtime release cancels recovery. After `reconnectexhausted`,
show an explicit reconnect action. A direct `RemoteXAppNativeClient` keeps
`reconnect:false` by default; `RemoteXAppHost` uses its configured reconnect
policy. Clipboard consent resets on connection replacement. A display-only
reconnect preserves separately held audio according to the audio contract;
runtime replacement retires old-generation interests and never silently
reopens microphone capture.

With `mount()`, use the default panel or render `getState()` with `{panel:false}`.
The five states are `connecting`, `ready`, `recovering`, `attention` and `closed`.
Custom controls call the current `run(action.id)`, `confirm(confirmation.id)` and
`cancelConfirmation()`; do not recreate action admission or persist action IDs.

| Condition | SDK/Manager behavior | Embedding-host responsibility |
| --- | --- | --- |
| Transient display/renewal outage | Bounded same-generation reconnect with fresh authority | Display current state/stats; retain the window |
| Authorization loss or exhausted retries | Attention; no implicit credential reuse or budget reset | Route login/help requests and let the user choose an offered action |
| Empty eligible managed failure | Manager may recover; a replacement needs an explicit verified reattach | Use the panel; do not silently bind an old Session to a new generation |
| `session-populated-or-unknown` | Preserve potentially live applications; recheck cannot kill or bypass policy | Explain the blocker and offer operator help |
| Confirmed restart | Fresh identity/generation checks and normal shutdown admission | Let the SDK explain the shared-runtime/unsaved-work impact; no implicit force or upgrade |
| Lost create/restart/action response | Observe and report uncertainty; no automatic replay | Inspect the outcome; never guess the new App or generate a replacement launch to hide the error |

Remove duplicated retry timers, grant renewal, legacy readiness inference and
per-window repair state machines from the native adapter. Keep authentication,
template/file mapping, window restoration and normal App stop policy. Neither
the SDK nor a recovery button hot-repairs borrowed buses or ambiguous processes.

## Adopt the native panel appearance

For Core 0.17.3, load the served SDK 0.34.0 and keep the existing mounted-window
adapter. Use the host's current language when opening a window. Subscribe each
window to the host locale while its View is mounted. Apply the host's theme
through CSS on the mount container or an ancestor.

```js
function mountRemoteWindow(container, target, appearance) {
  container.classList.add('remote-window-display');
  const view = host.mount(container, target, {
    panelLocale: appearance.getLocale(),
  });
  const unsubscribe = appearance.subscribeLocale(locale => view.setPanelLocale?.(locale));

  return {
    view,
    async close() {
      unsubscribe();
      await view.release();
    },
  };
}
```

`appearance` stands for the host's preferences store. Bind `close()` to
closing the window. A hidden workspace can retain its View and receive the
same preferences as a visible window. Map CSS tokens on the mount container
and let inherited values update when the host theme changes.

```css
.remote-window-display {
  --remotexapp-recovery-font-size: var(--window-text-size, 15px);
  --remotexapp-recovery-background: var(--window-surface, rgba(15, 23, 42, .96));
  --remotexapp-recovery-foreground: var(--window-text, #e5edf6);
}
```

Set the control fill, text, border and focus tokens if the host uses a
different control palette. See the
[SDK appearance contract](browser-sdk.md#native-connection-and-recovery-panel-appearance)
and [the complete token list](recovery-panel-appearance-proposal.md#theme-contract).

Use `en` or `zh-CN` for the first two language catalogs. Locale variants
are normalized by the SDK. Omitting `panelLocale`, or clearing it with
`view.setPanelLocale()`, restores the default display. The optional method call
allows the same host adapter to load SDK 0.33.0. The host localizes its title,
footer status line and other window chrome through its own UI. Hosts with
`panel: false` own the panel copy and render the existing recovery snapshot.

For this appearance update, the tested pair uses the published
0.17.2 KasmVNC component. Stage Core 0.17.3 and its SDK assets, then verify the
served version on a freshly loaded host page. Continue to use the 0.17.2
component pin for compatible existing runtimes. Test UI rollback by disabling
the host locale and theme mapping, then reload the host page with the default
panel configuration.

Start in `/sdk/recovery.html` under the authenticated Manager prefix. Choose a
language, palette and font size before opening a test App, open a second
Viewer, and give it a different appearance. Disconnect one Viewer, switch
locale and theme on its panel, then retry and verify a fresh frame on the
same generation. On a disposable App, open and cancel a restart confirmation.
Check keyboard focus, large type, narrow panes and whether the warning remains
readable at 200% browser zoom. Repeat the same checks in the embedding host
and record that acceptance separately.

## Audio, clipboard and transport

An audio interest alone does not open transport. At least one session must
enable speaker or mic. Different sessions have independent switches; multiple
Tabs of the same session share its desired route, with explicit playback/capture
ownership. Removing a display does not remove its separately retained audio
interest. Capture cannot silently restart after a failure.

In an embedding host, obtain the audio interest in the background when the
current Session becomes available. Keep both switches off by default and show
a loading or retry state until the interest is ready. Invoke
`interest.setSpeaker(enabled)` or `interest.setMicrophone(enabled)` directly
from the corresponding user click. Preparing the interest leaves playback,
capture and the audio WebSocket idle. The first enabled switch starts the
shared connection. On generation change, discard the old interest, prepare
the new Session's interest and require a fresh microphone action. A late
preparation result for a closed window must be released.

Native clipboard supports plain text, HTML and PNG within an aggregate 2 MiB.
It excludes file/folder transfer. Automatic directions require explicit opt-in
and browser permissions; only the active Viewer synchronizes. Empty local reads
preserve the remote clipboard, and conflicts remain visible rather than guessed.

Optional UDP changes screen delivery. WSS still owns the display connection and
control/input path; audio retains its independent multiplexed transport. The
0.16 deployment model uses an operator-supplied endpoint catalog and host
forwarding. In 0.17 the [WebRTC routing modes](native-webrtc-routing.md)
automatically allocate a listener from the Manager's configured range. TURN
lets multiple containers on a shared private relay network reuse the same
range. Relay deployment, peer access and host firewall rules remain the
deployment owner's responsibility. SDK 0.33.0 exposes the observed
`webRTCPath` of `direct` or `turn` only while actual UDP display is active.
Display stats distinguish actual painted UDP from WSS, active RTT probes,
bandwidth counters, paint FPS and scoped display-block loss. Missing/stale values
are unavailable, never fabricated zeroes.

## Deployment-owner rollout and rollback

On Ubuntu, install `x11-utils` so the Manager can use `xdpyinfo` for display
readiness. For the LightView template on Ubuntu 26.04, provision the
distribution-specific LightView v0.1.13 host binary and verify its checksum.
The RemoteXApp App Package is `lightview@1.0.13`. See
[host dependencies and LightView](dependencies.md#must-have-when-the-corresponding-app-is-installed)
and [Ubuntu preparation](dependencies.md#ubuntu-2404--2604-preparation).

1. Inventory Core/SDK/component/App identities and the actual provider, runtime
   generations, active Viewers, managed intent and document/profile owners.
   Snapshot compatible state and persistent data; retain the previous artifacts.
2. Stage the matched Core/SDK and the selected native component in separate
   immutable directories. Preserve their manifests, hashes and corresponding
   source. For the 0.17.3 appearance update, reuse the verified 0.17.2 component.
   Do not overwrite an installed component or bypass a mismatch with cached
   browser files. Reload host documents after changing the served SDK.
3. Update the authenticated proxy's SDK asset graph and, where it serves native
   assets, its component-digest allowlist. Keep old mappings while old pinned
   runtimes remain. Verify served hashes and real browser paint: the November 20
   deployment initially failed because the edge still allowed only the old client.
4. Restarting Manager adopts compatible runtime pins; it does not update them.
   After saving work and reviewing all affected windows, inspect
   `getRuntimeVersions()` and perform an eligible same-profile
   `upgradeAndRestartInstance()` with fresh `sessionGeneration` and
   `targetRevision`, following the [upgrade API](runtime-upgrade-api.md).
   The recovery panel's ordinary Restart action is not this upgrade operation.
   Never calculate the next generation or automatically retry an uncertain POST.
5. Migrate display providers one runtime at a time, after saving work and closing
   its Viewers. Start with WSS and verify the actual instance reports
   `displayProvider: "kasm"` and paints a fresh frame.

   - **Ordinary Apps.** Stop the old runtime and wait for it to stop. Open the
     same template with the original parameters. Retain its `profileRef`
     wherever the App uses a persistent profile.
   - **Managed desktops.** Retain the registration, `managedId`, Unix user and
     HOME. Set the registered desktop's desired state to `stopped` using the
     Console or managed-instance API. Wait for an observed `stopped` state
     and completed runtime teardown, then set the desired state to `running`.
     Resolve any unsaved-work or shutdown veto before proceeding.
   - **Previous UDP deployments.** Compatible WSS Kasm runtimes with no UDP
     lease can be adopted with the same pins and generation. Retire old
     catalog-backed UDP runtimes before installing 0.17. A registration that
     pins an old UDP slot needs the specific
     [legacy-slot migration](native-webrtc-routing.md#migration-and-rollback).
     For direct UDP or TURN, the deployment owner sets the selected listener
     range, routing and firewall rules.
6. Verify current pins, managed intent, fresh frames, input/file readback,
   consented clipboard/audio and cleanup through the reference pages, then the
   real embedding host. For rollback, stop affected native runtimes with a
   compatible Core and use a verified compatible state/profile snapshot. An old
   Core must not read unsupported native schemas; restoring binaries alone does
   not roll back documents or migrate state.

These are handoff instructions for the deployment owner. Repository publication,
local reference-host UAT and downstream deployment are separate operations.

## Reference host and remaining acceptance

Open `/sdk/host.html` under the authenticated Manager prefix. The workbench uses
public SDK APIs for catalog/parameters, existing and managed attachment,
workspaces, duplicate windows, unload/restore, background ownership, native
input, clipboard, audio and actions. It exports content-free observations;
its export explicitly says `acceptance: not-evaluated`.

The host must still supply its own file picker/backend mapping, application
selection rules, durable window restoration, permission UX and trusted Agent
executor. The standalone workbench does not substitute for downstream product
acceptance. Exact candidate qualification and the consolidated UAT checklist
are recorded in the [candidate evidence](../tests/kasm-native/NATIVE-HOST.md)
and [single UAT checklist](../tests/kasm-native/NATIVE-HOST-UAT.md) for Issue #57.

For Core 0.17, use both `/sdk/host.html` and `/sdk/recovery.html` under the same
prefix. Verify the version and provider, discover templates through
`GET /api/templates`, exercise ordinary App and managed-desktop opens, then
check input, clipboard, audio with explicit consent, reconnect and window
release. If the deployment enables WebRTC, confirm the expected
`webRTCPath` after UDP paint and verify WSS fallback. Repeat the relevant
workflow in the embedding application and record its result separately.
The [0.17.0 qualification record](https://github.com/woodegg/remotexapp/issues/75)
tracks the exact release artifact.

For the earlier recovery qualification, use `/sdk/recovery.html` under the same prefix.
The [November 20 results](../tests/kasm-native/RECOVERY-EXPERIENCE-20261120.md)
record 24 fault modes, default/custom panels, multi-Viewer isolation, protected
managed recovery and resource cleanup on the exact development pair. Earlier
375-check legacy evidence is separately identified; it is not relabeled as that
pair. Physical IME/audio devices, a new long soak, WAN loss/MTU and OOM/CPU
starvation remain outside that qualification.

The host migration is complete only after its own file/template routing,
managed selection, workspace/window/task ownership, recovery actions, logout,
clipboard/audio consent and generation-qualified controls pass end to end.
**Reference-page automation and the previous 0.16.0 UAT do not constitute
acceptance of either this recovery extension or the downstream adapter.**


## Adopt 0.17.4 audio recovery

Use Core 0.17.4 with its served SDK 0.34.1. Keep the existing
`session.audio()` handle and call the speaker and mic methods from user
gestures. Remove host code that disposes and reacquires the entire audio
controller for a Manager restart or worker failure. Render the desired
`speaker` separately from `actualSpeaker`, and offer an explicit play action
when `playbackBlocked` or `speaker-action-required` is reported. A failed
worker channel can rebind on the next explicit action. Interrupted microphone
capture stays off until the user enables it again.

Enable automatic speaker recovery at the trusted reverse proxy only when it
can supply a verified login-session identifier as described in the
[audio contract](native-audio.md#authentication-and-protocol). Application
window and Viewer integration use the same APIs.
