#!/bin/sh
set -eu

: "${REMOTEXAPP_RUNTIME:?}"
: "${REMOTEXAPP_PARAMETERS:?}"
: "${REMOTEXAPP_DRIVER_CONFIG:?}"
: "${REMOTEXAPP_RESOURCES:?}"
: "${REMOTEXAPP_CORE_DRIVER_DIR:?}"

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
[ "${REMOTEXAPP_SESSION_SERVICES:-}" = core-v1 ] || { echo "Core session services required" >&2; exit 1; }
. "$REMOTEXAPP_CORE_DRIVER_DIR/session-status.sh"

wm_pid=""
app_pid=""
probe_pid=""
cleanup() {
  trap - EXIT INT TERM
  for child_pid in "$app_pid" "$probe_pid" "$wm_pid"; do
    if [ -n "$child_pid" ] && kill -0 "$child_pid" 2>/dev/null; then
      kill "$child_pid" 2>/dev/null || true
    fi
  done

  rm -f "$REMOTEXAPP_RUNTIME/synthetic.pid" \
    "$REMOTEXAPP_RUNTIME/synthetic-process.pid" \
    "$REMOTEXAPP_RUNTIME/control-ready"
}
trap cleanup EXIT INT TERM

session_status_report --state loading --summary "Preparing synthetic App Package" \
  --detail-string application=synthetic-app

matchbox-window-manager -use_titlebar no >"$REMOTEXAPP_RUNTIME/matchbox.log" 2>&1 &
wm_pid=$!

control_address=$(jq -er '.control.address == "127.0.0.1" and .control.kind == "loopback-tcp" | if . then "127.0.0.1" else error("invalid control resource") end' "$REMOTEXAPP_RESOURCES")
control_port=$(jq -er '.control.port | select(type == "number" and . >= 1024 and . <= 65535)' "$REMOTEXAPP_RESOURCES")
probe_protocol=$(jq -er '.probeProtocol | select(. == "synthetic-json-line-v1")' "$REMOTEXAPP_DRIVER_CONFIG")
python3 "$script_dir/probe.py" \
  --address "$control_address" \
  --port "$control_port" \
  --ready-file "$REMOTEXAPP_RUNTIME/control-ready" &
probe_pid=$!

message=$(jq -er '.message' "$REMOTEXAPP_PARAMETERS")
xmessage -center -buttons OK:0 -default OK "$message" >"$REMOTEXAPP_RUNTIME/xmessage.log" 2>&1 &
app_pid=$!
printf '%s\n' "$app_pid" >"$REMOTEXAPP_RUNTIME/synthetic-process.pid"

ready=false
for _ in $(seq 1 200); do
  if [ -f "$REMOTEXAPP_RUNTIME/control-ready" ] && \
    [ -n "$(xdotool search --onlyvisible --class xmessage 2>/dev/null || true)" ]; then
    ready=true
    break
  fi
  kill -0 "$app_pid" 2>/dev/null || exit 1
  kill -0 "$probe_pid" 2>/dev/null || exit 1
  sleep 0.05
done
[ "$ready" = true ] || exit 1

control_json=$(jq -cn \
  --arg protocol "$probe_protocol" \
  --arg address "$control_address" \
  --argjson port "$control_port" \
  '{protocol:$protocol,address:$address,port:$port}')
printf '%s\n' "$$" >"$REMOTEXAPP_RUNTIME/synthetic.pid"
session_status_report --state ready --summary "Synthetic App Package is ready" \
  --detail-string application=synthetic-app \
  --detail-json "control=$control_json"

wait "$app_pid"
session_status_report --state exited --summary "Synthetic App Package exited" \
  --detail-string application=synthetic-app \
  --detail-json "control=$control_json"
