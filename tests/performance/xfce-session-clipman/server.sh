#!/bin/sh
set -eu

: "${REMOTEXAPP_RUNTIME:?}"
: "${REMOTEXAPP_SOCKET_RUNTIME:?}"
: "${REMOTE_UNICODE_SOCKET:?}"
: "${REMOTE_UNICODE_ENGINE:?}"

umask 077
mkdir -p "$REMOTEXAPP_RUNTIME"
mkdir -p "$REMOTEXAPP_SOCKET_RUNTIME"

dbus_pid=""
ibus_pid=""
engine_pid=""

cleanup() {
  trap - EXIT INT TERM
  for child_pid in "$engine_pid" "$ibus_pid" "$dbus_pid"; do
    if [ -n "$child_pid" ] && kill -0 "$child_pid" 2>/dev/null; then
      kill "$child_pid" 2>/dev/null || true
    fi
  done
  rm -f "$REMOTE_UNICODE_SOCKET" "$REMOTEXAPP_SOCKET_RUNTIME/ibus.sock"
}
trap cleanup EXIT INT TERM

eval "$(dbus-launch --sh-syntax)"
dbus_pid=$DBUS_SESSION_BUS_PID
printf '%s\n' "$DBUS_SESSION_BUS_ADDRESS" >"$REMOTEXAPP_RUNTIME/dbus-address"
printf '%s\n' "$dbus_pid" >"$REMOTEXAPP_RUNTIME/dbus.pid"

export GTK_IM_MODULE=ibus
export QT_IM_MODULE=ibus
export XMODIFIERS=@im=ibus
export IBUS_ADDRESS="unix:path=$REMOTEXAPP_SOCKET_RUNTIME/ibus.sock"

rm -f "$REMOTEXAPP_SOCKET_RUNTIME/ibus.sock"
ibus-daemon --panel=disable --address="$IBUS_ADDRESS" -rx >"$REMOTEXAPP_RUNTIME/ibus.log" 2>&1 &
ibus_pid=$!
printf '%s\n' "$ibus_pid" >"$REMOTEXAPP_RUNTIME/ibus.pid"

python3 "$REMOTE_UNICODE_ENGINE" \
  --socket "$REMOTE_UNICODE_SOCKET" \
  --log "$REMOTEXAPP_RUNTIME/engine.log" \
  >"$REMOTEXAPP_RUNTIME/engine.stderr.log" 2>&1 &
engine_pid=$!
printf '%s\n' "$engine_pid" >"$REMOTEXAPP_RUNTIME/engine.pid"

for _ in $(seq 1 100); do
  if [ -S "$REMOTE_UNICODE_SOCKET" ] && ibus engine remote-unicode >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done
if [ ! -S "$REMOTE_UNICODE_SOCKET" ]; then
  echo "private IBus engine did not become ready" >&2
  exit 1
fi

# Keep the profile-level autostart mask so XFCE cannot create a second Clipman.
# P03b starts the only clipboard manager explicitly in the session layer.
mkdir -p "$XDG_CONFIG_HOME/autostart"
install -m 600 "$(dirname "$0")/xfce4-clipman-plugin-autostart.desktop" \
  "$XDG_CONFIG_HOME/autostart/xfce4-clipman-plugin-autostart.desktop"

printf '%s\n' "$$" >"$REMOTEXAPP_RUNTIME/server.pid"
wait "$engine_pid"
