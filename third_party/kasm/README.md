# Experimental Kasm WSS component

This directory is the D1 integration recipe, not an upstream release or a
qualified RemoteXApp distribution. The default provider remains TigerVNC.
Server and browser client form one separately installed, manifest-pinned pair.
Do not update files inside an installed component directory.

Source inputs:

| Input | Immutable source |
| --- | --- |
| Kasm server | [17265facc40ab50db5740cdf0d12c61173edafc9](https://github.com/kasmtech/KasmVNC/tree/17265facc40ab50db5740cdf0d12c61173edafc9) |
| Kasm browser client | [475ecfa5356579ef222983c7ce4619a7576a3bce](https://github.com/kasmtech/noVNC/tree/475ecfa5356579ef222983c7ce4619a7576a3bce) |
| Xorg server | [21.1.12](https://www.x.org/archive/individual/xserver/xorg-server-21.1.12.tar.xz) |
| Browser dependency/build tool | pako 2.1.0 / esbuild 0.20.1, locked by `package-lock.json` |

The build script checks archive SHA-256 before extraction. Download the commit
archives from `https://codeload.github.com/kasmtech/KasmVNC/tar.gz/COMMIT` and
`https://codeload.github.com/kasmtech/noVNC/tar.gz/COMMIT`, naming them
`server.tar.gz` and `client.tar.gz`; name the Xorg archive `xorg.tar.xz`.
Do not substitute a tag archive: different archive root names change its hash.

On a disposable Ubuntu 24.04 amd64 build host with the Kasm/Xorg build
dependencies, GCC 13, CMake, autotools, Node/npm and binutils installed:

```sh
python3 scripts/build-kasm-component.py \
  --inputs /var/tmp/kasm-inputs \
  --work /var/tmp/kasm-build-new \
  --output /var/tmp/kasm-component-new
```

The work/output paths must be new. The script never installs or restarts a
service. It uses a clean source tree and `npm ci` with integrity-checked locked
packages; npm registry access is required unless the packages are cached.
Tool versions and bundled library package versions are retained in `SOURCE.json`.
This is a source reconstruction recipe, not a claim of byte-identical builds
across toolchains. Distribution review remains tracked by Issue #26.

The output includes the original source archives, ordered patches, adapter,
build recipe, manifest, upstream licenses and bundled library/pako notices.
The server is a GPL derivative and the browser client retains MPL notices;
preserve corresponding source and all notices when sharing a component.
Audit unbundled runtime libraries on the actual target before use.

## Patch boundary

- 0001/0004/0005 retain the frozen research server hardening changes.
- 0006 disables the UDP worker/discovery and rejects UDP upgrade messages in
  this WSS-only component; 0007 fixes static-library link ordering.
- 0010 preserves the research input, reconnect and bounded frame-callback
  changes without importing the research site or its deployment configuration.
- 0011 disables browser WebRTC setup and QOI workers and emits an actual-paint
  event from the display; 0012 removes the full menu UI dependency and gives
  each Viewer its own window-channel identity.
- 0013 makes completed control handlers continue the receive loop, uses the
  bounded transactional codec parser in `server-messages.mjs`, and removes
  printer/smartcard subscriptions. Applied-source tests run during the build.
- 0015-server fixes encoding-cache key ordering and replaces both the stored
  length and owned allocation for repeated rectangles. The applied C++ test
  exercises every ordering of conflicting rectangle keys, growing/shrinking
  replacements, clearing and destruction under ASan/UBSan with leak detection.
  It requires `KASM_SERVER_SOURCE`; ordinary CI skips it without that build tree.
- `client-entry.js` is the only adapter that uses pinned upstream internals.
  It initializes required DOM-to-X11 mouse-button mapping otherwise supplied
  by the upstream UI. It exposes connection/input policy and native text actions to the SDK;
  clipboard requires explicit server selection and per-Viewer consent.

The initial component does not enable UDP, audio, rich clipboard, extra
windows, QOI workers or video codec qualification. Physical IME and host
workspace acceptance belong to later gates. Research test passes are not
product qualification.

## Manager selection

In a project-owned disposable environment, add these flags to the normal
authenticated Manager launch with the direct launcher:

```sh
-display-provider kasm -kasm-bundle /opt/remotexapp-components/kasm-DIGEST
```

The path must be absolute and canonical, without symlinks or group/world
writable files/directories. The Manager hashes the manifest and every member;
native manifests retain that pin. Missing/changed files fail startup or
adoption. Native runtime records use schema 4; older Core cannot adopt them.
The browser uses `RemoteXAppNativeClient`, not the legacy `RemoteXAppClient`.
The native kiosk displays actual WSS state (or explicit loopback WS for local
development). Stop and snapshot state before provider/Core rollback; do not
point an older Core at native runtime records or share a live profile writer.

## D2 input and text checkpoint

Patch 0009 removes ordinary content-bearing keyboard mapping logs.
The recipe now emits protocol `kasm-wss-text-v1`. Patch 0008 bounds incoming
UTF-8 text before allocation/mutation and filters outgoing formats/sizes.
Patch 0014 uses the bounded transactional browser parser. The adapter exposes
keyboard policy and explicit native text sends; it never accesses the browser
clipboard itself. Policy tests exercise the exact patch in portable CI and
the actual applied file during a component build.

Core also recognizes the older WSS-only component for adoption, but rejects
text policy on it. Add `-native-clipboard` explicitly for new runtimes; without
it the server keeps clipboard off. Restarting Manager is not a runtime upgrade.
Browser clipboard actions require separate per-Viewer consent/user gesture.
The native kiosk exposes those actions. HTML/PNG/RTF/files are not supported
by this checkpoint; no passive browser clipboard synchronization is enabled.
