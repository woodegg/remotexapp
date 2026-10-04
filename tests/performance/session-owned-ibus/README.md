# P14 session-owned D-Bus and IBus

P14 tests whether a persistent display can keep its server layer free of
D-Bus, IBus and the Unicode engine, creating all three only with the on-demand
XFCE session. It is isolated from the live service:

| Resource | Experiment | Production candidate |
|---|---:|---:|
| Manager | `0.0.0.0:1992` | `0.0.0.0:1991` |
| X display | `:31` | `:2` |
| RFB | `127.0.0.1:5931` | unchanged |
| Gateway | `127.0.0.1:39031` | unchanged |
| State | `.runtime/experiments/session-owned-ibus/state-final` | unchanged |

`class.json` opts into `input.lifecycle: "session"`. The parser default remains
`server` for compatibility; all repository production classes now explicitly
use `session`. `server.sh` is only
a lifecycle/readiness anchor. `session.sh` creates one private D-Bus, one lean
IBus daemon, the custom Unicode engine, XFCE and exactly one Clipman inside the
session cgroup, then removes their PID files and sockets on exit.

## Result

With no RFB client attached, the server unit contained only
`/usr/bin/sleep infinity`: 204,800 bytes `MemoryCurrent`, one task and no input
runtime artifacts. The current production server-unit snapshot was 16,887,808
bytes and 18 tasks. The attributable server-unit difference was 16,683,008
bytes and 17 tasks. VNC/gateway numbers are not used for a causal claim because
their live workload and Go heap age differed.

The gateway remains alive while the input socket is absent. Its reconnect loop
now logs one unavailable message per outage and reconnects automatically when
the session creates the socket. It no longer writes the same expected message
once per second throughout a vacant period.

Two complete session generations passed:

- cold attach-to-ready was 4,798 ms and 3,747 ms;
- Chinese/English switching, the first post-switch character, text ACK,
  pointer, shortcuts, RFB/input reconnect and clipboard readback passed;
- server processing was 0.532–1.883 ms and measured browser/server round trips
  were 1.0–4.8 ms;
- pushed and cached cursor snapshots remained usable after session recreation
  and after switching away from and back to `remote-unicode`;
- final Mousepad text was exactly
  `B2首字：好D4；B2重连E5；B2切换首字F6`;
- ten seconds after detach, the session D-Bus, IBus, engine, PID files and
  sockets were all gone while VNC and the gateway stayed ready.

The gateway must own the public cursor `sequence`. The engine's sequence
restarts both when a session is recreated and when the input method is switched
away and back within one session. Rebasing only when a Unix subscription opens
does not solve the second case.

The test Mousepad process uses a per-generation XDG config/cache/data directory.
Reusing its profile after deliberately terminating a session can show a GTK
recovery dialog; that dialog is application recovery behavior, not input
failure.

## Reproduction

The resource table records the original experiment. The commands below use
loopback for current reproduction; do not copy historical wildcard test
listeners into production.


Build experimental binaries outside `bin/`, then run an isolated manager:

```bash
go build -o .runtime/experiments/session-owned-ibus/bin/remotexappd ./cmd/remotexappd
go build -o .runtime/experiments/session-owned-ibus/bin/novnc-input ./cmd/novnc-input
go build -o .runtime/experiments/session-owned-ibus/bin/remotexapp-status ./cmd/remotexapp-status

systemd-run --user --unit=remotexapp-session-owned-ibus --collect \
  --property=WorkingDirectory="$PWD" \
  "$PWD/.runtime/experiments/session-owned-ibus/bin/remotexappd" \
  -listen 127.0.0.1:1992 \
  -state-dir "$PWD/.runtime/experiments/session-owned-ibus/state" \
  -class-config "$PWD/tests/performance/session-owned-ibus/class.json" \
  -gateway-bin "$PWD/.runtime/experiments/session-owned-ibus/bin/novnc-input" \
  -status-bin "$PWD/.runtime/experiments/session-owned-ibus/bin/remotexapp-status" \
  -ibus-engine "$PWD/components/remote-unicode-engine/engine.py" \
  -gateway-text-log errors -vnc-launcher direct \
  -managed-observer cgroup -session-observer cgroup
```

Verify the server-only state before opening a viewer:

```bash
curl -fsS http://127.0.0.1:1992/api/instances | jq .
systemctl --user status remotexapp-INSTANCE-server.service
journalctl --user-unit remotexapp-INSTANCE-gateway.service
```

The isolated viewer was stopped after acceptance; port 1992 is no longer
running. The live managed XFCE viewer is
`http://test-host:1991/remotexapps/xfce-desktop-EXAMPLE/kiosk.html`.

## Decision and deployment state

P14 is accepted and deployed to XFCE, Mousepad and Edge. The live Full XFCE
vacant server unit measured 212,992 B/1 task versus 16,887,808 B/18 tasks
before deployment. Post-live application input, clipboard, resize/reconnect
and cleanup tests passed. Detached display `:2` intentionally has no
D-Bus/IBus/clipboard service until the next RFB attach.

Machine-readable evidence is in
[`results-2026-08-27.json`](results-2026-08-27.json).
