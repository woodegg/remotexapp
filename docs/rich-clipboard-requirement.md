# Bidirectional Rich Clipboard Release Train

**Status:** CLP-001 through CLP-017 accepted on 2026-09-02. The complete
automated/local train, exact rc.3 real-browser authorization check, and Human
UAT passed. Annotated `v0.4.0-rc.3` is published as a checksum-verified GitHub
prerelease and approved for promotion without functional changes to stable
`v0.4.0`. Annotated `v0.4.0` is now published as the normal checksum-verified
Latest GitHub Release. No local or sandbox deployment is authorized.

**Target release:** RemoteXApp `0.4.0`, SDK `0.20.0`, App Package ABI
V1 unchanged.

The original lock authorized implementation, complete automated and local real
X11/browser E2E, and deployment only to local `0.0.0.0:1991` for Human UAT.
The operator subsequently accepted UAT and separately authorized the GitHub tag
and Release. It still does not authorize a sandbox change.

This train creates one manager-mediated clipboard subsystem for both
`toRemote` (browser/local clipboard to the remote X11 session) and `toLocal`
(remote X11 clipboard to the browser/local clipboard). It is additive: the
accepted RFB physical-key split, browser paste through IBus, and
`RemoteXAppClient.sendText()` remain unchanged.

## Scope and terminology

The initial allow-list is:

| Representation | Maximum decoded bytes | X11 targets |
| --- | ---: | --- |
| Plain UTF-8 text | 4 MiB | `UTF8_STRING`, `text/plain`, `text/plain;charset=utf-8` |
| HTML UTF-8 | 4 MiB | `text/html` |
| RTF | 16 MiB | `text/rtf`, `application/rtf` |
| PNG | 64 MiB | `image/png` |
| Complete transaction | 80 MiB | Sum of all logical representations |

Multipart framing does not count toward the logical total but has a separate
bounded parser. PNG input must have a valid signature and IHDR and satisfy an
administrator-owned dimension/pixel ceiling. HTML and RTF are opaque clipboard
representations and are not rendered, sanitized, or transcoded by RemoteXApp.

Files, `text/uri-list`, directories, file upload, drag/drop, audio/video,
custom objects, and arbitrary MIME types remain outside this train. Clipboard
sync only updates the destination clipboard. `toRemote` sends a paste gesture
only when an authorized caller explicitly selects `action: "paste"`;
`toLocal` never pastes into another local application.

## Architecture and trust boundaries

The authenticated Manager is the external control plane. It validates the
instance, current positive session generation, ready active session,
direction, action, media types, quotas, caller authorization, and transaction
concurrency. It does not connect to X11 or retain clipboard bodies.

The pinned per-runtime Go gateway is the data plane because it already has the
correct non-root UID, display, Xauthority, focus validation, and XTEST
connection. Manager-to-gateway content transfer uses a mode-0600 Unix socket
below the runtime socket directory. The clipboard bridge should use the pure-Go
`github.com/jezek/xgb` protocol implementation and XFixes extension. It owns
selections for `toRemote`, monitors owner changes for `toLocal`, and implements
normal X11 Selection transfer plus `INCR` chunking. No template-ID or
application-protocol branch is permitted.

The existing `/input` WebSocket carries bounded event metadata and is opened
by every SDK Viewer, including view-only Viewers. Clipboard bodies never use
that JSON channel or the RFB clipboard extension; they use streamed multipart
Manager requests. All external URLs remain relative to the Manager base path,
so the existing same-origin reverse-proxy design and CORS policy do not change.

## Manager API and event protocol

The proposed public surface is:

| Method and path | Purpose |
| --- | --- |
| `GET /api/instances/{id}/clipboard/capabilities` | Return current generation, enabled directions, formats, limits, and event support. |
| `POST /api/instances/{id}/clipboard/offers` | Stream one `toRemote` offer as multipart with `set` or `paste`. |
| `GET /api/instances/{id}/clipboard/offers` | Recover metadata for unexpired offers after connect or an event-sequence gap. |
| `GET /api/instances/{id}/clipboard/offers/{offerId}` | Read bounded transaction metadata and state. |
| `POST /api/instances/{id}/clipboard/offers/{offerId}/accept` | Non-destructively accept one `toLocal` offer and stream its representations as multipart. |
| `DELETE /api/instances/{id}/clipboard/offers/{offerId}` | Cancel a caller-created `toRemote` transaction; dismissing a broadcast offer is client-local. |

Every call is generation-qualified. Offer IDs are unpredictable, but never
replace authentication or generation checks. `POST .../accept` is
non-consuming: more than one authorized Viewer may retrieve the same remote
offer before it expires.

The gateway sends only metadata events such as:

```json
{
  "type": "clipboard-offer",
  "offer": {
    "id": "clp_01...",
    "direction": "toLocal",
    "generation": 4,
    "sequence": 27,
    "sourceViewerId": "viewer_01...",
    "types": ["text/html", "text/plain"],
    "totalBytes": 18342,
    "createdAt": "2026-09-02T15:20:00Z",
    "expiresAt": "2026-09-02T15:21:00Z"
  }
}
```

Clipboard events use a per-runtime monotonic sequence and a reliable bounded
per-peer queue. A detected gap makes the SDK query the pending-offer API;
clipboard events must not use the lossy cursor-snapshot queue.

## `toRemote` flow

Manual callers may supply explicit items or ask the SDK to read the local
clipboard. In prompt or automatic modes, the SDK detects a local change and
creates a local in-memory offer; declined content never reaches the Manager.
On approval it streams the allowed representations to the Manager. The
gateway atomically replaces the prior owned transaction, advertises `TARGETS`,
and lets the application request its preferred form.

`set` establishes clipboard ownership. Its API offer has a bounded lifetime,
but the one current bounded X11 selection remains pasteable until replacement
or lifecycle cleanup. `paste` establishes ownership and then issues the
validated native paste gesture.
Only one gateway-owned `toRemote` transaction may be active per runtime.
Observable server states are `accepted`, `owned`, `requested`, `served`, and
terminal `not-consumed`, `cancelled`, `expired`, or `failed`. `served` proves
only that an application requested and received bytes, not that it inserted,
rendered, or saved them.

## `toLocal` flow and Viewer broadcast

The gateway uses XFixes to detect each authoritative remote `CLIPBOARD` owner
change. When at least one session Viewer exists, it snapshots the allowed
representations into one owner-only, bounded, transient offer so stacked
notifications remain actionable even if the application changes its clipboard
again. It then broadcasts the same `clipboard-offer` metadata to **every
Viewer attached to the current session generation**, including view-only
Viewers.

The snapshot is stored once, not once per Viewer. Acceptance is independent
and non-consuming: every Viewer may copy it to its own local clipboard, and one
Viewer's acceptance or dismissal has no effect on another. A newly connected
or reconnected Viewer retrieves any unexpired offers through the list API.
Client-side `off`, `manual`, `prompt`, or `auto` policy controls presentation
and action, not whether the authoritative gateway event is broadcast.

When Viewer A creates a `toRemote` selection, that selection change is still
broadcast to all Viewers. Its opaque `sourceViewerId` lets A suppress a
redundant sync-back prompt while B and C treat it as an ordinary remote offer.
The bridge ignores duplicate owner notifications for the same transaction,
and the SDK uses an in-memory representation fingerprint to suppress changes
caused by its own local clipboard write. Neither identifier nor fingerprint is
persisted or logged.

## Browser SDK contract

Clipboard operations live under one `client.clipboard` namespace rather than
adding application-specific methods to the client:

```js
client.clipboard.configure({
  toRemote: "prompt",
  toLocal: "prompt",
  checkOnFocus: true
});

await client.clipboard.syncToRemote({action: "set"});
await client.clipboard.syncToLocal(offerId);
client.clipboard.dismiss(offerId);
```

The SDK also exposes explicit-item `send`, pending-offer listing, and `offer`,
`statechange`, `permissionrequired`, and `error` events so host application and other
integrators can provide their own policy and UI. Both directions are
configured independently:

- `off`: ignore and retain no client-side offer state;
- `manual`: expose methods and events without monitoring or built-in prompts;
- `prompt`: monitor changes and require Yes/X approval for each transfer;
- `auto`: after explicit opt-in, transfer without per-change approval when
  browser permission permits, otherwise degrade visibly to `prompt`.

Permission inspection and acquisition are explicit public operations:

```js
const checked = await client.clipboard.checkAccess();

button.onclick = async () => {
  const result = await client.clipboard.requestReadAccess();
  console.log(result.access.read.state, result.access.read.verified);
};
```

`checkAccess()` queries capability and permission state without reading or
writing clipboard content. `requestReadAccess()` must be invoked directly from
a user activation. It performs one real read to request and verify access, but
does not decode, return, fingerprint, upload, or write back the content. The
operation returns structured state and marks `verified` only after a successful
read. Browser permission is not a promise of future access.

There is no dummy or read-then-write write probe. Writing the current clipboard
back could lose representations, race a newer user copy, mutate clipboard
history, or trigger feedback. Write permission is verified only when the user
accepts a real remote offer through `syncToLocal(offerId)`.

`prompt` is the required default for built-in automatic monitoring; it does
not move content before the user approves. `viewOnly` disables `toRemote`
actions but does not prevent receipt of `toLocal` broadcast metadata or an
otherwise authorized local copy.

## Browser capability and focus reconciliation

Clipboard access requires a secure context and remains subject to browser
permission and user-activation rules. The SDK detects `clipboardchange`, rich
`navigator.clipboard.read()`/`write()`, Permissions Policy, and available
representations. It never triggers a fresh browser permission prompt merely
because focus changed.

In `prompt` or `auto` mode, the SDK reconciles the local clipboard when the
top-level document gains system focus or changes from hidden to visible. This
does not run for internal DOM focus, `RemoteXAppClient.focus()`, or IME-host
refocus. Focus, visibility, and clipboard-change signals are debounced and
deduplicated by browser change ID where available, then by an in-memory
representation fingerprint. Without read permission, the SDK waits for an
explicit user action or a real paste event instead of repeatedly requesting
permission.

## Built-in prompt stack

The core SDK emits events and performs actions; an optional reusable prompt
controller supplies the built-in UI used by the shipped Viewer and
`RemoteXAppElement`. Custom consumers may omit it entirely.

Each pending change appears as a translucent full-width bar over the top of
the remote canvas. New messages are inserted at the top and older messages
move downward. Each prompt has Yes and X actions; X dismisses only that
Viewer's notice. The stack is bounded, exposes expired/superseded states,
briefly reports progress or success, never displays a payload preview, does
not steal remote keyboard focus, and is keyboard and screen-reader accessible.
The required text distinguishes:

- “Local clipboard changed. Sync it to the remote session?”
- “Remote clipboard changed. Sync it to this device?”

## Unified Console validation surface

The Unified Console is the built-in integration and UAT surface for this
train. Whenever it has an active Viewer, it exposes separate `toRemote` and
`toLocal` mode selectors for `off`, `manual`, `prompt`, and `auto`.
It also exposes manual “sync local to remote” and “sync remote to local”
actions, current browser capability and permission state, pending offer
metadata, and bounded success or error status.
An explicit “Authorize local clipboard read” action exercises
`requestReadAccess()` without sending content remotely. Mode changes use
`checkAccess()` and therefore cannot raise a permission prompt.

The Console imports and exercises the same public `client.clipboard` API as
The host application and other consumers; it must not call private bridge functions or add a
test-only backend route. Enabling prompt or automatic behavior requires an
explicit user action after the Viewer connects. The selection applies only to
that browser-side client and is reset by page reload, disconnect, or client
replacement. It never becomes an App parameter, query parameter, local/session
storage value, runtime manifest field, or Manager configuration value.

The Console renders the standard prompt stack over its Viewer and makes both
directions testable without developer tools. Automatic mode must visibly
degrade to prompt when browser permission is unavailable, while manual mode
must remain usable through its explicit buttons.

## Security and lifecycle

Content is untrusted, transient, and non-durable. Owner-only storage is bounded
per offer and per runtime. Payloads, previews, filenames, content hashes, and
representations must not enter journals, diagnostics, status, runtime
manifests, browser persistence, or crash evidence. Privacy-safe aggregate
type, size, latency, state, and error counters are permitted.

Offer bodies and API eligibility are cleared on bounded expiry or eviction.
The gateway may retain only the one current bounded, memory-only `toRemote`
X11 selection after its offer expires; it is removed by replacement, explicit
cancellation while the offer is valid, session exit, generation change,
runtime stop, or gateway failure. A clean clear retains an empty X11 tombstone
owner so a desktop clipboard manager cannot restore older content; an
application can take ownership normally. Recovery never replays an
ambiguous transfer. Public
`auth-mode=none` deployments fail closed unless an explicit insecure-public
clipboard opt-in exists; ordinary loopback development remains possible.

## Acceptance gate

Acceptance requires exact-limit and malformed-input tests, Go race tests,
stream cancellation, X11 target negotiation, XFixes change detection, `INCR`,
repeated requests, multi-Viewer fanout, event-gap recovery, focus
reconciliation, permission denial, feedback-loop suppression, replacement,
timeout, generation change, restart, and resource-exhaustion coverage.

Real E2E must prove both directions for plain text in Mousepad and XFCE, HTML
and PNG in LibreOffice, rich content in Edge and Firefox, multiple simultaneous
Viewers, reconnect recovery, view-only broadcast, and browser permission
fallback. Unified Console E2E must exercise every mode, both manual actions,
the prompt stack, reload reset, and permission fallback through the public SDK.
Human UAT was accepted on 2026-09-02 after the complete rc.1/rc.2 E2E record and
an exact rc.3 real-Chromium permission check. Formal GitHub publication was
separately authorized. Every sandbox or production deployment remains a
separately approved action; none is authorized by this acceptance.
