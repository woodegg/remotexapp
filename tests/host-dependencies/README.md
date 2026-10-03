# Ubuntu host compatibility tests

Portable dependency checks run inside `make check` through the App Package
Node test entry; independently run `python3 -I tests/host-dependencies/test_check.py`.
They cover selected package lists, GTK3 versus GTK4, actual Qt major detection,
missing imports/libraries/modules, command failures/timeouts, target-user
identity, renamed desktop templates, installed selectors and staging wiring.
The pidfd test creates and reaps only its own child; it requires Linux pidfd
support, including inside CI containers. No packages or services are installed.

## Explicit local live gate

```bash
make build
node tests/host-dependencies/run-mousepad-e2e.mjs
```

Requires the real Mousepad/Matchbox/IBus/X11 stack, systemd user manager, `xclip`
and Node 22. Uses a new loopback Manager on **21997**, separate package catalog,
state and isolated App HOMEs. Run serially with other live suites because X
display numbers are host-global. Never redirect this test to a deployed Manager.
It force-stops only Apps it created. Temporary diagnostic files are retained.

The test explicitly refreshes its Manager catalog after selecting a package,
proves a running runtime stays pinned, then upgrades through SDK Manager APIs
from 4.0.0 and 4.0.0-sandbox.ubuntu2604.1 to 4.0.1. Old-version sources are
declared **version-selection fixtures using current Driver scripts**, not
archived old release certification. Generation fencing and both X11 class
identities are tested using actual Unicode/multiline document readback, not
just transport ACK. The window's class is changed only in this disposable
runtime; this does not replace testing native Mousepad 0.7 on Ubuntu 26.04.
An unrelated Authentication class must reject text without changing the document.

Complement with the shipped-App [dynamic-state matrix](../session-services/README.md)
and real Viewer/clipboard suites. Target-user capability success on an already
provisioned 24.04 developer host is not pristine 24.04/26.04 acceptance.
See [the locked repair train](../../docs/ubuntu-host-compatibility-release.md)
for recorded failures, repaired results and remaining gates.
