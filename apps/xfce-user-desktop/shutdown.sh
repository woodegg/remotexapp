#!/bin/sh
set -eu

: "${REMOTEXAPP_RUNTIME:?}"
: "${REMOTEXAPP_SHUTDOWN_GRACE_SECONDS:?}"
: "${DBUS_SESSION_BUS_ADDRESS:?}"

pid=$(cat "$REMOTEXAPP_RUNTIME/xfce-process.pid" 2>/dev/null || true)
case "$pid" in
  ''|*[!0-9]*) printf '%s\n' 'XFCE session PID is unavailable' >&2; exit 10 ;;
esac
if ! kill -0 "$pid" 2>/dev/null; then
  exit 0
fi

if ! xfce4-session-logout --logout >/dev/null 2>&1; then
  printf '%s\n' 'XFCE rejected the logout request' >&2
  exit 10
fi

# Reserve one second for status propagation before the manager's deadline.
attempts=$((REMOTEXAPP_SHUTDOWN_GRACE_SECONDS * 10 - 10))
if [ "$attempts" -lt 1 ]; then attempts=1; fi
while [ "$attempts" -gt 0 ]; do
  if ! kill -0 "$pid" 2>/dev/null; then
    exit 0
  fi
  attempts=$((attempts - 1))
  sleep 0.1
done

printf '%s\n' 'XFCE logout is blocked by an application or user decision' >&2
exit 10
