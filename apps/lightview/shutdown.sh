#!/bin/sh
set -eu

: "${REMOTEXAPP_RUNTIME:?}"
: "${REMOTEXAPP_SHUTDOWN_GRACE_SECONDS:?}"

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
pid=$(cat "$REMOTEXAPP_RUNTIME/lightview-process.pid" 2>/dev/null || true)
case "$pid" in
  ''|*[!0-9]*) printf '%s\n' 'LightView process PID is unavailable' >&2; exit 10 ;;
esac
if ! kill -0 "$pid" 2>/dev/null; then
  exit 0
fi
socket="$REMOTEXAPP_RUNTIME/lightview/control.sock"
if ! /usr/bin/python3 "$script_dir/control.py" "$socket" "$pid" quit >/dev/null; then
  printf '%s\n' 'LightView native quit could not be delivered safely' >&2
  exit 10
fi
attempts=$((REMOTEXAPP_SHUTDOWN_GRACE_SECONDS * 10 - 10))
if [ "$attempts" -lt 1 ]; then attempts=1; fi
while [ "$attempts" -gt 0 ]; do
  if ! kill -0 "$pid" 2>/dev/null; then
    exit 0
  fi
  attempts=$((attempts - 1))
  sleep 0.1
done
printf '%s\n' 'LightView did not exit after native quit' >&2
exit 10
