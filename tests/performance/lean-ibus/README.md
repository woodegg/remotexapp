# P01 lean private IBus

P01 compares the original private IBus invocation with a single-process lean
mode while keeping TigerVNC, Mousepad, Matchbox, the Unicode engine, gateway,
display settings and browser path constant. The isolated class and server
driver in this directory reproduce the accepted candidate.

The server layer fell from about 101 MiB to about 62 MiB and from 58 to 48
tasks. Instance creation took 578 ms and session-driver readiness about 34 ms.
Exact `P01你好abc` application clipboard readback, cursor push, IME switching,
pointer, resize and reconnect passed; the user confirmed the interactive
matrix. The experiment is accepted for the tested single-app stack.

The detailed reasoning, readiness caveat and process attribution are in the
[P01 section](../../../docs/performance-experiments.md#p01-lean-private-ibus).
Machine-readable summary values are in
[`results-2026-08-27.json`](results-2026-08-27.json).
