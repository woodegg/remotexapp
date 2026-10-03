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

  rm -f "$REMOTEXAPP_RUNTIME/mousepad.pid" "$REMOTEXAPP_RUNTIME/mousepad-process.pid"
}
request_shutdown() {
  shutdown_requested=true
  cleanup
}
trap cleanup EXIT
trap request_shutdown INT TERM

session_status_report --state loading --summary "Preparing Mousepad session" \
  --detail-string application=mousepad


matchbox-window-manager -use_titlebar no >"$REMOTEXAPP_RUNTIME/matchbox.log" 2>&1 &
wm_pid=$!

document_path=$(/usr/bin/jq -er 'if has("filePath") then .filePath | strings | select(length > 0) else "" end' "$REMOTEXAPP_PARAMETERS")
set --
if [ -n "$document_path" ]; then
  case "$document_path" in /*) ;; *) echo "Mousepad filePath must be absolute" >&2; exit 1 ;; esac
  /usr/bin/python3 -c 'import os,stat,sys
fd=os.open(sys.argv[1], os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
try:
    assert stat.S_ISREG(os.fstat(fd).st_mode)
finally:
    os.close(fd)' "$document_path"
  set -- "$document_path"
fi
mousepad --disable-server "$@" >"$REMOTEXAPP_RUNTIME/mousepad.log" 2>&1 &
app_pid=$!
printf '%s\n' "$app_pid" >"$REMOTEXAPP_RUNTIME/mousepad-process.pid"

window_ready=false
for _ in $(seq 1 100); do
  if [ -n "$(xdotool search --onlyvisible --pid "$app_pid" 2>/dev/null || true)" ]; then
    window_ready=true
    break
  fi
  if ! kill -0 "$app_pid" 2>/dev/null; then
    echo "Mousepad exited before its document window became ready" >&2
    exit 1
  fi
  sleep 0.1
done
if [ "$window_ready" != true ]; then
  echo "Mousepad document window did not become ready" >&2
  exit 1
fi

printf '%s\n' "$$" >"$REMOTEXAPP_RUNTIME/mousepad.pid"
session_status_report --state ready --summary "Mousepad is ready" \
  --detail-string application=mousepad

set +e
wait "$app_pid"
exit_code=$?
set -e

if [ "$shutdown_requested" = true ]; then
  exit 0
fi

if [ "$exit_code" -eq 0 ]; then
  session_status_report --state exited --summary "Mousepad exited" \
    --detail-string application=mousepad
else
  session_status_report --state error --summary "Mousepad exited unexpectedly" \
    --error "Mousepad exit code $exit_code" --detail-string application=mousepad
fi
exit "$exit_code"
