#!/bin/sh
set -eu

: "${REMOTEXAPP_CORE_DRIVER_DIR:?}"
: "${REMOTEXAPP_RUNTIME:?}"
[ "${REMOTEXAPP_SESSION_SERVICES:-}" = core-v1 ] || exit 1
. "$REMOTEXAPP_CORE_DRIVER_DIR/session-status.sh"

wm_pid=
app_pid=
cleanup() {
  [ -z "$app_pid" ] || kill "$app_pid" 2>/dev/null || true
  [ -z "$wm_pid" ] || kill "$wm_pid" 2>/dev/null || true
  rm -f "$REMOTEXAPP_RUNTIME/example.pid"
}
trap cleanup EXIT INT TERM HUP

session_status_report --state loading --summary "Starting example App"
matchbox-window-manager -use_titlebar no >"$REMOTEXAPP_RUNTIME/matchbox.log" 2>&1 &
wm_pid=$!
xmessage -center "RemoteXApp package works" >"$REMOTEXAPP_RUNTIME/example.log" 2>&1 &
app_pid=$!

for _ in $(seq 1 100); do
  kill -0 "$app_pid" 2>/dev/null || {
    session_status_report --state error --summary "Example App exited before readiness" --error "xmessage exited"
    exit 1
  }
  if xdotool search --onlyvisible --class Xmessage >/dev/null 2>&1; then
    printf '%s\n' "$app_pid" >"$REMOTEXAPP_RUNTIME/example.pid"
    session_status_report --state ready --summary "Example App is ready" --detail-string application=example-app
    wait "$app_pid"
    session_status_report --state exited --summary "Example App exited"
    exit 0
  fi
  sleep 0.1
done
session_status_report --state error --summary "Example App readiness timed out" --error "no visible Xmessage window"
exit 1
