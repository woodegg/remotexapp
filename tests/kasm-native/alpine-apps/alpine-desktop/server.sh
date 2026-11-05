#!/bin/sh
set -eu

: "${REMOTEXAPP_RUNTIME:?}"
: "${REMOTEXAPP_CORE_DRIVER_DIR:?}"
exec "$REMOTEXAPP_CORE_DRIVER_DIR/x11-server.sh"
