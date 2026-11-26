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
| Candidate public bundled SDK, Edge 157 and Chrome 158 | 0 / 0 / 0 each | Real Viewer, clipboard and Pulse data before retirement |

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
live eighty-second idle endpoint require their own final review; the controlled
results above do not stand in for that review. PSS/anonymous PSS/RSS describe the
owned browser processes; heap/DOM/listener metrics describe the sampled page.
A planned Manager restart must be separated from same-process server growth.
No whole-browser leak-freedom or matched long-duration memory saving is claimed.
Physical devices, actual OS sleep, UDP/TURN and downstream adoption remain outside
this controlled audio-resource experiment.
