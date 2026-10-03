# Dependencies: must-have and optional

RemoteXApp packages its own services, SDK, noVNC and App drivers. It does **not**
bundle the operating system, TigerVNC, desktops or application executables.
Administrators install those host dependencies separately. Installing an App
Package installs its driver and manifest—not Firefox, LibreOffice, etc.

## Must-have: runtime host

| Dependency | Why it is required | Supplied by RemoteXApp? |
|---|---|---|
| Supported Linux host, systemd/user manager and non-root runtime account | Services, runtime units and lifecycle supervision | No; formal archives target Linux amd64, with Ubuntu/X11 validation |
| TigerVNC (`Xtigervnc`) and `xauth` | Virtual display and X11 authorization | No |
| D-Bus (`dbus-daemon`, `dbus-send`), `ibus` / `ibus-daemon` | Core-owned session services and bounded protocol readiness | No |
| Python 3, PyGObject (`gi`), GLib and IBus introspection bindings | Shipped Unicode input engine | Engine source is bundled; interpreter/bindings are not |
| X11, XTest and libxdo runtime libraries; `xdotool` | Native X11 input and driver helpers | No |
| Shell and host utilities | Installers/drivers require tools such as `bash`, coreutils, `rsync`, `tar`, and `jq`; exact needs depend on the workflow/App | No |
| noVNC and browser SDK | Browser display/input client | **Yes**; no separate system noVNC installation needed |

A browser with JavaScript/WebSocket support is needed to use a Viewer. Rich
browser clipboard access additionally requires a secure context and browser
permissions; localhost is suitable for development. Non-local production access
requires the authenticated TLS deployment described in [security](../SECURITY.md).
A particular reverse-proxy product is not a required dependency.

Core-owned session supervision requires Linux `pidfd_open` / `pidfd_send_signal`;
shutdown-hook ownership also uses child-subreaper support. Container/seccomp
policies must permit these calls. Installed executables alone do not prove this
capability: validate actual launch, graceful/forced stop and Manager-crash
cleanup on the target host. See the [service design](session-services-release.md).

## Installed components are not pre-running desktop services

**Install the building blocks; let RemoteXApp start the display and App session.**
Requiring TigerVNC, XFCE or IBus packages does not mean a standalone VNC desktop,
graphical login or application must already be running.

| Component | Required before launching a RemoteXApp runtime |
|---|---|
| systemd user manager | Available for the deployment's non-root account; configure lingering for unattended user-service operation |
| User D-Bus in `user-home` mode | Existing account bus available at `/run/user/<uid>/bus`; RemoteXApp reuses it and must not stop it |
| TigerVNC | Executable installed; RemoteXApp starts its own display server |
| XFCE / Matchbox / application | Corresponding packages installed; the App driver starts the session when its activation policy requires it |
| IBus and private session D-Bus | Components installed; session input setup manages them according to the run mode, not a separately prestarted desktop |
| Standalone VNC/desktop autostart service | Not required; keep conflicting services stopped/disabled when RemoteXApp owns their intended display |

A disabled or masked standalone `tigervncserver@.service` is compatible with
RemoteXApp: its runtime launches the executable rather than requiring that unit.
Keep the TigerVNC package installed. For the default `xfce-user-desktop`, ensure
display `:1` and its required ports are free. Do not disable unrelated desktops
or shared system/user D-Bus services as a blanket preparation step.

No running X11 socket or XFCE process before first launch is expected, not a
missing dependency. Portal/notification units can have old failures from trying
to use an absent display; inspect the cause, then verify desktop health after
RemoteXApp launches it. Do not start a competing desktop just to clear those
failures. Package presence establishes deployment prerequisites, not completed
functional acceptance of input, clipboard or application control.

## Must-have when the corresponding App is installed

These are conditional requirements, **not optional enhancements to that App**.
Other shared commands and modules are listed in each manifest's `dependencies`.

| Template | Additional host dependencies |
|---|---|
| `xfce-user-desktop` | XFCE (`startxfce4`, `xfce4-session-logout`), `xfce4-clipman`, `xprop`, GTK3 IBus module |
| `mousepad` | `mousepad`, `matchbox-window-manager`, GTK3 IBus module |
| `libreoffice` | `libreoffice`, GTK3 VCL plugin, Python `uno` module, `matchbox-window-manager`, `fuser`, GTK3 IBus module |
| `edge` | `microsoft-edge`, `matchbox-window-manager` |
| `firefox-esr` | `firefox-esr`, `matchbox-window-manager`, GTK3 IBus module |
| `lightview` | A separately installed, capability-compatible `lightview` executable, WebKitGTK runtime, `matchbox-window-manager`, GTK3 IBus module; GStreamer bad and libav plugins for common web media |
| `kate` | `kate`, `gdbus`, `matchbox-window-manager`, matching Qt IBus plugin |
| `kwrite` | `kwrite`, `gdbus`, `matchbox-window-manager`, matching Qt IBus plugin |

For example, LibreOffice's Python binding is provided by `python3-uno` on the
Ubuntu deployment path; a Python interpreter alone is insufficient. Edge and
Firefox ESR may need administrator-approved package sources. A different browser
executable is not automatically a substitute for the manifest's declared command.
LightView is separately provisioned by the operator; its binary is not
downloaded or embedded by the App Package. The current Driver checks a visible
window, exact process identity, private control socket and native readiness
status rather than a version string. The host build must provide the status
capabilities the Driver consumes, including `engine_state` and
`web_process_generation`: Ubuntu 26.04 QA passed with Lightview 0.1.10, while
0.1.7 lacked those fields and failed readiness. Record the checksum and
WebKitGTK identity of the approved host build; see `apps/lightview/README.md`.
A host missing the
GStreamer bad/libav plugins can load YouTube while the player reports that it
cannot play the selected video.

**Default full installation:** the shipped-App installer processes every bundled
App archive, including dependency validation. Prepare dependencies for the full
catalog before using it. Merely planning not to launch an App—or disabling its
selector—does not bypass this install-time validation. A deliberately reduced
catalog needs an explicit App Package deployment plan; there is no automatic
“install only the OS packages for Apps I use” option.

## Good to have: operational conveniences

- Monitoring dashboards and centralized log collection beyond systemd's journal.
- Automated backup/restore tooling for persistent profiles and user documents,
  according to the deployment's retention policy.
- Extra desktop utilities, fonts or language packs for user workloads, beyond
  what the selected application requires.

These are not prerequisites for starting RemoteXApp. Do not classify required
security controls, Matchbox for single-App templates, or a template's executable
as merely “good to have.” XFCE Clipman is declared by the current desktop
template even though other templates do not need a clipboard manager.

## Build/test only—not required on release runtime hosts

Source builds require pinned Go 1.26.8, Node 22, esbuild 0.20.1 and native build
headers/toolchain. Go modules are recorded in `go.mod` / `go.sum`.
Live validation additionally uses tools such as Xvfb, `xclip`, a test browser,
and Playwright for the dedicated prompt UI check. These become required when
running their respective tests; **production clipboard transfer does not use
`xclip`**. See [development quality](development-quality-process.md) and the
test/workflow scripts for the exact gate's prerequisites.

## What is checked, installed and versioned today?

- [Preflight](../scripts/preflight.sh) checks core commands, installed catalog
  and target-user capabilities. [App validation](../cmd/remotexappd/app_package.go)
  checks declared executables and actual isolated Python imports, not merely
  module discovery. Native binding import failures therefore fail validation.
  Missing dependencies are errors; installers do not run `apt` to repair them.
- [Ubuntu host checks](../scripts/check-ubuntu-host.py) import GI/GLib/IBus and
  selected Python bindings, load X11/XTest/libxdo and selected toolkit modules,
  exercise pidfd signaling on their own child, and query the runtime user's
  manager/required borrowed bus. Each subprocess probe is bounded. Installed
  central-user/system checks run these probes **as the runtime account**, not
  the installing administrator. They do not start a desktop, read clipboard
  data, print environment contents or modify system configuration.
- This is **not complete compatibility certification**. Library load success
  and an IBus ACK do not prove text reached the focused application. Perform
  actual Unicode/multiline input and document readback, clipboard, shutdown,
  restart and upgrade acceptance on a clean target. A standalone binding check is:

  ```bash
  python3 -c 'import gi; gi.require_version("IBus", "1.0"); from gi.repository import GLib, IBus'
  ```

- noVNC is bundled and pinned to 1.7.0 with commit/checksum provenance and a
  reviewed [upstream update process](novnc-upstream.md). Host applications are
  externally maintained; their versions are not locked by an App Package's
  driver version. `firefox-esr@2.2.0`, for example, identifies our App Package,
  not the installed Firefox version.
- Check the installed OS/application versions and validate a clean host before
  rollout. An existing sandbox having all packages installed does not prove the
  RemoteXApp installer will provision those packages on a fresh machine.

## Ubuntu 24.04 / 26.04 preparation

Generate an explicit list for administrator review; these commands install nothing:

```bash
python3 -I scripts/check-ubuntu-host.py --print-packages --ubuntu 26.04 --apps all
python3 -I scripts/check-ubuntu-host.py --print-packages --ubuntu 24.04 --apps mousepad,libreoffice

# Run as the intended non-root runtime account, after package installation.
python3 -I scripts/check-ubuntu-host.py --apps all --user alice --require-linger
# Installed selectors (including site-specific desktop names):
python3 -I scripts/check-ubuntu-host.py --enabled-root /etc/remotexapp/apps-enabled --user alice
```

`--apps core` checks only the base services; it does not certify any App.
Edge/Firefox ESR require separately approved package sources; the list neither
adds repositories nor promises these packages exist in a base Ubuntu archive.
The full installer still requires all bundled Apps. Custom Apps retain generic
manifest dependency checks without Core changes, but their toolkit integration
is explicitly reported as **not checked** and needs administrator review.

GTK3 Apps require `ibus-gtk3`; GTK4 workloads additionally use `--gtk4` and
`ibus-gtk4`. Do not assume both are necessary for GTK3 Mousepad. Kate/KWrite
checks inspect their actual Qt major version and load that version's IBus plugin;
installing a Qt5 plugin does not satisfy a Qt6 executable. Package lists target
distribution-native Qt5 on 24.04 and Qt6 on 26.04; separately sourced builds need
their own matching packages. Ubuntu ships the IBus plugin in
[`libqt5gui5t64` on 24.04](https://packages.ubuntu.com/noble/amd64/libqt5gui5t64/filelist)
and [`libqt6gui6` on 26.04](https://packages.ubuntu.com/resolute/amd64/libqt6gui6/filelist),
not the similarly named Qt6 QPA plugin package. No standalone IBus daemon or graphical login needs
to be enabled to satisfy these package requirements.

See the [Ubuntu repair train](ubuntu-host-compatibility-release.md) for the
separate clean-host acceptance gates and currently unverified targets.
