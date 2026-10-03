# P08 direct Xtigervnc launcher experiment

This experiment compares the existing `tigervncserver` Perl wrapper with a
candidate in which systemd directly supervises `Xtigervnc` and a second bound
unit owns the class server driver.

## Controlled change

Both paths use the same accepted P01/P03 no-Clipman class, P05 gateway, P07
manager assets, 1280x720 depth 16, 15-fps cap, dynamic display allocation and
no attached application session during resource sampling.

The manager flag is the only selector:

```text
-vnc-launcher direct    # accepted repository default
-vnc-launcher wrapper   # explicit compatibility fallback
```

Wrapper topology:

```text
VNC unit (RemainAfterExit)
  -> resident tigervncserver Perl child
     -> Xtigervnc
     -> server driver and its private D-Bus/IBus tree
```

Direct topology:

```text
VNC unit: Xtigervnc is MainPID
server unit: class driver; BindsTo/After VNC unit
gateway/session units: BindsTo VNC unit
```

Direct mode creates a random 128-bit MIT-MAGIC-COOKIE in the instance's
mode-0600 `.Xauthority` before starting `Xtigervnc`. The manager API reports the
additional `serverUnit`. Normal stop order is session, gateway, server, VNC.

## Automated result, 2026-08-27

Five independent instances per mode were sampled two seconds after
server-ready. Direct mode's memory is the sum of its VNC and server-driver
cgroups so it is comparable with the wrapper's combined VNC cgroup.

| Median | Wrapper | Direct | Change |
|---|---:|---:|---:|
| Create to server-ready | 596 ms | 538 ms | -9.7% |
| Server-layer MemoryCurrent | 42,831,872 B | 32,141,312 B | -25.0% |
| Server-layer total PSS | 48,305 KiB | 37,438 KiB | -22.5% |
| Tasks | 24 | 22 | -8.3% |
| `tigervncserver` PSS | 5,280 KiB | 0 | removed |

Do not attribute the entire 10.6-MiB PSS difference to Perl: the measured
total also includes variation in the freshly started X/IBus process set. The
controlled total is the decision metric.

The direct real-stack check passed:

- mode-0600 Xauthority and authenticated local `xdpyinfo`;
- loopback RFB and gateway health;
- Mousepad launch and client-driven resize;
- exact `P08 中文 input reconnect OK` application clipboard readback;
- explicit SDK disconnect/reconnect in 59.1 ms with both channels restored;
- server text acknowledgements of 2.782 ms and 0.807 ms; and
- source-level wrapper compatibility smoke test on a second manager.

The first cold text attempt was intentionally retained as a readiness lesson:
RFB/input were connected before Mousepad owned X11/IBus focus, so the gateway
correctly rejected it with `no focused X11 application class`. The harness now
waits for a focused/enabled cursor event; it does not weaken the focus policy.

In a scoped crash test, killing only the candidate `Xtigervnc` MainPID made the
VNC unit fail and automatically deactivated the bound gateway, application
session and server-driver units. An API stop then left all four units inactive
and removed the ephemeral HOME, runtime and socket path. The manager's in-memory
instance snapshot remained stale until that explicit stop because unit-event
subscription is not implemented; that pre-existing lifecycle-observation gap
is outside P08.

The user completed the isolated manual keyboard, IME switching,
first-character, shortcut, pointer, resize and refresh/reconnect matrix and
reported that it worked. Final counters showed seven RFB and seven input
connections; the journal recorded 46 completed text requests, zero text errors
and zero `client event:` traces. P08 is accepted and `direct` is the repository
default. A final build started a real server-ready instance without passing the
launcher flag and confirmed `Xtigervnc` as the running VNC MainPID plus a
non-empty bound `serverUnit`. The live port-1991 process was not restarted and therefore retains its
older compiled launcher until deliberate deployment.

Machine-readable samples are in
[`results-2026-08-27.json`](results-2026-08-27.json).
