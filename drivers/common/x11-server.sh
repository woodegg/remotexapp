#!/bin/sh
set -eu

: "${REMOTEXAPP_RUNTIME:?}"
umask 077
mkdir -p "$REMOTEXAPP_RUNTIME"

# The persistent layer is only a lifecycle anchor. D-Bus, IBus and the Unicode
# engine are owned by the pinned Core supervisor, never by this Driver.
printf '%s\n' "$$" >"$REMOTEXAPP_RUNTIME/server.pid"
# Alpine installs sleep in /bin; use the launcher's controlled system PATH.
exec sleep infinity
