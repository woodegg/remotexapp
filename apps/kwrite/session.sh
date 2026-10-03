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
  # Force/API stop bypasses shutdown.sh. Enforce no-save shutdown here too.
  if [ -n "$app_pid" ] && kill -0 "$app_pid" 2>/dev/null; then
    kill -KILL "$app_pid" 2>/dev/null || true
  fi
  for child_pid in "$wm_pid"; do
    if [ -n "$child_pid" ] && kill -0 "$child_pid" 2>/dev/null; then
      kill "$child_pid" 2>/dev/null || true
    fi
  done

  rm -f "$REMOTEXAPP_RUNTIME/kwrite.pid" "$REMOTEXAPP_RUNTIME/kwrite-process.pid"
}
request_shutdown() {
  shutdown_requested=true
  cleanup
}
trap cleanup EXIT
trap request_shutdown INT TERM

session_status_report --state loading --summary "Preparing KWrite session" \
  --detail-string application=kwrite


matchbox-window-manager -use_titlebar no >"$REMOTEXAPP_RUNTIME/matchbox.log" 2>&1 &
wm_pid=$!

document_path=$(/usr/bin/jq -er 'if has("filePath") then .filePath | strings | select(length > 0) else "" end' "$REMOTEXAPP_PARAMETERS")
set --
if [ -n "$document_path" ]; then
  case "$document_path" in /*) ;; *) echo "KWrite filePath must be absolute" >&2; exit 1 ;; esac
  /usr/bin/python3 -c 'import os,stat,sys
fd=os.open(sys.argv[1], os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
try:
    assert stat.S_ISREG(os.fstat(fd).st_mode)
finally:
    os.close(fd)' "$document_path"
  set -- "$document_path"
fi
kwrite "$@" >"$REMOTEXAPP_RUNTIME/kwrite.log" 2>&1 &
app_pid=$!
printf '%s\n' "$app_pid" >"$REMOTEXAPP_RUNTIME/kwrite-process.pid"

# Probe verifies the foreground process, its private bus owner and window.
connection_json=$(python3 "$script_dir/probe.py" "$app_pid" kwrite "$document_path")
printf '%s\n' "$app_pid" >"$REMOTEXAPP_RUNTIME/kwrite.pid"
session_status_report --state ready --summary "KWrite is ready" \
  --detail-string application=kwrite --connection-application "$connection_json"

set +e
wait "$app_pid"
exit_code=$?
set -e

if [ "$shutdown_requested" = true ]; then
  exit 0
fi

if [ "$exit_code" -eq 0 ]; then
  session_status_report --state exited --summary "KWrite exited" \
    --detail-string application=kwrite
else
  session_status_report --state error --summary "KWrite exited unexpectedly" \
    --error "KWrite exit code $exit_code" --detail-string application=kwrite
fi
exit "$exit_code"
