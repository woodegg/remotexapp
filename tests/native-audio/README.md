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

Manager authorization/lifecycle, browser/SDK coordination, WAN quality, physical
devices and long-duration resources still need product integration evidence.
