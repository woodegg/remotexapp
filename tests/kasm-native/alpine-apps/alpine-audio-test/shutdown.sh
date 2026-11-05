#!/bin/sh
set -eu
: "${REMOTEXAPP_RUNTIME:?}"
pid=$(cat "$REMOTEXAPP_RUNTIME/audio-test-process.pid")
case "$pid" in ''|*[!0-9]*) exit 1 ;; esac
if kill -0 "$pid" 2>/dev/null; then kill -TERM "$pid"; fi
for _ in $(seq 1 50); do
  if ! kill -0 "$pid" 2>/dev/null; then exit 0; fi
  sleep 0.1
done
exit 1
