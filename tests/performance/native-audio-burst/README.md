# P17: bounded playback credits per speaker

A fixed total of eight browser playback credits competes with the eight-frame
queue that already exists **per stream**. Two speakers delivering five 20 ms
frames each in one 100 ms burst exceed that aggregate budget, even though both
stream queues have room. The selected change allocates eight credits per enabled
speaker, capped at 64 for the eight supported slots, and shrinks the allowance
when a speaker is disabled. Microphone credits and worklet queue sizes are unchanged.

Run from the repository root with Node.js and Git:

```sh
node tests/performance/native-audio-burst/measure.mjs /tmp/audio-burst-results.json
node --test cmd/remotexappd/web/sdk/audio-coordinator.test.mjs
```

The harness loads the recorded baseline commit and the current coordinator into
identical deterministic fixtures. It delivers 100 ms of packets per speaker
before returning credits, then checks the aggregate cap. The
[results](results.json) bind both source hashes and the harness; the
[manifest](manifest.json) records the comparison variable and bounds.

| Scenario | Before | Selected candidate |
| --- | --- | --- |
| Two speakers, ten offered frames | Eight delivered, two dropped | Ten delivered, none dropped |
| Two speakers, saturated sender | Eight frames in flight | At most 16 frames in flight |
| Eight speakers, 40 offered frames | Outside the selected two-speaker comparison | 40 delivered, none dropped; cap 64 |

This accepts the bounded allocation change. It is not a browser scheduling,
network latency or physical audio-quality benchmark. Live WAN observations are
reported separately in the [native audio qualification](../../native-audio/README.md).
The earlier development observation was stopped after contention was found;
its partial duration does not qualify the repaired candidate.
