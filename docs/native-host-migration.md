# Embedding-host migration to the native SDK

This guide implements the scope in [NHI-001 through NHI-010](native-host-integration.md).
It describes the reference workbench and the changes an embedding host must
make. It is not evidence that the downstream application has been changed or
accepted. Legacy SDK names and events are not compatibility requirements.

## Ownership and initialization

Create one `RemoteXAppHost` per authenticated login/server. Its `scope` is a
non-secret cross-Tab coordination namespace. Authorization remains with the
Manager; a scope is never a credential. Each window or background task calls
`open()` and owns its resulting `RemoteXAppSession`. A session owns a runtime
handle, any attached Viewers and explicitly acquired audio interests.

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

## Workflow changes

| Existing host responsibility | Native integration | Retained contract / host change |
| --- | --- | --- |
| SDK loader and capability/version checks | Load the served `index.js`; require `RemoteXAppHost` and the needed Viewer capabilities | Adapt exports and event handling; fail visibly when capability is unavailable |
| Browser window and shared profile | `host.open({templateId, parameters})`, then `session.actions()` / `session.invoke('openUrl', {url})` | Keep template singleton/profile semantics. Never replay an uncertain action |
| File-editor window | Map the selected host file on the host backend, then `host.open({templateId, parameters:{filePath}})` | Preserve canonical root mapping and editor classification. Manager independently enforces document roots |
| Restoring an editor | Validate saved template/path identity before `host.open({instanceId})` | An instance ID alone is insufficient proof that it represents the selected document |
| Managed desktop | `host.open({managedId})` | Respect desired/observed state, HOME and explicit stop. Recovery remains a distinct operation |
| Connection mask | Viewer `statechange`, `ready`, `reconnecting`, `reconnectstopped`, `reconnectexhausted` | Native ready already includes current App status and paint; remove duplicated legacy readiness inference |
| Hidden workspace/window | Retain the session and DOM Viewer; blur inactive input | Hidden is not closed. If the host unloads the Viewer, restore with `session.attach()` and re-establish clipboard consent |
| Background agent/task | A separate `host.open({instanceId, keepAlive:true})` handle | Closing a window cannot release the task's interest. Generation invalidation ends its authority |
| Close window | `session.release()` | Releases only this owner's display/audio/runtime references; does not stop a shared App |
| Close-and-stop editor | Explicit `session.stop()` followed by `session.release()` | Preserve unsaved-document veto. A stale generation cannot stop its replacement. Do not force automatically |
| Text/shortcut injection | `viewer.sendText(text)` / `viewer.sendKey(key, {modifiers})` | Native key path, no clipboard fallback; validate receipt target and perform App readback when required |
| Clipboard prompts | `configureClipboard`, `requestClipboardPermission`, manual directional actions | Replace legacy prompt/offer UI. Explain auto/manual/off, focus ownership, permissions and reset on reconnect |
| Speaker/microphone | `await session.audio()`, then explicit interest switches inside browser gestures | Prepare interest before the user enables playback/capture. Shared server transport remains separate from display sockets |
| Agent control endpoints | `session.connections()` and a trusted local executor | CDP, BiDi, UNO and D-Bus stay distinct, loopback-only protocols. Revalidate generation before control |
| Logout | `await host.logout()` | Release this host's windows/tasks and retire the authenticated audio login epoch |

The old input socket, IBus/Unicode injection ACK interpretation, remote-caret
positioning and old clipboard offer negotiation are removed from the Kasm
Viewer integration. They remain in the legacy provider. Do not retain two
clipboard or IME controllers for the same native Viewer.

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

All new Core native connections use generation/component-qualified, renewable
grants, including WSS-only components. Old Core builds lacking this capability
cannot promise server-enforced read-only attachment. There is no silent downgrade.

## Audio, clipboard and transport

An audio interest alone does not open transport. At least one session must
enable speaker or mic. Different sessions have independent switches; multiple
Tabs of the same session share its desired route, with explicit playback/capture
ownership. Removing a display does not remove its separately retained audio
interest. Capture cannot silently restart after a failure.

Native clipboard supports plain text, HTML and PNG within an aggregate 2 MiB.
It excludes file/folder transfer. Automatic directions require explicit opt-in
and browser permissions; only the active Viewer synchronizes. Empty local reads
preserve the remote clipboard, and conflicts remain visible rather than guessed.

Optional UDP changes screen delivery. WSS still owns the display connection and
control/input path; audio retains its independent multiplexed transport. The
deployment owner supplies the existing endpoint catalog and host forwarding.
This work does not introduce automatic multi-container UDP orchestration.
Display stats distinguish actual painted UDP from WSS, active RTT probes,
bandwidth counters, paint FPS and scoped display-block loss. Missing/stale values
are unavailable, never fabricated zeroes.

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
belong with the implementation evidence for Issue #57.
