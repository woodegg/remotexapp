#!/bin/sh
set -eu

: "${REMOTEXAPP_RUNTIME:?}"
: "${REMOTEXAPP_CORE_DRIVER_DIR:?}"

umask 077
mkdir -p "$REMOTEXAPP_RUNTIME"

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
[ "${REMOTEXAPP_SESSION_SERVICES:-}" = core-v1 ] || { echo "Core session services required" >&2; exit 1; }
. "$REMOTEXAPP_CORE_DRIVER_DIR/session-status.sh"

xfce_pid=""
clipman_pid=""
shutdown_requested=false

cleanup() {
  trap - EXIT INT TERM
  for child_pid in "$clipman_pid" "$xfce_pid"; do
    if [ -n "$child_pid" ] && kill -0 "$child_pid" 2>/dev/null; then
      kill "$child_pid" 2>/dev/null || true
    fi
  done

  rm -f "$REMOTEXAPP_RUNTIME/xfce.pid" "$REMOTEXAPP_RUNTIME/xfce-process.pid" \
    "$REMOTEXAPP_RUNTIME/clipman.pid"
}
request_shutdown() {
  shutdown_requested=true
  cleanup
}
trap cleanup EXIT
trap request_shutdown INT TERM

# Publish application-specific startup separately from the manager's session
# state. This lets the cgroup observer distinguish an orderly XFCE logout from
# an unexpected process-tree disappearance.
session_status_report --state loading --summary "Preparing XFCE desktop" \
  --detail-string application=xfce-desktop


# Keep the profile-level autostart mask so XFCE cannot create a second Clipman
# through its freedesktop autostart entry.
mkdir -p "$XDG_CONFIG_HOME/autostart"
install -m 600 "$script_dir/xfce4-clipman-plugin-autostart.desktop" \
  "$XDG_CONFIG_HOME/autostart/xfce4-clipman-plugin-autostart.desktop"

startxfce4 >"$REMOTEXAPP_RUNTIME/xfce.log" 2>&1 &
xfce_pid=$!
printf '%s\n' "$xfce_pid" >"$REMOTEXAPP_RUNTIME/xfce-process.pid"

# Do not report session readiness while XFCE is still constructing the
# desktop. The manager may otherwise expose an attached client before a window
# manager or clipboard owner exists.
wm_ready=false
# A fresh user profile on a busy host may need more than ten seconds to start
# xfwm4 and publish its EWMH identity. Keep the wait bounded and below the
# App's 75-second session readiness deadline.
for _ in $(seq 1 300); do
  # A persistent TigerVNC display can retain the root property briefly after
  # an earlier WM exits. Do not treat the property alone as readiness: EWMH
  # requires the referenced live window to point back to itself.
  root_wm_check=$(xprop -root _NET_SUPPORTING_WM_CHECK 2>/dev/null || true)
  case "$root_wm_check" in
    *'window id # '*)
      wm_window=${root_wm_check##*window id \# }
      wm_window=${wm_window%%,*}
      if [ "$wm_window" != "0x0" ] &&
        xprop -id "$wm_window" _NET_SUPPORTING_WM_CHECK 2>/dev/null | grep -Fq "$wm_window"; then
        wm_ready=true
        break
      fi
      ;;
  esac
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
  # Filter in one native process first. Scanning every /proc entry and spawning
  # one `cat` per PID made this readiness loop scale with all host processes.
  for clipman_candidate in $(pgrep -x xfce4-clipman 2>/dev/null || true); do
    proc_dir="/proc/$clipman_candidate"
    if tr '\0' '\n' <"$proc_dir/environ" 2>/dev/null | \
      grep -Fqx "DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS"; then
      printf '%s\n' "$clipman_candidate"
    fi
  done
}

# An existing profile may own Clipman through an XFCE panel plugin, while a
# fresh/minimal profile may not contain that plugin at all. Give the panel a
# short, bounded chance to create its process, then supply exactly one
# session-owned fallback. Both forms use this generation's private D-Bus and
# are contained by the session cgroup.
clipman_pid=""
# The grace period is deliberately probe-free. Even one native pgrep still
# scans every host process, so running it every 100 ms makes a private desktop
# start depend on unrelated host process count.
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

# This is the manager's readiness marker. Both the WM and the session-owned
# clipboard manager are ready before it appears.
printf '%s\n' "$$" >"$REMOTEXAPP_RUNTIME/xfce.pid"

session_status_report --state ready --summary "XFCE desktop is ready" \
  --detail-string application=xfce-desktop

# A normal xfce4-session logout makes startxfce4 exit with status zero. Write
# the terminal status before this shell exits, so the generation-qualified
# cgroup event observes `exited` rather than classifying the empty unit as a
# crash. Manager-initiated vacancy cleanup removes the observer first.
set +e
wait "$xfce_pid"
exit_code=$?
set -e

if [ "$shutdown_requested" = true ]; then
  exit 0
fi

if [ "$exit_code" -eq 0 ]; then
  session_status_report --state exited --summary "XFCE session logged out" \
    --detail-string application=xfce-desktop
else
  session_status_report --state error --summary "XFCE session exited unexpectedly" \
    --error "XFCE exit code $exit_code" --detail-string application=xfce-desktop
fi
exit "$exit_code"
