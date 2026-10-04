# RemoteXApp

**Remote apps. Local interaction.** A Linux application service and browser
client SDK for bringing desktops, browsers, editors and office apps into your
own product.

[Get a release](https://github.com/woodegg/remotexapp/releases) ·
[Embed an app](#embed-an-app) · [Try it locally](#development-launch) ·
[Integration guide](docs/integration-guide.md)

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

## Citrix-style remote Linux apps, ready to embed

Give your users a real Linux app inside your web application. An editor in a
support portal. LibreOffice in a document workflow. A browser or full XFCE
desktop shared by a person and an AI agent. The app runs on your Linux host;
your user opens it in the browser, types with their local IME, and exchanges
rich clipboard content.

RemoteXApp packages the service and client SDK together: the **Go Manager**
launches and supervises application runtimes, **versioned App Packages** define
how each app starts and stops, and the **JavaScript SDK** embeds the interactive
Viewer in your page. The included multi-window **Console** lets you explore the
same APIs before building your own interface.

Start with a shipped App Package, connect a Viewer with a few lines of
JavaScript, then add the lifecycle and application actions your solution needs.
You can also package another X11 app without rebuilding the Manager.

The experience is Citrix-style desktop and application delivery, with a
programmable integration surface for developers. RemoteXApp uses TigerVNC and
noVNC; it is not compatible with Citrix ICA/HDX. Bring your own Linux host,
authentication and tenant isolation. Audio integration is still work in progress.

## Embed an app

With a configured Manager and the Mousepad App installed, serve your page behind
the same authenticated origin and import the SDK that the Manager serves:

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

That is the Viewer connection. Your host supplies the application and X11
services; the [dependency guide](docs/dependencies.md) lists what to install.
For a first local experiment, follow [Development launch](#development-launch)
and open `http://127.0.0.1:1991/sdk/console.html`.

Use the [integration guide](docs/integration-guide.md) for proxy subpaths and
embedding, and the [SDK reference](docs/browser-sdk.md) for lifecycle, actions
and opt-in clipboard synchronization. The SDK ships with the service at
`/sdk/index.js`; it does not require a separate npm package.

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

## Explore the project

| You want to… | Start here |
|---|---|
| Provision a host and install the service | [Dependencies](docs/dependencies.md) and [Operations](docs/operations.md) |
| Embed a Viewer in your own product | [Integration guide](docs/integration-guide.md) and [SDK reference](docs/browser-sdk.md) |
| Let an agent work with the same running app | [Connection descriptors](docs/agent-connections.md) and [App actions](docs/app-actions-release.md) |
| Add another Linux application | [Driver guide](drivers/README.md) and [Example App Package](examples/app-package/README.md) |
| Understand lifecycle and explicit upgrades | [Backend structure](docs/backend-structure.md) and [Runtime upgrade API](docs/runtime-upgrade-api.md) |
| Check versions, changes and security boundaries | [Current source identity](docs/current-state.md), [Changelog](CHANGELOG.md) and [Security policy](SECURITY.md) |
| Contribute or qualify a release | [Contributing](CONTRIBUTING.md), [Test process](docs/development-quality-process.md) and [Release process](docs/release-process.md) |

Earlier release and operational records describe historical validation, rather
than the state of your installation. See the [historical-record note](docs/private-history.md).

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
archive=dist/apps/mousepad-4.0.1.tar.gz
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
