#!/bin/sh
set -eu

: "${REMOTEXAPP_RUNTIME:?}"
: "${REMOTEXAPP_SOCKET_RUNTIME:?}"
: "${REMOTE_UNICODE_SOCKET:?}"
: "${REMOTE_UNICODE_ENGINE:?}"

umask 077
mkdir -p "$REMOTEXAPP_RUNTIME" "$REMOTEXAPP_SOCKET_RUNTIME"

xfce_pid=""
clipman_pid=""
engine_pid=""
ibus_pid=""
dbus_pid=""

cleanup() {
  trap - EXIT INT TERM
  for child_pid in "$clipman_pid" "$xfce_pid" "$engine_pid" "$ibus_pid" "$dbus_pid"; do
    if [ -n "$child_pid" ] && kill -0 "$child_pid" 2>/dev/null; then
      kill "$child_pid" 2>/dev/null || true
    fi
  done
  rm -f "$REMOTEXAPP_RUNTIME/xfce.pid" "$REMOTEXAPP_RUNTIME/clipman.pid" \
    "$REMOTEXAPP_RUNTIME/session-engine.pid" "$REMOTEXAPP_RUNTIME/session-ibus.pid" \
    "$REMOTEXAPP_RUNTIME/session-dbus.pid" "$REMOTEXAPP_RUNTIME/session-dbus-address" \
    "$REMOTE_UNICODE_SOCKET" "$REMOTEXAPP_SOCKET_RUNTIME/ibus.sock"
}
trap cleanup EXIT INT TERM

# This is the only D-Bus in the experiment. IBus, the custom engine and XFCE
# all belong to this session unit and disappear together on vacancy cleanup.
eval "$(dbus-launch --sh-syntax)"
dbus_pid=$DBUS_SESSION_BUS_PID
printf '%s\n' "$DBUS_SESSION_BUS_ADDRESS" >"$REMOTEXAPP_RUNTIME/session-dbus-address"
printf '%s\n' "$dbus_pid" >"$REMOTEXAPP_RUNTIME/session-dbus.pid"

export GTK_IM_MODULE=ibus
export QT_IM_MODULE=ibus
export XMODIFIERS=@im=ibus
export IBUS_ADDRESS="unix:path=$REMOTEXAPP_SOCKET_RUNTIME/ibus.sock"

rm -f "$REMOTEXAPP_SOCKET_RUNTIME/ibus.sock" "$REMOTE_UNICODE_SOCKET"
ibus-daemon \
  --single \
  --panel=disable \
  --emoji-extension=disable \
  --config=disable \
  --cache=none \
  --address="$IBUS_ADDRESS" \
  --replace \
  >"$REMOTEXAPP_RUNTIME/session-ibus.log" 2>&1 &
ibus_pid=$!
printf '%s\n' "$ibus_pid" >"$REMOTEXAPP_RUNTIME/session-ibus.pid"

for _ in $(seq 1 100); do
  if [ -S "$REMOTEXAPP_SOCKET_RUNTIME/ibus.sock" ]; then
    break
  fi
  if ! kill -0 "$ibus_pid" 2>/dev/null; then
    echo "session IBus daemon exited before its socket became ready" >&2
    exit 1
  fi
  sleep 0.05
done
if [ ! -S "$REMOTEXAPP_SOCKET_RUNTIME/ibus.sock" ]; then
  echo "session IBus daemon socket did not become ready" >&2
  exit 1
fi

python3 "$REMOTE_UNICODE_ENGINE" \
  --socket "$REMOTE_UNICODE_SOCKET" \
  --log "$REMOTEXAPP_RUNTIME/session-engine.log" \
  >"$REMOTEXAPP_RUNTIME/session-engine.stderr.log" 2>&1 &
engine_pid=$!
printf '%s\n' "$engine_pid" >"$REMOTEXAPP_RUNTIME/session-engine.pid"

for _ in $(seq 1 100); do
  if [ -S "$REMOTE_UNICODE_SOCKET" ] && ibus engine remote-unicode >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$engine_pid" 2>/dev/null; then
    echo "session Unicode engine exited before readiness" >&2
    exit 1
  fi
  sleep 0.1
done
if [ ! -S "$REMOTE_UNICODE_SOCKET" ]; then
  echo "session Unicode engine socket did not become ready" >&2
  exit 1
fi

# Keep the accepted single-Clipman behavior from the production XFCE driver.
mkdir -p "$XDG_CONFIG_HOME/autostart"
install -m 600 "$(dirname "$0")/xfce4-clipman-plugin-autostart.desktop" \
  "$XDG_CONFIG_HOME/autostart/xfce4-clipman-plugin-autostart.desktop"

startxfce4 >"$REMOTEXAPP_RUNTIME/xfce.log" 2>&1 &
xfce_pid=$!

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
  for clipman_candidate in $(pgrep -x xfce4-clipman 2>/dev/null || true); do
    proc_dir="/proc/$clipman_candidate"
    if tr '\0' '\n' <"$proc_dir/environ" 2>/dev/null | \
      grep -Fqx "DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS"; then
      printf '%s\n' "$clipman_candidate"
    fi
  done
}

for _ in $(seq 1 20); do
  if ! kill -0 "$xfce_pid" 2>/dev/null; then
    echo "XFCE exited before session Clipman became ready" >&2
    exit 1
  fi
  sleep 0.1
done
clipman_pids=$(find_session_clipman)
set -- $clipman_pids
if [ "$#" -eq 1 ]; then
  clipman_pid=$1
elif [ "$#" -gt 1 ]; then
  echo "XFCE started multiple session Clipman processes: $clipman_pids" >&2
  exit 1
fi
if [ -z "$clipman_pid" ]; then
  xfce4-clipman --sm-client-disable >>"$REMOTEXAPP_RUNTIME/xfce.log" 2>&1 &
  fallback_clipman_pid=$!
  for _ in $(seq 1 50); do
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
    if ! kill -0 "$fallback_clipman_pid" 2>/dev/null; then
      echo "Fallback session Clipman exited before readiness" >&2
      exit 1
    fi
    sleep 0.1
  done
fi
if [ -z "$clipman_pid" ]; then
  echo "XFCE session Clipman did not become ready" >&2
  exit 1
fi
printf '%s\n' "$clipman_pid" >"$REMOTEXAPP_RUNTIME/clipman.pid"

# Readiness means D-Bus, IBus, the Unicode engine, WM and clipboard owner are
# all alive. The manager can safely attach RFB only after this marker appears.
printf '%s\n' "$xfce_pid" >"$REMOTEXAPP_RUNTIME/xfce.pid"
wait "$xfce_pid"
