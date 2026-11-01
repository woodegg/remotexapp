# Native audio verification

Issue [#45](https://github.com/woodegg/remotexapp/issues/45) owns full product
integration. The owner requests one end-to-end human UAT after the complete
integration, not separate manual gates for each implementation checkpoint.

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
Worker failure closes the capture track and playback context; a newly created
controller starts with audio off and requires an explicit microphone action. Synthetic readback disables browser echo cancellation,
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
