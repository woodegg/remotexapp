#!/bin/sh
set -eu

: "${REMOTEXAPP_RUNTIME:?}"
: "${REMOTEXAPP_STATUS_PATH:?}"
: "${REMOTEXAPP_STATUS_SCHEMA:?}"
: "${REMOTEXAPP_STATUS_HELPER:?}"
: "${REMOTEXAPP_SESSION_GENERATION:?}"
: "${REMOTEXAPP_CORE_DRIVER_DIR:?}"

umask 077
mkdir -p "$REMOTEXAPP_RUNTIME"

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
[ "${REMOTEXAPP_SESSION_SERVICES:-}" = core-v1 ] || { echo "Core session services required" >&2; exit 1; }
. "$REMOTEXAPP_CORE_DRIVER_DIR/session-status.sh"

wm_pid=""
app_pid=""
shutdown_requested=false

cleanup() {
  trap - EXIT INT TERM
  for child_pid in "$app_pid" "$wm_pid"; do
    if [ -n "$child_pid" ] && kill -0 "$child_pid" 2>/dev/null; then
      kill "$child_pid" 2>/dev/null || true
    fi
  done

  rm -f "$REMOTEXAPP_RUNTIME/audio-test.pid" "$REMOTEXAPP_RUNTIME/audio-test-process.pid"
}
request_shutdown() {
  shutdown_requested=true
  cleanup
}
trap cleanup EXIT
trap request_shutdown INT TERM

session_status_report --state loading --summary "Preparing Audio test session" \
  --detail-string application=audio-test


openbox --sm-disable >"$REMOTEXAPP_RUNTIME/openbox.log" 2>&1 &
wm_pid=$!

"$script_dir/bin/remotexapp-audio-test" >"$REMOTEXAPP_RUNTIME/audio-test.log" 2>&1 &
app_pid=$!
printf '%s\n' "$app_pid" >"$REMOTEXAPP_RUNTIME/audio-test-process.pid"

window_ready=false
for _ in $(seq 1 100); do
  if [ -n "$(xdotool search --onlyvisible --pid "$app_pid" 2>/dev/null || true)" ]; then
    window_ready=true
    break
  fi
  if ! kill -0 "$app_pid" 2>/dev/null; then
    echo "Audio test exited before its document window became ready" >&2
    exit 1
  fi
  sleep 0.1
done
if [ "$window_ready" != true ]; then
  echo "Audio test document window did not become ready" >&2
  exit 1
fi

printf '%s\n' "$$" >"$REMOTEXAPP_RUNTIME/audio-test.pid"
session_status_report --state ready --summary "Audio test is ready" \
  --detail-string application=audio-test

set +e
wait "$app_pid"
exit_code=$?
set -e

if [ "$shutdown_requested" = true ]; then
  exit 0
fi

if [ "$exit_code" -eq 0 ]; then
  session_status_report --state exited --summary "Audio test exited" \
    --detail-string application=audio-test
else
  session_status_report --state error --summary "Audio test exited unexpectedly" \
    --error "Audio test exit code $exit_code" --detail-string application=audio-test
fi
exit "$exit_code"
