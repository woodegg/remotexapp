# Kate/KWrite D-Bus control experiment

`probe.py` verifies two instances of each installed editor on a disposable X
display/private bus. It exercises real document content and the current status
helper without creating production templates or touching existing runtimes.
Dependencies: Kate, KWrite, Python 3, Xvfb/xauth, dbus-run-session, gdbus,
xdotool, xclip and a built RemoteXApp status helper with CONN-001. xclip is only
the small test-content readback tool, not a production Driver dependency.

Run from the repository root:

```sh
probe_root=$(mktemp -d)
install -d -m 700 "$probe_root/home" "$probe_root/runtime"
env HOME="$probe_root/home" XDG_CONFIG_HOME="$probe_root/home/config" \
  XDG_DATA_HOME="$probe_root/home/data" XDG_CACHE_HOME="$probe_root/home/cache" \
  XDG_RUNTIME_DIR="$probe_root/runtime" \
  KDE_PROBE_STATUS_HELPER="$PWD/bin/remotexapp-status" \
  xvfb-run -a -s '-screen 0 1280x720x16 -nolisten tcp' \
  dbus-run-session -- python3 tests/experiments/kde-control/probe.py
```

Set HOME/XDG **before starting the bus**, so D-Bus-activated KDE helpers also use
temporary data. The script prints its evidence directory and one result per
process, retaining introspection and private/public status files. It force-kills
only its own disposable editor processes in `finally`; the private X/bus exit
then terminates their helper connections. Do not run this against a real desktop.

2026-09-10 result: Kate and KWrite `4:23.08.5-0ubuntu3`, two instances each,
all passed. See [findings and boundaries](../../../docs/kate-kwrite-control-research.md).
Structured results: [v1 evidence](../../evidence/v1/kate-kwrite-control-research.json).
