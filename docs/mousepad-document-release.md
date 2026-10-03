# Optional Document Launch and Agent Connection Information — Next Release Train

Status: scope locked by the operator on 2026-09-10. MPD-001 records the operator's request to make
Mousepad closer to the LibreOffice document template, with optional `filePath`.
LOF-001 adds optional `filePath` to LibreOffice in the same train.
CONN-001 adds a protected, generic connection-information API and SDK reader
for trusted local Agents; it does not add an application-control service.
Target Core `0.6.0-rc.1`, SDK `0.23.0`, Mousepad `3.0.0`, LibreOffice
`3.1.0`; other App Packages are unchanged. Implementation, full testing and
deployment to local `127.0.0.1:1991` and `127.0.0.1:2992` are authorized.
No sandbox or publication is authorized. Existing runtimes retain their pins.
The accepted 0.5.4 train remains closed.

Implementation and exact-candidate automated acceptance completed; the candidate
is deployed to both authorized local endpoints. Human UAT is pending. See
[deployment evidence](../tests/evidence/v1/document-connections-0.6.0-rc.1-local.json)
for checks. The separately approved local desktop replacement subsequently
closed the fresh user-home connection coverage gap; see
[XFCE follow-up evidence](../tests/evidence/v1/document-connections-xfce-0.6.0-rc.1-local.json).

## Locked configuration (pre-train baseline versus target)

| Setting | Current Mousepad | Proposed Mousepad | Current LibreOffice |
|---|---|---|---|
| File parameter | None | Optional `filePath`, type `file`, maxLength 4096 | Required `filePath` |
| No file supplied | Blank editor | Blank editor | Rejected |
| Supplied file | Not supported | Open existing authorized readable regular file | Open authorized document |
| Session activation | on-attach | immediate | immediate |
| Display | Dynamic 1280x720, 16-bit, 15 FPS | Dynamic 1280x720, 16-bit, 10 FPS | Dynamic 1280x720, 16-bit, 10 FPS |
| Resize | Allowed | Retain allowed | Allowed |
| Vacant lifecycle | 5 seconds, stop-instance | 60 seconds, stop-instance | 60 seconds, stop-instance |
| Isolation / singleton | Isolated ephemeral HOME / false | Unchanged | Same |
| Window manager | Matchbox | Unchanged | Matchbox |
| Ready condition | Visible process-owned window | Visible editor window; verify requested-file readiness in implementation tests | Document and UNO ready |
| Control resource | None | None; `resources: {}` | Dynamic loopback UNO |
| Shutdown | Graceful window close | Confirmed: destructive no-save stop | Destructive no-save stop |

Optional file launch and destructive no-save shutdown are confirmed requirements;
the operator's lock accepts immediate activation, 10 FPS and 60-second vacancy.
Geometry, frameRate and allowClientResize remain the only
instance policy overrides. Keep `mousepad --disable-server` so another process
cannot receive the launch request.

## Optional file semantics

Omit `filePath` to open a blank document. An explicitly empty string, null,
invalid type, missing file, directory, unauthorized path or unreadable file
must fail clearly, not silently open a blank editor. Reuse the existing
Manager `file` parameter and configured document roots; check the resolved
file again in the driver before launch. Quote the argument and treat it as a
path, never executable shell text. This version does not create missing files
or accept a list of files.

## Confirmed shutdown policy

This section specifies Mousepad's change; LibreOffice retains its existing
destructive no-save shutdown policy.

The operator explicitly selected forced exit without saving, superseding the
earlier graceful-close recommendation. Manager-initiated stop, including the
vacancy action, must terminate the instance's application without sending
Ctrl+S, invoking save, or waiting for a save/discard/cancel dialog. Unsaved
changes are discarded; users must explicitly save before stopping if needed.
This must work for a normal stop request, not only an API `force:true` request.
Scope termination and cleanup to this instance; never kill another Mousepad
instance or delete the original document. This policy does not disable normal
in-application manual saving or redefine the application's own close UI.

## LOF-001 — LibreOffice optional filePath

Confirmed requested scope: make `parameters.filePath` optional, retaining the
existing `file` type and 4096-character limit when supplied. Omission alone
means no initial document; explicitly empty, null or invalid values must not
silently fall back to the no-document path.

Locked no-file behavior: show LibreOffice Start Center,
not an arbitrarily selected Writer/Calc/Impress document. Users can choose a
document type or use the existing UNO control endpoint. Do not add a new
document-type parameter in this increment.

| Case | Proposed behavior |
|---|---|
| `filePath` omitted | Start Center; visible process-owned window plus usable UNO Desktop service required for ready; an active file document is not required |
| Valid `filePath` supplied | Preserve current document-root validation, driver recheck, document lease, stale-lock handling and requested-document UNO readiness |
| Invalid/unreadable/unauthorized path | Explicit error, never silently launch Start Center |
| No-file stop | Force exit without saving; skip initial-document lease/lock cleanup because none was acquired |
| File-backed stop | Preserve scoped destructive exit and exact owned document lock/lease cleanup |

UNO address, dynamic port allocation and returned control metadata are unchanged.
Keep isolated non-singleton operation, immediate activation, 1280x720/16-bit/
10 FPS, client resize and 60-second vacancy. Do not derive a lock path from an
empty string or search/delete unrelated locks. Files later opened or saved via
UI/UNO do not automatically acquire the initial-file lease; this change does
not promise a new sandbox or generic tracking of all later documents.

Creation examples:

```json
{"templateId":"libreoffice"}
```

```json
{"templateId":"libreoffice","parameters":{"filePath":"/srv/documents/report.odt"}}
```

## CONN-001 — Unified connection information for trusted local Agents

Provide one consistent connection descriptor. A trusted Agent running on the
same host connects to the actual application protocol and performs operations;
RemoteXApp only describes connections. There is no control proxy, generic RPC,
browser-to-Unix-socket bridge, or Manager/SDK application-specific adapter.

Implemented API: `GET /api/instances/{id}/connections`. SDK method:
`manager.getConnections(instanceId, options)`, with typed response, cancellation
and explicit permission/unavailable/stale-generation errors. When the caller
supplies its expected session generation, reject a mismatch. Validate readiness
and generation consistently across the entire response; do not mix values from
different sessions. Locked authorization uses `-connections-token-file` /
`REMOTEXAPP_CONNECTIONS_TOKEN_FILE`: an owner-only regular file containing a
random 32-byte token encoded as 64 hex characters. Unset disables the endpoint.
Caller supplies `X-RemoteXApp-Connections-Token`; SDK accepts it per call via
`options.token` without storage. This is additional to normal Manager auth.
The token authorizes connection reads across this Manager's runtimes; use
separate Managers/UIDs for separate trust domains. Restart Manager to rotate.
Never put this credential in browser storage, URLs, templates or Driver env.
Missing/invalid credentials return 403, invalid generation 400, unknown ID 404,
and not-ready/stale/invalid metadata 409. Successful replies are no-store.
Revision is an opaque content hash (stable across Manager adoption).

Illustrative response for a template-declared private D-Bus application
(Kate remains an example, not a shipped package):

```json
{
  "schemaVersion": 1,
  "instanceId": "kate-example",
  "sessionGeneration": 3,
  "revision": "opaque-content-hash",
  "state": "ready",
  "environment": {
    "display": ":12",
    "xauthorityPath": "/run/user/1000/example/Xauthority",
    "sessionBus": {
      "address": "unix:path=/run/user/1000/example/bus",
      "scope": "runtime"
    }
  },
  "application": {
    "protocol": "dbus",
    "service": "org.kde.kate-12345",
    "objectPath": "/MainApplication",
    "interface": "org.kde.Kate.Application"
  }
}
```

Sources and ownership:

- Manager supplies runtime ID, generation and its resolved Display/Xauthority
  configuration. Never return Xauthority cookie contents.
- Driver reports the actual session D-Bus address and whether its scope is
  `runtime` or shared `user`; never infer a bus from the display number. In
  user-home XFCE, other services on the user bus need not belong to this runtime.
- Template declares schema/visibility and Driver reports runtime application
  values. Reuse existing `resources.control` allocation and
  `applicationStatus.details.control` for Edge, Firefox and LibreOffice;
  `application` is a projection, not a separately maintained copy. Retain
  existing protocol names, addresses, ports and endpoint fields.
- Support declared bounded private Driver connection metadata for D-Bus and
  similar local details, with generation and size/depth/type validation. It
  must not leak into ordinary instance/status/Viewer responses or broadcasts.
  Avoid duplicate public/private authorities for the same control value.
- For XFCE and Mousepad, omit `application`: no dedicated application-control
  endpoint exists. A ready descriptor may still contain environment information.
  Kate/KWrite illustrate the D-Bus shape, not authorization to add their templates.

Access requires an explicit connection-information read capability, not merely
Viewer access, loopback source, `expose-internals`, or an insecure-public switch.
The separate capability token is the minimal authorization mechanism; normal
Manager authentication alone does not separate Agents from Viewers. Deny by default
and return `Cache-Control: no-store`; do not log descriptors or return a complete
process environment. EXP-007 remains a separate API and is not the source of a
public secret-bearing environment dump. Existing public control fields remain
compatible; this new endpoint does not retroactively protect those fields.

Use generation plus descriptor revision to identify changes. Invalidate stale
metadata on session stop/restart or connection changes; Agent must refetch and
verify ownership/readiness when reconnecting. A descriptor is not a lease or
guarantee that the target remains alive after the response. Raw trusted-local
connections cannot be constrained by a JSON permissions field or revoked merely
by hiding the API. Reject unavailable/stale descriptors explicitly; do not
present a previous session's control address as ready. Older pinned Drivers may
lack private metadata; report that availability without guessing missing fields.

## Locked Mousepad choices

1. **Concurrent editing:** do not add document leases in the first
   increment; same-file concurrent edits would not be prevented. If strict
   exclusivity is required, add package-owned ownership and stale-lease
   recovery with dedicated tests before lock. Do not copy LibreOffice's
   application-specific lock-file deletion into Mousepad or delete locks
   belonging to other applications.
2. **Automation:** retain no control socket. Mousepad has no equivalent
   declared UNO resource; automatic save/control APIs are outside this train.

## Implementation boundary and acceptance

Expected scope is the Mousepad and LibreOffice App Package manifests, drivers,
LibreOffice readiness probe, package tests and documentation. Use new immutable
package versions; do not edit published Mousepad 2.0.0 or LibreOffice 3.0.0.
MPD-001 and LOF-001 do not plan Manager/SDK protocol changes. CONN-001 explicitly
adds a generic Manager endpoint, Driver metadata contract and SDK method/types,
with no application-specific core branches. If optional generic `file`
validation cannot express the agreed semantics, report that gap before
expanding the core scope. Existing runtimes retain their old package pins.

Test omitted/valid/empty/invalid paths, spaces and Unicode filenames, argument
safety, document-root rejection, unreadable/deleted/replaced files, and actual
editor content. Cover immediate launch with no Viewer, pre/post-60-second
attach, last-Viewer detach, reconnect, modified-document normal/API-force/idle
stops, app exit, Manager adoption and scoped cleanup. Prove that modified
documents stop without waiting for a save dialog, original file bytes remain
unchanged unless manually saved, and other instances survive. Verify input,
clipboard, resize and package install/update/rollback. For LibreOffice, test
no-file visible readiness and working returned UNO control, unchanged file-backed
readiness, invalid-file rejection, parallel blank/file-backed instances,
modified untitled-document stop without save, no-file Manager adoption/restart,
no bogus lock cleanup and preservation of existing file-backed lease recovery.

CONN-001 acceptance covers all five shipped templates and a synthetic D-Bus
package: exact endpoint projection, no application object where appropriate,
private versus user-shared bus scope, missing/invalid/oversized private metadata,
unauthorized access and absence of leaks through existing APIs/events/logs,
generation races, descriptor revisions, stop/restart/adoption, older pinned
Drivers, SDK errors/cancellation and unchanged existing control consumers.
Demonstrate a trusted local Agent connecting to reported D-Bus and existing
CDP/BiDi/UNO endpoints, without changing production runtime architecture or
exposing a remote control proxy.
Human UAT remains pending after automated acceptance and both approved local deployments.

## Local UAT checklist

Use newly created runtimes: existing runtimes keep their old Drivers and helpers.
On local 1991 use `/sdk/console.html`; local 2992 keeps Console disabled and
supports API/SDK launch plus each runtime's `/remotexapps/{id}/kiosk.html`.

1. Launch Mousepad with no parameters, then with an existing authorized file.
   Modify text and use Stop: there must be no save prompt, and unsaved changes
   must be discarded. Separately save explicitly and confirm that save persists.
2. Launch LibreOffice with no parameters: expect Start Center, then choose a
   document type. Also check an existing document and ordinary destructive Stop.
3. From a trusted local Agent, use `manager.getConnections()` with the separate
   Manager token. Confirm D-Bus/X11 access and existing UNO/CDP/BiDi descriptors.
   A Viewer without that capability must receive 403. Never paste the token
   into a Viewer, URL, browser console or issue report.

Local token files are `$HOME/.config/remotexapp/connections-1991.token` and
`connections-2992.token`, mode 0600; user-service drop-ins configure their paths.
The test App catalog is user-owned: install/activate its packages as that user,
not root. The centrally installed 1991 catalog uses the root installer. Keep
both listeners loopback-only and retain current Console/kiosk policies.
