# Native Viewer lease recovery qualification

Issue [#68](https://github.com/woodegg/remotexapp/issues/68), PR
[#69](https://github.com/woodegg/remotexapp/pull/69), measured 2026-11-20.
This is local development qualification of SDK 0.31.1. The earlier SDK 0.31.0
[failed run](../session-services/LOCAL-E2E-20261120.md) remains unchanged.
[Machine-readable evidence](../evidence/v1/native-lease-recovery-20261120.json)
binds this new result to its own artifact, test sources and private raw results.

## Defect and correction

A transient HTTP failure at the 20-second lease-renewal boundary was treated
as `grant-expired`, closing the display without scheduling recovery. The new
deterministic regression failed on that implementation before the repair.

SDK 0.31.1 distinguishes transient network/service errors from explicit lease
rejection. It retires the old connection and grant, then uses the existing
bounded reconnect policy: authenticated runtime read, same-generation/component
checks, prepare, and a fresh one-use grant. A renewal request has a ten-second
deadline. Old callbacks cannot replace a newer connection; input/actions are
never replayed and clipboard consent resets with the connection epoch.

`RemoteXAppHost` supplies its reconnect policy. Direct `RemoteXAppNativeClient`
use still defaults to `reconnect:false`; callers enable it explicitly. The
standalone native Viewer page retains that default. This qualification exercises
the host workbench at `/rx/sdk/host.html`, not an implicit change to every
embedding application's policy. No server authorization or Kasm component code
changed in this repair.

## Artifact and environment

Built once from clean source `708fbea2c665528b32e98b5db1da1a415b985288`, Go
1.27.4, SDK 0.31.1. Archive `remotexapp-0.16.0-linux-amd64.tar.gz`, SHA-256
`ea554b58a4f85c6842d864a5e603b5e52a05eea78ad3b1fa4c77e318fbeb2ab5`.
It uses a separate development installation directory, not a replacement tag
or an overwritten public release. Later evidence/harness commits do not change
the artifact's source identity.

Live checks use project-owned Ubuntu AMD64/systemd fixtures, the existing
qualified Kasm component, Node 22.22.3 and isolated Chrome 149.0.7827.102.
The component manifest SHA-256 is
`e3055aae24a0b325e22dee924d0b493b5a26c78799610da50d403668bd8e37b3`.
HTTP failure injection occurs in an owned loopback connector; browser offline
injection affects only the owned page. It does not modify an identity provider.

## Results

All ten fault modes pass. Five prove automatic recovery; the other five prove
that protected stop conditions remain stopped, followed by a separate explicit
reconnect. Every recovered attachment must paint a fresh connection epoch,
retain App generation/session-service identities and saved text, and save new
input through the real Viewer. An API-ready response alone is insufficient.

| Automatic recovery | Measured interval |
| --- | --- |
| Browser offline across lease renewal | 1,211 ms after networking returns |
| Manager SIGKILL with systemd supervision | 6,485 ms after injection |
| Three-second frontend outage | 304 ms after restoration |
| One synthetic lease HTTP 503 | 1,370 ms after the injected response |
| Held lease response | 11,300 ms after the request, including the ten-second timeout; held request released |

These are individual functional observations, not latency guarantees or a
performance benchmark. HTTP 401/403/409 each leaves the Viewer failed with no
new grant. Continued offline operation exhausts the finite retry budget, and
explicit disconnect cancels retries. Network restoration alone cannot undo
either condition. Manual reconnect is tested separately after those assertions.

Additional completed gates:

- 65 focused deterministic native-client/reconnect tests, including transient
  HTTP classifications, terminal denials, fresh authorization failure,
  generation/component replacement, cancellation, stale callbacks, independent
  Viewers and no replay.
- `make check`, coverage floors, release metadata checks, source vulnerability
  scanning, immutable-archive verification and all four binary vulnerability
  scans. SDK coverage: 89.77% lines, 83.22% branches, 83.94% functions.
- Eight full native host suites, 44 checks: eight formal templates, host
  workflows, audio/clipboard, lifecycle, two actual container reboots, Manager
  rollback, shutdown veto and managed desktop entry.
- Real canvas pointer/arrow-key input with saved-file readback, ten synthetic
  IME focus transitions, and four platform shortcut policies. Physical OS IME
  operation is not inferred from these synthetic events.
- Deployed legacy test service: real paint and Unicode/clipboard readback
  before/after Manager restart, preserved generation/services, and raw input
  remains usable after an injected Unicode-engine failure.
- Deployed native UAT through its trusted edge: workflow/channel checks plus
  another lease-outage recovery, with SDK 0.31.1 checked in the browser and all
  13 directly served asset hashes verified. A temporary loopback connector
  supplies the configured Host/Origin; this is not Cloudflare/TLS qualification.

## Retained deployment attempts and cleanup

The first legacy deployment check incorrectly required stopped, unmanaged
runtime list entries to survive a Manager restart. It rolled back; the restored
old version also removed these transient entries. The retry used an empty
inventory and verified the already staged artifact before activation. Native
deployment checks retain all managed/live identities while allowing only fully
stopped unmanaged entries to disappear. Product code was not changed for this.

The first edge activation checked HTTP before the newly started process was
listening and rolled back. A bounded readiness wait fixed the deployment
script; the subsequent exact asset checks and real-browser suites passed.
Both attempts remain private evidence rather than being relabeled successful.

The local legacy test service, native UAT and trusted edge retain the tested
artifact. Owned test Apps/Viewers and browser connections are closed. The native
fault container is stopped, and the earlier legacy fault container remains
stopped. The original non-test Manager and display process PID/start-time
identities are unchanged. No sandbox or regional environment was operated.

## Scope still outside this result

This closes the demonstrated lease-renewal gap for callers with reconnect
enabled. It does not establish universal self-healing: the
[fault matrix](../session-services/FAULT-RECOVERY-MATRIX.md) still identifies
input-helper, borrowed-bus and live-App gateway cases needing explicit repair.
The earlier 375-checkpoint broad matrix and legacy full-release suites belong
to the prior artifact and are not counted as reruns here. Go/server code is
unchanged from that parent work.

Physical IMEs/audio devices, public TLS/Cloudflare/WAN/NAT, a new UDP loss or
MTU experiment, Alpine/ARM64 qualification, disk-full/OOM experiments and a new
long-duration soak remain separate. This is not renewed human UAT acceptance,
a merge, post-merge release qualification or publication.
