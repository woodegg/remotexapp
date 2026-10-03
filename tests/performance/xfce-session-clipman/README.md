# P03b XFCE session-owned Clipman

P03b moves Full XFCE clipboard ownership into its on-demand session cgroup.
The files in this directory reproduce the isolated fixed-display class and its
server/session drivers.

Generation 1 intentionally exposed duplicate ownership when the session script
started Clipman while the XFCE panel also loaded its plugin. The corrected
driver lets the panel own exactly one process. Generations 2 and 3 proved that
the process uses the private session D-Bus, is absent from the server cgroup,
and disappears with the session after vacancy. The user confirmed Full XFCE
input, clipboard and reconnect; the final journal contained 33 successful text
commits and zero client-event records. P03b is accepted.

The measured 234 MiB/176-task connected session is workload context, not a
claimed memory saving. See the
[P03b section](../../../docs/performance-experiments.md#p03b-move-full-xfce-clipman-into-its-session-layer)
and [`results-2026-08-27.json`](results-2026-08-27.json).
