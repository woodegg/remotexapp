#!/bin/sh
set -eu

: "${REMOTEXAPP_RUNTIME:?}"
pid_file="$REMOTEXAPP_RUNTIME/synthetic-process.pid"
[ -r "$pid_file" ] || exit 0
pid=$(sed -n '1p' "$pid_file")
case "$pid" in
  ''|*[!0-9]*) exit 1 ;;
esac
if kill -0 "$pid" 2>/dev/null; then
  kill -TERM "$pid"
fi
exit 0
