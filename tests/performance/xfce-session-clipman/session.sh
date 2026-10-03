#!/bin/sh
set -eu

: "${REMOTEXAPP_RUNTIME:?}"

umask 077
mkdir -p "$REMOTEXAPP_RUNTIME"

xfce_pid=""
clipman_pid=""
dbus_pid=""

cleanup() {
  trap - EXIT INT TERM
  for child_pid in "$clipman_pid" "$xfce_pid" "$dbus_pid"; do
    if [ -n "$child_pid" ] && kill -0 "$child_pid" 2>/dev/null; then
      kill "$child_pid" 2>/dev/null || true
    fi
  done
  rm -f "$REMOTEXAPP_RUNTIME/xfce.pid" "$REMOTEXAPP_RUNTIME/clipman.pid" \
    "$REMOTEXAPP_RUNTIME/session-dbus.pid" "$REMOTEXAPP_RUNTIME/session-dbus-address"
}
trap cleanup EXIT INT TERM

eval "$(dbus-launch --sh-syntax)"
dbus_pid=$DBUS_SESSION_BUS_PID
printf '%s\n' "$DBUS_SESSION_BUS_ADDRESS" >"$REMOTEXAPP_RUNTIME/session-dbus-address"
printf '%s\n' "$dbus_pid" >"$REMOTEXAPP_RUNTIME/session-dbus.pid"

startxfce4 >"$REMOTEXAPP_RUNTIME/xfce.log" 2>&1 &
xfce_pid=$!

# Delay session readiness until XFCE has installed a window manager.
wm_ready=false
for _ in $(seq 1 100); do
  if xprop -root _NET_SUPPORTING_WM_CHECK 2>/dev/null | grep -q 'window id #'; then
    wm_ready=true
    break
  fi
  if ! kill -0 "$xfce_pid" 2>/dev/null; then
    echo "XFCE exited before its window manager became ready" >&2
    exit 1
  fi
  sleep 0.1
done
if [ "$wm_ready" != true ]; then
  echo "XFCE window manager did not become ready" >&2
  exit 1
fi

find_session_clipman() {
  for proc_dir in /proc/[0-9]*; do
    [ "$(cat "$proc_dir/comm" 2>/dev/null || true)" = "xfce4-clipman" ] || continue
    if tr '\0' '\n' <"$proc_dir/environ" 2>/dev/null | grep -Fqx "DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS"; then
      basename "$proc_dir"
    fi
  done
}

# The default XFCE panel profile contains the Clipman panel plugin. It creates
# the session's clipboard owner even though the freedesktop autostart entry is
# masked. Do not launch another process: wait for exactly one Clipman attached
# to this private session D-Bus and make that part of readiness.
clipman_pid=""
for _ in $(seq 1 100); do
  clipman_pids=$(find_session_clipman)
  set -- $clipman_pids
  if [ "$#" -eq 1 ]; then
    clipman_pid=$1
    break
  fi
  if [ "$#" -gt 1 ]; then
    echo "XFCE started multiple session Clipman processes: $clipman_pids" >&2
    exit 1
  fi
  if ! kill -0 "$xfce_pid" 2>/dev/null; then
    echo "XFCE exited before session Clipman became ready" >&2
    exit 1
  fi
  sleep 0.1
done
if [ -z "$clipman_pid" ]; then
  echo "XFCE session Clipman did not become ready" >&2
  exit 1
fi
printf '%s\n' "$clipman_pid" >"$REMOTEXAPP_RUNTIME/clipman.pid"

# This is the manager's session-readiness file. Write it only after both XFCE
# and the panel-owned session Clipman are alive.
printf '%s\n' "$xfce_pid" >"$REMOTEXAPP_RUNTIME/xfce.pid"
wait "$xfce_pid"
