# Recovery experience fault qualification

This is the execution/acceptance matrix for
[the recovery design](../../docs/native-recovery-experience.md), Issue #70.
The [2026-11-20 results](RECOVERY-EXPERIENCE-20261120.md) and
[machine-readable evidence](../evidence/v1/native-recovery-experience-20261120.json)
record the executed coverage and remaining variants. A row is not automatically
fully qualified because one variant passed. Earlier human UAT and #69's
lower-level passes do not establish acceptance of this new interface.

## Common oracle

Use owned disposable fixtures, isolated browsers and synthetic documents. Record
immutable Core/SDK/component/App identities and protected non-test process
identities before injection. Retain injected PID/start time or the exact HTTP/
browser boundary privately. Never inject into an active user desktop.

Recovery requires correct visible state/action, a fresh frame, new input saved
and read back by the App, retained saved data, and intended generation/process
behavior. HTTP 200 or surviving processes alone do not pass. Refusal requires
proof of no prohibited grant/restart/replacement or replay. Check a second App
and duplicate Viewer where scope could cross those boundaries. Remove only the
fault before measuring automatic recovery; manual actions are a separate stage.

Default/custom panels consume the same public model. Fixture control probes
provide readback, not hidden repair. Close owned Apps/browsers/connectors and
restore limits/rules; retain failed attempts and incomplete cleanup.

## Required cases

| ID | Injection / variations | Expected outcome and evidence |
| --- | --- | --- |
| REX-F01 | Initial API unreachable, missing component, malformed descriptor, no first frame | Bounded attention; no false ready/duplicate launch; unit and browser |
| REX-F02 | Loss before/across renewal; 429/500/502/503/504; held response | Bounded automatic recovery with fresh grant/frame/input and same generation; unit and browser |
| REX-F03 | Offline through exhaustion, then restoration | Explicit retry required; no automatic budget reset; unit and browser |
| REX-F04 | 401/403, retired grant, login switch/logout during retry | Terminal authority boundary, no old-scope reuse; API/SDK and injected browser responses |
| REX-F05 | Manager TERM/KILL and return during recovery | Supervisor restarts Manager; App identities survive; actual browser interaction |
| REX-F06 | Release/hide/unload/disconnect during backoff, delayed callback | Release cannot revive; hide retains ownership; stale callback ignored; unit and browser |
| REX-F07 | Duplicate Viewers/Tabs, separate App, one Viewer failure | Independent display state, honest shared-operation scope, other App/task retained; multi-context browser |
| REX-F08 | Double-click, concurrent Tab actions, stale revision/confirmation | One local operation; Manager fences stale competitors; unit and concurrent API/browser |
| REX-F09 | Confirm/cancel restart, shutdown veto/409, response lost after acceptance | No mutation before confirmation, no force/replay, exact pins and truthful uncertainty; unit and lifecycle fixture |
| REX-F10 | External replacement, changed generation/component/profile/template/creation identity | Explicit verified reattach only; no guessed target or template relaunch; unit and live replacement |
| REX-F11 | Managed failure with live editor/unknown ownership; later empty | Blocker visible; recheck cannot kill/reset budget; backend eligibility governs recovery; managed live fixture |
| REX-F12 | Explicit stop, unfinished upgrade, cooldown/exhaustion | Observation/retry cannot start App or reset cooldown; unit and managed lifecycle |
| REX-F13 | VNC/Driver/supervisor/gateway loss with survivors | Preserve live/unknown components; truthful UI/admitted actions; broad matrix and native browser |
| REX-F14 | IBus/Unicode/private D-Bus loss, borrowed account-bus interruption | Legacy degraded preservation; no borrowed-bus replacement; native IBus absence not a fault; system matrix/provider negatives |
| REX-F15 | Another disconnect/crash/replacement during recovery | Finite budgets, stale work retired, no duplicate transition or false ready; unit and chained live faults |
| REX-F16 | Clipboard denial/late transfer, mic active during replacement | No stale paste/capture reopening; independent display/audio ownership; unit and synthetic audio/clipboard browser |
| REX-F17 | UDP unavailable/exhausted/disabled with working WSS | Actual fallback/stats, no App restart; local UDP fixture; WAN/MTU separate |
| REX-F18 | Missing/offline document root, rejected path, uncertain action response | No automatic file/create/save replay, unrelated Apps retained; API and real file readback |
| REX-F19 | Release/logout during restart, lost response | Local cleanup, uncertain server outcome, no undo/force/replay/rebind; unit and response-drop connector |
| REX-F20 | Default/custom UI, keyboard, IME focus, hidden workspace, stats | Same actions/outcomes, no focus stealing, responsive UI; browser/visual review; physical IME separate |
| REX-F21 | Repeated cycles, then all windows released | Retired Viewer DOM/listeners return to baseline; any explicit background owner remains until logout; SDK counters plus collected browser resource measurements |
| REX-F22 | Create response headers lost, concurrent/restarted Manager replay, intent storage failure/expiry/capacity | One SDK call can produce multiple wire requests; one successful create within the reservation window, explicit uncertainty and no guessed reattach |

Each variation records `automatic-recovery`, `explicit-recovery`,
`protected-stop`, `degraded-preservation`, `unsupported`, or `not-tested`, plus
pass/fail for that expected outcome. Do not sum these into an unconditional
self-healing pass. Missing variations leave a row partially qualified.

## Appearance qualification for REX-010

Run `node tests/kasm-native/browser-recovery-appearance.mjs FIXTURE.json`
with the existing [disposable browser fixture](NATIVE-HOST.md). Set the
fixture's ingress URL to the candidate Manager's browser-visible base path.
The suite delays its own launch and retry requests in Chrome to verify the
connecting and recovering panels on real Viewers. It exercises independent
window themes, contrast presets, confirmation identity, focus, narrow layout
and cleanup. On the reference `/sdk/recovery.html` page, check the same
settings manually at 200% browser zoom before accepting the exact candidate.

## Additional system experiments

Disk-full/read-only storage, cgroup OOM/CPU starvation, packet loss/reordering/
MTU, certificate/Access expiry and long-duration load require bounded fixtures
and rollback. Use disposable backing storage, owned cgroups or network namespaces;
never exhaust or firewall the shared host. Retain not-tested when a safe fixture
is unavailable. A unit-injected write error is not live disk-full evidence;
synthetic HTTP 403 is not identity-provider expiry qualification.

Rerun applicable provider regression on the exact artifact. Keep physical
devices, other platforms, public WAN and a new soak separate. Human UAT is one
consolidated session after automation. Actual downstream host adaptation remains outside
this reference-host run. Record original results, cleanup, source/artifact hashes
and each missing or failed case before claiming UAT readiness.
