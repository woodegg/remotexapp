# P09a transition-only managed-registry persistence

This experiment isolates one part of the managed reconciliation hot path: a
healthy five-second reconciliation must not durably rewrite an unchanged
managed registration. The accepted P08 direct-`Xtigervnc`, P01 lean-IBus and
P03 no-Clipman stack, manager interval, health probes and class policy were
held constant. Port 1992 and separate state directories were used; port 1991
was not rebuilt or restarted.

## Controlled comparison

The baseline always serialized the mode-0600 registration, wrote a temporary
file, called `fsync`, and atomically renamed it on every healthy pass. The
candidate persists only a desired/observed/runtime/error transition. The
existing five-second `xdpyinfo` and gateway `/healthz` checks deliberately
remain unchanged; replacing them is P09b.

Each 20-second steady-state window contained four complete reconciliation
passes:

| Operation | Baseline | P09a | Change |
|---|---:|---:|---:|
| `xdpyinfo` executions | 4 | 4 | unchanged |
| gateway health connects | 4 | 4 | unchanged |
| registry `fsync` calls | 4 | 0 | -100% |
| registry atomic renames | 4 | 0 | -100% |
| registry inode/mtime/content | changed/changed/same | same/same/same | no no-op mutation |

At 100 healthy managed registrations this removes the former average of 20
temporary-file writes, 20 `fsync` calls and 20 renames per second. It does not
yet remove the corresponding 20 `xdpyinfo` processes and 20 HTTP checks per
second.

## Correctness and lifecycle checks

- `running -> stopped` and `stopped -> running` both replaced the registry
  file and updated the durable transition.
- Restarting the manager adopted the same healthy runtime without rewriting
  its registration.
- Killing the isolated gateway caused the five-second safety reconciler to
  replace the runtime in 2.956 seconds and restore a healthy gateway.
- The restart test exposed a pre-existing ownership bug: each periodic pass
  copied the old durable runtime snapshot over the live in-memory instance,
  losing current session/client state. SDK reconnect could then try to create
  an already-loaded transient session unit. P09a now adopts the durable
  snapshot only when the runtime is absent; the live instance remains
  authoritative after adoption.
- After a real manager restart, the browser committed `P09a 中文 input`,
  explicitly disconnected/reconnected both channels in 44.0 ms, committed
  ` reconnect OK`, and the Mousepad clipboard readback was exactly
  `P09a 中文 input reconnect OK`. Server acknowledgements were 0.653 ms and
  1.566 ms.

Raw measurements and binary hashes are in
[`results-2026-08-27.json`](results-2026-08-27.json). The isolated managed
registration, runtime, browser and port-1992 manager were removed after the
test.
