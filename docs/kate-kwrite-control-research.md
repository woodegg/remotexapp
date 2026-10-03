# Kate and KWrite: Separate App Packages and Verified Control Discovery

Research date: 2026-09-10. Scope: local experiments and next-train design, not
App implementation or deployment. Installed Ubuntu packages are separately
`kate` and `kwrite`, both `4:23.08.5-0ubuntu3` (application version 23.08.5).
Do not extrapolate these results to every KDE version without probing it.

## Findings

| Item | `kate` template | `kwrite` template |
|---|---|---|
| Executable | `kate --block --startanon` | `kwrite` |
| Service observed | `org.kde.kate-<actual PID>` | `org.kde.kwrite-<actual PID>` |
| Object path | `/MainApplication` | `/MainApplication` |
| Interface observed | `org.kde.Kate.Application` | `org.kde.Kate.Application` |
| Dedicated TCP/control port | None required | None required |

These are **two independently identified/versioned App Packages**, not one
template with an executable parameter. KWrite sharing the Kate interface is
intentional: upstream constructs the shared application in KWrite mode and
registers a multiple-instance D-Bus service. See the version-specific
[KWrite entry point](https://github.com/KDE/kate/blob/v23.08.5/apps/kwrite/main.cpp).

Kate's default startup daemonizes. The first experiment detected the launching
process exiting; using that PID would produce an invalid readiness/control
record. `--block` prevents detachment and `--startanon` requests a new anonymous
session rather than attaching to another Kate. KWrite does not support those
Kate-only flags and its entry point explicitly does not detach. See
[Kate startup](https://github.com/KDE/kate/blob/v23.08.5/apps/kate/main.cpp).

## What was actually tested

An Xvfb display and private D-Bus session hosted two Kate and two KWrite
processes concurrently, each with temporary HOME/XDG data. All four retained
distinct PIDs, service names and unique bus owners. For each, the probe:

- Checked the bus-reported service PID against the launched foreground PID.
- Found a visible process-owned X window and introspected `/MainApplication`.
- Called `tokenOpenUrl(fileURI, "UTF-8", false)` for a Unicode/space filename,
  then read the expected file contents back from the actual editor.
- Called `setCursor(1, 2)` successfully.
- Called `openInput(text, "UTF-8")` and read the exact Chinese/text content back.
- Submitted the discovered descriptor with the installed `0.6.0-rc.1` status
  helper, verifying matching private/public revisions, mode 0600, exact private
  payload and no service-name leakage into public status.

All four passed. Temporary application processes were killed without saving;
original fixture files were unchanged. Existing RemoteXApp runtimes were not
used for these experiments. See the [reproducible probe](../tests/experiments/kde-control/README.md).

This proves application discovery/control and helper submission, **not yet** a
Kate/KWrite App Package to Manager API end-to-end test: neither package exists
yet. That integration remains a release acceptance gate.

## Driver discovery and readiness

Use the runtime's provided DISPLAY/Xauthority and private session D-Bus, not
the default user bus. Launch the selected executable with its correct flags,
record the canonical foreground application PID, and retain normal cgroup /
process-start identity checks. Never choose the first system-wide editor.

Use `ListNames`, filter the appropriate service prefix, resolve `GetNameOwner`,
and verify `GetConnectionUnixProcessID` on that unique owner. The PID suffix is
only a discovery hint, not proof of ownership. Require exactly one matching
owner; verify it is still live/current before publishing. Introspect the unique
owner, validate the object/interface and required method signatures, and make a
non-mutating property/Peer call. Require a visible process-owned editor window.
Do not call `openInput` merely as a readiness probe: it creates a document.

Optional initial `filePath` is separately validated as an authorized readable
regular file, passed as a quoted argument/encoded local file URI, and tested for
real content readiness. Never use `--tempfile` or `isTempFile=true`: those can
delete the supplied file. No-file Kate must deliberately produce the promised
blank editor rather than assuming its welcome view is a document.

## Submission contract

Each template declares `session.status.privateDetails.application` as bounded
JSON, e.g. `maxBytes:4096`, `maxDepth:4`, `maxItems:32`; do not simultaneously
declare public `details.control`. Driver constructs JSON with a JSON encoder
and calls the existing helper:

```sh
session_status_report --state ready \
  --detail-string application=kate \
  --connection-application "$verified_connection_json"
```

Use `application=kwrite` in the other template and declare that public string
field in its schema. Example **private** application payload:

```json
{
  "protocol": "dbus",
  "service": "org.kde.kwrite-12345",
  "uniqueName": ":1.7",
  "objectPath": "/MainApplication",
  "interface": "org.kde.Kate.Application"
}
```

Values are discovered per launch, not literal constants from this example.
The helper separately reports the actual bus address/scope from the driver
environment. The existing protected SDK `manager.getConnections()` returns
`environment.sessionBus` plus this `application` payload. The trusted local
Agent verifies ownership and uses the unique bus destination. Refetch after
generation changes, owner loss or bus reconnection; unique names are only
unique within one bus lifetime. A recorded bus `GetId` may additionally guard
Agent reconnection. No new core App-specific branch, TCP proxy or public
Viewer credential is necessary.

## Limits and remaining acceptance

`openInput` creates a **new** document; it is not arbitrary insertion into the
active document. `tokenOpenUrl` returns an opaque document token, not a D-Bus
document object path. The application adaptor does not provide an UNO-like
document read/edit/save model. Qt action objects also appeared in introspection,
but their UI-dependent paths and save behavior are not a verified stable
automation contract for this train. See the
[adaptor contract](https://github.com/KDE/kate/blob/v23.08.5/apps/lib/kateappadaptor.h)
and [implementation](https://github.com/KDE/kate/blob/v23.08.5/apps/lib/kateappadaptor.cpp).

Agents directly controlling applications can open files beyond initial Manager
document roots; those roots are launch validation, not a filesystem sandbox.
Do not present a capability list as enforcement of raw D-Bus access.

Before release, test each real package through `getConnections()`, optional-file
and blank UI behavior, readiness failures, changed bus owners, restart/adoption,
multiple isolated runtimes, destructive normal/idle stop, no auto-save/stash
restoration surprises, Matchbox/IBus/input/resize/clipboard and dependencies.
Lifecycle target for both: isolated non-singleton, Matchbox, immediate start,
1280x720/16-bit/10 FPS dynamic display with resize, 60-second detached stop-instance,
and forceful no-save application shutdown. No production templates were added
by this research.
