# Release trains and future work

Source identity is maintained in [current-state.md](current-state.md). The released baseline is Core 0.15.0 / SDK 0.30.0,
[published and verified](managed-recovery-0.15.0-qualification.md) on 2026-10-21.
Earlier candidate labels are historical. Deployment is owned by each target's
operator.

<a id="proposed-core-0160--kasmvnc-integration-evaluation"></a>

## Core 0.16.0 development — native integration

The owner selected evaluating KasmVNC as the replacement for the current
TigerVNC/noVNC integration, including container audio and clipboard.
[Issue #24](https://github.com/woodegg/remotexapp/issues/24) and
[Milestone 0.16.0](https://github.com/woodegg/remotexapp/milestone/3) track the
[evaluation and acceptance gates](kasmvnc-0.16.0-evaluation.md), KVE-001–008.
The research direction now has bounded implementations merged through
#31, #33, #35 and #37: Kasm/WSS, native input/text clipboard, Alpine static Core
and optional IPv4 UDP/diagnostics. Source is Core 0.16.0-dev.3 / SDK 0.31.0-dev.3;
the published baseline remains 0.15.0 / 0.30.0. The default provider has not
changed, and the bounded #37 UAT does not qualify the full release.
The frozen research baseline feeds the
[native architecture](kasm-native-architecture.md), with remaining input/host,
audio and product qualification tracked separately. AUD-002's
connection timing (R3) was accepted as a design decision on 2026-10-25, without
full implementation acceptance at that time. Current standalone acceptance is
recorded below. AUD-002 explicitly proposes changes
to the original AUD-001 audio scope; KasmVNC and optional audio services remain
separate components. [D3 / Issue #45](https://github.com/woodegg/remotexapp/issues/45)
now has an implemented standalone candidate in PR #49 (workbench #48), Core
0.16.0-dev.4 / SDK 0.31.0-dev.4 at `7926949`. The owner reported its current
audio UAT passed on 2026-11-01; [evidence and limits](https://github.com/woodegg/remotexapp/blob/5c2a5f386e42f4529c206c2ed63e341b483d4830/tests/native-audio/qualification-7926949.md)
remain separate from actual embedding-host and release qualification. The
[original integration plan](native-audio-integration.md) retains the preparation
sequence; PR review/merge and exact post-merge qualification are next. The abandoned multi-container UDP Host Agent proposal
is not a dependency; current static deployment-owned UDP configuration remains.

## Separate release train: Core 0.14.5, Go 1.27.3

The protected release/0.14.5 branch retains the reviewed pre-lifecycle-change
source for this train. Locked 2026-10-07 for implementation and local UAT. Upgrade the exact Go build
toolchain from
`1.26.8` to `1.27.3` and qualify newly compiled Core binaries. Core `0.14.5`
is the release target; SDK `0.29.1` and existing App Package versions remain
unchanged unless implementation reveals a separately reviewed change.

The [Go toolchain release plan](go-toolchain-0.14.5-release.md) defines the
implementation scope, acceptance matrix and rollback. REL-009 defines the
new exact build pin; REL-002–004 and REL-010–014
continue to govern qualification and immutable publication. Publication remains
pending fresh candidate qualification and human UAT. The 2026-10-07 Go 1.27.1
qualification remains historical; the 2026-10-21 security update requires
Go 1.27.3 and renewed acceptance.

## Completed Core 0.15.0 — managed desktop self-recovery

MSR-001–007 shipped in Core 0.15.0 / SDK 0.30.0. Implementation Issue #2,
release Issue #3 and Milestone 0.15.0 are complete. Exact-archive qualification,
six actual container reboots and owner UAT passed; formal release downloads
match the accepted candidate. See the
[qualification and publication record](managed-recovery-0.15.0-qualification.md).
The separate 0.14.5 train remains pending; publication does not deploy it.

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
integration (AUD-001). These are proposals, not shipped features. AUD-001 is included in the
KasmVNC evaluation above as historical scope. Its AUD-002 replacement now has
a standalone implementation and owner UAT decision in #45/#49; it remains
unpublished and does not qualify deferred multi-server work.

## Selecting a new train

Record the problem, stable IDs, component owner, compatibility impact,
acceptance matrix, rollback and deferred scope. Update requirements and the
changelog; append a design decision when invariants or trust boundaries change.
Run focused checks and `make check`, then qualify the exact immutable candidate
and record human UAT. [Release policy](release-policy.md) and
[release process](release-process.md) govern publication. A feature proposal or
publication does not authorize an operator's deployment or runtime restart.
