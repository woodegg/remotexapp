#!/bin/sh
set -eu

: "${REMOTEXAPP_RUNTIME:?}"
: "${REMOTEXAPP_API_VERSION:?}"
: "${REMOTEXAPP_DRIVER_CONFIG:?}"
: "${REMOTEXAPP_RESOURCES:?}"

test "$REMOTEXAPP_API_VERSION" = "remotexapp/v1"
test -r "$REMOTEXAPP_DRIVER_CONFIG"
test -r "$REMOTEXAPP_RESOURCES"
umask 077
mkdir -p "$REMOTEXAPP_RUNTIME"
printf '%s\n' "$$" >"$REMOTEXAPP_RUNTIME/server.pid"
exec /usr/bin/sleep infinity
