# RemoteXApp

This public repository begins with a reviewed source snapshot. Earlier
operational issues and release artifacts remain in a private archive; see the
[historical-record note](docs/private-history.md). Public releases from this
repository will appear on its Releases page.

```text
       LOCAL                               REMOTE
   .------------.       .  *  .       .------------.
   |  >_        |  === (  X  ) ===>   |  [ app ]   |
   |   you :)   |       '  *  '       |   agent :] |
   '-----++-----'                     '-----++-----'
      ___||___                           ___||___

                    R e m o t e X A p p
             Your apps are far. Your IME isn't.
```

## Remote Linux desktops and apps, built for humans and AI agents

Connect from your browser to a full Linux desktop or just one application
running on a **VPS, a container, or a physical machine**. RemoteXApp manages the
X11 runtime and gives your product an embeddable viewer, local IME integration,
rich bidirectional clipboard, and application lifecycle and control APIs.
**Audio integration is work in progress, not a shipped feature.**

Use it as a foundational building block for an **AI-agent sandbox fabric**:
agents can launch and inspect applications, while people can see and interact
with those same runtimes through a browser. Bring your own sandbox provisioning,
tenant isolation, identity, and agent orchestration.

```text
       .----------.              .----------.
       |  o    o  |              |  []  []  |
       |    __    |   RemoteXApp  |   ====   |
       '----||----'  <========>  '----||----'
         ___||___                  ___||___
           HUMAN                     AGENT

             Same app. Different life goals.
```

## Why developers use RemoteXApp

- **Bring your local IME to remote apps.** Compose Chinese, Japanese and other
  text with your familiar local input method instead of switching to a remote
  input-method UI. This goes beyond forwarding individual keyboard events:
  browser IME composition and Unicode text use the IBus integration;
  ordinary ASCII keys and shortcuts use RFB.
  Text injection does not overwrite the clipboard. Password fields and other
  direct-keyboard-only controls need keyboard input, not `sendText()`.
- **Clipboard that follows your workflow.** With prompt sync enabled,
  RemoteXApp automatically detects clipboard changes and offers synchronization
  directly in the viewer, with content type, size and previews before approval.
  No separate clipboard panel or manually copying text through an intermediate
  box. Exchange plain text, HTML, RTF and PNG images in either direction.
  Manual synchronization is also available. Automatic detection is opt-in and
  subject to browser permissions and focus; prompt mode still requires your
  confirmation, and unrestricted background clipboard access is not guaranteed.
- **Embed the experience.** Use the JavaScript SDK in your own web application,
  or use the supplied multi-window Console to launch apps and inspect status,
  connection information and declared actions.
- **Give agents structured control.** `getConnections()` exposes runtime and
  application control descriptors for trusted local tools: CDP for Edge, BiDi
  for Firefox, UNO for LibreOffice, and D-Bus for supported editors. Declared
  actions such as browser `openUrl` are callable through the SDK without making
  the browser connect directly to host-local control sockets.
- **Plugin-style App templates.** Add applications through versioned App
  Packages containing templates and drivers, without rebuilding the Manager.
  Configure sharing, profiles and idle shutdown. Activate a package and restart
  the Manager to load the catalog; this is not in-process plugin hot-loading.
  Existing runtimes keep their package pins until explicitly upgraded.
- **Upgrade the Manager while apps keep running.** Compatible Manager upgrades
  can adopt existing runtimes after a brief service restart, minimizing downtime
  without restarting the applications. API access and viewer connections may
  briefly interrupt; the SDK can reconnect. This is not a zero-downtime guarantee
  or an automatic runtime upgrade: updating pinned runtime components requires
  an explicit [upgrade and restart](docs/runtime-upgrade-api.md).
- **Cloudflare Tunnel-friendly WebSockets.** Browser display and input channels
  use WebSockets through the HTTP gateway, fitting an authenticated HTTPS tunnel
  without exposing VNC or application control ports. RFB WebSocket heartbeats
  and SDK reconnection help handle idle connections and interruptions.
  [Cloudflare supports WebSockets](https://developers.cloudflare.com/network/websockets/),
  but proxy/tunnel restarts can still disconnect them; configure authentication
  and WebSocket forwarding correctly.

RemoteXApp builds on TigerVNC and noVNC; it does not replace their display
transport. Its focus is integrating interactive application runtimes into
developer products. See the [research-backed positioning](docs/project-positioning.md)
for the comparison with noVNC and Xpra, and the
[current component versions](docs/current-state.md) for release identity.

## Choose a desktop or an app

```text
       _________________________________
      /  RemoteXApp Express            /|
     /________________________________/ |
     |                                | |
     |  [ desktop ]  [ browser ]      | |
     |  [ editor  ]  [ tiny robot ]   | /
     |________________________________|/
          O                      O
       ~~                          ~~

       We deliver apps, not screenshots.
       Clipboard included. Audio loading... (WIP)
```

| App Package | Typical use | Integration |
|---|---|---|
| `xfce-user-desktop` | A full desktop using the deployment account's HOME | User-session D-Bus and runtime connection information |
| `firefox-esr` | Shared browser with persistent profile; stops after six detached hours | WebDriver BiDi and `openUrl` |
| `edge` | Shared browser with persistent profile; stops after six detached hours | CDP and `openUrl` |
| `lightview` | Low-memory shared WebKit view with persistent profile; stops after six detached hours | Private same-UID Unix JSON control and `openUrl` |
| `libreoffice` | Temporary office session; optional authorized server-side `filePath` | UNO control |
| `mousepad` | Temporary text editor; optional `filePath` | Runtime connection information |
| `kate`, `kwrite` | Two independent editor templates; optional `filePath` | Application D-Bus control |

Temporary document/editor Apps stop without saving: save explicitly before
stopping when changes must persist. Control addresses are host-local metadata
for trusted automation, not public browser endpoints.

## Deployment boundary

The server targets Linux X11 environments with the required host services;
containers must provide those prerequisites, not just an arbitrary minimal
Docker image. RemoteXApp launches and manages its own runtimes; this is not a
promise to take over any existing desktop session. See the
[must-have and optional dependencies](docs/dependencies.md).

Run under a dedicated non-root account or one independent Manager per approved
Unix user. A Manager never switches identity. Isolated HOME/profile settings
are **not an OS security sandbox**: mutually untrusted tenants need separate
Linux UIDs or containers. Publish through authenticated TLS; keep internal
display and control endpoints private.

## Embed an app

With a configured Manager and the Mousepad App installed, serve your page behind
the same authenticated origin and import the release-matched SDK:

```html
<div id="app" style="height: 720px"></div>
<script type="module">
  import { RemoteXAppManager, RemoteXAppClient } from '/sdk/index.js';

  const manager = new RemoteXAppManager();
  const instance = await manager.createInstance({ templateId: 'mousepad' });
  const client = new RemoteXAppClient({ manager, instance, container: '#app' });
  await client.connect();
</script>
```

See the [integration guide](docs/integration-guide.md) for reverse-proxy subpaths
and the [SDK reference](docs/browser-sdk.md) for lifecycle and clipboard APIs.
Clipboard synchronization is opt-in; this example only connects the viewer.

## Start here

- [Dependencies: must-have, per-App requirements and optional tools](docs/dependencies.md)
- [Production handover](docs/production-handover.md)
- [Downstream integration](docs/integration-guide.md)
- [Release policy and process](docs/release-policy.md)
- [Development and test quality process](docs/development-quality-process.md)
- [Generated current repository state](docs/current-state.md)
- [0.2.0 stable release train](docs/stable-0.2.0-release.md)
- [0.3.0 stable template catalog release](docs/template-catalog-0.3.0-release.md)
- [0.4.0 stable rich clipboard release](docs/rich-clipboard-requirement.md)
- [0.5.0 stable client-active clipboard release](docs/client-active-clipboard-release.md)
- [0.5.1 stable clipboard prompt reliability release](docs/clipboard-prompt-reliability-release.md)
- [Formal release alignment process](docs/release-alignment-process.md)
- [Commercial readiness and trust boundary](docs/commercial-readiness.md)
- [Operations runbook](docs/operations.md)
- [Driver version and immutable release design](docs/driver-version-lifecycle.md)
- [App Package ABI v1 release train](docs/app-package-major-release.md)
- [WAOS migration for App Package ABI v1](docs/waos-app-package-migration.md)
- [WAOS runtime Coordinator migration](docs/waos-runtime-coordinator-migration.md)
- [Unified operator console release train](docs/unified-operator-console-release.md)
- [Graceful application shutdown](docs/graceful-shutdown.md)
- [Product requirements](docs/requirements.md)
- [Design decision log](docs/design-log.md)
- [Changelog](CHANGELOG.md)
- [RemoteXApp naming cutover](docs/remotexapp-cutover-2026-08-27.md)
- [Backend structure](docs/backend-structure.md)
- [Browser SDK](docs/browser-sdk.md)
- [noVNC upstream dependency](docs/novnc-upstream.md)
- [Driver development](drivers/README.md)
- [Security policy](SECURITY.md)

Obsolete WebRTC, FFmpeg, raw WebSocket, and browser A/B prototypes were removed
from the release branch in rc.13. They remain recoverable from Git history and
are not built, installed, or served by the current product.

## Product identifiers

This release uses one name consistently: `RemoteXApp` for the product and
`remotexapp` for machine-facing identifiers. The daemon is `remotexappd`, both
the dedicated system unit and per-user unit are named `remotexapp.service` in
their respective service managers, instance viewer routes start with
`/remotexapps/`, and the browser SDK exports `RemoteXAppManager`,
`RemoteXAppClient`, and `RemoteXAppElement`. No renamed-route, binary, unit,
environment-variable, or SDK aliases are shipped.

## Build and verify

Before installing, read the [dependency guide](docs/dependencies.md). TigerVNC,
D-Bus/IBus and the selected applications are host-installed dependencies; noVNC
is bundled. The default full installer validates **all shipped Apps** and does
not automatically install missing OS packages. Go/Node/build tools are needed
on build hosts, not hosts using the release binaries.

```bash
make check
make build
make package-release
make release-check
```

`make check` runs confidentiality, metadata/evidence, Go and JavaScript,
generated-asset, vendored noVNC, tracked-shell, workflow, and `go vet` checks.
The build host needs exact Go 1.26.8, Node 22, and `esbuild`; no system noVNC
package is required. Pull-request CI adds coverage and vulnerability gates.
`make release-check` also runs race, immutable staging, synthetic ABI, and real
shipped-App E2E. Live X11 verification requires user systemd, TigerVNC, X11,
IBus, and a browser; see the operations runbook.

`make package-release` creates a reproducible Linux archive and checksum under
`dist/`. Formal publication uses the build-once candidate flow in the
[release process](docs/release-process.md). Downstream browser applications should use the manager's stable,
same-origin `/sdk/index.js`; the SDK is not published as an independent npm
package. See the integration guide for the supported public boundary.

Shipped Apps are independently packaged and activated with:

```bash
make app-catalog
scripts/package-app.sh apps/mousepad dist/apps
archive=dist/apps/mousepad-3.0.0.tar.gz
digest=$(sha256sum "$archive" | awk '{print $1}')
scripts/install-app.sh --archive "$archive" --sha256 "$digest" \
  --package-root "$HOME/.local/share/remotexapp/apps" \
  --enabled-root "$HOME/.config/remotexapp/apps-enabled"
```

`scripts/manage-app.sh` activates, disables, or validates an installed package.
The manager loads enabled selectors only at startup; restart it after changing
the catalog. Running instances remain pinned to their verified package content.

For production, build as an ordinary user and then install root-owned shared
artifacts in either dedicated-account or real-user mode:

```bash
make release-check
sudo ./scripts/install-system.sh --dedicated
# Or, for an existing Unix account with a unique manager port:
sudo ./scripts/install-system.sh --user alice --listen 127.0.0.1:1992
```

Neither mode runs RemoteXApp as root or permits it to switch Unix identities.
`make install-user` remains the source-checkout development installation.

noVNC is pinned as reviewed source under `third_party/novnc/`. Use
`scripts/update-novnc.sh VERSION` for stable upstream updates; do not edit the
vendored tree or generated bundles by hand.

## Development launch

Loopback-only, without a reverse proxy:

```bash
make app-catalog
bin/remotexappd \
  -listen 127.0.0.1:1991 \
  -auth-mode none \
  -state-dir .runtime/remotexappd \
  -class-config configs/remotexapp-classes \
  -app-package-root .runtime/apps \
  -apps-enabled .runtime/apps-enabled \
  -core-driver-dir drivers/common \
  -gateway-bin bin/novnc-input \
  -status-bin bin/remotexapp-status
```

Health and readiness are public at `/healthz` and `/readyz`. All other routes
use trusted-header authentication by default. Never bind `auth-mode=none` to a
non-loopback address in production.

## License

RemoteXApp is licensed under the [Apache License 2.0](LICENSE). Bundled
dependency attribution and license locations are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
