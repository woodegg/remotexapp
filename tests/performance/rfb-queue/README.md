# P05 RFB compatibility-queue experiment

This directory reproduces the controlled slow-client comparison behind the
accepted `/rfb-compat` queue capacity of 8.

## Scope

The experiment changes only the two in-process compatibility-relay channel
capacities. It does not change TigerVNC, noVNC, display geometry/depth/frame
rate, Tight settings, input handling or lifecycle policy. RFB is an ordered
byte stream, so the relay applies TCP backpressure and never drops or replaces
arbitrary chunks.

`cmd/novnc-input/rfb_queue_experiment_test.go` has the
`rfbqueueexperiment` build tag and is excluded from normal builds. It sends 32
MiB from a deterministic TCP source while the WebSocket client stalls for one
second and then drains slowly. The test records queue depth, live heap after a
forced GC, upstream backpressure and source-data age.

Run one sample for capacities 256, 8 and 1:

```bash
tests/performance/rfb-queue/run.sh
```

Run a single capacity in a separate process:

```bash
RFB_QUEUE_CAPACITY=8 \
  go test -tags rfbqueueexperiment ./cmd/novnc-input \
    -run '^TestRFBCompatSlowClientExperiment$' -count=1 -v
```

Use separate processes when repeating samples so a previous run's Go heap does
not contaminate the next capacity.

## Accepted result

Five independent processes per capacity produced these medians:

| Metric | Queue 256 | Queue 8 | Queue 1 |
|---|---:|---:|---:|
| Live HeapAlloc increase during stall | 16.18 MiB | 0.68 MiB | 0.24 MiB |
| Average source-frame age | 1564 ms | 1051 ms | 1124 ms |
| Maximum source-frame age | 2127 ms | 1593 ms | 1648 ms |
| Final-frame age | 1156 ms | 976 ms | 989 ms |

Queue 8 was selected because it removed 95.8% of the measured stall-time heap
increase and reduced average data age by 32.8%. Queue 1 saved only another
roughly 0.44 MiB and did not provide a stable latency improvement.

The isolated real-stack check then passed noVNC attach, Mousepad readiness,
exact `P05你好abc` IBus/clipboard round-trip, detach/reconnect, pointer,
continuous English input, Chinese/English switching, the first post-switch
character, shortcuts, resize and refresh. The final journal contained 94
successful text commits and zero client-event traces.

Machine-readable medians are in
[`results-2026-08-27.json`](results-2026-08-27.json). The complete decision and
test provenance are in
[`docs/performance-experiments.md`](../../../docs/performance-experiments.md#p05-bound-the-compatibility-relay-queue).

The repository source default is 8. A gateway process already running from an
older binary keeps its compiled value until that binary is deliberately rebuilt
and the gateway restarted; the P05 experiment did not restart port 1991.
