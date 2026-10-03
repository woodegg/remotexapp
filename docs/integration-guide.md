# Downstream integration guide

## Single-server runtime coordination (Core 0.13 / SDK 0.29)

WAOS implementers: start with the [Coordinator migration guide](waos-runtime-coordinator-migration.md)
for ownership, incremental adapter code, cold XFCE activation, logout,
restart/upgrade, dependency locks and the downstream acceptance checklist.

This candidate is opt-in; existing standalone Viewers need no migration.
Create one `RemoteXAppCoordinator({manager, scope})` per application/login in
each Tab, using the same non-secret login epoch across cooperating Tabs.
It manages one RemoteXApp server; do not combine multiple servers or audio
in this train. See [SDK examples and lifetime rules](browser-sdk.md#optional-runtime-keepalive-sdk-029).

The host owns one handle per desired window/controller interest. Use
`track(id, {sessionGeneration, keepAlive:true})` only when detached/background
retention is wanted, after activation of an on-attach App. Pass `runtime:handle`
to a Viewer for shared monitoring. Closing a window releases its own handle;
disconnecting its Viewer does not. Separate agent/workflow interests require
separate handles. On logout destroy the coordinator in every participating Tab
and clear the login scope. A new login epoch isolates old claims but does not
revoke an old Tab's server credentials; ordinary logout/auth revocation remains
the host's responsibility.

On `invalidated`, show that the old interest ended; do not silently bind a new
generation or relaunch. Explicit Stop/restart/upgrade and natural exit win.
Handle/Coordinator `leasechange` reports the granted outcome/deadline;
Coordinator `error` reports failures. Browser suspension is not reliable
background-service ownership. A lease is neither an authorization grant nor
a distributed lock.

Rollback: release handles/destroy coordinators and use the existing standalone
Client construction. Existing grants expire under the template policy; no
profile migration, App stop or Driver change is required. Do not centralize
Viewer IME, clipboard focus/prompts or fingerprints. WAOS adoption is a separate
repository task; this release changes no WAOS code.

## Declared App actions (Core 0.9 / SDK 0.26)

The candidate adds `manager.getActions(id)` and
`manager.invokeAction(id, action, parameters, {sessionGeneration, signal})`.
An already-connected writable `client.invokeAction(action, parameters, {signal})`
supplies its own runtime identity. See [App Actions contract and WAOS flow](app-actions-release.md).

For Firefox 2.2.0 / Edge 1.1.0, ensure/create the singleton with a neutral start
page, attach a Viewer, wait until `applicationStatus.state === 'ready'`, then:

```js
await client.invokeAction('openUrl', {
  url: 'https://example.com', disposition: 'new-tab'
});
```

Do not pass the same target as both `startUrl` and `openUrl`, or automatically
retry a failed mutation: the new tab may already exist. A successful result
contains `instanceId`, `sessionGeneration`, `action` and `result: {tabId, url}`;
it means browser acknowledgement, not successful website loading. Existing
pins without this action need an explicit upgrade; no action starts/restarts
the app. Firefox returns `control-busy` while another BiDi controller owns it.
WAOS needs no new raw CDP/BiDi service. Normal Manager authentication applies.

## Existing clipboard integration

RemoteXApp 0.5 supports browser applications through SDK `0.21.1` served by the
manager, including opt-in clipboard APIs without changing App Package ABI V1.
Deploy the application and RemoteXApp behind the same authenticated TLS reverse
proxy, then import the stable entry point:

```html
<div id="desktop" style="height: 720px"></div>
<script type="module">
  import { RemoteXAppManager, RemoteXAppClient } from '/sdk/index.js';

  const manager = new RemoteXAppManager();
  const instance = await manager.createInstance({
    templateId: 'mousepad',
    profileRef: 'customer-42',
  });
  const client = new RemoteXAppClient({ manager, instance, container: '#desktop' });
  await client.connect();
</script>
```

The same-origin deployment is part of the supported 0.4 contract. The server
does not ship a permissive CORS policy, and the SDK package is deliberately not
published to npm. Do not copy repository SDK source files or hard-code
content-hashed `/assets/` URLs. Those are release internals; `/sdk/index.js`
selects the matching SDK and noVNC assets.

RemoteXApp can be mounted below a same-origin path without SDK configuration:

```js
import { RemoteXAppManager } from '/tools/remotexapp/sdk/index.js';
const manager = new RemoteXAppManager();
```

The module location supplies `/tools/remotexapp` to API, asset, viewer, health,
RFB, and input URLs. Configure the reverse proxy to strip that prefix before
forwarding to `remotexappd`. An explicit
`new RemoteXAppManager({baseURL:'/tools/remotexapp'})` remains available for
unusual embedding or test arrangements. Base-path support remains same-origin
and does not enable CORS.

## Clipboard consistency in 0.10

Use SDK `0.27.0` with upgraded Core `0.10.0` runtime gateways for guarded
prompt approval. Updating only the Manager does not upgrade existing runtime
pins. WAOS keeps one Client and optional prompt controller per Viewer; no
shared coordinator or App-specific changes are needed.

Each direction retains only its latest prompt. Recovered history does not
re-prompt; the initial remote snapshot is available manually through `list()`.
Yes revalidates the source and observed destination. If either changed, show
the SDK error and let the user review/choose again—do not silently retry an old
approval. Auto mode defers independent two-sided changes or unknown state to
explicit choice. Timestamps are only for expiry.

For custom direct uploads, capabilities expose `consistencyVersion`, `sequence`
and `settled`. Pass `expectedSequence` to `sendClipboardOffer()` (or `send()`)
to guard the observed destination; HTTP 409 requires refreshing state and
consent. An unset precondition remains an explicit unguarded payload upload.
These checks are not atomic with external OS clipboard changes; see the
[consistency contract](clipboard-prompt-consistency-release.md).

## Clipboard integration in 0.4

Clipboard synchronization is opt-in per Viewer and per direction. A custom
consumer can provide explicit content without browser clipboard permission:

```js
await client.clipboard.send([
  { type:'text/plain', data:'Hello' },
  { type:'text/html', data:'<b>Hello</b>' },
], { action:'set' });
```

For browser-local synchronization, configure `manual`, `prompt`, or `auto` only
after a user action. `prompt` is the recommended default. `auto` requires prior
permission and otherwise becomes `prompt`. Use
`RemoteXAppClipboardPrompts` for the standard UI or handle the clipboard events
yourself. Every remote offer is broadcast to every attached Viewer; acceptance
is non-consuming and dismissal is local to that Viewer.

Call `client.clipboard.checkAccess()` to inspect support and permission state
without reading or writing. A button may call `requestReadAccess()` directly to
trigger and verify browser read authorization; the SDK discards the result and
does not upload it. There is no non-destructive write probe, so verify write
access only when an actual remote offer is copied with `syncToLocal(offerId)`.

Serve the embedding page, SDK, API, RFB, input, and clipboard routes from the
same authenticated HTTPS origin. The existing inferred base path applies to
clipboard URLs as well. Browser Clipboard API access is not reliable on plain
LAN HTTP; `localhost` is treated as trustworthy for local testing. Content is
transient and must not be copied into URLs, logs, diagnostics, application
status, launch parameters, local storage, or crash reports.

SDK `0.21.1` retains per-Client input activity for multi-window consumers. Keep
one Client and one prompt controller per Viewer; do not create a shared
clipboard coordinator. A pointer or keyboard event over the remote canvas
activates its Client automatically. When application window chrome or keyboard
navigation selects a Viewer, call `client.focus()`. Call `client.blur()` when
explicitly minimizing it. Only the active Client checks local clipboard and
its `client.clipboard.snapshot().inputActive` field reports that state.
Remote-to-local offers still reach every attached Viewer independently.

The optional standard prompt controller owns every descendant it creates.
Size and position the container passed to `RemoteXAppClient`, but do not apply
wildcard child rules such as `viewer > *` to SDK-created nodes. SDK `0.21.1`
defensively keeps ordinary non-`!important` sizing rules from stretching its
prompt stack; it cannot isolate that DOM from hostile same-page CSS or
JavaScript. Consumers needing a custom presentation should omit the standard
controller and render from public clipboard events.

## Lifecycle choices

Use `createInstance()` or `launch()` for disposable work. Use
`createManagedInstance()` when an operator needs a durable identity, explicit
desired state, and controlled lifecycle. Both managed and anonymous active
runtimes have durable manifests. Manager restart adopts a complete healthy
runtime on its locked driver without replacing its application or unit PIDs;
the SDK reconnects browser channels. An unhealthy runtime without a live
application is rebuilt under the same ID from that locked snapshot; a live
session is preserved for graceful host policy. Only an explicit stop/start
selects the current driver catalog.

SDK `0.24.0` also provides explicit `upgradeAndRestartInstance()` and bound
`client.upgradeAndRestart()` operations, with current/available version records,
durable failure status and generation/target guards. See the
[runtime upgrade guide](runtime-upgrade-api.md) before integrating a destructive
upgrade action. Do not implement it as separate client-side stop/create requests.

To restart a running managed or anonymous runtime without upgrading it, send
the current generation through the additive SDK method:

```js
const current = await manager.getInstance(instanceId);
const restarted = await manager.restartInstance(instanceId, {
  sessionGeneration: current.sessionGeneration,
});
```

This is one server transaction, not a client-side stop/create sequence. It
retains durable launch intent, identity, profile, parameters, allowed
overrides, locked App/core snapshot, and allocated ports. A stale generation
fails before shutdown. Graceful-shutdown blocking returns an error; only an
explicitly confirmed second call with `force:true` may discard unsaved work.

Template `parameters` are the only application-specific launch input. They are
validated by the manager and delivered consistently to server, session, and
shutdown drivers. Clients cannot supply HOME, D-Bus, Xauthority, executable,
or unrestricted host-path values. A template may explicitly declare a `file`
parameter; those paths must resolve to readable regular files under the
operator's document-root allow-list.

For trusted internal workflows, the LibreOffice template accepts `filePath`
and returns its loopback API endpoint number:

```js
const instance = await manager.createInstance({
  templateId: 'libreoffice',
  parameters: {filePath: '/srv/remotexapp-documents/report.odt'},
});
console.log(instance.resources.control.port);
```

The port is for a same-host trusted control component; it is not reachable
through the RemoteXApp reverse proxy. Downstream browser products should use
an authenticated, allow-listed server API rather than expose raw UNO.
Creation waits for the exact document to become visible and UNO-ready. Normal
LibreOffice instance stop intentionally discards unsaved changes and removes
the document lock without opening save UI; call an allow-listed UNO save
operation and verify its result before stopping when edits must persist.

For one shared Firefox profile that must consume no server resources after a
long vacancy, use the unmanaged singleton template rather than a managed
registration:

```js
const instance = await manager.createInstance({
  templateId: 'firefox-esr',
  parameters: {startUrl: 'https://example.com'},
});
```

The first attachment starts Firefox ESR. Six hours after the last detach the
complete runtime ends; calling `createInstance()` later returns a new runtime
that reuses profile `default`. All clients share cookies and authenticated
browser state, so they must belong to the same trust domain.

After attachment and a current-generation
`applicationStatus.state === 'ready'`, trusted same-host automation reads the
persisted allocation from `instance.resources.control` and the WebSocket URL
from `applicationStatus.details.control.endpoints.webSocketUrl`. Validate that
the two loopback address/port values match. These values describe a host-local
endpoint, not a browser or reverse-proxy URL. WebDriver BiDi has no separate
RemoteXApp authentication and must be wrapped by an authenticated,
allow-listed service if remote callers need automation.

Firefox supports one BiDi session at a time. Always send `session.end`, wait
for its success response, and only then close the WebSocket. If the automation
process dies and `session.status` reports `ready: false` without a known owner,
stop this anonymous instance and create it again; the Firefox process and
orphaned session end, while profile `default` remains persistent.

## Security boundary

The reverse proxy must remove any client-provided identity header and insert
the authenticated identity. Every identity accepted by one manager can operate
all instances owned by that manager's Unix account. Use a separate Unix UID or
container for mutually untrusted tenants.

`xfce-user-desktop` and `runMode: user-home` are supported only for a persistent
singleton managed registration running under the same dedicated or approved
real Unix account whose HOME, D-Bus, and Xauthority they use. They do not
permit caller-selected HOME or cross-user access. Ordinary printable ASCII
reaches secure dialogs through RFB. Non-ASCII input into a remote widget
without an IBus input context is not supported.

The EXP-007 application-environment endpoint is deliberately experimental and
secret-bearing. Its presence in a build is not part of the stable 0.3
compatibility contract; ordinary integrations must not depend on it.

See [the browser SDK reference](browser-sdk.md), [release policy](release-policy.md),
and [operations runbook](operations.md) before production integration.
