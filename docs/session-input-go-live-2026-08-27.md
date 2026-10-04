# Session-owned input go-live — 2026-08-27

> Historical technical record. Dated status and validation statements describe
> their original scope; they do not identify a current deployment. See
> [current source versions](current-state.md). Host labels and runtime IDs in
> historical examples are anonymized.

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
- Full XFCE: `http://test-host:1991/remotexapps/xfce-desktop-EXAMPLE/kiosk.html`
- X display: `:2`
- managed registration: `example-managed-desktop`
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
`xfce-desktop-EXAMPLE` to `xfce-desktop-EXAMPLE` so no old
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

## Historical rollback boundary

The original qualification retained a private source/binary/state snapshot.
Its captured account paths and service names are not portable instructions.
Current installations use immutable release selection and pinned runtime
upgrade rules; follow [Operations](operations.md#roll-back) and
[release selection](release-alignment-process.md). Never restore old state over
a running Manager or point an older Manager at incompatible forward-written
records. Resolve owned runtime identities before any stop.
