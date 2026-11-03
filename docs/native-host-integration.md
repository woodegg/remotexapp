# Native host integration and UAT

Issue [#57](https://github.com/woodegg/remotexapp/issues/57) owns implementation
and qualification. The owner authorized completion through a consolidated UAT
handoff on 2026-11-03. This is an implementation plan, not a passing test report.
The owner accepted the current combined clipboard/audio UAT baseline in #54/#56;
that acceptance does not qualify the additional behavior below.

## Outcome and scope

Design the native SDK around Kasm capabilities and observable application
workflows. Legacy method names, classes and event shapes are not compatibility
requirements. Preserve application data, template semantics, lifecycle intent,
generation fencing and explicit permissions. Use the served host workbench to
simulate embedding-host windows, workspaces and tasks through public SDK APIs.
The downstream application is not modified or deployed by this work.

The SDK and workbench evolve together. A test-only access to private RFB objects
cannot make a missing public SDK workflow pass. Fault injection and fixture file
preparation are separate from normal host operations. Actual downstream
acceptance remains separate from this reference host's qualification.

## Stable requirements

| ID | Contract | Required evidence |
| --- | --- | --- |
| NHI-001 | Discover template metadata, validate parameters and choose create/reuse/managed attachment explicitly. Preserve template profile, singleton, file and activation semantics. | Shared browsers, isolated editors, managed desktop; invalid parameters and stopped managed targets |
| NHI-002 | Separate owned runtime observation/keepalive, display attachments and audio interests. Hidden is not closed; closing one owner never releases another. | Two workspaces, two Viewers of one runtime, different runtimes, independent task handle, last release and logout |
| NHI-003 | Reconnect with bounded backoff and explicit cancellation. Retry only the same eligible running generation/component; terminal intent, authorization loss and replacement stop retries. | Offline/online, exhaustion, dispose during backoff, stale async completions and no input/action replay |
| NHI-004 | Native input APIs identify the current target and report submission/uncertainty honestly; never use clipboard as an implicit text transport. Read-only display controls cannot be advertised as authorization unless enforced by the service. | Unicode and keys with actual App readback, disconnect/order/cancel, direct wire write rejection for a read-only attachment |
| NHI-005 | Expose native rendering/resize and readiness as public capability-driven behavior. Ready requires current App readiness plus actual paint. | Resize convergence, scale-only templates, two Viewers, hidden first attachment, timeout and cleanup |
| NHI-006 | Preserve consented native clipboard and independent session audio; expose their actual state alongside real display transport statistics. | Text/HTML/PNG, 2 MiB aggregate, focus and multi-Tab routing, speaker/mic ownership, UDP/WSS transitions |
| NHI-007 | The workbench implements a realistic reference host using only public SDK calls, with generic metadata-driven forms and explicit destructive operations. | Rendered browser workflows, keyboard/pointer, responsive visual review and sanitized operation records |
| NHI-008 | Qualify shipped App contracts, including specialized control and persistence, on suitable project-owned fixtures. | Edge, Firefox ESR, LightView, Mousepad, Kate, KWrite, LibreOffice, managed XFCE; explicit architecture/distribution limitations |
| NHI-009 | Validate latest combined-channel adoption/recovery/cleanup with immutable artifact identity and retained user-data safeguards. | Manager restart, eligible failed-session recovery, explicit-stop/veto, stale channels, actual target reboot and rollback scope |
| NHI-010 | Deliver an actionable host migration guide and one consolidated UAT checklist. No simulation result is represented as actual downstream acceptance. | Old workflow to new calls, ownership, removable old logic, evidence, limits and exact candidate tuple |

## Object ownership

One host service per login/server owns a Manager, a runtime Coordinator and an
audio coordinator. Each window/task owns its runtime handle. Each visible or
retained display owns a Viewer. Audio interests belong to the window/task whose
explicit policy needs them; they are not implicitly acquired by display attach.
Server identity includes origin and API base path; login scope is not a secret
and is not a substitute for server authorization.

Hiding retains ownership. Keeping the original Viewer avoids a DOM-destruction
reconnect; explicitly unloading a view permits display reattachment while
retaining a separately owned runtime/audio interest. Resource effects must be
measured. Closing a view releases that view. Stopping an App is an explicit
Manager action and preserves graceful-shutdown/veto semantics. An editor host
may choose close-and-stop as its visible product action. A lease never revives
an App, cancels explicit stop, or transfers itself to a replacement generation.

## Template workflow matrix

| Scenario | Templates | Result to prove |
| --- | --- | --- |
| Shared browser launch and repeated open | Edge, Firefox ESR, LightView | Correct shared profile/instance, capability-qualified openUrl, bounded uncertain outcomes without replay |
| File selection and editing | Mousepad, Kate, KWrite, LibreOffice | Allowed remote file mapping, correct template and instance, persistence/readback and graceful close |
| Managed user desktop | XFCE user desktop | Correct managed identity/HOME, on-attach generation transition, explicit stop respected |
| Specialized control handoff | Browser protocols, UNO, D-Bus, desktop environment | Current generation and protocol verified; controlled operation/readback; retired target rejected |
| Workspace and multi-window | All supported templates | Independent Viewer focus/clipboard, explicit handles/audio, retain/unload/restore and close/stop distinction |

Mousepad is additional provider coverage, not an assertion that every embedding
host already exposes it. Fixtures for plain text, source files and Office
documents use owned remote files. File upload/folder clipboard is not added.
File-root translation belongs to the host's backend; RemoteXApp independently
validates configured document roots. The workbench uses an explicit fixture
mapping rather than treating arbitrary browser paths as remote paths.

CDP, BiDi, UNO and D-Bus remain distinct protocols. The workbench can obtain a
generation-qualified descriptor; a controlled local test executor proves that
the real protocol works. Browser UI must not pretend it can reach a server's
loopback socket directly. No paid model or existing user Agent is required.

## Qualification and delivery

Start with a complete shared-browser/editor flow, then expand to all templates.
Exercise SDK cancellation and ownership with deterministic tests, then real
browser workflows on the exact candidate. Retain the existing focused input,
clipboard, UDP and audio matrices. Run applicable repository gates and visual
review before declaring readiness. Platform absence is unavailable/untested,
never a pass inferred from a different fixture.

Record Core/SDK/component/App hashes and source commits, browser and OS, target
configuration, results and cleanup. Human UAT is one end-to-end handoff after
automated qualification; its passing state is never synthesized. Release,
merge, default-provider cutover and downstream deployment remain separate.

Multi-container UDP orchestration and external background lease ownership are
outside this work. Existing bounded IPv4 UDP remains optional, with WSS as the
functional base. The closed UDP orchestration work is not reopened implicitly.
