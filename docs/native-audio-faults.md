# Native audio faults and recovery

This is a fault inventory for the Core 0.17.6 / SDK 0.37 source contract, not a
claim that every failure has automatic recovery or that an incident's cause is
known. The owner has selected the [self-recovery implementation](native-self-recovery.md)
to supersede several current manual-resume boundaries; it is not yet qualified.
See [audio ownership](native-audio.md) and
[integration intent](integration-intent-recovery.md). Physical device faults,
browser policies, ingress failures and SDK defects can produce the same silence.
A WebSocket close code, including 1006, does not identify which layer failed.

Development update under #119: the transport implementation has removed the
twelve-second forced source retirement described in the original inventory
below. A still-live source with responsive owner and requested mic routes is
retained with delivery fenced and its track disabled; fresh authorization and
delivery fencing can resume it. Native-cookie refresh also differs from an
observed principal change. These partial repairs do not qualify the remaining
Worker, device/permission, combined fault or long-duration gates. The linked
self-recovery plan defines the replacement behavior and outstanding evidence.

## Epochs are different fences

| Fence | What changes it | Correct response |
| --- | --- | --- |
| Viewer connection epoch | Display reconnect | Leave healthy audio alone. It is not an audio service restart. |
| Audio transport epoch / connection ID | Replace a failed audio WSS | Discard old PCM, get fresh connection/route grants, restore eligible routes. |
| Manager service epoch | Restart the Manager/audio service | Replace grants and connection; preserve same-owner intent for the same runtime generation under current access. |
| Worker incarnation / bootstrap generation | Worker termination, watchdog or initialization timeout | Rebind live interests; restore eligible speaker intent. Old capture ends; microphone intent becomes action-required. |
| Capture epoch / delivery fence | Capture cancellation, replacement or new route ACK | Reject old async device results and old frames; never let an old delivery token resume transmission. |
| Runtime generation | App runtime replacement | Retire old routes. A fresh runtime needs fresh interests; do not replay old microphone authority. |
| Identity / scope binding | Observed account change, logout or authorization rejection | Retire old interests. Do not treat this as a retryable service restart. Optional login metadata is not required for ordinary recovery. |

An enabled switch describes `requested`; `actualSpeaker`/`actualMic` describe
effective delivery. `microphoneActionRequired` describes retained microphone
intent without eligible capture. An embedding host must show these distinctions.

## Fault inventory

The table groups failure classes and underlying causes. Reason strings are
diagnostic examples, not a complete stable error-code API. Recovery depends on
the owner still existing, current access and the target runtime still matching.

| Failure class | Causes / evidence to distinguish | Current recovery or required action |
| --- | --- | --- |
| Audio WSS loss | Network reset, proxy/ingress idle timeout, peer close, failed handshake; correlate both ends rather than guessing from 1006 | Retry with fresh grants; speaker restores. A still-live mic may resume within the 12-second interruption window after a fresh route ACK; discard outage frames. |
| HTTP control/renewal failure | Timeout, offline fetch, transient 5xx, unavailable Manager | Shared retry loop and fresh context/grants. Explicit off must still work locally. Persistent failure remains recovering; it is not a successful connection. |
| Invalid/expired grant or stale delivery | Old service/connection/runtime token, expired or already-used grant, old capture delivery token | Obtain fresh grants only under current access and runtime binding. Reject old frames. Actual authorization rejection or runtime retirement must not be bypassed by retry. |
| Control handshake / ACK failure | No connected/route ACK before deadline, closed peer, malformed or mismatched protocol | Fence failed connection/control operations and report failure. A transient reconnect can restore eligible routes; an incompatible protocol/deployment must be corrected. |
| Long transport outage | Recovery exceeds 12 seconds | Expire capture, retain microphone request/action-required; speaker may later restore. No automatic new getUserMedia. |
| Manager restart | Service epoch changes, old socket/grants cease to be valid | Same-owner/same-runtime speaker recovery; short-outage live mic recovery only. A changed service is not by itself an identity change. |
| Display-only reconnect | Viewer lease or WSS replaced while audio remains healthy | No audio reconnect or new capture should occur. |
| Worker error / termination | Worker target exits or emits error | Rejoin/replace worker, rebind live interests and restore eligible speaker. Stop old capture; microphone needs an explicit action. |
| Worker unresponsive / init failure | No active-page messages for 10 seconds; init RPC timeout, worker script/protocol/storage/lock failure | Watchdog retires the old peer. Init timeout can select a replacement generation using Web Locks and storage. Failed initialization can remain `failed`; it is not an unlimited automatic recovery guarantee. |
| Browser background vs suspension | Ordinary hidden tab differs from frozen/BFCache page, long event-loop gap, OS sleep or lost owner heartbeat | Healthy background audio remains enabled. Suspension can stop capture; retained microphone intent requires explicit resume. A fresh/unloaded document starts off. |
| Speaker playback blocked | AudioContext suspended by autoplay/user-activation policy, missing eligible playback owner | Report playback blocked. Previously unlocked eligible owners can take over; otherwise a user action is needed. Do not report sound merely because WSS is connected. |
| Microphone permission/device loss | Permission denied/revoked, OS privacy switch, unplugged device, ended track, getUserMedia failure | Stop capture immediately, fence late results, retain applicable request with action-required. A user must grant/resume; recovery does not silently open a new device. |
| Microphone owner loss | Owning tab closes, suspends or loses heartbeat | Stop that capture; do not silently capture from another tab or reroute to its focused App. |
| Audio scope / writer contention | Another profile owns the shared connection, another writer owns the target domain | Report connection ownership or mic conflict. No duplicate capture/socket and no automatic takeover; explicit authorized takeover is separate. |
| One App audio domain unavailable | Pulse process/socket/backend unavailable or being recreated; route 409 | Isolate that route; keep other Apps connected. Speaker can retry when the domain returns. The mic request can require explicit reactivation. |
| Audio domain replaced | Domain-retired notification, new Pulse domain identity | Refresh eligible speaker route. Retire the old microphone writer; do not transfer its authority silently. |
| App/runtime retired | Runtime stopped, generation replaced, route 410 | Disable/fence old routes and release unused channel/capture. New runtime binding is a host decision, not a transient reconnect. |
| Access or identity rejected | Context 401/403, explicit logout, verified identity/scope change | Retire old interests. Restore access and bind current interests; never retry across an observed account change as though it were network loss. |
| Unsupported/mismatched deployment | Insecure context, no SharedWorker/MessageChannel/AudioWorklet, cross-origin base, wrong worker/worklet assets, unsupported protocol/sample rate | Fail explicitly; correct capability/configuration/assets. Reconnecting does not repair a bad deployment. |
| Capacity / resource exhaustion | Coordinator route quota, unavailable system resources, FD/memory/CPU exhaustion | Report quota or underlying failure; release unused routes/resources or correct provisioning. Repeatedly creating owners is not a recovery strategy. |
| Backpressure / scheduling overload | WSS bufferedAmount, slow renderer, lost playback credits, delayed microphone frames | Bound queues and drop obsolete PCM; do not accumulate latency or close a healthy mux solely because a valid backlog arrives in a burst. Persistent overload still needs diagnosis. |
| Retirement incomplete | Missing terminal Worklet ACK, suspended graph, Context close failure, retained listeners/buffers | Fence capture synchronously and await bounded retirement. Report incomplete cleanup, rather than successful disposal. Final cleanup never captures a device or restores intent. |
| Connected but silent / wrong audio | App uses the wrong Pulse endpoint, mute/volume/output-device choice, app emits no PCM, browser sink/graph issue | Trace App→Pulse monitor→server PCM→Worker→Worklet→output, and the reverse mic path. Fresh tone/readback distinguishes transport health from actual delivery; hardware/acoustic checks remain separate. |
| Host/SDK intent lost or misrendered | Released handle reused, host sends off during reconnect, wrong runtime binding, checked switch mistaken for actual activity | Compare requested/actual/required-action and handle lifetime. Do not infer misuse or a server defect from UI alone; capture the transition sequence. |

## Reproduce epoch faults

The deterministic coordinator/SDK tests run without touching a deployed service:

```sh
node --test cmd/remotexappd/web/sdk/audio-coordinator.test.mjs \
  cmd/remotexappd/web/sdk/remotexapp-audio.test.mjs \
  cmd/remotexappd/web/sdk/audio-worker-hub.test.mjs
```

For real end-to-end injection, use a project-owned disposable Manager and a
loopback-only test controller. Keep its addresses, credentials, unit names and
raw evidence outside Git. No production fault endpoint belongs in the Core.

1. Open a real Viewer and enable speaker plus a synthetic mic by explicit
   actions. Record service binding, connection ID, runtime generation and
   capture-request count. Verify fresh speaker PCM and remote Pulse mic readback.
2. Restart only that test Manager. Verify its service epoch actually changed,
   its runtime generation and audio domain survived, and a new connection/route
   restores fresh data. For a short interruption, assert no new capture request.
3. Stop it for more than 12 seconds and start it again. Verify speaker recovers,
   mic requested stays true, actualMic is false/action-required, and capture
   count does not rise until an explicit resume. Then verify fresh mic data.
4. Terminate only the test browser's audio SharedWorker through CDP. Verify
   speaker recovery and microphone action-required without refreshing the page
   or re-creating the Host. Explicit mic resume must recover real readback.
5. Test identity rejection and runtime retirement separately: these must fence
   old delivery rather than automatically reuse the old grant/interest. Unit
   fault simulation is separate evidence from an actual process restart.
6. Release SDK owners and stop only owned Apps, Manager, controller, browser and
   initially stopped test container. Preserve existing sessions and public UAT.

Never replace service-epoch assertions with a changed display epoch or merely
call `setSpeaker(true)` again to manufacture recovery. Fresh content/tone is
required; retained requested flags and a connected counter are insufficient.

## Clipboard diagnostic boundary

[Issue #117](https://github.com/woodegg/remotexapp/issues/117) records a distinct
clipboard stale-echo defect now repaired in development, with final qualification
pending. It does not explain audio epoch failures. See the
[mandatory A-B-A regressions](../tests/kasm-native/CLIPBOARD-ABA.md). A successful
sequential clipboard test or natural audio soak does not close that regression.

## Recorded execution

[2026-11-28 real epoch results](../tests/native-audio/results-epoch-recovery-20261128.json)
cover the unchanged runtime source `00c97b4` / Core `0.17.6` / SDK `0.37.0` in an isolated
real Chrome 158, Kasm WSS and Pulse environment. Eight cases passed: baseline,
two actual short Manager restarts, a greater-than-12-second Manager outage,
explicit mic resume, actual SharedWorker termination/replacement, another mic
resume and awaited logout/cleanup. The short restarts changed service epoch and
connection, preserved runtime generation/Pulse domain and reused the one capture.
Long outage and worker replacement restored speaker while preserving mic intent
without automatically creating another capture. Explicit actions restored real
remote mic tone. Raw evidence and the excluded transient-unit fixture failure
remain private. These are runtime fault results, not human UAT, physical-device
qualification or proof that every fault class in the inventory was exercised.
