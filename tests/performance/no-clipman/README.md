# P03 disposable single-app server without Clipman

P03 removes persistent `xfce4-clipman` startup from the accepted lean-IBus
single-app server. The class and driver in this directory are the isolated
candidate; Full XFCE is explicitly outside this experiment.

Server MemoryCurrent was 41,463,808 B before attach and 41,381,888 B after more
than 60 seconds, versus about 62 MiB for P01. Tasks fell from 23 to 20 over the
same interval. D-Bus requester logs showed why the removed Clipman path also
avoided AT-SPI, Xfconf and Desktop Portal helpers. Exact in-app clipboard,
Unicode/IME, pointer, resize and reconnect passed, and the user confirmed the
interactive behavior. P03 is accepted for disposable single-app instances.

See the [P03 section](../../../docs/performance-experiments.md#p03-disposable-single-app-server-without-clipman)
and [`results-2026-08-27.json`](results-2026-08-27.json).
