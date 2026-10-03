# System performance before/after benchmark

This harness records a reproducible system-level baseline before the accepted
P01/P03/P03b driver integrations and the P02/P05-P13 live deployment. Run the
same commands after go-live; do not change the workload between runs.

For each Mousepad and Full XFCE run it records:

- manager process and VNC/server/gateway/session cgroup CPU, memory, PSS and
  I/O (the server cgroup is optional for the old wrapper topology);
- 30 seconds attached but static;
- 600 sequential Unicode commits at 50 ms intervals (30 seconds), including
  60 Chinese commits and 60 newlines;
- 30 seconds of browser-originated RFB wheel input;
- RFB traffic, request acknowledgement latency, cold browser asset load,
  resize policy, reconnect time and exact application clipboard readback;
- live manager/gateway binary hashes and lifecycle timing.

Clipboard validation explicitly requests the X11 `UTF8_STRING` target. The
shell locale's default `STRING` request is not a valid Unicode correctness
test and is not consistently advertised by Full XFCE's selection owner.

Resize is strict: a resizable class must reach the requested framebuffer width
and height within five seconds; a fixed class must remain byte-for-byte at its
original dimensions through a two-second observation window. An intermediate
framebuffer change is not accepted as completion.

The benchmark deliberately uses a new ephemeral Mousepad instance. It attaches
to the existing fixed Full XFCE singleton, waits for its session to start, and
starts and activates one Mousepad benchmark window with that session's
environment.
The app inherits the private session/IBus environment and its PID metrics are
recorded separately, then added to the full-desktop comparison. Its XDG
config/cache/data paths live inside the temporary browser profile so recovery
dialogs and saved state in the persistent XFCE HOME cannot affect the run. The one-time
`xdotool windowfocus` is setup outside every measured phase; all workload
input still travels through the browser SDK/RFB/IBus paths. The harness leaves
the XFCE server layer running after client disconnect and never stops the fixed
server.

```bash
BENCH_OUTPUT_DIR=tests/system-performance/results \
  tests/system-performance/capture-inventory.sh pre-go-live

BENCH_OUTPUT_DIR=tests/system-performance/results \
  tests/system-performance/run-one.sh mousepad pre-go-live

BENCH_OUTPUT_DIR=tests/system-performance/results \
  tests/system-performance/run-one.sh xfce-user-desktop current
```

The default workload lasts about 90 seconds per class. Use shorter values only
to debug the harness, never for the recorded before/after comparison.

## Recorded pre-go-live baseline

The current port-1991 runtime used manager `163f8646…`, gateway `4e99d0a7…`
and SDK 0.5. Both valid runs committed 600 requests over 30 seconds and returned
the exact 660-character/780-byte application value through the X11
`UTF8_STRING` clipboard.

| Metric | Mousepad | Full XFCE + benchmark Mousepad |
|---|---:|---:|
| Create/lookup | 578 ms | 9 ms |
| Attach to running session | 1,184 ms | 1,029 ms |
| Attached total PSS | 169,585 KiB | 433,741 KiB |
| Input ACK p50 / p95 | 1.3 / 3.0 ms | 1.3 / 3.5 ms |
| Input RFB down | 127.35 kbit/s | 82.61 kbit/s |
| Scroll RFB down | 35.43 kbit/s | 37.22 kbit/s |
| Static RFB down | 0.24 kbit/s | 307.79 kbit/s |
| Cold static assets | 45 / 549,477 B | 45 / 549,477 B |
| Reconnect | 31 ms | 43 ms |
| Exact clipboard / resize policy | pass / pass | pass / pass |

The Full XFCE server-only inventory was 151,190 KiB VNC/server PSS plus 5,347
KiB gateway PSS before attachment. Full XFCE's attached total includes the
separately measured 21,310 KiB benchmark Mousepad process.

An earlier 90-second XFCE run is retained as
`pre-go-live-xfce-invalid-recovery-dialog.json` but excluded. A recovery dialog
from the persistent XFCE HOME was focused instead of an editor; the private
IBus engine ACKed requests, demonstrating why ACK alone is not application
delivery evidence. The fixed harness gives its benchmark app temporary XDG
state and requires exact clipboard readback.

Authoritative artifacts:

- `results/pre-go-live-inventory.json`
- `results/pre-go-live-mousepad.json`
- `results/pre-go-live-xfce-desktop.json`
- `results/pre-go-live-summary.json`

## Recorded post-go-live comparison

The identical workload was repeated against the actual port-1991 user-systemd
deployment. Both classes again completed 600 requests/780 UTF-8 bytes with
zero errors, exact application clipboard readback, correct resize policy,
reconnect and lifecycle cleanup. SDK 0.8 loaded 3 static resources/182,088
bytes instead of 45/549,477.

| Metric | Mousepad before -> after | Full XFCE before -> after |
|---|---:|---:|
| Attached total PSS | 169,585 -> 124,410 KiB (-26.6%) | 433,741 -> 393,179 KiB (-9.4%) |
| Attach | 1,184 -> 796 ms | 1,029 -> 3,597 ms |
| Static CPU | 25,995 -> 16,472 us | 274,776 -> 38,259 us |
| Input CPU | 3,013,833 -> 2,663,215 us | 2,617,639 -> 2,436,058 us |
| Static RFB down | 0.24 -> 0.24 kbit/s | 307.79 -> 0.30 kbit/s |
| Input RFB down | 127.35 -> 127.63 kbit/s | 82.61 -> 73.11 kbit/s |
| ACK p50 / p95 | 1.3/3.0 -> 1.0/2.9 ms | 1.3/3.5 -> 1.0/2.1 ms |

XFCE server-only PSS fell 156,537 -> 80,903 KiB and MemoryCurrent fell
142,700,544 -> 33,792,000 bytes. The XFCE cold attach regression is the cost
of starting its private session D-Bus and exactly one session-owned Clipman
instead of retaining desktop support in the detached server layer.

Post-live artifacts:

- `results/post-go-live-inventory.json`
- `results/post-go-live-mousepad.json`
- `results/post-go-live-xfce-desktop.json`
- `results/post-go-live-summary.json`

The complete interpretation, validation matrix, deployment and rollback notes
are in [`docs/go-live-report-2026-08-27.md`](../../docs/go-live-report-2026-08-27.md).

## Commercial RC sample

The same 90-second workloads were repeated after installing 0.1.0-rc.1 and
rebuilding display 2 from installed binaries. Both classes again passed 600
commits, exact clipboard, resize policy, reconnect and cleanup. RFB input and
scroll byte counts remained within 1.32% of the post-go-live sample.

The RC host was materially busier (load averages about 3-7 rather than 1-3),
so its higher latency and some PSS variation are recorded but are not treated
as a matched regression. See the commercial release report for the comparison
and qualification.

RC artifacts:

- `results/commercial-rc-inventory.json`
- `results/commercial-rc-mousepad.json`
- `results/commercial-rc-xfce-desktop.json`
- [`docs/commercial-release-report-2026-08-27.md`](../../docs/commercial-release-report-2026-08-27.md)
