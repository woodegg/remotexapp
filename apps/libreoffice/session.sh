#!/bin/sh
set -eu

: "${REMOTEXAPP_RUNTIME:?}"
: "${REMOTEXAPP_PARAMETERS:?}"
: "${REMOTEXAPP_DRIVER_CONFIG:?}"
: "${REMOTEXAPP_RESOURCES:?}"
: "${REMOTEXAPP_CORE_DRIVER_DIR:?}"
: "${REMOTEXAPP_STATUS_PATH:?}"
: "${HOME:?}"

umask 077
mkdir -p "$REMOTEXAPP_RUNTIME" "$HOME/.config/libreoffice-remote"

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
profile_dir="$HOME/.config/libreoffice-remote"
profile_seed="$script_dir/profile-seed"
[ "${REMOTEXAPP_SESSION_SERVICES:-}" = core-v1 ] || { echo "Core session services required" >&2; exit 1; }
. "$REMOTEXAPP_CORE_DRIVER_DIR/session-status.sh"

wm_pid=""
launcher_pid=""
app_pid=""
shutdown_requested=false
document_path=""
document_lock=""
document_lock_owned=false
document_lease=""
document_lease_owned=false
control_address=$(/usr/bin/jq -er '.control.address | select(. == "127.0.0.1")' "$REMOTEXAPP_RESOURCES")
control_port=$(/usr/bin/jq -er '.control.port | select(type == "number" and . >= 1024 and . <= 65535)' "$REMOTEXAPP_RESOURCES")
control_protocol=$(/usr/bin/jq -er '.protocol | select(. == "libreoffice-uno")' "$REMOTEXAPP_DRIVER_CONFIG")
control_json=$(/usr/bin/jq -cn \
  --arg protocol "$control_protocol" \
  --arg address "$control_address" \
  --argjson port "$control_port" \
  '{protocol:$protocol,address:$address,port:$port}')

release_document_lease() {
  if [ "$document_lease_owned" != true ] || [ -z "$document_lease" ]; then
    return 0
  fi
  owner=$(cat "$document_lease/owner-pid" 2>/dev/null || true)
  if [ "$owner" = "$$" ]; then
    rm -f -- "$document_lease/owner-pid" "$document_lease/document-path"
    if ! rmdir -- "$document_lease"; then
      printf 'Unable to release LibreOffice document lease: %s\n' "$document_lease" >&2
      return 1
    fi
  fi
  document_lease_owned=false
}

acquire_document_lease() {
  state_root=$(dirname -- "$(dirname -- "$REMOTEXAPP_RUNTIME")")
  lease_root="$state_root/document-leases"
  document_key=$(printf '%s' "$document_path" | sha256sum | cut -d' ' -f1)
  document_lease="$lease_root/$document_key"
  lease_error=""
  mkdir -p -- "$lease_root"

  attempts=2
  while [ "$attempts" -gt 0 ]; do
    if mkdir -- "$document_lease" 2>/dev/null; then
      document_lease_owned=true
      if ! printf '%s\n' "$$" >"$document_lease/owner-pid" ||
         ! printf '%s\n' "$document_path" >"$document_lease/document-path"; then
        lease_error="Unable to record LibreOffice document lease"
        return 1
      fi
      return 0
    fi

    owner=$(cat "$document_lease/owner-pid" 2>/dev/null || true)
    case "$owner" in
      ''|*[!0-9]*)
        lease_mtime=$(stat -c %Y "$document_lease" 2>/dev/null || date +%s)
        lease_age=$(( $(date +%s) - lease_mtime ))
        if [ "$lease_age" -lt 30 ]; then
          lease_error="LibreOffice document lease is still initializing"
          return 1
        fi
        ;;
      *)
        if kill -0 "$owner" 2>/dev/null; then
          lease_error="LibreOffice document is already active in another RemoteXApp session"
          return 1
        fi
        ;;
    esac

    rm -f -- "$document_lease/owner-pid" "$document_lease/document-path"
    if ! rmdir -- "$document_lease" 2>/dev/null; then
      lease_error="Stale LibreOffice document lease cannot be cleaned"
      return 1
    fi
    attempts=$((attempts - 1))
  done

  lease_error="Unable to acquire LibreOffice document lease"
  return 1
}

remove_document_lock() {
  if [ -z "$document_lock" ]; then
    return 0
  fi
  if [ ! -e "$document_lock" ] && [ ! -L "$document_lock" ]; then
    return 0
  fi
  if ! rm -f -- "$document_lock"; then
    printf 'Unable to remove LibreOffice document lock: %s\n' "$document_lock" >&2
    return 1
  fi
  if [ -e "$document_lock" ] || [ -L "$document_lock" ]; then
    printf 'LibreOffice document lock remains after cleanup: %s\n' "$document_lock" >&2
    return 1
  fi
}

report_error() {
  summary=$1
  message=$2
  session_status_report --state error --summary "$summary" \
    --error "$message" \
    --detail-string application=libreoffice \
    --detail-json "control=$control_json" || true
  printf '%s\n' "$message" >&2
  exit 1
}

preflight_error() {
  report_error "LibreOffice preflight failed" "$1"
}

startup_error() {
  report_error "LibreOffice startup failed" "$1"
}

report_loading() {
  session_status_report --state loading --summary "$1" \
    --detail-string application=libreoffice \
    --detail-json "control=$control_json"
}

cleanup() {
  trap - EXIT INT TERM
  for child_pid in "$app_pid" "$launcher_pid" "$wm_pid"; do
    if [ -n "$child_pid" ] && kill -0 "$child_pid" 2>/dev/null; then
      kill "$child_pid" 2>/dev/null || true
    fi
  done
  # The template's shutdown contract intentionally discards unsaved changes.
  # Keep the session-unit fallback bounded if the dedicated hook could not run.
  for _ in $(seq 1 10); do
    children_alive=false
    for child_pid in "$app_pid" "$launcher_pid" "$wm_pid"; do
      if [ -n "$child_pid" ] && kill -0 "$child_pid" 2>/dev/null; then
        children_alive=true
      fi
    done
    if [ "$children_alive" = false ]; then
      break
    fi
    sleep 0.1
  done
  for child_pid in "$app_pid" "$launcher_pid" "$wm_pid"; do
    if [ -n "$child_pid" ] && kill -0 "$child_pid" 2>/dev/null; then
      kill -KILL "$child_pid" 2>/dev/null || true
    fi
  done
  if [ "$document_lock_owned" = true ]; then
    remove_document_lock || true
    document_lock_owned=false
  fi
  release_document_lease || true

  rm -f "$REMOTEXAPP_RUNTIME/libreoffice.pid" \
    "$REMOTEXAPP_RUNTIME/libreoffice-process.pid"
}
request_shutdown() {
  shutdown_requested=true
  cleanup
}
trap cleanup EXIT
trap request_shutdown INT TERM

case "$control_port" in
  ''|*[!0-9]*) printf '%s\n' 'invalid LibreOffice control port' >&2; exit 1 ;;
esac
if [ "$control_port" -lt 1024 ] || [ "$control_port" -gt 65535 ]; then
  printf '%s\n' 'LibreOffice control port is outside the allowed range' >&2
  exit 1
fi

if ! document_path=$(/usr/bin/jq -er 'if has("filePath") then .filePath | strings | select(length > 0) else "" end' "$REMOTEXAPP_PARAMETERS"); then
  preflight_error "LibreOffice filePath parameter is missing or invalid"
fi
if [ -n "$document_path" ]; then
case "$document_path" in
  /*) ;;
  *) preflight_error "LibreOffice filePath is not the canonical absolute path locked by the manager" ;;
esac
if [ -L "$document_path" ] || [ ! -f "$document_path" ] || [ ! -r "$document_path" ]; then
  preflight_error "LibreOffice document is not a readable regular file: $document_path"
fi
if ! /usr/bin/python3 -c \
  'import os, stat, sys
fd = os.open(sys.argv[1], os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
try:
    assert stat.S_ISREG(os.fstat(fd).st_mode)
finally:
    os.close(fd)' \
  "$document_path"; then
  preflight_error "LibreOffice document cannot be opened for reading: $document_path"
fi
if ! acquire_document_lease; then
  preflight_error "$lease_error"
fi
document_lock=$(dirname -- "$document_path")/.~lock.$(basename -- "$document_path")#
if fuser "$document_path" >/dev/null 2>&1; then
  preflight_error "LibreOffice document is already open by another local process"
fi
if ! remove_document_lock; then
  preflight_error "LibreOffice document lock cannot be cleaned: $document_lock"
fi
document_lock_owned=true
fi

report_loading "Preparing LibreOffice profile"
if [ ! -d "$profile_seed" ]; then
  preflight_error "LibreOffice profile seed is unavailable: $profile_seed"
fi
if [ -z "$(find "$profile_dir" -mindepth 1 -print -quit)" ]; then
  if ! cp -R "$profile_seed/." "$profile_dir/"; then
    preflight_error "Unable to initialize the LibreOffice profile seed"
  fi
fi


if command -v xsetroot >/dev/null 2>&1; then
  xsetroot -solid '#f2f2f2' >/dev/null 2>&1 || true
fi
matchbox-window-manager -use_titlebar no >"$REMOTEXAPP_RUNTIME/matchbox.log" 2>&1 &
wm_pid=$!
sleep 0.1
if ! kill -0 "$wm_pid" 2>/dev/null; then
  startup_error "Matchbox exited before LibreOffice startup"
fi

report_loading "Starting LibreOffice"
profile_uri=$(/usr/bin/python3 -c \
  'from pathlib import Path; import sys; print(Path(sys.argv[1]).resolve().as_uri())' \
  "$profile_dir")

rm -f "$REMOTEXAPP_RUNTIME/libreoffice.pid" "$REMOTEXAPP_RUNTIME/libreoffice-process.pid"
set --
if [ -n "$document_path" ]; then set -- --nodefault "$document_path"; fi
/usr/bin/libreoffice \
  --nologo \
  --norestore \
  --nolockcheck \
  --pidfile="$REMOTEXAPP_RUNTIME/libreoffice-process.pid" \
  --accept="socket,host=$control_address,port=$control_port;urp;StarOffice.ComponentContext" \
  "-env:UserInstallation=$profile_uri" \
  "$@" >"$REMOTEXAPP_RUNTIME/libreoffice.log" 2>&1 &
launcher_pid=$!

ready=false
document_loading_reported=false
for _ in $(seq 1 120); do
  candidate=$(cat "$REMOTEXAPP_RUNTIME/libreoffice-process.pid" 2>/dev/null || true)
  case "$candidate" in
    ''|*[!0-9]*) candidate="" ;;
  esac
  if [ -n "$candidate" ]; then
    app_pid=$candidate
    if [ "$document_loading_reported" = false ] && kill -0 "$app_pid" 2>/dev/null; then
      report_loading "Loading LibreOffice document"
      document_loading_reported=true
    fi
    if kill -0 "$app_pid" 2>/dev/null && \
      [ -n "$(xdotool search --onlyvisible --pid "$app_pid" 2>/dev/null || true)" ] && \
      /usr/bin/python3 "$script_dir/probe.py" "$control_port" "$document_path" \
        >/dev/null 2>&1; then
      ready=true
      break
    fi
  fi
  if ! kill -0 "$launcher_pid" 2>/dev/null; then
    startup_error "LibreOffice exited before its document became ready"
  fi
  sleep 0.1
done
if [ "$ready" != true ]; then
  startup_error "LibreOffice document or UNO control socket did not become ready"
fi

printf '%s\n' "$$" >"$REMOTEXAPP_RUNTIME/libreoffice.pid"
session_status_report --state ready --summary "LibreOffice document is ready" \
  --detail-string application=libreoffice \
  --detail-json "control=$control_json"

set +e
wait "$launcher_pid"
exit_code=$?
set -e

if [ "$shutdown_requested" = true ]; then
  exit 0
fi
if [ "$exit_code" -eq 0 ]; then
  session_status_report --state exited --summary "LibreOffice exited" \
    --detail-string application=libreoffice \
    --detail-json "control=$control_json"
else
  session_status_report --state error --summary "LibreOffice exited unexpectedly" \
    --error "LibreOffice exit code $exit_code" \
    --detail-string application=libreoffice \
    --detail-json "control=$control_json"
fi
exit "$exit_code"
