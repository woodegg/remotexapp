# P02 opt-in input-event tracing

P02 makes browser input-event tracing opt-in without changing input handling.
The included Node benchmark runs the trace-on and trace-off paths over 50,000
synthetic events; the isolated class supplies the real Mousepad regression
stack.

Seven runs produced medians of 1662.35 ms with tracing and 0.88 ms without it.
Trace-off avoided 4,900,000 WebSocket bytes and 50,000 diagnostic events per
50,000 traced events. The real kiosk passed IME switching, the first key after
switching, shortcuts, pointer, resize and reconnect. Its journal recorded 27
successful text commits and zero client-event records, so P02 is accepted.

See the [P02 section](../../../docs/performance-experiments.md#p02-opt-in-input-event-tracing)
for interpretation limits. Summary data are in
[`results-2026-08-27.json`](results-2026-08-27.json).
