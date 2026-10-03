#!/bin/sh
set -eu

: "${REMOTE_UNICODE_RUNTIME:?}"
: "${REMOTE_UNICODE_SOCKET:?}"
: "${PPTX_PATH:?}"
: "${LIBREOFFICE_PROFILE:?}"
: "${UNO_PORT:?}"

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_root=$(CDPATH= cd -- "$script_dir/../.." && pwd)
remote_unicode_engine=${REMOTE_UNICODE_ENGINE:-$project_root/components/remote-unicode-engine/engine.py}

mkdir -p "$REMOTE_UNICODE_RUNTIME"
eval "$(dbus-launch --sh-syntax)"
printf '%s\n' "$DBUS_SESSION_BUS_ADDRESS" >"$REMOTE_UNICODE_RUNTIME/dbus-address"
printf '%s\n' "$DBUS_SESSION_BUS_PID" >"$REMOTE_UNICODE_RUNTIME/dbus.pid"
export GTK_IM_MODULE=ibus
export QT_IM_MODULE=ibus
export XMODIFIERS=@im=ibus

ibus-daemon --panel=disable -rx >"$REMOTE_UNICODE_RUNTIME/ibus.log" 2>&1 &
ibus_pid=$!
printf '%s\n' "$ibus_pid" >"$REMOTE_UNICODE_RUNTIME/ibus.pid"

python3 "$remote_unicode_engine" \
  --socket "$REMOTE_UNICODE_SOCKET" \
  --log "$REMOTE_UNICODE_RUNTIME/engine.log" \
  >"$REMOTE_UNICODE_RUNTIME/engine.stderr.log" 2>&1 &
engine_pid=$!
printf '%s\n' "$engine_pid" >"$REMOTE_UNICODE_RUNTIME/engine.pid"

for _ in $(seq 1 80); do
  if [ -S "$REMOTE_UNICODE_SOCKET" ] && ibus engine remote-unicode >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

matchbox-window-manager -use_titlebar no &
exec libreoffice --impress --nologo --nodefault --nofirststartwizard --norestore --nolockcheck \
  --accept="socket,host=127.0.0.1,port=${UNO_PORT};urp;StarOffice.ComponentContext" \
  "-env:UserInstallation=file://${LIBREOFFICE_PROFILE}" "$PPTX_PATH"
