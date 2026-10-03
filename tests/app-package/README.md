# App Package ABI V1 acceptance

For ACT-001–008, `node tests/app-package/run-actions-local-e2e.mjs` runs a
disposable Manager on loopback 21995 with its own packages, profiles and state.
It tests real Edge/Firefox tabs, foreign BiDi ownership, shipped Console forms,
a newly packaged synthetic action without rebuilding, serialization, lifecycle
cancellation/process cleanup and Manager adoption. Set
`REMOTEXAPP_SHIPPED_E2E_RELEASE_ROOT` to test extracted candidate bytes.
The exact-candidate gate runs it automatically. It never attaches to or stops
deployed user runtimes. Portable API/SDK/Console tests also run in `make check`.

Unit tests cover schema, ownership, permissions, archive safety, digest,
activation, rollback, resources, bounded status and dependency failures.
Package-owned tests live below `apps/<id>/tests/`.

After one `make build`, run the isolated live acceptance test:

```bash
tests/app-package/run-local-e2e.sh
```

It uses loopback manager port 21991 and a temporary package/state root. It
installs and launches neutral package 1.0.0, probes its real visible X11 App and
loopback protocol, restarts the manager and adopts the same runtime, activates
1.1.0 without rebuilding, proves the live runtime remains pinned, launches a
new 1.1.0 runtime, then disables and rolls back to 1.0.0. The three core binary
hashes must remain unchanged. The script never deploys to a sandbox.

`make live-e2e` additionally exercises the shipped Apps. FFX-007 uses
`tests/go-live-validation/check-firefox-ime.mjs` for Firefox application
readback (not ACK-only): ASCII/Unicode, RFB, tab/window focus, native chrome
focus return, Viewer reconnect and BiDi lifecycle. The harness repeats this
against a reused profile seeded with the old preference and after runtime
restart. Dependencies include real Firefox ESR, Chrome as Viewer, X11,
TigerVNC, Matchbox, IBus and the user's systemd bus. Use an isolated test
account/state; the script's temporary profiles are disposable.

`node tests/app-package/run-lightview-local-e2e.mjs` is the isolated LightView
gate on port 21996. It covers deterministic packaging, dependency failure,
package-only rollback, shared Viewers, private Unix control, low-memory policy,
Viewer input/clipboard/resize, bounded `openUrl`, Manager adoption, restart,
crash and stale-socket recovery, substitution rejection, profile continuity,
native exit and accelerated vacancy cleanup. The current development container
cannot run WebKit's bubblewrap sandbox, so the harness temporarily sets the
documented WebKit test override in the user manager and restores its exact prior
environment on exit. That override is never part of the App Package.
## Optional documents and private connection metadata

`node tests/app-package/run-document-local-e2e.mjs` uses isolated local port
21992 and temporary state. It tests optional-file rejection/readback, no-save
Mousepad stop, explicit save, instance isolation, synthetic private D-Bus
control and non-disclosure, Manager adoption/restart, no-file LibreOffice/UNO
and the real 60-second vacancy. Requires the same local systemd/X11/application
dependencies as the shipped-App harness plus gdbus and openssl. No installed
Manager is replaced. Both `make live-e2e` and exact-candidate acceptance run it.
