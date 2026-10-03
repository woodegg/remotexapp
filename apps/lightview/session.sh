#!/bin/sh
set -eu

: "${REMOTEXAPP_RUNTIME:?}"
: "${REMOTEXAPP_PARAMETERS:?}"
: "${REMOTEXAPP_STATUS_PATH:?}"
: "${REMOTEXAPP_DRIVER_CONFIG:?}"
: "${REMOTEXAPP_CORE_DRIVER_DIR:?}"
: "${HOME:?}"

umask 077
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
[ "${REMOTEXAPP_SESSION_SERVICES:-}" = core-v1 ] || { echo "Core session services required" >&2; exit 1; }
. "$REMOTEXAPP_CORE_DRIVER_DIR/session-status.sh"

socket_relative=$(/usr/bin/jq -er '.socketRelativePath | select(. == "lightview/control.sock")' "$REMOTEXAPP_DRIVER_CONFIG")
protocol=$(/usr/bin/jq -er '.protocol | select(. == "lightview-json-v1")' "$REMOTEXAPP_DRIVER_CONFIG")
control_dir="$REMOTEXAPP_RUNTIME/lightview"
control_socket="$REMOTEXAPP_RUNTIME/$socket_relative"
profile_dir="$HOME/.local/share/remotexapp/lightview/default"
mkdir -p "$control_dir" "$profile_dir"
chmod 700 "$control_dir" "$profile_dir"

wm_pid=""
lightview_pid=""
shutdown_requested=false

cleanup() {
  trap - EXIT INT TERM
  for child_pid in "$lightview_pid" "$wm_pid"; do
    if [ -n "$child_pid" ] && kill -0 "$child_pid" 2>/dev/null; then
      kill "$child_pid" 2>/dev/null || true
    fi
  done
  for _ in $(seq 1 50); do
    if { [ -z "$lightview_pid" ] || ! kill -0 "$lightview_pid" 2>/dev/null; } && \
       { [ -z "$wm_pid" ] || ! kill -0 "$wm_pid" 2>/dev/null; }; then
      break
    fi
    sleep 0.1
  done
  for child_pid in "$lightview_pid" "$wm_pid"; do
    if [ -n "$child_pid" ] && kill -0 "$child_pid" 2>/dev/null; then
      kill -KILL "$child_pid" 2>/dev/null || true
    fi
  done
  rm -f "$REMOTEXAPP_RUNTIME/lightview.pid" "$REMOTEXAPP_RUNTIME/lightview-process.pid"
}
request_shutdown() {
  shutdown_requested=true
  cleanup
}
trap cleanup EXIT
trap request_shutdown INT TERM

start_url=$(/usr/bin/jq -er '.startUrl | strings' "$REMOTEXAPP_PARAMETERS")
case "$start_url" in
  about:blank|http://*|https://*) ;;
  *) printf '%s\n' 'LightView startUrl must be HTTP, HTTPS or exactly about:blank' >&2; exit 1 ;;
esac
# Compatibility is established by the launched process/window and control
# status below, not by its version banner or user-selected memory policy.
descriptor=$(/usr/bin/jq -cn --arg protocol "$protocol" --arg socketPath "$control_socket" \
  '{protocol:$protocol,transport:"unix",socketPath:$socketPath}')
session_status_report --state loading --summary "Preparing LightView session" \
  --detail-string application=lightview --detail-bool launchLowMemory=true

matchbox-window-manager -use_titlebar no >"$REMOTEXAPP_RUNTIME/matchbox.log" 2>&1 &
wm_pid=$!

lightview --low-memory --profile "$profile_dir" --socket "$control_socket" \
  "$start_url" >"$REMOTEXAPP_RUNTIME/lightview.log" 2>&1 &
lightview_pid=$!
printf '%s\n' "$lightview_pid" >"$REMOTEXAPP_RUNTIME/lightview-process.pid"

window_ready=false
control_status=""
for _ in $(seq 1 450); do
  if [ -n "$(xdotool search --onlyvisible --pid "$lightview_pid" 2>/dev/null || true)" ]; then
    window_ready=true
  fi
  control_status=$(/usr/bin/python3 "$script_dir/control.py" "$control_socket" "$lightview_pid" status 2>/dev/null || true)
  if [ "$window_ready" = true ] && [ -n "$control_status" ]; then
    load_error=$(printf '%s' "$control_status" | /usr/bin/jq -r '.load_error // empty')
    loading=$(printf '%s' "$control_status" | /usr/bin/jq -r '.loading')
    if [ -n "$load_error" ]; then
      printf 'LightView initial navigation failed: %s\n' "$load_error" >&2
      exit 1
    fi
    if [ "$loading" = false ]; then
      break
    fi
  fi
  if ! kill -0 "$lightview_pid" 2>/dev/null; then
    printf '%s\n' 'LightView exited before its window and control socket became ready' >&2
    exit 1
  fi
  sleep 0.1
done
if [ "$window_ready" != true ] || [ -z "$control_status" ] || \
   [ "$(printf '%s' "$control_status" | /usr/bin/jq -r '.loading')" != false ]; then
  printf '%s\n' 'LightView window, low-memory status or control socket did not become ready' >&2
  exit 1
fi

printf '%s\n' "$lightview_pid" >"$REMOTEXAPP_RUNTIME/lightview.pid"
session_status_report --state ready --summary "LightView is ready" \
  --detail-string application=lightview --detail-bool launchLowMemory=true \
  --connection-application "$descriptor"

set +e
wait "$lightview_pid"
exit_code=$?
set -e

if [ "$shutdown_requested" = true ]; then
  exit 0
fi
if [ "$exit_code" -eq 0 ]; then
  session_status_report --state exited --summary "LightView exited" \
    --detail-string application=lightview --detail-bool launchLowMemory=true
else
  session_status_report --state error --summary "LightView exited unexpectedly" \
    --error "LightView exit code $exit_code" --detail-string application=lightview \
    --detail-bool launchLowMemory=true
fi
exit "$exit_code"
