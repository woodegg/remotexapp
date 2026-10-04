# RemoteXApp 0.9.1 — RFB idle heartbeat

> Historical technical record. Dated status and validation statements describe
> their original scope; they do not identify a current deployment. See
> [current source versions](current-state.md). Host labels and runtime IDs in
> historical examples are anonymized.

## Accepted scope

RFB-001: server WebSocket Ping every 30 seconds on direct and compatibility
relays; browser-native Pong; bounded control writes and lifecycle cleanup.
SDK remains 0.26.0 and all App Packages remain unchanged. No authentication,
listener, clipboard, IME, queue-capacity or retry-policy changes.

## Acceptance and authorization — 2026-09-12

The operator accepted local 1991 UAT of the working-tree heartbeat build,
then authorized formal GitHub publication, all eight endpoint deployments,
and forced upgrade/restart of existing runtimes. Forced restart may discard
unsaved application state. Persistent profiles must remain intact.

Local verification passed make check, five repeated focused race runs, and
140 seconds of real Edge/noVNC plus minimal-RFB observation: four Pings with
30002/29998/30000 ms intervals and no unexpected disconnect. This local test
does not certify the Cloudflare path. Formal metadata promotion must still
pass hosted candidate gates and exact-archive App E2E before tagging.

## Deployment scope

- Local production 127.0.0.1:1991 and test 127.0.0.1:2992.
- test-host-a production 1991 and loopback test 2991.
- test-host-c, test-host-d, test-host-h and test-host-k production 1991.

Use the alignment process and sandbox playbook: verify one formal artifact,
stage everywhere, select sequentially with rollback, verify twice, then use
generation/revision-qualified force upgrade-and-restart for recorded runtimes.
Do not create replacement apps when an endpoint has no runtime. Verify current
pins, actual gateway executable identity, and readiness after browser attach
where sessions are on-demand. No gateway configuration changes or aggressive
production-gateway tests. Record publication/alignment evidence separately.

## Status

Human UAT accepted. Formal v0.9.1 publication and eight-endpoint alignment are
complete; all seven live runtimes, including test-host-k Edge, were force-upgraded
and verified ready with the formal gateway bytes and 30-second heartbeats.
Both test endpoints had no live runtime. Stable rollback is 0.9.0; replacing
Manager alone does not change an existing runtime pin.

[Evidence](private-history.md) records hosted
gates, exact-archive E2E, cleanup/diagnostic retries and per-endpoint checks.
Direct build-host private HTTP remains unavailable; no production-gateway
configuration or aggressive test was used to bypass that restriction.
