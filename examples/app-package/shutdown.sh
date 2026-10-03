#!/bin/sh
set -eu
: "${REMOTEXAPP_RUNTIME:?}"
if [ -s "$REMOTEXAPP_RUNTIME/example.pid" ]; then
  pid=$(sed -n '1p' "$REMOTEXAPP_RUNTIME/example.pid")
  case "$pid" in (*[!0-9]*|'') exit 10;; esac
  kill -TERM "$pid" 2>/dev/null || true
fi
exit 0
