# App Actions and Browser Open URL — Locked Release Train

> Historical technical record. Dated status and validation statements describe
> their original scope; they do not identify a current deployment. See
> [current source versions](current-state.md). Host labels and runtime IDs in
> historical examples are anonymized.

Status: **closed; stable `0.9.0` published on 2026-09-10**, ACT-001–008.
Target: Core `0.9.0`, SDK `0.26.0`, Firefox ESR App `2.2.0`,
Edge App `1.1.0`. Promote the accepted candidate without functional changes.
GitHub publication is authorized; no additional deployment is authorized.
Publication completed with full exact-archive E2E and independently verified
downloaded bytes. See [publication evidence](private-history.md).
The subsequent explicit "deploy to all" approval aligned all eight environments
to stable `0.9.0`, preserving existing runtime pins and configuration.
See [alignment evidence and network limitation](private-history.md).
Existing runtime pins are preserved; invoking an action never upgrades them.
App Package V1 gains an optional `actions` field: old packages remain valid;
older Managers reject new action-bearing manifests through strict decoding.

## Local UAT readiness — 2026-09-10

Candidate commit `fc2d94e6b764` passed hosted gates and complete exact-archive
E2E and is deployed to `127.0.0.1:1991` and `127.0.0.1:2992`.
See [verification evidence](private-history.md).
Human UAT passed after the separately approved force upgrade of local XFCE and
Edge. Both report ready, generation 3 and Core `0.9.0-rc.1`; connection reads
passed and Edge `1.1.0` advertises ready `openUrl`. Test 2992 has no active
runtimes. See [human acceptance](private-history.md).

On the production Console (`/sdk/console.html` on 1991), launch/connect Firefox,
wait for ready, choose **Actions**, enter an HTTP/HTTPS URL and click **Invoke**.
Expect a newly activated tab and JSON containing `tabId` and `url`; the prior
tab remains. Repeat with another URL. Production Edge now uses `1.1.0`
following the explicit runtime upgrade approval.
Test 2992 retains its disabled Console; its Manager/SDK action checks passed.

Cancel/close stops the request, not the app; effects may already have occurred.
An external active BiDi owner yields `control-busy`, never takeover.

## Outcome and architecture

Allow a Viewer client to invoke a small, declared operation on an already-ready
application without restarting it. The first operation is `openUrl` for the
shared singleton Firefox ESR and Edge templates, defaulting to a new tab.

Client SDK -> generic Manager action dispatcher -> pinned App Package handler
-> browser's loopback control endpoint. Firefox owns the BiDi implementation;
Edge owns the CDP implementation. Manager and SDK contain no browser-specific
dispatch branches. Drivers do not start an HTTP service. The host application need not build a
new CDP/BiDi backend service for this operation.

## Requirements

Canonical IDs ACT-001 through ACT-008 are in [requirements.md](requirements.md#locked-release-train-app-actions-and-browser-open-url).

- ACT-001: optional package action declarations, discoverable supported actions,
  bounded input/result schemas and pinned handlers; immutable package updates.
- ACT-002: generic, authenticated Manager invocation with strict validation,
  generation checks, bounded execution and stable result/error envelopes.
- ACT-003: typed Manager and bound Client SDK calls, normal authentication and
  reverse-proxy base-path support; no automatic mutation retry.
- ACT-004: Firefox and Edge `openUrl`, new tab plus activation, returning a tab
  identifier; no restart, no replacement of the current page.
- ACT-005: ready-session requirement, per-runtime serialization and coordination
  with lifecycle operations, cancellation and ambiguous outcomes.
- ACT-006: least-privilege execution, package/control ownership, URL restrictions,
  no generic shell or raw control proxy, and no takeover of another BiDi session.
- ACT-007: comprehensive tests and host application integration guidance before acceptance.
- ACT-008: a generic Console action panel using the public SDK to discover,
  enter parameters, explicitly invoke, and inspect results/errors for one runtime.

## Locked contract (not available in 0.8.1)

The manifest's optional `actions.openUrl` declares a package-relative handler
such as `open-url.py`, parameter/result schemas and a bounded timeout.
Reuse existing parameter schema primitives except `file`; at most 16 actions,
16 fields per schema, 16 KiB request/result and a 1–30 second timeout.
Public discovery exposes schemas, not
handler paths. Instance capabilities reflect its pinned package, not merely
the newest enabled template. Existing packages without actions remain usable.

```http
POST /api/instances/{id}/actions/openUrl
Content-Type: application/json

{
  "sessionGeneration": 3,
  "parameters": {
    "url": "https://example.com",
    "disposition": "new-tab"
  }
}
```

Proposed successful response:

```json
{
  "instanceId": "firefox-esr-example",
  "sessionGeneration": 3,
  "action": "openUrl",
  "result": {"tabId": "browser-owned-id", "url": "https://example.com"}
}
```

Success means the browser acknowledged creation/navigation and tab activation,
not that the website finished loading or returned HTTP 200. Errors distinguish
unsupported action, invalid input, not-ready/stale generation, busy control,
driver failure and unknown outcome after timeout/transport loss. Late results
must not be attributed to a newer session. Do not promise exactly-once delivery
or report that an ambiguous command had no side effects.

```js
// Bound client supplies its current runtime/session identity.
await client.invokeAction('openUrl', {
  url: 'https://example.com', disposition: 'new-tab'
});

// Unbound Manager requires the expected generation explicitly.
await manager.invokeAction(instanceId, 'openUrl', {
  url: 'https://example.com', disposition: 'new-tab'
}, { sessionGeneration, signal });
```

First version supports only `new-tab` (default), and HTTP/HTTPS URLs. Reject
other dispositions and schemes, including javascript/file/data, instead of
silently changing behavior. The action runs only when session and application
are ready; it does not create, attach, restart or wake an application.

## Execution and security

Use the runtime's pinned, validated package handler and its exact runtime
graphical environment (HOME, XDG directories, DISPLAY, XAUTHORITY and declared
D-Bus plus package resources/config) under the deployment UID; never copy the
entire Manager environment. No root, arbitrary path/command, shell
interpolation, or caller-selected control endpoint. Input is bounded JSON on
stdin; output is bounded validated JSON. Bound stdout/stderr, process lifetime
and concurrent work; sanitize public errors and avoid logging URLs/secrets.
Kill only owned handler subprocesses on cancellation, never the browser merely
to time out an action. Browser-side effects may already have occurred.

Serialize actions per runtime, reject or bound excess work, and coordinate with
stop/restart/upgrade so a delayed action cannot execute against a replacement
session. Avoid a global lock held through browser I/O. Control endpoints come
from the runtime, never from request parameters. Firefox's existing single BiDi
session ownership requires explicit contention handling: return busy if another
controller owns it; never terminate or steal that session. Dispose only control
sessions owned by this handler, without closing the running browser.

Use existing Manager authentication/origin rules; this does not add per-runtime
authorization. With auth-mode=none, reachable callers can invoke declared
actions. All viewers of a shared runtime can see the newly activated tab.
Raw CDP/BiDi remain loopback-only; getConnections stays a read-only descriptor.

## host application flow and scope boundaries

Ensure/create the singleton -> open/connect its Viewer -> wait for application
ready -> invoke `openUrl`. Use a neutral initial page for creation, then invoke
once; do not send the target both as startUrl and as an action. Existing
createInstance/startUrl semantics remain unchanged. Direct Agent CDP/BiDi
control remains available; this action API is not an unrestricted replacement.

No arbitrary RPC, persistent action job database, cross-runtime coordinator,
automatic background startup, automatic retries, package/schema editing,
or other application's actions are included in this first train. Set minimum
Core `0.9.0` / SDK `0.26.0` and Firefox `2.2.0` / Edge `1.1.0` as minimum versions;
old Managers must fail clearly on unsupported action-bearing packages, and old
runtime pins must not silently gain new operations.

## Console invocation panel (ACT-008)

Add an Actions entry for managed runtimes and standalone runtimes in the
Unified Console. Show the target instance ID, pinned App version and current
session generation. Discover only actions supported by that runtime's pinned
package; do not hard-code Firefox/Edge controls or offer arbitrary action names.
Render a small parameter form from the declared schema (bounded JSON input
where a structured field requires it). For openUrl, expose URL and the supported
new-tab disposition. This edits invocation inputs, never the package/schema.

Invoke only after an explicit user click using the public SDK invokeAction;
show pending state, prevent duplicate submissions, and render bounded result
JSON, tab ID, or structured error safely as text. Explain shared-runtime side
effects. A timeout/cancel with unknown outcome must not imply that nothing
happened or trigger a retry. Closing the panel must not stop the runtime.

Disable invocation and explain why when no ready session/action exists.
Refresh or invalidate capabilities, forms and responses after target,
generation or pinned-version changes; an old response must not appear as a
new runtime's result. Scope each panel to its selected runtime across multiple
Console windows. Keep normal authentication and Console-disable policy;
do not expose this operator panel in kiosk automatically or enable disabled
management pages. Do not persist URL inputs/results in browser storage.

Console browser tests must cover successful Firefox/Edge new-tab invocation,
schema validation, unsupported/legacy actions, non-ready/busy/stale targets,
duplicate clicks, concurrent windows, restart/upgrade, cancel/timeout ambiguity,
hostile result text, base paths, and Console-disabled behavior. The panel is
the human UAT surface for this train and a reference for host application SDK integration.

## Required verification

Test declaration/schema/path validation, auth/origin denial, injection and
output bounds, unsupported/legacy packages, stale generations, not-ready apps,
concurrent calls and lifecycle races, timeout/cancel/process cleanup, malformed
results and lost responses without retries. Test genuine foreign endpoint and
BiDi-controller ownership conflicts; do not replace them with mocked success.

Run real Firefox/Edge E2E for both initially absent and existing singleton
runtimes, sequential/multiple URLs, Unicode/encoded URLs, invalid protocols,
new tab activation without losing the old page/profile, concurrent viewers,
shared control contention, restart/upgrade/Manager adoption and refreshed
capabilities. Validate SDK under root and reverse-proxy prefixes, and document
the minimal host application change. Demonstrate a synthetic new package action installed
and invoked without rebuilding Manager/SDK. Require local tests, release gates,
exact-artifact E2E and human UAT; deployment/publication approvals are separate.

## Frozen wire and handler details

`GET /api/instances/{id}/actions` returns `instanceId`, `sessionGeneration`,
`driverVersion`, `ready` and an `actions` object. Each entry has `parameters`,
`result` and `timeout`, never the executable path. Old pinned packages return
an empty object. `/api/version` advertises `capabilities.appActions`.

POST executes the declared executable directly, with one JSON object on stdin:
`{"parameters":{...},"connections":{...}}`. `connections` is the same validated
generation-bound descriptor as getConnections. The handler prints only its
declared result object (no envelope) and exits zero. Required result fields
must be present; extra fields, invalid JSON, and extra output fail closed.
Exit 10 reserves `control-busy`; other nonzero exits give `outcome-unknown`.
Public errors contain `error` and stable `code`, not raw driver stderr.

HTTP errors: 400 invalid-request/invalid-parameters; 404 instance-not-found or
unsupported-action; 409 busy, control-busy, not-ready, stale-generation,
invalid-package or outcome-unknown; 502 outcome-unknown for failed/malformed
handler output; 500 driver-unavailable when execution cannot start.
Manager auth/origin errors retain their existing status. With HTTP/network
failure after submission, inspect tabs before manually retrying.

At most one action runs per runtime and 32 overall; callers receive busy,
not an unbounded queue. Lifecycle stops cancel and join the action before
replacing the session. A handler gets its own process group: deadline or
cancellation sends SIGTERM, with up to four seconds to release owned protocol
sessions before force kill. Remaining group members are killed on completion.
Parent death also signals the handler. This cleans cooperative subprocesses, not a
security sandbox for hostile package code that deliberately escapes its group.
Packages remain trusted same-UID code. Python bytecode writes are disabled to
keep the sealed package unchanged across repeated invocations.

Firefox releases the session associated with its own action WebSocket, even
if cancellation interrupts the session.new response. It never sends session.end
when an existing controller was already busy. This is best-effort bounded
cleanup: an unresponsive browser or externally orphaned controller can still
require operator recovery; never steal a session or silently restart the app.

HTTP body reads have a five-second deadline on the production HTTP transport
and occur before acquiring the lifecycle lock. A slow upload must not block
another runtime's stop/restart. Bounded schemas do not alone bound read time.

The Console has one selected-runtime Actions dialog per Console page; separate
pages remain independent. Close/target changes clear inputs/results and abort
the request, never stop the app. SDK cancellation does not undo browser effects.

Protocol references: [WebDriver BiDi](https://www.w3.org/TR/webdriver-bidi/)
and [CDP Target](https://chromedevtools.github.io/devtools-protocol/tot/Target/).
