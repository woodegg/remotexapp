# KasmVNC integration evaluation — proposed Core 0.16.0

Selected for evaluation on 2026-10-21 by the owner: consider replacing
TigerVNC and the current noVNC integration with KasmVNC, including container
audio and clipboard. [Issue #24](https://github.com/woodegg/remotexapp/issues/24)
and [Milestone 0.16.0](https://github.com/woodegg/remotexapp/milestone/3) track
this work. This is an evaluation plan; replacement feasibility and the default
switch are not accepted yet. VERSION remains 0.15.0 / SDK 0.30.0.

## Inspected upstream baseline

| Component | Inspected identity | Relevance |
| --- | --- | --- |
| KasmVNC server | [v1.5.0](https://github.com/kasmtech/KasmVNC/releases/tag/v1.5.0), source `17265facc40ab50db5740cdf0d12c61173edafc9` | Starting evaluation version; not an automatic moving dependency |
| Kasm browser client | [kasmweb submodule](https://github.com/kasmtech/KasmVNC/tree/v1.5.0/kasmweb), kasmtech/noVNC `475ecfa5356579ef222983c7ce4619a7576a3bce` | A forked client must be evaluated alongside the server |
| Container service reference | [startup script](https://github.com/kasmtech/workspaces-core-images/blob/357d80ad64ced141614e828822b7d31075fc0723/src/common/startup_scripts/vnc_startup.sh) | Launches separate audio playback/input services; reference inspection is not a runtime pin or a tested image |

The [release README](https://github.com/kasmtech/KasmVNC/blob/v1.5.0/README.md)
states divergence from RFB and no legacy VNC Viewer support. This rules out
assuming the existing TigerVNC/noVNC pair can be swapped one component at a
time without protocol review. The official browser client is itself a noVNC
fork: the goal is replacing our current integration, not claiming removal of
all noVNC-derived code.

KasmVNC's [server license](https://github.com/kasmtech/KasmVNC/blob/v1.5.0/LICENSE.TXT)
is GPL-2.0; the pinned browser client's
[license notice](https://github.com/kasmtech/noVNC/blob/475ecfa5356579ef222983c7ce4619a7576a3bce/LICENSE.txt)
describes MPL-2.0 core files and other asset licenses. Inventory actual files,
modifications, linking/process boundaries, source availability and distribution
obligations before bundling. Preserve RemoteXApp's Apache-2.0 source license;
this plan makes no legal compatibility determination and does not copy
upstream implementation into the repository.

## Integration boundaries to prove

Retain the Manager, App Package catalog, public SDK and selected non-root
ownership as the product boundaries. First try an opt-in paired server/client
adapter behind the authenticated Manager route. Determine whether the gateway
can proxy the new display transport while retaining current generation fencing,
input acknowledgements and diagnostics. Do not assume `novnc-input` or the
IBus/Unicode path becomes unnecessary: prove composition and clipboard behavior
before selecting which components can be removed.

Test SDK embedding, lazy asset imports, Console and ordinary Viewer integration
without coupling consumers to the upstream toolbar. Verify base paths, CSP,
Origin checks, authentication and reconnect; do not expose upstream control
APIs, credentials, audio listeners or VNC sockets publicly. Determine the SDK
version impact after an API/behavior comparison. Runtime/component manifests
must pin both sides of the selected transport and remain auditable.

Containers are the initial test environment, not a decision to replace all
App lifecycle management with Docker or Kasm Workspaces. Prove the actual
runtime/UID/cgroup model before changing systemd or standalone ownership.

## Audio scope

[AUD-001](release-pending.md#aud-001--server-scoped-shared-audio-integration)
remains authoritative. Kasm container startup references separate audio-out
and audio-input helpers plus PulseAudio/encoding processes. Identify each
helper's source, license, buildability, protocol and authentication. Verify
which features work without Kasm Workspaces; do not infer usable audio from
KasmVNC installation or a browser control alone.

Use one bidirectional connection per server/client coordination scope, shared
across that server's runtimes, with independent playback/microphone controls,
both off initially. One explicit microphone target and cross-Tab playback
ownership must survive handoff without silent capture or duplicate sound.
Stopping one App must not stop another App's audio; audio activity must not
implicitly keep every runtime alive. Shared-user audio is not per-App isolation.

## Acceptance matrix

| ID | Required evidence before implementation/default switch |
| --- | --- |
| KVE-001 | Pin server/client/image/helper sources and checksums; inventory licenses and redistribution; identify independently usable audio components and unsupported host/browser combinations. |
| KVE-002 | Real XFCE and representative single-App rendering, pointer/wheel, modifiers, first-character Chinese IME, composition commit/cancel, secure-field policy, focus, fixed/dynamic resize and reconnect; compare against 0.15.0 in Chromium and Firefox, with explicit Safari decision. |
| KVE-003 | SDK/Console embedding, base-path/auth/Origin/CSP behavior and stale-generation fencing; preserve input ordering/acknowledgements and owned old-channel retirement. |
| KVE-004 | Text/Unicode, HTML/image, empty/no-op versus explicit clear, size limits, permission denial, manual/prompt/auto modes, multiple Viewers, rebound prevention and stale offers; no bypass of the existing public clipboard contract. |
| KVE-005 | Actual playback and microphone readback, explicit permissions, default-off behavior, multi-Tab ownership, reconnect/outage isolation and component cleanup, following AUD-001. |
| KVE-006 | Manager adoption, shutdown veto, profile/HOME retention, component pins, both lifecycle backends, populated-process protection, automatic recovery and actual container reboot matrix. |
| KVE-007 | Reproducible same-host/workload baseline versus candidate: CPU/memory, bandwidth, latency and image quality, with experiment README, manifest and result JSON; no performance claim from feature lists. |
| KVE-008 | Written go/no-go, scoped implementation Issues, version/API/migration decisions, rollback and exact-candidate gates before changing defaults; human UAT and publication remain separate. |

## Execution and decision gates

1. Inventory dependencies and compare protocol/SDK surfaces. Record facts and
   unknowns, then select exact PoC packages/images rather than moving tags.
2. Build a minimal proof of concept (PoC) on a new project-owned disposable
   environment. Exercise display, Chinese input, clipboard and real audio.
   Leave the accepted UAT environment and all sandbox deployments untouched.
3. Record measured evidence and gaps. Choose whether to adopt, retain an
   opt-in experimental backend, or defer. A failed feasibility result is valid;
   do not publish a replacement that drops accepted behavior.
4. If viable, lock implementation slices and component versions through PRs.
   Retain the current transport during comparison. Do not mix incompatible
   server/client halves or rewrite live runtime pins during a Manager restart.
5. Qualify an exact post-merge candidate, run affected full suites and human
   UAT, then separately authorize publication. Deployment belongs to its owner.

Before activation, retain the prior release and pre-change state/HOME snapshot.
State whether rollback is selector-only or needs scoped stop/recreation; do not
promise adoption of a live X server across different transport implementations.
New durable formats require explicit migration and downgrade treatment.

Multi-server orchestration RTC-005 and external lease owners RTC-006 remain
outside this evaluation; audio must still respect server identity boundaries.
