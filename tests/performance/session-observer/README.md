# P10 event-driven session exit observation

P10 replaces the 500 ms readiness-PID monitor for every running session with
one additional `cgroup.events` watch descriptor on its transient systemd
session unit. It reuses P09b's host-wide cgroup-v2/inotify FD and reader
goroutine, so a running session adds neither a timer nor a goroutine, process,
or file descriptor. `-session-observer=poll` explicitly restores the previous
PID-file behavior when cgroup-v2/inotify is unavailable.

## Controlled result

The P09b binary and P10 candidate ran the same P03 lean/no-Clipman Mousepad
class with a real headless Chrome/noVNC attachment. Matched 30-second steady
windows produced:

| Operation per running session | P09b baseline | P10 |
|---|---:|---:|
| readiness PID-file opens/parses | 60 | 0 |
| `kill(pid, 0)` probes | 60 | 0 |
| recurring monitor goroutines | 1 | 0 |
| one-time session watch descriptors | 0 | 1 |

The candidate registered the watch once at session startup and performed zero
watch registrations during the steady window. A simultaneous clean
20-second sample recorded one CPU tick for each manager. Five PSS snapshots
averaged 9,925.2 KiB for the old manager and 9,336.4 KiB for the candidate;
the small negative difference is treated as Go heap/process noise, not a
claimed memory saving. Both used eight OS threads. The candidate adds no new
host-wide inotify FD or reader because it shares P09b's observer.

## Correctness and failure injection

- normal Mousepad termination became `stopped` in 112 ms;
- `SIGKILL` became driver-reported `failed` in 62 ms with exit code 137;
- after a real manager restart, the same managed runtime and registry inode
  were retained, all three VNC/gateway/session watches were restored, and
  normal Mousepad termination became `stopped` in 118 ms;
- explicit `-session-observer=poll` detected normal termination in 219 ms;
- the production Full XFCE session driver reached `running`, and terminating
  its `xfce4-session` MainPID became `failed` in 206 ms;
- stale session generations are ignored by a unit test, and both observer
  modes retain the same generation guard.

The browser committed and read back exactly `P10 中文 input reconnect OK`.
The input acknowledgement took 0.903 ms server-side/2.0 ms round trip, the
SDK explicitly reconnected in 39.8 ms, the framebuffer changed from 1100x760
to 900x640, and an RFB pointer event landed at the requested display position
550,380. English/Chinese input, application clipboard readback, pointer,
resize and both SDK channels therefore passed on the isolated candidate.

One invalid Full-XFCE attempt used P03b's experimental session driver and
missed the manager readiness deadline while that driver waited for Clipman.
It never registered a P10 session watch and is excluded from P10 results. The
successful Full-XFCE check used this directory's dynamic class with the
production `apps/xfce-desktop/driver` server/session drivers. This keeps the
observer experiment separate from the known P03b readiness/retry issue.

All test instances and port-1992/1993 managers were stopped. Port 1991 was
reachable throughout and was not rebuilt or restarted during the experiment.
Machine-readable evidence is in
[`results-2026-08-27.json`](results-2026-08-27.json); the browser harness is
[`verify-cdp.mjs`](verify-cdp.mjs).
