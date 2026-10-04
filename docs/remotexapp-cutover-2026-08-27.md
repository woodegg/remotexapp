# RemoteXApp naming cutover — 2026-08-27

> Historical technical record. Dated status and validation statements describe
> their original scope; they do not identify a current deployment. See
> [current source versions](current-state.md). Host labels and runtime IDs in
> historical examples are anonymized.

## Outcome

The host now uses the formal product name `RemoteXApp` and machine identifier
`remotexapp` without naming aliases. The implementation change is commit
`8cd67bf8ecf0`. The supported host identity is:

| Surface | Identifier |
|---|---|
| User service | `remotexapp.service` |
| Manager binary | `remotexappd` |
| Status helper | `remotexapp-status` |
| Installed root | `~/.local/{libexec,share}/remotexapp` |
| Configuration | `~/.config/remotexapp/remotexapp.env` |
| Persistent state | `~/.local/state/remotexapp` |
| Socket runtime | `/run/user/$UID/remotexappd` |
| Viewer route | `/remotexapps/{instanceId}/kiosk.html` |
| Driver environment | `REMOTEXAPP_*` |
| SDK | `RemoteXAppManager`, `RemoteXAppClient`, `RemoteXAppElement` |
| Web Component | `<remote-x-app>` |

No alias is installed for a renamed binary, unit, route, SDK symbol, driver
environment variable, or filesystem path. Git history remains unchanged; the
current tree and deployment are the supported product surface.

## Display 2 migration

The previous manager was stopped with zero attached clients. Its managed
registration and persistent XFCE profile were copied into the new state root;
the runtime directory itself was not reused. `remotexapp.service` then created
managed runtime `xfce-desktop-EXAMPLE` on fixed display `:2` with:

- framebuffer `1280x720`, depth 16, 5 FPS, client resize disabled;
- loopback RFB `127.0.0.1:5902`;
- loopback instance gateway `127.0.0.1:39002`;
- XFCE, private D-Bus, IBus, Unicode engine, and Clipman started on attach;
- ten-second vacancy cleanup returning to server-only state.

The manager remains the explicitly authorized internal-test deployment on
`0.0.0.0:1991` with authentication disabled and internal diagnostics exposed.
This is not the secure public default in `deploy/examples/remotexapp.env`.

## Verification

- `make release-check` passed generated asset checks, 16 experiment-document
  checks, all Go and JavaScript tests, `go vet`, production builds, the race
  detector, and host preflight.
- `/api/version` reported the rename build and `/readyz` returned ready.
- The managed registry reported desired/observed running on display `:2` and
  used only `remotexapp-*` transient units and new state/socket paths.
- A real headless Edge/noVNC client connected through the public SDK. Fixed
  resize remained `1280x720`; disconnect/reconnect completed in about 91 ms.
- Committed Chinese and English text succeeded before and after reconnect.
  Server input time was about 2.1–2.5 ms and browser/server round trip about
  3.4–5.0 ms in that smoke test.
- With Mousepad focused, `中文切换后FirstKey` committed in 1.213 ms server time,
  the caret sequence advanced from 4 to 5, a second input subscriber received
  the cached sequence, and Ctrl+A/C produced an exact UTF-8 clipboard readback.
- After the browser detached, the XFCE/input session stopped and removed its
  input artifacts while VNC, gateway, and server anchor remained active.
- The renamed-away viewer route returned 404; the formal route returned its
  expected kiosk redirect.

## Post-cutover XFCE profile correction

A later attach exposed one migration defect in the persistent XFCE profile.
Its saved session still used absolute working-directory and discard-command
paths from the pre-cutover profile HOME. A mechanical identifier replacement
had turned them into a different nonexistent path. `xfce4-session` therefore
failed to launch `xfwm4`, `xfsettingsd`, `xfce4-panel`, `xfdesktop`, and the
power manager.

The failure was initially hidden by a stale `_NET_SUPPORTING_WM_CHECK` root
property on the persistent TigerVNC display. The driver now requires the EWMH
supporting-WM window to be live and to point back to itself before publishing
readiness. The seven saved XFCE session paths were migrated to the actual
profile root, and managed registration `example-managed-desktop` was stopped and
started through its API. It rebuilt runtime `xfce-desktop-EXAMPLE` on the
same fixed display `:2`.

A real Edge/noVNC client then verified the full desktop visually and confirmed
that `xfwm4`, `xfsettingsd`, `xfce4-panel`, `xfdesktop`, and exactly one
Clipman all belonged to the session cgroup. Both RFB and input channels were
connected, fixed resize remained `1280x720`, and explicit SDK reconnect took
about 75 ms. Two additional attach/vacancy generations then reproduced clean
startup and cleanup. The shared driver signal pattern was tightened so a
manager-initiated SIGTERM exits its transient session unit with status 0 and
leaves the manager-owned application snapshot at `stopped`, while an
unexpected cgroup disappearance is still classified by the manager as a
failure. Generation 3 ended with `Result=success`, `ExecMainStatus=0`, no RFB
or input connections, and the persistent server layer healthy. Mousepad and
Edge use the same clean-stop pattern; their class policy and launch commands
were not changed.

## Cleanup and recovery

Early POC displays `:23` through `:28`, their ports, old install trees, old
user-unit files, ignored runtime data, and project-generated Trash entries were
removed. The current source tree, process list, user-unit registry, live
install roots, and repository filenames have zero renamed identifier matches.

A pre-cutover recovery archive is retained at
`~/.local/state/remotexapp-migration/pre-rename-state-20260827T1645.tar.gz`.
It is not part of the live installation. Restoring it is a manual disaster
recovery operation, not a supported compatibility deployment.

## Post-cutover noVNC source governance

Browser assets no longer depend on the build host's Debian noVNC tree. The
repository vendors upstream noVNC `v1.7.0` at peeled tag commit
`63107bd06d9e1f6136ff21aeda8cd62cbf0d433e`; `UPSTREAM.json` also records the
downloaded commit archive SHA-256. Normal builds are offline with respect to
noVNC, and production still receives only the bundle embedded in
`remotexappd`.

The weekly GitHub release check opens a draft update pull request for newer
stable releases and explicitly dispatches CI; failures create a deduplicated
issue. Updates use `scripts/update-novnc.sh`, receive a source and
generated-asset review, pass `make check`, and then require the real
RFB/English/Chinese IME/resize/reconnect matrix in the operations runbook.
RemoteXApp's private keyboard dependency is isolated in the noVNC bundle entry
and guarded by `make novnc-check`; updates are not eligible for unattended
merge.

The initial `v1.7.0` upgrade is deployed from commit `cb473fc332b4`. GitHub CI,
the isolated Mousepad E2E gate and the production managed-XFCE browser smoke
passed. Production preserved fixed 1280x720 geometry, exact mixed Unicode
clipboard readback, pointer/wheel traffic, reconnect and session-only vacancy
cleanup. The machine-readable isolated and production results are
`tests/go-live-validation/results/novnc-1.7-{upgrade,production}.json`. Human
visual and interactive UAT was accepted by user confirmation on 2026-08-27,
completing the noVNC 1.7 adoption.

## Central deployment follow-up

The repository now includes a root-owned central installation path with two
strictly non-root runtime modes. Dedicated mode runs the system unit as the
locked `remotexapp` account with state in `/var/lib/remotexapp`. Real-user mode
runs one user unit per approved existing Unix account with state in that
user's `~/.local/state/remotexapp`. Both modes use shared immutable code under
`/usr/local/{libexec,share}/remotexapp`; neither mode contains a root manager,
`sudo`, `su`, or runtime UID switching.

The live service was subsequently migrated in central real-user mode under
the `tester` account from commit `0da7d0c24602`. Per operator direction, the old
`~/.local/{libexec,share}/remotexapp`, user-owned unit, and user-owned
environment file were removed without a migration backup; persistent state at
`~/.local/state/remotexapp` was retained. The enabled unit now resolves from
`/etc/systemd/user/remotexapp.service`, code is root-owned under `/usr/local`,
and configuration is administrator-owned under `/etc/remotexapp`.

Health/readiness, managed XFCE adoption, unauthenticated API rejection, fixed
1280x720 browser rendering, RFB/input connection, a 60.55 ms reconnect, and
vacancy cleanup passed. Machine-readable evidence is
`tests/go-live-validation/results/central-user-deployment.json`. The backend
now listens only on `127.0.0.1:1991`; configuring and validating the permanent
authenticated identity proxy remains an external deployment gate.
