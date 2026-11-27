# Native audio verification

Issue [#45](https://github.com/woodegg/remotexapp/issues/45) owns full product
integration. The owner requests one end-to-end human UAT after the complete
integration, not separate manual gates for each implementation checkpoint.

## Qualified standalone candidate

[Candidate 7926949 qualification](qualification-7926949.md) records 36 local real
Pulse/Chrome cases, 56 UAT fixture checks, three-region AMD64/ARM64 playback and
App lifecycle checks, 27 live fault checks, six logout checks, the natural
30-minute resource observation and cleanup. The owner reported the current
standalone audio UAT passed on 2026-11-01; the report records that decision
separately without inventing per-case/device results. Actual embedding-host
acceptance remains separate; resource and queue-counter limits still apply.

## Same-UID routing experiment

Run as a non-root application UID with PulseAudio, pactl, pacat and parec:

```sh
python3 tests/native-audio/domain-experiment.py --output /tmp/audio-domain-result.json
```

The harness owns two private Pulse servers and uses synthetic 440/660/880/1100 Hz
signals. It reads actual speaker monitors and microphone sources, checks silent
routes, stops/crashes one domain, rebuilds it with a new endpoint, and verifies
the other domain continues. It preserves account audio process identities and
configuration hashes and removes its own processes, sockets and temporary files.

[Results](results-domain-20261101.json) bind the harness hash. Five cases passed
on Linux x86_64/PulseAudio 16.1. The initial idle PSS/RSS/FD samples are snapshots,
not leak or long-duration evidence. Same-UID routing is functional isolation;
mutually untrusted tenants still require separate Linux UIDs or containers.

During harness development, default null-sink buffering yielded too few samples
in short capture windows. `norewinds=1` selects PulseAudio's 50 ms null-sink block
instead of its default two-second block. Readback checks multiple steady 100 ms
windows; startup/drain windows are not steady-state quality measurements. Every
window of inactive routes is checked for unexpected tones. This is routing
proof, not a measurement of end-to-end delay or physical audio quality.

Pulse remains an external distribution package. No upstream codec or Pulse
source is vendored. Sources: [Pulse modules](https://wiki.freedesktop.org/www/Software/PulseAudio/Documentation/User/Modules/),
[16.1 null-sink implementation](https://github.com/pulseaudio/pulseaudio/blob/v16.1/src/modules/module-null-sink.c).

## Product integration harnesses

`go test ./internal/sessionaudio ./cmd/remotexappd ./tests/kasm-native/edge`
checks packet bounds, bounded queues, route grants, account and generation
fencing, runtime compatibility, shutdown, and the edge cookie boundary.
`REMOTEXAPP_TEST_AUDIO_LIVE=1 go test ./internal/sessionaudio` also exercises
real private Pulse recovery. SDK coordinator/worklet tests run with `make check`.

Before changing the shared CDP helper, run
`node tests/native-audio/browser-cdp-check.mjs` against the local Chrome. It
checks both top-level await and async expression settlement, error propagation
and value serialization. Chrome REPL mode can otherwise serialize a pending
Promise as `{}` and let a scenario run before its setup finishes.

For browser verification, start the test-only fixture in one terminal:

```sh
REMOTEXAPP_AUDIO_FIXTURE=/tmp/audio-fixture.json go test ./cmd/remotexappd \
  -run '^TestAudioBrowserFixture$' -count=1 -timeout=50m -v
```

Then run `node tests/native-audio/browser-integration.mjs` with three absolute
arguments: that private fixture JSON, a synthetic 48 kHz mono WAV containing an
880 Hz test signal, and a private output directory. It owns ephemeral Chrome
profiles and two private Pulse domains. The fixture deliberately replaces the
Manager's runtime resolver: this proves the real audio service, SDK,
SharedWorker and AudioWorklet, not full App supervision or WAN delivery.
The fixture stops on POST `/fixture/stop`; its test-only routes are absent from
product binaries. Preserve only sanitized summaries in public documentation.

The browser cases cover two sessions, three tabs, one shared channel, actual
440/660 Hz playback, selected/unselected microphone readback, one capture for
multiple targets, profile conflicts and explicit takeover, permission denial,
late permission cancellation, active permission revocation, domain replacement,
playback-owner handoff, last-reference cleanup, and silent SharedWorker exit.
Worker failure closes the capture track and resets playback. An explicit
speaker action on the original audio interest rebinds the worker and restores
real playback. A separate explicit microphone action restores real readback.
Server retirement of the final enabled App must also close the shared channel.
Holding one domain unavailable must preserve the other domain’s real speaker,
microphone readback and connection; recovery never re-enables the failed mic target. Synthetic readback disables browser echo cancellation,
noise suppression and gain control explicitly; normal SDK defaults enable them.
This avoids mistaking suppression of a sustained test tone for routing loss.

`tests/native-audio/app-experiment.py --binary PATH --output PATH` uses an owned
Xvfb display and real private Pulse server to verify the test App's Play,
three-second Record, Replay and Stop controls. Its recording stays in memory.
The helper is packaged inside the immutable `alpine-audio-test` App Package,
not installed as a mutable account-wide executable.

Full Manager lifecycle, target Alpine/ARM64 deployment, WAN resources and
physical-device UAT require separate evidence. Unit and local fixture passes
must not be presented as acceptance of those scopes.


Build the target's UAT-only App Package with Python 3, Go, `readelf`, Bash and
GNU tar:

```sh
python3 tests/native-audio/package-app.py --goarch amd64 --output /tmp/audio-app-amd64
python3 tests/native-audio/package-app.py --goarch arm64 --output /tmp/audio-app-arm64
```

Version 1.0.1 records App input/toolchain/binary hashes and includes XGB and Go
license notices. The helper omits repository-wide VCS metadata so unrelated Core
commits do not alter an immutable App version. Do not overwrite an installed
App version with different contents; bump the App version when its inputs change.

## Ingress-authorized integration continuity

Issue #98 adds `tests/kasm-native/browser-integration-continuity.py`. Run it with
an absolute private fixture JSON containing `projectOwnedDisposable: true`, a
`local:remotexapp-host-*` container, a loopback HTTPS `origin`, the selected
Manager `state` directory and `expectedCommit`. The fixture directory supplies
`loopback.spki`, `mic-880.wav`, the existing integration control page and owned
fault endpoints. Use the private UAT procedure for environment provisioning.

The loopback Manager uses auth-mode none and no login-session header to reproduce
an ingress-owned authentication boundary. The matrix reads real X11 clipboard,
measures browser speaker playback and samples the selected remote Pulse mic. It
cuts display and audio independently and together, restarts the Manager, holds
an audio outage beyond capture expiry, injects renewal 503, cancels during an
outage, tests browser offline/online and suspension, and holds both transports
for 38 seconds to exercise automatic retry cooldown. Logout and explicit
Viewer disconnect are terminal. Tests close their Apps and browser. This local
matrix does not establish a cause for public ingress disconnects.


## Buffered microphone regression

Issue [#102](https://github.com/woodegg/remotexapp/issues/102) covers transport
coalescing of normal 50 fps microphone frames. Run:

```sh
go test ./cmd/remotexappd -run '^TestAudioBufferedMicrophone' -count=1
go test -race ./cmd/remotexappd ./internal/sessionaudio
```

The old reader fails after 100 buffered frames. Regression sends full and
silence 140-frame and 2250-frame backlogs, then checks control acknowledgements,
HTTP renewal and the same connection/scope. Invalid type/size/slot/sequence and
expired/retired scope remain rejected. `TestMicQueueBoundedAndOldestDropped`
checks that 2390 pushes keep only the newest five frames and count the drops.
These checks establish admission and bounded buffering, not WAN audio quality.
Real browser/Pulse qualification must additionally coalesce upstream microphone
traffic while keeping downstream speaker traffic and grants available, measure
actual selected microphone and speaker signals, then run a natural one-hour
foreground/background observation. Preserve raw closure events and distinguish
external clipboard interference and debugger limitations from product failures.

## Native audio retirement (Issue #104)

`browser-retirement.py` is a six-cycle native heap diagnostic for an owned
loopback directory and an explicitly selected browser executable. Put
`retirement-minimal.html` there as `repro.html` beside the exact
`audio-worklet.js`; retain its SHA-256. Run the unpatched control with
`--expect retained`, then the candidate with `--page 'repro.html?terminal'`
and `--expect released`. Add `kind=capture` and `suspended` query parameters to
exercise nonzero capture processing and a muted suspended-context drain.
The browser stays alive through equal diagnostic GC and the idle snapshot.
Raw heaps remain in the private `--output` directory; count native objects,
not similarly named JavaScript constructors or prototypes.

`browser-host-retirement.py` uses the same project-owned HTTPS/X11 fixture
configuration as the continuity matrix. Its edge also serves the two
`retirement-host` fixture files. Supply `--browser`, `--output` and optionally
`--cycles` (six by default). It uses the served public SDK lifecycle and real
pointer clicks, actual Viewer paint, synthetic speaker/mic readback and
bidirectional Unicode clipboard data. Read-only lifecycle counters do not hold
retired Contexts, Nodes, Streams or Hosts. Native snapshots follow public
retirement with test references released. Capture-only on/off, paused capture
resume, microphone-only all-off/resume, suspended final disposal, repeated
cleanup and logout are exercised separately.

`--natural-seconds 10800 --cycles 50` first runs a three-hour natural/fault lane
with no periodic GC, heap snapshots, navigation, browser exit or Network-domain
response recording. It samples browser PSS/anonymous PSS/RSS, JS heap, DOM and
listeners, plus selected server processes and OOM counters. Real clipboard and
audio checks, foreground/background transitions and labelled faults continue.
Only after that lane ends naturally does diagnostic GC begin for fifty
retirement cycles and an eighty-second idle endpoint in the same live browser.
`retirement_cdp.py` launches only an owned temporary profile and never enables
CDP Network. Durations or closed track state alone are not acceptance; inspect
final native counts, functional checks, resource observations and owned cleanup.

Use the exact affected Edge 157 first, record its executable hash, then qualify
other browsers separately. Do not mix a standalone protocol probe, source-module
baseline, public bundled SDK result, resource observation or physical-device
UAT into one claim. A missing browser, local service, Pulse/X11 dependencies or
HTTPS permission context is a prerequisite failure, not proof of a product bug.

[P19 controlled results](../performance/native-audio-retirement/README.md) bind
the native retirement observations and expanded reproducible harness.

Capture/route readiness can precede the first browser PCM callback. A real quiet
microphone may legitimately produce zeros. Synthetic qualification therefore
observes fresh frame submission and two consecutive nonzero remote readback
windows within a bounded observation period; it never re-enables capture or
replaces a connection while observing. The fixture records every window and
fails with before/after state if fresh signal does not arrive. A single immediate
half-second zero window is not proof of a broken connection.

For a cheap owned preflight, `--fault-plan PATH` supplies sorted JSON
`[elapsedSeconds, faultName]` pairs using the documented built-in fault names.
Choose a timed lane long enough for the faults' hold and recovery intervals;
unexecuted requested faults fail the preflight. The default three-hour lane
retains its full natural duration and separate post-soak GC/lifecycle phase.

The retirement harness's periodic clipboard readbacks are sequential. It waits
for focused ownership and the SDK's public `copied-to-local` phase before the
next local copy. Browser visibility alone can precede normalization completion.
Concurrent source changes during that asynchronous interval are a separate
[clipboard issue #107](https://github.com/woodegg/remotexapp/issues/107), outside
this audio-resource qualification; do not report them as fixed by this lane.


## Bounded native Worker clients (Issue #110)

`browser-worker-hub-retirement.py --browser /path/to/chrome --output /private/output`
loads the actual Worker hub in an owned minimal loopback fixture. Use `--legacy`
for the direct-client negative control. Fifty logical retirements preserve a
live peer; native endpoints are measured before page/browser close. This
mechanism probe creates no audio and cannot substitute for full SDK/Pulse or
post-merge candidate tests. See [P20](../performance/native-audio-worker-clients/README.md).
