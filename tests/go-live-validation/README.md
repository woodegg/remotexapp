# Live validation harnesses

These harnesses validate specific scenarios on provisioned Linux/X11 hosts.
They do not certify a live deployment merely because its health route answers.
Historical operational diaries are retained privately; public records describe
reproducible tests, conclusions and limitations.

## Choose the appropriate suite

| Change | Harness or guide |
|---|---|
| Package installation and immutable pins | [App Package acceptance](../app-package/README.md) |
| Shipped-App Viewer/input/control | `tests/app-package/run-shipped-local-e2e.sh` and App-owned tests |
| Firefox IME and raw keys | `tests/go-live-validation/check-firefox-ime.mjs` |
| Session services, adoption and component faults | [Session state matrix](../session-services/README.md) |
| Managed session recovery | [Recovery matrix](../../docs/managed-session-recovery-release.md#acceptance-matrix) and colocated Core tests |
| Boot markers and document storage | [Boot recovery](../boot-recovery/README.md) |
| Host dependencies and Mousepad compatibility | [Host checks](../host-dependencies/README.md) |
| Clipboard and Coordinator | SDK tests plus [idle-lease acceptance](../idle-lease/README.md) |
| Performance regression | [Performance register](../../docs/performance-experiments.md) |

Check the referenced script's arguments before running it. Use the
[exact-candidate harness](../../docs/development-quality-process.md#build-once-and-promote)
for release qualification rather than checkout binaries.

## Environment and ownership

Live checks require the relevant real applications, TigerVNC/X11, D-Bus/IBus,
a browser and the configured backend. Some suites require a disposable Unix
account and sudo to provision it. Run live Manager suites serially: X displays
are host-global even when HTTP ports differ. Bind test Managers to loopback.

Fault injection and cleanup must own only disposable test accounts, units,
processes and runtime IDs. Singleton creation may return an existing runtime;
a successful create response does not prove cleanup ownership. Capture existing
IDs before a test and exclude them independently from mutation and cleanup.
Do not run fault tests against user documents or production gateways.

## Functional acceptance

Verify a real served Viewer connects and renders the App; plain ASCII keys,
shortcuts, committed Unicode, native IME switching and the first committed
character work; pointer and resize policy behave correctly; clipboard content
reads back in both directions; and reconnect restores usable channels.

Exercise normal exit/logout, unsaved-document shutdown policy, vacancy,
Manager restart adoption, explicit restart/upgrade, rollback and the specific
faults changed by the candidate. Status/connection records must agree on the
current runtime identity and generation. A transport ACK is not application
readback. A simulated boot-marker change is not a real host/container reboot.

## Evidence

Record the exact source and artifact identities, UTC timestamps, dependency
versions, scenario outcomes, skipped checks and cleanup ownership. Keep raw
sensitive logs, account paths and deployment topology outside the public tree.
Public summaries must retain failures and qualification limits and must not
include entered text, clipboard captures, credentials or user profiles.
Automated test success, human UAT, publication and deployment are separate
claims. Follow the [evidence contract](../../docs/development-quality-process.md#evidence-and-review)
and [production handover](../../docs/production-handover.md).
