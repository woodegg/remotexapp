# P19: native audio retirement

Issue [#104](https://github.com/woodegg/remotexapp/issues/104) reproduces native
AudioWorklet retention in Edge 157 even after tracks stop, owners are released,
Contexts report closed and equal diagnostic GC runs. The selected SDK change
terminates both processors, clears PCM state, awaits a terminal render ACK and
false return, closes ports and joins Context close through public Host cleanup.

The [results](results.json) retain sanitized native counts and private raw-report
hashes; the [manifest](manifest.json) binds the implementation and expanded
current harness. Earlier probes are observations of their original inputs,
not claims that the later expanded harness hash describes an earlier run.
Counts below mean native Context / WorkletNode / MessagingProxy instances.

| Six-cycle lane | Native endpoint | Interpretation |
| --- | --- | --- |
| Exact reported browser + original shipped Worklet | 6 / 6 / 6 | Independently reproduces retention |
| Running processor, terminal render and awaited close | 0 / 0 / 0 | Selected termination mechanism |
| Suspended processor, terminal message without drain | 6 / 6 / 6 | Rejected incomplete repair |
| Suspended processor, muted existing-graph drain | 0 / 0 / 0 | Qualifies suspended termination |
| Original Worklet bytes again | 6 / 6 / 6 | Reversible control |
| Nonzero capture processing, Edge 157 and Chrome 158 | 0 / 0 / 0 each | Capture termination exercised |
| SDK 0.35 source-module control | 6 / 14 / 6 | Actual capture/playback lifecycle; distinct from formal bundled bytes |
| Candidate public bundled SDK, Edge 157 / Edge 158 / Chrome 158 | 0 / 0 / 0 each | Real Viewer, clipboard and Pulse data before retirement |

The source-module control has six ordinary captures and two extra capture-only
resumes. Its 14 nodes must not be substituted for the original issue's 13-node
input sequence. Native retention does not mean capture secretly continues: the
control's tracks are stopped. The repaired owner stops capture synchronously
before waiting. Candidate capture-only churn leaves one playback node while mic
is off, then two nodes with mic on, in one Context. Microphone-only all-off keeps
the Context suspended until an explicit gesture resumes it; old capture nodes
do not accumulate. Final owner retirement returns all sampled classes to zero.

Use [the native audio harness instructions](../../native-audio/README.md#native-audio-retirement-issue-104).
Real pointer clicks and nonzero processing are preconditions. Drop test-owned
strong references, keep the same page/browser alive, take equal GC samples and
count only native instances. Never use navigation, browser exit, repeated
WeakRef dereference, console-held resource objects or memory-pressure injection
as evidence that the owner released its resources.

The expanded natural/fault lane runs separately without periodic GC or CDP
Network response caching. Its three-hour duration, fifty retirements and
live eighty-second idle endpoint have their own final review below; the controlled
results above do not stand in for that review. PSS/anonymous PSS/RSS describe the
owned browser processes; heap/DOM/listener metrics describe the sampled page.
A planned Manager restart must be separated from same-process server growth.
No whole-browser leak-freedom or matched long-duration memory saving is claimed.
Physical devices, actual OS sleep, UDP/TURN and downstream adoption remain outside
this controlled audio-resource experiment.

The first extended attempt ended around 45 minutes on an immediate zero mic
readback after a freeze event; it is incomplete, not a three-hour pass. A
same-environment control observes two initial zero windows with no browser PCM
submission, then sustained synthetic signal without reconnect or another device
request. This proves that one immediate window is an insufficient test, but does
not establish what would have happened after the aborted original window. The
expanded observer requires fresh submission and two consecutive remote-signal
windows within a bounded period, retaining every window and failing persistent
silence. A new continuous natural lane is required after the earlier browser
was normally closed. Production SDK/Worklet bytes are unchanged by this
observer correction; the earlier native diagnostics are not replayed as new data.

A silent-input negative control produces eleven zero remote windows and fails
the bounded synthetic-signal criterion while keeping one capture and the same
connection; cleanup succeeds. This demonstrates that bounded observation does
not silently accept a missing test signal or repair it by reopening devices.
Corrected short preflights cover the nine built-in fault types across two owned
runs and finish at zero native audio objects. The first preflight's short clock
did not execute its last two scheduled faults; those are covered by the second
run rather than counted as executed in the first.

A second attempt ended around 56 minutes on local-to-remote clipboard readback
timeout. Its baseline was not traced at failure, so a precise retrospective
cause is unavailable. A separate controlled write/read gate reproduces a
concurrent-source normalization race tracked in
[Issue #107](https://github.com/woodegg/remotexapp/issues/107). One hundred ordinary
transfers and one hundred explicitly serialized transfers pass; the gated
overlap is a negative control. The audio natural lane now waits for the public
`copied-to-local` completion phase before changing the local source. It validates
sequential clipboard data flow and does not claim the overlapping-source race
is fixed. Both incomplete attempts and their owned cleanup remain separate from
the fresh continuous qualification. No production clipboard bytes change.

The sequential observer preflight executes eight faults before its short
210-second window expires. Its guard correctly fails the unexecuted ninth
entry; it is not presented as a nine-fault pass. A separate suspended-retirement
preflight supplies that final fault and the expanded native zero endpoint.
The new continuous lane uses the unchanged production bytes and the separately
frozen sequential observer.

## Reviewed extended implementation lane — 2026-11-27

The fresh frozen lane completes 10800.000041 seconds without periodic diagnostic
GC, then fifty retirement cycles and 80.001920 seconds of live idle. All 175
actual data checks pass, including 150 sequential bidirectional clipboard checks.
All nine planned fault types execute. Native Context / Node / Proxy counts at
retired cycles 0, 25, 49 and the final idle snapshot are 0 / 0 / 0. The final audit
records 80 captures / 80 synchronous track stops, 52 Context closes and 132
terminal acknowledgements. The two extra Context closes are the natural lane's
planned owner retirement and final owner disposal. Owned App/browser cleanup
passes, and the frozen inputs remain unchanged.

Nine natural-lane WebSocket closes comprise five explicit fixture cuts, two
channels closed by the planned Manager restart and two by planned owner
retirement. There are no additional closes in that measured interval. The
longest sampling gap is 81.884 seconds across the planned forty-second network
block and recovery; it is not a fresh observation during that gap. Manager has
two process identities across its planned restart; the four non-Manager measured backend
types each retain one identity. Container
OOM counters remain zero. The owned job peaks at 532.77 MiB cgroup
memory and 86.54 MiB swap, under its 3 GiB memory cap.

Browser-process PSS is 497.88 → 465.69 MiB (range 416.27–692.03), anonymous PSS
187.58 → 189.87 MiB (range 134.81–322.98), and summed RSS 1184.86 → 1047.46 MiB.
The sampled page heap ranges 2.23–4.27 MiB; DOM ends at its initial 64 nodes and
listeners at 103 versus initial 107. There are 483 foreground and 528 background
samples. The shared host also reclaims/swaps pages: these decreases are not a
matched memory-saving result attributable to this fix. Pulse anonymous PSS grows
about 3.00 MiB, recorded as an observation rather than a general leak diagnosis.
The complete server ranges and before/after Manager groups are in results.json.

This qualifies the implementation bytes, not an exact post-merge artifact,
whole-browser leak freedom, physical media, actual OS sleep, UDP/TURN or downstream
adoption. Candidate archive qualification and human UAT remain separate.

## SDK 0.38 graph development follow-up (2026-11-28)

[Isolated processor recovery](../../native-audio/results-graph-node-recovery-20261128.json)
passes a real module 404/retry, suspension and ten actual Worklet throws in
headed sandboxed Chrome 158.0.8127.88 with real Kasm/Pulse, a synthetic mic and
sink:none. One source and Context survive; device requests remain one. Baseline
and post-fault native Context/WorkletNode/MessagingProxy counts are 1/2/1; after
awaited owner disposal they are 0/0/0 in the same live page. MediaStream source,
stream, track, Gain, Worklet and destination counts also return to zero. GC is
explicitly diagnostic; this is not a natural soak, new backend or immutable
release qualification.

Stage only a private test Worklet; never install its hook as a production asset:

```sh
python3 tests/native-audio/stage-graph-fault-worklet.py \
  --output /private/fixture/audio-worklet.js
```

The helper reproduces the measured staged bytes. A subclass delegates normal
processing to the production class; an owned `fixtureThrow:true` port message
causes an actual processor exception on the next render. Test each capture and
playback role, check fresh remote mic readback and speaker tone after recovery,
then inspect native snapshots before closing the page/browser. Keep controller,
addresses and raw heaps outside Git.

A [separate whole-Context control](../../native-audio/results-graph-retirement-failure-20261128.json)
passes functional checks but retains12/14/12 native Contexts/nodes/proxies.
Its first proxy expectation was incorrect; the fresh positive baseline1/2/1
corrects that expectation without excusing the measured retention. Closing
before healthy processors terminate violates P19's retirement requirement.
Whole-graph and already-closed cleanup remain OPEN; neither models nor the
isolated-node pass accept complete resource recovery. Earlier accepted P19
measurements remain unchanged in scope.

A further [matched closed-Context control](../../native-audio/results-closed-context-frame-20261128.json)
uses the unchanged production Worklet. Six ordinary direct cycles retain6/6/6;
six cycles constructed in a same-origin owned frame and followed by frame
retirement reach0/0/0. Reproduce the mechanism by staging the stock Worklet and
`retirement-frame.html`, then running `browser-retirement.py --page retirement-frame.html`
with the same six-cycle settings and a private output directory. This headless,
diagnostic-GC prototype is not yet the SDK architecture. Parent microphone
continuity, host policy/activation, whole-graph integration and full production
qualification remain pending. Do not relabel the prior SDK graph failure passed.
