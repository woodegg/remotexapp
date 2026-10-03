# Third-party notices

RemoteXApp release artifacts contain or bundle the following third-party code.
This file is informational; the referenced license texts are controlling.

## Gorilla WebSocket

The Go binaries include `github.com/gorilla/websocket` v1.5.3 under the
BSD 2-Clause license. See
[`third_party/licenses/gorilla-websocket-LICENSE.txt`](third_party/licenses/gorilla-websocket-LICENSE.txt).

## Go module utilities

The Manager includes `golang.org/x/mod` v0.41.0 for semantic version comparison
under the BSD 3-Clause license. See
[`third_party/licenses/golang-x-mod-LICENSE.txt`](third_party/licenses/golang-x-mod-LICENSE.txt).

The Go binaries include `golang.org/x/sys` v0.48.0 for operating-system
interfaces under the BSD 3-Clause license. See
[`third_party/licenses/golang-x-sys-LICENSE.txt`](third_party/licenses/golang-x-sys-LICENSE.txt).

## noVNC browser client

The browser bundle contains reviewed source from noVNC v1.7.0, pinned by exact
commit and archive checksum in
[`third_party/novnc/UPSTREAM.json`](third_party/novnc/UPSTREAM.json). noVNC is
licensed under MPL-2.0; bundled dependencies retain their own licenses. The
complete corresponding source and license set are distributed under
[`third_party/novnc/`](third_party/novnc/), including `LICENSE.txt` and
`docs/LICENSE.*`.

## XGB

The Go gateway includes `github.com/jezek/xgb` v1.3.1 for the pure-Go X11
Selection and XFixes clipboard protocol. See
[`third_party/licenses/jezek-xgb-LICENSE.txt`](third_party/licenses/jezek-xgb-LICENSE.txt).

## Runtime dependencies

TigerVNC, X11, D-Bus, IBus, Python/PyGObject, XFCE, Matchbox, Mousepad, and any
configured browser are host-installed runtime dependencies and are not copied
into RemoteXApp release artifacts. Operators remain responsible for their
package and application license obligations.
