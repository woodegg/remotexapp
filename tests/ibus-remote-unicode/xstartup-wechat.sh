#!/bin/sh
set -eu

: "${REMOTE_UNICODE_RUNTIME:?}"
: "${REMOTE_UNICODE_SOCKET:?}"
: "${REMOTE_UNICODE_ENGINE:?}"

mkdir -p "$REMOTE_UNICODE_RUNTIME"
eval "$(dbus-launch --sh-syntax)"
printf '%s\n' "$DBUS_SESSION_BUS_ADDRESS" >"$REMOTE_UNICODE_RUNTIME/dbus-address"
printf '%s\n' "$DBUS_SESSION_BUS_PID" >"$REMOTE_UNICODE_RUNTIME/dbus.pid"
export GTK_IM_MODULE=ibus
export QT_IM_MODULE=ibus
export XMODIFIERS=@im=ibus
# Electron's GPU/SwiftShader path has rendered incorrect colours under the
# virtual X server. Keep this disposable remote-desktop session on software
# compositing, which also avoids relying on a passed-through GPU device.
export LIBGL_ALWAYS_SOFTWARE=1

ibus-daemon --panel=disable -rx >"$REMOTE_UNICODE_RUNTIME/ibus.log" 2>&1 &
ibus_pid=$!
printf '%s\n' "$ibus_pid" >"$REMOTE_UNICODE_RUNTIME/ibus.pid"

python3 "$REMOTE_UNICODE_ENGINE" \
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

matchbox-window-manager -use_titlebar no >"$REMOTE_UNICODE_RUNTIME/matchbox.log" 2>&1 &
wm_pid=$!
printf '%s\n' "$wm_pid" >"$REMOTE_UNICODE_RUNTIME/wm.pid"

wechat --disable-gpu --disable-gpu-compositing >"$REMOTE_UNICODE_RUNTIME/wechat.log" 2>&1 &
wechat_pid=$!
printf '%s\n' "$wechat_pid" >"$REMOTE_UNICODE_RUNTIME/wechat.pid"

# Matchbox intentionally keeps an application's requested geometry. noVNC can
# resize the X root dynamically, so mirror a *stable* root geometry onto
# WeChat while the app is running. Do not issue ConfigureWindow repeatedly for
# the same size: Electron redraws on every request and that can visibly jitter
# during browser resize negotiation. A small right/bottom gap avoids a rounding
# feedback loop at the noVNC viewport boundary.
(
  gap=6
  candidate=""
  stable_samples=0
  applied=""
  while kill -0 "$wechat_pid" 2>/dev/null; do
    dimensions=$(xdpyinfo 2>/dev/null | awk '/dimensions:/{print $2; exit}')
    case "$dimensions" in
      *x*)
        if [ "$dimensions" = "$candidate" ]; then
          stable_samples=$((stable_samples + 1))
        else
          candidate=$dimensions
          stable_samples=1
        fi
        if [ "$stable_samples" -ge 2 ] && [ "$dimensions" != "$applied" ]; then
          width=${dimensions%x*}
          height=${dimensions#*x}
          width=$((width - gap))
          height=$((height - gap))
          if [ "$width" -gt 0 ] && [ "$height" -gt 0 ]; then
            wmctrl -x -r 'wechat.wechat' -e "0,0,0,$width,$height" \
              >>"$REMOTE_UNICODE_RUNTIME/window-resize.log" 2>&1 || true
            applied=$dimensions
          fi
        fi
        ;;
    esac
    sleep 0.2
  done
) &
resizer_pid=$!
printf '%s\n' "$resizer_pid" >"$REMOTE_UNICODE_RUNTIME/resizer.pid"

wait "$wm_pid"
