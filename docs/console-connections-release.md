# Console Connection Information — Locked Release Train

## Stable publication — 2026-09-10

Published as normal Latest `v0.8.0` at `c097bbcdb032`. Full hosted candidate and
exact-archive acceptance passed; independently downloaded bytes match the tested
candidate. See [evidence](../tests/evidence/v1/connections-0.8.0-publication.json).
Local services remain rc.3; no additional deployment or runtime recreation.

Human UAT accepted for rc.3; publish stable `0.8.0` with SDK `0.25.1` after
same-commit hosted candidate and exact-archive acceptance. No runtime code or
App version changes. No new deployment or Edge recovery is authorized.
The prior singleton test incident remains recorded, not erased by acceptance.

Status: locked by the operator on 2026-09-10 for Core `0.8.0-rc.1`, SDK
`0.25.0`, with App Package versions unchanged. CONN-002 and CONN-003 are
authorized for development, testing and deployment to local loopback 1991/2992
only. Preserve existing runtimes, credentials and page policy. No sandbox or
publication is authorized. Retain earlier candidate acceptance evidence.

## 2026-09-10 amendment — CONN-004

Target Core `0.8.0-rc.2` / SDK `0.25.1`; operator authorized deployment
to local loopback 1991/2992 after candidate verification. Preserve live runtimes
and page configuration. No sandbox deployment or formal publication.

Operator requested removal of the dedicated connection token. This supersedes
all token-entry, token-isolation and disabled-by-default requirements in the
original locked scope below. API/SDK/Console use normal Manager authentication
and origin checks, retaining metadata validation and stale-response protection.
With auth-mode=none, reachable callers can read descriptors. The old token-file
setting is ignored. This follow-up requires new validation/deployment evidence;
the recorded local candidate below remains token-protected until updated.

## Function

CONN-005 follow-up: Console must load its build-matched hashed SDK directly.
Target Core `0.8.0-rc.3`, unchanged SDK `0.25.1`; local 1991/2992 deployment
authorized after candidate verification. No sandbox or publication.
The old /sdk/index.js entry can remain cached without selecting an old Manager.
Validate root and nested proxy paths with
`node tests/app-package/check-console-sdk-cache.mjs http://127.0.0.1:PORT RUNTIME_ID`.
This requires Chrome and a ready disposable fixture/runtime and performs only
reads; native clipboard writes are mocked. Deployed locally as rc.3; see the
production handover for a post-deployment singleton-test incident and pending
operator recovery direction. No all-runtime-preservation acceptance is claimed.

Add **Connection info** to Console runtime details, reachable from both managed
applications and anonymous runtimes. A managed application without a runtime
shows “No runtime”; opening this panel must not launch or restart anything.

Reuse `manager.getConnections(id, {token, sessionGeneration, signal})` and the
existing protected endpoint. Display:

- Runtime ID, session generation, descriptor revision and last retrieval time.
- Actual current core/App version from the existing runtime version API,
  correlated to the same runtime/generation; distinguish it from the descriptor.
- `environment.display`, `xauthorityPath` and available session D-Bus address/scope.
- Actual `environment.ibus` address/scope supplied by CONN-003, or its explicit
  unavailability reason; never treat session D-Bus as the IBus endpoint.
- Generic `application` fields, including current UNO, BiDi, CDP or KDE D-Bus
  descriptors when supplied by the template; safely render future JSON fields.
- Missing metadata, not-ready/stopped runtime, authorization errors and stale data.

Provide explicit Refresh, Copy field, and Copy JSON actions. JSON copy copies
the descriptor, not the capability token or an undocumented merged API envelope.
Missing fields remain unavailable, not empty invented values. Original
CONN-001 omitted IBus; CONN-003 adds its validated endpoint in this train.
Do not infer one from D-Bus or filesystem paths.
Never expose Xauthority cookie contents. Render App-provided strings as text,
not HTML, executable links or shell commands.

## CONN-003 — Actual IBus connection information

Baseline source evidence: `drivers/common/session-input.sh` exports the address
passed to `ibus-daemon --address` and records `session-ibus.pid`; both isolated
and user-home modes start a runtime-local IBus. The user-home session D-Bus has
scope `user`, but its IBus still has scope `runtime`. The current connection
environment in `cmd/remotexappd/connections.go` previously had no IBus field;
this train adds the validated optional field.

Extend the existing descriptor additively, retaining `schemaVersion:1` and
the same endpoint, authorization and SDK method:

```json
{
  "environment": {
    "ibus": {"address": "unix:path=/run/user/1000/remotexappd/example/ibus.sock", "scope": "runtime"}
  }
}
```

This is a field example, not a complete response or a path to construct.
The shared input startup layer records the actual successful launch address
and daemon identity. Publish it using the existing private connection-status
pipeline with matching generation/revision; do not add per-App Manager logic
or move D-Bus/IBus into a new lifecycle layer in this train.

Before exposing it, validate the address is a supported local filesystem Unix
endpoint, the socket belongs to this runtime/UID, and the recorded daemon is
alive with matching process identity and session ownership. A pre-existing
socket pathname alone is insufficient. Reject symlink/foreign/TCP endpoints,
PID reuse and stale generation/revision. Do not scan unrelated processes or
publish an address merely because Manager launch arguments predict it.

When a supported runtime lacks IBus, omit `environment.ibus`, add `"ibus"` to
the existing `unavailable` list, and add optional
`unavailableReasons: {"ibus":"metadata-missing"}`. Stable reason values are
`metadata-missing`, `not-enabled`, and `not-running`; report only what evidence
supports. Legacy absent records mean metadata-missing, not that IBus is absent.
Malformed, foreign or stale supplied metadata keeps the existing HTTP 409
fail-closed behavior; do not downgrade integrity failures to normal absence.
Overall not-ready/stopped runtime handling remains unchanged.

Update SDK types, validation and documentation for the optional IBus and reason
fields. Old servers and old pinned runtime metadata remain readable, with
explicit absence; do not rewrite pins or restart a runtime on inspection.
Console shows the generic field and reason without executing IBus methods.
An available IBus bus does not guarantee focused input context, text delivery,
or permission to use sendText in password fields.

## Trust and credential handling

This is an opt-in **trusted operator Console**, not an ordinary Viewer feature.
Enabling Console does not grant connection-read permission. Preserve normal
Manager authentication, same-origin policy and the separate connections token.
The capability grants reads across its Manager; do not imply per-runtime access.

Allow explicit masked token input only in a trusted loopback or authenticated
HTTPS deployment. Warn that the page and its same-origin scripts must be trusted.
Retain the token only in memory for the open inspection panel; clear the input
after submission and clear retained credentials/results on panel close, Manager
change or page teardown. Reload requires entry again. Never read the server's
token file on behalf of a browser, persist credentials in browser storage, put
them in URLs, telemetry, errors or copied JSON, or configure them on a Viewer.

Copy is user-initiated and can fail due to browser permissions; report failure
without leaking data or changing the remote clipboard. Warn that the descriptor
contains sensitive host/control information before copying it locally.
Do not offer protocol execution, socket proxying or a generic remote-control RPC.

## Lifecycle

Fetch on explicit opening/refresh, not through background privileged polling.
Pass the current session generation. Use existing runtime observation to mark
the displayed descriptor stale when stop/restart/upgrade or generation changes
are observed; disable copying stale data and require a fresh successful read.
A displayed descriptor is a snapshot, never a guarantee that the process is alive.

Abort outstanding reads and reject late responses after panel close, selection
or Manager change, lifecycle transition, or a newer refresh request. A matching
ID alone is insufficient. On HTTP 409, refresh ordinary runtime status and ask
for a new descriptor read; never start an application or retry a mutation.

## Acceptance

- Unit/browser tests cover missing/wrong token, disabled endpoint, stopped/not-ready
  runtime, unavailable metadata and correct capability isolation between Managers.
- Verify no token in persistent storage, URLs, Viewer configuration, logs, errors
  or copied JSON; text rendering must resist malicious template field content.
- Test delayed responses across refresh, panel close, runtime selection, restart,
  upgrade and generation change; stale results must not reappear or remain copyable.
- Real App checks cover Mousepad, XFCE, LibreOffice, Firefox, Edge, Kate and KWrite,
  including no application object and template-specific private descriptors.
- For CONN-003, connect to the returned IBus bus and perform a bounded read-only
  protocol query, proving service identity without changing focus or input state.
  Cover isolated and user-home modes, correct distinction from session D-Bus,
  daemon death, missing/legacy metadata, foreign sockets, symlinks, PID reuse and
  generation/revision races. Verify adoption retains valid metadata and restart/
  explicit upgrade refreshes it; no public status or Viewer leakage is allowed.
- Test old-server/new-SDK and new-server/old-SDK descriptor compatibility, absent
  optional fields, reason codes, and invalid metadata rejection. Use a disposable
  account for destructive user-home tests; do not replace an occupied desktop.
- Verify Console-disabled policy remains effective, and no panel action launches,
  stops or controls an application. Test copy denial and successful manual copy.
- Run existing SDK/API regressions, `make check`, exact-candidate acceptance and
  authorized local deployment checks before UAT. Native permissions need human UAT.

## Implemented verification and UAT boundary

The implementation includes private launch identity records, Unix peer/process
verification, optional SDK fields, and a separate read-only Console inspector.
Tests cover absent/invalid capability, SDK compatibility, stale/foreign IBus
metadata, delayed responses and credential clearing. Real browser acceptance
also covers a rapid close/reopen race, field/JSON copy, permission denial and
literal rendering of hostile template text. Copy tests stub browser clipboard
writes to avoid changing the operator's clipboard; native permission UX is UAT.

`scripts/test-release-candidate.sh` runs the exact-archive existing App and
upgrade suites, now including IBus protocol queries and Console DOM acceptance.
It also runs `tests/app-package/run-user-home-connections.sh`, which requires
passwordless sudo and creates/removes a unique locked local test account. That
test uses the shipped XFCE driver and policy with only fixed display/ports
relocated to an unused value, preserving the occupied real desktop. It verifies
default user D-Bus/Xauthority, distinct runtime IBus, adoption, restart and daemon
death. The temporary account is deleted only after its user service/processes
have exited; test evidence remains outside its home.

Do not treat development test results as deployment evidence. Hosted candidate
gates, exact-archive acceptance and both post-deployment checks must finish first.
The existing [connection API](agent-connections.md) remains authoritative.

## Local deployment and UAT

**Current: rc.2 / SDK 0.25.1, deployed 2026-09-10 08:55 UTC.** Both local
endpoints passed candidate and post-deployment checks. Open 1991 Console,
select Connection info and Refresh: no token is required. SDK callers can use
`manager.getConnections(id)` directly. Manager authentication still applies.
2992 Console remains disabled; use its SDK/API. Existing XFCE pins remain
unchanged. [Evidence](../tests/evidence/v1/tokenless-connections-0.8.0-rc.2-local.json).

The following rc.1 deployment and token-entry checklist is historical and
superseded by CONN-004 above.

Exact candidate `c64d1857da26`, Core `0.8.0-rc.1` / SDK `0.25.0`, completed
automated acceptance and both local loopback deployments on 2026-09-10 at
08:17 UTC. App versions and selectors are unchanged. See
[verification evidence](../tests/evidence/v1/console-connections-0.8.0-rc.1-local.json).
No sandbox or publication was performed; Human UAT remains pending.

1. On the deployment host, open `http://127.0.0.1:1991/sdk/console.html` and
   launch a new Kate, KWrite or other test application. Select **Connection info**.
2. Obtain this Manager's existing connection-read token through a trusted local
   terminal and enter it manually. The local token files remain owner-only under
   `~/.config/remotexapp/connections-1991.token` and `connections-2992.token`;
   never send their contents to a Viewer, URL, log or issue report.
3. Select Refresh. Verify runtime/generation, Display, Xauthority path, separate
   session D-Bus and IBus information, and the template's application controls.
   Test field/JSON copy and the browser's native permission-denial behavior.
4. Close/reopen the panel: it must require the token again and show no old
   descriptor. Use only disposable runtimes when testing restart/upgrade;
   observed lifecycle changes must invalidate displayed data.
5. Inspect the existing managed desktop without restarting it. Its old helper
   has no IBus launch record, so `metadata-missing` is expected; this does not
   mean its IBus is absent. New metadata requires an explicitly approved runtime
   upgrade, not merely another Manager restart.

Local 2992 retains its disabled Console and enabled SDK/kiosk/API policy.
The default user-home test used a temporary UID and relocated display 90;
the occupied display 1 was not replaced. Native browser permission UX and
operator acceptance are the remaining UAT boundary, not a production-ready
claim about automatic permission grants or guaranteed IME text delivery.
