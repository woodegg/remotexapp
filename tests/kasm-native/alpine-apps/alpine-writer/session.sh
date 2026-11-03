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

  rm -f "$REMOTEXAPP_RUNTIME/writer.pid" "$REMOTEXAPP_RUNTIME/writer-process.pid"
}
request_shutdown() {
  shutdown_requested=true
  cleanup
}
trap cleanup EXIT
trap request_shutdown INT TERM

session_status_report --state loading --summary "Preparing Writer session" \
  --detail-string application=writer


openbox --sm-disable --config-file "$script_dir/openbox.xml" >"$REMOTEXAPP_RUNTIME/openbox.log" 2>&1 &
wm_pid=$!

wm_ready=false
for _ in $(seq 1 100); do
  if ! kill -0 "$wm_pid" 2>/dev/null; then
    echo "Openbox exited before window management became ready" >&2
    exit 1
  fi
  if xdotool get_desktop >/dev/null 2>&1; then
    wm_ready=true
    break
  fi
  sleep 0.1
done
[ "$wm_ready" = true ] || { echo "Openbox readiness timed out" >&2; exit 1; }

document_path=$(/usr/bin/jq -er 'if has("filePath") then .filePath | strings | select(length > 0) else "" end' "$REMOTEXAPP_PARAMETERS")
set --
if [ -n "$document_path" ]; then
  case "$document_path" in /*) ;; *) echo "Writer filePath must be absolute" >&2; exit 1 ;; esac
  /usr/bin/python3 -c 'import os,stat,sys
fd=os.open(sys.argv[1], os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
try:
    assert stat.S_ISREG(os.fstat(fd).st_mode)
finally:
    os.close(fd)' "$document_path"
  set -- "$document_path"
fi
profile_url=$(/usr/bin/python3 -c 'import pathlib,sys;print(pathlib.Path(sys.argv[1]).as_uri())' "$REMOTEXAPP_RUNTIME/writer-profile")
libreoffice "-env:UserInstallation=$profile_url" --norestore --nofirststartwizard --nologo --writer "$@" >"$REMOTEXAPP_RUNTIME/writer.log" 2>&1 &
app_pid=$!
printf '%s\n' "$app_pid" >"$REMOTEXAPP_RUNTIME/writer-process.pid"

window_ready=false
for _ in $(seq 1 350); do
  if [ -n "$(xdotool search --onlyvisible --class libreoffice-writer 2>/dev/null || true)" ]; then
    window_ready=true
    break
  fi
  if ! kill -0 "$app_pid" 2>/dev/null; then
    echo "Writer exited before its document window became ready" >&2
    exit 1
  fi
  sleep 0.1
done
if [ "$window_ready" != true ]; then
  echo "Writer document window did not become ready" >&2
  exit 1
fi

printf '%s\n' "$$" >"$REMOTEXAPP_RUNTIME/writer.pid"
session_status_report --state ready --summary "Writer is ready" \
  --detail-string application=writer

set +e
wait "$app_pid"
exit_code=$?
set -e

if [ "$shutdown_requested" = true ]; then
  exit 0
fi

if [ "$exit_code" -eq 0 ]; then
  session_status_report --state exited --summary "Writer exited" \
    --detail-string application=writer
else
  session_status_report --state error --summary "Writer exited unexpectedly" \
    --error "Writer exit code $exit_code" --detail-string application=writer
fi
exit "$exit_code"
