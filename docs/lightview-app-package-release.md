# LightView Shared Browser App Package

> Historical technical record. Dated status and validation statements describe
> their original scope; they do not identify a current deployment. See
> [current source versions](current-state.md). Host labels and runtime IDs in
> historical examples are anonymized.

## Formal target 1.0.13: Viewer attach wakeup

LightView's native one-hour idle hibernation can suspend WebKit while its
process, window and socket remain healthy. App 1.0.13 pairs the new optional
Core Viewer hooks with native `status`, `hibernate-after` and `open`: first
Viewer attach saves the user-selected interval, inhibits hibernation, and wakes
from the last committed HTTP(S) page (or `about:blank`) before RFB proceeds.
The final detach restores the exact prior interval. Manager adoption after
restart reconciles as detached. A locally changed interval is not overwritten.
This does not preserve in-page state discarded by hibernation. The public
Manager `ready` field still reflects the most recent Driver report; trusted
local Agents can query current `engine_state` via the private control socket.
The 19-scenario isolated exact-package real-browser E2E passed 2026-10-02,
including native hibernation, Viewer reattachment, Manager adoption, profile
continuity, App upgrade/rollback and vacancy cleanup. Candidate Core
`0.14.1-rc.1` and App `1.0.12` were then deployed to both local loopback
endpoints, 1991 and 2992. Both passed real native suspension/reattachment,
policy restoration, and served Chrome Viewer resize/reconnect. Existing 1991
XFCE generation 11 and component PIDs were preserved. See the
[local deployment evidence](private-history.md).
Human UAT of the deployed RC.1 / App 1.0.12 was accepted on 2026-10-02 and
formal GitHub publication was authorized. That local App archive included
ignored Python bytecode and cannot share a version with the clean published
archive. Formal App 1.0.13 changes only the manifest version and packaging;
the Driver code and behavior are unchanged. Publish the clean App under an
independent annotated tag after Core's exact-candidate gate; it requires Core
0.14.1 or later. Local 1.0.12 runtimes remain pinned until a separately
requested upgrade. Sandbox deployment remains the sandbox project's responsibility.

## Formal 1.0.11 publication

Formal [lightview-v1.0.11](private-history.md)
was published 2026-09-29 after local exact-package qualification and hosted
Verify. Its downloaded archive matches the local UAT archive. Core, SDK and
host Lightview remain unchanged; sandbox deployment is separately owned.
See [publication evidence](private-history.md).

## Hibernation wakeup (LTV-012)

Recorded 2026-09-29 for App Package 1.0.11. Lightview 0.1.10 hibernates its
WebKit engine after idle time without closing the main process, window or owned
Unix control socket. Native `open` wakes and navigates. App 1.0.10 instead
checked `engine_state:ready` before sending `open`, so a healthy suspended
browser could not be navigated through the Manager action. test-host-k reproduced
the failure and verified a sealed experimental App through the real HTTP action
with memory protection enabled and disabled.

Use identity/status validation before dispatch. A ready pre-state retains all
existing status-field checks; a suspended pre-state may issue native `open`
after ownership, PID and nonprivate-mode checks. Do not send `open` from
`recovering`, `failed`, invalid or untrusted pre-states. After dispatch, poll
the verified status through transient suspension/recovery until ready, a load
error, or a bounded timeout. Validate the final ready fields and action result.
Read-only status must stay nonwaking. Keep the immutable package seal and Core
action API unchanged; install a new App version and explicitly upgrade a pinned
runtime to use it. This train is scoped to local 1991/2992 UAT, without formal
publication or sandbox deployment.

## Optional memory protection (LTV-011)

Published and closed 2026-09-24 as formal
[lightview-v1.0.10](private-history.md).
Hosted Verify passed; downloaded archive and checksum match the exact local
candidate. Core/SDK are unchanged. See [publication evidence](private-history.md).
The following records the scope and qualification history.

Recorded 2026-09-24 for [Issue #8](private-history.md),
target App Package 1.0.10. Formal publication authorized after local qualification
on 2026-09-24, with no additional deployment. The same tested archive must be
published; Core and SDK stay unchanged. The following retains the earlier lock.
Locked 2026-09-24 for development, testing and local
1991/2992 UAT using immutable candidate 1.0.10; no formal publication or
sandbox deployment. The previous Driver's
`control.status()` is reused for startup, `openUrl` and `quit`, and requires
`memory_kill_threshold_mib == 3072`. A user can legitimately disable memory
protection (effective threshold `0`) or select a different threshold. That choice
must not invalidate an otherwise usable browser or its shutdown channel.

Split validation by purpose: shared socket ownership, canonical process and
bounded protocol checks; engine/page readiness for navigation; independent
safe quit validation. Retain the `--low-memory` launch default, but do not use
optional protection or fixed termination thresholds as operation/readiness
gates. Never silently restore user settings. Review manifest/status telemetry:
configured defaults are not proof of current enforcement. Prefer removing or
clearly labeling static policy claims over inventing central polling.

Implemented candidate: `identity_status()` validates the target and persistent
mode; `status()` additionally validates engine readiness and navigation fields.
Native quit uses identity validation only. The Driver never changes the selected
memory policy. Startup still passes `--low-memory`. Public status now contains
`application` and `launchLowMemory`; the former `lowMemory`, `memoryLimitMiB`
and `memoryKillThresholdMiB` fields are removed because they could become stale.
The private connection descriptor and action request/result schema are unchanged.
An Agent needing current policy reads native `status` over the existing socket.

Acceptance must first reproduce the disabled-protection failure and then cover
enabled/disabled protection, alternate thresholds, and toggles between ready
and action dispatch. Verify startup, repeated navigation, graceful stop, runtime
restart/upgrade, and quit while the engine is recovering. Preserve negative
tests for foreign/substituted sockets, wrong PID, malformed/oversized replies,
unsafe URLs, and navigation on an unready engine. Genuine failed shutdown still
uses the host's deadline/enforcement policy. Do not claim the generic
`outcome-unknown` contract has changed; a broader structured action-error change
would require separate scope. Qualify the exact App archive in project-owned
local tests; sandbox deployment remains separately owned by the sandbox project.

### Follow-up evidence and deterministic acceptance

The [Issue #8 follow-up](private-history.md)
reports that editing installed `control.py` triggered `409 invalid-package`;
Manager startup also rejected the content/seal mismatch. Restoring the exact
original file and removing inspection-generated Python bytecode restored package
validity. The original package subsequently navigated successfully after native
status changed to protection enabled. This is reported sandbox evidence, not a
locally reproduced candidate pass, and the attempted in-place A/B is inconclusive.

Do not weaken integrity checks or edit/re-seal an installed release. Build a
fresh immutable candidate from clean source, verify its archive checksum and
installed seal, and keep imports/inspection from writing `__pycache__` into the
package. Existing tamper rejection at action dispatch and Manager startup must
continue to pass using disposable test packages only. A content seal is not a
cryptographic signature; this requirement adds no new signing infrastructure.

Use a deterministic private Unix-socket state double with valid ownership, PID,
protocol, engine and URL. Only vary memory policy: configured 3072/effective 0
with protection off; enabled 3072; enabled alternate thresholds. Capture native
requests to prove old 1.0.9 never dispatches `open` in the disabled case, whereas
the sealed candidate returns successful navigation without changing user policy.
Exercise the real Manager HTTP action path and Driver tests, including native
quit, then verify against an actual browser. Keep identity/security failures
negative regardless of policy. Test transient recovery during a policy toggle
separately from settled `engine_state:ready`; a legitimate disabled state is
not degraded health and requires neither automatic correction nor investigation.

## Published history (superseded where LTV-011 states above)

Follow-up published 2026-09-18: **LTV-010 / lightview@1.0.9** supersedes only
the executable-version pin in the historical releases below. The Driver no
longer calls `lightview --version` or rejects a version banner; existing
window/process/private-socket identity and required native status capabilities
remain mandatory. Compatible future builds need no App update merely to change
the accepted version number, but are not automatically certified or installed.
All 15 isolated exact-package scenarios passed on verified formal Lightview
0.1.9. Source/race/coverage/vulnerability and hosted Verify gates passed.
The formal [release](private-history.md)
contains only the deterministic archive and checksum; fresh downloads match
the tested bytes. Core 0.13.0 / SDK 0.29.1 and all endpoints are unchanged.
See [qualification](private-history.md)
and [publication evidence](private-history.md).

Follow-up accepted 2026-09-18: LTV-009 creates immutable `lightview@1.0.8`,
pinned to formal Lightview 0.1.8 and its verified public artifact. It preserves
the existing RemoteXApp public contract while adopting upstream supervised
WebKit recovery. The Driver requires `engine_state:ready`, a positive
`web_process_generation`, the 384 MiB low-memory pressure target, and the
3072 MiB last-resort per-WebKit-process threshold before reporting ready.
Soft and hard reset, mode switching, version details, recovery telemetry and
raw page automation remain trusted local socket capabilities rather than new
Manager actions. Complete validation passed and formal GitHub publication is
authorized; no endpoint deployment is authorized. Fifteen isolated RemoteXApp
scenarios proved Viewer/input/clipboard/action/lifecycle behavior plus stable-
PID/socket soft and hard WebKit reset. All nine upstream integrations passed
with a completion-aware download assertion; the released file-exists-only
assertion was separately reproduced as a test race.

Annotated tag
[`lightview-v1.0.8`](private-history.md)
formally publishes only the accepted deterministic archive (SHA-256
`8af626a664bf335481ad8b7094b0d3f98e18dd6acfa948b17abcc89f5aedbcb7`)
and checksum. Fresh downloads match the candidate and its App content seal is
`deb929ce4ed3a2c333827dba268543aa2c3863e27c0b55f3ddb5fad0d02f42e2`.
Core `v0.12.2` was Latest at that historical gate and no endpoint was deployed. See the
[publication evidence](private-history.md).

Follow-up formally published 2026-09-17: LTV-008 creates immutable
`lightview@1.0.7`, pinned to formal Lightview 0.1.7. The version gate remains
exact: the new Driver rejects 0.1.6 and unknown versions. Upstream 0.1.7 keeps
images enabled in low-memory mode and automatically saves downloads to the
runtime user's standard Downloads directory without overwriting existing
files. Core, SDK, Manager APIs, private control metadata, `openUrl`, profile and
lifecycle contracts do not change. Complete automated and real-X11 gates passed,
and the operator explicitly authorized formal GitHub publication without a
separate interactive UI-UAT claim. Annotated tag
[`lightview-v1.0.7`](private-history.md)
publishes only the deterministic archive (SHA-256
`512eeed017ae52f994e2911d8f203a480a6c9c43a26e54b828298f18ef00ad61`)
and checksum. Fresh downloads match the tested bytes. No endpoint deployment
is authorized; sandbox deployment belongs to the sandbox project. See the
[publication evidence](private-history.md).

Follow-up accepted 2026-09-17: LTV-007 advances the independent package to
`lightview@1.0.6`, pinned to the verified formal Lightview 0.1.6 release. It is
fully validated and accepted on loopback 1991/2992; formal GitHub publication
is authorized. Sandbox deployment remains separately gated.

Published and closed 2026-09-17 as annotated tag
[`lightview-v1.0.6`](private-history.md).
The release contains only `lightview-1.0.6.tar.gz` and its checksum; downloaded
bytes match local UAT SHA-256
`bc424aabdf8484734e4f35c75ff00345268343c237eb9f093724bd79e5d3f381`.

Status: formally published and closed on 2026-09-16. Target LightView
App Package `1.0.0`; Core remains `0.12.2` and SDK remains `0.28.0`. Package-only
deployment to both loopback local environments is authorized after production
quality gates pass. Publication, sandbox deployment and downstream adoption are
not authorized by this lock.

The immutable `lightview-1.0.0.tar.gz` candidate is active on loopback 1991 and
2992. Automated acceptance and human UAT are complete. This local
container cannot run WebKitGTK's bubblewrap sandbox, so only these local UAT
runtimes inherit WebKit's explicit unsafe sandbox override. The package does not
contain that override, and a production host must support the normal WebKit
sandbox. See the [evidence record](private-history.md).

Annotated tag [`lightview-v1.0.0`](private-history.md)
publishes only the accepted deterministic App archive and checksum. Downloaded
assets match the UAT bytes, while RemoteXApp Latest remains Core `v0.12.2`.
See the [publication evidence](private-history.md).

## Purpose and user-visible policy

Add template ID and display name `lightview` as an independent App Package.
Follow the accepted Edge/Firefox shared-browser lifecycle: one anonymous
singleton runtime, shared persistent profile `default`, on-attach session,
dynamic 1280×720 depth-16 framebuffer at 5 FPS, client resize, and complete
runtime stop after six hours detached. The next launch reuses website data.
`startUrl` accepts HTTP, HTTPS or exactly `about:blank` and defaults to blank.

Every template launch must include `--low-memory`. This is locked App policy,
not an instance parameter or allowed override. LightView currently maps it to a
384 MiB WebKit per-process memory-pressure target. In the 1.0.8 follow-up it
keeps normal images enabled and disables WebRTC, WebGL and accelerated 2D canvas. Media playback, Media Source, encrypted
media and WebAudio remain enabled. The target is advisory cache/process pressure, not a cgroup limit or
hard guarantee on whole-runtime RSS/PSS. A WebKit process that reaches the
upstream 3072 MiB last-resort floor is terminated and recovered behind the
stable LightView process. Do not advertise either value as a whole-runtime cap.

Use Matchbox and Core-owned session D-Bus/IBus/Unicode/clipboard services.
LightView remains a single-view WebKit browser; this requirement does not add
tabs, a download manager UI, password management, popup windows, DRM or
browser-extension compatibility. Lightview 0.1.7 itself automatically saves
website downloads without a destination prompt.

## Native control contract

LightView 0.1.8 exposes a Unix stream socket selected with `--socket PATH`.
Each connection sends one newline-terminated UTF-8 JSON request and receives
one newline-terminated JSON response before close. Native commands include
`status`, `open`, `eval`, navigation, reload/stop/reset and quit. The protocol
limits requests to 1 MiB, responses to 4 MiB, concurrent clients to 16 and each
connection to about 30 seconds. The socket directory must be owned by the
runtime user with mode 0700; LightView creates the socket under umask 0077 and
rejects peers whose Unix UID differs.

The Driver uses an explicit short path below `REMOTEXAPP_RUNTIME`, for example
`$REMOTEXAPP_RUNTIME/lightview/control.sock`, and launches:

```text
lightview --low-memory --profile PROFILE --socket SOCKET START_URL
```

Do not declare a V1 named TCP port. After verifying process, visible window and
native `status`, publish this bounded private connection descriptor:

```json
{
  "protocol": "lightview-json-v1",
  "transport": "unix",
  "socketPath": "/run/user/1000/remotexappd/<runtime>/lightview/control.sock"
}
```

Declare it as `session.status.privateDetails.application` and submit it through
`session_status_report --connection-application`. Existing CONN-001 machinery
then returns it in `getConnections().application` only while the exact session
generation and canonical process are ready. Do not copy it into public status,
diagnostics or logs. Remote callers receive a descriptor, not network access to
the local socket.

## Driver lifecycle and readiness

The session Driver starts Matchbox, prepares the persistent profile, removes no
unknown path, and lets LightView perform its own conservative stale-socket check.
It reports ready only when all of the following remain true:

1. the launched LightView PID is alive and is the canonical readiness process;
2. a visible window with the expected `lightview` class exists;
3. the configured path is an owned Unix socket inside the expected runtime;
4. `{"command":"status"}` succeeds within a short bounded probe; and
5. returned `result.pid` equals the launched PID;
6. `engine_state` is `ready` with a positive `web_process_generation`; and
7. under the historical 1.0.8/1.0.9 contract, low-memory and termination
   thresholds were exactly 384 and 3072 MiB. LTV-011 removes this memory-policy
   readiness condition in 1.0.10; conditions 1–6 remain required.

An initial navigation error is reported as a Driver error rather than hidden.
Normal shutdown first sends native `quit`; existing host grace/refusal/force
policy remains authoritative. Cleanup targets only recorded owned processes and
the exact expected socket. Crash recovery must tolerate LightView's verified
stale-socket recovery but reject a live, foreign-owned or substituted endpoint.

## Actions and trust boundary

Expose one package-owned `openUrl` action that validates HTTP/HTTPS and sends
the native `open` request. It returns the requested URL and current URI/status
after bounded load validation. Do not expose `eval` through a generic Manager
action: it can read and modify signed-in page state and is equivalent to trusted
local browser automation. A local Agent obtains the socket from
`getConnections()`, revalidates generation/revision and connects directly as
the runtime UID. The Manager does not interpret, proxy or authenticate the
LightView wire protocol.

## Dependency and delivery

The manifest declares `lightview`, Matchbox, `jq`, `python3`, `seq`, `sleep` and
`xdotool` as required executables; add `lightviewctl` only if the final Driver
actually invokes it. Pin a supported LightView release and checksum in operator
documentation. Installing the host binary remains provisioning work; the App
Package neither downloads nor embeds it. Activation must work through the
existing immutable package-only path without rebuilding Core or SDK.

## Acceptance gates

- Manifest/Driver tests cover exact policy, URL validation, private descriptor,
  mandatory non-overridable `--low-memory`, status bounds and absence of a TCP
  resource or public `eval` action.
- Real X11 tests cover visible-window plus socket/PID readiness, Viewer input,
  IME, clipboard, resize and initial-load errors. Native `status` must report
  `low_memory:true` and `memory_limit_mib:384`; feature probes confirm the
  documented WebGL/media reductions without claiming a hard memory ceiling.
- Control tests cover every native command needed by readiness/shutdown/action,
  concurrent clients, timeout/oversize failures, same-UID success and different-
  UID denial without publishing the socket through a network proxy.
- Lifecycle tests cover multiple Viewers sharing one runtime, Manager restart
  adoption, App exit, stale socket after crash, replacement attacks, ordinary
  restart, upgrade-and-restart, simulated six-hour vacancy and exact cleanup.
- Profile tests prove cookie/local-storage continuity across stopped runtime
  recreation and prevent a second process from sharing the locked profile.
- Package-only install, activation, rollback, dependency failure, release gates,
  exact candidate E2E and human UAT pass before publication or deployment.

LightView's existing real integration suite passed all six tests during this
requirements review, including native socket protocol, profile locking,
concurrency, load errors and crash stale-socket recovery. That establishes
feasibility only; it is not RemoteXApp implementation or acceptance evidence.
