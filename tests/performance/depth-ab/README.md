# P04 depth 16 versus depth 24

P04 runs the two class configurations in this directory sequentially with
`run-one.sh`. Geometry, frame-rate, accepted lean server, Tight/noVNC client and
scroll workload remain constant; X display depth is the primary variable.

Depth 24 used 4.52 MiB more server memory, reduced normalized X11 throughput by
40.7%, and required 71.5% more VNC CPU per completed scroll operation while
saving 8.1% RFB bytes per operation. The hypothesis is rejected: retain depth
16 for generic classes. WeChat remains an application-specific depth-24
exception because depth 16 renders it incorrectly.

See the [P04 section](../../../docs/performance-experiments.md#p04-depth-16-versus-depth-24)
and [`results-2026-08-27.json`](results-2026-08-27.json).
