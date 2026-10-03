# P06 demand-driven browser diagnostics

P06 makes periodic SDK traffic diagnostics opt-in. The CDP harness in this
directory measures gateway requests, SDK events and diagnostic DOM mutations
with the kiosk panel hidden, visible and hidden again.

Both hidden 5.2-second phases produced zero `/healthz` requests, diagnostic
events and DOM mutations. The visible phase produced five health requests and
six diagnostic events/mutations. The independent two-second instance watcher
remained active in all phases. Exact Unicode/clipboard, reconnect and the full
interactive matrix passed, so P06 is accepted.

See the [P06 section](../../../docs/performance-experiments.md#p06-demand-driven-browser-diagnostics)
and [`results-2026-08-27.json`](results-2026-08-27.json).
