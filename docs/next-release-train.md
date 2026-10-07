# Release trains and future work

Source identity is maintained in [current-state.md](current-state.md). The
public source targets Core 0.14.5 / SDK 0.29.1; the released baseline is
Core 0.14.4. Earlier candidate labels and
local acceptance states are historical, not a list of work still awaiting
publication. Deployment is owned by each target's operator.

## Locked next train: Core 0.14.5, Go 1.27.1

Locked 2026-10-07 for implementation and local UAT. Upgrade the exact Go build
toolchain from
`1.26.8` to `1.27.1` and qualify newly compiled Core binaries. Core `0.14.5`
is the release target; SDK `0.29.1` and existing App Package versions remain
unchanged unless implementation reveals a separately reviewed change.

The [Go toolchain release plan](go-toolchain-0.14.5-release.md) defines the
implementation scope, acceptance matrix and rollback. REL-009 defines the
new exact build pin; REL-002–004 and REL-010–014
continue to govern qualification and immutable publication. Publication remains
pending exact-candidate qualification and human UAT.

## Included technical trains

| Train | Stable requirement IDs | Contract and qualification |
|---|---|---|
| Managed session recovery, Core 0.14.2 | RTM-019–021 | [Bounded recovery](managed-session-recovery-release.md); retain surviving user processes and durable attempt limits. The real-host leader-exit test exercised an empty cgroup; the populated branch has controlled fixture coverage. |
| LightView Viewer wakeup, Core 0.14.1 / App 1.0.13 | LTV-013 | [Viewer hooks](lightview-app-package-release.md); App requires Core 0.14.1 or later. Hibernation recovery is not a DOM/form-state checkpoint. |
| Standalone/runit, Core 0.14.0 | RUN-001–007, DEP-017 | [Backend contract](standalone-runit-release.md); explicit selected UID and delegated cgroup v2. Host reboot persistence was not certified at acceptance. |
| Startup failure diagnostics, Core 0.13.1 | RTM-018, EDGE-006 | [Requirements](requirements.md); bounded two-minute anonymous startup-failure retention, without changing healthy vacancy policy. |
| Idle leases and Coordinator, Core 0.13.0 / SDK 0.29.1 | IDL-001–004, RTC-001–004, RTC-007 | [Coordinator contract](runtime-coordinator-release.md); one server, explicit interests, best-effort browser background ownership. |

Earlier technical trains are recorded in [requirements](requirements.md), the
[design log](design-log.md) and [changelog](../CHANGELOG.md). Accepted decisions
remain in force unless a dated replacement explicitly supersedes them.

## Deferred scope

[Release pending](release-pending.md) records multiple concurrent servers
(RTC-005), reliable external lease owners (RTC-006) and shared playback/microphone
integration (AUD-001). These are proposals, not shipped features or selected
implementation work. Promote a requirement into a reviewed train before coding.

## Selecting a new train

Record the problem, stable IDs, component owner, compatibility impact,
acceptance matrix, rollback and deferred scope. Update requirements and the
changelog; append a design decision when invariants or trust boundaries change.
Run focused checks and `make check`, then qualify the exact immutable candidate
and record human UAT. [Release policy](release-policy.md) and
[release process](release-process.md) govern publication. A feature proposal or
publication does not authorize an operator's deployment or runtime restart.
