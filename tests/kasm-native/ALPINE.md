# Alpine standalone UAT

Issue [#34](https://github.com/woodegg/remotexapp/issues/34) adds an experimental
Alpine 3.24 amd64 build of the existing D2 checkpoint. It is not a release or
evidence that every Linux distribution is supported.

## Artifact boundaries

`scripts/build-alpine-static.py` builds all four Core executables with Go
1.27.3. The three pure-Go tools use `CGO_ENABLED=0`; the legacy input gateway
uses musl and the explicit `x11_static` build tag. The default Ubuntu build
keeps its existing linkage. Every output must have neither ELF `INTERP` nor
`DT_NEEDED`; a failed check aborts packaging. The gateway remains in the Core
package for existing component identity/adoption contracts even though the
native Kasm provider does not launch it.

Static Core does not make a graphical application self-contained. Shell,
D-Bus, X11 fonts/keymaps, Openbox and Mousepad are target dependencies. Kasm is
a separately pinned native musl component, built from the same server/client
source archives and D2 patches with `build-kasm-component.py --platform alpine`.
Its runtime shared libraries must be installed and audited on Alpine. The
component retains its own digest and source/patch provenance. UDP, audio,
rich clipboard and production support remain outside this checkpoint.

## Disposable build environment

Use a separate Alpine 3.24 amd64 build container. Install the compiler,
autotools, Python 3, binutils, Node/npm and the X11/Kasm development packages
listed in `scripts/alpine-build-dependencies.txt` (one package per line).
Do not install build tools on a small deployment host. Supply Go 1.27.3 and
the three source archives named/checksummed in `build-alpine-static.py`:

- `libXau-1.0.12.tar.xz` and `libXinerama-1.1.6.tar.xz` from the
  [X.org library archive](https://www.x.org/releases/individual/lib/).
- `xdotool-3.20160805.1.tar.gz` from the exact
  [upstream tag archive](https://github.com/jordansissel/xdotool/archive/refs/tags/v3.20160805.1.tar.gz).

The build needs static X11, XCB, XTest, Xext, Xdmcp and xkbcommon libraries;
Xau, Xinerama and libxdo are built from those checked sources. Preserve source
archives, dependency versions and notices alongside the candidate. Supply the
exact source commit and its epoch; regenerate web assets before building.
Use new work and output directories. Builds need repository/registry access
unless all source inputs, Go modules and npm dependencies are cached.

```sh
apk add --no-cache $(cat scripts/alpine-build-dependencies.txt)
python3 scripts/build-alpine-static.py --inputs /inputs \
  --work /build/core --output /output/core \
  --source-commit "$VERIFIED_SOURCE_COMMIT" --source-epoch "$SOURCE_DATE_EPOCH"
python3 scripts/build-kasm-component.py --platform alpine --inputs /inputs \
  --work /build/kasm --output /output/kasm
```

## Host and application fixture

Run the Manager as the existing non-root test account with
`-lifecycle-backend standalone`, inside its host-delegated cgroup v2 subtree.
Runit supervises the Manager. The platform supplies a private runtime directory,
an account D-Bus and boot startup; Core retains atomic component placement,
generation fencing and bounded descendant cleanup. Test actual `clone3`
placement and Manager-crash adoption; writable cgroup files alone are not proof.

`alpine-apps/alpine-mousepad` and `alpine-apps/alpine-desktop` are disposable
Openbox fixtures with distinct IDs and immutable App Package digests. They do
not replace the shipped Mousepad or XFCE definitions. Install them with the
normal package/install scripts. The UAT page accepts `templateId` in fixture
configuration, defaulting to the existing `mousepad` template.

`ingress/` is a test-only HTTP proxy, built with `CGO_ENABLED=0`. It accepts only
loopback and one configured edge IP, overwrites the test identity, and serves
only the UAT page, fixture configuration and `/rx/` Manager proxy. The edge
must verify Access before forwarding. This intentionally shares one test
account among authorized UAT participants; it is not a multi-tenant gateway.
Keep Manager and Kasm sockets loopback-only. Never expose the fixture proxy
directly to the Internet or treat its IP check as user authentication.

## Qualification and route migration

Record immutable Core, component and App digests; target package versions;
ELF/linker checks; actual pointer/arrows/text/clipboard/two-Viewer statistics;
managed desktop launch, Manager restart/adoption and complete owned-process
cleanup. A running service or HTTP 200 is not browser acceptance. Physical IME
and human UAT remain separate from automated DOM/CDP input.

Only after qualification, copy the one UAT ingress rule with unchanged Access
audience/required policy into the destination tunnel, change that hostname's
proxied DNS record, and test authenticated and anonymous requests. Then remove
only its old rule. Preserve shared tunnels and unrelated routes. Save private
configuration snapshots and rollback instructions outside this public repo.
