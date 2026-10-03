#!/bin/sh
set -eu

: "${REMOTEXAPP_RUNTIME:?}"
: "${REMOTEXAPP_PARAMETERS:?}"
: "${REMOTEXAPP_STATUS_PATH:?}"
: "${REMOTEXAPP_DRIVER_CONFIG:?}"
: "${REMOTEXAPP_RESOURCES:?}"
: "${REMOTEXAPP_CORE_DRIVER_DIR:?}"
: "${HOME:?}"

umask 077
mkdir -p "$REMOTEXAPP_RUNTIME" "$HOME/.config/microsoft-edge-remote"

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
[ "${REMOTEXAPP_SESSION_SERVICES:-}" = core-v1 ] || { echo "Core session services required" >&2; exit 1; }
. "$REMOTEXAPP_CORE_DRIVER_DIR/session-status.sh"

# Ubuntu 26.04's uutils date prints nanoseconds for %3N, unlike GNU date's
# three-digit millisecond field. Match Core's epoch-millisecond deadline with
# Python's explicit nanosecond conversion instead of date formatting.
now_ms() {
  /usr/bin/python3 -c 'import time; print(time.time_ns() // 1000000)'
}

wm_pid=""
edge_pid=""
shutdown_requested=false

cleanup() {
  trap - EXIT INT TERM
  for child_pid in "$edge_pid" "$wm_pid"; do
    if [ -n "$child_pid" ] && kill -0 "$child_pid" 2>/dev/null; then
      kill "$child_pid" 2>/dev/null || true
    fi
  done

  rm -f "$REMOTEXAPP_RUNTIME/edge.pid" "$REMOTEXAPP_RUNTIME/edge-process.pid"
}
request_shutdown() {
  shutdown_requested=true
  cleanup
}
trap cleanup EXIT
trap request_shutdown INT TERM

session_status_report --state loading --summary "Preparing Edge session" \
  --detail-string application=edge

control_address=$(/usr/bin/jq -er '.control.address | select(. == "127.0.0.1")' "$REMOTEXAPP_RESOURCES")
control_port=$(/usr/bin/jq -er '.control.port | select(type == "number" and . >= 1024 and . <= 65535)' "$REMOTEXAPP_RESOURCES")
control_protocol=$(/usr/bin/jq -er '.protocol | select(. == "cdp")' "$REMOTEXAPP_DRIVER_CONFIG")
control_loading=$(/usr/bin/jq -cn \
  --arg protocol "$control_protocol" \
  --arg address "$control_address" \
  --argjson port "$control_port" \
  '{protocol:$protocol,address:$address,port:$port,endpoints:{versionUrl:("http://"+$address+":"+($port|tostring)+"/json/version")}}')
session_status_report --state loading --summary "Preparing Edge control endpoint" \
  --detail-string application=edge \
  --detail-json "control=$control_loading"

profile_dir="$HOME/.config/microsoft-edge-remote"
if ! /usr/bin/python3 "$script_dir/profile-locks.py" "$profile_dir" \
  >"$REMOTEXAPP_RUNTIME/edge-profile-locks.json" \
  2>"$REMOTEXAPP_RUNTIME/edge-profile-locks.log"; then
  message=$(sed -n '1p' "$REMOTEXAPP_RUNTIME/edge-profile-locks.log")
  [ -n "$message" ] || message="Edge profile lock recovery failed"
  session_status_report --state error --summary "Edge profile is unavailable" \
    --error "$message" --detail-string application=edge \
    --detail-json "control=$control_loading"
  printf '%s\n' "$message" >&2
  exit 1
fi

matchbox-window-manager -use_titlebar no >"$REMOTEXAPP_RUNTIME/matchbox.log" 2>&1 &
wm_pid=$!

start_url=$(/usr/bin/jq -er '.startUrl | strings' "$REMOTEXAPP_PARAMETERS")
incognito=$(/usr/bin/jq -r '.incognito' "$REMOTEXAPP_PARAMETERS")
case "$incognito" in
  true|false) ;;
  *) printf '%s\n' 'invalid incognito launch parameter' >&2; exit 1 ;;
esac

set -- microsoft-edge \
  --user-data-dir="$profile_dir" \
  --no-first-run \
  --no-default-browser-check \
  --disable-background-networking \
  --disable-component-update \
  --disable-sync \
  --disable-gpu \
  --disable-dev-shm-usage \
  --password-store=basic \
  --remote-debugging-address="$control_address" \
  --remote-debugging-port="$control_port" \
  --start-maximized
if [ "$incognito" = true ]; then
  set -- "$@" --inprivate
fi
set -- "$@" "$start_url"
"$@" >"$REMOTEXAPP_RUNTIME/edge.log" 2>&1 &
edge_pid=$!
printf '%s\n' "$edge_pid" >"$REMOTEXAPP_RUNTIME/edge-process.pid"

window_ready=false
control_json=""
probe_error=""
# Leave Core time to consume our specific error status before its own deadline.
if [ -n "${REMOTEXAPP_SESSION_DEADLINE_MS:-}" ]; then
  driver_deadline_ms=$((REMOTEXAPP_SESSION_DEADLINE_MS - 5000))
else
  driver_deadline_ms=$(($(now_ms) + 40000))
fi
for _ in $(seq 1 450); do
  window_ready=false
  if [ -n "$(xdotool search --onlyvisible --class microsoft-edge 2>/dev/null || true)" ]; then
    window_ready=true
  fi
  if control_json=$(/usr/bin/python3 "$script_dir/probe.py" "$control_address" "$control_port" 2>"$REMOTEXAPP_RUNTIME/edge-cdp-probe.log"); then
    probe_error=""
  else
    control_json=""
    probe_error=$(sed -n '1p' "$REMOTEXAPP_RUNTIME/edge-cdp-probe.log" | cut -c 1-256)
  fi
  if [ "$window_ready" = true ] && [ -n "$control_json" ]; then
    break
  fi
  if ! kill -0 "$edge_pid" 2>/dev/null; then
    probe_error="Edge exited before readiness"
    break
  fi
  if [ "$(now_ms)" -ge "$driver_deadline_ms" ]; then
    break
  fi
  sleep 0.1
done
if [ "$window_ready" != true ] || [ -z "$control_json" ]; then
  if [ "$window_ready" != true ]; then
    message="Edge browser window did not become visible"
  else
    message="Edge CDP endpoint did not become ready"
  fi
  if [ -n "$probe_error" ]; then
    message="$message: $probe_error"
  fi
  session_status_report --state error --summary "Edge readiness failed" \
    --error "$message" --detail-string application=edge \
    --detail-json "control=$control_loading"
  printf '%s\n' "$message" >&2
  exit 1
fi

# The environment contract uses the stable session-owner shell. Edge rewrites
# its own initial environment memory for a process title, so /proc on the
# browser PID is not a lossless source. Keep its PID private to shutdown logic.
printf '%s\n' "$$" >"$REMOTEXAPP_RUNTIME/edge.pid"
session_status_report --state ready --summary "Edge is ready" \
  --detail-string application=edge \
  --detail-json "control=$control_json"

set +e
wait "$edge_pid"
exit_code=$?
set -e

if ! /usr/bin/python3 "$script_dir/profile-locks.py" "$profile_dir" \
  >"$REMOTEXAPP_RUNTIME/edge-profile-locks-exit.json" \
  2>"$REMOTEXAPP_RUNTIME/edge-profile-locks-exit.log"; then
  lock_error=$(sed -n '1p' "$REMOTEXAPP_RUNTIME/edge-profile-locks-exit.log")
  [ -n "$lock_error" ] || lock_error="Edge profile lock cleanup failed"
  session_status_report --state error --summary "Edge exited with unsafe profile locks" \
    --error "$lock_error" --detail-string application=edge \
    --detail-json "control=$control_json"
  printf '%s\n' "$lock_error" >&2
  exit 1
fi

if [ "$shutdown_requested" = true ]; then
  exit 0
fi
if [ "$exit_code" -eq 0 ]; then
  session_status_report --state exited --summary "Edge exited" \
    --detail-string application=edge \
    --detail-json "control=$control_json"
else
  session_status_report --state error --summary "Edge exited unexpectedly" \
    --error "Edge exit code $exit_code" --detail-string application=edge \
    --detail-json "control=$control_json"
fi
exit "$exit_code"
