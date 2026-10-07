# Operations runbook

Source versions are listed in [current-state.md](current-state.md). The
commands below use example accounts and loopback ports, not a captured
deployment. For a non-systemd host, use the [standalone/runit contract](standalone-runit-release.md)
and provision its delegated cgroup and account services before launch.

## Choose the runtime identity

Root installs immutable code, but no RemoteXApp process runs as root or changes
UID at runtime.

| Mode | Runtime | State | Use |
|---|---|---|---|
| Dedicated | system unit with `User=remotexapp` | `/var/lib/remotexapp` | Default production or shared managed profiles |
| Real user | one user unit in an existing account | `~/.local/state/remotexapp` | Applications need that user's actual file permissions and HOME |
| Local development | current user unit and checkout-built files | `~/.local/state/remotexapp` | Development only |

Run separate managers under separate UIDs for mutually untrusted tenants. The
manager API does not accept a target UID and neither service unit contains
`sudo` or `su`.

### Use the real account's desktop environment

For a dedicated existing account, the trusted `xfce-user-desktop` template can
use that account's passwd HOME and existing systemd user D-Bus. Register it as
one managed instance; do not launch it through `/api/instances`:

Registration is optional and explicit: choose a stable ID appropriate to this
deployment. `primary-desktop` below is an example, not an automatically created
or reserved fleet name. Read `/api/managed-instances` first; if the ID already
exists, inspect its template and desired state. Keep a matching registration;
resolve an incompatible registration with the operator. Do not delete/recreate
or rename an existing registration to make an installer succeed. A create
conflict does not authorize overwriting its profile or runtime.

```bash
curl -H 'Content-Type: application/json' \
  -H 'Cf-Access-Authenticated-User-Email: operator@example.com' \
  -d '{"id":"primary-desktop","templateId":"xfce-user-desktop","desiredState":"running"}' \
  http://127.0.0.1:1992/api/managed-instances
```

The manager must itself run as that Unix user, lingering/user D-Bus must be
available, and display `:1` plus ports 5901/39001 must be free. Stop or migrate
any existing VNC desktop owning those resources before starting the managed
instance. RemoteXApp uses `~/.Xauthority` so an SSH login can launch an X11
program with `DISPLAY=:1`; it updates only that display record, never deletes
the account HOME, and never owns or stops `/run/user/<uid>/bus`. A dedicated
`remotexapp` service account gets that account's HOME—not another user's.

### Manager readiness versus application readiness

`/healthz` and `/readyz` describe the Manager and its loaded catalog, not a
successful desktop login or a healthy session for every App. Their existing
API semantics are unchanged. Read the instance's `sessionState` and
`applicationStatus`; verify current-generation connection information when the
session is ready. With on-attach activation, a ready display server alone does
not mean the application has started. Use real input/readback and clipboard
checks for functional acceptance.

Failed Core startups identify a bounded stage in the existing error text
(D-Bus, IBus, Unicode engine, Driver or application readiness). The session unit
journal contains the internal diagnostic detail; the API deliberately does not
copy subprocess output, private paths or environment contents. A failed runtime
is retained for inspection and explicit recovery; a Manager restart is not a
host reboot or an instruction to replay failed Apps automatically.

## Build and centrally install

First use the [dependency guide](dependencies.md) to distinguish core must-haves,
per-App requirements and optional operational tools. The default full installer
checks all bundled App archives, not only Apps an operator plans to launch;
missing OS packages must be installed separately. The abbreviated list below
is not the complete dependency list for the shipped App catalog.

These are **installed component requirements**, not a requirement to prestart
a standalone desktop. RemoteXApp starts TigerVNC and the App driver starts its
session; a conflicting standalone VNC service should remain stopped/disabled.
Keep the systemd user manager and, for `user-home`, the existing user D-Bus
available. See [component versus service readiness](dependencies.md#installed-components-are-not-pre-running-desktop-services).

Prerequisites are the chosen lifecycle backend (systemd by default), TigerVNC (`Xtigervnc`), Xauth, Python
3, D-Bus, IBus, Matchbox (`matchbox-window-manager`), `jq`, `fuser`, X11/XTest
libraries, and the applications referenced by enabled drivers. On Ubuntu,
install `matchbox-window-manager`, `jq`, `libreoffice`, `python3-uno`, `psmisc`, and
`firefox-esr`; the shipped single-application templates use these packages.
Firefox ESR may require an administrator-approved package source that is not
enabled by a base Ubuntu installation. The build host also needs exact Go
1.27.1, Node 22, and `esbuild`; runtime hosts do not need Node, Go, or a system
noVNC package.

Build as an ordinary user. Then choose exactly one installation command:

```bash
make release-check

# Preferred: create/use the locked remotexapp account.
sudo ./scripts/install-system.sh --dedicated

# Alternative: deploy for an existing non-root Unix account.
sudo ./scripts/install-system.sh \
  --user alice --listen 127.0.0.1:1992
```

Add `--start` only after the configuration has been reviewed. The installer
places immutable releases under
`/usr/local/{libexec,share}/remotexapp/releases/<version>` and activates them
through `current` symlinks. It places administrator configuration under
`/etc/remotexapp`, and shared units under `/etc/systemd/{system,user}`. It
enables lingering for the selected account so its user manager and transient
instance units remain available without an interactive login.

Core releases and App Packages have independent selectors. The system
installer packages and installs the shipped Apps below
`/usr/local/share/remotexapp/apps/<id>/<driverVersion>` and activates them from
`/etc/remotexapp/apps-enabled`. A user install uses the equivalent `~/.local`
and `~/.config` paths. To add an ordinary trusted App after the core build:

```bash
scripts/package-app.sh apps/mousepad dist/apps
app_archive=dist/apps/mousepad-4.0.1.tar.gz
app_digest=$(sha256sum "$app_archive" | awk '{print $1}')
scripts/install-app.sh --archive "$app_archive" --sha256 "$app_digest" \
  --package-root "$HOME/.local/share/remotexapp/apps" \
  --enabled-root "$HOME/.config/remotexapp/apps-enabled"
systemctl --user restart remotexapp.service
```

Use `scripts/manage-app.sh --disable ID ...` to stop selecting an App for new
instances, or `--activate ID@VERSION ...` to roll its selector forward/back.
Neither command changes an existing runtime. For an explicitly retired shipped
ID, stop the manager and use `--retire ID --state-dir STATE_DIR ...`; retirement
fails while any durable runtime manifest or managed registration references the
ID. It removes only the enabled selector, never immutable package versions or
independently installed Apps. Retain every package version referenced under
`STATE_DIR/runtime-manifests/`.

Publishing does not restart the manager. Read
[`driver-version-lifecycle.md`](driver-version-lifecycle.md) before restarting
and [`runtime-manifest-design.md`](runtime-manifest-design.md) before upgrading.
A normal restart health-checks and adopts locked active runtimes, preserving
their application processes and unit PIDs. Browser connections briefly drop
and use SDK reconnection. Notify or drain users when explicitly stopping and
starting a runtime to apply a new driver, because that transition replaces the
application process.

The administrator-owned environment also controls graceful application
shutdown:

```text
REMOTEXAPP_SHUTDOWN_GRACE_TIMEOUT=15s
REMOTEXAPP_SHUTDOWN_BLOCKED_WARNING_AFTER=1h
REMOTEXAPP_SHUTDOWN_FORCE_AFTER=0
```

Zero force-after is the safe default and never discards work automatically. A
blocked cleanup retains the session for user reconnection and logs after the
warning deadline. Configure automatic force only on hosts where that data-loss
policy is explicitly accepted. The protocol, API force operation, and driver
contract are in [`graceful-shutdown.md`](graceful-shutdown.md).

The same environment can remove unused built-in web pages without disabling
downstream SDK integrations:

```text
REMOTEXAPP_DISABLE_CONSOLE=false
REMOTEXAPP_DISABLE_KIOSK=false
```

Console disablement covers `/`, `/sdk/console.html`, and
`/sdk/minimal.html`. Kiosk disablement removes the built-in instance viewer and
its advertised `viewerUrl`; `/sdk/index.js`, APIs, RFB/input WebSockets, and
instance health remain available. Defaults are `false` for upgrade
compatibility. Restart the manager after changing the environment file.

These four entry routes now use one versioned console bundle. `/` and the SDK
console select operator mode, the former minimal example selects launch mode,
and `/remotexapps/{id}/kiosk.html` selects viewer-only mode. The viewer mode
contains no runtime or service controls. Backend policy remains authoritative;
sharing a bundle does not share permissions.

### Optional user-service restart helper

Runtime restart and manager-service restart are different operations. The
console can restart one runtime through its durable manifest without changing
the selected App version. Manager-service restart is disabled by default and
is supported only for local or centrally installed user services using
authenticated `trusted-header` mode. It is unavailable for `auth-mode=none`
and the dedicated system unit hard-codes the capability off.

To opt in after configuring an authenticated same-origin reverse proxy:

```text
REMOTEXAPP_ENABLE_SERVICE_RESTART=true
```

Then start the independently supervised helper before restarting the manager:

```bash
systemctl --user enable --now remotexapp-operator.service
systemctl --user restart remotexapp.service
```

The helper socket is owner-only and accepts only restart of the exact
`remotexapp.service` user unit plus operation-status queries. It cannot run an
arbitrary command or select another unit. The manager refuses to start with
the feature enabled if the helper is unavailable. Leave the setting false on
an unauthenticated test listener.

File-launch templates accept documents only below configured server-side
roots. The default is the manager-owned `STATE_DIR/documents`. To use existing
storage, set a colon-separated list of absolute directories and ensure the
runtime account can traverse and read them:

```text
REMOTEXAPP_DOCUMENT_ROOTS=/srv/remotexapp-documents:/mnt/approved-documents
```

Unavailable directories (including disconnected remote storage/remote storage mounts) do
not prevent Manager startup. The journal records `ERROR document root unavailable`
or a check timeout, and the configured allowlist stays intact. Actual file
requests still fail if the file/root is unavailable or outside that allowlist;
storage becoming accessible is picked up on the next request without a restart.
No fallback directory is substituted. Bad configuration, such as relative roots,
still prevents startup. These checks do not distinguish an intentionally empty
directory from an unmounted filesystem, and are not filesystem isolation.

For example, launch LibreOffice with the canonical server path:

```bash
curl -H 'Content-Type: application/json' \
  -d '{"templateId":"libreoffice","parameters":{"filePath":"/srv/remotexapp-documents/report.odt"}}' \
  http://127.0.0.1:1991/api/instances
```

The response's `resources.control.port` is a loopback-only LibreOffice UNO
port for trusted same-host automation. Never proxy it directly: UNO is a privileged
application-control interface without its own RemoteXApp authentication.
LibreOffice starts immediately, so the create request returns only after the
requested document is visible and UNO-ready; allow at least the manager's
normal application-start deadline. Its normal stop is intentionally
destructive and discards unsaved changes. Save explicitly through UNO before
stopping when edits must persist.

Launch the persistent shared Firefox workaround through the anonymous API:

```bash
curl -H 'Content-Type: application/json' \
  -d '{"templateId":"firefox-esr","parameters":{"startUrl":"https://example.com"}}' \
  http://127.0.0.1:1991/api/instances
```

Use no lifecycle overrides for the supported default behavior. The create
starts only the dynamic server; first RFB attachment starts Firefox. Six hours
after the last detach, `stop-instance` removes the runtime but preserves
`profiles/firefox-esr/default`. A later create returns a new runtime ID and
reuses the browser profile. Concurrent clients share the browser, cookies, and
authenticated state, so this is only for mutually trusted collaborators.

The create response contains the generic `resources.control` allocation. The
listener appears only after the first attachment starts Firefox and is ready
only when current-generation application status is `ready`; the package-owned
status control object supplies its BiDi WebSocket URL. Connect from trusted
same-host automation and never add a reverse-proxy location for the BiDi port
because Firefox does not authenticate it.

Only one BiDi session can own Firefox. A controller must complete
`session.end` before disconnecting. If a crashed controller leaves
`session.status.ready` false and no controller owns the session, use the normal
instance stop API and create a replacement. This clears the native Firefox
session and preserves the shared browser profile; do not expose or kill the
listener independently.

For a same-origin mount such as `/tools/remotexapp/`, strip the prefix before
forwarding. The trailing slash on `proxy_pass` is significant:

```nginx
location /tools/remotexapp/ {
    proxy_pass http://127.0.0.1:1991/;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

The SDK derives `/tools/remotexapp` from its module URL, so no application
`baseURL` setting or forwarded-prefix header is required. The authenticated
proxy must still remove client-supplied identity headers and inject its trusted
identity as described below.

The first unified-manifest upgrade needs only a manager restart. It converts
complete embedded managed runtime snapshots, stops pre-manifest anonymous
units, removes their runtime directories, preserves profiles, and then performs
normal manifest restoration and template autostart.

The dedicated service reads `/etc/remotexapp/remotexapp.env`. A real-user
service reads that global file and then the administrator-owned override
`/etc/remotexapp/users/<user>.env`. The installer creates the override with the
explicit loopback listen address and never overwrites an existing override.
These environment files are not a secret store.

The secure default accepts the configured identity header only from a
loopback reverse proxy. The proxy must overwrite, not pass through, that
header. After review, start dedicated mode with:

```bash
sudo systemctl enable --now remotexapp.service
```

For real-user mode, either pass `--start` during installation or log in as that
user and run:

```bash
systemctl --user enable --now remotexapp.service
```

Every real-user manager needs a unique `REMOTEXAPP_LISTEN`. On a multi-user
host, use only dynamic-display classes or set
`REMOTEXAPP_CLASS_CONFIG=/etc/remotexapp/users/<user>/classes` in each override
and assign non-overlapping fixed displays, RFB ports, and gateway ports. The
shipped fixed `xfce-user-desktop` App can be active in only one manager on a
host with the default allocation because its display and internal ports are fixed.
For a separate approved Manager, configure a coherent nonconflicting
administrator-owned site allocation before creating the runtime.

For a checkout-local development installation, retain the existing workflow:

```bash
make install-user
editor ~/.config/remotexapp/remotexapp.env
systemctl --user enable --now remotexapp.service
```

### Select or roll back an installed core release

When the same formal release must reach several approved endpoints, use the
[formal release alignment process](release-alignment-process.md) around this
per-host selector procedure.

For a centrally installed dedicated or real-user manager, preinstall both
immutable releases, stop every paired host application, and select the
retained core with the repository-owned selector. It stops the manager before
changing both `current` links and automatically restores the previous links and
service state when startup or the optional version/commit check fails:

```bash
# Build or unpack the reviewed candidate, then publish it without activation.
sudo scripts/stage-system-release.sh

# Run this selection only inside the stopped-consumer paired transition.
release_version="$(cat VERSION)"
release_commit=FULL_COMMIT_FROM_VERIFIED_RELEASE
sudo scripts/select-system-release.sh --user alice "$release_version" --start \
  --health-url http://127.0.0.1:1991 --expected-commit "$release_commit"
```

Use `--dedicated` instead of `--user NAME` for the locked `remotexapp` account.
The stager preserves administrator configuration, units, service state, core
selectors, and enabled App selectors. It rejects changed bytes under an
existing version. The selector never installs, modifies, or removes a release
or App Package.
Restart paired consumers only after RemoteXApp reports the expected exact
version and commit.

`--health-url` is mandatory whenever the selector starts the manager, including
when the manager was active before selection. The selector verifies the target
and, after any failed activation, verifies the restored previous version before
returning. The default health timeout is 120 seconds so locked runtime recovery
can complete; use `--health-timeout SECONDS` only for an explicit 1–600 second
target budget. This protects selector consistency; it does not translate
persistent state between incompatible major schemas.

Before a breaking major activation, stop new work and capture the exact
operator-defined root/Home state snapshot required by the paired deployment.
To downgrade, stop the consumer and manager, restore that pre-upgrade snapshot,
then select and verify the older core before restoring the older consumer. Do
not start an older manager on state already written by a newer incompatible
schema. Snapshot rollback discards state created after the snapshot, so define
the rollback window and obtain UAT before accepting new production work.

## Verify

Use `systemctl`/`journalctl` for dedicated mode and add `--user` for real-user
or local mode:

```bash
curl -fsS http://127.0.0.1:1991/healthz
curl -fsS http://127.0.0.1:1991/readyz
sudo systemctl --no-pager status remotexapp.service
sudo journalctl -u remotexapp.service --since -10m
```

Through the identity proxy, verify `/api/version`, class listing, managed and
temporary launch, attach, Unicode input, Chinese/English switching and the
first character after switching, shortcuts, mouse buttons, resize policy,
reconnect, vacancy cleanup, intentional XFCE logout, and manager restart
adoption with stable runtime IDs, unit PIDs, and session generation. Inject one
component failure and verify same-ID recovery uses the locked snapshot. For driver `1.5.0`,
also verify native close, an unsaved-document
block, reconnect/cancel, explicit force, and the early idle action. Verify the
same API without identity returns 401.

For RemoteXApp 0.4 clipboard validation, use the Unified Console through the
authenticated HTTPS origin. Local UAT may use `http://localhost:1991`; binding
the service to `0.0.0.0` does not make `http://host:1991` a secure browser
context. Connect a Viewer, explicitly select each direction's mode, and click
the Local→remote or Remote→local button to trigger any browser permission
request. Focus/visibility changes intentionally never trigger a new prompt.
Verify plain text, HTML with plain fallback, RTF, PNG, multiple Viewers,
view-only receipt, reconnect recovery, permission denial/degradation, and
session-generation cleanup. Clipboard bodies or previews must not appear in
the manager/gateway journals, status, manifests, diagnostics, or browser
storage.

For `xfce-user-desktop`, additionally verify the launched process HOME matches
passwd (internal paths stay redacted from the normal API), the session bus
address is `/run/user/<uid>/bus`, existing user services remain
alive after logout/stop, IBus/Unicode generation processes are removed, HOME
files persist, `DISPLAY=:1` works from a plain SSH login without an explicit
Xauthority path, unrelated Xauthority records survive, `purge=true` is
rejected, and reconnect starts a new XFCE generation. This real-account UAT is
mandatory before production adoption.

## Migrate an existing local user deployment

The lowest-risk migration keeps the same Unix identity and selects central
real-user mode. Stop the local service, preserve its state/configuration, and
move its user-owned `~/.config/systemd/user/remotexapp.service` and any drop-ins
to a backup outside the user unit search path. The central installer refuses
`--user` mode while those files exist because they would silently shadow the
root-owned unit. Translate the existing environment settings into
`/etc/remotexapp/remotexapp.env` or the root-owned per-user override, install
without `--start`, inspect `systemctl --user cat remotexapp.service`, and then
start and repeat the full verification matrix.

Changing from a real UID to the dedicated `remotexapp` UID is a data migration,
not an in-place unit change. Prefer a fresh dedicated state root and recreate
managed registrations. Persistent profiles copied between UIDs require
careful ownership changes, and XFCE session files may contain absolute HOME
paths. Do not automate or deploy that migration without a backup, restore test,
and human UAT.

## Upgrade

1. Preserve the state directory and `/etc/remotexapp`. Confirm clients permit
   automatic reconnect before restarting the manager.
2. Bump `VERSION`, run `make release-check`, then repeat the applicable central
   installer command without `--start`. The installer publishes an immutable
   side-by-side release and moves `current`; it does not restart the manager.
3. Restart the dedicated system service or each affected user service. The
   manager adopts complete healthy manifests on their locked drivers; the first
   unified-manifest restart also performs the legacy migration described above.
4. Confirm health, readiness, version, applied/available driver versions,
   stable runtime/unit identities, automatic browser reconnect, and a real
   application session. An adoption failure without a live application must
   recover from the locked manifest, not the newly loaded catalog; a live
   session remains subject to graceful host policy.
5. Notify or drain users for each runtime that must adopt the new driver, then
   perform its explicit stop/start transition and repeat application E2E/UAT.

### noVNC upstream update

The weekly `Update noVNC upstream` workflow opens a draft pull request when
GitHub's latest stable release differs from
`third_party/novnc/UPSTREAM.json`. It commits the vendored and generated assets
and explicitly dispatches CI. An import or PR failure creates a deduplicated
issue. To run the process manually on a dedicated branch:

```bash
./scripts/update-novnc.sh 1.7.1
make check
```

The importer resolves the release tag to its peeled 40-character commit,
downloads that commit archive, rejects unsafe archive paths, validates the
package version, retains the complete `core/` and `vendor/` graphs and license
texts, records the archive SHA-256, and regenerates embedded assets. Never
fetch noVNC during a normal build or production startup.

An update pull request must contain the vendored source/provenance change and
the generated asset change. Review upstream release notes, private-adapter
compatibility, license changes, bundle-size change, and the asset manifest.
The automated `make check` gate covers imports and the private keyboard
contract. Before merge, run the existing real browser stack and verify RFB
connect/render, pointer and wheel, shortcuts and modifier release, English and
Chinese IME first-character input, resize policy, disconnect/reconnect, and
vacancy cleanup. Do not auto-merge noVNC updates.

## Roll back

Stop the affected service, repoint both central `current` symlinks to the same
retained older release, and restart. App Package locations are supplied through
environment variables so the installed unit remains compatible with retained
pre-V1 binaries, which safely ignore those variables. Compatible healthy manifests keep their
locked processes; explicitly stop/start only runtimes that must move to the
rollback catalog. Never copy an older release over a newer directory, and do
not downgrade or delete state unless release notes explicitly document a
compatible state migration.
The checkout-local development installer retains its separate backup workflow.

## Failure handling

- `healthz` failure: inspect the manager journal and dependency paths.
- `readyz` failure: validate the class catalog and driver files.
- Instance `failed`: inspect its four transient user units shown only when the
  manager is deliberately started with `-expose-internals`.
- Input fails while video works: inspect session-owned IBus/socket readiness;
  do not add a second D-Bus to the persistent server layer.
- Fixed display conflict: stop the stale owning unit after resolving its exact
  identity; never kill all X/VNC processes indiscriminately.

Example backend target: `http://127.0.0.1:1991/`. Direct non-health requests
return 401; publish it only through the authenticated identity proxy.
