# P16: Core-owned session service overhead

Measured again on the local Ubuntu/X11 host, 2026-09-14 (America/New_York).
The variable is service ownership: stable Core 0.11/Mousepad 3 versus
Core 0.12.0-rc.2/Mousepad 4. The App's display, document and shutdown policies
are unchanged. Other live test suites had finished before this measurement.

## Reproduce

```bash
node tests/performance/core-session-services/measure.mjs \
  /path/to/extracted-0.11.0 /path/to/extracted-candidate
```

Requires local user systemd, X11/IBus, shipped-App dependencies, Node and the
two extracted archives. Uses disposable Managers at loopback 21996 and fresh
Mousepad profiles; never point it at a deployed user's runtime. Five samples
per version alternate order. Each includes a fresh runtime/profile launch,
2-second settle, 5-second idle observation, then a same-runtime warm session
restart. Host executable caches are warm; this is not a power-on/cache-drop
benchmark. Session-cgroup memory/CPU and live processes are observed directly.
No threshold was relaxed after measurement.

## Results

| Median | Stable baseline | Candidate |
|---|---:|---:|
| Fresh runtime/profile ready | 1,194 ms | 1,584 ms |
| Same-runtime session restart | 1,264 ms | 1,669 ms |
| Session cgroup memory | 72,056,832 B | 76,288,000 B |
| Idle CPU, percent of one core | 0.0451% | 0.0458% |
| Live processes | 15 | 16 |
| Stop-instance cleanup | 122 ms | 122 ms |

Memory increases by 4.04 MiB; startup/restart increase about 0.39/0.41 seconds.
The extra process is the Core supervisor. Both versions have one owned session
D-Bus, one IBus and one Unicode engine. AT-SPI also owns a D-Bus daemon in both
versions; it is counted separately, not mistaken for a duplicate session bus.

All locked gates pass: extra latency <= max(1 second, 20%), memory <= 16 MiB,
idle CPU <= 0.5 percentage points, at most one extra process, no additional
input services, and every candidate cleanup <= 10 seconds. This is a bounded
overhead result, not a performance improvement or a universal host guarantee.
Human UAT remains a separate requirement.

[Raw samples, identities and gate results](results-2026-09-14.json) come from
the frozen installable rc.2 archive B, also used for final real-App tests.
The [earlier rc.1 samples](results-2026-09-13.json) remain historical evidence,
not measurements of the repaired runtime. This is not a controlled performance
comparison between rc.1 and rc.2; both were separately compared to stable 0.11.
The initial exploratory counter counted AT-SPI as a second session bus and
failed that assertion; the final measurement distinguishes both explicitly.
