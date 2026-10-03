# P11 non-blocking cursor fan-out

P11 prevents one slow `/input` WebSocket from delaying caret updates for every
other browser. Each input peer owns one cursor writer and a capacity-one queue.
`cursor-position` messages are state snapshots: when the writer is busy, a new
snapshot replaces the older queued snapshot. Text acknowledgements and direct
cursor-query replies remain reliable writes, serialized with the cursor writer
by the peer's existing write mutex.

## Deterministic A/B

`cmd/novnc-input/cursor_fanout_experiment_test.go` is protected by the
`p11experiment` build tag. It runs the production `publishCursor` path with 32
updates, one writer delayed by exactly 10 ms and one fast writer. The same
harness was run five times immediately before and after the source change.

```bash
go test -tags p11experiment ./cmd/novnc-input \
  -run '^TestP11CursorFanoutExperiment$' -count=5 -v

go test -tags p11experiment ./cmd/novnc-input \
  -run '^TestP11CursorPeerOverheadExperiment$' -count=1 -v
```

Median results:

| Metric | Serial baseline | P11 |
|---|---:|---:|
| `publishCursor` for 32 updates | 324.437 ms | 13.211 us |
| Fast peer receives sequence 32 | 324.436 ms | 23.242 us |
| Slow peer snapshots written | 32 | 1 |
| Slow peer receives sequence 32 | 324.434 ms | 10.791 ms |

The publisher became approximately 24,558 times faster in this controlled
case. The important property is bounded latency: the slow writer no longer
executes on the subscription-reader goroutine, and every peer still converges
to sequence 32.

The separate 1,000-peer candidate measurement added exactly 1,000 goroutines.
Its five normal-build samples used a median 1,031,256 bytes of live heap and
2,162,688 bytes of stack-in-use, or about 3.19 KiB per connected input peer.
Every writer goroutine exited after its peer was removed. Race-enabled tests
also passed; their larger instrumented stacks are not used as memory results.

## Real-stack verification

The candidate used the accepted P03 no-Clipman class on isolated manager port
1992, display `:11`, RFB port 5911 and gateway port 39011. A headless Chrome
noVNC client exercised Unicode, cursor push/cache, pointer dispatch, client
resize and explicit SDK reconnect. `verify-live.mjs` attached a second raw
`/input` observer: it saw sequence 6, the text commit pushed sequence 7, and a
new observer immediately received cached sequence 7. A later run verified
sequences 7 -> 8 -> cached 8.

The first exact text request completed in 0.852 ms server-side and 2.0 ms
round-trip; both SDK channels explicitly reconnected in 36.0 ms. Selecting all
and copying from Mousepad returned exactly:

```text
P11 中文 input reconnect OK P11 cursor cache P11 clipboard exact
```

For a contextual 30-second idle check, the old gateway and P11 candidate each
had one RFB and one input client. Their CPU use was one and zero scheduler
ticks. A unique copy of the old binary avoided shared-inode PSS distortion;
old/new average RSS was 9,498.4/9,966.4 KiB and average PSS was
7,080.4/7,447.4 KiB. These whole-process values are not attributed solely to
P11 because the deployed old binary also predates other accepted source work;
the build-tagged 1,000-peer measurement above is the controlled marginal-cost
result.

Automated unit tests cover latest-value coalescing, fast-peer isolation,
cached snapshots, stale-sequence rejection, connection cleanup and writer
failure. The full package and race suites pass.

All port-1992/1993 managers, Chrome processes, instances and displays were
stopped. Their temporary directory was moved to trash. Port 1991 remained HTTP
200 and was not rebuilt or restarted. Machine-readable evidence is in
[`results-2026-08-27.json`](results-2026-08-27.json).
