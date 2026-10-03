#!/bin/sh
set -eu

: "${REMOTEXAPP_RUNTIME:?}"
: "${REMOTEXAPP_CORE_DRIVER_DIR:?}"

# The Manager invokes this inside the instance's locked shutdown contract.
# Never send Ctrl+S or ask the application to show a save dialog.
pid=$(cat "$REMOTEXAPP_RUNTIME/kate-process.pid" 2>/dev/null || true)
case "$pid" in
  ''|*[!0-9]*) echo "Kate process PID is unavailable" >&2; exit 1 ;;
esac
if kill -0 "$pid" 2>/dev/null; then
  kill -KILL "$pid"
fi
for _ in $(seq 1 50); do
  if ! kill -0 "$pid" 2>/dev/null; then exit 0; fi
  sleep 0.1
done
echo "Kate did not exit after SIGKILL" >&2
exit 1
