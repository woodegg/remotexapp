# RemoteXApp browser SDK

## Optional runtime keepalive (SDK 0.29)

For a windowed host application, see the [WAOS migration guide](waos-runtime-coordinator-migration.md)
before deciding whether to retain existing Viewers or bind new ones to handles.

Keepalive defaults **off**. It delays the template's idle action without a
Viewer connection; it does not launch an App, override Stop, or survive a
runtime generation change. Status polling and WebSocket Ping do not renew it.

For an existing connected Viewer:

```js
await client.startIdleLease(); // own automatic interest, including after disconnect
client.disconnect();           // App may continue running
client.stopIdleLease();        // stop renewal, not the App
// client.destroy() also releases this Viewer-owned interest.
```

For host-owned interests and shared monitoring across same-origin Tabs:

```js
import { RemoteXAppManager, RemoteXAppCoordinator, RemoteXAppClient } from '/sdk/index.js';
const manager = new RemoteXAppManager();
const coordinator = new RemoteXAppCoordinator({ manager, scope:'current-login-epoch' });
// Track after on-attach activation; replace this value with the current runtime.
const runtime = coordinator.track(instance.id, {
  sessionGeneration:instance.sessionGeneration, keepAlive:true,
});
await runtime.ready;
runtime.addEventListener('leasechange', e => console.log(e.detail.lease));
runtime.addEventListener('invalidated', () => console.log('Acquire again explicitly if needed'));
coordinator.addEventListener('error', e => console.warn(e.detail));
console.log(coordinator.getDiagnostics()); // Read-only local observation; no extra requests.
const viewer = new RemoteXAppClient({ runtime, container:'#remote' });
await viewer.connect();
// Later: viewer.destroy() does NOT release this host-owned handle.
// runtime.release() removes only this interest; coordinator.destroy() on logout.
```

Use a non-secret login epoch shared by cooperating Tabs, different for each
login. Server URL (including proxy base path) is also part of the namespace.
`mode` is `cross-tab` or explicit `local` fallback. Omit `keepAlive:true` for
observation only. Handle snapshots contain lifecycle metadata, not a full
connection/control descriptor. Fetch those explicitly through Manager.

One-shot renewal is `manager.renewIdleLease(id, {sessionGeneration, signal})`
or `client.renewIdleLease()`. Receipts contain `instanceId`, `sessionGeneration`,
`outcome` (`renewed`, `attached`, `kept`), `idleAction`, `idleTimeoutMs`,
`serverTime` and `expiresAt` (null except for `renewed`). Server policy chooses
the timeout; no client TTL is accepted. Generation zero only renews a dormant
on-attach runtime, without starting it. Activation changes that generation:
acquire a new handle explicitly after activation.

Browser keepalive is best effort: an awake participating Tab can take over
after six seconds; silent interests expire after five minutes. If every Tab
is suspended, the server deadline can expire. Short timeouts/network delays
can also beat takeover. Last release leaves the existing deadline intact.
IME/clipboard remain per Viewer. See the [full contract](runtime-coordinator-release.md).

A bound handle becoming invalidated disconnects its Viewer and emits
`runtimeinvalidated`; reconnect requires a newly acquired handle/Viewer.
Explicitly releasing a still-valid host handle removes its shared observation
and returns an existing Viewer to standalone monitoring, without stopping it.

## Connection mask (SDK 0.28)

`connectionMask` defaults to `true` in `RemoteXAppClient` options. Use
`connectionMask:false` to opt out, or `client.setConnectionMaskEnabled(false)`
to hide it without reconnecting. The custom element accepts `no-connection-mask`.
Console/kiosk Viewers have independent switches; kiosk accepts `connectionMask=off`.

`connected`/`connect()` retain transport semantics. With the mask enabled,
`viewerready` is emitted after a current-generation ready app and an actual
painted frame, then the mask fades out. A 45-second timeout shows retry/disconnect
instead of endless progress. Cancel disconnects only the Viewer. Readiness does
not certify completion of every app-internal asynchronous task. This is visual
input protection, not a security boundary or a replacement for host authorization.

The SDK is served by `remotexappd` from the stable `/sdk/index.js` URL. It is
framework-independent application code and lazily loads the server's noVNC
bundle only when a display connects.

## Quick start

```html
<div id="remote" style="width:100%;height:600px"></div>
<script type="module">
  import { RemoteXAppManager, RemoteXAppClient } from '/sdk/index.js';

  const manager = new RemoteXAppManager();
  const instance = await manager.createInstance({
    templateId: 'edge',
    profileRef: 'default',
    parameters: { startUrl:'https://example.com', incognito:true },
  });
  const client = new RemoteXAppClient({
    manager,
    instance,
    container: '#remote',
    resize: 'class',
    resizeDebounce: 300,
    resizeMaxWait: Infinity,
    autoReconnect: true,
    maxReconnectAttempts: Infinity,
    textBatchDelay: 16,
  });
  await client.connect();
</script>
```

For short-lived classes, the equivalent one-object flow is:

```js
const client = new RemoteXAppClient({ manager, container:'#remote' });
await client.launch({ classId:'mousepad', profileRef:'account-42' });
```

`relaunch()` stops the current runtime, creates a new instance with the same
class/profile by default, and connects it.

Creation must be followed promptly by `connect()` for short-lived classes. The
SDK console does both in one action, so Mousepad's five-second vacancy policy
does not race a human clicking a second Open button.

## Control plane

`RemoteXAppManager` provides class discovery, filtered instance listing,
creation/launch, attach metadata, stop, state waits, and instance watching. It
automatically infers a same-origin service base path from the loaded SDK module
URL. Importing `/tools/remotexapp/sdk/index.js` therefore prefixes API, viewer,
health, RFB, input, and generated-asset requests with `/tools/remotexapp`.
Applications may still pass `baseURL` to override this result. The reverse
proxy must strip the external prefix before forwarding to `remotexappd`.
RemoteXApp 0.2 does not ship a cross-origin CORS policy; use one authenticated
same-origin reverse proxy for the application, SDK, HTTP API, and WebSockets.

SDK 0.17 was the coordinated App Package ABI v1 break. Instances always expose
generic `resources`; protocol metadata remains opaque JSON under
`applicationStatus.details`. SDK types no longer declare top-level
`controlAddress`, `controlPort`, or `controlWebSocketUrl`. A downstream adapter
must require current-generation `ready` status, a `loopback-tcp` allocation on
`127.0.0.1`, exact allocation/status port agreement, and the App-owned protocol
and endpoints it understands. No legacy-field fallback is provided.

SDK 0.10 exposes one class and effective-policy `runMode`: `shared`,
`isolated`, or `user-home`. Clients must not infer or independently request a
HOME, D-Bus, or Xauthority mode; the selected template owns that complete
execution-environment decision.

## Display and input plane

`RemoteXAppClient` owns one container. It handles RFB pointer/wheel/control keys,
the browser IME host, committed Unicode over `/input`, remote caret placement,
class-driven resize, modifier recovery, lifecycle polling, traffic metrics and
bounded automatic reconnect. `destroy()` removes its sockets, timers, observers
and DOM listeners. It does not stop the remote instance; call `stopInstance()`
when that is the desired lifecycle action.

The client connects to the instance-scoped `/rfb-compat` endpoint. The Go
gateway preserves the RFB byte stream and uses the P05-validated capacity-8
relay queue before applying TCP backpressure. This is a server transport
property, not an SDK video-frame queue: application code must not attempt to
drop RFB messages to chase the live edge.

SDK 0.15 makes remote-resize timing an embedding policy. `resizeDebounce:0`
keeps noVNC's compatibility behavior. A positive millisecond value waits for
that quiet period and locally scales the old framebuffer while waiting.
`resizeMaxWait` defaults to `Infinity`; set a finite value greater than or
equal to the debounce to permit bounded progress during a long gesture. If the
embedding UI knows a drag ended, `client.flushResize()` submits the latest
pending size as soon as noVNC's one-in-flight/100 ms constraints allow. Initial
connect and reconnect negotiation are immediate, newer sizes survive an
in-flight request, and disconnect/destroy cancel stale work. Fixed or
scale-only template policy remains authoritative. P15 measurements and the
real-stack reproduction are in
[`tests/performance/resize-debounce/README.md`](../tests/performance/resize-debounce/README.md).

Both shipped UIs consume this public API. The built-in kiosk is a thin
full-window `RemoteXAppClient` host, and the SDK console uses
`RemoteXAppManager` plus `RemoteXAppClient` for catalog, lifecycle, connection,
input and diagnostics. Neither UI may implement its own RFB/input/IME stack;
missing shared behavior belongs in the SDK.

SDK 0.18 adds a server-owned runtime restart transaction:

```js
const current = await manager.getInstance(instanceId);
const restarted = await manager.restartInstance(instanceId, {
  sessionGeneration: current.sessionGeneration,
});
```

The exact generation prevents a stale page from restarting a newer session.
The manager retains the runtime ID, launch parameters, profile, allowed
overrides, locked App/core snapshot, and allocated ports. A blocked graceful
shutdown returns HTTP 409; pass `force:true` only after an explicit user
decision to discard unsaved work. Restart is not an App upgrade.

SDK 0.18 also exposes `getVersion()` and `getHealth()`. An authenticated
operator console may call `restartManagerService()` and then
`waitForOperatorOperation(id)`, but only when `/api/version` advertises
`capabilities.serviceRestart`. That capability is disabled by default and is
never available in `auth-mode=none`; application integrations should not treat
it as a general system-service API.

The root page, former SDK console, former minimal example, and kiosk now load
one content-hashed console application in operator, launch, or viewer mode.
The kiosk mode does not expose lifecycle or service operations. The console
renders parameter and override forms only from template metadata and never
automatically calls the secret-bearing environment endpoint.

## Bidirectional clipboard

SDK `0.22.0` omits supported zero-byte representations before upload and
fingerprinting, but preserves whitespace-only text. `send()`, `syncToRemote()`,
`syncToLocal()`, and low-level `sendClipboardOffer()` can return
`{skipped:true, reason:'empty-clipboard'}` instead of an offer/result when
there is no content to transfer. A skipped result never clears the destination
or emits `clipboardsync`. Automatic empty observations do not create prompts;
an approved empty prompt displays a neutral skipped state. Handle the union
result before reading offer IDs or written types.

Nonempty HTML requires nonempty plain text from the same captured snapshot.
Missing fallback, failed reads, malformed payloads and limit violations reject
the operation without silently dropping valid formats or committing a partial
offer. No implicit second clipboard read or HTML-to-text conversion is used.
The low-level API returns HTTP 200 for a valid all-empty multipart offer;
requests with no parts, duplicate formats or unsupported formats remain errors.
Remote capture failures emit generation-scoped `clipboarderror` events with
`direction:'toLocal'`; these do not create an actionable partial offer. Browser
format support and permission constraints still apply.

```js
const result = await client.clipboard.syncToRemote();
if (result.skipped) {
  // Nothing was changed. Do not display a synchronization-success message.
} else {
  console.log(result.id);
}
```

SDK 0.21 exposes clipboard policy and transfers under `client.clipboard`.
Both directions start `off` and are configured independently:

```js
client.clipboard.configure({
  toRemote: 'prompt',
  toLocal: 'prompt',
  checkOnFocus: true,
});

// Explicit user actions; `paste` also sends the remote native paste gesture.
await client.clipboard.syncToRemote({ action:'set' });
await client.clipboard.syncToRemote({
  action:'paste',
  items:[{ type:'text/plain', data:'approved text' }],
});
await client.clipboard.syncToLocal(offerId);

// No prompt and no clipboard read/write.
const checked = await client.clipboard.checkAccess();

// Call directly from a click/tap handler. Content is discarded.
const authorized = await client.clipboard.requestReadAccess();
if (authorized.access.read.verified) {
  // This read succeeded at this moment; future access remains browser policy.
}
```

The allowed representations are UTF-8 `text/plain`, UTF-8 `text/html` with a
plain fallback, `text/rtf`, and `image/png`. `send()` accepts explicit items
without reading the browser clipboard. `list()`, `dismiss()`, `cancel()`, and
`approve()` support custom integration UI. Listen for `clipboardoffer`,
`clipboardstatechange`, `clipboardpermissionrequired`, `clipboardsync`, and
`clipboardexpired`, and `clipboarderror` on the client, or the corresponding
unprefixed events on `client.clipboard`.

`off` ignores that direction; `manual` exposes actions without monitoring;
`prompt` monitors and waits for approval; and explicitly selected `auto`
transfers only while browser permission is already granted. Unsupported or
ungranted automatic access visibly degrades to `prompt`. In SDK 0.21 only the
Client that owns real Viewer input focus monitors local clipboard changes.
Pointer/keyboard input or an embedding window manager's `client.focus()` makes
that Client active and reconciles once; `client.blur()`, focus elsewhere,
disconnect, or destruction makes it inactive. A background connection never
claims this activity. The `inputActive` snapshot field reports the current
state. Focus reconciliation queries permission but never opens a new permission
prompt itself. A real paste event remains a text/HTML/RTF/PNG fallback when
asynchronous clipboard read is unavailable.

`checkAccess()` reports secure-context, document-focus, transient-activation,
read, and write state without attempting a clipboard operation.
`requestReadAccess()` starts one real browser read before its first asynchronous
wait so a direct click/tap activation is preserved. It does not decode, return,
upload, fingerprint, or write back the content. Its `access.read.state` reports
`granted`, `denied`, `requires-user-activation`, `document-not-focused`,
`secure-context-required`, `unsupported`, or `failed`; `verified` is true only
when the read actually succeeds. Because browsers expose no non-mutating write
probe, a real `syncToLocal(offerId)` remains the write authorization check.

The Clipboard API requires a secure context. Use authenticated HTTPS in normal
deployments; `http://localhost` is suitable for local UAT, while a plain LAN
HTTP hostname is not. The permission prompt can only be triggered from an
explicit user gesture: select `prompt` or `auto`, then press the Console's
manual Local→remote or Remote→local button (or call the matching `sync*`
method from your own click handler). Do not request clipboard access on page
load.

Each Client owns its fingerprints and loop suppression. If A writes a remote
offer into the browser clipboard, only A suppresses the rebound; B may prompt
for that same value when B later gains focus. Embedding applications must not
add a shared clipboard coordinator—activate their ordinary Client when its
window becomes the input target.

`RemoteXAppClipboardPrompts` is the optional standard newest-first tick/X stack.
SDK 0.27.4 adds prominent SVG direction arrows and pre-consent content types,
encoded byte sizes, a bounded plain-text sample and PNG thumbnail/dimensions.
Preview reads never write either clipboard; approval still revalidates the
offer. Rich HTML/RTF is never rendered as markup. Previews are Viewer-local and
ephemeral, not added to public offer/state events, diagnostics or browser storage.
Unknown or failed previews are explicitly unavailable; synchronization still
requires the user's choice and normal permissions. Success receipts remain
button-free and default to three seconds.

Hosts using this standard UI must allow `data:` and `blob:` in CSP `img-src`
for decorative SVG icons and local PNG object URLs (not in `script-src`).
The shipped Console/kiosk policy includes these image sources. PNG thumbnails
are limited to 16 MiB encoded and 4,194,304 pixels; larger images retain metadata
without thumbnail decoding. These preview bounds do not reduce transfer limits.
Object URLs are released on approval, expiry, dismissal or UI destruction.

View-only clients still receive remote offer metadata and may copy it
locally, but their SDK rejects local-to-remote sends. Disconnect, destruction,
or client replacement resets modes and pending state.

SDK 0.21.1 makes that stack explicitly content-height and top-anchored, with
direction encoded by text, arrow, and high-contrast color. Size the Client
container, but treat SDK-created descendants as owned by the SDK; do not target
them with wildcard child layout rules. Use the public clipboard events instead
when an application needs custom prompt UI. The same SDK fingerprints the
successful browser write path and authorized post-write readback, so omitted,
reordered, fallback, or normalized rich representations do not rebound from
remote to local and back through the same Client. Suppression remains per
Client.

P07 keeps the public import URL stable while changing its delivery graph. The
entry is a 41-byte loader with `Cache-Control: no-cache` and an ETag. It points
to one content-hashed SDK bundle, which lazily imports one content-hashed noVNC
bundle. Those hashed assets are immutable for one year. Applications must
import `/sdk/index.js`; they must not hard-code generated `/assets/` names.
Five-profile testing reduced median viewer static requests from 45 to 3 and
fresh local-HTTP transfer from 551,233 B to 181,399 B while preserving exact
Unicode input and explicit SDK reconnection. Build/reproduction details are in
[`tests/performance/assets-bundle/README.md`](../tests/performance/assets-bundle/README.md).

SDK 0.8 makes text latency policy explicit. Ordinary browser `input` values
use `textBatchDelay`, an integer/number from 0 through 1000 milliseconds whose
default is 16 ms. Completed `compositionend` text is already one semantic IME
transaction, so it is appended after older pending ordinary text and flushed
immediately. `textBatchDelay:40` preserves the former ordinary-input timing;
`0` sends every ordinary event immediately and may materially increase
WebSocket/IBus commits. The accepted 16 ms default reduced deterministic
single-event timer latency from 40.490 to 16.278 ms while keeping five events
spaced 10 ms apart in one request. See
[`tests/performance/text-batching/README.md`](../tests/performance/text-batching/README.md).

Pending text belongs to the current input-channel generation. `connect()`,
explicit reconnect, failure and disconnect clear its timer/value before a
replacement WebSocket can be used. The SDK deliberately does not replay that
ambiguous client-side fragment. `getDiagnostics().textBatchDelay` exposes the
effective setting.

SDK 0.11 splits physical keyboard input from committed browser text. Reliably
mapped printable ASCII keydowns (`U+0020` through `U+007E`) use RFB, as do
controls and shortcuts. The SDK prevents the ASCII keydown default, which
suppresses the duplicate textarea `input` event. Composition, direct
non-ASCII, dead/unidentified-key fallback, soft keyboards, and paste continue
through `/input` and the private IBus engine. This lets secure widgets that
reject IBus commits accept ordinary passwords while preserving exact Unicode
IME transactions. ASCII paste is not synthesized into layout-dependent RFB
keystrokes.

### `sendText()` is not keyboard simulation

`client.sendText(value)` always submits text through `/input` and IBus, even
when `value` contains only ASCII. It requires a compatible, focused remote
input context. **Do not use it for password fields, authentication dialogs,
or other widgets requiring direct keyboard input.** Rejection in these
fields is an expected API limitation, not a text-delivery defect.

Use physical keyboard input or `client.sendKey(keysym, code, down)` over RFB
for such fields. Programmatic callers must map supported keys and send paired
key-down/key-up events; this is not a general Unicode-to-keystroke conversion.
For example, a single supported ASCII key can be sent with
`client.sendKey(0x61, 'KeyA', true)` followed by
`client.sendKey(0x61, 'KeyA', false)`. Never put real credentials in examples,
logs, or diagnostic captures.

A resolved `sendText()` promise acknowledges the engine commit, not that the
application inserted the text. The SDK cannot reliably identify the remote
field type. Do not automatically resend or fall back to another input path:
that can duplicate text or deliver it to a stale application's input context.
Normal editable-field failures must be investigated separately from expected
password-field rejection.

This split does not make non-ASCII input safe in a remote widget that has no
IBus input context. Full-desktop templates allow multiple window classes, and
IBus may retain the previous application's context when a Polkit-style secure
dialog takes X11 focus. In that case the secure field rejects the commit and
the previous IBus application may receive it. Ordinary ASCII passwords use the
RFB route and are supported; non-ASCII secure-field input remains unsupported
until the remote side can bind an IBus context to the current X11 focus.

P13 adds privacy-safe gateway text counters to the health object copied into
`getDiagnostics().traffic`: `textLogLevel`, `textRequests`, `textErrors`,
`textInputBytes` and `textServerMicroseconds`. They are cumulative for one
gateway process and contain no typed value. Applications may derive an average
server time from the two cumulative fields but must handle process restart and
counter reset. Selecting `metadata` or `content` logging is an operator-side
manager flag, not an SDK option; browsers must not be able to enable content
logging.

Class catalog entries expose `input.lifecycle` as `server` or `session`.
This is descriptive policy for client/operator UI, not a launch override: P14
uses it to report that D-Bus/IBus exist only while the application session is
running. All current production classes report `session`; the field remains
descriptive and cannot be changed through a launch override.

SDK 0.7 makes gateway traffic diagnostics demand-driven. They are disabled by
default; call `await client.setDiagnosticsEnabled(true)` while an observation
panel is visible, disable them when it closes, or call
`await client.refreshDiagnostics()` for one explicit sample. `getDiagnostics()`
returns the current local snapshot without starting periodic HTTP work. The
`diagnostics` attribute provides the same opt-in for `<remote-x-app>`. P06
accepted this behavior after real-browser request/DOM measurements and full
interactive input regression. The original SDK 0.8 post-live asset result was
3 requests and 182,088 transferred bytes; the same demand-driven contract is
retained by SDK 0.15.

SDK 0.6 makes verbose per-input-event tracing explicitly opt-in through the
`RemoteXAppClient` option `inputEventTracing:true`. It is disabled by default so
normal key, composition and text handling does not serialize diagnostics, send
`client-event` messages or write those events to the gateway journal. The
built-in kiosk accepts `?trace=on` for an authorized diagnostic session.

SDK 0.5 replaces rapid caret polling with push-based IBus cursor events,
freshness correlation and safe hidden-textarea relocation/refocus. See
[`ime-caret-push.md`](ime-caret-push.md). P11 later isolated server-side cursor
fan-out per input peer with a capacity-one latest-value queue; this does not
change the SDK event schema or reconnect contract. SDK 0.4 added `getApplicationStatus()` and generation-aware
`waitForApplicationState()` for launch and reattachment. SDK 0.3 added typed
template launch `parameters` to temporary and managed
creation. SDK 0.2 added `listTemplates()`, `createManagedInstance()`,
`listManagedInstances()`, `getManagedInstance()`, `setManagedInstanceState()`
and `deleteManagedInstance()`. The older class-oriented methods remain
compatible. Managed runtimes must be stopped by changing their registration's
desired state, not by calling `stopInstance()` on the generated runtime.

SDK 0.15 also makes the primary pointer an effective pre-caret native IME
anchor. Primary mouse, touch, and pen activation forces layout and safely
renews hidden-textarea focus; right, middle, and non-primary pointers do not
replace it. A fresh remote caret remains authoritative even after the 750 ms
recovery window. Composition and queued/in-flight text block focus renewal.
Browser tests cannot prove an operating system's candidate-window placement,
so each release still requires native-IME visual UAT; rc.21 passed that gate
on 2026-08-29.

Full XFCE now uses that status contract as well: orderly Logout appears as
`sessionState: stopped` with `applicationStatus.state: exited`, while an
unexpected exit remains `failed/error`. SDK 0.9 emits `sessionended` and closes
its channels without automatic reconnect after a clean application exit or
Logout. It checks terminal manager state before treating channel loss as a
reconnect error and emits at most once per instance/session generation. An
integrator should present a clear Reconnect/Start Session action;
reconnecting starts the next generation when the server layer was retained.

SDK 0.12 adds an explicit automatic reconnect budget. Use
`maxReconnectAttempts`; omit it or pass `Infinity`
to keep retrying, or pass a non-negative integer to cap automatic attempts;
`0` disables automatic attempts without changing `autoReconnect`. The initial
connection is not counted. A successful connection or an explicit `connect()`
or `reconnect()` begins a fresh budget. When a finite budget is exhausted, the
client remains disconnected, closes its channels, stops its reconnect timer,
and emits `reconnectexhausted` exactly once with `attempts`,
`maxReconnectAttempts`, and `reason`.
The built-in kiosk accepts the same limit through
`?maxReconnectAttempts=5`; use `Infinity` for an explicit unlimited value.

Important events are `statechange`, `instancechange`, `reconnecting`,
`reconnectexhausted`, `error`, `sessionended`, `diagnostics`, `resize`,
`cursorchange`, `textack`, and `inputevent`.

## Declarative component

```html
<remote-x-app
  class-id="mousepad"
  profile-ref="account-42"
  resize="class"
  resize-debounce="300"
  resize-max-wait="1000"
  max-reconnect-attempts="5"
  text-batch-delay="16">
</remote-x-app>
<script type="module" src="/sdk/index.js"></script>
```

Removing the element disconnects and destroys the browser client but does not
directly stop the instance. Normal class vacancy policy then applies. Add
`view-only` to disable input or `no-reconnect` to disable automatic reconnect.
The optional `text-batch-delay` attribute maps to the SDK option above.
`resize-debounce` and `resize-max-wait` map to the remote-resize scheduler;
call the element's `flushResize()` when an embedding UI detects gesture end.

## Included examples

- `/sdk/minimal.html` — full-window Web Component.
- `/sdk/console.html` — class catalog, launch, instance lifecycle, embedded
  client, reconnection and live diagnostics. Instance cards show application
  generation/state/revision/summary and refresh about every three seconds; the
  connected client's diagnostics panel shows the complete
  `applicationStatus` snapshot. It does not currently render a status timeline.

Type declarations are available from `/sdk/index.d.ts`.
