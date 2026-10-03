#!/bin/sh
set -eu

: "${REMOTEXAPP_RUNTIME:?}"

umask 077
mkdir -p "$REMOTEXAPP_RUNTIME"

# The experiment intentionally leaves the server layer with no D-Bus, IBus or
# Unicode engine. This one long-lived process is only a readiness/lifecycle
# anchor for the already separate TigerVNC and gateway units.
rm -f "$REMOTEXAPP_RUNTIME/dbus-address" "$REMOTEXAPP_RUNTIME/dbus.pid" \
  "$REMOTEXAPP_RUNTIME/ibus.pid" "$REMOTEXAPP_RUNTIME/engine.pid"
printf '%s\n' "$$" >"$REMOTEXAPP_RUNTIME/server.pid"
exec /usr/bin/sleep infinity
