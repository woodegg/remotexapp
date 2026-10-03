# P09b event-driven managed-runtime observation

P09b replaces the healthy managed runtime's five-second `xdpyinfo` process and
gateway `/healthz` request with host-wide cgroup-v2/inotify observation. It is
built on accepted P09a transition-only persistence and P08 direct Xtigervnc.
The existing lean-IBus/no-Clipman class, health definition and runtime recovery
path remain unchanged.

The observer owns one inotify FD and one goroutine per host manager. Each
running managed runtime adds two watch descriptors, for its VNC and gateway
`cgroup.events` files. A `populated 1 -> 0`, cgroup deletion or move queues a
generation-qualified reconciliation event. Events from an old runtime are
ignored after replacement. A five-minute, +/-20% jittered full health pass is
retained for a process that remains alive but becomes unresponsive. Explicit
`-managed-observer=poll` restores the old five-second behavior.

## Controlled 30-second result

| Steady operation | P09a poll baseline | P09b cgroup observer |
|---|---:|---:|
| `xdpyinfo` executions | 6 | 0 |
| gateway health connects | 6 | 0 |
| registry `fsync` | 0 | 0 |
| registry rename | 0 | 0 |
| watch registration during window | n/a | 0 |

Watches are registered once when a runtime is created or adopted. Restart
adoption performed one full `xdpyinfo`/HTTP validation, registered two watches,
kept the runtime ID and registry inode unchanged, then returned to event-only
steady state.

## Cost and recovery

A simultaneous 20-second sample with one managed runtime per manager measured:

| Host-manager metric | P09a | P09b | Change |
|---|---:|---:|---:|
| Average CPU | 0.05% | 0.00% | below sample resolution |
| PSS | 8,360 KiB | 8,816 KiB | +456 KiB |
| RSS | 9,856 KiB | 10,312 KiB | +456 KiB |
| Threads | 7 | 8 | +1 per manager |
| File descriptors | 7 | 8 | +1 per manager |
| Binary size | 9,460,570 B | 9,488,424 B | +27,854 B |

Recovery from an intentionally killed isolated gateway completed in 1.596
seconds. Killing direct Xtigervnc completed runtime replacement in 642 ms.
After a real manager restart, killing the adopted gateway recovered in 631 ms,
proving the watches were restored rather than only created for new runtimes.
The explicit poll fallback also recovered a killed gateway in 2.840 seconds.

Explicit stopped/running transitions, stale-event suppression, SDK reconnect,
Unicode input, resize and clipboard readback passed automated checks. The
browser committed and read back exactly `P09b 中文 input reconnect OK`, restored
both SDK channels in 65.1 ms, and resized the remote display from 780x437 to
1100x760. The user then completed the isolated interactive input, pointer and
reconnect check and reported that it worked. The accepted gateway journal
contained 50 completed text requests, zero text errors and zero client trace
events. P09b is accepted; the isolated runtime and port-1992 manager were
removed after confirmation.

Machine-readable evidence is in
[`results-2026-08-27.json`](results-2026-08-27.json).
