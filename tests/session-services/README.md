# Core session-services dynamic-state validation

These are explicit local live gates, not portable unit tests. They require
systemd user services, X11/TigerVNC, D-Bus/IBus, all selected real applications,
Node 22 and passwordless sudo to create a locked temporary account. Never run
them on a production gateway. Do not point them at an existing Manager.

## Seven-App state matrix

```sh
bash tests/session-services/run-state-matrix.sh /absolute/extracted/release
# Separate real input/clipboard/exit and cross-runtime interaction matrix:
bash tests/session-services/run-state-matrix.sh /absolute/extracted/release all interaction
# Gateway/VNC failure, live-App preservation and explicit recovery:
bash tests/session-services/run-state-matrix.sh /absolute/extracted/release all transport
# Managed comparison: test-only stop-session policy makes shared Edge eligible.
bash tests/session-services/run-state-matrix.sh /absolute/extracted/release edge managed-transport
# Timeout/failed hooks, Manager crash and unchanged enforcement deadlines:
bash tests/session-services/run-state-matrix.sh /absolute/extracted/release all shutdown-outcomes
# Temporarily pause/resume only the disposable account bus (not the build user's):
bash tests/session-services/run-state-matrix.sh /absolute/extracted/release xfce-user-desktop borrowed-bus
# Narrow harness check before the full run:
bash tests/session-services/run-state-matrix.sh /absolute/extracted/release mousepad
```

The wrapper creates a disposable UID/HOME/account bus and Manager on loopback
21996. XFCE's fixed display is relocated to a verified free display (90–99).
The build user's desktop, local 1991/2992, sandboxes and existing account buses
are not fault-injection targets. Suites run serially because X display numbers
are host-global even with different UIDs/Manager ports.

The actual shipped App scripts run behind declared **test-only** startup and
shutdown barriers. Package patch versions and an inert Core helper marker
provide selectable new-architecture upgrade targets. These are instrumented
real-App tests, not a claim of byte-identical App Package testing; the earlier
exact-archive suites remain required.

| Axis | Assertions |
|---|---|
| Startup | No premature connections; actions/clipboard fenced; Manager SIGKILL resumes the same supervisor/generation |
| Running | Status, versions, connections, canonical environment, actions and clipboard metadata agree |
| Manager TERM/KILL | Supervisor/Driver/services and descriptor identity survive without replacement |
| Restart | Three concurrent requests produce one replacement; ordinary restart retains pins; stale generations rejected |
| Upgrade | App plus Core target selected explicitly; three concurrent requests produce one upgrade; old process identities gone |
| Interrupted upgrade | SIGKILL during real stopping/launching barriers; bounded original startup should be adopted, not replaced; on-attach Apps test first attachment after upgrade completes |
| IBus/engine loss | No App restart; degraded API behavior; Manager-crash adoption; explicit restart restores services |
| Blocked shutdown | Real App/services remain alive; injected refusing hook; API fences; Manager crash retains host force deadline |
| Private D-Bus loss | Distinguish App self-exit from surviving App; no silent bus replacement; cleanup/recovery |
| Supervisor loss | Complete owned cleanup; truthful failed-state APIs; Manager restart cannot resurrect stale identities |
| Offline failure | Kill supervisor while Manager is offline; preserve failure/generation; Viewer reconnect cannot relaunch; explicit restart recovers |
| Borrowed bus | User bus identity unchanged throughout; never kill the build user's account bus |

Every stable-state row records HTTP status outcomes for the applicable APIs.
Unsupported actions are expected 404, unavailable/stale operations 409, and
ready information 200. Starting reads protected by the lifecycle lock may wait
for completion; the test checks they do not publish early readiness.

The interaction run adds a second real Mousepad runtime, text/HTML clipboard
round-trips before/during/after input service faults, actual input-WebSocket
error acknowledgements, natural App exit/logout while API readers race, and
XFCE relogin. Process identities and a working second runtime's clipboard
prove independence. This is not a substitute for the existing real RFB Viewer
pixel/raw-key/native-IME tests.

The transport run kills only the temporary UID's validated gateway/VNC MainPID.
It checks clipboard unavailability, live-App preservation across Manager loss,
explicit gateway recovery, display-loss cleanup, fresh launch and unchanged
borrowed account bus. Do not interpret a working connection descriptor as proof
that a dead transport can render a Viewer.

`managed-transport` changes the test package's vacancy action to `stop-session`
to satisfy managed registration rules. Use it for shared/user-home Apps, not
ephemeral Mousepad/LibreOffice/KDE templates. A refusing shutdown marker checks
that transport repair does not bypass App policy; after replacement it probes
the old generation to detect reused-generation acceptance.

Evidence is retained in `/var/tmp/remotexapp-svc-matrix.*/evidence/result.json`
before removing only the temporary account/HOME. Failures remain recorded;
test setup fixes and product fixes must be distinguished in the release report.

## Real XFCE Viewer gate

`tests/app-package/run-user-home-connections.sh /absolute/extracted/release`
uses another locked disposable UID and relocated fixed display. In addition to
bus/control, Xfconf, Thunar, logout/relogin and restart checks, it starts a real
headless Chrome Viewer and a disposable Mousepad window inside XFCE. It verifies
the fixed 1280×720 framebuffer, Viewer reconnect, and served-SDK Unicode plus
actual clipboard readback before/after Manager restart, preserving service
identities. It also enables SaveOnExit only in the temporary HOME, launches an
actual XSMP-aware XFCE Terminal with a Mousepad document, logs out **without
`--fast`**, and requires XFCE to restore that command/window without a test-side
relaunch. It verifies document content, the restored App's current generation
and input environment, exactly one owned IBus/Unicode engine, unchanged borrowed
account bus, and real Viewer input/readback across a subsequent Manager restart.
Mousepad's independent crash-backup restoration is disabled only in this fixture
so the earlier intentionally terminated test editor cannot obscure this check.

Requires Chrome, Mousepad, **xfce4-terminal** and xclip as test tools. The wrapper
and runner require a fresh disposable UID/HOME; the real build user's desktop
is not used. `served-viewer.json`, `saved-session.json` and
`saved-session-viewer.json` are retained under the wrapper's `evidence/` directory
before temporary HOME/account removal, including completed subchecks if a later
check fails. Native-IME human UAT is still separate. During injected IBus exit a
fail-closed identity-race 409 is recorded, not treated as a ready descriptor:
within five seconds the API must expose `ibus: not-running`, omit the address
and retain the running App/generation. Permanent 409 or App replacement fails.

## Limits of the claim

No finite test can exhaust every timing/interleaving. Report executed state
transitions and invariants, not "all possible combinations passed". This matrix
supplements (does not replace) existing real Viewer/IME/clipboard/document,
natural exit/logout, interrupted-upgrade recovery, cutover and unit/race tests.
An RFB activation socket here is not a fully rendered Viewer. The test-only
refusing hook is not proof of every App's unsaved-document dialog. Six-hour and
48-hour policies are not measured by waiting those full durations here.
