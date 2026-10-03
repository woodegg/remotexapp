#!/bin/sh
set -eu

: "${DISPLAY:?}"
: "${XAUTHORITY:?}"
: "${REMOTEXAPP_SHUTDOWN_PID:?}"
: "${REMOTEXAPP_SHUTDOWN_GRACE_SECONDS:?}"

pid=$(cat "$REMOTEXAPP_SHUTDOWN_PID" 2>/dev/null || true)
case "$pid" in
  ''|*[!0-9]*) printf '%s\n' 'application PID is unavailable' >&2; exit 10 ;;
esac
if ! kill -0 "$pid" 2>/dev/null; then
  exit 0
fi

# Match only mapped application windows. Some GTK applications also own an
# internal, unmapped GApplication window; destroying it makes an otherwise
# normal close look like an X11 crash. Alt+F4 follows the application's native
# close path and therefore preserves save/discard/cancel prompts.
windows=$(xdotool search --onlyvisible --pid "$pid" 2>/dev/null || true)
if [ -z "$windows" ]; then
  printf '%s\n' 'application has no closeable X11 window' >&2
  exit 10
fi
for window in $windows; do
  xdotool key --window "$window" alt+F4 2>/dev/null || true
done

# Return a precise blocked outcome before the manager's outer context deadline.
# A 200 ms margin was too small under production scheduling at a 15 s grace.
attempts=$((REMOTEXAPP_SHUTDOWN_GRACE_SECONDS * 10 - 10))
if [ "$attempts" -lt 1 ]; then attempts=1; fi
while [ "$attempts" -gt 0 ]; do
  if ! kill -0 "$pid" 2>/dev/null; then
    exit 0
  fi
  attempts=$((attempts - 1))
  sleep 0.1
done

printf '%s\n' 'application is still running, possibly awaiting a save decision' >&2
exit 10
