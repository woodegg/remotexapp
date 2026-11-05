#!/bin/sh
set -eu
: "${REMOTEXAPP_RUNTIME:?}"
: "${REMOTEXAPP_CORE_DRIVER_DIR:?}"
[ "${REMOTEXAPP_SESSION_SERVICES:-}" = core-v1 ] || exit 1
. "$REMOTEXAPP_CORE_DRIVER_DIR/session-status.sh"
umask 077
wm_pid=""
terminal_pid=""
shutdown_requested=false
cleanup() {
  trap - EXIT INT TERM
  for pid in "$terminal_pid" "$wm_pid"; do
    if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; fi
  done
  rm -f "$REMOTEXAPP_RUNTIME/openbox.pid" "$REMOTEXAPP_RUNTIME/openbox-process.pid"
}
request_shutdown() { shutdown_requested=true; cleanup; }
trap cleanup EXIT
trap request_shutdown INT TERM
session_status_report --state loading --summary "Preparing Openbox UAT desktop" --detail-string application=openbox-desktop
openbox --sm-disable >"$REMOTEXAPP_RUNTIME/openbox.log" 2>&1 &
wm_pid=$!
printf '%s\n' "$wm_pid" >"$REMOTEXAPP_RUNTIME/openbox-process.pid"
ready=false
for _ in $(seq 1 100); do
  check=$(xprop -root _NET_SUPPORTING_WM_CHECK 2>/dev/null || true)
  case "$check" in
    *'window id # '*)
      window=${check##*window id \# }; window=${window%%,*}
      if [ "$window" != 0x0 ] && xprop -id "$window" _NET_SUPPORTING_WM_CHECK 2>/dev/null | grep -Fq "$window"; then
        ready=true; break
      fi ;;
  esac
  kill -0 "$wm_pid" 2>/dev/null || exit 1
  sleep 0.1
done
[ "$ready" = true ] || { echo 'Openbox did not become ready' >&2; exit 1; }
xterm -title 'RemoteXApp Alpine UAT' -geometry 90x26+40+40 -fa 'DejaVu Sans Mono' -fs 11 >"$REMOTEXAPP_RUNTIME/xterm.log" 2>&1 &
terminal_pid=$!
printf '%s\n' "$$" >"$REMOTEXAPP_RUNTIME/openbox.pid"
session_status_report --state ready --summary "Openbox UAT desktop is ready" --detail-string application=openbox-desktop
set +e
wait "$wm_pid"
result=$?
set -e
[ "$shutdown_requested" = false ] || exit 0
if [ "$result" = 0 ]; then
  session_status_report --state exited --summary "Openbox exited" --detail-string application=openbox-desktop
else
  session_status_report --state error --summary "Openbox failed" --error "Openbox exit code $result" --detail-string application=openbox-desktop
fi
exit "$result"
