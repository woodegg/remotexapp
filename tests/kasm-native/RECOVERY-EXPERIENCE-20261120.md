# Native recovery experience qualification

Issue [#70](https://github.com/woodegg/remotexapp/issues/70), PR
[#71](https://github.com/woodegg/remotexapp/pull/71), measured 2026-11-20.
This qualifies a development SDK/Core pair through owned local fixtures.
Qualification is still in progress: resource review rejected the initial pair
below despite its functional passes. A corrected immutable native component
must complete requalification before local UAT activation.
Human UAT, downstream adoption, merge and formal release are separate gates.
The [design](../../docs/native-recovery-experience.md) and
[acceptance matrix](RECOVERY-EXPERIENCE.md) define the expected behavior.

## Identity and method

Final development source: `6c5e5309a947ed2ce9a65a037ea2f20d9b131f92`;
Core 0.16.0, SDK 0.32.0-dev.1, Go 1.27.4. The clean-source archive
`remotexapp-0.16.0-linux-amd64.tar.gz` has SHA-256
`4ed70d5abfdb574d9b27c205b17ed15f7b6c6485b4a15d629c4f5bace8a2480c`.
Its development version does not replace the existing public 0.16.0 release.
Subsequent documentation/test evidence commits do not change these bytes.

Live fixtures use Ubuntu AMD64, systemd or runit with delegated cgroup v2,
Node 22.22.3 and owned Chrome 149.0.7827.102. The unchanged native component
manifest SHA-256 is
`e3055aae24a0b325e22dee924d0b493b5a26c78799610da50d403668bd8e37b3`.
Synthetic files and isolated browsers prevent faults affecting a real user's
documents or desktop. The non-test Manager and original display are protected
by PID/start-time comparisons.

Browser recovery assertions require an actual new frame, new input saved and
read back, retained data, expected generation/process identities, and no effect
on unrelated owners. A successful HTTP response alone is insufficient.
Negative cases assert that the prohibited operation did not happen. A protected
stop is a successful safety check, not a claim that the failed component healed.

## Defects found and corrected

1. Releasing a view while adoption awaited retirement of the previous handle
   could register listeners after release. The failing deterministic test
   observed a remaining listener. A post-await cancellation check now fences
   registration; the same test requires zero listeners.
2. Losing response headers let Chrome resend a create POST although the SDK
   invoked fetch once. The original live case created five Apps. A persisted,
   principal-scoped launch-intent reservation now permits one creation and
   returns `launch-uncertain` on duplicate requests, including after Manager
   restart. The view cannot guess an attachment or offer an automatic relaunch.
   Restart already has a generation fence: the final lost-response case saw
   one successful mutation and four rejected stale wire retries.
3. A completed upgrade history entry hid an otherwise valid restart action.
   Completed history now permits normal admission; preparing, running, blocked
   and failed upgrade phases remain protected. Five deterministic phase cases
   cover this distinction.
4. Resource review found that twenty closed Viewers retained 300 DOM nodes and
   240 listeners after GC, despite zero owned Viewers/DOM. Heap snapshots traced
   this to Kasm BroadcastChannel listeners retaining RFB and its canvas/input
   trees; discarding console records did not fix it. Patch 0025 closes owned
   window channels and removes the omitted global blur/mouseover listeners.
   A channels-only probe still failed; its heap snapshot identified the Window
   listener as the second independent root. The applied lifecycle test fails
   before the patch and passes
   after it, including sibling isolation and repeated disposal. Live repeated
   DOM/listener assertions now gate acceptance instead of owner counters alone.

Reservations have a 24-hour retention window and an 8,192-entry capacity limit;
storage failure rejects before launch. This is bounded duplicate suppression,
not indefinite exactly-once execution for arbitrary App actions.

## Executed coverage

| Group | Artifact / evidence | Result |
| --- | --- | --- |
| Recovery controller and real panel | Final archive, 24 serial fault modes | Passed; automatic recovery, explicit recovery and protected stops are distinguished below |
| Default/custom UI and managed panel | Final archive, 7 + 3 browser checks | Passed; two Tabs, three Viewers, two Apps, no focus stealing, retained data and controlled replacement |
| Standalone/runit | Final archive, 3 browser checks | Passed; real paint, missing-marker preservation and Manager-only adoption |
| Broad legacy lifecycle matrix | Earlier archive below, 375 checks across eight modes | Passed; unchanged backend source, separately identified evidence |
| Native host regression, storage, repetition, UDP and local activation | Final archive | Qualification in progress; do not infer acceptance from earlier groups |

The broad matrix was rerun on clean source
`4af8343a5fff3ed09b657b087834e8a765927764`, archive SHA-256
`775fc44a72401b2a19e8314671f9bf28a4a60ec86db56648f3d651c482893467`.
Its modes contain 240 main, 43 interaction, 42 transport, 6 managed-transport,
28 shutdown-outcome, 3 borrowed-bus, 3 liveness-observation and 10
supervisor-preservation checks. Between that source and the final archive,
product changes affect only the native SDK's completed-upgrade admission and
generated web assets; backend Go/drivers are unchanged. These 375 results are
not relabeled as a final-archive run. Synthetic browser audio regression also
passed on that earlier archive, with 36 checks.

The final portable `make check` and coverage gates passed. The SDK suite has
311 passing tests; SDK coverage is 89.87% lines, 83.32% branches and 83.83%
functions. Six existing applied-Kasm-source checks are skipped by the portable
runner when the external applied source tree is absent; this run does not claim
a rebuilt Kasm component. Go race/source vulnerability gates passed on unchanged
backend source; all four final archive binaries passed vulnerability scanning.

### Recovery mode interpretation

The 24 real-browser modes exercise:

- Automatic connection recovery: renewal outage, brief outage, Manager SIGKILL,
  held response, HTTP 429/500/502/503/504, repeated disconnect cycles and chained
  faults. Reconnection retains the App and uses fresh authority/frame/input.
- Protected stop then explicit recovery: HTTP 401/403/409, exhausted retry
  budget and explicit disconnect. Network restoration alone cannot renew
  authority or reset the retry budget.
- Explicit lifecycle handling: confirmed restart, cancelled confirmation,
  shutdown refusal, response lost after accepted restart, and external
  replacement. No implicit force or template relaunch is permitted.
- Ownership/uncertainty: release during backoff, lost initial-create response,
  and Manager crash after create acceptance. No released window revives and
  no duplicate launch or guessed attachment is accepted.

The managed panel experiment retains a live editor after Driver loss, exposes
`session-populated-or-unknown`, and proves that recheck neither kills the editor
nor resets the recovery budget. Once the fixture deliberately empties only its
owned failed cgroup, the backend recovers with the original component pins.
The panel then requires explicit reattachment. Desired-stopped stays stopped.

## Matrix coverage and limits

The following records the evidence level, not an assertion that every possible
variation in a row ran live. Deterministic API/SDK cases remain distinguishable
from real process/browser injection.

| Matrix rows | Evidence and remaining boundary |
| --- | --- |
| F01 | Deterministic initial read/attach failure and real uncertain launch; every missing-component/malformed-descriptor variant is not newly injected through the panel |
| F02–F05 | Real renewal/status/timeout/exhaustion/authority/Manager faults; synthetic 401/403 are not identity-provider expiry |
| F06–F07 | Real release, hiding, per-Tab outage and independent owners; delayed callbacks/logout races also deterministic |
| F08–F10 | Real confirmation/cancel/refusal/lost response/replacement; duplicate actions, expired/stale confirmations and changed pins are deterministic/API cases; simultaneous human clicks in two Tabs are not separately qualified |
| F11–F12 | Real populated/empty managed failure and durable stop; cooldown/exhaustion/upgrade admission also covered by deterministic lifecycle cases |
| F13–F14 | Real broad VNC/Driver/supervisor/gateway and legacy input/bus faults; live/unknown resources and borrowed buses are preserved, not hot-repaired |
| F15 | Real repeated/chained recovery and deterministic stale callback fencing |
| F16 | Native channel/audio regression plus generation/consent tests; physical devices and every recovery-panel-plus-active-mic combination are not newly qualified |
| F17 | Pending final local UDP qualification; WAN loss, reordering and MTU remain separate |
| F18–F19 | Real document-root rejection/readback and lost create/restart responses; release during an in-flight mutation is deterministic; arbitrary App actions do not acquire exactly-once semantics |
| F20 | Real default/custom UI, fresh keyboard save, mobile viewport and focus preservation; physical OS IME behavior remains human UAT |
| F21 | Pending final short resource repetition; no new long-duration soak claim |
| F22 | Real create replay and crash across reservation; concurrency, identity separation, capacity and expiry are deterministic; live bounded storage qualification pending |

## Reproduction and human handoff

Provision the owned host fixture described in [NATIVE-HOST.md](NATIVE-HOST.md)
with the matched Core/component/App pins. The fixture JSON selects the owned
container, loopback Manager/ingress, test identity, evidence directory and CDP
browser. Set `expectedCoreCommit` to the installed artifact commit. Run suites
serially per container; the managed fixture requires its dedicated test desktop.

```sh
node tests/kasm-native/browser-recovery-faults.mjs "$fixture" lease-outage
node tests/kasm-native/browser-recovery-ui.mjs "$fixture"
node tests/kasm-native/browser-recovery-managed.mjs "$fixture"
node tests/kasm-native/browser-recovery-storage.mjs "$fixture"
node tests/kasm-native/browser-recovery-cycles.mjs "$fixture"
```

The storage harness is deliberately restricted to the named disposable native
clone; provision/inspect that fixture rather than removing its ownership guard.
It must never mount over an active installation's launch ledger.

One consolidated human UAT uses `/rx/sdk/recovery.html` (or the same SDK path
under the configured API prefix): open a synthetic editor, open a duplicate
window, hide/reveal, disconnect/retry, cancel then confirm a restart after
saving, and compare default/custom presentation. Use the main host workbench
for templates, physical IME, clipboard and speaker/mic. Human acceptance is
not inferred from these automated tests.

The screenshots contain owned synthetic Apps only:
[default window](recovery-experience-20261120/recovery-ui-default.png) and
[mobile attention state](recovery-experience-20261120/recovery-ui-mobile.png).

## Retained attempts and exclusions

The listener-race baseline, duplicate-create baseline, and first lost-restart
response attempt remain failed evidence. The initial restart oracle incorrectly
equated one SDK request with one wire request and then assumed a generation
increment of one; the lifecycle advances by two. Corrected assertions count
SDK calls, server responses and successful effects separately.

The first multi-Tab UI attempt expected fresh paint from a background Tab;
the corrected interaction fixture foregrounds the tested Tab before injection.
A broad-matrix attempt hit an ephemeral process exiting between enumeration
and `/proc` read; only ENOENT is now tolerated, while actual barrier children
must still be observed. The first deployment inventory assertion rejected
disappearance of fully stopped unmanaged entries and rolled back. A later
old-artifact probe is retained as such, not labeled a failure of the new binary.
One superseded archive was never activated or qualified.

Outside this qualification: physical OS IMEs/audio devices, real IdP/certificate
expiry, public WAN/NAT/TLS behavior, packet loss/reordering/MTU, cgroup OOM/CPU
starvation, whole-filesystem exhaustion, fresh Alpine/ARM64, new long-duration
soak, downstream host adaptation and post-merge release qualification.
The SDK does not hot-repair input helpers, borrowed buses or ambiguous surviving
applications. It provides an honest, guarded recovery flow for those cases.
