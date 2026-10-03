# Unified operator console release train

Status: scope-locked 2026-08-31 and extended by accepted UAT correction
CON-010 on 2026-09-01; target `0.2.0-rc.10` with SDK `0.18.0`.
Implementation, complete local validation, and deployment only to local port
1991 are authorized. No sandbox deployment is authorized.

Rc.9 automated local acceptance completed. Evidence is in
[`unified-console-rc9-local-1991.json`](../tests/go-live-validation/results/unified-console-rc9-local-1991.json).
Human UAT rejected its flat managed-registration/runtime navigation. Rc.10
adds the locked ownership hierarchy and repeats affected acceptance before UAT.

The first local rc.6 candidate was rejected during runtime-restart E2E because
same-ID singleton recovery returned the old in-memory record. Its durable
manifest recovered correctly after manager restart. Immutability forbids
replacing rc.6 bytes, so rc.7 superseded that candidate with the conflict fix.
Real Chrome testing then rejected rc.7 because empty root prefixes were treated
as unmatched and produced a nested loader URL. rc.8 carries the corrected,
executable-tested compatibility path resolver.
Real user-systemd testing then rejected rc.8 because the strict helper waited
for request EOF while the manager waited for its response. rc.9 half-closes
the Unix request stream after one JSON object and retains the response stream.

Human UAT then rejected rc.9 because the operator sidebar rendered a managed
registration and its child runtime as peer cards and mixed anonymous creation
with managed registration behind a `Launch type` selector. Rc.10 does not
change either API object. It renders one managed application with nested
runtime details, lists only anonymous runtimes separately, and uses action
labels that state whether the operation creates, starts, connects, or
reconnects.

Rc.10 implementation and automated local acceptance are complete. The exact
artifact passed the repository, race, package, immutable staging, and real
Chrome gates. Evidence is in
[`unified-console-rc10-navigation-local-1991.json`](../tests/go-live-validation/results/unified-console-rc10-navigation-local-1991.json).
Human UAT was accepted on 2026-09-01. The Unified Operator Console train is
complete.

## Goal

RemoteXApp currently has separate root, SDK console, minimal example, and
per-instance kiosk pages. This train will replace their duplicated page logic
with one maintained web application. The application will select a constrained
dashboard, launch, or viewer mode for each entry route; sharing code must not
grant a kiosk user operator capabilities.

The console is an operational client of stable server APIs, not a security
boundary and not a replacement for the browser SDK.

## Required workflows

The unified console must:

- report core/SDK versions, health, enabled capabilities, templates, managed
  registrations, active runtimes, sessions, resources, application status,
  readiness, clients, generations, and actionable errors;
- build launch forms from generic App/template parameter and override metadata,
  including required values, defaults, validation constraints, and profiles;
- launch an App, connect or reconnect a viewer, disconnect, start or stop a
  managed registration, stop a runtime gracefully, and explicitly force a
  blocked stop after confirmation;
- restart an active runtime through one generation-qualified server operation
  that reuses its durable launch intent and locked component snapshot; restart
  is not an App upgrade and the browser must not reconstruct the launch request;
- follow long-running operations across a temporary connection loss and show a
  final success, blocked, failed, or timed-out result.

Operator navigation must expose the lifecycle hierarchy rather than the raw
API collections. A managed application is the durable operator object and its
current runtime is nested diagnostic state, never a second peer navigation
entry. Anonymous runtimes remain standalone. Creation, desired-state changes,
viewer attachment, and viewer reconnection use distinct verbs.

Application-specific protocols remain opaque. The console displays generic
`resources` and bounded application-status `details`; it must not add Edge,
Firefox, LibreOffice, or template-ID branches.

## Routes and exposure policy

One generated application and component set will serve the canonical console.
During the migration, `/`, `/sdk/console.html`, `/sdk/minimal.html`, and
`/remotexapps/{id}/kiosk.html` remain compatibility entry points into explicit
modes. Reverse-proxy base-path inference continues to apply.

`REMOTEXAPP_DISABLE_CONSOLE` and `REMOTEXAPP_DISABLE_KIOSK` remain independent
and authoritative. Viewer/kiosk mode exposes no catalog-wide, runtime-control,
or service-control actions. Hiding a button never substitutes for server-side
authorization.

## Service restart boundary

Restarting the manager is distinct from restarting an application runtime. It
is optional, disabled by default, and unavailable on an unauthenticated public
listener. The manager must never accept an arbitrary unit name, command, shell,
or privilege escalation.

The implementation requires an independently supervised, out-of-process
operator helper with a fixed allowlist for the current non-root RemoteXApp user
service. The operator endpoint must enforce an authenticated operator
capability, origin/request-forgery protections, rate limiting, and an audit
record that contains no App parameters or status secrets. The helper survives
the requested manager restart; the console waits for health and version
recovery and reports adoption or recovery failures. This is not a general
systemd administration interface and introduces no root orchestration.
The helper supports local and centrally installed user services. A dedicated
system service cannot safely self-restart without privileged orchestration, so
that deployment mode does not advertise this capability.

## Sensitive status

Ordinary polling may read only the established bounded instance status.
EXP-007's complete environment is secret-bearing and must never be fetched,
polled, logged, exported, or persisted automatically. If a later locked scope
includes it, retrieval requires a separate deliberate operator action, an
explicit warning, and the existing backend authorization checks.

## Acceptance gate

Before release, automated API and browser tests must cover:

- every compatibility route, root and reverse-proxy-prefix deployment, and the
  independent console/kiosk enablement matrix;
- generic parameter types, required/default/invalid values, profiles, locked
  overrides, and server-side validation;
- anonymous and managed launch, attach, stop, blocked graceful shutdown,
  explicit force, durable runtime restart, manager restart, reconnect, and
  operation recovery after a dropped HTTP or viewer connection;
- status refresh, application errors, resources/details, input, resize, and
  kiosk isolation;
- rejected unauthenticated, stale-generation, cross-origin, arbitrary-unit,
  repeated, and unavailable-helper service operations; and
- absence of secrets and parameters from URLs, browser storage, diagnostics,
  history, and journals, plus keyboard, responsive-layout, and accessibility
  checks.

Real systemd/X11 E2E and human UAT follow the normal release gate. No sandbox
deployment is authorized by this locked train.

## Additive API surface

`POST /api/instances/{id}/restart` accepts the exact current
`sessionGeneration` and optional `force`. It returns the same runtime identity
after locked-snapshot recreation; a stale generation fails before shutdown.
SDK `restartInstance()` wraps this operation.

When explicitly enabled with authenticated trusted-header mode,
`POST /api/operator/service/restart` accepts no unit or command and returns an
asynchronous operation. `GET /api/operator/operations/{id}` and SDK
`waitForOperatorOperation()` follow it across manager connection loss. The
helper is installed separately and is never enabled by default.

## Out of scope

This train does not provide arbitrary command execution, a file manager, a
general host/service dashboard, public access to loopback control protocols, or
the deferred APP-008 lifecycle redesign. App installation and activation remain
operator/deployment workflows rather than browser console actions.
