# Session-owned input go-live — 2026-08-27

## Outcome

P14 is live on `0.0.0.0:1991`. Every repository production class
(`xfce-desktop`, `mousepad`, and `edge-browser`) explicitly sets
`input.lifecycle: "session"` and sources
`drivers/common/session-input.sh`. The persistent server driver contains no
D-Bus, IBus or Unicode engine; it is one `sleep` readiness process.

The parser retains `server` as the default only so an external older class file
does not silently change lifecycle. The repository catalog test enforces the
new explicit production policy and rejects server drivers containing
`dbus-launch`, `ibus-daemon`, or `engine.py`.

Live endpoints:

- console: `http://test-host:1991/sdk/console.html`
- Full XFCE: `http://test-host:1991/remotexapps/xfce-desktop-688676b680f5/kiosk.html`
- X display: `:2`
- managed registration: `test-host-xfce`
- retained profile: `xfce-driver-test`

Port 1992, display `:31`, RFB 5931 and gateway 39031 were stopped after the
candidate tests.

## Deployment identity

| Component | Live SHA-256 |
|---|---|
| `remotexappd` | `188afc120b3f1b12d3555e7dc7fc63dc608c04f784bc080c40a577ad31f566a6` |
| `novnc-input` | `304f77f9c0452c03195ac2eccd0062d7b46d915c8cff267bcb59ea598f37e8d5` |
| `remotexapp-status` | `3ee10fb239c7f201d773d2d422b6bac96d90e7fb9ef9b442c2714ce028d46a91` |

The managed ID, HOME and profile were preserved. Runtime identity changed from
`xfce-desktop-3a4e151e1d2b` to `xfce-desktop-688676b680f5` so no old
server-owned input process could survive the manager binary replacement.

## Verification

Before deployment, the exact production drivers ran under an isolated
port-1992 catalog:

- XFCE: 20 mixed English/Chinese commits, exact clipboard readback, fixed
  framebuffer, reconnect and detach cleanup passed;
- Mousepad: the same input/readback passed, remote resize reached 900x640 and
  complete instance cleanup left no unit/process;
- Edge: its address bar copied exact `P14Edge你好Z9`; D-Bus, IBus and the engine
  were all members of the session cgroup and left no socket/PID afterward.

After deployment, all three were repeated against port 1991 and the final
binary hashes:

| Check | XFCE | Mousepad | Edge |
|---|---:|---:|---:|
| Attach to running session | 4,188 ms | 1,013 ms | passed |
| Text | 20 mixed requests | 20 mixed requests | exact `LiveEdge你好Z9` |
| Browser/server RTT p50 | 1.10 ms | 1.50 ms | ACK 1.073 ms server time |
| Server processing p50 | 0.524 ms | 0.811 ms | 1.073 ms |
| Clipboard/readback | exact | exact | exact |
| Reconnect | 34 ms | 34 ms | n/a |
| Resize policy | fixed, correct | remote 900x640, correct | isolated/live driver path passed |
| Input artifacts after stop | zero | zero | zero |

`make backend-test`, targeted race tests, `go vet`, all shell syntax checks,
the SDK suite and the 16-experiment documentation gate passed. The production
class API reports `lifecycle: "session"` for all three templates.

A later same-day lifecycle follow-up enabled driver status for Full XFCE.
Real Logout on isolated `1993/:31` and production `:2` produced
`sessionState: stopped`, application state `exited`, no error, and retained the
RFB client. Reattachment started generation 2; final detach removed every
input artifact. The manager now refreshes the status schema on every session
start so an older persistent runtime can adopt a newly enabled status contract.

## Resource comparison

The causal comparison is the Full XFCE server unit only:

| Detached server-layer metric | Before P14 | Live P14 | Difference |
|---|---:|---:|---:|
| `MemoryCurrent` | 16,887,808 B | 212,992 B | -16,674,816 B (-98.74%) |
| Tasks | 18 | 1 | -17 |
| D-Bus/IBus/engine processes | present | 0 | removed |

Attached total memory is not claimed as a controlled improvement: input work
moves into the session cgroup, and VNC/gateway/application heap state differed
between historical samples. The historical identical harness attached in
3,597 ms; the post-P14 run attached in 4,188 ms. Input p50 (1.0 versus 1.1 ms),
reconnect (35 versus 34 ms) and server p50 (0.514 versus 0.524 ms) were
effectively unchanged.

## Runtime behavior

```text
manager start
  -> Xtigervnc + gateway + sleep anchor
  -> server-ready; no D-Bus/IBus/Unicode socket

first RFB attach
  -> session-input.sh starts private D-Bus + lean IBus + engine
  -> class driver starts XFCE or Matchbox/application

last RFB detach + class timeout
  -> stop complete session cgroup
  -> remove session PID/address/socket files
  -> persistent XFCE returns to server-ready
     or temporary single-app instance stops completely
```

The gateway remains alive while its Unicode socket is absent. It logs one
unavailable message per outage and reconnects when the next session creates
the socket. The gateway owns the public caret sequence because an engine's
counter restarts across both session recreation and input-method switching.

## Rollback

The recoverable snapshot is:

`/home/tester/dev/remotexapp/.runtime/deploy-backups/20260827-session-owned-input`

It contains the old three binaries, managed registry/API snapshots, service
definition, old `HEAD` source archive and the P14 patch. A rollback must stop
the manager and all four current XFCE units before restoring anything; live
driver scripts are read directly from the repository.

```bash
backup=/home/tester/dev/remotexapp/.runtime/deploy-backups/20260827-session-owned-input
repo=/home/tester/dev/remotexapp

systemctl --user stop remotexapp.service
systemctl --user stop \
  remotexapp-xfce-desktop-688676b680f5-session.service \
  remotexapp-xfce-desktop-688676b680f5-gateway.service \
  remotexapp-xfce-desktop-688676b680f5-server.service \
  remotexapp-xfce-desktop-688676b680f5-vnc.service

tar -xf "$backup/source-head.tar" -C "$repo" configs drivers
install -m 0755 "$backup/binaries/remotexappd-bin" "$repo/.runtime/remotexappd-bin"
install -m 0755 "$backup/binaries/novnc-input-bin" "$repo/.runtime/novnc-input-bin"
install -m 0755 "$backup/binaries/remotexapp-status-bin" "$repo/.runtime/remotexapp-status-bin"
systemctl --user start remotexapp.service
```

Do not restore the old managed JSON over a running manager. Its registration
already remains desired-running and preserves the same profile; after the old
runtime is stopped, reconciliation creates a compatible replacement.
