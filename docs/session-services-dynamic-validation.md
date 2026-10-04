# Core session-services dynamic-state validation

Status: **rc.2 repaired gates passed, UAT accepted; stable 0.12.0 published**
(2026-09-14). The original rc.1 failed gate and its seven blocker categories
remain below. Initial seven-App E2E passes did not prove every App/state/API
combination; do not promote `0.12.0-rc.1` on that basis.

Operator acceptance supersedes the historical pending-UAT statements below;
see [acceptance and stable promotion provenance](private-history.md).
No deployment alignment was requested with publication.

Stable commit `3037ca136f58` subsequently passed all seven exact-archive E2E
suites on the first run plus the stopped-cutover rehearsal; hosted, independent
local and published archives are identical. This does not relabel the rc.2
dynamic matrix as a stable-archive run. See
[stable publication evidence](private-history.md).

## Repair follow-up — 2026-09-14 (automated validation and local deployment complete)

The operator now authorizes fixes and continued comprehensive local testing.
SVC-F01–09 have targeted implementation changes and new regression tests.
The final fixed-candidate dynamic matrices passed 361 checkpoints, including
2,235 recorded HTTP status assertions, with no failed checkpoint. Exact-package
real Viewer, performance and final repeatability gates passed.
The original failures below remain historical evidence, not accepted behavior.
Both local endpoints now run the verified rc.2 archive; the desktop was upgraded
gracefully. No sandbox/GitHub release changed. See
[current local evidence](private-history.md).

Additional SVC-F08: repeated SIGTERM could kill the supervisor during deferred
cleanup because its signal handler was removed before cleanup ran. Disposable
process tests left service fixtures alive despite reporting success. Keep signal
handling through cleanup, assert actual child exit, and exercise a TERM-ignoring
Driver plus repeated signals. The corrected focused race test passed three
repetitions. 128 positively identified orphaned test fixtures from removed
temporary test directories were terminated; no real App/service or files were
removed. Production session cgroups additionally have bounded systemd cleanup;
the fixture leak alone does not prove the same number of production leaks.

The follow-up also covers supervisor failure while Manager is offline, Viewer
reconnect not relaunching a failed session, hook descendants using setsid,
cross-Manager hook serialization and bounded diagnostic output. No threshold
was relaxed: a race-instrumented test subprocess's default one-second exit
sleep is disabled only in the short-deadline test environment.

Additional SVC-F09: managed VNC SIGKILL exposed stale `/tmp/.X*-lock` and
`/tmp/.X11-unix/X*` entries. Runtime cleanup did not own these paths, so fixed
display recovery/new launch failed as "display busy". VNC and session cgroup
events could also arrive in the wrong order and trigger recovery before the
session's terminal failure was recorded. Private `x11-ownership.json` now
records the VNC PID/start identity plus device/inode identities of both paths.
After owned units stop, cleanup verifies no original/live server, exact same
UID/type/file identities, unchanged lock PID and no filesystem/abstract X/RFB
listener before unlinking. Unknown/replaced ownership is not guessed. Managed
event handling records lost-display session failure before recovery decisions.
Both real managed XFCE and eligible managed Edge transport retests now pass,
including explicit restart and fresh launch after VNC loss. Final frozen-archive
and Viewer gates subsequently passed as recorded below.

### Repaired dynamic matrix results

| Suite | Checkpoints passed | Recorded HTTP assertions |
|---|---:|---:|
| Seven-App lifecycle, restart, upgrade and Manager/service failures | 239 | 1,890 |
| Seven-App input/clipboard, natural exit/logout and runtime independence | 43 | 70 |
| Seven-App gateway/VNC failure and recovery (managed XFCE included) | 42 | 105 |
| Eligible managed Edge transport comparison | 6 | 15 |
| Disposable account-bus outage/recovery | 3 | 15 |
| Seven-App timeout/failed shutdown hooks and crash-persistent enforcement | 28 | 140 |

These counts are assertions/checkpoints, not independent exhaustive scenarios.
See the [machine-readable repaired gate](private-history.md).
Firefox's interrupted graceful upgrade also exercised the conditional blocked
response followed by explicit force recovery of the disposable test App. That
does not authorize forcing a real user's blocked shutdown.
The instrumented matrix used archive A (`d47210f28c62865ad584a9afe8a0c4cbb024b8cb6e8d148011a1a4175dfced7d`).
Final installable archive B (`eb97b7941be80035f00e58f417da5f5c7dc161dcdb096c20a0fedcd62835a98f`)
has byte-identical four Core binaries, runtime helpers and App scripts. Four
manifests increment patch versions because an earlier whitespace cleanup would
otherwise conflict with installed immutable packages; no old package is replaced.
The harness overwrites those patch versions, and its serialized test manifests
were mechanically verified identical for A and B. Two contract-test version
assertions also change, but tests are excluded from installed App archives.
Final real-App/Viewer, cutover, resource and deployment gates use B explicitly;
the dynamic matrices must not be labeled as byte-identical B archive tests.

The final B synthetic-plugin, shipped-App Viewer, optional-document, KDE/upgrade,
action/control, disposable-XFCE, service-fault and clean-cutover suites passed.
An additional real XFCE Viewer run verified fixed framebuffer, Unicode/clipboard
readback and unchanged service identities before/after Manager restart. P16's
five paired fresh/warm samples also pass every locked resource threshold. Final
20-iteration shuffled Go/Node and three fuzz gates passed. Both local Managers
now run rc.2, with preserved listener/configuration/Console policy; actual served
Viewers passed restart/input/clipboard checks. The desktop upgraded gracefully
from generation 1 to 3 with new pinned services and old owned processes gone.
Its stable IBus pathname is reused; generation and PID/start identities prove
replacement. An initial deployment assertion wrongly required a new pathname;
read-only corrected validation passed without a second upgrade. Human UAT is
not claimed.

## Completion audit — XFCE saved-session restoration, 2026-09-14

The named XFCE saved-session gate was not established by the earlier
`--logout --fast` test: that option deliberately skips saving. A new disposable
UID test now enables SaveOnExit and saves an actual XSMP XFCE Terminal command
opening a Mousepad document. After ordinary logout, the old editor must exit;
XFCE itself must restore a new visible editor containing the original document.
The test does not synthesize the session file or relaunch the applications.

It verifies the restored environment/current generation, exactly one live
IBus and Unicode engine with recorded PID/start/cgroup identities, and an
unchanged borrowed account bus. Actual served-Viewer Unicode and clipboard
readback then pass in that restored editor before/after Manager restart.
Ordinary runtime restart and subsequent IBus loss also pass without silently
replacing the App. See [saved-session evidence and raw hashes](private-history.md).

Three consecutive full runs passed; the final two use the identical final
harness with an explicit five-second degradation bound. The last observed
`409 -> 200` within 111 ms after IBus termination: a fail-closed identity race,
then an omitted IBus address with `not-running`, unchanged App/generation.
Preparation failures are retained: Mousepad's independent crash-recovery modal,
an overly broad test process classifier, and a test that incorrectly required
the first concurrent teardown query to be a stable descriptor. These are harness
corrections, not additional production fixes. Only temporary profile settings
changed; production binaries, deployment configuration and the real desktop
were untouched. Temporary users and test HOME files were removed after evidence
collection. This closes the automated saved-session gap, not human UAT.

## Original failed rc.1 run: scope and provenance

Operator requested per-template restart, upgrade, service-state combinations
and API validation on 2026-09-13. Tests use the frozen local UAT Core archive
(`57a9dc17b2740361936ab2eb8d32c475ab2cd7284b768b9ad7a341ae81be4f36`)
under a newly created locked UID. All seven real applications are in scope.
Local 1991/2992, the real desktop, sandboxes and production gateways are not
mutation/fault-injection targets. No production code fix or redeployment is
part of this test-only follow-up.

App scripts remain unchanged but test packages add outer startup/shutdown
barriers, patch-version upgrade targets and XFCE display relocation. An inert
Core helper marker supplies an alternative coherent new-architecture pin.
These instrumented tests complement, not replace, the exact-package and real
served-Viewer suites. See [repeatable harness](../tests/session-services/README.md).

## Reproduced findings

### SVC-F01: failed session becomes a fresh session on Manager restart

Reproduction: launch a real App, kill its owned private D-Bus, wait for the
dependent App to exit and `sessionState=failed`, then SIGKILL/restart Manager.
Mousepad and LibreOffice go from generation 1 to 2 and `running` without an
explicit App restart. Killing the supervisor has the same recovery effect.

Cause: `restoreRuntimeManifests` treats an already-failed session as incomplete;
when no live App remains, `DesiredState=running` drives the generic cleanup and
`createRecoveryRuntimeLocked` path. The existing recovery policy conflicts with
SVC-006's new failure-preservation contract. This is not evidence that a live
unsaved document was lost in this test; these Apps had already exited.

Required resolution: distinguish an interrupted requested transaction from a
completed/observed failed session. Preserve failure/generation until explicit
recovery, while retaining deliberately requested stop/upgrade and host policy.
Do not disable all managed recovery or change desired-state semantics blindly.

### SVC-F02: interrupted upgrade replaces a live starting generation

Reproduction: start an upgrade, hold the new Driver before App launch, then
SIGKILL/restart Manager. Mousepad/LibreOffice's live generation 9 is replaced
with generation 11 and a different supervisor. Old children are cleaned, but
startup continuity is not preserved.

Cause: `restoreUpgrade` runs before the normal `resumeSessionStartup` path.
Its `launching` branch tests completed adoption only; a valid still-starting
session fails that check and falls through to `continueUpgrade`, which stops
and launches again.

Required resolution: resume the original bounded startup within the frozen
upgrade target/generation, then complete the durable transaction. Keep PID,
cgroup, target identity and original deadline checks; no unbounded retries.

### SVC-F03: Kate/KWrite startup adoption assumes the wrong canonical PID

Reproduction: hold the real Kate/KWrite Driver before launch, SIGKILL Manager,
release the barrier and restart Manager. Instead of adopting generation 1,
startup waits to its deadline and creates generation 2.

Cause: `resumeSessionStartup` requires the canonical readiness PID to equal
the supervisor's Driver PID. Kate/KWrite intentionally publish their actual
application child PID. Both identities are valid but represent different
processes. Healthy steady-state API calls already support that distinction.

Required resolution: independently validate the canonical App and Driver
identities in the pinned session cgroup; do not equate them or fall back to
UID-only checks. Include actual KDE Apps in startup-interruption regression.

### SVC-F04: concurrent restart requests accepted repeatedly for on-attach Apps

Reproduction: Firefox/Edge/XFCE running; issue three concurrent `/restart`
requests with the same generation and `force:true`. All three return success.

Cause: restart serializes requests, but recreates an on-attach runtime with the
same session generation until the next Viewer attachment. Queued requests
therefore still pass the generation fence and repeat server teardown/startup.
The responsible restart implementation also exists in the preceding committed
code; do not describe this as proven newly introduced by the service refactor.

Required resolution: fence a lifecycle mutation independently of a later
session activation, or reject pending duplicate transitions. Review sequential
retry semantics and SDK generation use before choosing the minimal change.

### SVC-F05: shutdown hook survives Manager death and overlaps recovery

Reproduction: during an upgrade's stopping phase, hold the real shutdown hook
in the outer test barrier. Record its PID/start time and verify it is a direct
Manager child. SIGKILL Manager. The same hook process remains alive. Releasing
the barrier lets it act on the application while restarted Manager executes a
new shutdown hook. Firefox/Edge recovery has returned `blocked` with
`application has no closeable X11 window` in this sequence.

The surviving hook is directly verified. The duplicate-window-close race is
consistent with the recorded sequence and hook implementation; no claim is
made that every `no closeable window` report has this cause. Returning blocked
is itself correct refusal behavior, not permission to force the user's App.
The harness now supports conditional explicit force-resume for a disposable
blocked upgrade. The final browser run did not take that conditional branch;
its orphan-hook observation is directly tested, but that branch is not claimed
covered by the final run.

Cause: `runShutdownDriver` uses `exec.CommandContext` but no parent-death or
owned process-group lifetime handling. Killing the Manager prevents its context
deadline/cancellation from running. This implementation predates this train.

Required resolution: give hooks and their descendants explicit process lifetime
ownership and prevent an orphan invocation from racing resumed shutdown or a
new generation. Test Manager death and deadline/cancellation, preserving normal
save/refuse/host-force behavior; do not broadly kill same-UID processes.

### SVC-F06: managed gateway recovery terminates a surviving application

The ordinary-runtime transport matrix preserves all six standalone Apps after
gateway SIGKILL. The same fault on managed XFCE triggers managed reconciliation
and terminates the still-live desktop session. A repeat with the outer shutdown
hook forced to refuse still terminates it. These are disposable desktops; no
claim is made that a real user's unsaved data was lost.

Cause: the managed event observer invokes `reconcileManagedLocked` on gateway
cgroup loss. It uses `item.Runtime`, which can still describe the original
server-only/stopped session, rather than refreshing the current runtime from
the authoritative instance map. Its stopped-session branch skips graceful
shutdown and proceeds to whole-runtime `stopUnits`. Independently, treating a
gateway health failure as an App replacement contradicts live-App preservation.

The managed Edge comparison reproduces the same live-App loss despite the
refusing hook. Its test-only manifest uses `stop-session` instead of the shipped
`stop-instance` vacancy action, because managed registrations reject that
shipped policy. Its six-hour timeout does not expire during this test. Direct
managed Mousepad/unaltered Edge rejection is correct validation, not a bug.

Required resolution: use the authoritative current runtime for policy and
cleanup; never use cached `stopped` to bypass a live App's shutdown contract.
Separate transport failure from application replacement. Fix before acceptance.

### SVC-F07: managed recovery reuses generation and accepts stale requests

Directly reproduced in managed XFCE and the eligible managed Edge fixture:
gateway loss replaces the supervisor and
App, but reconnect produces generation **1 again**, rather than a generation
greater than the old 1. `GET /connections?sessionGeneration=1` returns **200**
for the new session using the old generation. Subsequent VNC-loss recovery also
exposes generation 0. This invalidates the stale-session fence; clipboard/action
cross-generation effects were not exercised and must not be asserted as proven.

Cause: the same stale managed runtime snapshot is used to construct
`runtimeRecoveryRequest`. Its server-only generation 0 is carried forward and
the next activation increments it to 1 again. Merely adding more PID checks
does not fix this generation-authority error.

Required resolution: recover from the latest authoritative durable/live
generation, never regress/reuse it, and test old-generation connections,
environment, clipboard, restart/upgrade and App-action requests against the
replacement session. These are release blockers even if the new desktop looks
normal. After VNC-loss managed recovery, fresh-launch completion remains an
unpassed scenario and must be retested after the authority/cleanup fix.

## Test boundaries

The harness records successful assertions and failures separately and keeps
running other templates. A failing invariant is never reclassified as a pass
just to advance the suite. Harness defects (wrong failure label/invalid test
Viewer ID) are recorded separately from product findings.

No finite test exhausts all event orderings. Missing coverage must remain
explicit: full OS reboot, disk-full/power-loss durability, long-duration load,
every unsaved-document dialog, full six-hour/48-hour wall-clock waits and
every browser/native-IME combination are not established by this matrix.
Human UAT cannot substitute for fixing these reproduced lifecycle findings.

## Completed runs and acceptance decision

See [machine-readable evidence](private-history.md)
for exact artifact identity, raw evidence locations and earlier-attempt
dispositions. The main matrix uses the later complete browser runs instead
of double-counting their earlier aborted partial runs.

| Real App | Main state/API checkpoints: pass / fail | Input/clipboard/natural exit | Gateway/VNC faults |
|---|---:|---|---|
| Mousepad | 28 / 3 | 6 passed | 6 passed (standalone) |
| LibreOffice | 28 / 3 | 6 passed | 6 passed (standalone) |
| Kate | 26 / 3 | 6 passed | 6 passed (standalone) |
| KWrite | 26 / 3 | 6 passed | 6 passed (standalone) |
| Firefox ESR | 30 / 3 | 6 passed | 6 passed (standalone) |
| Edge | 30 / 3 | 6 passed | 6 passed standalone; managed comparison failed |
| XFCE user desktop | 28 / 2 | 7 passed | Failed managed recovery; fresh-launch path uncompleted |

Main matrix: **196 passed checkpoints, 20 failed**, with 1,645 recorded HTTP
status assertions. These are grouped checks, not 20 distinct bugs or exhaustive
timing coverage. Additional interaction matrix: 43 passed. Six standalone
transport matrices: 36 passed. Managed fault evidence adds SVC-F06/F07 and
uncompleted fresh-launch paths; those must not be counted as passing.

`make check` passed, and targeted supervisor/runtime/upgrade Go tests passed
under `-race -count=3 -shuffle=30913`. Their success does not supersede the live
failures. HTTP/API validation includes current/stale generations, readiness,
connections, canonical environment, action discovery/invocation, clipboard
capabilities/offers, attach, ordinary restart and explicit upgrade.

Recommended fix order: first SVC-F06/F07 (live-App/graceful policy and generation
authority), then F03/F02 (bounded startup/upgrade adoption), F05 (hook ownership),
F01 (terminal failure preservation), and F04 (duplicate lifecycle fencing).
Keep each as a reproducible regression. Rerun the whole matrix and served-Viewer
E2E after fixing; do not promote based on partial retests or human UAT alone.

Existing local 1991/2992 listeners/binaries were not changed. The actual user
XFCE remained `xfce-user-desktop-EXAMPLE`, generation 1. All temporary test
accounts were terminated/removed, evidence retained, and port 21996 was clear.
No sandbox/gateway mutation, commit, push, deployment or publication occurred.
