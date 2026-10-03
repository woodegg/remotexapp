#!/bin/sh
set -eu

: "${REMOTEXAPP_RUNTIME:?}"
: "${REMOTEXAPP_CORE_DRIVER_DIR:?}"
: "${HOME:?}"

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

REMOTEXAPP_SHUTDOWN_PID="$REMOTEXAPP_RUNTIME/edge-process.pid"
export REMOTEXAPP_SHUTDOWN_PID
set +e
"$REMOTEXAPP_CORE_DRIVER_DIR/window-close.sh"
shutdown_status=$?
set -e

profile_status=0
/usr/bin/python3 "$script_dir/profile-locks.py" "$HOME/.config/microsoft-edge-remote" \
  >"$REMOTEXAPP_RUNTIME/edge-profile-locks-shutdown.json" \
  2>"$REMOTEXAPP_RUNTIME/edge-profile-locks-shutdown.log" || profile_status=$?

[ "$shutdown_status" -eq 0 ] || exit "$shutdown_status"
exit "$profile_status"
