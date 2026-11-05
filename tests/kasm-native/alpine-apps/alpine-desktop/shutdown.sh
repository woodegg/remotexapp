#!/bin/sh
set -eu
: "${REMOTEXAPP_SHUTDOWN_GRACE_SECONDS:?}"
openbox --exit || exit 10
attempts=$((REMOTEXAPP_SHUTDOWN_GRACE_SECONDS * 10 - 10))
while [ "$attempts" -gt 0 ]; do
  # The session driver removes readiness only once it observes the WM exit.
  [ -f "$REMOTEXAPP_RUNTIME/openbox.pid" ] || exit 0
  attempts=$((attempts - 1))
  sleep 0.1
done
exit 10
